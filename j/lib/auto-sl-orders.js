// 기기 자동 손절 주문 목록(p34 설계 §2.7·§8.2) — IndexedDB ptf-<판>-vault kv.autoSlOrders = { v: 1, list: [ { inst, coid, orderId|null, owner: 'f'|'m', tradeId, state: 'sending'|'live', sendAt, at } ] }.
// 따라가기(f)·트레이딩 탭 수동 주문(m) 두 장부가 같이 쓴다. 가격 칸은 없다(발동가는 거래소 주문에만). 쓰기는 vault.update(한 거래)로만, requireDurable 먼저.
// 항목은 거래소가 끝 상태(cancelled·filled·rejected)를 줄 때만 지운다(안 나간 것이 확실한 보내기 실패는 부르는 쪽이 바로 지움) — 매매가 끝나도
// 항목이 남아 있는 동안 계속 본다. 최대 100건(넘으면 새로 받지 않음 — 부르는 쪽이 failed).
// cancelEntry·checkBeforeEntry·sweepEntries는 거래소 손잡이(ops: orderState·cancel·findByCoid — follow-exec가 만든다)를 받는다.
import { requireDurable } from './vault.js';
import { AUTO_SL } from './auto-sl.js';
import { OX_AUTH_FAIL, OX_PARAM_FAIL } from './ox-client.js';

export const ORDERS_KV = 'autoSlOrders';
const END = Object.freeze(['filled', 'partial', 'failed']); // orderStateOf 끝 값(filled / 취소·거절(체결분 있으면 partial))
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function clean(e) {
  return {
    inst: String(e.inst),
    coid: String(e.coid),
    orderId: e.orderId == null || e.orderId === '' ? null : String(e.orderId),
    owner: e.owner === 'm' ? 'm' : 'f',
    tradeId: String(e.tradeId),
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

// type market 미체결 조회(U-A2)는 덧붙인 조회 — 거래소·중계가 그 꼴을 '확정' 거절하면 그 조회는 없는 것으로 본다(그러지 않으면 type market을
// 모르는 거래소에서 끝 확인이 영영 안 된다). 확정 거절(p35 검토 2·3) = 중계·앱 검사의 파라미터 거절(denied bad_params — 그 칸을 모르는 허브)
// 또는 거래소 파라미터 오류(ox 8000 'Request params not valid!' — 실측)뿐. 그 밖의 ox(요청 과다·내부 오류 — WS 직접 경로는 거래소 오류가
// 모두 ox)·denied 다른 이유·down·rate·busy는 일시 실패('모름'). 이 기기에서 그 조회가 된 적이 있으면(listedType 'market') 어떤 실패도 거절이 아니다
export function refusedQuery(r, { listedType = null } = {}) {
  if (listedType === 'market' || !r || r.ok || !r.outcome) return false;
  const o = r.outcome;
  if (o.kind === 'denied') return o.error === 'bad_params';
  return o.kind === 'ox' && Number(o.code) === OX_PARAM_FAIL;
}
// 주문 상태 조회 실패의 까닭(p35 검토 4): 거래소가 그 번호에 오류로 답함(그런 주문 없음 — UID·키를 바꾼 기기의 옛 번호·거래소가 지운 옛 주문 등) →
// 'unknown'(자동 정리·새 진입 확인에서는 끝 확인 전과 같고, '확인했습니다'만 미체결에 안 보일 때 회원 확인으로 지움). 인증 실패(10000·1001)·
// 망 실패(down·rate·busy·시간 초과)는 'net'(물어보지 못함)
export function stateFailWhy(s) {
  const o = s && s.outcome;
  return o && o.kind === 'ox' && !OX_AUTH_FAIL.includes(Number(o.code)) ? 'unknown' : 'net';
}

// 항목 하나 취소 → 끝 확인. { done, end?, order?, cancelled?, why?, foundId? } — done이면 목록에서 지워도 된다.
// 번호를 모르면(보낸 결과 모름) 식별자로 찾는다(미체결 일반 → type market → 기록 20건, foundId = 찾은 번호) — 못 찾으면 listed 기기에서
// 보낸 지 60초가 지났을 때만 '안 나감'(end 'absent'), 아니면 모름. 끝나지 않은 까닭 why: 'net'(조회 실패) · 'absent'(어디에도 없음 — 번호 모름) ·
// 'open'(취소 뒤에도 거래소가 open이라 답함) · 'unknown'(모르는 order_state — U-A8, 또는 상태 조회에 거래소가 오류로 답함). cancelled: 이번에 취소를 보냈다
// opt: listed·listedType·noMarket(스위치 read 값 — noMarket이면 market 조회를 하지 않음), onRefused(market 조회 확정 거절을 봄 — 기기에 적기)
export async function cancelEntry(e, ops, { listed = false, listedType = null, noMarket = false, now = Date.now(), onRefused = null } = {}) {
  let id = e.orderId;
  let foundId = null;
  if (!id) {
    let f = await ops.findByCoid(e.inst, e.coid);
    if (f && f.ok && !f.order && (listedType === 'market' || !noMarket)) {
      const m = await ops.findByCoid(e.inst, e.coid, { type: 'market' }); // 조건 주문이 type market 조회에만 보이는 거래소(U-A2)
      if (refusedQuery(m, { listedType })) {
        if (onRefused) await onRefused();
      } else f = m;
    }
    if (!f || !f.ok) return { done: false, why: 'net' };
    if (!f.order) {
      const gone = !!listed && Number.isFinite(e.sendAt) && now - e.sendAt >= AUTO_SL.unclearMs;
      return gone ? { done: true, end: 'absent' } : { done: false, end: 'absent', why: 'absent' };
    }
    id = String(f.order.order_id);
    foundId = id;
  }
  const out = (r) => (foundId ? { ...r, foundId } : r);
  let s = await ops.orderState(id);
  if (!s || !s.ok) return out({ done: false, why: stateFailWhy(s) });
  if (END.includes(s.state)) return out({ done: true, end: s.state, order: s.order });
  await ops.cancel(id);
  s = await ops.orderState(id);
  if (!s || !s.ok) return out({ done: false, why: stateFailWhy(s), cancelled: true });
  if (END.includes(s.state)) return out({ done: true, end: s.state, order: s.order, cancelled: true });
  return out({ done: false, why: s.state === 'open' ? 'open' : 'unknown', raw: s.order ? s.order.order_state ?? null : null, cancelled: true });
}

// 새 진입 전 확인(§2.7): 그 종목 항목을 모두 끝 확인 — 하나라도 못 하면 거짓(진입하지 않음). 확인된 것은 지운다. opt = cancelEntry와 같음
export async function checkBeforeEntry(inst, { orders, ops, ...opt } = {}) {
  let ok = true;
  for (const e of await orders.list()) {
    if (e.inst !== inst) continue;
    const r = await cancelEntry(e, ops, opt);
    if (r.done) await orders.remove([e.coid]);
    else ok = false;
  }
  return ok;
}

// 목록 정리(§2.7): 주인이 살아 있지 않은 항목(alive(e) 거짓)만 취소 → 끝 확인 → 지움. 지운 수. opt = cancelEntry와 같음
export async function sweepEntries({ orders, ops, alive = () => true, ...opt } = {}) {
  let n = 0;
  for (const e of await orders.list()) {
    if (alive(e)) continue;
    const r = await cancelEntry(e, ops, opt);
    if (r.done) {
      await orders.remove([e.coid]);
      n += 1;
    }
  }
  return n;
}
