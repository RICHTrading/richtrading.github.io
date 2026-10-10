// 설치 안내 흐름 — 맨 아래 배너, 설치 화면, 안드로이드 브라우저 설치 팝업(beforeinstallprompt). 그리기는 screens/install.js
import { readEnv } from '../lib/env.js';
import { installPlan, sectionsFor } from '../lib/install-plan.js';
import { escapeLink } from '../lib/escape.js';
import { safeGet, safeSet } from '../lib/store.js';
import { renderInstall } from './install.js';

export const BANNER_KEY = 'ptf-install-banner-closed';

// 판 3개가 한 출처의 저장소를 같이 쓴다 — 닫은 기록도 판마다 따로(공용판은 1단계 키 그대로)
export function bannerKey(edition) {
  return edition && edition !== 'pub' ? `${BANNER_KEY}-${edition}` : BANNER_KEY;
}

export function createInstallController({ win = window, doc = document, config, navigate, pdfHref = null }) {
  const env = readEnv(win);
  const KEY = bannerKey(config && config.edition);
  const $ = (s) => doc.querySelector(s);
  let deferred = null; // 안드로이드 Chrome이 준 설치 팝업 — 한 번만 쓸 수 있다
  let guide = null;
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
    const p = plan();
    renderInstall($('#install-body'), {
      plan: p,
      sections: sectionsFor(p, guide),
      escape: escapeLink(env, config.appUrl),
      appUrl: config.appUrl,
      onPrompt: promptInstall,
      pdfHref,
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
