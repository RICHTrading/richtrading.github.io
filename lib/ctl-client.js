// 동업자 비상 컨트롤러 허브 경로(계획 2026-10-30 Task 6·7) — /v1/ctl/login·password·logout·members·cmd·cmd/<id>.
// - 세션 토큰(pc1.…)만 이 판 기기 저장소(IndexedDB ptf-<판>-vault, s·j판만) kv ctlToken에 둔다. 아이디·비밀번호는 login 인자로만 받아
//   바로 보내고 저장하지 않는다(브라우저 저장·주소·기록 없음). 토큰은 Authorization 머리글로만.
// - 머리글은 Authorization·Content-Type뿐 — 허브 컨트롤러 사전 요청이 그 둘만 허락한다(회원 경로의 앱 판 머리글을 붙이면
//   브라우저가 사전 요청에서 막음, Task 6 검토 — 회원 머리글 도우미를 쓰지 않는다).
// - 401(토큰 문제만 — 틀린 비밀번호는 403 bad_login)이면 저장한 토큰을 지우고 { auth:true } — 화면이 로그인으로.
// - 그룹(R5 — 동업자가 고른 회원 키 묶음)은 kv ctlGroups = [{ name, members:[해시] }]에만(허브에 두지 않음).
// - 휴대폰 차트 칸 펴짐(R14 — 계획 2026-10-30 Task 10)은 kv ctlChartOpen = true|false에만(브라우저 웹 저장소 안 씀). 없음·틀림·못 읽음이면 펴짐.
// - 칸 꼴은 허브 사본(시험이 hub/lib/ctl-routes.js·exec/lib/wire.js와 비교) — 모르는 칸(손절가 같은 것)이 끼면 통째로 버림.
//   매매의 거래소 청산가 liq·익절가 tp·체결 fills는 동업자 차트 선 재료(계획 2026-10-30 Task 9 — 대표 결정 2026-10-30 저녁 C, 이 경로에만)
// - 새 진입(계획 2026-10-30 Task 11): cmd('enter', members, args) — 본문 { v:1, kind, members, args }(args 칸 정확히 CTL_ENTER_ARGS_KEYS, seenAt 없음).
//   허브가 낱말 bad_args(값이 규칙 밖 — 기본 새 진입은 AI 값만)·entry_off(새 진입을 받지 않는 허브)로 거절할 수 있다.
//   수동 모드 열기(계획 Task 12): cmd('buy', members, args) — 같은 꼴(args 칸 CTL_BUY_ARGS_KEYS, tpPct null = 익절 없음 그대로)
//   수동 모드 닫기(계획 Task 13): cmd('reduce', members, args) — 같은 꼴(args 칸 CTL_REDUCE_ARGS_KEYS { symbol, pct }), 결과 낱말 too_small 더함
//   수동 추가(대표 요청 2026-11-04): cmd('addm', members, args) — 같은 꼴(args 칸 CTL_ADDM_ARGS_KEYS { symbol, pct })
import { memberCapable } from './auto-view.js';
import { memoryVault } from './vault.js';
import { CTL_ENTER_ARGS_KEYS, CTL_BUY_ARGS_KEYS, CTL_REDUCE_ARGS_KEYS, CTL_ADDM_ARGS_KEYS } from './ctl-enter-rules.js';

export { CTL_ENTER_ARGS_KEYS, CTL_BUY_ARGS_KEYS, CTL_REDUCE_ARGS_KEYS, CTL_ADDM_ARGS_KEYS };
// args를 싣는 명령과 그 칸(그 밖 명령은 셋째 인자가 seenAt)
const ARGS_KEYS = Object.freeze({ enter: CTL_ENTER_ARGS_KEYS, buy: CTL_BUY_ARGS_KEYS, reduce: CTL_REDUCE_ARGS_KEYS, addm: CTL_ADDM_ARGS_KEYS });
export const CTL_TOKEN_KV = 'ctlToken';
export const CTL_GROUPS_KV = 'ctlGroups';
export const CTL_CHART_KV = 'ctlChartOpen';
export const CTL_TOKEN_RE = /^pc1\.[A-Za-z0-9_-]{43}$/;
export const CTL_HASH_RE = /^[0-9a-f]{64}$/;
export const CTL_CMD_ID_RE = /^c[0-9a-f]{16}$/;
// = exec/lib/wire.js(시험이 비교) — buy = 수동 모드 열기(계획 Task 12), reduce = 수동 모드 닫기(Task 13), addm = 수동 추가(대표 요청 2026-11-04)
export const CTL_KINDS = Object.freeze(['close', 'add', 'tp', 'off', 'enter', 'buy', 'reduce', 'addm']);
// 결과 낱말 — 1단계 일곱 + 새 진입 다섯 + 줄이기 하나(= exec/lib/wire.js CTL_ERRORS — 시험이 비교)
export const CTL_ERRORS = Object.freeze(['not_enrolled', 'no_trade', 'detached', 'max_stage', 'mode', 'busy', 'failed', 'auto_off', 'has_trade', 'nofund', 'low_balance', 'unclear', 'too_small']);
export const CTL_MAX_TARGETS = 50;
export const CTL_MEMBER_KEYS = Object.freeze(['h', 'uid', 'o', 'funded', 'enrolled', 'status', 'auto', 'symbols', 'bal', 'trades', 'lastCheck']);
// 매매 칸(계획 2026-10-30 Task 9): 새 허브 11칸(익절가 tp·거래소 청산가 liq·체결 fills — 동업자 차트 선 재료), 옛 허브 8칸(V1)도 받아 세 칸을 채운다(R13 —
// 앱을 먼저 게시). 체결 { at, stage 1~4, px }은 CTL_FILLS_MAX개까지(실행기 wire.js와 같은 값 — 시험이 비교)
export const CTL_TRADE_KEYS_V1 = Object.freeze(['id', 'symbol', 'side', 'lev', 'stage', 'avg', 'openedAt', 'src']);
export const CTL_TRADE_KEYS = Object.freeze([...CTL_TRADE_KEYS_V1, 'tp', 'liq', 'fills']);
export const CTL_FILLS_MAX = 8;
export const CTL_GROUPS_MAX = 20;
export const CTL_GROUP_NAME_MAX = 20;
export const CTL_TIMEOUT_MS = 8000;
const CTL_LIST_MAX = 5000;
const STATUSES = Object.freeze(['on', 'closing', 'off', 'error']);
const SRCS = Object.freeze(['signal', 'manual', 'legacy']);
const STATES = Object.freeze(['queued', 'done', 'expired']);
const WORD_RE = /^[a-z_]{1,40}$/;

// 컨트롤러는 기기 저장소가 있는 판(s·j)만 — 회원 활성화와 무관
export const ctlCapable = (config) => memberCapable(config);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => v === null || num(v);
const boolOrNull = (v) => v === null || typeof v === 'boolean';
const exact = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const okTradeBase = (t) => typeof t.id === 'string' && /^[0-9A-Za-z]{1,40}$/.test(t.id) && typeof t.symbol === 'string' && /^[A-Z0-9]{1,20}$/.test(t.symbol)
  && (t.side === 'long' || t.side === 'short') && Number.isInteger(t.lev) && t.lev >= 1 && Number.isInteger(t.stage) && t.stage >= 0
  && numOrNull(t.avg) && num(t.openedAt) && (t.src === null || SRCS.includes(t.src));
const pxOrNull = (v) => v === null || (num(v) && v > 0);
const okFill = (f) => exact(f, ['at', 'stage', 'px']) && num(f.at) && Number.isInteger(f.stage) && f.stage >= 1 && f.stage <= 4 && num(f.px) && f.px > 0;
// 옛 꼴(8칸) 또는 새 꼴(11칸 — 익절가·청산가는 양수|null, 체결 꼴) — 그 밖의 칸(손절가 등)이 끼면 거짓
const okTrade = (t) => (exact(t, CTL_TRADE_KEYS_V1)
  || (exact(t, CTL_TRADE_KEYS) && pxOrNull(t.tp) && pxOrNull(t.liq) && Array.isArray(t.fills) && t.fills.length <= CTL_FILLS_MAX && t.fills.every(okFill)))
  && okTradeBase(t);
// 옛 꼴은 tp·liq null·fills []로 채워 늘 11칸으로 돌려준다(받은 값은 고치지 않음)
const fullTrade = (t) => (exact(t, CTL_TRADE_KEYS_V1) ? { ...t, tp: null, liq: null, fills: [] } : { ...t, fills: t.fills.map((f) => ({ ...f })) });
const okBal = (b) => b === null || (exact(b, ['avail', 'equity', 'at']) && num(b.avail) && num(b.equity) && num(b.at));
const okMember = (m) => exact(m, CTL_MEMBER_KEYS) && typeof m.h === 'string' && CTL_HASH_RE.test(m.h)
  && (m.uid === null || (typeof m.uid === 'string' && /^[0-9A-Z-]{1,24}$/.test(m.uid)))
  && (m.o === null || (typeof m.o === 'string' && /^[A-Za-z0-9_.@-]{1,32}$/.test(m.o)))
  && boolOrNull(m.funded) && typeof m.enrolled === 'boolean' && (m.status === null || STATUSES.includes(m.status)) && boolOrNull(m.auto)
  && Array.isArray(m.symbols) && m.symbols.length <= 10 && m.symbols.every((s) => typeof s === 'string' && /^[A-Z0-9]{1,20}$/.test(s))
  && okBal(m.bal) && Array.isArray(m.trades) && m.trades.length <= 50 && m.trades.every(okTrade) && numOrNull(m.lastCheck);

// GET /v1/ctl/members 답 — 꼴이 정확할 때만 { now, mark, members }(매매는 늘 11칸 — 옛 허브 8칸은 채움), 아니면 null
export function checkMembers(b) {
  if (!exact(b, ['ok', 'now', 'mark', 'members']) || b.ok !== true || !num(b.now) || !(b.mark === null || (num(b.mark) && b.mark > 0))) return null;
  if (!Array.isArray(b.members) || b.members.length > CTL_LIST_MAX || !b.members.every(okMember)) return null;
  if (new Set(b.members.map((m) => m.h)).size !== b.members.length) return null;
  return { now: b.now, mark: b.mark, members: b.members.map((m) => ({ ...m, trades: m.trades.map(fullTrade) })) };
}

// GET /v1/ctl/cmd/<id> 답 → { state, results:[{h, ok, error}] } | null. 결과 낱말이 CTL_ERRORS 밖이면 failed(허브와 같은 규칙)
export function checkCmdResult(b) {
  if (!exact(b, ['ok', 'state', 'results']) || b.ok !== true || !STATES.includes(b.state) || !Array.isArray(b.results) || b.results.length > CTL_MAX_TARGETS) return null;
  const out = [];
  for (const r of b.results) {
    if (!exact(r, ['h', 'ok', 'error']) || typeof r.h !== 'string' || !CTL_HASH_RE.test(r.h) || typeof r.ok !== 'boolean') return null;
    if (!(r.error === null || (typeof r.error === 'string' && WORD_RE.test(r.error)))) return null;
    out.push({ h: r.h, ok: r.ok, error: r.ok ? null : CTL_ERRORS.includes(r.error) ? r.error : 'failed' });
  }
  return { state: b.state, results: out };
}

// 그룹 꼴 정리 — 이름(앞뒤 공백·제어 글자 지움, 20자) 1자 이상·같은 이름 없음, 회원 해시 꼴만·중복 없음·1~50명, 20개까지
export function cleanGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const names = new Set();
  for (const g of raw) {
    if (out.length >= CTL_GROUPS_MAX) break;
    if (!g || typeof g !== 'object' || typeof g.name !== 'string' || !Array.isArray(g.members)) continue;
    const name = [...g.name.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, CTL_GROUP_NAME_MAX).join('').trim();
    if (!name || names.has(name)) continue;
    const members = [...new Set(g.members.filter((h) => typeof h === 'string' && CTL_HASH_RE.test(h)))].slice(0, CTL_MAX_TARGETS);
    if (!members.length) continue;
    names.add(name);
    out.push({ name, members });
  }
  return out;
}

// getVault: () => Promise<vault|null> — 앱은 bootMember가 연 기기 저장소(못 열면 이번 실행 동안만 메모리)
export function createCtlClient({ base, getVault = async () => null, fetchImpl = (...a) => globalThis.fetch(...a), signalFor = (ms) => AbortSignal.timeout(ms), timeoutMs = CTL_TIMEOUT_MS } = {}) {
  const root = String(base).replace(/\/+$/, '');
  const mem = memoryVault();
  let tok; // undefined = 아직 안 읽음, null = 없음
  const vault = async () => {
    try {
      return (await getVault()) || mem;
    } catch {
      return mem;
    }
  };
  async function token() {
    if (tok !== undefined) return tok;
    let v = null;
    try {
      v = await (await vault()).get(CTL_TOKEN_KV);
    } catch {
      v = null;
    }
    tok = typeof v === 'string' && CTL_TOKEN_RE.test(v) ? v : null;
    return tok;
  }
  async function dropToken() {
    tok = null;
    try {
      await (await vault()).del(CTL_TOKEN_KV);
    } catch {
      // 지우기 실패 — 다음에 401로 다시
    }
  }
  const fail = (error, retryAfter = null, extra = {}) => ({ ok: false, error, retryAfter, ...extra });
  const retryOf = (res) => {
    const v = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
    const n = Number(v);
    return v != null && Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
  };
  // 한 번 부르기 → { status, body, res } | null(닿지 못함)
  async function call(path, { method = 'GET', body, auth = null } = {}) {
    const headers = {};
    if (auth) headers.Authorization = `Bearer ${auth}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(`${root}${path}`, {
        method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store', mode: 'cors', credentials: 'omit', signal: signalFor(timeoutMs),
      });
    } catch {
      return null;
    }
    if (!res || typeof res.status !== 'number') return null;
    let b = null;
    try {
      b = await res.json();
    } catch {
      b = null;
    }
    return { status: res.status, body: b, res };
  }
  const errOf = (r) => (r.body && typeof r.body.error === 'string' && WORD_RE.test(r.body.error) ? r.body.error : 'down');
  // 토큰이 필요한 부르기 — 없으면 auth, 401이면 토큰을 지우고 auth
  async function authed(path, opts) {
    const t = await token();
    if (!t) return { r: null, out: fail('bad_token', null, { auth: true }) };
    const r = await call(path, { ...opts, auth: t });
    if (!r) return { r: null, out: fail('down') };
    if (r.status === 401) {
      await dropToken();
      return { r, out: fail('bad_token', null, { auth: true }) };
    }
    return { r, out: null };
  }

  return {
    token,
    async login(id, password) {
      if (typeof id !== 'string' || typeof password !== 'string') return fail('bad_request');
      const r = await call('/v1/ctl/login', { method: 'POST', body: { v: 1, id, password } });
      if (!r) return fail('down');
      const b = r.body;
      if (r.status === 200 && b && b.ok === true && typeof b.token === 'string' && CTL_TOKEN_RE.test(b.token)) {
        tok = b.token;
        try {
          await (await vault()).set(CTL_TOKEN_KV, b.token); // 토큰만(아이디·비밀번호·기한·이름 없음)
        } catch {
          // 저장 실패 — 이번 실행 동안만 메모리
        }
        return { ok: true };
      }
      return fail(errOf(r), retryOf(r.res));
    },
    async password(oldPw, newPw) {
      if (typeof oldPw !== 'string' || typeof newPw !== 'string') return fail('bad_request');
      const { r, out } = await authed('/v1/ctl/password', { method: 'POST', body: { v: 1, old: oldPw, new: newPw } });
      if (out) return out;
      if (r.status === 200 && r.body && r.body.ok === true) return { ok: true };
      return fail(errOf(r), retryOf(r.res));
    },
    // 로그아웃 — 허브 답과 상관없이 이 기기 토큰은 지운다
    async logout() {
      const t = await token();
      if (t) await call('/v1/ctl/logout', { method: 'POST', auth: t });
      await dropToken();
      return { ok: true };
    },
    async members() {
      const { r, out } = await authed('/v1/ctl/members', {});
      if (out) return out;
      if (r.status !== 200) return fail(errOf(r), retryOf(r.res));
      const v = checkMembers(r.body);
      return v ? { ok: true, ...v } : fail('bad_shape');
    },
    // 셋째 인자 — enter·buy·reduce·addm이면 args(칸 정확히 — 아니면 보내지 않고 bad_request, 값은 화면 enterArgsOk·buyArgsOk·reduceArgsOk·addmArgsOk·허브가 봄),
    // 다른 명령이면 seenAt = 동업자가 본 목록 응답 now(ms 정수 — 최종 검토 고침 F1: 실행기 다음 차수가 그 뒤 체결이면 busy). 정수가 아니면 싣지 않음(허브가 받은 시각)
    async cmd(kind, members, third = null) {
      if (!CTL_KINDS.includes(kind) || !Array.isArray(members) || !members.length) return fail('bad_request');
      if (members.length > CTL_MAX_TARGETS) return fail('too_many');
      if (!members.every((h) => typeof h === 'string' && CTL_HASH_RE.test(h)) || new Set(members).size !== members.length) return fail('bad_request');
      let extra;
      if (Object.hasOwn(ARGS_KEYS, kind)) {
        const keys = ARGS_KEYS[kind];
        if (!exact(third, keys)) return fail('bad_request');
        extra = { args: Object.fromEntries(keys.map((k) => [k, third[k]])) };
      } else extra = Number.isSafeInteger(third) && third >= 0 ? { seenAt: third } : {};
      const { r, out } = await authed('/v1/ctl/cmd', { method: 'POST', body: { v: 1, kind, members: [...members], ...extra } });
      if (out) return out;
      if (r.status === 202 && r.body && r.body.ok === true && typeof r.body.id === 'string' && CTL_CMD_ID_RE.test(r.body.id)) return { ok: true, id: r.body.id };
      return fail(r.status === 202 ? 'down' : errOf(r), retryOf(r.res));
    },
    async cmdResult(id) {
      if (typeof id !== 'string' || !CTL_CMD_ID_RE.test(id)) return fail('bad_request');
      const { r, out } = await authed(`/v1/ctl/cmd/${id}`, {});
      if (out) return out;
      if (r.status === 404) return fail('not_found');
      if (r.status !== 200) return fail(errOf(r), retryOf(r.res));
      const v = checkCmdResult(r.body);
      return v ? { ok: true, ...v } : fail('bad_shape');
    },
    async loadGroups() {
      try {
        return cleanGroups(await (await vault()).get(CTL_GROUPS_KV));
      } catch {
        return [];
      }
    },
    async saveGroups(list) {
      const clean = cleanGroups(list);
      try {
        await (await vault()).set(CTL_GROUPS_KV, clean);
        return { ok: true, groups: clean };
      } catch {
        return { ok: false, groups: clean };
      }
    },
    // 휴대폰 차트 칸 — false로 저장된 때만 접힘(없음·틀린 값·저장소가 던짐 → 펴짐)
    async loadChartOpen() {
      try {
        return (await (await vault()).get(CTL_CHART_KV)) !== false;
      } catch {
        return true;
      }
    },
    // 저장 실패(사생활 보호 모드 등)면 false — 화면은 이번 동안만 그 상태로
    async saveChartOpen(on) {
      try {
        await (await vault()).set(CTL_CHART_KV, on === true);
        return true;
      } catch {
        return false;
      }
    },
  };
}
