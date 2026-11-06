// 서버 자동(④ — 2026-10-12 설계 §5.2·§7.6·§10·5.6·5.14, 대표 결정 7) — 허브 회원 경로 /v1/member/server/{enroll,state,off}(회원 토큰은 Authorization 머리글로만 — 규칙 12)와 상태 보기.
// 등록 묶음(sealConnectedKey): 새 키 없이 키 화면에 연결해 둔 kv.ox를 WS 로그인 길(ox-client)과 같은 함수(vault.js loadOxKey·openOxSecret)로 풀어
// 바로 실행기 공개키로 잠근다(server-enroll.js sealEnrollment). 푼 원문은 그 함수의 지역 변수에만 — 모듈 상태·DOM·기록 없음, 허브로는 잠근 묶음만.
// 상태는 보이는 동안 30초마다(등록 중·끄는 중은 5초), 숨으면 멈춘다. state() = SERVER_STATE | null(아직 모름·회원 아님) | { ok:false, error:'down', now }(받기 실패).
// 서버 매매(trades)는 그 회원 것만 — 평단·정리가·USDT는 이 회원에게만, 자동 손절은 상태 낱말 키만(가격 칸 없음 — 모르는 칸이 있으면 통째로 버림).
// offApp(spec §7.6) = 그 회원 계정의 앱 밖 주문 감지 시각 → serverOffAppLine 안내 한 줄(경보 아님)
// 회원 명령(설계 2026-10-16 §15.8 — 서버 전용): cmd(kind, args)는 기기 명령 키(cmd-key.js)로 서명해 /v1/member/server/cmd, cmdResult(id)로 결과. 화면은 P2b
import { memberHeaders } from './member.js';
import { followCapable } from './follow-view.js';
import { FTEXT, SERVER_CONSENT_VERSION } from './follow-text.js';
import { TEXT, fmtHM } from './auto-view.js';
import { sha256Hex } from './follow-settings.js';
import { loadOxKey, openOxSecret } from './vault.js';
import { sealEnrollment, b64u } from './server-enroll.js';
import { createCmdKey, CMD_KINDS, CMD_ID_RE, CMD_MAX_BYTES } from './cmd-key.js';
import { canonJson } from './canon-json.js';

// 회원 상태 v2(설계 2026-10-16 §15.19-11, 계획 2026-10-21 Task 22 — 화면은 P2b): 끝 다섯 칸 = 그 회원 실행기 보고 칸(auto·settings·notes·skips·cmds).
// 옛 허브 답(SERVER_STATE_KEYS_V1 — 허브를 먼저 바꾸는 배포 순서라 잠깐 있을 수 있음)도 받는다. 매매 줄은 옛 칸(v1) 또는 v2(+ src·nextStage·slWatch)
export const SERVER_STATE_KEYS_V1 = Object.freeze(['ok', 'now', 'available', 'reason', 'status', 'error', 'lastCheck', 'exec', 'trades', 'offApp']);
export const SERVER_STATE_KEYS = Object.freeze([...SERVER_STATE_KEYS_V1, 'auto', 'settings', 'notes', 'skips', 'cmds']);
export const SERVER_TRADE_KEYS = Object.freeze(['id', 'symbol', 'side', 'lev', 'stage', 'state', 'openedAt', 'closedAt', 'avg', 'exit', 'resultPct', 'pnlUsdt', 'autoSl', 'rehearsal']);
export const SERVER_TRADE_KEYS_V2 = Object.freeze([...SERVER_TRADE_KEYS, 'src', 'nextStage', 'slWatch']);
export const SL_WATCH_KINDS = Object.freeze(['after4', 'early', 'forced', 'pct']); // = sl-watch.js SL_WATCH_KINDS(시험이 비교 — 앱 화면이 실행기 모듈을 가져오지 않게 사본)
const TRADE_SRCS = Object.freeze(['signal', 'manual', 'legacy']);
const SETTINGS_KEYS = Object.freeze(['maxMarginPct', 'lev', 'firstPct', 'tpPct', 'slMode', 'slPct', 'skipWeak', 'autoSl']); // = 실행기 보고 REPORT_SETTINGS_KEYS
// D37(설계 §15.20) 새 꼴 = 실행기 보고 AUTO_REPORT_KEYS(사본 — 앱은 wire.js를 가져오지 않음, 시험이 비교). 옛 8칸 꼴도 받음(배포 순서 사이)
// 자동매매 여러 종목(2026-10-23): 새 6칸(+ symbols — 고른 종목 0~10개) = 실행기 AUTO_REPORT_KEYS, 옛 5칸(AUTO_SETTINGS_KEYS_D37 — 옛 실행기, 종목 BTC로 봄)도 받음
export const AUTO_SETTINGS_KEYS_D37 = Object.freeze(['autoSl', 'max', 'until', 'startedAt', 'done']);
export const AUTO_SETTINGS_KEYS = Object.freeze([...AUTO_SETTINGS_KEYS_D37, 'symbols']);
const AUTO_COUNT_MAX = 1000;
const LIMITS = Object.freeze({ notes: 5, skips: 5, cmds: 20 });
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
const WORD_RE = /^[a-z_]{1,40}$/; // 명령 오류·결과 낱말 꼴(= exec 보고 cmds error 꼴)

// 빌드가 serverExec 판·실행기 공개키를 찍었는가(따라가기 화면의 ④ 라디오·app.js 배선)
export const serverBuildReady = (config) => !!config && config.serverExec === true && !!config.exec && PUB_RE.test(String(config.exec.pubKey)) && FP_RE.test(String(config.exec.fp));
// 서버 자동 자격 = 따라가기 자격(followCapable — s·j판 같은 판 인증 && (autoReady || 시험 토큰)) && 서버 자동 빌드
export const serverCapable = (config, member) => followCapable(config, member) && serverBuildReady(config);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => v === null || num(v);
const exact = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
function okTrade(t) {
  const v2 = exact(t, SERVER_TRADE_KEYS_V2);
  return (v2 || exact(t, SERVER_TRADE_KEYS)) && typeof t.id === 'string' && /^[0-9A-Za-z]{1,40}$/.test(t.id) && typeof t.symbol === 'string' && /^[A-Z0-9]{1,20}$/.test(t.symbol)
    && (t.side === 'long' || t.side === 'short') && Number.isInteger(t.lev) && Number.isInteger(t.stage) && TRADE_STATES.includes(t.state)
    && num(t.openedAt) && numOrNull(t.closedAt) && numOrNull(t.avg) && numOrNull(t.exit) && numOrNull(t.resultPct) && numOrNull(t.pnlUsdt)
    && (t.autoSl === null || (typeof t.autoSl === 'string' && /^[A-Za-z]{1,20}$/.test(t.autoSl))) && typeof t.rehearsal === 'boolean'
    && (!v2 || (TRADE_SRCS.includes(t.src) && (t.nextStage === null || (Number.isInteger(t.nextStage) && t.nextStage >= 1 && t.nextStage <= 4))
      && (t.slWatch === null || SL_WATCH_KINDS.includes(t.slWatch))));
}
// v2 회원 칸 — 낱말·번호만(가격 칸이 끼면 통째로 버림). 낱말 목록은 고정하지 않고 꼴만(새 낱말이 와도 상태 전체를 버리지 않게 — 화면은 아는 낱말만, P2b)
const pctIn = (v, hi) => num(v) && v > 0 && v <= hi;
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const okSymbols = (v) => Array.isArray(v) && v.length <= 10 && v.every((x) => typeof x === 'string' && /^[A-Z0-9]{1,20}$/.test(x)) && new Set(v).size === v.length;
const okAutoSettings = (s) => (exact(s, AUTO_SETTINGS_KEYS) ? okSymbols(s.symbols) : exact(s, AUTO_SETTINGS_KEYS_D37)) && typeof s.autoSl === 'boolean' && (s.max === null || intIn(s.max, 1, AUTO_COUNT_MAX))
  && numOrNull(s.until) && numOrNull(s.startedAt) && intIn(s.done, 0, AUTO_COUNT_MAX);
const okSettings = (s) => s === null || okAutoSettings(s) || (exact(s, SETTINGS_KEYS) && (s.maxMarginPct === null || pctIn(s.maxMarginPct, 100)) && Number.isInteger(s.lev) && s.lev >= 1 && s.lev <= 125
  && pctIn(s.firstPct, 100) && pctIn(s.tpPct, 1000) && (s.slMode === 'partner' || s.slMode === 'pct') && (s.slPct === null || pctIn(s.slPct, 100))
  && typeof s.skipWeak === 'boolean' && typeof s.autoSl === 'boolean');
const posInt = (v) => Number.isSafeInteger(v) && v >= 1;
const listOk = (a, max, ok) => Array.isArray(a) && a.length <= max && a.every(ok);
const okV2 = (b) => typeof b.auto === 'boolean' && okSettings(b.settings)
  && listOk(b.notes, LIMITS.notes, (x) => exact(x, ['n', 'code']) && posInt(x.n) && typeof x.code === 'string' && WORD_RE.test(x.code))
  && listOk(b.skips, LIMITS.skips, (x) => exact(x, ['code', 'n']) && typeof x.code === 'string' && WORD_RE.test(x.code) && posInt(x.n))
  && listOk(b.cmds, LIMITS.cmds, (x) => exact(x, ['id', 'ok', 'error']) && typeof x.id === 'string' && CMD_ID_RE.test(x.id) && typeof x.ok === 'boolean'
    && (x.error === null || (typeof x.error === 'string' && WORD_RE.test(x.error))));
// GET /v1/member/server/state 답(5.6·v2) — 정확한 모양만(옛 칸 또는 v2 칸), 아니면 null
export function checkServerState(b) {
  const v2 = exact(b, SERVER_STATE_KEYS);
  if (!v2 && !exact(b, SERVER_STATE_KEYS_V1)) return null;
  if (v2 && !okV2(b)) return null;
  if (b.ok !== true || !num(b.now) || typeof b.available !== 'boolean' || !REASONS.includes(b.reason) || !STATUSES.includes(b.status)) return null;
  if (!(b.error === null || (typeof b.error === 'string' && /^[a-z_]{1,40}$/.test(b.error))) || !numOrNull(b.lastCheck) || !numOrNull(b.offApp)) return null;
  if (!exact(b.exec, ['up', 'lastSeen']) || typeof b.exec.up !== 'boolean' || !numOrNull(b.exec.lastSeen)) return null;
  if (!Array.isArray(b.trades) || b.trades.length > 50 || !b.trades.every(okTrade)) return null;
  return b;
}

// 연결해 둔 키 → 등록 묶음 v2(대표 결정 7, 설계 2026-10-16 §15.19-7). vault = 이 판 기기 저장소(ptf-<판>-vault — kv.ox·kv.oxSeal·kv.cmdKey).
// 묶음 평문 = { v:2, clientId, secret, devPub, ts, nonce } — devPub은 이 기기 명령 키(cmd-key.js — 없으면 여기서 만듦, 등록 때 만든다 §15.8). settings는 받아도
// 묶음에 넣지 않는다(설정은 등록 뒤 settings 명령 — 옛 등록 화면이 넘기는 값은 버림). 기기 키를 못 만들면(저장 실패 등) key_open.
// load·open은 키 화면·WS 로그인 길과 같은 vault.js 함수(시험만 바꿈), seal = server-enroll.js sealEnrollment.
export async function sealConnectedKey({
  vault, config, now = Date.now(), subtle = globalThis.crypto && globalThis.crypto.subtle, cryptoImpl = globalThis.crypto,
  load = loadOxKey, open = openOxSecret, seal = sealEnrollment, cmdKeyFor = (v, s) => createCmdKey({ vault: v, subtle: s }),
}) {
  let k;
  try {
    k = await load(vault);
  } catch {
    return { ok: false, error: 'key_open' };
  }
  if (!k || k.state === 'none') return { ok: false, error: 'no_key' };
  if (k.state !== 'ok' || !k.rec) return { ok: false, error: 'key_open' };
  let devPub;
  try {
    ({ devPub } = await cmdKeyFor(vault, subtle).ensure());
  } catch {
    return { ok: false, error: 'key_open' };
  }
  let secret = null;
  try {
    secret = await open(k.rec, subtle);
  } catch {
    return { ok: false, error: 'key_open' };
  }
  try {
    const ex = config && config.exec ? config.exec : {};
    const blob = await seal({ pubKey: ex.pubKey, fp: ex.fp, clientId: k.rec.clientId, secret, devPub, now, subtle, cryptoImpl });
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
  cmdKey = null, // 기기 명령 키(cmd-key.js createCmdKey — 같은 판 기기 저장소). 없으면 명령은 dev_key
  cryptoImpl = globalThis.crypto,
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
  // 회원 명령(설계 2026-10-16 §15.8) — { v:1, kind, args, ts, nonce(16바이트 b64u), dev }를 기기 키로 서명해 POST /v1/member/server/cmd(본문 = 명령 칸 정확히,
  // 토큰은 Authorization만). 답 { ok:true, id }(id = c + 16자 16진) → { ok:true, id }. 실패는 낱말 코드만(글은 P2b): bad_request·too_big(보내지 않음)·no_token·
  // dev_key(기기 키 없음·메모리 저장소·서명 실패)·rate(429)·허브 낱말(manual_off·test_only·full …)·down(끊김·이상한 답)
  async function cmd(kind, args) {
    if (!CMD_KINDS.includes(kind) || !args || typeof args !== 'object' || Array.isArray(args) || Object.getPrototypeOf(args) !== Object.prototype) return { ok: false, error: 'bad_request' };
    const tok = token();
    if (!tok) return { ok: false, error: 'no_token' };
    if (!cmdKey) return { ok: false, error: 'dev_key' };
    let body;
    try {
      const { dev } = await cmdKey.ensure();
      const c = { v: 1, kind, args, ts: now(), nonce: b64u(cryptoImpl.getRandomValues(new Uint8Array(16))), dev };
      canonJson(c); // 정렬 JSON으로 못 만드는 args(함수·NaN 등)는 서명 전에 걸러진다
      body = { ...c, sig: await cmdKey.sign(c) };
    } catch (e) {
      return { ok: false, error: /^canon_/.test(String(e && e.message)) ? 'bad_request' : 'dev_key' };
    }
    if (new TextEncoder().encode(canonJson(body)).length > CMD_MAX_BYTES) return { ok: false, error: 'too_big' };
    let res;
    let b = null;
    try {
      res = await fetchImpl(`${base}/v1/member/server/cmd`, opts(tok, 'POST', body));
      b = await readJson(res);
    } catch {
      return { ok: false, error: 'down' };
    }
    if ((res.status === 200 || res.status === 202) && b && b.ok === true) {
      return typeof b.id === 'string' && CMD_ID_RE.test(b.id) ? { ok: true, id: b.id } : { ok: false, error: 'down' };
    }
    if (res.status === 429) return { ok: false, error: 'rate' };
    const e = b && typeof b.error === 'string' && WORD_RE.test(b.error) ? b.error : 'down';
    return { ok: false, error: e };
  }
  // 명령 결과(계획 정한 것 6) — GET /v1/member/server/cmd/<id>(그 회원 것만, 허브 답 { ok, now, state, result }) → { state: 'queued'|'done'|'expired'|null, ok, error }.
  // done만 ok(불리언)·error(낱말|null), 404 = 허브가 잊음(10분) → expired·not_found, 번호 꼴 밖은 묻지 않음(bad_request), 끊김·이상한 답 → state null·down
  async function cmdResult(id) {
    if (typeof id !== 'string' || !CMD_ID_RE.test(id)) return { state: null, ok: null, error: 'bad_request' };
    const tok = token();
    if (!tok) return { state: null, ok: null, error: 'no_token' };
    let res;
    let b = null;
    try {
      res = await fetchImpl(`${base}/v1/member/server/cmd/${id}`, opts(tok, 'GET'));
      b = await readJson(res);
    } catch {
      return { state: null, ok: null, error: 'down' };
    }
    if (res.status === 404) return { state: 'expired', ok: null, error: 'not_found' };
    // 허브 답 = { ok:true, now, state, result: { ok, error } | null }(hub/lib/exec-cmd.js — 겉 ok는 HTTP 성공, 명령 결과는 result 안. Task 8·9 검토)
    if (res.status !== 200 || !b || typeof b !== 'object' || b.ok !== true) return { state: null, ok: null, error: 'down' };
    if (b.state === 'queued' || b.state === 'expired') return { state: b.state, ok: null, error: null };
    const r = b.result;
    if (b.state === 'done' && r && typeof r === 'object' && typeof r.ok === 'boolean' && (r.error == null || (typeof r.error === 'string' && WORD_RE.test(r.error)))) {
      return { state: 'done', ok: r.ok, error: r.error == null ? null : r.error };
    }
    return { state: null, ok: null, error: 'down' };
  }
  return {
    state: () => st,
    refresh,
    cmd,
    cmdResult,
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
  // 옛 serverKeyUse 줄은 대표 검토 2026-10-20으로 뺌(serverConsentItems '키가 서버에 암호화되어 보관됩니다.'와 겹침 — 판은 server-consent-2026-10-20 그대로, 게시 전)
  return [FTEXT.intro, ...TEXT.legal, TEXT.notice, FTEXT.serverLimit, ...FTEXT.consentItems, FTEXT.serverConsentNote, ...FTEXT.serverConsentItems, FTEXT.serverRefreshNote].join('\n');
}
// D37 자동매매 동의(옛 autoConsentText·makeAutoConsent — 동의 창 원문·기기 동의 기록)는 대표 결정 2026-10-23('동의 문구는 그냥 다 빼 의미 없어')으로 뺐다.
// 서버 판 자동매매는 동의 창 없이 시작하고 동의 기록을 남기지 않는다(server-cmd-flow.js startAuto)
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
