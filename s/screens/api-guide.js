// 오렌지엑스 API 연결 가이드(앱용) — 키 화면(#keys) 맨 위 앱 안 단계(2026-10-12 설계 §5.1, 대표 결정 7). 문구는 app/lib/api-guide-text.js(PDF와 같은 원본).
// 접힌 채 시작(details·summary) — 키 칸이 아래로 밀리지 않게. 사진·PDF 링크는 빌드가 실은 판만(config.guides.apiApp — 회원 판 빌드에
// app/guide/api-guide/*.png·ptf-api-guide.pdf가 있어야, tools/build.mjs checkApiGuide). 동업자 가이드는 쓰지 않는다. DOM은 createElement·textContent로만(CSP)
// 서버 자동(④) 글(머리말 둘째 문장·8단계·알림 한 줄)은 서버 자동이 있는 판(serverBuildReady — 따라가기 화면 ④ 라디오와 같은 조건)만(대표 결정 2026-10-20)
import { API_GUIDE_PDF, apiGuideView, TB_API_GUIDE, TB_API_GUIDE_PDF } from '../lib/api-guide-text.js';
import { serverBuildReady } from '../lib/server-exec.js';

// 투빗 API 연결 가이드(투빗 회원 키 화면 맨 위 — 2026-11-23, 오렌지엑스 상자의 짝): 같은 접힌 상자 꼴, 그림은 투빗 시작 순서 그림(install/start/tb-api-*.webp),
// PDF guide/ptf-api-guide-tb.pdf — 둘 다 빌드가 투빗이 켜진 판에만 싣는다(이 상자도 그 판의 투빗 회원에게만)
export function renderTbApiGuide(el, { doc = globalThis.document } = {}) {
  return drawGuide(el, doc, { ...TB_API_GUIDE, steps: [...TB_API_GUIDE.steps], notes: [...TB_API_GUIDE.notes] }, { imgSrc: (s) => s.img, pdf: `guide/${TB_API_GUIDE_PDF}`, link: 'tb-api-guide-pdf', cls: 'api-guide tb-api-guide' });
}

export function renderApiGuide(el, { config, doc = globalThis.document } = {}) {
  const shots = !!(config && config.guides && config.guides.apiApp === true);
  const g = apiGuideView({ serverExec: serverBuildReady(config) });
  return drawGuide(el, doc, g, { imgSrc: (s) => (shots ? `guide/api-guide/${s.img}` : null), pdf: shots ? `guide/${API_GUIDE_PDF}` : null, link: 'api-guide-pdf', cls: 'api-guide' });
}

function drawGuide(el, doc, g, { imgSrc, pdf, link, cls }) {
  const node = (tag, c, text) => {
    const n = doc.createElement(tag);
    if (c) n.className = c;
    if (text != null) n.textContent = text;
    return n;
  };
  const box = node('details', cls);
  box.append(node('summary', 'api-guide-title', g.title), node('p', 'api-guide-lead', g.lead));
  const ol = node('ol', 'api-guide-steps');
  for (const s of g.steps) {
    const li = node('li', 'api-guide-step');
    li.dataset.step = s.id;
    li.append(node('span', 'api-guide-step-title', s.title), node('span', 'api-guide-step-text', s.text));
    const src = s.img ? imgSrc(s) : null;
    if (src) {
      const img = doc.createElement('img');
      img.className = 'api-guide-img';
      img.src = src;
      img.alt = s.title;
      img.setAttribute('loading', 'lazy');
      li.append(img);
    }
    ol.append(li);
  }
  const notes = node('ul', 'api-guide-notes');
  for (const t of g.notes) notes.append(node('li', null, t));
  box.append(ol, notes);
  if (pdf) {
    const a = node('a', 'api-guide-pdf', g.pdfLink);
    a.href = pdf;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.link = link;
    box.append(a);
  }
  el.replaceChildren(box);
  return { box };
}
