// Follow Line — 원문: 대표 제공 Pine 'Follow Line'(짧은 이름 '리치 트레이딩 멤버쉽 지표', docs/indicators-src/리치 트레이딩 지표(멤버쉽).txt).
// 입력 고정: ATR 5, BB 21, 편차 1.0, ATR 필터 켬, 신호 켬. 진행 봉 포함(원문에 isconfirmed 없음).
// 다르게 두는 것(spec §4.4): 값이 0 이하인 구간은 선·라벨을 그리지 않는다(계산은 원문 그대로). 알림 없음.
import { pSma, pStdev, pAtr, nz } from './pine.js';
import { fmtPrice } from '../indicators.js';

export const FOLLOW_COLORS = Object.freeze({ up: 'rgb(220,20,60)', down: 'rgb(9,98,232)', buyBg: 'rgb(255,0,0)', sellBg: 'rgb(17,190,8)', fg: '#ffffff' });

export function followLineCore({ c, h, l, bbU, bbL, atr }) {
  const n = c.length;
  const fl = new Array(n).fill(NaN);
  const trend = new Array(n).fill(0);
  let FL = NaN; // var float FollowLine = na (L20)
  let sig = 0; // var int BBSignal = 0 (L21)
  let tr = 0; // var int iTrend = 0 (L48)
  for (let i = 0; i < n; i += 1) {
    const prev = i > 0 ? fl[i - 1] : NaN; // FollowLine[1]
    if (c[i] > bbU[i]) sig = 1; else if (c[i] < bbL[i]) sig = -1; // L24-27
    if (sig === 1) { FL = l[i] - atr[i]; if (FL < nz(prev)) FL = nz(prev); } // L30-36 (ATR 필터 켬)
    if (sig === -1) { FL = h[i] + atr[i]; if (FL > nz(prev)) FL = nz(prev); } // L39-45
    if (nz(FL) > nz(prev)) tr = 1; else if (nz(FL) < nz(prev)) tr = -1; // L49-52
    fl[i] = FL;
    trend[i] = tr;
  }
  const buys = [];
  const sells = [];
  for (let i = 1; i < n; i += 1) { // L60-61 (iTrend[1] — 첫 봉은 na라 거짓)
    if (trend[i - 1] === -1 && trend[i] === 1) buys.push(i);
    if (trend[i - 1] === 1 && trend[i] === -1) sells.push(i);
  }
  return { fl, trend, buys, sells };
}

export function followLine(B) {
  const c = B.map((b) => b.c);
  const mid = pSma(c, 21);
  const sd = pStdev(c, 21);
  const bbU = mid.map((m, i) => m + sd[i] * 1.0); // L13
  const bbL = mid.map((m, i) => m - sd[i] * 1.0); // L14
  const atr = pAtr(B, 5); // L17
  const core = followLineCore({ c, h: B.map((b) => b.h), l: B.map((b) => b.l), bbU, bbL, atr });
  const plot = core.fl.map((v, i) => (Number.isFinite(v) && v > 0 ? { i, value: v, color: core.trend[i] > 0 ? FOLLOW_COLORS.up : FOLLOW_COLORS.down } : { i }));
  const last = core.fl.at(-1);
  const legend = [{ key: 'follow', text: Number.isFinite(last) && last > 0 ? `리치 지표 ${fmtPrice(last)} · ${core.trend.at(-1) > 0 ? '상승' : '하락'}` : '리치 지표 봉 부족' }];
  return { ...core, atr, plot, legend };
}

export function followLineScene(res) {
  const labels = [];
  for (const i of res.buys) labels.push({ i, price: res.fl[i] - res.atr[i], text: '매수', bg: FOLLOW_COLORS.buyBg, fg: FOLLOW_COLORS.fg, anchor: 'up' }); // L70
  for (const i of res.sells) labels.push({ i, price: res.fl[i] + res.atr[i], text: '익절', bg: FOLLOW_COLORS.sellBg, fg: FOLLOW_COLORS.fg, anchor: 'down' }); // L71
  return { boxes: [], segs: [], circles: [], labels: labels.filter((x) => Number.isFinite(x.price) && x.price > 0) };
}
