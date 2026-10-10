// 셸 → 사무실 실계좌 송출 중계(설계 3-2 §4.3·§4.5, 사무실 쪽 규약 lite-relay 계획 「결정·해석」 6 — test/fixtures/app-relay-contract.json).
// 회원 송출 스냅샷(member-feed)·실시간 이벤트를 사무실이 아는 모양으로만 옮긴다 — 정해진 키만 고르므로 인증 값·장부·체결 비중·
// 내부 이름·따라가기 상태는 들어가지 않는다. 보내기(post)는 office-shell이 한다(사무실이 준비됐는지·출처 검사).
//   ptf:relay-state = RelayState에 type만 더한 평평한 모양 — 준비되면 한 번, 그 뒤 바뀔 때 1초에 최대 1회(몰리면 마지막 것)
//   ptf:relay-event = 실시간(source 'stream')으로 받은 회원 이벤트·리허설만(재생분은 상태의 recent로만)
//   ptf:relay-link  = 바뀔 때 바로 + 30초마다(같은 값이어도 — 사무실이 셸이 멈춘 것을 120초 뒤 스스로 알게)
// updated(상태) = 그 상태를 만든 허브 시각(state.now), link의 updated = 허브와 마지막으로 연결이 확인된 허브 시각
//   (실시간 연결이면 지금 허브 시각, 폴링만 되는 브라우저면 loaded·hubDown 아님인 새 state.now — 폴링은 delayed지만 updated는 멈추지 않는다)
export const RELAY_STATE_MIN_MS = 1000;
export const RELAY_LINK_EVERY_MS = 30000;
export const RELAY_RECENT = 20;
export const RELAY_STATE_KEYS = Object.freeze(['type', 'v', 'test', 'updated', 'stale', 'autoOn', 'autoSymbols', 'open', 'recent']);
export const RELAY_OPEN_KEYS = Object.freeze(['id', 'symbol', 'side', 'lev', 'stage', 'maxStage', 'openedAt', 'avg', 'tp', 'sl', 'liq', 'tpPct', 'slPct', 'rehearsal']);
export const RELAY_EVENT_KEYS = Object.freeze(['seq', 'at', 'kind', 'id', 'symbol', 'side', 'lev', 'stage', 'maxStage', 'manual', 'price', 'avg', 'tp', 'sl', 'resultPct', 'late', 'rehearsal']);

const SYM = /^[A-Z0-9]{1,20}$/;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v : null);

export function relayOpen(o, rehearsal = false) {
  if (!isObj(o)) return null;
  return {
    id: str(o.id), symbol: str(o.symbol), side: str(o.side), lev: num(o.lev), stage: num(o.stage), maxStage: num(o.maxStage),
    openedAt: num(o.openedAt), avg: num(o.avg), tp: num(o.tp), sl: num(o.sl), liq: num(o.liq), tpPct: num(o.tpPct), slPct: num(o.slPct),
    rehearsal: rehearsal === true,
  };
}

export function relayEvent(e) {
  if (!isObj(e)) return null;
  return {
    seq: num(e.seq), at: num(e.at), kind: str(e.kind), id: str(e.id), symbol: str(e.symbol), side: str(e.side), lev: num(e.lev),
    stage: num(e.stage), maxStage: num(e.maxStage), manual: e.manual === true, price: num(e.price), avg: num(e.avg), tp: num(e.tp), sl: num(e.sl),
    resultPct: num(e.resultPct), late: e.late === true, rehearsal: e.rehearsal === true,
  };
}

const byTime = (a, b) => ((a.at ?? 0) - (b.at ?? 0)) || ((a.seq ?? 0) - (b.seq ?? 0));

export function relayState(snap) {
  if (!isObj(snap) || snap.member !== true || !isObj(snap.state)) return null;
  const s = snap.state;
  const feed = isObj(s.feed) ? s.feed : {};
  const rh = isObj(s.rehearsal) ? s.rehearsal : null;
  const open = [
    ...(Array.isArray(s.open) ? s.open : []).map((o) => relayOpen(o, false)),
    ...(rh && Array.isArray(rh.open) ? rh.open : []).map((o) => relayOpen(o, true)),
  ].filter(Boolean);
  const recent = [
    ...(Array.isArray(snap.events) ? snap.events : []).map(relayEvent),
    ...(Array.isArray(snap.rehearsal) ? snap.rehearsal : []).map((r) => (isObj(r) ? relayEvent({ ...r, rehearsal: true }) : null)),
  ].filter(Boolean).sort(byTime).slice(-RELAY_RECENT);
  return {
    type: 'ptf:relay-state',
    v: 1,
    test: isObj(s.me) && s.me.test === true,
    updated: num(s.now) ?? num(feed.updated),
    stale: feed.stale === true || feed.degraded === true,
    autoOn: feed.autoOn === true,
    autoSymbols: (Array.isArray(feed.autoSymbols) ? feed.autoSymbols : []).filter((x) => typeof x === 'string' && SYM.test(x)),
    open,
    recent,
  };
}

export function relayLink(snap) {
  if (isObj(snap) && snap.hubDown === true) return 'down';
  if (isObj(snap) && snap.streaming === true) return 'live';
  return 'delayed';
}

export function createOfficeRelay({ post, now = () => Date.now(), timers = globalThis }) {
  let active = false;
  let snap = null;
  let lastNow = null; // 마지막으로 본 상태의 허브 시각 — 같은 상태가 다시 오면 시계 차이를 다시 재지 않는다
  let offset = 0; // 허브 시계 − 기기 시계
  let confirmedAt = null; // 허브와 연결이 마지막으로 확인된 허브 시각
  let lastLink = null;
  let lastStateKey = null;
  let lastStateAt = -Infinity;
  let stateTimer = null;
  let linkTimer = null;
  const seenRehearsal = new Set();
  const rKey = (r) => `${r.id}|${r.kind}|${r.rseq}`;

  // 리허설은 스냅샷 목록(member-feed가 모은 최근 20건)으로만 온다 — 처음 보는 것 중 실시간(stream)인 것만 이벤트로
  function markRehearsal(forward) {
    for (const r of isObj(snap) && Array.isArray(snap.rehearsal) ? snap.rehearsal : []) {
      if (!isObj(r)) continue;
      const k = rKey(r);
      if (seenRehearsal.has(k)) continue;
      seenRehearsal.add(k);
      if (forward && r.source === 'stream') {
        const e = relayEvent({ ...r, rehearsal: true });
        if (e) post({ type: 'ptf:relay-event', v: 1, event: e });
      }
    }
  }

  function sendLink(force) {
    const l = relayLink(snap);
    if (l === 'live') confirmedAt = now() + offset;
    if (!force && l === lastLink) return;
    lastLink = l;
    post({ type: 'ptf:relay-link', v: 1, link: l, updated: confirmedAt });
  }

  function sendState() {
    stateTimer = null;
    if (!active) return;
    const rs = relayState(snap);
    if (!rs) return;
    const key = JSON.stringify(rs);
    if (key === lastStateKey) return;
    lastStateKey = key;
    lastStateAt = now();
    post(rs);
  }

  function scheduleState() {
    if (!active || stateTimer != null) return;
    const wait = lastStateAt + RELAY_STATE_MIN_MS - now();
    if (wait <= 0) sendState();
    else stateTimer = timers.setTimeout(sendState, wait);
  }

  function stop() {
    active = false;
    if (stateTimer != null) {
      timers.clearTimeout(stateTimer);
      stateTimer = null;
    }
    if (linkTimer != null) {
      timers.clearInterval(linkTimer);
      linkTimer = null;
    }
  }

  return {
    // 회원 송출 스냅샷(공개 송출이면 null) — 준비 전에도 기억해 둔다(준비되면 바로 보내게)
    update(s) {
      snap = isObj(s) && s.member === true ? s : null;
      const hubNow = snap && isObj(snap.state) ? num(snap.state.now) : null;
      if (hubNow != null && hubNow !== lastNow) {
        lastNow = hubNow;
        offset = hubNow - now();
        // 새 허브 상태를 제대로 받았다 = 그 시각에 연결이 확인됨(폴링만 되는 브라우저도 — 실시간 연결이 없어도 updated가 멈추지 않게)
        if (snap.loaded === true && snap.hubDown !== true) confirmedAt = hubNow;
      }
      markRehearsal(active);
      if (!active) return;
      sendLink(false);
      scheduleState();
    },
    event(ev) {
      if (!active || !isObj(ev) || ev.source !== 'stream') return;
      const e = relayEvent(ev);
      if (e) post({ type: 'ptf:relay-event', v: 1, event: e });
    },
    // 사무실 준비(office-shell: 출처·창·경로 통과) — 중계로 떴고(relay) 중계 가능한 사무실(capable)일 때만 시작
    ready(info) {
      stop();
      if (!isObj(info) || info.relay !== true || info.capable !== true || info.pathOk !== true) return;
      active = true;
      markRehearsal(false);
      lastStateKey = null;
      lastStateAt = -Infinity;
      lastLink = null;
      sendState();
      sendLink(true);
      linkTimer = timers.setInterval(() => sendLink(true), RELAY_LINK_EVERY_MS);
    },
    stop,
    active: () => active,
  };
}
