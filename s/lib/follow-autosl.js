// 따라가기 자동 손절 맞추기(p34 설계 §2.3~§2.13) — 엔진·정리 주기·가벼운 주기가 부른다(종목 큐 안, 탭 잠금을 쥔 탭, 위험을 줄이는 조건 gateReduce일 때만).
// 판정은 auto-sl.js(공용 순수 함수), 기기 주문 목록은 auto-sl-orders.js, 거래소 호출은 follow-exec.js. 여기서는 순서만 정한다.
// - 매번 첫 줄에서 스위치(kv.autoSl)를 저장소에서 다시 읽는다(메모리 사본으로 판단하지 않음).
// - 발동가는 장부·목록·기록 어디에도 저장하지 않는다 — 거래소 주문에 넣거나 받은 주문의 trigger_price와 메모리에서 비교할 때만.
// - 걸기·취소는 위험을 줄이는 호출 — 시간당 30건은 세기만 하고 막지 않는다. 살아 있는 주문의 자동 교체만 10분 2번·하루 10번(syncAllowed).
// - 우리 STOP = 이 매매의 아는 번호(장부 autoSl.orderId·prevOrderId + 기기 목록 항목 번호 — 넣을 때 응답·허브 기억·모양 맞춤으로 채움, 주문 번호 추적
//   설계 2026-10-19 §3). 조회 결과의 이름표(custom_order_id — 오렌지엑스가 늘 비워 줌)로는 아무것도 판단하지 않는다(§1-2). 미체결은 인자 없는 조회 하나
//   (조건 주문은 거기에만 보임 — type market 조회·listed 배우기는 없앰, §4.5·정한 것 9). 모르는 번호(회원·다른 기기 STOP)는 하나도 취소하지 않는다(정한 것 12).
// - 결과 모름(504·끊김·200인데 번호 없음)은 허브 기억 → 모양 맞춤으로 풀고, 그래도 모르면 다시 보내지 않는다(unclear + 보조 감시 — 옛 listed 60초 규칙
//   없음, 새로 거는 것은 회원 '다시 걸기'뿐, 설계 §1-3·§5) — 보이지 않는 STOP 두 개를 막는다. 회원 화면이 없는 서버 실행기 keeper만(unknownDropMs)
//   허브 모름 + 넓은 모양도 없음 + 보낸 지 60초면 안 나간 것으로 본다(진행 기록 Task 4 Ruling — 계획 정한 것 8·21과 같은 조건).
import { autoSlDue, liqOf, autoSlTrigger, autoSlTol, autoSlPassed, autoSlVerdict, autoSlMatches, dedupeKeep, nextK, autoSlKOf, AUTO_SL } from './auto-sl.js';
import { cancelEntry, checkBeforeEntry, presumedUnsent } from './auto-sl-orders.js';
import { syncAllowed, CORE } from './follow-core.js';
import { coidFor, dirOf, numStr } from './follow-math.js';
import { ORDER_ID_RE } from './known-orders.js';

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
// 이 매매가 건 자동 손절의 아는 번호(설계 §3): 장부 autoSl.orderId·prevOrderId + 목록 항목 번호 — 거래소 조회 결과의 이름표는 쓰지 않는다
function ownIds(t, entries) {
  const s = slOf(t);
  return new Set([s.orderId, s.prevOrderId, ...entries.filter((x) => x.tradeId === t.id).map((x) => x.orderId)].filter((x) => x != null && ORDER_ID_RE.test(String(x))).map(String));
}
// 아는 번호의 식별자 — 그 번호의 목록 항목 것, 없으면 장부 것(옛 주문 번호면 prevCoid)
function coidOfId(t, entries, id) {
  const s = slOf(t);
  const ent = entries.find((x) => x.orderId === id);
  if (ent) return ent.coid;
  return s.prevOrderId != null && String(s.prevOrderId) === id ? s.prevCoid : s.coid;
}

// e = { exec, sw, orders, rules, refresh, save, now, instruments, reduceOk, markOf(inst), isTest(), setDiag(d), markCheck(inst, on), enqueue(symbol, fn), owner?, unknownDropMs? }
// owner(p40): 이 keeper가 거는·정리하는 목록 항목의 주인 — 'f'(따라가기, 기본) | 'm'(트레이딩 탭 수동 주문 manual-exec). 그 밖의 값은 'f'.
// 같은 기기 목록(kv.autoSlOrders)을 두 keeper가 나눠 쓴다: 목록 정리(sweep)는 자기 주인 항목만, 새 진입 전 확인·'확인했습니다'는 그 종목 모든 항목
// unknownDropMs(서버 실행기만 — exec/lib/engine.js가 follow-exec PEND_DROP_MS를 넘김, 진행 기록 Task 4 Ruling): 회원 '다시 걸기'·'확인했습니다' 화면이 없는
// keeper는 결과 모름 자동 손절을 허브 unknown + 모양 없음 + 보낸 지 이 값이 넘으면 안 나간 것으로 본다(계획 정한 것 8·21과 같은 조건 — 목록 항목은
// cancelEntry가 끝으로, 열린 매매는 resolveUnknown이 넓은 모양까지 본 뒤 k+1). 휴대폰 따라가기·수동은 넘기지 않는다(회원 확인으로만 풂)
export function createAutoSlKeeper(e) {
  const cfg = e.rules.follow.autoSl;
  const owner = e.owner === 'm' ? 'm' : 'f';
  const now = () => e.now();
  const dropMs = Number.isFinite(e.unknownDropMs) && e.unknownDropMs > 0 ? e.unknownDropMs : null;
  const dropOpt = () => (dropMs ? { dropMs, nowMs: now() } : null); // cancelEntry 셋째 인자·presumedUnsent opt
  const addNote = (t, reason, arg = null) => ({ ...t, notes: [...(t.notes || []), { at: now(), reason, arg }].slice(-NOTES_KEEP) });
  const lastNote = (t) => (Array.isArray(t.notes) && t.notes.length ? t.notes[t.notes.length - 1].reason : null);
  // 다시 쓰는 아는 번호(중복 정리로 남긴 것·placeNew 앞에서 찾은 것)의 목록 항목 — 없으면 넣고, 같은 식별자 항목에 번호가 없으면 채운다
  // (다른 번호가 적힌 항목은 덮지 않음 — 그 번호도 끝 확인 전까지 목록이 본다)
  async function keepEntry(t, entries, coid, orderId) {
    if (!coid || entries.some((x) => x.orderId === orderId)) return;
    const same = entries.find((x) => x.coid === coid);
    if (!same) await e.orders.add({ inst: t.inst, coid, orderId, owner, tradeId: t.id, side: t.side, state: 'live', sendAt: now(), at: now() });
    else if (!same.orderId) await e.orders.patch(coid, { orderId, state: 'live' });
  }
  async function insOf(inst) {
    const items = await e.instruments();
    return (Array.isArray(items) ? items : []).find((x) => x && x.inst === inst) || null;
  }

  // 원하는 자동 손절(발동가는 메모리에서만): { liq, src, trigger, tol, qty, amount, mark, tick, step } | { skip }
  // 자리 = 평단→청산가 거리의 liqDistPct 지점(청산가가 추정값이면 estDistPct), tol = 맞추기 허용 오차(auto-sl.js autoSlTol)
  function want(t, pos, ins) {
    const dir = dirOf(t.side);
    const avg = pos.avg ?? t.avg;
    const L = liqOf({ dir, avg, lev: t.lev, liquidPrice: pos.liq });
    if (!L) return { skip: 'auto_sl_no_room' };
    const slArgs = { avg, liq: L.liq, src: L.src, distPct: cfg.liqDistPct, estDistPct: cfg.estDistPct };
    const tr = autoSlTrigger({ ...slArgs, dir, tick: ins.tick });
    if (tr.skip) return tr;
    const qty = Math.abs(pos.size);
    const mk = e.markOf(t.inst);
    return { dir, liq: L.liq, src: L.src, trigger: tr.trigger, tol: autoSlTol(slArgs), qty, amount: numStr(qty, ins.step), mark: mk ?? pos.mark ?? null, tick: ins.tick, step: ins.step };
  }
  const matchOf = (w) => ({ qty: w.qty, trigger: w.trigger, tol: w.tol, step: w.step });

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
    if (v === 'cancel') return cancelFor(t, { final: gone ? 'done' : 'off' });
    if (v === 'keep') {
      if (t.state === 'unclear' && sw.on && due && pos) await guard(t, pos);
      return t;
    }
    // 회원이 바꾼 포지션(방향 다름·수량 ±5% 밖)이면 걸기·교체·바로 정리를 하지 않는다 — detached 판정·기록은 엔진·정리 주기가(§2.8, 검토 고침 1)
    if (!ownsPosition(t, pos)) return t;
    // 교체 도중 앱이 꺼져 새 것이 걸린 채(set) 옛 것이 남았으면 이제 옛 것을 취소(§2.6-6 — 새 것이 보인 뒤)
    if (slOf(t).state === 'set' && slOf(t).prevCoid) t = await settlePrev(t);
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
    if (s.state === 'set') return verify(t, pos, w);
    if (s.state === 'sending' || s.state === 'unclear') return resolveUnknown(t, pos, w);
    if (s.state === 'failed') {
      if (now() - (s.at || 0) < AUTO_SL.retryFailedMs) {
        await guard(t, pos, w);
        return t;
      }
      t = withSl(t, { rejects: 0 });
    }
    // 걸기 직전 — 표시가가 이미 발동가를 지났으면 조건 주문 대신 바로 정리(§2.4, [대표 확인] 3)
    if (autoSlPassed({ dir: w.dir, trigger: w.trigger, mark: w.mark })) return closeNowSl(t, pos, ins);
    return (await placeNew(t, w)).t;
  }

  // 새로 건다 — 목록에 'sending'을 저장한 뒤 호출(그 사이 앱이 꺼져도 다음에 허브 기억·모양 맞춤으로 확인). replacing이면 자동 교체(새 것 먼저)
  async function placeNew(t0, w, { replacing = false } = {}) {
    let t = t0;
    const s = slOf(t);
    const entries = await e.orders.list();
    const oo = await e.exec.openOrders(t.inst);
    // 미체결 조회를 못 하면 이미 걸린 것이 있는지 모른다 — 이번에는 걸지 않고 다음 주기에(중복 STOP을 만들지 않게)
    if (!oo.ok) return { t, ok: false };
    const ids = ownIds(t, entries);
    const live = oo.list.filter((x) => ids.has(String(x.order_id)));
    // 이 매매의 아는 번호가 미체결에 살아 있으면(앞선 실행·다른 탭이 건 것) 새로 걸지 않고 그것을 쓴다(§2.7). 모르는 번호(회원 STOP 등)는 보지 않는다
    if (!replacing && live.length) {
      const { keep, cancel } = dedupeKeep(live, matchOf(w));
      for (const x of cancel) await e.exec.cancelOrder(x.order_id); // 목록의 그 항목은 목록 정리가 끝 확인 뒤 지운다
      const kid = String(keep.order_id);
      const coid = coidOfId(t, entries, kid);
      await keepEntry(t, entries, coid, kid);
      t = withSl(t, { state: 'set', k: autoSlKOf(coid) || s.k, coid, orderId: kid, liqSrc: w.src, at: now(), rejects: 0 });
      await e.save(t);
      return { t, ok: true };
    }
    // 다음 k는 장부·목록(우리 기록)에서만 — 조회 결과의 이름표 k는 쓰지 않는다
    const k = nextK([s.k, ...entries.filter((x) => x.tradeId === t.id).map((x) => autoSlKOf(x.coid))]);
    const coid = k == null ? null : coidFor(t.id, `g${k}`);
    // qty = 보낸 수량 글자(가격 아님 — 번호를 모를 때 cancelEntry 모양 맞춤이 수량까지 보게, 최종 검토 중요 1)
    const added = coid ? await e.orders.add({ inst: t.inst, coid, orderId: null, owner, tradeId: t.id, side: t.side, qty: w.amount, state: 'sending', sendAt: now(), at: now() }) : false;
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
      await afterPlaced(t, r.orderId, w);
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
    return { t: await resolveUnknown(t, null, w), ok: false };
  }

  // 걸린 뒤(시험 토큰만 — 정한 것 15): 인자 없는 미체결에 그 번호가 보이나·주문 상태 원문·주문 종류(order_type)·만든 시각 자릿수를 진단 줄로(가격 없음).
  // 실제 토큰은 조회하지 않는다(옛 listed·type market 배우기 조회는 없앰 — 설계 §4.5)
  async function afterPlaced(t, orderId, w) {
    if (!e.isTest()) return;
    const oo = await e.exec.openOrders(t.inst);
    const st = await e.exec.orderState(orderId);
    const o = st.ok ? st.order : null;
    const ts = o ? String(o.creation_timestamp ?? '') : '';
    e.setDiag({
      listed: oo.ok ? oo.list.some((x) => String(x.order_id) === String(orderId)) : null, src: w.src,
      raw: o ? String(o.order_state ?? '') : null, kind: o ? String(o.order_type ?? '') : null, ts: /^\d{1,20}$/.test(ts) ? ts.length : null,
    });
  }

  // 결과 모름(sending·unclear — 설계 §5): 허브 기억 → 모양 맞춤(STOP·감소 전용·반대 방향·수량·발동가 오차·만든 시각·아는 번호 아님).
  // placed면 번호로 상태 확인(거래소가 지웠으면 처음부터), rejected(안 나감이 확실)면 처음부터·교체 중이면 옛 것으로,
  // 모름이면 unclear + 보조 감시 — 다시 보내지 않는다(옛 60초 규칙 없음, 설계 §1-3). 다음 주기가 다시 묻는다.
  // 서버 실행기(unknownDropMs — 회원 확인 길이 없음, 진행 기록 Task 4 Ruling ②)만: 허브도 모르고(unknown) 좁은 모양도 없고 보낸 지 그 값이 넘었으면
  // 넓은 모양(수량·발동가 안 봄 — cancelEntry의 qty 없는 옛 항목 물음과 같음)으로 한 번 더 물어 그것도 없을 때만 안 나간 것으로 본다(dropUnsent). 넓은 모양이 하나·둘 이상·
  // 조회 실패면 채택도 하지 않고 unclear 그대로(걸린 뒤 수량·청산가 출처가 바뀌면 좁은 모양은 걸린 STOP을 못 보고, 넓은 하나는 회원 STOP일 수 있음)
  async function resolveUnknown(t0, pos, w) {
    let t = t0;
    const s = slOf(t);
    if (!s.coid) {
      t = withSl(t, { state: 'none' });
      await e.save(t);
      return t;
    }
    const ask = { inst: t.inst, coid: s.coid, sentAt: s.sendAt, side: t.side === 'long' ? 'sell' : 'buy', reduce: true, cond: 'STOP' };
    const r = await e.exec.resolvePlaced({ ...ask, qty: w ? w.qty : null, step: w ? w.step : 0.001, fits: w ? (o) => autoSlMatches(o, matchOf(w)) : null });
    if (r.state === 'net') return t;
    if (r.state === 'rejected') {
      await e.orders.remove([s.coid]);
      // 교체 중이었으면 지켜 둔 옛 주문이 다시 현재(맞지 않으면 다음 확인에서 교체 — 그 사이 보호 0건이 되지 않음), 아니면 처음부터
      t = s.prevCoid ? backToPrev(t) : withSl(t, { state: 'none' });
      await e.save(t);
      return t;
    }
    if (r.state === 'placed') {
      const st = await e.exec.orderState(r.orderId);
      if (st.ok && st.state === 'failed') {
        // 나갔지만 거래소가 지움(취소·거절, 체결 없음) — 목록에서 지우고 교체 중이면 옛 것으로, 아니면 처음부터(k+1)
        await e.orders.remove([s.coid]);
        t = s.prevCoid ? backToPrev(t) : withSl(t, { state: 'none', orderId: r.orderId });
        await e.save(t);
        return t;
      }
      await e.orders.patch(s.coid, { orderId: r.orderId, state: 'live' });
      t = withSl(t, { state: 'set', orderId: r.orderId, rejects: 0, at: now() });
      if (s.state === 'sending' && !s.prevCoid && lastNote(t) !== 'auto_sl_set') t = addNote(t, 'auto_sl_set');
      await e.save(t);
      // 새 것의 번호를 알았다 — 이제 옛 것을 취소(§2.6-6 새 것 먼저)
      if (s.prevCoid) t = await settlePrev(t);
      return t;
    }
    if (presumedUnsent(r, s.sendAt, dropOpt())) {
      // 좁은 모양으로 물었으면(w) 넓은 모양으로 한 번 더 — w가 없으면 처음 물음이 이미 넓은 모양(qty null·fits 없음)
      const wide = w ? await e.exec.resolvePlaced({ ...ask, qty: null, step: 0.001, fits: null }) : r;
      if (presumedUnsent(wide, s.sendAt, dropOpt())) return dropUnsent(t, pos, w);
    }
    if (s.state !== 'unclear') {
      t = addNote(withSl(t, { state: 'unclear', at: now() }), 'auto_sl_unclear');
      await e.save(t);
    }
    if (pos) await guard(t, pos, w);
    return t;
  }
  // 안 나간 것으로 본 결과 모름(서버 실행기 — 위 resolveUnknown) → 목록 항목 지움 → 교체 중이면 지켜 둔 옛 주문이 다시 현재(맞지 않으면 다음 확인에서
  // 교체 — 그 사이 보호 0건이 되지 않음), 아니면 처음부터: 걸기 직전 규칙 그대로(표시가가 이미 발동가를 지났으면 바로 정리 §2.4, 아니면 k+1 — 옛 60초 갈래 자리)
  async function dropUnsent(t0, pos, w) {
    const s = slOf(t0);
    await e.orders.remove([s.coid]);
    if (s.prevCoid) {
      const t = backToPrev(t0);
      await e.save(t);
      return t;
    }
    const t = withSl(t0, { state: 'none' });
    await e.save(t);
    if (!w) return t;
    if (autoSlPassed({ dir: w.dir, trigger: w.trigger, mark: w.mark })) return pos ? closeNowSl(t, pos, await insOf(t.inst)) : t;
    return (await placeNew(t, w)).t;
  }

  // 걸린 것 확인(§2.6-4 set, 설계 §4.2·§4.4): 인자 없는 미체결에서 이 매매의 아는 번호로 찾고(둘 이상이면 번호를 아는 것끼리 중복 정리 —
  // 남긴 번호의 목록 항목으로 식별자·k), 안 보이면 주문 상태로
  async function verify(t0, pos, w) {
    let t = t0;
    const s = slOf(t);
    const oo = await e.exec.openOrders(t.inst);
    if (!oo.ok) return t;
    const entries = await e.orders.list();
    const ids = ownIds(t, entries);
    const mine = oo.list.filter((x) => ids.has(String(x.order_id)));
    let order = null;
    if (mine.length > 1) {
      const { keep, cancel } = dedupeKeep(mine, matchOf(w));
      for (const x of cancel) await e.exec.cancelOrder(x.order_id); // 목록의 그 항목은 목록 정리가 끝 확인 뒤 지운다
      order = keep;
      const kid = String(keep.order_id);
      if (kid !== String(s.orderId)) {
        const coid = coidOfId(t, entries, kid);
        await keepEntry(t, entries, coid, kid);
        t = withSl(t, { orderId: kid, coid, k: autoSlKOf(coid) || s.k });
        await e.save(t);
      }
    } else {
      order = mine.find((x) => String(x.order_id) === String(s.orderId)) || null;
    }
    if (order) {
      // 맞으면 그대로 — 단 계산값으로 건 것은 거래소 청산가가 오면 바꾼다(추정 80% 지점 → 거래소 90% 지점, §2.4·§2.6-7 자동 교체)
      if (autoSlMatches(order, matchOf(w)) && !(slOf(t).liqSrc === 'estimate' && w.src === 'exchange')) return t;
      return replace(t, w, order);
    }
    if (!s.orderId) return resolveUnknown(t, pos, w);
    const st = await e.exec.orderState(s.orderId);
    if (!st.ok) return t;
    if (st.state === 'filled' || st.state === 'partial') return t; // 발동 — 정리 주기의 포지션 판정이 맡는다(§2.8)
    if (st.state === 'failed') {
      // 거래소가 지움(취소·거절, 살아 있는 보호 없음) → 목록에서 지우고 다시(k+1, 횟수에 안 셈)
      await e.orders.remove([s.coid]);
      t = withSl(t, { state: 'none' });
      await e.save(t);
      return (await placeNew(t, w)).t;
    }
    if (st.state === 'open') {
      if (autoSlMatches(st.order, matchOf(w)) && !(slOf(t).liqSrc === 'estimate' && w.src === 'exchange')) return t;
      return replace(t, w, st.order);
    }
    // 모르는 order_state(발동 전 STOP이 어떤 값으로 오는지 문서에 없음 — U-A8) — 다시 걸지 않는다. 목록에 안 보이니 unclear + 원문(가격 없음)
    const raw = String(st.order.order_state ?? '').slice(0, 24);
    t = withSl(t, { state: 'unclear', rawState: /^[A-Za-z_]{1,24}$/.test(raw) ? raw : null, at: now() });
    if (lastNote(t) !== 'auto_sl_unclear') t = addNote(t, 'auto_sl_unclear');
    await e.save(t);
    return t;
  }

  // 자동 교체(§2.6-6·7): 한도(10분 2번·하루 10번) 안에서만, 새 것 먼저 → 걸리면 옛 것 취소·끝 확인. 거래소가 둘을 받지 않으면(U-A7) 옛 것 먼저.
  // old = 장부의 지금 번호(s.orderId)의 주문 — 식별자는 장부 것(조회 결과의 이름표는 쓰지 않는다)
  async function replace(t0, w, old) {
    let t = t0;
    const s = slOf(t);
    if (!syncAllowed(s.syncs, now())) {
      if (lastNote(t) !== 'auto_sl_stale') {
        t = addNote(t, 'auto_sl_stale');
        await e.save(t);
      }
      return t;
    }
    const oldEntry = { inst: t.inst, coid: String(s.coid), orderId: String(old.order_id), owner, tradeId: t.id, side: t.side, state: 'live', sendAt: s.sendAt, at: s.at };
    // 옛 주문을 prev로 지킨다 — 새 것의 결과를 모르는 동안 목록 정리가 '살아 있지 않음'으로 보고 취소하지 않게(검토 고침 3)
    t = withSl(t, { syncs: [...(s.syncs || []).filter((x) => now() - x < 86400000), now()], prevCoid: oldEntry.coid, prevOrderId: oldEntry.orderId, prevLiqSrc: s.liqSrc });
    await e.save(t);
    const r = await placeNew(t, w, { replacing: true });
    if (r.ok) {
      const c = await cancelEntry(oldEntry, e.exec.ops, dropOpt());
      if (c.done) await e.orders.remove([oldEntry.coid]);
      return dropPrev(r.t); // 끝 확인이 안 됐으면 항목이 남아 목록 정리가 다시 취소
    }
    if (r.rejected) {
      const c = await cancelEntry(oldEntry, e.exec.ops, dropOpt());
      if (!c.done) return dropPrev(r.t);
      await e.orders.remove([oldEntry.coid]);
      return (await placeNew(withSl(r.t, { state: 'none', ...NO_PREV }), w, { replacing: true })).t;
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
  async function settlePrev(t0) {
    const s = slOf(t0);
    if (!s.prevCoid) return t0;
    if (s.prevCoid !== s.coid) {
      const c = await cancelEntry({ inst: t0.inst, coid: s.prevCoid, orderId: s.prevOrderId, owner, tradeId: t0.id, side: t0.side, state: 'live', sendAt: null, at: null }, e.exec.ops, dropOpt());
      if (c.done) await e.orders.remove([s.prevCoid]);
    }
    return dropPrev(t0);
  }

  // 이 매매의 자동 손절 모두 취소 → 끝 확인(p35 §5.3 고침 1, 주문 번호 추적 설계 §3): 목록 항목 ∪ 장부 번호(autoSl.orderId·prevOrderId — 목록에 없으면
  // 목록에 넣지 않고 바로, 목록이 100건이면 넣지 못하므로 기대지 않음) — 번호 없는 항목은 허브 기억·모양 맞춤으로 찾는다(cancelEntry). 끝난 목록 항목은 지운다.
  // 미체결을 이름표로 훑어 이 매매 STOP을 찾지 않는다(조회 결과에 이름표가 없음 — 모르는 번호는 하나도 취소하지 않는다, 정한 것 12).
  // 결과: { any(이번에 취소를 보냄·항목을 지움), open(거래소가 open이라 답함·인자 없는 미체결에 그 번호가 보임), net(조회 실패), soft(번호 모름·모르는 상태·
  // 상태 조회 오류 — 미체결에도 그 번호가 안 보임), softCoids(그 목록 항목) }
  // '시도함'은 실제로 cancelEntry를 부른 식별자·번호만 적는다(p35 검토 1 — 장부 번호가 목록 항목과 같으면 두 번 부르지 않음)
  async function cancelTargets(t) {
    const s = slOf(t);
    const out = { any: false, open: 0, net: 0, soft: 0, softCoids: [] };
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
      const c = await cancelEntry(x, e.exec.ops, dropOpt());
      tried(x.coid, x.orderId || c.foundId);
      if (c.done) {
        await e.orders.remove([x.coid]);
        out.any = true;
      } else tally(c, x.coid, x.orderId, true);
    }
    for (const [coid, id] of [[s.coid, s.orderId], [s.prevCoid, s.prevOrderId]]) {
      if (!coid && !id) continue;
      if (id ? ids.has(String(id)) : coids.has(coid)) continue;
      // 번호를 모르는 식별자는 보내다 결과를 모른 것(sending·unclear)일 때만 찾는다(허브 기억·모양 맞춤) — 그 밖은 안 나간 것이 확실한 옛 식별자이거나
      // 회원이 '다시 걸기'로 없음을 확인한 것. 그래도 거래소에 남았으면 모르는 번호라 다음 1차 진입의 '모르는 미체결' 검사가 막는다
      if (!id && !['sending', 'unclear'].includes(s.state)) continue;
      const c = await cancelEntry({ inst: t.inst, coid: coid || `ptf.${t.id}.g0`, orderId: id ? String(id) : null, owner, tradeId: t.id, side: t.side, state: id ? 'live' : 'sending', sendAt: s.sendAt, at: s.at }, e.exec.ops, dropOpt());
      tried(coid, id || c.foundId);
      if (c.cancelled) out.any = true;
      tally(c, coid, id, false);
    }
    // 끝을 모르는 것(soft) 가운데 번호가 있고 그 번호가 인자 없는 미체결에 보이면 '모름'이 아니라 살아 있음 — 번호로만 본다(인자 없는 조회 한 번,
    // 번호 있는 soft가 있을 때만). 그 조회를 하지 못하면 번호 있는 soft는 net
    if (softs.length) {
      const oo = softs.some((x) => x.id) ? await e.exec.openOrders(t.inst) : null;
      for (const x of softs) {
        if (x.id && !oo.ok) out.net += 1;
        else if (x.id && oo.list.some((o) => String(o.order_id) === String(x.id))) out.open += 1;
        else {
          out.soft += 1;
          if (x.entry) out.softCoids.push(x.coid);
        }
      }
    }
    return out;
  }

  // 취소(§2.2-5·§2.6-1): cancelTargets → 다 끝났을 때만 상태를 off·done으로. 하나라도 끝 확인이 안 되면 autoSl을 그대로 둔다 —
  // 매매가 이미 끝났으면 '정리 미완'(slCleanupPending)으로 남아 정리·가벼운 주기가 다시(cleanup), 그 종목 새 진입은 막힘(checkEntry).
  // 두 번째 인자의 sw(옛 스위치 값 — 부르는 곳이 넘김)는 더 보지 않는다
  async function cancelFor(t0, { final }) {
    let t = t0;
    const s = slOf(t);
    const r = await cancelTargets(t);
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
      await cancelFor(t, { final: 'done' });
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
  async function closeGone(t0) {
    const g = await e.exec.goneExit(t0);
    let t = e.exec.withExit(t0, g.exit);
    t = { ...t, state: 'closed', closedAt: now(), reason: g.reason || t0.reason || 'gone' };
    await e.save(t);
    await cancelFor(t, { final: 'done' });
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
    await cancelFor(t, { final: 'done' });
    return t;
  }

  // 새 진입 전 확인(§2.7) — openTrade가 포지션 없음·회원 주문 없음을 본 뒤에만 부른다(follow-exec). 결과: true(진입) / false(auto_sl_check) /
  // 'has_position'·'error'(그 사유로 건너뜀). 무엇이든 취소하기 전에 포지션을 새로 본다 — 있으면 살아 있는 포지션의 자동 손절이라
  // 아무것도 건드리지 않는다(검토 고침 2·4). 없을 때만: 같은 종목 열린 매매는 끝난 것(자동 손절 체결부터 보고 닫고 항목 취소) →
  // 그 종목 목록 항목 모두 끝 확인(원웨이 포지션 하나라 남은 STOP은 어느 주인 것이든 새 포지션을 닫는다)
  // p35: 끝난 매매의 자동 손절 정리 미완(장부 번호로 다시 취소·끝 확인) 매매도 본다 — 목록에 없는 번호의 STOP이 새 포지션을 닫지 않게
  async function checkEntry(inst, trades) {
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
      if (SL_LIVE.includes(cur.state)) await closeGone(cur);
    }
    let ok = await checkBeforeEntry(inst, { orders: e.orders, ops: e.exec.ops, ...dropOpt() });
    // 정리 미완이거나 방금 위에서 닫은 매매만 다시 읽는다(끝 확인이 끝난 줄 — 건너뜀 줄 수백 개 — 을 하나하나 읽지 않게)
    for (const x of mine.filter((y) => slCleanupPending(y) || SL_LIVE.includes(y.state))) {
      const cur = await cleanup(x.id);
      if (slCleanupPending(cur)) ok = false;
    }
    e.markCheck(inst, !ok);
    return ok;
  }

  // 정리 미완 매매 하나 — 큐 안에서(정리 주기·가벼운 주기·새 진입 전 확인). 위험을 줄이는 호출만
  async function cleanup(id) {
    const t = await e.refresh(id);
    if (!slCleanupPending(t) || !e.reduceOk()) return t;
    return cancelFor(t, { final: 'done' });
  }

  // '확인했습니다'(p35 §5.3 고침 2) — 엔진이 탭 잠금을 쥐고 그 종목 큐 안에서 부른다. 포지션부터 캐시 없이: 조회 실패 → 아무것도 안 함('error'),
  // 포지션 있음 → 아무것도 취소·삭제하지 않음('has_position' — 살아 있는 포지션의 보호 STOP을 지우지 않게). 포지션 없음일 때만, 그 종목 목록 항목
  // (주인과 상관없이 — 원웨이 포지션 하나라 남은 STOP은 어느 주인 것이든 새 포지션을 닫음)과 정리 미완 매매의 장부 번호를 한 번 더 취소·끝 확인:
  // 끝 → 지움, 거래소가 open이라 답함 → 남김('still_open'), 번호 모름(허브 기억·모양으로 못 찾음)·모르는 상태·상태 조회에 거래소가 오류로 답함
  // (p35 검토 4 — 거래소가 모르는 번호) → 회원 확인으로 지움. 단 번호가 있고 그 번호가 인자 없는 미체결에 보이면 '모름'이 아니라 살아 있음 →
  // 남김('still_open'), 미체결을 보지 못하면 지우지 않음('error' — 번호로만 본다, 조회 결과의 이름표는 쓰지 않음). 조회 실패가 남으면 'error'
  async function confirmInst(inst, trades) {
    const p = await e.exec.positionOf(inst, { fresh: true });
    if (!p.ok) return { ok: false, reason: 'error' };
    if (p.pos) return { ok: false, reason: 'has_position' };
    let open = 0;
    let net = 0;
    const soft = [];
    for (const x of (await e.orders.list()).filter((y) => y.inst === inst)) {
      const c = await cancelEntry(x, e.exec.ops, dropOpt());
      if (c.done) await e.orders.remove([x.coid]);
      else if (c.why === 'open') open += 1;
      else if (c.why === 'net') net += 1;
      else soft.push({ coid: x.coid, id: x.orderId || c.foundId || null });
    }
    if (soft.length) {
      const oo = soft.some((x) => x.id) ? await e.exec.openOrders(inst) : null;
      for (const x of soft) {
        if (!x.id) await e.orders.remove([x.coid]); // 번호 없음 — 포지션 없음을 본 뒤의 회원 확인
        else if (!oo.ok) net += 1;
        else if (oo.list.some((o) => String(o.order_id) === String(x.id))) open += 1;
        else await e.orders.remove([x.coid]);
      }
    }
    for (const x of trades.filter((y) => y && y.inst === inst && (slCleanupPending(y) || SL_LIVE.includes(y.state)))) {
      let cur = await e.refresh(x.id);
      if (!slCleanupPending(cur)) continue;
      const r = await cancelTargets(cur);
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
      const c = await cancelEntry(x, e.exec.ops, dropOpt());
      if (c.done) {
        await e.orders.remove([x.coid]);
        n += 1;
      }
    }
    return n;
  }
  // 스위치 OFF: 목록의 모든 항목(두 장부)을 취소·끝 확인(§2.2-5) — 따라가기(f) 항목은 ensure·목록 정리가 맡으니 여기서는 트레이딩 탭(m) 등 남은 것.
  // owner와 상관없이 늘 'f' 아닌 항목 — 따라가기 keeper(엔진)만 부른다. 수동(owner m) keeper는 부르지 않는다(자기 항목은 ensure·목록 정리가, p40).
  // 인자(옛 스위치 값 — 부르는 곳이 넘김)는 더 보지 않는다
  async function cancelRest() {
    for (const x of await e.orders.list()) {
      if (x.owner === 'f') continue;
      const c = await cancelEntry(x, e.exec.ops, dropOpt());
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
