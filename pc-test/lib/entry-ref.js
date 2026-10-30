// 트레이딩 탭 '진입 참고가' 카드 값(대표 결정 2026-10-25 — 보안 규칙 22 예외: 사무실 판정판 '▶ 진입가·익절가 보기' → 이 카드 →
// 회원이 [진입하기]와 확인 [진입]을 둘 다 눌러야만 수동 1차 진입 명령). 값은 셸이 허브 GET /v1/analysis/item/<id>로 받은 그 분석 항목의
// plan(허브가 판정 때 받은 오렌지엑스 시세·익절가 — 보안 규칙 19)뿐 — 사무실이 보낸 숫자는 쓰지 않는다(사무실은 분석 id만 보냄).
// 배율·비중·익절 %는 이 판 trade-rules(수동 1차와 같은 값 — 사무실 패널의 follow-rules 회원 기본값과 지금 같음 50×·13%·+10%).
// 순수 함수만(화면은 modes/trade-server-orders.js). 손절가·청산가는 없다(보안 규칙 18)
import { ANALYSIS_ID } from './analysis-shape.js';

export const ENTRY_REF_MAX_AGE_MS = 30 * 60 * 1000; // 분석이 이보다 오래면 진입 버튼을 잠근다(새 분석 뒤 진입)
const SYM = /^[A-Z0-9]{1,20}$/;
const LIVE = Object.freeze(['open', 'opening', 'closing']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

export const ER_TEXT = Object.freeze({
  title: (sym) => `${sym}/USDT · 진입 참고가`,
  pos: '포지션', margin: '마진', marginVal: '격리', lev: '레버리지', pct: '비중', entry: '진입가', tp: '익절가',
  side: (s) => (s === 'SHORT' ? 'SHORT/숏 오픈' : 'LONG/롱 오픈'),
  go: '진입하기', close: '닫기', yes: '진입', no: '취소',
  confirm: (sym, side, lev, pct) => `${sym} ${side === 'SHORT' ? '숏' : '롱'} 1차 진입 · ${lev}× · 잔고 ${pct}%`,
  // 버튼 대신 한 줄(짧게)
  verify: 'UID 활성화 후 진입할 수 있습니다.',
  closed: '수동 진입은 아직 열리지 않았습니다.',
  loading: '서버 상태를 확인하는 중입니다.',
  enroll: '서버 등록 뒤 진입할 수 있습니다.',
  symbol: '이 종목은 진입할 수 없습니다.',
  stale: '30분 지난 분석입니다 — 새 분석 뒤 진입하세요.',
  auto: '오토 모드가 켜져 있어 수동 진입은 쉽니다.',
  open: '이 종목에 열린 매매가 있습니다.',
  loadFail: '진입 참고가를 불러오지 못했습니다.',
  none: '이 분석에는 진입 참고가가 없습니다.',
});

// 허브 분석 항목(analysis-shape cleanAnalysis) → { id, symbol, side, entry, tp, at } | null(HOLD·plan 없음·id 다름·값 틀림)
export function entryRefOfItem(item, id) {
  if (!isObj(item) || typeof id !== 'string' || !ANALYSIS_ID.test(id) || item.id !== id) return null;
  if (typeof item.symbol !== 'string' || !SYM.test(item.symbol) || !pos(item.at)) return null;
  const p = isObj(item.plan) ? item.plan : null;
  if (!p || (p.side !== 'LONG' && p.side !== 'SHORT') || !pos(p.entry) || !pos(p.tp)) return null;
  return { id, symbol: item.symbol, side: p.side, entry: p.entry, tp: p.tp, at: item.at };
}

export function fmtRef(n) {
  const a = Math.abs(n);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// 카드 글·막는 이유. st = 서버 회원 상태(serverExec.state()), manualOk = 서버 판 수동 주문 자격(tradeReady 판 또는 시험 토큰 — 주문 칸과 같은 관문),
// member = UID 활성화 회원. block = null이면 [진입하기], 아니면 그 한 줄(가격은 그대로 보임)
export function entryRefModel(ref, { now = Date.now(), st = null, manualOk = false, member = false, rules = null } = {}) {
  if (!isObj(ref) || (ref.side !== 'LONG' && ref.side !== 'SHORT') || !pos(ref.entry) || !pos(ref.tp)) return null;
  const coin = rules && rules.tabs && rules.tabs.coin ? rules.tabs.coin : null;
  const lev = coin && Number.isInteger(coin.lev) ? coin.lev : null;
  const firstPct = rules && rules.entry && Number.isFinite(rules.entry.firstPct) ? rules.entry.firstPct : null;
  const tpPct = rules && rules.entry && Number.isFinite(rules.entry.tpPct) ? rules.entry.tpPct : null;
  const ok = isObj(st) && st.ok === true;
  const trades = ok && Array.isArray(st.trades) ? st.trades.filter(isObj) : [];
  let block = null;
  if (!member) block = ER_TEXT.verify;
  else if (!manualOk) block = ER_TEXT.closed;
  else if (!coin || !Array.isArray(coin.watch) || !coin.watch.includes(ref.symbol) || !lev || !firstPct || !tpPct) block = ER_TEXT.symbol;
  else if (!(now - ref.at <= ENTRY_REF_MAX_AGE_MS)) block = ER_TEXT.stale;
  else if (!ok) block = ER_TEXT.loading;
  else if (st.status !== 'on') block = ER_TEXT.enroll;
  else if (st.auto === true) block = ER_TEXT.auto;
  else if (trades.some((t) => t.symbol === ref.symbol && LIVE.includes(t.state))) block = ER_TEXT.open;
  return {
    title: ER_TEXT.title(ref.symbol),
    side: ER_TEXT.side(ref.side),
    margin: ER_TEXT.marginVal,
    lev: lev ? `${lev}×` : '–',
    pct: firstPct ? `${firstPct}%` : '–',
    entry: fmtRef(ref.entry),
    tp: fmtRef(ref.tp),
    tpPct: tpPct ? `(+${tpPct}%)` : '',
    block,
  };
}
