// 따라가기 거래소 절차(설계 3-2 §6.6~§6.10) — 진입·추가 진입·종료·익절/손절 보호·남은 주문 정리·보내다 끊긴 줄 확인.
// call(method, params, opts) = ox-client.call(같은 결과 모양 Outcome). 장부 줄(trade)을 받아 바뀐 새 줄을 돌려준다 — 저장은 부른 쪽(엔진)이,
// 단 주문을 보내기 전의 'sending' 줄은 save(trade)로 먼저 저장한다(§6.4 — 그 사이 앱이 꺼지면 다음에 식별자로 확인).
// - 주문 전마다 같은 식별자를 미체결·최근 기록 20건에서 찾는다(있으면 adopted — 다시 보내지 않음, §6.7). 결과 모름(unknown·duplicate)도 같은 확인.
// - 한 동작 안의 get_positions·get_assets_info는 5초 동안 다시 쓴다(호출 수 줄이기, §6.8).
// - 서버 요청 제한(rate·busy): 위험을 늘리는 호출은 그 신호를 건너뛰고(rate_hub), 체결 확인·보호 확인·종료는 1초 뒤 최대 3번 다시.
// - p34 자동 손절(설계 §2.5~§2.8): placeAutoSl(STOP·reduce_only·표시가 발동·ptf.<id>.g<k>), orderState·cancelOrder(ops — auto-sl-orders가 끝 확인에 씀),
//   closeTrade의 포지션 없음 갈래는 그 매매 자동 손절 주문 상태부터(filled면 사유 auto_sl), 아니면 최근 기록의 반대 방향 reduce_only 체결로 exit.
//   회원 본인 USDT 손익(§4) = dir × (exit 평균가 − 평단) × exit 수량(거래 비용 제외) — 모르면 null.
import { orderStateOf, positionVerdict, syncAllowed, CORE } from './follow-core.js';
import { assetsView, coidFor, coidPrefix, isProtectCoid, isPtf, isFollowCoid, numStr, roundTo, tradeResultPct, dirOf, pnlUsdt } from './follow-math.js';

export const EXEC = Object.freeze({ fillPollMs: 600, fillPolls: 5, openCancelMs: 3000, unknownPollMs: 1000, unknownPolls: 3, cacheMs: 5000, retryMs: 1000, retries: 3, tpslTol: 0.002, historyCount: 20 });
const RETRY_KINDS = Object.freeze(['rate', 'busy']);
const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
const note = (trade, reason, arg = null, now = Date.now()) => ({ ...trade, notes: [...(trade.notes || []), { at: now, reason, arg }] });

export function createExec({ call, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onOrder = () => {}, cond = false } = {}) {
  const cache = new Map();
  // 조회 두 가지는 5초 캐시 — 주문을 낸 뒤에는 forget()으로 지운다(그 뒤 조회는 새 값)
  async function cached(method, params) {
    const key = `${method}|${JSON.stringify(params)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < EXEC.cacheMs) return hit.o;
    const o = await call(method, params);
    if (o.ok) cache.set(key, { at: now(), o });
    return o;
  }
  const forget = () => cache.clear();
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
  // type(limit·market): 조건 주문이 어느 미체결 조회에 보이는지(U-A2) — 자동 손절 확인은 listed 기기에서 보였던 조회를 쓴다
  async function openOrders(inst, { type = null } = {}) {
    const o = await retrying('/private/get_open_orders_by_instrument', type ? { instrument_name: inst, type } : { instrument_name: inst });
    return o.ok ? { ok: true, list: Array.isArray(o.result) ? o.result : [] } : { ok: false, outcome: o };
  }
  async function assets() {
    const o = await cached('/private/get_assets_info', { asset_type: ['PERPETUAL'] });
    return o.ok ? { ok: true, view: assetsView(o.result) } : { ok: false, outcome: o };
  }
  // §6.7-2: 같은 식별자가 미체결·최근 기록 20건에 있으면 그 주문(다른 기기·앞선 실행이 낸 것)
  async function findByCoid(inst, coid, { type = null } = {}) {
    const open = await openOrders(inst, { type });
    if (!open.ok) return open;
    const hist = await retrying('/private/get_order_history_by_instrument', { instrument_name: inst, count: EXEC.historyCount });
    if (!hist.ok) return { ok: false, outcome: hist };
    const all = [...open.list, ...(Array.isArray(hist.result) ? hist.result : [])];
    return { ok: true, order: all.find((x) => x && x.custom_order_id === coid) || null };
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
        await retrying('/private/cancel', { order_id: String(orderId) });
        const again = await retrying('/private/get_order_state', { order_id: String(orderId) });
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

  // 마진 모드 격리 → 배율 L(§6.6 entry). WS 직접이면 follow/check가 coid를 본다({ coid })
  async function ensureMarginLev(inst, lev, coid) {
    const c = await call('/private/get_perpetual_user_config', { instrument_name: inst });
    if (!c.ok) return { fail: c };
    if (String(c.result && c.result.margin_type).toLowerCase() !== 'isolated') {
      const m = await call('/private/adjust_perpetual_margin_type', { instrument_name: inst, margin_type: 'isolate' }, { coid });
      if (!m.ok) return { fail: m };
    }
    if (Number(c.result && c.result.leverage) !== lev) {
      const l = await call('/private/adjust_perpetual_leverage', { instrument_name: inst, leverage: lev, posId: 0 }, { coid });
      if (!l.ok) return { fail: l, lev: true };
    }
    return { ok: true };
  }

  // 주문 결과(Outcome)가 실패일 때 기록 사유 — 막힘(서버 판정)·서버 요청 제한(rate_hub — 시간당 30건 rate_guard와 다름)·헤지 모드·그 밖 코드
  function failReason(o) {
    if (o.kind === 'blocked') return { reason: 'halted', arg: o.reason };
    if (RETRY_KINDS.includes(o.kind)) return { reason: 'rate_hub' };
    if (o.kind === 'ox' && /hedge|position\s*side/i.test(o.message || '')) return { reason: 'hedge_mode' };
    return { reason: 'error', arg: o.kind === 'ox' ? o.code : o.kind };
  }

  // 시장가 주문 하나: 보내고 → (결과 모름이면 식별자로 확인) → 체결 확인. { fill: { state, qty, price, orderId } } | { fail: { reason, arg } }
  async function sendOrder(method, params, inst, coid) {
    onOrder();
    const o = await call(method, params, { coid });
    forget();
    let orderId = o.ok && o.result ? String((o.result.order && o.result.order.order_id) ?? o.result.order_id ?? '') : '';
    if (!o.ok) {
      if (o.kind !== 'unknown' && o.kind !== 'duplicate') return { fail: failReason(o) };
      const f = await findByCoid(inst, coid); // 504·끊김 뒤에는 식별자로 먼저 확인 — 없으면 failed(같은 신호를 다시 보내지 않음)
      if (!f.ok || !f.order) return { fail: { reason: 'not_filled' } };
      orderId = String(f.order.order_id);
    }
    if (!orderId) return { fail: { reason: 'not_filled' } };
    const c = await confirmFill(orderId);
    return { fill: { ...c, orderId } };
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

  // ── 진입(§6.6 entry·§6.7): 같은 식별자(adopted) → 내 포지션·내 미체결(따라가기 식별자 아님 — 수동 ptf.m… 포함)이면 건너뜀 → sending 저장 → 격리·배율 → 시장가 + 익절·손절 부착 → 체결 확인 ──
  // plan = { trade(새 장부 줄, fills 비어 있음), amount, qty, margin, tp, sl, tick, preflight? }
  // preflight() = 시장가를 보내기 바로 전 엔진이 다시 보는 조건(시각 조건·G1~G8, §6.3 "주문 하나마다") — 거짓이면 보내지 않고 late
  // beforeEntry() = 새 진입 전 그 종목 자동 손절 주문 목록 끝 확인(p34 §2.7) — 포지션 없음·회원 주문 없음을 본 뒤에만 부른다.
  //   거짓이면 진입하지 않고 auto_sl_check(남은 STOP이 새 포지션을 닫지 않게), 'has_position'·'error'면 그 사유
  async function openTrade(plan, save) {
    let trade = plan.trade;
    const coid = coidFor(trade.id, 'e1');
    const dup = await findByCoid(trade.inst, coid);
    if (!dup.ok) return { trade: note({ ...trade, state: 'skipped', reason: 'error', closedAt: now() }, 'error', dup.outcome.kind, now()) };
    if (dup.order) {
      const st = orderStateOf(dup.order);
      trade = { ...trade, state: 'open', fills: [{ fill: 1, customId: coid, orderId: String(dup.order.order_id), state: 'adopted', qty: num(dup.order.filled_amount), price: num(dup.order.average_price), margin: plan.margin, at: now() }] };
      if (st === 'failed') return { trade: { ...trade, state: 'skipped', reason: 'not_filled', closedAt: now() } };
      return { trade: await syncPos(trade) };
    }
    const pos = await positionOf(trade.inst);
    if (!pos.ok) return { trade: { ...trade, state: 'skipped', reason: 'error', closedAt: now() } };
    if (pos.pos) return { trade: { ...trade, state: 'skipped', reason: 'has_position', closedAt: now() } };
    const oo = await openOrders(trade.inst);
    if (!oo.ok) return { trade: { ...trade, state: 'skipped', reason: 'error', closedAt: now() } };
    // 따라가기·리허설 식별자(isFollowCoid)가 아닌 미체결 = 회원 주문 — 트레이딩 탭 수동 주문(ptf.m…)도 회원 주문이다(spec §5.10)
    if (oo.list.some((x) => !isFollowCoid(x.custom_order_id))) return { trade: { ...trade, state: 'skipped', reason: 'has_orders', closedAt: now() } };
    // 진입할 때만(포지션·회원 주문이 없음을 본 뒤) 이전 자동 손절 확인 — 앞에 두면 진입하지 않을 신호가 살아 있는 포지션의 STOP을 지운다(검토 고침 2·4).
    // true면 진입, 문자열('has_position'·'error')이면 그 사유, 그 밖이면 auto_sl_check
    if (typeof plan.beforeEntry === 'function') {
      const be = await plan.beforeEntry();
      if (be !== true) return { trade: { ...trade, state: 'skipped', reason: be === 'has_position' || be === 'error' ? be : 'auto_sl_check', closedAt: now() } };
    }
    trade = { ...trade, state: 'opening', fills: [{ fill: 1, customId: coid, orderId: null, state: 'sending', qty: plan.qty, price: null, margin: plan.margin, at: now() }] };
    await save(trade);
    const ml = await ensureMarginLev(trade.inst, trade.lev, coid);
    if (!ml.ok) {
      // 거래소가 배율 변경을 거절했을 때만 lev_denied — 요청 제한·결과 모름·숨김(hidden) 등은 그 사유 그대로
      const r = ml.lev && ml.fail.kind === 'ox' ? { reason: 'lev_denied' } : failReason(ml.fail);
      return { trade: { ...trade, state: 'skipped', reason: r.reason, reasonArg: r.arg ?? null, closedAt: now(), fills: [{ ...trade.fills[0], state: 'failed' }] } };
    }
    if (typeof plan.preflight === 'function' && !plan.preflight()) {
      return { trade: { ...trade, state: 'skipped', reason: 'late', closedAt: now(), fills: [{ ...trade.fills[0], state: 'failed' }] } };
    }
    const { method, params } = orderParams(trade.side, { inst: trade.inst, amount: plan.amount, coid, tp: plan.tp, sl: plan.sl, tick: plan.tick });
    const r = await sendOrder(method, params, trade.inst, coid);
    if (r.fail) return { trade: { ...trade, state: 'skipped', reason: r.fail.reason, reasonArg: r.fail.arg ?? null, closedAt: now(), fills: [{ ...trade.fills[0], state: 'failed' }] } };
    const f = r.fill;
    const fill = { ...trade.fills[0], orderId: f.orderId, state: f.state === 'unclear' ? 'sending' : f.state, qty: f.qty, price: f.price };
    if (f.state === 'failed') return { trade: { ...trade, state: 'skipped', reason: 'not_filled', closedAt: now(), fills: [fill] } };
    if (f.state === 'unclear') return { trade: note({ ...trade, state: 'unclear', fills: [fill] }, 'unclear_fill', null, now()) };
    trade = { ...trade, state: 'open', fills: [fill], avg: f.price, size: f.qty, tp: { price: plan.tp, via: 'attach', orderIds: [] }, sl: { price: plan.sl, via: 'attach', orderIds: [] } };
    return { trade: await syncPos(trade) };
  }

  // ── 추가 진입(§6.6 dca): 같은 식별자 → 거래소 포지션 ±5%(아니면 detached·gone이면 closed) → sending 저장 → preflight → 배율 그대로 시장가(새 예상 평단 익절·손절) → 체결 확인 ──
  async function addFill(trade, plan, save) {
    const coid = coidFor(trade.id, `d${plan.fill}`);
    if (trade.fills.some((f) => f.customId === coid && ['filled', 'partial', 'adopted'].includes(f.state))) return { trade };
    const dup = await findByCoid(trade.inst, coid);
    if (!dup.ok) return { trade: note(trade, 'error', dup.outcome.kind, now()) };
    if (dup.order) {
      const t = { ...trade, fills: [...trade.fills, { fill: plan.fill, customId: coid, orderId: String(dup.order.order_id), state: 'adopted', qty: num(dup.order.filled_amount), price: num(dup.order.average_price), margin: plan.margin, at: now() }] };
      return { trade: await syncPos(t) };
    }
    const pos = await positionOf(trade.inst);
    if (!pos.ok) return { trade: note(trade, 'error', pos.outcome.kind, now()) };
    const v = positionVerdict(trade, pos.pos);
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
    t.fills[idx] = { ...sending, orderId: r.fill.orderId, state: r.fill.state === 'unclear' ? 'sending' : r.fill.state, qty: r.fill.qty, price: r.fill.price };
    if (r.fill.state === 'failed') return { trade: note(t, 'not_filled', null, now()) };
    if (r.fill.state === 'unclear') return { trade: note({ ...t, state: 'unclear' }, 'unclear_fill', null, now()) };
    t = { ...t, tp: { ...(t.tp || {}), price: plan.tp ?? null }, sl: { ...(t.sl || {}), price: plan.sl ?? null } };
    return { trade: await syncPos(t) };
  }

  // ── 종료(§6.6 tp·sl·close·liq): 거래소에 포지션이 남아 있으면 close_position(시장가·전량·pos_id 0) → 그 매매의 ptf. 주문 취소 → closed ──
  // 회원이 바꾼 포지션(±5% 밖·방향 다름)은 닫지 않고 detached(§6.10). 결과 %는 정리 주문의 평균가로(기록용)
  // 포지션을 확인하지 못하면(네트워크·요청 제한·서버) 'open'으로 돌려 둔다 — 끝 이벤트가 남아 있으니 정리 주기(endVerdict)가 다시 정리한다.
  // 'closing'이나 'closed'로 적으면 아무도 다시 보지 않아 거래소 포지션이 남는다(검토 2026-10-08)
  async function closeTrade(trade, { step = 0.001, reason = null } = {}) {
    const pos = await positionOf(trade.inst, { fresh: true });
    if (!pos.ok) return { trade: note({ ...trade, state: 'open' }, 'error', pos.outcome.kind, now()), done: false };
    const v = positionVerdict(trade, pos.pos);
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
    await cancelTradeOrders(t);
    t = { ...t, state: 'closed', closedAt: now() };
    if (reason) t = note(t, reason.reason, reason.arg ?? null, now());
    return { trade: t, done: true };
  }
  async function cancelTradeOrders(trade) {
    const oo = await openOrders(trade.inst);
    if (!oo.ok) return;
    for (const x of oo.list) if (typeof x.custom_order_id === 'string' && x.custom_order_id.startsWith(coidPrefix(trade.id))) await retrying('/private/cancel', { order_id: String(x.order_id) });
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
      const at = num(x.last_update_timestamp) ?? num(x.creation_timestamp) ?? 0;
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
  //       / { ok: false, sent: 'unknown', kind } — 결과 모름(504·끊김·같은 식별자) → 부르는 쪽이 식별자로 찾는다(다시 보내지 않음)
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
  // auto-sl-orders(cancelEntry·checkBeforeEntry·sweepEntries)가 쓰는 거래소 손잡이
  const ops = { orderState, cancel: cancelOrder, findByCoid: (inst, coid, opts) => findByCoid(inst, coid, opts) };

  // ── 보호 확인(§6.9): 실제 평단으로 다시 계산한 목표(target = { tp, sl } — 엔진이 follow-math.tpslFor로)와 비교 ──
  // cond false: get_positions의 take_profit_price·stop_loss_price(0 = 없음)와 0.2% 안이면 끝, 아니면 tpsl_not_synced(다음 추가 진입 안 함).
  // cond true: 그 매매의 조건 주문(ptf.<id>.t*·s*)의 trigger_price·amount와 비교 — 다르면 옛 것 취소 뒤 새로(10분 2번·하루 10번, 넘으면 tpsl_not_synced)
  const near = (a, b) => (a == null || a === 0 ? b == null : b != null && Math.abs(a - b) / b <= EXEC.tpslTol);
  async function protect(trade, target, { tick = 0.1, step = 0.001 } = {}) {
    if (!cond) {
      const p = await positionOf(trade.inst);
      if (!p.ok || !p.pos) return { trade };
      if (near(p.pos.tp, target.tp) && near(p.pos.sl, target.sl)) return { trade: { ...trade, tpslNotSynced: false } };
      return { trade: trade.tpslNotSynced ? trade : note({ ...trade, tpslNotSynced: true }, 'tpsl_not_synced', null, now()) };
    }
    const oo = await openOrders(trade.inst);
    if (!oo.ok) return { trade };
    const mine = oo.list.filter((x) => isProtectCoid(x.custom_order_id, trade.id));
    const tpO = mine.filter((x) => /\.t\d+$/.test(x.custom_order_id));
    const slO = mine.filter((x) => /\.s\d+$/.test(x.custom_order_id));
    const ok = (list, want) => (want == null ? list.length === 0 : list.length === 1 && near(num(list[0].trigger_price), want) && Math.abs(num(list[0].amount) - trade.size) < step / 2);
    if (ok(tpO, target.tp) && ok(slO, target.sl)) return { trade: { ...trade, tpslNotSynced: false } };
    if (!syncAllowed(trade.tpslSyncs, now())) return { trade: trade.tpslNotSynced ? trade : note({ ...trade, tpslNotSynced: true }, 'tpsl_not_synced', null, now()) };
    for (const x of mine) await retrying('/private/cancel', { order_id: String(x.order_id) });
    let t = { ...trade, tpslSyncs: [...(trade.tpslSyncs || []), now()] };
    const close = trade.side === 'long' ? '/private/sell' : '/private/buy';
    const base = { instrument_name: trade.inst, amount: numStr(trade.size, step), type: 'market', position_side: 'BOTH', reduce_only: true };
    let failed = null; // 새 조건 주문이 걸리지 않았으면(요청 제한·막힘·거래소 오류) 맞춰졌다고 적지 않는다
    if (target.tp != null) {
      const k = (t.tpK || 0) + 1;
      onOrder();
      const o = await retrying(close, { ...base, custom_order_id: coidFor(trade.id, `t${k}`), condition_type: 'IF_TOUCHED', trigger_price: numStr(roundTo(target.tp, tick), tick), trigger_price_type: 2 });
      if (o.ok) t = { ...t, tpK: k, tp: { price: target.tp, via: 'cond', orderIds: [] } };
      else failed = failed || o;
    }
    if (target.sl != null) {
      const k = (t.slK || 0) + 1;
      onOrder();
      const o = await retrying(close, { ...base, custom_order_id: coidFor(trade.id, `s${k}`), condition_type: 'STOP', trigger_price: numStr(roundTo(target.sl, tick), tick), trigger_price_type: 1 });
      if (o.ok) t = { ...t, slK: k, sl: { price: target.sl, via: 'cond', orderIds: [] } };
      else failed = failed || o;
    }
    forget();
    if (failed) return { trade: note({ ...t, tpslNotSynced: true }, 'tpsl_not_synced', failed.kind === 'ox' ? failed.code : failed.kind, now()) };
    return { trade: { ...t, tpslNotSynced: false } };
  }

  // ── 남은 ptf. 주문 정리(§6.9 끝): 이 기기 장부에 있는 매매(ownIds) 중 열려 있지 않은(liveIds 밖) 매매의 ptf. 미체결 주문만 취소 ──
  // 장부가 모르는 ptf. 식별자(같은 UID의 다른 기기·창이 연 매매일 수 있음)와 회원 주문(ptf. 아님)은 건드리지 않는다(§6.3 "자기 장부에 있는 매매에만").
  // 엔진은 임대와 탭 잠금을 모두 쥔 기기에서만 부른다(follow-upkeep)
  async function cancelOrphans(inst, { ownIds = [], liveIds = [] } = {}) {
    const oo = await openOrders(inst);
    if (!oo.ok) return 0;
    let n = 0;
    for (const x of oo.list) {
      if (!isPtf(x.custom_order_id)) continue;
      const id = x.custom_order_id.split('.')[1];
      if (!ownIds.includes(id) || liveIds.includes(id)) continue;
      const o = await retrying('/private/cancel', { order_id: String(x.order_id) });
      if (o.ok) n += 1;
    }
    return n;
  }

  // ── 앱을 켤 때(§6.4·§6.11): 'sending' 체결 줄을 식별자로 확인 → 찾으면 adopted(체결분), 없으면 failed ──
  async function recoverSending(trade) {
    let t = trade;
    for (let i = 0; i < t.fills.length; i += 1) {
      const f = t.fills[i];
      if (f.state !== 'sending') continue;
      const r = await findByCoid(t.inst, f.customId);
      if (!r.ok) return { trade: t };
      const fills = [...t.fills];
      if (r.order) {
        const s = orderStateOf(r.order);
        fills[i] = { ...f, orderId: String(r.order.order_id), state: s === 'failed' ? 'failed' : 'adopted', qty: num(r.order.filled_amount), price: num(r.order.average_price) };
      } else fills[i] = { ...f, state: 'failed' };
      t = { ...t, fills };
    }
    const live = t.fills.some((f) => ['filled', 'partial', 'adopted'].includes(f.state));
    if (!live) return { trade: { ...t, state: 'skipped', reason: t.reason || 'not_filled', closedAt: t.closedAt || now() } };
    if (t.state === 'opening' || t.state === 'unclear') t = { ...t, state: 'open' };
    return { trade: await syncPos(t) };
  }

  // orderParams: 시장가 주문 모양(진입·추가 진입이 쓰는 것) — 트레이딩 탭 수동 주문(p40 manual-exec)이 같은 모양을 쓴다. sendOrder는 내보내지 않는다(수동은 자체 보내기, spec §5.5)
  return {
    positionOf, positions, openOrders, assets, findByCoid, confirmFill, ensureMarginLev, openTrade, addFill, closeTrade, protect, cancelOrphans, recoverSending, forget,
    placeAutoSl, orderState, cancelOrder, goneExit, exitFromHistory, withExit, ops, orderParams,
  };
}
