// 회원 실시간 연결 읽기(설계 3-2 §3.4) — EventSource는 머리글(Authorization)을 붙일 수 없어 fetch 본문을 직접 읽는다.
// createSseParser: 글자 덩어리를 받아 SSE 규칙대로 이벤트를 낸다 — 줄 끝 LF·CRLF·CR(덩어리 경계에서 갈라져도),
//   data 여러 줄(\n으로 잇기), event, id(연결 동안 유지, NUL이 든 값은 무시), retry(숫자만), 주석(':'로 시작).
//   아직 끝나지 않은 이벤트(줄 버퍼 + 쌓인 data)가 maxBuffer(256 KB, UTF-8 바이트 — 3-1 §5와 같은 규칙)를 넘으면 push가 false — 연결을 끊으라는 뜻.
// createFetchStream: fetch → res.body.getReader() → TextDecoder(stream: true) → 파서.
//   onClose({ kind }) 한 번: 'unauthorized'(401, 본문) · 'http'(그 밖 실패 상태, 또는 2xx인데 content-type이 text/event-stream이 아님 —
//   공용 와이파이 로그인 페이지가 200 html을 주면 활동으로 세어 45초 감시가 멈추지 않게) · 'unsupported'(본문을 읽을 수 없음)
//   · 'eof'(허브가 닫음) · 'overflow'(256 KB 넘음) · 'error'(네트워크). close()로 직접 닫으면 onClose 없음.
export const SSE_MAX_BUFFER = 262144; // 바이트
const EVENT_STREAM = /^text\/event-stream\s*(;|$)/i;

// UTF-8 바이트 수(한글은 글자당 3바이트, 서로게이트 쌍은 4바이트)
export function utf8Len(s) {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

export function createSseParser({ onEvent = () => {}, onComment = () => {}, onRetry = () => {}, maxBuffer = SSE_MAX_BUFFER } = {}) {
  let buf = '';
  let data = [];
  let dataLen = 0; // 쌓인 data의 UTF-8 바이트(줄마다 +1)
  let type = '';
  let lastId = '';
  let skipLF = false; // 바로 앞 글자가 CR — 이어 오는 LF는 같은 줄 끝
  let dead = false;

  function dispatch() {
    if (data.length === 0) {
      type = '';
      return;
    }
    const ev = { type: type || 'message', data: data.join('\n'), id: lastId };
    data = [];
    dataLen = 0;
    type = '';
    onEvent(ev);
  }

  function line(l) {
    if (l === '') {
      dispatch();
      return;
    }
    if (l.charCodeAt(0) === 58) { // ':' 주석
      onComment(l.slice(1).replace(/^ /, ''));
      return;
    }
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    if (field === 'event') type = value;
    else if (field === 'data') {
      data.push(value);
      dataLen += utf8Len(value) + 1;
    } else if (field === 'id') {
      if (!value.includes('\u0000')) lastId = value;
    } else if (field === 'retry') {
      if (/^\d+$/.test(value)) onRetry(Number(value));
    }
  }

  function push(text) {
    if (dead) return false;
    buf += String(text);
    let start = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const c = buf.charCodeAt(i);
      if (skipLF) {
        skipLF = false;
        if (c === 10) {
          start = i + 1;
          continue;
        }
      }
      if (c === 10 || c === 13) {
        line(buf.slice(start, i));
        if (c === 13) skipLF = true;
        start = i + 1;
      }
    }
    buf = buf.slice(start);
    if (utf8Len(buf) + dataLen > maxBuffer) { // 남은 줄 버퍼는 보통 짧다(끝나지 않은 한 줄)
      dead = true;
      return false;
    }
    return true;
  }

  return { push, lastEventId: () => lastId };
}

export function createFetchStream({
  url,
  headers = {},
  fetchImpl = (...a) => globalThis.fetch(...a),
  Decoder = globalThis.TextDecoder,
  maxBuffer = SSE_MAX_BUFFER,
  onOpen = () => {},
  onActivity = () => {},
  onEvent = () => {},
  onClose = () => {},
}) {
  const ac = new AbortController();
  let closed = false;
  let reader = null;

  function cancel() {
    try {
      ac.abort();
    } catch {
      // 이미 끝남
    }
    if (reader) reader.cancel().catch(() => {});
  }

  function finish(info) {
    if (closed) return;
    closed = true;
    cancel();
    onClose(info);
  }

  (async () => {
    let res;
    try {
      res = await fetchImpl(url, { headers, cache: 'no-store', mode: 'cors', credentials: 'omit', signal: ac.signal });
    } catch {
      finish({ kind: 'error' });
      return;
    }
    if (closed) return;
    if (!res) {
      finish({ kind: 'error' });
      return;
    }
    if (res.status === 401) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      finish({ kind: 'unauthorized', status: 401, body });
      return;
    }
    if (!res.ok) {
      finish({ kind: 'http', status: res.status });
      return;
    }
    const ctype = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : null;
    if (typeof ctype !== 'string' || !EVENT_STREAM.test(ctype.trim())) {
      finish({ kind: 'http', status: res.status }); // 허브가 아닌 응답 — 끊고 다시 붙는 규칙(5→60초)대로
      return;
    }
    if (!res.body || typeof res.body.getReader !== 'function' || typeof Decoder !== 'function') {
      finish({ kind: 'unsupported' });
      return;
    }
    reader = res.body.getReader();
    const dec = new Decoder('utf-8');
    const parser = createSseParser({ maxBuffer, onEvent: (e) => { if (!closed) onEvent(e); } });
    onOpen();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (closed) return;
        if (done) {
          parser.push(dec.decode());
          finish({ kind: 'eof' });
          return;
        }
        onActivity();
        if (!parser.push(dec.decode(value, { stream: true }))) {
          finish({ kind: 'overflow' });
          return;
        }
      }
    } catch {
      finish({ kind: 'error' });
    }
  })();

  return {
    close() {
      if (closed) return;
      closed = true;
      cancel();
    },
  };
}
