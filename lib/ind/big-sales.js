// Big Sales — 원문: 대표 제공 Pine 'Big Sales'(docs/indicators-src/big sales.txt). 입력 기본값 고정: len 7, 선 1·1, 흰색/파랑.
import { pSma } from './pine.js';
import { fmtPrice } from '../indicators.js';

const LEN = 7;
const K = [2.0, 1.75, 1.5, 1.25, 1.0]; // f1..f5(L45-49) → spc 5..1
export const BUBBLE_R = Object.freeze([3, 5, 8, 12, 18]); // tiny·small·normal·large·huge(우리가 정한 픽셀)
export const BIGS_COLORS = Object.freeze({ bull: '#ffffff', bear: '#2196f3', bullA: 'rgba(255,255,255,.5)', bearA: 'rgba(33,150,243,.5)' });

export function bigSales(B, { closedUntil = B.length - 2 } = {}) {
  const v = B.map((b) => b.v);
  const c = B.map((b) => b.c);
  const sma = pSma(v, LEN); // L44
  const blM = [{ vol: 0, pos: NaN, loc: NaN, spc: NaN }]; // L39-40
  const brM = [{ vol: 0, pos: NaN, loc: NaN, spc: NaN }];
  const bubbles = [];
  for (let i = 0; i < B.length; i += 1) {
    const tier = K.findIndex((k) => v[i] > sma[i] * k); // 첫 참 = 가장 큰 단계, NaN이면 -1
    const blV = blM[0];
    const brV = brM[0];
    blV.vol = 0; // L54-55 (dpBL·dpBR 켜짐)
    brV.vol = 0;
    if (i <= closedUntil) { // L57 barstate.isconfirmed
      for (let k = 0; k < LEN; k += 1) { // L60-62: b.c[i] > b.c[i+1]
        const a = i - k;
        const p = i - k - 1;
        if (a < 0 || p < 0) continue;
        if (c[a] > c[p]) blV.vol += v[a];
        if (c[a] < c[p]) brV.vol += v[a];
      }
      if (blV.vol === 0 && tier >= 0) blM.unshift({ vol: 0, pos: c[i], loc: i, spc: 5 - tier }); // L64-69
      if (brV.vol === 0 && tier >= 0) brM.unshift({ vol: 0, pos: c[i], loc: i, spc: 5 - tier }); // L71-76
    }
    if (blV.vol === 0 && tier >= 0) bubbles.push({ i, bull: true, top: 5 - tier }); // L116-120
    if (brV.vol === 0 && tier >= 0) bubbles.push({ i, bull: false, top: 5 - tier }); // L122-126
  }
  const lines = [];
  for (const [m, bull] of [[blM[0], true], [brM[0], false]]) if (!Number.isNaN(m.pos)) lines.push({ i: m.loc, price: m.pos, spc: m.spc, bull }); // L79-112
  const p = (bull) => { const x = lines.find((l) => l.bull === bull); return x ? fmtPrice(x.price) : '—'; };
  return { bubbles, lines, legend: [{ key: 'bigs', text: `빅세일즈 매수 ${p(true)} / 매도 ${p(false)}` }] };
}

export function bigSalesScene(res, { lastIndex, bars }) {
  const circles = [];
  for (const b of res.bubbles) for (let k = 0; k < b.top; k += 1) circles.push({ i: b.i, price: bars[b.i].c, r: BUBBLE_R[k], fill: b.bull ? BIGS_COLORS.bullA : BIGS_COLORS.bearA }); // L116 close·absolute
  const segs = res.lines.map((l) => ({ i1: l.i, p1: l.price, i2: lastIndex + 1, p2: l.price, color: l.bull ? BIGS_COLORS.bull : BIGS_COLORS.bear, width: l.spc, dash: [], extendRight: true }));
  return { boxes: [], segs, circles, labels: [] };
}
