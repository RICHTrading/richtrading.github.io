// 따라가기 계산(설계 3-2 §6.5·§6.7) — 순수 함수만(node에서 검사). 수량·배율·익절·손절 가격·주문 식별자·가격 차이·허브 시각 표본.
// 숫자 반올림은 종목의 step(수량)·tick(가격) 자릿수로 — 1e-9를 더해 0.1+0.2 같은 부동소수 오차로 한 단위 모자라지 않게.
import { OX_COID_RE } from './ox-client.js';
import { stageMarginPct } from './dca-rules.js'; // 다른 모듈을 가져오지 않는 순수 파일 — 순환 없음

export const MATH = Object.freeze({
  minBase: 10, // 기준 잔고 10 USDT 미만이면 건너뜀(§6.5)
  availFrac: 0.95, // 사용 가능 잔고의 95%까지(§6.5)
  liqBuffer: 0.0038, // 예상 청산 폭 = 1/L − 0.0038(02 §3.6 경험식)
  badSignalPct: 2, // 방향과 무관하게 신호가 대비 2% 넘게 다르면 bad_signal(§6.6)
  testMaxBase: 200, // 시험 토큰 기준 잔고 상한 기본(허브 follow.testMaxBase — 회원 상태 limits.maxBase가 있으면 그것)
  maxRoundTripMs: 2000, // 허브 시각 표본: 왕복 2초 넘으면 버림(§6.6)
});

export const dirOf = (side) => (side === 'long' ? 1 : side === 'short' ? -1 : 0);

export function decimalsOf(step) {
  const s = String(step);
  const e = /e-(\d+)$/i.exec(s);
  if (e) return Number(e[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
export function floorTo(v, step) {
  return Number((Math.floor(v / step + 1e-9) * step).toFixed(decimalsOf(step)));
}
export function roundTo(v, tick) {
  return Number((Math.round(v / tick) * tick).toFixed(decimalsOf(tick)));
}
// 오렌지엑스 숫자 문자열(지수 표기 없이, step 자릿수)
export const numStr = (v, step) => Number(v).toFixed(decimalsOf(step));

// ── 주문 식별자(§6.7): ptf.<id>.<꼬리> — id = 송출 12자 16진, 리허설 r + 11자 16진, 트레이딩 탭 수동 주문 m + 11자 16진(p40, spec §5.7).
// 꼬리 e1 · d<fill> · t<k> · s<k> · g<k>(p34 자동 손절) · a<k>(수동 추가 진입 1~99). 셋은 겹치지 않는다(첫 글자 r·m은 16진이 아님) ──
export const TRADE_ID_RE = /^(?:[0-9a-f]{12}|r[0-9a-f]{11})$/; // 따라가기 이벤트 id 검사 — 수동 id는 받지 않는다
export const MANUAL_ID_RE = /^m[0-9a-f]{11}$/;
const TAIL_RE = /^(?:e1|d[1-9]\d{0,2}|t[1-9]\d{0,2}|s[1-9]\d{0,2}|g[1-9]\d{0,2}|a[1-9]\d?)$/;
export function coidFor(id, tail) {
  const c = `ptf.${id}.${tail}`;
  const sid = String(id);
  if (!(TRADE_ID_RE.test(sid) || MANUAL_ID_RE.test(sid)) || !TAIL_RE.test(String(tail)) || c.length > 36 || !OX_COID_RE.test(c)) throw new Error(`coid: ${c}`);
  return c;
}
export const coidPrefix = (id) => `ptf.${id}.`;
export const isPtf = (coid) => typeof coid === 'string' && coid.startsWith('ptf.');
// 따라가기·리허설이 낸 주문(spec §5.10) — 수동(ptf.m…)은 아님. 따라가기 진입의 has_orders는 이것이 아닌 미체결을 회원 주문으로 본다
export const FOLLOW_COID_RE = /^ptf\.(?:[0-9a-f]{12}|r[0-9a-f]{11})\./;
export const isFollowCoid = (c) => typeof c === 'string' && FOLLOW_COID_RE.test(c);
// 그 매매의 조건 익절·손절 주문(ptf.<id>.t*·.s*)
export function isProtectCoid(coid, id) {
  return typeof coid === 'string' && coid.startsWith(coidPrefix(id)) && /\.(?:t|s)\d{1,3}$/.test(coid);
}

// ── 배율(§6.5): min(신호 배율, 종목 최대). 허브 천장(oxMaxLev, 기본 50)을 넘으면 배율을 못 바꾸므로 lev_denied ──
export function chooseLev(signalLev, instMaxLev, cap = 50) {
  if (!Number.isInteger(signalLev) || signalLev < 1) return { skip: 'no_lev' };
  const L = Number.isFinite(instMaxLev) && instMaxLev >= 1 ? Math.min(signalLev, Math.floor(instMaxLev)) : signalLev;
  if (L > Math.min(125, cap)) return { skip: 'lev_denied' };
  return { lev: L };
}

// ── 기준 잔고(§6.5): get_assets_info(["PERPETUAL"])의 total_margin_balance → 없으면 wallet_balance. 시험 토큰은 min(그 값, maxBase) ──
const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
export function assetsView(result) {
  const p = result && typeof result === 'object' ? result.PERPETUAL : null;
  if (!p || typeof p !== 'object') return null;
  const total = num(p.total_margin_balance) ?? num(p.wallet_balance);
  const available = num(p.available_funds);
  return total == null ? null : { total, available: available == null ? total : available };
}
export function baseFrom(view, { test = false, maxBase = null } = {}) {
  if (!view) return { skip: 'low_balance' };
  const cap = test ? (Number.isFinite(maxBase) && maxBase > 0 ? maxBase : MATH.testMaxBase) : Infinity;
  const base = Math.min(view.total, cap);
  if (!(base >= MATH.minBase)) return { skip: 'low_balance' };
  return { base };
}

// ── 증거금(§6.5): base × weightPct/100 × 배수, 한 매매 최대(base × capPct/100 − 이미 쓴 증거금)·사용 가능 잔고 × 0.95 ──
export function marginFor({ base, weightPct, mult = 1, capPct, used = 0, available }) {
  if (!(Number.isFinite(weightPct) && weightPct > 0)) return { skip: 'no_weight' };
  if (!(Number.isFinite(capPct) && capPct > 0)) return { skip: 'capped' }; // 한 매매 최대 증거금이 없으면(기본값 없음 — 회원 입력) 주문하지 않는다
  const notes = [];
  let m = base * (weightPct / 100) * mult;
  const room = base * (capPct / 100) - used;
  if (m > room) {
    m = room;
    notes.push('capped');
  }
  if (!(m > 0)) return { skip: 'capped' };
  const avail = (Number.isFinite(available) ? available : 0) * MATH.availFrac;
  if (m > avail) {
    m = avail;
    notes.push('low_funds');
  }
  if (!(m > 0)) return { skip: 'low_balance' };
  return { margin: m, notes };
}

// ── 수량(§6.5): floor(margin × L / px / step) × step, 최소 수량·최소 명목 밑이면 below_min ──
export function qtyFor({ margin, lev, px, step, minQty = 0, minNotional = 0 }) {
  if (!(px > 0) || !(step > 0)) return { skip: 'below_min' };
  const q = floorTo((margin * lev) / px, step);
  if (!(q > 0) || q < (minQty || 0) || q * px < (minNotional || 0)) return { skip: 'below_min' };
  return { qty: q, amount: numStr(q, step) };
}

// ── 익절·손절 가격(§6.5 '같은 가격 폭'): 신호 %는 신호 배율 기준 증거금 % → 가격 폭으로 바꿔 회원 평단에 붙인다 ──
// tpMove = tpPct/(100·S), slMove = slPct/(100·S)(손실 쪽 음수·추적 손절 양수). 회원 직접 손절은 없다(p34 — 대표 결정 2026-10-08,
// 4차 진입 뒤 자동 손절은 auto-sl.js가 따로). px = 지금 가격: 익절가가 이미 지났으면 tp_passed, 손절가가 현재가 반대쪽이면 sl_passed(그 다리는 걸지 않음).
// 손실 쪽 손절 폭이 예상 청산 폭(1/L − 0.0038) 이상이면 sl_beyond_liq를 남기고 진입한다(단일 모드 — 배포판 그대로)
export function tpslFor(o) {
  const { dir, avg, signalLev, lev, tpPct = null, slPct = null, tick, px = avg } = o;
  const S = signalLev;
  const notes = [];
  const tpMove = Number.isFinite(tpPct) && tpPct > 0 ? tpPct / (100 * S) : null;
  const slMove = Number.isFinite(slPct) && slPct !== 0 ? slPct / (100 * S) : null;
  let tp = tpMove == null ? null : roundTo(avg * (1 + dir * tpMove), tick);
  let sl = slMove == null ? null : roundTo(avg * (1 + dir * slMove), tick);
  if (slMove != null && slMove < 0 && -slMove >= 1 / lev - MATH.liqBuffer) notes.push('sl_beyond_liq');
  if (tp != null && dir * (tp - px) <= 0) {
    tp = null;
    notes.push('tp_passed');
  }
  if (sl != null && dir * (sl - px) >= 0) {
    sl = null;
    notes.push('sl_passed');
  }
  return { tp, sl, notes };
}

// ── 신호 가격 대조(§6.6, p34 §3.2): 양쪽 2% 넘으면 bad_signal(②·③ 모두 안 함) — 신호 가격 자체가 틀린 데이터 오류를 막는 내부 장치.
// 회원 설정 '가격 차이 한도'는 없앴다(대표 결정 2026-10-08, 동업자판에 없음) — 2% 안이면 불리해도 그대로 ──
export function slipCheck({ px, price }) {
  if (!(px > 0) || !(price > 0)) return { reason: 'bad_signal', pct: null };
  const diff = Math.abs(((px - price) / price) * 100);
  if (diff > MATH.badSignalPct) return { reason: 'bad_signal', pct: diff };
  return { reason: null, pct: diff };
}

// ── 허브 시각 표본(§6.6): 요청·응답 쌍마다 now − (보낸 시각 + 받은 시각)/2, 왕복 2초 넘으면 버림 ──
export function offsetSample(sentAt, recvAt, hubNow) {
  if (!Number.isFinite(hubNow) || !(recvAt >= sentAt) || recvAt - sentAt > MATH.maxRoundTripMs) return null;
  return hubNow - (sentAt + recvAt) / 2;
}

// ── AI 신호 주문 크기·가격(설계 2026-10-16 §7.4~7.6·§15.5) — 서버 실행기가 신호 매매·수동 매매에 같이 쓴다.
// 옛 함수(chooseLev·marginFor·tpslFor·slipCheck)는 옛 길용으로 그대로 둔다. 가격은 계산해 돌려줄 뿐 — 기록·보고에 싣지 않는다(규칙 18) ──

// 운용 금액 C = 사용 가능 잔고 × 운용 상한 %(§6). 상한이 없으면 no_cap(기본값 없음 — 회원 입력), 시험 토큰은 maxBase(없으면 MATH.testMaxBase)까지,
// MATH.minBase 밑이면 low_balance
export function capitalFor({ available, capPct, test = false, maxBase = null } = {}) {
  if (!(Number.isFinite(capPct) && capPct > 0)) return { skip: 'no_cap' };
  if (!Number.isFinite(available)) return { skip: 'low_balance' };
  let capital = (available * Math.min(capPct, 100)) / 100;
  if (test) capital = Math.min(capital, Number.isFinite(maxBase) && maxBase > 0 ? maxBase : MATH.testMaxBase);
  if (!(capital >= MATH.minBase)) return { skip: 'low_balance' };
  return { capital };
}
// 수동 매매 운용 금액(§15.5 — 관리자 판단): 운용 상한이 없으면 100%로 본다(회원이 직접 누른 것)
export function manualCapitalFor({ available, capPct = null, test = false, maxBase = null } = {}) {
  return capitalFor({ available, capPct: Number.isFinite(capPct) && capPct > 0 ? capPct : 100, test, maxBase });
}

// 사용 가능 잔고 × 0.95 상한(§6.5) — 넘으면 줄이고 low_funds
function availCap(m, available) {
  const notes = [];
  const avail = (Number.isFinite(available) ? available : 0) * MATH.availFrac;
  if (m > avail) {
    m = avail;
    notes.push('low_funds');
  }
  if (!(m > 0)) return { skip: 'low_balance' };
  return { margin: m, notes };
}
// 1차 증거금 = C × 1차 비중 %
export function firstMarginFor({ capital, firstPct, available } = {}) {
  if (!(capital > 0) || !(firstPct > 0)) return { skip: 'low_balance' };
  return availCap((capital * firstPct) / 100, available);
}
// 2·3·4차 증거금 = min(사용 가능 잔고, C − 쓴 증거금) × 그 차수 비율(stageMarginPct — 마지막 차수는 배율만큼 남김)
export function dcaMarginFor({ capital, used = 0, available, stage, lev } = {}) {
  if (!stage || !(capital > 0)) return { skip: 'low_balance' };
  const base = Math.min(Number.isFinite(available) ? available : 0, capital - (Number.isFinite(used) ? used : 0));
  const pct = stageMarginPct(stage, lev);
  if (!(base > 0) || !(pct > 0)) return { skip: 'low_balance' };
  return availCap((base * pct) / 100, available);
}

// 불리한 쪽 움직임(증거금 %) = dir × (평단 − 가격) / 평단 × 100 × 배율 — 차수마다 그 순간 평단에서(avgReset)
export const adversePct = ({ dir, avg, px, lev } = {}) => ((dir * (avg - px)) / avg) * 100 * lev;
// 선 경계 비교 여유 — 100 − 99.2 같은 부동소수 오차로 정확히 선에 닿은 값을 놓치지 않게(증거금 % 1e-9는 가격으로 의미 없는 폭)
const EDGE_EPS = 1e-9;
// 다음 차수(stage = stageRule 칸): 강제 선 이상 → force, 조건부 선 이상이고 조건 참 → cond, 그 밖 null
export function dcaDecision({ m, stage, condOk = false } = {}) {
  if (!stage || !Number.isFinite(m)) return null;
  if (m >= stage.forcePct - EDGE_EPS) return 'force';
  if (m >= stage.condPct - EDGE_EPS && condOk === true) return 'cond';
  return null;
}

// 익절 발동가 = 평단 × (1 + dir × 익절%/(100×배율)), tick 반올림
export const tpPriceFor = ({ dir, avg, tpPct, lev, tick } = {}) => roundTo(avg * (1 + (dir * tpPct) / (100 * lev)), tick);
// 직접 % 손절 자리 = 평단 × (1 − dir × |손절%|/(100×배율)), tick 반올림 — 서버 감시 판정에서만(거래소에 걸지 않음, Q23)
// tick 반올림은 평단 쪽으로(롱 올림·숏 내림 — 손실이 반 tick 더 커지지 않게, 검토 4 사소 2)
export const pctStopFor = ({ dir, avg, slPct, lev, tick } = {}) => {
  const v = avg * (1 - (dir * Math.abs(slPct)) / (100 * lev));
  const n = v / tick;
  const k = dir === 1 ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
  return Number((k * tick).toFixed(decimalsOf(tick)));
};
// 청산 거리(증거금 %) L = |청산가 − 평단| / 평단 × 배율 × 100
export const liqMarginPct = ({ avg, liq, lev } = {}) => (Math.abs(liq - avg) / avg) * lev * 100;

// 미리 거는 자동 손절(§7.5): 다음 차수 강제 선 ≥ d × L. d는 auto-sl.js autoSlDist와 같은 식(이미 ÷100 — 진행 기록 Ruling)이지만
// auto-sl.js를 가져오지 않는다(auto-sl.js가 맨 위에서 이 파일의 MATH를 읽어 거꾸로 가져오면 순환). 두 식이 같은지는 시험이 비교
export function earlyAutoSl({ liqPct, nextStage, src, autoSl } = {}) {
  if (!autoSl || autoSl.early !== true || !nextStage || !Number.isFinite(liqPct) || !(liqPct > 0)) return false;
  const d = (src === 'estimate' ? autoSl.estDistPct : autoSl.liqDistPct) / 100;
  if (!(d > 0)) return false;
  return nextStage.forcePct >= d * liqPct - EDGE_EPS;
}

// 회원 직접 손절 인정(§7.5 ⓑ Q18): 대상 = 감소 전용 STOP·반대 방향(롱이면 sell)·아는 번호 밖(known — 그 회원 장부·목록의 거래소 주문 번호,
// Set이나 has()가 있는 객체. 조회 결과 이름표는 늘 비어 있어 번호로만 가린다 — 주문 번호 추적 설계 2026-10-19). 번호 없는 줄은 보지 않는다.
// 이름표가 ptf.로 오는 줄은 우리 주문으로 보고 뺀다(덜 끄는 쪽). 하나도 없으면 none,
// 그중 수량 ≥ 포지션 − step/2이고 발동가가 청산가보다 평단 쪽(롱 trigger > liq·숏 trigger < liq)인 것이 있으면 covers, 아니면 partial
export function memberStopOf({ orders, side, size, liq, step, known = null } = {}) {
  const dir = dirOf(side);
  if (!dir) return 'none';
  const close = dir === 1 ? 'sell' : 'buy';
  // known이 없으면 우리 주문인지 가를 수 없으니 회원 직접 손절로 인정하지 않는다(감시를 끄지 않는 쪽 — 검토 4 사소 1)
  if (!known || typeof known.has !== 'function') return 'none';
  const isKnown = (id) => known.has(String(id));
  const list = (Array.isArray(orders) ? orders : []).filter((o) => o && typeof o === 'object'
    && /^\d{1,30}$/.test(String(o.order_id ?? ''))
    && o.condition_type === 'STOP'
    && (o.reduce_only === true || o.reduce_only === 'true')
    && o.direction === close
    && !isPtf(o.custom_order_id)
    && !isKnown(o.order_id));
  if (!list.length) return 'none';
  const half = (step > 0 ? step : 0) / 2;
  const covers = list.some((o) => {
    const a = num(o.amount);
    const t = num(o.trigger_price);
    return a != null && t != null && Number.isFinite(size) && a >= size - half && Number.isFinite(liq) && dir * (t - liq) > 0;
  });
  return covers ? 'covers' : 'partial';
}

// 내 매매 결과 %(증거금 기준) — 기록용
export function tradeResultPct({ dir, avg, exit, lev }) {
  if (!(avg > 0) || !(exit > 0) || !(lev > 0)) return null;
  return Math.round(((exit - avg) / avg) * dir * lev * 1000) / 10;
}

// 회원 본인 실현 손익 USDT(p34 §4.2) = dir × (청산 평균가 − 평단) × 청산 수량, 0.01 반올림, 거래 비용(수수료·펀딩) 제외. 모르면 null(지어내지 않음)
export function pnlUsdt({ dir, avg, price, qty }) {
  if ((dir !== 1 && dir !== -1) || !(avg > 0) || !(price > 0) || !(qty > 0)) return null;
  const v = dir * (price - avg) * qty;
  const r = Math.round((v + Math.sign(v) * 1e-9) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}
