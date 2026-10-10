// 트레이딩 탭 ⚡ 오토 모드 켜기·끄기 줄(따라가기 — CEO 2026-10-10) — 차트 위 '⚡ 오토 모드' 카드 안 자리(.trade-follow, app/modes/trade.js onOrderSlot의 follow)에
// 제목('⚡ 오토 모드' — 이 줄을 그리면 카드 제목 h2는 숨음) · 엔진 상태 줄(켜짐·꺼짐) · 켜기/끄기 버튼 하나 · '설정 ›' + 기능 한계 한 줄.
// 모델은 app/lib/follow-view.js followQuick(같은 엔진 state()).
// 누르는 것은 app.js로만(onToggle — 끄기는 따라가기 화면과 같은 follow.disable(), 켜기는 같은 enable 길 또는 #follow / onSettings — 늘 #follow).
// DOM은 createElement·textContent로만(CSP — 인라인 꾸밈 속성·HTML 문자열 없음). 버튼은 한 번 만들고 글만 바꾼다(누르는 사이 다시 만들지 않음)
const TONES = new Set(['good', 'warn', 'bad', 'dim']);

export function renderTradeFollow(slot, { doc = globalThis.document, onToggle = () => {}, onSettings = () => {} } = {}) {
  const node = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (id, cls) => {
    const b = node('button', cls);
    b.type = 'button';
    b.id = id;
    return b;
  };
  const row = node('div', 'tf-row');
  const title = node('span', 'tf-title');
  const status = node('span', 'tf-status dim');
  status.setAttribute('role', 'status');
  const toggle = button('trade-follow-toggle', 'tf-toggle');
  toggle.setAttribute('aria-pressed', 'false');
  const settings = button('trade-follow-settings', 'tf-settings');
  row.append(title, status, toggle, settings);
  const note = node('p', 'tf-note');

  // 앞 누름(켜기는 거래소 배율 확인까지 기다림)이 끝나기 전 겹쳐 누름은 무시 — 그동안 버튼을 막는다(엔진 상태가 다시 그려져도)
  let busy = false;
  toggle.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    toggle.disabled = true;
    let p = null;
    try {
      p = onToggle();
    } catch {
      p = null;
    }
    Promise.resolve(p).catch(() => {}).finally(() => {
      busy = false;
      toggle.disabled = false;
    });
  });
  settings.addEventListener('click', () => onSettings());

  let shown = false;
  function update(m) {
    if (!m || m.show !== true) {
      slot.replaceChildren(); // 자리를 비움 — .trade-follow:empty는 숨김(app.css)
      shown = false;
      return;
    }
    title.textContent = m.title;
    status.textContent = m.status;
    status.className = `tf-status ${TONES.has(m.tone) ? m.tone : 'dim'}`;
    toggle.textContent = m.button;
    toggle.setAttribute('aria-pressed', m.on === true ? 'true' : 'false');
    toggle.disabled = busy;
    settings.textContent = m.settings;
    note.textContent = m.note;
    if (!shown) slot.replaceChildren(row, note);
    shown = true;
  }

  return { update, toggle, settings };
}
