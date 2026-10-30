// 수동 주문 실행(p2 spec 4판 §5.3~§5.5·§5.6-2·§5.7·§5.9) — 트레이딩 탭에서 회원이 누른 동작만 주문을 만든다(알림·분석 판정·지표 신호는 주문을 만들지 않음).
// - 모든 거래소 호출에 X-Ptf-Intent: manual — createExec에 넘기는 call도 같은 감싸개(mcall)라 조회·체결 확인·정리까지 모두 의도가 붙는다.
// - 따라가기 엔진과 같은 종목 큐(symbol-queue.js): 회원 동작·정리 주기는 wait:false(다른 창이 그 종목 잠금을 쥐면 busy_window·이번 주기 건너뜀),
//   큐 안 예외는 down(guard — 큐가 삼켜 undefined가 되지 않게). 큐 안에서 큐를 다시 부르지 않는다(Web Locks는 다시 들어갈 수 없음).
// - 주문 번호 추적(설계 2026-10-19 §2~§5): '우리 주문' = 넣을 때 응답의 거래소 주문 번호를 적은 것(체결 줄 fills[].orderId·익절 tp.orderId·prevIds·
//   끝난 기록 tpLeft — known()이 자동매매 장부·자동 손절 목록과 합친 아는 번호). 이름표(custom_order_id)는 보내기만 하고(허브 중복 막기·결과 기억의 열쇠)
//   조회 결과의 이름표로는 아무것도 판단하지 않는다(오렌지엑스가 조회에는 늘 빈 값으로 줌 — 실측).
// - 결과 모름(504·끊김·같은 식별자·200인데 번호 없음)은 허브 기억(placed — 보낸 바로 뒤 약 2·6·15초) → 모양 맞춤(인자 없는 미체결 + 기록 20건에서 아는 번호가
//   아니고 종목·방향·수량·만든 시각이 맞는 것이 딱 하나)으로 찾고, 같은 주문을 다시 보내지 않는다(보안 규칙 22). 그래도 모르면 줄을 failed + recheckUntil(5분)로
//   두고 정리 주기가 같은 줄을 15초에 한 번 다시 묻는다(찾으면 adopted, 그동안 그 종목 새 진입은 checking). 체결 확인이 결과 모름(unclear)이면
//   줄은 'unknown'(번호는 적음 — 정리 주기가 그 번호의 주문 상태로 채택).
// - 보내기 직전 거래소 재확인(추가 진입·익절가 변경·체결 뒤·정리 주기): 방향이 같고 |수량|이 체결 줄 합 ±1%(결과 확인 중인 줄은 그 수량까지) —
//   아니면 먼저 그 매매 자동 손절이 일부만 체결됐는지(keeper.settlePartial — 따라가기와 같은 순서, 그렇다면 남은 수량 정리·끝 sl, 검토 1),
//   아니면 기록을 '분리됨'(state detached — 정리만)으로 바꾸고 알림 기록 detached.
// - 1차 진입 전 미체결(인자 없는 조회 하나 — 조건 주문은 거기에만 보임, 실측): 이 기기가 모르는 번호가 있으면 foreign_orders(다른 기기·오렌지엑스 앱 —
//   아무것도 취소하지 않음, 설계 §3·Q2), 아는 번호(포지션이 없는데 남은 우리 주문 — 주인 무관, 정한 것 12)는 번호로 취소·끝 확인 뒤 진입(못 하면 stale_orders).
// - 끝난 매매의 익절 번호는 번호로 취소·끝 확인(exec.cancelIds — 거짓 성공 없음). 닿지 않았으면 끝난 기록 tpLeft(남은 번호 목록)·알림 tp_left·정리 결과
//   tpLeft, 정리 주기가 종목 큐 안에서 다시 취소하고 끝이 확인된 번호를 뺀다(남으면 나중의 같은 방향 포지션을 옛 가격에서 닫는다). 옛 기록의 tpLeft true
//   (번호 없음)는 다시 취소할 수 없어 지우고 알림 tp_left_check 한 줄(정한 것 10 — 받침은 다음 1차 진입의 '모르는 미체결' 검사).
// - 익절: cond()가 거짓이면 진입 시장가에 take_profit_price를 붙이고, 참이면(조건 주문 모드 — 시험 토큰 manualTestCond 포함) 체결 뒤
//   IF_TOUCHED(이름표 ptf.<mid>.t<k>)를 새 것 먼저 — 보내기 전에 tp.pend(이름표·보낸 시각·보낸 수량 글자)를 적고, 응답 번호가 인자 없는 미체결(안 보이면
//   주문 상태)에 보인 뒤에만 옛 번호를 취소·끝 확인(설계 §4.3). 결과 모를 익절(pend)은 허브 기억 → 모양 맞춤(보낸 수량)으로 먼저 풀고, 허브 '모름' + 모양 없음이
//   60초(PEND_DROP_MS) 넘을 때만 안 나간 것으로 본다(정한 것 8·22 — 그 전·모양 둘·허브 error면 새로 걸지 않음). 정리 주기는 익절을 새로 걸지 않는다 —
//   번호가 안 보이면 상태만 unknown(회원이 '다시 걸기'), 보이고 지금 포지션을 덮으면 ok(그 익절 발동가로 tpPct도 — 늦게 확인된 익절가 변경을
//   다음 추가 진입·다시 걸기가 옛 %로 되돌리지 않게, 작업 5 Ruling), 보인 뒤 취소 대기 옛 번호를 취소.
// - 정리: close_position → 0 확인(1초 간격 3번) → 그다음에만 그 매매의 익절 번호 + 그 종목 끝난 매매에 남은 아는 번호를 번호로 취소·끝 확인 →
//   갈고리 afterClose(기록이 열린 채) → 끝 기록. 모르는 번호·살아 있는 다른 매매의 번호는 건드리지 않는다(정한 것 12).
//   포지션이 남으면 보호 주문을 그대로 두고 close_failed.
// - 자동 손절(보안 규칙 18 — 4차 진입 뒤에만 reduce_only STOP ptf.<mid>.g<k>)은 따라가기와 같은 공용 keeper(follow-autosl.js createAutoSlKeeper,
//   owner 'm')가 건다(p40 T10) — 판정·걸기·교체(새 것 먼저)·결과 모름(허브 기억 → 모양 맞춤 → 모름, 다시 보내지 않음)·보조 감시·끝 확인(아는 번호로만, 옛 주문 지킴)이 하나.
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
//     afterClose(inst) — 정리에서 포지션 0 확인·번호 취소 뒤, 기록을 끝내기 전(기록이 아직 열려 있음) — 그 매매 자동 손절 cancelFor(끝 확인)
//       + 그 종목 남은 목록 항목(주인 무관 — 원웨이 포지션 하나라 남은 STOP은 새 포지션을 닫음) checkBeforeEntry
// - 끝 판정(조사 5-1 — 번호로): 포지션 0이면 ① 그 매매 자동 손절 번호의 주문 상태(filled면 keeper.closeGone — 끝 sl) ② 익절 번호(지금·취소 대기 옛 것 +
//   결과 모를 pend가 풀리면 그 번호)의 주문 상태(filled면 tp) ③ 최근 기록 20건의 감소 전용 체결 가운데 익절 번호면 tp·자동 손절 번호면 sl,
//   그 밖은 정리 요청 뒤 close·아니면 gone(이름표 꼬리는 읽지 않음 — 조회에는 이름표가 없음).
//   끝 확인이 안 된 자동 손절은 끝난 기록에 autoSl(정리 미완)로 남아 정리 주기가 종목 큐 안에서 마저 취소하고(keeper.cleanup) 그 종목 새 진입을 막는다.
import { createExec, isIsolatedMargin, orderIdOf, UNKNOWN_WAITS, PEND_DROP_MS, EXEC } from './follow-exec.js';
import { orderStateOf } from './follow-core.js';
import { coidFor, dirOf, numStr, roundTo, MANUAL_ID_RE, decimalsOf } from './follow-math.js';
import { sizeFor, tpPrice, pctAt, changedTooMuch, baseOf, estAvg, tpDirOk } from './manual-math.js';
import { FILLED, MANUAL_KEEP, stageOf, filledQty, findMid, toTrade, endedTrade, entryFills } from './manual-store.js';
import { createAutoSlKeeper, slCleanupPending, slOf, SL_LIVE } from './follow-autosl.js';
import { checkBeforeEntry } from './auto-sl-orders.js';
import { isHedgeModeError, oxCodeOf } from './ox-errors.js';
import { knownOrders, splitOpen, ORDER_ID_RE } from './known-orders.js';
import { createManualQuote } from './manual-quote.js';

export const RECHECK_MS = UNKNOWN_WAITS; // 결과 모름 뒤 허브에 묻는 간격(보낸 바로 뒤 — 누적 약 2·6·15초, follow-exec와 같은 값 한 곳)
export const LATE_RECHECK_MS = 300000; // 그 뒤 정리 주기가 계속 확인하는 시간(5분)
export const ASK_GAP_MS = 15000; // 정리 주기(5초)가 같은 결과 모름 줄·결과 모를 익절(pend)을 다시 묻는 간격(계획 정한 것 4)
export const INST_TTL_MS = 600000; // 종목 목록 캐시 — 허브가 꺼져도 정리는 되게(10분)
const CLOSE_CHECKS = 3; // 정리 뒤 0 확인 횟수(1초 간격)
const CLOSE_GAP_MS = 1000;
const RETRY_KINDS = Object.freeze(['rate', 'busy']); // 위험을 줄이는·확인하는 호출만 1초 뒤 최대 3번 다시
const ENTRY_KIND = /^(?:e1|a[1-9]\d?)$/;
const ADD_KIND = /^a\d+$/;
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
const instOfSym = (symbol) => `${symbol}-USDT-PERPETUAL`;
const idOk = (x) => x != null && ORDER_ID_RE.test(String(x));
// 그 매매의 익절 번호 — 지금 것(tp.orderId) + 취소 대기 옛 것(tp.prevIds)
const prevOf = (tp) => (tp && Array.isArray(tp.prevIds) ? tp.prevIds.filter(idOk).map(String) : []);
const tpIdsOf = (o) => (o && o.tp ? [...new Set([o.tp.orderId, ...prevOf(o.tp)].filter(idOk).map(String))] : []);
// 결과 모를 익절의 보낸 수량 글자(계획 정한 것 22) — 옛 pend(qty 없음)는 null
const pendQty = (p) => (p && typeof p.qty === 'string' && Number(p.qty) > 0 ? p.qty : null);
// 결과 모를 익절의 보낸 발동가(trig — 보낸 trigger_price 글자, 최종 검토 중요 2) — 옛 pend(trig 없음)는 null(발동가를 보지 않음)
const pendTrig = (p) => (p && typeof p.trig === 'string' && Number(p.trig) > 0 ? Number(p.trig) : null);
// 끝난 기록에 남길 진입 번호(체결로 센 1차·추가 진입 줄의 번호) — 같은 수량 재진입의 결과 모름 모양 맞춤에서 앞 매매의 매수를 고르지 않게(known-orders가 끝난 진입으로 읽음)
const entryIdsOf = (o) => [...new Set(entryFills(o).map((f) => f.orderId).filter(idOk).map(String))];
// 끝난 기록의 진입 시각(차트 내 매매 마커 — 작업 6, 가격 없음)
const fillAtsOf = (o) => entryFills(o).map((f) => f.at).filter((x) => Number.isFinite(x));
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

// placed(coid) = 허브 주문 결과 기억(ox-client.placed — 결과 모름 뒤), skew() = 허브 − 이 기기 시계 차(임대 응답으로 잼 — 모양 맞춤 시각 폭, 모르면 null),
// followTrades() = 같은 vault의 자동매매 장부(아는 번호에 넣음 — 설계 §3)
export function createManualExec({
  call, queue, store, sw = null, orders = null, rules, followRules = null, cond = () => false, instruments, price, markPrice = () => null, member,
  reduceOk = () => true, isTest = () => false, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), hooks = {},
  placed = async () => ({ status: 'unknown' }), skew = () => null, followTrades = async () => [],
}) {
  const mcall = (m, p, o = {}) => call(m, p, { ...o, intent: 'manual' });
  // 아는 주문 번호(설계 2026-10-19 §3): 자동매매 장부 + 수동 기록 + 자동 손절 목록. createExec보다 앞에(진행 기록 Task 3 Ruling — 만들 때 넘기고 부르는 것은 나중).
  // 수동 기록 읽기 실패는 던진다(수동 판단 재료 — 부르는 쪽이 down·net), 자동매매 장부를 못 읽으면 빈 목록(번호를 모르는 쪽 — 진입이 막히는 쪽으로만 틀림)
  async function followList() {
    try {
      const t = await followTrades();
      return Array.isArray(t) ? t : [];
    } catch {
      return [];
    }
  }
  const known = async () => knownOrders({ trades: await followList(), manual: await store.read(), slOrders: orders ? await orders.list() : [] });
  // 익절 방식은 이 파일이 정한다(orderParams에 tp를 넣거나 뺌 — cond false)
  const exec = createExec({ call: mcall, placed, known, skew, now, sleep, cond: false });
  const condNow = () => (typeof cond === 'function' ? cond() === true : cond === true);
  // 결과 모름을 마지막으로 물은 시각(이름표 → ms, 메모리에만) — 정리 주기는 같은 것을 ASK_GAP_MS에 한 번만(정한 것 4)
  const asked = new Map();
  const askNow = (key) => {
    const at = asked.get(key);
    if (at !== undefined && now() - at < ASK_GAP_MS) return false;
    asked.set(key, now());
    return true;
  };
  const oldTried = new Set(); // 번호 없는 옛 열린 기록의 익절 모양 맞춤은 한 번(정한 것 11 — mid)

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
        const ids = entryIdsOf(o);
        r.ended.push({
          mid: o.mid, inst: o.inst, symbol: o.symbol, side: o.side, lev: o.lev, openedAt: o.openedAt, closedAt: Number.isFinite(t.closedAt) ? t.closedAt : now(),
          end, resultPct: Number.isFinite(t.resultPct) ? t.resultPct : null, fills: stageOf(o), fillAts: fillAtsOf(o), autoSl: keep(t), ...(ids.length ? { entryIds: ids } : {}),
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
  // 정리에서 포지션 0 확인 뒤(기록이 열린 채): 그 매매 자동 손절 취소·끝 확인 → 그 종목 남은 목록 항목(주인 무관) 끝 확인(번호·허브 기억·모양 맞춤)
  async function slAfterClose(inst) {
    const o = (await store.read()).open[inst];
    if (o) await keeper.cancelFor(toTrade(o), { final: 'done' });
    await checkBeforeEntry(inst, { orders, ops: exec.ops });
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
  // 익절 칸 고치기 — rec가 있으면 같은 저장에서 기록 칸도(정리 주기가 익절을 ok로 적을 때의 tpPct — tpPctFix)
  const setTp = (inst, mid, fields, rec = null) => store.update((r) => {
    const o = r.open[inst];
    if (!o || o.mid !== mid) return;
    o.tp = { ...(o.tp || { k: 0, state: 'none' }), ...fields };
    if (rec) Object.assign(o, rec);
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

  // 그 번호가 보이나 — 인자 없는 미체결(조건 주문은 여기에만, 실측 §2) → 안 보이면 주문 상태로 한 번 더(설계 §4.2). 지금 확인 중인 번호의 '없음'은
  // '아직 안 보임'(정한 것 6 — 지우거나 새로 넣지 않음). → { v: true, order } 보임 · { v: false } 안 보임 · { v: null } 둘 다 묻지 못함
  async function seeOrder(inst, id) {
    const oo = await exec.openOrders(inst);
    const hit = oo.ok ? oo.list.find((x) => x && String(x.order_id) === String(id)) : null;
    if (hit) return { v: true, order: hit };
    const s = await exec.orderState(id);
    if (s.ok) return s.state === 'open' ? { v: true, order: s.order } : { v: false };
    return oo.ok ? { v: false } : { v: null };
  }
  const isOpen = async (inst, id) => (await seeOrder(inst, id)).v === true;
  // 지금 열린 그 매매 기록(판단용 읽기) — keeper가 닫기 전에 익절 번호를 잡아 둔다(닫힌 끝난 기록에는 익절 번호가 없음)
  const openOf = async (inst, mid) => {
    const y = (await store.read()).open[inst];
    return y && y.mid === mid ? y : null;
  };
  // 그 매매 익절의 모양(감소 전용·반대 방향 IF_TOUCHED) — 수량은 보낸 수량 글자 q(계획 정한 것 22 — 그 뒤 추가 진입·자동 손절 일부 체결로 포지션이 바뀌어도
  // 그 익절을 찾음), q가 없으면(옛 pend·옛 기록) 지금 포지션 수량 size(그것도 없으면 수량을 보지 않음). 체결 없이 끝난(취소·거절) 조건 주문은 고르지 않는다 —
  // 교체로 이미 취소해 번호를 뺀 우리 옛 익절이 기록 20건에 남아 있다(그것을 결과 모를 익절로 잡으면 진짜 것을 놓치고 끝난 번호를 지금 익절로 적는다).
  // 결과 모를 익절이 회원 손으로 이미 취소됐다면 못 찾아도 그만이다(60초 뒤 허브 '모름'이면 다시 걸 수 있음). fits = 더 볼 조건(발동가 등)
  const tpWant = (o, inst, coid, sentAt, q, size, spec, fits = null) => ({
    inst, coid, sentAt, side: o.side === 'long' ? 'sell' : 'buy', reduce: true, cond: 'IF_TOUCHED',
    qty: q ? Number(q) : (Number(size) > 0 ? Number(size) : null), step: q ? 10 ** -decimalsOf(q) : (spec ? spec.step : 0.001),
    fits: (x) => orderStateOf(x) !== 'failed' && (typeof fits !== 'function' || fits(x) === true),
  });
  // 결과 모를 익절(tp.pend — 보내기 전에 적음)을 한 번 풀어 기록에 적는다(정한 것 8·22): 허브 기억 → 모양 맞춤(보낸 수량 + 보낸 발동가 글자 trig ±EXEC.tpslTol —
  // 지금 목표가 아니라 보낸 때의 값이라 목표가 그 뒤 바뀌어도 맞음. 같은 수량·반대 방향의 회원 익절을 지금 번호로 채택해 다음 교체·다시 걸기가 취소하지 않게 —
  // 최종 검토 중요 2, 설계 §6.10. 옛 pend(trig 없음)는 발동가를 보지 않음). placed면 그 번호가 지금 번호(옛 지금 번호는 prevIds — 취소 대기), 허브 rejected 또는 허브 unknown(물어보지 못한 error 아님) + 모양 없음 +
  // 보낸 지 PEND_DROP_MS면 안 나간 것(pend만 지움), 그 밖(모양 둘·허브 기다리는 중·허브 error·60초 전·조회 실패)은 그대로.
  // gap: 정리 주기는 같은 pend를 ASK_GAP_MS에 한 번만(정한 것 4). → { o(고친 기록 사본), done(pend가 없어짐) }
  async function settleTpPend(inst, o, size, spec, { gap = false } = {}) {
    const p = o && o.tp && o.tp.pend;
    if (!p || typeof p.coid !== 'string') return { o, done: true };
    if (gap && !askNow(p.coid)) return { o, done: false };
    asked.set(p.coid, now()); // 회원 동작(다시 걸기·익절가 변경·체결 뒤)이 물어도 정리 주기는 그 뒤 15초 기다림
    const trig = pendTrig(p);
    const r = await exec.resolvePlaced(tpWant(o, inst, p.coid, Number(p.at), pendQty(p), size, spec, trig ? (x) => Math.abs(Number(x.trigger_price) - trig) / trig <= EXEC.tpslTol : null));
    let tp = o.tp;
    if (r.state === 'placed') {
      const cur = idOk(tp.orderId) ? String(tp.orderId) : null;
      tp = { ...tp, orderId: r.orderId, prevIds: [...new Set([...prevOf(tp), ...(cur && cur !== r.orderId ? [cur] : [])])], pend: null };
    } else if (r.state === 'rejected' || (r.state === 'unknown' && r.hub === 'unknown' && r.none && now() - Number(p.at) >= PEND_DROP_MS)) {
      tp = { ...tp, pend: null };
    } else return { o, done: false };
    asked.delete(p.coid);
    await setTp(inst, o.mid, { orderId: idOk(tp.orderId) ? String(tp.orderId) : null, prevIds: prevOf(tp), pend: null });
    return { o: { ...o, tp }, done: true };
  }
  // 끝난 기록의 남은 익절 번호(tpLeft)에서 끝이 확인된 번호를 뺀다 — 비면 칸을 지움
  async function dropTpLeft(ids) {
    const gone = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!gone.size) return;
    await store.update((r) => {
      for (const e of r.ended) {
        if (!e || !Array.isArray(e.tpLeft)) continue;
        e.tpLeft = e.tpLeft.filter((id) => !gone.has(String(id)));
        if (!e.tpLeft.length) delete e.tpLeft;
      }
    });
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

  // 크기 계산(spec §5.3) — manual-quote.js로 옮김(계획 2026-10-22 작업 11 — 서버 판 수동 명령과 같은 계산). 잔고·종목 캐시는 이 실행기 것을 그대로 넘겨
  // 계산 결과가 옛 quoteRaw와 같다(시험 app-server-manual이 비교)
  const mq = createManualQuote({ call: mcall, rules, member, price, newMid, assets: () => exec.assets(), instOf, now });
  const quoteRaw = (args) => mq.quoteRaw(args);
  // 카드·시트를 열 때(큐 밖) — 던지지 않는다
  const quote = (args) => mq.quote(args);

  // 시장가 하나: 보냄 → 응답 번호(없으면 결과 모름 — 허브 기억 2·6·15초 → 모양 맞춤) → 체결 확인. 같은 주문을 다시 보내지 않는다.
  // sentAt = 보내기 전 줄의 at(모양 맞춤 시각), step = 종목 수량 단위(모양 맞춤 수량 폭).
  // 결과 state: filled·partial·adopted(체결) / unknown(체결 확인 결과 모름 — 번호는 앎) / failed(체결 0 — recheckUntil이 있으면 결과 모름에서 온 것) / not_sent(안 나간 것이 확실)
  async function sendOne({ inst, mid, method, params, coid, sentAt, step }) {
    const o = await mcall(method, params, { coid });
    exec.forget();
    let orderId = orderIdOf(o);
    let adopted = false;
    if (!o.ok && o.kind !== 'unknown' && o.kind !== 'duplicate') {
      if (o.kind === 'blocked') return { state: 'not_sent', reason: `blocked:${o.reason || 'off'}` };
      if (isHedgeModeError(o)) return { state: 'not_sent', reason: 'hedge_mode' }; // 배율이 이미 맞아 그 단계를 건너뛴 헤지 계정의 BOTH 주문 거절
      return { state: 'not_sent', reason: o.kind === 'ox' ? `ox:${o.code}` : String(o.kind || 'down') };
    }
    if (!orderId) {
      // 결과 모름(504·끊김·같은 식별자·200인데 번호 없음) — 줄을 unknown으로 먼저 저장(그 사이 앱이 꺼져도 다음에 허브 기억·모양으로 확인)
      await store.update((r) => {
        const y = r.open[inst];
        const f = y && y.mid === mid ? y.fills.find((x) => x.coid === coid) : null;
        if (f) f.state = 'unknown';
      });
      const r = await exec.resolvePlaced({ inst, coid, sentAt, side: method === '/private/buy' ? 'buy' : 'sell', reduce: false, qty: Number(params.amount), step, cond: null }, { waits: RECHECK_MS });
      asked.set(coid, now()); // 정리 주기는 그 뒤 15초 기다렸다 다시 묻는다
      if (r.state === 'rejected') { // 거래소가 거절한 것을 허브가 기억 — 안 나간 것이 확실(늦은 헤지 5147도 같은 판단, ox-errors 하나)
        return { state: 'not_sent', reason: isHedgeModeError({ kind: 'ox', code: r.code }) ? 'hedge_mode' : r.code != null ? `ox:${r.code}` : 'not_filled' };
      }
      if (r.state !== 'placed') return { state: 'failed', reason: 'unknown', recheckUntil: now() + LATE_RECHECK_MS };
      orderId = r.orderId;
      adopted = true;
    }
    const c = await exec.confirmFill(orderId);
    const st = c.state === 'unclear' ? 'unknown' : adopted && (c.state === 'filled' || c.state === 'partial') ? 'adopted' : c.state;
    return { state: st, qty: c.qty, price: c.price, orderId, reason: st === 'failed' ? 'not_filled' : st === 'unknown' ? 'unknown' : null };
  }
  // 보낸 줄에 결과를 적는다(같은 기록·같은 식별자만) — 체결이면 그 알림 기록(entryLog). 거래소 주문 번호도(filled·partial·adopted·unknown — 아는 번호)
  function applyFill(r, inst, mid, coid, f, symbol, entryLog) {
    const y = r.open[inst];
    const x = y && y.mid === mid ? y.fills.find((z) => z.coid === coid) : null;
    if (!x) return;
    if (FILLED.includes(f.state)) {
      Object.assign(x, { state: f.state, qty: num(f.qty) ?? x.qty, price: num(f.price), orderId: f.orderId ?? null });
      entryLog(y);
    } else if (f.state === 'unknown') {
      Object.assign(x, { state: 'unknown', orderId: f.orderId ?? null });
    } else if (f.state === 'failed' && f.recheckUntil) {
      Object.assign(x, { state: 'failed', recheckUntil: f.recheckUntil });
      log(r, '■', symbol, 'entry_fail', 'unknown');
    } else {
      Object.assign(x, { state: 'failed', qty: 0 });
      log(r, '■', symbol, 'entry_fail', f.reason || 'not_filled');
    }
  }
  // 격리·배율 맞추기 실패 → 사유. 헤지(양방향) 모드 계정(공용 판단 — 5147·글, 마진·배율 어느 단계든)이면 hedge_mode(원웨이 안내 창),
  // 배율 단계의 그 밖 거래소 거절은 'lev_denied:<거래소 코드>'(K-11에 코드를 붙임 — 코드를 모르면 lev_denied)
  const mlReason = (ml) => {
    const k = ml.fail && ml.fail.kind;
    if (k === 'blocked') return `blocked:${ml.fail.reason || 'off'}`;
    if (k === 'hidden') return 'hidden';
    if (isHedgeModeError(ml.fail)) return 'hedge_mode';
    if (ml.lev && k === 'ox') {
      const code = oxCodeOf(ml.fail);
      return code === null ? 'lev_denied' : `lev_denied:${code}`;
    }
    return 'margin_cfg';
  };

  // 익절 조건 주문(spec §5.5 익절가 변경·§5.6-2 cond 모드, 설계 2026-10-19 §4) — 새 것 먼저·옛 것 나중. 앞서 결과를 모른 익절(pend)이 있으면 그것부터
  // 풀고(다시 보내 둘이 되지 않게 — 못 풀면 아무것도 보내지 않고 unknown, 정한 것 8), 시도마다 k 증가(같은 식별자를 두 번 보내지 않음).
  // 보내기 전에 tp.pend(이름표·보낸 시각·보낸 수량 글자·보낸 익절 발동가 글자 trig — 최종 검토 중요 2)를 적고, 응답 번호(없으면 허브 기억 2·6·15초 → 모양 맞춤 — 발동가까지)가 미체결에
  // 보인 뒤에만 옛 번호(지금 것·취소 대기 것)를 번호로 취소·끝 확인. 새 것이 안 보이면 옛 것을 지우지 않는다(§4.3 — 다음 정리 주기가 본 뒤 취소). 맞춰졌으면 true
  async function placeTp(inst, o0, pos, spec, target) {
    let o = o0;
    if (o.tp && o.tp.pend) {
      const sp = await settleTpPend(inst, o, Math.abs(pos.size), spec);
      if (!sp.done) {
        await setTp(inst, o.mid, { state: 'unknown' });
        return false; // 모름(모양 둘·허브 기다리는 중·허브 error·60초 전) — 계획 정한 것 8
      }
      o = sp.o;
    }
    const tp0 = o.tp || { k: 0, state: 'none' };
    const cur = idOk(tp0.orderId) ? String(tp0.orderId) : null;
    let prev = prevOf(tp0);
    const k = (Number(tp0.k) || 0) + 1;
    const coid = coidFor(o.mid, `t${k}`);
    const sentAt = now();
    const amount = qtyStr(pos.size, spec);
    const trig = numStr(roundTo(target, spec.tick), spec.tick); // 보낼 익절 발동가 글자(아래 trigger_price와 같은 값 — 기록 tpPct로 셈한 익절가, 자동 손절가 아님)
    // 보내기 전에 적음 — 그 사이 앱이 꺼지거나 응답을 잃어도 다음에 허브·모양으로(보낸 수량·보낸 발동가까지 — 정한 것 22·최종 검토 중요 2). 번호 칸(orderId·prevIds)도 같이 —
    // 이 판이 만진 기록은 번호 칸이 있어 '번호 없는 옛 기록'(옛 판 — 정리 주기의 한 번 모양 맞춤)과 갈린다
    await setTp(inst, o.mid, { k, orderId: cur, prevIds: prev, pend: { coid, at: sentAt, qty: amount, trig } });
    const params = {
      instrument_name: inst, amount, type: 'market', position_side: 'BOTH', reduce_only: true, custom_order_id: coid,
      condition_type: 'IF_TOUCHED', trigger_price: trig, trigger_price_type: 2,
    };
    const r = await retrying(o.side === 'long' ? '/private/sell' : '/private/buy', params, { coid });
    exec.forget();
    let id = orderIdOf(r);
    if (!id && (r.ok || r.kind === 'unknown' || r.kind === 'duplicate')) { // 결과 모름(200인데 번호 없음 포함)
      const x = await exec.resolvePlaced(tpWant(o, inst, coid, sentAt, amount, null, spec, (q) => Math.abs(Number(q.trigger_price) - Number(params.trigger_price)) <= spec.tick / 2), { waits: RECHECK_MS });
      asked.set(coid, now());
      if (x.state === 'placed') id = x.orderId;
      else if (x.state !== 'rejected') {
        await setTp(inst, o.mid, { state: 'unknown' });
        return false; // 모름 — pend 그대로(정리 주기가 허브·모양으로)
      }
    }
    if (!id) {
      await setTp(inst, o.mid, { state: 'unknown', pend: null }); // 안 나간 것이 확실(거래소 거절·막힘·숨김)
      return false;
    }
    if (cur) prev = [...new Set([...prev, cur])];
    await setTp(inst, o.mid, { orderId: id, prevIds: prev, pend: null });
    if (!(await isOpen(inst, id))) {
      await setTp(inst, o.mid, { state: 'unknown' }); // 새 것이 확인되지 않음 — 옛 것을 지우지 않는다(§4.3)
      return false;
    }
    const c = await exec.cancelIds(inst, prev);
    await setTp(inst, o.mid, { prevIds: c.left, state: c.left.length ? 'unknown' : 'ok' });
    return c.left.length === 0;
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
      const before = (await openOf(inst, mid)) || rc.o; // 방금 건 익절 번호가 적힌 기록 — keeper가 닫으면 끝난 기록에는 익절 번호가 없다
      await H.afterFill(inst, { pos: rc.pos, mid });
      await afterKeeperEnd(inst, before); // keeper가 바로 정리했으면(auto_sl_now) 남은 익절 주문
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
      const oo = await exec.openOrders(inst); // ③-2 미체결(인자 없는 조회 — 조건 주문도 여기에, 실측 §2)
      if (!oo.ok) return fail('down');
      const sp = splitOpen(oo.list, await known());
      // 이 기기가 모르는 미체결(다른 기기·오렌지엑스 앱 — 우리 주문이어도 번호를 모름) — 진입하지 않고 아무것도 취소하지 않는다(설계 §3·Q2)
      if (sp.foreign.length) return fail('foreign_orders');
      // ③-3 포지션 없는데 남은 우리 주문(아는 번호 — 주인 무관, 계획 정한 것 12) → 번호로 취소·끝 확인, 하나라도 남으면 진입하지 않는다
      // (남은 reduce_only STOP·IF_TOUCHED는 새 같은 방향 포지션을 옛 발동가에서 닫는다). 끝난 기록의 tpLeft에서 끝난 번호를 뺀다
      if (sp.mine.length) {
        const c = await exec.cancelIds(inst, sp.mine.map((x) => String(x.order_id)));
        await dropTpLeft(c.done);
        if (c.left.length) return fail('stale_orders');
      }
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
          fills: [{ coid, kind: 'e1', pct: q.pctReal, state: 'sending', qty: q.qty, price: null, at, orderId: null }],
          tp: { k: 0, state: cnd ? 'none' : 'ok' }, autoSl: null, closing: null, notes: [], avg: null,
        };
      });
      if (clash) return fail('checking');
      // ⑥ 시장가 — 익절은 cond가 거짓일 때만 붙인다(참이면 체결 뒤 조건 주문, spec §5.6-2)
      const { method, params } = exec.orderParams(q.side, { inst, amount: q.amount, coid, tp: cnd ? null : q.tp, tick: q.tick });
      const f = await sendOne({ inst, mid: q.mid, method, params, coid, sentAt: at, step: q.step }); // ⑦
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
      // 격리·배율이 그대로인가 — 격리 판단은 follow-exec isIsolatedMargin 하나(실측 "isolate" — 2026-10-19, 'isolated'만 보면 늘 cfg_changed였다)
      const c = await mcall('/private/get_perpetual_user_config', { instrument_name: inst });
      if (!c.ok) return fail('down');
      if (!isIsolatedMargin(c.result && c.result.margin_type) || Number(c.result && c.result.leverage) !== o.lev) return fail('cfg_changed');
      const q = await quoteRaw({ symbol, side: o.side, tab: o.tab, pct, mid: o.mid, lev: o.lev });
      if (!q.ok) return q;
      if (!shown || changedTooMuch(shown.qty, q.qty) || changedTooMuch(shown.margin, q.margin)) return fail('changed', { quote: q });
      const cnd = condNow();
      const at = now();
      await store.update((r) => {
        const y = r.open[inst];
        if (y && y.mid === o.mid) y.fills.push({ coid, kind: `a${k}`, pct: q.pctReal, state: 'sending', qty: q.qty, price: null, at, orderId: null });
      });
      const avgNext = estAvg({ avg: Number(pos.avg), size: Math.abs(pos.size), px: q.px, qty: q.qty });
      const tp = cnd ? null : tpPrice({ avg: avgNext, dir: dirOf(o.side), lev: o.lev, tpPct: o.tpPct, tick: q.tick });
      const { method, params } = exec.orderParams(o.side, { inst, amount: q.amount, coid, tp, tick: q.tick });
      const f = await sendOne({ inst, mid: o.mid, method, params, coid, sentAt: at, step: q.step });
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

  // 포지션 0이 확인된 뒤(설계 §3 '정리 때 취소', 계획 정한 것 12): 그 매매의 익절 번호(지금·취소 대기 옛 것 — 결과 모를 pend가 풀리면 그 번호도) + 그 종목의
  // 끝난 매매에 남은 아는 번호(live false — 자동매매 끝난 매매의 익절·손절·자동 손절, 끝난 수동 기록의 tpLeft)를 번호로 취소·끝 확인(exec.cancelIds).
  // 살아 있는 다른 매매의 번호·모르는 번호는 건드리지 않는다. '남은' = 지금 인자 없는 미체결에 보이는 번호만(자동매매 장부 300줄의 끝난 번호까지 하나씩
  // 주문 상태를 묻지 않게 — 허브 토큰 한도 10초 40). 자동 손절 목록 항목은 keeper(H.afterClose → cancelFor·checkBeforeEntry)가.
  // 끝이 확인된 번호는 끝난 기록의 tpLeft에서 빼고, 그 매매 익절 번호 가운데 끝 확인이 안 된 것을 돌려준다(끝난 기록 tpLeft). pend: 결과 모를 익절을 먼저 풂
  async function cancelKnown(inst, o0, { pend = true } = {}) {
    let o = o0;
    if (pend && o && o.tp && o.tp.pend) {
      try {
        o = (await settleTpPend(inst, o, null, null)).o;
      } catch {
        // 못 풂 — 번호를 모르는 그 익절은 거래소에 남으면 다음 1차 진입의 '모르는 미체결' 검사가 막는다
      }
    }
    const mine = tpIdsOf(o);
    let c;
    try {
      const oo = await exec.openOrders(inst);
      const vis = new Set(oo.ok ? oo.list.map((x) => String(x.order_id)) : []);
      const dead = (await known()).ofInst(inst).filter((x) => x.live === false && x.role !== 'entry' && vis.has(x.id)).map((x) => x.id);
      c = await exec.cancelIds(inst, [...mine, ...dead]);
      exec.forget();
    } catch {
      return mine; // 기록을 못 읽음 — 그 매매 익절 번호는 남은 것으로(정리 주기가 다시)
    }
    try {
      await dropTpLeft(c.done);
    } catch {
      // 끝난 기록을 못 고침 — 다음 정리 주기가 같은 번호를 다시 확인(끝난 주문이라 취소 없이 끝)
    }
    return c.left.filter((id) => mine.includes(id));
  }
  // 끝난 기록에 남은 익절 번호(tpLeft — 가격 없음)·알림 기록 tp_left(처음 남을 때 한 번). 정리 주기가 다시 취소하고 끝이 확인된 번호를 뺀다(clearTpLeft)
  async function markTpLeft(mid, ids) {
    const left = (Array.isArray(ids) ? ids : []).filter(idOk).map(String);
    if (!left.length) return;
    await store.update((r) => {
      const w = findMid(r, mid);
      if (!w || w.inst) return;
      const e = r.ended[w.ended];
      const had = Array.isArray(e.tpLeft) ? e.tpLeft.filter(idOk).map(String) : [];
      e.tpLeft = [...new Set([...had, ...left])];
      if (!had.length) log(r, '■', e.symbol, 'tp_left');
    });
  }
  async function clearTpLeft(inst, mid, ids) {
    const c = await exec.cancelIds(inst, ids);
    await dropTpLeft(c.done);
  }
  // 옛 끝난 기록의 tpLeft true(번호 없음 — 주문 번호 추적 전): 다시 취소할 수 없어 지우고 알림 tp_left_check 한 줄(정한 것 10). 기록을 못 쓰면 다음 주기
  async function dropOldTpLeft(mid) {
    try {
      await store.update((r) => {
        const w = findMid(r, mid);
        if (!w || w.inst || r.ended[w.ended].tpLeft !== true) return;
        delete r.ended[w.ended].tpLeft;
        log(r, '■', r.ended[w.ended].symbol, 'tp_left_check');
      });
    } catch {
      // 다음 주기
    }
  }
  // keeper가 매매를 닫은 뒤(바로 정리 auto_sl_now·일부 체결 뒤 남은 수량 settlePartial) — 그 매매 익절 번호 취소·끝 확인(keeper의 closeTrade는
  // 따라가기 장부 다리 번호만 — 수동 익절 번호는 모름). 못 하면 끝난 기록에 tpLeft. o = 닫히기 전 기록(익절 번호가 적힌 것)
  async function afterKeeperEnd(inst, o) {
    if (!o || !(tpIdsOf(o).length || (o.tp && o.tp.pend))) return; // 조건 익절 번호가 없음(붙임 모드 등)
    const cur = (await store.read()).open[inst];
    if (cur && cur.mid === o.mid) return; // 아직 열림
    const left = await cancelKnown(inst, o);
    if (left.length) await markTpLeft(o.mid, left);
  }
  async function endRecord(inst, mid, end, tpLeft = []) {
    const left = (Array.isArray(tpLeft) ? tpLeft : []).filter(idOk).map(String);
    await store.update((r) => {
      const o = r.open[inst];
      if (!o || o.mid !== mid) return;
      const e = { mid: o.mid, inst: o.inst, symbol: o.symbol, side: o.side, lev: o.lev, openedAt: o.openedAt, closedAt: now(), end, resultPct: null, fills: stageOf(o), fillAts: fillAtsOf(o), autoSl: o.autoSl || null };
      if (!slCleanupPending(endedTrade(e))) e.autoSl = null; // 자동 손절 정리가 남았을 때만 넘긴다(keeper가 마저 취소)
      const ids = entryIdsOf(o);
      if (ids.length) e.entryIds = ids;
      if (left.length) e.tpLeft = left;
      r.ended.push(e);
      log(r, end === 'tp' ? '✅' : '■', o.symbol, `end_${end}`);
      if (left.length) log(r, '■', o.symbol, 'tp_left');
      delete r.open[inst];
    });
  }
  // 포지션 0이 확인된 뒤: 그 매매 익절 번호 + 그 종목 끝난 매매에 남은 아는 번호 취소(cancelKnown) → 갈고리 afterClose(기록이 열린 채 — 자동 손절) → 끝 close.
  // 그 매매 익절 번호 취소를 확인하지 못했으면 true(끝난 기록 tpLeft — 정리 결과에 tpLeft)
  async function finishClose(inst, o) {
    const left = await cancelKnown(inst, o);
    try {
      await H.afterClose(inst);
    } catch {
      // 남은 자동 손절은 끝난 기록의 정리 미완으로 keeper가
    }
    if (o) await endRecord(inst, o.mid, 'close', left);
    return !!o && left.length > 0;
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

  // 끝 판정(spec §5.5 끝 판정 2, 조사 5-1 — 번호로) — 포지션 0이 확인된 뒤(정리 주기·종목 큐 안).
  // ① 그 매매 자동 손절 번호의 주문 상태부터(p34 §2.8): filled면 그 매매 익절 번호 취소(cancelKnown) → keeper.closeGone(체결 값으로 결과 %·끝 sl·남은 자동 손절 끝 확인).
  // ② 익절 번호(지금·취소 대기 옛 것 + 결과 모를 pend가 풀리면 그 번호)의 주문 상태 — filled·partial이면 tp.
  // ③ 아니면 최근 기록 20건의 감소 전용 체결 가운데 번호가 익절 번호면 tp, 자동 손절 번호(autoSl.orderId·prevOrderId)면 sl, 그 밖 정리 요청 뒤 close·아니면 gone
  //   (이름표 꼬리는 읽지 않음 — 조회에는 이름표가 없음. 기록을 못 읽으면 끝내지 않고 다음 주기)
  // → 남은 번호 취소(cancelKnown) → 그 매매 자동 손절 끝 확인(keeper.cancelFor — 기록이 열린 채) → 끝(확인이 안 됐으면 끝난 기록에 정리 미완·tpLeft)
  async function endJudge(inst, o0) {
    let o = o0;
    const slId = keeper && o.autoSl && idOk(o.autoSl.orderId) ? String(o.autoSl.orderId) : null;
    if (slId) {
      const s = await exec.orderState(slId);
      if (s.ok && (s.state === 'filled' || s.state === 'partial')) {
        const left = await cancelKnown(inst, o);
        const cur = (await store.read()).open[inst];
        if (cur && cur.mid === o.mid) await keeper.closeGone(toTrade(cur));
        if (left.length) await markTpLeft(o.mid, left);
        return;
      }
    }
    o = (await settleTpPend(inst, o, null, null)).o;
    let end = null;
    for (const id of tpIdsOf(o)) {
      const s = await exec.orderState(id);
      if (s.ok && (s.state === 'filled' || s.state === 'partial')) {
        end = 'tp';
        break;
      }
    }
    if (!end) {
      const h = await retrying('/private/get_order_history_by_instrument', { instrument_name: inst, count: 20 });
      if (!h.ok || !Array.isArray(h.result)) return;
      const tps = new Set(tpIdsOf(o));
      const sls = new Set([o.autoSl && o.autoSl.orderId, o.autoSl && o.autoSl.prevOrderId].filter(idOk).map(String));
      const last = h.result
        .filter((x) => x && (x.reduce_only === true || x.reduce_only === 'true') && Number(x.filled_amount) > 0 && (tps.has(String(x.order_id)) || sls.has(String(x.order_id))))
        .sort((a, b) => (Number(b.last_update_timestamp) || 0) - (Number(a.last_update_timestamp) || 0))[0];
      end = last ? (tps.has(String(last.order_id)) ? 'tp' : 'sl') : o.closing ? 'close' : 'gone';
    }
    const left = await cancelKnown(inst, o, { pend: false }); // pend는 위에서 한 번 물음
    if (keeper) {
      const cur = (await store.read()).open[inst];
      if (cur && cur.mid === o.mid) await keeper.cancelFor(toTrade(cur), { final: 'done' });
    }
    await endRecord(inst, o.mid, end, left);
  }

  // 정리 주기가 익절을 ok로 적을 때(tpUpkeep ③④ — 늦게 보인 새 익절 RF5·결과 모를 익절 pend 채택) 기록 tpPct를 그 익절의 발동가로 맞춘다(진행 기록 작업 5
  // Ruling): 익절가 변경이 unknown·tp_fail로 끝나면 tpPct는 옛 값인데 거래소에는 새 익절이 남아, 그대로면 다음 체결 뒤(afterFill)·다시 걸기(retry)가
  // o.tpPct로 다음 익절가를 셈해 회원이 바꾼 익절 수준을 말없이 옛 %로 되돌린다(차트 익절 선 이름·추가 진입 시트 글도 어긋남). 발동가가 지금 평단·tpPct로 셈한
  // 값(afterFill·retry와 같은 식)과 tick/2 안이면 그대로(보통 확인 — 굵은 tick에서 0.1 반올림으로 흐르지 않게), 넘거나 tpPct가 없으면 pctAt 0.1 반올림
  // (changeTp와 같은 식). spec·발동가·평단을 모르면 건너뜀. ok는 지금 포지션을 덮을 때만이라 평단·수량이 바뀐 채택(Ruling C)은 옮기지 않는다 → { tpPct } | null
  function tpPctFix(o, pos, spec, order) {
    const trig = num(order && order.trigger_price);
    const avg = num(pos && pos.avg) ?? num(o.avg);
    if (!spec || !(trig > 0) || !(avg > 0)) return null;
    const dir = dirOf(o.side);
    if (Number.isFinite(o.tpPct) && Math.abs(trig - tpPrice({ avg, dir, lev: o.lev, tpPct: o.tpPct, tick: spec.tick })) <= spec.tick / 2) return null;
    const pct = Math.round(pctAt({ avg, dir, lev: o.lev, price: trig }) * 10) / 10;
    return Number.isFinite(pct) ? { tpPct: pct } : null;
  }

  // 정리 주기의 익절 맞추기(조건 주문 모드 — 새로 걸지 않음, 회원 '다시 걸기'만 건다): ① 결과 모를 익절(pend)을 허브 기억 → 모양 맞춤으로(같은 pend는 15초에
  // 한 번) ② 번호 없는 옛 기록(k > 0·번호·pend 없음)은 한 번 모양 맞춤 — 시각은 보지 않고(anyTime), tpPct·평단이 있으면 그 퍼센트로 계산한 발동가와
  // EXEC.tpslTol 안인 것만(정한 것 11·23 — 못 찾거나 둘 이상이면 unknown) ③ 지금 번호가 보이면 취소 대기 옛 번호(prevIds)를 번호로 취소·끝 확인
  // ④ 지금 번호가 안 보이면 unknown(옛 것을 지우지 않음 — 새 것이 늦게 보일 수 있음), 보이고 지금 포지션 수량을 덮으면 ok(번호로 확인되면 되돌림).
  // ③④가 ok를 적을 때는 같은 저장에서 tpPct를 그 익절 발동가로(tpPctFix — 작업 5 Ruling).
  // 지금 포지션을 덮지 않는 익절(늦게 채택된 추가 진입·pend 뒤 추가 진입 — 보낸 수량)은 unknown 그대로(다시 걸기로 전체 수량). 묻지 못하면 그대로
  async function tpUpkeep(inst, o0, pos, spec) {
    let o = o0;
    let tp = o.tp || { k: 0, state: 'none' };
    const unknown = () => (tp.state === 'unknown' ? null : setTp(inst, o.mid, { state: 'unknown' }));
    if (!(Number(tp.k) > 0 || idOk(tp.orderId) || tp.pend)) { // 조건 익절을 건 적 없음
      if (tp.state === 'ok') await unknown(); // 붙임 모드로 연 기록을 조건 모드에서 봄 — 거래소에 익절 조건 주문 없음(옛 동작 그대로)
      return;
    }
    const size = Math.abs(Number(pos.size));
    if (tp.pend) {
      const sp = await settleTpPend(inst, o, size, spec, { gap: true });
      if (!sp.done) {
        await unknown(); // 모름 — 새로 걸지 않음(정한 것 8)
        return;
      }
      o = sp.o;
      tp = o.tp;
    }
    if (!idOk(tp.orderId)) {
      // 번호 칸이 없는 옛 판 기록({ k, state }뿐 — 정한 것 11·23)만 한 번 모양 맞춤. 이 판의 기록인데 번호가 없으면(보내기 확정 실패·pend를 안 나감으로 놓음)
      // 걸린 익절이 없는 것 — unknown(회원 '다시 걸기'), 시각을 보지 않는 모양 맞춤으로 회원 익절을 잡지 않는다
      if (Array.isArray(tp.prevIds) || oldTried.has(o.mid) || !spec) {
        await unknown();
        return;
      }
      oldTried.add(o.mid);
      const avg = num(pos.avg) ?? num(o.avg);
      const p = Number.isFinite(o.tpPct) && avg > 0 ? tpPrice({ avg, dir: dirOf(o.side), lev: o.lev, tpPct: o.tpPct, tick: spec.tick }) : null;
      let coid = null;
      try {
        coid = coidFor(o.mid, `t${tp.k}`);
      } catch {
        // 식별자를 만들 수 없음 — 허브 기억 없이 모양만
      }
      const r = await exec.resolvePlaced({ ...tpWant(o, inst, coid, null, null, size, spec, p ? (x) => Math.abs(Number(x.trigger_price) - p) / p <= EXEC.tpslTol : null), anyTime: true });
      if (r.state !== 'placed') {
        await unknown();
        return;
      }
      await setTp(inst, o.mid, { orderId: r.orderId, prevIds: [] });
      tp = { ...tp, orderId: r.orderId, prevIds: [] };
    }
    const seen = await seeOrder(inst, String(tp.orderId));
    if (seen.v === null) return; // 묻지 못함 — 그대로
    if (!seen.v) {
      await unknown();
      return;
    }
    const a = Number(seen.order && seen.order.amount);
    const covers = Number.isFinite(a) && Math.abs(a - size) < (spec ? spec.step : 1e-9) / 2;
    const prev = prevOf(tp);
    if (prev.length) {
      const c = await exec.cancelIds(inst, prev);
      const ok = !c.left.length && covers;
      await setTp(inst, o.mid, { prevIds: c.left, state: ok ? 'ok' : 'unknown' }, ok ? tpPctFix(o, pos, spec, seen.order) : null);
      return;
    }
    if (tp.state !== 'ok' && covers) await setTp(inst, o.mid, { state: 'ok' }, tpPctFix(o, pos, spec, seen.order));
  }

  // 한 종목 맞추기(정리 주기 — 종목 큐 안): 확인 중 줄 → 포지션 → 끝 판정 / 재확인 → 익절 맞추기(tpUpkeep) → 갈고리 reconcileTail(자동 손절).
  // 확인 중 줄: 번호가 있으면 그 번호의 주문 상태(허브·기록 조회 없이 — 설계 §5.3), 없으면 허브 기억 → 모양 맞춤(한 번, 같은 줄은 15초에 한 번 — 정한 것 4).
  // light(가벼운 주기·스위치 적용): 익절 맞추기만 건너뛴다 — 확인 중 줄·재확인·끝 판정·자동 손절 맞추기(보조 감시 포함)는 같다
  async function reconcile(inst, { light = false } = {}) {
    const o0 = (await store.get()).open[inst];
    if (!o0) return;
    for (const f of o0.fills.filter((x) => checking(x))) {
      let id = idOk(f.orderId) ? String(f.orderId) : null;
      let rejected = false;
      if (!id) {
        if (!askNow(f.coid)) continue; // 15초 안에 물었음 — 다음 주기
        const spec = await instOf(inst);
        const r = await exec.resolvePlaced({ inst, coid: f.coid, sentAt: Number(f.at), side: o0.side === 'long' ? 'buy' : 'sell', reduce: false, qty: Number(f.qty), step: spec ? spec.step : 0.001, cond: null });
        if (r.state === 'net') continue; // 조회 실패 — 그대로
        if (r.state === 'placed') id = r.orderId;
        else if (r.state === 'rejected') rejected = true;
      }
      const s = id ? await exec.orderState(id) : null;
      if (s && !s.ok && f.orderId === id) continue; // 상태 조회 실패 — 그대로
      const st = s && s.ok ? s.state : null;
      const cnd = condNow();
      let settled = false;
      await store.update((x) => {
        const y = x.open[inst];
        const g = y && y.mid === o0.mid ? y.fills.find((z) => z.coid === f.coid) : null;
        if (!g || !checking(g)) return;
        if (id) g.orderId = id;
        if (st === 'filled' || st === 'partial') {
          // 늦게 찾은 체결 — 채택. 익절은 다시 걸기(조건 주문 모드), 자동 손절은 갈고리가 판정
          Object.assign(g, { state: 'adopted', qty: num(s.order.filled_amount), price: num(s.order.average_price) ?? g.price });
          delete g.recheckUntil;
          if (cnd) y.tp = { ...(y.tp || { k: 0 }), state: 'unknown' };
          if (g.kind === 'e1') log(x, '▶', y.symbol, 'entry1', { side: y.side, price: g.price });
          else log(x, '▶', y.symbol, 'add', { stage: stageOf(y) });
          settled = true;
        } else if (st === 'failed' || rejected) { // 체결 없이 끝남·거래소가 거절한 것을 허브가 기억 — 안 나감
          Object.assign(g, { state: 'failed', qty: 0 });
          delete g.recheckUntil;
          settled = true;
        } else if (!id && g.state !== 'failed') {
          g.state = 'failed';
          g.recheckUntil = now() + LATE_RECHECK_MS;
        } // 미체결(open)·모르는 상태·모름(5분 안)은 그대로 — 다음 주기
      });
      if (settled) asked.delete(f.coid);
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
    // 익절이 거래소에 있는지(번호로) — 자동으로 다시 걸지 않는다(회원이 오렌지엑스 앱에서 지웠을 수 있음, M-30 + 다시 걸기)
    if (!light && condNow()) await tpUpkeep(inst, rc.o, rc.pos, await instOf(inst));
    const before = (await openOf(inst, rc.o.mid)) || rc.o; // 익절 번호가 적힌 지금 기록(keeper가 닫으면 끝난 기록에는 익절 번호가 없다)
    await H.reconcileTail(inst, { pos: rc.pos, mid: rc.o.mid });
    await afterKeeperEnd(inst, before); // keeper 보조 감시가 바로 정리했으면(auto_sl_now) 남은 익절 주문
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
    // 익절 번호 취소를 확인하지 못한 끝난 기록(tpLeft — 남은 번호 목록, 검토 2) — 종목 큐 안에서 번호로 다시 취소·끝 확인.
    // 옛 기록의 tpLeft true(번호 없음)는 다시 취소할 수 없어 지우고 알림 tp_left_check 한 줄(정한 것 10 — 받침은 다음 1차 진입의 '모르는 미체결' 검사)
    for (const e of rec.ended) {
      if (!e || typeof e.symbol !== 'string' || typeof e.inst !== 'string' || typeof e.mid !== 'string') continue;
      if (e.tpLeft === true) await dropOldTpLeft(e.mid);
      else if (Array.isArray(e.tpLeft) && e.tpLeft.length) await queue.run(e.symbol, guard(() => clearTpLeft(e.inst, e.mid, e.tpLeft)), { wait: false });
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
        const before = (await openOf(inst, o.mid).catch(() => null)) || o; // 방금 건 익절 번호가 적힌 기록
        if (['unclear', 'failed', 'sending'].includes(slOf(toTrade(o)).state)) await keeper.retry(o.mid);
        else await keeper.ensure(o.mid, { pos: rc.pos });
        await afterKeeperEnd(inst, before);
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
