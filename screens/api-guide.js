// 오렌지엑스 API 연결 가이드(앱용) — 키 화면(#keys) 맨 위 앱 안 단계(2026-10-12 설계 §5.1, 대표 결정 7). 문구는 app/lib/api-guide-text.js(PDF와 같은 원본).
// 접힌 채 시작(details·summary) — 키 칸이 아래로 밀리지 않게. 사진·PDF 링크는 빌드가 실은 판만(config.guides.apiApp — 회원 판 빌드에
// app/guide/api-guide/*.png·ptf-api-guide.pdf가 있어야, tools/build.mjs checkApiGuide). 동업자 가이드는 쓰지 않는다. DOM은 createElement·textContent로만(CSP)
import { API_GUIDE, API_GUIDE_PDF } from '../lib/api-guide-text.js';

export function renderApiGuide(el, { config, doc = globalThis.document } = {}) {
  const node = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const shots = !!(config && config.guides && config.guides.apiApp === true);
  const box = node('details', 'api-guide');
  box.append(node('summary', 'api-guide-title', API_GUIDE.title), node('p', 'api-guide-lead', API_GUIDE.lead));
  const ol = node('ol', 'api-guide-steps');
  for (const s of API_GUIDE.steps) {
    const li = node('li', 'api-guide-step');
    li.dataset.step = s.id;
    li.append(node('span', 'api-guide-step-title', s.title), node('span', 'api-guide-step-text', s.text));
    if (s.img && shots) {
      const img = doc.createElement('img');
      img.className = 'api-guide-img';
      img.src = `guide/api-guide/${s.img}`;
      img.alt = s.title;
      img.setAttribute('loading', 'lazy');
      li.append(img);
    }
    ol.append(li);
  }
  const notes = node('ul', 'api-guide-notes');
  for (const t of API_GUIDE.notes) notes.append(node('li', null, t));
  box.append(ol, notes);
  if (shots) {
    const a = node('a', 'api-guide-pdf', API_GUIDE.pdfLink);
    a.href = `guide/${API_GUIDE_PDF}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.link = 'api-guide-pdf';
    box.append(a);
  }
  el.replaceChildren(box);
  return { box };
}
