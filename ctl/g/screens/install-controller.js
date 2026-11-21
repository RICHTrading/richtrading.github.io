// 설치 안내 흐름 — 맨 아래 배너, 설치 화면, 안드로이드 브라우저 설치 팝업(beforeinstallprompt). 그리기는 screens/install.js
import { readEnv } from '../lib/env.js';
import { installPlan, sectionsFor } from '../lib/install-plan.js';
import { escapeLink } from '../lib/escape.js';
import { safeGet, safeSet } from '../lib/store.js';
import { renderInstall } from './install.js';

export const BANNER_KEY = 'ptf-install-banner-closed';
export const TB_START_PDF_HREF = 'guide/ptf-start-guide-tb.pdf';

// 회원 시작 순서 고르기(투빗 3단계 P3-10): 투빗이 켜진 빌드(config.exchanges에 'tb' — 빌드가 그 판에만 start-tb.json을 실음)의
// 투빗 회원(kv.member.ex 'tb' — 허브가 정한 값)은 install/start-tb.json(투빗 화면 ②·③) + 투빗 PDF(guide/ptf-start-guide-tb.pdf — 2026-11-21), 그 밖은 install/start.json + PDF
export function startGuideFor({ config, ex, pdfHref }) {
  if (!pdfHref) return null; // 시작 순서가 없는 판(공용판)
  const tbBuild = !!(config && Array.isArray(config.exchanges) && config.exchanges.includes('tb'));
  if (tbBuild && ex === 'tb') return { href: 'install/start-tb.json', pdfHref: TB_START_PDF_HREF };
  return { href: 'install/start.json', pdfHref };
}

// 판 3개가 한 출처의 저장소를 같이 쓴다 — 닫은 기록도 판마다 따로(공용판은 1단계 키 그대로)
export function bannerKey(edition) {
  return edition && edition !== 'pub' ? `${BANNER_KEY}-${edition}` : BANNER_KEY;
}

// start = { href, pdfHref } 또는 그것을 돌려주는 함수 — 수호·준현판 회원 시작 순서(install/start.json, 투빗 회원은 install/start-tb.json).
// 없거나 받지 못하면 설치 안내만
export function createInstallController({ win = window, doc = document, config, navigate, pdfHref = null, start = null }) {
  const env = readEnv(win);
  const KEY = bannerKey(config && config.edition);
  const $ = (s) => doc.querySelector(s);
  let deferred = null; // 안드로이드 Chrome이 준 설치 팝업 — 한 번만 쓸 수 있다
  let guide = null;
  let startGuide = null;
  const plan = () => installPlan(env, { bip: !!deferred });

  function persist() {
    try {
      const s = win.navigator.storage;
      if (s && s.persist) s.persist().catch(() => {});
    } catch {
      // 지원 안 하는 브라우저
    }
  }

  function updateBanner() {
    const p = plan();
    const show = !['installed', 'desktop', 'escape'].includes(p) && safeGet(KEY) !== '1';
    $('#install-banner').hidden = !show;
    $('#ib-go').textContent = p === 'android-prompt' ? '앱 설치' : '설치 방법';
  }

  async function promptInstall() {
    if (!deferred) return;
    const e = deferred;
    deferred = null;
    try {
      await e.prompt();
      await e.userChoice;
    } catch {
      // 사용자가 닫음
    }
    updateBanner();
  }

  async function open() {
    if (!guide) {
      try {
        guide = await (await win.fetch('install/guide.json')).json();
      } catch {
        guide = { sections: [] };
      }
    }
    // start가 함수면 열 때마다 고른다(투빗 회원 = install/start-tb.json — 활성화 뒤 거래소가 정해지므로). 받은 글은 주소마다 한 번
    const cur = typeof start === 'function' ? start() : start;
    if (cur && (!startGuide || startGuide.href !== cur.href)) {
      try {
        const g = await (await win.fetch(cur.href)).json();
        startGuide = { href: cur.href, guide: g && Array.isArray(g.sections) ? g : false };
      } catch {
        startGuide = { href: cur.href, guide: false };
      }
    }
    const p = plan();
    renderInstall($('#install-body'), {
      plan: p,
      sections: sectionsFor(p, guide),
      escape: escapeLink(env, config.appUrl),
      appUrl: config.appUrl,
      onPrompt: promptInstall,
      pdfHref,
      start: cur && startGuide && startGuide.guide ? { guide: startGuide.guide, pdfHref: cur.pdfHref } : null,
      doc,
    });
  }

  function setup() {
    win.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      updateBanner();
    });
    win.addEventListener('appinstalled', () => {
      deferred = null;
      safeSet(KEY, '1');
      updateBanner();
      persist();
    });
    $('#ib-go').addEventListener('click', () => (plan() === 'android-prompt' ? promptInstall() : navigate('install')));
    $('#ib-close').addEventListener('click', () => {
      safeSet(KEY, '1');
      updateBanner();
    });
    if (env.standalone) persist(); // 홈 화면 앱으로 열렸으면 저장 공간을 지켜 달라고 요청(키를 지킨다)
    updateBanner();
  }

  // 인앱 브라우저로 처음 열렸으면 바로 '외부 브라우저로 열기' 화면 — 그 안에서는 설치가 안 된다
  function autoOpen(currentScreen) {
    if (plan() === 'escape' && !currentScreen) navigate('install');
  }

  return { env, plan, open, setup, autoOpen, updateBanner };
}
