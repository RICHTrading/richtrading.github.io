// 트레이딩 탭 앱 연결 도우미(spec 4판 §2.1·§5.3·§5.6-2) — app.js가 쓰고 node에서 시험한다(검토 4·5·24).
export const memberManualOf = (snap) => (snap && snap.state && snap.state.manual) || null;            // 회원 송출 스냅샷 { state, events, hubDown }
export const instrumentsFor = (fetchInstruments, hub) => () => fetchInstruments(hub);                 // 배열 그대로(실패하면 던짐 — manual-exec가 캐시)
export const condFor = (config, member) => !!config.oxTpsl && (config.oxTpsl.cond === true || (config.oxTpsl.manualTestCond === true && !!member && member.test === true));
export const watchFor = (keys) => (symbol) => {                                                        // 따라가기가 꺼져 있어도 주문 시세가 들어오게
  if (!keys || typeof keys.ready !== 'function' || !keys.ready()) return;
  const c = keys.client();
  if (c && typeof c.watchTicker === 'function') c.watchTicker(`${symbol}-USDT-PERPETUAL`);
};
// 지금 가격(inst) = 이 기기 키 시세(오렌지엑스 WS) → 없으면 chart(inst)(차트 공개 시세) → null. 키는 부를 때 getKeys()로 읽는다.
// 서버 판 시트 크기 계산도 이것을 쓴다(2026-11-01 — 키 시세만 보면 5초 넘은 때 no_price) — 실행기가 자기 시세로 다시 셈(2% 넘게 다르면 changed)
const goodPx = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
export const livePriceFor = (getKeys, chart) => (inst) => {
  const keys = getKeys();
  const k = keys && typeof keys.ready === 'function' && keys.ready() ? goodPx(keys.client().price(inst)) : null;
  if (k !== null) return k;
  return typeof chart === 'function' ? goodPx(chart(inst)) : null;
};
