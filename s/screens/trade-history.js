// '매매 내역' 창(2026-10-23 요청 ③·⑦ — 상단 띠 '📄 가이드'와 이벤트 칩 사이 버튼). 자동매매 서버 매매(허브 /v1/member/server/state trades —
// 이 회원 것만)를 follow-view tradeHistoryView로 요약: 승률(최근 24시간·전체) · 수익금 합계(USDT·거래 비용 제외) · 승·패 · 열린 포지션 · 끝난 매매 목록
// (종목·방향·진입·정리·%·USDT). PC판(동업자판)은 실매매 기록·성과 화면이 없어(📊 성적표는 가상 판정 통계) 이 꼴은 우리 것.
// 원웨이 안내 창(hedge-guide.js)과 같은 방식 — .ui-modal 하나를 body에, 닫기는 [닫기]·바깥 누름·Esc, 열린 동안 html.history-open, 초점 되돌림.
// 열린 동안 서버 상태가 바뀌면 update(view)로 다시 그린다. DOM은 createElement·textContent만(CSP).
import { fmtUsdt } from '../lib/auto-view.js';

export const HISTORY_TEXT = Object.freeze({
  button: '📊 매매 내역',
  buttonShort: '📊 내역',
  title: '매매 내역',
  rateDay: '승률 (최근 24시간)',
  rateAll: '승률 (전체)',
  sum: '수익금 합계',
  count: '거래 수',
  rate: (r) => (r == null ? '-' : `${r}%`),
  wl: (w, l) => `${w}승 ${l}패`,
  sumNote: '거래 비용 제외',
  openHead: '열린 포지션',
  openNone: '열린 포지션 없음',
  openLine: (o) => `${o.symbol} ${o.side} ${o.lev}× · ${o.stage}차${o.avg ? ` · 평단 ${o.avg}` : ''}`,
  doneHead: '끝난 매매',
  doneNone: '끝난 매매 없음',
  cols: ['종목', '방향', '진입', '정리', '%', 'USDT'],
  close: '닫기',
});
export const HISTORY_OPEN_CLASS = 'history-open';
const rootOf = (doc) => (doc && doc.documentElement && doc.documentElement.classList ? doc.documentElement : null);
const usdtPlain = (u) => (u ? u.replace(/ USDT$/, '') : '-');

function fill(doc, body, v) {
  const T = HISTORY_TEXT;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const stat = (k, val, sub) => {
    const d = el('div', 'hist-stat');
    d.append(el('span', 'hist-k', k), el('b', 'hist-v', val));
    if (sub) d.append(el('span', 'hist-sub', sub));
    return d;
  };
  const sumText = v.all.win + v.all.loss > 0 ? usdtPlain(fmtUsdt(v.sum)) : '-';
  const grid = el('div', 'hist-stats');
  grid.append(
    stat(T.rateDay, T.rate(v.day.rate), T.wl(v.day.win, v.day.loss)),
    stat(T.rateAll, T.rate(v.all.rate), T.wl(v.all.win, v.all.loss)),
    stat(T.sum, sumText === '-' ? '-' : `${sumText} USDT`, T.sumNote),
    stat(T.count, String(v.all.win + v.all.loss), T.wl(v.all.win, v.all.loss)),
  );
  const openBox = el('section', 'hist-open');
  openBox.append(el('h3', 'hist-h', T.openHead));
  if (v.open.length) {
    const ol = el('ol', 'hist-open-list');
    for (const o of v.open) ol.append(el('li', 'hist-open-item', T.openLine(o)));
    openBox.append(ol);
  } else openBox.append(el('p', 'hist-none', T.openNone));
  const doneBox = el('section', 'hist-done');
  doneBox.append(el('h3', 'hist-h', T.doneHead));
  if (v.done.length) {
    const table = el('table', 'hist-table');
    const head = el('tr', null);
    for (const c of T.cols) head.append(el('th', null, c));
    const thead = el('thead', null);
    thead.append(head);
    const tbody = el('tbody', null);
    for (const d of v.done) {
      const tr = el('tr', d.win === true ? 'win' : d.win === false ? 'loss' : null);
      for (const c of [d.symbol, d.side, d.entry || '-', d.exit || '-', d.pct || '-', usdtPlain(d.usdt)]) tr.append(el('td', null, c));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    doneBox.append(table);
  } else doneBox.append(el('p', 'hist-none', T.doneNone));
  body.replaceChildren(grid, openBox, doneBox);
}

// view = follow-view tradeHistoryView(trades, now)
export function createTradeHistory({ doc = document } = {}) {
  let win = null;
  let body = null;
  let back = null;
  const onKey = (e) => {
    if (!e || e.key !== 'Escape') return;
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    close();
  };
  function close() {
    if (!win) return;
    win.remove();
    win = null;
    body = null;
    if (doc.removeEventListener) doc.removeEventListener('keydown', onKey);
    const root = rootOf(doc);
    if (root) root.classList.remove(HISTORY_OPEN_CLASS);
    const prev = back;
    back = null;
    if (prev && prev !== doc.body && prev.isConnected === true && typeof prev.focus === 'function') prev.focus();
  }
  function open(view) {
    if (!doc || !doc.body) return false;
    if (win) { update(view); return false; }
    back = doc.activeElement || null;
    const m = doc.createElement('div');
    m.className = 'ui-modal trade-history';
    m.id = 'trade-history';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', HISTORY_TEXT.title);
    const box = doc.createElement('div');
    box.className = 'ui-modal-box';
    const h = doc.createElement('h2');
    h.className = 'ui-modal-title';
    h.textContent = HISTORY_TEXT.title;
    body = doc.createElement('div');
    body.className = 'hist-body';
    const ok = doc.createElement('button');
    ok.type = 'button';
    ok.className = 'big-btn ui-close';
    ok.textContent = HISTORY_TEXT.close;
    ok.addEventListener('click', () => close());
    box.append(h, body, ok);
    m.append(box);
    m.addEventListener('click', (e) => { if (e && e.target === m) close(); });
    win = m;
    fill(doc, body, view);
    doc.body.append(m);
    if (doc.addEventListener) doc.addEventListener('keydown', onKey);
    const root = rootOf(doc);
    if (root) root.classList.add(HISTORY_OPEN_CLASS);
    if (typeof ok.focus === 'function') ok.focus({ preventScroll: true });
    return true;
  }
  function update(view) {
    if (win && body && view) fill(doc, body, view);
  }
  return { open, update, close, isOpen: () => !!win };
}
