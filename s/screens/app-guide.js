// 오렌지엑스 앱 받기 창(p34 설계 §6.3 — 동업자 tour.js:88-110 휴대폰판). DOM은 createElement·textContent만(CSP).
// 대표 결정 2026-10-09: 첫 안내 장(S1)에서 열지 않고 UID 인증 화면(s·j, app/screens/verify.js)의 가입 줄 아래 '▶ 오렌지엑스 거래소 앱 받기'에서 연다.
// - 그 판 가입 주소(config.signupUrl — https만, 인증 화면 가입 줄과 같은 규칙)가 있으면 맨 위에 ① 가입 단계(가입하기) → ② 앱 받기.
//   가입 주소는 그 빌드의 config.signupUrl에서만 — 다른 판 코드는 빌드 출력에 0건(test/app-verify-gate.test.mjs).
// - 없으면(공용판 null·https 아님) 예전 그대로: 제목 → 설명 → 아이폰·안드로이드 → 공식 주소 안내 → 닫기.
// - 앱 두 주소는 config.oxApps(새 창 noopener). APK 직접 주소·QR은 넣지 않는다.
// - .ui-modal(z 48)이라 덮는 화면(.screen z 40)·안내(44·45) 위에 그린다. 바깥(막) 누름·닫기 = onClose. Esc는 연 쪽이 듣는다.
import { APP_GUIDE_TEXT } from '../lib/tour-text.js';

// 그 판 가입 주소 — https만(그 밖이면 null)
export function signupHref(config) {
  const u = config && config.signupUrl;
  return typeof u === 'string' && /^https:\/\//.test(u) ? u : null;
}

export function renderAppGuide({ doc = document, config, onClose = () => {} }) {
  const T = APP_GUIDE_TEXT;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const link = (cls, text, href) => {
    const a = el('a', cls, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };
  const m = el('div', 'ui-modal tour-appguide');
  m.id = 'tour-appguide';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.setAttribute('aria-label', T.title);
  const box = el('div', 'ui-modal-box');
  const col = (title, steps, text, href) => {
    const c = el('div', 'ag-col');
    const ol = el('ol', 'ag-steps');
    for (const s of steps) ol.append(el('li', null, s));
    c.append(el('h3', 'ag-os', title), ol, link('big-btn ag-btn', text, href));
    return c;
  };
  const apps = (config && config.oxApps) || {};
  const close = el('button', 'big-btn alt ui-close', T.close);
  close.type = 'button';
  close.addEventListener('click', () => onClose());
  box.append(el('h2', 'ui-modal-title', T.title));
  const signup = signupHref(config);
  if (signup) {
    const sec = el('div', 'ag-signup');
    const a = link('big-btn ag-btn', T.signupButton, signup);
    a.dataset.link = 'ag-signup';
    sec.append(el('h3', 'ag-step', T.signupStep), a);
    box.append(sec, el('h3', 'ag-step', T.appsStep));
  }
  box.append(
    el('p', null, T.sub),
    col(T.ios, T.iosSteps, T.iosButton, apps.ios || ''),
    col(T.android, T.androidSteps, T.androidButton, apps.android || ''),
    el('p', 'ui-note', T.note),
    close,
  );
  m.append(box);
  m.addEventListener('click', (e) => { if (e && e.target === m) onClose(); });
  return m;
}
