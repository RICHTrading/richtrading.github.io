// AI 신호 최근 결과(2026-10-28 대표 요청) — 허브 GET /v1/analysis/results → 트레이딩 탭 'AI 오토 모드 최근 매매'(동업자 운영 계정 송출) 자리.
// 실제로 낸 신호를 신호 가격·공개 시세로 셈한 결과(hub/lib/signal-results.js) — 익절·손절·24시간 마감·진행 중을 모두 싣는다(이긴 것만 고르지 않음)
import { PCT_BASIS } from './auto-view.js';

export const RESULT_TEXT = Object.freeze({
  // 2026-10-29 대표·동업자: 손실·진행 중은 빼고 익절만(PC판 '수익 알림'처럼) — 전체 결과처럼 보이지 않게 제목·요약에 '익절'을 밝힌다
  title: '최근 익절 신호',
  summary: (s, days) => `최근 ${days}일 익절 ${s.tp}건`,
  basis: `% = ${PCT_BASIS}`,
  empty: '아직 익절한 신호가 없습니다.',
  side: { LONG: '롱', SHORT: '숏' },
  word: { tp: '익절', sl: '손절', end: '24시간 마감', open: '진행 중' },
});
const RESULTS = Object.freeze(['tp', 'sl', 'end', 'open']);
const SYM_RE = /^[A-Z0-9]{1,20}$/;
const ID_RE = /^[A-Za-z0-9]{1,40}$/;
const KEEP = 50;

const pad = (n) => String(n).padStart(2, '0');
function fmtMDHM(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const signed = (p) => (p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : '0%');
const okInt = (x) => Number.isInteger(x) && x >= 0 && x <= 100000;

// 허브 응답 → 화면 모양 | null(꺼짐·모양 틀림 — 그때는 옛 목록 그대로)
export function signalResultsView(r) {
  if (!r || typeof r !== 'object' || r.on !== true || !Array.isArray(r.items)) return null;
  const s = r.summary && typeof r.summary === 'object' ? r.summary : null;
  if (!s || !okInt(s.tp)) return null;
  const days = Number.isInteger(r.days) && r.days > 0 && r.days <= 31 ? r.days : 7;
  const lines = r.items.slice(0, KEEP).filter((x) => x && typeof x === 'object'
    && typeof x.id === 'string' && ID_RE.test(x.id) && typeof x.symbol === 'string' && SYM_RE.test(x.symbol)
    && Object.hasOwn(RESULT_TEXT.side, x.side) && x.result === 'tp' // 익절만
    && typeof x.at === 'number' && Number.isFinite(x.at) && typeof x.pct === 'number' && Number.isFinite(x.pct) && Math.abs(x.pct) <= 1000)
    .map((x) => ({
      seq: x.id,
      time: fmtMDHM(x.at),
      text: `${x.symbol} ${RESULT_TEXT.side[x.side]} · ${RESULT_TEXT.word[x.result]} ${signed(x.pct)}`,
      tone: x.result === 'tp' ? 'good' : x.result === 'sl' ? 'bad' : x.result === 'open' ? 'dim' : (x.pct >= 0 ? 'good' : 'bad'),
    }));
  return { title: RESULT_TEXT.title, note: RESULT_TEXT.summary(s, days), basis: RESULT_TEXT.basis, empty: RESULT_TEXT.empty, lines };
}
