// 설치 안내 화면 그리기 — 내용은 install/guide.json(PDF와 같은 문구), 어떤 구역을 보일지는 lib/install-plan.js
export function installIntro(plan) {
  if (plan === 'installed') return '이미 앱으로 설치돼 있습니다. 홈 화면 아이콘으로 열어 쓰시면 됩니다.';
  if (plan === 'escape') return '지금은 다른 앱(카카오톡·텔레그램 등) 안에서 열려 있어 홈 화면에 추가할 수 없습니다. 먼저 Safari나 Chrome으로 열어 주세요.';
  if (plan === 'desktop') return '이 앱은 휴대폰용입니다. 휴대폰에서 아래 주소를 열어 주세요.';
  return '홈 화면에 추가하면 주소창 없이 앱처럼 열립니다.';
}

export function renderSection(s, doc = document) {
  const box = doc.createElement('section');
  box.className = 'guide-sec';
  box.dataset.section = s.id;
  const h = doc.createElement('h2');
  h.textContent = s.title;
  box.append(h);
  if (s.lead) {
    const p = doc.createElement('p');
    p.className = 'lead';
    p.textContent = s.lead;
    box.append(p);
  }
  const ol = doc.createElement('ol');
  for (const st of s.steps) {
    const li = doc.createElement('li');
    li.textContent = st.text;
    if (st.chips && st.chips.length) {
      const row = doc.createElement('div');
      row.className = 'chips';
      st.chips.forEach((c, i) => {
        if (i) {
          const ar = doc.createElement('span');
          ar.className = 'chip-arrow';
          ar.textContent = '→';
          row.append(ar);
        }
        const chip = doc.createElement('span');
        chip.className = 'chip';
        chip.textContent = c;
        row.append(chip);
      });
      li.append(row);
    }
    ol.append(li);
  }
  box.append(ol);
  for (const n of s.notes || []) {
    const p = doc.createElement('p');
    p.className = 'note';
    p.textContent = n;
    box.append(p);
  }
  return box;
}

// 시작 순서 단계 글의 '(1)'·'(2)'… = 그림의 빨간 번호 — 빨간 동그라미 글자로(.start-mk)
export function markParts(text) {
  return String(text).split(/(\(\d\))/).filter((p) => p !== '').map((p) => {
    const m = /^\((\d)\)$/.exec(p);
    return m ? { mark: m[1] } : { text: p };
  });
}

// 회원 시작 순서 한 구역 — 단계마다 한두 줄 + 실제 앱 화면 그림(install/start/*.webp — tools/make_start_shots.py, PDF와 같은 그림)
export function renderStartSection(s, doc = document) {
  const box = doc.createElement('section');
  box.className = 'guide-sec start-sec';
  box.dataset.section = s.id;
  const h = doc.createElement('h2');
  h.textContent = s.title;
  box.append(h);
  const ol = doc.createElement('ol');
  ol.className = 'start-steps';
  for (const st of s.steps) {
    const li = doc.createElement('li');
    const p = doc.createElement('p');
    p.className = 'start-step';
    for (const part of markParts(st.text)) {
      const span = doc.createElement('span');
      if (part.mark) span.className = 'start-mk';
      span.textContent = part.mark || part.text;
      p.append(span);
    }
    li.append(p);
    for (const src of st.img || []) {
      const img = doc.createElement('img');
      img.className = 'start-img';
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      li.append(img);
    }
    ol.append(li);
  }
  box.append(ol);
  for (const n of s.notes || []) {
    const p = doc.createElement('p');
    p.className = 'note';
    p.textContent = n;
    box.append(p);
  }
  return box;
}

// 회원 시작 순서(수호·준현판 — install/start.json, PDF tools/make_start_guide.py와 같은 문구·그림): 제목·한 줄·①~⑦ 구역·원금 손실 한 줄·PDF 링크
export function renderStart(el, { guide, pdfHref = null, doc = document }) {
  const box = doc.createElement('div');
  box.className = 'start-guide';
  box.id = 'start-guide';
  const h = doc.createElement('h2');
  h.className = 'start-head';
  h.textContent = guide.title;
  box.append(h);
  if (guide.lead) {
    const p = doc.createElement('p');
    p.className = 'install-intro';
    p.textContent = guide.lead;
    box.append(p);
  }
  for (const s of guide.sections) box.append(renderStartSection(s, doc));
  if (guide.notice) {
    const p = doc.createElement('p');
    p.className = 'start-notice';
    p.textContent = guide.notice;
    box.append(p);
  }
  if (pdfHref) {
    const a = doc.createElement('a');
    a.className = 'big-btn alt';
    a.id = 'start-pdf';
    a.href = pdfHref;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = guide.pdfLink || 'PDF 보기';
    box.append(a);
  }
  el.append(box);
}

export function renderInstall(el, { plan, sections, escape = null, appUrl, onPrompt = null, pdfHref = null, start = null, doc = document }) {
  el.replaceChildren();
  const intro = doc.createElement('p');
  intro.className = plan === 'installed' ? 'installed-note' : 'install-intro';
  intro.textContent = installIntro(plan);
  el.append(intro);

  const actions = doc.createElement('div');
  actions.className = 'escape-actions';
  if (plan === 'escape' && escape) {
    const a = doc.createElement('a');
    a.className = 'big-btn';
    a.href = escape.href;
    a.dataset.escape = escape.kind;
    a.textContent = '외부 브라우저로 열기';
    actions.append(a);
  }
  if (plan === 'android-prompt' && onPrompt) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'big-btn';
    btn.id = 'install-prompt';
    btn.textContent = '앱 설치';
    btn.addEventListener('click', () => onPrompt());
    actions.append(btn);
  }
  if (['escape', 'desktop', 'ios-other', 'android-other'].includes(plan)) {
    const copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'big-btn alt';
    copy.id = 'copy-link';
    copy.textContent = `링크 복사 (${appUrl.replace(/^https:\/\//, '').replace(/\/$/, '')})`;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(appUrl);
        copy.textContent = '복사했습니다 — 브라우저 주소창에 붙여 넣어 주세요';
      } catch {
        copy.textContent = appUrl;
      }
    });
    actions.append(copy);
  }
  if (actions.childElementCount) el.append(actions);

  for (const s of sections) el.append(renderSection(s, doc));

  if (pdfHref) {
    const a = doc.createElement('a');
    a.className = 'big-btn alt';
    a.id = 'guide-pdf';
    a.href = pdfHref;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'PDF 안내서 보기';
    el.append(a);
  }
  if (start && start.guide) renderStart(el, { guide: start.guide, pdfHref: start.pdfHref, doc });
}
