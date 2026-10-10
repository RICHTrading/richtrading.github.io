// 따라가기 화면(#follow, s·j판 인증 회원 + (autoReady 또는 시험 토큰) — 설계 3-2 §6.1·§6.2·§6.14·§6.15, 문구 §8.1 F-01~F-21·L-01).
// 한 번 그리고 update(엔진 state, { keysReady, balance })로 바꾼다 — 입력칸은 다시 그리지 않는다(쓰던 값 유지). DOM은 createElement·textContent로만(CSP).
// 상태 줄 아래 잔고 한 줄(대표 결정 2026-10-10): 띠와 같은 메모리 값의 글을 받기만(setBalance — 잔고가 바뀔 때 app.js가 다시 넘김).
// - 방식(②·③)은 미리 고르지 않는다. 한 매매 최대 증거금은 빈칸으로 시작 — 넣어야 켤 수 있다(대표 결정 2026-10-07).
// - 맨 위에 늘 F-03(기능 한계). 동의 9항목은 처음·동의 판·규칙 판이 바뀌면 전부 눌러야, 방식·값을 바꾸면 요약 한 줄 + 다시 확인.
// - 법정 고지 5줄·고지(원금 손실)를 둔다. 배율은 숫자만.
// - p34(대표 결정 2026-10-08, 동업자 최신판과 같게): 값 칸은 한 매매 최대 증거금·동시 건수뿐(직접 손절·하루 손실·가격 차이 칸 없음).
//   상태 줄 아래에 회원 본인 손익(이 기기 기록 · 거래 비용 제외 · 리허설 따로), 그 아래 '자동 손절' 스위치 하나(기본 켜짐, 따라가기가 켜진 동안에도 바꿈 —
//   트레이딩 탭과 같은 스위치). 손절가·남은 거리는 그리지 않는다 — 기능 한계 한 줄과 매매별 상태 낱말만.
import { FTEXT } from '../lib/follow-text.js';
import { TEXT } from '../lib/auto-view.js';
import { KTEXT } from '../lib/keys.js';
import { AUTO_SL_TEXT } from '../lib/auto-sl.js';
import { parseNum, validateSettings, consentNeeded, summaryLine } from '../lib/follow-settings.js';
import { recordLine, shadowLines, consentLine, pnlLines } from '../lib/follow-view.js';
import { recentTrades } from '../lib/follow-store.js';

const SIDE = Object.freeze({ long: '롱', short: '숏' });

export function renderFollow(el, {
  onEnable = () => {}, onDisable = () => {}, onMoveHere = () => {}, onCleanup = () => {}, onUpdate = () => {}, onSaveConsents = () => {}, onWake = () => {},
  onAutoSl = () => {}, onAutoSlRetry = () => {}, onAutoSlClear = () => {},
  wake = 'none', doc = document,
  kakao = null, // 카카오 문의 주소(config.kakao) — K-11 옆 문의 링크(p35 L-1)
}) {
  const node = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (id, text, cls = 'big-btn') => {
    const b = node('button', cls, text);
    b.type = 'button';
    if (id) b.id = id;
    return b;
  };
  const box = node('div', 'follow');
  const limits = node('p', 'follow-limits', FTEXT.limits); // F-03 — 늘 맨 위
  const status = node('p', 'follow-status dim', FTEXT.stOff);
  status.setAttribute('role', 'status');
  // 잔고 한 줄(대표 결정 2026-10-10 — 이 화면은 덮는 화면이라 상단 띠가 가려짐): 띠와 같은 메모리 값의 글(app.js → screens/strip.js balanceLine)을 받기만
  const balanceRow = node('p', 'follow-balance', '');
  balanceRow.hidden = true;
  const setBalance = (text) => {
    const ok = typeof text === 'string' && text !== '';
    balanceRow.hidden = !ok;
    balanceRow.textContent = ok ? text : '';
  };
  const band = node('p', 'follow-note', ''); // 알림 한 줄(F-12·F-16·F-17·F-19·F-20·규칙 바뀜·K-11·저장 불가)
  band.hidden = true;
  // K-11(배율 권한 없음 — 따라가기를 켤 수 없음) 바로 아래 카카오 문의 링크(p35 L-1 — 설정 화면에서 따로 찾지 않게). https 주소일 때만
  const kakaoOk = typeof kakao === 'string' && /^https:\/\//.test(kakao);
  const levContact = node('a', 'big-btn alt follow-contact', KTEXT.levContact);
  levContact.dataset.link = 'follow-kakao';
  if (kakaoOk) levContact.href = kakao;
  levContact.target = '_blank';
  levContact.rel = 'noopener';
  levContact.hidden = true;
  const keysLink = node('a', 'big-btn alt', FTEXT.needKeysBtn); // F-02
  keysLink.href = '#keys';
  keysLink.dataset.link = 'follow-keys';
  const keysNote = node('p', 'follow-keys-note', FTEXT.needKeys);
  const moveBtn = button('follow-move', FTEXT.moveHere, 'big-btn alt'); // F-17
  moveBtn.addEventListener('click', () => onMoveHere());
  const cleanupBtn = button('follow-cleanup', FTEXT.cleanupBtn, 'big-btn alt'); // F-20
  cleanupBtn.addEventListener('click', () => onCleanup());
  const updateBtn = button('follow-update', FTEXT.updateBtn, 'big-btn alt'); // F-16
  updateBtn.addEventListener('click', () => onUpdate());

  // 회원 본인 손익(p34 §4.3) — 상태 줄 아래
  const pnl = node('section', 'follow-pnl');
  const pnlTitle = node('h3', 'follow-pnl-title', FTEXT.pnlTitle);
  const pnlList = node('div', 'follow-pnl-lines');
  pnl.append(pnlTitle, pnlList);
  pnl.hidden = true;

  // 자동 손절(p34 §2.2·§2.9) — 스위치 하나·기능 한계 한 줄·도움말·확인·상태(가격 없음)
  const sl = node('section', 'follow-autosl');
  const slHead = node('h3', 'follow-autosl-label', AUTO_SL_TEXT.label);
  const autoSlBtn = button('follow-autosl', AUTO_SL_TEXT.on, 'big-btn alt');
  autoSlBtn.setAttribute('aria-pressed', 'true');
  const slDesc = node('p', 'follow-autosl-desc', AUTO_SL_TEXT.desc);
  const slHelp = node('p', 'follow-autosl-help', AUTO_SL_TEXT.help);
  const slToast = node('p', 'follow-autosl-toast', '');
  slToast.setAttribute('role', 'status');
  slToast.hidden = true;
  const slLocked = node('p', 'follow-autosl-locked', AUTO_SL_TEXT.offLocked);
  slLocked.hidden = true;
  const slConfirm = node('div', 'follow-autosl-confirm');
  const slYes = button('follow-autosl-yes', AUTO_SL_TEXT.confirmGo, 'big-btn');
  const slNo = button('follow-autosl-no', AUTO_SL_TEXT.confirmCancel, 'big-btn alt');
  slConfirm.append(node('p', 'follow-autosl-confirm-text', AUTO_SL_TEXT.confirmOff), slYes, slNo);
  slConfirm.setAttribute('role', 'dialog');
  slConfirm.hidden = true;
  const slOff = node('p', 'follow-autosl-off', AUTO_SL_TEXT.turningOff); // 끄는 중(목록이 빌 때까지)
  slOff.hidden = true;
  const slFollowOff = node('p', 'follow-autosl-followoff', AUTO_SL_TEXT.followOff);
  slFollowOff.hidden = true;
  const slFailed = node('p', 'follow-autosl-failed bad', AUTO_SL_TEXT.failed);
  slFailed.hidden = true;
  const slWords = node('ul', 'follow-autosl-words');
  const slRetryBox = node('div', 'follow-autosl-retrybox');
  const slRetryHelp = node('p', 'follow-autosl-retryhelp', AUTO_SL_TEXT.retryHelp);
  const slRetryList = node('div', 'follow-autosl-retries');
  slRetryBox.append(slRetryList, slRetryHelp);
  slRetryBox.hidden = true;
  const slClearBox = node('div', 'follow-autosl-clearbox');
  const slClearList = node('div', 'follow-autosl-clears');
  // 번호 모름 안내(p35 §5.3 ㉡ — 조건 주문이 어느 조회에 보이는지·발동 전 상태·자동 취소 실측 전에는 보이지 않는 STOP이 남을 수 있음)
  slClearBox.append(node('p', 'follow-autosl-check bad', AUTO_SL_TEXT.checkNeeded), slClearList, node('p', 'follow-autosl-clearhelp', AUTO_SL_TEXT.clearHelp), node('p', 'follow-autosl-clearunknown dim', AUTO_SL_TEXT.clearUnknown));
  slClearBox.hidden = true;
  const slDiag = node('p', 'follow-autosl-diag dim', ''); // 시험 토큰 진단(가격 없음)
  slDiag.hidden = true;
  sl.append(slHead, autoSlBtn, slDesc, slHelp, slToast, slLocked, slConfirm, slOff, slFollowOff, slFailed, slWords, slRetryBox, slClearBox, slDiag);

  // 방식(F-04) — 미리 고르지 않음
  const modeBox = node('fieldset', 'follow-mode');
  modeBox.append(node('legend', null, FTEXT.modeTitle));
  const radio = (value, text) => {
    const label = node('label', 'follow-radio');
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = 'follow-mode';
    input.value = value;
    input.id = `follow-mode-${value}`;
    input.checked = false;
    label.append(input, node('span', null, text));
    modeBox.append(label);
    return input;
  };
  const modeAuto = radio('auto', FTEXT.modeAuto);
  const modeTap = radio('tap', FTEXT.modeTap);

  // 값(F-06) — p34: 최대 증거금·동시 건수만
  const field = (id, label, value = '') => {
    const wrap = node('label', 'follow-field');
    const input = doc.createElement('input');
    input.type = 'text';
    input.id = id;
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    input.value = value;
    wrap.append(node('span', null, label), input);
    return { wrap, input };
  };
  const maxMargin = field('follow-max-margin', `${FTEXT.maxMarginLabel} (%)`);
  const concurrent = field('follow-concurrent', `${FTEXT.concurrentLabel} (건)`);
  const how = node('p', 'follow-how', '');
  const help = node('ul', 'follow-help');
  for (const t of [FTEXT.help1, FTEXT.help3]) help.append(node('li', null, t));
  const symbolsLine = node('p', 'follow-symbols', '');
  const errors = node('p', 'follow-errors bad', '');
  errors.hidden = true;

  // 동의(F-11·L-01·법정 고지)
  const consent = node('div', 'follow-consent');
  // 전체 동의(2026-10-08 대표 요청) — 맨 위. 9항목과 서로 맞춘다
  const allWrap = node('label', 'follow-check follow-check-all');
  const checkAll = doc.createElement('input');
  checkAll.type = 'checkbox';
  checkAll.id = 'follow-consent-all';
  allWrap.append(checkAll, node('span', null, FTEXT.consentAll));
  consent.append(allWrap, node('p', 'follow-intro', FTEXT.intro));
  const legal = node('ul', 'follow-legal');
  for (const line of TEXT.legal) legal.append(node('li', null, line));
  consent.append(legal, node('p', 'follow-notice', TEXT.notice));
  const checks = FTEXT.consentItems.map((text, i) => {
    const label = node('label', 'follow-check');
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.id = `follow-consent-${i + 1}`;
    label.append(input, node('span', null, text));
    consent.append(label);
    return input;
  });
  const summary = node('p', 'follow-summary', '');
  const why = node('p', 'follow-why bad', ''); // 켜기가 막힌 이유(버튼 바로 위)
  why.hidden = true;
  const goBtn = button('follow-go', FTEXT.consentGo);
  const offBtn = button('follow-off', FTEXT.autoOff, 'big-btn alt');
  offBtn.addEventListener('click', () => onDisable());

  // 화면 켜 두기(F-13 / F-21)
  const wakeWrap = node('label', 'follow-check');
  const wakeInput = doc.createElement('input');
  wakeInput.type = 'checkbox';
  wakeInput.id = 'follow-wake';
  wakeWrap.append(wakeInput, node('span', null, FTEXT.wakeLock));
  wakeInput.addEventListener('change', () => onWake(wakeInput.checked === true));
  wakeWrap.hidden = wake !== 'ok';
  const wakeOld = node('p', 'follow-note', FTEXT.iosWake);
  wakeOld.hidden = wake !== 'ios-old';

  // 기록(F-18)
  const records = node('section', 'follow-records');
  records.append(node('h3', null, FTEXT.records));
  const recList = node('ol', 'follow-record-list');
  const consentToggle = button('follow-consent-list', FTEXT.consentRecords, 'big-btn alt');
  const consentList = node('ol', 'follow-consent-records');
  consentList.hidden = true;
  consentToggle.addEventListener('click', () => { consentList.hidden = !consentList.hidden; });
  const saveBtn = button('follow-save', FTEXT.saveFile, 'big-btn alt');
  saveBtn.addEventListener('click', () => onSaveConsents());
  const shadowBox = node('section', 'follow-shadow');
  shadowBox.append(node('h3', null, FTEXT.shadowTitle));
  const shadowList = node('ol', 'follow-shadow-list');
  shadowBox.append(shadowList);
  shadowBox.hidden = true;
  records.append(recList, consentToggle, consentList, saveBtn);

  box.append(
    node('h2', 'follow-title', FTEXT.title), limits, status, balanceRow, band, levContact, pnl, sl, keysNote, keysLink, moveBtn, cleanupBtn, updateBtn,
    modeBox, maxMargin.wrap, concurrent.wrap, how, help, symbolsLine,
    consent, summary, errors, why, goBtn, offBtn, wakeWrap, wakeOld, records, shadowBox,
  );
  el.replaceChildren(box);

  let last = null;
  let filled = false;
  const slOn = () => !last || !last.autoSl || last.autoSl.on !== false;
  function readSettings() {
    const base = last && last.settings ? last.settings : {};
    return {
      ...base,
      mode: modeAuto.checked ? 'auto' : modeTap.checked ? 'tap' : null,
      maxMarginPct: parseNum(maxMargin.input.value),
      maxConcurrent: parseNum(concurrent.input.value),
      wakeLock: wakeInput.checked === true,
    };
  }
  function need() {
    if (!last || !last.rules) return 'full';
    const s = readSettings();
    return last.rulesChanged ? 'full' : consentNeeded(last.consents, { rulesVersion: last.rules.rulesVersion, mode: s.mode, settings: s });
  }
  function refreshForm() {
    if (!last || !last.rules) return;
    const s = readSettings();
    const n = need();
    consent.hidden = last.on || n !== 'full';
    summary.hidden = last.on || n === 'none';
    summary.textContent = s.mode ? summaryLine(s, last.rules, { autoSlOn: slOn() }) : '';
    const v = validateSettings(s, last.rules);
    // 넣은 값이 틀리면 바로 그 이유를(막힌 버튼만 보이지 않게) — 아직 비어 있는 방식·최대 증거금은 말하지 않는다
    const shown = Object.entries(v.errors).filter(([k]) => k !== 'mode' && !(k === 'maxMarginPct' && maxMargin.input.value.trim() === ''));
    errors.hidden = shown.length === 0;
    errors.textContent = shown.map(([, t]) => t).join(' ');
    const allChecked = checks.every((c) => c.checked === true);
    checkAll.checked = allChecked;
    // 켜져 있는 동안은 값을 바꿔도 반영되지 않으므로 입력칸을 막는다(끄고 바꾼 뒤 다시 켬). 자동 손절 스위치는 설정 밖이라 막지 않는다
    for (const i of [modeAuto, modeTap, maxMargin.input, concurrent.input]) i.disabled = last.on === true;
    goBtn.hidden = last.on;
    goBtn.textContent = n === 'none' ? (s.mode === 'tap' ? FTEXT.tapOn : FTEXT.autoOn) : FTEXT.consentGo;
    goBtn.disabled = !v.ok || (n === 'full' && !allChecked) || !last.keysReady;
    // 막힌 이유를 한 줄씩 — 아직 빈 방식·최대 증거금도 여기서는 말한다(값이 틀린 이유는 errors 줄)
    const reasons = [];
    if (v.errors.mode) reasons.push(FTEXT.why.mode);
    if (v.errors.maxMarginPct && maxMargin.input.value.trim() === '') reasons.push(FTEXT.why.maxMargin);
    if (n === 'full' && !allChecked) reasons.push(FTEXT.why.consent);
    if (!last.keysReady) reasons.push(FTEXT.why.keys);
    why.hidden = last.on || reasons.length === 0;
    why.textContent = reasons.join(' ');
    offBtn.hidden = !last.on;
    offBtn.textContent = last.mode === 'tap' ? FTEXT.tapOff : FTEXT.autoOff;
  }
  for (const i of [modeAuto, modeTap, ...checks]) i.addEventListener('change', refreshForm);
  checkAll.addEventListener('change', () => {
    for (const c of checks) c.checked = checkAll.checked === true;
    refreshForm();
  });
  for (const f of [maxMargin, concurrent]) f.input.addEventListener('input', refreshForm);
  goBtn.addEventListener('click', () => {
    if (goBtn.disabled) return;
    const s = readSettings();
    const v = validateSettings(s, last.rules);
    if (!v.ok) {
      errors.hidden = false;
      errors.textContent = Object.values(v.errors).join(' ');
      return;
    }
    errors.hidden = true;
    // lev = 이 화면 F-05에 보인 배율(동의 기록 textHash가 보인 글 그대로). 켜지 못하면 그 이유를 이 칸에(버튼만 아무 일 없게 두지 않음)
    Promise.resolve(onEnable({ settings: { ...last.settings, ...s }, consentShown: need(), lev: last.lev })).then((r) => {
      if (!r || typeof r !== 'object' || r.ok !== false || r.note) return; // K-11(note)은 알림 줄이 보인다
      const why2 = r.error ? [r.error] : r.errors ? Object.values(r.errors) : r.need ? [FTEXT.invalid.consent] : [];
      if (!why2.length) return;
      errors.hidden = false;
      errors.textContent = why2.join(' ');
    }, () => {});
  });

  // 자동 손절 스위치(§2.2): 켜기는 언제든, 끄기는 걸린 주문이 있으면 확인 시트(엔진이 confirm을 돌려줌) → '끄기'를 누를 때만
  function askAutoSl(on, opts = {}) {
    Promise.resolve(onAutoSl(on, opts)).then((r) => {
      if (r && r.confirm) slConfirm.hidden = false;
      else slConfirm.hidden = true;
      if (r && r.locked) slLocked.hidden = false;
    }, () => {});
  }
  autoSlBtn.addEventListener('click', () => {
    if (autoSlBtn.disabled) return;
    askAutoSl(!slOn());
  });
  slYes.addEventListener('click', () => {
    slConfirm.hidden = true;
    askAutoSl(false, { confirmed: true });
  });
  slNo.addEventListener('click', () => { slConfirm.hidden = true; });

  function drawAutoSl(st) {
    const a = st.autoSl || { on: true, words: {}, retry: [], checkNeeded: [] };
    const on = a.on !== false;
    autoSlBtn.textContent = a.busy ? AUTO_SL_TEXT.busy : on ? AUTO_SL_TEXT.on : AUTO_SL_TEXT.off;
    autoSlBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    autoSlBtn.className = on ? 'big-btn alt follow-autosl-on' : 'big-btn alt follow-autosl-offbtn';
    autoSlBtn.disabled = a.busy === true || (on && a.offLocked === true);
    slLocked.hidden = !(on && a.offLocked === true);
    slToast.hidden = !a.toast;
    slToast.textContent = a.toast || '';
    slOff.hidden = !a.turningOff;
    slFollowOff.hidden = !a.followOff;
    slFailed.hidden = !a.failed;
    if (!on) slConfirm.hidden = true;
    // 매매별 상태 낱말(가격 없음)
    const words = a.words || {};
    const byId = new Map((st.trades || []).map((t) => [t.id, t]));
    slWords.replaceChildren(...Object.entries(words).filter(([, w]) => !!w).map(([id, w]) => {
      const t = byId.get(id) || {};
      return node('li', 'follow-autosl-word', `${t.rehearsal ? `${FTEXT.rehearsal} ` : ''}${t.symbol || '?'} ${SIDE[t.side] || ''} · ${w}`.replace(/\s+·/, ' ·'));
    }));
    // 다시 걸기(결과 모름·걸지 못함) — 매매마다 버튼
    const retry = Array.isArray(a.retry) ? a.retry : [];
    slRetryBox.hidden = retry.length === 0;
    slRetryList.replaceChildren(...retry.map((id) => {
      const t = byId.get(id) || {};
      const b = button(null, `${AUTO_SL_TEXT.retry} · ${t.rehearsal ? `${FTEXT.rehearsal} ` : ''}${t.symbol || '?'} ${SIDE[t.side] || ''}`.trim(), 'big-btn alt follow-autosl-retry');
      b.dataset.trade = id;
      b.addEventListener('click', () => onAutoSlRetry(id));
      return b;
    }));
    // 확인했습니다(이전 자동 손절을 확인하지 못해 새 진입을 막은 종목)
    const checkN = Array.isArray(a.checkNeeded) ? a.checkNeeded : [];
    slClearBox.hidden = checkN.length === 0;
    slClearList.replaceChildren(...checkN.map((inst) => {
      const b = button(null, `${AUTO_SL_TEXT.clear} · ${String(inst).split('-')[0]}`, 'big-btn alt follow-autosl-clear');
      b.dataset.inst = inst;
      b.addEventListener('click', () => onAutoSlClear(inst));
      return b;
    }));
    slDiag.hidden = !a.diag;
    slDiag.textContent = a.diag || '';
  }

  function update(st, { keysReady = false, balance = null } = {}) {
    last = { ...st, keysReady };
    setBalance(balance);
    levContact.hidden = !(kakaoOk && st.ready && st.probeNote === 'lev_denied');
    if (!st.ready) {
      band.hidden = false;
      band.textContent = FTEXT.needRules;
      goBtn.disabled = true;
      return;
    }
    const s = st.settings;
    if (!filled) {
      // 저장된 값으로 한 번 채운다 — 한 매매 최대 증거금·방식은 저장된 것이 있을 때만(기본값 없음)
      filled = true;
      modeAuto.checked = s.mode === 'auto';
      modeTap.checked = s.mode === 'tap';
      maxMargin.input.value = s.maxMarginPct == null ? '' : String(s.maxMarginPct);
      concurrent.input.value = String(s.maxConcurrent);
      wakeInput.checked = s.wakeLock === true;
    }
    status.textContent = st.status.text;
    status.className = `follow-status ${st.status.tone}`;
    const notes = [];
    if (!st.durable) notes.push(FTEXT.needDurable);
    if (st.rulesChanged) notes.push(FTEXT.rulesChanged(st.rules.rulesVersion));
    else if (st.consentChanged) notes.push(FTEXT.consentChanged);
    if (st.probeNote === 'lev_denied') notes.push(KTEXT.levDenied);
    if (st.halted) notes.push(FTEXT.halted);
    if (st.update) notes.push(FTEXT.update);
    if (st.other) notes.push(FTEXT.other);
    if (st.checking) notes.push(FTEXT.checking); // p40 — 임대 확인 중(다른 기기가 아님, 옮기기 버튼 없음)
    if (st.otherTab) notes.push(FTEXT.otherTab);
    if (st.moved) notes.push(FTEXT.moved);
    if (st.cleanup > 0) notes.push(FTEXT.cleanup(st.cleanup));
    band.hidden = notes.length === 0;
    band.textContent = notes.join(' ');
    // 손익(§4.3) — 첫 줄은 제목, 나머지 줄
    const pl = pnlLines(st.pnl);
    pnl.hidden = pl.length === 0;
    pnlList.replaceChildren(...pl.slice(1).map((l) => node('p', 'follow-pnl-line', l)));
    drawAutoSl(st);
    keysNote.hidden = keysReady;
    keysLink.hidden = keysReady;
    moveBtn.hidden = !(st.other || st.moved);
    cleanupBtn.hidden = !(st.cleanup > 0);
    updateBtn.hidden = !st.update;
    how.textContent = FTEXT.how;
    symbolsLine.textContent = FTEXT.symbols(st.symbols && st.symbols.length ? st.symbols : ['BTC']);
    recList.replaceChildren(...recentTrades(st.trades.filter((t) => t.state !== 'shadow'), 100).map((t) => node('li', 'follow-record', recordLine(t))));
    if (!recList.children.length) recList.append(node('li', 'follow-record dim', FTEXT.noRecords));
    consentList.replaceChildren(...st.consents.slice().reverse().map((c) => node('li', null, consentLine(c))));
    const shadows = st.trades.filter((t) => t.state === 'shadow');
    shadowBox.hidden = shadows.length === 0;
    shadowList.replaceChildren(...shadows.flatMap(shadowLines).map((l) => node('li', null, l)));
    refreshForm();
  }

  return {
    box, update, setBalance, inputs: { modeAuto, modeTap, maxMargin: maxMargin.input, concurrent: concurrent.input, checks, checkAll, wake: wakeInput },
    goBtn, offBtn, moveBtn, cleanupBtn, updateBtn, saveBtn, status, band, consent, summary, autoSlBtn,
  };
}
