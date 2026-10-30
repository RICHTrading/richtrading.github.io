// D37 자동매매 창(설계 2026-10-16 §15.20, 계획 2026-10-22 작업 9) — 서버 판(serverBuildReady)의 #follow 본문. 동업자 오토 창 꼴:
// ① 설정 창(phase none·setup): 종목 칩(규칙 autoRun.symbols — 한 번에 maxSymbols(3)개까지, 대표 결정 2026-10-23 '동업자판과 같게')·횟수 칩 여섯(직접이면 숫자 칸)·종료 시각 칩 넷(시각 지정이면 시·10분 고르기)·추가 진입 고정 칩(막힘)·
//    자동 손절 켬/끔(등록된 회원은 누르면 onAutoSl — settings 명령)·고정 값 한 줄·[⚡ 자동매매 시작](확인 창·동의 창 없음 — 대표 결정 2026-10-23 '동의 문구는 그냥 다 빼')·안내 한 줄
// ② 진행 창(running·stopped): 머리·상태·진행(N / M회 · HH:MM까지)·총 수익·최근 자동매매 매매 줄·[■ 자동매매 멈추기](확인 뒤 onStop) | [새로 설정하기]·안내
// 입력칸·고른 칩은 update가 다시 그리지 않는다(쓰던 값 유지). DOM은 createElement·textContent로만(CSP — 인라인 꾸밈·HTML 문자열 없음), 꾸밈은 app.css .ar-*
import { AUTO_TEXT } from '../lib/follow-text.js';
import { PICK_DEFAULT, runArgsOf, autoRunModel } from '../lib/auto-run-view.js';
import { cmdErrText } from '../lib/server-cmd-flow.js';
import { serverTradeLines } from '../lib/follow-view.js';
import { autoSymbols, autoMaxSymbols } from '../lib/follow-settings.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const STOP_CODES = new Set(['run_done', 'run_until', 'hedge_off']);
const MINUTES = [0, 10, 20, 30, 40, 50];

export function renderAutoRun(el, {
  doc = globalThis.document, rules, getState = () => null, onStart = async () => ({ ok: false }), onStop = async () => ({ ok: false }),
  onAutoSl = async () => ({ ok: true }), now = () => Date.now(), confirmFn = (m) => globalThis.confirm(m), tz = undefined, symbol = 'BTC',
  getRelayPhase = () => null, // 회원 상태 signals.relay.phase(설계 2026-10-22 §11)
  mountPush = null, // 주문 알림 한 줄 자리(설계 2026-10-23 — 머리 바로 아래, 설정·진행 창 둘 다에서 보임)
  onOneWayHelp = null, // 원웨이 안내 창 열기(2026-10-28) — 있으면 설정 창 시작 버튼 위 상자·포지션 모드 멈춤 때 버튼
} = {}) {
  const node = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, text, id = null) => {
    const b = node('button', cls, text);
    b.type = 'button';
    if (id) b.id = id;
    return b;
  };
  const setOn = (list, pick) => {
    for (const b of list) {
      const on = pick(b);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };
  // 고를 수 있는 종목·한 번에 고르는 수(규칙 파일 — 없으면 symbol 하나)
  const symList = rules ? autoSymbols(rules) : [symbol];
  const symMax = rules ? autoMaxSymbols(rules) : 1;
  const firstPick = PICK_DEFAULT.symbols.filter((x) => symList.includes(x));
  const pick = { ...PICK_DEFAULT, symbols: firstPick.length ? firstPick : symList.slice(0, 1) };
  let slTouched = false;
  let symTouched = false;

  // ── 머리 ──
  const head = node('div', 'ar-head');
  const title = node('h2', 'ar-title', AUTO_TEXT.title);
  const kicker = node('p', 'ar-kicker', AUTO_TEXT.kicker);
  head.append(title, kicker);

  // ── ① 설정 창 ──
  const setup = node('div', 'ar-setup');
  const rowOf = (label) => {
    const r = node('div', 'ar-row');
    r.append(node('div', 'ar-label', label));
    const chips = node('div', 'ar-chips');
    r.append(chips);
    setup.append(r);
    return chips;
  };
  const symChips = rowOf(AUTO_TEXT.symbol);
  const syms = symList.map((v) => {
    const b = button('ar-chip ar-symbol', v);
    b.dataset.v = v;
    b.addEventListener('click', () => { chooseSym(v); });
    symChips.append(b);
    return b;
  });

  const countChips = rowOf(AUTO_TEXT.count);
  const counts = AUTO_TEXT.counts.map(([v, label]) => {
    const b = button('ar-chip ar-count', label);
    b.dataset.v = String(v);
    b.addEventListener('click', () => {
      pick.count = v;
      paintPick();
    });
    countChips.append(b);
    return b;
  });
  const custom = node('input', 'ar-input');
  custom.id = 'ar-count-custom';
  custom.type = 'text';
  custom.setAttribute('inputmode', 'numeric');
  custom.setAttribute('maxlength', '3');
  custom.setAttribute('aria-label', AUTO_TEXT.count);
  custom.value = '';
  countChips.append(custom);

  const untilChips = rowOf(AUTO_TEXT.until);
  const untils = AUTO_TEXT.untils.map(([v, label]) => {
    const b = button('ar-chip ar-until', label);
    b.dataset.v = v;
    b.addEventListener('click', () => {
      pick.until = v;
      paintPick();
    });
    untilChips.append(b);
    return b;
  });
  const timeBox = node('div', 'ar-time');
  const selOf = (id, values, fmt, value) => {
    const s = node('select', 'ar-select');
    s.id = id;
    for (const x of values) {
      const o = node('option', null, fmt(x));
      o.value = String(x);
      s.append(o);
    }
    s.value = String(value);
    return s;
  };
  const hh = selOf('ar-h', Array.from({ length: 24 }, (_, i) => i), (x) => String(x).padStart(2, '0'), PICK_DEFAULT.h);
  const mm = selOf('ar-m', MINUTES, (x) => String(x).padStart(2, '0'), PICK_DEFAULT.m);
  hh.setAttribute('aria-label', '시');
  mm.setAttribute('aria-label', '분');
  timeBox.append(hh, node('span', 'ar-colon', ':'), mm);
  untilChips.append(timeBox);

  const dca = button('ar-chip ar-dca on', AUTO_TEXT.dcaChip);
  dca.disabled = true;
  dca.setAttribute('aria-pressed', 'true');
  rowOf(AUTO_TEXT.dca).append(dca);

  const slChips = rowOf(AUTO_TEXT.autoSl);
  const sls = [['on', AUTO_TEXT.on, true], ['off', AUTO_TEXT.off, false]].map(([v, label, val]) => {
    const b = button('ar-chip ar-sl', label);
    b.dataset.v = v;
    b.addEventListener('click', () => { chooseSl(val); });
    slChips.append(b);
    return b;
  });
  const fixed = node('p', 'ar-fixed', AUTO_TEXT.fixed);
  const msg = node('p', 'ar-msg');
  msg.setAttribute('role', 'status');
  const start = button('big-btn ar-start', AUTO_TEXT.start, 'ar-start');
  // 원웨이 상자(2026-10-28) — 시작 버튼 바로 위, 노란 테두리 한 줄 + [설정 방법 보기 ›]
  const oneWayBox = (id) => {
    const box = node('div', 'ar-oneway');
    const b = button('ar-oneway-btn', AUTO_TEXT.oneWayBtn, id);
    b.addEventListener('click', () => { try { onOneWayHelp(); } catch { /* 창 실패는 무시 */ } });
    box.append(node('p', 'ar-oneway-text', AUTO_TEXT.oneWay), b);
    return box;
  };
  const oneWay = typeof onOneWayHelp === 'function' ? oneWayBox('ar-oneway-help') : null;
  setup.append(fixed, ...(oneWay ? [oneWay] : []), msg, start);

  // ── ② 진행 창 ──
  const runBox = node('div', 'ar-runbox');
  const runHead = node('p', 'ar-run-kicker');
  const runLine = node('div', 'ar-run');
  const status = node('p', 'ar-status');
  status.setAttribute('role', 'status');
  const progress = node('p', 'ar-progress');
  runLine.append(status, progress);
  const pnl = node('p', 'ar-pnl');
  const tradeList = node('ul', 'ar-trades');
  const runMsg = node('p', 'ar-run-msg');
  const stopBtn = button('big-btn ar-stop', AUTO_TEXT.stop, 'ar-stop');
  const againBtn = button('big-btn ar-again', AUTO_TEXT.again, 'ar-again');
  const runNote = node('p', 'ar-note', AUTO_TEXT.runNote);
  const runOneWay = typeof onOneWayHelp === 'function' ? oneWayBox('ar-oneway-help-run') : null; // 포지션 모드로 멈췄을 때만 보임
  if (runOneWay) runOneWay.hidden = true;
  runBox.append(runHead, runLine, pnl, tradeList, runMsg, ...(runOneWay ? [runOneWay] : []), stopBtn, againBtn, runNote);

  const pushSlot = node('div', 'ar-push');
  el.replaceChildren(head, pushSlot, setup, runBox);
  if (typeof mountPush === 'function') mountPush(pushSlot);
  else pushSlot.hidden = true;

  // ── 상태 ──
  let st = null;
  let prevAuto = null;
  let seenNote = null; // 마지막으로 본 멈춤 알림 번호
  let stoppedAt = null;
  let localSetup = false; // [새로 설정하기]
  let busy = false;
  let lastStop = null; // 마지막 멈춤 알림 코드(hedge_off면 원웨이 버튼)
  const registered = () => isObj(st) && st.ok === true && st.status === 'on';

  // 종목 칩 누름 — 켜져 있으면 끔, 꺼져 있으면 켬(한 번에 symMax개까지 — 넘으면 한 줄). 순서는 규칙 목록 순서
  function chooseSym(v) {
    symTouched = true;
    if (pick.symbols.includes(v)) pick.symbols = pick.symbols.filter((x) => x !== v);
    else if (pick.symbols.length >= symMax) {
      msg.textContent = AUTO_TEXT.symbolMax(symMax);
      return;
    } else pick.symbols = symList.filter((x) => x === v || pick.symbols.includes(x));
    msg.textContent = '';
    paintPick();
  }
  function paintPick() {
    setOn(syms, (b) => pick.symbols.includes(b.dataset.v));
    setOn(counts, (b) => b.dataset.v === String(pick.count));
    custom.hidden = pick.count !== 'custom';
    setOn(untils, (b) => b.dataset.v === pick.until);
    timeBox.hidden = pick.until !== 'at';
    setOn(sls, (b) => (b.dataset.v === 'on') === (pick.autoSl !== false));
  }
  async function chooseSl(v) {
    if (pick.autoSl === v) return;
    const before = pick.autoSl;
    pick.autoSl = v;
    slTouched = true;
    paintPick();
    if (!registered()) return;
    msg.textContent = '';
    let r;
    try {
      r = await onAutoSl(v);
    } catch {
      r = { ok: false, error: 'down' };
    }
    if (!r || r.ok !== true) {
      pick.autoSl = before;
      paintPick();
      msg.textContent = cmdErrText(r && r.error);
    }
  }
  function readPick() {
    return { ...pick, symbols: [...pick.symbols], custom: String(custom.value ?? ''), h: Number(hh.value), m: Number(mm.value) };
  }
  start.addEventListener('click', async () => {
    if (busy) return;
    const p = readPick();
    const a = runArgsOf(p, now(), rules, ...(tz === undefined ? [] : [tz]));
    if (!a.ok) {
      msg.textContent = a.error === 'count' ? AUTO_TEXT.badCount : a.error === 'symbols' ? (p.symbols.length ? AUTO_TEXT.badSymbols : AUTO_TEXT.noSymbol) : AUTO_TEXT.badUntil;
      return;
    }
    busy = true;
    msg.textContent = '';
    start.disabled = true;
    start.textContent = AUTO_TEXT.starting;
    let r;
    try {
      r = await onStart({ run: a.run, autoSl: p.autoSl !== false });
    } catch {
      r = { ok: false, error: 'down' };
    }
    busy = false;
    start.disabled = false;
    start.textContent = AUTO_TEXT.start;
    if (!r || r.ok !== true) {
      msg.textContent = cmdErrText(r && r.error);
      return;
    }
    localSetup = false;
    paint();
  });
  stopBtn.addEventListener('click', async () => {
    if (busy) return;
    let yes = false;
    try {
      yes = confirmFn(AUTO_TEXT.stopConfirm) === true;
    } catch {
      yes = false;
    }
    if (!yes) return;
    busy = true;
    stopBtn.disabled = true;
    runMsg.textContent = '';
    let r;
    try {
      r = await onStop();
    } catch {
      r = { ok: false, error: 'down' };
    }
    busy = false;
    stopBtn.disabled = false;
    if (!r || r.ok !== true) runMsg.textContent = cmdErrText(r && r.error);
  });
  againBtn.addEventListener('click', () => {
    localSetup = true;
    paint();
  });

  function paint() {
    let relayPhase = null;
    try { relayPhase = getRelayPhase(); } catch { relayPhase = null; }
    const m = autoRunModel(st, { now: now(), symbol, stoppedAt, relayPhase });
    if (m.phase === 'running') localSetup = false;
    const phase = localSetup && m.phase === 'stopped' ? 'setup' : m.phase;
    const showRun = phase === 'running' || phase === 'stopped';
    setup.hidden = showRun;
    runBox.hidden = !showRun;
    if (!showRun) return;
    runHead.textContent = m.kicker;
    status.textContent = m.status;
    status.className = `ar-status ${phase === 'running' ? 'good' : 'warn'}`;
    progress.textContent = m.progress;
    pnl.textContent = m.pnlLine || '';
    pnl.hidden = !m.pnlLine;
    const lines = serverTradeLines((Array.isArray(st.trades) ? st.trades : []).filter((t) => isObj(t) && t.src === 'signal')).slice(0, 5);
    tradeList.replaceChildren(...lines.map((l) => node('li', null, l.text)));
    tradeList.hidden = lines.length === 0;
    if (runOneWay) runOneWay.hidden = !(phase === 'stopped' && lastStop === 'hedge_off');
    stopBtn.hidden = phase !== 'running';
    againBtn.hidden = phase !== 'stopped';
  }

  function update(next) {
    st = isObj(next) ? next : null;
    const auto = !!(st && st.ok === true && st.auto === true);
    const notes = st && Array.isArray(st.notes) ? st.notes.filter((x) => isObj(x) && STOP_CODES.has(x.code) && Number.isSafeInteger(x.n)) : [];
    const lastN = notes.length ? Math.max(...notes.map((x) => x.n)) : 0;
    if (notes.length) lastStop = notes.find((x) => x.n === lastN).code;
    if (prevAuto === true && st && st.ok === true && !auto) stoppedAt = now(); // 켜짐 → 꺼짐을 봄
    else if (seenNote !== null && lastN > seenNote && !auto) stoppedAt = now(); // 새 멈춤 알림
    if (st && st.ok === true) {
      prevAuto = auto;
      seenNote = lastN;
    }
    if (!slTouched && registered() && isObj(st.settings) && typeof st.settings.autoSl === 'boolean') pick.autoSl = st.settings.autoSl;
    // 지난번 고른 종목(보고 settings.symbols)으로 — 회원이 칩을 누르기 전까지만
    if (!symTouched && registered() && isObj(st.settings) && Array.isArray(st.settings.symbols)) {
      const was = symList.filter((x) => st.settings.symbols.includes(x)).slice(0, symMax);
      if (was.length) pick.symbols = was;
    }
    paintPick();
    paint();
  }

  paintPick();
  update(getState());
  return {
    update,
    pick: () => readPick(),
    els: { setup, runBox, start, stopBtn, againBtn, msg },
  };
}
