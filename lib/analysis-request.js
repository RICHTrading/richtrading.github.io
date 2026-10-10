// 요청 분석 전달(p35 §2.11 — B안, 대표 결정 2026-10-08-1). 수호·준현판(config.analysisRequest)만 만든다 — 공용판은 받지도 보내지도 않는다.
// 사무실 ptf:analysis-request {v:1, req, symbol} → 허브 POST /v1/analysis/request(토큰 없음 — 공개 경로, 8초 제한) → 대기·실행이면 4초마다
// GET /v1/analysis/request/<표>(앱이 숨으면 멈추고 다시 보이면 이어감, 최대 12분) → 끝나면 GET /v1/analysis/item/<id> → 사무실에
// ptf:analysis-result(사무실이 보낸 req·symbol을 그대로 — 상태가 바뀔 때마다). 분석을 실제로 돌리는 것은 이 PC 스케줄러 하나다
// (허브가 대기열에 넣고 스케줄러가 가져감) — 셸은 묻고 기다리고 알릴 뿐이다.
//   · 이 기기에서 진행 중인 요청이 있으면: 같은 종목 → 지금 상태를 새 req로 다시, 다른 종목 → busy·pending(허브 요청 없음)
//   · 허브 POST 실패(연결·시간 초과·5xx·모양 틀림) → unavailable·hub_down + 셸이 가진 최신 분석, 429(IP 분당 제한) → limited·ip
//   · 상태 404(허브가 다시 켜져 표가 사라짐)·잇단 실패 5번 → failed·lost, 상태 429(퍼널 IP 분당 제한)는 세지 않고 15초 쉼,
//     12분 상한 → 한 번 더 물어 끝났으면 그 결과, 아니면 마지막이 queued면 expired·running이면 timeout(숨은 채 넘겨도 다시 보일 때 한 번 묻는다)
//   · 사무실 iframe load·unready(officeGone) → 옛 창으로의 전달만 끊는다(허브 표는 그대로 — 새 창에서 같은 종목을 누르면 그 표에 다시 붙음).
//     끝 상태의 item을 받는 중이면 새 창에는 아무것도 먼저 보내지 않는다 — 분석을 실은 결과 하나만(진행 상태 queued·running만 다시 보냄)
//   · 분석 하나: 셸이 가진 최신 분석이 같은 id면 그것(요청 없음). 첫 결과(POST 답)는 사무실 12초 안 — item 시간 제한을 남은 시간으로,
//     상태 받기 뒤(done)는 4초 간격 세 번까지
// 요청자 구분 값 dev는 kv.reqDev(UID 인증용 kv.device와 다른 임의값 — 허브가 요청과 UID를 잇지 못하게, §2.5). 메모리 저장소면 실행마다 새 값.
// app.js가 저장소를 연 뒤 미리 한 번 만든다(첫 누름이 저장소를 기다리지 않게 — 동시에 불러도 한 값)
// p37 실시간 직원 말(§3.4, config.analysisLive 판 — 수호·준현): 이 요청의 마지막 공개 상태가 running이면 다음 받기부터 상태 GET 대신
//   3초마다 GET …/request/<표>/turns?after=<받은 n>(응답의 status는 상태 GET과 같이 처리). 새 직원 말 → ptf:analysis-turns {live:'on'}
//   (한 응답의 새 말을 한 메시지에 차례대로), 허브 aborted → {live:'aborted', stop} 한 번, 말을 보낸 뒤 off → {aborted, stop:'cut'} 한 번 —
//   그 요청의 실시간은 끝(상태 GET으로 되돌아가고 끝 결과는 지금처럼). turns 404 → 옛 허브로 보고 바로 상태 GET(그 404면 lost),
//   400·5xx·모양 틀림은 상태 GET 실패와 같은 셈, 429는 15초 쉼, 숨으면 멈춤. 같은 종목 다시 누름(새 창)이면 받은 말을 새 req로 한 번 더
import { ANALYSIS_ID } from './analysis-shape.js';
import { parseTurnsResp, turnsMessage, REQ_LIVE_POLL_MS } from './analysis-live.js';

export const REQUEST_RE = /^[A-Z0-9]{1,20}$/;
export const REQ_MAX = 1e9;
export const REQ_POLL_MS = 4000;
export const REQ_MAX_WAIT_MS = 12 * 60000;
export const REQ_LOST_FAILS = 5; // 상태 받기가 이어 실패하면(약 20초) 잃은 것으로
export const REQ_RATE_WAIT_MS = 15000; // 상태 받기 429 — 표는 그대로라 세지 않고 쉬었다 다시(허브 창 60초 안에 몇 번만)
export const REQ_FIRST_MS = 11000; // 첫 결과(POST 답 + item)는 사무실 첫 결과 대기 12초(§2.12) 안 — 1초 여유
export const REQ_ITEM_TRIES = 3; // 상태 받기 뒤 끝난 분석(done) 받기 — 사무실은 첫 결과 뒤 13분까지 기다린다
const ITEM_MS = 5000;
const ITEM_MIN_MS = 1000;
export const TICKET_RE = /^t[0-9a-f]{16}$/;
export const DEV_RE = /^d[0-9a-f]{16}$/;

// §7.1 허브 ↔ 앱(허브 계약 test/fixtures/analysis-contract.mjs REQUEST_*와 같은 값 — 통합 시험이 비교)
export const REQUEST_KEYS = Object.freeze(['ok', 'v', 'state', 'ticket', 'symbol', 'ahead', 'etaSec', 'elapsedSec', 'id', 'reason']);
export const REQ_STATES = Object.freeze(['ready', 'queued', 'running', 'done', 'failed', 'unsupported', 'limited', 'unavailable']);
export const REQ_REASONS = Object.freeze({
  ready: ['fresh', 'regular', 'position_open'],
  limited: ['hour', 'day', 'ip', 'device', 'queue'],
  unavailable: ['off', 'sched_down', 'app_down'],
  failed: ['analysis_failed', 'no_report', 'timeout', 'expired', 'not_exported', 'rejected', 'app_down', 'position_open'],
  unsupported: ['symbol'], queued: [null], running: [null], done: [null],
});
// §7.2 셸 ↔ 사무실 — 셸이 만드는 이유(lost·hub_down·셸 12분의 expired·timeout)와 busy·pending을 더함
export const RESULT_KEYS = Object.freeze(['type', 'v', 'req', 'symbol', 'state', 'ahead', 'etaSec', 'elapsedSec', 'reason', 'analysis']);
export const RESULT_STATES = Object.freeze([...REQ_STATES, 'busy']);
export const RESULT_REASONS = Object.freeze({
  ...REQ_REASONS,
  failed: [...REQ_REASONS.failed, 'lost'],
  unavailable: [...REQ_REASONS.unavailable, 'hub_down'],
  busy: ['pending'],
});

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

// 사무실 → 셸 요청 메시지 형식 검사(§7.2 toShell.analysisRequest) — 맞으면 { req, symbol }, 아니면 null(버림)
export function parseAnalysisRequest(d) {
  if (!isObj(d) || d.type !== 'ptf:analysis-request' || d.v !== 1) return null;
  return cleanReq(d);
}

function cleanReq(d) {
  if (!isObj(d) || !Number.isInteger(d.req) || d.req < 1 || d.req > REQ_MAX) return null;
  if (typeof d.symbol !== 'string' || !REQUEST_RE.test(d.symbol)) return null;
  return { req: d.req, symbol: d.symbol };
}

// 허브 응답(§7.1) 모양 검사 — 맞으면 계약 칸만 새로 만든 값, 아니면 null(받는 쪽이 실패로 다룸)
export function parseRequestResp(b) {
  if (!isObj(b) || b.ok !== true || b.v !== 1 || !REQ_STATES.includes(b.state)) return null;
  const reason = b.reason === undefined ? null : b.reason;
  if (!REQ_REASONS[b.state].includes(reason)) return null;
  if (b.ticket != null && (typeof b.ticket !== 'string' || !TICKET_RE.test(b.ticket))) return null;
  if (b.id != null && (typeof b.id !== 'string' || !ANALYSIS_ID.test(b.id))) return null;
  return {
    state: b.state,
    ticket: b.ticket || null,
    symbol: typeof b.symbol === 'string' && REQUEST_RE.test(b.symbol) ? b.symbol : null,
    ahead: count(b.ahead),
    etaSec: count(b.etaSec),
    elapsedSec: count(b.elapsedSec),
    id: b.id || null,
    reason,
  };
}

// p37 turns 응답의 status 칸(§3.3 — GET /v1/analysis/request/<표>와 같은 객체): REQUEST_KEYS 정확히 + parseRequestResp
export function parseStatusExact(b) {
  return exactKeys(b, REQUEST_KEYS) ? parseRequestResp(b) : null;
}

function newDev(cryptoImpl) {
  const b = new Uint8Array(8);
  cryptoImpl.getRandomValues(b);
  return `d${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// hub: { request(body) → {status, body}|null, status(ticket) → {status, body}|null, item(id) → Analysis|null,
//        turns(ticket, after) → {status, body}|null — p37, 없으면 실시간 없음 } (app/lib/hub.js)
// feed: 최신 분석 받기(analysis-feed — current().analysis·refreshSoon()), post: 사무실로 보내기(office-shell.post — 준비된 창에만)
export function createAnalysisRequests({ config, hub, vault = null, feed = null, post, timers = globalThis, now = () => Date.now(), cryptoImpl = globalThis.crypto }) {
  // 수호·준현판만(대표 결정 1) — 공용판에 값이 잘못 와도 요청하지 않는다(빌드 검사 다음의 한 겹)
  const on = !!config && config.analysisRequest === true && config.edition !== 'pub';
  // p37 실시간 직원 말 — 판의 office.analysis_live(config.analysisLive)이고 허브 turns 받기가 있을 때만
  const live = on && config.analysisLive === true && !!hub && typeof hub.turns === 'function';
  // 진행 중 요청 { symbol, sub: {req, symbol}|null, ticket, last: 공개 상태 값, startedAt, timer, busy, fails, sentKey,
  //   liveNext: 받은 가장 큰 n, liveTurns: 받은 직원 말(새 창 다시 보내기용), liveDead: 이 요청의 실시간 끝(멈춤·꺼짐·옛 허브) }
  let active = null;
  let visible = true;
  let devP = null;

  async function loadDev() {
    let v;
    try {
      v = vault ? await vault.get('reqDev') : undefined;
    } catch {
      v = undefined;
    }
    if (typeof v === 'string' && DEV_RE.test(v)) return v;
    const d = newDev(cryptoImpl);
    try {
      if (vault) await vault.set('reqDev', d);
    } catch {
      // 저장이 안 되면 이번 실행 동안만
    }
    return d;
  }

  // 한 번만 만든다 — 미리 부르기(app.js)와 첫 요청이 겹쳐도 같은 값
  function devId() {
    if (!devP) devP = loadDev();
    return devP;
  }

  function fallback() {
    try {
      const v = feed ? feed.current() : null;
      return (v && v.analysis) || null;
    } catch {
      return null;
    }
  }

  // 셸이 가진 최신 분석이 그 id면 그것(허브 요청 없음 — done 분석은 모두의 최신, 정규 종목·30분 안 다시 누름도 흔히 최신)
  function ownAnalysis(id) {
    try {
      const v = feed ? feed.current() : null;
      return v && v.analysis && v.analysis.id === id ? v.analysis : null;
    } catch {
      return null;
    }
  }

  const wait = (ms) => new Promise((res) => { timers.setTimeout(res, ms); });

  // 분석 하나(ready·done·limited·unavailable의 id). first = POST 답(첫 결과 — 사무실 12초 안에 맞춰 한 번, 시간 제한을 남은 시간으로),
  // 아니면 상태 받기 뒤(done — 4초 간격 세 번까지, 사이에 최신 분석 받기). 못 받으면 null
  async function analysisFor(a, id, first) {
    const mine = ownAnalysis(id);
    if (mine) return mine;
    const tries = first ? 1 : REQ_ITEM_TRIES;
    for (let i = 0; i < tries; i += 1) {
      if (i > 0) {
        try {
          if (feed) feed.refreshSoon();
        } catch {
          // 최신 분석 받기 실패는 다음 item 받기와 무관
        }
        await wait(REQ_POLL_MS);
        if (active !== a) return null;
        const got = ownAnalysis(id);
        if (got) return got;
      }
      const timeoutMs = first ? Math.max(ITEM_MIN_MS, Math.min(ITEM_MS, REQ_FIRST_MS - (now() - a.startedAt))) : ITEM_MS;
      let got = null;
      try {
        got = await hub.item(id, { timeoutMs });
      } catch {
        got = null;
      }
      if (active !== a) return null;
      if (got) return got;
    }
    return null;
  }

  function message(sub, state, reason, { ahead = 0, etaSec = 0, elapsedSec = 0, analysis = null } = {}) {
    return { type: 'ptf:analysis-result', v: 1, req: sub.req, symbol: sub.symbol, state, ahead, etaSec, elapsedSec, reason: reason ?? null, analysis: analysis || null };
  }

  function send(sub, state, reason, extra) {
    if (!sub) return false;
    try {
      return post(message(sub, state, reason, extra)) !== false;
    } catch {
      return false;
    }
  }

  function clearTimer(a) {
    if (a && a.timer != null) {
      timers.clearTimeout(a.timer);
      a.timer = null;
    }
  }

  function finish(a, state, reason, analysis) {
    if (active !== a) return;
    clearTimer(a);
    active = null;
    const l = a.last || {};
    send(a.sub, state, reason, { elapsedSec: l.elapsedSec || 0, analysis });
  }

  // 지금 공개 상태(queued·running)만 보냄 — 바뀔 때만(force면 늘). 끝 상태(item을 받는 중)는 보내지 않는다 —
  // 결과는 finish가 그때의 창(a.sub)에 분석을 실어 한 번(분석 없는 ready·done을 먼저 보내면 사무실이 O-35를 띄우고 진짜 결과를 버림)
  function progress(a, force = false) {
    const l = a.last;
    if (!l || (l.state !== 'queued' && l.state !== 'running')) return;
    const key = `${l.state}|${l.ahead}`;
    if (!force && key === a.sentKey) return;
    if (send(a.sub, l.state, null, { ahead: l.ahead, etaSec: l.etaSec, elapsedSec: l.elapsedSec })) a.sentKey = key;
  }

  function capped(a) {
    if (now() - a.startedAt < REQ_MAX_WAIT_MS) return false;
    const st = a.last ? a.last.state : 'queued';
    finish(a, 'failed', st === 'running' ? 'timeout' : 'expired', null);
    return true;
  }

  // p37: 다음 받기를 turns로 하는가 — 이 요청의 마지막 공개 상태가 running이고 실시간이 끝나지 않았을 때
  const liveOn = (a) => live && !a.liveDead && !!a.ticket && !!a.last && a.last.state === 'running';

  function sendTurns(sub, state, stop, turns) {
    if (!sub) return false;
    try {
      return post(turnsMessage(sub, state, stop, turns)) !== false;
    } catch {
      return false;
    }
  }

  // turns 응답 하나의 실시간 칸(status 칸은 poll이 상태 GET 답처럼 처리). 멈춤·꺼짐은 한 번만 — 그 뒤로는 상태 GET
  function liveStep(a, t) {
    if (a.liveDead) return;
    if (t.live === 'aborted' || t.live === 'off') {
      a.liveDead = true;
      // aborted는 늘 허브 stop 그대로(보인 말이 없어도 — fail이면 사무실이 바로 끝 화면), off는 말을 보낸 뒤에만 cut(운영 끄기 — 런은 계속)
      if (t.live === 'aborted') sendTurns(a.sub, 'aborted', t.stop, []);
      else if (a.liveTurns.length) sendTurns(a.sub, 'aborted', 'cut', []);
      a.liveTurns = [];
      return;
    }
    // wait·on·ended — 받은 n보다 큰 새 말만, 한 메시지에 차례대로
    const fresh = t.turns.filter((x) => x.n > a.liveNext);
    if (!fresh.length) return;
    a.liveNext = fresh[fresh.length - 1].n;
    a.liveTurns.push(...fresh);
    sendTurns(a.sub, 'on', null, fresh);
  }

  function schedule(a, ms = liveOn(a) ? REQ_LIVE_POLL_MS : REQ_POLL_MS) {
    clearTimer(a);
    if (active !== a || !visible) return;
    a.timer = timers.setTimeout(() => {
      a.timer = null;
      poll(a);
    }, ms);
  }

  // 상태 한 번. 12분 상한을 넘었어도 먼저 묻는다(허브는 끝난 표를 15분 보관 — 숨은 동안 끝났으면 그 결과를 싣는다).
  // 끝나지 않았거나 못 물었으면 그때 마지막으로 본 상태로 expired·timeout
  async function poll(a) {
    if (active !== a || a.busy) return;
    const viaLive = liveOn(a);
    a.busy = true;
    let resp = null;
    try {
      resp = viaLive ? await hub.turns(a.ticket, a.liveNext) : await hub.status(a.ticket);
    } catch {
      resp = null;
    }
    a.busy = false;
    if (active !== a) return;
    let p = null;
    if (viaLive) {
      if (resp && resp.status === 404) {
        // turns 경로를 모르는 옛 허브로 본다 — 이 요청의 실시간을 끝내고 바로 상태 GET 한 번(표가 정말 없으면 그 404가 지금처럼 lost)
        a.liveDead = true;
        poll(a);
        return;
      }
      const t = resp && resp.status === 200 ? parseTurnsResp(resp.body, parseStatusExact) : null;
      if (t) {
        liveStep(a, t);
        p = t.status;
      }
    } else {
      p = resp && resp.status === 200 ? parseRequestResp(resp.body) : null;
    }
    if (p && p.state !== 'queued' && p.state !== 'running') {
      a.fails = 0;
      await settle(a, p);
      return;
    }
    if (now() - a.startedAt >= REQ_MAX_WAIT_MS) {
      if (p) a.last = p;
      capped(a);
      return;
    }
    if (resp && resp.status === 404) {
      finish(a, 'failed', 'lost', null);
      return;
    }
    if (resp && resp.status === 429) {
      schedule(a, REQ_RATE_WAIT_MS); // 퍼널 IP 분당 제한 — 표는 그대로, 세지 않고 쉬었다 다시
      return;
    }
    if (!p) {
      a.fails += 1;
      if (a.fails >= REQ_LOST_FAILS) finish(a, 'failed', 'lost', null);
      else schedule(a);
      return;
    }
    a.fails = 0;
    await settle(a, p);
  }

  // 허브 공개 상태 하나를 처리(첫 POST 답 — first·상태 답 모두)
  async function settle(a, p, first = false) {
    if (p.state === 'queued' || p.state === 'running') {
      if (!p.ticket && !a.ticket) {
        finish(a, 'unavailable', 'hub_down', fallback());
        return;
      }
      if (p.ticket) a.ticket = p.ticket;
      a.last = p;
      progress(a);
      if (!capped(a)) schedule(a);
      return;
    }
    a.last = p;
    if (p.state === 'unsupported' || p.state === 'failed') {
      finish(a, p.state, p.reason, null);
      return;
    }
    // ready·done·limited·unavailable — id가 있으면 그 분석 하나를 받아 싣는다(그동안 상태를 다시 묻지 않음)
    a.busy = true;
    const analysis = p.id ? await analysisFor(a, p.id, first) : null;
    if (active !== a) return;
    try {
      if (feed) feed.refreshSoon();
    } catch {
      // 최신 분석 받기 실패는 결과와 무관
    }
    if (p.state === 'ready' || p.state === 'done') {
      if (analysis) finish(a, p.state, p.reason, analysis);
      else finish(a, 'failed', 'lost', null);
      return;
    }
    finish(a, p.state, p.reason, analysis || fallback());
  }

  async function start(sub) {
    const a = { symbol: sub.symbol, sub, ticket: null, last: null, startedAt: now(), timer: null, busy: true, fails: 0, sentKey: null, liveNext: 0, liveTurns: [], liveDead: false };
    active = a;
    const body = { v: 1, symbol: sub.symbol, ed: config.edition, dev: await devId() };
    let resp = null;
    try {
      resp = await hub.request(body);
    } catch {
      resp = null;
    }
    a.busy = false;
    if (active !== a) return;
    if (resp && resp.status === 429) {
      finish(a, 'limited', 'ip', fallback());
      return;
    }
    const p = resp && resp.status === 200 ? parseRequestResp(resp.body) : null;
    if (!p) {
      finish(a, 'unavailable', 'hub_down', fallback());
      // 허브에 닿지 못한 것을 안 즉시 최신 분석도 한 번 받는다 — 그 받기도 실패하면 사무실 안내 줄이 바로 '연결 끊김'(다음 주기 최대 60초까지
      // '최신 분석 · N분 전'이 연결된 것처럼 남지 않게, p35 종단 확인 S9-5). 받기는 3초에 1번까지(refreshSoon)
      try {
        if (feed) feed.refreshSoon();
      } catch {
        // 받기 실패는 결과와 무관
      }
      return;
    }
    await settle(a, p, true);
  }

  return {
    // office-shell이 형식을 본 { req, symbol } — 여기서도 한 번 더
    request(raw) {
      if (!on) return;
      const sub = cleanReq(raw);
      if (!sub) return;
      if (active) {
        if (active.symbol === sub.symbol) {
          active.sub = sub;
          active.sentKey = null;
          progress(active, true);
          // p37: 지금까지 받은 직원 말을 새 창(새 req)에 한 번 더 — running 진행 상태 다음에(사무실은 대기·실행 중 요청의 말만 받는다)
          if (!active.liveDead && active.liveTurns.length && active.last && active.last.state === 'running') sendTurns(sub, 'on', null, active.liveTurns);
          return;
        }
        send(sub, 'busy', 'pending');
        return;
      }
      start(sub);
    },
    // 사무실 iframe load·다른 경로·사무실 교체 — 옛 창으로의 전달만 끊는다(허브 표·상태 받기는 그대로)
    officeGone() {
      if (active) {
        active.sub = null;
        active.sentKey = null;
      }
    },
    setVisible(v) {
      const was = visible;
      visible = !!v;
      const a = active;
      if (!a) return;
      if (!visible) {
        clearTimer(a);
        return;
      }
      if (!was && a.ticket && !a.busy) poll(a); // 12분을 넘겼어도 한 번은 묻는다(poll)
    },
    active: () => (active ? { symbol: active.symbol, ticket: active.ticket, state: active.last ? active.last.state : null } : null),
    devId,
  };
}
