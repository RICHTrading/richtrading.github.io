// 서비스 워커 등록·업데이트. 새 버전은 '적용'을 눌러야만 바뀐다(화면이 저절로 새로고침되지 않게).
// 아이폰 홈 화면 앱은 메모리에서 바로 돌아와 새로 열지 않으므로, 화면이 다시 보일 때·30분마다 확인한다
export function registerSW({ onUpdateReady, nav = globalThis.navigator, win = globalThis.window }) {
  if (!nav || !('serviceWorker' in nav)) return null;
  let asked = false;
  nav.serviceWorker.addEventListener('controllerchange', () => {
    if (asked) win.location.reload();
  });
  const ready = nav.serviceWorker.register('sw.js', { scope: './' }).then((reg) => {
    const notifyIfWaiting = () => {
      if (reg.waiting && nav.serviceWorker.controller) onUpdateReady();
    };
    notifyIfWaiting();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') notifyIfWaiting(); });
    });
    win.document.addEventListener('visibilitychange', () => {
      if (win.document.visibilityState === 'visible') reg.update().catch(() => {});
    });
    win.setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    return reg;
  });
  ready.catch(() => {});
  return {
    async check() {
      const reg = await ready;
      await reg.update();
      const w = reg.installing;
      if (w) {
        await new Promise((resolve) => {
          w.addEventListener('statechange', () => { if (w.state !== 'installing') resolve(); });
        });
      }
      return !!reg.waiting;
    },
    async apply() {
      const reg = await ready;
      if (!reg.waiting) return false;
      asked = true;
      reg.waiting.postMessage('SKIP_WAITING');
      return true;
    },
  };
}
