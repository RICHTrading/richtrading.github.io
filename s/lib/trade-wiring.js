// 트레이딩 탭 앱 연결 도우미(spec 4판 §2.1·§5.3·§5.6-2) — app.js가 쓰고 node에서 시험한다(검토 4·5·24).
export const memberManualOf = (snap) => (snap && snap.state && snap.state.manual) || null;            // 회원 송출 스냅샷 { state, events, hubDown }
export const instrumentsFor = (fetchInstruments, hub) => () => fetchInstruments(hub);                 // 배열 그대로(실패하면 던짐 — manual-exec가 캐시)
export const condFor = (config, member) => !!config.oxTpsl && (config.oxTpsl.cond === true || (config.oxTpsl.manualTestCond === true && !!member && member.test === true));
export const watchFor = (keys) => (symbol) => {                                                        // 따라가기가 꺼져 있어도 주문 시세가 들어오게
  if (!keys || typeof keys.ready !== 'function' || !keys.ready()) return;
  const c = keys.client();
  if (c && typeof c.watchTicker === 'function') c.watchTicker(`${symbol}-USDT-PERPETUAL`);
};
