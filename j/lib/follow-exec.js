// 따라가기 거래소 절차(설계 3-2 §6.6~§6.10) — 진입·추가 진입·종료·익절/손절 보호·남은 주문 정리·보내다 끊긴 줄 확인.
// call(method, params, opts) = ox-client.call(같은 결과 모양 Outcome). 장부 줄(trade)을 받아 바뀐 새 줄을 돌려준다 — 저장은 부른 쪽(엔진)이,
// 단 주문을 보내기 전의 'sending' 줄은 save(trade)로 먼저 저장한다(§6.4 — 그 사이 앱이 꺼지면 다음에 그 줄을 확인).
// 주문 번호 추적(설계 2026-10-19): 오렌지엑스는 조회(미체결·주문 상태·기록)에 이름표(custom_order_id)를 늘 빈 값으로 준다 — 이름표는 보내기만 하고
// (허브 중복 막기·결과 기억의 열쇠) 조회 결과의 이름표로는 아무것도 판단하지 않는다. '우리 주문' = 넣을 때 응답의 번호를 장부에 적은 것(known — 아는 번호).
// - 결과 모름(504·끊김·같은 식별자·200인데 번호 없음): 허브 기억(placed — POST /v1/member/ox/placed, 보낸 바로 뒤 약 2·6·15초) → 모양 맞춤(인자 없는 미체결 +
//   기록 20건에서 아는 번호가 아니고 종목·방향·감소 전용·수량·조건·만든 시각이 맞는 것이 딱 하나) → 모름. 모름이면 같은 주문을 다시 보내지 않는다(보안 규칙 22).
// - 1차 진입 전 미체결에 모르는 번호가 있으면 건너뜀(has_orders — 아무것도 취소하지 않음), 아는 번호(남은 우리 주문)는 번호로 취소·끝 확인 뒤 진입.
// - 정리·고아 정리·보호 주문 교체의 취소는 장부 번호로만(cancelIds — 취소 뒤 그 번호의 주문 상태로 끝 확인, 거짓 성공 없음).
// - 한 동작 안의 get_positions·get_assets_info는 5초 동안 다시 쓴다(호출 수 줄이기, §6.8).
// - 서버 요청 제한(rate·busy): 위험을 늘리는 호출은 그 신호를 건너뛰고(rate_hub), 체결 확인·보호 확인·종료는 1초 뒤 최대 3번 다시.
// - p34 자동 손절(설계 §2.5~§2.8): placeAutoSl(STOP·reduce_only·표시가 발동·ptf.<id>.g<k>), orderState·cancelOrder(ops — auto-sl-orders가 끝 확인에 씀),
//   closeTrade의 포지션 없음 갈래는 그 매매 자동 손절 주문 상태부터(filled면 사유 auto_sl), 아니면 최근 기록의 반대 방향 reduce_only 체결로 exit.
//   회원 본인 USDT 손익(§4) = dir × (exit 평균가 − 평단) × exit 수량(거래 비용 제외) — 모르면 null.
import { orderStateOf, positionVerdict, syncAllowed, CORE } from './follow-core.js';
import { assetsView, coidFor, decimalsOf, numStr, roundTo, tradeResultPct, dirOf, pnlUsdt } from './follow-math.js';
import { isHedgeModeError, oxCodeOf } from './ox-errors.js';
import { OX_AUTH_FAIL } from './ox-client.js';
import { EMPTY_KNOWN, splitOpen, shapeMatch, shapeWindowMs, protectIds, ORDER_ID_RE, tsMs } from './known-orders.js';
import { ownsPosition } from './follow-autosl.js';

export const EXEC = Object.freeze({ fillPollMs: 600, fillPolls: 5, openCancelMs: 3000, unknownPollMs: 1000, unknownPolls: 3, cacheMs: 5000, retryMs: 1000, retries: 3, tpslTol: 0.002, historyCount: 20, recancelMs: 500 });
// recancelMs: 취소가 200 + order_id로 답했는데 그 주문이 아직 열려 있을 때 한 번 더 취소하기 전 쉼(대표 실측 2026-10-21 — '취소 200 = 취소됨'이 아님)
// 결과 모름 뒤 허브에 묻는 간격(보낸 바로 뒤 — 누적 약 2·6·15초, 설계 §5.1·계획 정한 것 4). 정리 주기·recoverSending은 한 번만 묻는다(기본 [0])
export const UNKNOWN_WAITS = Object.freeze([2000, 4000, 9000]);
// 결과 모를 보호 주문 pend를 '안 나감'으로 보는 나이 — 허브가 'unknown'(모름)이고 모양도 없을 때만(계획 정한 것 8·21 — 수동 익절 pend도 이 값)
export const PEND_DROP_MS = 60000;
// 끝난 매매의 못 푼 pend를 놓는 나이 = 허브 주문 결과 기억 15분(그 뒤에는 허브가 답할 수 없음 — 남은 주문은 다음 1차 진입의 '모르는 미체결' 검사가 막는다)
export const PEND_STALE_MS = 900000;
const RETRY_KINDS = Object.freeze(['rate', 'busy']);
// orderStateOf 끝 값(filled / 취소·거절(체결분 있으면 partial)) — auto-sl-orders END와 같음
const END_STATES = Object.freeze(['filled', 'partial', 'failed']);
const FILLED = Object.freeze(['filled', 'partial', 'adopted']);
// 끝나지 않은 매매(= known-orders FOLLOW_LIVE·follow-engine CLEANUP_STATES) — recoverSending이 줄을 푼 뒤 상태·수량까지 맞추는 것은 이 상태뿐
// (그 밖 = 끝난 매매는 줄만 고침, 진행 기록 Task 3 Ruling ①)
const ACTIVE_STATES = Object.freeze(['opening', 'unclear', 'open', 'closing', 'detached']);
// 결과 모를 보호 주문(장부 다리 pend — known-orders protectPending의 pend 판단과 같은 꼴)
const pendOf = (x) => (x && typeof x === 'object' && x.pend && typeof x.pend === 'object' && typeof x.pend.coid === 'string' ? x.pend : null);
const dropPend = (x) => Object.fromEntries(Object.entries(x && typeof x === 'object' ? x : {}).filter(([k]) => k !== 'pend'));
// 넣을 때 응답의 주문 번호(실측 result.order.order_id, 옛 모양 result.order_id) — 없거나 꼴이 틀리면 ''(결과 모름 길로)
export function orderIdOf(o) {
  const r = o && o.ok && o.result && typeof o.result === 'object' ? o.result : null;
  const id = r ? String((r.order && r.order.order_id) ?? r.order_id ?? '') : '';
  return ORDER_ID_RE.test(id) ? id : '';
}
// 거래소 마진 방식 글자가 격리인가 — 판단은 여기 한 곳(ensureMarginLev·수동 추가 진입 전 검사 manual-exec·서버 실행기가 같이 씀).
// 대표 실측(2026-10-19 — docs/research/2026-10-19-ox-order-label-probe.md §1): get_perpetual_user_config·get_positions가 격리를 "isolate"(소문자)로
// 돌려준다 — 문서는 'isolated'(예시 'Cross'). 둘 다(대소문자 무시) 격리, 'cross'·빈 값·모르는 값은 격리가 아니다(1차는 격리로 바꾸고 추가 진입은 cfg_changed)
const ISOLATED_WORDS = Object.freeze(['isolate', 'isolated']);
export function isIsolatedMargin(v) {
  return typeof v === 'string' && ISOLATED_WORDS.includes(v.toLowerCase());
}
const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
const note = (trade, reason, arg = null, now = Date.now()) => ({ ...trade, notes: [...(trade.notes || []), { at: now, reason, arg }] });

// placed(coid) = 허브 주문 결과 기억 묻기(ox-client.placed — { status: placed·rejected·pending·unknown·error }, 없으면 늘 unknown),
// known() = 지금 아는 주문 번호(known-orders knownOrders — 장부·수동 기록·자동 손절 목록), skew() = 허브 − 이 기기 시계 차(ms, 모르면 null — 모양 맞춤 시각 폭)
export function createExec({ call, placed = async () => ({ status: 'unknown' }), known = async () => EMPTY_KNOWN, skew = () => null, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onOrder = () => {}, cond = false } = {}) {
  const cache = new Map();
  let gen = 0; // forget()마다 +1
  // 조회 두 가지는 5초 캐시 — 주문을 낸 뒤에는 forget()으로 지운다(그 뒤 조회는 새 값). 지우기 전에 보낸 조회의 답이 지운 뒤에 오면 담지 않는다
  // (정리 전 포지션이 정리 뒤 5초 동안 되살아나 '기록에 없는 포지션'으로 보이지 않게 — check_app manual 8)
  async function cached(method, params) {
    const key = `${method}|${JSON.stringify(params)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < EXEC.cacheMs) return hit.o;
    const g = gen;
    const o = await call(method, params);
    if (o.ok && g === gen) cache.set(key, { at: now(), o });
    return o;
  }
  const forget = () => {
    gen += 1;
    cache.clear();
  };
  // 위험을 줄이는·확인하는 호출: 요청 제한이면 1초 뒤 최대 3번 다시
  async function retrying(method, params, opts) {
    let o = await call(method, params, opts);
    for (let i = 0; i < EXEC.retries && !o.ok && RETRY_KINDS.includes(o.kind); i += 1) {
      await sleep(EXEC.retryMs);
      o = await call(method, params, opts);
    }
    return o;
  }

  // fresh: 종료 경로 — 캐시 없이, 요청 제한이면 1초 뒤 최대 3번 다시(§6.8)
  async function positionOf(inst, { fresh = false } = {}) {
    const params = { currency: 'PERPETUAL', kind: 'perpetual' };
    const o = fresh ? await retrying('/private/get_positions', params) : await cached('/private/get_positions', params);
    if (!o.ok) return { ok: false, outcome: o };
    const row = (Array.isArray(o.result) ? o.result : []).find((p) => p && p.instrument_name === inst && num(p.size));
    if (!row) return { ok: true, pos: null };
    let size = num(row.size);
    if (row.direction === 'sell' && size > 0) size = -size;
    // liq(거래소 liquid_price — 0은 없음, 교차 마진 예시가 "0")·mark(표시가) — 자동 손절 청산가 출처·이미 지났나(p34 §2.4)
    // upl(floating_profit_loss — 미실현 손익 USDT, 칸이 없으면 null, 0은 0) — 트레이딩 탭 수동 주문 카드(p40)
    return { ok: true, pos: { size, avg: num(row.average_price), tp: num(row.take_profit_price) || null, sl: num(row.stop_loss_price) || null, liq: num(row.liquid_price) || null, mark: num(row.mark_price) || null, upl: num(row.floating_profit_loss) } };
  }
  // 열린 포지션 전부 — 트레이딩 탭 '내 포지션' 칩(p40 T13). positionOf와 같은 조회·같은 5초 캐시(칩과 카드가 한 번 받은 값을 같이 씀).
  // { inst, size(매도는 음수) }만 — 가격 칸은 넘기지 않는다
  async function positions() {
    const o = await cached('/private/get_positions', { currency: 'PERPETUAL', kind: 'perpetual' });
    if (!o.ok) return { ok: false, outcome: o };
    const list = [];
    for (const p of Array.isArray(o.result) ? o.result : []) {
      let size = p ? num(p.size) : null;
      if (!size || typeof p.instrument_name !== 'string') continue;
      if (p.direction === 'sell' && size > 0) size = -size;
      list.push({ inst: p.instrument_name, size });
    }
    return { ok: true, list };
  }
  // 그 종목 미체결 — 인자 없는 조회 하나(조건 주문은 여기에만 보이고 type 붙은 조회에는 0건 — 실측 §2, 계획 정한 것 9·18)
  async function openOrders(inst) {
    const o = await retrying('/private/get_open_orders_by_instrument', { instrument_name: inst });
    return o.ok ? { ok: true, list: Array.isArray(o.result) ? o.result : [] } : { ok: false, outcome: o };
  }
  async function assets() {
    const o = await cached('/private/get_assets_info', { asset_type: ['PERPETUAL'] });
    return o.ok ? { ok: true, view: assetsView(o.result) } : { ok: false, outcome: o };
  }

  // ── 결과 모름(설계 2026-10-19 §5): 허브 기억(POST /v1/member/ox/placed — waits마다 한 번) → 모양 맞춤(인자 없는 미체결 + 기록 20건, 아는 번호 빼고
  // 딱 하나) → 모름. 다시 보내지 않는다 ──
  async function askPlaced(coid) {
    try {
      const r = await placed(coid);
      return r && typeof r.status === 'string' ? r : { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  }
  // want = { inst, coid, sentAt, side, reduce, qty, step, cond, fits?, anyTime? }(known-orders shapeFits와 같은 칸) →
  // { state: 'placed', orderId, via: 'hub'|'shape' } | { state: 'rejected', code } | { state: 'pending'|'unknown', none, many, hub } | { state: 'net' }(조회 실패)
  async function resolvePlaced(want, { waits = [0] } = {}) {
    let r = { status: 'error' };
    for (const ms of waits) {
      if (ms > 0) await sleep(ms);
      r = await askPlaced(want.coid);
      if (r.status === 'placed' && ORDER_ID_RE.test(String(r.orderId))) return { state: 'placed', orderId: String(r.orderId), via: 'hub' };
      if (r.status === 'rejected') return { state: 'rejected', code: Number.isInteger(r.code) ? r.code : null };
      if (r.status === 'unknown') break; // 허브가 모름(다시 켜짐·15분 지남·답 없이 끝남) — 다시 물어도 같다
    }
    let kn;
    try {
      kn = await known();
    } catch {
      return { state: 'net' };
    }
    const open = await openOrders(want.inst);
    if (!open.ok) return { state: 'net' };
    const hist = await retrying('/private/get_order_history_by_instrument', { instrument_name: want.inst, count: EXEC.historyCount });
    if (!hist.ok) return { state: 'net' };
    const m = shapeMatch([...open.list, ...(Array.isArray(hist.result) ? hist.result : [])], { ...want, windowMs: shapeWindowMs(skew()) }, kn);
    if (m.order) return { state: 'placed', orderId: String(m.order.order_id), via: 'shape' };
    // hub = 마지막 허브 답 — 'unknown'(허브가 모름)일 때만 보호 주문 pend를 '안 나감'으로 볼 수 있다('error' = 물어보지 못함, 계획 정한 것 8·21)
    return { state: r.status === 'pending' ? 'pending' : 'unknown', none: !!m.none, many: m.many || 0, hub: r.status };
  }
  // 거래소가 그 번호에 오류로 답함(그런 주문 없음일 수도, 요청 과다 10028 같은 일시 오류일 수도) — 인증 실패는 아님
  const oxErr = (s) => !!s && !s.ok && !!s.outcome && s.outcome.kind === 'ox' && !OX_AUTH_FAIL.includes(Number(s.outcome.code));
  // 번호로 취소 → 끝 확인(설계 §3 — 거짓 성공 없음, 계획 정한 것 6). 끝 = 끝 상태, 또는 오류 답 + 그 종목 인자 없는 미체결에도 그 번호 없음
  // (미체결은 오류 답이 처음 나올 때 한 번 — 못 보면 끝으로 보지 않는다). → { done: 끝난 번호, left: 끝을 확인하지 못한 번호 }
  async function cancelIds(inst, ids) {
    const done = [];
    const left = [];
    let vis; // undefined = 아직 안 봄 · null = 못 봄 · Set = 보인 번호
    const absent = async (id) => {
      if (vis === undefined) {
        const oo = await openOrders(inst);
        vis = oo.ok ? new Set(oo.list.map((x) => String(x.order_id))) : null;
      }
      return vis !== null && !vis.has(id);
    };
    const ended = async (s, id) => (s.ok ? END_STATES.includes(s.state) : oxErr(s) && (await absent(id)));
    for (const id of [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((x) => ORDER_ID_RE.test(x))) {
      let s = await orderState(id);
      if (await ended(s, id)) {
        done.push(id);
        continue;
      }
      if (!s.ok && !oxErr(s)) { // 물어보지 못함(down·rate·인증 실패) — 다음 주기에
        left.push(id);
        continue;
      }
      onOrder(); // open·모르는 상태·오류 답인데 미체결에 보임(또는 못 봄) — 취소는 보낸다(우리 번호)
      const c1 = await retrying('/private/cancel', { order_id: id });
      forget();
      s = await orderState(id);
      if (c1.ok && s.ok && !END_STATES.includes(s.state)) {
        // 취소가 200(정상 답)인데 주문 상태가 아직 끝이 아님(대표 실측 2026-10-21 — 두 번째 취소에 사라짐): 잠깐 뒤(주입 sleep) 한 번 더.
        // 번호당 최대 2번 — 그래도 남으면 left(다음 주기가 다시). 취소 자체가 실패한 것(down·rate·오류 답)은 여기서 다시 보내지 않는다(다음 주기)
        await sleep(EXEC.recancelMs);
        onOrder();
        await retrying('/private/cancel', { order_id: id });
        forget();
        s = await orderState(id);
      }
      ((await ended(s, id)) ? done : left).push(id);
    }
    return { done, left };
  }
  // 결과 모를 보호 주문(장부 다리 pend — 계획 정한 것 21·22) 풀기: 허브 기억 → 모양 맞춤(보낸 수량 글자·종류·감소 전용·방향·보낸 시각 + 보낸 발동가 글자 trig
  // ±EXEC.tpslTol — 지금 목표가 아니라 보낸 때의 값이라 목표가 그 뒤 바뀌어도 맞음, 같은 수량·반대 방향의 회원 조건 주문을 채택해 취소하지 않게 — 최종 검토 중요 2,
  // 설계 §6.10. 옛 pend(trig 없음)는 발동가를 보지 않음). placed면 그 번호를 다리 orderIds 맨 앞에(다음 확인이 목표와 비교해 남기거나 교체), 안 나감이 확실하면(허브 rejected,
  // 또는 허브 unknown + 모양 없음 + 보낸 지 PEND_DROP_MS) pend만 지움, 그 밖(모양 둘 이상·허브가 기다리는 중·60초 전·허브 error·조회 실패)은 그대로 —
  // done false(이 다리는 새로 보내지 않음). stale(끝난 매매 — cancelProtect): 허브 기억 15분(PEND_STALE_MS)이 지나도 못 풀면 놓는다
  // (그 주문이 거래소에 남았으면 다음 1차 진입의 '모르는 미체결' 검사가 막는다 — 안전한 쪽)
  async function settlePend(t, leg, { stale = false } = {}) {
    const p = pendOf(t[leg]);
    if (!p) return { trade: t, done: true };
    const q = typeof p.qty === 'string' && Number(p.qty) > 0 ? p.qty : null; // 수량 없는 pend는 수량을 보지 않음(shapeFits qty null)
    const trig = num(p.trig) > 0 ? num(p.trig) : null; // 보낸 발동가 글자 — 없는 옛 pend는 발동가를 보지 않음
    const r = await resolvePlaced({ inst: t.inst, coid: p.coid, sentAt: Number(p.at), side: t.side === 'long' ? 'sell' : 'buy', reduce: true, qty: q ? Number(q) : null, step: q ? 10 ** -decimalsOf(q) : 0, cond: p.cond === 'STOP' ? 'STOP' : 'IF_TOUCHED', fits: trig ? (o) => near(num(o.trigger_price), trig) : null });
    if (r.state === 'placed') return { trade: { ...t, [leg]: { ...dropPend(t[leg]), orderIds: [r.orderId, ...protectIds(t[leg]).filter((id) => id !== r.orderId)] } }, done: true };
    const age = now() - Number(p.at);
    if (r.state === 'rejected' || (r.state === 'unknown' && r.hub === 'unknown' && r.none && age > PEND_DROP_MS) || (stale && age > PEND_STALE_MS)) return { trade: { ...t, [leg]: dropPend(t[leg]) }, done: true };
    return { trade: t, done: false };
  }
  // 그 매매의 익절·손절 조건 주문 취소·끝 확인 — pend부터 풀고(끝난 매매라 stale), 장부 tp·sl.orderIds 번호로. 끝난 번호·푼 pend는 장부에서 빼고
  // 남은 번호·못 푼 pend는 그대로(protectPending — 정리 주기가 다시). → { trade, left: 남은 번호 수 + 못 푼 pend 수 }
  async function cancelProtect(trade) {
    let t = trade;
    for (const leg of ['tp', 'sl']) t = (await settlePend(t, leg, { stale: true })).trade;
    const pendLeft = ['tp', 'sl'].filter((leg) => pendOf(t[leg])).length;
    const ids = [...protectIds(t.tp), ...protectIds(t.sl)];
    if (!ids.length) return { trade: t, left: pendLeft };
    const c = await cancelIds(t.inst, ids);
    const keep = (x) => (x && typeof x === 'object' ? { ...x, orderIds: protectIds(x).filter((id) => !c.done.includes(id)) } : x);
    return { trade: { ...t, tp: keep(t.tp), sl: keep(t.sl) }, left: c.left.length + pendLeft };
  }

  // §6.8: get_order_state 600ms 간격 최대 5번 — filled / 취소·거절(체결분 있으면 partial) / 3초 넘게 open이면 cancel 뒤 체결분만 / 모르는 값은 1초 뒤 최대 3번
  async function confirmFill(orderId) {
    const t0 = now();
    let unknown = 0;
    let last = null;
    for (let i = 0; i < EXEC.fillPolls + EXEC.unknownPolls; i += 1) {
      const o = await retrying('/private/get_order_state', { order_id: String(orderId) });
      last = o.ok ? o.result : null;
      const s = o.ok ? orderStateOf(o.result) : 'unknown';
      if (s === 'filled' || s === 'partial') return { state: s, qty: num(last.filled_amount), price: num(last.average_price) };
      if (s === 'failed') return { state: 'failed', qty: 0, price: null };
      if (s === 'open' && now() - t0 >= EXEC.openCancelMs) {
        const c1 = await retrying('/private/cancel', { order_id: String(orderId) });
        let again = await retrying('/private/get_order_state', { order_id: String(orderId) });
        if (c1.ok && again.ok && orderStateOf(again.result) === 'open') {
          // 취소 200인데 남음(대표 실측 2026-10-21) — 한 번 더, 그래도 open이면 failed가 아니라 unclear(살아 있는 주문을 끝으로 보지 않음)
          await sleep(EXEC.recancelMs);
          await retrying('/private/cancel', { order_id: String(orderId) });
          again = await retrying('/private/get_order_state', { order_id: String(orderId) });
          if (again.ok && orderStateOf(again.result) === 'open') return { state: 'unclear', qty: num(again.result.filled_amount), price: num(again.result.average_price) };
        }
        // 첫 취소가 실패했어도 주문이 아직 open이면 끝이 아니다 — unclear(검토 A S2)
        if (again.ok && orderStateOf(again.result) === 'open') return { state: 'unclear', qty: num(again.result.filled_amount), price: num(again.result.average_price) };
        // 취소 뒤 상태를 못 읽으면 끝을 모른다 — failed가 아니라 unclear(검토 18 사소 2)
        if (!again.ok) return { state: 'unclear', qty: num(last && last.filled_amount), price: num(last && last.average_price) };
        const filled = again.ok ? num(again.result.filled_amount) : null;
        return filled > 0 ? { state: 'partial', qty: filled, price: num(again.result.average_price) } : { state: 'failed', qty: 0, price: null };
      }
      if (s === 'unknown') {
        unknown += 1;
        if (unknown > EXEC.unknownPolls) break;
        await sleep(EXEC.unknownPollMs);
      } else await sleep(EXEC.fillPollMs);
    }
    return { state: 'unclear', qty: num(last && last.filled_amount), price: num(last && last.average_price) };
  }

  // 마진 모드 격리 → 배율 L(§6.6 entry). 이미 격리(isIsolatedMargin — 실측 "isolate")면 바꾸기를 보내지 않는다. WS 직접이면 follow/check가 coid를 본다({ coid })
  async function ensureMarginLev(inst, lev, coid) {
    const c = await call('/private/get_perpetual_user_config', { instrument_name: inst });
    if (!c.ok) return { fail: c };
    if (!isIsolatedMargin(c.result && c.result.margin_type)) {
      const m = await call('/private/adjust_perpetual_margin_type', { instrument_name: inst, margin_type: 'isolate' }, { coid });
      if (!m.ok) return { fail: m };
    }
    if (Number(c.result && c.result.leverage) !== lev) {
      const l = await call('/private/adjust_perpetual_leverage', { instrument_name: inst, leverage: lev, posId: 0 }, { coid });
      if (!l.ok) return { fail: l, lev: true };
    }
    return { ok: true };
  }

  // 주문 결과(Outcome)가 실패일 때 기록 사유 — 막힘(서버 판정)·서버 요청 제한(rate_hub — 시간당 30건 rate_guard와 다름)·헤지 모드(공용 판단 —
  // 코드 5147 또는 글에 hedge·position side, app/lib/ox-errors.js)·그 밖 코드
  function failReason(o) {
    if (o.kind === 'blocked') return { reason: 'halted', arg: o.reason };
    if (RETRY_KINDS.includes(o.kind)) return { reason: 'rate_hub' };
    if (isHedgeModeError(o)) return { reason: 'hedge_mode' };
    return { reason: 'error', arg: o.kind === 'ox' ? o.code : o.kind };
  }
  // 격리·배율 맞추기(ensureMarginLev) 실패 사유 — 헤지 계정(어느 단계든)이면 hedge_mode(원웨이 안내 창), 배율 단계의 그 밖 거래소 거절은 lev_denied +
  // 거래소 코드(K-11에 붙임), 요청 제한·결과 모름·숨김(hidden) 등은 failReason 그대로
  function marginLevReason(ml) {
    if (isHedgeModeError(ml.fail)) return { reason: 'hedge_mode' };
    if (ml.lev && ml.fail.kind === 'ox') return { reason: 'lev_denied', arg: oxCodeOf(ml.fail) };
    return failReason(ml.fail);
  }

  // 시장가 주문 하나: 보내고 → 응답 번호(없으면 결과 모름 — 허브 기억 2·6·15초 → 모양 맞춤) → 체결 확인.
  // { fill: { state, qty, price, orderId } } | { fail: { reason, arg } } | { unclear: true }(모름 — 다시 보내지 않음)
  async function sendOrder(method, params, inst, coid) {
    onOrder();
    const sentAt = now();
    const o = await call(method, params, { coid });
    forget();
    if (!o.ok && o.kind !== 'unknown' && o.kind !== 'duplicate') return { fail: failReason(o) };
    let orderId = orderIdOf(o);
    if (!orderId) {
      const r = await resolvePlaced({ inst, coid, sentAt, side: method === '/private/buy' ? 'buy' : 'sell', reduce: params.reduce_only === true, qty: Number(params.amount), step: 10 ** -decimalsOf(params.amount), cond: null }, { waits: UNKNOWN_WAITS });
      // 늦게 온 거절도 같은 사유 판단(failReason — 헤지 5147이면 hedge_mode, CLAUDE.md 헤지 줄 '판단은 ox-errors.js 하나')
      if (r.state === 'rejected') return { fail: r.code != null ? failReason({ kind: 'ox', code: r.code, message: '' }) : { reason: 'error', arg: 'rejected' } };
      if (r.state !== 'placed') return { unclear: true };
      orderId = r.orderId;
    }
    return { fill: { ...(await confirmFill(orderId)), orderId } };
  }
  const orderParams = (side, { inst, amount, coid, tp, sl, tick, reduce = false }) => {
    const p = { instrument_name: inst, amount, type: 'market', position_side: 'BOTH', custom_order_id: coid };
    if (reduce) p.reduce_only = true;
    if (tp != null) Object.assign(p, { take_profit_price: numStr(tp, tick), take_profit_type: 2 });
    if (sl != null) Object.assign(p, { stop_loss_price: numStr(sl, tick), stop_loss_type: 1 });
    return { method: side === 'long' ? '/private/buy' : '/private/sell', params: p };
  };
  async function syncPos(trade) {
    const p = await positionOf(trade.inst);
    if (!p.ok) return trade;
    if (!p.pos) return trade;
    return { ...trade, size: Math.abs(p.pos.size), avg: p.pos.avg ?? trade.avg };
  }

  // ── 진입(§6.6 entry·§6.7): 내 포지션이 있으면 건너뜀 → 모르는 미체결이면 건너뜀·아는 번호(남은 우리 주문)는 번호로 취소·끝 확인 → sending 저장 → 격리·배율 →
  // 시장가 + 익절·손절 부착 → 체결 확인(결과 모름이면 unclear — 다시 보내지 않음). 보내기 전 같은 이름표 확인은 없다(계획 정한 것 3 — 조회에 이름표가 없음,
  // 받침은 허브 중복 막기(같은 UID·같은 이름표 24시간)와 임대(한 기기만 위험 증가))
  // plan = { trade(새 장부 줄, fills 비어 있음), amount, qty, margin, tp, sl, tick, preflight? }
  // preflight() = 시장가를 보내기 바로 전 엔진이 다시 보는 조건(시각 조건·G1~G8, §6.3 "주문 하나마다") — 거짓이면 보내지 않고 late
  // beforeEntry() = 새 진입 전 그 종목 자동 손절 주문 목록 끝 확인(p34 §2.7) — 포지션 없음·모르는 미체결 없음을 본 뒤에만 부른다.
  //   거짓이면 진입하지 않고 auto_sl_check(남은 STOP이 새 포지션을 닫지 않게), 'has_position'·'error'면 그 사유
  async function openTrade(plan, save) {
    let trade = plan.trade;
    const coid = coidFor(trade.id, 'e1');
    // 캐시 없이(최종 검토 중요 3 — 수동 openFirst와 같음): 5초 캐시의 '포지션 없음' 뒤 트레이딩 탭이 연 포지션의 살아 있는 익절(아는 번호)을 아래에서 취소하지 않게
    const pos = await positionOf(trade.inst, { fresh: true });
    if (!pos.ok) return { trade: { ...trade, state: 'skipped', reason: 'error', closedAt: now() } };
    if (pos.pos) return { trade: { ...trade, state: 'skipped', reason: 'has_position', closedAt: now() } };
    const oo = await openOrders(trade.inst);
    if (!oo.ok) return { trade: { ...trade, state: 'skipped', reason: 'error', closedAt: now() } };
    let kn;
    try {
      kn = await known();
    } catch {
      return { trade: { ...trade, state: 'skipped', reason: 'error', closedAt: now() } };
    }
    const sp = splitOpen(oo.list, kn);
    // 이 기기가 모르는 미체결(다른 기기·오렌지엑스 앱·다른 판 — 우리 주문이어도 번호를 모름) = 회원 주문으로 보고 건너뜀(설계 §3·Q2). 아무것도 취소하지 않는다
    if (sp.foreign.length) return { trade: { ...trade, state: 'skipped', reason: 'has_orders', closedAt: now() } };
    // 포지션이 없는데 남은 우리 주문(아는 번호 — 주인 무관, 계획 정한 것 12) → 번호로 취소·끝 확인, 하나라도 남으면 건너뜀.
    // 남은 자동 손절 STOP(역할 autosl)은 정한 것 12 끝 줄대로 바로 뒤 beforeEntry(자동 손절 keeper checkEntry — 목록·정리 미완 장부 번호로 취소·끝 확인,
    // 못 하면 auto_sl_check + '확인했습니다' 길, p35 §5.3)가 먼저 맡고, 그 뒤에도 미체결에 남았는지 번호로 한 번 더 본다(목록·정리 미완에 없는 옛 번호)
    const hasBefore = typeof plan.beforeEntry === 'function';
    const slRole = (x) => hasBefore && (kn.of(x.order_id) || {}).role === 'autosl';
    const own = sp.mine.filter((x) => !slRole(x)).map((x) => String(x.order_id));
    const slLeft = sp.mine.filter(slRole).map((x) => String(x.order_id));
    if (own.length && (await cancelIds(trade.inst, own)).left.length) return { trade: { ...trade, state: 'skipped', reason: 'has_orders', closedAt: now() } };
    // 진입할 때만(포지션·모르는 미체결이 없음을 본 뒤) 이전 자동 손절 확인 — 앞에 두면 진입하지 않을 신호가 살아 있는 포지션의 STOP을 지운다(검토 고침 2·4).
    // true면 진입, 문자열('has_position'·'error')이면 그 사유, 그 밖이면 auto_sl_check
    if (hasBefore) {
      const be = await plan.beforeEntry();
      if (be !== true) return { trade: { ...trade, state: 'skipped', reason: be === 'has_position' || be === 'error' ? be : 'auto_sl_check', closedAt: now() } };
    }
    if (slLeft.length && (await cancelIds(trade.inst, slLeft)).left.length) return { trade: { ...trade, state: 'skipped', reason: 'auto_sl_check', closedAt: now() } };
    trade = { ...trade, state: 'opening', fills: [{ fill: 1, customId: coid, orderId: null, state: 'sending', qty: plan.qty, price: null, margin: plan.margin, at: now() }] };
    await save(trade);
    const ml = await ensureMarginLev(trade.inst, trade.lev, coid);
    if (!ml.ok) {
      // 헤지 계정이면 hedge_mode, 거래소가 배율 변경을 거절했으면 lev_denied(+ 코드) — 요청 제한·결과 모름·숨김(hidden) 등은 그 사유 그대로
      const r = marginLevReason(ml);
      return { trade: { ...trade, state: 'skipped', reason: r.reason, reasonArg: r.arg ?? null, closedAt: now(), fills: [{ ...trade.fills[0], state: 'failed' }] } };
    }
    if (typeof plan.preflight === 'function' && !plan.preflight()) {
      return { trade: { ...trade, state: 'skipped', reason: 'late', closedAt: now(), fills: [{ ...trade.fills[0], state: 'failed' }] } };
    }
    const { method, params } = orderParams(trade.side, { inst: trade.inst, amount: plan.amount, coid, tp: plan.tp, sl: plan.sl, tick: plan.tick });
    const r = await sendOrder(method, params, trade.inst, coid);
    if (r.fail) return { trade: { ...trade, state: 'skipped', reason: r.fail.reason, reasonArg: r.fail.arg ?? null, closedAt: now(), fills: [{ ...trade.fills[0], state: 'failed' }] } };
    // 결과 모름(허브·모양으로도 못 찾음) — 다시 보내지 않고 장부 unclear·체결 줄 sending(번호 없음) 그대로. skipped·failed로 떨어뜨리지 않는다
    // (포지션이 없으면 90초 뒤 정리 주기가 not_filled로 — 계획 정한 것 7, 설계 §5.3)
    if (r.unclear) return { trade: note({ ...trade, state: 'unclear' }, 'unclear_fill', null, now()) };
    const f = r.fill;
    // 체결 확인이 모름(번호는 앎) — 줄은 sending(보낸 수량 그대로 — 보내다 모른 수량, ownsPosition·settleBySize가 쓴다), 다음 recoverSending이 그 번호로 푼다
    const fill = f.state === 'unclear' ? { ...trade.fills[0], orderId: f.orderId } : { ...trade.fills[0], orderId: f.orderId, state: f.state, qty: f.qty, price: f.price };
    if (f.state === 'failed') return { trade: { ...trade, state: 'skipped', reason: 'not_filled', closedAt: now(), fills: [fill] } };
    if (f.state === 'unclear') return { trade: note({ ...trade, state: 'unclear', fills: [fill] }, 'unclear_fill', null, now()) };
    trade = { ...trade, state: 'open', fills: [fill], avg: f.price, size: f.qty, tp: { price: plan.tp, via: 'attach', orderIds: [] }, sl: { price: plan.sl, via: 'attach', orderIds: [] } };
    return { trade: await syncPos(trade) };
  }

  // ── 추가 진입(§6.6 dca): 자기 장부에 그 차수 줄(체결·보내는 중)이 있으면 다시 보내지 않음 → 거래소 포지션 ±5%(보내다 모른 수량까지 — 아니면 detached·
  // gone이면 closed) → sending 저장 → preflight → 배율 그대로 시장가(새 예상 평단 익절·손절) → 체결 확인. 결과 모름이면 매매는 open 그대로 —
  // 그 줄만 sending·메모 unclear_fill(계획 정한 것 20 — 다음 차수·4차 자동 손절은 이어 가고, 90초 뒤 정리 주기가 포지션 크기로 푼다)
  async function addFill(trade, plan, save) {
    const coid = coidFor(trade.id, `d${plan.fill}`);
    // 같은 차수를 보내다 결과를 모르면(sending) 그 차수를 다시 보내지 않는다 — 보내기 전 이름표 확인이 없어졌으므로(정한 것 3·20)
    if (trade.fills.some((f) => f.customId === coid && ['filled', 'partial', 'adopted', 'sending'].includes(f.state))) return { trade };
    const pos = await positionOf(trade.inst);
    if (!pos.ok) return { trade: note(trade, 'error', pos.outcome.kind, now()) };
    let v = positionVerdict(trade, pos.pos);
    // 앞 차수를 보내다 모른 수량까지 이 매매 것(ownsPosition) — 다음 차수가 이어진다(closeTrade와 같은 줄)
    if (v === 'detached' && pos.pos && trade.fills.some((f) => f && f.state === 'sending') && ownsPosition(trade, pos.pos)) v = 'ok';
    if (v === 'gone') return { trade: { ...trade, state: 'closed', closedAt: now(), reason: 'gone' } };
    if (v === 'detached') return { trade: note({ ...trade, state: 'detached' }, 'detached', null, now()) };
    const sending ={ fill: plan.fill, customId: coid, orderId: null, state: 'sending', qty: plan.qty, price: null, margin: plan.margin, at: now() };
    let t = { ...trade, fills: [...trade.fills, sending] };
    await save(t);
    const idx = t.fills.length - 1;
    if (typeof plan.preflight === 'function' && !plan.preflight()) {
      t.fills[idx] = { ...sending, state: 'failed' };
      return { trade: note(t, 'late', null, now()) };
    }
    const { method, params } = orderParams(trade.side, { inst: trade.inst, amount: plan.amount, coid, tp: plan.tp, sl: plan.sl, tick: plan.tick });
    const r = await sendOrder(method, params, trade.inst, coid);
    if (r.fail) {
      t.fills[idx] = { ...sending, state: 'failed' };
      return { trade: note(t, r.fail.reason, r.fail.arg ?? null, now()) };
    }
    // 결과 모름 — 그 줄 sending(번호 null) 그대로, 매매 상태 그대로(open). syncPos 하지 않음(장부 수량 = 마지막으로 맞춘 포지션 — 90초 뒤 크기 판정의 받침)
    if (r.unclear) return { trade: note(t, 'unclear_fill', null, now()) };
    // 체결 확인이 모름(번호는 앎)도 같은 규칙 — 줄은 sending(보낸 수량 그대로)·번호만 적음, 다음 정리 주기 recoverSending이 그 번호의 주문 상태로 푼다
    t.fills[idx] = r.fill.state === 'unclear' ? { ...sending, orderId: r.fill.orderId } : { ...sending, orderId: r.fill.orderId, state: r.fill.state, qty: r.fill.qty, price: r.fill.price };
    if (r.fill.state === 'failed') return { trade: note(t, 'not_filled', null, now()) };
    if (r.fill.state === 'unclear') return { trade: note(t, 'unclear_fill', null, now()) };
    t = { ...t, tp: { ...(t.tp || {}), price: plan.tp ?? null }, sl: { ...(t.sl || {}), price: plan.sl ?? null } };
    return { trade: await syncPos(t) };
  }

  // ── 종료(§6.6 tp·sl·close·liq): 거래소에 포지션이 남아 있으면 close_position(시장가·전량·pos_id 0) → 그 매매의 익절·손절 조건 주문을 장부 번호로
  // 취소·끝 확인(cancelProtect — 거래소는 포지션이 0이 돼도 남은 reduce_only 조건 주문을 지우지 않음, 실측 §3-1) → closed ──
  // 회원이 바꾼 포지션(±5% 밖·방향 다름)은 닫지 않고 detached(§6.10) — 보내다 결과를 모른 줄의 수량까지 이 매매 것이면(ownsPosition) 닫는다. 결과 %는 정리 주문의 평균가로(기록용)
  // 끝을 확인하지 못한 보호 주문 번호·못 푼 pend는 장부에 남기고 메모 protect_left(protectPending — 정리 주기가 다시 취소·확인)
  // 포지션을 확인하지 못하면(네트워크·요청 제한·서버) 'open'으로 돌려 둔다 — 끝 이벤트가 남아 있으니 정리 주기(endVerdict)가 다시 정리한다.
  // 'closing'이나 'closed'로 적으면 아무도 다시 보지 않아 거래소 포지션이 남는다(검토 2026-10-08)
  async function closeTrade(trade, { step = 0.001, reason = null } = {}) {
    const pos = await positionOf(trade.inst, { fresh: true });
    if (!pos.ok) return { trade: note({ ...trade, state: 'open' }, 'error', pos.outcome.kind, now()), done: false };
    let v = positionVerdict(trade, pos.pos);
    // 결과 모름 줄(sending) — 보내다 모른 수량까지 이 매매 것(장부 수량이 옛 값·0일 수 있음)
    if (v === 'detached' && pos.pos && Array.isArray(trade.fills) && trade.fills.some((f) => f && f.state === 'sending') && ownsPosition(trade, pos.pos)) v = 'ok';
    let t = trade;
    if (v === 'detached') return { trade: note({ ...trade, state: 'detached' }, 'detached', null, now()), done: false };
    if (v === 'ok') {
      onOrder();
      const o = await retrying('/private/close_position', { instrument_name: trade.inst, type: 'market', amount: numStr(Math.abs(pos.pos.size), step), pos_id: 0 });
      forget();
      if (!o.ok && o.kind !== 'unknown') return { trade: note({ ...trade, state: 'open' }, failReason(o).reason, failReason(o).arg ?? null, now()), done: false };
      const after = await positionOf(trade.inst, { fresh: true });
      if (!after.ok) return { trade: note({ ...trade, state: 'open' }, o.ok ? 'error' : 'unclear_fill', o.ok ? after.outcome.kind : null, now()), done: false };
      if (after.pos) return { trade: note({ ...trade, state: 'open' }, 'not_filled', null, now()), done: false };
      const oid = o.ok && o.result ? String((o.result.order && o.result.order.order_id) ?? o.result.order_id ?? '') : '';
      let exit = null;
      if (oid) {
        const s = await retrying('/private/get_order_state', { order_id: oid });
        const px = s.ok ? num(s.result.average_price) : null;
        const qty = s.ok ? num(s.result.filled_amount) : null;
        if (px > 0 && qty > 0) exit = { price: px, qty, via: 'close', at: now() };
      }
      t = withExit(t, exit);
    } else {
      // 포지션 없음(gone) — 자동 손절이 먼저 체결됐을 수 있다(동업자 끝 신호와 거의 같은 때, §2.8): 그 주문 상태부터, 아니면 최근 기록에서 정리 체결
      const g = await goneExit(trade);
      t = withExit(t, g.exit);
      if (g.reason) t = { ...t, reason: g.reason };
    }
    const cp = await cancelProtect(t);
    t = cp.left ? note(cp.trade, 'protect_left', null, now()) : cp.trade;
    t = { ...t, state: 'closed', closedAt: now() };
    if (reason) t = note(t, reason.reason, reason.arg ?? null, now());
    return { trade: t, done: true };
  }

  // ── p34 회원 본인 손익(§4.2): exit = { price, qty, via, at } → resultPct·pnlUsdt(거래 비용 제외). exit가 없으면 둘 다 null(지어내지 않음) ──
  function withExit(t, exit) {
    if (!exit) return { ...t, exit: null, pnlUsdt: null, resultPct: t.resultPct ?? null };
    const dir = dirOf(t.side);
    return { ...t, exit, pnlUsdt: pnlUsdt({ dir, avg: t.avg, price: exit.price, qty: exit.qty }), resultPct: tradeResultPct({ dir, avg: t.avg, exit: exit.price, lev: t.lev }) };
  }
  // 그 매매가 마지막으로 체결한 시각(체결 줄 at) — 그 뒤 기록만 본다
  const lastFillAt = (t) => (Array.isArray(t.fills) ? t.fills : []).filter((f) => ['filled', 'partial', 'adopted'].includes(f.state)).reduce((a, f) => Math.max(a, Number(f.at) || 0), Number(t.openedAt) || 0);
  // 거래소가 닫은 매매(진입에 붙인 익절 등)의 exit: 최근 기록 20건에서 마지막 체결 뒤 반대 방향 reduce_only 체결 — Σ수량이 장부 수량 ±5% 안일 때만
  async function exitFromHistory(t) {
    const o = await retrying('/private/get_order_history_by_instrument', { instrument_name: t.inst, count: EXEC.historyCount });
    if (!o.ok || !Array.isArray(o.result)) return null;
    const since = lastFillAt(t);
    const want = t.side === 'long' ? 'sell' : 'buy';
    let q = 0;
    let qp = 0;
    for (const x of o.result) {
      if (!x || x.reduce_only !== true || x.direction !== want) continue;
      const fq = num(x.filled_amount);
      const fp = num(x.average_price);
      // 거래소 시각은 10자리(초)로 와도 ms로(tsMs — 설계 §10, 계획 대표 확인 표 '시각 비교는 모두 tsMs') — 체결 시각(since)은 이 기기 ms
      const at = tsMs(x.last_update_timestamp) ?? tsMs(x.creation_timestamp) ?? 0;
      if (!(fq > 0) || !(fp > 0) || at < since) continue;
      q += fq;
      qp += fq * fp;
    }
    if (!(q > 0) || !(t.size > 0) || Math.abs(q - t.size) / t.size > CORE.posTol) return null;
    return { price: qp / q, qty: Number(q.toFixed(8)), via: 'exchange', at: now() };
  }
  // 포지션이 없어진 매매의 exit·사유(§2.8): 장부의 자동 손절 주문(autoSl.orderId)이 체결됐으면 그 값·사유 auto_sl(U-A6 — 발동 뒤 같은 번호로 체결가),
  // 아니면 기록에서 정리 체결(사유 그대로)
  async function goneExit(t) {
    const id = t.autoSl && t.autoSl.orderId ? String(t.autoSl.orderId) : null;
    if (id) {
      const s = await orderState(id);
      const fq = s.ok ? num(s.order.filled_amount) : null;
      const fp = s.ok ? num(s.order.average_price) : null;
      if (s.ok && (s.state === 'filled' || s.state === 'partial') && fq > 0 && fp > 0) return { exit: { price: fp, qty: fq, via: 'auto_sl', at: now() }, reason: 'auto_sl' };
    }
    return { exit: await exitFromHistory(t), reason: null };
  }

  // ── p34 자동 손절 주문(§2.5): 포지션 반대 방향 시장가 STOP, reduce_only, 표시가 발동(trigger_price_type 1), 수량 = 포지션 전체, ptf.<id>.g<k> ──
  // 결과: { ok: true, orderId, coid } / { ok: false, sent: false, kind, code } — 안 나간 것이 확실(거래소 오류 응답·숨김·키 없음·막힘·연결 없음·요청 제한)
  //       / { ok: false, sent: 'unknown', kind } — 결과 모름(504·끊김·같은 식별자) → 부르는 쪽(keeper)이 확인한다(다시 보내지 않음 — 작업 4에서 허브 기억·모양 맞춤으로)
  // 위험을 줄이는 호출 — 시간당 30건에는 세지만(onOrder) 막지 않는다(엔진은 gateReduce만 본다)
  async function placeAutoSl({ trade, k, amount, trigger, tick }) {
    const coid = coidFor(trade.id, `g${k}`);
    onOrder();
    const method = trade.side === 'long' ? '/private/sell' : '/private/buy';
    const o = await retrying(method, {
      instrument_name: trade.inst, amount, type: 'market', position_side: 'BOTH', reduce_only: true,
      condition_type: 'STOP', trigger_price: numStr(roundTo(trigger, tick), tick), trigger_price_type: 1, custom_order_id: coid,
    });
    forget();
    if (o.ok) {
      const id = o.result ? String((o.result.order && o.result.order.order_id) ?? o.result.order_id ?? '') : '';
      return id ? { ok: true, orderId: id, coid } : { ok: false, sent: 'unknown', kind: 'unknown', code: null };
    }
    if (o.kind === 'unknown' || o.kind === 'duplicate') return { ok: false, sent: 'unknown', kind: o.kind, code: null };
    return { ok: false, sent: false, kind: o.kind, code: o.kind === 'ox' ? o.code ?? null : null };
  }
  // 주문 하나의 상태 — { ok, state: orderStateOf(filled·partial·failed·open·unknown), order(원문 — 메모리에서만 본다) }
  async function orderState(orderId) {
    const o = await retrying('/private/get_order_state', { order_id: String(orderId) });
    if (!o.ok || !o.result || typeof o.result !== 'object') return { ok: false, outcome: o };
    return { ok: true, state: orderStateOf(o.result), order: o.result };
  }
  async function cancelOrder(orderId) {
    onOrder();
    const o = await retrying('/private/cancel', { order_id: String(orderId) });
    forget();
    return o;
  }
  // auto-sl-orders(cancelEntry·checkBeforeEntry·sweepEntries)가 쓰는 거래소 손잡이 — resolvePlaced(결과 모름 확인)도 같은 절차(설계 §3~§5: 세 길이 같이 씀).
  // 조회 결과의 이름표로 찾는 손잡이(옛 findByCoid)는 없다 — 오렌지엑스가 조회에는 이름표를 늘 비워 준다(설계 §1-2)
  // pause = 취소 200인데 남은 주문을 한 번 더 취소하기 전 쉼(주입 sleep — cancelIds와 같은 EXEC.recancelMs)
  const ops = { orderState, cancel: cancelOrder, resolvePlaced: (want, opts) => resolvePlaced(want, opts), pause: () => sleep(EXEC.recancelMs) };

  // ── 보호 확인(§6.9): 실제 평단으로 다시 계산한 목표(target = { tp, sl } — 엔진이 follow-math.tpslFor로)와 비교 → { trade, confirmed } ──
  // cond false: get_positions의 take_profit_price·stop_loss_price(0 = 없음)와 0.2% 안이면 끝, 아니면 tpsl_not_synced(다음 추가 진입 안 함).
  // cond true(설계 2026-10-19 §4 — 계획 정한 것 14·21): 다리(tp·sl)마다 장부 번호(t[leg].orderIds)로만 알아보고, 인자 없는 미체결의 trigger_price·amount와
  // 비교 — 다르면 새 것을 먼저 걸고 새 것이 보인 뒤에 옛 번호를 취소·끝 확인(10분 2번·하루 10번, 넘으면 tpsl_not_synced). 같은 다리에 우리 번호가 둘 이상
  // 열려 있으면 목표에 맞는 것 하나(번호 작은 것)만 남김(§4.4). 보내기 전에 장부 다리에 pend를 적어 save로 저장하고(결과 모름 대비), 다음 확인은 pend부터 푼다
  const near = (a, b) => (a == null || a === 0 ? b == null : b != null && Math.abs(a - b) / b <= EXEC.tpslTol);
  // 한 다리(tp | sl): want = 목표 발동가(null = 걸지 않음). 장부 번호(t[leg].orderIds — 첫 칸이 지금 것, 뒤는 취소 대기 옛 것)로만 알아본다.
  // 보내다 결과를 모른 것(t[leg].pend — 계획 정한 것 21)이 있으면 먼저 풀고, 못 풀면 이 다리는 아무것도 보내지 않는다(둘이 되지 않게). → { trade, ok, sent, why }
  async function syncLeg(t0, leg, want, { seen, tick, step, allow, save }) {
    const sp = await settlePend(t0, leg);
    let t = sp.trade;
    if (!sp.done) return { trade: t, ok: false, why: 'pend' };
    const setIds = (list) => { t = { ...t, [leg]: { ...(t[leg] || {}), orderIds: list } }; };
    const ids = protectIds(t[leg]);
    const live = [];
    const gone = [];
    let unk = 0; // 안 보이고 끝도 모르는 번호(조회 실패·'없음' — 새 주문이 늦게 보일 수 있음, 계획 정한 것 6) — 지우지도 새로 넣지도 않는다
    for (const id of ids) {
      if (seen.has(id)) {
        live.push(seen.get(id));
        continue;
      }
      const s = await orderState(id); // 인자 없는 미체결에 안 보이면 주문 상태로 한 번 더(설계 §4.2)
      if (s.ok && s.state === 'open') live.push(s.order);
      else if (s.ok && END_STATES.includes(s.state)) gone.push(id);
      else unk += 1;
    }
    if (gone.length) setIds(ids.filter((id) => !gone.includes(id)));
    const fits = (o) => want != null && near(num(o.trigger_price), want) && Math.abs(num(o.amount) - t.size) < step / 2;
    const good = live.filter(fits).sort((a, b) => (BigInt(String(a.order_id)) < BigInt(String(b.order_id)) ? -1 : 1))[0] || null;
    const extra = live.filter((o) => o !== good);
    if (unk === 0 && (want == null ? live.length === 0 : !!good && extra.length === 0)) return { trade: t, ok: true };
    if (good || want == null) { // 맞는 것이 있음(나머지는 옛 것·중복) 또는 걸지 않을 다리 — 보이는 남은 것만 번호로 취소·끝 확인(§4.3 끝·§4.4)
      const c = await cancelIds(t.inst, extra.map((o) => String(o.order_id)));
      setIds(protectIds(t[leg]).filter((id) => !c.done.includes(id)));
      return { trade: t, ok: c.left.length === 0 && unk === 0, why: unk ? 'net' : c.left.length ? 'left' : null };
    }
    if (unk) return { trade: t, ok: false, why: 'net' }; // 끝을 모르는 우리 번호가 있으면 새로 넣지 않는다(둘이 되지 않게)
    if (!allow) return { trade: t, ok: false, why: 'limit' };
    const kKey = leg === 'tp' ? 'tpK' : 'slK';
    const k = (t[kKey] || 0) + 1;
    const coid = coidFor(t.id, `${leg === 'tp' ? 't' : 's'}${k}`);
    const side = t.side === 'long' ? 'sell' : 'buy';
    const condType = leg === 'tp' ? 'IF_TOUCHED' : 'STOP';
    const amount = numStr(t.size, step);
    const trig = numStr(roundTo(want, tick), tick); // 보낼 발동가 글자(아래 trigger_price와 같은 값)
    const sentAt = now();
    const before = t;
    // 보내기 전에 장부 다리에 pend(이름표·보낸 시각·보낸 수량 글자·종류·보낸 발동가 글자 trig)와 식별자 k를 적어 저장(정한 것 21·22 — 응답을 잃어도
    // 다음 주기·다른 탭이 같은 다리에 또 보내지 않고 이 pend부터 푼다). trig는 익절·직접 손절 발동가(장부 tp·sl.price에 이미 있는 값 — 자동 손절가 아님,
    // 보안 규칙 18 밖) — pend 풀기가 회원 조건 주문을 채택하지 않게(최종 검토 중요 2)
    t = { ...t, [kKey]: k, [leg]: { ...(t[leg] || {}), pend: { coid, at: sentAt, qty: amount, cond: condType, trig } } };
    if (typeof save === 'function') await save(t);
    onOrder();
    const o = await retrying(`/private/${side}`, { instrument_name: t.inst, amount, type: 'market', position_side: 'BOTH', reduce_only: true, custom_order_id: coid, condition_type: condType, trigger_price: trig, trigger_price_type: leg === 'tp' ? 2 : 1 });
    forget();
    if (!o.ok && o.kind !== 'unknown' && o.kind !== 'duplicate') { // 안 나간 것이 확실(거래소 오류 답·막힘·요청 제한 등) — pend·k를 되돌림
      t = before;
      if (typeof save === 'function') await save(t);
      return { trade: t, ok: false, sent: true, why: o.kind === 'ox' ? o.code : o.kind };
    }
    let id = orderIdOf(o);
    if (!id) { // 결과 모름(504·끊김·같은 식별자·200인데 번호 없음) — 여기서는 한 번만 묻고(정한 것 4), 못 풀면 pend 그대로 다음 주기에
      const r = await resolvePlaced({ inst: t.inst, coid, sentAt, side, reduce: true, qty: Number(amount), step: 10 ** -decimalsOf(amount), cond: condType, fits: (x) => near(num(x.trigger_price), want) });
      if (r.state === 'rejected') return { trade: { ...t, [leg]: dropPend(t[leg]) }, ok: false, sent: true, why: r.code ?? 'rejected' }; // 늦은 거절 — k는 쓴 것으로 둠
      if (r.state !== 'placed') return { trade: t, ok: false, sent: true, why: 'pend' };
      id = r.orderId;
    }
    t = { ...t, [leg]: { price: want, via: 'cond', orderIds: [id, ...protectIds(t[leg])] } }; // pend 없는 새 다리
    const oo2 = await openOrders(t.inst);
    let vis = oo2.ok && oo2.list.some((x) => String(x.order_id) === id);
    if (!vis) {
      const s2 = await orderState(id);
      vis = s2.ok && s2.state === 'open';
    }
    if (!vis) return { trade: t, ok: false, sent: true, why: 'unseen' }; // 새 것이 확인되지 않으면 옛 것을 지우지 않는다(§4.3)
    const old = protectIds(t[leg]).filter((x) => x !== id);
    const c = await cancelIds(t.inst, old);
    setIds([id, ...old.filter((x) => !c.done.includes(x))]);
    return { trade: t, ok: c.left.length === 0, sent: true, why: c.left.length ? 'left' : null };
  }
  // save(t) — cond 판이 보호 주문을 보내기 전에 pend를 적은 장부 줄을 저장(엔진 save·정리 주기 e.save). 없으면 저장 없이(시험이 protect만 부를 때)
  async function protect(trade, target, { tick = 0.1, step = 0.001, save = null } = {}) {
    if (!cond) {
      const p = await positionOf(trade.inst);
      if (!p.ok || !p.pos) return { trade, confirmed: false };
      if (near(p.pos.tp, target.tp) && near(p.pos.sl, target.sl)) return { trade: { ...trade, tpslNotSynced: false }, confirmed: true };
      return { trade: trade.tpslNotSynced ? trade : note({ ...trade, tpslNotSynced: true }, 'tpsl_not_synced', null, now()), confirmed: false };
    }
    const oo = await openOrders(trade.inst);
    if (!oo.ok) return { trade, confirmed: false };
    const seen = new Map(oo.list.map((x) => [String(x.order_id), x]));
    const allow = syncAllowed(trade.tpslSyncs, now());
    let t = trade;
    let ok = true;
    let sent = false;
    let why = null;
    for (const leg of ['tp', 'sl']) {
      const r = await syncLeg(t, leg, leg === 'tp' ? target.tp : target.sl, { seen, tick, step, allow, save });
      t = r.trade;
      ok = ok && r.ok;
      sent = sent || !!r.sent;
      why = why ?? r.why ?? null;
    }
    if (sent) t = { ...t, tpslSyncs: [...(t.tpslSyncs || []), now()] };
    if (ok) return { trade: { ...t, tpslNotSynced: false }, confirmed: true };
    // 다음 주기에 저절로 풀리는 까닭(한도·아직 안 보임·조회 실패·결과 모를 pend·옛 번호 끝 확인 못 함 left — 장부에 남겨 다음 주기가 다시 취소)
    // — 30초마다 메모를 쌓지 않는다
    const quiet = why === 'limit' || why === 'unseen' || why === 'net' || why === 'pend' || why === 'left';
    if (t.tpslNotSynced && quiet) return { trade: t, confirmed: false };
    return { trade: note({ ...t, tpslNotSynced: true }, 'tpsl_not_synced', quiet ? null : why, now()), confirmed: false };
  }

  // ── 남은 우리 주문 정리(고아 — §6.9 끝, 설계 2026-10-19 §3): 미체결 가운데 아는 번호이고 끝난 매매(live false)의 것만(진입 번호 빼고) 번호로 취소·끝 확인 ──
  // 모르는 번호(같은 UID의 다른 기기·창·오렌지엑스 앱)·살아 있는 매매 번호·목록에만 있는 번호(live null — 자동 손절 목록 정리가 맡음)는 건드리지 않는다.
  // 엔진은 임대와 탭 잠금을 모두 쥔 기기에서만 부른다(follow-upkeep). 돌려준 값 = 끝을 확인한 수
  async function cancelOrphans(inst, { known: kn = EMPTY_KNOWN } = {}) {
    const oo = await openOrders(inst);
    if (!oo.ok) return 0;
    const ids = oo.list.map((x) => String(x.order_id)).filter((id) => {
      const e = kn.of(id);
      return !!e && e.live === false && e.role !== 'entry';
    });
    if (!ids.length) return 0;
    return (await cancelIds(inst, ids)).done.length;
  }

  // 풀린 장부 줄의 수량·평단(진행 기록 Task 3 Ruling ② — 설계 §6.10 회원이 바꾼 포지션은 닫지 않음): 지금 포지션이 같은 방향이고 체결 줄(filled·partial·adopted)
  // 수량 합 ±합×posTol 안일 때만 포지션으로(syncPos와 같음), 밖이면(회원이 더 사거나 팜·방향 다름) 수량 = 체결 합·평단 그대로 — 뒤 positionVerdict·
  // closeTrade가 detached로 보고 회원 몫을 닫지 않는다(분리 매매를 state open으로 넘기는 닫기 시트 길도). 포지션 없음·조회 실패는 그대로.
  // 체결 줄 수량을 모르면(옛 기록 — 합을 못 셈) 풀기 전 장부 줄(before — 보내다 모른 수량까지)로 ownsPosition일 때만 포지션으로, 아니면 그대로
  async function fitSize(t, before) {
    const p = await positionOf(t.inst);
    if (!p.ok || !p.pos) return t;
    const toPos = { ...t, size: Math.abs(p.pos.size), avg: p.pos.avg ?? t.avg };
    const filled = t.fills.filter((f) => f && FILLED.includes(f.state));
    if (filled.some((f) => !(Number(f.qty) > 0))) return ownsPosition(before, p.pos) ? toPos : t;
    const sum = Number(filled.reduce((a, f) => a + Number(f.qty), 0).toFixed(8));
    if (Math.sign(p.pos.size) === dirOf(t.side) && Math.abs(Math.abs(p.pos.size) - sum) <= sum * CORE.posTol) return toPos;
    return { ...t, size: sum };
  }
  // 보내다 끊긴 줄(sending — 앱이 꺼짐·체결 확인 unclear·결과 모름) 확인(§6.4·§6.11, 설계 2026-10-19 §5.3): 저장된 번호가 있으면 그 주문 상태부터
  // (조사 4-2 — 허브·기록 조회 없이), 없으면 허브 기억 → 모양 맞춤(한 번). 찾으면 체결분으로 adopted, 안 나감이 확실하면 failed,
  // 모름이면 sending 그대로(다시 보내지 않고 skipped로 떨어뜨리지 않음 — 포지션 없음의 끝은 follow-upkeep이 정함, 계획 정한 것 7).
  // 줄을 푼 뒤(진행 기록 Task 3 Ruling — 회원이 바꾼 포지션을 장부 수량으로 흡수해 닫지 않게):
  // - 끝난 매매(closed·skipped 등 — ACTIVE_STATES 밖)는 줄(adopted·failed·번호)만 고치고 상태·수량·평단 그대로(skipped로 바꾸지 않고 포지션도 보지 않음)
  // - sending 줄이 하나라도 남으면 장부 수량을 지금 포지션으로 덮지 않는다(장부 수량 = 마지막으로 맞춘 포지션, 90초 뒤 크기 판정의 받침)
  // - 다 풀리면 opening·unclear는 open으로(detached·closing은 그대로), 수량은 fitSize(포지션이 풀린 체결 줄 합 ±5% 안일 때만 포지션으로)
  async function recoverSending(trade) {
    let t = trade;
    const put = (i, f) => {
      const fills = [...t.fills];
      fills[i] = f;
      t = { ...t, fills };
    };
    for (let i = 0; i < t.fills.length; i += 1) {
      const f = t.fills[i];
      if (f.state !== 'sending') continue;
      let id = f.orderId && ORDER_ID_RE.test(String(f.orderId)) ? String(f.orderId) : null;
      if (!id) {
        const r = await resolvePlaced({ inst: t.inst, coid: f.customId, sentAt: Number(f.at), side: t.side === 'long' ? 'buy' : 'sell', reduce: false, qty: Number(f.qty), step: 10 ** -decimalsOf(f.qty), cond: null });
        if (r.state === 'net') return { trade: t };
        if (r.state === 'rejected') {
          put(i, { ...f, state: 'failed' });
          continue;
        }
        if (r.state !== 'placed') continue;
        id = r.orderId;
      }
      const s = await orderState(id);
      if (s.ok && (s.state === 'filled' || s.state === 'partial')) put(i, { ...f, orderId: id, state: 'adopted', qty: num(s.order.filled_amount), price: num(s.order.average_price) });
      else if (s.ok && s.state === 'failed') put(i, { ...f, orderId: id, state: 'failed' });
      else if (f.orderId !== id) put(i, { ...f, orderId: id }); // open·모르는 상태·조회 실패 — 번호만 적고 그대로
    }
    if (!ACTIVE_STATES.includes(t.state)) return { trade: t }; // 끝난 매매 — 줄만(Ruling ①)
    const live = t.fills.some((f) => FILLED.includes(f.state));
    const pend = t.fills.some((f) => f.state === 'sending');
    if (!live && !pend) return { trade: { ...t, state: 'skipped', reason: t.reason || 'not_filled', closedAt: t.closedAt || now() } };
    if (!live) return { trade: t.state === 'opening' ? { ...t, state: 'unclear' } : t };
    if (pend) return { trade: t };
    if (t.state === 'opening' || t.state === 'unclear') t = { ...t, state: 'open' };
    return { trade: await fitSize(t, trade) };
  }

  // orderParams: 시장가 주문 모양(진입·추가 진입이 쓰는 것) — 트레이딩 탭 수동 주문(p40 manual-exec)이 같은 모양을 쓴다. sendOrder는 내보내지 않는다(수동은 자체 보내기, spec §5.5)
  // resolvePlaced·cancelIds·cancelProtect — 자동 손절 keeper·수동 실행기·정리 주기가 같은 절차를 쓴다(진행 기록 Task 3 Ruling)
  return {
    positionOf, positions, openOrders, assets, confirmFill, ensureMarginLev, openTrade, addFill, closeTrade, protect, cancelOrphans, recoverSending, forget,
    placeAutoSl, orderState, cancelOrder, goneExit, exitFromHistory, withExit, ops, orderParams, resolvePlaced, cancelIds, cancelProtect,
  };
}
