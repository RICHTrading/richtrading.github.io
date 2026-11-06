// 거래소 연결 화면(#keys, s·j판 인증 회원 + (autoReady 또는 시험 토큰) — 설계 3-2 §5.1·§5.2, 문구 §8.1 K-01~K-13). 한 번 그리고 update로 바꾼다.
// - 비밀 키 칸은 password가 아닌 textarea(.secret로 가림) — 비밀번호 관리자가 저장을 제안해 비밀 키가 기기 밖 계정으로 동기화되지 않게.
//   <form> 밖, name 없음. 누르면 먼저 형식(validateKeyInput)과 (시험 토큰) '다른 계정의 키입니다' 체크 상자를 본다 — 틀리면 입력값을
//   그대로 두고 안내만(다시 붙여 넣게 하지 않음). 통과하면 두 칸을 비우고 값을 넘긴다(원문을 화면·DOM에 남기지 않음 — 성공·실패 모두).
//   체크 상자가 보이는 동안 누르기 전에는 '연결하기'를 잠근다.
// - 연결됨이면 입력칸 대신 K-07·진단 줄·'연결 해제'. 법정 고지 5줄·고지(원금 손실)를 아래에 둔다. DOM은 createElement·textContent로만(CSP) 맨 위에는 오렌지엑스 API 연결 가이드(앱용 — config.guides.apiApp일 때만, 대표 결정 7).
import { KTEXT, keyGuide, validateKeyInput } from '../lib/keys.js';
import { renderApiGuide } from './api-guide.js';
import { TEXT } from '../lib/auto-view.js';

const CONNECTED = Object.freeze(['ok', 'down', 'checking']);
const NO_FILL = Object.freeze([['autocomplete', 'off'], ['autocapitalize', 'off'], ['autocorrect', 'off'], ['spellcheck', 'false'], ['data-lpignore', 'true'], ['data-1p-ignore', '']]);

export function renderKeys(el, { config, startPdf = null, onConnect = () => {}, onDisconnect = () => {}, doc = document }) {
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
  // 옛 시험 토큰 K-10 체크 상자('다른 계정의 키입니다')는 없앰 — 시험 토큰도 일반 회원 화면(대표 2026-10-24)
  const button = doc.createElement('button');
  button.type = 'button';
  button.id = 'keys-submit';
  button.className = 'big-btn';
  button.textContent = KTEXT.submit;
  form.append(label('keys-api', KTEXT.apiLabel), api, label('keys-secret', KTEXT.secretLabel), secret, clip, button);

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

  let pending = false;
  let connected = false;
  const lock = () => {
    button.disabled = pending;
  };
  // 넘기기 전 안내(입력값은 그대로) — 다음 update가 연결 상태의 문구로 바꾼다
  const hint = (tone, text) => {
    msg.hidden = false;
    msg.textContent = text;
    msg.className = `keys-msg ${tone}`;
  };
  button.addEventListener('click', () => {
    if (pending || connected) return;
    if (!validateKeyInput(api.value, secret.value).ok) {
      hint('bad', KTEXT.badInput);
      return;
    }
    const input = { apiKey: api.value, secret: secret.value };
    api.value = '';
    secret.value = '';
    onConnect(input);
  });

  // 맨 위 오렌지엑스 API 연결 가이드(앱용 — 2026-10-12 대표 결정 7, app/screens/api-guide.js): 빌드가 사진·PDF를 실은 판(config.guides.apiApp)만,
  // 바로 아래 K-03c(가이드대로 계정은 '읽기') — 계정 쓰기를 받는 빌드(oxScope.allowAccountWrite — 대표 결정 2026-10-19, 되돌린 뒤 2026-10-20 다시 게시 설정)는 그리지 않는다.
  // 동업자 API 가이드(guide/ox-api.pdf — partnerOk:false)는 이 화면에 그리지 않는다
  const top = [];
  if (config && config.guides && config.guides.apiApp === true) {
    const g = doc.createElement('div');
    g.className = 'keys-api-guide';
    renderApiGuide(g, { config, doc });
    top.push(g);
    // 회원 시작 안내서 PDF(guide/ptf-start-guide.pdf — 빌드가 수호·준현판에만 싣는다, 대표 2026-10-27)
    if (startPdf) {
      const a = doc.createElement('a');
      a.className = 'big-btn alt keys-start-pdf';
      a.href = startPdf;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = KTEXT.startPdf;
      top.push(a);
    }
    if (!allowWrite) top.push(p('keys-guide-read', KTEXT.guideAccountRead));
  }
  // 2026-10-30 대표: 키 칸 위 회색 안내(privacy)·아래 법정 문구(legal) 뺌
  box.append(...top, p('keys-intro', KTEXT.intro), guide, done, form, msg, scopeLine);
  el.replaceChildren(box);

  function update({ keys = null } = {}) {
    const k = keys || {};
    connected = CONNECTED.includes(k.status);
    form.hidden = connected;
    done.hidden = !connected;
    pending = !!k.pending;
    button.textContent = pending ? KTEXT.pending : KTEXT.submit;
    lock();
    privacy.textContent = k.transport === 'ws' ? KTEXT.privacyDirect : KTEXT.privacyRelay;
    const m = k.message;
    msg.hidden = !m;
    msg.textContent = m ? m.text : '';
    msg.className = m ? `keys-msg ${m.tone}` : 'keys-msg';
    scopeLine.hidden = !k.receivedScope;
    scopeLine.textContent = k.receivedScope ? KTEXT.scopeGot(k.receivedScope) : '';
    // K-07은 받은 권한을 본다 — 계정 읽기·쓰기 키는 '거래 전용'이 아님(대표 결정 2026-10-19 뒤 검토)
    okLine.textContent = k.status === 'checking' ? KTEXT.pending : k.account ? KTEXT.ok(k.account.tail, k.scope) : '';
    diag.textContent = k.diag || '';
    diag.hidden = !k.diag;
  }

  update();
  return { box, api, secret, button, disconnect, update };
}
