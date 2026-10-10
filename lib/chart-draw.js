// 그리기 층(spec §3.6) — 지표 장면(상자·구간 선·원·라벨)을 큰 차트 캔버스에 그린다. Lightweight Charts v4.2.3 플러그인(series.attachPrimitive).
// 위치는 봉 번호(논리 번호, 미래 칸 허용)·가격 → 그릴 때 좌표. DOM·style 속성 없음. 지표는 가격선(createPriceLine)을 쓰지 않는다.
// 화면 밖·값 없음은 건너뛴다: 좌표가 없거나(null·NaN) 가로로 화면(0~폭)을 완전히 벗어난 요소 — 걸친 것은 그린다(3,200봉 장면을 다 그리지 않게).
export const EMPTY_SCENE = Object.freeze({ boxes: Object.freeze([]), segs: Object.freeze([]), circles: Object.freeze([]), labels: Object.freeze([]) });
export const KST_SEC = 32400;
export const toChartTime = (ms) => Math.floor(ms / 1000) + KST_SEC;
const fin = (...a) => a.every((v) => typeof v === 'number' && Number.isFinite(v));
const PAD = 4; // 선 두께·끝 모양이 넘치는 몫(px)
const outX = (a, b, width) => Math.max(a, b) < -PAD || Math.min(a, b) > width + PAD; // 폭을 모르면(undefined) 오른쪽은 자르지 않음

export function mergeScenes(...scenes) {
  const out = { boxes: [], segs: [], circles: [], labels: [] };
  for (const s of scenes) if (s) for (const k of Object.keys(out)) out[k].push(...(s[k] || []));
  return out;
}

export function drawScene(ctx, scene, { x, y, width }) {
  ctx.save();
  for (const b of scene.boxes) {
    const x1 = x(b.i1), x2 = x(b.i2), y1 = y(b.top), y2 = y(b.bottom);
    if (!fin(x1, x2, y1, y2) || outX(x1, x2, width)) continue;
    const [l, t, w, h] = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
    ctx.fillStyle = b.fill;
    ctx.fillRect(l, t, w, h);
    if (b.border) { ctx.strokeStyle = b.border; ctx.lineWidth = 1; ctx.strokeRect(l, t, w, h); }
    if (b.text) { ctx.fillStyle = b.textColor || '#a0a0b8'; ctx.font = '10px Galmuri11, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(b.text, l + w / 2, t + h / 2); }
  }
  for (const s of scene.segs) {
    const x1 = x(s.i1), y1 = y(s.p1), y2 = y(s.p2);
    const x2 = s.extendRight ? width : x(s.i2);
    if (!fin(x1, x2, y1, y2) || outX(x1, x2, width) || (s.extendRight && x1 > width + PAD)) continue; // 오른쪽으로 늘이는 선이 이미 오른쪽 끝 너머에서 시작하면 안 보임
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 1;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const c of scene.circles) {
    const cx = x(c.i), cy = y(c.price);
    if (!fin(cx, cy) || outX(cx - c.r, cx + c.r, width)) continue;
    ctx.fillStyle = c.fill;
    ctx.beginPath();
    ctx.arc(cx, cy, c.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const lb of scene.labels) {
    const lx = x(lb.i), ly = y(lb.price);
    if (!fin(lx, ly)) continue;
    ctx.font = '10px Galmuri11, monospace';
    const w = ctx.measureText(lb.text).width + 8;
    const h = 14;
    const [bx, by] = lb.anchor === 'left' ? [lx + 4, ly - h / 2] : lb.anchor === 'up' ? [lx - w / 2, ly + 4] : [lx - w / 2, ly - h - 4];
    if (outX(bx, bx + w, width)) continue; // 그려질 상자 기준 — 점이 밖이어도 상자가 걸치면 그림
    ctx.fillStyle = lb.bg;
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = lb.fg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(lb.text, bx + w / 2, by + h / 2);
  }
  ctx.restore();
}

export function createScenePrimitive() {
  let scene = EMPTY_SCENE;
  let chart = null, series = null, request = null;
  const renderer = {
    draw(target) {
      if (!chart || !series) return;
      const ts = chart.timeScale();
      target.useMediaCoordinateSpace(({ context, mediaSize }) => drawScene(context, scene, {
        x: (i) => ts.logicalToCoordinate(i),
        y: (p) => series.priceToCoordinate(p),
        width: mediaSize.width,
      }));
    },
  };
  const view = { renderer: () => renderer, zOrder: () => 'top' };
  const views = [view]; // 늘 같은 배열 — 라이브러리는 paneViews() 배열이 같으면 감싼 뷰를 다시 쓴다
  const primitive = {
    attached(p) { chart = p.chart; series = p.series; request = p.requestUpdate; },
    detached() { chart = null; series = null; request = null; },
    updateAllViews() {},
    paneViews: () => views,
  };
  return { primitive, setScene(s) { scene = s || EMPTY_SCENE; if (request) request(); } };
}

export function mergeMarkers(lists, bars) {
  const out = [];
  for (const list of lists) for (const m of list || []) {
    const b = bars[m.i];
    if (!b) continue;
    out.push({ time: toChartTime(b.t), position: m.position, shape: m.shape, color: m.color, text: m.text || '', size: m.size ?? 1 });
  }
  return out.sort((a, b) => a.time - b.time);
}
