// 마커는 한 시리즈에 한 목록 — 내 체결 화살표 + TP/SL GUIDE Buy/Sell·끝 표시 + Delta ▲▼를 시각 순으로 합친다(spec §3.6)
export { mergeMarkers, toChartTime } from './chart-draw.js';
// 내 체결: N applyMarkers(chart:114)와 같은 화살표·금색·글자 없음·크기 0.7
export const fillArrows = (fills, side, barIndexOf) => fills.map((f) => ({ i: barIndexOf(f.at), position: side === 'long' ? 'belowBar' : 'aboveBar', shape: side === 'long' ? 'arrowUp' : 'arrowDown', color: '#f5a623', text: '', size: 0.7 })).filter((m) => m.i >= 0);
export const deltaMarks = (res) => [...res.up.map((i) => ({ i, position: 'belowBar', shape: 'arrowUp', color: '#12cef8', text: '' })), ...res.down.map((i) => ({ i, position: 'aboveBar', shape: 'arrowDown', color: '#fe3f00', text: '' }))];
