// 서버 자동(④ — 2026-10-12 설계 §5.2·§7.6·§10·5.6·5.14, 대표 결정 7) — 허브 회원 경로 /v1/member/server/{enroll,state,off}(회원 토큰은 Authorization 머리글로만 — 규칙 12)와 상태 보기.
// 등록 묶음(sealConnectedKey): 새 키 없이 키 화면에 연결해 둔 kv.ox를 WS 로그인 길(ox-client)과 같은 함수(vault.js loadOxKey·openOxSecret)로 풀어
// 바로 실행기 공개키로 잠근다(server-enroll.js sealEnrollment). 푼 원문은 그 함수의 지역 변수에만 — 모듈 상태·DOM·기록 없음, 허브로는 잠근 묶음만.
// 상태는 보이는 동안 30초마다(등록 중·끄는 중은 5초), 숨으면 멈춘다. state() = SERVER_STATE | null(아직 모름·회원 아님) | { ok:false, error:'down', now }(받기 실패).
// 서버 매매(trades)는 그 회원 것만 — 평단·정리가·USDT는 이 회원에게만, 자동 손절은 상태 낱말 키만(가격 칸 없음 — 모르는 칸이 있으면 통째로 버림).
// offApp(spec §7.6) = 그 회원 계정의 앱 밖 주문 감지 시각 → serverOffAppLine 안내 한 줄(경보 아님)
import { memberHeaders } from './member.js';
import { followCapable } from './follow-view.js';
import { FTEXT, SERVER_CONSENT_VERSION } from './follow-text.js';
import { TEXT, fmtHM } from './auto-view.js';
import { sha256Hex } from './follow-settings.js';
import { loadOxKey, openOxSecret } from './vault.js';
import { sealEnrollment } from './server-enroll.js';

export const SERVER_STATE_KEYS = Object.freeze(['ok', 'now', 'available', 'reason', 'status', 'error', 'lastCheck', 'exec', 'trades', 'offApp']);
export const SERVER_TRADE_KEYS = Object.freeze(['id', 'symbol', 'side', 'lev', 'stage', 'state', 'openedAt', 'closedAt', 'avg', 'exit', 'resultPct', 'pnlUsdt', 'autoSl', 'rehearsal']);
export const SERVER_VIEW_KEYS = Object.freeze(['none', 'unavailable', 'pending', 'on', 'closing', 'deleted', 'error', 'down']);
export const SERVER_ENGAGED = Object.freeze(['pending', 'on', 'closing']); // 서버 자동이 이 UID를 맡은(맡으려는) 동안 — 휴대폰 방식 잠금
export const SERVER_POLL_MS = 30000;
export const SERVER_FAST_MS = 5000;
export const SERVER_TIMEOUT_MS = 8000;
export const SERVER_STALE_MS = 120000; // 켜짐인데 마지막 확인이 이만큼 지나면 경고 색(실행기 보고 15초·허브 살아 있음 60초보다 넉넉히)
// 연결해 둔 키 잠그기 실패 사유(FTEXT.serverErr에 글이 있음): 키 없음 · 이 기기에서 못 풂(예전 기록·봉인 키 없음·다른 봉인 키·그 밖 예외) · 지문 · 묶음 clientId 꼴 · 설정
export const SEAL_ERRORS = Object.freeze(['no_key', 'key_open', 'exec_key', 'bad_client', 'bad_settings']);
const STATUSES = Object.freeze(['none', 'pending', 'on', 'closing', 'off', 'error']);
const REASONS = Object.freeze([null, 'exec_off', 'test_only', 'not_allowed', 'exec_down']);
const TRADE_STATES = Object.freeze(['open', 'opening', 'closing', 'closed', 'unclear', 'detached', 'skipped', 'shadow']);
const PUB_RE = /^[A-Za-z0-9_-]{87}$/;
const FP_RE = /^[0-9a-f]{16}$/;

// 빌드가 serverExec 판·실행기 공개키를 찍었는가(따라가기 화면의 ④ 라디오·app.js 배선)
export const serverBuildReady = (config) => !!config && config.serverExec === true && !!config.exec && PUB_RE.test(String(config.exec.pubKey)) && FP_RE.test(String(config.exec.fp));
// 서버 자동 자격 = 따라가기 자격(followCapable — s·j판 같은 판 인증 && (autoReady || 시험 토큰)) && 서버 자동 빌드
export const serverCapable = (config, member) => followCapable(config, member) && serverBuildReady(config);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => v === null || num(v);
const exact = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
function okTrade(t) {
  return exact(t, SERVER_TRADE_KEYS) && typeof t.id === 'string' && /^[0-9A-Za-z]{1,40}$/.test(t.id) && typeof t.symbol === 'string' && /^[A-Z0-9]{1,20}$/.test(t.symbol)
    && (t.side === 'long' || t.side === 'short') && Number.isInteger(t.lev) && Number.isInteger(t.stage) && TRADE_STATES.includes(t.state)
    && num(t.openedAt) && numOrNull(t.closedAt) && numOrNull(t.avg) && numOrNull(t.exit) && numOrNull(t.resultPct) && numOrNull(t.pnlUsdt)
    && (t.autoSl === null || (typeof t.autoSl === 'string' && /^[A-Za-z]{1,20}$/.test(t.autoSl))) && typeof t.rehearsal === 'boolean';
}
// GET /v1/member/server/state 답(5.6) — 정확한 모양만, 아니면 null
export function checkServerState(b) {
  if (!exact(b, SERVER_STATE_KEYS)) return null;
  if (b.ok !== true || !num(b.now) || typeof b.available !== 'boolean' || !REASONS.includes(b.reason) || !STATUSES.includes(b.status)) return null;
  if (!(b.error === null || (typeof b.error === 'string' && /^[a-z_]{1,40}$/.test(b.error))) || !numOrNull(b.lastCheck) || !numOrNull(b.offApp)) return null;
  if (!exact(b.exec, ['up', 'lastSeen']) || typeof b.exec.up !== 'boolean' || !numOrNull(b.exec.lastSeen)) return null;
  if (!Array.isArray(b.trades) || b.trades.length > 50 || !b.trades.every(okTrade)) return null;
  return b;
}

// 연결해 둔 키 → 등록 묶음(대표 결정 7). vault = 이 판 기기 저장소(ptf-<판>-vault — kv.ox·kv.oxSeal), settings = 묶음 설정(5.8 — symbols ['BTC']).
// load·open은 키 화면·WS 로그인 길과 같은 vault.js 함수(시험만 바꿈), seal = server-enroll.js sealEnrollment.
export async function sealConnectedKey({
  vault, config, settings, now = Date.now(), subtle = globalThis.crypto && globalThis.crypto.subtle, cryptoImpl = globalThis.crypto,
  load = loadOxKey, open = openOxSecret, seal = sealEnrollment,
}) {
  let k;
  try {
    k = await load(vault);
  } catch {
    return { ok: false, error: 'key_open' };
  }
  if (!k || k.state === 'none') return { ok: false, error: 'no_key' };
  if (k.state !== 'ok' || !k.rec) return { ok: false, error: 'key_open' };
  let secret = null;
  try {
    secret = await open(k.rec, subtle);
  } catch {
    return { ok: false, error: 'key_open' };
  }
  try {
    const ex = config && config.exec ? config.exec : {};
    const blob = await seal({ pubKey: ex.pubKey, fp: ex.fp, clientId: k.rec.clientId, secret, settings, now, subtle, cryptoImpl });
    return { ok: true, blob };
  } catch (e) {
    const m = String(e && e.message);
    return { ok: false, error: ['exec_key', 'bad_client', 'bad_settings'].includes(m) ? m : 'key_open' };
  } finally {
    secret = null; // 원문은 이 함수 밖에 남기지 않는다
  }
}

export function createServerExec({
  config,
  getMember = () => null,
  fetchImpl = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  timers = globalThis,
  onChange = () => {},
  pollMs = SERVER_POLL_MS,
  fastMs = SERVER_FAST_MS,
  signalFor = (ms) => AbortSignal.timeout(ms),
} = {}) {
  const base = String(config.hub).replace(/\/+$/, '');
  let st = null;
  let visible = false;
  let stopped = false;
  let timer = null;
  let seq = 0;
  const token = () => {
    const m = getMember();
    return m && typeof m.token === 'string' ? m.token : null;
  };
  const opts = (tok, method, body) => ({
    method,
    headers: { ...memberHeaders(tok, config.version), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    mode: 'cors',
    credentials: 'omit',
    signal: signalFor(SERVER_TIMEOUT_MS),
  });
  async function readJson(res) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  function set(next) {
    st = next;
    try {
      onChange(st);
    } catch {
      // 화면 그리기 실패가 받기를 멈추지 않게
    }
  }
  function schedule() {
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
    if (stopped || !visible || !token()) return;
    const fast = !!st && st.ok === true && (st.status === 'pending' || st.status === 'closing');
    timer = timers.setTimeout(() => { refresh(); }, fast ? fastMs : pollMs);
  }
  async function refresh() {
    const tok = token();
    seq += 1;
    const mine = seq;
    if (!tok) {
      set(null);
      schedule();
      return;
    }
    let next = { ok: false, error: 'down', now: now() };
    try {
      const res = await fetchImpl(`${base}/v1/member/server/state`, opts(tok, 'GET'));
      const b = res.status === 200 ? checkServerState(await readJson(res)) : null;
      if (b) next = b;
    } catch {
      // 닿지 못함 — down
    }
    if (mine !== seq) return; // 그사이 새로 받기 시작함
    set(next);
    schedule();
  }
  async function post(p, body) {
    const tok = token();
    if (!tok) return { ok: false, error: 'down' };
    let res;
    let b = null;
    try {
      res = await fetchImpl(`${base}${p}`, opts(tok, 'POST', body));
      b = await readJson(res);
    } catch {
      return { ok: false, error: 'down' };
    }
    if ((res.status === 202 || res.status === 200) && b && b.ok === true) return { ok: true, id: typeof b.id === 'string' ? b.id : null };
    if (res.status === 429) return { ok: false, error: 'busy' };
    const e = b && typeof b.error === 'string' ? b.error : 'down';
    return { ok: false, error: Object.hasOwn(FTEXT.serverErr, e) ? e : 'down' };
  }
  return {
    state: () => st,
    refresh,
    async enroll(blob) {
      const r = await post('/v1/member/server/enroll', { v: 1, blob });
      await refresh();
      return r;
    },
    async off(mode) {
      if (mode !== 'flat' && mode !== 'now') return { ok: false, error: 'bad_request' };
      const r = await post('/v1/member/server/off', { v: 1, mode });
      await refresh();
      return r.ok ? { ok: true } : r;
    },
    setVisible(v) {
      visible = v === true;
      if (visible) refresh();
      else if (timer != null) {
        timers.clearTimeout(timer);
        timer = null;
      }
    },
    stop() {
      stopped = true;
      if (timer != null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

// 상태 → 화면 한 줄(5.15). key = SERVER_VIEW_KEYS
export function serverView(st, nowMs = Date.now()) {
  if (st == null) return { key: 'none', text: '', tone: 'dim' };
  if (st.ok !== true) return { key: 'down', text: FTEXT.serverDown, tone: 'warn' };
  const errText = (e) => (typeof e === 'string' && Object.hasOwn(FTEXT.serverErr, e) ? FTEXT.serverErr[e] : FTEXT.serverDown);
  switch (st.status) {
    case 'pending': return { key: 'pending', text: FTEXT.serverPending, tone: 'warn' };
    case 'on': {
      const hm = num(st.lastCheck) ? fmtHM(st.lastCheck) : '-';
      if (!st.exec || st.exec.up !== true) return { key: 'on', text: `${FTEXT.serverOn(hm)} · ${FTEXT.serverDown}`, tone: 'warn' };
      const stale = !num(st.lastCheck) || nowMs - st.lastCheck > SERVER_STALE_MS;
      return { key: 'on', text: FTEXT.serverOn(hm), tone: stale ? 'warn' : 'good' };
    }
    case 'closing': return { key: 'closing', text: FTEXT.serverClosing, tone: 'warn' };
    case 'off': return { key: 'deleted', text: FTEXT.serverDeleted, tone: 'warn' };
    case 'error': return { key: 'error', text: errText(st.error), tone: 'bad' };
    default:
      if (st.available) return { key: 'none', text: '', tone: 'dim' };
      return { key: 'unavailable', text: st.reason === 'exec_down' ? FTEXT.serverDown : errText(st.reason), tone: 'dim' };
  }
}

// 앱 밖 주문 안내 한 줄(spec §7.6) — 실행기가 그 회원 계정에서 우리가 내지 않은 매매를 봤으면(허브 offApp, 24시간 안) 안내 글, 아니면 null
export function serverOffAppLine(st) {
  return st && st.ok === true && num(st.offApp) ? FTEXT.serverOffApp : null;
}

// 서버 자동 동의 기록(기기 vault kv.consent에 함께 — 판 값 v로 따라가기 동의와 구분, 허브로 보내지 않음 — 규칙 17). 원문 = 등록 화면에 보인 글 전체
export function serverConsentText() {
  return [FTEXT.intro, ...TEXT.legal, TEXT.notice, FTEXT.serverLimit, FTEXT.serverKeyUse, ...FTEXT.consentItems, FTEXT.serverConsentNote, ...FTEXT.serverConsentItems, FTEXT.serverRefreshNote].join('\n');
}
export async function makeServerConsent({ ed, settings, rules, appVersion, now = Date.now(), subtle = globalThis.crypto.subtle }) {
  return {
    v: SERVER_CONSENT_VERSION,
    at: now,
    ed,
    mode: 'server',
    style: 'single',
    rulesVersion: rules.rulesVersion,
    settings: { maxMarginPct: num(settings.maxMarginPct) ? settings.maxMarginPct : null, maxConcurrent: num(settings.maxConcurrent) ? settings.maxConcurrent : null, autoSl: settings.autoSl === true },
    textHash: await sha256Hex(serverConsentText(), subtle),
    appVersion: String(appVersion ?? ''),
  };
}
