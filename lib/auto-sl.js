// 자동 손절 공용 계약(p34 설계 §8 — 따라가기·트레이딩 탭 수동 주문이 같은 함수·같은 글을 쓴다). 순수 함수만(DOM·저장소·거래소 모름).
// 동업자 최신판 20261008a와 같게(대표 결정 2026-10-08): 스위치 하나(기본 켜짐), 그 매매가 4차(follow-rules.json autoSl.afterStage) 진입한 뒤에만
// 회원 자기 포지션 청산가 바로 앞(liqGapPct)에 reduce_only STOP 조건 주문(ptf.<id>.g<k>)을 건다. 손절가·남은 거리는 화면·기록·기기 저장
// 어디에도 두지 않는다 — 여기서 계산한 발동가는 거래소 주문에 넣거나 메모리에서 비교할 때만 쓴다.
// 고정물 test/fixtures/auto-sl-cases.json이 이 파일의 답을 못 박는다(트레이딩 탭이 같은 답을 확인).
import { MATH } from './follow-math.js';

export const AUTO_SL = Object.freeze({
  liqBuffer: MATH.liqBuffer, // 경험식 청산 폭 = 1/L − 0.0038(follow-math·허브 리허설과 같은 값)
  minGapFrac: 0.001, // 거래소 liquid_price가 평단과 0.1% 미만이면 잘못 읽은 값으로 보고 버림
  minTicks: 2, // 청산가에서 2 tick 이상 안쪽
  estimateMult: 2, // 청산가가 계산값이면 거리 2배(더 안쪽)
  matchFrac: 0.5, // 걸린 주문의 발동가 허용 오차 = 청산가 × g/100 × 0.5
  maxK: 999,
  maxOrders: 100, // 기기 자동 손절 주문 목록(kv.autoSlOrders) 최대
  rejectsMax: 3, // 거래소가 연속으로 거절하면 failed
  retryFailedMs: 600000, // failed는 10분 뒤 한 번 다시
  unclearMs: 60000, // listed 기기에서 보낸 뒤 60초 동안 어디에도 없으면 안 나간 것
  busyMs: 5000, // 스위치 연타 막기
});

const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
const decimals = (step) => {
  const s = String(step);
  const e = /e-(\d+)$/i.exec(s);
  if (e) return Number(e[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};
const ceilTo = (v, tick) => Number((Math.ceil(v / tick - 1e-9) * tick).toFixed(decimals(tick)));
const floorTo = (v, tick) => Number((Math.floor(v / tick + 1e-9) * tick).toFixed(decimals(tick)));

// 4차 판정 — stage = 따라가기 신호 차수(sigStage) / 수동은 그 매매의 체결 줄 수
export const autoSlDue = (stage, afterStage) => Number.isInteger(stage) && Number.isInteger(afterStage) && stage >= afterStage;

// 청산가(§2.4): ① 거래소 liquid_price — 손실 쪽이고 평단과 0.1% 이상·1/L 이하(0은 없음) ② 경험식 avg × (1 − dir × (1/L − 0.0038)).
// 증거금 공식(margin − maintenance_margin)은 쓰지 않는다(문서 예시의 margin이 표시가 기준으로 보임 — U-A3 확인 전)
export function liqOf({ dir, avg, lev, liquidPrice = null } = {}) {
  if ((dir !== 1 && dir !== -1) || !(avg > 0) || !(lev >= 1)) return null;
  const ex = num(liquidPrice);
  if (ex != null && ex > 0) {
    const d = ((avg - ex) * dir) / avg;
    if (d >= AUTO_SL.minGapFrac && d <= 1 / lev) return { liq: ex, src: 'exchange' };
  }
  const w = 1 / lev - AUTO_SL.liqBuffer;
  if (!(w > AUTO_SL.minGapFrac)) return null;
  return { liq: avg * (1 - dir * w), src: 'estimate' };
}

// 발동가(§2.4): liq × (1 + dir × g/100), g = liqGapPct(계산값이면 2배). 평단 쪽으로 tick 반올림(롱 올림·숏 내림), 청산가에서 2 tick 이상 안쪽.
// 평단에 닿거나 넘으면 걸지 않음(auto_sl_no_room)
export function autoSlTrigger({ dir, avg, liq, src, gapPct, tick } = {}) {
  if ((dir !== 1 && dir !== -1) || !(avg > 0) || !(liq > 0) || !(gapPct > 0) || !(tick > 0)) return { skip: 'auto_sl_no_room' };
  const g = (src === 'estimate' ? AUTO_SL.estimateMult : 1) * gapPct;
  const raw = liq * (1 + (dir * g) / 100);
  const bound = liq + dir * AUTO_SL.minTicks * tick;
  const trigger = dir === 1 ? Math.max(ceilTo(raw, tick), ceilTo(bound, tick)) : Math.min(floorTo(raw, tick), floorTo(bound, tick));
  if (dir * (avg - trigger) <= 0) return { skip: 'auto_sl_no_room' };
  return { trigger };
}
// 계산에 쓴 거리(%) — 맞추기 허용 오차용
export const autoSlGap = (src, gapPct) => (src === 'estimate' ? AUTO_SL.estimateMult : 1) * gapPct;

// 이미 지났는지(§2.4·§2.11) — 표시가만(체결가 순간 튐으로 먼저 닫지 않게). 표시가가 없으면 거짓(조건 주문을 건다)
export function autoSlPassed({ dir, trigger, mark } = {}) {
  const m = num(mark);
  if (m == null || !(m > 0) || !(trigger > 0)) return false;
  return dir * (m - trigger) <= 0;
}

// 판정(§2.6 표): 포지션 없음(확인됨) → 취소 / 스위치 꺼짐 → 취소(매매 상태와 무관) / open + 4차 → 건다 / 그 밖(1~3차·unclear·closing·detached) → 그대로
export function autoSlVerdict({ on, gone, state, due } = {}) {
  if (gone) return 'cancel';
  if (!on) return 'cancel';
  if (state === 'open' && due) return 'place';
  return 'keep';
}

// 걸린 주문이 원하는 것과 맞나: 수량 step 절반 안·발동가 청산가 × g/100 × 0.5 안
export function autoSlMatches(order, { qty, trigger, liq, g, step } = {}) {
  const a = num(order && order.amount);
  const p = num(order && order.trigger_price);
  if (a == null || p == null) return false;
  return Math.abs(a - qty) < step / 2 && Math.abs(p - trigger) <= liq * (g / 100) * AUTO_SL.matchFrac;
}

const byId = (a, b) => {
  const x = BigInt(String(a.order_id));
  const y = BigInt(String(b.order_id));
  return x < y ? -1 : x > y ? 1 : 0;
};
// 중복 정리(§2.7): 하나뿐이면 취소 없음. 둘 이상이면 원하는 수량·발동가에 맞는 것 중 order_id가 가장 작은 것, 없으면 가장 작은 것을 남긴다
export function dedupeKeep(orders, want) {
  const list = (Array.isArray(orders) ? orders : []).filter((o) => o && /^\d{1,30}$/.test(String(o.order_id)));
  if (list.length <= 1) return { keep: list[0] || null, cancel: [] };
  const sorted = [...list].sort(byId);
  const keep = sorted.find((o) => autoSlMatches(o, want)) || sorted[0];
  return { keep, cancel: sorted.filter((o) => o !== keep) };
}

// 다음 k = (장부·목록·미체결에서 본 k) 중 최대 + 1. 999를 넘으면 null(더 걸지 않음)
export function nextK(ks) {
  const max = (Array.isArray(ks) ? ks : []).filter((k) => Number.isInteger(k) && k >= 1 && k <= AUTO_SL.maxK).reduce((a, k) => Math.max(a, k), 0);
  return max + 1 > AUTO_SL.maxK ? null : max + 1;
}
const G_RE = /\.g([1-9]\d{0,2})$/;
export function isAutoSlCoid(coid, id) {
  return typeof coid === 'string' && coid.startsWith(`ptf.${id}.`) && G_RE.test(coid);
}
export function autoSlKOf(coid) {
  const m = typeof coid === 'string' ? G_RE.exec(coid) : null;
  return m ? Number(m[1]) : null;
}

// 공용 문구(§5.4 자동 손절 줄) — 가격·거리 없음. 배율 숫자 없음
export const AUTO_SL_TEXT = Object.freeze({
  label: '자동 손절',
  on: '자동 손절 ON',
  off: '자동 손절 OFF',
  desc: '4차 진입 뒤 청산가 바로 앞에서 자동 손절 — 1~3차에는 손절 없음',
  help: '언제든 켜고 끌 수 있고, 열린 매매에 바로 적용됩니다. 끄면 이 앱이 건 자동 손절 주문(따라가기·트레이딩 탭 주문 모두)을 취소합니다. 손절가는 표시하지 않습니다.',
  toastOn: '자동 손절을 켰습니다',
  toastOff: '자동 손절을 껐습니다',
  busy: '맞추는 중',
  confirmOff: '자동 손절을 끄면 이 앱이 이 기기 포지션(따라가기·트레이딩 탭)에 건 자동 손절 주문을 모두 지웁니다. 끄시겠습니까?',
  confirmGo: '끄기',
  confirmCancel: '취소',
  offLocked: '인증이 풀린 동안에는 자동 손절을 끌 수 없습니다. 켜기와 다시 걸기는 됩니다.',
  turningOff: '거래소에 자동 손절 주문이 남아 있습니다 — 지우는 중입니다. 앱을 화면에 켜 두세요.',
  followOff: '따라가기를 꺼도 앱이 화면에 켜져 있는 동안 열린 매매의 자동 손절은 계속 맞춥니다. 앱이 꺼져 있으면 이미 건 주문만 거래소에 남아 있습니다.',
  failed: "자동 손절 주문을 걸지 못했습니다 — 앱이 화면에 켜져 있는 동안 30초마다 시세(표시 가격)를 보고 직접 정리합니다. 거래소 앱에서 손절을 확인하거나 '다시 걸기'를 누르세요.",
  retry: '다시 걸기',
  retryHelp: "오렌지엑스 앱 '조건 주문'에 이 앱의 자동 손절이 없을 때만 누르세요. 있으면 누르지 마세요(두 개가 됩니다).",
  checkNeeded: "이전 자동 손절 주문을 확인하지 못해 이 종목에 새로 진입하지 않았습니다 — 오렌지엑스 앱 '조건 주문'에서 확인하세요.",
  clear: '확인했습니다',
  clearHelp: "오렌지엑스 앱 '조건 주문'에 이 앱의 자동 손절이 남아 있지 않은 것을 본 뒤 누르세요. 남아 있으면 거래소 앱에서 먼저 취소하세요.",
  // p35 §5.3 고침 2 — '확인했습니다'·'다시 걸기'를 누른 뒤(포지션부터 확인)
  clearHasPos: '포지션이 있어 지금은 확인할 수 없습니다',
  clearError: '지금은 확인할 수 없습니다 — 잠시 뒤 다시 눌러 주세요',
  clearStillOpen: '이 앱의 자동 손절이 아직 거래소에 있어 다시 취소합니다',
  clearUnknown: '이 앱이 보낸 자동 손절이 거래소에 남아 있을 수 있습니다 — 오렌지엑스 앱 조건 주문 탭에서 직접 확인한 뒤 눌러 주세요',
  otherTab: '다른 탭에서 따라가기를 쓰는 중입니다',
  word: Object.freeze({
    wait: '자동 손절 · 대기(4차 진입 뒤)',
    noStage: '자동 손절 · 대기(차수 모름)', // 신호에 진입 차수가 없음(p35 F-8) — 차수가 오면 그때부터

    set: '자동 손절 · 걸림',
    checking: '자동 손절 · 확인 중',
    failed: '자동 손절 · 걸지 못함',
    off: '자동 손절 · 꺼짐',
    turningOff: '자동 손절 · 끄는 중',
  }),
  // 시험 토큰 진단 줄(U-A2·U-A3·U-A8) — 가격 없이. 보임 여부가 null이면 조회하지 못함
  diag: ({ listed = null, listedMarket = null, src = null, raw = null } = {}) => {
    const seen = (v) => (v === true ? '보임' : v === false ? '안 보임' : '확인 못 함');
    const s = src === 'exchange' ? '거래소' : src === 'estimate' ? '계산값' : '-';
    const r = typeof raw === 'string' && /^[A-Za-z_]{1,24}$/.test(raw) ? raw : '-';
    return `자동 손절 진단: 주문 목록에 ${seen(listed)} (type market: ${seen(listedMarket)}) · 청산가 출처 ${s} · 주문 상태 ${r}`;
  },
});

const WORD_STATES = Object.freeze(['open', 'opening', 'closing', 'unclear', 'detached']);
// 매매 하나의 상태 낱말(§2.9) — 끝난 매매는 null. pending = 이 매매의 자동 손절 주문이 기기 목록에 남아 있음(꺼짐이면 '끄는 중')
export function autoSlWord(trade, { on, afterStage, pending = false } = {}) {
  if (!trade || !WORD_STATES.includes(trade.state)) return null;
  const W = AUTO_SL_TEXT.word;
  if (!on) return pending ? W.turningOff : W.off;
  if (!Number.isInteger(trade.sigStage)) return W.noStage;
  if (!autoSlDue(trade.sigStage, afterStage)) return W.wait;
  const s = trade.autoSl && typeof trade.autoSl === 'object' ? trade.autoSl.state : null;
  if (s === 'set') return W.set;
  if (s === 'failed') return W.failed;
  return W.checking;
}
