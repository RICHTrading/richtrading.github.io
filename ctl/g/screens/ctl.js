// 동업자 비상 컨트롤러 화면 #ctl(계획 2026-10-30 Task 7 — 설계 §2 거래소 화면 꼴, R5 그룹 중심). 보기·전량 정리·다음 차수·익절 다시·오토 끄기와
// 새 진입(Task 11 — 대표 결정 2026-10-30 저녁 A: 신호 서버가 멈췄을 때 고른 회원에게 새 롱·숏 1차 — 회원 수동 1차와 같은 길)·수동 매수(Task 12 — 대표 결정 2026-11-01).
// 오토 모드는 그대로 돌고, 이 화면은 동업자가 오작동·위험 구간에서 회원을 손으로 지키는 장치다.
// - 로그인(아이디·비밀번호 → 세션 토큰만 기기 저장소 — lib/ctl-client.js) → 설정 줄(비밀번호 바꾸기·로그아웃) → 그룹 칩('전체'·저장한 그룹·'+ 새 그룹') →
//   'BTCUSDT 무기한 · 표시가' → (PC) BTC 5분봉 차트 → 요약 카드 + 명령 띠 → 탭(회원·포지션·명령 기록)·필터·전체 선택·정렬 → 표
// - 그룹을 고르면 그 회원만 보이고 전부 체크(명령 대상 = 그룹 회원 전부). 명령 대상은 늘 '체크 ∩ 보이는 줄'(숨은 체크는 보내지 않음)
// - 명령: 확인 시트(명령·인원·포지션 있는 회원 n명·오토 켜진 회원이면 정리 안내) [실행]/[취소] → POST → 결과는 2초마다 30초까지 → 회원별 '완료'·사유
// - 10초마다 목록(보일 때만), 401이면 로그인으로. 결과·기록은 이 화면 메모리에만(새 알림 없음 — R4). 로그아웃·401·새 로그인이면 기록·결과 묻기·체크·필터·
//   정렬·탭·그룹 고름·차트 고름·차트 선을 모두 비우고 세대를 올려 늦은 답을 버림(최종 검토 고침 F2 — 같은 기기의 다음 동업자에게 앞 범위 UID가 남지 않게)
// - 명령 본문에 시트를 연 때 목록의 허브 now(seenAt — 최종 검토 고침 F1), 400 stale_view면 글 + 목록 바로 새로
// - 새 진입(Task 11): 시트 phase form(입력 칸 screens/ctl-enter.js — 기본값 enterDefaults, 틀리면 '값을 확인해 주세요') → confirm('새 진입'·요약·대상·건너뛸 회원 n명
//   — enterSkips) → sent(결과 줄 그대로). 본문 { v:1, kind:'enter', members, args }(seenAt 없음). 규칙이 없는 판(enterRules null)은 단추 잠김 + 띠 글
// - 대표 결정 2026-11-01(Task 12 — R16·R17): form 위 탭 '기본'·'수동'. 기본 = 종목·롱/숏 + 고정 값 한 줄(본문 args는 AI 값 — enterDefaults) → [다음] → confirm → [진입].
//   수동 = 종목·배율·비중(칩 25·50·75·100 + 입력)·익절(칩 + 입력, 비우면 없음)·[매수·롱]·[매도·숏](누르면 방향을 정하고 confirm — kind buy) → confirm('수동 매수'·
//   요약·대상·건너뛸 회원 — buySkips) → [보내기] → sent. 본문 { v:1, kind:'buy', members, args }. 수동 매수는 명령 띠 단추가 따로 없다
// - 대표 결정 2026-11-01(Task 13 — R18): 수동 탭 안 고르기 '열기'(위 수동 매수)·'닫기'. 닫기 = 종목 칩·줄일 비중 %(칩 25·50·75·100 + 정수 1~100) → [줄이기] →
//   confirm('줄이기'·'BTC 포지션 50% 줄이기'·대상·건너뛸 회원 — reduceSkips) → [보내기] → sent. 본문 { v:1, kind:'reduce', members, args:{ symbol, pct } }. 띠 단추 없음
// - 대표 요청 2026-11-04: 띠 단추 '수동 추가'(addm) → 시트 phase form(종목·잔고 비중 % — ctl-enter.js buildAddmForm) → [다음] → confirm('수동 추가'·요약·대상·건너뛸 회원 — addmSkips) →
//   [보내기] → sent. 본문 { v:1, kind:'addm', members, args:{ symbol, pct } }. 규칙이 없는 판은 단추 잠김
// - 차트(screens/ctl-chart.js — vendor LightweightCharts + 허브 공개 봉 /v1/candles): PC 넓은 판(1100px 이상 — CSS 두 칸)은 왼쪽 위에 늘(오른쪽 요약·명령,
//   아래 표), 휴대폰은 표 위에 접고 펴는 칸(기본 펴짐 — 기기 저장소 kv ctlChartOpen, R14) + 아래 고정 명령 띠
// - 포지션 줄(회원 탭 button.ctl-pline·포지션 탭 .ctl-prow)을 누르면 그 종목 차트에 그 회원 매매의 평단·익절·청산가 선과 차수 화살표, 다시 누르면 BTC
//   (계획 2026-10-30 Task 10 — 대표 결정 2026-10-30 저녁 B·D). 표시가 줄·손익%는 BTC 그대로(R15)
// DOM은 createElement·textContent만(CSP — 인라인 꾸밈 속성·HTML 문자열 넣기 없음)
import { CTL_TEXT } from '../lib/ctl-text.js';
import { CTL_KINDS, CTL_MAX_TARGETS, CTL_GROUPS_MAX } from '../lib/ctl-client.js';
import {
  markText, posLine, posCells, autoWord, balText, balLine, lowBal, agoText, passes, sortRows, summaryOf, summaryLines, resultText, fmtUsd, pickOf, enterSkips, buySkips, reduceSkips, addmSkips,
  FILTER_KEYS, MARK_SYMBOL,
} from '../lib/ctl-view.js';
import { enterDefaults, buyDefaults, reduceDefaults, addmDefaults } from '../lib/ctl-enter-rules.js';
import { fetchCandles } from '../lib/hub.js';
import { fmtHM } from '../lib/auto-view.js';
import { attributionLink } from '../modes/trade.js';
import { createCtlChart } from './ctl-chart.js';
import { buildEnterForm, buildBuyForm, buildReduceForm, buildAddmForm } from './ctl-enter.js';
// 명령 띠 단추 — 수동 매수(buy — 계획 Task 12)·줄이기(reduce — Task 13)는 띠에 따로 두지 않고 새 진입 시트의 '수동' 탭(열기·닫기)에서
const STRIP_KINDS = Object.freeze(CTL_KINDS.filter((k) => k !== 'buy' && k !== 'reduce'));
const ARGS_KINDS = Object.freeze(['enter', 'buy', 'reduce', 'addm']); // 본문에 args를 싣는 명령(그 밖은 seenAt)
const RULE_KINDS = Object.freeze(['enter', 'addm']); // 규칙이 없는 판이면 잠기는 띠 단추

export const CTL_LIST_MS = 10000;
export const CTL_POLL_MS = 2000;
export const CTL_POLL_MAX_MS = 30000;
const LOG_MAX = 30;

// enterRules = 새 진입 인자 규칙(lib/ctl-enter-rules.js enterRulesOf — null이면 '새 진입' 잠김)
export function createCtlScreen({
  doc = globalThis.document, win = globalThis.window, root, client, hubBase = '',
  timers = globalThis, now = () => Date.now(), wide = () => false,
  loadLib = null, loadCandles = (q) => fetchCandles({ base: hubBase, ...q }),
  clipboard = win && win.navigator ? win.navigator.clipboard : null, enterRules = null,
}) {
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const button = (cls, text, onClick, type = 'button') => {
    const b = el('button', cls, text);
    b.type = type;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };
  const input = (cls, type, auto, label) => {
    const i = el('input', cls);
    i.type = type;
    i.setAttribute('autocomplete', auto);
    i.setAttribute('autocapitalize', 'none');
    i.setAttribute('spellcheck', 'false');
    if (label) i.setAttribute('aria-label', label);
    return i;
  };
  const field = (label, inp) => {
    const l = el('label', 'ctl-field');
    l.append(el('span', 'ctl-field-k', label), inp);
    return l;
  };

  const S = {
    visible: false, phase: 'boot', data: null, err: null,
    groups: [], group: '', checked: new Set(), filters: new Set(), sort: null, tab: 'members',
    posChecked: new Set(), // 포지션 탭 체크 `${회원 해시}|${종목}`(2026-11-10 — 회원 탭 checked와 따로)
    log: [], sheet: null,
    pick: null, // 차트에 그릴 포지션 { h, id } — 목록에서 사라지면 풀림
    chartOpen: true, // 휴대폰 차트 칸(PC는 늘 보임) — boot에서 기기 저장소 값으로
  };
  let listTimer = null;
  let listSeq = 0;
  let booting = null;
  let gen = 0; // 로그인 세대(최종 검토 고침 F2) — 로그아웃·401·새 로그인마다 올림. 앞 세대의 명령·결과 답은 화면·기록에 닿지 않음

  // ── 뼈대(한 번) ──
  const ui = {};
  function build() {
    // 로그인 — form + type=password(브라우저 비밀번호 저장 허용), 제출은 막고 fetch로만(CSP form-action 'none')
    ui.login = el('form', 'ctl-login');
    ui.login.setAttribute('autocomplete', 'on');
    ui.id = input('ctl-id', 'text', 'username');
    ui.id.name = 'username';
    ui.pw = input('ctl-pw', 'password', 'current-password');
    ui.pw.name = 'password';
    ui.loginBtn = button('big-btn ctl-login-btn', CTL_TEXT.login, null, 'submit');
    ui.loginMsg = el('p', 'ctl-login-msg');
    ui.loginMsg.setAttribute('role', 'status');
    ui.login.append(el('h2', 'ctl-login-head', CTL_TEXT.loginHead), field(CTL_TEXT.id, ui.id), field(CTL_TEXT.pw, ui.pw), ui.loginBtn, ui.loginMsg);
    ui.login.addEventListener('submit', (e) => { if (e && e.preventDefault) e.preventDefault(); doLogin(); });

    ui.main = el('div', 'ctl-main');
    // 설정 줄
    const top = el('div', 'ctl-top');
    ui.msg = el('span', 'ctl-msg');
    ui.msg.setAttribute('role', 'status');
    ui.pwBtn = button('ui-chip ctl-pwbtn', CTL_TEXT.pwChange, () => { ui.pwForm.hidden = !ui.pwForm.hidden; ui.pwMsg.textContent = ''; });
    ui.logoutBtn = button('ui-chip ctl-logout', CTL_TEXT.logout, () => doLogout());
    top.append(ui.msg, ui.pwBtn, ui.logoutBtn);
    ui.pwForm = el('form', 'ctl-pwform');
    ui.pwForm.hidden = true;
    ui.pwOld = input('ctl-pwold', 'password', 'current-password');
    ui.pwNew = input('ctl-pwnew', 'password', 'new-password');
    const pwRow = el('div', 'ctl-btns');
    pwRow.append(button('big-btn ctl-pwsave', CTL_TEXT.pwSave, null, 'submit'), button('big-btn alt ctl-pwcancel', CTL_TEXT.cancel, () => { ui.pwForm.hidden = true; clearPw(); }));
    ui.pwForm.append(field(CTL_TEXT.pwOld, ui.pwOld), field(CTL_TEXT.pwNew, ui.pwNew), pwRow);
    ui.pwForm.addEventListener('submit', (e) => { if (e && e.preventDefault) e.preventDefault(); doPassword(); });
    ui.pwMsg = el('p', 'ctl-pwmsg');
    ui.pwMsg.setAttribute('role', 'status');
    // 그룹 칩·새 그룹
    ui.groups = el('div', 'ctl-groups');
    ui.gForm = el('form', 'ctl-gform');
    ui.gForm.hidden = true;
    ui.gName = input('ctl-gname', 'text', 'off', CTL_TEXT.groupName);
    ui.gName.setAttribute('maxlength', '20');
    ui.gName.setAttribute('placeholder', CTL_TEXT.groupName);
    ui.gForm.append(ui.gName, button('ui-chip on ctl-gsave', CTL_TEXT.groupSave, null, 'submit'), button('ui-chip ctl-gcancel', CTL_TEXT.cancel, () => { ui.gForm.hidden = true; ui.gName.value = ''; }));
    ui.gForm.addEventListener('submit', (e) => { if (e && e.preventDefault) e.preventDefault(); saveGroup(); });
    ui.gMsg = el('p', 'ctl-gmsg');
    // 표시가·차트 머리(고른 포지션·선택 풀기·접기 단추)·차트(PC 왼쪽 위 칸 — 휴대폰은 표 위, 접고 펴는 칸)
    const chartCol = el('div', 'ctl-chartcol');
    const chartTop = el('div', 'ctl-chart-top');
    ui.mark = el('div', 'ctl-mark');
    ui.chartHead = el('div', 'ctl-chart-head');
    ui.chartToggle = button('ui-chip ctl-chart-toggle', CTL_TEXT.chart.close, () => toggleChart());
    chartTop.append(ui.mark, ui.chartHead, ui.chartToggle);
    ui.chart = el('div', 'ctl-chart');
    ui.chartBox = el('div', 'ctl-chart-box');
    ui.chart.append(ui.chartBox, attributionLink(doc));
    ui.chart.hidden = true;
    chartCol.append(chartTop, ui.chart);
    // 오른쪽(PC)·위(휴대폰) — 요약 카드 + 명령 띠
    const side = el('div', 'ctl-side');
    ui.sum = el('section', 'ctl-sum');
    ui.strip = el('div', 'ctl-strip');
    ui.count = el('span', 'ctl-count');
    ui.cmdBtns = STRIP_KINDS.map((k) => {
      const b = button(`ctl-cmd ctl-cmd-${k}`, CTL_TEXT.kinds[k], () => openSheet(k));
      b.dataset.kind = k;
      return b;
    });
    const cmdRow = el('div', 'ctl-cmdrow');
    cmdRow.append(...ui.cmdBtns);
    ui.stripMsg = el('p', 'ctl-strip-msg');
    ui.strip.append(ui.count, cmdRow, ui.stripMsg);
    side.append(ui.sum, ui.strip);
    // 아래 — 탭·필터·표
    const list = el('div', 'ctl-list');
    ui.tabs = el('div', 'ctl-tabs');
    ui.tabs.setAttribute('role', 'tablist');
    ui.tools = el('div', 'ctl-tools');
    ui.filters = FILTER_KEYS.map((f) => {
      const b = button('ui-chip ctl-filter', CTL_TEXT.filters[f], () => { if (S.filters.has(f)) S.filters.delete(f); else S.filters.add(f); render(); });
      b.dataset.f = f;
      return b;
    });
    ui.sorts = [['bal', CTL_TEXT.sortBal], ['pnl', CTL_TEXT.sortPnl]].map(([k, t]) => {
      const b = button('ui-chip ctl-sort', t, () => { S.sort = S.sort === k ? null : k; render(); });
      b.dataset.sort = k;
      return b;
    });
    const allLab = el('label', 'ctl-all-lab');
    ui.all = el('input', 'ctl-all');
    ui.all.type = 'checkbox';
    ui.all.addEventListener('change', () => {
      if (S.tab === 'positions') {
        for (const { m, t } of shownPos()) { const k = posKey(m.h, t.symbol); if (ui.all.checked) S.posChecked.add(k); else S.posChecked.delete(k); }
      } else for (const m of shownRows()) { if (ui.all.checked) S.checked.add(m.h); else S.checked.delete(m.h); }
      render();
    });
    allLab.append(ui.all, el('span', null, CTL_TEXT.selectAll));
    ui.tools.append(...ui.filters, ...ui.sorts, allLab);
    ui.pane = el('div', 'ctl-pane');
    list.append(ui.tabs, ui.tools, ui.pane);
    ui.main.append(top, ui.pwForm, ui.pwMsg, ui.groups, ui.gForm, ui.gMsg, chartCol, side, list);
    ui.main.hidden = true;
    ui.login.hidden = true;
    root.replaceChildren(ui.login, ui.main);
  }
  build();
  const chart = createCtlChart({ doc, win, box: ui.chartBox, loadLib, loadCandles });

  // ── 고르기 ──
  const members = () => (S.data ? S.data.members : []);
  const mark = () => (S.data ? S.data.mark : null);
  const picked = () => pickOf(members(), S.pick);
  const isPick = (h, id) => !!S.pick && S.pick.h === h && S.pick.id === id;
  const groupOf = (name) => S.groups.find((g) => g.name === name) || null;
  function scopeRows() {
    const g = S.group ? groupOf(S.group) : null;
    if (!g) return members();
    const set = new Set(g.members);
    return members().filter((m) => set.has(m.h));
  }
  const visibleRows = () => sortRows(scopeRows().filter((m) => passes(m, S.filters, mark())), S.sort, mark());
  // 체크·전체 선택·명령 대상이 보는 줄 — 포지션 탭은 포지션 있는 회원 줄만 보이므로 그 회원만(2026-11-02 — 숨은 체크는 보내지 않음)
  const shownRows = () => (S.tab === 'positions' ? visibleRows().filter((m) => m.trades.length > 0) : visibleRows());
  // 포지션 탭(2026-11-10 동업자 'BTC만 정리하려 해도 다른 코인까지'): 체크는 포지션(회원 + 종목)마다. 명령 대상 회원 = 고른 포지션의 회원,
  // 정리는 고른 종목만(종목마다 줄이기 100%)
  const posKey = (h, sym) => `${h}|${sym}`;
  const shownPos = () => shownRows().flatMap((m) => m.trades.map((t) => ({ m, t })));
  const pickedPos = () => shownPos().filter((p) => S.posChecked.has(posKey(p.m.h, p.t.symbol)));
  const targets = () => {
    if (S.tab !== 'positions') return shownRows().filter((m) => S.checked.has(m.h));
    const seen = new Set();
    return pickedPos().map((p) => p.m).filter((m) => (seen.has(m.h) ? false : (seen.add(m.h), true)));
  };
  // 종목마다 고른 회원 [[종목, [해시…]]…] — 보이는 차례대로
  const coinGroups = () => {
    const g = new Map();
    for (const { m, t } of pickedPos()) {
      const hs = g.get(t.symbol) || [];
      if (!hs.includes(m.h)) hs.push(m.h);
      g.set(t.symbol, hs);
    }
    return [...g];
  };

  // ── 그리기 ──
  function render() {
    ui.login.hidden = S.phase !== 'login';
    ui.main.hidden = S.phase !== 'main';
    if (S.phase !== 'main') return;
    renderGroups();
    ui.mark.textContent = markText(mark());
    renderChartHead();
    renderSummary();
    renderStrip();
    renderTabs();
    for (const b of ui.filters) { b.classList.toggle('on', S.filters.has(b.dataset.f)); b.setAttribute('aria-pressed', String(S.filters.has(b.dataset.f))); }
    for (const b of ui.sorts) { b.classList.toggle('on', S.sort === b.dataset.sort); b.setAttribute('aria-pressed', String(S.sort === b.dataset.sort)); }
    const vis = visibleRows();
    if (S.tab === 'positions') {
      const ps = shownPos();
      ui.all.checked = ps.length > 0 && ps.every((p) => S.posChecked.has(posKey(p.m.h, p.t.symbol)));
    } else {
      const shown = shownRows();
      ui.all.checked = shown.length > 0 && shown.every((m) => S.checked.has(m.h));
    }
    ui.tools.hidden = S.tab === 'log';
    ui.picks = [];
    if (S.tab === 'positions') renderPositions(vis);
    else if (S.tab === 'log') renderLog();
    else renderMembers(vis);
    if (S.err) ui.msg.textContent = CTL_TEXT.listErr[S.err] || CTL_TEXT.listErr.down;
  }
  function chip(text, cls, on, onClick, key) {
    const b = button(`ui-chip ctl-gchip${cls ? ` ${cls}` : ''}`, text, onClick);
    b.dataset.group = key;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    return b;
  }
  // 차트 머리 — 고른 포지션('UID · 종목 방향 N차' + 선택 풀기) 또는 안내, 접기 단추는 휴대폰만
  function renderChartHead() {
    const p = picked();
    if (p) {
      const { m, t } = p;
      ui.chartHead.replaceChildren(
        el('span', 'ctl-chart-title on', CTL_TEXT.chart.picked(m.uid || CTL_TEXT.uidWait, t.symbol, CTL_TEXT.side[t.side] || t.side, t.stage)),
        button('ui-chip ctl-unpick', CTL_TEXT.chart.unpick, () => setPick(null)),
      );
    } else ui.chartHead.replaceChildren(el('span', 'ctl-chart-title', CTL_TEXT.chart.hint));
    // 그 종목 봉을 못 받음(F7) — 차트는 비우고 머리 줄에 짧게
    const sym = p ? p.t.symbol : MARK_SYMBOL;
    if (chartOn() && chart.missing() === sym) ui.chartHead.append(el('span', 'ctl-chart-miss', CTL_TEXT.chart.none));
    ui.chartToggle.hidden = wide();
    ui.chartToggle.textContent = S.chartOpen ? CTL_TEXT.chart.close : CTL_TEXT.chart.open;
    ui.chartToggle.setAttribute('aria-expanded', String(S.chartOpen));
  }
  // 포지션 줄 표시(.pick·aria-pressed) — 표를 다시 그리지 않고 고친다(키보드 초점이 그 줄에 남게)
  function markPicks() {
    for (const n of ui.picks || []) {
      const on = isPick(n.dataset.h, n.dataset.id);
      n.classList.toggle('pick', on);
      n.setAttribute('aria-pressed', String(on));
    }
  }
  function pickable(node, h, id) {
    node.dataset.h = h;
    node.dataset.id = id;
    node.classList.toggle('pick', isPick(h, id));
    node.setAttribute('aria-pressed', String(isPick(h, id)));
    ui.picks.push(node);
    return node;
  }
  function renderGroups() {
    const chips = [chip(CTL_TEXT.all, '', S.group === '', () => pickGroup(''), '')];
    for (const g of S.groups) chips.push(chip(g.name, '', S.group === g.name, () => pickGroup(g.name), g.name));
    chips.push(chip(CTL_TEXT.newGroup, 'ctl-gnew', false, () => newGroup(), '+'));
    ui.groups.replaceChildren(...chips);
  }
  function renderSummary() {
    const g = S.group ? groupOf(S.group) : null;
    const scope = scopeRows();
    const head = el('div', 'ctl-sum-head');
    head.append(el('h3', 'ctl-sum-title', g ? CTL_TEXT.sumGroup(g.name) : CTL_TEXT.sumAll));
    if (g) head.append(button('ui-chip ctl-gdel', CTL_TEXT.groupDel, () => deleteGroup(g.name)));
    const items = el('div', 'ctl-sum-items');
    for (const t of summaryLines(summaryOf(scope, mark()))) items.append(el('span', 'ctl-sum-item', t));
    const kids = [head, items];
    if (g) {
      const miss = g.members.length - scope.length;
      if (miss > 0) kids.push(el('p', 'ctl-sum-missing', CTL_TEXT.missing(miss)));
    }
    ui.sum.replaceChildren(...kids);
  }
  function renderStrip() {
    const n = targets().length;
    ui.count.textContent = S.tab === 'positions' ? CTL_TEXT.pickedPos(pickedPos().length) : CTL_TEXT.picked(n);
    const over = n > CTL_MAX_TARGETS;
    for (const b of ui.cmdBtns) b.disabled = n === 0 || over || (RULE_KINDS.includes(b.dataset.kind) && !enterRules);
    ui.stripMsg.textContent = over ? CTL_TEXT.tooMany : !enterRules ? CTL_TEXT.enter.off : '';
  }
  function renderTabs() {
    const vis = visibleRows();
    const defs = [['members', CTL_TEXT.tabs.members(vis.length)], ['positions', CTL_TEXT.tabs.positions(vis.reduce((s, m) => s + m.trades.length, 0))], ['log', CTL_TEXT.tabs.log]];
    ui.tabs.replaceChildren(...defs.map(([k, t]) => {
      const b = button('ctl-tab', t, () => { S.tab = k; render(); });
      b.dataset.tab = k;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(S.tab === k));
      b.classList.toggle('on', S.tab === k);
      return b;
    }));
  }
  // 회원 체크 칸(회원 탭·포지션 탭 같은 S.checked) — 포지션 탭 줄은 누르면 차트 고름이라 체크 칸의 누름·키는 줄로 올리지 않는다(2026-11-02)
  function checkCell(m) {
    const lab = el('label', 'ctl-c-chk');
    const chk = el('input', 'ctl-chk');
    chk.type = 'checkbox';
    chk.checked = S.checked.has(m.h);
    chk.setAttribute('aria-label', m.uid || CTL_TEXT.uidWait);
    chk.addEventListener('change', () => { if (chk.checked) S.checked.add(m.h); else S.checked.delete(m.h); render(); });
    for (const t of ['click', 'keydown']) lab.addEventListener(t, (e) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); });
    lab.append(chk);
    return lab;
  }
  // 포지션 탭 체크 칸(2026-11-10) — 그 포지션(회원 + 종목)만
  function posCheckCell(m, t) {
    const k = posKey(m.h, t.symbol);
    const lab = el('label', 'ctl-c-chk');
    const chk = el('input', 'ctl-chk');
    chk.type = 'checkbox';
    chk.checked = S.posChecked.has(k);
    chk.setAttribute('aria-label', `${m.uid || CTL_TEXT.uidWait} ${t.symbol}`);
    chk.addEventListener('change', () => { if (chk.checked) S.posChecked.add(k); else S.posChecked.delete(k); render(); });
    for (const ev of ['click', 'keydown']) lab.addEventListener(ev, (e) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); });
    lab.append(chk);
    return lab;
  }
  function renderMembers(vis) {
    if (!S.data) { ui.pane.replaceChildren(el('p', 'ctl-empty', S.err ? CTL_TEXT.listErr[S.err] || CTL_TEXT.listErr.down : CTL_TEXT.loggingIn)); return; }
    if (!members().length) { ui.pane.replaceChildren(el('p', 'ctl-empty', CTL_TEXT.empty)); return; }
    const box = el('div', 'ctl-rows');
    const head = el('div', 'ctl-hrow');
    const C = CTL_TEXT.cols;
    head.append(el('span', 'ctl-h-chk'), el('span', null, C.uid), el('span', null, C.o), el('span', null, C.bal), el('span', null, C.auto), el('span', null, C.pos), el('span', null, C.ago));
    box.append(head);
    if (!vis.length) box.append(el('p', 'ctl-empty', CTL_TEXT.noRows));
    const t = now();
    for (const m of vis) {
      const row = el('div', 'ctl-row');
      row.dataset.h = m.h;
      row.classList.toggle('picked', S.checked.has(m.h));
      const lab = checkCell(m);
      const uid = m.uid ? button('ctl-uid', m.uid, () => copy(m.uid)) : el('span', 'ctl-uid wait', CTL_TEXT.uidWait);
      const bal = el('span', 'ctl-c-bal');
      const bv = el('span', `ctl-bal${lowBal(m) ? ' low' : ''}`, balText(m));
      bal.append(bv);
      if (m.bal) bal.append(el('span', 'ctl-avail', CTL_TEXT.avail(fmtUsd(m.bal.avail))));
      const a = autoWord(m);
      const pos = el('div', 'ctl-pos');
      if (m.trades.length) for (const tr of m.trades) pos.append(pickable(button('ctl-pline', posLine(tr, mark()), () => pickRow(m.h, tr.id)), m.h, tr.id));
      else pos.textContent = CTL_TEXT.noPos;
      row.append(lab, uid, el('span', 'ctl-o', m.o || CTL_TEXT.dash), bal, el('span', `ctl-auto ${a.tone}`, a.text), pos, el('span', 'ctl-ago', agoText(m.lastCheck, t)));
      box.append(row);
    }
    ui.pane.replaceChildren(box);
  }
  function renderPositions(vis) {
    const box = el('div', 'ctl-prows');
    const P = CTL_TEXT.pcols;
    const head = el('div', 'ctl-phead');
    head.append(el('span', 'ctl-h-chk'));
    for (const t of [P.uid, P.pos, P.lev, P.stage, P.avg, P.pnl, P.src, P.bal]) head.append(el('span', null, t));
    box.append(head);
    let n = 0;
    for (const m of vis) for (const t of m.trades) {
      const row = pickable(el('div', 'ctl-prow'), m.h, t.id);
      row.classList.toggle('picked', S.posChecked.has(posKey(m.h, t.symbol)));
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.addEventListener('click', () => pickRow(m.h, t.id));
      row.addEventListener('keydown', (e) => {
        if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
        if (typeof e.preventDefault === 'function') e.preventDefault();
        pickRow(m.h, t.id);
      });
      const cells = el('div', 'ctl-pcells');
      for (const c of posCells(m, t, mark())) cells.append(el('span', null, c));
      cells.append(el('span', 'ctl-pbal', balLine(m)));
      row.append(posCheckCell(m, t), cells);
      box.append(row);
      n += 1;
    }
    if (!n) box.append(el('p', 'ctl-empty', CTL_TEXT.noPos));
    ui.pane.replaceChildren(box);
  }
  function resultList(entry) {
    const ol = el('ul', 'ctl-reslist');
    for (const h of entry.targets) {
      const r = entry.results.get(h);
      const li = el('li', `ctl-res${r ? (r.ok ? ' good' : ' bad') : ''}`, `${entry.uids.get(h)} · ${resultText(r, entry.state)}`);
      ol.append(li);
    }
    return ol;
  }
  function renderLog() {
    const box = el('div', 'ctl-log');
    if (!S.log.length) box.append(el('p', 'ctl-empty', CTL_TEXT.logEmpty));
    for (const e of S.log) {
      const item = el('section', 'ctl-log-item');
      const kindText = e.sym ? `${CTL_TEXT.kinds[e.kind]} · ${e.sym}` : CTL_TEXT.kinds[e.kind]; // 코인별 정리는 종목까지
      item.append(el('h4', 'ctl-log-head', CTL_TEXT.logHead(fmtHM(e.at), kindText, e.targets.length)), resultList(e));
      box.append(item);
    }
    ui.pane.replaceChildren(box);
  }

  // ── 시트(확인 → 결과) ──
  function closeSheet() {
    if (!S.sheet) return;
    S.sheet.node.remove();
    S.sheet = null;
  }
  // 시트 줄 — 새 진입은 입력 칸 동안 이름만, 그 뒤 '새 진입'·요약·대상·건너뛸 회원 / 수동 탭으로 고르면 '수동 매수'·요약·대상·건너뛸 회원
  // (보낸 뒤에도 무엇을 보냈는지 남김)
  function sheetLines(sh) {
    if (sh.phase === 'form') return [CTL_TEXT.kinds[sh.kind]];
    if (sh.kind === 'enter') return [CTL_TEXT.kinds.enter, CTL_TEXT.enter.summary(sh.args), CTL_TEXT.sheet.target(sh.targets.length), CTL_TEXT.enter.skip(sh.skips)];
    if (sh.kind === 'buy') return [CTL_TEXT.kinds.buy, CTL_TEXT.buy.summary(sh.args), CTL_TEXT.sheet.target(sh.targets.length), CTL_TEXT.buy.skip(sh.skips)];
    if (sh.kind === 'reduce') return [CTL_TEXT.kinds.reduce, CTL_TEXT.reduce.summary(sh.args), CTL_TEXT.sheet.target(sh.targets.length), CTL_TEXT.reduce.skip(sh.skips)];
    if (sh.kind === 'addm') return [CTL_TEXT.kinds.addm, CTL_TEXT.addm.summary(sh.args), CTL_TEXT.sheet.target(sh.targets.length), CTL_TEXT.addm.skip(sh.skips)];
    if (sh.perCoin) return [CTL_TEXT.kinds.close, CTL_TEXT.sheet.perCoin, CTL_TEXT.sheet.coins(sh.perCoin)];
    const lines = [CTL_TEXT.kinds[sh.kind], CTL_TEXT.sheet.target(sh.targets.length), CTL_TEXT.sheet.withPos(sh.withPos)];
    if (sh.kind === 'close' && sh.autoOn > 0) lines.push(CTL_TEXT.sheet.autoHint);
    return lines;
  }
  // 새 진입 시트 위 탭 둘 — '기본'(AI 진입과 같은 값 — R16)·'수동'(수동 모드 열기 — R17). 바꾸면 그 탭 입력 칸(값은 칸마다 남음)·글 지움
  function tabRow(sh) {
    const r = el('div', 'ctl-en-tabs');
    r.setAttribute('role', 'tablist');
    for (const k of ['base', 'free']) {
      const b = button(`ui-chip ctl-en-tab${sh.tab === k ? ' on' : ''}`, CTL_TEXT.enter.tabs[k], () => {
        if (sh.tab === k) return;
        sh.tab = k;
        sh.formErr = '';
        drawSheet();
      });
      b.dataset.tab = k;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(sh.tab === k));
      r.append(b);
    }
    return r;
  }
  // 수동 탭 안 고르기 '열기'(수동 매수 — R17)·'닫기'(줄이기 — R18, 계획 Task 13). 바꾸면 그 칸(값은 칸마다 남음)·글 지움
  function actRow(sh) {
    const r = el('div', 'ctl-fr-acts');
    for (const [k, t] of [['open', CTL_TEXT.buy.open], ['close', CTL_TEXT.reduce.close]]) {
      const b = button(`ui-chip ctl-fr-act${sh.act === k ? ' on' : ''}`, t, () => {
        if (sh.act === k) return;
        sh.act = k;
        sh.formErr = '';
        drawSheet();
      });
      b.dataset.act = k;
      b.setAttribute('aria-pressed', String(sh.act === k));
      r.append(b);
    }
    return r;
  }
  function drawSheet() {
    const sh = S.sheet;
    if (!sh) return;
    const box = el('div', 'ui-modal-box ctl-sheet-box');
    sheetLines(sh).forEach((t, i) => box.append(el(i === 0 ? 'h2' : 'p', `ctl-sheet-line${i === 0 ? ' ui-modal-title' : ''}${t === CTL_TEXT.sheet.autoHint ? ' hint' : ''}`, t)));
    if (sh.phase === 'form') {
      // 탭 + 그 탭 입력 칸(같은 노드를 다시 붙임 — 다시 그려도 넣은 값이 남음). 기본 탭은 [다음], 수동 탭은 열기·닫기 고르기 + 칸 안의 [매수·롱]·[매도·숏]·[줄이기]가 확인으로
      const msg = el('p', 'ctl-en-msg', sh.formErr || '');
      msg.setAttribute('role', 'status');
      const row = el('div', 'ctl-btns');
      if (sh.kind === 'addm') row.append(button('big-btn accent ctl-am-next', CTL_TEXT.enter.next, () => nextAddm()));
      else if (sh.tab === 'base') row.append(button('big-btn accent ctl-en-next', CTL_TEXT.enter.next, () => nextEnter()));
      row.append(button('big-btn alt ctl-cancel', CTL_TEXT.cancel, () => closeSheet()));
      if (sh.kind === 'addm') box.append(sh.addmForm.node, msg, row); // 수동 추가는 탭 없이 칸 하나
      else {
        const pane = sh.tab === 'free' ? [actRow(sh), sh.act === 'close' ? sh.reduceForm.node : sh.buyForm.node] : [sh.form.node];
        box.append(tabRow(sh), ...pane, msg, row);
      }
    } else if (sh.phase === 'confirm') {
      const row = el('div', 'ctl-btns');
      const runText = sh.kind === 'enter' ? CTL_TEXT.enter.run : ['buy', 'reduce', 'addm'].includes(sh.kind) ? CTL_TEXT.buy.send : CTL_TEXT.sheet.run;
      const tone = sh.kind === 'close' || sh.kind === 'reduce' ? 'danger' : 'accent';
      row.append(button(`big-btn ${tone} ctl-run`, runText, () => runSheet()), button('big-btn alt ctl-cancel', CTL_TEXT.cancel, () => closeSheet()));
      box.append(row);
    } else {
      // 코인별 정리면 종목 기록 모두를 하나로 — 다 끝 · 하나라도 응답 없음 · 늦음 · 받는 중
      const es = sh.entries && sh.entries.length ? sh.entries : null;
      const e = es ? {
        state: es.every((x) => x.state === 'done') ? 'done' : es.some((x) => x.state === 'expired') ? 'expired' : 'queued',
        late: es.some((x) => x.late), entries: es,
      } : sh.entry;
      const stateText = sh.error && !es ? sh.error
        : !e ? CTL_TEXT.sheet.sending
          : e.state === 'done' ? CTL_TEXT.sheet.done
            : e.state === 'expired' ? CTL_TEXT.sheet.expired
              : e.late ? CTL_TEXT.sheet.late : CTL_TEXT.sheet.waiting;
      box.append(el('p', `ctl-sheet-state${sh.error ? ' bad' : ''}`, stateText));
      if (es && sh.error) box.append(el('p', 'ctl-sheet-state bad', sh.error)); // 일부 종목만 거절됨
      if (sh.entries) { // 코인별 정리 — 종목마다 결과
        for (const x of sh.entries) box.append(el('p', 'ctl-sheet-coin', x.sym), resultList(x));
      } else if (e) box.append(resultList(e));
      const row = el('div', 'ctl-btns');
      if (e && e.late && e.state === 'queued') row.append(button('big-btn alt ctl-recheck', CTL_TEXT.sheet.recheck, () => (es ? es.forEach((x) => recheck(x)) : recheck(e))));
      row.append(button('big-btn alt ctl-close', CTL_TEXT.sheet.close, () => closeSheet()));
      box.append(row);
    }
    sh.node.replaceChildren(box);
  }
  function openSheet(kind) {
    const list = targets();
    if (!list.length || list.length > CTL_MAX_TARGETS) return;
    const enter = kind === 'enter';
    const addm = kind === 'addm';
    if ((enter || addm) && !enterRules) return; // 규칙이 없는 판 — 단추도 잠겨 있음
    closeSheet();
    const node = el('div', 'ui-modal ctl-sheet');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-label', CTL_TEXT.kinds[kind]);
    node.addEventListener('click', (e) => { if (e && e.target === node && S.sheet && S.sheet.phase !== 'sent') closeSheet(); });
    // seenAt(최종 검토 고침 F1) = 시트를 연 때 본 목록의 허브 now — 시트가 열린 사이 목록이 새로 와도 이 값(실행기는 그 뒤 체결이면 다음 차수를 넣지 않음)
    const seenAt = S.data && Number.isFinite(S.data.now) ? Math.floor(S.data.now) : null;
    S.sheet = {
      node, kind, phase: enter || addm ? 'form' : 'confirm', targets: list.map((m) => m.h), uids: new Map(list.map((m) => [m.h, m.uid || CTL_TEXT.uidWait])),
      withPos: list.filter((m) => m.trades.length > 0).length, autoOn: list.filter((m) => m.auto === true).length, entry: null, error: null, seenAt,
      // 새 진입: 시트를 연 때의 대상 회원(건너뛸 회원 셈)·탭(기본·수동)·수동 탭 안 열기·닫기(act)·입력 칸 셋·확인한 값.
      // 확인으로 넘어갈 때 kind가 enter(기본)·buy(수동 열기)·reduce(수동 닫기 — Task 13)
      members: enter || addm ? list : null, tab: 'base', act: 'open', formErr: '', args: null, skips: 0,
      form: enter ? buildEnterForm({ doc, rules: enterRules, init: enterDefaults(enterRules) }) : null,
      buyForm: enter ? buildBuyForm({ doc, rules: enterRules, init: buyDefaults(enterRules), onSide: (d) => nextBuy(d) }) : null,
      reduceForm: enter ? buildReduceForm({ doc, rules: enterRules, init: reduceDefaults(enterRules), onRun: () => nextReduce() }) : null,
      addmForm: addm ? buildAddmForm({ doc, rules: enterRules, init: addmDefaults(enterRules) }) : null,
      perCoin: kind === 'close' && S.tab === 'positions' ? coinGroups() : null, // 포지션 탭 정리 — 고른 종목만(2026-11-10)
      entries: null,
    };
    drawSheet();
    root.append(node);
  }
  // 새 진입 [다음](기본 탭) — 값이 규칙 안일 때만 확인 단계로(아니면 입력 칸 그대로 + 글)
  function nextEnter() {
    const sh = S.sheet;
    if (!sh || sh.kind !== 'enter' || sh.phase !== 'form' || sh.tab !== 'base') return;
    const a = sh.form.read();
    if (!a) {
      sh.formErr = CTL_TEXT.enter.bad;
      drawSheet();
      return;
    }
    sh.args = a;
    sh.skips = enterSkips(sh.members, a.symbol);
    sh.formErr = '';
    sh.phase = 'confirm';
    drawSheet();
  }
  // 수동 추가 [다음](대표 요청 2026-11-04) — 값이 규칙 안이면 확인으로(건너뛸 회원 = 그 종목 포지션이 없는 회원)
  function nextAddm() {
    const sh = S.sheet;
    if (!sh || sh.kind !== 'addm' || sh.phase !== 'form') return;
    const a = sh.addmForm.read();
    if (!a) {
      sh.formErr = CTL_TEXT.enter.bad;
      drawSheet();
      return;
    }
    sh.args = a;
    sh.skips = addmSkips(sh.members, a.symbol);
    sh.formErr = '';
    sh.phase = 'confirm';
    drawSheet();
  }
  // 수동 탭 [매수·롱]·[매도·숏] — 방향을 정하고 값이 규칙 안이면 수동 매수(buy) 확인으로
  // 수동 탭 닫기 [줄이기](Task 13 — R18) — 값이 규칙 안이면 줄이기(reduce) 확인으로(건너뛸 회원 = 그 종목 포지션이 없는 회원)
  function nextReduce() {
    const sh = S.sheet;
    if (!sh || sh.kind !== 'enter' || sh.phase !== 'form' || sh.tab !== 'free' || sh.act !== 'close') return;
    const a = sh.reduceForm.read();
    if (!a) {
      sh.formErr = CTL_TEXT.enter.bad;
      drawSheet();
      return;
    }
    sh.kind = 'reduce';
    sh.args = a;
    sh.skips = reduceSkips(sh.members, a.symbol);
    sh.formErr = '';
    sh.phase = 'confirm';
    drawSheet();
  }
  function nextBuy(dir) {
    const sh = S.sheet;
    if (!sh || sh.kind !== 'enter' || sh.phase !== 'form' || sh.tab !== 'free' || sh.act !== 'open') return;
    const a = sh.buyForm.read(dir);
    if (!a) {
      sh.formErr = CTL_TEXT.enter.bad;
      drawSheet();
      return;
    }
    sh.kind = 'buy';
    sh.args = a;
    sh.skips = buySkips(sh.members, a.symbol, a.dir);
    sh.formErr = '';
    sh.phase = 'confirm';
    drawSheet();
  }
  function cmdErrText(r, kind) {
    if (kind === 'addm' && r.error === 'entry_off') return CTL_TEXT.addm.off;
    const f = CTL_TEXT.cmdErr[r.error];
    if (typeof f === 'function') return f(r.retryAfter);
    return f || CTL_TEXT.cmdErr.down;
  }
  async function runSheet() {
    const sh = S.sheet;
    if (!sh || sh.phase !== 'confirm') return;
    sh.phase = 'sent';
    drawSheet();
    const g = gen;
    if (sh.perCoin) { await runPerCoin(sh, g); return; }
    const r = await client.cmd(sh.kind, sh.targets, ARGS_KINDS.includes(sh.kind) ? sh.args : sh.seenAt); // 새 진입·수동 매수는 args, 그 밖은 seenAt
    if (g !== gen) return; // 답을 기다리는 사이 로그아웃·다른 동업자(F2) — 그 세대 기록에 넣지 않고 결과도 묻지 않음
    if (r.auth) { closeSheet(); toLogin(CTL_TEXT.relogin); return; }
    if (!r.ok) {
      sh.error = cmdErrText(r, sh.kind);
      if (S.sheet === sh) drawSheet();
      if (r.error === 'stale_view') refresh(); // 목록이 오래됨(F1) — 바로 새로 받아 다시 누를 수 있게
      return;
    }
    const entry = { id: r.id, kind: sh.kind, targets: sh.targets, uids: sh.uids, at: now(), t0: now(), state: 'queued', results: new Map(), late: false, timer: null, gen };
    S.log.unshift(entry);
    if (S.log.length > LOG_MAX) S.log.length = LOG_MAX;
    sh.entry = entry;
    // 보낸 뒤 체크: 그룹이면 그 그룹 회원 전부 다시, 전체면 비움(다음 명령을 숨은 체크로 보내지 않게)
    S.checked = S.group ? new Set(scopeRows().map((m) => m.h)) : new Set();
    S.posChecked = new Set();
    render();
    if (S.sheet === sh) drawSheet();
    pollLater(entry);
  }
  // 포지션 탭 정리(2026-11-10): 종목마다 줄이기 100%(reduce — 그 종목 포지션만 감소 전용 시장가, 100%면 전량 정리와 같은 길)를 차례로 보낸다.
  // 기록은 종목마다 한 줄(머리에 '정리 · 종목'), 한 종목이 거절돼도 나머지는 보냄(그 종목 글만 sh.error에)
  async function runPerCoin(sh, g) {
    sh.entries = [];
    const errs = [];
    for (const [sym, hs] of sh.perCoin) {
      const r = await client.cmd('reduce', hs, { symbol: sym, pct: 100 });
      if (g !== gen) return;
      if (r.auth) { closeSheet(); toLogin(CTL_TEXT.relogin); return; }
      if (!r.ok) { errs.push(`${sym} ${cmdErrText(r, 'reduce')}`); continue; }
      const entry = { id: r.id, kind: 'close', sym, targets: hs, uids: sh.uids, at: now(), t0: now(), state: 'queued', results: new Map(), late: false, timer: null, gen };
      S.log.unshift(entry);
      sh.entries.push(entry);
      pollLater(entry);
    }
    if (S.log.length > LOG_MAX) S.log.length = LOG_MAX;
    sh.error = errs.length ? errs.join(' · ') : null;
    sh.entry = sh.entries[0] || null;
    S.posChecked = new Set();
    render();
    if (S.sheet === sh) drawSheet();
  }
  function applyResult(entry, r) {
    entry.state = r.state;
    for (const x of r.results) if (entry.targets.includes(x.h)) entry.results.set(x.h, { ok: x.ok, error: x.error });
  }
  function entryChanged(entry) {
    if (S.sheet && (S.sheet.entry === entry || (S.sheet.entries && S.sheet.entries.includes(entry)))) drawSheet();
    if (S.tab === 'log' && S.phase === 'main') renderLog();
  }
  function pollLater(entry) {
    entry.timer = timers.setTimeout(() => poll(entry), CTL_POLL_MS);
  }
  async function poll(entry) {
    entry.timer = null;
    if (entry.gen !== gen) return;
    const r = await client.cmdResult(entry.id);
    if (entry.gen !== gen) return; // 묻는 사이 로그아웃(F2) — 늦게 온 답은 버림
    if (r.auth) { toLogin(CTL_TEXT.relogin); return; }
    if (r.ok) applyResult(entry, r);
    else if (r.error === 'not_found') entry.state = 'expired';
    if (entry.state === 'queued' && now() + CTL_POLL_MS - entry.t0 <= CTL_POLL_MAX_MS) pollLater(entry);
    else if (entry.state === 'queued') entry.late = true;
    else refresh(); // 끝났으면 목록을 한 번 새로(포지션·오토가 바뀜)
    entryChanged(entry);
  }
  async function recheck(entry) {
    if (entry.gen !== gen) return;
    const r = await client.cmdResult(entry.id);
    if (entry.gen !== gen) return;
    if (r.auth) { toLogin(CTL_TEXT.relogin); return; }
    if (r.ok) applyResult(entry, r);
    else if (r.error === 'not_found') entry.state = 'expired';
    entryChanged(entry);
  }

  // ── 그룹 ──
  function pickGroup(name) {
    S.group = name;
    S.filters = new Set();
    S.checked = name ? new Set(scopeRows().map((m) => m.h)) : new Set();
    ui.gForm.hidden = true;
    ui.gMsg.textContent = '';
    render();
  }
  function newGroup() {
    ui.gMsg.textContent = '';
    if (!targets().length) { ui.gMsg.textContent = CTL_TEXT.groupNeed; ui.gForm.hidden = true; return; }
    ui.gForm.hidden = false;
    if (typeof ui.gName.focus === 'function') ui.gName.focus();
  }
  async function saveGroup() {
    const name = String(ui.gName.value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const list = targets().map((m) => m.h);
    if (!list.length) { ui.gMsg.textContent = CTL_TEXT.groupNeed; return; }
    if (!name) { ui.gMsg.textContent = CTL_TEXT.groupNoName; return; }
    if (groupOf(name)) { ui.gMsg.textContent = CTL_TEXT.groupDup; return; }
    if (S.groups.length >= CTL_GROUPS_MAX) { ui.gMsg.textContent = CTL_TEXT.groupFull; return; }
    if (list.length > CTL_MAX_TARGETS) { ui.gMsg.textContent = CTL_TEXT.groupMax; return; }
    const r = await client.saveGroups([...S.groups, { name, members: list }]);
    S.groups = r.groups;
    ui.gName.value = '';
    ui.gForm.hidden = true;
    ui.gMsg.textContent = CTL_TEXT.groupSaved(name);
    render();
  }
  async function deleteGroup(name) {
    const r = await client.saveGroups(S.groups.filter((g) => g.name !== name));
    S.groups = r.groups;
    if (S.group === name) { S.group = ''; S.checked = new Set(); }
    render();
  }

  // ── 로그인·비밀번호·로그아웃 ──
  async function doLogin() {
    const id = String(ui.id.value || '').trim();
    const pw = String(ui.pw.value || '');
    ui.pw.value = ''; // 비밀번호는 보내는 동안만 이 함수 안에
    if (!id || !pw) { ui.loginMsg.textContent = CTL_TEXT.loginErr.bad_request; return; }
    ui.loginBtn.disabled = true;
    ui.loginBtn.textContent = CTL_TEXT.loggingIn;
    const r = await client.login(id, pw);
    ui.loginBtn.disabled = false;
    ui.loginBtn.textContent = CTL_TEXT.login;
    if (!r.ok) { ui.loginMsg.textContent = CTL_TEXT.loginErr[r.error] || CTL_TEXT.loginErr.down; return; }
    ui.id.value = '';
    ui.loginMsg.textContent = '';
    resetSession(); // 다른 아이디일 수 있음(F2) — 앞 세션 것은 하나도 남기지 않음
    S.phase = 'main';
    S.data = null;
    S.err = null;
    render();
    refresh();
  }
  function clearPw() {
    ui.pwOld.value = '';
    ui.pwNew.value = '';
  }
  async function doPassword() {
    const oldPw = String(ui.pwOld.value || '');
    const newPw = String(ui.pwNew.value || '');
    clearPw();
    const r = await client.password(oldPw, newPw);
    if (r.auth) { toLogin(CTL_TEXT.relogin); return; }
    if (r.ok) {
      ui.pwForm.hidden = true;
      ui.pwMsg.textContent = CTL_TEXT.pwDone;
      return;
    }
    ui.pwMsg.textContent = CTL_TEXT.pwErr[r.error] || CTL_TEXT.pwErr.down;
  }
  async function doLogout() {
    await client.logout();
    toLogin('');
  }
  // 로그인 세션 하나가 만든 것을 모두 비움(최종 검토 고침 F2 — 같은 기기에 다른 동업자가 로그인해도 앞 동업자 범위의 UID·기록이 남지 않게):
  // 명령 기록·결과 묻기 타이머·체크·필터·정렬·탭·그룹 고름·차트 고름·시트·차트 선·마커. 세대를 올려 앞 세대의 늦은 답(목록·명령·결과)을 버린다.
  // 저장한 그룹(기기 저장소)·휴대폰 차트 접힘은 기기 설정이라 남긴다
  function resetSession() {
    gen += 1;
    listSeq += 1;
    for (const e of S.log) {
      if (e.timer != null) timers.clearTimeout(e.timer);
      e.timer = null;
    }
    S.log = [];
    S.checked = new Set();
    S.filters = new Set();
    S.sort = null;
    S.tab = 'members';
    S.group = '';
    S.pick = null;
    closeSheet();
    ui.gForm.hidden = true;
    ui.gName.value = '';
    ui.gMsg.textContent = '';
    ui.msg.textContent = '';
    // 숨긴 화면에도 앞 세션 글(UID·기록·요약)을 남기지 않음 — 다음 로그인 render가 새로 그림
    for (const n of [ui.pane, ui.sum, ui.tabs, ui.chartHead]) n.replaceChildren();
    ui.count.textContent = '';
    ui.mark.textContent = '';
    chart.clear();
  }
  function toLogin(msg) {
    stopList();
    resetSession();
    S.phase = 'login';
    S.data = null;
    S.err = null;
    ui.pwForm.hidden = true;
    clearPw();
    ui.pwMsg.textContent = '';
    ui.loginMsg.textContent = msg || '';
    render();
    drawChart(); // 숨김
  }

  // ── 목록 주기·차트 ──
  function stopList() {
    if (listTimer != null) timers.clearTimeout(listTimer);
    listTimer = null;
  }
  function scheduleList() {
    stopList();
    if (S.visible && S.phase === 'main') listTimer = timers.setTimeout(() => refresh(), CTL_LIST_MS);
  }
  async function refresh() {
    if (!S.visible || S.phase !== 'main') return;
    stopList();
    listSeq += 1;
    const mine = listSeq;
    const r = await client.members();
    if (mine !== listSeq) return;
    if (r.auth) { toLogin(CTL_TEXT.relogin); return; }
    if (r.ok) {
      S.data = { now: r.now, mark: r.mark, members: r.members };
      S.err = null;
      ui.msg.textContent = '';
      const have = new Set(r.members.map((m) => m.h));
      for (const h of [...S.checked]) if (!have.has(h)) S.checked.delete(h);
      if (S.pick && !pickOf(r.members, S.pick)) S.pick = null; // 고른 매매가 정리·익절로 사라짐 → BTC로
    } else S.err = r.error;
    render();
    drawChart();
    scheduleList();
  }
  async function copy(uid) {
    try {
      if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('clip');
      await clipboard.writeText(uid);
      ui.msg.textContent = CTL_TEXT.copied;
    } catch {
      ui.msg.textContent = CTL_TEXT.copyFail;
    }
  }

  // 차트 — 보임·로그인·(PC 넓은 판 또는 휴대폰 칸 펴짐)일 때만 그리고 봉을 받는다(접힌 동안 봉 요청 없음).
  // 고른 포지션이 있으면 그 종목·그 선, 없으면 BTC(목록 주기·고르기·접기·창 크기 바뀜마다). 그린 뒤 머리 줄('차트 없음' — F7)을 맞춤
  function chartOn() {
    return S.visible && S.phase === 'main' && (wide() || S.chartOpen);
  }
  function drawChart() {
    const on = chartOn();
    ui.chart.hidden = !on;
    if (!on) return;
    const p = picked();
    const g = gen;
    Promise.resolve(chart.draw({ symbol: p ? p.t.symbol : MARK_SYMBOL, trade: p ? p.t : null }))
      .then(() => { if (g === gen && S.phase === 'main') renderChartHead(); })
      .catch(() => {});
  }
  function setPick(next) {
    S.pick = next;
    if (next && !S.chartOpen) { // 접힌 채 줄을 고르면 펴고 저장(R14)
      S.chartOpen = true;
      client.saveChartOpen(true);
    }
    markPicks();
    renderChartHead();
    drawChart();
  }
  const pickRow = (h, id) => setPick(isPick(h, id) ? null : { h, id });
  // 휴대폰 접기·펴기 — 기기 저장소에 남김(저장이 막히면 이번 화면 동안만)
  function toggleChart() {
    S.chartOpen = !S.chartOpen;
    client.saveChartOpen(S.chartOpen);
    renderChartHead();
    drawChart();
  }

  // ── 바깥 ──
  async function boot() {
    const [tok, groups, open] = await Promise.all([client.token(), client.loadGroups(), client.loadChartOpen()]);
    S.groups = groups;
    S.chartOpen = open;
    S.phase = tok ? 'main' : 'login';
    render();
  }
  return {
    show() {
      S.visible = true;
      if (S.phase === 'boot') {
        if (!booting) booting = boot().then(() => { booting = null; if (S.visible) refresh(); });
        return;
      }
      render();
      refresh();
    },
    hide() {
      S.visible = false;
      stopList();
    },
    // 창 크기가 PC 경계를 넘나들면 차트·접기 단추만 맞춤(목록은 다시 받지 않음)
    layoutChanged() {
      if (!S.visible) return;
      if (S.phase === 'main') renderChartHead();
      drawChart();
    },
  };
}
