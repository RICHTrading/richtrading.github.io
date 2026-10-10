// 따라가기 자동 손절 맞추기(p34 설계 §2.3~§2.13) — 엔진·정리 주기·가벼운 주기가 부른다(종목 큐 안, 탭 잠금을 쥔 탭, 위험을 줄이는 조건 gateReduce일 때만).
// 판정은 auto-sl.js(공용 순수 함수), 기기 주문 목록은 auto-sl-orders.js, 거래소 호출은 follow-exec.js. 여기서는 순서만 정한다.
// - 매번 첫 줄에서 스위치(kv.autoSl)를 저장소에서 다시 읽는다(메모리 사본으로 판단하지 않음).
// - 발동가는 장부·목록·기록 어디에도 저장하지 않는다 — 거래소 주문에 넣거나 받은 주문의 trigger_price와 메모리에서 비교할 때만.
// - 걸기·취소는 위험을 줄이는 호출 — 시간당 30건은 세기만 하고 막지 않는다. 살아 있는 주문의 자동 교체만 10분 2번·하루 10번(syncAllowed).
// - 결과 모름(504·끊김)은 다시 보내지 않는다(listed 기기에서 60초 동안 어디에도 없으면 안 나간 것으로 보고 k+1) — 보이지 않는 STOP 두 개를 막는다.
import { autoSlDue, liqOf, autoSlTrigger, autoSlPassed, autoSlVerdict, autoSlMatches, autoSlGap, dedupeKeep, nextK, isAutoSlCoid, autoSlKOf, AUTO_SL } from './auto-sl.js';
import { cancelEntry, checkBeforeEntry, refusedQuery } from './auto-sl-orders.js';
import { syncAllowed, CORE } from './follow-core.js';
import { coidFor, dirOf, numStr } from './follow-math.js';

// 자동 손절을 맞추는 매매 상태(그 밖은 끝난 매매 — 남은 주문은 목록 정리가)
export const SL_LIVE = Object.freeze(['open', 'unclear', 'closing', 'detached']);
const WATCH = Object.freeze(['failed', 'unclear', 'sending']); // 보조 감시(§2.11)
const NOTES_KEEP = 50;
// prevCoid·prevOrderId·prevLiqSrc: 자동 교체(새 것 먼저) 중 새 것이 보이기 전까지 지키는 옛 주문(가격 없음 — 식별자·번호·청산가 출처만, 검토 고침 3)
const NO_PREV = Object.freeze({ prevCoid: null, prevOrderId: null, prevLiqSrc: null });
const EMPTY = Object.freeze({ state: 'none', k: 0, coid: null, orderId: null, prevCoid: null, prevOrderId: null, prevLiqSrc: null, liqSrc: null, at: null, sendAt: null, syncs: [], rejects: 0, rawState: null });

export const slOf = (t) => (t && t.autoSl && typeof t.autoSl === 'object' ? { ...EMPTY, ...t.autoSl } : { ...EMPTY });
const withSl = (t, patch) => ({ ...t, autoSl: { ...slOf(t), ...patch } });
// 자동 손절 정리 미완(p35 §5.3 고침 1): 매매는 끝났는데(SL_LIVE 밖) 그 매매가 건 자동 손절의 끝이 아직 확인되지 않음 — autoSl.state가
// off·done·none이 아니고 번호·식별자가 남아 있다. 정리 주기·가벼운 주기가 종목 큐 안에서 다시 취소하고, 새 진입 전 확인이 그 종목 진입을 막는다
const SL_SETTLED = Object.freeze(['off', 'done', 'none']);
export function slCleanupPending(t) {
  if (!t || typeof t !== 'object' || SL_LIVE.includes(t.state)) return false;
  const s = slOf(t);
  return !SL_SETTLED.includes(s.state) && !!(s.orderId || s.coid || s.prevOrderId || s.prevCoid);
}
// 이 매매가 연 포지션인가(§2.8 — 회원이 바꾼 포지션이면 수량이 회원 것이라 새로 걸거나 바꾸거나 닫지 않는다, 검토 고침 1):
// 방향이 같고 수량이 장부 수량 ±5%(follow-core positionVerdict와 같은 폭) 안. 보내다 결과를 모른 체결 줄(sending)은 나갔을 수도 있어 그 수량까지 허용
export function ownsPosition(t, pos) {
  const size = Number(pos && pos.size);
  if (!t || !Number.isFinite(size) || size === 0 || Math.sign(size) !== dirOf(t.side)) return false;
  const lo = Number(t.size) > 0 ? Number(t.size) : 0;
  const pend = (Array.isArray(t.fills) ? t.fills : []).filter((f) => f && f.state === 'sending').reduce((a, f) => a + (Number(f.qty) > 0 ? Number(f.qty) : 0), 0);
  const hi = lo + pend;
  if (!(hi > 0)) return false;
  const q = Math.abs(size);
  return q >= lo * (1 - CORE.posTol) && q <= hi * (1 + CORE.posTol);
}
// 신호 차수(§2.3) — 가장 큰 값만(옛 사본이 내리지 않게)
export function bumpStage(t, stage) {
  if (!t || !Number.isInteger(stage) || stage < 1) return t;
  return Number.isInteger(t.sigStage) && t.sigStage >= stage ? t : { ...t, sigStage: stage };
}
// 회원 상태·리허설 상태의 open[].stage(정리 주기·가벼운 주기 — 앱이 꺼진 동안 4차가 된 매매)
export function stageFromState(t, st) {
  const list = t.rehearsal ? st && st.rehearsal && st.rehearsal.open : st && st.open;
  const o = Array.isArray(list) ? list.find((x) => x && x.id === t.id) : null;
  return o && Number.isInteger(o.stage) ? o.stage : null;
}

// e = { exec, sw, orders, rules, refresh, save, now, instruments, reduceOk, markOf(inst), isTest(), setDiag(d), markCheck(inst, on), enqueue(symbol, fn), owner? }
// owner(p40): 이 keeper가 거는·정리하는 목록 항목의 주인 — 'f'(따라가기, 기본) | 'm'(트레이딩 탭 수동 주문 manual-exec). 그 밖의 값은 'f'.
// 같은 기기 목록(kv.autoSlOrders)을 두 keeper가 나눠 쓴다: 목록 정리(sweep)는 자기 주인 항목만, 새 진입 전 확인·'확인했습니다'는 그 종목 모든 항목
export function createAutoSlKeeper(e) {
  const cfg = e.rules.follow.autoSl;
  const owner = e.owner === 'm' ? 'm' : 'f';
  const now = () => e.now();
  const addNote = (t, reason, arg = null) => ({ ...t, notes: [...(t.notes || []), { at: now(), reason, arg }].slice(-NOTES_KEEP) });
  const lastNote = (t) => (Array.isArray(t.notes) && t.notes.length ? t.notes[t.notes.length - 1].reason : null);
  // type market 미체결 조회 확정 거절을 기기에 적는다(p35 검토 2·3) — 같은 회차의 남은 조회도 sw 사본으로 건너뛴다. 저장 실패면 다음에 다시
  async function markNoMarket(sw) {
    if (!sw || sw.noMarket || sw.listedType === 'market' || !e.sw || typeof e.sw.markNoMarket !== 'function') return;
    try {
      await e.sw.markNoMarket();
      sw.noMarket = true;
    } catch {
      // 메모리 저장소 등 — 기록 없이 이번 판단만
    }
  }
  // cancelEntry 옵션 — 스위치 값(listed·listedType·noMarket)과 거절 기록
  const optOf = (sw) => ({ listed: sw.listed, listedType: sw.listedType, noMarket: !!sw.noMarket, now: now(), onRefused: () => markNoMarket(sw) });
  // 거래소 미체결(일반 + type market — 거절을 확인한 기기는 일반만)에서 keep(주문)에 맞는 것. 조회 실패(확정 거절 아님)는 net으로 센다
  async function openListed(inst, sw, keep) {
    const list = [];
    let net = 0;
    for (const type of sw.noMarket ? [null] : [null, 'market']) {
      const oo = await e.exec.openOrders(inst, { type });
      if (!oo.ok) {
        if (type && refusedQuery(oo, sw)) await markNoMarket(sw);
        else net += 1;
        continue;
      }
      for (const x of oo.list) if (x && keep(x) && !list.some((y) => String(y.order_id) === String(x.order_id))) list.push(x);
    }
    return { list, net };
  }
  const seenIn = (list, coid, id) => list.some((x) => (!!id && String(x.order_id) === String(id)) || (!!coid && x.custom_order_id === coid));
  async function insOf(inst) {
    const items = await e.instruments();
    return (Array.isArray(items) ? items : []).find((x) => x && x.inst === inst) || null;
  }

  // 원하는 자동 손절(발동가는 메모리에서만): { liq, src, trigger, g, qty, amount, mark, tick, step } | { skip }
  function want(t, pos, ins) {
    const dir = dirOf(t.side);
    const avg = pos.avg ?? t.avg;
    const L = liqOf({ dir, avg, lev: t.lev, liquidPrice: pos.liq });
    if (!L) return { skip: 'auto_sl_no_room' };
    const tr = autoSlTrigger({ dir, avg, liq: L.liq, src: L.src, gapPct: cfg.liqGapPct, tick: ins.tick });
    if (tr.skip) return tr;
    const qty = Math.abs(pos.size);
    const mk = e.markOf(t.inst);
    return { dir, liq: L.liq, src: L.src, trigger: tr.trigger, g: autoSlGap(L.src, cfg.liqGapPct), qty, amount: numStr(qty, ins.step), mark: mk ?? pos.mark ?? null, tick: ins.tick, step: ins.step };
  }
  const matchOf = (w) => ({ qty: w.qty, trigger: w.trigger, liq: w.liq, g: w.g, step: w.step });

  // ── 맞추기(§2.6): 판정 → 취소 / 그대로 / 건다 ──
  async function ensure(id, { pos: given, sw: givenSw } = {}) {
    if (!e.reduceOk()) return null;
    const sw = givenSw || (await e.sw.read());
    let t = await e.refresh(id);
    if (!t || !SL_LIVE.includes(t.state)) return t;
    let pos = given;
    if (pos === undefined) {
      const p = await e.exec.positionOf(t.inst);
      if (!p.ok) return t;
      pos = p.pos;
    }
    const gone = !pos || !(Math.abs(Number(pos.size)) > 0);
    const due = autoSlDue(t.sigStage, cfg.afterStage);
    const v = autoSlVerdict({ on: sw.on, gone, state: t.state, due });
    if (v === 'cancel') return cancelFor(t, { final: gone ? 'done' : 'off', sw });
    if (v === 'keep') {
      if (t.state === 'unclear' && sw.on && due && pos) await guard(t, pos);
      return t;
    }
    // 회원이 바꾼 포지션(방향 다름·수량 ±5% 밖)이면 걸기·교체·바로 정리를 하지 않는다 — detached 판정·기록은 엔진·정리 주기가(§2.8, 검토 고침 1)
    if (!ownsPosition(t, pos)) return t;
    // 교체 도중 앱이 꺼져 새 것이 걸린 채(set) 옛 것이 남았으면 이제 옛 것을 취소(§2.6-6 — 새 것이 보인 뒤)
    if (slOf(t).state === 'set' && slOf(t).prevCoid) t = await settlePrev(t, sw);
    const ins = await insOf(t.inst);
    if (!ins) return t;
    const w = want(t, pos, ins);
    const s = slOf(t);
    if (w.skip) {
      if (s.state !== 'failed' || lastNote(t) !== w.skip) {
        t = addNote(withSl(t, { state: 'failed', at: now() }), w.skip);
        await e.save(t);
      }
      return t;
    }
    if (s.state === 'set') return verify(t, pos, w, sw);
    if (s.state === 'sending' || s.state === 'unclear') return resolveUnknown(t, pos, w, sw);
    if (s.state === 'failed') {
      if (now() - (s.at || 0) < AUTO_SL.retryFailedMs) {
        await guard(t, pos, w);
        return t;
      }
      t = withSl(t, { rejects: 0 });
    }
    // 걸기 직전 — 표시가가 이미 발동가를 지났으면 조건 주문 대신 바로 정리(§2.4, [대표 확인] 3)
    if (autoSlPassed({ dir: w.dir, trigger: w.trigger, mark: w.mark })) return closeNowSl(t, pos, ins);
    return (await placeNew(t, w, sw)).t;
  }

  // 새로 건다 — 목록에 'sending'을 저장한 뒤 호출(그 사이 앱이 꺼져도 다음에 식별자로 확인). replacing이면 자동 교체(새 것 먼저)
  async function placeNew(t0, w, sw, { replacing = false } = {}) {
    let t = t0;
    const s = slOf(t);
    const entries = await e.orders.list();
    const oo = await e.exec.openOrders(t.inst, { type: sw.listedType });
    // 미체결 조회를 못 하면 이미 걸린 것이 있는지 모른다 — 이번에는 걸지 않고 다음 주기에(중복 STOP을 만들지 않게)
    if (!oo.ok) return { t, ok: false };
    const live = oo.list.filter((x) => isAutoSlCoid(x.custom_order_id, t.id));
    // 다른 기기(같은 매매가 두 장부에 든 드문 경우)가 이미 건 것이 있으면 새로 걸지 않고 그것을 쓴다(§2.7)
    if (!replacing && live.length) {
      const { keep, cancel } = dedupeKeep(live, matchOf(w));
      for (const x of cancel) await e.exec.cancelOrder(x.order_id);
      if (!entries.some((x) => x.coid === keep.custom_order_id)) await e.orders.add({ inst: t.inst, coid: keep.custom_order_id, orderId: String(keep.order_id), owner, tradeId: t.id, state: 'live', sendAt: now(), at: now() });
      t = withSl(t, { state: 'set', k: autoSlKOf(keep.custom_order_id) || s.k, coid: keep.custom_order_id, orderId: String(keep.order_id), liqSrc: w.src, at: now(), rejects: 0 });
      await e.save(t);
      return { t, ok: true };
    }
    const k = nextK([s.k, ...entries.filter((x) => x.tradeId === t.id).map((x) => autoSlKOf(x.coid)), ...live.map((x) => autoSlKOf(x.custom_order_id))]);
    const coid = k == null ? null : coidFor(t.id, `g${k}`);
    const added = coid ? await e.orders.add({ inst: t.inst, coid, orderId: null, owner, tradeId: t.id, state: 'sending', sendAt: now(), at: now() }) : false;
    if (!added) {
      t = addNote(withSl(t, { state: 'failed', at: now() }), 'auto_sl_failed');
      await e.save(t);
      return { t, ok: false };
    }
    const prev = s.state;
    t = withSl(t, { state: 'sending', k, coid, orderId: null, liqSrc: w.src, sendAt: now(), at: now(), rawState: null });
    await e.save(t);
    const r = await e.exec.placeAutoSl({ trade: t, k, amount: w.amount, trigger: w.trigger, tick: w.tick });
    if (r.ok) {
      await e.orders.patch(coid, { orderId: r.orderId, state: 'live' });
      t = withSl(t, { state: 'set', orderId: r.orderId, rejects: 0, at: now() });
      if (!replacing && prev !== 'set') t = addNote(t, 'auto_sl_set');
      if (w.src === 'estimate' && !replacing) t = addNote(t, 'liq_estimated');
      await e.save(t);
      await afterPlaced(t, r.orderId, sw, w);
      return { t, ok: true };
    }
    if (r.sent === false) {
      await e.orders.remove([coid]);
      if (r.kind === 'ox') {
        const rejects = slOf(t0).rejects + 1;
        t = withSl(t, { state: rejects >= AUTO_SL.rejectsMax ? 'failed' : 'none', rejects, coid: s.coid, orderId: s.orderId, at: now() });
        if (rejects >= AUTO_SL.rejectsMax) t = addNote(t, 'auto_sl_failed');
      } else {
        t = withSl(t, { state: replacing ? 'set' : prev === 'failed' ? 'failed' : 'none', coid: s.coid, orderId: s.orderId, k: s.k });
      }
      await e.save(t);
      return { t, ok: false, rejected: r.kind === 'ox' };
    }
    return { t: await resolveUnknown(t, null, w, sw), ok: false };
  }

  // 걸린 뒤: 미체결 조회에 보이면 listed(이 기기에서 조건 주문이 목록에 보임 — 결과 모름 뒤 60초 규칙), 시험 토큰이면 진단 줄(가격 없음).
  // p35 F-5: type market 조회도 모든 기기에서(배울 때까지만 — 걸 때 GET 한 번 더). 배운 뒤에는 실제 토큰은 조회하지 않는다
  async function afterPlaced(t, orderId, sw, w) {
    const test = e.isTest();
    if (sw.listed && !test) return;
    const vis = (o) => o.ok && o.list.some((x) => String(x.order_id) === String(orderId));
    const plain = await e.exec.openOrders(t.inst);
    let market = null;
    if (test || (!sw.listed && !vis(plain))) market = await e.exec.openOrders(t.inst, { type: 'market' });
    if (test) {
      const st = await e.exec.orderState(orderId);
      e.setDiag({ listed: plain.ok ? vis(plain) : null, listedMarket: market.ok ? vis(market) : null, src: w.src, raw: st.ok ? String(st.order.order_state ?? '') : null });
    }
    if (!sw.listed) {
      if (vis(plain)) await e.sw.markListed(null);
      else if (market && vis(market)) await e.sw.markListed('market');
      else if (market && !market.ok && refusedQuery(market, sw)) await markNoMarket(sw);
    }
  }

  // 결과 모름(sending·unclear): 식별자로 찾는다 — 있으면 set, 거래소가 지운 것이면 다시(k+1), 없으면 listed 기기에서 60초 뒤 다시·아니면 unclear(다시 보내지 않음)
  async function resolveUnknown(t0, pos, w, sw) {
    let t = t0;
    const s = slOf(t);
    if (!s.coid) {
      t = withSl(t, { state: 'none' });
      await e.save(t);
      return t;
    }
    let f = await e.exec.findByCoid(t.inst, s.coid, { type: sw.listedType });
    if (!f.ok) return t;
    // 아직 배우지 않은 기기(p35 F-5 남은 갈래): 일반 조회·기록에 없으면 type market 조회까지 — 거기에만 보이면 listedType market을 배운다
    // (조건 주문이 type market 조회에만 보이는 거래소 U-A2에서 첫 STOP 결과 모름이 영영 '확인 중'으로 남지 않게)
    // 없음·일시 실패는 아래 '모름' 갈래 그대로(unclear·보조 감시 — listed 기기가 아니므로 60초 규칙은 쓰지 않음)
    if (!f.order && !sw.listed && !sw.noMarket) {
      const m = await e.exec.findByCoid(t.inst, s.coid, { type: 'market' });
      if (m.ok && m.order) {
        f = m;
        await e.sw.markListed('market');
      } else if (!m.ok && refusedQuery(m, sw)) await markNoMarket(sw);
    }
    if (f.order) {
      const st = String(f.order.order_state ?? '').toLowerCase();
      const id = String(f.order.order_id);
      if (st === 'cancelled' || st === 'canceled' || st === 'rejected') {
        if (!(Number(f.order.filled_amount) > 0)) {
          await e.orders.remove([s.coid]);
          // 교체 중이었으면 지켜 둔 옛 주문이 다시 현재(맞지 않으면 다음 확인에서 교체), 아니면 처음부터
          t = s.prevCoid ? backToPrev(t) : withSl(t, { state: 'none', orderId: id });
          await e.save(t);
          return t;
        }
      }
      await e.orders.patch(s.coid, { orderId: id, state: 'live' });
      t = withSl(t, { state: 'set', orderId: id, rejects: 0, at: now() });
      if (s.state === 'sending' && !s.prevCoid && lastNote(t) !== 'auto_sl_set') t = addNote(t, 'auto_sl_set');
      await e.save(t);
      // 새 것이 보였다 — 이제 옛 것을 취소(§2.6-6 새 것 먼저)
      if (s.prevCoid) t = await settlePrev(t, sw);
      return t;
    }
    if (sw.listed && Number.isFinite(s.sendAt) && now() - s.sendAt >= AUTO_SL.unclearMs) {
      await e.orders.remove([s.coid]);
      if (s.prevCoid) {
        // 안 나간 것으로 확정 — 지켜 둔 옛 주문이 다시 현재. 교체는 다음 확인에서(그 사이 보호 0건이 되지 않음)
        t = backToPrev(t);
        await e.save(t);
        return t;
      }
      t = withSl(t, { state: 'none' });
      await e.save(t);
      return w ? (await placeNew(t, w, sw)).t : t;
    }
    if (s.state !== 'unclear') {
      t = addNote(withSl(t, { state: 'unclear', at: now() }), 'auto_sl_unclear');
      await e.save(t);
    }
    if (pos) await guard(t, pos, w);
    return t;
  }

  // 걸린 것 확인(§2.6-4 set): 미체결에서 번호·식별자로 찾고(둘 이상이면 중복 정리), 없으면 주문 상태로
  async function verify(t0, pos, w, sw) {
    let t = t0;
    const s = slOf(t);
    const oo = await e.exec.openOrders(t.inst, { type: sw.listedType });
    if (!oo.ok) return t;
    const mine = oo.list.filter((x) => isAutoSlCoid(x.custom_order_id, t.id));
    let order = null;
    if (mine.length > 1) {
      const { keep, cancel } = dedupeKeep(mine, matchOf(w));
      for (const x of cancel) await e.exec.cancelOrder(x.order_id); // 목록의 그 항목은 목록 정리가 끝 확인 뒤 지운다
      order = keep;
      if (String(keep.order_id) !== String(s.orderId)) {
        const list = await e.orders.list();
        if (!list.some((x) => x.coid === keep.custom_order_id)) await e.orders.add({ inst: t.inst, coid: keep.custom_order_id, orderId: String(keep.order_id), owner, tradeId: t.id, state: 'live', sendAt: now(), at: now() });
        t = withSl(t, { orderId: String(keep.order_id), coid: keep.custom_order_id, k: autoSlKOf(keep.custom_order_id) || s.k });
        await e.save(t);
      }
    } else {
      order = mine.find((x) => String(x.order_id) === String(s.orderId) || x.custom_order_id === s.coid) || null;
    }
    if (order) {
      if (!sw.listed) await e.sw.markListed(sw.listedType);
      // 맞으면 그대로 — 단 계산값으로 건 것은 거래소 청산가가 오면 바꾼다(거리 2배 → 1배, §2.4·§2.6-7 자동 교체)
      if (autoSlMatches(order, matchOf(w)) && !(slOf(t).liqSrc === 'estimate' && w.src === 'exchange')) return t;
      return replace(t, w, sw, order);
    }
    if (!s.orderId) return resolveUnknown(t, pos, w, sw);
    const st = await e.exec.orderState(s.orderId);
    if (!st.ok) return t;
    if (st.state === 'filled' || st.state === 'partial') return t; // 발동 — 정리 주기의 포지션 판정이 맡는다(§2.8)
    if (st.state === 'failed') {
      // 거래소가 지움(취소·거절, 살아 있는 보호 없음) → 목록에서 지우고 다시(k+1, 횟수에 안 셈)
      await e.orders.remove([s.coid]);
      t = withSl(t, { state: 'none' });
      await e.save(t);
      return (await placeNew(t, w, sw)).t;
    }
    if (st.state === 'open') {
      if (autoSlMatches(st.order, matchOf(w)) && !(slOf(t).liqSrc === 'estimate' && w.src === 'exchange')) return t;
      return replace(t, w, sw, st.order);
    }
    // 모르는 order_state(발동 전 STOP이 어떤 값으로 오는지 문서에 없음 — U-A8) — 다시 걸지 않는다. 목록에 안 보이니 unclear + 원문(가격 없음)
    const raw = String(st.order.order_state ?? '').slice(0, 24);
    t = withSl(t, { state: 'unclear', rawState: /^[A-Za-z_]{1,24}$/.test(raw) ? raw : null, at: now() });
    if (lastNote(t) !== 'auto_sl_unclear') t = addNote(t, 'auto_sl_unclear');
    await e.save(t);
    return t;
  }

  // 자동 교체(§2.6-6·7): 한도(10분 2번·하루 10번) 안에서만, 새 것 먼저 → 걸리면 옛 것 취소·끝 확인. 거래소가 둘을 받지 않으면(U-A7) 옛 것 먼저
  async function replace(t0, w, sw, old) {
    let t = t0;
    const s = slOf(t);
    if (!syncAllowed(s.syncs, now())) {
      if (lastNote(t) !== 'auto_sl_stale') {
        t = addNote(t, 'auto_sl_stale');
        await e.save(t);
      }
      return t;
    }
    const oldEntry = { inst: t.inst, coid: String(old.custom_order_id || s.coid), orderId: String(old.order_id), owner, tradeId: t.id, state: 'live', sendAt: s.sendAt, at: s.at };
    // 옛 주문을 prev로 지킨다 — 새 것의 결과를 모르는 동안 목록 정리가 '살아 있지 않음'으로 보고 취소하지 않게(검토 고침 3)
    t = withSl(t, { syncs: [...(s.syncs || []).filter((x) => now() - x < 86400000), now()], prevCoid: oldEntry.coid, prevOrderId: oldEntry.orderId, prevLiqSrc: s.liqSrc });
    await e.save(t);
    const r = await placeNew(t, w, sw, { replacing: true });
    if (r.ok) {
      const c = await cancelEntry(oldEntry, e.exec.ops, optOf(sw));
      if (c.done) await e.orders.remove([oldEntry.coid]);
      return dropPrev(r.t); // 끝 확인이 안 됐으면 항목이 남아 목록 정리가 다시 취소
    }
    if (r.rejected) {
      const c = await cancelEntry(oldEntry, e.exec.ops, optOf(sw));
      if (!c.done) return dropPrev(r.t);
      await e.orders.remove([oldEntry.coid]);
      return (await placeNew(withSl(r.t, { state: 'none', ...NO_PREV }), w, sw, { replacing: true })).t;
    }
    // 안 나간 것이 확실(옛 것이 그대로 현재)이면 prev를 비우고, 결과 모름이면 새 것이 보이거나 안 나간 것이 확정될 때까지 prev를 지킨다
    if (slOf(r.t).coid === oldEntry.coid) return dropPrev(r.t);
    return r.t;
  }
  // 지켜 둔 옛 주문(prev)이 다시 현재 — 상태 set(다음 확인에서 맞는지 보고 교체). k는 그대로(쓴 번호를 다시 쓰지 않음)
  function backToPrev(t) {
    const s = slOf(t);
    return withSl(t, { state: 'set', coid: s.prevCoid, orderId: s.prevOrderId, liqSrc: s.prevLiqSrc, ...NO_PREV, sendAt: null, at: now() });
  }
  async function dropPrev(t0) {
    if (!slOf(t0).prevCoid) return t0;
    const t = withSl(t0, NO_PREV);
    await e.save(t);
    return t;
  }
  // 새 것이 보인 뒤 옛 것 취소·끝 확인 → 목록에서 지움(실패해도 prev는 비운다 — 살아 있지 않은 항목이라 목록 정리가 다시 취소)
  async function settlePrev(t0, sw) {
    const s = slOf(t0);
    if (!s.prevCoid) return t0;
    if (s.prevCoid !== s.coid) {
      const c = await cancelEntry({ inst: t0.inst, coid: s.prevCoid, orderId: s.prevOrderId, owner, tradeId: t0.id, state: 'live', sendAt: null, at: null }, e.exec.ops, optOf(sw));
      if (c.done) await e.orders.remove([s.prevCoid]);
    }
    return dropPrev(t0);
  }

  // 이 매매의 자동 손절 모두 취소 → 끝 확인(p35 §5.3 고침 1): 목록 항목 ∪ 장부 번호(autoSl.orderId·prevOrderId — 목록에 없으면 목록에
  // 넣지 않고 바로, 목록이 100건이면 넣지 못하므로 기대지 않음) ∪ 미체결(일반 + type market)의 ptf.<id>.g*. 끝난 목록 항목은 지운다.
  // 결과: { any(이번에 취소를 보냄·항목을 지움), open(거래소가 open이라 답함·미체결에 보임), net(조회 실패), soft(번호 모름·모르는 상태·상태 조회 오류
  // — 미체결에도 안 보임), softCoids(그 목록 항목) }
  // p35 검토 1: '시도함'은 실제로 cancelEntry를 부른 식별자·번호만 적는다(건너뛴 옛 식별자를 적으면 미체결 훑기가 그 식별자의 살아 있는 STOP을 건너뜀).
  // 미체결 훑기는 번호로만 가린다(같은 식별자·다른 번호 — 같은 UID 두 기기가 같은 k로 건 STOP도 취소). 끝을 모르는 것이 미체결에 보이면 살아 있음(open)
  async function cancelTargets(t, sw) {
    const s = slOf(t);
    const out = { any: false, open: 0, net: 0, soft: 0, softCoids: [] };
    const opt = optOf(sw);
    const ids = new Set();
    const coids = new Set();
    const tried = (coid, id) => {
      if (coid) coids.add(coid);
      if (id) ids.add(String(id));
    };
    const softs = [];
    const tally = (c, coid, id, entry) => {
      if (c.done) return;
      if (c.why === 'open') out.open += 1;
      else if (c.why === 'net') out.net += 1;
      else softs.push({ coid, id: id || c.foundId || null, entry });
    };
    for (const x of (await e.orders.list()).filter((y) => y.tradeId === t.id)) {
      const c = await cancelEntry(x, e.exec.ops, opt);
      tried(x.coid, x.orderId || c.foundId);
      if (c.done) {
        await e.orders.remove([x.coid]);
        out.any = true;
      } else tally(c, x.coid, x.orderId, true);
    }
    for (const [coid, id] of [[s.coid, s.orderId], [s.prevCoid, s.prevOrderId]]) {
      if (!coid && !id) continue;
      if (id ? ids.has(String(id)) : coids.has(coid)) continue;
      // 번호를 모르는 식별자는 보내다 결과를 모른 것(sending·unclear)일 때만 찾는다 — 그 밖은 안 나간 것이 확실한 옛 식별자.
      // 찾지 않았으니 '시도함'으로 적지 않는다 — 그 식별자의 STOP이 거래소에 살아 있으면 아래 미체결 훑기가 취소
      if (!id && !['sending', 'unclear'].includes(s.state)) continue;
      const c = await cancelEntry({ inst: t.inst, coid: coid || `ptf.${t.id}.g0`, orderId: id ? String(id) : null, owner, tradeId: t.id, state: id ? 'live' : 'sending', sendAt: s.sendAt, at: s.at }, e.exec.ops, opt);
      tried(coid, id || c.foundId);
      if (c.cancelled) out.any = true;
      tally(c, coid, id, false);
    }
    // 미체결(일반 + type market)의 이 매매 STOP 가운데 위에서 시도하지 않은 번호
    const live = await openListed(t.inst, sw, (x) => isAutoSlCoid(x.custom_order_id, t.id));
    out.net += live.net;
    const ended = new Set();
    for (const x of live.list) {
      const xid = String(x.order_id);
      if (ids.has(xid)) continue;
      ids.add(xid);
      const c = await cancelEntry({ inst: t.inst, coid: x.custom_order_id, orderId: xid, owner, tradeId: t.id, state: 'live', sendAt: null, at: null }, e.exec.ops, opt);
      out.any = true;
      if (c.done) ended.add(xid);
      else if (c.why === 'net') out.net += 1;
      else out.open += 1; // 미체결에 보인 STOP — 끝 확인 전이면 살아 있는 것
    }
    // 끝을 모르는 것 가운데 지금 미체결에 보이는(이번에 끝 확인되지 않은) 것은 '모름'이 아니라 살아 있음
    const alive = live.list.filter((x) => !ended.has(String(x.order_id)));
    for (const x of softs) {
      if (seenIn(alive, x.coid, x.id)) out.open += 1;
      else {
        out.soft += 1;
        if (x.entry) out.softCoids.push(x.coid);
      }
    }
    return out;
  }

  // 취소(§2.2-5·§2.6-1): cancelTargets → 다 끝났을 때만 상태를 off·done으로. 하나라도 끝 확인이 안 되면 autoSl을 그대로 둔다 —
  // 매매가 이미 끝났으면 '정리 미완'(slCleanupPending)으로 남아 정리·가벼운 주기가 다시(cleanup), 그 종목 새 진입은 막힘(checkEntry)
  async function cancelFor(t0, { final, sw }) {
    let t = t0;
    const s = slOf(t);
    const r = await cancelTargets(t, sw);
    const all = r.open + r.net + r.soft === 0;
    const any = r.any;
    if (all && s.state !== final && !(final === 'off' && s.state === 'none' && !any)) {
      t = withSl(t, { state: final, at: now(), ...NO_PREV });
      if (final === 'off' && (any || ['set', 'sending', 'unclear'].includes(s.state))) t = addNote(t, 'auto_sl_off');
      await e.save(t);
    } else if (all && s.prevCoid) t = await dropPrev(t);
    return t;
  }

  // 보조 감시(§2.11): failed·unclear·sending인 동안 표시가가 원하는 발동가를 지났으면 정리(auto_sl_now). 표시가가 없으면 하지 않음.
  // 회원이 바꾼 포지션이면 하지 않는다(그 포지션을 닫지 않게, 검토 고침 1)
  async function guard(t, pos, w0 = null) {
    const s = slOf(t);
    if (!WATCH.includes(s.state) || !pos || !ownsPosition(t, pos)) return;
    const ins = await insOf(t.inst);
    if (!ins) return;
    const w = w0 || want(t, pos, ins);
    if (w.skip) return;
    if (autoSlPassed({ dir: w.dir, trigger: w.trigger, mark: w.mark })) await closeNowSl(t, pos, ins);
  }

  // 바로 정리(auto_sl_now) — close_position(시장가 전량 = 지금 거래소 포지션, 위험을 줄임) → exit·USDT → 남은 자동 손절 취소.
  // 결과 모름(unclear) 매매는 장부 수량이 옛 값일 수 있어 지금 포지션 수량으로(회원 변경으로 빼지 않게)
  async function closeNowSl(t0, pos, ins) {
    const r = await e.exec.closeTrade({ ...t0, size: Math.abs(pos.size), state: 'closing' }, { step: ins ? ins.step : 0.001 });
    let t = r.trade;
    if (r.done) {
      t = { ...t, reason: 'auto_sl_now', exit: t.exit ? { ...t.exit, via: 'auto_sl_now' } : null };
      await e.save(t);
      await cancelFor(t, { final: 'done', sw: await e.sw.read() });
      return (await e.refresh(t.id)) || t;
    }
    // 정리하지 못함(p35 F-3) — 원래 상태(결과 모름 unclear·보조 감시)와 장부 수량을 그대로 두고 사유 기록만 더한다. 지금 거래소 수량으로
    // 덮으면 회원이 바꾼 수량을 '내 것'으로 보게 되고, unclear를 open으로 바꾸면 결과 모름 표시·보조 감시가 조용히 사라진다.
    // 거래소 포지션이 회원 변경으로 판정됐으면(detached) 그것만 따른다
    t = { ...t0, notes: Array.isArray(r.trade.notes) ? r.trade.notes : t0.notes, state: r.trade.state === 'detached' ? 'detached' : t0.state };
    await e.save(t);
    return t;
  }

  // 포지션이 없어진 매매(§2.8): 자동 손절 체결부터(사유 auto_sl), 아니면 기록에서 정리 체결 → closed → 남은 항목 취소(실패해도 목록에 남아 다음에)
  async function closeGone(t0, sw = null) {
    const g = await e.exec.goneExit(t0);
    let t = e.exec.withExit(t0, g.exit);
    t = { ...t, state: 'closed', closedAt: now(), reason: g.reason || t0.reason || 'gone' };
    await e.save(t);
    await cancelFor(t, { final: 'done', sw: sw || (await e.sw.read()) });
    return (await e.refresh(t.id)) || t;
  }

  // 자동 손절이 일부만 체결돼 포지션이 남음 → 남은 수량을 정리(사유 auto_sl) — 크기가 달라 detached로 잘못 빠지지 않게(§2.8 첫 줄)
  async function settlePartial(t0, pos) {
    const s = slOf(t0);
    if (!s.orderId || !pos) return null;
    const st = await e.exec.orderState(s.orderId);
    const fq = st.ok ? Number(st.order.filled_amount) : 0;
    const fp = st.ok ? Number(st.order.average_price) : 0;
    if (!st.ok || !(st.state === 'filled' || st.state === 'partial') || !(fq > 0) || !(fp > 0)) return null;
    const ins = await insOf(t0.inst);
    const rest = { ...t0, size: Math.abs(pos.size), state: 'closing' };
    const r = await e.exec.closeTrade(rest, { step: ins ? ins.step : 0.001 });
    if (!r.done) {
      await e.save(r.trade.state === 'closing' ? { ...r.trade, state: 'open' } : r.trade);
      return r.trade;
    }
    const q2 = r.trade.exit ? r.trade.exit.qty : 0;
    const p2 = r.trade.exit ? r.trade.exit.price : 0;
    const exit = q2 > 0 ? { price: (fq * fp + q2 * p2) / (fq + q2), qty: Number((fq + q2).toFixed(8)), via: 'auto_sl', at: now() } : { price: fp, qty: fq, via: 'auto_sl', at: now() };
    let t = e.exec.withExit({ ...t0 }, exit);
    t = { ...t, state: 'closed', closedAt: now(), reason: 'auto_sl' };
    await e.save(t);
    await cancelFor(t, { final: 'done', sw: await e.sw.read() });
    return t;
  }

  // 새 진입 전 확인(§2.7) — openTrade가 포지션 없음·회원 주문 없음을 본 뒤에만 부른다(follow-exec). 결과: true(진입) / false(auto_sl_check) /
  // 'has_position'·'error'(그 사유로 건너뜀). 무엇이든 취소하기 전에 포지션을 새로 본다 — 있으면 살아 있는 포지션의 자동 손절이라
  // 아무것도 건드리지 않는다(검토 고침 2·4). 없을 때만: 같은 종목 열린 매매는 끝난 것(자동 손절 체결부터 보고 닫고 항목 취소) →
  // 그 종목 목록 항목 모두 끝 확인(원웨이 포지션 하나라 남은 STOP은 어느 주인 것이든 새 포지션을 닫는다)
  // p35: 끝난 매매의 자동 손절 정리 미완(장부 번호로 다시 취소·끝 확인) 매매도 본다 — 목록에 없는 번호의 STOP이 새 포지션을 닫지 않게
  async function checkEntry(inst, trades) {
    const sw = await e.sw.read();
    const mine = trades.filter((x) => x && x.inst === inst);
    const live = mine.filter((x) => SL_LIVE.includes(x.state));
    const listed = (await e.orders.list()).some((x) => x.inst === inst);
    if (!live.length && !listed && !mine.some(slCleanupPending)) {
      e.markCheck(inst, false);
      return true;
    }
    const p = await e.exec.positionOf(inst, { fresh: true });
    if (!p.ok) return 'error';
    if (p.pos) return 'has_position';
    // 포지션이 없음을 캐시 없이 확인 — 장부에 살아 있는 매매(열림·결과 모름·회원 변경)는 끝난 것(자동 손절 체결부터 보고 닫고 취소)
    for (const x of live) {
      const cur = (await e.refresh(x.id)) || x;
      if (SL_LIVE.includes(cur.state)) await closeGone(cur, sw);
    }
    let ok = await checkBeforeEntry(inst, { orders: e.orders, ops: e.exec.ops, ...optOf(sw) });
    // 정리 미완이거나 방금 위에서 닫은 매매만 다시 읽는다(끝 확인이 끝난 줄 — 건너뜀 줄 수백 개 — 을 하나하나 읽지 않게)
    for (const x of mine.filter((y) => slCleanupPending(y) || SL_LIVE.includes(y.state))) {
      const cur = await cleanup(x.id, sw);
      if (slCleanupPending(cur)) ok = false;
    }
    e.markCheck(inst, !ok);
    return ok;
  }

  // 정리 미완 매매 하나 — 큐 안에서(정리 주기·가벼운 주기·새 진입 전 확인). 위험을 줄이는 호출만
  async function cleanup(id, sw = null) {
    const t = await e.refresh(id);
    if (!slCleanupPending(t) || !e.reduceOk()) return t;
    return cancelFor(t, { final: 'done', sw: sw || (await e.sw.read()) });
  }

  // '확인했습니다'(p35 §5.3 고침 2) — 엔진이 탭 잠금을 쥐고 그 종목 큐 안에서 부른다. 포지션부터 캐시 없이: 조회 실패 → 아무것도 안 함('error'),
  // 포지션 있음 → 아무것도 취소·삭제하지 않음('has_position' — 살아 있는 포지션의 보호 STOP을 지우지 않게). 포지션 없음일 때만, 그 종목 목록 항목
  // (주인과 상관없이 — 원웨이 포지션 하나라 남은 STOP은 어느 주인 것이든 새 포지션을 닫음)과 정리 미완 매매의 장부 번호를 한 번 더 취소·끝 확인:
  // 끝 → 지움, 거래소가 open이라 답함 → 남김('still_open'), 번호 모름·모르는 상태·상태 조회에 거래소가 오류로 답함(p35 검토 4 — 거래소가 모르는 번호)
  // → 회원 확인으로 지움. 단 그 번호·식별자가 거래소 미체결(일반 + type market)에 보이면 '모름'이 아니라 살아 있음 → 남김('still_open'),
  // 미체결을 보지 못하면 지우지 않음('error'). 조회 실패가 남으면 'error'
  async function confirmInst(inst, trades) {
    const sw = await e.sw.read();
    const p = await e.exec.positionOf(inst, { fresh: true });
    if (!p.ok) return { ok: false, reason: 'error' };
    if (p.pos) return { ok: false, reason: 'has_position' };
    let open = 0;
    let net = 0;
    const opt = optOf(sw);
    const soft = [];
    for (const x of (await e.orders.list()).filter((y) => y.inst === inst)) {
      const c = await cancelEntry(x, e.exec.ops, opt);
      if (c.done) await e.orders.remove([x.coid]);
      else if (c.why === 'open') open += 1;
      else if (c.why === 'net') net += 1;
      else soft.push({ coid: x.coid, id: x.orderId || c.foundId || null });
    }
    if (soft.length) {
      const live = await openListed(inst, sw, (x) => typeof x.custom_order_id === 'string' && x.custom_order_id.startsWith('ptf.'));
      for (const x of soft) {
        if (live.net) net += 1;
        else if (seenIn(live.list, x.coid, x.id)) open += 1;
        else await e.orders.remove([x.coid]);
      }
    }
    for (const x of trades.filter((y) => y && y.inst === inst && (slCleanupPending(y) || SL_LIVE.includes(y.state)))) {
      let cur = await e.refresh(x.id);
      if (!slCleanupPending(cur)) continue;
      const r = await cancelTargets(cur, sw);
      if (r.softCoids.length) await e.orders.remove(r.softCoids);
      if (r.open + r.net === 0) {
        cur = withSl(cur, { state: 'done', at: now(), ...NO_PREV });
        await e.save(cur);
      } else {
        open += r.open;
        net += r.net;
      }
    }
    if (open) return { ok: false, reason: 'still_open' };
    if (net) return { ok: false, reason: 'error' };
    e.markCheck(inst, false);
    return { ok: true };
  }

  // 목록 정리(§2.7): 주인이 살아 있지 않은 항목 — 끝난 매매·장부에 없는 매매·교체로 남은 옛 주문. 이 keeper의 주인(owner) 항목만 본다 —
  // 다른 주인(따라가기 f ↔ 트레이딩 탭 m) 항목은 그쪽 장부가 정한다(이 장부에 없다고 남의 살아 있는 STOP을 취소하지 않게, p40).
  // 스위치 OFF면 자기 주인 항목은 모두 살아 있지 않음(취소).
  // 교체(새 것 먼저) 중 새 것의 결과를 모르는 동안 지키는 옛 주문(prevCoid)도 살아 있는 것으로 본다(검토 고침 3)
  // p35 F-2: 종목마다 그 종목 큐 안에서(e.enqueue — 같은 종목의 걸기·교체와 겹치지 않게), 항목마다 장부를 큐 안에서 다시 읽고 판단한다
  // (처음에 찍은 장부 사본으로 판단하면 큐 안에서 막 건 STOP을 '주인 없음'으로 취소한다). 종목 큐 안에서 부르지 않는다(자기 큐를 기다림)
  async function sweep(sw = null) {
    const s = sw || (await e.sw.read());
    const insts = [...new Set((await e.orders.list()).filter((x) => x.owner === owner).map((x) => x.inst))];
    let n = 0;
    for (const inst of insts) await e.enqueue(inst.split('-')[0], async () => { n += await sweepInst(inst, s); });
    return n;
  }
  async function sweepInst(inst, s) {
    let n = 0;
    for (const x of (await e.orders.list()).filter((y) => y.inst === inst && y.owner === owner)) {
      const t = await e.refresh(x.tradeId);
      const a = slOf(t);
      if (t && SL_LIVE.includes(t.state) && (a.coid === x.coid || (a.prevCoid != null && a.prevCoid === x.coid)) && s.on) continue;
      const c = await cancelEntry(x, e.exec.ops, optOf(s));
      if (c.done) {
        await e.orders.remove([x.coid]);
        n += 1;
      }
    }
    return n;
  }
  // 스위치 OFF: 목록의 모든 항목(두 장부)을 취소·끝 확인(§2.2-5) — 따라가기(f) 항목은 ensure·목록 정리가 맡으니 여기서는 트레이딩 탭(m) 등 남은 것.
  // owner와 상관없이 늘 'f' 아닌 항목 — 따라가기 keeper(엔진)만 부른다. 수동(owner m) keeper는 부르지 않는다(자기 항목은 ensure·목록 정리가, p40)
  async function cancelRest(sw) {
    for (const x of await e.orders.list()) {
      if (x.owner === 'f') continue;
      const c = await cancelEntry(x, e.exec.ops, optOf(sw));
      if (c.done) await e.orders.remove([x.coid]);
    }
  }

  // '다시 걸기'(결과 모름·걸지 못함, §2.7) — 회원이 오렌지엑스 앱에서 이 앱의 자동 손절이 없음을 본 뒤. 그 매매의 번호 모르는 항목을 지우고 처음부터
  async function retry(id) {
    let t = await e.refresh(id);
    if (!t || !SL_LIVE.includes(t.state)) return t;
    const s = slOf(t);
    if (!['unclear', 'failed', 'sending'].includes(s.state)) return t;
    const drop = (await e.orders.list()).filter((x) => x.tradeId === t.id && !x.orderId).map((x) => x.coid);
    if (drop.length) await e.orders.remove(drop);
    // 교체 중 결과 모름이었으면 지켜 둔 옛 주문으로 돌아가 다시 확인(맞지 않으면 새 것 먼저 교체), 아니면 처음부터
    t = s.prevCoid ? withSl(backToPrev(t), { rejects: 0 }) : withSl(t, { state: 'none', rejects: 0, at: now() });
    await e.save(t);
    return ensure(id);
  }

  return { ensure, cancelFor, closeGone, settlePartial, checkEntry, cleanup, confirmInst, sweep, cancelRest, retry, guard };
}
