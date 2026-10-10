// UID 인증 화면(#verify, s·j판만 — 설계 3-2 §3.1, 문구 §8.1 V-01~V-13 · p34 §6.5 동업자 UID 활성화 창 문구·단계).
// 위에서 아래로: ◆ 제목 ◆ → 자동 확인 → 이용료 없음 → 열리는 것 → 입력칸 → ▶ 인증하기 → 결과 줄 → 가입 줄(그 판 signupUrl)·
// 앱 받기 줄(대표 결정 2026-10-09 — 앱 받기 창, 맨 위에 그 판 가입 단계)·(명단에 없음 뒤) 입금·사용 가이드·문의하기 → 또는 → 체험 모드로 시작 →
// UID 확인 위치 → 개인정보 줄. 앱 받기 창은 이 화면이 문서 body에 하나만 붙이고 닫기·바깥 누름·Esc로 뗀다(Esc 듣기는 열려 있는 동안만).
// 한 번 그리고 update로 버튼·안내만 바꾼다(입력한 값 유지). 입력칸은 password가 아닌 text(UID는 비밀이 아님) — 대문자·맞춤법 끔·자동 완성 끔.
// 성공하면 입력칸을 비운다(UID를 화면에 남기지 않음). 확인 중에는 버튼이 잠겨 같은 값이 두 번 가지 않는다. 이미 인증된 기기는 입력칸 대신
// 지금 인증 줄 + '이 기기 인증 해제' 안내만 — 다른 UID로 덮어쓰면 옛 토큰이 정리 유예 없이 기기 칸만 차지하므로(member-control.submit도 무시한다).
// DOM은 createElement·textContent로만(CSP)
import { VTEXT, memberRowText } from '../lib/member.js';
import { renderAppGuide, signupHref } from './app-guide.js';

const DEPOSIT_HREF = 'guide/ox-deposit.pdf';

export function renderVerify(el, { config, onSubmit = () => {}, onGuest = () => {}, doc = document }) {
  const p = (cls, text) => {
    const n = doc.createElement('p');
    if (cls) n.className = cls;
    n.textContent = text;
    return n;
  };
  const link = (id, text, href) => {
    const a = doc.createElement('a');
    a.className = 'verify-link';
    a.dataset.link = id;
    a.textContent = text;
    a.href = href || '';
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };
  const box = doc.createElement('div');
  box.className = 'verify';
  const current = p('verify-current', '');
  current.hidden = true;
  const hint = p('verify-hint', VTEXT.verifiedHint);
  hint.hidden = true;
  const input = doc.createElement('input');
  input.type = 'text';
  input.id = 'verify-uid';
  input.setAttribute('inputmode', 'text');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('maxlength', '32');
  input.setAttribute('aria-label', VTEXT.label);
  input.setAttribute('placeholder', VTEXT.placeholder);
  const button = doc.createElement('button');
  button.type = 'button';
  button.id = 'verify-submit';
  button.className = 'big-btn';
  button.textContent = VTEXT.submit;
  const msg = p('verify-msg', '');
  msg.hidden = true;
  msg.setAttribute('role', 'status');
  // 링크 줄: 가입(늘, 그 판 주소) · 입금·사용 가이드(명단에 없음 뒤, 빌드가 실은 판만) · 문의하기(V-09·V-15)
  const links = doc.createElement('div');
  links.className = 'verify-links';
  const signup = link('verify-signup', VTEXT.signup, config && config.signupUrl);
  signup.hidden = !signupHref(config);
  // 앱 받기 줄(가입 줄 바로 아래) — 링크 줄 모양의 버튼, 누르면 앱 받기 창(맨 위에 그 판 가입 단계)
  const appGuide = doc.createElement('button');
  appGuide.type = 'button';
  appGuide.className = 'verify-link verify-app';
  appGuide.dataset.link = 'verify-app';
  appGuide.textContent = VTEXT.appGuide;
  const deposit = link('verify-deposit', VTEXT.depositGuide, DEPOSIT_HREF);
  deposit.hidden = true;
  const canDeposit = !!(config && config.guides && config.guides.deposit === true);
  const contact = doc.createElement('a');
  contact.className = 'big-btn alt';
  contact.dataset.link = 'verify-contact';
  contact.textContent = VTEXT.contact;
  contact.href = config && config.kakao ? config.kakao : '';
  contact.target = '_blank';
  contact.rel = 'noopener';
  contact.hidden = true;
  links.append(signup, appGuide, deposit, contact);

  // 앱 받기 창 — 하나만, 열려 있는 동안만 Esc를 듣는다(닫을 때 지움). 창의 생명은 인증 화면과 같이: 인증되면(update) 닫고,
  // 화면을 떠나면 app.js show()가 closeAppGuide()를 부른다(안드로이드 뒤로 가기로 #verify를 떠나도 창이 남지 않게).
  // 창을 닫은 Esc는 문서의 다른 키 듣기(안내 덮개 등)에 가지 않는다
  let guide = null;
  const onGuideKey = (e) => {
    if (!e || e.key !== 'Escape') return;
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    closeGuide();
  };
  function closeGuide() {
    if (!guide) return;
    guide.remove();
    guide = null;
    if (doc.removeEventListener) doc.removeEventListener('keydown', onGuideKey);
  }
  function openGuide() {
    if (guide) return;
    guide = renderAppGuide({ doc, config, onClose: closeGuide });
    doc.body.append(guide);
    if (doc.addEventListener) doc.addEventListener('keydown', onGuideKey);
  }
  appGuide.addEventListener('click', openGuide);
  const or = p('verify-or', VTEXT.or);
  const guest = doc.createElement('button');
  guest.type = 'button';
  guest.id = 'verify-guest';
  guest.className = 'big-btn alt';
  guest.textContent = VTEXT.guest;
  guest.addEventListener('click', () => onGuest());
  const foot = p('verify-foot', VTEXT.foot);

  let pending = false;
  let verified = false;
  const submit = () => {
    if (!pending && !verified) onSubmit(input.value);
  };
  button.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e && e.key === 'Enter') submit();
  });

  box.append(
    p('verify-gate-title', VTEXT.gateTitle), p('verify-desc', VTEXT.gateDesc), p('verify-why', VTEXT.gateWhy), p('verify-intro', VTEXT.intro),
    current, hint, input, button, msg, links, or, guest, foot, p('verify-note', VTEXT.privacy),
  );
  el.replaceChildren(box);

  function update({ member = null, verify = { pending: false, message: null } } = {}) {
    verified = !!member;
    if (verified) closeGuide(); // 링크 줄과 함께 창도 — 인증 직후 계정 연결 한 장과 겹치지 않게
    for (const n of [input, button, or, guest, foot]) n.hidden = verified;
    hint.hidden = !verified;
    if (verified) input.value = '';
    pending = !!(verify && verify.pending);
    button.disabled = pending;
    button.textContent = pending ? VTEXT.pending : VTEXT.submit;
    const m = verify && verify.message;
    msg.hidden = !m;
    msg.textContent = m ? m.text : '';
    msg.className = m ? `verify-msg ${m.tone}` : 'verify-msg';
    contact.hidden = !(m && m.contact);
    if (m && m.contact) contact.href = m.contact;
    // 명단에 없음(V-09) 뒤에만 입금·사용 가이드 — 허브 명단은 있음/없음만 알아 미가입·입금 전을 가르지 못하므로 가입 줄과 같이
    deposit.hidden = verified || !canDeposit || !(m && m.text === VTEXT.notVerified);
    links.hidden = verified;
    if (m && m.ok) input.value = '';
    current.hidden = !member;
    current.textContent = member ? memberRowText(member) : '';
  }

  update();
  return { box, input, button, guest, update, closeAppGuide: closeGuide };
}
