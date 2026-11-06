// 트레이딩 탭 차트 위 내 매매 표시(대표 결정 2026-10-19 '차트에 내 매매 표시만' — AI 신호 표시는 지금 안 함. 모양은 같은 날 다시 정함:
// "일반 거래소들처럼 … 화살표 색깔 구분"). 순수 함수만. 회원 자기 수동 매매(kv.manual)의 체결을 방향으로만 낸다 — 매수 체결(롱 진입·추가 진입,
// 숏 끝) 'buy', 매도 체결(숏 진입·추가 진입, 롱 끝) 'sell'. 끝(익절·자동 손절·정리·원인 모르게 사라짐 모두 — 사유로 가르지 않음)은 우리가 안
// 끝 시각 closedAt 한 점. 끝난 매매도 남긴다(최근 MY_ENDED_MAX건, 마커 MY_MARKS_CAP개 — 열린 매매 먼저, 끝난 매매는 최근 것부터 매매 단위로,
// 계획 정한 것 13). 가격·손절가·낱말은 넣지 않는다(보안 규칙 18 — 시각·방향만). 모양·색·크기는 chart-markers.js MY_MARK 한 곳
// (이 파일이 chart-markers를, chart-markers가 manual-store를 끌어오지 않게 — 순수 그리기 파일은 순수 그대로)
import { entryFills } from './manual-store.js';

export const MY_MARKS_CAP = 30;
export const MY_ENDED_MAX = 10;
const SIDES = Object.freeze(['long', 'short']);
const okAt = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const inDir = (side) => (side === 'long' ? 'buy' : 'sell'); // 진입·추가 진입 체결 방향
const outDir = (side) => (side === 'long' ? 'sell' : 'buy'); // 끝(포지션을 닫는) 체결 방향
// 체결로 센 1차·추가 진입 줄의 시각(카드 비중 줄과 같은 entryFills — 보내는 중·실패·결과 모름 줄은 없음)
const fillAtsOf = (o) => entryFills(o).map((f) => f.at).filter(okAt);
export function myTradeMarks({ rec = null, ended = [], symbol, cap = MY_MARKS_CAP, endedMax = MY_ENDED_MAX } = {}) {
  if (typeof symbol !== 'string' || !symbol) return null;
  const list = [];
  if (rec && rec.symbol === symbol && SIDES.includes(rec.side)) for (const at of fillAtsOf(rec)) list.push({ at, dir: inDir(rec.side) });
  const done = (Array.isArray(ended) ? ended : []).filter((e) => e && e.symbol === symbol && SIDES.includes(e.side) && okAt(e.closedAt)).sort((a, b) => b.closedAt - a.closedAt).slice(0, endedMax);
  for (const e of done) {
    const ms = [...(Array.isArray(e.fillAts) ? e.fillAts.filter(okAt) : []).map((at) => ({ at, dir: inDir(e.side) })), { at: e.closedAt, dir: outDir(e.side) }];
    if (list.length + ms.length > cap) break;
    list.push(...ms);
  }
  return list.length ? { symbol, list: list.sort((a, b) => a.at - b.at) } : null;
}

// 서버 판(s·j — serverExec) 회원 자기 매매(2026-10-23 — 마커가 사라진 원인: 서버 판 회원 매매는 실행기에 있고 휴대폰 장부 kv.manual은 비어 있음).
// 허브가 받는 실행기 보고의 회원 trades(회원 상태 — server-exec checkServerState를 지난 줄)로 같은 모양을 낸다: 진입 openedAt(롱 buy·숏 sell),
// 끝난 매매는 끝 closedAt(거울). 2·3·4차 체결 시각은 보고에 칸이 없어 진입·끝만(실행기 보고를 바꾸지 않음). 건너뜀(skipped)·기록만(shadow)은 체결이 없어 뺌
const SERVER_LIVE = Object.freeze(['open', 'opening', 'closing', 'unclear', 'detached']);
export function serverTradeMarks({ trades = [], symbol, cap = MY_MARKS_CAP, endedMax = MY_ENDED_MAX } = {}) {
  if (typeof symbol !== 'string' || !symbol) return null;
  const mine = (Array.isArray(trades) ? trades : []).filter((t) => t && typeof t === 'object' && t.symbol === symbol && SIDES.includes(t.side) && okAt(t.openedAt));
  const list = [];
  for (const t of mine) if (SERVER_LIVE.includes(t.state) && !okAt(t.closedAt)) list.push({ at: t.openedAt, dir: inDir(t.side) });
  const done = mine.filter((t) => t.state === 'closed' && okAt(t.closedAt)).sort((a, b) => b.closedAt - a.closedAt).slice(0, endedMax);
  for (const t of done) {
    if (list.length + 2 > cap) break;
    list.push({ at: t.openedAt, dir: inDir(t.side) }, { at: t.closedAt, dir: outDir(t.side) });
  }
  return list.length ? { symbol, list: list.sort((a, b) => a.at - b.at) } : null;
}
