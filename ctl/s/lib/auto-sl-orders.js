// 기기 자동 손절 주문 목록(p34 설계 §2.7·§8.2) — IndexedDB ptf-<판>-vault kv.autoSlOrders = { v: 1, list: [ { inst, coid, orderId|null, owner: 'f'|'m', tradeId,
// side: 'long'|'short'|null, qty: string|null, state: 'sending'|'live', sendAt, at } ] }. side = 그 매매 방향(가격 아님 — 번호 없는 항목의 모양 맞춤에 쓴다, 주문 번호 추적 정한 것 17.
// 옛 항목은 null — 방향을 보지 않는다). qty = 보낸 수량 글자(amount — 가격 아님, 최종 검토 중요 1: 번호 없는 항목의 모양 맞춤이 수량까지 보게. 옛 항목은 null).
// 따라가기(f)·트레이딩 탭 수동 주문(m) 두 장부가 같이 쓴다. 가격 칸은 없다(발동가는 거래소 주문에만).
// 쓰기는 vault.update(한 거래)로만, requireDurable 먼저.
// 항목은 거래소가 끝 상태(cancelled·filled·rejected)를 줄 때만 지운다(안 나간 것이 확실한 보내기 실패·허브가 거절을 기억한 것, 서버 실행기만 허브 모름·모양 없음
// 60초(presumedUnsent)도 끝 — 부르는 쪽이 지움) — 매매가 끝나도 항목이 남아 있는 동안 계속 본다. 최대 100건(넘으면 새로 받지 않음 — 부르는 쪽이 failed).
// cancelEntry·checkBeforeEntry·sweepEntries는 거래소 손잡이(ops: orderState·cancel·resolvePlaced — follow-exec가 만든다)를 받는다.
import { requireDurable } from './vault.js';
import { AUTO_SL } from './auto-sl.js';
import { OX_AUTH_FAIL } from './ox-client.js';
import { decimalsOf } from './follow-math.js';

export const ORDERS_KV = 'autoSlOrders';
const END = Object.freeze(['filled', 'partial', 'failed']); // orderStateOf 끝 값(filled / 취소·거절(체결분 있으면 partial))
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// 보낸 수량 글자(숫자 글자이고 0보다 큼)만 — 그 밖은 null(옛 항목과 같음)
const qtyOk = (v) => (typeof v === 'string' && /^\d{1,12}(\.\d{1,12})?$/.test(v) && Number(v) > 0 ? v : null);
function clean(e) {
  return {
    inst: String(e.inst),
    coid: String(e.coid),
    orderId: e.orderId == null || e.orderId === '' ? null : String(e.orderId),
    owner: e.owner === 'm' ? 'm' : 'f',
    tradeId: String(e.tradeId),
    side: e.side === 'long' || e.side === 'short' ? e.side : null,
    qty: qtyOk(e.qty),
    state: e.state === 'live' ? 'live' : 'sending',
    sendAt: fin(e.sendAt),
    at: fin(e.at),
  };
}
const valid = (e) => isObj(e) && typeof e.inst === 'string' && typeof e.coid === 'string' && e.coid.startsWith('ptf.') && typeof e.tradeId === 'string';
const listOf = (cur) => (isObj(cur) && Array.isArray(cur.list) ? cur.list.filter(valid).map(clean) : []);

export function createAutoSlOrders(vault, { max = AUTO_SL.maxOrders } = {}) {
  async function list() {
    try {
      return listOf(vault ? await vault.get(ORDERS_KV) : undefined);
    } catch {
      return [];
    }
  }
  async function add(e) {
    requireDurable(vault);
    let ok = false;
    await vault.update(ORDERS_KV, (cur) => {
      const l = listOf(cur);
      if (l.some((x) => x.coid === e.coid)) {
        ok = true;
        return { v: 1, list: l };
      }
      if (l.length >= max) {
        ok = false;
        return { v: 1, list: l };
      }
      ok = true;
      return { v: 1, list: [...l, clean(e)] };
    });
    return ok;
  }
  async function patch(coid, fields) {
    requireDurable(vault);
    await vault.update(ORDERS_KV, (cur) => ({ v: 1, list: listOf(cur).map((x) => (x.coid === coid ? clean({ ...x, ...fields }) : x)) }));
  }
  async function remove(coids) {
    requireDurable(vault);
    const drop = new Set(Array.isArray(coids) ? coids : [coids]);
    await vault.update(ORDERS_KV, (cur) => ({ v: 1, list: listOf(cur).filter((x) => !drop.has(x.coid)) }));
  }
  // 회원 '확인했습니다'의 항목 지우기는 follow-autosl confirmInst가 항목마다(remove) — 종목 전체를 한 번에 지우는 길은 두지 않는다(p35 §5.3)
  return { list, add, patch, remove };
}

// type market 미체결 조회(옛 U-A2)와 그 확정 거절 판단(옛 refusedQuery)은 없다 — 조건 주문은 인자 없는 미체결에만 보인다(실측 §2, 주문 번호 추적 정한 것 9·18)
// 주문 상태 조회 실패의 까닭(p35 검토 4): 거래소가 그 번호에 오류로 답함(그런 주문 없음 — UID·키를 바꾼 기기의 옛 번호·거래소가 지운 옛 주문 등) →
// 'unknown'(자동 정리·새 진입 확인에서는 끝 확인 전과 같고, '확인했습니다'만 미체결에 안 보일 때 회원 확인으로 지움). 인증 실패(10000·1001)·
// 망 실패(down·rate·busy·시간 초과)는 'net'(물어보지 못함)
export function stateFailWhy(s) {
  const o = s && s.outcome;
  return o && o.kind === 'ox' && !OX_AUTH_FAIL.includes(Number(o.code)) ? 'unknown' : 'net';
}

// 결과 모름을 '안 나감'으로 보는가(r = ops.resolvePlaced 답) — 서버 실행기 keeper만(회원 '다시 걸기'·'확인했습니다' 화면이 없음 — 진행 기록 Task 4 Ruling,
// 계획 정한 것 8·21과 같은 조건): 허브(실행기는 늦은 답 기억)가 unknown(pending·error 아님) + 모양 없음(none — 둘 이상 아님) + 보낸 시각을 앎 + 보낸 지 dropMs
// 넘음(조건 주문은 인자 없는 미체결·기록에 늘 보임 — 실측 §2). opt = { dropMs, nowMs } — dropMs가 없으면(휴대폰 따라가기·수동은 넘기지 않음) 늘 거짓
export function presumedUnsent(r, sentAt, opt) {
  const { dropMs = null, nowMs = null } = opt || {};
  return Number.isFinite(dropMs) && dropMs > 0 && Number.isFinite(nowMs) && Number.isFinite(sentAt)
    && !!r && r.state === 'unknown' && r.hub === 'unknown' && r.none === true && nowMs - sentAt > dropMs;
}

// 항목 하나 취소 → 끝 확인. { done, end?, order?, cancelled?, why?, foundId? } — done이면 목록에서 지워도 된다.
// 번호를 모르면(보낸 결과 모름) 허브 기억 → 모양 맞춤(ops.resolvePlaced — 인자 없는 미체결 + 기록, 감소 전용·반대 방향 STOP·보낸 수량(qty)·보낸 시각,
// 아는 번호 아님 — 주문 번호 추적 설계 2026-10-19 §5)으로 찾는다(foundId = 찾은 번호). 채택은 허브 기억(via hub) 또는 보낸 수량까지 맞는 모양 하나뿐 —
// 수량을 모르는 옛 항목(qty null)의 넓은 모양(수량·발동가 안 봄) 하나는 회원이 직접 건 STOP일 수 있어 채택·취소하지 않는다(최종 검토 중요 1, 설계 §6.10 —
// 모르면 '모름'으로 남김: 감소 전용 STOP이 둘이 되는 쪽). 허브가 거절을 기억하면(안 나감이 확실) 끝(end 'absent'), 그래도 모르면
// 시간이 지나도 모름(옛 listed 60초 규칙 없음 — 설계 §1-3, 지우는 것은 회원 '확인했습니다'뿐). 단 서버 실행기는 drop(presumedUnsent의 opt)을 넘겨
// 허브 모름·모양 없음 + 보낸 지 60초면 끝(end 'absent')으로 본다 — 모양은 이 물음 그대로(보낸 수량 있는 항목은 보낸 수량 모양: 우리 STOP의 amount는
// 보낸 그대로라 그것이 없으면 걸린 것이 없음 — 회원 STOP이 폭 안에 있어도 실행기가 영영 막히지 않게, 옛 항목은 넓은 모양 — 진행 기록 Task 4 Ruling).
// 셋째 인자의 옛 이름(listed·now 등 — 60초 규칙)은 보지 않는다. 조회 결과의 이름표로는 찾지 않는다(§1-2).
// 끝나지 않은 까닭 why: 'net'(조회 실패) · 'absent'(번호 모름 — 허브·모양으로 못 찾음) · 'open'(두 번 취소한 뒤에도 거래소가 open이라 답함) ·
// 'unknown'(모르는 order_state — U-A8, 또는 상태 조회에 거래소가 오류로 답함). cancelled: 이번에 취소를 보냈다
export async function cancelEntry(e, ops, drop = null) {
  let id = e.orderId;
  let foundId = null;
  if (!id) {
    const q = qtyOk(e.qty);
    const r = await ops.resolvePlaced({ inst: e.inst, coid: e.coid, sentAt: e.sendAt, side: e.side === 'long' ? 'sell' : e.side === 'short' ? 'buy' : null, reduce: true, cond: 'STOP', qty: q ? Number(q) : null, step: q ? 10 ** -decimalsOf(q) : 0.001 });
    if (!r || r.state === 'net') return { done: false, why: 'net' };
    if (r.state === 'rejected' || presumedUnsent(r, e.sendAt, drop)) return { done: true, end: 'absent' };
    if (r.state !== 'placed' || (!q && r.via !== 'hub')) return { done: false, end: 'absent', why: 'absent' };
    id = String(r.orderId);
    foundId = id;
  }
  const out = (r) => (foundId ? { ...r, foundId } : r);
  let s = await ops.orderState(id);
  if (!s || !s.ok) return out({ done: false, why: stateFailWhy(s) });
  if (END.includes(s.state)) return out({ done: true, end: s.state, order: s.order });
  const c1 = await ops.cancel(id);
  s = await ops.orderState(id);
  if (c1 && c1.ok && s && s.ok && !END.includes(s.state)) {
    // 취소가 200(정상 답)인데 남음(대표 실측 2026-10-21 — 두 번째 취소에 사라짐): 잠깐 뒤(ops.pause — 주입 sleep, 없으면 바로) 한 번 더.
    // 번호당 최대 2번 — 그래도 남으면 끝 아님. 취소 자체가 실패한 것은 여기서 다시 보내지 않는다(다음 확인)
    if (typeof ops.pause === 'function') await ops.pause();
    await ops.cancel(id);
    s = await ops.orderState(id);
  }
  if (!s || !s.ok) return out({ done: false, why: stateFailWhy(s), cancelled: true });
  if (END.includes(s.state)) return out({ done: true, end: s.state, order: s.order, cancelled: true });
  return out({ done: false, why: s.state === 'open' ? 'open' : 'unknown', raw: s.order ? s.order.order_state ?? null : null, cancelled: true });
}

// 새 진입 전 확인(§2.7): 그 종목 항목을 모두 끝 확인 — 하나라도 못 하면 거짓(진입하지 않음). 확인된 것은 지운다.
// dropMs·nowMs: 서버 실행기만(presumedUnsent) — 옛 옵션 이름(listed·listedType·noMarket·now·onRefused — 60초 규칙)은 넘겨도 보지 않는다
export async function checkBeforeEntry(inst, { orders, ops, dropMs = null, nowMs = null } = {}) {
  let ok = true;
  for (const e of await orders.list()) {
    if (e.inst !== inst) continue;
    const r = await cancelEntry(e, ops, { dropMs, nowMs });
    if (r.done) await orders.remove([e.coid]);
    else ok = false;
  }
  return ok;
}

// 목록 정리(§2.7): 주인이 살아 있지 않은 항목(alive(e) 거짓)만 취소 → 끝 확인 → 지움. 지운 수
export async function sweepEntries({ orders, ops, alive = () => true } = {}) {
  let n = 0;
  for (const e of await orders.list()) {
    if (alive(e)) continue;
    const r = await cancelEntry(e, ops);
    if (r.done) {
      await orders.remove([e.coid]);
      n += 1;
    }
  }
  return n;
}
