// 화면 이동은 주소 해시로만 한다(GitHub Pages는 경로 폴백이 없다).
// #office·#trade = 모드(맨 위 큰 버튼), #install·#settings·… = 모드 위를 덮는 화면.
// 대표 결정 2026-10-10: 자동매매 탭을 트레이딩 탭으로 합쳤다(맨 위 [사무실] [트레이딩] [⚙]) — 옛 #auto(홈 화면 바로가기·안내·가이드 링크·
// 마지막으로 보던 모드 저장값)는 트레이딩 탭으로 간다(MODE_ALIASES). app.js가 주소도 #trade로 바꿔 쓴다
export const MODES = ['office', 'trade'];
export const MODE_ALIASES = Object.freeze({ auto: 'trade' });
export const SCREENS = ['install', 'settings', 'verify', 'keys', 'follow']; // verify = UID 인증, keys = 거래소 연결, follow = 따라가기(s·j판만 — 자격은 app.js가 본다)
export const LAST_MODE_KEY = 'ptf-last-mode';

// 옛 모드 이름을 지금 모드로(모르는 값은 null) — 객체 원형의 이름(__proto__ 등)은 받지 않는다
function modeOf(key) {
  if (MODES.includes(key)) return key;
  return Object.hasOwn(MODE_ALIASES, key) ? MODE_ALIASES[key] : null;
}

export function parseRoute(hash) {
  const key = String(hash || '').trim().replace(/^#/, '').trim().toLowerCase();
  const mode = modeOf(key);
  if (mode) return { mode, screen: null };
  if (SCREENS.includes(key)) return { mode: null, screen: key };
  return { mode: null, screen: null };
}

export function routeHash({ mode, screen }) {
  if (screen && SCREENS.includes(screen)) return `#${screen}`;
  return `#${modeOf(mode) || MODES[0]}`;
}

// 첫 화면: 주소의 해시 → 마지막으로 보던 모드(옛 'auto'는 트레이딩) → 사무실
export function initialRoute(hash, savedMode) {
  const r = parseRoute(hash);
  const fallback = modeOf(savedMode) || MODES[0];
  return { mode: r.mode || fallback, screen: r.screen };
}
