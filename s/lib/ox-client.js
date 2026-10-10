// 오렌지엑스 주문 경로(설계 3-2 §5.4~§5.8) — 권한 허용 목록·계정 일치·위험 증가 판정(순수 함수)과 로그인·호출(createOxClient, 아래).
// - 로그인(2026-10-08 개정): 기본 client_credentials(config.oxAuth 'credentials' — 실측으로 이것만 됨), 'signature'로 서명 방식으로 되돌릴 수 있다.
//   자격은 봉인({ clientId, ct, iv, sealKey } — vault.js)만 쥐고, 원문은 /public/auth 바로 앞에서 풀어 이 기기 → 오렌지엑스 WS로만 보낸 뒤 버린다.
//   비밀 키 원문은 허브·기록·주소·브라우저 저장소·사무실 iframe 어디로도 가지 않는다.
// - 접속 토큰(access_token)은 메모리에만. refresh_token은 버린다(다시 받을 때도 같은 방식으로 로그인). 기록(console)·저장소·주소에 넣지 않는다.
// - 기본은 허브 중계(POST /v1/ox). 로그인 뒤 WS로 /private/get_account_msg가 되면 WS 직접(토큰이 허브를 지나지 않음, §5.5).
//   한 번 'ws'로 정했어도 어떤 호출이 1000·8121(처리 안 됨)을 받으면 그 호출만 중계로 다시 보내고 이 실행 동안 'relay'로 내린다.
// - WS 직접일 때 위험을 늘리는 주문 직전마다 허브 POST /v1/member/follow/check(2초, X-Ptf-Coid·X-Ptf-Inst — 허브 계약 FOLLOW_CHECK_HEADERS)
//   — enabled && holder가 아니면 내지 않고 허브 reason(shadow·not_allowed 등)을 그대로 돌려준다.
//   허브 /v1/ox의 같은 식별자 24시간 한 번(409 duplicate_order)도 WS 직접에서 앱이 같게 지킨다(kind 'duplicate').
// - 수동 의도(p40, 2e spec §5.8): call(…, { intent: 'manual' })이면 중계에 X-Ptf-Intent: manual(403 manual_disabled → blocked 사유),
//   WS 직접이면 위험 증가 직전 follow/check 대신 POST /v1/member/manual/check(임대 없음, 본문 { v, method, inst, lev?, coid? }).
// - 허용 목록 밖 메서드는 어디로도 보내지 않는다(허브 §5.6 표와 같은 13개 — 출금·이체·주소·키 관리·카피·블록 거래·cancel_all 없음).
//   파라미터도 두 경로 모두 허브와 같은 규칙으로 보내기 전에 검사한다(validateOxParams — WS 직접이 허브 규칙을 비켜 가지 않게).
// - 접속 토큰 수명(§5.7): 끝나기 min(10분, 수명/2) 전, 또는 10000·1001을 받으면 다시 로그인 — 성공한 로그인 뒤 30초 안에는 하지 않는다.
//   키 문제(10000·1001·8000)로 3번 연속 실패하면 'bad'(WS도 닫음), 권한이 허용 목록 밖으로 바뀌거나 봉인이 안 풀리면 바로 'bad'.
//   네트워크·거래소 일시 오류(모르는 코드)는 세지 않는다(잠깐 끊긴 휴대폰이 키를 버리지 않게) — down으로 30초 뒤 다시.
// - 정리만(setCleanup, §3.4): 회원 토큰을 잃고 정리 유예 중이면 위험을 늘리는 호출은 보내지 않는다(blocked 'grace').
// - 앱이 숨으면 WS를 닫고 주문류를 보내지 않는다(조회는 허용). 다시 보이면 남은 수명을 보고 다시 로그인하거나 WS만 다시 연다(15초 간격).
import { createOxWs, authParams, oxAuthMode } from './ox-ws.js';
import { memberHeaders, uidHash } from './member.js';
import { openOxSecret, isSealKey } from './vault.js';

export const OX_RELAY_METHODS = Object.freeze([
  '/private/get_account_msg', '/private/get_assets_info', '/private/get_positions', '/private/get_open_orders_by_instrument',
  '/private/get_order_history_by_instrument', '/private/get_order_state', '/private/get_perpetual_user_config',
  '/private/adjust_perpetual_margin_type', '/private/adjust_perpetual_leverage', '/private/buy', '/private/sell',
  '/private/close_position', '/private/cancel',
]);
// 주문류(결과를 모르면 '나갔을 수도' — unknown, 숨으면 보내지 않음)
export const OX_WRITE_METHODS = Object.freeze([
  '/private/adjust_perpetual_margin_type', '/private/adjust_perpetual_leverage', '/private/buy', '/private/sell', '/private/close_position', '/private/cancel',
]);
export const OX_UNROUTED = Object.freeze([1000, 8121]); // No service found — 그 경로로는 처리 안 됨
export const OX_AUTH_FAIL = Object.freeze([10000, 1001]); // 인증 실패(K-08a)
export const OX_PARAM_FAIL = 8000; // 파라미터 오류(K-08g — 시계 포함)

// 권한 허용 목록(§5.4-6). account:read_write는 config.oxScope.allowAccountWrite일 때만
export const SCOPE_ITEMS = Object.freeze([
  'account:read', 'account:read_write', 'account:none', 'trade:read', 'trade:read_write', 'wallet:read', 'wallet:none', 'block_trade:read', 'block_trade:none',
]);

// 실측(2026-10-08, 대표 키 client_credentials 로그인): 권한 문자열에 'block_trade:undefined'가 왔다 — 그 묶음만 '<묶음>:none'으로 본다.
// 'undefined'는 문서에 있는 '없음'이 아니라 직렬화 흔적이라, 실측하지 않은 묶음(지갑·계정 등)의 undefined는 이름 없는 권한(출금·이체 등)일 수 있어
// 바꾸지 않고 허용 목록 밖(거부, fail-closed). trade:undefined는 거래 권한이 없는 것으로 보고 늘 거부(K-08c — 거래 밖 쓰기가 같이 있으면 K-08b)
const UNDEF_AS_NONE = Object.freeze(['block_trade']);
const noneOf = (s) => {
  const m = /^([a-z_]+):undefined$/.exec(s);
  return m && UNDEF_AS_NONE.includes(m[1]) ? `${m[1]}:none` : s;
};

export function checkScope(scope, { allowAccountWrite = false } = {}) {
  const items = typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean).map(noneOf) : [];
  if (!items.length) return { ok: false, reason: 'empty', items };
  const allowed = (s) => SCOPE_ITEMS.includes(s) && (s !== 'account:read_write' || allowAccountWrite === true);
  const bad = items.filter((s) => !allowed(s) && s !== 'trade:undefined');
  // 막힌 것이 계정 쓰기 하나뿐(동업자 API 가이드대로 '계정 읽고 쓰기'로 만든 키) — 이유를 말해 주고 받지 않는다(K-08h, p34 §6.6).
  // 거래 읽기·쓰기까지 없으면 두 이유를 한 번에(p35 L-10 — K-08h만 말하면 계정 권한만 고쳐 다시 넣었다가 K-08c를 또 받는다)
  if (bad.length === 1 && bad[0] === 'account:read_write') {
    return { ok: false, reason: items.includes('trade:read_write') ? 'account_write' : 'account_write_no_trade', items, bad };
  }
  if (bad.length) return { ok: false, reason: 'forbidden', items, bad };
  if (items.includes('trade:undefined')) return { ok: false, reason: 'no_trade', items };
  if (!items.includes('trade:read_write')) return { ok: false, reason: 'no_trade', items };
  if (!items.includes('account:read') && !items.includes('account:read_write')) return { ok: false, reason: 'no_account', items };
  return { ok: true, items };
}

export function isRiskIncreasing(method, params = {}) {
  if (method === '/private/buy' || method === '/private/sell') return !(params && params.reduce_only === true);
  return method === '/private/adjust_perpetual_leverage' || method === '/private/adjust_perpetual_margin_type';
}

// 계정 일치(§5.4-8): SHA-256('ptf-uid|' + 대문자 UID)를 인증 UID 해시(member.uidHash)와 비교. 'exact'에서 다르면 실제 회원은 막고 시험 토큰은 진단만
export async function accountCheck({ uid, member, mode = 'exact', subtle = globalThis.crypto.subtle }) {
  const u = String(uid ?? '').trim().toUpperCase();
  if (!/^[0-9A-Z]{1,40}$/.test(u)) return { ok: false, reason: 'no_uid' };
  const hash = await uidHash(u, subtle);
  const same = !!member && hash === member.uidHash;
  const block = mode !== 'off' && !same && !(member && member.test === true);
  return { ok: !block, reason: block ? 'account' : null, hash, tail: u.slice(-4), digits: u.length, same };
}

// ── 파라미터 검사(설계 3-2 §5.6 표) — 허브 hub/lib/ox-relay.js OX_RULES·validateOxCall과 키 하나하나 같게 ──
// WS 직접은 허브를 거치지 않으므로 앱이 보내기 전에 같은 규칙을 지킨다(따라가기 엔진 버그의 지정가·125배·알트·식별자 없는 주문이 실계좌로 가지 않게).
// 중계도 같은 검사를 먼저 한다(허브 400을 받기 전에 — 두 경로가 같은 호출만 받게). 배율은 정수만, 천장은 허브 follow.breaker.maxLev(기본 50)
export const OX_MAX_LEV = 50;
export const OX_COID_RE = /^ptf\.[.A-Z:/a-z0-9_-]{1,32}$/; // custom_order_id(36자 이하) — 허브 COID_RE
const V_INST = /^[A-Z0-9]{1,20}-USDT-PERPETUAL$/;
const V_NUM = /^\d{1,16}(\.\d{1,16})?$/;
const vPos = (v) => typeof v === 'string' && V_NUM.test(v) && Number(v) > 0;
const vInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const vOne = (...xs) => (v) => xs.includes(v);
const vPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const V_COMMON = Object.freeze({ instrument_name: (v) => typeof v === 'string' && V_INST.test(v), order_id: (v) => typeof v === 'string' && /^\d{1,30}$/.test(v) });
const V_ORDER = Object.freeze({
  req: ['instrument_name', 'amount', 'type', 'position_side'],
  opt: ['custom_order_id', 'reduce_only', 'take_profit_price', 'stop_loss_price', 'take_profit_type', 'stop_loss_type', 'condition_type', 'trigger_price', 'trigger_price_type'],
  check: {
    amount: vPos, type: vOne('market'), position_side: vOne('BOTH'),
    custom_order_id: (v) => typeof v === 'string' && v.length <= 36 && OX_COID_RE.test(v), reduce_only: (v) => typeof v === 'boolean',
    take_profit_price: vPos, stop_loss_price: vPos, take_profit_type: vOne(1, 2), stop_loss_type: vOne(1, 2),
    condition_type: vOne('NORMAL', 'STOP', 'IF_TOUCHED'), trigger_price: vPos, trigger_price_type: vOne(1, 2),
  },
  // 위험을 늘리는 주문은 custom_order_id 필수, 조건 주문(STOP·IF_TOUCHED)·trigger_price는 reduce_only:true만, 조건 주문에는 trigger_price
  whole: (p) => {
    if (p.reduce_only !== true && p.custom_order_id === undefined) return false;
    const cond = p.condition_type !== undefined && p.condition_type !== 'NORMAL';
    if ((cond || p.trigger_price !== undefined) && p.reduce_only !== true) return false;
    return !(cond && p.trigger_price === undefined);
  },
});
const OX_PARAM_RULES = Object.freeze({
  '/private/get_account_msg': { req: [], opt: [] },
  '/private/get_assets_info': { req: ['asset_type'], opt: [], check: { asset_type: (v) => Array.isArray(v) && v.length === 1 && v[0] === 'PERPETUAL' } },
  '/private/get_positions': { req: ['currency'], opt: ['kind'], check: { currency: vOne('PERPETUAL'), kind: vOne('perpetual') } },
  // type(limit·market, docs :3219-3223) — p34 자동 손절: 조건 주문이 어느 미체결 조회에 보이는지(U-A2). 허브 ox-relay.js도 같은 칸(T-HUB H7)이어야 중계로 보인다
  '/private/get_open_orders_by_instrument': { req: ['instrument_name'], opt: ['type'], check: { type: vOne('limit', 'market') } },
  '/private/get_order_history_by_instrument': { req: ['instrument_name'], opt: ['count', 'offset'], check: { count: (v) => vInt(v, 1, 50), offset: (v) => vInt(v, 0, 500) } },
  '/private/get_order_state': { req: ['order_id'], opt: [] },
  '/private/get_perpetual_user_config': { req: ['instrument_name'], opt: [] },
  '/private/adjust_perpetual_margin_type': { req: ['instrument_name', 'margin_type'], opt: [], check: { margin_type: vOne('isolate') } },
  '/private/adjust_perpetual_leverage': { req: ['instrument_name', 'leverage', 'posId'], opt: [], check: { leverage: 'lev', posId: vOne(0) } },
  '/private/buy': V_ORDER,
  '/private/sell': V_ORDER,
  '/private/close_position': { req: ['instrument_name', 'type', 'amount'], opt: ['pos_id'], check: { type: vOne('market'), amount: vPos, pos_id: vOne(0) } },
  '/private/cancel': { req: ['order_id'], opt: [] },
});

export function validateOxParams(method, params, { maxLev = OX_MAX_LEV } = {}) {
  const bad = { ok: false, error: 'bad_params' };
  const rule = Object.hasOwn(OX_PARAM_RULES, method) ? OX_PARAM_RULES[method] : null;
  if (!rule) return { ok: false, error: 'method_not_allowed' };
  if (!vPlain(params)) return bad;
  const cap = Math.min(125, Number.isInteger(maxLev) && maxLev >= 1 ? maxLev : OX_MAX_LEV);
  const allowed = new Set([...rule.req, ...rule.opt]);
  for (const k of Object.keys(params)) if (!allowed.has(k)) return bad;
  for (const k of rule.req) if (params[k] === undefined) return bad;
  for (const [k, val] of Object.entries(params)) {
    const c = (rule.check && rule.check[k]) || V_COMMON[k];
    const okVal = c === 'lev' ? vInt(val, 1, cap) : !!c && c(val);
    if (!okVal) return bad;
  }
  if (rule.whole && !rule.whole(params)) return bad;
  return { ok: true };
}

export const OX_REFRESH_BEFORE_MS = 10 * 60 * 1000; // 끝나기 10분 전에 다시 로그인(§5.7) — 수명이 짧으면 수명의 절반 전
export const OX_RELOGIN_RETRY_MS = 30000; // 다시 시도 간격 = 성공한 로그인 사이 최소 간격(로그인 폭주 방지, docs L5764)
export const OX_MAX_AUTH_FAILS = 3;
export const OX_RELAY_TIMEOUT_MS = 12000; // 허브가 오렌지엑스에 8초 — 그보다 조금 길게
export const OX_CHECK_TIMEOUT_MS = 2000; // follow/check(§5.5)
export const OX_RELAY_BODY_MAX = 4096; // 허브 /v1/ox 본문 ≤ 4 KB(§5.6)
export const OX_TOKEN_RE = /^[A-Za-z0-9._~+/=-]{8,512}$/; // 허브 X-Ox-Authorization 형식과 같게
// 배율 변경 권한 오류로 보는 오류 문장(§5.4 끝) — 코드 번호는 문서에 없다(U4, 대표 시험 T11에서 확인)
export const OX_PERMISSION_RE = /scope|permission|forbidden|not\s*allowed|unauthori[sz]ed|no\s*access/i;
// WS 직접 중복 막기 — 허브 ox-relay.js isDup/reserve(DUP_MS 24시간·DUP_MAX)와 같게. 오렌지엑스는 custom_order_id로 막아 주지 않는다
export const OX_DUP_MS = 86400000;
export const OX_DUP_MAX = 20000;
// 따라가기 시세(설계 3-2 §6.5): WS ticker.<종목>.raw의 last_price(5초 안 값), 없으면 mark_price — 둘 다 없거나 오래되면 null(그 신호는 건너뜀)
export const TICKER_MAX_AGE_MS = 5000;

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function createOxClient({
  config,
  getToken = () => null, // 회원 토큰(pm1.…) — 중계·follow/check 머리글로만. 정리만이면 app.js가 정리 유예 토큰을 넘긴다
  getLease = () => null, // 따라가기 임대 id(따라가기 트랙이 넘김)
  fetchImpl = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  timers = globalThis,
  subtle = globalThis.crypto && globalThis.crypto.subtle,
  signalFor = (ms) => AbortSignal.timeout(ms),
  wsFactory = (opts) => createOxWs({ url: config.oxWs, ...opts }),
  onState = () => {},
  onUnauthorized = () => {},
}) {
  const hub = String(config.hub).replace(/\/+$/, '');
  const allowAccountWrite = !!(config.oxScope && config.oxScope.allowAccountWrite === true);
  const maxLev = Math.min(125, Number.isInteger(config.oxMaxLev) && config.oxMaxLev >= 1 ? config.oxMaxLev : OX_MAX_LEV); // 허브 천장 follow.breaker.maxLev
  const authMode = oxAuthMode(config); // 'credentials'(기본) | 'signature'
  // 로그인 자격 = 기기 저장소에서 불러온 봉인 그대로 { clientId, ct, iv, sealKey(꺼낼 수 없는 AES-GCM) } — 원문은 없다. 메모리에만
  const sealedOk = (c) => !!c && typeof c === 'object' && typeof c.clientId === 'string' && c.ct instanceof Uint8Array && c.iv instanceof Uint8Array && isSealKey(c.sealKey);
  let cred = null;
  let token = null; // access_token — 메모리에만
  let expiresAt = null;
  let ttlMs = null; // 이번 토큰 수명(expires_in) — 앞당김 = min(10분, 수명/2)
  let lastAuthAt = -Infinity; // 마지막으로 성공한 로그인 시각
  let scope = null; // 권한 항목 배열
  let transport = null; // 'ws' | 'relay'
  let status = 'idle'; // 'idle' | 'login' | 'ready' | 'down' | 'bad'
  let badReason = null;
  let badScope = null;
  let authFails = 0;
  let refreshTimer = null;
  let reauthRun = null;
  let visible = true;
  let cleanup = false; // 정리만(§3.4) — 위험을 늘리는 호출은 보내지 않는다
  let epoch = 0;
  // WS 직접으로 보낸 위험 증가 buy·sell의 custom_order_id → 보낸 시각(메모리만). 중계는 허브가 같은 일을 한다(409 duplicate_order)
  const sentCoids = new Map();
  function coidDup(coid) {
    const at = sentCoids.get(coid);
    if (at === undefined) return false;
    if (now() - at < OX_DUP_MS) return true;
    sentCoids.delete(coid);
    return false;
  }
  function coidReserve(coid) {
    if (sentCoids.size >= OX_DUP_MAX) {
      const t = now();
      for (const [k, at] of [...sentCoids]) if (t - at >= OX_DUP_MS) sentCoids.delete(k);
      if (sentCoids.size >= OX_DUP_MAX) sentCoids.delete(sentCoids.keys().next().value);
    }
    sentCoids.set(coid, now());
  }

  const state = () => ({ status, transport, scope: scope ? [...scope] : null, expiresAt, badReason, badScope, cleanup });
  const emit = () => onState(state());
  function setStatus(s) {
    status = s;
    emit();
  }
  // 다시 로그인할 시각: 끝나기 min(10분, 수명/2) 전 — expires_in이 10분 이하여도 0초 뒤가 되지 않게(U11 미확인)
  const refreshAt = () => expiresAt - Math.min(OX_REFRESH_BEFORE_MS, Math.floor((ttlMs || 0) / 2));
  const tooSoon = () => now() - lastAuthAt < OX_RELOGIN_RETRY_MS;
  function stopRefresh() {
    if (refreshTimer != null) {
      timers.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }
  // delay를 주면 그 뒤에(다시 시도), 안 주면 refreshAt에 — 그래도 30초보다 빠르게는 잡지 않는다
  function scheduleRefresh(delay = null) {
    stopRefresh();
    const ms = delay != null ? delay : Math.max(OX_RELOGIN_RETRY_MS, refreshAt() - now());
    refreshTimer = timers.setTimeout(() => {
      refreshTimer = null;
      reauth();
    }, ms);
  }
  // 열려 있던 WS가 저절로 끊김(서버·네트워크·ping 시간 초과) — 보이는 동안이면 15초 간격을 지켜 다시 연다
  function onWsClose() {
    if (!cred || status === 'bad' || !visible) return;
    if (status === 'ready') setStatus('down');
    ws.open().then((ok) => {
      if (!cred || status === 'bad' || !visible) return;
      if (!ok) {
        scheduleRefresh(OX_RELOGIN_RETRY_MS);
        return;
      }
      afterOpen();
      if (expiresAt != null && (now() < refreshAt() || tooSoon())) {
        if (status === 'down') setStatus('ready');
        scheduleRefresh();
      } else reauth();
    });
  }
  // 시세(따라가기, §6.5) — 구독한 종목만, 알림마다 { last, mark, at }. WS가 다시 열리면 다시 구독한다(afterOpen)
  const tickers = new Map();
  const tickerSubs = new Set();
  const numOrNull = (v) => {
    const n = Number(v);
    return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : null;
  };
  function onNotify(p) {
    const m = /^ticker\.(.+)\.raw$/.exec(String(p.channel || ''));
    if (!m || !p.data || typeof p.data !== 'object') return;
    tickers.set(m[1], { last: numOrNull(p.data.last_price), mark: numOrNull(p.data.mark_price), at: now() });
  }
  function afterOpen() {
    if (tickerSubs.size) ws.subscribe([...tickerSubs].map((i) => `ticker.${i}.raw`));
  }
  const ws = wsFactory({ now, timers, onClose: onWsClose, onNotify });

  // 로그인(/public/auth). 봉인(c.ct·c.iv, 기기 키 c.sealKey)은 WS가 열린 뒤 바로 앞에서만 풀고, 매개변수에 넣어 보낸 즉시
  // 원문·매개변수 참조를 버린다(모듈 상태·cred에 두지 않음 — 다시 로그인할 때 다시 푼다). 봉인이 안 풀리면 아무것도 보내지 않는다('seal')
  async function auth(c) {
    if (!sealedOk(c)) return { ok: false, reason: 'seal' };
    if (!(await ws.open())) return { ok: false, reason: 'down' };
    if (authMode === 'signature' && ws.offset() == null) await ws.ping(); // 서명 방식만 시계 맞추기(§5.4-2)
    let secret;
    try {
      secret = await openOxSecret(c, subtle);
    } catch {
      return { ok: false, reason: 'seal' };
    }
    let params;
    try {
      params = await authParams({ mode: authMode, clientId: c.clientId, secret, now: now(), offset: ws.offset() || 0, subtle });
    } catch {
      return { ok: false, reason: 'error', code: 'sign' };
    } finally {
      secret = null;
    }
    const sent = ws.request('/public/auth', params); // 보내기는 이 줄 안에서 끝난다(JSON 문자열로 소켓에)
    params = null;
    const r = await sent;
    if (r.error) {
      if (OX_AUTH_FAIL.includes(r.error.code)) return { ok: false, reason: 'auth', code: r.error.code };
      // 8000: 서명 방식이면 시각·서명 매개변수(K-08g), client_credentials면 시계와 무관 — 키 문제로 본다
      if (r.error.code === OX_PARAM_FAIL) return { ok: false, reason: authMode === 'signature' ? 'param' : 'auth', code: r.error.code };
      return { ok: false, reason: 'error', code: r.error.code };
    }
    const res = r.result;
    if (!res || typeof res !== 'object') return { ok: false, reason: 'down' }; // 시간 초과·닫힘
    if (typeof res.access_token !== 'string' || !OX_TOKEN_RE.test(res.access_token)) return { ok: false, reason: 'error', code: 'token' };
    const sc = checkScope(res.scope, { allowAccountWrite });
    if (!sc.ok) return { ok: false, reason: 'scope', scope: sc };
    const ttl = Number(res.expires_in);
    const life = Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 3600000;
    // refresh_token은 받지도 두지도 않는다 — 다시 받을 때도 같은 방식으로 로그인
    return { ok: true, token: res.access_token, expiresAt: now() + life, ttlMs: life, scope: sc };
  }
  function took(a) {
    token = a.token;
    expiresAt = a.expiresAt;
    ttlMs = a.ttlMs;
    lastAuthAt = now();
    scope = a.scope.items;
  }

  // intent 'manual'(트레이딩 탭 수동 주문, p2 spec §5.8)이면 X-Ptf-Intent: manual — 허브가 수동 갈래(manual.on·testOnly·종목·배율·시험 상한)로
  // 판정하고 기록 경로 끝에 #m. 그 밖의 값·없음은 머리글 없이(따라가기 그대로)
  async function relay(method, params, intent = null) {
    const auth = getToken();
    if (!auth) return { ok: false, kind: 'unauthorized', body: null };
    if (!token || !OX_TOKEN_RE.test(token)) return { ok: false, kind: 'nokey' };
    const body = JSON.stringify({ method, params });
    if (new TextEncoder().encode(body).length > OX_RELAY_BODY_MAX) return { ok: false, kind: 'denied', error: 'too_large' };
    const headers = { ...memberHeaders(auth, config.version), 'Content-Type': 'application/json', 'X-Ox-Authorization': `bearer ${token}` };
    if (intent === 'manual') headers['X-Ptf-Intent'] = 'manual';
    const lease = getLease();
    if (lease) headers['X-Ptf-Lease'] = lease;
    const write = OX_WRITE_METHODS.includes(method);
    let res;
    try {
      res = await fetchImpl(`${hub}/v1/ox`, { method: 'POST', headers, body, cache: 'no-store', mode: 'cors', credentials: 'omit', signal: signalFor(OX_RELAY_TIMEOUT_MS) });
    } catch {
      // 허브가 이미 넘겼는지 모른다(12초 제한으로 끊김 포함) — 주문류는 '나갔을 수도'(§5.6 504와 같게)
      return write ? { ok: false, kind: 'unknown' } : { ok: false, kind: 'down', why: 'network' };
    }
    if (!res) return write ? { ok: false, kind: 'unknown' } : { ok: false, kind: 'down', why: 'network' };
    const b = await readJson(res);
    const err = b && typeof b.error === 'string' && b.error ? b.error : null;
    if (res.status === 200 && b && b.ok === true && b.ox && typeof b.ox === 'object') {
      if (b.ox.error && typeof b.ox.error === 'object') return { ok: false, kind: 'ox', code: Number(b.ox.error.code), message: String(b.ox.error.message ?? '') };
      return { ok: true, result: b.ox.result };
    }
    if (res.status === 401) {
      onUnauthorized(b, auth);
      return { ok: false, kind: 'unauthorized', body: b };
    }
    if (res.status === 403 && err === 'follow_disabled') return { ok: false, kind: 'blocked', reason: String(b.reason || 'off') };
    if (res.status === 403 && err === 'manual_disabled') return { ok: false, kind: 'blocked', reason: String(b.reason || 'off') };
    if (res.status === 400 || res.status === 403 || res.status === 413) return { ok: false, kind: 'denied', error: err || `http_${res.status}` };
    // 허브 OX_ERRORS(member-contract L127-136): 409 = 그 식별자를 허브가 이미 받음(보내지 않음 — 식별자로 확인, 다시 보내지 않음)
    if (res.status === 409) return { ok: false, kind: 'duplicate' };
    if (res.status === 429) return { ok: false, kind: 'rate' };
    if (res.status === 503 && err === 'ox_busy') return { ok: false, kind: 'busy' };
    if (res.status === 502) return { ok: false, kind: 'down', why: 'ox_unreachable' };
    // 503 ox_off·ox_unavailable·members_off, 408 timeout(본문 받기 시간 초과), 415 — 거래소로 보내지 않음이 확실하다
    if (res.status === 503 || res.status === 408 || res.status === 415) return { ok: false, kind: 'down', why: err || `http_${res.status}` };
    if (res.status === 504) return { ok: false, kind: 'unknown' };
    return write ? { ok: false, kind: 'unknown' } : { ok: false, kind: 'down', why: `http_${res.status}` };
  }

  // WS 직접일 때 위험 증가 주문 직전(§5.5, 허브 계약 FOLLOW_CHECK_HEADERS): 회원 토큰 + X-Ptf-Lease + X-Ptf-Coid(그 주문의 식별자,
  // adjust_*는 opts.coid) + X-Ptf-Inst(종목 — 허브가 follow.symbols를 본다), 본문 없음, 2초. 막히면 허브 reason 그대로
  async function followCheck(params, opts) {
    const auth = getToken();
    const lease = getLease();
    if (!auth || !lease) return { ok: false, reason: 'lease_required' };
    const coid = typeof params.custom_order_id === 'string' ? params.custom_order_id : typeof opts.coid === 'string' ? opts.coid : null;
    if (!coid || coid.length > 36 || !OX_COID_RE.test(coid)) return { ok: false, reason: 'coid_required' };
    let res;
    try {
      res = await fetchImpl(`${hub}/v1/member/follow/check`, {
        method: 'POST',
        headers: { ...memberHeaders(auth, config.version), 'X-Ptf-Lease': lease, 'X-Ptf-Coid': coid, 'X-Ptf-Inst': String(params.instrument_name) },
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        signal: signalFor(OX_CHECK_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, reason: 'check_failed' };
    }
    const b = res ? await readJson(res) : null;
    if (res && res.status === 401) {
      onUnauthorized(b, auth);
      return { ok: false, reason: 'unauthorized' };
    }
    if (res && res.status === 200 && b && b.ok === true && b.enabled === true && b.holder === true) return { ok: true };
    if (res && res.status === 200 && b && b.enabled === false) return { ok: false, reason: typeof b.reason === 'string' && b.reason ? b.reason : 'off' };
    if (res && res.status === 200 && b && b.holder === false) return { ok: false, reason: 'not_holder' };
    return { ok: false, reason: 'check_failed' };
  }

  // 수동 주문(p2 spec §5.8·§7.1): WS 직접일 때 위험 증가 호출 직전 — 임대 없이 허브 POST /v1/member/manual/check, 본문 { v:1, method, inst,
  // lev?(배율 변경), coid?(buy·sell) }, 2초. 중계 /v1/ox 수동 갈래와 같은 판정(시험 상한은 수량이 없어 허브가 보지 않음). 막히면 허브 reason 그대로,
  // 답이 없거나 모르는 응답(400 포함)이면 보내지 않는다(check_failed)
  async function manualCheck(method, params, opts) {
    const auth = getToken();
    if (!auth) return { ok: false, reason: 'grace' };
    const body = { v: 1, method, inst: String(params.instrument_name) };
    if (method === '/private/adjust_perpetual_leverage') body.lev = Number(params.leverage);
    const coid = typeof params.custom_order_id === 'string' ? params.custom_order_id : typeof opts.coid === 'string' ? opts.coid : null;
    if (method === '/private/buy' || method === '/private/sell') body.coid = coid;
    let res;
    try {
      res = await fetchImpl(`${hub}/v1/member/manual/check`, {
        method: 'POST',
        headers: { ...memberHeaders(auth, config.version), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        signal: signalFor(OX_CHECK_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, reason: 'check_failed' };
    }
    const b = res ? await readJson(res) : null;
    if (res && res.status === 401) {
      onUnauthorized(b, auth);
      return { ok: false, reason: 'unauthorized' };
    }
    if (res && res.status === 200 && b && b.ok === true && b.enabled === true) return { ok: true };
    if (res && res.status === 200 && b && b.enabled === false) return { ok: false, reason: typeof b.reason === 'string' && b.reason ? b.reason : 'off' };
    return { ok: false, reason: 'check_failed' };
  }

  function fromWs(r, write) {
    if (r.error) return { ok: false, kind: 'ox', code: r.error.code, message: r.error.message };
    if (Object.hasOwn(r, 'result')) return { ok: true, result: r.result };
    if (r.closed && !r.sent) return { ok: false, kind: 'down', why: 'closed' };
    return write ? { ok: false, kind: 'unknown' } : { ok: false, kind: 'down', why: r.timeout ? 'timeout' : 'closed' };
  }

  // 주문 경로 알아보기(§5.4-7): WS로 계정 조회 → uid가 오면 ws. 그 밖(1000·8121, 다른 오류 코드, 시간 초과, 닫힘)은 모두
  // 기본 경로인 허브 중계로 같은 조회를 한다 — 로그인은 이미 됐고, 인증된 WS의 개인 메서드는 실제 키로만 확인된다(U1)
  async function detect() {
    const r = await ws.request('/private/get_account_msg', { access_token: token });
    if (r.result && typeof r.result === 'object' && r.result.uid != null) return { transport: 'ws', uid: String(r.result.uid) };
    const o = await relay('/private/get_account_msg', {});
    if (o.ok && o.result && typeof o.result === 'object' && o.result.uid != null) return { transport: 'relay', uid: String(o.result.uid) };
    return { fail: o };
  }
  function detectFail(o) {
    if (o.ok) return { ok: false, reason: 'error', code: 'uid' };
    if (o.kind === 'ox' && OX_AUTH_FAIL.includes(o.code)) return { ok: false, reason: 'relay_auth', code: o.code };
    if (o.kind === 'unauthorized') return { ok: false, reason: 'member' };
    if (o.kind === 'ox') return { ok: false, reason: 'error', code: o.code };
    if (['down', 'unknown', 'rate', 'busy', 'duplicate'].includes(o.kind)) return { ok: false, reason: 'down' };
    return { ok: false, reason: 'error', code: o.error || o.kind };
  }

  async function login(c) {
    epoch += 1;
    const e = epoch;
    stopRefresh();
    cred = null;
    token = null;
    expiresAt = null;
    ttlMs = null;
    scope = null;
    transport = null;
    badReason = null;
    badScope = null;
    authFails = 0;
    setStatus('login');
    const a = await auth(c);
    if (e !== epoch) return { ok: false, reason: 'stale' };
    if (!a.ok) {
      setStatus('idle');
      return a;
    }
    took(a);
    const d = await detect();
    if (e !== epoch) return { ok: false, reason: 'stale' };
    if (d.fail) {
      token = null;
      expiresAt = null;
      ttlMs = null;
      scope = null;
      setStatus('idle');
      return detectFail(d.fail);
    }
    cred = c;
    transport = d.transport;
    setStatus('ready');
    scheduleRefresh();
    afterOpen();
    return { ok: true, uid: d.uid, transport, scope: a.scope, expiresAt };
  }

  // 키를 더 쓸 수 없음 — 토큰을 버리고 거래소 WS도 닫는다(키 없이 5초마다 ping하지 않게). 다시 연결은 #keys에서 새로
  function toBad(reason, sc = null) {
    stopRefresh();
    badReason = reason;
    badScope = sc;
    cred = null;
    token = null;
    expiresAt = null;
    ttlMs = null;
    ws.close();
    setStatus('bad');
  }

  // 다시 로그인 — 한 번에 하나, 성공한 로그인 뒤 30초 안에는 하지 않는다(폭주 방지).
  // 키 문제(10000·1001·8000)만 세고(3번이면 bad), 네트워크·거래소 일시 오류(모르는 코드·요청 제한·점검)는 세지 않고 down으로 30초 뒤 다시
  function reauth() {
    if (!cred || status === 'bad' || !visible) return Promise.resolve(false);
    if (reauthRun) return reauthRun;
    if (tooSoon()) {
      if (refreshTimer == null) scheduleRefresh(OX_RELOGIN_RETRY_MS - (now() - lastAuthAt));
      return Promise.resolve(false);
    }
    const e = epoch;
    const c = cred;
    const run = (async () => {
      const a = await auth(c);
      if (e !== epoch) return false;
      if (a.ok) {
        took(a);
        authFails = 0;
        setStatus('ready');
        scheduleRefresh();
        afterOpen();
        return true;
      }
      if (a.reason === 'scope') {
        toBad('scope', a.scope);
        return false;
      }
      if (a.reason === 'seal') { // 기기 키로 봉인이 안 풀림 — 몇 번 해도 같다(다시 연결해야)
        toBad('seal');
        return false;
      }
      if (a.reason !== 'auth' && a.reason !== 'param') {
        if (status !== 'down') setStatus('down');
        scheduleRefresh(OX_RELOGIN_RETRY_MS);
        return false;
      }
      authFails += 1;
      if (authFails >= OX_MAX_AUTH_FAILS) {
        toBad(a.reason);
        return false;
      }
      scheduleRefresh(OX_RELOGIN_RETRY_MS);
      return false;
    })();
    reauthRun = run;
    const clear = () => {
      if (reauthRun === run) reauthRun = null;
    };
    run.then(clear, clear);
    return run;
  }

  // 호출 하나. 허용 목록 → 파라미터 검사(두 경로 모두, 허브 §5.6 규칙) → 정리만이면 위험 증가 막음 → 숨으면 주문류 막음 → (WS 직접) 위험 증가면 follow/check
  // opts = { coid?(adjust_* 확인용 식별자), intent?('manual' — 트레이딩 탭 수동 주문: 중계 X-Ptf-Intent·WS 직접 manual/check, p2 spec §5.8) }
  function call(method, params, opts = {}) {
    return send(method, params === undefined ? {} : params, opts && typeof opts === 'object' ? opts : {}, false);
  }
  async function send(method, p, opts, retried) {
    if (!OX_RELAY_METHODS.includes(method)) return { ok: false, kind: 'denied', error: 'method_not_allowed' };
    if (!validateOxParams(method, p, { maxLev }).ok) return { ok: false, kind: 'denied', error: 'bad_params' };
    const write = OX_WRITE_METHODS.includes(method);
    const increase = isRiskIncreasing(method, p);
    if (increase && cleanup) return { ok: false, kind: 'blocked', reason: 'grace' }; // 정리 유예 동안은 정리만(§3.4)
    if (write && !visible) return { ok: false, kind: 'hidden' }; // 숨으면 주문하지 않는다(§5.7)
    if (cred && expiresAt != null && now() >= refreshAt()) await reauth();
    if (status === 'bad' || !token) return { ok: false, kind: 'nokey' };
    let o;
    const intent = opts.intent === 'manual' ? 'manual' : null; // 트레이딩 탭 수동 주문(p2 spec §5.8) — 중계 머리글·WS 직접 확인 경로
    if (transport === 'ws') {
      if (increase) {
        const ck = intent === 'manual' ? await manualCheck(method, p, opts) : await followCheck(p, opts);
        if (!ck.ok) return { ok: false, kind: 'blocked', reason: ck.reason };
      }
      // 허브와 같은 순서·규칙: 막는 사유(follow/check) 다음에 같은 식별자 확인, 보내기 직전(같은 틱)에 자리 잡기 —
      // '결과 모름' 뒤 다시 보내기·두 호출 경합이 두 번째 실제 진입이 되지 않게
      const dupCoid = increase && (method === '/private/buy' || method === '/private/sell') ? p.custom_order_id : null;
      if (dupCoid) {
        if (coidDup(dupCoid)) return { ok: false, kind: 'duplicate' };
        coidReserve(dupCoid);
      }
      const r = await ws.request(method, { ...p, access_token: token });
      // 안 나간 게 확실하면 자리를 돌려준다(거래소 오류 응답 — 1000·8121로 중계에 넘기면 허브가 따로 막는다, 보내기 전 닫힘). 시간 초과·보낸 뒤 닫힘·성공은 그대로
      if (dupCoid && (r.error || (r.closed && !r.sent))) sentCoids.delete(dupCoid);
      if (r.error && OX_UNROUTED.includes(r.error.code)) {
        transport = 'relay'; // 이 실행 동안 중계로 내린다(§5.5)
        emit();
        o = await relay(method, p, intent);
      } else o = fromWs(r, write);
    } else {
      o = await relay(method, p, intent);
    }
    if (!retried && !o.ok && o.kind === 'ox' && OX_AUTH_FAIL.includes(o.code) && cred) {
      if (await reauth()) return send(method, p, opts, true);
    }
    return o;
  }

  // 배율 변경 권한 확인(§5.4 끝) — 따라가기를 켤 때 따라가기 트랙이 부른다. 지금 배율 그대로 바꿔 본다(값이 같아 포지션 영향 없음).
  // WS 직접이면 opts.coid가 있어야 follow/check를 지난다(그림자 실행 중 시험 토큰은 리허설 식별자). 허브 천장 위 배율은 바꿔 보지 않는다
  async function probeLeverage(inst = 'BTC-USDT-PERPETUAL', opts = {}) {
    const c = await call('/private/get_perpetual_user_config', { instrument_name: inst });
    if (!c.ok) return { ok: false, kind: c.kind, code: c.code ?? null };
    const lev = Number(c.result && c.result.leverage);
    if (!Number.isInteger(lev) || lev < 1 || lev > 125) return { ok: true, note: 'no_leverage' };
    if (lev > maxLev) return { ok: true, note: 'lev_cap' }; // 첫 진입이 신호 배율로 바꿀 때 lev_denied로 다시 잡힌다
    const a = await call('/private/adjust_perpetual_leverage', { instrument_name: inst, leverage: lev, posId: 0 }, opts);
    if (a.ok) return { ok: true, note: null };
    if (a.kind === 'ox' && OX_PERMISSION_RE.test(a.message || '')) return { ok: false, kind: 'denied_scope', code: a.code };
    if (a.kind === 'ox') return { ok: true, note: `code ${a.code}` };
    return { ok: false, kind: a.kind, code: a.code ?? null, reason: a.reason ?? null };
  }

  // 정리만(§3.4) 켜고 끄기 — keys.js createKeyControl이 회원 토큰을 잃었을 때 켠다(로그인·토큰은 그대로)
  function setCleanup(on) {
    if (cleanup === !!on) return;
    cleanup = !!on;
    emit();
  }
  function pause() {
    visible = false;
    ws.close();
  }
  function resume() {
    visible = true;
    if (!cred || status === 'bad') return Promise.resolve(false);
    if (expiresAt == null || (now() >= refreshAt() && !tooSoon())) return reauth();
    scheduleRefresh();
    return ws.open().then((ok) => {
      if (!cred || status === 'bad') return false;
      if (ok) {
        afterOpen();
        if (status === 'down') setStatus('ready');
        return true;
      }
      if (status !== 'down') setStatus('down');
      scheduleRefresh(OX_RELOGIN_RETRY_MS);
      return false;
    });
  }
  // 키·토큰을 버린다(WS는 둔다 — #keys에서 실패한 연결 다음 시도를 15초 기다리지 않게. 화면을 떠나면 keys.js가 stop)
  function forget() {
    epoch += 1;
    stopRefresh();
    cred = null;
    token = null;
    expiresAt = null;
    ttlMs = null;
    scope = null;
    transport = null;
    badReason = null;
    badScope = null;
    authFails = 0;
    setStatus('idle');
  }
  function stop() {
    forget();
    ws.close();
  }

  // 따라가기: 종목 시세 구독(로그인 뒤·WS가 다시 열릴 때마다 다시) — 공개 채널이라 키·토큰과 무관
  function watchTicker(inst) {
    if (typeof inst !== 'string' || !/^[A-Z0-9]{1,20}-USDT-PERPETUAL$/.test(inst) || tickerSubs.has(inst)) return;
    tickerSubs.add(inst);
    if (ws.isOpen()) ws.subscribe([`ticker.${inst}.raw`]);
  }
  // 지금 가격: 5초 안 알림의 last_price, 없으면 mark_price, 그것도 없거나 오래되면 null
  function price(inst, maxAgeMs = TICKER_MAX_AGE_MS) {
    const t = tickers.get(inst);
    if (!t || now() - t.at > maxAgeMs) return null;
    return t.last ?? t.mark ?? null;
  }
  // 표시가(p34 자동 손절 §2.4): 5초 안 알림의 mark_price만 — 거래소 STOP 발동·청산이 표시가 기준이라 체결가 순간 튐으로 먼저 정리하지 않게
  function markPrice(inst, maxAgeMs = TICKER_MAX_AGE_MS) {
    const t = tickers.get(inst);
    if (!t || now() - t.at > maxAgeMs) return null;
    return t.mark ?? null;
  }

  return { login, call, reauth, probeLeverage, setCleanup, pause, resume, forget, stop, state, watchTicker, price, markPrice, ready: () => status === 'ready' && !!token && visible };
}
