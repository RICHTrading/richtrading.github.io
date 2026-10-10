// 따라가기 엔진(설계 3-2 §6) — 휴대폰에서, 앱이 화면에 켜져 있을 때만. 회원 송출(실시간 'stream'만)을 받아 ② 자동 / ③ 한 번 눌러 주문.
// 들어오는 것: onFeed(회원 송출 스냅샷 — state·follow·rehearsal), onEvent(회원 이벤트, source 붙음), setVisible, setMember, keysChanged.
// 나가는 것: onChange(state()) — 화면(#follow·시트·띠·설정 줄·트레이딩 탭 ⚡ 오토 모드 줄·최근 매매 흐름의 '놓친 신호')이 그린다.
// - 주문 하나마다 G1~G8(follow-core gateIncrease). 실제 신호인데 follow.shadow면 주문 없이 낼 주문만 기록(그림자 실행, §6.4).
// - 같은 종목의 동작은 한 줄(queue) — 앞 동작의 체결·포지션 확인이 끝난 뒤 다음(§6.6). 앱은 트레이딩 탭 수동 주문과 같은
//   공용 종목 큐(symbol-queue.js, 창 사이 Web Locks)를 넘긴다(p40) — 없으면 엔진 자체 큐.
// - 종료는 그 id의 끝 이벤트를 받았을 때만(endVerdict). open[]에서 사라진 것만으로는 주문하지 않는다.
// - 리허설은 리허설 목록·이벤트로만, 실제는 회원 목록·이벤트로만(§6.6 끝). 리허설은 follow.shadow와 무관하게 주문한다(시험 토큰만 받음).
// - 정리 주기·앱을 켤 때 확인은 follow-upkeep.js(makeUpkeep — 엔진 손잡이 inner를 받는다).
// - 같은 판의 탭은 기기 장부(IndexedDB) 하나를 같이 쓴다: 장부로 판단하기 전마다 저장소에서 다시 읽고(refresh), 탭 잠금(Web Locks)을 못 잡은
//   탭은 장부를 읽기만 한다(쓰기·정리·정리 주기 없음 — 10-02 "탭 두 개" 사고, §5.1).
import { decide, timeCheck, followLive, gateIncrease, gateReduce, deviceDeadline, feedHealth, lateCloseMode, hourlyOk, positionVerdict, END_KINDS, ORDER_KINDS } from './follow-core.js';
import { chooseLev, baseFrom, marginFor, qtyFor, tpslFor, slipCheck, dirOf, TRADE_ID_RE, coidFor } from './follow-math.js';
import { normalizeSettings, validateSettings, consentNeeded, makeConsent, summaryLine } from './follow-settings.js';
import { createExec } from './follow-exec.js';
import { acquireTabLock } from './follow-lease.js';
import { FTEXT } from './follow-text.js';
// p34 자동 손절(설계 §2) — 스위치 kv.autoSl(계정 전체·기본 켜짐)·기기 주문 목록 kv.autoSlOrders·맞추기(follow-autosl). 4차 진입 뒤에만, 손절가는 어디에도 두지 않는다.
// 따라가기가 꺼져 있어도 화면에 보이는 동안 30초마다 가벼운 주기(slTick)가 자동 손절만 맞춘다(§2.13 — 위험을 줄이는 호출만, 회차마다 탭 잠금).
import { createAutoSlSwitch } from './auto-sl-switch.js';
import { createAutoSlOrders } from './auto-sl-orders.js';
import { createAutoSlKeeper, bumpStage, stageFromState, slOf, slCleanupPending, SL_LIVE } from './follow-autosl.js';
import { AUTO_SL, AUTO_SL_TEXT, autoSlWord } from './auto-sl.js';

export const LOOP_MS = 30000;
export const INSTRUMENTS_TTL_MS = 3600000;
export const SEEN_MAX = 2000; // 처리한 이벤트 키(넘으면 최근 1000개만)
const SHEET_KINDS = Object.freeze(['entry', 'dca', 'adjust', 'close']);
const LIVE_STATES = Object.freeze(['open', 'opening', 'closing']);
// F-20 '내 포지션 정리'가 세는·정리하는 매매 — 따라가기로 연 포지션이 남아 있을 수 있는 상태 전부(회원이 바꾼 포지션은 closeTrade가 닫지 않음)
export const CLEANUP_STATES = Object.freeze(['open', 'opening', 'closing', 'unclear', 'detached']);

const hms = (ms) => {
  const d = new Date(ms + 9 * 3600000);
  return [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};
const evKey = (ev) => (ev.rehearsal ? `r|${ev.id}|${ev.kind}|${ev.rseq}` : `s|${ev.seq}`);
// 트레이딩 탭 최근 매매 흐름의 항목 번호(auto-view memberViewModel: 송출 seq, 리허설 'r<rseq>')
export const flowKeyOf = (ev) => (ev.rehearsal ? `r${ev.rseq}` : String(ev.seq));

export function createFollowEngine({
  config,
  rules,
  store,
  getClient = () => null, // ox-client(keys.client()) — call·price·watchTicker·probeLeverage
  keys = { ready: () => false, status: () => 'none' },
  lease = null,
  getMember = () => null,
  loadInstruments = async () => [],
  makeExec = (opts) => createExec(opts),
  makeUpkeep = null,
  acquireLock = () => acquireTabLock(),
  now = () => Date.now(),
  timers = globalThis,
  sleep = (ms) => new Promise((r) => timers.setTimeout(r, ms)),
  subtle = globalThis.crypto && globalThis.crypto.subtle,
  vibrate = () => {},
  onChange = () => {},
  slSwitch = null, // 자동 손절 스위치(auto-sl-switch) — 없으면 store.vault로 만든다
  slOrders = null, // 기기 자동 손절 주문 목록(auto-sl-orders)
  makeChannel = undefined, // BroadcastChannel 만들기(시험이 바꿔 끼움)
  // 공용 종목 큐(symbol-queue.js — 트레이딩 탭 수동 주문과 같은 것, Web Locks로 창 사이도 한 줄). 없으면 엔진 자체 큐(지금까지 그대로).
  // Web Locks는 다시 들어갈 수 없다 — 큐 안의 동작에서 같은 종목 enqueue·keeper.sweep(종목마다 enqueue)을 기다리지 않는다(지금도 그렇다)
  queue = null,
}) {
  let settings = rules ? normalizeSettings(null, rules).settings : null;
  let rulesChanged = false;
  let consentChanged = false; // 켜져 있었는데 지금 동의 문구 판·설정에 맞는 동의 기록이 없음 — 꺼 두고 #follow에 다시 확인 안내
  let consents = [];
  let running = false; // 켜져 있고 화면에 보여 임대·잠금을 쥔(쥐려는) 동안
  let visible = true;
  let snap = null;
  let lock = null;
  let otherTab = false;
  let moved = false; // event: follow other_device — F-19
  // 이 기기로 옮긴(force)·다시 시작한 시각 — 그 전에 받은 other_device는 스냅샷에 남아 있어도 다시 F-19를 켜지 않는다
  // (허브는 새 보유 기기에는 아무것도 보내지 않아 옛 follow가 다음 heartbeat까지 남는다, 검토 2026-10-08)
  let forcedAt = -Infinity;
  let probeNote = null; // 'lev_denied' — K-11
  let probePending = false; // 켤 때 배율 권한 확인을 못 함(허브가 막음·임대 없음 등) — 다음에 보일 때 다시
  let lastError = null;
  let loop = null;
  let instCache = { at: 0, items: [] };
  let rehSeen = new Set();
  let seenEpoch = null;
  let chain = Promise.resolve();
  const trades = new Map();
  const seen = new Set();
  const endedReal = new Set();
  const endedReh = new Set();
  const endEvents = new Map();
  const sheets = new Map();
  const missed = new Set();
  const orderTimes = [];
  const queues = new Map();
  // ── 자동 손절 화면 상태(저장소에서 읽어 둔 사본 — state()는 동기라 여기서 그린다. 판단은 늘 저장소 값으로) ──
  let slView = { on: !(rules && rules.follow && rules.follow.autoSl && rules.follow.autoSl.default === false), listed: false, listedType: null, entries: [] };
  let slApplying = null; // 스위치 적용 중(연타 막기 — §2.2-7)
  let slSetAt = -Infinity;
  let slToast = null; // { text, at } — '자동 손절을 켰습니다/껐습니다'
  let slDiag = null; // 시험 토큰 진단(가격 없음)
  let slRun = null; // 가벼운 주기 한 회차(잠금을 잡고 놓는 동안)
  let slLoop = null;
  const slCheck = new Set(); // 이전 자동 손절을 확인하지 못해 새 진입을 막은 종목
  // 받은 이벤트의 신호 차수(매매 id → 최대 stage) — 따라가기가 꺼져 있어도 실시간 이벤트는 오므로 가벼운 주기가 쓴다(회원 상태 스냅샷은 확인 주기에만 새로워짐).
  // 메모리에만 — 장부에는 탭 잠금을 쥔 회차에서만 저장한다
  const evStage = new Map();
  const afterStage = rules && rules.follow && rules.follow.autoSl ? rules.follow.autoSl.afterStage : 4;

  const client = () => getClient();
  const exec = makeExec({
    call: (m, p, o) => (client() ? client().call(m, p, o) : Promise.resolve({ ok: false, kind: 'nokey' })),
    now,
    sleep,
    onOrder: () => { orderTimes.push(now()); },
    cond: !!(config.oxTpsl && config.oxTpsl.cond === true),
  });
  const member = () => getMember();
  const st = () => (snap && snap.state && typeof snap.state === 'object' ? snap.state : null);
  let stateRef = null; // 마지막으로 받은 회원 상태 객체
  let stateAt = null; // 그것을 받은 이 기기 시각(follow-core endVerdict stateAt)
  const followCfg = () => (st() && st().follow && typeof st().follow === 'object' ? st().follow : null);
  const symbols = () => {
    const f = followCfg();
    return f && Array.isArray(f.symbols) ? f.symbols.filter((s) => typeof s === 'string' && /^[A-Z0-9]{1,20}$/.test(s)) : [];
  };
  const openTrades = () => [...trades.values()].filter((t) => LIVE_STATES.includes(t.state));
  const live = () => followLive(snap && snap.follow, now());
  const offset = () => (lease && Number.isFinite(lease.offset()) ? lease.offset() : null);
  // 'held' | 'refused' | 'checking'(follow-lease status — 없는 옛 모양이면 보유/거절로만)
  const leaseStatus = () => (!lease ? 'held' : typeof lease.status === 'function' ? lease.status() : lease.held() ? 'held' : 'refused');
  const emit = () => onChange(state());

  // 켜져 있는데 지금 동의 문구 판(CONSENT_VERSION)·규칙 판·설정에 맞는 동의 기록이 없음
  const consentGone = () => !!(settings && settings.on && rules && consentNeeded(consents, { rulesVersion: rules.rulesVersion, mode: settings.mode, settings }) !== 'none');

  // 장부 쓰기 — 탭 잠금을 못 잡은 탭은 쓰지 않는다(같은 기기 장부를 잠금 쥔 탭만 고친다).
  // 신호 차수(sigStage)는 내려가지 않게 — 옛 사본으로 쓴 줄이 큐 안에서 올린 값을 덮지 않게(p34 §2.3)
  async function save(t0) {
    if (otherTab) return;
    let t = t0;
    const prev = trades.get(t.id);
    if (prev && Number.isInteger(prev.sigStage) && !(Number.isInteger(t.sigStage) && t.sigStage >= prev.sigStage)) t = { ...t, sigStage: prev.sigStage };
    trades.set(t.id, t);
    await store.putTrade(t);
  }
  // 장부로 판단하기 바로 전에 저장소에서 다시 읽는다(같은 판 다른 탭이 고쳤을 수 있음)
  async function refresh(id) {
    if (id == null) return null;
    try {
      const cur = await store.trade(id);
      if (cur) trades.set(id, cur);
    } catch {
      // 읽기 실패 — 메모리 사본 그대로
    }
    return trades.get(id) || null;
  }
  const frozenOf = (ev) => {
    const s = st();
    return !ev.rehearsal && !!(s && Array.isArray(s.open) && s.open.some((o) => o && o.id === ev.id && o.frozen === true));
  };
  // 같은 종목 한 줄. 동작이 던지면 lastError(진단 줄 — 두 길 같음)·결과 undefined, 아니면 동작 결과 그대로(confirmSheet가 돌려줌). 던지지 않는다
  // (route는 기다리지 않고 부른다). 공용 큐는 던진 동작을 { error }로 돌려주고, 큐 자체의 거절(잠금 요청 실패 등)도 lastError로
  function enqueue(symbol, fn) {
    const diag = (e) => { lastError = String(e && e.message ? e.message : e); };
    if (queue) return queue.run(symbol, fn).then((r) => { if (r && r.error) diag(r.error); return r && r.error ? undefined : r; }, (e) => { diag(e); return undefined; }).finally(() => slSync());
    const prev = queues.get(symbol) || Promise.resolve();
    const next = prev.then(fn, fn).catch((e) => { lastError = String(e && e.message ? e.message : e); }).finally(() => slSync());
    queues.set(symbol, next);
    return next;
  }

  // ── 자동 손절(p34) — 스위치·기기 목록·맞추기 ──
  const sw = rules ? slSwitch || createAutoSlSwitch({ vault: store.vault, rules, edition: config.edition, now, makeChannel }) : null;
  const slList = rules ? slOrders || createAutoSlOrders(store.vault) : null;
  // 화면 사본을 저장소에서 다시 읽고 그린다(가격 없음)
  async function refreshSl() {
    if (!sw) return;
    try {
      const s = await sw.read();
      slView = { on: s.on, listed: s.listed, listedType: s.listedType, entries: await slList.list() };
    } catch {
      // 읽기 실패 — 옛 사본
    }
  }
  function slSync() {
    return refreshSl().then(() => emit(), () => emit());
  }
  const keeper = rules ? createAutoSlKeeper({
    exec,
    sw,
    orders: slList,
    rules,
    refresh: (id) => refresh(id),
    save: (t) => save(t),
    now,
    instruments: () => instruments(),
    reduceOk: () => reduceOk(),
    markOf: (inst) => {
      const c = client();
      return c && typeof c.markPrice === 'function' ? c.markPrice(inst) : null;
    },
    isTest: () => !!(member() && member().test === true),
    setDiag: (d) => { slDiag = d; },
    markCheck: (inst, on) => { if (on) slCheck.add(inst); else slCheck.delete(inst); },
    enqueue: (symbol, fn) => enqueue(symbol, fn), // 목록 정리가 종목마다 그 종목 큐 안에서(p35 F-2)
  }) : null;
  async function instruments() {
    if (now() - instCache.at < INSTRUMENTS_TTL_MS && instCache.items.length) return instCache.items;
    try {
      const items = await loadInstruments();
      if (Array.isArray(items) && items.length) instCache = { at: now(), items };
    } catch {
      // 지난 값 그대로
    }
    return instCache.items;
  }

  function gates() {
    return {
      member: !!member(),
      on: running && !!settings && settings.on === true,
      lease: !!lease && lease.held() && !moved, // other_device를 받으면 다음 갱신 전이라도 바로 G2 거짓
      live: live(),
      visible,
      lock: !otherTab,
      keys: keys.ready(),
      hourly: hourlyOk(orderTimes, now()),
      inst: true, // 종목은 계산에서(planFor — no_inst)
      clock: offset() != null,
    };
  }
  const reduceOk = () => !gateReduce({ member: !!member(), grace: keys.status() === 'cleanup', visible, lock: !otherTab, keys: keys.ready() });
  const cleanupList = () => [...trades.values()].filter((t) => CLEANUP_STATES.includes(t.state));

  // ── 자동 손절 화면 상태(§2.9) — 가격·거리 없음, 상태 낱말만 ──
  function slState() {
    const entries = slView.entries || [];
    const pendingIds = new Set(entries.map((x) => x.tradeId));
    const live = [...trades.values()].filter((t) => SL_LIVE.includes(t.state));
    const m = member();
    return {
      on: slView.on,
      busy: !!slApplying && now() - slSetAt < AUTO_SL.busyMs,
      toast: slToast && now() - slToast.at < AUTO_SL.busyMs ? slToast.text : null,
      turningOff: !slView.on && entries.length > 0,
      offLocked: !m && keys.status() === 'cleanup',
      pending: entries.length,
      followOff: !(settings && settings.on) && live.length > 0,
      checkNeeded: [...slCheck],
      retry: live.filter((t) => ['unclear', 'failed'].includes(slOf(t).state)).map((t) => t.id),
      failed: live.some((t) => slOf(t).state === 'failed'),
      diag: m && m.test === true && slDiag ? AUTO_SL_TEXT.diag(slDiag) : null,
      words: Object.fromEntries(live.map((t) => [t.id, autoSlWord(t, { on: slView.on, afterStage, pending: pendingIds.has(t.id) })])),
    };
  }
  // ── 회원 본인 손익(§4) — 이 기기 장부의 끝난 매매 합계(리허설 따로)·열린 매매 평가(표시가 — 저장 안 함). 모르면 null ──
  const markOf = (inst) => {
    const c = client();
    return c && typeof c.markPrice === 'function' ? c.markPrice(inst) : null;
  };
  function evalOf(t) {
    const px = markOf(t.inst);
    if (!(px > 0) || !(t.avg > 0) || !(t.size > 0)) return null;
    return Math.round(dirOf(t.side) * (px - t.avg) * t.size * 100) / 100;
  }
  function pnlView() {
    const all = [...trades.values()];
    const sum = (list) => {
      const known = list.filter((t) => Number.isFinite(t.pnlUsdt));
      return { n: list.length, sum: Math.round(known.reduce((a, t) => a + t.pnlUsdt, 0) * 100) / 100, unknown: list.length - known.length };
    };
    const closed = all.filter((t) => t.state === 'closed' && Array.isArray(t.fills) && t.fills.some((f) => ['filled', 'partial', 'adopted'].includes(f.state)));
    const live = all.filter((t) => ['open', 'unclear', 'closing'].includes(t.state));
    // 열린 매매 평가 — 실제와 리허설을 섞지 않는다(p35 F-6, 설계 §4.3 '리허설은 합계에 섞지 않는다'). 하나라도 모르면 null
    const evalSum = (list) => {
      const evals = list.map(evalOf);
      return list.length && evals.every((v) => v != null) ? Math.round(evals.reduce((a, v) => a + v, 0) * 100) / 100 : null;
    };
    const open = live.filter((t) => !t.rehearsal);
    const rOpen = live.filter((t) => t.rehearsal);
    return {
      done: sum(closed.filter((t) => !t.rehearsal)),
      rehearsal: sum(closed.filter((t) => t.rehearsal)),
      openN: open.length,
      open: evalSum(open),
      rehearsalOpenN: rOpen.length,
      rehearsalOpen: evalSum(rOpen),
    };
  }
  // 트레이딩 탭 열린 포지션 카드의 '내 따라가기' 줄(§4.3) — 매매 id → { state, word, eval, pnl, resultPct } (가격 없음)
  function mineView() {
    const pendingIds = new Set((slView.entries || []).map((x) => x.tradeId));
    const out = {};
    for (const t of trades.values()) {
      if (!t || !t.id || ['skipped', 'shadow', 'new'].includes(t.state)) continue;
      out[t.id] = {
        state: t.state,
        word: autoSlWord(t, { on: slView.on, afterStage, pending: pendingIds.has(t.id) }),
        eval: ['open', 'unclear', 'closing'].includes(t.state) ? evalOf(t) : null,
        pnl: Number.isFinite(t.pnlUsdt) ? t.pnlUsdt : null,
        resultPct: Number.isFinite(t.resultPct) ? t.resultPct : null,
      };
    }
    return out;
  }

  // ── 상태 줄(F-08) ──
  function status() {
    if (!settings || !settings.on) return { key: 'off', text: FTEXT.stOff, tone: 'dim' };
    const ks = keys.status();
    if (!member() && ks === 'cleanup') return { key: 'cleanup', text: FTEXT.stCleanup, tone: 'warn' };
    if (ks === 'bad' || ks === 'lost') return { key: 'key', text: FTEXT.stKey, tone: 'bad' };
    if (!visible) return { key: 'hidden', text: FTEXT.stHidden, tone: 'warn' };
    const f = snap && snap.follow;
    if (f && f.enabled === false && (f.reason === 'off' || f.reason === 'hold')) return { key: 'halted', text: FTEXT.stHalted, tone: 'bad' };
    if (f && f.enabled === false && f.reason === 'app_version') return { key: 'update', text: FTEXT.stUpdate, tone: 'bad' };
    if (moved) return { key: 'moved', text: FTEXT.stOther, tone: 'warn' };
    if (otherTab) return { key: 'otherTab', text: FTEXT.stOtherTab, tone: 'warn' }; // 같은 브라우저의 다른 창(탭) — 옮기기로 풀리지 않음
    // 임대(p40): 허브가 holder:false로 답했을 때만 '다른 기기'(F-17·옮기기). 아직 답이 없거나·실패·오래된 답이면 '연결 확인 중'(주문은 똑같이 막힘 — G2 = held()).
    // 키 해제로 엔진이 멈춰 임대를 놓았으면(돌지 않음 + 키 준비 안 됨) 임대가 아니라 거래소 연결 줄로(다시 확인하는 임대가 없음 — p40 검토)
    if (lease && !lease.held() && (running || keys.ready())) return leaseStatus() === 'refused' ? { key: 'other', text: FTEXT.stOther, tone: 'warn' } : { key: 'checking', text: FTEXT.stChecking, tone: 'warn' };
    if (!keys.ready()) return { key: 'exchange', text: FTEXT.stExchange, tone: 'warn' };
    if (!live().ok) return { key: 'server', text: FTEXT.stServer, tone: 'warn' };
    if (!hourlyOk(orderTimes, now())) return { key: 'rate', text: FTEXT.stRate, tone: 'warn' };
    const at = f && Number.isFinite(f.receivedAt) ? f.receivedAt : now();
    return { key: 'on', text: settings.mode === 'tap' ? FTEXT.stTapOn(hms(at)) : FTEXT.stOn(hms(at)), tone: 'good' };
  }
  function state() {
    const s = status();
    const cleanupN = !member() && keys.status() === 'cleanup' ? cleanupList().length : 0;
    return {
      ready: !!rules,
      rules,
      autoSl: slState(),
      pnl: pnlView(),
      mine: mineView(),
      settings,
      rulesChanged,
      consentChanged,
      consents: consents.slice(),
      durable: store.durable(),
      on: !!(settings && settings.on),
      mode: settings ? settings.mode : null,
      status: s,
      halted: s.key === 'halted',
      update: s.key === 'update',
      other: s.key === 'other',
      checking: s.key === 'checking',
      otherTab: s.key === 'otherTab',
      moved: s.key === 'moved',
      cleanup: cleanupN,
      band: s.key === 'on' && settings.mode === 'auto' && visible,
      sheets: [...sheets.values()].sort((a, b) => a.at - b.at),
      trades: [...trades.values()],
      missed: new Set(missed),
      shadow: !!(snap && snap.follow && snap.follow.shadow === true),
      symbols: symbols(),
      lev: (st() && Array.isArray(st().open) && st().open[0] && Number.isInteger(st().open[0].lev)) ? st().open[0].lev : 50,
      probeNote,
      lastError,
      leaseHeld: !!lease && lease.held(),
    };
  }

  // ── 계산(§6.5) — 시트 미리보기와 실제 주문이 같이 쓴다 ──
  async function planFor(ev, trade, kind) {
    const items = await instruments();
    const ins = items.find((x) => x && x.inst === (ev.inst || `${ev.symbol}-USDT-PERPETUAL`) && x.active === true) || null;
    if (!ins) return { skip: 'no_inst' };
    const c = client();
    if (c && typeof c.watchTicker === 'function') c.watchTicker(ins.inst);
    const px = c && typeof c.price === 'function' ? c.price(ins.inst) : null;
    if (!(px > 0)) return { skip: 'no_price', ins };
    const dir = dirOf(ev.side);
    if (!dir) return { skip: 'bad_signal', ins };
    if (kind === 'adjust') {
      const t = tpslFor({ dir, avg: trade.avg, signalLev: trade.signalLev || ev.lev, lev: trade.lev, tpPct: ev.tpPct, slPct: ev.slPct, tick: ins.tick, px });
      return { ins, px, target: { tp: t.tp, sl: t.sl }, notes: t.notes };
    }
    // 신호 가격 대조 2%(bad_signal) — 데이터 오류 막기. 회원 '가격 차이 한도'는 없다(p34 §3)
    const sc = slipCheck({ px, price: ev.price });
    if (sc.reason === 'bad_signal') return { skip: 'bad_signal', ins };
    let lev;
    let base;
    let used = 0;
    if (kind === 'entry') {
      const L = chooseLev(ev.lev, ins.maxLev, Number.isInteger(config.oxMaxLev) ? config.oxMaxLev : 50);
      if (L.skip) return { skip: L.skip, ins };
      lev = L.lev;
    } else {
      lev = trade.lev;
      base = trade.base;
      used = trade.fills.filter((f) => ['filled', 'partial', 'adopted'].includes(f.state)).reduce((a, f) => a + (Number(f.margin) || 0), 0);
    }
    const a = await exec.assets();
    if (!a.ok || !a.view) return { skip: 'low_balance', ins };
    if (kind === 'entry') {
      const f = followCfg();
      const b = baseFrom(a.view, { test: !!(member() && member().test), maxBase: f && f.limits ? f.limits.maxBase : null });
      if (b.skip) return { skip: b.skip, ins };
      base = b.base;
    }
    const m = marginFor({ base, weightPct: ev.weightPct, mult: rules.follow.weightMultiplier, capPct: settings.maxMarginPct, used, available: a.view.available });
    if (m.skip) return { skip: m.skip, ins };
    const q = qtyFor({ margin: m.margin, lev, px, step: ins.step, minQty: ins.minQty, minNotional: ins.minNotional });
    if (q.skip) return { skip: q.skip, ins };
    const avg = kind === 'entry' ? px : (trade.size * trade.avg + q.qty * px) / (trade.size + q.qty);
    const t = tpslFor({ dir, avg, signalLev: ev.lev, lev, tpPct: ev.tpPct, slPct: ev.slPct, tick: ins.tick, px });
    return { ins, px, lev, base, margin: m.margin, qty: q.qty, amount: q.amount, tp: t.tp, sl: t.sl, notes: [...m.notes, ...t.notes], assets: a.view };
  }
  // 체결 뒤 실제 평단으로 다시 맞춘 목표(§6.9) — 그 매매에 기록한 최신 신호 tpPct·slPct
  function targetFor(t, ins, px = t.avg) {
    const r = tpslFor({ dir: dirOf(t.side), avg: t.avg, signalLev: t.signalLev, lev: t.lev, tpPct: t.signalTpPct ?? null, slPct: t.signalSlPct ?? null, tick: ins.tick, px });
    return { tp: r.tp, sl: r.sl };
  }

  function newTrade(ev, plan, mode) {
    return {
      id: ev.id, rehearsal: ev.rehearsal === true, inst: plan.ins.inst, symbol: ev.symbol, side: ev.side, mode, style: 'single', lev: plan.lev, signalLev: ev.lev,
      signalTpPct: ev.tpPct ?? null, signalSlPct: ev.slPct ?? null, base: plan.base, capMarginPct: settings.maxMarginPct,
      epoch: ev.rehearsal ? null : st() && st().feed ? st().feed.epoch : null, seq: ev.rehearsal ? null : ev.seq, rseq: ev.rehearsal ? ev.rseq : null,
      fills: [], size: 0, avg: null, tp: null, sl: null, tpK: 0, slK: 0, state: 'new', reason: null, reasonArg: null, openedAt: now(), closedAt: null, resultPct: null,
      tpslSyncs: [], tpslNotSynced: false, notes: [],
      // p34: 신호 차수(§2.3)·자동 손절 상태(§2.6 — 발동가 없음)·회원 본인 손익(§4)
      // 신호에 차수가 없으면 null(차수 모름 — 1로 굳혀 조용히 손절 없이 두지 않음, p35 F-8). 추가 진입·회원 상태의 stage가 오면 그때부터
      sigStage: Number.isInteger(ev.stage) && ev.stage >= 1 ? ev.stage : null, autoSl: null, exit: null, pnlUsdt: null,
    };
  }
  const withNotes = (t, reasons) => ({ ...t, notes: [...(t.notes || []), ...reasons.map((r) => ({ at: now(), reason: r, arg: null }))] });
  async function recordSkip(ev, reason, arg = null) {
    if (otherTab || ev.kind !== 'entry' || trades.has(ev.id) || !TRADE_ID_RE.test(String(ev.id))) return;
    if (await store.trade(ev.id)) return; // 같은 판 다른 탭이 이미 연(또는 적은) 매매를 건너뜀으로 덮지 않는다
    await save({
      id: ev.id, rehearsal: ev.rehearsal === true, inst: ev.inst || null, symbol: ev.symbol, side: ev.side, mode: settings.mode, style: 'single', lev: null, signalLev: ev.lev,
      base: null, capMarginPct: settings.maxMarginPct, epoch: null, seq: ev.rehearsal ? null : ev.seq, rseq: ev.rehearsal ? ev.rseq : null,
      fills: [], size: 0, avg: null, tp: null, sl: null, state: 'skipped', reason, reasonArg: arg, openedAt: now(), closedAt: now(), resultPct: null, tpslSyncs: [], notes: [],
    });
  }
  const markMissed = (ev) => missed.add(flowKeyOf(ev));

  // ── 그림자 기록(§6.4): 실제 신호인데 follow.shadow — G3 밖 조건을 모두 보고 계산까지 한 뒤 주문 없이 낼 주문만 ──
  async function shadow(ev, plan, trade) {
    const row = {
      at: now(), kind: END_KINDS.includes(ev.kind) ? 'close' : ev.kind, side: ev.side, qty: plan.qty ?? null, lev: plan.lev ?? (trade ? trade.lev : null),
      tp: plan.tp ?? (plan.target ? plan.target.tp : null), sl: plan.sl ?? (plan.target ? plan.target.sl : null),
      customId: ev.kind === 'entry' ? coidFor(ev.id, 'e1') : ev.kind === 'dca' && Number.isInteger(ev.fill) ? coidFor(ev.id, `d${ev.fill}`) : null,
      fill: ev.kind === 'entry' ? 1 : ev.kind === 'dca' && Number.isInteger(ev.fill) ? ev.fill : null, // 기록 줄의 'N차 진입'(follow-view shadowLines)
    };
    // p34 §2.10: 4차 이상 추가 진입 뒤 자동 손절을 걸 자리 — 가격 칸 없이 한 줄(T13 대조용)
    const slRow = ev.kind === 'dca' && Number.isInteger(ev.stage) && ev.stage >= afterStage
      ? [{ at: now(), kind: 'autoSl', side: ev.side, qty: null, lev: null, tp: null, sl: null, customId: null, fill: null }]
      : [];
    if (ev.kind === 'entry') await save({ ...newTrade(ev, plan, settings.mode), state: 'shadow', shadow: [row], size: plan.qty, avg: plan.px, closedAt: now() });
    else if (trade && trade.state === 'shadow') {
      const size = ev.kind === 'dca' ? trade.size + (plan.qty || 0) : trade.size;
      const avg = ev.kind === 'dca' && plan.qty ? (trade.size * trade.avg + plan.qty * plan.px) / size : trade.avg;
      await save({ ...trade, shadow: [...(trade.shadow || []), row, ...slRow], size, avg, closedAt: now() });
    }
  }

  // ── 진입·추가 진입·조정(② 자동 또는 시트에서 누름) — 그 순간 조건을 모두 다시 본다 ──
  // 큐에서 기다리는 사이 앞 동작(조정의 tpsl_not_synced·정리 주기의 detached)·일시 고정·동시 한도가 바뀌었을 수 있으므로 종류별 표(decide)부터 다시,
  // 시장가 바로 전에 시각 조건·G1~G8을 한 번 더(preflight — 사이에 네트워크 호출이 여러 번 있다, §6.3 "주문 하나마다 전부 확인").
  // shadowOnly: 받을 때 그림자 실행이었던 실제 신호 — 무슨 일이 있어도 여기서 주문하지 않는다(그 사이 shadow가 꺼졌으면 ③·직접 주문은 시트, ②는 놓친 신호)
  async function act(ev, kind, { fromSheet = false, shadowOnly = false } = {}) {
    const trade = await refresh(ev.id);
    const d = decide(ev, { mode: settings.mode, trade, symbols: symbols(), openCount: openTrades().length, maxConcurrent: settings.maxConcurrent, frozen: frozenOf(ev) });
    if (d.act !== 'auto' && d.act !== 'sheet') {
      if (d.act === 'skip') {
        if (kind === 'entry') await recordSkip(ev, d.reason);
        else if (trade && !shadowOnly) await save(withNotes(trade, [d.reason]));
      }
      return { done: false, reason: d.reason || d.act };
    }
    if (timeCheck(ev, { now: now(), offset: offset() })) {
      markMissed(ev);
      if (kind === 'entry') await recordSkip(ev, 'late');
      return { done: false, reason: 'late' };
    }
    const g = gateIncrease(gates());
    if (g) {
      if (g.gate === 'G2' && g.why === 'lease') return { done: false, reason: 'lease' }; // 다른 기기가 따라가는 중 — 그 기기가 한다
      markMissed(ev);
      if (kind === 'entry') await recordSkip(ev, g.why === 'rate' ? 'rate_guard' : 'late');
      return { done: false, reason: g.why };
    }
    const plan = await planFor(ev, trade, kind);
    if (plan.skip) {
      if (kind === 'entry') await recordSkip(ev, plan.skip);
      else if (trade) await save(withNotes(trade, [plan.skip]));
      return { done: false, reason: plan.skip };
    }
    if (!ev.rehearsal && live().shadow === true) {
      await shadow(ev, plan, trade);
      return { done: false, reason: 'shadow' };
    }
    if (shadowOnly) {
      if (settings.mode === 'tap' || ev.manual === true) openSheet(ev, kind, { reason: ev.manual === true ? 'manual_signal' : null, plan });
      else markMissed(ev);
      return { done: false, reason: 'shadow' };
    }
    if (!fromSheet && (settings.mode === 'tap' || ev.manual === true)) {
      // ③과 직접 주문 신호는 회원이 누를 때만(§6.1·§6.13) — 판단 뒤 방식이 바뀌었어도 시트로
      openSheet(ev, kind, { reason: ev.manual === true ? 'manual_signal' : null, plan });
      return { done: false, reason: 'sheet' };
    }
    const preflight = () => !timeCheck(ev, { now: now(), offset: offset() }) && !gateIncrease(gates());
    if (kind === 'entry') {
      // 새 진입 전: 그 종목 이전 자동 손절 주문이 모두 끝났는지(p34 §2.7) — 남은 STOP이 새 포지션을 닫지 않게
      const beforeEntry = keeper ? () => keeper.checkEntry(plan.ins.inst, [...trades.values()]) : null;
      const r = await exec.openTrade({ trade: newTrade(ev, plan, fromSheet ? 'tap' : settings.mode), amount: plan.amount, qty: plan.qty, margin: plan.margin, tp: plan.tp, sl: plan.sl, tick: plan.ins.tick, preflight, beforeEntry }, save);
      let t = withNotes(r.trade, plan.notes);
      if (t.state === 'open') t = (await exec.protect(t, targetFor(t, plan.ins), { tick: plan.ins.tick, step: plan.ins.step })).trade;
      // 차수 모름(p35 F-8) — 자동 손절을 걸 차수를 알 수 없음을 기록에 한 번(화면 낱말은 '대기(차수 모름)')
      if (SL_LIVE.includes(t.state) && t.sigStage == null && !(t.notes || []).some((n) => n.reason === 'auto_sl_no_stage')) t = withNotes(t, ['auto_sl_no_stage']);
      await save(t);
      return { done: t.state === 'open', reason: t.reason };
    }
    if (kind === 'dca') {
      const r = await exec.addFill(trade, { fill: ev.fill, amount: plan.amount, qty: plan.qty, margin: plan.margin, tp: plan.tp, sl: plan.sl, tick: plan.ins.tick, preflight }, save);
      let t = withNotes({ ...r.trade, signalTpPct: ev.tpPct ?? null, signalSlPct: ev.slPct ?? null }, plan.notes);
      if (t.state === 'open') t = (await exec.protect(t, targetFor(t, plan.ins), { tick: plan.ins.tick, step: plan.ins.step })).trade;
      if (t.state === 'detached' && ['set', 'sending', 'unclear'].includes(slOf(t).state)) t = withNotes(t, ['auto_sl_left']);
      await save(t);
      // 포지션이 이미 없었음(거래소 익절·자동 손절 등) — exit·USDT·사유를 맞추고 남은 자동 손절 취소(§2.8)
      if (t.state === 'closed' && t.reason === 'gone' && keeper) await keeper.closeGone(t);
      else if (keeper && fromSheet) await keeper.ensure(t.id); // ③ 누른 추가 진입 — 체결한 수량으로 자동 손절(4차 뒤)
      return { done: true };
    }
    const t = (await exec.protect({ ...trade, signalTpPct: ev.tpPct ?? null, signalSlPct: ev.slPct ?? null }, plan.target, { tick: plan.ins.tick, step: plan.ins.step })).trade;
    await save(withNotes(t, plan.notes));
    return { done: true };
  }

  // ── 종료(§6.6) — 실시간 끝 이벤트(②면 바로, ③이면 시트) / 다시 열었을 때(②·24시간 안이면 late_close, 그 밖 시트) ──
  async function endTrade(given, { live: isLive, endAt }) {
    const trade = given ? (await refresh(given.id)) || given : null;
    if (!trade || trade.state !== 'open') return { done: false };
    if (!reduceOk()) return { done: false, reason: 'gate' };
    // feed.epoch가 장부와 다르면(허브 상태 새로 만듦) 끝 이벤트를 받았어도 자동으로 닫지 않고 묻는다, recovered·stale·degraded·partner 다운이면 판정 없음(§6.6)
    const h = trade.rehearsal ? 'ok' : feedHealth(st(), trade.epoch);
    if (h === 'hold') return { done: false, reason: 'hold' };
    if (h === 'epoch') {
      await save(withNotes({ ...trade, state: 'unclear' }, ['signal_unclear']));
      openSheet({ id: trade.id, symbol: trade.symbol, side: trade.side, lev: trade.lev, rehearsal: false, kind: 'close' }, 'close', { reason: 'signal_unclear' });
      return { done: false, reason: 'epoch' };
    }
    const mode = settings && settings.mode === 'tap' ? 'tap' : 'auto';
    const hubNow = now() + (offset() ?? 0);
    const how = isLive ? (mode === 'auto' ? 'auto' : 'sheet') : lateCloseMode({ mode, endAt, hubNow });
    if (how === 'sheet') {
      openSheet({ id: trade.id, symbol: trade.symbol, side: trade.side, lev: trade.lev, rehearsal: trade.rehearsal, kind: 'close' }, 'close');
      return { done: false, reason: 'sheet' };
    }
    return closeNow(trade, isLive ? null : { reason: 'late_close', arg: endAt });
  }
  async function closeNow(given, extraNote = null) {
    if (!reduceOk()) return { done: false };
    let trade = given;
    if (Array.isArray(trade.fills) && trade.fills.some((f) => f.state === 'sending')) {
      // 결과 모름(unclear) 줄은 먼저 식별자로 확인해 수량을 맞춘다(장부 수량 0이면 회원이 바꾼 포지션으로 보여 닫지 못함)
      trade = (await exec.recoverSending(trade)).trade;
      if (!['open', 'unclear'].includes(trade.state)) {
        await save(trade);
        return { done: false };
      }
    }
    const ins = (await instruments()).find((x) => x.inst === trade.inst);
    const r = await exec.closeTrade({ ...trade, state: 'closing' }, { step: ins ? ins.step : 0.001, reason: extraNote });
    await save(r.trade);
    // 정리했으면(또는 포지션이 이미 없었으면) 이 매매의 자동 손절 주문 목록 항목도 취소·끝 확인(§2.8 — 실패하면 목록에 남아 다음에)
    if (r.done && keeper) await keeper.cancelFor(r.trade, { final: 'done', sw: await sw.read() });
    return r;
  }

  // ── ③ 시트(§6.13) — 진입·추가 진입·조정은 임대를 쥔 기기에서만·실시간 신호에만, 정리 시트는 유효 시간 없음 ──
  function openSheet(ev, kind, { reason = null, plan = null } = {}) {
    if (!SHEET_KINDS.includes(kind) || otherTab) return; // 탭 잠금을 못 잡은 탭은 F-17만(시트 없음)
    if (kind !== 'close' && !(lease && lease.held())) return;
    const key = kind === 'close' ? `close|${ev.id}` : evKey(ev);
    if (sheets.has(key)) return;
    sheets.set(key, {
      key, kind, ev, reason, at: now(), tradeId: ev.id, rehearsal: ev.rehearsal === true,
      deadline: kind === 'close' ? null : deviceDeadline(ev, offset() ?? 0) ?? now(),
      preview: plan ? { margin: plan.margin ?? null, lev: plan.lev ?? null, qty: plan.qty ?? null, amount: plan.amount ?? null, base: ev.symbol, tp: plan.tp ?? (plan.target ? plan.target.tp : null), sl: plan.sl ?? (plan.target ? plan.target.sl : null) } : null,
    });
    try {
      vibrate(200);
    } catch {
      // 진동 없음
    }
    emit();
  }

  // ── 이벤트 하나(실제·리허설 공통) — 같은 키는 한 번만(받는 즉시), 판단은 받은 순서대로 한 줄(chain), 실행은 종목 큐 ──
  function handle(ev) {
    if (!ev || typeof ev !== 'object' || typeof ev.kind !== 'string') return chain;
    const key = evKey(ev);
    if (seen.has(key)) return chain;
    seen.add(key);
    if (seen.size > SEEN_MAX) {
      const keep = [...seen].slice(-1000);
      seen.clear();
      for (const k of keep) seen.add(k);
    }
    if (END_KINDS.includes(ev.kind)) {
      (ev.rehearsal ? endedReh : endedReal).add(ev.id);
      endEvents.set(ev.id, ev);
    }
    if (ORDER_KINDS.includes(ev.kind) && Number.isInteger(ev.stage) && typeof ev.id === 'string') {
      evStage.set(ev.id, Math.max(evStage.get(ev.id) || 0, ev.stage));
      if (evStage.size > 500) evStage.delete(evStage.keys().next().value);
      // 따라가기가 돌지 않는 동안 장부에 살아 있는 매매의 차수가 오르면 가벼운 주기를 바로(30초를 기다리지 않음, §2.13)
      const t = trades.get(ev.id);
      if (!running && keeper && t && SL_LIVE.includes(t.state)) slTick();
    }
    chain = chain.then(() => route(ev)).catch((e) => { lastError = String(e && e.message ? e.message : e); });
    return chain;
  }
  async function route(ev) {
    if (!settings || !settings.on || !running) return;
    const trade = await refresh(ev.id);
    const shadowing = !ev.rehearsal && live().ok && live().shadow === true;
    if (shadowing && trade && trade.state === 'shadow') {
      if (ev.source !== 'stream') return;
      enqueue(ev.symbol, async () => {
        const plan = ev.kind === 'dca' || ev.kind === 'adjust' ? await planFor(ev, trade, ev.kind) : {};
        if (!plan.skip) await shadow(ev, plan, trade);
      });
      return;
    }
    const d = decide(ev, { mode: settings.mode, trade, symbols: symbols(), openCount: openTrades().length, maxConcurrent: settings.maxConcurrent, frozen: frozenOf(ev) });
    if (shadowing && (d.act === 'auto' || d.act === 'sheet') && ORDER_KINDS.includes(ev.kind)) {
      enqueue(ev.symbol, () => act(ev, ev.kind, { shadowOnly: true })); // 그림자 실행 중 실제 신호는 시트 없이 기록만 — 주문하지 않는다
      return;
    }
    await dispatch(ev, trade, d);
    // p34 §2.3: 그 매매가 장부에 살아 있으면 따르든 안 따르든(놓침·건너뜀·고정·③ 시트 포함) 신호 차수를 올리고 자동 손절을 맞춘다 —
    // 종목 큐 안에서, 위 동작(act) 다음에(4차 체결이 끝난 수량으로). route()는 큐 밖이라 여기서 바로 저장하지 않는다
    if (keeper && ORDER_KINDS.includes(ev.kind) && ev.kind !== 'entry' && Number.isInteger(ev.stage) && trade && SL_LIVE.includes(trade.state)) {
      enqueue(ev.symbol, () => onStage(ev.id, ev.stage));
    }
  }
  async function onStage(id, stage) {
    const t = await refresh(id);
    if (!t || !SL_LIVE.includes(t.state)) return;
    const b = bumpStage(t, stage);
    if (b !== t) await save(b);
    // ③ 시트가 떠 있으면(회원이 누르면 그 체결 수량으로) 누른 뒤에 맞춘다 — 건너뛰면 그때, 놓쳐도 정리 주기가(시트 없이 건다)
    if ([...sheets.values()].some((s) => s.tradeId === id && s.kind !== 'close')) return;
    await slOne(id);
  }
  // 자동 손절 맞추기 앞 포지션 판정(p34 §2.8 — 정리 주기 one()과 같은 순서, 검토 고침 1): 포지션 없음 → 닫기(자동 손절 체결부터) /
  // 회원이 바꾼 포지션(방향 다름·수량 ±5% 밖) → 자동 손절 일부 체결이면 남은 수량 정리, 아니면 detached + auto_sl_left(수량이 회원 것 —
  // 새로 걸거나 바꾸지 않음) → 맞추기. 가벼운 주기·신호 차수(onStage)·스위치 적용·건너뛴 추가 진입 시트가 부른다(종목 큐 안).
  // 보내다 결과를 모른 체결 줄(sending)이 있으면 장부 수량이 옛 값이라 여기서 판정하지 않는다(맞추기 안에서 그 수량까지 보고 막음)
  async function slOne(id) {
    let t = await refresh(id);
    if (!t || !SL_LIVE.includes(t.state) || !reduceOk()) return;
    const p = await exec.positionOf(t.inst, { fresh: true }); // 회원 변경 판정은 캐시 없이(정리 주기 one()의 forget과 같음)
    if (!p.ok) return;
    if (!p.pos) {
      await keeper.closeGone(t);
      return;
    }
    const sending = Array.isArray(t.fills) && t.fills.some((f) => f.state === 'sending');
    if (t.state !== 'detached' && !sending && positionVerdict(t, p.pos) === 'detached') {
      if (slOf(t).orderId && (await keeper.settlePartial(t, p.pos))) return;
      t = withNotes({ ...t, state: 'detached' }, ['set', 'sending', 'unclear'].includes(slOf(t).state) ? ['detached', 'auto_sl_left'] : ['detached']);
      await save(t);
    }
    await keeper.ensure(id, { pos: p.pos });
  }
  async function dispatch(ev, trade, d) {
    switch (d.act) {
      case 'missed':
        markMissed(ev);
        if (ev.kind === 'entry') await recordSkip(ev, 'late');
        emit();
        return;
      case 'skip':
        if (ev.kind === 'entry') await recordSkip(ev, d.reason);
        else if (trade) await save(withNotes(trade, [d.reason]));
        emit();
        return;
      case 'detach':
        // 신호 추적이 끊김(untracked·lost) — 내 포지션은 그대로 두고 F-09 signal_lost + '내 포지션 정리' 시트(§6.6).
        // 회원 자동 손절 주문은 거래소에 남아 보호를 계속한다(p34 §2.8 — auto_sl_left)
        await save(withNotes({ ...trade, state: 'detached' }, ['set', 'sending', 'unclear'].includes(slOf(trade).state) ? [d.reason, 'auto_sl_left'] : [d.reason]));
        openSheet({ id: trade.id, symbol: trade.symbol, side: trade.side, lev: trade.lev, rehearsal: trade.rehearsal, kind: 'close' }, 'close', { reason: 'signal_lost' });
        emit();
        return;
      case 'end':
        enqueue(ev.symbol, () => endTrade(trades.get(ev.id), { live: ev.source === 'stream', endAt: ev.at }));
        return;
      case 'auto':
        enqueue(ev.symbol, () => act(ev, ev.kind));
        return;
      case 'sheet':
        enqueue(ev.symbol, async () => {
          const cur = (await refresh(ev.id)) || trade;
          const p = await planFor(ev, cur, ev.kind);
          if (p.skip) {
            // 계산이 이미 건너뜀(최소 주문 단위·잔고·종목·시세 등)이면 눌러도 주문이 나가지 않는다 — 시트 없이 ②와 같이 장부에 건너뜀 + 사유.
            // 임대를 쥔 기기만 적는다(시트를 띄울 수 있는 기기와 같은 조건 — 다른 기기가 따라가는 중이면 그 기기가 적는다)
            if (!(lease && lease.held())) return;
            if (ev.kind === 'entry') await recordSkip(ev, p.skip);
            else if (cur) await save(withNotes(cur, [p.skip]));
            return;
          }
          openSheet(ev, ev.kind, { reason: d.reason || null, plan: p });
        });
        return;
      default:
    }
  }

  // ── 바깥에서 부르는 것 ──
  async function init() {
    if (!rules) {
      emit();
      return state();
    }
    const n = normalizeSettings(await store.settings(), rules);
    settings = n.settings;
    // 저장된 '켜짐'도 지금 규칙으로 다시 검사 — 틀리면(최대 증거금 없음 등) 꺼진 채로 시작해 다시 켜게 한다
    if (settings && settings.on && !validateSettings(settings, rules).ok) settings = { ...settings, on: false };
    rulesChanged = n.rulesChanged;
    consents = await store.consents();
    // 저장된 '켜짐'도 지금 동의 문구 판으로 다시 — 앱 업데이트로 CONSENT_VERSION이 바뀌었으면 꺼 두고 다시 동의를 받는다(§6.2·G2 동의 기록)
    consentChanged = consentGone();
    if (consentChanged) settings = { ...settings, on: false };
    for (const t of await store.trades()) if (t && t.id) trades.set(t.id, t);
    // p34: 하루 손실 기록(kv.day)은 더 쓰지 않는다 — 한 번 지움(실패해도 그대로)
    if (store.durable() && typeof store.dropDay === 'function') await store.dropDay();
    await refreshSl();
    // 따라가기가 꺼져 있어도 화면에 보이는 동안 30초마다 자동 손절만 맞춘다(§2.13) — 켜져 있으면 정리 주기가 맡고 이 회차는 건너뜀
    if (slLoop == null) slLoop = timers.setInterval(() => { slTick(); }, LOOP_MS);
    emit();
    return state();
  }

  // ── 가벼운 주기(§2.13): 따라가기가 돌지 않는 동안(꺼짐·인증 풀림 정리 유예) — 위험을 줄이는 호출만, 회차마다 탭 잠금(ifAvailable)을 잡고 놓는다 ──
  // 하는 일: 신호 차수(회원·리허설 상태 open[].stage) → 매매마다 자동 손절 맞추기(종목 큐) → 포지션 없음이면 닫기 → 목록 정리 → 보조 감시.
  // 끝 신호 정리·보호 교체·새 진입은 하지 않는다
  function slTick() {
    if (slRun) return slRun;
    if (!keeper || running || !visible || !keys.ready() || !store.durable()) return Promise.resolve();
    if (!member() && keys.status() !== 'cleanup') return Promise.resolve();
    slRun = (async () => {
      const list = [...trades.values()].filter((t) => SL_LIVE.includes(t.state) || slCleanupPending(t));
      const entries = await slList.list();
      if (!list.length && !entries.length) return;
      const l = await acquireLock();
      try {
        if (!l.ok || running) return;
        const st0 = st();
        const swv = await sw.read();
        for (const t of list) await enqueue(t.symbol, () => lightOne(t.id, st0));
        await keeper.sweep(swv);
        if (!swv.on) await keeper.cancelRest(swv);
      } finally {
        l.release();
      }
    })().catch((e) => { lastError = String(e && e.message ? e.message : e); }).finally(() => { slRun = null; return slSync(); });
    return slRun;
  }
  async function lightOne(id, st0) {
    let t = await refresh(id);
    if (slCleanupPending(t)) {
      await keeper.cleanup(id); // 끝난 매매의 자동 손절 정리 미완(p35 §5.3)
      return;
    }
    if (!t || !SL_LIVE.includes(t.state)) return;
    const b = bumpStage(t, Math.max(stageFromState(t, st0) || 0, evStage.get(id) || 0));
    if (b !== t) {
      t = b;
      await save(t);
    }
    // 회원이 바꾼 포지션 판정을 거친 뒤에만 맞춘다(따라가기가 꺼진 동안 회원이 바꾸거나 닫고 다시 연 포지션에 걸거나 닫지 않게, 검토 고침 1)
    await slOne(id);
  }

  // ── 자동 손절 스위치(§2.2) — 따라가기 화면·트레이딩 탭 같은 값. 켜기는 언제든, 끄기는 정리 유예면 잠김, 걸린 주문이 있으면 확인 뒤 ──
  async function setAutoSl(on, { confirmed = false } = {}) {
    if (!sw) return { ok: false, error: FTEXT.needRules };
    if (!store.durable()) return { ok: false, error: FTEXT.needDurable };
    if (slApplying && now() - slSetAt < AUTO_SL.busyMs) return { ok: false, busy: true };
    if (!on && !member() && keys.status() === 'cleanup') return { ok: false, locked: true };
    if (!on && !confirmed && (await slList.list()).length > 0) return { ok: false, confirm: true };
    await sw.set(!!on);
    slSetAt = now();
    slToast = { text: on ? AUTO_SL_TEXT.toastOn : AUTO_SL_TEXT.toastOff, at: now() };
    await slSync();
    await applySwitch();
    return { ok: true };
  }
  // 적용은 탭 잠금을 쥔 탭만 — 따라가기를 돌리는 탭이면 열린 매매마다 종목 큐로 맞추기 + 목록 정리, 아니면 가벼운 주기 한 회차(그 동안만 잠금)
  function applySwitch() {
    if (!keeper || slApplying) return slApplying || Promise.resolve();
    const run = (async () => {
      if (running && !otherTab) {
        const jobs = [...trades.values()].filter((t) => SL_LIVE.includes(t.state)).map((t) => enqueue(t.symbol, () => slOne(t.id)));
        await Promise.all(jobs);
        const swv = await sw.read();
        await keeper.sweep(swv);
        if (!swv.on) await keeper.cancelRest(swv);
      } else if (!running) {
        await slTick();
      }
    })().catch((e) => { lastError = String(e && e.message ? e.message : e); });
    slApplying = run.finally(() => { slApplying = null; return slSync(); });
    return slApplying;
  }
  if (sw) sw.onChange(() => { slSync().then(() => applySwitch()); });
  // 탭 잠금을 쥔 채로 fn(p35 F-4) — 따라가기를 돌리는 탭은 이미 쥐고 있고(다른 탭이 쥐었으면 other_tab), 꺼져 있으면 이 회차만
  // ifAvailable로 잡았다 놓는다(가벼운 주기와 같은 자리 slRun — start()가 놓을 때까지 기다림). 못 잡으면 거래소 호출 없이 other_tab
  const OTHER_TAB = Object.freeze({ ok: false, reason: 'other_tab' });
  async function withTabLock(fn) {
    while (!running && slRun) await slRun;
    if (running) return otherTab ? OTHER_TAB : fn();
    let out = OTHER_TAB;
    const run = (async () => {
      const l = await acquireLock();
      try {
        if (l.ok && !running) out = await fn();
      } finally {
        l.release();
      }
    })();
    slRun = run.catch((e) => { lastError = String(e && e.message ? e.message : e); }).finally(() => { slRun = null; return slSync(); });
    await slRun;
    return out;
  }
  const SL_REASON_TEXT = Object.freeze({ other_tab: AUTO_SL_TEXT.otherTab, has_position: AUTO_SL_TEXT.clearHasPos, still_open: AUTO_SL_TEXT.clearStillOpen, error: AUTO_SL_TEXT.clearError });
  function slSay(out) {
    const text = out && SL_REASON_TEXT[out.reason];
    if (text) {
      slToast = { text, at: now() };
      slSync();
    }
    return out;
  }
  // '다시 걸기'(결과 모름·걸지 못함 — 회원이 오렌지엑스 앱에서 없음을 본 뒤) — 탭 잠금·종목 큐 안에서
  async function retryAutoSl(id) {
    const t = trades.get(id);
    if (!keeper || !t) return { ok: false };
    return slSay(await withTabLock(async () => {
      await enqueue(t.symbol, () => keeper.retry(id));
      return { ok: true };
    }));
  }
  // '확인했습니다'(p35 §5.3 고침 2) — 탭 잠금 → 그 종목 큐 안에서 포지션부터(있으면 아무것도 안 함) → 끝 확인·번호 모름만 지움
  async function clearAutoSlCheck(inst) {
    if (!keeper || !store.durable() || typeof inst !== 'string') return { ok: false };
    return slSay(await withTabLock(async () => {
      if (!reduceOk()) return { ok: false, reason: 'error' };
      let out = { ok: false, reason: 'error' };
      await enqueue(inst.split('-')[0], async () => { out = await keeper.confirmInst(inst, [...trades.values()]); });
      return out;
    }));
  }
  async function saveSettings(patch) {
    if (!settings) return state();
    settings = { ...settings, ...patch, on: settings.on };
    try {
      await store.saveSettings(settings);
    } catch {
      // 메모리 저장소 — 켤 때 막힌다
    }
    emit();
    return state();
  }
  // 켜기(F-07·F-11): 규칙·오래가는 저장소 → 설정 검사 → 동의(full·summary면 기록) → 잠금·임대 → 배율 권한 확인(§5.4 끝)
  // lev = 화면 F-05에 보인 배율(동의 문구 textHash가 화면에 보인 글 그대로가 되게 — 없으면 지금 상태의 값)
  async function enable({ settings: next = settings, consentShown = 'none', lev = null } = {}) {
    if (!rules) return { ok: false, error: FTEXT.needRules };
    if (!store.durable()) return { ok: false, error: FTEXT.needDurable };
    const v = validateSettings(next, rules);
    if (!v.ok) return { ok: false, errors: v.errors };
    const need = consentNeeded(consents, { rulesVersion: rules.rulesVersion, mode: next.mode, settings: next });
    if (need === 'full' && consentShown !== 'full') return { ok: false, need };
    if (need === 'summary' && consentShown === 'none') return { ok: false, need };
    const shownLev = Number.isInteger(lev) && lev >= 1 ? lev : state().lev;
    const autoSlOn = sw ? (await sw.read()).on : null; // 동의 기록에 정보로(비교에는 넣지 않음, §5.3)
    if (need !== 'none') consents = await store.addConsent(await makeConsent({ ed: config.edition, settings: next, rules, lev: shownLev, appVersion: config.version, now: now(), subtle, autoSlOn }));
    settings = { ...next, on: true, rulesVersion: rules.rulesVersion };
    rulesChanged = false;
    consentChanged = false;
    await store.saveSettings(settings);
    await start({ probe: true });
    emit();
    return { ok: !!settings.on, note: probeNote };
  }
  async function disable() {
    if (settings) {
      settings = { ...settings, on: false };
      try {
        await store.saveSettings(settings);
      } catch {
        // 메모리 저장소
      }
    }
    stopRunning();
    emit();
    slTick(); // 따라가기를 꺼도 자동 손절은 이어서 맞춘다(§2.13 — 잠금을 놓은 뒤 한 회차)
  }
  // 켜기·보일 때: 잠금 → 임대 → (배율 권한 확인) → 켤 때 확인·정리 주기. 기다리는 사이 화면을 떠나면(stopRunning) 늦게 잡힌 잠금·임대를 바로 놓는다
  async function start({ probe = false } = {}) {
    if (!settings || !settings.on || !visible || running || !member() || !store.durable()) return;
    if (consentGone()) {
      // 동의 기록 없이 주문하지 않는다(init 뒤 기록이 바뀐 경우까지)
      consentChanged = true;
      settings = { ...settings, on: false };
      try {
        await store.saveSettings(settings);
      } catch {
        // 메모리 저장소
      }
      emit();
      return;
    }
    running = true;
    moved = false;
    forcedAt = now();
    probeNote = null;
    if (slRun) await slRun; // 가벼운 주기 회차가 잠금을 쥐고 있으면 놓을 때까지(§2.13 — 잠금 주고받기)
    const l = await acquireLock();
    if (!running) {
      l.release();
      return;
    }
    lock = l;
    otherTab = !l.ok;
    // 첫 claim의 resume(p40): 다시 뜬 페이지가 같은 기기의 옛 lease를 이어받는다. 탭 잠금을 못 잡은 탭은 보내지 않는다(잠금 쥔 탭의 임대를 뺏지 않게)
    if (lease) await lease.start({ resume: !otherTab });
    if (!running) {
      if (lease) lease.stop();
      return;
    }
    const c = client();
    for (const s of symbols()) if (c && typeof c.watchTicker === 'function') c.watchTicker(`${s}-USDT-PERPETUAL`);
    // 배율 권한 확인(§5.4 끝) — 지어낸 주문 식별자 없이(허브가 식별자 모양으로 그림자 실행 예외를 주지 않게). 허브가 막거나(그림자 실행 등)
    // 임대가 없어 못 하면 다음에 보일 때 다시. 권한 오류(denied_scope)면 K-11 — 켜지 않는다.
    // 그 종목 큐 안에서(p40 검토 3): 확인은 읽은 배율로 다시 adjust하므로, 같은 종목 수동 1차 진입의 배율 맞추기 ~ 시장가 사이에 끼면 시장가가 다른 배율로 나간다
    if (probe || probePending) {
      if (!otherTab && c && typeof c.probeLeverage === 'function' && lease && lease.held()) {
        const sym = symbols()[0] || 'BTC';
        const p = (await enqueue(sym, () => c.probeLeverage(`${sym}-USDT-PERPETUAL`))) || { ok: false, kind: 'error' };
        if (!running) return;
        probePending = !p.ok && p.kind !== 'denied_scope';
        if (!p.ok && p.kind === 'denied_scope') {
          probeNote = 'lev_denied';
          settings = { ...settings, on: false };
          await store.saveSettings(settings);
          stopRunning();
          return;
        }
      } else probePending = true;
    }
    if (upkeep && !otherTab) await upkeep.onStart();
    if (!running) return;
    if (loop == null) loop = timers.setInterval(() => { if (upkeep) upkeep.tick(); }, LOOP_MS);
    emit();
  }
  function stopRunning() {
    running = false;
    if (loop != null) timers.clearInterval(loop);
    loop = null;
    if (lease) lease.stop();
    if (lock) lock.release();
    lock = null;
    otherTab = false;
    for (const [k, s] of sheets) if (s.kind !== 'close') sheets.delete(k); // 화면을 떠난 동안의 신호는 실행하지 않는다
  }

  function onFeed(next) {
    snap = next && typeof next === 'object' ? next : null;
    // 회원 상태를 새로 받은 시각(이 기기) — 회원 feed는 다시 받기 전까지 같은 상태 객체를 넘긴다(실시간 이벤트만으로는 바뀌지 않음)
    const s0 = snap && snap.state && typeof snap.state === 'object' ? snap.state : null;
    if (s0 !== stateRef) {
      stateRef = s0;
      stateAt = s0 ? now() : null;
    }
    const f = snap && snap.follow;
    if (f && f.enabled === false && f.reason === 'other_device' && !(Number.isFinite(f.receivedAt) && f.receivedAt < forcedAt)) {
      // 다른 기기로 옮김(F-19) — 바로 G2 거짓(gates의 moved), 임대도 지금 다시 물어 보유를 내려놓는다(다음 30초 갱신을 기다리지 않음)
      if (!moved && lease && typeof lease.renewNow === 'function') lease.renewNow();
      moved = true;
    }
    // 허브 상태를 새로 만들면(epoch 바뀜) seq가 다시 시작할 수 있다 — 실제 이벤트 처리 기록을 비운다(새 신호를 옛 seq로 버리지 않게)
    const ep = st() && st().feed && typeof st().feed.epoch === 'string' ? st().feed.epoch : null;
    if (ep && seenEpoch && ep !== seenEpoch) for (const k of [...seen]) if (k.startsWith('s|')) seen.delete(k);
    if (ep) seenEpoch = ep;
    for (const r of snap && Array.isArray(snap.rehearsal) ? snap.rehearsal : []) {
      const k = `${r.id}|${r.kind}|${r.rseq}`;
      if (rehSeen.has(k)) continue;
      rehSeen.add(k);
      handle({ ...r, rehearsal: true });
    }
    if (rehSeen.size > 500) rehSeen = new Set([...rehSeen].slice(-200));
    emit();
  }
  function onEvent(ev) {
    if (ev && typeof ev === 'object') handle({ ...ev, rehearsal: false });
  }
  function setVisible(v) {
    visible = !!v;
    if (visible) {
      if (settings && settings.on && member()) start();
      else slTick(); // 따라가기가 꺼져 있으면 다시 보일 때 자동 손절부터 맞춘다(앱이 꺼진 동안 4차가 된 매매 — §2.3)
    } else stopRunning();
    emit();
  }
  function setMember() {
    if (member()) start();
    else stopRunning();
    emit();
  }
  // 키가 준비되면 다시 시작, 키가 없거나(해제)·틀리거나·잃으면 멈추고 임대를 놓는다(§6.16 — 같은 UID의 다른 휴대폰이 옮기기 없이 따라가게)
  function keysChanged() {
    if (keys.ready()) start();
    else if (['none', 'bad', 'lost'].includes(keys.status())) stopRunning();
    emit();
  }

  async function confirmSheet(key) {
    const s = sheets.get(key);
    if (!s) return { ok: false };
    if (s.kind !== 'close' && now() > s.deadline) return { ok: false, expired: true };
    sheets.delete(key);
    emit();
    if (s.kind === 'close') {
      const t = await refresh(s.tradeId);
      if (!t || !['open', 'unclear', 'detached', 'closing'].includes(t.state)) return { ok: false };
      return enqueue(t.symbol, () => closeNow({ ...t, state: 'open' }));
    }
    return enqueue(s.ev.symbol, () => act(s.ev, s.kind, { fromSheet: true }));
  }
  async function skipSheet(key) {
    const s = sheets.get(key);
    if (!s) return;
    sheets.delete(key);
    if (s.kind === 'entry') await recordSkip(s.ev, 'skipped');
    else if (keeper && s.kind === 'dca') enqueue(s.ev.symbol, () => slOne(s.tradeId)); // 건너뛴 추가 진입도 신호 차수는 올라 있다(§2.3)
    emit();
  }
  async function moveHere() {
    if (!lease) return false;
    const ok = await lease.force();
    if (ok) {
      moved = false;
      forcedAt = now();
    }
    emit();
    return ok;
  }
  // F-20 '내 포지션 정리' — 인증이 풀려도 정리 유예 토큰으로(위험을 줄이는 호출만, 자기 장부의 매매만)
  async function cleanupAll() {
    const list = cleanupList();
    for (const t of list) await enqueue(t.symbol, async () => closeNow((await refresh(t.id)) || t));
    return list.length;
  }

  // 정리 주기·켤 때 확인(follow-upkeep)이 쓰는 손잡이
  const inner = {
    exec, trades, save, refresh, enqueue, instruments, st, stateAt: () => stateAt, symbols, endedReal, endedReh, endEvents, endTrade, openSheet, targetFor, withNotes, now, emit, orderTimes,
    keeper, sw, slList, slSync,
    running: () => running && visible,
    tabOk: () => !otherTab, // 탭 잠금을 쥔 탭만 장부를 고친다(정리 주기 포함)
    held: () => !!lease && lease.held() && !otherTab && !moved, // 남은 ptf. 주문 정리는 임대 + 탭 잠금을 쥔 기기에서만
    slTick,
  };
  const upkeep = makeUpkeep ? makeUpkeep(inner) : null;

  return {
    init, state, saveSettings, enable, disable, onFeed, onEvent, setVisible, setMember, keysChanged, confirmSheet, skipSheet, moveHere, cleanupAll,
    setAutoSl, retryAutoSl, clearAutoSlCheck,
    summary: () => (settings && rules ? summaryLine(settings, rules, { autoSlOn: slView.on }) : ''),
    leaseChanged: () => emit(), // 임대 답(보유·거절·확인 중)이 바뀜 — 상태 줄을 바로(p40)
    stop: stopRunning,
    inner,
  };
}
