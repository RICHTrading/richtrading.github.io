// 주문 알림 구독(설계 2026-10-23 §3) — 서버 판(serverBuildReady)만 쓴다. 허브 GET /v1/member/push로 공개키·켜짐을 받고,
// 켜기 = (사용자 손짓 안에서 먼저) Notification.requestPermission → pushManager.subscribe(공개키) → POST /v1/member/push,
// 끄기 = subscription.unsubscribe + DELETE. 회원 토큰은 Authorization 머리글로만(주소·저장소 없음 — 보안 규칙 12).
// 지원 안 되는 기기(PushManager 없음 — iOS 사파리 탭·16.4 미만)는 홈 화면 앱 안내 한 줄
export const PUSH_TEXT = Object.freeze({
  label: '주문 알림',
  on: '주문 알림 받기',
  off: '주문 알림 끄기',
  onLine: '켜짐 · 주문이 나가면 알림',
  offLine: '앱을 닫아도 주문을 알려 드립니다',
  needHome: '홈 화면에 추가한 앱에서 켤 수 있습니다',
  denied: '기기 설정에서 알림을 허용해 주세요',
  fail: '알림을 켜지 못했습니다',
  offFail: '알림을 끄지 못했습니다',
});
const KEY_RE = /^[A-Za-z0-9_-]{87}$/;

export function b64uToBytes(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = globalThis.atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
const bytesToB64u = (buf) => {
  const a = new Uint8Array(buf);
  let bin = '';
  for (const x of a) bin += String.fromCharCode(x);
  return globalThis.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// 기기 능력 → 'ok' | 'need_home' | 'denied'
export function pushSupport(env, permission) {
  if (!env || env.sw !== true || env.push !== true || env.notif !== true) return 'need_home';
  return permission === 'denied' ? 'denied' : 'ok';
}
export const pushEnv = (win = globalThis.window, nav = globalThis.navigator) => ({
  sw: !!nav && 'serviceWorker' in nav, push: !!win && 'PushManager' in win, notif: !!win && 'Notification' in win,
});

// 화면 모델 — 허브가 꺼져 있으면(이 기기 구독도 없으면) 줄을 숨긴다
export function pushRowModel(st) {
  const s = st || {};
  if (!s.hubOn && !s.subscribed) return { show: false, line: '', btn: null, disabled: false, msg: '' };
  const base = { show: true, disabled: !!s.busy, msg: s.msg || '' };
  if (s.subscribed) return { ...base, line: PUSH_TEXT.onLine, btn: 'off' };
  if (s.support === 'need_home') return { ...base, line: PUSH_TEXT.needHome, btn: null };
  if (s.support === 'denied') return { ...base, line: PUSH_TEXT.denied, btn: null };
  return { ...base, line: PUSH_TEXT.offLine, btn: 'on' };
}

export function createPushClient({ hub, getToken = () => null, fetchImpl = globalThis.fetch, swReady = async () => null, Notif = globalThis.Notification ?? null, env = pushEnv(), timeoutMs = 8000 } = {}) {
  const url = `${String(hub).replace(/\/+$/, '')}/v1/member/push`;
  const perm = () => (Notif && typeof Notif.permission === 'string' ? Notif.permission : 'default');
  const st = { support: pushSupport(env, perm()), hubOn: false, key: null, subscribed: false, busy: false, msg: '' };
  const subs = new Set();
  const emit = () => { for (const fn of [...subs]) { try { fn({ ...st }); } catch { /* 화면 오류 무시 */ } } };

  async function call(method, body) {
    const token = getToken();
    if (typeof token !== 'string' || !token) return null;
    try {
      const res = await fetchImpl(url, {
        method, mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let j = null;
      try {
        j = await res.json();
      } catch {
        j = null;
      }
      return { status: res.status, body: j };
    } catch {
      return null;
    }
  }
  async function pm() {
    try {
      const reg = await swReady();
      return reg && reg.pushManager ? reg.pushManager : null;
    } catch {
      return null;
    }
  }
  const keyOf = (sub) => {
    try {
      const k = sub && sub.options && sub.options.applicationServerKey;
      return k ? bytesToB64u(k) : null;
    } catch {
      return null;
    }
  };
  const bodyOf = (sub) => {
    const j = sub.toJSON();
    return { v: 1, endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
  };
  async function info() {
    const r = await call('GET');
    const b = r && r.status === 200 && r.body && r.body.ok === true ? r.body : null;
    st.hubOn = !!b && b.on === true && KEY_RE.test(String(b.key));
    st.key = st.hubOn ? b.key : null;
    return b;
  }

  async function refresh() {
    st.support = pushSupport(env, perm());
    const b = await info();
    if (st.support === 'need_home' || !b) {
      st.subscribed = false;
      emit();
      return;
    }
    const m = await pm();
    const sub = m ? await m.getSubscription().catch(() => null) : null;
    st.subscribed = !!sub && st.hubOn && keyOf(sub) === st.key && perm() === 'granted';
    // 허브가 이 회원 구독을 잊었으면(404·410·키 교체 뒤 등) 같은 키로 구독된 이 기기를 조용히 다시 알린다
    if (st.subscribed && b.n === 0) {
      const r = await call('POST', bodyOf(sub));
      if (!r || r.status !== 200) st.subscribed = false;
    }
    emit();
  }

  // 반드시 누른 그 자리에서 부를 것 — 첫 await 전에 권한을 묻는다(iOS·크롬은 사용자 손짓 안에서만 허락 창을 띄움)
  function enable() {
    if (st.busy) return Promise.resolve();
    st.support = pushSupport(env, perm());
    if (st.support !== 'ok' || !Notif || typeof Notif.requestPermission !== 'function') {
      emit();
      return Promise.resolve();
    }
    let asked;
    try {
      asked = Promise.resolve(Notif.requestPermission());
    } catch {
      asked = Promise.resolve('default');
    }
    st.busy = true;
    st.msg = '';
    emit();
    return (async () => {
      try {
        const p = await asked;
        if (p !== 'granted') {
          st.support = pushSupport(env, perm() === 'denied' || p === 'denied' ? 'denied' : perm());
          if (st.support === 'ok') st.msg = PUSH_TEXT.fail;
          return;
        }
        if (!st.key) await info();
        const m = await pm();
        if (!st.hubOn || !m) {
          st.msg = PUSH_TEXT.fail;
          return;
        }
        let sub = await m.getSubscription().catch(() => null);
        if (sub && keyOf(sub) !== st.key) {
          await sub.unsubscribe().catch(() => false);
          sub = null;
        }
        if (!sub) sub = await m.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(st.key) });
        const r = await call('POST', bodyOf(sub));
        if (r && r.status === 200) st.subscribed = true;
        else {
          await sub.unsubscribe().catch(() => false);
          st.subscribed = false;
          st.msg = PUSH_TEXT.fail;
        }
      } catch {
        st.msg = PUSH_TEXT.fail;
      } finally {
        st.busy = false;
        emit();
      }
    })();
  }

  async function disable() {
    if (st.busy) return;
    st.busy = true;
    st.msg = '';
    emit();
    try {
      const m = await pm();
      const sub = m ? await m.getSubscription().catch(() => null) : null;
      if (sub) {
        const ep = sub.endpoint;
        await sub.unsubscribe().catch(() => false);
        const r = await call('DELETE', { v: 1, endpoint: ep });
        if (!r || r.status !== 200) st.msg = PUSH_TEXT.offFail;
      }
      st.subscribed = false;
    } catch {
      st.msg = PUSH_TEXT.offFail;
    } finally {
      st.busy = false;
      emit();
    }
  }

  return {
    state: () => ({ ...st }),
    refresh,
    enable,
    disable,
    onChange(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
