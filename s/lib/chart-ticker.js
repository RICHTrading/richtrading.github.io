// 차트 전용 오렌지엑스 공개 WS(spec §3.3) — ticker.<inst>.raw만. 새 연결 120초에 1번 이하(3-3 ox-client 15초 = 분당 4회와 합쳐 4.5회·동시 2개 — 문서 한도 분당 5회).
// 열기에 실패하면 120초 뒤 다시 시도한다(시도 길이 끊기지 않게). 주문 계산 시세는 이것이 아니라 ox-client.price()(5초 신선도)를 쓴다.
// onDown: 열기 실패·열린 연결이 끊김(거래소가 닫음·핑 시간 초과) — 화면이 옛 가격을 '실시간' 아래 두지 않게(스스로 stop은 알리지 않음)
import { createOxWs } from './ox-ws.js';
export const CHART_WS_GAP_MS = 120000;
const ch = (inst) => `ticker.${inst}.raw`;

export function createChartTicker({ url, WebSocketImpl = globalThis.WebSocket, timers = globalThis, now = () => Date.now(), onPrice = () => {}, onDown = () => {}, minGapMs = CHART_WS_GAP_MS }) {
  let ws = null;
  let inst = null;
  let active = false;
  let retry = null;
  function notify(params) {
    if (!inst || !params || params.channel !== ch(inst)) return;
    const px = Number(params.data && params.data.last_price);
    if (px > 0) onPrice(inst, px);
  }
  function down() {
    try { onDown(); } catch { /* 화면 쪽 실패가 다시 연결을 막지 않게 */ }
  }
  function later() {
    if (!active || retry != null) return;
    retry = timers.setTimeout(() => { retry = null; connect(); }, minGapMs);
  }
  async function connect() {
    if (!active) return;
    if (!ws) ws = createOxWs({ url, WebSocketImpl, timers, now, minGapMs, onNotify: notify, onClose: () => { down(); if (active) later(); } });
    let ok = false;
    try { ok = await ws.open(); } catch { ok = false; }
    if (!ok) { if (active) down(); later(); return; }
    if (active && inst) await ws.subscribe([ch(inst)]);
  }
  function watch(next) {
    if (next === inst) return;
    const prev = inst;
    inst = next;
    if (ws && ws.isOpen()) {
      if (prev) ws.request('/public/unsubscribe', { channels: [ch(prev)] });
      if (next) ws.subscribe([ch(next)]);
    }
  }
  function start() { active = true; connect(); }
  function stop() { active = false; if (retry != null) { timers.clearTimeout(retry); retry = null; } if (ws) ws.close(); }
  return { start, stop, watch };
}
