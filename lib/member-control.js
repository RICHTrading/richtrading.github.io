// UID 인증 상태(설계 3-2 §3.1·§3.3·§3.4) — 처음 불러오기·인증·12시간마다 갱신·401 해제·로그아웃.
// 화면은 onChange({ member, notice, verify })로만 안다. 담당자판(s·j)이 아니면 아무것도 하지 않는다.
// epoch = 지금 회원(토큰)의 세대. 새 인증이 성공해 회원이 바뀌거나 해제·로그아웃할 때만 올린다 — 그 전에 시작한 갱신 응답은 버린다
//   (끝난 인증이 되살아나지 않게). 인증 요청을 보냈다는 것만으로는 올리지 않는다.
// '인증하기'는 응답이 올 때까지 한 번만 보낸다(기기별 하루 10회 제한을 헛되이 쓰지 않게). 이미 인증된 기기에서는 아무것도 하지 않는다 —
//   다른 UID로 덮어쓰면 옛 토큰이 정리 유예(memberGrace) 없이 기기 칸만 30일 차지하므로, 바꾸려면 먼저 '이 기기 인증 해제'.
// 갱신(§3.3): 켤 때 + 12시간마다 + 화면으로 돌아왔을 때 마지막 성공에서 12시간이 지났으면(resume — 뒤로 간 앱은 타이머가 멈춘다).
//   한 번에 하나(refreshing) — 겹쳐 부르면 같은 요청을 기다린다(새 토큰이 둘 생겨 하나가 기기 칸을 30일 차지하지 않게).
//   네트워크·서버 오류면 30초·2분·5분 뒤 다시(합 7분 30초) — 허브가 이미 새 토큰을 냈는데 응답만 잃었어도
//   옛 토큰이 살아 있는 10분 안에 새 토큰을 받는다(허브는 겹치는 동안 옛 토큰의 같은 갱신에 같은 새 토큰을 준다 — 허브 트랙에 요청).
//   세 번 다 실패하면 다음 12시간·화면 복귀까지 쉰다. 네트워크 실패로는 해제하지 않는다(해제는 401로만).
// 같은 판 탭 여러 개(기기 저장소 하나, 통합 보고 7 — 허브는 갱신마다 새 토큰을 내고 앞 토큰을 지운다):
//   - 갱신은 탭끼리 잠금(Web Locks 'ptf-<판>-member-refresh') 안에서: 저장소를 다시 읽어 다른 탭이 이미 바꿨으면 그 토큰을 쓰고(요청 없음),
//     아니면 요청 → 새 토큰을 잠금 안에서 저장 → 다른 탭에 알림(BroadcastChannel, 토큰 없이 — 받은 탭은 저장소에서 다시 읽음)
//   - 잠금이 없는 브라우저에서 겹쳐 401을 받거나 회원 연결이 옛 토큰으로 401을 받아도, 저장소에 같은 UID의 다른 토큰이 있으면 해제하지 않고 그것을 쓴다
import { memberCapable } from './auto-view.js';
import {
  normalizeUid, uidKind, verifyUid, refreshToken, logoutToken, revokeInfo, verifyMessage, memberFromVerify, logoutConfirmText, REFRESH_EVERY_MS,
} from './member.js';

export const REFRESH_RETRY_MS = Object.freeze([30000, 120000, 300000]);
export const REFRESHED_MSG = Object.freeze({ type: 'ptf:member-refreshed', v: 1 }); // 탭 사이 알림 — 토큰은 싣지 않는다(보안 규칙 12)
export const refreshLockName = (edition) => `ptf-${edition}-member-refresh`;
export const memberChannelName = (edition) => `ptf-${edition}-member`;

// locks: navigator.locks(없으면 null — iOS 15.4 미만 등), channel: BroadcastChannel(memberChannelName) 또는 null — app.js가 넣는다
export function createMemberControl({
  config,
  session,
  fetchImpl = (...a) => globalThis.fetch(...a),
  timers = globalThis,
  now = () => Date.now(),
  subtle = globalThis.crypto && globalThis.crypto.subtle,
  locks = null,
  channel = null,
  onChange = () => {},
}) {
  const capable = memberCapable(config);
  let member = null;
  let notice = null; // 해제 사유 문구(V-14·V-16·V-17) — 다시 인증하면 지운다
  let verify = { pending: false, message: null };
  let epoch = 0;
  let timer = null; // 12시간 주기
  let retryTimer = null; // 실패 뒤 다시
  let retries = 0;
  let refreshing = null; // { member, p } — 진행 중인 갱신(한 번에 하나)
  let lastRefreshAt = null; // 마지막 갱신 성공('new'·'same') 시각
  const emit = () => onChange({ member, notice, verify });

  // 탭 잠금 — 없으면 그냥 실행(저장소 다시 읽기·401 때 다시 읽기가 받친다)
  function withLock(fn) {
    if (locks && typeof locks.request === 'function') {
      try {
        return Promise.resolve(locks.request(refreshLockName(config.edition), () => fn()));
      } catch {
        // 잠금 API 오류 — 잠금 없이
      }
    }
    return fn();
  }
  // 저장소의 회원이 지금 회원과 같은 UID인데 토큰이 다르면(다른 탭이 갱신) 그것
  const newerStored = (s, cur) => (s && cur && s.token !== cur.token && s.uidHash === cur.uidHash && s.ed === cur.ed ? s : null);
  function adopt(s) {
    member = s;
    retries = 0;
    clearRetry();
    lastRefreshAt = now();
    emit();
  }
  // 다른 탭이 갱신했다는 알림 — 저장소에서 다시 읽는다
  async function adoptStored() {
    const cur = member;
    if (!cur) return false;
    const e = epoch;
    const s = newerStored(await session.load(), cur);
    if (!s || e !== epoch || member !== cur) return false;
    adopt(s);
    return true;
  }
  function announce() {
    try {
      if (channel) channel.postMessage({ ...REFRESHED_MSG }); // 고정 모양뿐 — 토큰 없음
    } catch {
      // 알림 실패 — 다른 탭은 다음 갱신·401 때 저장소를 다시 읽는다
    }
  }
  if (channel && capable) {
    channel.onmessage = (m) => {
      if (m && m.data && m.data.type === REFRESHED_MSG.type) adoptStored().catch(() => {});
    };
  }

  function clearRetry() {
    if (retryTimer != null) {
      timers.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }
  function stopRefresh() {
    if (timer != null) {
      timers.clearInterval(timer);
      timer = null;
    }
    clearRetry();
    retries = 0;
    lastRefreshAt = null;
  }
  function startRefresh() {
    stopRefresh();
    // 12시간 주기 — 그 사이 다른 탭의 갱신을 받아 썼으면(adopt, 6시간 안) 이번은 건너뜀(같은 토큰으로 탭마다 다시 묻지 않게)
    timer = timers.setInterval(() => {
      if (lastRefreshAt != null && now() - lastRefreshAt < REFRESH_EVERY_MS / 2) return;
      refresh();
    }, REFRESH_EVERY_MS);
  }

  async function init() {
    if (!capable) return null;
    member = await session.load();
    emit();
    if (member) {
      startRefresh();
      refresh(); // 켤 때 한 번 — 기다리지 않는다(허브가 늦어도 화면·연결은 바로)
    }
    return member;
  }

  async function submit(raw) {
    if (!capable || verify.pending || member) return verify;
    const uid = normalizeUid(raw);
    if (!uidKind(uid)) {
      verify = { pending: false, message: verifyMessage({ status: 'bad_format' }, config) };
      emit();
      return verify;
    }
    verify = { pending: true, message: null };
    emit();
    const e = epoch;
    let r;
    try {
      const device = await session.device();
      r = await verifyUid({ hub: config.hub, uid, edition: config.edition, device, fetchImpl });
      if (e !== epoch || member) {
        verify = { pending: false, message: null };
        emit();
        return verify;
      }
      if (r.status === 'ok') {
        const m = await memberFromVerify(r, uid, config.edition, subtle);
        await session.save(m);
        epoch += 1; // 회원이 바뀜 — 그 전의 갱신 응답은 버린다
        member = m;
        notice = null;
        startRefresh();
        lastRefreshAt = now(); // 갓 받은 30일 토큰 — 12시간 뒤부터 갱신 확인
      }
    } catch {
      r = { status: 'error' };
    }
    verify = { pending: false, message: verifyMessage(r, config) };
    emit();
    return verify;
  }

  function refresh() {
    if (!member) return Promise.resolve();
    if (refreshing && refreshing.member === member) return refreshing.p;
    const used = member;
    const e = epoch;
    clearRetry();
    const p = (async () => {
      // 탭 잠금 안: 저장소를 다시 읽고(다른 탭이 이미 바꿨으면 그 토큰) → 요청 → 새 토큰은 잠금을 놓기 전에 저장(기다리던 탭이 읽게)
      const r = await withLock(async () => {
        if (e !== epoch || member !== used) return { status: 'stale' };
        const stored = newerStored(await session.load(), used);
        if (e !== epoch || member !== used) return { status: 'stale' };
        if (stored) return { status: 'adopt', member: stored };
        const res = await refreshToken({ hub: config.hub, token: used.token, version: config.version, fetchImpl });
        if (res.status === 'new' && e === epoch && member === used) {
          const next = { ...used, token: res.token, exp: res.exp };
          await session.save(next);
          return { ...res, member: next };
        }
        return res;
      });
      if (r.status === 'stale' || e !== epoch || member !== used) return; // 그사이 해제·로그아웃·다시 인증·다른 탭 토큰 — 옛 응답은 버린다
      if (r.status === 'adopt') {
        adopt(r.member);
      } else if (r.status === 'new') {
        retries = 0;
        lastRefreshAt = now();
        member = r.member;
        emit();
        announce();
      } else if (r.status === 'same') {
        retries = 0;
        lastRefreshAt = now();
      } else if (r.status === 'unauthorized') {
        await revoked(r.body, used.token);
      } else if (retries < REFRESH_RETRY_MS.length) {
        const delay = REFRESH_RETRY_MS[retries];
        retries += 1;
        retryTimer = timers.setTimeout(() => {
          retryTimer = null;
          refresh();
        }, delay);
      } else {
        retries = 0; // 다음 12시간·화면 복귀 때 다시
      }
    })().finally(() => {
      if (refreshing && refreshing.p === p) refreshing = null;
    });
    refreshing = { member: used, p };
    return p;
  }

  // 화면으로 돌아왔을 때(app.js의 visibilitychange) — 뒤로 간 휴대폰 앱은 12시간 타이머가 멈춰 있을 수 있다
  function resume() {
    if (!member || refreshing || retryTimer != null) return;
    if (lastRefreshAt != null && now() - lastRefreshAt < REFRESH_EVERY_MS) return;
    refresh();
  }

  // 회원 연결·갱신이 받은 401 — 그 토큰이 지금 토큰일 때만 해제한다(바뀐 뒤의 옛 토큰 401은 무시)
  // 같은 판 다른 탭이 갱신해 저장소에 같은 UID의 새 토큰이 있으면 해제하지 않고 그것을 쓴다(옛 토큰의 401 — token_invalid)
  async function revoked(body, token) {
    if (!member || (typeof token === 'string' && token !== member.token)) return false;
    const m = member;
    const stored = newerStored(await session.load(), m);
    if (member !== m) return false; // 그사이 바뀜(다른 401·로그아웃·알림으로 새 토큰)
    if (stored) {
      adopt(stored);
      return false;
    }
    epoch += 1;
    member = null;
    stopRefresh();
    notice = revokeInfo(body, m).message;
    await session.drop(m);
    emit();
    return true;
  }

  async function logout({ confirm = () => false } = {}) {
    const m = member;
    if (!m) return false;
    const n = await session.openTrades();
    if (member !== m || !confirm(logoutConfirmText(n))) return false;
    epoch += 1;
    member = null;
    notice = null;
    stopRefresh();
    logoutToken({ hub: config.hub, token: m.token, version: config.version, fetchImpl }); // 서버 응답과 상관없이 기기 쪽은 해제
    await session.drop(m);
    emit();
    return true;
  }

  return { init, submit, refresh, resume, revoked, logout, state: () => ({ member, notice, verify }) };
}
