// 따라가기 판단(설계 3-2 §6.3·§6.6·§6.8·§6.10·§6.11) — 순수 함수만. 실행 조건 G1~G8, 종류별 동작 표, 시각 조건, 종료 판정, 회원이 바꾼 포지션,
// 주문 상태 철자, 시간당 주문·보호 주문 교체 한도. 거래소·허브·저장소는 모른다(follow-exec·follow-engine이 부른다).
// p34(대표 결정 2026-10-08): 하루 손실 한도(옛 G6 daily)는 없앴다 — 동업자판에 없음. 시간당 30건은 앱 버그 반복 막기라 남긴다(위험 증가만 막음).
export const CORE = Object.freeze({
  validMarginMs: 2000, // validUntil − 2초까지만(§6.6)
  maxAgeMs: 15000, // 허브 시각으로 신호 t에서 15초까지만(§6.6)
  followFreshMs: 45000, // 마지막 event: follow가 45초 안(G3)
  leaseFreshMs: 45000, // 임대 갱신 성공이 45초 안(G2)
  lateCloseMs: 86400000, // 다시 열었을 때 ②는 신호 종료 뒤 24시간 안이면 바로 정리(§6.6)
  hourlyMax: 30, // 시간당 주문 30건(보호 주문 교체·자동 손절도 세지만 막는 것은 위험 증가만, G6)
  hourMs: 3600000,
  posTol: 0.05, // 거래소 포지션이 장부 수량 ±5% 밖이면 회원이 바꾼 것(§6.10)
  syncPer10m: 2, // 보호 주문 교체 10분 2번·하루 10번(§6.9)
  syncPerDay: 10,
  maxFills: 100, // 3-1 체결 수 상한
});
export const END_KINDS = Object.freeze(['tp', 'sl', 'close', 'liq']);
export const LOST_KINDS = Object.freeze(['untracked', 'lost']);
export const ORDER_KINDS = Object.freeze(['entry', 'dca', 'adjust']);

// 시각 조건(§6.6): 허브 시각(휴대폰 시각 + hubOffset)으로 validUntil − 2초·ev.t + 15초 안. 표본이 없으면 하지 않는다(G8)
export function timeCheck(ev, { now, offset }) {
  if (!Number.isFinite(offset)) return 'no_clock';
  const hubNow = now + offset;
  if (!Number.isFinite(ev.validUntil) || hubNow > ev.validUntil - CORE.validMarginMs) return 'late';
  if (!Number.isFinite(ev.t) || hubNow - ev.t > CORE.maxAgeMs) return 'late';
  return null;
}
// 시트 남은 시간(휴대폰 시각) — timeCheck의 두 조건(validUntil − 2초, ev.t + 15초) 중 이른 쪽을 허브 시각에서 휴대폰 시각으로.
// 남은 시간·만료 줄·막힌 버튼·누를 때 주문 판정이 같은 시각을 쓴다(검토 2026-10-08 — 전에는 15초 뒤 눌러도 버튼이 살아 있다가 놓친 신호가 됨). 모르면 null
export function deviceDeadline(ev, offset) {
  if (!ev || !Number.isFinite(ev.validUntil) || !Number.isFinite(ev.t)) return null;
  return Math.min(ev.validUntil - CORE.validMarginMs, ev.t + CORE.maxAgeMs) - offset;
}

// G3(§6.3): 실시간 연결이 열려 있고(event: live 다음에 받은 follow — source 'stream'), 마지막 event: follow가 45초 안이며 enabled:true
export function followLive(follow, now) {
  if (!follow || typeof follow !== 'object' || follow.source !== 'stream' || !Number.isFinite(follow.receivedAt)) return { ok: false, why: 'server' };
  if (now - follow.receivedAt > CORE.followFreshMs) return { ok: false, why: 'server' };
  if (follow.enabled !== true) return { ok: false, why: typeof follow.reason === 'string' && follow.reason ? follow.reason : 'off' };
  return { ok: true, why: null, shadow: follow.shadow === true };
}

// 실행 조건 G1~G8(§6.3) — 위험을 늘리는 주문 하나마다. 처음 걸린 조건을 돌려준다(없으면 null)
// g = { member, on, lease, live(followLive 결과), visible, lock, keys, hourly, inst, clock }
export function gateIncrease(g) {
  if (!g.member) return { gate: 'G1', why: 'member' };
  if (!g.on) return { gate: 'G2', why: 'off' };
  if (!g.lease) return { gate: 'G2', why: 'lease' };
  if (!g.live || !g.live.ok) return { gate: 'G3', why: g.live ? g.live.why : 'server' };
  if (!g.visible) return { gate: 'G4', why: 'hidden' };
  if (!g.lock) return { gate: 'G4', why: 'lock' };
  if (!g.keys) return { gate: 'G5', why: 'keys' };
  if (!g.hourly) return { gate: 'G6', why: 'rate' };
  if (!g.inst) return { gate: 'G7', why: 'inst' };
  if (!g.clock) return { gate: 'G8', why: 'clock' };
  return null;
}
// 종료·취소(위험을 줄임): G4·G5만 + 회원 토큰 또는 정리 유예 토큰(§6.3 표 아래). G4에는 같은 브라우저 탭 잠금도 든다 —
// 잠금을 못 잡은 탭(lock: false)은 같은 기기 장부를 읽기만 한다(두 탭이 같은 매매를 닫거나 장부를 덮어쓰지 않게)
export function gateReduce(g) {
  if (!g.member && !g.grace) return { gate: 'G1', why: 'member' };
  if (!g.visible) return { gate: 'G4', why: 'hidden' };
  if (g.lock === false) return { gate: 'G4', why: 'lock' };
  if (!g.keys) return { gate: 'G5', why: 'keys' };
  return null;
}

// 종류별 동작 표(§6.6). ctx = { mode: 'auto'|'tap', trade(장부의 그 매매|null), symbols, openCount, maxConcurrent, frozen }
// → { act: 'auto'|'sheet'|'missed'|'skip'|'end'|'detach'|'ignore', reason? }
export function decide(ev, { mode, trade = null, symbols = [], openCount = 0, maxConcurrent = 3, frozen = false } = {}) {
  if (!ev || typeof ev !== 'object') return { act: 'ignore' };
  const k = ev.kind;
  const live = trade && trade.state === 'open';
  if (ORDER_KINDS.includes(k)) {
    if (k !== 'entry' && !live) return { act: 'ignore' }; // 1차를 따라가지 않은 매매는 추가 진입도 따라가지 않는다
    if (k === 'entry' && trade) return { act: 'ignore' }; // 같은 매매를 두 번 열지 않는다
    if (k === 'entry' && !symbols.includes(ev.symbol)) return { act: 'skip', reason: 'not_allowed' };
    if (ev.source !== 'stream' || ev.late === true) return { act: 'missed', reason: 'late' };
    if (k !== 'entry' && frozen) return { act: 'ignore' }; // 열린 신호가 일시 고정이면 추가 진입·조정 안 함
    if (k === 'entry') {
      if (ev.manual === true) return { act: 'sheet', reason: 'manual_signal' };
      if (openCount >= maxConcurrent) return { act: 'skip', reason: 'max_concurrent' };
      return { act: mode === 'auto' ? 'auto' : 'sheet' };
    }
    if (k === 'dca') {
      if (trade.fills.length >= CORE.maxFills) return { act: 'ignore' };
      if (trade.tpslNotSynced) return { act: 'skip', reason: 'tpsl_not_synced' };
      if (ev.manual === true) return { act: 'sheet', reason: 'manual_signal' };
    }
    return { act: mode === 'auto' ? 'auto' : 'sheet' };
  }
  if (END_KINDS.includes(k)) return live ? { act: 'end' } : { act: 'ignore' };
  if (LOST_KINDS.includes(k)) return live ? { act: 'detach', reason: 'signal_lost' } : { act: 'ignore' };
  return { act: 'ignore' };
}

// 종료 판정의 전제(§6.6·§6.11): 회원 상태 feed가 recovered·stale·degraded·partner 다운이면 판정 자체를 하지 않음(hold),
// 장부의 epoch와 다르면(허브 상태 새로 만듦) 'epoch'
export function feedHealth(state, epoch = null) {
  const f = state && typeof state === 'object' ? state.feed : null;
  if (!f || typeof f !== 'object') return 'hold';
  if (f.recovered === true || f.stale === true || f.degraded === true || !(f.partner && f.partner.up === true)) return 'hold';
  if (epoch && f.epoch !== epoch) return 'epoch';
  return 'ok';
}

// 종료 판정(§6.6): 그 id의 끝 이벤트를 실제로 받았을 때만 'ended'. open[]에서 사라진 것만으로는 아무 주문도 하지 않는다 →
// open[]에도 ended[]에도 없으면 'unclear'(시트로 묻기). 리허설 장부는 state.rehearsal.open·ended와 리허설 이벤트로만,
// 실제 장부는 state.open·ended와 회원 이벤트로만 본다(서로의 목록을 보지 않음).
// endedIds: 이 실행에서 받은 끝 이벤트 id 집합(실제·리허설 따로 넘긴다)
// stateAt: 그 회원 상태를 받은 이 기기 시각 — 그 뒤에 연 매매(trade.openedAt, 같은 기기 시계)는 그 상태의 open[]에 아직 없을 수 있으므로
// 끝을 판단하지 않는다('hold' — 다음 상태를 기다림, p34 종단 확인: 30초마다 받는 상태가 실시간 entry보다 늦어 unclear로 잘못 바뀌던 것)
const before = (trade, stateAt) => Number.isFinite(stateAt) && Number.isFinite(trade.openedAt) && trade.openedAt > stateAt;
export function endVerdict(trade, { state, endedIds = new Set(), stateAt = null }) {
  if (!state || typeof state !== 'object') return 'hold';
  if (trade.rehearsal) {
    const r = state.rehearsal;
    if (!r || typeof r !== 'object') return 'hold';
    if (endedIds.has(trade.id) || (Array.isArray(r.ended) && r.ended.some((e) => e && e.id === trade.id))) return 'ended';
    if (Array.isArray(r.open) && r.open.some((o) => o && o.id === trade.id)) return 'open';
    return before(trade, stateAt) ? 'hold' : 'unclear';
  }
  const h = feedHealth(state, trade.epoch);
  if (h === 'hold') return 'hold';
  if (h === 'epoch') return 'unclear';
  if (endedIds.has(trade.id) || (Array.isArray(state.ended) && state.ended.some((e) => e && e.id === trade.id))) return 'ended';
  if (Array.isArray(state.open) && state.open.some((o) => o && o.id === trade.id)) return 'open';
  return before(trade, stateAt) ? 'hold' : 'unclear';
}
// 끝난 시각(허브 ms) — 늦은 정리 판단용. 받은 끝 이벤트 → ended[] 순
export function endedAt(trade, { state, endEvents = new Map() }) {
  const e = endEvents.get(trade.id);
  if (e && Number.isFinite(e.at)) return e.at;
  const list = trade.rehearsal ? state && state.rehearsal && state.rehearsal.ended : state && state.ended;
  const hit = Array.isArray(list) ? list.find((x) => x && x.id === trade.id) : null;
  return hit && Number.isFinite(hit.at) ? hit.at : null;
}
// 다시 열었을 때의 종료(§6.6): ②이고 신호 종료 뒤 24시간 안이면 바로 정리(late_close), 그 밖(24시간 넘음·③·시각 모름)은 시트
export function lateCloseMode({ mode, endAt, hubNow }) {
  return mode === 'auto' && Number.isFinite(endAt) && Number.isFinite(hubNow) && hubNow - endAt <= CORE.lateCloseMs ? 'auto' : 'sheet';
}

// 회원이 직접 바꾼 포지션(§6.10): pos = { size(부호 있음), avg } | null. 없으면 'gone'(거래소 익절·손절·청산으로 끝남 → closed),
// 방향이 다르거나 크기가 ±5% 밖이면 'detached'
export function positionVerdict(trade, pos) {
  if (!pos || !Number.isFinite(pos.size) || pos.size === 0) return 'gone';
  const want = trade.side === 'long' ? 1 : -1;
  if (Math.sign(pos.size) !== want) return 'detached';
  if (!(trade.size > 0) || Math.abs(Math.abs(pos.size) - trade.size) / trade.size > CORE.posTol) return 'detached';
  return 'ok';
}

// 주문 상태(§6.8): 소문자로 — filled / cancelled·canceled·rejected(체결분 있으면 partial) / open / 그 밖 unknown
export function orderStateOf(o) {
  const s = String(o && o.order_state != null ? o.order_state : '').toLowerCase();
  const filled = Number(o && o.filled_amount);
  if (s === 'filled') return 'filled';
  if (s === 'cancelled' || s === 'canceled' || s === 'rejected') return filled > 0 ? 'partial' : 'failed';
  if (s === 'open') return 'open';
  return 'unknown';
}

// 시간당 주문 30건(보호 주문 교체·자동 손절 포함해 센다 — 막는 것은 gateIncrease의 위험 증가만) — times = 보낸 시각들
export const hourlyCount = (times, now) => times.filter((t) => now - t < CORE.hourMs).length;
export const hourlyOk = (times, now) => hourlyCount(times, now) < CORE.hourlyMax;
// 보호 주문 교체(§6.9): 그 매매에서 10분에 2번·하루 10번까지
export function syncAllowed(syncs, now) {
  const list = Array.isArray(syncs) ? syncs : [];
  return list.filter((t) => now - t < 600000).length < CORE.syncPer10m && list.filter((t) => now - t < 86400000).length < CORE.syncPerDay;
}
