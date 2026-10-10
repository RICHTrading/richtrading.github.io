// 첫 실행 안내 덮개(p34 설계 §6.2 그리기 — 동업자 tour.js의 휴대폰판). DOM은 createElement·textContent만, 자리는 클래스로만(CSP — style 속성·CSSOM 없음).
// - #tour(z 44): 화면 전체 어두운 막 + 바깥 누름 막음. 덮는 화면(.screen 40)·따라가기 켜짐 띠(41)보다 위, '한 번 눌러 주문' 시트(46)보다 아래(검토 5).
// - 비추는 곳: 대상에 tour-target(금색 테두리), 대상의 고정 조상(#topbar·#main·#strip)에 tour-lift(z 45 — 막 위로 올려 밝게, 누름은 막음).
//   고정 위치 조상이 쌓임 맥락을 만들어 대상 자신의 z-index·box-shadow 구멍은 막 위로 나오지 못하므로 조상째 올린다.
// - 설명 상자 #tour-box(z 45, 조상보다 뒤에 붙어 위에 그려짐): 대상이 화면 위쪽 절반이면 아래 칸(.at-bottom), 아니면 위 칸(.at-top), 대상이 없으면 가운데(.center).
// - [건너뛰기]·[이전]·[다음 ▶], 끝 장은 판별 버튼 하나. Esc = 건너뛰기, ←·→ = 이전·다음(동업자와 같음). 대상이 없는 장은 시작할 때 뺀다.
// - 첫 장의 '앱 받기' 버튼은 없다(대표 결정 2026-10-09) — 앱 받기 창은 app/screens/app-guide.js, UID 인증 화면에서 연다.
import { TOUR_TEXT } from '../lib/tour-text.js';

const LIFT_IDS = Object.freeze(['topbar', 'main', 'strip']);

export function createTour({ doc = document, win = window, onFinish = () => {} }) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  let overlay = null;
  let box = null;
  let steps = [];
  let idx = 0;
  let first = false;
  let lit = null; // { target, lift }
  let running = false;

  const html = () => doc.documentElement || null;
  const find = (sel) => {
    try {
      return sel ? doc.querySelector(sel) : null;
    } catch {
      return null;
    }
  };
  const rectOf = (n) => {
    try {
      return n && n.getBoundingClientRect ? n.getBoundingClientRect() : null;
    } catch {
      return null;
    }
  };
  const present = (s) => {
    if (!s.target) return true;
    const r = rectOf(find(s.target));
    return !!r && r.width >= 2 && r.height >= 2;
  };
  const liftOf = (n) => {
    for (let p = n; p; p = p.parentElement || p.parent || null) if (LIFT_IDS.includes(p.id)) return p;
    return null;
  };
  const unlight = () => {
    if (!lit) return;
    if (lit.target && lit.target.classList) lit.target.classList.remove('tour-target');
    if (lit.lift && lit.lift.classList) lit.lift.classList.remove('tour-lift');
    lit = null;
  };
  function remove(n) {
    if (!n) return;
    if (typeof n.remove === 'function') n.remove();
    else if (n.parent && Array.isArray(n.parent.children)) n.parent.children = n.parent.children.filter((c) => c !== n);
  }

  function body(s) {
    const out = [];
    const paras = (s.paras || []).map((t) => el('p', 'tour-p', t));
    if (!s.table) out.push(...paras); // 비교표가 있는 끝 장은 동업자처럼 표 → 설명 순서
    if (s.agents && s.agents.length) {
      const list = el('div', 'tour-agents');
      for (const a of s.agents) {
        const card = el('div', 'tour-agent');
        // 얼굴 — 데모 앱 스프라이트로 미리 만든 16×16 PNG(tools/make_tour_faces.mjs). 꾸밈이라 alt는 비움
        const face = el('img', 'tour-face');
        face.src = `tour/faces/${a.id}.png`;
        face.alt = '';
        const txt = el('div', 'tour-agent-text');
        txt.append(el('b', 'tour-agent-name', a.name), el('span', 'tour-agent-desc', a.desc));
        card.append(face, txt);
        list.append(card);
      }
      out.push(list);
    }
    if (s.table) {
      const t = el('table', 'tour-cmp');
      const thead = el('thead');
      const hr = el('tr');
      s.table.head.forEach((h, i) => hr.append(el('th', i === 1 ? 'pro' : null, h)));
      thead.append(hr);
      const tbody = el('tbody');
      for (const row of s.table.rows) {
        const tr = el('tr');
        row.forEach((c, i) => tr.append(el('td', i === 1 ? 'pro' : null, c)));
        tbody.append(tr);
      }
      t.append(thead, tbody);
      out.push(t, ...paras);
    }
    for (const t of s.small || []) out.push(el('p', 'tour-small', t));
    for (const x of s.extra || []) {
      const a = el('a', 'big-btn alt tour-extra', x.text);
      a.href = x.href;
      a.target = '_blank';
      a.rel = 'noopener';
      out.push(a);
    }
    return out;
  }

  function show(i) {
    idx = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[idx];
    unlight();
    const target = find(s.target);
    let pos = 'center';
    if (s.target && target) {
      const lift = liftOf(target);
      if (target.classList) target.classList.add('tour-target');
      if (lift && lift.classList) lift.classList.add('tour-lift');
      lit = { target, lift };
      const r = rectOf(target);
      const h = (win && win.innerHeight) || 0;
      pos = r && h && r.top + r.height / 2 >= h / 2 ? 'at-top' : 'at-bottom';
    }
    box.className = ['tour-box', pos, s.big ? 'big' : '', s.final ? 'final' : '', s.agent ? 'agent' : ''].filter(Boolean).join(' ');
    stepNo.textContent = steps.length > 1 ? `${idx + 1} / ${steps.length}` : '';
    title.textContent = s.title;
    content.replaceChildren(...body(s));
    prev.classList.toggle('invisible', idx === 0);
    skip.classList.toggle('invisible', steps.length < 2);
    next.textContent = s.final ? s.finalLabel || TOUR_TEXT.ok : TOUR_TEXT.next;
    next.classList.toggle('final', !!s.final);
  }

  function finish(how, { record = true } = {}) {
    if (!running) return;
    running = false;
    const s = steps[idx];
    unlight();
    remove(overlay);
    remove(box);
    overlay = null;
    box = null;
    if (html() && html().classList) html().classList.remove('touring');
    if (doc.removeEventListener) doc.removeEventListener('keydown', onKey);
    onFinish({ how, action: how === 'final' && s ? s.finalAction || 'close' : null, first, record });
  }

  function onKey(e) {
    if (!running || !e) return;
    if (e.key === 'Escape') finish('skip');
    else if (e.key === 'ArrowRight') goNext();
    else if (e.key === 'ArrowLeft') show(idx - 1);
  }
  function goNext() {
    if (idx >= steps.length - 1) finish('final');
    else show(idx + 1);
  }

  // 상자 부품 — 한 번 만들고 장마다 글만 바꾼다
  const stepNo = el('div', 'tour-step');
  const title = el('div', 'tour-title');
  const content = el('div', 'tour-body');
  const nav = el('div', 'tour-nav');
  const skip = el('button', 'tour-skip', TOUR_TEXT.skip);
  skip.type = 'button';
  skip.id = 'tour-skip';
  const prev = el('button', 'tour-prev', TOUR_TEXT.prev);
  prev.type = 'button';
  prev.id = 'tour-prev';
  const next = el('button', 'tour-next', TOUR_TEXT.next);
  next.type = 'button';
  next.id = 'tour-next';
  nav.append(skip, el('span', 'tour-sp'), prev, next);
  skip.addEventListener('click', () => finish('skip'));
  prev.addEventListener('click', () => show(idx - 1));
  next.addEventListener('click', goNext);

  // steps: tourSteps()/apiStep() 결과. opts.first = 처음 켤 때 자동으로 띄운 것(끝난 뒤 처리를 부른 쪽이 고른다)
  function start(list, opts = {}) {
    if (running) return false;
    steps = (Array.isArray(list) ? list : []).filter(present);
    if (!steps.length) return false;
    first = !!opts.first;
    running = true;
    overlay = el('div', 'tour');
    overlay.id = 'tour';
    overlay.setAttribute('aria-hidden', 'true');
    box = el('div', 'tour-box');
    box.id = 'tour-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '안내');
    box.append(stepNo, title, content, nav);
    doc.body.append(overlay, box);
    if (html() && html().classList) html().classList.add('touring');
    if (doc.addEventListener) doc.addEventListener('keydown', onKey);
    show(0);
    return true;
  }

  return {
    start,
    close: ({ record = true } = {}) => finish('closed', { record }),
    isRunning: () => running,
  };
}
