// 트레이딩 탭 분석 근거 창(대표 2026-10-23 — 판정 상자 '근거 보기 ▾' → 사무실·PC판 '분석 근거' 창과 같은 꼴). 계산·문구는 app/lib/trade-evidence.js.
// 제목 '분석 근거' + 오른쪽 위 빨간 ✕(닫기) · Esc · 바깥(막) 누름으로 닫힘. ■ 차트 근거(받는 동안 '수신 중' → chart 약속이 풀리면 바꿈)·■ 뉴스 근거
// (출처 주황 칩·제목·N분 전 · 원문 ↗ — https만, 새 창)·■ 토론 결론(BULL·BEAR 두 상자). 판정 → 주문으로 잇는 말·버튼 없음(보안 규칙 22).
// 창은 원웨이 안내 창(hedge-guide.js)과 같은 .ui-modal 꼴 — 문서 body에 하나, 열 때 ✕에 초점, 닫을 때 열기 전 초점으로. DOM은 createElement·textContent만(CSP)
import { EV_TEXT, evidenceNews, evidenceDebate } from '../lib/trade-evidence.js';

export const EVIDENCE_OPEN_CLASS = 'evidence-open';

export function createEvidenceModal({ doc = globalThis.document, now = () => Date.now(), note = null } = {}) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  let win = null;
  let back = null;
  let seq = 0;
  const root = () => (doc.documentElement && doc.documentElement.classList ? doc.documentElement : null);
  const onKey = (e) => {
    if (!e || e.key !== 'Escape') return;
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    close();
  };
  function section(head, sub) {
    const sec = el('div', 'ev-sec');
    const h = el('div', 'ev-head', head);
    if (sub) h.append(el('small', null, sub));
    sec.append(h);
    return sec;
  }
  function chartSection(items) {
    const sec = section(EV_TEXT.chart, EV_TEXT.chartSub);
    sec.classList.add('ev-chart');
    const ul = el('ul', 'ev-list');
    if (Array.isArray(items) && items.length) {
      for (const it of items) {
        const li = el('li');
        li.append(el('span', null, it.t), el('em', null, `→ ${it.link}`));
        ul.append(li);
      }
    } else {
      const li = el('li');
      li.append(el('span', null, items === null ? EV_TEXT.chartWait : EV_TEXT.chartNone));
      ul.append(li);
    }
    sec.append(ul);
    return sec;
  }
  function newsSection(list) {
    const sec = section(EV_TEXT.news);
    const ul = el('ul', 'ev-news');
    if (list.length) {
      for (const n of list) {
        const li = el('li');
        const meta = el('span', 'ev-meta');
        if (n.age) meta.append(n.age);
        if (n.link) {
          if (n.age) meta.append(' · ');
          const a = el('a', null, EV_TEXT.newsLink);
          a.href = n.link;
          a.target = '_blank';
          a.rel = 'noopener';
          meta.append(a);
        }
        li.append(el('span', 'ev-tag', n.source), el('span', 'ev-title', n.title), meta);
        ul.append(li);
      }
    } else {
      const li = el('li');
      li.append(el('span', 'ev-meta', EV_TEXT.newsNone));
      ul.append(li);
    }
    sec.append(ul);
    return sec;
  }
  function debateSection(d) {
    const sec = section(EV_TEXT.debate);
    if (d.bull || d.bear) {
      const g = el('div', 'ev-debate');
      const side = (cls, head, text) => { const x = el('div', `ev-side ${cls}`); x.append(el('b', null, head), el('p', null, text || '—')); return x; };
      g.append(side('bull', EV_TEXT.bull, d.bull), side('bear', EV_TEXT.bear, d.bear));
      sec.append(g);
    } else sec.append(el('div', 'ev-meta', EV_TEXT.debateNone));
    return sec;
  }
  function close() {
    seq += 1;
    if (!win) return;
    win.remove();
    win = null;
    if (doc.removeEventListener) doc.removeEventListener('keydown', onKey);
    const r = root();
    if (r) r.classList.remove(EVIDENCE_OPEN_CLASS);
    const prev = back;
    back = null;
    if (prev && prev !== doc.body && prev.isConnected === true && typeof prev.focus === 'function') prev.focus();
  }
  // analysis = 허브 분석 항목(parseItem 값 — turns·news), chart = 차트 근거 줄 약속([{k,t,link}] — 못 받으면 [])
  function open({ analysis, chart } = {}) {
    if (win) close();
    if (!doc || !doc.body) return false;
    const my = ++seq;
    back = doc.activeElement || null;
    const m = el('div', 'ui-modal ev-wrap');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', EV_TEXT.title);
    const box = el('div', 'ui-modal-box ev-box');
    const head = el('div', 'ev-top');
    const x = el('button', 'ev-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', EV_TEXT.close);
    x.addEventListener('click', () => close());
    head.append(el('h2', 'ui-modal-title', EV_TEXT.title), x);
    const body = el('div', 'ev-modal');
    let chartSec = chartSection(null);
    body.append(chartSec, newsSection(evidenceNews(analysis && analysis.news, now())), debateSection(evidenceDebate(analysis)));
    box.append(head, body);
    if (note) box.append(el('p', 'ui-note ev-note', note));
    m.append(box);
    m.addEventListener('click', (e) => { if (e && e.target === m) close(); });
    win = m;
    doc.body.append(m);
    if (doc.addEventListener) doc.addEventListener('keydown', onKey);
    const r = root();
    if (r) r.classList.add(EVIDENCE_OPEN_CLASS);
    if (typeof x.focus === 'function') x.focus({ preventScroll: true });
    Promise.resolve(chart).then((items) => items, () => []).then((items) => {
      if (my !== seq || !win) return;
      const next = chartSection(Array.isArray(items) ? items : []);
      const i = body.children.indexOf ? body.children.indexOf(chartSec) : -1;
      if (typeof chartSec.replaceWith === 'function') chartSec.replaceWith(next);
      else if (i >= 0) { body.children[i] = next; next.parent = body; }
      chartSec = next;
    });
    return true;
  }
  return { open, close, isOpen: () => !!win };
}
