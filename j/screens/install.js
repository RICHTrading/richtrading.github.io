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

export function renderInstall(el, { plan, sections, escape = null, appUrl, onPrompt = null, pdfHref = null, doc = document }) {
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
}
