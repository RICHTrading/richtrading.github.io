// PC 화면 배치(2026-10-28 대표 요청) — 넓은 화면이면 사무실·트레이딩을 나란히(html.pc-wide). 폰은 지금처럼 탭 하나.
// 경계는 CSS(app.css html.pc-wide)와 같은 값 하나
export const WIDE_QUERY = '(min-width: 1100px)';
export const PC_CLASS = 'pc-wide';

// enabled: CONFIG.pcLayout — 꺼져 있으면 넓은 화면에서도 폰 배치(탭 하나)
export function createLayout(win = globalThis.window, { enabled = true } = {}) {
  const mq = enabled && win && typeof win.matchMedia === 'function' ? win.matchMedia(WIDE_QUERY) : null;
  return {
    wide: () => !!(mq && mq.matches),
    onChange(fn) {
      if (!mq) return;
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', () => fn());
      else if (typeof mq.addListener === 'function') mq.addListener(() => fn());
    },
  };
}
