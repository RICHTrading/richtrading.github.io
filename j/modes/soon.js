// 아직 열리지 않은 탭 — 무엇이 들어올지와 '준비 중'만 정직하게 보여 준다(지금은 없음).
// 운영 측 자동매매 송출은 3-1부터 실제 화면(modes/auto.js — 2026-10-10부터 트레이딩 탭 안), 트레이딩 탭은 2단계부터 실제 화면(modes/trade.js)
export const SOON = {};

export function renderSoon(panel, { title, lines }, doc = document) {
  panel.replaceChildren();
  const box = doc.createElement('div');
  box.className = 'soon';
  const badge = doc.createElement('span');
  badge.className = 'badge';
  badge.textContent = '준비 중';
  const h = doc.createElement('h2');
  h.textContent = title;
  box.append(badge, h);
  for (const t of lines) {
    const p = doc.createElement('p');
    p.textContent = t;
    box.append(p);
  }
  panel.append(box);
}
