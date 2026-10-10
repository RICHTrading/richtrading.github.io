// 수동 주문 실행(p2 spec 4판 §5.3~§5.5·§5.6-2·§5.7·§5.9) — 트레이딩 탭에서 회원이 누른 동작만 주문을 만든다(알림·분석 판정·지표 신호는 주문을 만들지 않음).
// - 모든 거래소 호출에 X-Ptf-Intent: manual — createExec에 넘기는 call도 같은 감싸개(mcall)라 조회·체결 확인·정리까지 모두 의도가 붙는다.
// - 따라가기 엔진과 같은 종목 큐(symbol-queue.js): 회원 동작·정리 주기는 wait:false(다른 창이 그 종목 잠금을 쥐면 busy_window·이번 주기 건너뜀),
//   큐 안 예외는 down(guard — 큐가 삼켜 undefined가 되지 않게). 큐 안에서 큐를 다시 부르지 않는다(Web Locks는 다시 들어갈 수 없음).
// - 결과 모름(504·끊김·같은 식별자)은 약 2·6·15초에 식별자로 확인하고 같은 주문을 다시 보내지 않는다. 그래도 없으면 줄을 failed + recheckUntil(5분)로
//   두고 정리 주기가 계속 확인한다(늦게 보이면 adopted, 그동안 그 종목 새 진입은 checking). 체결 확인이 결과 모름(unclear)이면 줄은 'unknown'.
// - 보내기 직전 거래소 재확인(추가 진입·익절가 변경·체결 뒤·정리 주기): 방향이 같고 |수량|이 체결 줄 합 ±1%(결과 확인 중인 줄은 그 수량까지) —
//   아니면 먼저 그 매매 자동 손절이 일부만 체결됐는지(keeper.settlePartial — 따라가기와 같은 순서, 그렇다면 남은 수량 정리·끝 sl, 검토 1),
//   아니면 기록을 '분리됨'(state detached — 정리만)으로 바꾸고 알림 기록 detached.
// - 끝난 매매의 익절 조건 주문(ptf.<mid>.t*): 취소 뒤 다시 받아 남았는지 본다 — 숨김·끊김으로 닿지 않았으면 끝난 기록 tpLeft·알림 tp_left·정리 결과
//   tpLeft, 정리 주기가 종목 큐 안에서 다시 취소하고 끝이 확인되면 지운다(검토 2 — 남으면 나중의 같은 방향 포지션을 옛 가격에서 닫는다)
// - 익절: cond()가 거짓이면 진입 시장가에 take_profit_price를 붙이고, 참이면(조건 주문 모드 — 시험 토큰 manualTestCond 포함) 체결 뒤
//   IF_TOUCHED ptf.<mid>.t<k>를 새 것 먼저·옛 것 나중으로. 정리 주기는 없어진 익절을 다시 걸지 않고 상태만 unknown(회원이 '다시 걸기').
// - 정리: close_position → 0 확인(1초 간격 3번) → 그다음에만 그 종목 ptf. 미체결 취소 → 갈고리 afterClose(기록이 열린 채) → 끝 기록.
//   포지션이 남으면 보호 주문을 그대로 두고 close_failed.
// - 자동 손절(보안 규칙 18 — 4차 진입 뒤에만 reduce_only STOP ptf.<mid>.g<k>)은 따라가기와 같은 공용 keeper(follow-autosl.js createAutoSlKeeper,
//   owner 'm')가 건다(p40 T10) — 판정·걸기·교체(새 것 먼저)·결과 모름(60초 규칙)·보조 감시·끝 확인(noMarket·listedType·옛 주문 지킴)이 하나.
//   sw(auto-sl-switch — kv.autoSl)·orders(auto-sl-orders — kv.autoSlOrders)는 따라가기 엔진과 같은 kv·채널을 부르는 쪽이 넘긴다.
//   스위치는 값 하나(kv.autoSl) — 이 파일은 쓰지 않는다(카드 버튼은 엔진 setAutoSl 뒤 applySwitch, 알림 sw.onChange도 applySwitch).
//   어댑터: 장부 = kv.manual(manual-store) — refreshTrade는 늘 저장소를 새로 읽고(읽기 오류면 던짐 — 빈 장부로 보고 STOP을 취소하지 않게),
//   saveTrade는 한 거래로 autoSl·분리됨·메모(최근 50)·새 메모의 알림 기록(asl_*)·끝(closed → ended, 자동 손절 체결이면 sl)을 쓴다.
//   발동가·남은 거리는 기록·목록·화면·console 어디에도 없다(keeper가 메모리에서만, manual-store가 가격 칸을 지움).
//   keeper.cancelRest는 부르지 않는다 — 스위치 OFF일 때 남의(m) 항목까지 지우는 것은 따라가기 엔진의 몫(이 keeper는 자기 m 항목만 sweep).
// - 갈고리(hooks로 넘기면 그것이, 아니면 keeper가 — sw·orders·followRules가 없으면 아무것도 안 함):
//     beforeEntry(inst) → true | false(auto_sl_check) | 'has_position' | 'error'(down) — 1차 진입에서 포지션 없음을 본 뒤·미체결을 보기 전
//       (keeper.checkEntry — 그 종목 목록 항목(주인 무관)·정리 미완 끝난 매매의 끝 확인)
//     afterFill(inst, { pos, mid }) — 체결·재확인·익절 뒤(같은 큐 동작 안, 재확인이 맞을 때만). 던져도 체결·익절 기록은 그대로(다음 주기가 맞춤)
//     reconcileTail(inst, { pos, mid }) — 정리 주기 맞추기의 끝(열림·분리됨 기록, 포지션이 있을 때) — 둘 다 keeper.ensure(분리됨은 keep/cancel)
//     afterClose(inst) — 정리에서 포지션 0 확인·ptf. 취소 뒤, 기록을 끝내기 전(기록이 아직 열려 있음) — 그 매매 자동 손절 cancelFor(끝 확인)
//       + 그 종목 남은 목록 항목(주인 무관 — 원웨이 포지션 하나라 남은 STOP은 새 포지션을 닫음) checkBeforeEntry
// - 끝 판정: 포지션 0이면 그 매매 자동 손절 주문 상태부터(filled면 keeper.closeGone — 끝 sl) → 아니면 기록의 마지막 reduce_only 체결.
//   끝 확인이 안 된 자동 손절은 끝난 기록에 autoSl(정리 미완)로 남아 정리 주기가 종목 큐 안에서 마저 취소하고(keeper.cleanup) 그 종목 새 진입을 막는다.
import { createExec } from './follow-exec.js';
import { orderStateOf } from './follow-core.js';
import { coidFor, dirOf, isPtf, numStr, roundTo, MANUAL_ID_RE } from './follow-math.js';
import { sizeFor, tpPrice, pctAt, changedTooMuch, baseOf, estAvg, tpDirOk } from './manual-math.js';
import { FILLED, MANUAL_KEEP, stageOf, filledQty, findMid, toTrade, endedTrade } from './manual-store.js';
import { createAutoSlKeeper, slCleanupPending, slOf, SL_LIVE } from './follow-autosl.js';
import { refusedQuery, checkBeforeEntry } from './auto-sl-orders.js';

export const RECHECK_MS = Object.freeze([2000, 4000, 9000]); // 결과 모름 뒤 식별자 확인(누적 약 2·6·15초)
export const LATE_RECHECK_MS = 300000; // 그 뒤 정리 주기가 계속 확인하는 시간(5분)
export const INST_TTL_MS = 600000; // 종목 목록 캐시 — 허브가 꺼져도 정리는 되게(10분)
const CLOSE_CHECKS = 3; // 정리 뒤 0 확인 횟수(1초 간격)
const CLOSE_GAP_MS = 1000;
const RETRY_KINDS = Object.freeze(['rate', 'busy']); // 위험을 줄이는·확인하는 호출만 1초 뒤 최대 3번 다시
const MANUAL_COID_RE = /^ptf\.m[0-9a-f]{11}\./;
const ENTRY_KIND = /^(?:e1|a[1-9]\d?)$/;
const ADD_KIND = /^a\d+$/;
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
const instOfSym = (symbol) => `${symbol}-USDT-PERPETUAL`;
const coidStarts = (x, prefix) => !!x && typeof x.custom_order_id === 'string' && x.custom_order_id.startsWith(prefix);
// keeper 메모 → 알림 기록 줄(가격 없음 — 이유만). 그 밖의 메모(auto_sl_off·liq_estimated·error 등)는 적지 않는다
const NOTE_LOG = Object.freeze({
  auto_sl_set: 'asl_set', auto_sl_failed: 'asl_fail', auto_sl_no_room: 'asl_no_room', auto_sl_stale: 'asl_stale',
  auto_sl_unclear: 'asl_unclear', auto_sl_left: 'asl_left', detached: 'detached',
});
const SL_HELD = Object.freeze(['set', 'sending', 'unclear']); // 거래소에 걸려 있을 수 있는 상태(분리될 때 auto_sl_left)
const noteKey = (n) => `${n && n.at}|${n && n.reason}|${JSON.stringify(n && n.arg != null ? n.arg : null)}`;
// keeper가 저장하려는 메모 가운데 장부에 없던 것(여러 벌 — 같은 시각 같은 이유가 둘이면 둘째는 새 것)
function freshNotes(old, cur) {
  const left = new Map();
  for (const n of Array.isArray(old) ? old : []) left.set(noteKey(n), (left.get(noteKey(n)) || 0) + 1);
  const out = [];
  for (const n of Array.isArray(cur) ? cur : []) {
    const k = noteKey(n);
    if (left.get(k) > 0) left.set(k, left.get(k) - 1);
    else out.push(n);
  }
  return out;
}
// keeper가 닫은 매매(closeNowSl·closeGone)가 자동 손절로 끝났나
const slEnded = (t) => t.reason === 'auto_sl' || t.reason === 'auto_sl_now' || (!!t.exit && (t.exit.via === 'auto_sl' || t.exit.via === 'auto_sl_now'));

export function createManualExec({
  call, queue, store, sw = null, orders = null, rules, followRules = null, cond = () => false, instruments, price, markPrice = () => null, member,
  reduceOk = () => true, isTest = () => false, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), hooks = {},
}) {
  const mcall = (m, p, o = {}) => call(m, p, { ...o, intent: 'manual' });
  const exec = createExec({ call: mcall, now, sleep, cond: false }); // 익절 방식은 이 파일이 정한다(orderParams에 tp를 넣거나 뺌)
  const condNow = () => (typeof cond === 'function' ? cond() === true : cond === true);

  // ── 자동 손절(p40 T10) — 공용 keeper(owner 'm'), 장부 어댑터는 kv.manual ──
  let diag = null; // 시험 토큰 진단(가격 없음) — 메모리에만
  const checkNeeded = new Set(); // 이전 자동 손절 끝 확인을 못 해 새 진입을 막은 종목('확인했습니다')
  const keeper = sw && orders && followRules && followRules.follow && followRules.follow.autoSl ? createAutoSlKeeper({
    exec,
    sw,
    orders,
    rules: followRules,
    owner: 'm',
    refresh: (id) => refreshTrade(id),
    save: (t) => saveTrade(t),
    now,
    instruments: () => instList(),
    reduceOk: () => reduceOk(),
    markOf: (inst) => markPrice(inst),
    isTest: () => isTest(),
    setDiag: (d) => { diag = d; },
    markCheck: (inst, on) => { if (on) checkNeeded.add(inst); else checkNeeded.delete(inst); },
    // 목록 정리가 종목마다 그 종목 큐 안에서(p35 F-2) — 정리 주기처럼 wait:false(다른 창이 쥐면 이번 회차는 건너뜀, 다음 주기)
    enqueue: (symbol, fn) => queue.run(symbol, fn, { wait: false }),
  }) : null;

  // 장부 → keeper 매매 꼴. 늘 저장소를 새로 읽는다(읽기 오류면 던짐)
  async function refreshTrade(id) {
    if (typeof id !== 'string') return null;
    const r = await store.read();
    const w = findMid(r, id);
    if (!w) return null;
    return w.inst ? toTrade(r.open[w.inst]) : endedTrade(r.ended[w.ended]);
  }
  // keeper가 볼 매매 — 열린 기록 + 자동 손절 정리 미완인 끝난 기록
  async function manualTrades() {
    const r = await store.read();
    return [...Object.values(r.open).map(toTrade), ...r.ended.filter((e) => e && e.autoSl).map(endedTrade).filter(slCleanupPending)];
  }
  // keeper 저장 — 한 거래(store.update). 열린 기록: autoSl·분리됨(되돌리지 않음)·메모(최근 50)·새 메모의 알림 기록.
  // closed(closeNowSl·closeGone) → 끝난 기록(sl — 자동 손절로 끝남 / close — 정리 요청 뒤 / gone), autoSl은 정리 미완일 때만.
  // 끝난 기록 → 그 autoSl만(끝 확인이 끝나면 null)
  async function saveTrade(t) {
    if (!t || typeof t.id !== 'string') return;
    await store.update((r) => {
      const w = findMid(r, t.id);
      if (!w) return;
      const keep = (x) => (slCleanupPending(x) && x.autoSl ? { ...x.autoSl } : null);
      if (!w.inst) {
        r.ended[w.ended].autoSl = keep({ ...t, state: 'closed' });
        return;
      }
      const o = r.open[w.inst];
      if (t.state === 'closed') {
        const end = slEnded(t) ? 'sl' : o.closing ? 'close' : 'gone';
        r.ended.push({
          mid: o.mid, inst: o.inst, symbol: o.symbol, side: o.side, lev: o.lev, openedAt: o.openedAt, closedAt: Number.isFinite(t.closedAt) ? t.closedAt : now(),
          end, resultPct: Number.isFinite(t.resultPct) ? t.resultPct : null, fills: stageOf(o), autoSl: keep(t),
        });
        log(r, '■', o.symbol, `end_${end}`);
        delete r.open[w.inst];
        return;
      }
      if (!SL_LIVE.includes(t.state)) return;
      for (const n of freshNotes(o.notes, t.notes)) if (NOTE_LOG[n.reason]) log(r, '■', o.symbol, NOTE_LOG[n.reason]);
      o.autoSl = t.autoSl ? { ...t.autoSl } : null;
      if (t.state === 'detached') o.state = 'detached';
      o.notes = (Array.isArray(t.notes) ? t.notes : []).slice(-MANUAL_KEEP.notes);
    });
  }
  async function markNoMarket() {
    try {
      await sw.markNoMarket();
    } catch {
      // 메모리 저장소 등 — 이번 판단만
    }
  }
  // 정리에서 포지션 0 확인 뒤(기록이 열린 채): 그 매매 자동 손절 취소·끝 확인 → 그 종목 남은 목록 항목(주인 무관) 끝 확인
  async function slAfterClose(inst) {
    const swv = await sw.read();
    const o = (await store.read()).open[inst];
    if (o) await keeper.cancelFor(toTrade(o), { final: 'done', sw: swv });
    await checkBeforeEntry(inst, { orders, ops: exec.ops, listed: swv.listed, listedType: swv.listedType, noMarket: !!swv.noMarket, now: now(), onRefused: markNoMarket });
  }
  const KH = keeper ? {
    beforeEntry: async (inst) => keeper.checkEntry(inst, await manualTrades()),
    afterFill: async (inst, { mid, pos }) => { await keeper.ensure(mid, { pos }); },
    reconcileTail: async (inst, { mid, pos }) => { await keeper.ensure(mid, { pos }); },
    afterClose: (inst) => slAfterClose(inst),
  } : {};
  const H = { beforeEntry: async () => true, afterFill: async () => {}, reconcileTail: async () => {}, afterClose: async () => {}, ...KH, ...hooks };
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const guard = (fn) => async () => {
    try {
      return await fn();
    } catch {
      return fail('down');
    }
  };
  const done = (r) => (r && r.busy ? fail('busy_window') : !r || r.error ? fail('down') : r);
  // 결과를 확인 중인 줄 — 보내는 중·결과 모름·결과 모름에서 온 실패(다시 확인 시간 안)
  const checking = (f, t = now()) => !!f && (f.state === 'sending' || f.state === 'unknown' || (f.state === 'failed' && Number(f.recheckUntil) > t));
  const log = (r, icon, symbol, key, arg = null) => {
    r.log.push({ at: now(), icon, symbol, key, ...(arg != null ? { arg } : {}) });
  };
  const setTp = (inst, mid, fields) => store.update((r) => {
    const o = r.open[inst];
    if (o && o.mid === mid) o.tp = { ...(o.tp || { k: 0, state: 'none' }), ...fields };
  });
  // 수량 문자열 — 종목 step(캐시)으로, 종목 목록이 없으면 거래소 포지션 수량 그대로(지수 표기 없이)
  const qtyStr = (size, spec) => (spec ? numStr(Math.abs(size), spec.step) : Math.abs(size).toFixed(8).replace(/\.?0+$/, ''));
  const newMid = () => `m${hex(rand(6)).slice(0, 11)}`;

  async function retrying(method, params, opts) {
    let o = await mcall(method, params, opts);
    for (let i = 0; i < 3 && !o.ok && RETRY_KINDS.includes(o.kind); i += 1) {
      await sleep(1000);
      o = await mcall(method, params, opts);
    }
    return o;
  }
  const cancelId = (id) => retrying('/private/cancel', { order_id: String(id) });

  // 종목 목록(fetchInstruments — 배열, 실패하면 던짐): 마지막 성공 값을 10분
  let instCache = { at: -Infinity, list: [] };
  async function instList() {
    if (now() - instCache.at < INST_TTL_MS && instCache.list.length) return instCache.list;
    try {
      const list = await instruments();
      if (Array.isArray(list) && list.length) instCache = { at: now(), list };
    } catch {
      // 허브 꺼짐 — 지난 값
    }
    return instCache.list;
  }
  const instOf = async (inst) => (await instList()).find((x) => x && x.inst === inst) || null;

  // 미체결 일반 + type market(조건 주문이 market 조회에만 보이는 거래소 — p34 U-A2). market 조회를 확정 거절하면 일반만, 그 밖의 실패는 모름
  async function openAll(inst) {
    const a = await exec.openOrders(inst);
    if (!a.ok) return a;
    const b = await exec.openOrders(inst, { type: 'market' });
    if (!b.ok) return refusedQuery(b) ? a : b;
    const ids = new Set(a.list.map((x) => String(x.order_id)));
    return { ok: true, list: [...a.list, ...b.list.filter((x) => !ids.has(String(x.order_id)))] };
  }
  // 조건 주문 식별자 찾기 — 일반 미체결·기록 20건, 없으면 type market 미체결
  async function findAny(inst, coid) {
    const f = await exec.findByCoid(inst, coid);
    if (!f.ok || f.order) return f;
    const m = await exec.findByCoid(inst, coid, { type: 'market' });
    if (!m.ok) return refusedQuery(m) ? f : m;
    return m;
  }

  // ① 허브 판정(회원 상태 manual) — 막히면 보내지 않는다
  function gate(symbol) {
    const m = member();
    const man = m && m.manual;
    if (!man || man.enabled !== true) return fail(`blocked:${(man && man.reason) || 'off'}`);
    if (!Array.isArray(man.symbols) || !man.symbols.includes(symbol)) return fail('symbol_off');
    return null;
  }

  // 방향이 같고 |수량|이 체결 줄 합 ±1% — 결과를 확인 중인 줄은 나갔을 수도 있어 그 수량까지 허용(잘못 분리하지 않게)
  function fits(o, pos) {
    const size = Number(pos && pos.size);
    if (!Number.isFinite(size) || size === 0 || Math.sign(size) !== dirOf(o.side)) return false;
    const lo = filledQty(o);
    const pend = o.fills.filter((f) => ENTRY_KIND.test(String(f.kind)) && checking(f)).reduce((a, f) => a + (Number(f.qty) > 0 ? Number(f.qty) : 0), 0);
    const hi = lo + pend;
    if (!(hi > 0)) return false;
    const q = Math.abs(size);
    return q >= lo * 0.99 && q <= hi * 1.01;
  }
  // 보내기 직전 거래소 재확인(spec §5.5) — given: 같은 동작에서 방금 캐시 없이 받은 positionOf 결과. 맞으면 기록 평단(avg)을 거래소 값으로.
  // 크기가 맞지 않으면 먼저 그 매매 자동 손절이 일부만 체결됐는지(keeper.settlePartial — 따라가기 정리 주기와 같은 순서, p34 §2.8 첫 줄):
  // 그렇다면 남은 수량을 정리(사유 자동 손절 — 끝 sl)하고 'settled'(정리하지 못했어도 분리됨으로 빼지 않고 다음 주기에 다시, 검토 1).
  // 분리됨으로 빼면 keeper가 걸지도·닫지도 않아 남은 포지션이 보호 없이 청산가 옆에 남는다
  async function recheck(inst, given = null) {
    const o = (await store.get()).open[inst];
    if (!o) return { verdict: 'no_record' };
    const p = given || (await exec.positionOf(inst, { fresh: true }));
    if (!p.ok) return { verdict: 'down', o };
    if (!p.pos) return { verdict: 'gone', o };
    if (o.state === 'detached') return { verdict: 'detached', o, pos: p.pos };
    if (!fits(o, p.pos)) {
      if (keeper && o.autoSl && o.autoSl.orderId && reduceOk()) {
        const t = await keeper.settlePartial(toTrade(o), p.pos);
        if (t) {
          await afterKeeperEnd(inst, o);
          return { verdict: 'settled', o };
        }
      }
      // 분리됨 — 자동 손절이 걸려 있었으면 거래소에 남아 보호를 계속한다(auto_sl_left — 스위치가 켜진 동안 keeper가 그대로 둠, p34 §2.8)
      await store.update((r) => {
        const y = r.open[inst];
        if (!y || y.mid !== o.mid || y.state === 'detached') return;
        y.state = 'detached';
        const at = now();
        const left = !!y.autoSl && SL_HELD.includes(y.autoSl.state);
        y.notes = [...(Array.isArray(y.notes) ? y.notes : []), { at, reason: 'detached', arg: null }, ...(left ? [{ at, reason: 'auto_sl_left', arg: null }] : [])];
        log(r, '■', y.symbol, 'detached');
        if (left) log(r, '■', y.symbol, 'asl_left');
      });
      return { verdict: 'detached', o: { ...o, state: 'detached' }, pos: p.pos };
    }
    const avg = num(p.pos.avg);
    if (avg != null && o.avg !== avg) {
      await store.update((r) => {
        const y = r.open[inst];
        if (y && y.mid === o.mid) y.avg = avg;
      });
    }
    return { verdict: 'ok', o: { ...o, avg: avg ?? o.avg ?? null }, pos: p.pos };
  }

  // 크기 계산(spec §5.3) — 기준 = min(사용 가능, 시험 상한), 배율 = min(탭 배율, 종목 최대)(추가 진입은 기록의 lev), 수량은 step으로 내림
  async function quoteRaw({ symbol, side, tab = 'coin', pct = rules.entry.firstPct, mid = null, avg = null, lev: fixedLev = null } = {}) {
    const dir = dirOf(side);
    if (!dir || typeof symbol !== 'string' || !Object.hasOwn(rules.tabs, tab)) return fail('down');
    const pc = Number(pct);
    if (!(pc > 0 && pc <= 100)) return fail('bad_pct');
    const inst = instOfSym(symbol);
    const spec = await instOf(inst);
    if (!spec) return fail('not_listed');
    const a = await exec.assets();
    if (!a.ok || !a.view) return fail('down');
    const m = member();
    const testMax = m && m.manual && m.manual.limits ? num(m.manual.limits.maxBase) : null;
    const base = baseOf({ available: a.view.available, testMax });
    const px = price(inst);
    const tabLev = rules.tabs[tab].lev;
    const lev = Number.isInteger(fixedLev) && fixedLev > 0 ? fixedLev : Math.min(tabLev, Number(spec.maxLev) >= 1 ? Math.floor(Number(spec.maxLev)) : tabLev);
    const s = sizeFor({ base, available: a.view.available, pct: pc, px, lev, inst: spec, availCap: rules.availCap, bumpToMin: rules.bumpToMin });
    if (!s.ok) return fail(s.reason, { need: s.need, available: a.view.available });
    return {
      ok: true, mid: mid || newMid(), inst, symbol, side, tab, lev, px, qty: s.qty, amount: s.amount, margin: s.margin, available: a.view.available,
      pctReal: s.pctReal, bumped: s.bumped, tick: spec.tick, step: spec.step, tp: tpPrice({ avg: avg ?? px, dir, lev, tpPct: rules.entry.tpPct, tick: spec.tick }),
    };
  }
  // 카드·시트를 열 때(큐 밖) — 던지지 않는다
  async function quote(args) {
    try {
      return await quoteRaw(args);
    } catch {
      return fail('down');
    }
  }

  // 시장가 하나: 보냄 → (결과 모름이면 2·6·15초 식별자 확인) → 체결 확인. 같은 주문을 다시 보내지 않는다.
  // 결과 state: filled·partial·adopted(체결) / unknown(체결 확인 결과 모름) / failed(체결 0 — recheckUntil이 있으면 결과 모름에서 온 것) / not_sent(안 나간 것이 확실)
  async function sendOne({ inst, mid, method, params, coid }) {
    const o = await mcall(method, params, { coid });
    exec.forget();
    let orderId = o.ok && o.result ? String((o.result.order && o.result.order.order_id) ?? o.result.order_id ?? '') : '';
    let adopted = false;
    if (!o.ok && o.kind !== 'unknown' && o.kind !== 'duplicate') {
      if (o.kind === 'blocked') return { state: 'not_sent', reason: `blocked:${o.reason || 'off'}` };
      return { state: 'not_sent', reason: o.kind === 'ox' ? `ox:${o.code}` : String(o.kind || 'down') };
    }
    if (!orderId) {
      // 결과 모름 — 줄을 unknown으로 먼저 저장(그 사이 앱이 꺼져도 다음에 식별자로 확인)
      await store.update((r) => {
        const y = r.open[inst];
        const f = y && y.mid === mid ? y.fills.find((x) => x.coid === coid) : null;
        if (f) f.state = 'unknown';
      });
      for (const ms of RECHECK_MS) {
        await sleep(ms);
        const f = await exec.findByCoid(inst, coid);
        if (f.ok && f.order) {
          orderId = String(f.order.order_id);
          adopted = true;
          break;
        }
      }
      if (!orderId) return { state: 'failed', reason: 'unknown', recheckUntil: now() + LATE_RECHECK_MS };
    }
    const c = await exec.confirmFill(orderId);
    const st = c.state === 'unclear' ? 'unknown' : adopted && (c.state === 'filled' || c.state === 'partial') ? 'adopted' : c.state;
    return { state: st, qty: c.qty, price: c.price, orderId, reason: st === 'failed' ? 'not_filled' : st === 'unknown' ? 'unknown' : null };
  }
  // 보낸 줄에 결과를 적는다(같은 기록·같은 식별자만) — 체결이면 그 알림 기록(entryLog)
  function applyFill(r, inst, mid, coid, f, symbol, entryLog) {
    const y = r.open[inst];
    const x = y && y.mid === mid ? y.fills.find((z) => z.coid === coid) : null;
    if (!x) return;
    if (FILLED.includes(f.state)) {
      Object.assign(x, { state: f.state, qty: num(f.qty) ?? x.qty, price: num(f.price) });
      entryLog(y);
    } else if (f.state === 'unknown') {
      x.state = 'unknown';
    } else if (f.state === 'failed' && f.recheckUntil) {
      Object.assign(x, { state: 'failed', recheckUntil: f.recheckUntil });
      log(r, '■', symbol, 'entry_fail', 'unknown');
    } else {
      Object.assign(x, { state: 'failed', qty: 0 });
      log(r, '■', symbol, 'entry_fail', f.reason || 'not_filled');
    }
  }
  const mlReason = (ml) => {
    const k = ml.fail && ml.fail.kind;
    if (k === 'blocked') return `blocked:${ml.fail.reason || 'off'}`;
    if (k === 'hidden') return 'hidden';
    if (ml.lev && k === 'ox') return 'lev_denied';
    return 'margin_cfg';
  };

  // 익절 조건 주문(spec §5.5 익절가 변경·§5.6-2 cond 모드) — 새 것 먼저·옛 것 나중. 시도마다 k 증가(같은 식별자를 두 번 보내지 않음),
  // 결과 모름이면 식별자로 찾아 그것을 쓰고, 미체결에 보이는지 확인 → 옛 ptf.<mid>.t* 취소 → 다시 받아 남으면 unknown. 맞춰졌으면 true
  async function placeTp(inst, o, pos, spec, target) {
    const k = ((o.tp && o.tp.k) || 0) + 1;
    const coid = coidFor(o.mid, `t${k}`);
    await setTp(inst, o.mid, { k });
    const params = {
      instrument_name: inst, amount: qtyStr(pos.size, spec), type: 'market', position_side: 'BOTH', reduce_only: true, custom_order_id: coid,
      condition_type: 'IF_TOUCHED', trigger_price: numStr(roundTo(target, spec.tick), spec.tick), trigger_price_type: 2,
    };
    const r = await retrying(o.side === 'long' ? '/private/sell' : '/private/buy', params, { coid });
    exec.forget();
    let ok = r.ok;
    if (!r.ok && (r.kind === 'unknown' || r.kind === 'duplicate')) {
      const f = await findAny(inst, coid);
      ok = !!(f.ok && f.order);
    }
    if (!ok) {
      await setTp(inst, o.mid, { state: 'unknown' });
      return false;
    }
    const old = (x) => coidStarts(x, `ptf.${o.mid}.t`) && x.custom_order_id !== coid;
    const oo = await openAll(inst);
    if (!oo.ok || !oo.list.some((x) => x && x.custom_order_id === coid)) {
      await setTp(inst, o.mid, { state: 'unknown' });
      return false;
    }
    for (const x of oo.list.filter(old)) await cancelId(x.order_id);
    exec.forget();
    const again = await openAll(inst);
    const left = again.ok ? again.list.filter(old).length : 1;
    await setTp(inst, o.mid, { state: left ? 'unknown' : 'ok' });
    return left === 0;
  }

  // 체결 뒤(같은 큐 동작 안): 재확인(평단 맞춤·분리됨) → (조건 주문 모드면) 익절 → 갈고리 afterFill(T10 자동 손절).
  // 재확인 실패·종목 목록 없음·예외는 체결 줄을 그대로 두고 익절 상태 unknown(조용히 넘어가지 않음 — 카드 M-30 + 다시 걸기)
  async function afterFill(inst, mid) {
    const cnd = condNow();
    let rc;
    try {
      rc = await recheck(inst);
    } catch {
      rc = { verdict: 'down' };
    }
    const ok = rc.verdict === 'ok' && !!rc.o && rc.o.mid === mid;
    if (cnd) {
      try {
        const spec = ok ? await instOf(inst) : null;
        if (!spec) await setTp(inst, mid, { state: 'unknown' });
        else await placeTp(inst, rc.o, rc.pos, spec, tpPrice({ avg: num(rc.pos.avg) ?? rc.o.avg, dir: dirOf(rc.o.side), lev: rc.o.lev, tpPct: rc.o.tpPct, tick: spec.tick }));
      } catch {
        try {
          await setTp(inst, mid, { state: 'unknown' });
        } catch {
          // 기록도 못 씀 — 다음 주기
        }
      }
    }
    if (!ok) return;
    try {
      await H.afterFill(inst, { pos: rc.pos, mid });
      await afterKeeperEnd(inst, rc.o); // keeper가 바로 정리했으면(auto_sl_now) 남은 익절 주문
    } catch {
      // 자동 손절은 정리 주기가 다시 맞춘다
    }
  }

  // ── 1차 진입(spec §5.5 377) — 종목 큐 안(wait:false) ──
  // draft = { mid(카드 하나에 하나), symbol, inst?, side, tab, shown: { qty, margin }(화면에 보인 값) }
  function openFirst(draft = {}) {
    const symbol = draft.symbol;
    return queue.run(symbol, guard(async () => {
      const g = gate(symbol); // ①
      if (g) return g;
      const inst = instOfSym(symbol);
      if (!MANUAL_ID_RE.test(String(draft.mid)) || !dirOf(draft.side) || !draft.shown || (draft.inst && draft.inst !== inst)) return fail('down');
      const coid = coidFor(draft.mid, 'e1');
      // 판단용 읽기(읽기 오류면 던짐 → down) — 화면용 get은 오류에 빈 기록을 돌려줘 확인 중 기록을 못 보고 덮어쓴다(spec §5.7, 검토 6)
      const cur = (await store.read()).open[inst];
      // 기록이 있으면 새 1차 진입 없음 — 결과 확인 중(또는 체결이 하나도 없는 기록 — 정리 주기가 곧 지움)이면 checking
      if (cur) return cur.fills.some((f) => checking(f)) || !cur.fills.some((f) => FILLED.includes(f.state)) ? fail('checking') : fail('has_position');
      const q = await quoteRaw({ symbol, side: draft.side, tab: draft.tab, mid: draft.mid }); // ①-2 누르는 순간 다시 계산
      if (!q.ok) return q;
      if (changedTooMuch(draft.shown.qty, q.qty) || changedTooMuch(draft.shown.margin, q.margin)) return fail('changed', { quote: q });
      const p = await exec.positionOf(inst, { fresh: true }); // ②
      if (!p.ok) return fail('down');
      if (p.pos) return fail('has_position');
      const be = await H.beforeEntry(inst); // ③ 자동 손절 목록 끝 확인(T10)
      if (be !== true) return fail(be === 'has_position' ? 'has_position' : be === 'error' ? 'down' : 'auto_sl_check');
      const oo = await openAll(inst); // ③-2 바깥 미체결
      if (!oo.ok) return fail('down');
      if (oo.list.some((x) => !isPtf(x && x.custom_order_id))) return fail('foreign_orders');
      // ③-3 포지션 없는데 남은 수동 주문(ptf.m…)은 취소하고 다시 받아 본다 — 어느 주인이든 ptf. 주문이 남아 있으면 진입하지 않는다
      // (남은 reduce_only STOP·IF_TOUCHED는 새 같은 방향 포지션을 옛 발동가에서 닫는다)
      const left = oo.list.filter((x) => MANUAL_COID_RE.test(String(x.custom_order_id)));
      for (const x of left) await cancelId(x.order_id);
      if (left.length) exec.forget();
      const again = left.length ? await openAll(inst) : oo;
      if (!again.ok) return fail('down');
      if (again.list.some((x) => isPtf(x && x.custom_order_id))) return fail('stale_orders');
      const ml = await exec.ensureMarginLev(inst, q.lev, coid); // ④ 격리·배율
      if (!ml.ok) return fail(mlReason(ml));
      const cnd = condNow();
      const at = now();
      let clash = false;
      await store.update((r) => { // ⑤ 보내기 전 'sending' 줄 — 그 사이 생긴 기록은 덮지 않는다(다른 창·늦은 기록)
        if (r.open[inst]) {
          clash = true;
          return;
        }
        r.open[inst] = {
          mid: q.mid, inst, symbol, side: q.side, tab: q.tab, lev: q.lev, openedAt: at, tpPct: rules.entry.tpPct, state: 'open',
          fills: [{ coid, kind: 'e1', pct: q.pctReal, state: 'sending', qty: q.qty, price: null, at }],
          tp: { k: 0, state: cnd ? 'none' : 'ok' }, autoSl: null, closing: null, notes: [], avg: null,
        };
      });
      if (clash) return fail('checking');
      // ⑥ 시장가 — 익절은 cond가 거짓일 때만 붙인다(참이면 체결 뒤 조건 주문, spec §5.6-2)
      const { method, params } = exec.orderParams(q.side, { inst, amount: q.amount, coid, tp: cnd ? null : q.tp, tick: q.tick });
      const f = await sendOne({ inst, mid: q.mid, method, params, coid }); // ⑦
      if (f.state === 'not_sent') {
        await store.update((r) => {
          if (r.open[inst] && r.open[inst].mid === q.mid) delete r.open[inst];
          log(r, '■', symbol, 'entry_fail', f.reason);
        });
        return fail(f.reason);
      }
      await store.update((r) => applyFill(r, inst, q.mid, coid, f, symbol, () => log(r, '▶', symbol, 'entry1', { side: q.side, price: num(f.price) })));
      if (!FILLED.includes(f.state)) return fail(f.reason || 'unknown');
      await afterFill(inst, q.mid); // ⑧
      return { ok: true, fill: { state: f.state, qty: num(f.qty), price: num(f.price) }, inst };
    }), { wait: false }).then(done);
  }

  // 추가 진입 시트를 열 때 그 시트의 식별자 — 다시 눌러도·두 번 빠르게 눌러도 같은 식별자(spec §5.5 추가 진입)
  async function nextAddCoid(symbol) {
    const o = (await store.get()).open[instOfSym(symbol)];
    if (!o) return null;
    try {
      return coidFor(o.mid, `a${o.fills.filter((f) => ADD_KIND.test(String(f.kind))).length + 1}`);
    } catch {
      return null; // 99번 넘음
    }
  }

  // ── 추가 진입 — 기록의 lev로 계산(25× 기록이면 25×), 보내기 직전 재확인·격리·배율 확인 ──
  function add({ symbol, pct, shown, coid } = {}) {
    const inst = instOfSym(symbol);
    return queue.run(symbol, guard(async () => {
      const g = gate(symbol);
      if (g) return g;
      const o0 = (await store.get()).open[inst];
      if (!o0) return fail('no_record');
      const dupe = o0.fills.find((f) => f.coid === coid);
      if (dupe) {
        // 같은 시트 식별자 — 다시 보내지 않고 그 줄의 결과(안 나간 것이 확실하면 시트를 다시 열게)
        if (FILLED.includes(dupe.state)) return { ok: true, fill: { state: dupe.state, qty: dupe.qty, price: dupe.price }, stage: stageOf(o0), repeat: true };
        return fail(checking(dupe) ? 'checking' : 'changed');
      }
      if (o0.fills.some((f) => checking(f))) return fail('checking');
      const k = o0.fills.filter((f) => ADD_KIND.test(String(f.kind))).length + 1;
      if (k > 99 || coid !== `ptf.${o0.mid}.a${k}`) return fail('changed'); // 시트를 연 뒤 기록이 바뀜
      const rc = await recheck(inst);
      if (rc.verdict === 'down') return fail('down');
      if (rc.verdict === 'no_record') return fail('no_record');
      if (rc.verdict !== 'ok') return fail('pos_changed');
      const { o, pos } = rc;
      const c = await mcall('/private/get_perpetual_user_config', { instrument_name: inst });
      if (!c.ok) return fail('down');
      if (String(c.result && c.result.margin_type).toLowerCase() !== 'isolated' || Number(c.result && c.result.leverage) !== o.lev) return fail('cfg_changed');
      const q = await quoteRaw({ symbol, side: o.side, tab: o.tab, pct, mid: o.mid, lev: o.lev });
      if (!q.ok) return q;
      if (!shown || changedTooMuch(shown.qty, q.qty) || changedTooMuch(shown.margin, q.margin)) return fail('changed', { quote: q });
      const cnd = condNow();
      const at = now();
      await store.update((r) => {
        const y = r.open[inst];
        if (y && y.mid === o.mid) y.fills.push({ coid, kind: `a${k}`, pct: q.pctReal, state: 'sending', qty: q.qty, price: null, at });
      });
      const avgNext = estAvg({ avg: Number(pos.avg), size: Math.abs(pos.size), px: q.px, qty: q.qty });
      const tp = cnd ? null : tpPrice({ avg: avgNext, dir: dirOf(o.side), lev: o.lev, tpPct: o.tpPct, tick: q.tick });
      const { method, params } = exec.orderParams(o.side, { inst, amount: q.amount, coid, tp, tick: q.tick });
      const f = await sendOne({ inst, mid: o.mid, method, params, coid });
      let stage = null;
      await store.update((r) => applyFill(r, inst, o.mid, coid, f, symbol, (y) => {
        stage = stageOf(y);
        log(r, '▶', symbol, 'add', { stage });
      }));
      if (!FILLED.includes(f.state)) return fail(f.reason || 'unknown');
      await afterFill(inst, o.mid);
      return { ok: true, fill: { state: f.state, qty: num(f.qty), price: num(f.price) }, stage };
    }), { wait: false }).then(done);
  }

  // ── 익절가 변경(조건 주문 모드에서만) — 재확인(방향·±1%) → 지금 가격 기준 방향(시세 없으면 tp_dir) → 새 것 먼저 ──
  function changeTp({ symbol, price: target } = {}) {
    const inst = instOfSym(symbol);
    return queue.run(symbol, guard(async () => {
      if (!condNow()) return fail('no_cond');
      const rc = await recheck(inst);
      if (rc.verdict === 'down') return fail('down');
      if (rc.verdict === 'no_record') return fail('no_record');
      if (rc.verdict !== 'ok') return fail('pos_changed');
      const dir = dirOf(rc.o.side);
      if (!tpDirOk({ dir, price: Number(target), px: price(inst) })) return fail('tp_dir'); // 시세가 없으면 거짓(현재가 아래 IF_TOUCHED 즉시 발동 막기)
      const spec = await instOf(inst);
      if (!spec) return fail('down');
      const want = roundTo(Number(target), spec.tick);
      const ok = await placeTp(inst, rc.o, rc.pos, spec, want);
      await store.update((r) => {
        const y = r.open[inst];
        if (!y || y.mid !== rc.o.mid) return;
        if (ok) y.tpPct = Math.round(pctAt({ avg: Number(rc.pos.avg), dir, lev: y.lev, price: want }) * 10) / 10;
        log(r, ok ? '✅' : '■', symbol, ok ? 'tp_changed' : 'tp_fail');
      });
      return ok ? { ok: true } : fail('unknown');
    }), { wait: false }).then(done);
  }

  // 그 매매의 익절 조건 주문(ptf.<mid>.t*) — 조건 주문 모드로 연 기록만(tp.k > 0 또는 tp.state가 ok 아님. 붙임 모드 {k:0, ok}는 포지션과 같이 사라짐)
  const tpMatch = (mid) => (x) => coidStarts(x, `ptf.${mid}.t`);
  const tpOf = (o) => (o && o.tp && (Number(o.tp.k) > 0 || o.tp.state !== 'ok') ? tpMatch(o.mid) : null);
  // 그 종목 ptf. 미체결 전부 / 그 매매(ptf.<mid>.)만 취소 — 포지션 0을 확인한 뒤에만 부른다. left(그 매매 익절 주문)를 주면 취소 뒤 다시 받아
  // 남았는지 본다(검토 2 — 숨김·끊김으로 취소가 닿지 않으면 익절 주문이 남아 나중의 같은 방향 포지션을 옛 가격에서 닫는다). 남음·조회 실패면 true.
  // 자동 손절(g*)의 끝 확인은 keeper가 따로(목록·장부 번호)
  async function cancelWhere(inst, keep, left = null) {
    const oo = await openAll(inst);
    if (oo.ok) for (const x of oo.list) if (keep(x)) await cancelId(x.order_id);
    exec.forget();
    if (!left || (oo.ok && !oo.list.some(left))) return false;
    const again = await openAll(inst);
    return !again.ok || again.list.some(left);
  }
  // 끝난 기록에 '익절 주문 남음'(tpLeft — 가격 없음)·알림 기록 tp_left. 정리 주기가 다시 취소하고 끝이 확인되면 지운다(clearTpLeft)
  async function markTpLeft(mid) {
    await store.update((r) => {
      const w = findMid(r, mid);
      if (!w || w.inst || r.ended[w.ended].tpLeft) return;
      r.ended[w.ended].tpLeft = true;
      log(r, '■', r.ended[w.ended].symbol, 'tp_left');
    });
  }
  async function clearTpLeft(inst, mid) {
    const tp = tpMatch(mid);
    if (await cancelWhere(inst, tp, tp)) return;
    await store.update((r) => {
      const w = findMid(r, mid);
      if (w && !w.inst) delete r.ended[w.ended].tpLeft;
    });
  }
  // keeper가 매매를 닫은 뒤(바로 정리 auto_sl_now·일부 체결 뒤 남은 수량 settlePartial) — 그 매매 익절 주문 취소·끝 확인. keeper의 closeTrade는
  // 일반 미체결 조회로만 취소한다(조건 주문이 type market 조회에만 보이는 거래소 U-A2에서 남음). 못 하면 끝난 기록에 tpLeft. o = 닫히기 전 기록
  async function afterKeeperEnd(inst, o) {
    const tp = tpOf(o);
    if (!tp) return;
    const cur = (await store.read()).open[inst];
    if (cur && cur.mid === o.mid) return; // 아직 열림
    if (await cancelWhere(inst, tp, tp)) await markTpLeft(o.mid);
  }
  async function endRecord(inst, mid, end, tpLeft = false) {
    await store.update((r) => {
      const o = r.open[inst];
      if (!o || o.mid !== mid) return;
      const e = { mid: o.mid, inst: o.inst, symbol: o.symbol, side: o.side, lev: o.lev, openedAt: o.openedAt, closedAt: now(), end, resultPct: null, fills: stageOf(o), autoSl: o.autoSl || null };
      if (!slCleanupPending(endedTrade(e))) e.autoSl = null; // 자동 손절 정리가 남았을 때만 넘긴다(keeper가 마저 취소)
      if (tpLeft) e.tpLeft = true;
      r.ended.push(e);
      log(r, end === 'tp' ? '✅' : '■', o.symbol, `end_${end}`);
      if (tpLeft) log(r, '■', o.symbol, 'tp_left');
      delete r.open[inst];
    });
  }
  // 포지션 0이 확인된 뒤: 그 종목 ptf. 주문 전부 취소(익절·자동 손절·따라가기 보호 주문) → 갈고리 afterClose(기록이 열린 채) → 끝 close.
  // 그 매매 익절 주문 취소를 확인하지 못했으면 true(끝난 기록 tpLeft — 정리 결과에 tpLeft)
  async function finishClose(inst, o) {
    const left = await cancelWhere(inst, (x) => isPtf(x && x.custom_order_id), tpOf(o));
    try {
      await H.afterClose(inst);
    } catch {
      // 남은 자동 손절은 끝난 기록의 정리 미완으로 keeper가
    }
    if (o) await endRecord(inst, o.mid, 'close', left);
    return !!o && left;
  }
  const closed = (left) => (left ? { ok: true, tpLeft: true } : { ok: true });
  // 정리 — close_position(결과 모름이어도) → 0 확인(1초 간격 3번) → 0일 때만 취소·끝. 남으면 보호 주문 그대로 close_failed
  async function closeNow(inst, o, pos, spec) {
    if (o) {
      await store.update((r) => {
        const y = r.open[inst];
        if (y && y.mid === o.mid) y.closing = now();
      });
    }
    const c = await retrying('/private/close_position', { instrument_name: inst, type: 'market', amount: qtyStr(pos.size, spec), pos_id: 0 });
    exec.forget();
    if (!c.ok && c.kind !== 'unknown') return fail('close_failed');
    let after = null;
    for (let i = 0; i < CLOSE_CHECKS; i += 1) {
      if (i) await sleep(CLOSE_GAP_MS);
      after = await exec.positionOf(inst, { fresh: true });
      if (after.ok && !after.pos) break;
    }
    if (!after || !after.ok || after.pos) return fail('close_failed');
    return closed(await finishClose(inst, o));
  }
  // 포지션 정리(빨간 시트 '시장가 전량 정리') — 어느 포지션이든(수동·분리됨·따라가기·바깥, spec §5.9) 정리만은 늘 된다(허브 판정과 무관)
  function close({ symbol } = {}) {
    const inst = instOfSym(symbol);
    return queue.run(symbol, guard(async () => {
      const p = await exec.positionOf(inst, { fresh: true });
      if (!p.ok) return fail('down');
      const o = (await store.get()).open[inst] || null;
      if (!p.pos) {
        // 결과를 확인 중인 체결 줄이 있으면 끝내지 않는다 — 늦게 보이는 체결이 기록 없는 포지션으로 남지 않게
        if (o && o.fills.some((f) => checking(f))) return fail('checking');
        return closed(await finishClose(inst, o));
      }
      return closeNow(inst, o, p.pos, await instOf(inst));
    }), { wait: false }).then(done);
  }

  // 끝 판정(spec §5.5 끝 판정 2) — 포지션 0이 확인된 뒤(정리 주기·종목 큐 안). ① 그 매매 자동 손절 주문 상태부터(p34 §2.8): filled면
  // 남은 ptf.<mid>. 취소 → keeper.closeGone(체결 값으로 결과 %·끝 sl·남은 자동 손절 끝 확인). ② 아니면 최근 기록 20건에서 그 매매의 마지막 체결
  // reduce_only: .t* 익절 → tp, .g* 자동 손절 → sl, 그 밖 정리 요청 뒤 → close, 아니면 gone(기록을 못 읽으면 끝내지 않고 다음 주기)
  // → 남은 ptf.<mid>. 주문 취소 → 그 매매 자동 손절 끝 확인(keeper.cancelFor — 기록이 열린 채) → 끝(확인이 안 됐으면 끝난 기록에 정리 미완)
  async function endJudge(inst, o) {
    const prefix = `ptf.${o.mid}.`;
    const slId = keeper && o.autoSl && o.autoSl.orderId ? String(o.autoSl.orderId) : null;
    if (slId) {
      const s = await exec.orderState(slId);
      if (s.ok && (s.state === 'filled' || s.state === 'partial')) {
        const left = await cancelWhere(inst, (x) => coidStarts(x, prefix), tpOf(o));
        const cur = (await store.read()).open[inst];
        if (cur && cur.mid === o.mid) await keeper.closeGone(toTrade(cur));
        if (left) await markTpLeft(o.mid);
        return;
      }
    }
    const h = await retrying('/private/get_order_history_by_instrument', { instrument_name: inst, count: 20 });
    if (!h.ok || !Array.isArray(h.result)) return;
    const mine = h.result.filter((x) => coidStarts(x, prefix) && (x.reduce_only === true || x.reduce_only === 'true') && Number(x.filled_amount) > 0);
    const last = mine.sort((a, b) => (Number(b.last_update_timestamp) || 0) - (Number(a.last_update_timestamp) || 0))[0];
    const tail = last ? String(last.custom_order_id).split('.').pop() : '';
    const end = /^t\d+$/.test(tail) ? 'tp' : /^g\d+$/.test(tail) ? 'sl' : o.closing ? 'close' : 'gone';
    const left = await cancelWhere(inst, (x) => coidStarts(x, prefix), tpOf(o));
    if (keeper) {
      const cur = (await store.read()).open[inst];
      if (cur && cur.mid === o.mid) await keeper.cancelFor(toTrade(cur), { final: 'done', sw: await sw.read() });
    }
    await endRecord(inst, o.mid, end, left);
  }

  // 한 종목 맞추기(정리 주기 — 종목 큐 안): 확인 중 줄 → 포지션 → 끝 판정 / 재확인 → 익절이 거래소에 있는지 → 갈고리 reconcileTail(자동 손절).
  // light(가벼운 주기·스위치 적용): 익절이 거래소에 있는지(미체결 조회 2번)만 건너뛴다 — 재확인·끝 판정·자동 손절 맞추기(보조 감시 포함)는 같다
  async function reconcile(inst, { light = false } = {}) {
    const o0 = (await store.get()).open[inst];
    if (!o0) return;
    for (const f of o0.fills.filter((x) => checking(x))) {
      const r = await exec.findByCoid(inst, f.coid);
      if (!r.ok) continue; // 조회 실패 — 그대로
      const st = r.order ? orderStateOf(r.order) : null;
      const cnd = condNow();
      await store.update((x) => {
        const y = x.open[inst];
        const g = y && y.mid === o0.mid ? y.fills.find((z) => z.coid === f.coid) : null;
        if (!g || !checking(g)) return;
        if (st === 'filled' || st === 'partial') {
          // 늦게 보인 체결 — 채택. 익절은 다시 걸기(조건 주문 모드), 자동 손절은 갈고리가 판정
          Object.assign(g, { state: 'adopted', qty: num(r.order.filled_amount), price: num(r.order.average_price) ?? g.price });
          delete g.recheckUntil;
          if (cnd) y.tp = { ...(y.tp || { k: 0 }), state: 'unknown' };
          if (g.kind === 'e1') log(x, '▶', y.symbol, 'entry1', { side: y.side, price: g.price });
          else log(x, '▶', y.symbol, 'add', { stage: stageOf(y) });
        } else if (st === 'failed') {
          Object.assign(g, { state: 'failed', qty: 0 });
          delete g.recheckUntil;
        } else if (!r.order && g.state !== 'failed') {
          g.state = 'failed';
          g.recheckUntil = now() + LATE_RECHECK_MS;
        } // 미체결(open)·모르는 상태는 그대로 — 다음 주기
      });
    }
    const p = await exec.positionOf(inst, { fresh: true });
    if (!p.ok) return;
    const o = (await store.get()).open[inst];
    if (!o || o.mid !== o0.mid) return;
    if (!p.pos) {
      if (o.fills.some((f) => checking(f))) return; // 아직 확인 중 — 기다림
      if (!o.fills.some((f) => FILLED.includes(f.state))) { // 한 번도 체결 안 됨 — 기록만 지움
        await store.update((x) => {
          if (x.open[inst] && x.open[inst].mid === o.mid) delete x.open[inst];
        });
        return;
      }
      await endJudge(inst, o);
      return;
    }
    const rc = await recheck(inst, p);
    if (rc.verdict === 'detached') {
      await H.reconcileTail(inst, { pos: rc.pos, mid: rc.o.mid }); // 분리됨 — 정리만(자동 손절은 keeper 판정 keep/cancel)
      return;
    }
    if (rc.verdict !== 'ok') return; // settled(자동 손절 일부 체결 — 남은 수량 정리)·down 등
    if (!light && condNow() && rc.o.tp && rc.o.tp.state === 'ok') {
      // 기록의 익절이 거래소에 없음 — 자동으로 다시 걸지 않는다(회원이 오렌지엑스 앱에서 지웠을 수 있음, M-30 + 다시 걸기)
      const oo = await openAll(inst);
      if (oo.ok && !oo.list.some((x) => coidStarts(x, `ptf.${rc.o.mid}.t`))) await setTp(inst, rc.o.mid, { state: 'unknown' });
    }
    await H.reconcileTail(inst, { pos: rc.pos, mid: rc.o.mid });
    await afterKeeperEnd(inst, rc.o); // keeper 보조 감시가 바로 정리했으면(auto_sl_now) 남은 익절 주문
  }

  // 한 회차(큐 밖에서 부름 — 큐 안에서 큐를 다시 부르지 않는다): 열린 기록마다 종목 큐 하나씩 맞추기 → 자동 손절 정리 미완인 끝난 기록마다
  // 종목 큐 안에서 마저 취소·끝 확인(keeper.cleanup) → 목록 정리(keeper.sweep — owner m 항목만, 종목마다 그 종목 큐 안에서 장부를 다시 읽음.
  // 스위치 OFF면 m 항목은 모두 살아 있지 않음). 회원 동작처럼 wait:false — 다른 창이 그 종목을 쥐면 이번 회차는 건너뛰고 다음 주기
  async function cycle({ light = false } = {}) {
    const rec = await store.get();
    for (const o of Object.values(rec.open)) {
      if (!o || typeof o.symbol !== 'string' || typeof o.inst !== 'string') continue;
      await queue.run(o.symbol, guard(() => reconcile(o.inst, { light })), { wait: false });
    }
    // 익절 주문 취소를 확인하지 못한 끝난 기록(tpLeft, 검토 2) — 종목 큐 안에서 다시 취소·끝 확인
    for (const e of rec.ended) {
      if (!e || e.tpLeft !== true || typeof e.symbol !== 'string' || typeof e.inst !== 'string' || typeof e.mid !== 'string') continue;
      await queue.run(e.symbol, guard(() => clearTpLeft(e.inst, e.mid)), { wait: false });
    }
    if (!keeper) return;
    for (const e of rec.ended) {
      if (!e || typeof e.symbol !== 'string' || typeof e.mid !== 'string' || !e.autoSl || !slCleanupPending(endedTrade(e))) continue;
      await queue.run(e.symbol, guard(() => keeper.cleanup(e.mid)), { wait: false });
    }
    try {
      await keeper.sweep();
    } catch {
      // 다음 주기
    }
  }

  // 정리 주기 — 트레이딩 탭이 보이는 동안 5초마다(다시 열 때 한 번) upkeep(), 앱이 화면에 있는 동안 30초마다 upkeep({ light: true })
  // (AUTO_SL_TEXT.failed의 '30초마다 직접 정리' — keeper 보조 감시). 겹쳐 부르면 진행 중인 것을 돌려준다
  let upkeepRun = null;
  function upkeep({ light = false } = {}) {
    if (upkeepRun) return upkeepRun;
    upkeepRun = (async () => {
      try {
        await cycle({ light });
      } catch {
        // 다음 주기
      } finally {
        upkeepRun = null;
      }
    })();
    return upkeepRun;
  }

  // 스위치 적용(카드 버튼이 엔진 setAutoSl 뒤에·다른 탭/엔진의 바뀜 알림 sw.onChange에) — 열린 기록마다 재확인 + keeper.ensure(켜짐·4차 → 건다,
  // 꺼짐 → 취소·끝 확인) → 큐 밖에서 목록 정리. 한 번에 하나 — 도는 중에 다시 부르면 끝난 뒤 한 번 더(그 사이 바뀐 값도 맞춤)
  let applyRun = null;
  let applyAgain = false;
  function applySwitch() {
    if (!keeper) return Promise.resolve();
    if (applyRun) {
      applyAgain = true;
      return applyRun;
    }
    applyRun = (async () => {
      try {
        do {
          applyAgain = false;
          await cycle({ light: true });
        } while (applyAgain);
      } catch {
        // 다음 주기가 맞춘다
      } finally {
        applyRun = null;
      }
    })();
    return applyRun;
  }
  const unsubscribe = keeper && typeof sw.onChange === 'function' ? sw.onChange(() => { applySwitch(); }) : null;
  // 끄는 중 — 스위치 OFF인데 기기 목록(두 장부)에 끝 확인이 안 된 항목이 남음(카드 '끄는 중'·turningOff 줄)
  async function turningOff() {
    if (!sw || !orders) return false;
    try {
      return !(await sw.read()).on && (await orders.list()).length > 0;
    } catch {
      return false;
    }
  }

  // '다시 걸기'(회원이 누른 동작 — 오렌지엑스 앱에서 없음을 본 뒤): 재확인 → 익절이 맞춰지지 않았으면(조건 주문 모드) 다시 →
  // 자동 손절: 결과 모름·걸지 못함·보내는 중이면 keeper.retry(번호 모르는 항목을 지우고 k+1, 교체 중이면 옛 주문으로), 아니면 keeper.ensure(due + none → 건다).
  // 분리됨은 걸지 않는다(pos_changed)
  function retry({ symbol } = {}) {
    const inst = instOfSym(symbol);
    return queue.run(symbol, guard(async () => {
      const rc = await recheck(inst);
      if (rc.verdict === 'down') return fail('down');
      if (rc.verdict === 'no_record') return fail('no_record');
      if (rc.verdict !== 'ok') return fail('pos_changed');
      const o = rc.o;
      let tp = null;
      if (condNow() && o.tp && o.tp.state !== 'ok') {
        const spec = await instOf(inst);
        if (spec) tp = await placeTp(inst, o, rc.pos, spec, tpPrice({ avg: num(rc.pos.avg) ?? o.avg, dir: dirOf(o.side), lev: o.lev, tpPct: o.tpPct, tick: spec.tick }));
        else {
          tp = false;
          await setTp(inst, o.mid, { state: 'unknown' });
        }
      }
      if (keeper) {
        if (['unclear', 'failed', 'sending'].includes(slOf(toTrade(o)).state)) await keeper.retry(o.mid);
        else await keeper.ensure(o.mid, { pos: rc.pos });
        await afterKeeperEnd(inst, o);
      }
      return tp === null ? { ok: true } : { ok: true, tp };
    }), { wait: false }).then(done);
  }

  // '확인했습니다'(AUTO_SL_TEXT.clearHelp — p35 §5.3 고침 2): 그 종목 큐 안에서 포지션부터(조회 실패·포지션 있음이면 아무것도 취소·삭제하지 않음) →
  // 포지션 없음일 때만 그 종목 목록 항목(주인 무관)·정리 미완 매매를 끝까지 취소·확인, 상태를 알 수 없는 항목만 지움. { ok } | reason has_position·still_open·error
  function clearCheck({ symbol } = {}) {
    const inst = instOfSym(symbol);
    return queue.run(symbol, guard(async () => {
      if (!keeper || !reduceOk()) return fail('error');
      const r = await keeper.confirmInst(inst, await manualTrades());
      return r && r.ok ? { ok: true } : fail((r && r.reason) || 'error');
    }), { wait: false }).then(done);
  }

  // 카드용(가격 없음): 새 진입을 막은 종목('확인했습니다' 보임)·시험 토큰 진단
  const state = () => ({ checkNeeded: [...checkNeeded], diag });
  const dispose = () => {
    if (unsubscribe) unsubscribe();
  };

  return { quote, openFirst, nextAddCoid, add, changeTp, close, upkeep, applySwitch, turningOff, retry, clearCheck, state, dispose, exec };
}
