// UID 인증·회원 토큰(설계 3-2 §3.1~§3.4, 문구 §8.1 V-01~V-19b).
// - UID 원문은 기기에도 저장하지 않는다: uidHash(SHA-256('ptf-uid|'+정규화 UID), 허브 해시와 다름)와 끝 4자만.
// - 허브 요청은 credentials 'omit' · cache 'no-store' · mode 'cors'. 토큰은 Authorization 머리글로만(주소·로컬 저장소·사무실 iframe에 넣지 않음).
// - 기한(exp)은 이 기기 시계로 판단하지 않는다 — 휴대폰 시계가 틀려도 인증이 풀리지 않게, 만료는 허브의 401(token_expired)로만 안다.
import { fmtMD } from './auto-view.js';

export const TEST_UID_RE = /^TEST-[A-HJ-NP-Z2-9]{6}$/;
export const REAL_UID_RE = /^[0-9A-Z]{4,24}$/;
export const TOKEN_RE = /^pm1\.[A-Za-z0-9_-]{43}$/;
export const DEVICE_RE = /^[A-Za-z0-9_-]{22}$/;
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 해제·만료 뒤 '정리만' 유예(§3.3)
export const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000; // 켤 때 + 켜져 있는 동안 12시간마다(§3.3)
export const OPEN_TRADE_STATES = Object.freeze(['opening', 'open', 'closing']); // 장부에서 거래소에 남아 있는 매매(§6.4)

export const VTEXT = Object.freeze({
  title: 'UID 인증', // V-01
  // p34 §6.5 — 동업자 최신판 UID 활성화 창(index.html:362-378) 문구·단계 그대로, '활성화'만 '인증'(열린 질문 3)
  gateTitle: '◆ 오렌지엑스 UID 인증 ◆',
  gateDesc: '오렌지엑스 UID를 입력하면 자동으로 확인합니다.',
  gateWhy: '프로그램 이용료는 없습니다. 전용 서버 인프라와 해외 리서치 수급에 드는 운영 비용, 타 업체 무단 사용 방지를 위해 인증된 계정에만 정식 기능이 열립니다.',
  intro: '인증되면 이 기기에서 가격 정보와 사무실의 실계좌 매매 기록 중계가 열립니다.', // V-02(p34에서 줄임 — p37 D3: 중계 사무실도 데모와 같은 입력칸 + ▶ ANALYZE라 따로 열리는 분석 버튼 없음)
  placeholder: '오렌지엑스 UID',
  signup: '▶ 오렌지엑스 리치 할인 코드 가입', // 동업자 문구 그대로(결정 10) — 그 판 signupUrl만
  appGuide: '▶ 오렌지엑스 거래소 앱 받기', // 가입 줄 바로 아래 — 앱 받기 창(app/screens/app-guide.js, 맨 위에 그 판 가입 단계). 대표 결정 2026-10-09: 첫 안내 장 대신 여기서
  depositGuide: '▶ 입금·사용 가이드', // 명단에 없음 뒤 — guide/ox-deposit.pdf(동업자 guide.pdf 그대로)
  or: '또는',
  guest: '체험 모드로 시작',
  foot: 'UID는 오렌지엑스 앱 › 프로필에서 확인', // 옛 V-03(같은 뜻)을 대신함
  label: 'UID', // V-04(입력칸 aria-label)
  submit: '▶ 인증하기', // V-05
  pending: '확인 중…', // V-05
  privacy: 'UID는 확인에만 쓰고, 서버에는 원래 숫자를 남기지 않습니다. UID 하나로 기기 3대까지 인증됩니다.', // V-06
  ok: '인증됐습니다. 가격 정보와 사무실 탭의 실계좌 매매 기록 화면이 열렸습니다.', // V-07
  okTest: (md) => `시험용 인증입니다(${md}까지). 시험 신호(리허설)도 함께 받습니다.`, // V-08
  okTestNoDate: '시험용 인증입니다. 시험 신호(리허설)도 함께 받습니다.',
  notVerified: '명단에서 확인되지 않았습니다. UID를 다시 확인해 주세요. 가입 직후라면 반영까지 시간이 걸릴 수 있습니다. 계속 안 되면 문의해 주세요.', // V-09
  contact: '문의하기(카카오톡 채널)', // V-09·V-15 버튼
  badFormat: 'UID 형식이 아닙니다. 오렌지엑스 UID(숫자) 또는 안내받은 시험 코드를 넣어 주세요.', // V-10
  limited: (min) => `시도가 많아 잠시 막혔습니다. ${min}분 뒤 다시 해 주세요.`, // V-11
  unavailable: '지금은 회원 명단을 확인할 수 없습니다. 잠시 뒤 다시 해 주세요.', // V-12
  network: '서버에 연결되지 않습니다. 인터넷 연결을 확인해 주세요.', // V-13
  removed: '회원 명단에서 확인되지 않아 이 기기 인증이 해제됐습니다. 다시 인증해 주세요.', // V-14
  deviceLimit: '이 UID는 이미 기기 3대에서 인증돼 있습니다. 쓰지 않는 기기에서 인증을 해제하거나 문의해 주세요.', // V-15
  expired: '인증 기간이 끝났습니다. 다시 인증해 주세요.', // V-16
  testEnded: '시험용 인증이 끝났습니다.', // V-17
  revokedOther: '이 기기 인증이 해제됐습니다. 다시 인증해 주세요.', // 사유가 명단·기간이 아닐 때(관리 해제·로그아웃·모름) — V-14에서 사유만 뺀 문장
  rowLabel: 'UID 인증', // V-18
  rowOn: (tail) => `인증됨 · UID …${tail}`,
  rowTest: (md) => `시험용 인증 · ${md}까지`,
  rowTestNoDate: '시험용 인증',
  rowOff: '안 됨',
  logout: '이 기기 인증 해제', // V-19
  logoutConfirm: '이 기기의 UID 인증을 해제할까요? 가격 정보·사무실 실계좌 기록 화면·따라가기가 꺼집니다.',
  logoutOpen: (n) => `따라가기로 연 포지션 ${n}건이 거래소에 남아 있습니다. 해제한 뒤에는 7일 동안 '내 포지션 정리'만 할 수 있고, 그 뒤에는 거래소 앱에서 직접 정리해야 합니다.`, // V-19b
  // 이미 인증된 기기의 인증 화면 — 입력칸 대신(다른 UID로 덮어쓰면 옛 토큰이 정리 유예 없이 기기 칸만 30일 차지). 설계 §8.1에 없는 줄 — 허브 트랙 설계 개정 때 추가 요청
  verifiedHint: "이 기기는 이미 인증돼 있습니다. 다른 UID로 바꾸려면 설정에서 '이 기기 인증 해제'를 먼저 눌러 주세요.",
});

// 붙여 넣은 값 정리: 전각→반각(NFKC), 여러 대시→'-', 공백·줄바꿈·보이지 않는 글자 제거, 대문자
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const INVISIBLE = /[\s\u200B-\u200D\u2060\uFEFF]+/g;
export function normalizeUid(raw) {
  return String(raw ?? '').normalize('NFKC').replace(DASHES, '-').replace(INVISIBLE, '').toUpperCase();
}

export function uidKind(uid) {
  if (TEST_UID_RE.test(uid)) return 'test';
  if (REAL_UID_RE.test(uid)) return 'real';
  return null;
}

export async function uidHash(uid, subtle = globalThis.crypto.subtle) {
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(`ptf-uid|${uid}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const uidTail = (uid) => String(uid).slice(-4);

export function newDeviceId(cryptoImpl = globalThis.crypto) {
  const b = new Uint8Array(16);
  cryptoImpl.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function memberHeaders(token, version) {
  return { Authorization: `Bearer ${token}`, 'X-Ptf-App-Version': String(version ?? '') };
}

const FETCH_OPTS = Object.freeze({ cache: 'no-store', mode: 'cors', credentials: 'omit' });
const hubBase = (hub) => String(hub).replace(/\/+$/, '');
async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
function retryAfterSec(res) {
  const v = res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60;
}

export async function verifyUid({ hub, uid, edition, device, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 15000 }) {
  let res;
  try {
    res = await fetchImpl(`${hubBase(hub)}/v1/member/verify`, {
      ...FETCH_OPTS,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, edition, device }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { status: 'network' };
  }
  if (!res) return { status: 'network' };
  if (res.status === 429) return { status: 'rate_limited', retryAfterSec: retryAfterSec(res) };
  if (res.status === 503) return { status: 'unavailable' };
  if (res.status === 400) return { status: 'bad_format' };
  const body = await readJson(res);
  if (!res.ok || !body || typeof body !== 'object') return { status: 'error', httpStatus: res.status };
  if (body.ok === true && typeof body.token === 'string' && TOKEN_RE.test(body.token) && Number.isFinite(body.exp)) {
    return { status: 'ok', token: body.token, exp: body.exp, test: body.test === true, testUntil: Number.isFinite(body.testUntil) ? body.testUntil : null };
  }
  if (body.ok === false && body.error === 'not_verified') return { status: 'not_verified' };
  if (body.ok === false && body.error === 'device_limit') return { status: 'device_limit' };
  return { status: 'error', httpStatus: res.status };
}

export async function refreshToken({ hub, token, version, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 15000 }) {
  let res;
  try {
    res = await fetchImpl(`${hubBase(hub)}/v1/member/refresh`, { ...FETCH_OPTS, method: 'POST', headers: memberHeaders(token, version), signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { status: 'network' };
  }
  if (!res) return { status: 'network' };
  const body = await readJson(res);
  if (res.status === 401) return { status: 'unauthorized', body };
  if (!res.ok || !body || body.ok !== true) return { status: 'error' };
  if (body.token === null) return { status: 'same' };
  if (typeof body.token === 'string' && TOKEN_RE.test(body.token) && Number.isFinite(body.exp)) return { status: 'new', token: body.token, exp: body.exp };
  return { status: 'error' };
}

export async function logoutToken({ hub, token, version, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 8000 }) {
  try {
    const res = await fetchImpl(`${hubBase(hub)}/v1/member/logout`, { ...FETCH_OPTS, method: 'POST', headers: memberHeaders(token, version), signal: AbortSignal.timeout(timeoutMs) });
    return !!res && res.ok === true;
  } catch {
    return false;
  }
}

// 401 본문 → 사유·문구(§3.3 해제 사유: list·dropped·test_removed·logout·admin, 기한 지남 token_expired)
export function revokeInfo(body, member) {
  const b = body && typeof body === 'object' ? body : {};
  const test = !!(member && member.test);
  if (b.error === 'token_expired') return { reason: 'expired', message: test ? VTEXT.testEnded : VTEXT.expired };
  if (b.error === 'token_revoked') {
    if (b.reason === 'test_removed') return { reason: 'test_removed', message: VTEXT.testEnded };
    if (b.reason === 'list' || b.reason === 'dropped') return { reason: b.reason, message: VTEXT.removed };
    return { reason: typeof b.reason === 'string' ? b.reason : 'revoked', message: VTEXT.revokedOther };
  }
  return { reason: 'invalid', message: VTEXT.revokedOther };
}

// verifyUid 결과(또는 { status: 'bad_format' }) → 화면 안내. 거절은 카카오 문의 버튼을 함께(V-09·V-15)
export function verifyMessage(r, config = {}) {
  const kakao = config && typeof config.kakao === 'string' && /^https:\/\//.test(config.kakao) ? config.kakao : null;
  const msg = (ok, tone, text, contact = null) => ({ ok, tone, text, contact });
  switch (r && r.status) {
    case 'ok': {
      if (!r.test) return msg(true, 'good', VTEXT.ok);
      const md = fmtMD(r.testUntil);
      return msg(true, 'good', md ? VTEXT.okTest(md) : VTEXT.okTestNoDate);
    }
    case 'not_verified': return msg(false, 'bad', VTEXT.notVerified, kakao);
    case 'device_limit': return msg(false, 'bad', VTEXT.deviceLimit, kakao);
    case 'bad_format': return msg(false, 'bad', VTEXT.badFormat);
    case 'rate_limited': return msg(false, 'warn', VTEXT.limited(Math.max(1, Math.ceil((Number(r.retryAfterSec) || 60) / 60))));
    case 'unavailable':
    case 'error': return msg(false, 'warn', VTEXT.unavailable);
    default: return msg(false, 'warn', VTEXT.network);
  }
}

export function memberRowText(member) {
  if (!member) return VTEXT.rowOff;
  if (member.test) {
    const md = fmtMD(member.testUntil);
    return md ? VTEXT.rowTest(md) : VTEXT.rowTestNoDate;
  }
  return VTEXT.rowOn(member.uidTail);
}

export function logoutConfirmText(openCount) {
  return Number.isInteger(openCount) && openCount > 0 ? `${VTEXT.logoutConfirm}\n\n${VTEXT.logoutOpen(openCount)}` : VTEXT.logoutConfirm;
}

export function validMember(m, edition) {
  return !!m && typeof m === 'object'
    && typeof m.token === 'string' && TOKEN_RE.test(m.token)
    && m.ed === edition
    && typeof m.uidHash === 'string' && /^[0-9a-f]{64}$/.test(m.uidHash)
    && typeof m.uidTail === 'string' && m.uidTail.length >= 1 && m.uidTail.length <= 4
    && typeof m.test === 'boolean';
}

export async function memberFromVerify(r, uid, edition, subtle = globalThis.crypto.subtle) {
  return { token: r.token, exp: r.exp, test: r.test === true, testUntil: r.testUntil ?? null, uidHash: await uidHash(uid, subtle), uidTail: uidTail(uid), ed: edition };
}

// 기기 저장(kv.member·kv.device·kv.memberGrace, 장부 읽기) — 저장소 오류는 던지지 않는다(인증 화면이 멈추지 않게)
export function createMemberSession({ vault, edition, now = () => Date.now(), cryptoImpl = globalThis.crypto }) {
  const get = async (k) => {
    try {
      return await vault.get(k);
    } catch {
      return undefined;
    }
  };
  const set = async (k, v) => {
    try {
      return await vault.set(k, v);
    } catch {
      return false;
    }
  };
  const del = async (k) => {
    try {
      return await vault.del(k);
    } catch {
      return false;
    }
  };
  let memDevice = null; // 저장이 안 되는 저장소에서도 이번 실행 동안 같은 기기 값
  return {
    async load() {
      const m = await get('member');
      return validMember(m, edition) ? m : null;
    },
    async save(m) {
      return set('member', m);
    },
    async drop(m) {
      if (m && typeof m.token === 'string') await set('memberGrace', { token: m.token, until: now() + GRACE_MS });
      await del('member');
    },
    async device() {
      const d = await get('device');
      if (typeof d === 'string' && DEVICE_RE.test(d)) return d;
      if (!memDevice) memDevice = newDeviceId(cryptoImpl);
      await set('device', memDevice);
      return memDevice;
    },
    async grace() {
      const g = await get('memberGrace');
      if (!g || typeof g !== 'object' || typeof g.token !== 'string') return null;
      if (!(typeof g.until === 'number' && g.until > now())) {
        await del('memberGrace');
        return null;
      }
      return g;
    },
    async openTrades() {
      let all = [];
      try {
        all = await vault.ledgerAll();
      } catch {
        all = [];
      }
      return (Array.isArray(all) ? all : []).filter((t) => t && OPEN_TRADE_STATES.includes(t.state)).length;
    },
  };
}
