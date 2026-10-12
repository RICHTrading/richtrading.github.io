// 거래소 이벤트 칩·창(p34 §5.4 — 동업자 events.js의 휴대폰판, 대표 결정 2026-10-08-3). 세 판 모두(판의 events — config.events).
// 칩: 상단 띠(#strip) 오른쪽 자리(#strip-events)에 "◆ 거래소 이벤트 · {chip}"(글자 두 벌 span.long·span.short — 좁은 화면·띠가 넘치면(#strip.tight) 짧은 쪽).
//     자리(slot)는 함수로 받아 그릴 때마다 찾는다 — 띠(외형 트랙 app/screens/strip.js renderStrip)가 안을 통째로 새로 그려 자리가 바뀌어도 칩이 문서 안에 남게.
//     자리가 아직 없으면 그리지 않고 onChip(false)(던지지 않음). 칩을 넣거나 지운 뒤 onChip → 띠가 보일지 다시 정한다(strip.refresh).
// 창: role="dialog", ✕·바깥(덮개) 누름·Esc로 닫힘. 머리 → (boost) 제목·표·note → 입금 챌린지 → 신규 가입 과제 → 거래 챌린지(동업자 표 이름·순서)
//     → footer → 진행 상황 안내 한 줄(우리 — 운영자 계정 진행 상황은 보이지 않으므로, §5.5) → 거래소에서 받기(hubUrl, 새 창 noopener)·입금 방법.
// '입금 방법'은 동업자 입금·사용 가이드(guide/ox-deposit.pdf)를 실은 빌드(config.guides.deposit)에서만 — 없는 파일을 가리키지 않는다.
// DOM은 createElement·textContent만(CSP) — 값의 *…*(금색 강조)는 글자 조각 span.g로
import { eventsView, EVENTS_MAX_AGE_MS } from '../lib/events-feed.js';

export const DEPOSIT_GUIDE = 'guide/ox-deposit.pdf';
export const EVENTS_TEXT = Object.freeze({
  chip: '◆ 거래소 이벤트',
  chipShort: '◆ 이벤트',
  chipHint: '오렌지엑스에서 진행 중인 이벤트',
  head: '◆ 거래소 이벤트 ◆',
  close: '닫기',
  deposit: '입금 챌린지',
  tasks: '신규 가입 과제',
  volume: '거래 챌린지',
  windowDays: (n) => `가입 후 ${n}일`,
  depositRow: (n) => `순입금 ${n} USDT`,
  volumeRow: (n) => `거래량 ${n} USDT`,
  reward: (n) => `${n} USDT`,
  progress: '진행 상황(남은 날짜·순입금·거래량)은 오렌지엑스 앱에서 확인하세요.',
  get: '거래소에서 받기',
  guide: '입금 방법',
});
const DEFAULT_WINDOW_DAYS = 30; // 동업자 창과 같음(N events.js:60 — window_days가 없으면 30)
const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

// now: 이 기기 시계(시험 주입) — 응답 updated가 72시간(EVENTS_MAX_AGE_MS)을 넘거나 없으면 칩 없음(p35 D-1, 허브 maxAge와 같은 값)
export function createEventsView({ doc = document, win = window, slot, box, config, now = () => Date.now(), onChip = () => {} }) {
  let ev = null; // 거른 Events(eventsView) — 없으면 null
  let open = false;
  // 칩 자리 — 함수면 그릴 때마다 부른다(띠가 안을 새로 그려도 지금 자리), 요소면 그대로
  const slotNow = () => (typeof slot === 'function' ? slot() : slot) || null;

  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // "*강조*" → 글자 조각(span.g) — HTML로 해석하지 않는다
  function goldText(parent, text) {
    const parts = String(text).split(/\*([^*]+)\*/);
    parts.forEach((p, i) => {
      if (!p) return;
      if (i % 2 === 1) parent.append(el('span', 'g', p));
      else parent.append(p);
    });
    return parent;
  }

  function table(rows) {
    const t = el('table', 'evt-table');
    for (const cells of rows) {
      const tr = el('tr');
      cells.forEach((c, i) => {
        const td = el('td', i === 0 ? 'k' : 'r');
        if (c && c.gold) goldText(td, c.text);
        else td.textContent = c;
        tr.append(td);
      });
      t.append(tr);
    }
    return t;
  }

  function section(title, sub, rows) {
    const s = el('section', 'evt-sec');
    const h = el('h3', null, sub ? `${title} · ${sub}` : title);
    s.append(h, table(rows));
    return s;
  }

  function onKey(e) {
    if (e && e.key === 'Escape') close();
  }

  function close() {
    if (!open) return;
    open = false;
    box.hidden = true;
    box.replaceChildren();
    win.removeEventListener('keydown', onKey);
  }

  function render() {
    const dlg = el('div');
    dlg.id = 'evt';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'evt-title');
    const hd = el('div', 'evt-hd');
    const h2 = el('h2', null, EVENTS_TEXT.head);
    h2.id = 'evt-title';
    const x = el('button', 'evt-x', '✕');
    x.setAttribute('type', 'button');
    x.setAttribute('aria-label', EVENTS_TEXT.close);
    x.addEventListener('click', close);
    hd.append(h2, x);
    const body = el('div', 'evt-body');
    const days = EVENTS_TEXT.windowDays(ev.windowDays || DEFAULT_WINDOW_DAYS);
    if (ev.boost) {
      const s = el('section', 'evt-sec');
      s.append(el('h3', null, ev.boost.title));
      if (ev.boost.rows.length) s.append(table(ev.boost.rows.map((r) => [r[0], { gold: true, text: r[1] }])));
      if (ev.boost.note) s.append(el('p', 'evt-note', ev.boost.note));
      body.append(s);
    }
    if (ev.deposit.length) body.append(section(EVENTS_TEXT.deposit, days, ev.deposit.map((t) => [EVENTS_TEXT.depositRow(num(t[0])), EVENTS_TEXT.reward(num(t[1]))])));
    if (ev.tasks.length) body.append(section(EVENTS_TEXT.tasks, days, ev.tasks.map((t) => [t[0], EVENTS_TEXT.reward(num(t[1]))])));
    if (ev.volume.length) body.append(section(EVENTS_TEXT.volume, days, ev.volume.map((t) => [EVENTS_TEXT.volumeRow(num(t[0])), EVENTS_TEXT.reward(num(t[1]))])));
    const ft = el('div', 'evt-ft');
    if (ev.footer) ft.append(el('p', 'evt-foot', ev.footer));
    ft.append(el('p', 'evt-own', EVENTS_TEXT.progress));
    const bt = el('div', 'evt-bt');
    if (ev.hubUrl) {
      const a = el('a', 'evt-get', EVENTS_TEXT.get);
      a.setAttribute('href', ev.hubUrl);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      bt.append(a);
    }
    if (config.guides && config.guides.deposit === true) {
      const a = el('a', 'evt-guide', EVENTS_TEXT.guide);
      a.setAttribute('href', DEPOSIT_GUIDE);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      bt.append(a);
    }
    if (bt.children.length) ft.append(bt);
    dlg.append(hd, body, ft);
    box.replaceChildren(dlg);
    box.hidden = false;
    return x;
  }

  function show() {
    if (!ev) return;
    const wasOpen = open;
    const x = render();
    if (!wasOpen) {
      open = true;
      win.addEventListener('keydown', onKey);
      if (x && typeof x.focus === 'function') x.focus();
    }
  }

  function renderChip() {
    const at = slotNow();
    if (!ev || !at) {
      if (at) at.replaceChildren();
      onChip(false);
      return;
    }
    const chip = el('button');
    chip.id = 'evt-chip';
    chip.setAttribute('type', 'button');
    chip.setAttribute('title', EVENTS_TEXT.chipHint);
    const long = el('span', 'long', EVENTS_TEXT.chip);
    if (ev.boost && ev.boost.chip) long.append(' · ', el('b', null, ev.boost.chip));
    chip.append(long, el('span', 'short', EVENTS_TEXT.chipShort));
    chip.addEventListener('click', show);
    at.replaceChildren(chip);
    onChip(true);
  }

  // 바깥(덮개 자신) 누름이면 닫힘 — 창 안을 누른 것은 그대로
  box.addEventListener('click', (e) => {
    if (e && e.target === box) close();
  });

  return {
    // 허브 응답(parseEvents 결과) — null·events null이면 칩을 지우고 열린 창도 닫는다(오류 문구 없음)
    update(resp) {
      const fresh = !!resp && typeof resp.updated === 'number' && now() - resp.updated <= EVENTS_MAX_AGE_MS;
      ev = fresh && resp.events ? eventsView(resp.events, config) : null;
      renderChip();
      if (!ev) close();
      else if (open) render();
    },
    open: show,
    close,
    isOpen: () => open,
  };
}
