// 서버 자동(④) 등록 화면(2026-10-12 설계 §5.1·§5.2·§7.6·§10, 대표 결정 7) — 따라가기 화면(#follow)의 서버 자동 자리(screens/follow.js serverSlot)에 한 번 그리고
// update(st)로 바꾼다. 위에서 아래로: 기능 한계(serverLimit — 늘 맨 위, 숨기지 않음) → 키 안내(serverKeyUse — 키 화면에 연결해 둔 같은 키를 씀, 키 칸 없음) →
// 키가 없으면 키 화면 안내 한 줄 + '키 화면 열기'(#keys) → 상태 줄·알림 → 앱 밖 주문 안내(serverOffApp — spec §7.6, 안내 톤) → 한 매매 최대 증거금·동시·자동 손절 →
// 동의(따라가기 9항목 + ②④⑦ 대신 안내 + 서버 자동 2항목, 법정 고지·원금 손실 고지) → 30일 안내 → 막힌 이유 → '동의하고 서버 자동 켜기'.
// 누르면: 연결해 둔 키를 잠금(sealConnectedKey — kv.ox를 WS 로그인 길과 같은 함수로 풀어 실행기 공개키로 잠그고 원문은 그 함수 안에서 버림) →
// 동의 기록(기기 vault — 허브로 보내지 않음) → 허브 POST(잠긴 묶음만). 이 화면은 비밀 키 원문을 만지지 않는다. 켜진 뒤(등록 중·켜짐·끄는 중): 상태 줄·
// '서버 자동 끄기'·'지금 지우기'(확인 창 — 열린 포지션은 오렌지엑스에서 직접). 지운 뒤: serverDeleted(휴대폰의 키 연결은 그대로). 서버 매매 기록은 맨 아래.
// DOM은 createElement·textContent로만(CSP)
import { FTEXT } from '../lib/follow-text.js';
import { TEXT } from '../lib/auto-view.js';
import { AUTO_SL_TEXT } from '../lib/auto-sl.js';
import { parseNum, validateSettings } from '../lib/follow-settings.js';
import { serverTradeLines } from '../lib/follow-view.js';
import { serverView, serverOffAppLine, makeServerConsent, sealConnectedKey, SERVER_ENGAGED } from '../lib/server-exec.js';

export function renderServerEnroll(el, {
  config,
  rules = null,
  getMember = () => null,
  server,
  follow = { state: () => null, addConsent: async () => {} },
  keysReady = () => false,
  vault = null,
  onDone = () => {},
  doc = globalThis.document,
  seal = sealConnectedKey,
  confirmFn = (t) => globalThis.confirm(t),
  now = () => Date.now(),
  subtle = globalThis.crypto && globalThis.crypto.subtle,
} = {}) {
  const node = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (id, text, cls = 'big-btn') => {
    const b = node('button', cls, text);
    b.type = 'button';
    b.id = id;
    return b;
  };
  const check = (id, text, cls = 'follow-check') => {
    const wrap = node('label', cls);
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    wrap.append(input, node('span', null, text));
    return { wrap, input };
  };
  const field = (id, text) => {
    const wrap = node('label', 'follow-field');
    const input = doc.createElement('input');
    input.type = 'text';
    input.id = id;
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    wrap.append(node('span', null, text), input);
    return { wrap, input };
  };

  const box = node('div', 'server-enroll');
  const limit = node('p', 'server-limit', FTEXT.serverLimit);
  const keyUse = node('p', 'server-keyuse', FTEXT.serverKeyUse);
  const needKey = node('div', 'server-needkey');
  const keysLink = node('a', 'server-keys-link', FTEXT.serverKeyBtn);
  keysLink.href = '#keys';
  needKey.append(node('p', 'server-needkey-text', FTEXT.serverNeedKey), keysLink);
  needKey.hidden = true;
  const stateLine = node('p', 'server-state dim', '');
  stateLine.setAttribute('role', 'status');
  stateLine.hidden = true;
  const msg = node('p', 'server-msg dim', '');
  msg.setAttribute('role', 'status');
  msg.hidden = true;
  const offApp = node('p', 'server-offapp warn', FTEXT.serverOffApp); // spec §7.6 — 회원 하나에게는 안내(경보 아님)
  offApp.setAttribute('role', 'status');
  offApp.hidden = true;
  const deleted = node('p', 'server-deleted', FTEXT.serverDeleted);
  deleted.hidden = true;

  // 등록 칸(키 칸 없음 — 키는 키 화면에서 연결해 둔 것을 씀)
  const form = node('div', 'server-form');
  const maxMargin = field('server-max-margin', `${FTEXT.maxMarginLabel} (%)`);
  const concurrent = field('server-concurrent', `${FTEXT.concurrentLabel} (건)`);
  const sl = check('server-autosl', `${AUTO_SL_TEXT.label} — ${AUTO_SL_TEXT.desc}`);
  const consent = node('div', 'follow-consent server-consent');
  const all = check('server-consent-all', FTEXT.serverConsentAll, 'follow-check follow-check-all');
  consent.append(all.wrap, node('p', 'follow-intro', FTEXT.intro));
  const legal = node('ul', 'follow-legal');
  for (const line of TEXT.legal) legal.append(node('li', null, line));
  consent.append(legal, node('p', 'follow-notice', TEXT.notice));
  const checks = [...FTEXT.consentItems, ...FTEXT.serverConsentItems].map((text, i) => {
    if (i === FTEXT.consentItems.length) consent.append(node('p', 'server-consent-note', FTEXT.serverConsentNote));
    const c = check(`server-consent-${i + 1}`, text);
    consent.append(c.wrap);
    return c.input;
  });
  const refreshNote = node('p', 'server-refresh-note', FTEXT.serverRefreshNote);
  const why = node('p', 'follow-why bad', '');
  why.hidden = true;
  const goBtn = button('server-go', FTEXT.serverGo);
  form.append(maxMargin.wrap, concurrent.wrap, sl.wrap, consent, refreshNote, why, goBtn);

  // 켜진 뒤
  const on = node('div', 'server-on');
  on.hidden = true;
  const offBtn = button('server-off', FTEXT.serverOffBtn, 'big-btn alt');
  const nowWarn = node('p', 'server-delete-warn', FTEXT.serverDeleteNowWarn);
  const nowBtn = button('server-delete-now', FTEXT.serverDeleteNow, 'big-btn danger');
  on.append(offBtn, nowWarn, nowBtn);
  const trades = node('ol', 'server-trades');
  box.append(limit, keyUse, needKey, stateLine, msg, offApp, deleted, form, on, trades);
  el.replaceChildren(box);

  let view = serverView(null);
  let busy = false;
  let filled = false;
  const engine = () => (follow && typeof follow.state === 'function' ? follow.state() : null);
  const hasKey = () => keysReady() === true;
  const errText = (e) => (typeof e === 'string' && Object.hasOwn(FTEXT.serverErr, e) ? FTEXT.serverErr[e] : FTEXT.serverErr.down);
  function say(text, tone = 'dim') {
    msg.hidden = !text;
    msg.textContent = text || '';
    msg.className = `server-msg ${tone}`;
  }
  const readSettings = () => ({ maxMarginPct: parseNum(maxMargin.input.value), maxConcurrent: parseNum(concurrent.input.value), autoSl: sl.input.checked === true });
  // 켜기가 막힌 이유(버튼 바로 위 한 줄씩 — 빈 칸도 말한다)
  function reasons() {
    if (!rules) return [FTEXT.needRules];
    const out = [];
    const v = validateSettings({ ...readSettings(), mode: 'auto' }, rules);
    if (v.errors.maxMarginPct) out.push(maxMargin.input.value.trim() === '' ? FTEXT.why.maxMargin : v.errors.maxMarginPct);
    if (v.errors.maxConcurrent) out.push(v.errors.maxConcurrent);
    if (!checks.every((c) => c.checked === true)) out.push(FTEXT.why.consent);
    const e = engine();
    if (!e || e.durable !== true) out.push(FTEXT.needDurable);
    if (!getMember()) out.push(FTEXT.serverErr.not_allowed);
    if (!hasKey()) out.push(FTEXT.serverNeedKey);
    if (view.key === 'unavailable' || view.key === 'down') out.push(view.text);
    return out;
  }
  function refreshForm() {
    all.input.checked = checks.every((c) => c.checked === true);
    const r = reasons();
    why.hidden = r.length === 0;
    why.textContent = r.join(' ');
    goBtn.disabled = busy || r.length > 0;
  }
  // 처음 한 번 — 휴대폰 따라가기에 넣은 값(있으면)·자동 손절 스위치로 채운다(입력칸은 다시 그리지 않음)
  function prefill() {
    const e = engine();
    const s = e && e.settings ? e.settings : null;
    maxMargin.input.value = s && typeof s.maxMarginPct === 'number' ? String(s.maxMarginPct) : '';
    concurrent.input.value = s && typeof s.maxConcurrent === 'number' ? String(s.maxConcurrent) : (rules ? String(rules.limits.maxConcurrent.default) : '');
    sl.input.checked = !(e && e.autoSl && e.autoSl.on === false);
  }
  function update(st) {
    view = serverView(st, now());
    if (!filled) {
      filled = true;
      prefill();
    }
    const engaged = SERVER_ENGAGED.includes(view.key);
    stateLine.hidden = !view.text || view.key === 'deleted';
    stateLine.textContent = view.text;
    stateLine.className = `server-state ${view.tone}`;
    offApp.hidden = !serverOffAppLine(st);
    needKey.hidden = engaged || hasKey();
    form.hidden = engaged;
    // error(실행기가 키를 쥔 채 로그인 실패 — 최종 검토 I1)도 끄기·지금 지우기를 보인다(다시 등록 칸과 함께) — 풀리면 다시 매매하므로 회원이 멈출 길이 있어야 함
    on.hidden = !(engaged || view.key === 'error');
    deleted.hidden = view.key !== 'deleted';
    offBtn.disabled = busy || view.key === 'closing';
    nowBtn.disabled = busy;
    const lines = serverTradeLines(st && st.ok === true ? st.trades : []);
    trades.replaceChildren(...lines.map((l) => {
      const li = node('li', 'server-trade');
      li.append(node('span', 'server-tag', l.tag), node('span', 'server-trade-text', l.text));
      return li;
    }));
    refreshForm();
  }

  async function go() {
    if (busy) return;
    refreshForm();
    if (goBtn.disabled) return;
    const s = readSettings();
    busy = true;
    goBtn.disabled = true;
    say(FTEXT.serverChecking, 'warn');
    try {
      const sealed = await seal({ vault, config, settings: { maxMarginPct: s.maxMarginPct, maxConcurrent: s.maxConcurrent, autoSl: s.autoSl, symbols: ['BTC'] }, now: now(), subtle });
      if (!sealed || sealed.ok !== true) {
        say(errText(sealed && sealed.error), 'bad');
        return;
      }
      await follow.addConsent(await makeServerConsent({ ed: config.edition, settings: s, rules, appVersion: config.version, now: now(), subtle }));
      const r = await server.enroll(sealed.blob);
      if (!r || r.ok !== true) {
        say(errText(r && r.error), 'bad');
        return;
      }
      say('', 'dim');
      onDone({ ok: true, id: r.id });
    } catch {
      say(FTEXT.serverErr.bad_blob, 'bad');
    } finally {
      busy = false;
      update(server.state());
    }
  }
  // 끄기 — flat(새 진입 멈춤, 열린 매매가 끝나면 서버의 키 삭제) · now(바로 서버의 키 삭제 — 확인 창, 열린 포지션은 오렌지엑스에서 직접)
  async function off(mode) {
    if (busy) return;
    if (mode === 'now' && confirmFn(FTEXT.serverDeleteNowWarn) !== true) return;
    busy = true;
    offBtn.disabled = true;
    nowBtn.disabled = true;
    try {
      const r = await server.off(mode);
      say(r && r.ok === true ? '' : errText(r && r.error), r && r.ok === true ? 'dim' : 'bad');
      onDone({ off: mode });
    } finally {
      busy = false;
      update(server.state());
    }
  }
  goBtn.addEventListener('click', () => { go(); });
  offBtn.addEventListener('click', () => { off('flat'); });
  nowBtn.addEventListener('click', () => { off('now'); });
  for (const c of checks) c.addEventListener('change', refreshForm);
  all.input.addEventListener('change', () => {
    for (const c of checks) c.checked = all.input.checked === true;
    refreshForm();
  });
  for (const f of [maxMargin, concurrent]) f.input.addEventListener('input', refreshForm);
  sl.input.addEventListener('change', refreshForm);

  return {
    box, update, go, off,
    inputs: { maxMargin: maxMargin.input, concurrent: concurrent.input, autoSl: sl.input, checks, checkAll: all.input },
    goBtn, offBtn, nowBtn, msg, why, stateLine, needKey, keysLink, offApp, form, on, deleted, trades,
  };
}
