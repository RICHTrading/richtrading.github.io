// 따라가기 정리 주기(설계 3-2 §6.11)와 앱을 켤 때 확인(§6.4). 엔진(follow-engine)의 손잡이 inner를 받는다.
// - 켤 때(보일 때) 한 번: 끝나지 않은 매매(opening·unclear·open·closing)의 'sending' 체결 줄을 번호·허브 기억·모양 맞춤으로 확인(recoverSending — 모르면 그대로)
//   → 아래 정리 한 번. 끝난·분리 매매의 줄은 켤 때 풀지 않는다(진행 기록 Task 3 Ruling ③).
// - 켜져 있고 화면에 보이는 동안 30초마다(장부에 open·unclear·closing 매매가 있을 때 — closing은 open으로 되돌려 다시 판정): get_positions → 회원이 바꾼 포지션(§6.10) →
//   끝이 확인된 매매 정리(끝 이벤트·ended[]로만 — 다시 열었을 때 규칙) → 보호 확인(최신 회원 상태의 tpPct·slPct) → 남은 우리 주문 정리.
// - 결과 모름 줄(sending)이 남은 매매(설계 2026-10-19 §5.3, 계획 정한 것 7·20): 다시 보내지 않고 skipped로 떨어뜨리지 않는다 — 회원 변경 판정 대신
//   ownsPosition(보내다 모른 수량까지)으로 보고, 1차는 포지션 없음 90초면 not_filled, 추가 진입은 90초 뒤 지금 포지션 크기로 푼다(settleBySize).
// - feed가 recovered·stale·degraded·partner 다운이면 종료 판정·정리 주문을 하지 않는다(보호 확인·조회만). 리허설 장부는 리허설 목록으로만.
// - open[]에도 ended[]에도 없으면(허브 초기화 등) unclear로 두고 시트로 묻는다(signal_unclear) — 자동으로 닫지 않는다(앱 실행마다 한 번 묻기).
// - 탭 잠금을 쥔 탭에서만 돈다(같은 판 탭은 장부 하나를 같이 씀). 매매마다 판단 전에 저장소에서 다시 읽는다.
// - 끝난 매매의 익절·손절 조건 주문 번호가 남았으면(protectPending — 정리 때 취소를 확인하지 못함·결과 모를 pend) 그 매매 줄에서 다시 풀고·취소·확인(위험을 줄임 — 탭 잠금만).
// - 남은 우리 주문 정리(고아)는 임대와 탭 잠금을 모두 쥔 기기에서만, 아는 번호(장부·수동 기록·자동 손절 목록 — 엔진 known) 가운데 끝난 매매의 것만(§6.3·§6.9).
// p34 자동 손절(설계 §2.6): 매매마다 신호 차수(회원·리허설 상태 open[].stage)를 올리고 → 포지션이 없으면 자동 손절 체결부터 보고 닫음(§2.8) →
//   크기가 다르면 자동 손절 일부 체결인지 먼저(남은 수량 정리) → 보호 확인 뒤 자동 손절 맞추기. 결과 모름(unclear)은 보조 감시만.
//   기기 주문 목록에 항목이 있는 detached 매매도 짧은 갈래로 본다(스위치 꺼짐 → 취소 / 포지션 없어짐 → 취소·closed). 끝에 목록 정리(잠금만).
import { endVerdict, endedAt, positionVerdict, CORE } from './follow-core.js';
import { bumpStage, stageFromState, slOf, slCleanupPending, ownsPosition } from './follow-autosl.js';
import { protectPending } from './known-orders.js';
import { dirOf } from './follow-math.js';

const SL_KEEP = Object.freeze(['set', 'sending', 'unclear']);
const FILLED = Object.freeze(['filled', 'partial', 'adopted']);
// 켤 때 확인으로 sending 줄을 푸는 매매(진행 기록 Task 3 Ruling ③) — 끝난·분리(detached) 매매의 못 푸는 줄로 켤 때마다 허브·미체결·기록을 묻지 않는다
// (분리 매매의 줄은 F-20 정리·닫기 시트의 closeNow가 푼다 — 그때도 recoverSending은 회원 몫을 장부 수량으로 흡수하지 않음)
const RECOVER_STATES = Object.freeze(['opening', 'unclear', 'open', 'closing']);
// 결과 모름 줄을 포지션으로 끝내는 나이(허브가 거래소 답을 기다리는 8 + 60초 + 여유 — 계획 정한 것 7·20): 1차 + 포지션 없음 → not_filled,
// 추가 진입 → 포지션 크기로(settleBySize)
export const UNRESOLVED_FLAT_MS = 90000;
const qtyOf = (f) => (Number(f.qty) > 0 ? Number(f.qty) : 0);
// 추가 진입 결과 모름 줄을 포지션 크기로 푼다(계획 정한 것 20 — 보낸 지 90초가 지나도 허브 기억·모양 맞춤으로 못 푼 줄). 모르는 줄 묶음을
// '모두 안 나감'(체결 줄 수량 합) → 오래된 줄부터 하나씩 '들어감'을 더한 순으로 보고, 포지션 수량이 그 합 ±CORE.posTol 안인 처음 것으로 정한다:
// 안 나간 줄 failed(notFilled — 부른 쪽이 메모 not_filled), 들어간 줄 adopted(번호를 모르면 null 그대로 — 수량은 보낸 수량, 가격 모름).
// 장부 수량·평단 = 포지션. 맞는 묶음이 없거나 방향이 다르거나 포지션이 없거나 체결 줄 수량을 모르면(합을 못 셈) null(부른 쪽이 지금의 크기 판정에 맡김)
export function settleBySize(t, pos) {
  const size = Number(pos && pos.size);
  if (!t || !Array.isArray(t.fills) || !Number.isFinite(size) || size === 0 || Math.sign(size) !== dirOf(t.side)) return null;
  if (t.fills.some((f) => f && FILLED.includes(f.state) && !(Number(f.qty) > 0))) return null;
  const q = Math.abs(size);
  const base = t.fills.filter((f) => f && FILLED.includes(f.state)).reduce((a, f) => a + qtyOf(f), 0);
  const unk = t.fills.map((f, i) => (f && f.state === 'sending' ? i : -1)).filter((i) => i >= 0).sort((a, b) => (Number(t.fills[a].at) || 0) - (Number(t.fills[b].at) || 0));
  for (let n = 0; n <= unk.length; n += 1) {
    const inIdx = unk.slice(0, n);
    const sum = base + inIdx.reduce((a, i) => a + qtyOf(t.fills[i]), 0);
    if (!(sum > 0) || Math.abs(q - sum) > sum * CORE.posTol) continue;
    const fills = t.fills.map((f, i) => (!f || f.state !== 'sending' ? f : inIdx.includes(i) ? { ...f, state: 'adopted' } : { ...f, state: 'failed' }));
    return { trade: { ...t, fills, size: q, avg: Number(pos.avg) > 0 ? Number(pos.avg) : t.avg }, notFilled: n < unk.length };
  }
  return null;
}

export function createUpkeep(e) {
  let busy = false;
  const asked = new Set();

  async function onStart() {
    if (!e.tabOk()) return;
    const unsent = (x) => !!x && RECOVER_STATES.includes(x.state) && Array.isArray(x.fills) && x.fills.some((f) => f.state === 'sending');
    for (const t of [...e.trades.values()]) {
      if (unsent(t)) {
        await e.enqueue(t.symbol, async () => {
          const cur = (await e.refresh(t.id)) || t;
          if (!unsent(cur)) return;
          await e.save((await e.exec.recoverSending(cur)).trade);
        });
      }
    }
    await tick({ always: true });
  }

  // 그 매매의 최신 신호 %(리허설은 리허설 목록에서)
  function signalPct(t, st) {
    const list = t.rehearsal ? st && st.rehearsal && st.rehearsal.open : st && st.open;
    const o = Array.isArray(list) ? list.find((x) => x && x.id === t.id) : null;
    return o ? { signalTpPct: o.tpPct ?? null, signalSlPct: o.slPct ?? null } : {};
  }

  // detached 짧은 갈래(p34 §2.6) — 회원 수량이라 새로 걸거나 바꾸지 않는다. 스위치 꺼짐 → 취소, 포지션이 없어지면 취소 + closed
  async function detachedOne(t) {
    const p = await e.exec.positionOf(t.inst);
    if (!p.ok) return;
    if (!p.pos) {
      await e.keeper.closeGone(t);
      return;
    }
    await e.keeper.ensure(t.id, { pos: p.pos });
  }

  // 결과 모름 줄(sending)이 남은 매매(설계 §5.3 — 다시 보내지 않고 skipped로 떨어뜨리지 않음, 계획 정한 것 7·20): 장부 수량이 옛 값일 수 있어
  // 회원 변경(detached) 판정 대신 ownsPosition(보내다 모른 수량까지)으로 본다. → 줄이 풀린 장부 줄(부른 쪽이 보통 판정으로 이어 감) | null(이 회차 끝)
  async function unresolved(t, pos, st, stAt) {
    const live = t.fills.some((f) => FILLED.includes(f.state));
    const ats = t.fills.filter((f) => f.state === 'sending').map((f) => Number(f.at) || 0);
    if (!pos) {
      if (live) {
        if (e.keeper) await e.keeper.closeGone(t);
        else await e.save({ ...t, state: 'closed', closedAt: e.now(), reason: t.reason || 'gone' });
        return null;
      }
      if (e.now() - Math.min(...ats) < UNRESOLVED_FLAT_MS) return null; // 1차 — 허브가 아직 거래소 답을 기다릴 수 있음(정한 것 7)
      await e.save(e.withNotes({ ...t, state: 'skipped', reason: 'not_filled', closedAt: e.now(), fills: t.fills.map((f) => (f.state === 'sending' ? { ...f, state: 'failed' } : f)) }, ['not_filled']));
      return null;
    }
    const detach = async () => { // 지금의 크기 불일치 처리 — 그 매매 자동 손절이 일부 체결됐으면 남은 수량 정리 먼저, 아니면 분리됨
      if (e.keeper && slOf(t).orderId && (await e.keeper.settlePartial(t, pos))) return null;
      await e.save(e.withNotes({ ...t, state: 'detached' }, SL_KEEP.includes(slOf(t).state) ? ['detached', 'auto_sl_left'] : ['detached']));
      return null;
    };
    if (live && e.now() - Math.max(...ats) >= UNRESOLVED_FLAT_MS) {
      // 추가 진입 결과 모름이 모두 90초를 넘음(정한 것 20) — 포지션 크기로 푼다
      const s = settleBySize(t, pos);
      if (s) {
        const t2 = s.notFilled ? e.withNotes(s.trade, ['not_filled']) : s.trade;
        await e.save(t2);
        return t2;
      }
      if (positionVerdict(t, pos) !== 'ok') return detach();
      // 체결 줄 수량을 다 몰라 합이 틀렸는데 장부 수량(마지막으로 맞춘 포지션)과는 맞음 — 안 나간 것으로 보고 끝없는 확인(매 주기 허브·기록 조회)을 끊는다
      const t3 = e.withNotes({ ...t, fills: t.fills.map((f) => (f.state === 'sending' ? { ...f, state: 'failed' } : f)) }, ['unclear_fill']);
      await e.save(t3);
      return t3;
    }
    if (!ownsPosition(t, pos)) return detach();
    if (endVerdict(t, { state: st, endedIds: t.rehearsal ? e.endedReh : e.endedReal, stateAt: stAt }) === 'ended') {
      const t2 = { ...t, state: 'open', size: Math.abs(pos.size), avg: pos.avg ?? t.avg }; // 지금 포지션이 이 매매 것 — 그 수량으로 정리
      await e.save(t2);
      await e.endTrade(t2, { live: false, endAt: endedAt(t2, { state: st, endEvents: e.endEvents }) });
      return null;
    }
    if (!live && t.state !== 'unclear') await e.save({ ...t, state: 'unclear' }); // 1차 결과 모름 — unclear, 보조 감시만(§2.11·정한 것 7)
    // 추가 진입 결과 모름 90초 전(정한 것 20): 매매는 open 그대로 — 남은 차수는 엔진이 이어 가고(addFill ownsPosition), 여기서는 자동 손절만 맞춘다
    // (4차 STOP도 — keeper도 ownsPosition. 보호 확인은 줄이 풀린 뒤)
    if (e.keeper) await e.keeper.ensure(t.id, { pos });
    return null;
  }

  async function one(id, st, items, stAt = null) {
    let t = await e.refresh(id);
    if (!t) return;
    if (protectPending(t)) {
      // 끝난 매매의 익절·손절 조건 주문 취소를 아직 확인하지 못함(정리 때 닿지 않음·결과 모를 pend) — 장부 번호로 다시 풀고·취소·확인(위험을 줄임)
      const r = await e.exec.cancelProtect(t);
      if (r.trade !== t) {
        await e.save(r.trade);
        t = r.trade;
      }
    }
    if (slCleanupPending(t)) {
      // 끝난 매매의 자동 손절 정리 미완(p35 §5.3) — 장부 번호·목록·미체결로 다시 취소·끝 확인
      if (e.keeper) await e.keeper.cleanup(t.id);
      return;
    }
    if (t.state === 'detached') {
      if (e.keeper) await detachedOne(t);
      return;
    }
    if (!['open', 'unclear', 'closing'].includes(t.state)) return;
    if (t.state === 'closing') {
      // 정리 도중 앱이 꺼진(또는 옛 판이 남긴) 줄 — 같은 종목 큐 안이라 지금 정리 중인 동작은 없다. open으로 되돌려 아래 판정(종료면 다시 정리)
      t = { ...t, state: 'open' };
      await e.save(t);
    }
    // 신호 차수(§2.3) — 앱이 꺼진 동안 4차가 된 매매도 상태 open[].stage로
    const b = bumpStage(t, stageFromState(t, st));
    if (b !== t) {
      t = b;
      await e.save(t);
    }
    const ins = items.find((x) => x && x.inst === t.inst);
    e.exec.forget();
    // 보내다 결과를 모른 체결 줄(unclear 진입·추가 진입)은 먼저 번호·허브 기억·모양 맞춤으로 확인(recoverSending — 한 번만 묻고 모르면 그대로)
    if (t.fills.some((f) => f.state === 'sending')) {
      t = (await e.exec.recoverSending(t)).trade;
      await e.save(t);
      if (!['open', 'unclear'].includes(t.state)) return;
    }
    const p = await e.exec.positionOf(t.inst);
    if (!p.ok) return;
    if (t.fills.some((f) => f.state === 'sending')) {
      // 그래도 모름 — 장부 수량이 0·옛 값이라 아래 회원 변경 판정이 진짜 따라가기 포지션을 detached로 잘못 뺀다. 포지션으로 따로 본다
      t = await unresolved(t, p.pos, st, stAt);
      if (!t) return; // 이 회차는 여기서 끝 — 줄이 풀렸으면 아래 보통 판정으로 이어 감
    }
    const v = positionVerdict(t, p.pos);
    if (v === 'gone') {
      // 거래소 익절·손절·청산·자동 손절로 끝남 — 자동 손절 체결이면 사유 auto_sl·exit, 아니면 기록에서 정리 체결(§2.8·§4.2)
      if (e.keeper) await e.keeper.closeGone(t);
      else await e.save({ ...t, state: 'closed', closedAt: e.now(), reason: t.reason || 'gone' });
      return;
    }
    if (v === 'detached') {
      // 자동 손절이 일부만 체결돼 크기가 달라졌으면 남은 수량을 정리(사유 auto_sl) — 회원 변경으로 잘못 빼지 않게(§2.8 첫 줄)
      if (e.keeper && slOf(t).orderId && (await e.keeper.settlePartial(t, p.pos))) return;
      await e.save(e.withNotes({ ...t, state: 'detached' }, SL_KEEP.includes(slOf(t).state) ? ['detached', 'auto_sl_left'] : ['detached']));
      return;
    }
    const verdict = endVerdict(t, { state: st, endedIds: t.rehearsal ? e.endedReh : e.endedReal, stateAt: stAt });
    if (verdict === 'ended') {
      if (t.state === 'unclear') {
        t = { ...t, state: 'open' };
        await e.save(t);
      }
      await e.endTrade(t, { live: false, endAt: endedAt(t, { state: st, endEvents: e.endEvents }) });
      return;
    }
    if (verdict === 'unclear') {
      if (t.state !== 'unclear') await e.save(e.withNotes({ ...t, state: 'unclear' }, ['signal_unclear']));
      if (!asked.has(t.id)) {
        asked.add(t.id);
        e.openSheet({ id: t.id, symbol: t.symbol, side: t.side, lev: t.lev, rehearsal: t.rehearsal, kind: 'close' }, 'close', { reason: 'signal_unclear' });
      }
      if (e.keeper) await e.keeper.ensure(t.id, { pos: p.pos }); // 4차 뒤 걸린 자동 손절은 그대로(보조 감시만)
      return;
    }
    if (verdict === 'open' && t.state === 'unclear') {
      t = { ...t, state: 'open' };
      asked.delete(t.id);
    }
    if (!ins || t.state !== 'open') {
      if (e.keeper && t.state === 'unclear') await e.keeper.ensure(t.id, { pos: p.pos }); // 5차 결과 모름 등 — 그대로 두고 보조 감시
      return;
    }
    t = { ...t, ...signalPct(t, st) };
    // cond 판 보호 주문 pend를 보내기 전에 저장(정한 것 21 — 응답을 잃어도 다음 주기가 같은 다리에 또 보내지 않게)
    const r = await e.exec.protect(t, e.targetFor(t, ins), { tick: ins.tick, step: ins.step, save: e.save });
    await e.save(r.trade);
    if (e.keeper) await e.keeper.ensure(t.id, { pos: p.pos });
  }

  // always: 켤 때 한 번(열린 매매가 없어도 남은 우리 주문 정리). 30초 주기는 open·unclear 매매(또는 자동 손절 목록 항목·보호 주문 정리 전 끝난 매매)가 있을 때만 돈다
  async function tick({ always = false } = {}) {
    if (busy || !e.running() || !e.tabOk()) return;
    busy = true;
    try {
      const entries = e.slList ? await e.slList.list() : [];
      const withSl = new Set(entries.map((x) => x.tradeId));
      const list = [...e.trades.values()].filter((x) => ['open', 'unclear', 'closing'].includes(x.state) || (x.state === 'detached' && (withSl.has(x.id) || SL_KEEP.includes(slOf(x).state))) || slCleanupPending(x) || protectPending(x));
      if (!list.length && !entries.length && !always) return;
      const st = e.st();
      const stAt = typeof e.stateAt === 'function' ? e.stateAt() : null; // 그 상태를 받은 시각 — 그 뒤에 연 매매는 그 상태로 끝을 판단하지 않음
      const items = await e.instruments();
      for (const t of list) await e.enqueue(t.symbol, () => one(t.id, st, items, stAt));
      if (e.keeper) {
        // 목록 정리(§2.7) — 끝난 매매·장부에 없는 매매·교체로 남은 옛 주문. 자기 목록·위험을 줄이는 호출이라 임대 없이 탭 잠금만.
        // 종목마다 그 종목 큐 안에서·장부를 큐 안에서 다시 읽고(p35 F-2 — 큐 안에서 막 건 STOP을 취소하지 않게)
        const swv = await e.sw.read();
        await e.keeper.sweep(swv);
        if (!swv.on) await e.keeper.cancelRest(swv);
      }
      if (e.held()) {
        // 남은 우리 주문(고아) — 아는 번호(장부·수동 기록·자동 손절 목록) 가운데 끝난 매매의 것만. 아는 번호를 읽지 못하면 이번에는 하지 않는다
        const all = [...e.trades.values()];
        const insts = new Set([...e.symbols().map((s) => `${s}-USDT-PERPETUAL`), ...all.filter((x) => x.inst && Array.isArray(x.fills) && x.fills.length).map((x) => x.inst)]);
        let kn = null;
        try {
          kn = await e.known();
        } catch {
          kn = null;
        }
        if (kn) for (const inst of insts) await e.enqueue(inst.split('-')[0], () => e.exec.cancelOrphans(inst, { known: kn }));
      }
    } finally {
      busy = false;
      if (e.slSync) await e.slSync();
      else e.emit();
    }
  }

  return { onStart, tick };
}
