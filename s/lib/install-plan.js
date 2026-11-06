// 지금 환경에서 보여 줄 설치 안내 종류. 화면(screens/install.js)과 PDF가 같은 guide.json 구역을 쓴다
export const PLAN_SECTIONS = {
  installed: [],
  escape: ['escape'],
  'ios-26': ['ios-26', 'first-run'],
  'ios-18': ['ios-18', 'first-run'],
  'ios-both': ['ios-26', 'ios-18', 'first-run'],
  'ios-chrome': ['ios-chrome', 'first-run'],
  'ios-other': ['ios-other'],
  'android-prompt': ['android-chrome', 'first-run'],
  'android-chrome': ['android-chrome', 'first-run'],
  'android-samsung': ['android-samsung', 'first-run'],
  'android-other': ['android-other'],
  desktop: ['desktop'],
};

export function installPlan(env, { bip = false } = {}) {
  if (env.standalone) return 'installed';
  if (env.inApp) return 'escape';
  if (env.os === 'ios') {
    if (env.browser === 'crios') return 'ios-chrome';
    if (env.browser !== 'safari') return 'ios-other';
    if (env.iosAmbiguous) return 'ios-both';
    return env.iosMajor >= 26 ? 'ios-26' : 'ios-18';
  }
  if (env.os === 'android') {
    if (bip) return 'android-prompt'; // 브라우저 설치 팝업을 받았으면 그게 가장 쉽다
    if (env.browser === 'samsung') return 'android-samsung';
    if (env.browser === 'chrome') return 'android-chrome';
    return 'android-other';
  }
  return 'desktop';
}

export function sectionsFor(plan, guide) {
  const ids = PLAN_SECTIONS[plan] || [];
  const byId = new Map(((guide && guide.sections) || []).map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
