// 따라가기 정리 주기(설계 3-2 §6.11)와 앱을 켤 때 확인(§6.4). 엔진(follow-engine)의 손잡이 inner를 받는다.
// - 켤 때(보일 때) 한 번: 'sending' 체결 줄을 식별자로 확인(adopted/failed) → 아래 정리 한 번.
// - 켜져 있고 화면에 보이는 동안 30초마다(장부에 open·unclear·closing 매매가 있을 때 — closing은 open으로 되돌려 다시 판정): get_positions → 회원이 바꾼 포지션(§6.10) →
//   끝이 확인된 매매 정리(끝 이벤트·ended[]로만 — 다시 열었을 때 규칙) → 보호 확인(최신 회원 상태의 tpPct·slPct) → 남은 ptf. 주문 정리.
// - feed가 recovered·stale·degraded·partner 다운이면 종료 판정·정리 주문을 하지 않는다(보호 확인·조회만). 리허설 장부는 리허설 목록으로만.
// - open[]에도 ended[]에도 없으면(허브 초기화 등) unclear로 두고 시트로 묻는다(signal_unclear) — 자동으로 닫지 않는다(앱 실행마다 한 번 묻기).
// - 탭 잠금을 쥔 탭에서만 돈다(같은 판 탭은 장부 하나를 같이 씀). 매매마다 판단 전에 저장소에서 다시 읽는다.
// - 남은 ptf. 주문 정리는 임대와 탭 잠금을 모두 쥔 기기에서만, 이 기기 장부에 있는(열려 있지 않은) 매매의 주문만(§6.3·§6.9).
// p34 자동 손절(설계 §2.6): 매매마다 신호 차수(회원·리허설 상태 open[].stage)를 올리고 → 포지션이 없으면 자동 손절 체결부터 보고 닫음(§2.8) →
//   크기가 다르면 자동 손절 일부 체결인지 먼저(남은 수량 정리) → 보호 확인 뒤 자동 손절 맞추기. 결과 모름(unclear)은 보조 감시만.
//   기기 주문 목록에 항목이 있는 detached 매매도 짧은 갈래로 본다(스위치 꺼짐 → 취소 / 포지션 없어짐 → 취소·closed). 끝에 목록 정리(잠금만).
import { endVerdict, endedAt, positionVerdict } from './follow-core.js';
import { bumpStage, stageFromState, slOf, slCleanupPending } from './follow-autosl.js';

const LIVE_FOR_ORDERS = Object.freeze(['open', 'opening', 'closing', 'unclear', 'detached']);
const SL_KEEP = Object.freeze(['set', 'sending', 'unclear']);

export function createUpkeep(e) {
  let busy = false;
  const asked = new Set();

  async function onStart() {
    if (!e.tabOk()) return;
    for (const t of [...e.trades.values()]) {
      if (Array.isArray(t.fills) && t.fills.some((f) => f.state === 'sending')) {
        await e.enqueue(t.symbol, async () => {
          const cur = (await e.refresh(t.id)) || t;
          if (!cur.fills.some((f) => f.state === 'sending')) return;
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

  async function one(id, st, items, stAt = null) {
    let t = await e.refresh(id);
    if (!t) return;
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
    // 보내다 결과를 모른 체결 줄(unclear 진입·추가 진입)은 먼저 식별자로 확인해 수량·평단을 거래소 값으로 — 장부 수량이 0·옛 값이면
    // 아래 회원 변경 판정이 진짜 따라가기 포지션을 detached로 잘못 뺀다
    if (t.fills.some((f) => f.state === 'sending')) {
      t = (await e.exec.recoverSending(t)).trade;
      await e.save(t);
      if (!['open', 'unclear'].includes(t.state)) return;
    }
    const p = await e.exec.positionOf(t.inst);
    if (!p.ok) return;
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
    const r = await e.exec.protect(t, e.targetFor(t, ins), { tick: ins.tick, step: ins.step });
    await e.save(r.trade);
    if (e.keeper) await e.keeper.ensure(t.id, { pos: p.pos });
  }

  // always: 켤 때 한 번(열린 매매가 없어도 남은 ptf. 주문 정리). 30초 주기는 open·unclear 매매(또는 자동 손절 목록 항목)가 있을 때만 돈다
  async function tick({ always = false } = {}) {
    if (busy || !e.running() || !e.tabOk()) return;
    busy = true;
    try {
      const entries = e.slList ? await e.slList.list() : [];
      const withSl = new Set(entries.map((x) => x.tradeId));
      const list = [...e.trades.values()].filter((x) => ['open', 'unclear', 'closing'].includes(x.state) || (x.state === 'detached' && (withSl.has(x.id) || SL_KEEP.includes(slOf(x).state))) || slCleanupPending(x));
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
        const all = [...e.trades.values()];
        const ownIds = all.map((x) => x.id);
        const liveIds = all.filter((x) => LIVE_FOR_ORDERS.includes(x.state)).map((x) => x.id);
        const insts = new Set([...e.symbols().map((s) => `${s}-USDT-PERPETUAL`), ...all.filter((x) => x.inst && Array.isArray(x.fills) && x.fills.length).map((x) => x.inst)]);
        for (const inst of insts) await e.enqueue(inst.split('-')[0], () => e.exec.cancelOrphans(inst, { ownIds, liveIds }));
      }
    } finally {
      busy = false;
      if (e.slSync) await e.slSync();
      else e.emit();
    }
  }

  return { onStart, tick };
}
