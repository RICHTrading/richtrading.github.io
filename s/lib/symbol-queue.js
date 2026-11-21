// 종목별 큐(spec §5.5) — 수동 주문과 따라가기가 같은 큐를 쓴다(같은 종목은 앞 동작의 체결 확인 뒤 다음).
// 같은 판을 두 창에서 열면 큐가 둘이라 Web Locks('ptf-<판>-ox-<종목>')로 창 사이도 한 줄. wait:false(수동)는 못 얻으면 바로 { busy: true }.
// Web Locks가 없는 브라우저는 BroadcastChannel('ptf-<판>-ox')로 진행 중 알림을 주고받는다(완전한 잠금은 아니지만 두 창 동시 주문을 막는다 — 검토 21).
// 그 길에서 wait:false(수동)는 다른 창이 진행 중이면 바로 busy, wait:true(따라가기 엔진·종목 정리)는 다른 창 알림이 끝나거나 busyMs(30초)가
// 지날 때까지 pollMs마다 다시 보고 기다린다(p40 검토 4 — 다른 창의 수동 1차 진입과 같은 종목 주문을 겹쳐 보내지 않게).
// fn이 던지면 onError 뒤 { error }를 돌려준다(삼키지 않음 — 부르는 쪽이 lastError·'down'으로 바꾼다).
// 다시 들어가기 금지: Web Locks는 다시 들어갈 수 없다(re-entrant 아님) — 큐 안의 동작(fn)에서 같은 종목으로 run을 부르고 기다리면
// 잠금을 쥔 채 자기 자신을 기다려 그 종목이 영원히 멈춘다(큐만 있는 대체 길도 앞 동작 = 자기 자신을 기다려 같다).
// 그래서 같은 종목의 run도, 종목마다 run을 부르는 일(자동 손절 keeper.sweep 등)도 큐 밖에서만 부른다 — 따라가기 엔진·정리 주기는 이미 그렇게 한다.
// 순서는 잠금 순서와 같게: 탭 잠금(follow-lease acquireTabLock)을 먼저, 그 안에서 종목 잠금(창 사이 교착 없음).
export function createSymbolQueue({
  locks = globalThis.navigator ? globalThis.navigator.locks : null, edition, onError = () => {}, Channel = globalThis.BroadcastChannel, now = () => Date.now(), busyMs = 30000,
  pollMs = 250, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const chains = new Map();
  const others = new Map(); // symbol → { id, at } 다른 창이 진행 중
  const me = Math.random().toString(16).slice(2);
  let ch = null;
  if (!(locks && typeof locks.request === 'function') && Channel) {
    try {
      ch = new Channel(`ptf-${edition}-ox`);
      ch.addEventListener('message', (e) => {
        const m = e && e.data;
        if (!m || m.id === me || typeof m.symbol !== 'string') return;
        if (m.t === 'start') others.set(m.symbol, { id: m.id, at: now() });
        else if (m.t === 'end') others.delete(m.symbol);
      });
    } catch { ch = null; }
  }
  const busyOf = (symbol) => { const o = others.get(symbol); return !!o && now() - o.at < busyMs; };
  const post = (t, symbol) => { if (ch) try { ch.postMessage({ t, symbol, id: me }); } catch { /* 닫힘 */ } };
  function run(symbol, fn, { wait = true } = {}) {
    const prev = chains.get(symbol) || Promise.resolve();
    const guarded = async () => {
      try { return await fn(); } catch (e) { onError(e); return { error: e }; }
    };
    const step = async () => {
      if (locks && typeof locks.request === 'function') return locks.request(`ptf-${edition}-ox-${symbol}`, wait ? {} : { ifAvailable: true }, (lock) => (lock === null ? { busy: true } : guarded()));
      if (!wait && busyOf(symbol)) return { busy: true };
      while (wait && busyOf(symbol)) await sleep(pollMs);
      post('start', symbol);
      try { return await guarded(); } finally { post('end', symbol); }
    };
    const next = prev.then(step, step);
    chains.set(symbol, next.catch(() => undefined));
    return next;
  }
  return { run, busyOf };
}
