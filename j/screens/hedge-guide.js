// 원웨이 안내 창(헤지 모드 계정 — 대표 결정 2026-10-19, docs/research/2026-10-19-ox-hedge-5147.md). 문구 app/lib/hedge-text.js, 판단 app/lib/ox-errors.js.
// 여는 곳: 트레이딩 탭 진입·추가 진입이 hedge_mode로 끝남(modes/trade-orders.js onHedge), 자동매매 켜기 확인·자동 진입이 hedge_mode(follow-engine onHedge).
// 한 번의 실패(또는 켜기 시도)에 한 번 — 여는 쪽이 실패 결과를 받은 그 자리에서만 부르고(5초 다시 그리기는 부르지 않음), 이미 열려 있으면 새로 열지 않는다.
// 앱 받기 창(screens/app-guide.js · verify.js)과 같은 방식: .ui-modal(z 48 — 덮는 화면 .screen 40·안내 44·45 위)을 문서 body에 하나, 닫기는 [확인]·바깥(막) 누름·Esc
// (Esc 듣기는 열려 있는 동안만, 창을 닫은 Esc는 다른 키 듣기에 안 감). 열린 동안 html.hedge-guide-open — app.css가 설치 배너를 숨긴다(트레이딩 시트의 tv-sheet-open과 같은 처리).
// 초점(검토 2026-10-19 — 거래소 이벤트 창 events.js처럼): 열 때 [확인]에 초점(preventScroll — 맨 아래 버튼이라 창 위쪽 제목·글이 밀려 올라가지 않게),
// 닫을 때 열기 전 초점(document.activeElement — 문서 안에 아직 있고 body가 아닐 때만)으로 되돌린다.
// DOM은 createElement·textContent만(CSP — style 속성·HTML 문자열 없음).
import { HEDGE_TEXT, HEDGE_MOBILE_IMAGES } from '../lib/hedge-text.js';

export const HEDGE_OPEN_CLASS = 'hedge-guide-open';
const rootOf = (doc) => (doc && doc.documentElement && doc.documentElement.classList ? doc.documentElement : null);

export function renderHedgeGuide({ doc = document, onClose = () => {} } = {}) {
  return buildHedgeGuide(doc, onClose).m;
}

// 창과 [확인] 버튼(열 때 초점을 줄 곳)
function buildHedgeGuide(doc, onClose, pre = false) {
  const T = HEDGE_TEXT;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const m = el('div', 'ui-modal hedge-guide');
  m.id = 'hedge-guide';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.setAttribute('aria-label', T.title);
  const box = el('div', 'ui-modal-box');
  // 단계마다 글 한 줄 + 그 화면 그림(폰 앱 — 2026-10-28)
  const steps = el('ol', 'hedge-steps');
  T.steps.forEach((s, i) => {
    const li = el('li', null);
    li.append(el('span', 'hedge-step-text', s));
    if (HEDGE_MOBILE_IMAGES[i]) {
      const img = el('img', 'hedge-img');
      img.src = HEDGE_MOBILE_IMAGES[i];
      img.alt = T.stepAlt(i + 1);
      img.loading = i === 0 ? 'eager' : 'lazy';
      li.append(img);
    }
    steps.append(li);
  });
  const ok = el('button', 'big-btn ui-close', T.ok);
  ok.type = 'button';
  ok.addEventListener('click', () => onClose());
  box.append(el('h2', 'ui-modal-title', T.title), el('p', 'hedge-body', pre ? T.preBody : T.body), steps, el('p', 'ui-note hedge-pc', T.pc), el('p', 'ui-note hedge-warn', T.warn), ok);
  m.append(box);
  m.addEventListener('click', (e) => { if (e && e.target === m) onClose(); });
  return { m, ok };
}

// 창 하나를 여닫는 손잡이 — open()은 새로 열었으면 true(이미 열려 있으면 false)
export function createHedgeGuide({ doc = document } = {}) {
  let win = null;
  let back = null; // 열기 전 초점 — 닫을 때 되돌림
  const onKey = (e) => {
    if (!e || e.key !== 'Escape') return;
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    close();
  };
  function close() {
    if (!win) return;
    win.remove();
    win = null;
    if (doc.removeEventListener) doc.removeEventListener('keydown', onKey);
    const root = rootOf(doc);
    if (root) root.classList.remove(HEDGE_OPEN_CLASS);
    const prev = back;
    back = null;
    if (prev && prev !== doc.body && prev.isConnected === true && typeof prev.focus === 'function') prev.focus();
  }
  // pre: 실패 없이 회원이 먼저 여는 창(오토 모드 창 '설정 방법 보기') — 본문만 미리 보는 글
  function open({ pre = false } = {}) {
    if (win || !doc || !doc.body) return false;
    back = doc.activeElement || null;
    const g = buildHedgeGuide(doc, close, pre === true);
    win = g.m;
    doc.body.append(win);
    if (doc.addEventListener) doc.addEventListener('keydown', onKey);
    const root = rootOf(doc);
    if (root) root.classList.add(HEDGE_OPEN_CLASS);
    if (typeof g.ok.focus === 'function') g.ok.focus({ preventScroll: true });
    return true;
  }
  return { open, close, isOpen: () => !!win };
}
