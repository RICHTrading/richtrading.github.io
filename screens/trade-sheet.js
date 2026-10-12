// 트레이딩 탭 시트(계획 Task 25 modal — p40 T12 판정 상자 '근거 보기', T13 주문 칸 진입·추가·익절·정리·동의가 같이 쓴다).
// 시트는 주문 칸 밖 자리(.trade-sheet — modes/trade.js onOrderSlot의 sheet)에만 붙인다: 주문 칸 5초 다시 그리기가 이 자리를 떼었다 붙이지 않아
// 시트 안 입력칸 초점이 남는다(검토 18·33). 자리에는 시트 하나 — 새로 열면 앞 시트를 바꾼다.
// 버튼을 누르면 그 동작이 끝날 때까지 시트의 버튼을 모두 막는다(겹쳐 누름 — 같은 주문을 두 번 보내지 않게). 동작이 던진 오류는 여기서 삼킨다
// (결과 문장은 각 동작이 그린다 — 처리 안 된 거절이 콘솔 오류가 되지 않게). DOM은 createElement·textContent만(CSP — style·HTML 문자열 없음).

// 시트가 열린 동안 html.tv-sheet-open(검토 7): 시트는 #main(고정 — 쌓임 맥락) 안이라 z 50이어도 #main 밖의 맨 아래 설치 배너(#install-banner, z 30)
// 아래에 깔려 동의·끄기 버튼이 가려진다. app.css가 이 표식이 있는 동안 배너를 숨긴다(배너 ✕를 찾지 않아도 시트 버튼을 누를 수 있게)
const OPEN_CLASS = 'tv-sheet-open';
const rootOf = (doc) => (doc && doc.documentElement && doc.documentElement.classList ? doc.documentElement : null);

const node = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// 시트 한 줄 — 라벨(span) + 값(b)
export function sheetRow(doc, label, value) {
  const r = node(doc, 'div', 'tvm-row');
  r.append(node(doc, 'span', '', String(label ?? '')), node(doc, 'b', '', String(value ?? '')));
  return r;
}

// rows: [라벨, 값] 또는 노드(입력칸·칩 줄 등), actions: [[글, 동작, 클래스?]], red: 위험 동작(정리·끄기) 테두리, note: 맨 아래 작은 글. 돌려줌 = 시트 노드
export function openSheet(slot, { doc = globalThis.document, title = '', rows = [], actions = [], red = false, note = '' } = {}) {
  const ov = node(doc, 'div', `tv-sheet${red ? ' red' : ''}`);
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  if (title) ov.setAttribute('aria-label', String(title));
  const box = node(doc, 'div', 'tvm-box');
  box.append(node(doc, 'div', 'tvm-title', String(title)));
  for (const r of rows) {
    if (Array.isArray(r)) box.append(sheetRow(doc, r[0], r[1]));
    else if (r) box.append(r);
  }
  const bar = node(doc, 'div', 'tvm-btns');
  let running = false;
  const buttons = actions.map(([label, fn, cls]) => {
    const b = node(doc, 'button', cls || '', label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (running) return; // 앞 동작이 끝나기 전 누름은 무시(버튼은 막혀 있다)
      running = true;
      for (const x of buttons) x.disabled = true;
      try {
        await fn();
      } catch {
        // 결과 문장은 동작이 그린다
      } finally {
        running = false;
        for (const x of buttons) x.disabled = false;
      }
    });
    return b;
  });
  bar.append(...buttons);
  box.append(bar);
  if (note) box.append(node(doc, 'div', 'tvm-note', String(note)));
  ov.append(box);
  slot.replaceChildren(ov);
  const root = rootOf(doc);
  if (root) root.classList.add(OPEN_CLASS);
  return ov;
}

// 시트 닫기 — only를 주면 그 시트가 지금 자리에 있을 때만(다른 화면이 연 시트는 두고 false). 닫았으면 true
export function closeSheet(slot, only = null) {
  if (!slot) return false;
  const cur = slot.children && slot.children.length ? slot.children[0] : null;
  if (only && cur !== only) return false;
  slot.replaceChildren();
  const root = rootOf(slot.ownerDocument || null);
  if (root) root.classList.remove(OPEN_CLASS);
  return true;
}
