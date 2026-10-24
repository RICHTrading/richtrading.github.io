// 인앱 브라우저(카카오톡·인스타 등)에서 외부 브라우저로 여는 링크.
// 아이폰 인앱은 강제로 Safari를 여는 방법이 없어 null → 화면이 '링크 복사'와 수동 안내를 보여 준다
export function escapeLink(env, url) {
  if (!env || !env.inApp) return null;
  const u = new URL(url);
  if (env.inApp === 'kakaotalk') {
    return { kind: 'kakao', href: `kakaotalk://web/openExternal?url=${encodeURIComponent(u.href)}` };
  }
  if (env.inApp === 'line') {
    u.searchParams.set('openExternalBrowser', '1');
    return { kind: 'line', href: u.href };
  }
  if (env.os === 'android') {
    // Chrome은 사용자가 누른 링크에서만 intent를 연다 — 자동 이동에 쓰지 말 것
    return {
      kind: 'intent',
      href: `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`,
    };
  }
  return null;
}
