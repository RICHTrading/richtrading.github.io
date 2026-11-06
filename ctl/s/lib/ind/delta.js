// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// [Delta Trading] (© hapharmonic) — Pine Script v6 원문(docs/indicators-src/델타 지표.txt)을 JavaScript로 옮김. 이 파일 전체가 MPL-2.0.
// 입력 고정: 캔들 칠하기 켬, 매수 #12cef8·매도 #fe3f00, EMA 켬, 거래량 확인 켬, EMA 12·26, 확인 6. 빛 번짐·채우기·알림은 옮기지 않음(spec §4.5).
import { pEma, pSma, msum, crossover, crossunder, change, sign } from './pine.js';

export const DELTA_COLORS = Object.freeze({ up: '#12cef8', down: '#fe3f00', upA10: 'rgba(18,206,248,.1)', downA10: 'rgba(254,63,0,.1)', upA20: 'rgba(18,206,248,.2)', downA20: 'rgba(254,63,0,.2)' });

export function fmtVol(x) {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(2)}K` : a.toFixed(2);
  return (x < 0 ? '-' : '') + s;
}

export function deltaRows(B) {
  return B.map(({ o, h, l, c, v }) => {
    const buy = (v * (c - l)) / (h - l); // L66 (h = l이면 NaN)
    const sell = v - buy; // L67
    const pcBuy = (buy / v) * 100; // L68
    const pcSell = 100 - pcBuy; // L69
    const isBuy = buy > sell; // L70 (NaN이면 거짓)
    const base = isBuy ? Math.min(o, c) : Math.max(o, c); // L153-158
    const value = isBuy ? base + Math.abs(o - c) * (pcBuy / 100) : base - Math.abs(o - c) * (pcSell / 100);
    return { buy, sell, pcBuy, pcSell, isBuy, higher: isBuy ? buy : sell, lower: isBuy ? sell : buy, hiCol: isBuy ? DELTA_COLORS.up : DELTA_COLORS.down, loCol: isBuy ? DELTA_COLORS.down : DELTA_COLORS.up, base, value }; // L71-74
  });
}

export function deltaCore({ v, emaF, emaS, volMA }) {
  const above = v.map((x, i) => (x > volMA[i] ? x : 0)); // L187: source > ma ? source : 0 (ma가 NaN이면 0)
  const below = v.map((x, i) => (x < volMA[i] ? x : 0));
  const sa = msum(above, 6);
  const sb = msum(below, 6);
  const isv = sa.map((x, i) => x >= sb[i]); // NaN이면 거짓
  const co = crossover(emaF, emaS); // L183
  const cu = crossunder(emaF, emaS); // L184
  const up = [];
  const down = [];
  for (let i = 0; i < v.length; i += 1) {
    if (co[i] && isv[i]) up.push(i); // L191, L213
    if (cu[i] && isv[i]) down.push(i); // L192, L214
  }
  return { isv, up, down };
}

export function delta(B) {
  const rows = deltaRows(B);
  const c = B.map((b) => b.c);
  const v = B.map((b) => b.v);
  const emaF = pEma(c, 12); // L176
  const emaS = pEma(c, 26); // L177
  const signal = emaF.map((x, i) => x > emaS[i]); // L178
  const volMA = pSma(v, 6); // L181
  const { up, down } = deltaCore({ v, emaF, emaS, volMA });
  const pane = {
    total: rows.map((r, i) => ({ value: v[i], color: r.isBuy ? DELTA_COLORS.upA10 : DELTA_COLORS.downA10 })), // L85
    total2: rows.map((r, i) => ({ value: v[i], color: r.hiCol })), // L86 계단선
    higher: rows.map((r) => ({ value: r.higher, color: r.hiCol })), // L87
    lower: rows.map((r) => ({ value: r.lower, color: r.loCol })), // L88
  };
  const candles = {
    body: rows.map((r) => ({ open: r.base, close: r.value, high: Math.max(r.base, r.value), low: Math.min(r.base, r.value), color: r.hiCol })), // L164-166
    fill: rows.map((r, i) => ({ open: B[i].o, high: B[i].h, low: B[i].l, close: B[i].c, color: r.isBuy ? DELTA_COLORS.upA20 : DELTA_COLORS.downA20, borderColor: r.hiCol, wickColor: r.hiCol })), // L168-170
  };
  const L = rows.at(-1);
  if (!L) return { rows, emaF, emaS, signal, up, down, pane, candles, legend: [{ key: 'delta', text: '델타 봉 부족' }] }; // spec §4.8
  const net = sign(change(c).at(-1)) * v.at(-1); // L92
  const pct = (x) => (Number.isFinite(x) ? `${x.toFixed(2)}%` : '—'); // 원문 NaN%는 —(spec §4.7과 같은 표시)
  const legend = [{ key: 'delta', text: `델타 매수 ${fmtVol(L.buy)} (${pct(L.pcBuy)}) · 매도 ${fmtVol(L.sell)} (${pct(L.pcSell)}) · Net ${fmtVol(net)}` }]; // L92-123 표 → 설명줄
  return { rows, emaF, emaS, signal, up, down, pane, candles, legend };
}
