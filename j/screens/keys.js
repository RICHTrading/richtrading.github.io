// 거래소 연결 화면(#keys, s·j판 인증 회원 + (autoReady 또는 시험 토큰) — 설계 3-2 §5.1·§5.2, 문구 §8.1 K-01~K-13). 한 번 그리고 update로 바꾼다.
// - 비밀 키 칸은 password가 아닌 textarea(.secret로 가림) — 비밀번호 관리자가 저장을 제안해 비밀 키가 기기 밖 계정으로 동기화되지 않게.
//   <form> 밖, name 없음. 누르면 먼저 형식(validateKeyInput)과 (시험 토큰) '다른 계정의 키입니다' 체크 상자를 본다 — 틀리면 입력값을
//   그대로 두고 안내만(다시 붙여 넣게 하지 않음). 통과하면 두 칸을 비우고 값을 넘긴다(원문을 화면·DOM에 남기지 않음 — 성공·실패 모두).
//   체크 상자가 보이는 동안 누르기 전에는 '연결하기'를 잠근다.
// - 연결됨이면 입력칸 대신 K-07·진단 줄·'연결 해제'. 법정 고지 5줄·고지(원금 손실)를 아래에 둔다. DOM은 createElement·textContent로만(CSP)
import { KTEXT, keyGuide, validateKeyInput } from '../lib/keys.js';
import { TEXT } from '../lib/auto-view.js';

const CONNECTED = Object.freeze(['ok', 'down', 'checking']);
const NO_FILL = Object.freeze([['autocomplete', 'off'], ['autocapitalize', 'off'], ['autocorrect', 'off'], ['spellcheck', 'false'], ['data-lpignore', 'true'], ['data-1p-ignore', '']]);

export function renderKeys(el, { config, onConnect = () => {}, onDisconnect = () => {}, doc = document }) {
  const p = (cls, text) => {
    const n = doc.createElement('p');
    if (cls) n.className = cls;
    n.textContent = text;
    return n;
  };
  const label = (forId, text) => {
    const n = doc.createElement('label');
    n.className = 'keys-label';
    n.htmlFor = forId;
    n.textContent = text;
    return n;
  };
  const allowWrite = !!(config && config.oxScope && config.oxScope.allowAccountWrite === true);
  const box = doc.createElement('div');
  box.className = 'keys';

  const guide = doc.createElement('ol');
  guide.className = 'keys-guide';
  for (const line of keyGuide(allowWrite)) {
    const li = doc.createElement('li');
    li.textContent = line;
    guide.append(li);
  }
  const privacy = p('keys-privacy', KTEXT.privacyRelay);

  const form = doc.createElement('div');
  form.className = 'keys-form';
  const api = doc.createElement('input');
  api.type = 'text';
  api.id = 'keys-api';
  for (const [k, v] of NO_FILL) api.setAttribute(k, v);
  const secret = doc.createElement('textarea');
  secret.id = 'keys-secret';
  secret.className = 'secret';
  secret.setAttribute('rows', '2');
  for (const [k, v] of NO_FILL) secret.setAttribute(k, v);
  const clip = p('keys-clip', KTEXT.clipboard);
  clip.hidden = true;
  secret.addEventListener('paste', () => {
    clip.hidden = false;
  });
  const testBox = doc.createElement('div');
  testBox.className = 'keys-test';
  testBox.hidden = true;
  const check = doc.createElement('label');
  check.className = 'keys-check';
  const other = doc.createElement('input');
  other.type = 'checkbox';
  other.id = 'keys-other';
  const checkText = doc.createElement('span');
  checkText.textContent = KTEXT.testCheck;
  check.append(other, checkText);
  testBox.append(p('keys-test-note', KTEXT.testNote), check);
  const button = doc.createElement('button');
  button.type = 'button';
  button.id = 'keys-submit';
  button.className = 'big-btn';
  button.textContent = KTEXT.submit;
  form.append(label('keys-api', KTEXT.apiLabel), api, label('keys-secret', KTEXT.secretLabel), secret, clip, testBox, button);

  const msg = p('keys-msg', '');
  msg.hidden = true;
  msg.setAttribute('role', 'status');
  const scopeLine = p('keys-scope', '');
  scopeLine.hidden = true;

  const done = doc.createElement('div');
  done.className = 'keys-done';
  done.hidden = true;
  const okLine = p('keys-ok', '');
  okLine.setAttribute('role', 'status');
  const diag = p('keys-diag', '');
  const disconnect = doc.createElement('button');
  disconnect.type = 'button';
  disconnect.id = 'keys-disconnect';
  disconnect.className = 'big-btn alt';
  disconnect.textContent = KTEXT.disconnect;
  disconnect.addEventListener('click', () => onDisconnect());
  done.append(okLine, diag, disconnect);

  const legal = doc.createElement('div');
  legal.className = 'keys-legal';
  for (const line of TEXT.legal) legal.append(p('keys-legal-line', line));
  legal.append(p('keys-notice', TEXT.notice));

  let pending = false;
  let connected = false;
  const needCheck = () => !testBox.hidden && other.checked !== true;
  const lock = () => {
    button.disabled = pending || needCheck();
  };
  // 넘기기 전 안내(입력값은 그대로) — 다음 update가 연결 상태의 문구로 바꾼다
  const hint = (tone, text) => {
    msg.hidden = false;
    msg.textContent = text;
    msg.className = `keys-msg ${tone}`;
  };
  other.addEventListener('change', lock);
  button.addEventListener('click', () => {
    if (pending || connected) return;
    if (!validateKeyInput(api.value, secret.value).ok) {
      hint('bad', KTEXT.badInput);
      return;
    }
    if (needCheck()) {
      hint('warn', KTEXT.testNote);
      lock();
      return;
    }
    const input = { apiKey: api.value, secret: secret.value, otherAccount: other.checked === true };
    api.value = '';
    secret.value = '';
    onConnect(input);
  });

  // 맨 위 동업자 API 연결 가이드(p34 §6.6) — 빌드가 실은 판만(config.guides.api — 동업자 확인 전 partnerOk:false면 없음).
  // 가이드 1쪽은 '계정 읽고 쓰기'라 바로 아래 K-03c(계정은 읽기로), 2쪽은 동업자 PC 화면이라 그 차이 한 줄 — PDF는 고치지 않는다
  const top = [];
  if (config && config.guides && config.guides.api === true) {
    const a = doc.createElement('a');
    a.className = 'keys-guide-link';
    a.href = 'guide/ox-api.pdf';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = KTEXT.guideLink;
    top.push(a);
    if (!allowWrite) top.push(p('keys-guide-read', KTEXT.guideAccountRead));
    top.push(p('keys-guide-page2', KTEXT.guidePage2));
  }
  box.append(...top, p('keys-intro', KTEXT.intro), guide, privacy, done, form, msg, scopeLine, legal);
  el.replaceChildren(box);

  function update({ keys = null, member = null } = {}) {
    const k = keys || {};
    connected = CONNECTED.includes(k.status);
    form.hidden = connected;
    done.hidden = !connected;
    pending = !!k.pending;
    button.textContent = pending ? KTEXT.pending : KTEXT.submit;
    testBox.hidden = !(member && member.test === true);
    if (testBox.hidden) other.checked = false;
    lock();
    privacy.textContent = k.transport === 'ws' ? KTEXT.privacyDirect : KTEXT.privacyRelay;
    const m = k.message;
    msg.hidden = !m;
    msg.textContent = m ? m.text : '';
    msg.className = m ? `keys-msg ${m.tone}` : 'keys-msg';
    scopeLine.hidden = !k.receivedScope;
    scopeLine.textContent = k.receivedScope ? KTEXT.scopeGot(k.receivedScope) : '';
    okLine.textContent = k.status === 'checking' ? KTEXT.pending : k.account ? KTEXT.ok(k.account.tail) : '';
    diag.textContent = k.diag || '';
    diag.hidden = !k.diag;
  }

  update();
  return { box, api, secret, other, button, disconnect, update };
}
