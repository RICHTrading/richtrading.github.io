// VP BOX indicator — 원문: 대표 제공 Pine v6(docs/indicators-src/VP BOX 지표 토리.txt). 입력 고정: 칸 20, 1W, 움직이는 PoC 끔.
// 다른 점(spec §4.6): 주 바뀜은 request.security(1W) 대신 봉 시각의 주 번호(월요일 00:00 UTC). 지난주 상자는 바뀔 때 모양을 얼려 둔다.
import { pStdev } from './pine.js';
import { fmtPrice } from '../indicators.js';

const BINS = 20;
const WEEK = 7 * 86400000;
const MONDAY0 = 4 * 86400000; // 1970-01-05 00:00 UTC(월)
// gray = Pine color.gray(#787B86, L80 주 바뀜 봉의 새 칸), label = color.new(poc_col, 90)(L140-141)
export const VP_COLORS = Object.freeze({ poc: '#298ada', bg: 'rgba(120,123,134,.1)', gray: '#787b86', g0: [46, 48, 53], g1: [126, 132, 146], label: 'rgba(41,138,218,.1)' });
export const weekIndex = (t) => Math.floor((t - MONDAY0) / WEEK);
const maxNoNa = (a) => { let m = -Infinity; for (let k = 0; k < a.length; k += 1) { const x = a[k]; if (Number.isFinite(x) && x > m) m = x; } return m === -Infinity ? NaN : m; };
const gradient = (val, top) => { // color.from_gradient(val, 2, max, #2e3035, rgb(126,132,146)) — 어두운 화면
  const f = top > 2 ? Math.min(1, Math.max(0, (val - 2) / (top - 2))) : val >= top ? 1 : 0;
  const [a, b] = [VP_COLORS.g0, VP_COLORS.g1];
  return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * f)).join(',')})`;
};
const fmt2 = (x) => String(Math.round(x * 100) / 100); // "#.##"

export function vpCore({ B, volVal, lastBarIndex }) {
  let srcHMax = -Infinity, srcLMin = Infinity; // src_h·src_l 목록의 최대·최소(쌓기만 하므로 같다)
  let sh = NaN, sl = NaN, step = NaN;
  let boxes = null, bg = null, index = NaN, poc = null;
  const freq = new Array(BINS).fill(0);
  const past = [], pastPoc = [];
  let labels = [];
  // 칸 색·글자(L109·L123-130)는 봉마다 덮어써지고 마지막 값만 남는다 — 판정 재료(val·max)만 봉마다 적어 두고
  // 색 글자는 상자를 얼릴 때(주 바뀜)와 끝에서 한 번 만든다(결과는 봉마다 칠한 것과 같음, 3,200봉 × 20칸 문자열을 줄임)
  const pVal = new Array(BINS).fill(0), pMax = new Array(BINS).fill(0);
  let dirty = false;
  const paint = () => {
    if (!boxes || !dirty) return;
    for (let k = 0; k < BINS; k += 1) {
      const isPoc = pVal[k] === pMax[k] && pMax[k] > 0;
      boxes[k].fill = isPoc ? VP_COLORS.poc : gradient(pVal[k], pMax[k]);
      boxes[k].text = isPoc ? fmt2(pVal[k]) : '';
    }
    dirty = false;
  };
  for (let i = 0; i < B.length; i += 1) {
    const { t, h, l, c } = B[i];
    const ch = i > 0 && weekIndex(t) !== weekIndex(B[i - 1].t); // L23
    if (!ch) { srcHMax = Math.max(srcHMax, h); sh = srcHMax; srcLMin = Math.min(srcLMin, l); sl = srcLMin; } // L28-35
    else { srcHMax = -Infinity; srcLMin = Infinity; } // L37-39
    if (h > sh) sh = h; // L45-47
    if (l < sl) sl = l; // L48-50
    step = Math.trunc((sh - sl) / BINS); // L52 int()
    if (lastBarIndex - i >= 3000) continue; // L160
    if (ch) { // L71-92
      const old = index; // index[1]
      index = i + 1;
      const mx = maxNoNa(freq);
      for (let k = 0; k < BINS; k += 1) {
        if (freq[k] === mx && mx > 1 && poc) pastPoc.push({ i1: old, p1: poc.y, i2: i, p2: poc.y, color: VP_COLORS.poc, width: 1, dash: [4, 4] }); // L82-83
      }
      paint();
      if (boxes) past.push(...boxes.map((b) => ({ ...b })));
      if (bg) past.push({ ...bg });
      boxes = [];
      for (let k = 0; k < BINS; k += 1) {
        const lower = sl + k * step;
        const upper = lower + step;
        boxes.push({ i1: index, i2: index, top: upper, bottom: lower, fill: freq[k] === mx ? VP_COLORS.poc : VP_COLORS.gray, text: '' }); // L80·L86
        if (k === 0) bg = { i1: index, i2: index, top: upper, bottom: lower, fill: VP_COLORS.bg, text: '' }; // L87-88
      }
      freq.fill(0); // L91-92
    } else { // L95-143
      if (bg) { bg.i2 = i; bg.top = sh; bg.bottom = sl; }
      for (let k = 0; k < BINS; k += 1) {
        const lower = sl + k * step;
        const upper = lower + step;
        const val = freq[k];
        const mx = maxNoNa(freq); // 칸마다 다시 — 이 봉에서 앞 칸에 더한 값이 들어간다(L109)
        const isPoc = val === mx && mx > 0;
        if (l < sh && h > sl && c > lower && c < upper) freq[k] = freq[k] + volVal[i]; // L112-114
        if (boxes) {
          const b = boxes[k];
          b.i2 = index + Math.trunc(val);
          b.top = upper;
          b.bottom = lower;
          pVal[k] = val; // fill = isPoc ? poc : gradient(val, mx), text = isPoc ? '#.##' : '' — paint()에서
          pMax[k] = mx;
          dirty = true;
        }
        if (isPoc) poc = { i1: index, y: (upper + lower) / 2, i2: lastBarIndex }; // L132-135
      }
      labels = [{ i: lastBarIndex, price: sh, text: ` High ${sh}` }, { i: lastBarIndex, price: sl, text: ` Low ${sl}` }, { i: lastBarIndex, price: poc ? poc.y : NaN, text: '<<' }]; // L137-143
    }
  }
  paint();
  return { boxes, bg, past, pastPoc, poc, sh, sl, step, freq, labels };
}

export function vpBox(B, { lastBarIndex = B.length - 1 } = {}) {
  const v = B.map((b) => b.v);
  const sd = pStdev(v, 200);
  const r = vpCore({ B, volVal: v.map((x, i) => x / sd[i]), lastBarIndex }); // L54
  const legend = [{ key: 'vp', text: r.step === 0 ? 'VP BOX 칸 없음(가격 폭 작음)' : Number.isFinite(r.sh) ? `VP BOX 1W · 고 ${fmtPrice(r.sh)} · 저 ${fmtPrice(r.sl)}` : 'VP BOX 봉 부족' }];
  return { ...r, legend };
}

export function vpScene(res, { chartBg = '#06060c' } = {}) {
  const ok = (b) => [b.i1, b.i2, b.top, b.bottom].every(Number.isFinite) && b.top !== b.bottom;
  const segOk = (s) => [s.i1, s.i2, s.p1, s.p2].every(Number.isFinite); // L83 index[1]이 na인 점선(범위 안 첫 주 바뀜)은 그리지 않음
  const boxes = [...res.past, ...(res.boxes || []), ...(res.bg ? [res.bg] : [])].filter(ok).map((b) => ({ ...b, border: chartBg, textColor: '#a0a0b8' }));
  const segs = res.pastPoc.filter(segOk);
  if (res.poc && Number.isFinite(res.poc.i1)) segs.push({ i1: res.poc.i1, p1: res.poc.y, i2: res.poc.i2, p2: res.poc.y, color: VP_COLORS.poc, width: 1, dash: [] });
  // 라벨 숫자는 precisionFor 자릿수(spec §4.6), << 는 바탕 없음(L142 color(na))
  const labels = res.labels.filter((x) => Number.isFinite(x.price)).map((x) => ({ ...x, text: x.text === '<<' ? '<<' : x.text.replace(/\S+$/, fmtPrice(x.price)), bg: x.text === '<<' ? 'rgba(0,0,0,0)' : VP_COLORS.label, fg: '#a0a0b8', anchor: 'left' }));
  return { boxes, segs, circles: [], labels };
}
