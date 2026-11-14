// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// TP/SL GUIDE (© COINGUIDE) — Pine Script v5 원문(docs/indicators-src/TP&SL Guide.txt)을 JavaScript로 옮김. 이 파일 전체가 MPL-2.0.
// 입력 고정(DEBUG 끔 — 원문 상수 L5-116): 스윙 10, FVG 감도 Normal 1.5, TP/SL 방식 GUIDE, R:R 0.57, SL 여유 4.75, 기준 봉 100,
// 진입 대기 1봉, ATR 10·50, 최근 3,000봉, 블록 40(쓰는 수 20), FVG 20, 200봉, 끝 판정 '종가', OB 표시 끔·BB 켬·IFVG 끔·합치기 끔. 마감 봉만.
import { highest, lowest, pAtr } from './pine.js';

export const TPSL_INPUT = Object.freeze({ swingLength: 10, fvgSens: 1.5, maxATRMult: 3.5, maxOrderBlocks: 40, obUse: 20, showLastXFVGs: 20, untouched: 200, rr: 0.57, slOffset: 4.75, tpslLength: 100, entryWait: 1, window: 3000, maxGuide: 75 });

export function fvgAt(B, i, atr) { // L955-1011
  const a = B[i - 2], b = B[i - 1], c = B[i];
  const same = (c.o > c.c && b.o > b.c && a.o > a.c) || (c.o <= c.c && b.o <= b.c && a.o <= a.c); // L971-973 Same Type
  if (!same) return null;
  const sizeSum = Math.abs(c.o - c.c) + Math.abs(b.o - b.c) + Math.abs(a.o - a.c); // L961-964
  const maxCO = Math.max(Math.abs(a.c - b.o), Math.abs(b.c - c.o)); // L978
  const cond = sizeSum * TPSL_INPUT.fvgSens > atr / 1.5 && maxCO <= atr; // L980-981 Average Range, allowGaps 끔
  const bear = c.h < a.l && b.c < a.l && cond; // L987
  const bull = c.l > a.h && b.c > a.h && cond; // L988
  if (!bear && !bull) return null;
  const size = bear ? Math.abs(a.l - c.h) : Math.abs(c.l - a.h); // L993
  if (!(size * TPSL_INPUT.fvgSens > atr)) return null; // L995
  const base = { startTime: c.t, startBar: i, lastTouched: i, endBar: NaN, endTime: NaN, isInverse: false };
  return bear ? { max: a.l, min: c.h, isBull: false, ...base } : { max: c.l, min: a.h, isBull: true, ...base }; // L992
}

export function obBox(B, i, fromX, type) { // L585-601 (useBody 끔 → max = high, min = low)
  if (type === 'Bull') {
    let bottom = B[i - 1].h, top = B[i - 1].l, start = i - 1; // boxBtmBull = max[1], boxTopBull = min[1]
    for (let k = 1; k <= i - fromX - 1; k += 1) {
      bottom = Math.min(B[i - k].l, bottom);
      if (bottom === B[i - k].l) { top = B[i - k].h; start = i - k; }
    }
    return { top, bottom, startTime: B[start].t, startIndex: start };
  }
  let top = B[i - 1].h, bottom = B[i - 1].l, start = i - 1; // boxBtmBear = min[1], boxTopBear = max[1]
  for (let k = 1; k <= i - fromX - 1; k += 1) {
    top = Math.max(B[i - k].h, top);
    if (top === B[i - k].h) { bottom = B[i - k].l; start = i - k; }
  }
  return { top, bottom, startTime: B[start].t, startIndex: start };
}

export function bbFvgTouch(ob, f, time) { // L1077-1098 (+ areaOfBB L424-432, areaOfFVG L750-758)
  if (!ob.breaker) return false;
  const XA1 = ob.breakTime, XA2 = time + 1, YA1 = ob.top, YA2 = ob.bottom;
  const XB1 = f.startTime, XB2 = Number.isNaN(f.endTime) ? time + 1 : f.endTime, YB1 = f.max, YB2 = f.min;
  const inter = Math.max(0, Math.min(XA2, XB2) - Math.max(XA1, XB1)) * Math.max(0, Math.min(YA1, YB1) - Math.max(YA2, YB2));
  const union = Math.abs(XA2 - XA1) * Math.abs(YA2 - YA1) + Math.abs(XB2 - XB1) * Math.abs(YB2 - YB1) - inter;
  return (inter / union) * 100 > 0; // overlapThresholdPercentage 0
}

export const zonesInit = () => ({ swingType: 0, prevSwing: NaN, top: { x: NaN, y: NaN, crossed: false }, btm: { x: NaN, y: NaN, crossed: false }, bull: [], bear: [], fvgs: [] });

export function zonesStep(z, B, i, { hi10, lo10, atr10, inWin }) {
  const I = TPSL_INPUT;
  const b = B[i];
  const hp = i >= 10 ? B[i - 10].h : NaN;
  const lp = i >= 10 ? B[i - 10].l : NaN;
  z.swingType = hp > hi10[i] ? 0 : lp < lo10[i] ? 1 : z.swingType; // L404
  if (i > 0) { // 첫 봉은 swingType[1]이 na → 비교 거짓
    if (z.swingType === 0 && z.prevSwing !== 0) z.top = { x: i - 10, y: hp, crossed: false }; // L406-407
    if (z.swingType === 1 && z.prevSwing !== 1) z.btm = { x: i - 10, y: lp, crossed: false }; // L409-410
  }
  z.prevSwing = z.swingType;
  if (!inWin) return; // L603, L953
  for (let j = z.bull.length - 1; j >= 0; j -= 1) { // L607-620
    const ob = z.bull[j];
    if (!ob.breaker) { if (Math.min(b.o, b.c) < ob.bottom) { ob.breaker = true; ob.breakTime = b.t; ob.breakIndex = i; } }
    else if (b.c > ob.top) z.bull.splice(j, 1);
  }
  if (b.c > z.top.y && !z.top.crossed) { // L622-633
    z.top.crossed = true;
    const box = obBox(B, i, z.top.x, 'Bull');
    if (Math.abs(box.top - box.bottom) <= atr10[i] * I.maxATRMult) {
      z.bull.unshift({ ...box, type: 'Bull', breaker: false, breakTime: NaN, breakIndex: NaN });
      if (z.bull.length > I.maxOrderBlocks) z.bull.pop();
    }
  }
  for (let j = z.bear.length - 1; j >= 0; j -= 1) { // L639-652
    const ob = z.bear[j];
    if (!ob.breaker) { if (Math.max(b.o, b.c) > ob.top) { ob.breaker = true; ob.breakTime = b.t; ob.breakIndex = i; } }
    else if (b.c < ob.bottom) z.bear.splice(j, 1);
  }
  if (b.c < z.btm.y && !z.btm.crossed) { // L654-664
    z.btm.crossed = true;
    const box = obBox(B, i, z.btm.x, 'Bear');
    if (Math.abs(box.top - box.bottom) <= atr10[i] * I.maxATRMult) {
      z.bear.unshift({ ...box, type: 'Bear', breaker: false, breakTime: NaN, breakIndex: NaN });
      if (z.bear.length > I.maxOrderBlocks) z.bear.pop();
    }
  }
  if (i >= 2) { // L953-1011
    const f = fvgAt(B, i, atr10[i]);
    if (f) { z.fvgs.unshift(f); while (z.fvgs.length > I.showLastXFVGs) z.fvgs.pop(); }
  }
  for (const f of z.fvgs) { // L1014-1048
    if ((f.isBull && b.l <= f.max) || (!f.isBull && b.h >= f.min)) f.lastTouched = i;
    if (Number.isNaN(f.endBar)) {
      if (f.isBull && b.c < f.min) { f.endBar = i; f.endTime = b.t; f.isInverse = true; }
      if (!f.isBull && b.c > f.max) { f.endBar = i; f.endTime = b.t; f.isInverse = true; }
    }
  }
  z.fvgs = z.fvgs.filter((f) => !f.isInverse && i - f.lastTouched <= I.untouched); // L1051-1065 (IFVG 끔 → 끝난 것은 무효)
}

export const newGuide = (t) => ({ state: 'wait', startTime: t, dir: 0, fvg: null, ob: null, enterBar: NaN, entryTime: NaN, entryIndex: NaN, entryPrice: NaN, sl: NaN, tp: NaN, exitTime: NaN, exitIndex: NaN, exitPrice: NaN });
const exitAt = (g, kind, price, bar, i) => { g.exitPrice = price; g.exitTime = bar.t; g.exitIndex = i; g.state = kind; };

export function guideStep(st, { i, bar, allFVG, allOB, lo100, hi100, atrG }) {
  const I = TPSL_INPUT;
  if (!st.last || !Number.isNaN(st.last.exitPrice)) { st.last = newGuide(bar.t); st.guides.unshift(st.last); } // L1162-1171
  const g = st.last;
  if (g.state === 'wait') { // L1175-1189 — 반복을 멈추지 않아 뒤에 맞은 것이 덮는다
    for (const f of allFVG) for (const ob of allOB) {
      if (!ob.breaker || !((ob.type === 'Bear' && f.isBull) || (ob.type === 'Bull' && !f.isBull))) continue;
      if (bbFvgTouch(ob, f, bar.t) && (bar.t === f.startTime || bar.t === ob.breakTime)) {
        g.state = 'overlap'; g.dir = f.isBull ? 1 : -1; g.fvg = { ...f }; g.ob = { ...ob };
      }
    }
  }
  if (g.state === 'overlap') { g.state = 'enter'; g.enterBar = i; } // L1192-1195 (되돌림 요구 끔)
  if (g.state === 'enter' && i >= g.enterBar + I.entryWait) { // L1209-1237 (GUIDE 방식)
    g.state = 'taken'; g.entryTime = bar.t; g.entryIndex = i; g.entryPrice = bar.c;
    g.sl = g.dir > 0 ? lo100[i] - atrG[i] * I.slOffset : hi100[i] + atrG[i] * I.slOffset;
    g.tp = g.entryPrice + g.dir * Math.abs(g.entryPrice - g.sl) * I.rr;
  }
  if (g.state === 'taken' && bar.t > g.entryTime) { // L1266-1289: 익절 다음 손절(같은 봉이면 손절이 덮음)
    if (g.dir > 0 && bar.h >= g.tp) exitAt(g, 'tp', g.tp, bar, i);
    if (g.dir < 0 && bar.l <= g.tp) exitAt(g, 'tp', g.tp, bar, i);
    if (g.dir > 0 && bar.l <= g.sl) exitAt(g, 'sl', g.sl, bar, i);
    if (g.dir < 0 && bar.h >= g.sl) exitAt(g, 'sl', g.sl, bar, i);
  }
}

export function renderStep(st, { i, bar }) { // L1299-1311
  const g = st.last;
  if (!g) return;
  if (g.state === 'sl' && bar.t >= g.exitTime) { st.exits.push({ i, kind: 'sl', dir: g.dir }); g.state = 'done'; }
  if (g.state === 'tp') { st.exits.push({ i, kind: 'tp', dir: g.dir }); g.state = 'done'; }
}

export function guideSummary(guides) { // L1347-1367
  let total = 0, wins = 0, losses = 0;
  for (const g of guides) {
    if (Number.isNaN(g.entryPrice)) continue;
    let ok = false;
    if (!Number.isNaN(g.exitPrice)) {
      const d = Math.abs((Math.abs(g.entryPrice - g.exitPrice) / g.exitPrice) * 100); // diffPercent(entry, exit) — 나누는 값은 끝 가격
      if ((g.dir > 0 && g.exitPrice > g.entryPrice) || (g.dir < 0 && g.exitPrice < g.entryPrice)) { total += d; ok = true; } else total -= d;
    }
    if (ok) wins += 1; else losses += 1;
  }
  const entries = wins + losses;
  return { entries, wins, losses, winrate: entries ? (100 * wins) / entries : NaN, avg: entries ? total / entries : NaN, total };
}

export function fmtHash2(x) { // Pine "#.##"
  if (!Number.isFinite(x)) return '—';
  const r = (Math.sign(x) * Math.round(Math.abs(x) * 100)) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}
// L1369-1395 표(T-14). 총 진입 0이면 승률·평균만 '—'(원문 NaN%), 누적은 원문처럼 늘 `#.##` + '%'.
export const backtestRows = (s) => [['총 진입', String(s.entries)], ['승', String(s.wins)], ['패', String(s.losses)], ['승률', s.entries ? `${fmtHash2(s.winrate)}%` : '—'], ['평균 수익', s.entries ? `${fmtHash2(s.avg)}%` : '—'], ['누적 수익', `${fmtHash2(s.total)}%`]];

export function tpslGuide(B, { lastBarIndex = B.length - 1, closedUntil = B.length - 2 } = {}) {
  const I = TPSL_INPUT;
  const h = B.map((b) => b.h), l = B.map((b) => b.l);
  const base = { hi10: highest(h, I.swingLength), lo10: lowest(l, I.swingLength), atr10: pAtr(B, 10) };
  const lo100 = lowest(l, I.tpslLength), hi100 = highest(h, I.tpslLength), atrG = pAtr(B, 50); // L1150-1156
  const z = zonesInit();
  const st = { last: null, guides: [], exits: [] };
  const N = Math.min(B.length, closedUntil + 1);
  for (let i = 0; i < N; i += 1) {
    const inWin = i > lastBarIndex - I.window;
    zonesStep(z, B, i, { ...base, inWin });
    if (inWin) { // L1069-1073: 정리 목록(같은 봉 안에서 바뀌지 않으므로 원본을 읽고, GUIDE에 넣을 때만 복사)
      const allOB = [...z.bull.slice(0, I.obUse), ...z.bear.slice(0, I.obUse)];
      guideStep(st, { i, bar: B[i], allFVG: z.fvgs, allOB, lo100, hi100, atrG });
    }
    renderStep(st, { i, bar: B[i] });
  }
  const summary = guideSummary(st.guides);
  const g = st.last;
  const now = g && g.state === 'taken' ? (g.dir > 0 ? '롱 진행 중' : '숏 진행 중') : '대기';
  return { guides: st.guides, exits: st.exits, summary, lastBarIndex, legend: [{ key: 'tpsl', text: `TP/SL가이드 ${now}` }] };
}

const C = { buy: 'rgba(8,153,129,.5)', sell: 'rgba(242,54,70,.5)', fvgUp: 'rgba(8,153,129,.25)', fvgDn: 'rgba(242,54,70,.25)', bbBull: 'rgba(255,235,59,.25)', bbBear: 'rgba(41,98,255,.25)', bbBullLine: '#ffeb3b', bbBearLine: '#2962ff', red: '#f23645', blue: '#2196f3' };

export function tpslScene(res) { // L1416-1450 (최근 GUIDE 76개 — 원문 반복 0..75)
  const boxes = [], segs = [], labels = [];
  for (const g of res.guides.slice(0, TPSL_INPUT.maxGuide + 1)) {
    if (Number.isNaN(g.entryTime)) continue;
    const e = g.entryIndex;
    const end = Number.isFinite(g.exitIndex) ? g.exitIndex : res.lastBarIndex + 15; // time("", -15)
    if (g.ob) {
      const bull = g.ob.type === 'Bull'; // 매수 블록의 브레이커 = bearishBreakerBlockColor(#ffeb3b)
      boxes.push({ i1: g.ob.startIndex, i2: e, top: g.ob.top, bottom: g.ob.bottom, fill: bull ? C.bbBull : C.bbBear, text: '' });
      for (const y of [g.ob.top, g.ob.bottom]) segs.push({ i1: g.ob.startIndex, p1: y, i2: e, p2: y, color: bull ? C.bbBullLine : C.bbBearLine, width: 1, dash: [4, 4] });
    }
    if (g.fvg) boxes.push({ i1: g.fvg.startBar, i2: e, top: g.fvg.max, bottom: g.fvg.min, fill: g.fvg.isBull ? C.fvgUp : C.fvgDn, text: '' });
    for (const [price, color, text] of [[g.tp, C.buy, 'TP'], [g.sl, C.sell, 'SL']]) {
      segs.push({ i1: e, p1: g.entryPrice, i2: e, p2: price, color, width: 1, dash: [4, 4] });
      segs.push({ i1: e, p1: price, i2: end, p2: price, color, width: 1, dash: [4, 4] });
      labels.push({ i: end, price, text, bg: color, fg: '#ffffff', anchor: 'left' });
    }
  }
  return { boxes, segs, circles: [], labels };
}

export function tpslMarkers(res) {
  const out = [];
  for (const g of res.guides.slice(0, TPSL_INPUT.maxGuide + 1)) {
    if (Number.isNaN(g.entryTime)) continue;
    out.push(g.dir > 0 ? { i: g.entryIndex, position: 'belowBar', shape: 'arrowUp', color: C.buy, text: 'Buy' } : { i: g.entryIndex, position: 'aboveBar', shape: 'arrowDown', color: C.sell, text: 'Sell' }); // L1431-1434
  }
  for (const x of res.exits) { // L1313-1316 (xcross는 라이브러리에 없어 원)
    const below = x.kind === 'sl' ? x.dir > 0 : x.dir < 0;
    out.push({ i: x.i, position: below ? 'belowBar' : 'aboveBar', shape: 'circle', color: x.kind === 'sl' ? C.red : C.blue, text: x.kind.toUpperCase() });
  }
  return out.sort((a, b) => a.i - b.i);
}
