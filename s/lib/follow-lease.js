// 따라가기 임대(설계 3-2 §6.16) — UID마다 따라가는 기기 하나. 허브 POST /v1/member/follow/lease(회원 토큰)에
// { v:1, lease:<22자, 엔진을 켤 때마다 새로>, op:'claim'|'renew'|'release', force?, resume? } → { ok, holder, until, now }.
// - 켜면 claim, 켜진 동안 30초마다 renew(holder:false면 force 없이 claim 다시 — 허브 재시작 뒤), 끄기·로그아웃·키 해제·앱 숨김 때 release.
// - p40(2026-10-10): 켤 때의 claim은 resume:true — 같은 기기(같은 토큰·같은 기기 값)가 쥔 옛 lease(페이지가 다시 떴는데 release가 유실 —
//   서비스 워커 업데이트·iOS가 앱을 멈췄다 다시 엶)를 이어받는다. 그 claim이 성공 답을 못 받으면(iOS가 다시 연 직후 네트워크 실패·시간 초과·
//   429·5xx) 첫 답을 받을 때까지 30초 주기에 renew 없이 resume claim을 다시(p40 검토). 첫 답 뒤의 주기 claim(renew → holder:false)에는
//   보내지 않는다(살아 있는 두 창이 번갈아 뺏지 않게). 탭 잠금을 못 잡은 탭은 start({ resume:false })(잠금을 쥔 탭의 임대를 뺏지 않게 — follow-engine).
// - release는 fetch keepalive(숨김·페이지 닫힘에도 나가게). 브라우저가 keepalive 요청을 거절하면 keepalive 없이 한 번 더.
// - held() = 보유 && 마지막 갱신 성공이 45초 안(G2). 실패·시간 초과면 보유를 믿지 않는다.
// - status() = 'held'(held()) | 'refused'(이 lease의 마지막 성공 답이 holder:false + until — 다른 기기가 쥠, F-17) | 'checking'(아직 답 없음·
//   마지막 요청 실패·마지막 성공 답이 45초보다 오래됨·holder:false + until:null = 아무도 안 쥠(허브 재시작 — 바로 다시 claim) — '다른 기기'라고
//   말하지 않는다). 주문 판단은 held()만 본다.
// - 응답의 now로 허브 시각 표본(§6.6 hubOffset — 왕복 2초 넘으면 버림, 최근 5개 중앙값)을 모은다. 표본이 없으면 진입·추가 진입·조정 안 함(G8).
// - force(F-17 '이 기기로 옮기기'): 앞 보유 기기에는 허브가 event: follow { enabled:false, reason:'other_device' }를 보낸다.
// 같은 브라우저의 탭 사이는 Web Locks('ptf-follow', ifAvailable)로 먼저 거른다(보조 — iOS 홈 화면 앱·다른 휴대폰은 임대가 막는다, §5.1).
import { memberHeaders, newDeviceId } from './member.js';
import { offsetSample } from './follow-math.js';
import { medianOffset } from './ox-ws.js';

export const LEASE_RENEW_MS = 30000;
export const LEASE_FRESH_MS = 45000;
export const LEASE_TIMEOUT_MS = 5000;
export const LEASE_STATUSES = Object.freeze(['held', 'refused', 'checking']);
const SAMPLES = 5;

export function createLeaseClient({
  config,
  getToken = () => null,
  fetchImpl = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  timers = globalThis,
  newId = () => newDeviceId(),
  signalFor = (ms) => AbortSignal.timeout(ms),
  onChange = () => {},
  onUnauthorized = () => {},
}) {
  const url = `${String(config.hub).replace(/\/+$/, '')}/v1/member/follow/lease`;
  let id = null;
  let holder = false;
  let until = null;
  let okAt = null;
  let failed = false; // 이 lease의 마지막 요청(release 빼고)이 성공 답을 받지 못함
  let lastHttp = null; // 마지막으로 받은 응답의 상태 코드(이 lease)
  // 켤 때 resume을 허락받았고 이 lease의 resume claim이 아직 성공 답을 받지 못함 — 주기도 renew 없이 resume claim(p40 검토:
  // iOS가 다시 연 직후 첫 요청 실패). 성공 답(보유·거절 무관)·보유 답·400(resume을 모르는 옛 허브)이면 끝 — 그 뒤로는 resume 없음
  let resumeWant = false;
  let timer = null;
  const samples = [];
  const state = () => ({ id, holder, until, okAt });
  const held = () => holder && okAt != null && now() - okAt <= LEASE_FRESH_MS;

  function send(token, body, keepalive) {
    return fetchImpl(url, {
      method: 'POST',
      headers: { ...memberHeaders(token, config.version), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
      ...(keepalive ? { keepalive: true } : {}),
      signal: signalFor(LEASE_TIMEOUT_MS),
    });
  }

  async function op(kind, { force = false, resume = false } = {}) {
    const token = getToken();
    const lease = id;
    if (!token || !lease) return null;
    const body = { v: 1, lease, op: kind };
    if (force) body.force = true;
    if (resume) body.resume = true;
    const release = kind === 'release';
    const sentAt = now();
    let res;
    let b = null;
    try {
      try {
        res = await send(token, body, release);
      } catch (e) {
        if (!release) throw e;
        res = await send(token, body, false); // keepalive를 못 쓰는 브라우저 — 한 번 더(실패해도 90초 뒤 풀린다)
      }
      b = await res.json();
    } catch {
      if (!release && lease === id) {
        failed = true;
        onChange(state());
      }
      return null;
    }
    if (lease !== id) return null; // 그사이 껐다 켬
    lastHttp = res.status;
    const good = res.status === 200 && !!b && b.ok === true && typeof b.holder === 'boolean';
    if (!release && !good) failed = true;
    if ((resume && (good || res.status === 400)) || (good && b.holder === true)) resumeWant = false;
    if (res.status === 401) {
      onUnauthorized(b, token);
      return null;
    }
    if (!good) return null;
    const recvAt = now();
    const s = offsetSample(sentAt, recvAt, Number(b.now));
    if (s != null) {
      samples.push(s);
      if (samples.length > SAMPLES) samples.shift();
    }
    if (!release) {
      holder = b.holder;
      until = Number.isFinite(b.until) ? b.until : null;
      okAt = recvAt;
      failed = false;
      onChange(state());
    }
    return b;
  }

  async function tick() {
    // 켤 때의 resume claim이 아직 답을 못 받음 — renew(쥔 적 없는 lease라 holder:false, 잠깐 '다른 기기'로 보임) 없이 resume claim만 다시
    if (resumeWant) {
      await op('claim', { resume: true });
      return;
    }
    const r = await op('renew');
    if (r && r.holder === false) await op('claim'); // 허브 재시작 등 — 빈 임대면 다시 쥔다(다른 기기·창이 쥐었으면 holder:false 그대로, resume 없음)
  }

  return {
    async start({ resume = true } = {}) {
      if (timer != null) timers.clearInterval(timer);
      id = newId();
      holder = false;
      until = null;
      okAt = null;
      failed = false;
      lastHttp = null;
      resumeWant = resume === true;
      timer = timers.setInterval(() => { tick(); }, LEASE_RENEW_MS);
      await op('claim', { resume: resume === true });
      // 옛 허브(resume 키를 모름 → 400 bad_request): resume 없이 바로 한 번 더(허브보다 앱을 먼저 게시해도 30초 기다리지 않게)
      if (resume === true && okAt == null && lastHttp === 400) await op('claim');
      return holder;
    },
    stop({ release = true } = {}) {
      if (timer != null) timers.clearInterval(timer);
      timer = null;
      if (release && id && holder) op('release'); // 기다리지 않는다 — 실패해도 90초 뒤 풀린다
      id = null;
      holder = false;
      until = null;
      okAt = null;
      failed = false;
      resumeWant = false;
      onChange(state());
    },
    async force() {
      if (!id) return false;
      await op('claim', { force: true });
      return holder;
    },
    renewNow: () => tick(),
    held,
    status() {
      if (held()) return 'held';
      if (!id || okAt == null || failed || now() - okAt > LEASE_FRESH_MS) return 'checking';
      // holder:false·until:null = 아무도 쥐지 않음(허브 재시작·임대 만료 — 바로 뒤 claim이 다시 쥔다). 다른 기기가 쥐었을 때만 until이 있다
      return holder || until == null ? 'checking' : 'refused';
    },
    offset: () => medianOffset(samples),
    id: () => id,
    state,
  };
}

// 같은 브라우저의 다른 탭·창(§5.1) — 잡으면 release()로 놓는다. navigator.locks가 없으면(iOS 15.4 미만) 임대만으로 판정
export function acquireTabLock(nav = globalThis.navigator) {
  if (!nav || !nav.locks || typeof nav.locks.request !== 'function') return Promise.resolve({ ok: true, held: false, release: () => {} });
  return new Promise((resolve) => {
    let release = () => {};
    const hold = new Promise((r) => { release = r; });
    Promise.resolve(nav.locks.request('ptf-follow', { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve({ ok: false, held: false, release: () => {} });
        return undefined;
      }
      resolve({ ok: true, held: true, release: () => release() });
      return hold;
    })).catch(() => resolve({ ok: true, held: false, release: () => {} }));
  });
}
