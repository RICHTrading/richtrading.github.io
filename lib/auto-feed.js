// 자동매매 송출 받기 — 공개 송출(설계 3-1 §5·§6 '연결')과 회원 송출(설계 3-2 §3.4)이 같이 쓴다.
// 처음엔 state·events로 화면을 채우고 그다음 실시간 연결. 문구·알림 판단은 auto-view.js.
//
// 전송(transport)
//   'eventsource'(공개, 기본): EventSource(<stream>?since=<마지막 번호>). 머리글을 붙일 수 없다.
//   'fetch'(회원): fetch 본문을 직접 읽는다(sse-reader.js) — Authorization·Last-Event-ID 머리글을 붙이려고.
//     본문을 읽을 수 없는 브라우저(ReadableStream 없음)는 10초 폴링만.
// 끊김: eventsource는 onerror에서 readyState가 CLOSED일 때(허브 재시작 중 502·429·403), fetch는 연결이 끝나거나 실패할 때
//   5→10→20→40→60초로 늘려 가며 새로 열고, 그 사이 10초마다 state를 읽어 번호가 늘었으면 events?since로 이어 받는다.
//   eventsource가 CONNECTING이면 브라우저가 retry(5초)로 스스로 다시 붙으니 그대로 둔다.
// 살아 있음: 연결이 있는 동안 30초마다 state를 읽어 확인한다.
//   - 성공 · 번호 ≤ 받은 마지막 번호 → 살아 있음 / 번호가 더 큼 → events?since로 이어 받고, 새로 받은 게 있으면 다시 연결
//   - 실패 → '연결 안 됨'. 45초 동안 아무것도 없으면 닫고 다시 연다
//   eventsource: 허브의 20초 ': ping'은 화면 코드에 안 보이므로 확인 성공도 '살아 있음'으로 센다(조용하지만 멀쩡한 연결은 끊지 않음).
//   fetch: ping·event: follow가 보이므로 스트림에서 온 것만 센다 — 스트림이 45초 조용하면 확인이 성공해도 다시 연다(설계 3-2 §3.4).
//   확인이 한 번 실패해 '연결 안 됨'이어도 스트림이 열리거나 이벤트를 주면 허브에 닿는 것이므로 바로 지운다.
// 인증(auth): 요청·연결마다 auth()가 준 머리글을 붙인다. 401(또는 스트림의 event: revoked)이면 멈추고 onUnauthorized(본문)를 한 번 —
//   같은 토큰으로 다시 붙지 않는다(해제된 토큰으로 허브를 두드리지 않게).
// 이벤트 출처(source): 연결마다 event: live를 받은 다음 스트림으로 받은 것만 'stream', 재생 프레임·이어 받기·폴링·처음 채우기는 'replay'
//   (재생 프레임은 실시간 프레임과 바이트가 같아 표식 없이는 구별할 수 없다). onEvent(이벤트)로 받은 순서대로 한 번씩 알린다.
// onConnect(): 새 실시간 연결을 열 때마다 — 끊긴 동안 바뀌었을 수 있는 연결별 값(회원 송출의 event: follow)을 지우라는 뜻.
// 허브 상태 초기화: state의 번호(seqOf)가 요청 직전에 받은 마지막 번호보다 작으면(허브 상태 파일이 새로 시작) 목록을 처음부터 다시
//   받는다(알림 없음). 안 그러면 새 이벤트가 이미 본 번호와 겹쳐 버려지고, 폴링만인 브라우저는 영영 멈춘다.
// 화면 갱신: 스냅샷 내용이 바뀔 때만 onUpdate — 변화 없는 30초 확인·스트림 재접속마다 탭을 다시 그리지 않게.
// EventSource가 없는 브라우저(공개)는 10초 폴링만.
import { LIST_KINDS, shouldAlert } from './auto-view.js';
import { createFetchStream } from './sse-reader.js';

export const BACKOFF_MS = Object.freeze([5000, 10000, 20000, 40000, 60000]);
export const POLL_MS = 10000;
export const LIVENESS_MS = 30000;
export const SILENCE_MS = 45000;
export const LIST_LIMIT = 50;
export const CATCHUP_LIMIT = 100;
const CLOSED = 2; // EventSource.CLOSED

// prefix: 공개 '/v1/auto' · 회원 '/v1/member'. kinds: 목록(흐름)에 받을 종류
export function feedUrls(hub, prefix = '/v1/auto', kinds = LIST_KINDS) {
  const base = `${String(hub).replace(/\/+$/, '')}${prefix}`;
  return {
    state: `${base}/state`,
    list: `${base}/events?limit=${LIST_LIMIT}&kinds=${kinds.join(',')}`,
    since: (seq) => `${base}/events?since=${seq}&limit=${CATCHUP_LIMIT}`,
    stream: (seq) => `${base}/stream?since=${seq}`,
  };
}

function parseJson(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
const isSeq = (n) => Number.isInteger(n) && n >= 0;

export function createAutoFeed({
  hub,
  urls: urlsIn = null,
  transport = 'eventsource',
  auth = null,
  listKinds = LIST_KINDS,
  seqOf = (s) => s.seq,
  fetchImpl = (...a) => globalThis.fetch(...a),
  EventSourceImpl = globalThis.EventSource,
  streamFactory = createFetchStream,
  timers = globalThis,
  now = () => Date.now(),
  onUpdate = () => {},
  onAlert = () => {},
  onEvent = () => {},
  onOther = () => {},
  otherTypes = [],
  onConnect = () => {},
  onUnauthorized = () => {},
  timeoutMs = 8000,
}) {
  const urls = urlsIn || feedUrls(hub);
  const useFetch = transport === 'fetch';
  let running = false;
  let gen = 0; // stop() 뒤에 끝난 요청은 버린다
  let loaded = false;
  let state = null;
  let events = [];
  let hubDown = false;
  let streaming = false;
  let baselineSeq = null; // 목록을 채울 때의 번호 — 이 번호 이하는 알림 없음
  let lastSeq = 0; // 받은 가장 큰 번호(since·Last-Event-ID에 쓴다)
  let seen = new Set();
  let es = null; // 지금 실시간 연결(EventSource 또는 fetch 연결 손잡이)
  let liveSeen = false; // 이 연결에서 event: live를 받았나
  let noStream = false; // fetch 전송인데 본문을 읽을 수 없는 브라우저 — 폴링만
  let revoked = false; // 401을 받아 멈춤 — 같은 토큰으로 다시 붙지 않는다
  let backoff = 0;
  let busy = false;
  const t = { reopen: null, poll: null, live: null, silence: null };

  const seqOfState = (s) => {
    try {
      return seqOf(s);
    } catch {
      return undefined;
    }
  };
  const authHeaders = () => {
    const h = auth ? auth() : null;
    return h && typeof h === 'object' ? h : null;
  };
  const streamOk = () => (useFetch ? !noStream : !!EventSourceImpl);

  const snapshot = () => ({ state, events: events.slice(), hubDown, streaming, loaded });
  let lastKey = null; // 마지막으로 알린 스냅샷의 요약 — 같으면 알리지 않는다
  function emit() {
    const n = events.length;
    const key = JSON.stringify([state, n, n ? events[0].seq : 0, n ? events[n - 1].seq : 0, hubDown, streaming, loaded]);
    if (key === lastKey) return;
    lastKey = key;
    onUpdate(snapshot());
  }

  function unauthorized(body) {
    if (revoked) return;
    revoked = true;
    stop();
    onUnauthorized(body && typeof body === 'object' ? body : { ok: false, error: 'token_invalid' });
  }

  async function getJson(url) {
    const opts = { cache: 'no-store', mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) };
    const h = authHeaders();
    if (h) opts.headers = h;
    const res = await fetchImpl(url, opts);
    if (res && res.status === 401) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      unauthorized(body);
      throw new Error('unauthorized');
    }
    if (!res || !res.ok) throw new Error('http');
    const data = await res.json();
    if (!data || data.ok !== true) throw new Error('not ok');
    return data;
  }

  function addEvent(ev, live, source) {
    if (!ev || typeof ev !== 'object' || !isSeq(ev.seq) || ev.seq === 0 || seen.has(ev.seq)) return false;
    const e = { ...ev, source };
    seen.add(e.seq);
    if (e.seq > lastSeq) lastSeq = e.seq;
    if (seen.size > 2000) seen = new Set([...seen].filter((s) => s > lastSeq - 1000));
    if (listKinds.includes(e.kind)) {
      events.push(e);
      events.sort((a, b) => a.seq - b.seq);
      if (events.length > LIST_LIMIT) events.splice(0, events.length - LIST_LIMIT);
    }
    onEvent(e);
    if (live && shouldAlert(e, { now: now(), baselineSeq })) onAlert(e);
    return true;
  }

  async function load(g) {
    try {
      const [s, list] = await Promise.all([getJson(urls.state), getJson(urls.list)]);
      if (g !== gen) return false;
      state = s;
      events = [];
      seen = new Set();
      const sq = seqOfState(s);
      baselineSeq = isSeq(sq) ? sq : 0;
      lastSeq = baselineSeq;
      for (const ev of Array.isArray(list.events) ? list.events : []) addEvent(ev, false, 'replay');
      loaded = true;
      hubDown = false;
      emit();
      return true;
    } catch {
      if (g !== gen) return false;
      hubDown = true;
      emit();
      return false;
    }
  }

  // 놓친 이벤트 이어 받기 — 새로 받은 개수, 목록을 처음부터 다시 받았으면 -1
  async function catchUp(g) {
    const r = await getJson(urls.since(lastSeq));
    if (g !== gen) return 0;
    if (r.gap === true || r.more === true) {
      await load(g);
      return -1;
    }
    let added = 0;
    for (const ev of Array.isArray(r.events) ? r.events : []) if (addEvent(ev, true, 'replay')) added += 1;
    return added;
  }

  function applyState(s) {
    state = s;
    hubDown = false;
  }

  // 끊긴 동안·실시간 연결을 못 쓸 때 10초마다
  async function pollOnce() {
    if (busy || !running) return;
    busy = true;
    const g = gen;
    try {
      if (!loaded) {
        await load(g);
        return;
      }
      const before = lastSeq; // 요청 전 값과 비교 — 응답을 기다리는 사이 스트림으로 받은 번호와 헷갈리지 않게
      const s = await getJson(urls.state);
      if (g !== gen) return;
      const sq = seqOfState(s);
      if (isSeq(sq) && sq < before) {
        await load(g); // 허브 상태 초기화 — 처음부터 다시(알림 없음). 다시 열 때는 새 lastSeq로
        return;
      }
      applyState(s);
      if (isSeq(sq) && sq > lastSeq) await catchUp(g);
      if (g === gen) emit();
    } catch {
      if (g === gen) {
        hubDown = true;
        emit();
      }
    } finally {
      if (g === gen) busy = false;
    }
  }

  // 연결이 있는 동안 30초마다(위 '살아 있음' 설명)
  async function checkAlive() {
    if (busy || !running || !es) return;
    busy = true;
    const g = gen;
    try {
      const before = lastSeq;
      const s = await getJson(urls.state);
      if (g !== gen) return;
      const sq = seqOfState(s);
      if (isSeq(sq) && sq < before) {
        // 허브 상태 초기화 — 목록을 처음부터 다시 받고(알림 없음) since=새 번호로 다시 연결
        if ((await load(g)) && g === gen) reconnect();
        return;
      }
      applyState(s);
      if (isSeq(sq) && sq > lastSeq) {
        const added = await catchUp(g);
        if (g === gen) {
          if (added !== 0) reconnect();
          else aliveFromCheck();
        }
      } else {
        aliveFromCheck();
      }
      if (g === gen) emit();
    } catch {
      if (g === gen) {
        hubDown = true;
        emit();
      }
    } finally {
      if (g === gen) busy = false;
    }
  }

  function alive() {
    if (t.silence != null) timers.clearTimeout(t.silence);
    t.silence = timers.setTimeout(onSilence, SILENCE_MS);
  }

  // 확인 성공 — eventsource만 '살아 있음'으로 센다(fetch는 스트림에서 ping·follow가 보인다)
  function aliveFromCheck() {
    if (!useFetch) alive();
  }

  function onSilence() {
    t.silence = null;
    if (running && es) reconnect();
  }

  function dropStream() {
    if (es) {
      const s = es;
      es = null;
      if (!useFetch) {
        s.onopen = null;
        s.onerror = null;
      }
      s.close();
    }
    streaming = false;
    liveSeen = false;
    if (t.silence != null) {
      timers.clearTimeout(t.silence);
      t.silence = null;
    }
    if (t.live != null) {
      timers.clearInterval(t.live);
      t.live = null;
    }
  }

  function reconnect() {
    dropStream();
    openStream();
  }

  function startPolling() {
    if (t.poll == null) t.poll = timers.setInterval(pollOnce, POLL_MS);
  }

  function stopPolling() {
    if (t.poll != null) {
      timers.clearInterval(t.poll);
      t.poll = null;
    }
  }

  function scheduleReopen() {
    if (t.reopen != null) return;
    const delay = BACKOFF_MS[Math.min(backoff, BACKOFF_MS.length - 1)];
    backoff += 1;
    t.reopen = timers.setTimeout(() => {
      t.reopen = null;
      openStream();
    }, delay);
  }

  function onOpened() {
    backoff = 0;
    streaming = true;
    hubDown = false; // 스트림이 열림 = 허브에 닿음
    stopPolling();
    alive();
    emit();
  }

  function streamClosed() {
    dropStream();
    startPolling();
    scheduleReopen();
  }

  // 실시간 프레임 하나 — 두 전송이 같이 쓴다
  function onFrame(type, raw) {
    alive();
    hubDown = false;
    if (type === 'auto') {
      addEvent(parseJson(raw), true, liveSeen ? 'stream' : 'replay');
      emit(); // 바뀐 게 없으면 emit이 알아서 건너뛴다
      return;
    }
    if (type === 'state') {
      const s = parseJson(raw);
      if (!s) return;
      if (s.reset === true) {
        load(gen);
        return;
      }
      applyState(s);
      emit();
      return;
    }
    if (type === 'live') {
      liveSeen = true;
      emit();
      return;
    }
    if (type === 'revoked') {
      const d = parseJson(raw) || {};
      unauthorized({ ok: false, error: 'token_revoked', reason: typeof d.reason === 'string' ? d.reason : null });
      return;
    }
    onOther(type, parseJson(raw), { source: liveSeen ? 'stream' : 'replay' });
  }

  function openEventSource() {
    const src = new EventSourceImpl(urls.stream(lastSeq));
    es = src;
    src.onopen = () => {
      if (es === src) onOpened();
    };
    for (const type of ['auto', 'state', 'live', ...otherTypes]) {
      src.addEventListener(type, (e) => {
        if (es === src) onFrame(type, e.data);
      });
    }
    src.onerror = () => {
      if (es !== src) return;
      streaming = false;
      if (src.readyState === CLOSED) streamClosed();
      emit();
    };
  }

  function openFetchStream() {
    const handle = { close: () => {} };
    es = handle;
    const mine = () => es === handle;
    const conn = streamFactory({
      url: urls.stream(lastSeq),
      headers: { ...(authHeaders() || {}), 'Last-Event-ID': String(lastSeq) },
      fetchImpl,
      onOpen: () => {
        if (mine()) onOpened();
      },
      onActivity: () => {
        if (mine()) alive();
      },
      onEvent: (m) => {
        if (mine() && m) onFrame(m.type, m.data);
      },
      onClose: (info) => {
        if (!mine()) return;
        const kind = info && info.kind;
        if (kind === 'unauthorized') {
          unauthorized(info.body);
          return;
        }
        streaming = false;
        if (kind === 'unsupported') {
          noStream = true; // 이 브라우저는 본문을 못 읽는다 — 다시 열지 않고 폴링만
          dropStream();
          startPolling();
          emit();
          return;
        }
        streamClosed();
        emit();
      },
    });
    handle.close = () => conn.close();
  }

  function openStream() {
    if (!running || es) return;
    if (!streamOk()) {
      startPolling();
      return;
    }
    if (!loaded) {
      startPolling();
      scheduleReopen();
      return;
    }
    liveSeen = false;
    onConnect();
    if (useFetch) openFetchStream();
    else openEventSource();
    alive();
    if (t.live == null) t.live = timers.setInterval(checkAlive, LIVENESS_MS);
  }

  function start() {
    if (running) return;
    running = true;
    revoked = false;
    gen += 1;
    busy = false;
    lastKey = null; // 화면으로 돌아온 첫 채우기는 내용이 같아도 알린다
    emit(); // 바로 loaded=false를 알린다 — 다시 채울 때까지(최대 8초) 옛 스냅샷이 살아 있는 것처럼 보이지 않게
    const g = gen;
    load(g).then((ok) => {
      if (g !== gen || !running) return;
      if (ok) openStream();
      else {
        startPolling();
        if (streamOk()) scheduleReopen();
      }
    });
  }

  function stop() {
    running = false;
    gen += 1;
    busy = false;
    // 숨어 있던 동안의 매매는 흐름에만(알림 없음) — 다시 시작하면 반드시 목록부터 새로 받아 baselineSeq·lastSeq를 다시 잡는다.
    // 다시 채우기가 실패해도 옛 번호로 이어 받거나(catchUp) 스트림을 열지 않는다(pollOnce·openStream이 load부터)
    loaded = false;
    dropStream();
    stopPolling();
    if (t.reopen != null) {
      timers.clearTimeout(t.reopen);
      t.reopen = null;
    }
    backoff = 0;
  }

  return { start, stop, snapshot };
}
