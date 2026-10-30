// 아는 주문 번호·모양 맞춤(설계 2026-10-19 주문 번호 추적 §3·§5.2) — 순수 함수만(DOM·저장소·거래소 모름).
// 오렌지엑스는 주문을 넣을 때의 응답에만 이름표(custom_order_id)를 돌려주고 미체결·주문 상태·기록 조회에서는 늘 빈 값으로 준다
// (실측 docs/research/2026-10-19-ox-order-label-probe.md §3). 그래서 '우리 주문' = 이 기기(서버 자동은 그 회원) 장부·수동 기록·자동 손절 목록에
// 적힌 거래소 주문 번호뿐이다. 다른 기기·다른 판에서 낸 우리 주문은 여기서는 '모르는 주문'이다(설계 §3 끝).
// 모양 맞춤: 결과를 모르는 주문(응답을 못 받음)을 종목·방향·감소 전용·수량·조건·만든 시각으로 찾는다 — 아는 번호가 아닌 것이 딱 하나일 때만.
export const ORDER_ID_RE = /^\d{1,30}$/;
export const KNOWN_ROLES = Object.freeze(['entry', 'tp', 'sl', 'autosl']);
// slackMs: 만든 시각 폭 = 시계 차 + 30초(설계 §5.2) · skewUnknownMs: 시계 차를 모를 때 쓰는 값(계획 정한 것 5)
export const SHAPE = Object.freeze({ slackMs: 30000, skewUnknownMs: 90000 });
// 따라가기·실행기 장부에서 끝나지 않은 매매(= follow-upkeep LIVE_FOR_ORDERS)
const FOLLOW_LIVE = Object.freeze(['open', 'opening', 'closing', 'unclear', 'detached']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const idOk = (v) => (typeof v === 'string' || (typeof v === 'number' && Number.isSafeInteger(v))) && ORDER_ID_RE.test(String(v));

export const protectIds = (x) => (isObj(x) && Array.isArray(x.orderIds) ? x.orderIds.filter(idOk).map(String) : []);

// trades = 따라가기(실행기) 장부 줄, manual = kv.manual(수동 기록 — 열린 기록의 체결·익절·자동 손절 번호, 끝난 기록의 진입 번호 entryIds·tpLeft·자동 손절 번호),
// slOrders = kv.autoSlOrders 목록 항목
export function knownOrders({ trades = [], manual = null, slOrders = [] } = {}) {
  const map = new Map();
  const put = (id, e) => {
    if (!idOk(id)) return;
    const k = String(id);
    const cur = map.get(k);
    if (!cur || (cur.live === null && e.live !== null)) map.set(k, Object.freeze({ id: k, ...e })); // 장부·기록이 목록보다 먼저(살아 있음을 앎)
  };
  for (const t of Array.isArray(trades) ? trades : []) {
    if (!isObj(t) || typeof t.id !== 'string') continue;
    const base = { inst: t.inst, tradeId: t.id, owner: 'f', live: FOLLOW_LIVE.includes(t.state) };
    for (const f of Array.isArray(t.fills) ? t.fills : []) if (isObj(f)) put(f.orderId, { ...base, role: 'entry' });
    for (const id of protectIds(t.tp)) put(id, { ...base, role: 'tp' });
    for (const id of protectIds(t.sl)) put(id, { ...base, role: 'sl' });
    if (isObj(t.autoSl)) for (const id of [t.autoSl.orderId, t.autoSl.prevOrderId]) put(id, { ...base, role: 'autosl' });
  }
  if (isObj(manual)) {
    for (const o of Object.values(isObj(manual.open) ? manual.open : {})) {
      if (!isObj(o) || typeof o.mid !== 'string') continue;
      const base = { inst: o.inst, tradeId: o.mid, owner: 'm', live: true };
      for (const f of Array.isArray(o.fills) ? o.fills : []) if (isObj(f)) put(f.orderId, { ...base, role: 'entry' });
      if (isObj(o.tp)) for (const id of [o.tp.orderId, ...(Array.isArray(o.tp.prevIds) ? o.tp.prevIds : [])]) put(id, { ...base, role: 'tp' });
      if (isObj(o.autoSl)) for (const id of [o.autoSl.orderId, o.autoSl.prevOrderId]) put(id, { ...base, role: 'autosl' });
    }
    for (const e of Array.isArray(manual.ended) ? manual.ended : []) {
      if (!isObj(e) || typeof e.mid !== 'string') continue;
      const base = { inst: e.inst, tradeId: e.mid, owner: 'm', live: false };
      // 끝난 매매의 진입 번호(entryIds — 작업 5): 같은 수량 재진입의 결과 모름 모양 맞춤에서 앞 매매의 매수를 고르지 않게(따라가기 장부는 끝난 매매도 체결 번호를 둠)
      for (const id of Array.isArray(e.entryIds) ? e.entryIds : []) put(id, { ...base, role: 'entry' });
      for (const id of Array.isArray(e.tpLeft) ? e.tpLeft : []) put(id, { ...base, role: 'tp' });
      if (isObj(e.autoSl)) for (const id of [e.autoSl.orderId, e.autoSl.prevOrderId]) put(id, { ...base, role: 'autosl' });
    }
  }
  for (const x of Array.isArray(slOrders) ? slOrders : []) {
    if (isObj(x)) put(x.orderId, { inst: x.inst, tradeId: x.tradeId, owner: x.owner === 'm' ? 'm' : 'f', role: 'autosl', live: null });
  }
  const all = () => [...map.values()];
  return Object.freeze({
    has: (id) => idOk(id) && map.has(String(id)),
    of: (id) => (idOk(id) ? map.get(String(id)) || null : null),
    ofInst: (inst) => all().filter((e) => e.inst === inst),
    ofTrade: (tradeId) => all().filter((e) => e.tradeId === tradeId),
    size: () => map.size,
  });
}
export const EMPTY_KNOWN = knownOrders({});

// 미체결 목록 → 아는 것(mine)·모르는 것(foreign). 번호가 없는 줄은 모르는 것
export function splitOpen(list, known = EMPTY_KNOWN) {
  const mine = [];
  const foreign = [];
  for (const x of Array.isArray(list) ? list : []) if (isObj(x)) (known.has(x.order_id) ? mine : foreign).push(x);
  return { mine, foreign };
}

// 만든 시각(ms) — 10자리(초)로 와도 ms로(실측 전 — 설계 §10)
export function tsMs(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0) return null;
  return n < 1e11 ? n * 1000 : n;
}
export const shapeWindowMs = (skew) => (Number.isFinite(skew) ? Math.abs(skew) : SHAPE.skewUnknownMs) + SHAPE.slackMs;

const condOf = (o) => (typeof o.condition_type === 'string' && o.condition_type ? o.condition_type : 'NORMAL');
const reduceOf = (o) => o.reduce_only === true || o.reduce_only === 'true';
export function shapeFits(o, want) {
  if (!isObj(o) || !idOk(o.order_id) || o.instrument_name !== want.inst) return false;
  if (want.side && o.direction !== want.side) return false;
  if (reduceOf(o) !== (want.reduce === true)) return false;
  if ((want.cond || 'NORMAL') !== condOf(o)) return false;
  if (Number.isFinite(want.qty) && want.qty > 0) {
    const a = Number(o.amount);
    if (!Number.isFinite(a) || Math.abs(a - want.qty) >= (want.step > 0 ? want.step : 1e-9) / 2) return false;
  }
  if (!want.anyTime) {
    const at = tsMs(o.creation_timestamp);
    if (at === null || !Number.isFinite(want.sentAt) || Math.abs(at - want.sentAt) > want.windowMs) return false;
  }
  return typeof want.fits === 'function' ? want.fits(o) === true : true;
}
// orders(미체결·기록을 합친 것 — 같은 번호는 하나로) 가운데 아는 번호가 아니고 모양이 맞는 것이 딱 하나면 { order },
// 없으면 { none: true }, 둘 이상이면 { many: n } — 없음·둘 이상은 '모름'(부르는 쪽이 채택하지 않는다)
export function shapeMatch(orders, want, known = EMPTY_KNOWN) {
  const seen = new Set();
  const hit = [];
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!isObj(o) || !idOk(o.order_id) || seen.has(String(o.order_id))) continue;
    seen.add(String(o.order_id));
    if (!known.has(o.order_id) && shapeFits(o, want)) hit.push(o);
  }
  if (hit.length === 1) return { order: hit[0] };
  return hit.length ? { many: hit.length } : { none: true };
}

// 보호 주문 번호(또는 결과 모를 보호 주문 pend — 계획 정한 것 21)가 남은 끝난 따라가기 매매(익절·손절 조건 주문 취소 확인 전) —
// 장부 300줄 정리에서 지우지 않고 정리 주기가 다시 풀고·취소·확인
const hasPend = (x) => isObj(x) && isObj(x.pend) && typeof x.pend.coid === 'string';
export function protectPending(t) {
  if (!isObj(t) || FOLLOW_LIVE.includes(t.state)) return false;
  return protectIds(t.tp).length + protectIds(t.sl).length > 0 || hasPend(t.tp) || hasPend(t.sl);
}
