// 오렌지엑스 WS(설계 3-2 §5.4) — 로그인 매개변수·서명·시계 맞추기·연결 하나(휴대폰 → wss://api.orangex.com/ws/api/v1 직접).
// - 로그인은 기본 client_credentials(아래 authParams — 실측 2026-10-08). 비밀 키 원문·접속 토큰은 기록하지 않는다(console 없음).
// - 서명 방식('signature', 지금은 거래소가 거절): StringToSign = clientId + "\n" + timestamp + "\n" + nonce + "\n",
//   signature = hex(HMAC-SHA256(secret, StringToSign)) — 원문은 꺼낼 수 없는 HMAC 키로 바꿔 서명만(docs L366-368).
// - 시계: ping 응답 usOut(실측 ms — 1e14보다 크면 문서 표대로 마이크로초로 보고 ms로)으로 offset = usOut − (보낸 시각 + 받은 시각)/2,
//   최근 5개 중앙값. timestamp = round(휴대폰 시각 + offset) — 휴대폰 시계가 틀려도 서버 시각으로 서명한다(8000·K-08g 방지).
// - 연결(createOxWs): 새 연결은 15초에 1번 이하(분당 4회 — 문서 한도 분당 5회·동시 10개 미만, docs L5764), 열린 동안 5초마다 /public/ping.
//   ping이 10초 안에 안 오면 반쯤 끊긴 연결로 보고 닫는다(onClose — 부른 쪽이 다시 연다). 요청은 id로 짝짓고 10초 제한.
export const OX_WS_MIN_GAP_MS = 15000;
export const OX_PING_MS = 5000;
export const OX_REQ_TIMEOUT_MS = 10000;
export const OX_CLOCK_SAMPLES = 5;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function oxStringToSign(clientId, ts, nonce) {
  return `${clientId}\n${ts}\n${nonce}\n`;
}

export async function oxSign(key, clientId, ts, nonce, subtle = globalThis.crypto.subtle) {
  return hex(await subtle.sign('HMAC', key, new TextEncoder().encode(oxStringToSign(clientId, ts, nonce))));
}

// 비밀 키 → 꺼낼 수 없는 서명 키. 원문 문자열은 부른 쪽이 바로 버린다(입력칸 비우기, §5.2)
export async function importOxSecret(secret, subtle = globalThis.crypto.subtle) {
  return subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export function newNonce(cryptoImpl = globalThis.crypto) {
  const b = new Uint8Array(16);
  cryptoImpl.getRandomValues(b);
  return hex(b);
}

// usOut: 문서 표는 마이크로초라 하고 예시·실측은 밀리초 — 1e14보다 크면 마이크로초로 본다
export function serverMs(usOut) {
  const n = Number(usOut);
  if (usOut == null || !Number.isFinite(n) || n <= 0) return null;
  return n > 1e14 ? n / 1000 : n;
}

export function clockSample(sentAt, recvAt, usOut) {
  const s = serverMs(usOut);
  if (s == null || !(recvAt >= sentAt)) return null;
  return s - (sentAt + recvAt) / 2;
}

export function medianOffset(samples) {
  const xs = (Array.isArray(samples) ? samples : []).filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(-OX_CLOCK_SAMPLES).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

// 로그인 방식(config.oxAuth) — 실측(2026-10-08 대표 키, tools/ox-key-check.html): client_credentials는 되고, 문서 서명식(과 변형 15가지)의
// client_signature는 모두 10000 'Authentication Failure'. 기본은 credentials, 오렌지엑스가 서명을 고치면 'signature'로 되돌릴 수 있게 둔다
export const OX_AUTH_MODES = Object.freeze(['credentials', 'signature']);
export const oxAuthMode = (config) => (config && config.oxAuth === 'signature' ? 'signature' : 'credentials');

// /public/auth 매개변수 — secret은 부른 쪽(ox-client auth)이 봉인을 풀어 바로 넘기고 보낸 즉시 버린다.
//   credentials: { grant_type 'client_credentials', client_id, client_secret } — 원문이 이 기기에서 오렌지엑스로만 간다(허브로는 안 감)
//   signature:   { grant_type 'client_signature', client_id, timestamp, nonce, signature } — 원문은 칸에 없음(꺼낼 수 없는 HMAC 키로 서명)
// refresh_token은 쓰지 않는다(다시 받을 때도 같은 방식으로 로그인, §5.4-5)
export async function authParams({ mode = 'credentials', clientId, secret, now = Date.now(), offset = 0, nonce = newNonce(), subtle = globalThis.crypto.subtle }) {
  if (mode !== 'signature') return { grant_type: 'client_credentials', client_id: clientId, client_secret: String(secret) };
  const key = await importOxSecret(secret, subtle);
  const timestamp = String(Math.round(now + (Number.isFinite(offset) ? offset : 0)));
  const signature = await oxSign(key, clientId, timestamp, nonce, subtle);
  return { grant_type: 'client_signature', client_id: clientId, timestamp, nonce, signature };
}

const WS_OPEN = 1;

// WS 연결 하나. request는 늘 resolve한다(reject 없음):
//   { result } | { error: { code, message } } | { timeout: true, sent: true } | { closed: true, sent }(sent false = 보내지도 못함)
// onNotify(params): 구독 알림({ method: 'subscription', params: { channel, data } } — docs L6526, 따라가기 시세 ticker.<종목>.raw)
// minGapMs: 새 연결 사이 최소 간격(기본 15초 — ox-client). 차트 전용 공개 연결은 120초(chart-ticker.js, p2 spec §3.3 — 합쳐 분당 4.5회)
export function createOxWs({ url, WebSocketImpl = globalThis.WebSocket, now = () => Date.now(), timers = globalThis, reqTimeoutMs = OX_REQ_TIMEOUT_MS, onClose = () => {}, onNotify = () => {}, minGapMs = OX_WS_MIN_GAP_MS } = {}) {
  let ws = null; // 지금 소켓(여는 중 또는 열림)
  let lastOpenAt = -Infinity; // 마지막으로 새 연결을 시작한 시각
  let waitTimer = null; // 15초 간격을 기다리는 열기
  let pingTimer = null;
  let opening = null;
  let openResolve = null;
  let nextId = 0;
  const pending = new Map(); // id → { resolve, timer, sentAt, method }
  const samples = []; // ping 시계 차이 표본(소켓이 바뀌어도 이어 씀)

  function settleAll() {
    for (const p of pending.values()) {
      timers.clearTimeout(p.timer);
      p.resolve({ closed: true, sent: true });
    }
    pending.clear();
  }
  function finishOpen(ok) {
    const r = openResolve;
    openResolve = null;
    opening = null;
    if (r) r(ok);
  }
  function stopPing() {
    if (pingTimer != null) {
      timers.clearInterval(pingTimer);
      pingTimer = null;
    }
  }
  // 소켓을 버린다. quiet = onClose를 부르지 않음(스스로 닫음·열기 실패)
  function drop(sock, quiet) {
    if (!sock || ws !== sock) return;
    ws = null;
    stopPing();
    settleAll();
    finishOpen(false);
    try {
      sock.close();
    } catch {
      // 이미 닫힘
    }
    if (!quiet) onClose();
  }
  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return; // 'PONG' 같은 글자 메시지는 넘긴다
    }
    if (msg && typeof msg === 'object' && msg.method === 'subscription' && msg.params && typeof msg.params === 'object') {
      try {
        onNotify(msg.params);
      } catch {
        // 알림 처리 실패가 연결을 흔들지 않게
      }
      return;
    }
    if (!msg || typeof msg !== 'object' || msg.id == null) return;
    const id = Number(msg.id);
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    timers.clearTimeout(p.timer);
    if (p.method === '/public/ping') {
      const s = clockSample(p.sentAt, now(), msg.usOut);
      if (s != null) {
        samples.push(s);
        if (samples.length > OX_CLOCK_SAMPLES) samples.shift();
      }
    }
    if (msg.error && typeof msg.error === 'object') p.resolve({ error: { code: Number(msg.error.code), message: String(msg.error.message ?? '') } });
    else p.resolve({ result: msg.result });
  }
  function request(method, params = {}) {
    const sock = ws;
    if (!sock || sock.readyState !== WS_OPEN) return Promise.resolve({ closed: true, sent: false });
    nextId += 1;
    const id = nextId;
    return new Promise((resolve) => {
      const timer = timers.setTimeout(() => {
        if (pending.delete(id)) resolve({ timeout: true, sent: true });
      }, reqTimeoutMs);
      pending.set(id, { resolve, timer, sentAt: now(), method });
      try {
        sock.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch {
        pending.delete(id);
        timers.clearTimeout(timer);
        resolve({ closed: true, sent: false });
      }
    });
  }
  function startPing(sock) {
    stopPing();
    pingTimer = timers.setInterval(() => {
      request('/public/ping', {}).then((r) => {
        if (r.timeout) drop(sock, false); // 반쯤 끊긴 연결
      });
    }, OX_PING_MS);
  }
  function start() {
    waitTimer = null;
    lastOpenAt = now();
    let sock;
    try {
      sock = new WebSocketImpl(url);
    } catch {
      finishOpen(false);
      return;
    }
    let opened = false;
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      opened = true;
      startPing(sock);
      finishOpen(true);
    };
    sock.onmessage = (ev) => {
      if (ws === sock) onMessage(ev);
    };
    sock.onerror = () => {};
    sock.onclose = () => {
      if (ws === sock) drop(sock, !opened);
    };
  }
  function open() {
    if (ws && ws.readyState === WS_OPEN) return Promise.resolve(true);
    if (opening) return opening;
    opening = new Promise((resolve) => {
      openResolve = resolve;
    });
    const p = opening;
    const wait = lastOpenAt + minGapMs - now();
    if (wait > 0) waitTimer = timers.setTimeout(start, wait);
    else start();
    return p;
  }
  function close() {
    if (waitTimer != null) {
      timers.clearTimeout(waitTimer);
      waitTimer = null;
    }
    if (ws) drop(ws, true);
    else finishOpen(false);
  }
  return {
    open,
    close,
    request,
    ping: () => request('/public/ping', {}),
    subscribe: (channels) => request('/public/subscribe', { channels }),
    isOpen: () => !!ws && ws.readyState === WS_OPEN,
    offset: () => medianOffset(samples),
    nextOpenAt: () => lastOpenAt + minGapMs,
  };
}
