// 마커는 한 시리즈에 한 목록 — 내 매매 화살표 + TP/SL GUIDE Buy/Sell·끝 표시 + Delta ▲▼를 시각 순으로 합친다(spec §3.6)
export { mergeMarkers, toChartTime } from './chart-draw.js';
// 내 매매(chart-my-trades — 대표 결정 2026-10-19): 일반 거래소처럼 매수 체결 초록 ▲(봉 아래)·매도 체결 빨강 ▼(봉 위), 글자 없음·크기 0.7.
// 색 = 캔들 오름·내림(modes/trade.js CANDLE_OPTS) = 주문 칸 롱·숏(app.css .trade --t-good·--t-bad). AI 자동매매 마커(chart-position-overlay —
// 파랑 화살표 + 'N차'·동그라미 + 끝 낱말, 크기 1)와는 색·모양·글자·크기로, 델타(청록 ▲·주황 ▼, 크기 1)와는 크기로, TP/SL GUIDE(반투명 + Buy·Sell)와는
// 불투명·글자로 갈린다(계획 정한 것 13)
export const MY_MARK_SIZE = 0.7;
export const MY_MARK = Object.freeze({
  buy: Object.freeze({ position: 'belowBar', shape: 'arrowUp', color: '#3fb950' }),
  sell: Object.freeze({ position: 'aboveBar', shape: 'arrowDown', color: '#f85149' }),
});
export const myArrows = (list, barIndexOf) => (Array.isArray(list) ? list : [])
  .filter((m) => m && Object.hasOwn(MY_MARK, m.dir))
  .map((m) => ({ i: barIndexOf(m.at), ...MY_MARK[m.dir], text: '', size: MY_MARK_SIZE }))
  .filter((m) => m.i >= 0);
export const deltaMarks = (res) => [...res.up.map((i) => ({ i, position: 'belowBar', shape: 'arrowUp', color: '#12cef8', text: '' })), ...res.down.map((i) => ({ i, position: 'aboveBar', shape: 'arrowDown', color: '#fe3f00', text: '' }))];
