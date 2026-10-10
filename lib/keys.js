// 거래소 키 연결(설계 3-2 §5.1~§5.8, 문구 §8.1 K-01~K-13) — 문구·자격·입력 검사·진단 줄·오류 분류(순수 함수)와 연결 상태(createKeyControl, 아래).
// - 키 화면은 s·j판 인증 회원이고 (autoReady 또는 tradeReady 또는 시험 토큰)일 때만(§5.1, p2 spec 머리말). 공용판은 화면도 기기 저장소도 쓰지 않는다.
// - 비밀 키 원문(2026-10-08 개정)은 이 기기·이 판의 꺼낼 수 없는 AES-GCM 키로 바로 봉인하고(vault.js sealOxSecret) 원문은 들고 있지 않는다 —
//   저장은 봉인만, 기록·허브 전송 없음(§5.3). 로그인 때 ox-client가 /public/auth 바로 앞에서만 풀어 오렌지엑스로 보낸다.
//   실패하면 kv.ox에 아무것도 저장하지 않는다(§5.2). 예전 방식(HMAC 키만) 기록은 'old' — 다시 넣어 달라고 한다(KTEXT.rekey).
import { memberCapable } from './auto-view.js';
import { VTEXT, OPEN_TRADE_STATES } from './member.js';
import { OX_AUTH_FAIL, OX_PARAM_FAIL, OX_RELOGIN_RETRY_MS, accountCheck } from './ox-client.js';
import { requireDurable, saveOxKey, loadOxKey, deleteOxKey, persistStorage, sealKeyFor, sealOxSecret } from './vault.js';

export const KTEXT = Object.freeze({
  title: '오렌지엑스 연결', // K-01
  intro: '자동 따라 주문과 한 번 눌러 주문에 쓰는 거래 전용 키를 이 기기에만 저장합니다. 키는 이 화면에서만 넣습니다 — 다른 창이나 팝업이 키를 물으면 넣지 마세요.', // K-02
  apiLabel: 'API 키', // K-04
  secretLabel: '비밀 키(Secret)',
  privacyRelay: "비밀 키는 이 기기 안에 암호화되어 저장되고, 이 기기가 오렌지엑스에 직접 로그인할 때만 오렌지엑스로 보냅니다 — 리치 서버로는 보내지 않습니다. 주문은 리치 서버를 거쳐 오렌지엑스로 전달되므로, 서버는 전달하는 동안 주문 내용과 오렌지엑스 접속 토큰(약 12시간 동안 이 키의 거래 권한으로 쓸 수 있음)을 받습니다. 서버는 이것을 저장·기록하지 않고, 출금·이체·키 관리 요청은 전달하지 않습니다. '연결 해제'나 앱 삭제는 이 기기의 키를 지우지만 이미 받은 접속 토큰은 만료까지 남습니다 — 걱정되면 오렌지엑스에서 키를 삭제하세요.", // K-05a
  privacyDirect: "비밀 키는 이 기기 안에 암호화되어 저장되고, 이 기기가 오렌지엑스에 직접 로그인할 때만 오렌지엑스로 보냅니다 — 리치 서버로는 보내지 않습니다. 로그인과 주문 모두 이 기기가 오렌지엑스에 직접 보냅니다. 앱을 지우거나 '연결 해제'를 누르면 키가 지워집니다.", // K-05b
  submit: '연결하기', // K-06
  pending: '확인 중…',
  ok: (tail) => `연결됐습니다 · 계정 UID …${tail} · 거래 전용 키`, // K-07
  authFail: '키가 맞지 않거나 삭제됐습니다. 오렌지엑스에서 키를 확인하고 다시 연결해 주세요.', // K-08a
  forbidden: '이 키에는 출금·블록 거래 같은 거래 밖 쓰기 권한이 있습니다. 안전을 위해 거래 권한만 있는 키를 새로 만들어 주세요.', // K-08b
  accountWrite: "이 키는 계정 권한이 '읽기·쓰기'입니다. 오렌지엑스에서 계정 권한을 '읽기'로 바꿔 새 키를 만들어 주세요(거래는 읽기·쓰기 그대로).", // K-08h(p34 §6.6)
  // K-08h + K-08c(p35 L-10): 계정 쓰기 + 거래 권한 없음 — 두 이유를 한 문구로(K-08h의 '거래는 … 그대로'를 잇지 않는다 — 거래 권한이 있다는 뜻이라 어긋남)
  accountWriteNoTrade: "이 키는 계정 권한이 '읽기·쓰기'이고 거래 권한(거래 읽기·쓰기)이 없습니다. 오렌지엑스에서 계정은 '읽기', 거래는 '읽기·쓰기'로 골라 새 키를 만들어 주세요.",
  // 동업자 API 연결 가이드(guide/ox-api.pdf — config.guides.api일 때만, p34 §6.6). PDF는 고치지 않고 화면 줄로 맞춘다
  guideLink: '📄 연결 가이드',
  guideAccountRead: "가이드 1쪽의 '계정' 권한은 '읽기'로 고르세요(거래는 읽기·쓰기, 지갑은 읽기). 이 앱은 계정 쓰기 권한이 있는 키를 받지 않습니다.", // K-03c
  guidePage2: '가이드 2쪽은 PC 프로그램 화면입니다. 이 앱에서는 이 화면에 붙여 넣고, 키는 이 휴대폰에만 암호화해 보관합니다.',
  noTrade: '이 키에는 거래 권한(거래 읽기·쓰기)이 없습니다.', // K-08c
  noAccount: '이 키에는 계정 읽기 권한이 없습니다.', // K-08d
  noScope: '키 권한을 확인할 수 없어 연결하지 않았습니다.', // K-08e
  account: (tail) => `인증한 UID(…${tail})와 이 키의 계정이 다릅니다. 같은 계정의 키를 넣어 주세요.`, // K-08f
  clock: '로그인 요청이 거절됐습니다. 휴대폰 시각이 자동으로 맞춰져 있는지 확인하고 다시 해 주세요.', // K-08g
  disconnect: '연결 해제', // K-09
  disconnectConfirm: '이 기기에 저장된 오렌지엑스 키를 지울까요? 따라가기가 꺼집니다. 거래소의 포지션과 익절·손절 주문은 그대로 남습니다.',
  cantDelete: '이 기기의 키를 지우지 못했습니다. 다시 눌러 주세요. 계속 안 되면 오렌지엑스에서 키를 삭제하세요.', // K-09b(2026-10-08)
  testNote: '시험용 인증은 계정 일치 확인으로 막지 않습니다. 신호를 내는 실계좌가 아닌 다른 시험 계정의 키인지 확인해 주세요.', // K-10
  testCheck: '다른 계정의 키입니다',
  // K-11(p35 L-1): 배율 변경에 어떤 권한이 필요한지는 U4(T11 대표 실측) 전이라 모른다 — K-08h가 거절하는 '계정 읽기·쓰기' 키를 권하지 않는 중립 문구.
  // 실측 답이 오면 정확한 안내로 바꾼다
  levDenied: '이 키로는 배율을 바꿀 수 없습니다 — 담당자에게 문의해 주세요.', // K-11
  levContact: '카카오톡 문의', // K-11 바로 아래 문의 링크(따라가기 화면, config.kakao)
  rowLabel: '거래소 연결', // K-12
  rowOn: (tail) => `연결됨 · 계정 …${tail} · 거래 전용`,
  rowBad: '키 확인 필요',
  rowOff: '안 됨',
  clipboard: '복사한 비밀 키가 클립보드에 남아 있을 수 있습니다 — 다른 내용을 복사해 덮어 주세요.', // K-13
  reconnect: '키를 다시 연결해 주세요.', // §5.2 저장소 정리 · §5.4-9 계정 바뀜
  rekey: '키 저장 방식이 바뀌어 예전에 연결한 키는 더 쓸 수 없습니다. 오렌지엑스 API 키와 비밀 키를 다시 넣어 연결해 주세요.', // 2026-10-08 개정 — 예전 기록(HMAC 키만)
  cantStore: '이 기기에서는 키를 저장할 수 없습니다.', // §9.1 U14
  down: '거래소 연결 끊김 — 주문하지 않습니다', // §5.8 · F-08
  unknownError: (code) => `거래소 오류(코드 ${code})`, // §5.8
  diagLabel: '진단', // §5.4 진단 줄(설정)
  // 설계 §8.1에 없는 줄 — 허브 레인 설계 개정 때 추가 요청(이 계획 '넘길 것' 2)
  badInput: 'API 키와 비밀 키를 공백 없이 그대로 붙여 넣어 주세요.',
  relayRejected: '오렌지엑스가 서버 경유 주문을 받지 않아 연결하지 않았습니다. 문의해 주세요.',
  scopeGot: (s) => `받은 권한: ${s}`,
});

// K-03 — 계정 쓰기 허용 빌드(oxScope.allowAccountWrite, T11 결과)면 ② '계정 읽기·쓰기'
export function keyGuide(allowAccountWrite = false) {
  return [
    '① PC에서 orangex.com → 사용자 센터 → API 관리(orangex.com/user-center/api)에서 새 키를 만드세요(본인인증 1단계·구글 OTP 필요).',
    // p35 L-2: 지갑은 '읽기'(실측 권한 wallet:read — K-03c 가이드 줄과 같은 말)
    `② 권한: ${allowAccountWrite ? '계정 읽기·쓰기' : '계정 읽기'} · 거래 읽기·쓰기 · 지갑 읽기 · 블록 거래 권한 없음 — 거래 전용·출금 권한 없음.`,
    "③ IP 제한: 'IP 제한 없음'(휴대폰은 IP가 계속 바뀝니다).",
    '④ 만든 API 키와 비밀 키를 아래에 붙여 넣으세요.',
  ];
}

export const KEYS_IDLE = Object.freeze({ status: 'none', pending: false, message: null, account: null, scope: null, transport: null, receivedScope: null, diag: null });

// 키 화면 자격(p2 spec 머리말): s·j판 + 같은 판 인증 + (autoReady || tradeReady || 시험 토큰).
// 따라가기 자격은 follow-view.js followCapable — tradeReady(트레이딩 탭 수동 주문)로는 열리지 않는다
export function keysCapable(config, member) {
  return memberCapable(config) && !!member && typeof member === 'object' && member.ed === config.edition
    && (config.autoReady === true || config.tradeReady === true || member.test === true);
}

// 붙여 넣은 값 정리: 보이지 않는 글자(ZWSP·BOM 등)와 앞뒤 공백·줄바꿈을 지운다. 가운데 공백은 형식 오류(오렌지엑스 키 형식은 문서에 없어 느슨하게, §5.2)
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
export function validateKeyInput(apiKey, secret) {
  const clean = (v) => String(v ?? '').replace(INVISIBLE, '').trim();
  const a = clean(apiKey);
  const s = clean(secret);
  const ok = (v) => /^\S{1,256}$/.test(v);
  return ok(a) && ok(s) ? { ok: true, apiKey: a, secret: s } : { ok: false };
}

const SCOPE_LABEL = Object.freeze({
  'account:read': '계정 읽기', 'account:read_write': '계정 읽기·쓰기', 'account:none': '계정 없음',
  'trade:read': '거래 읽기', 'trade:read_write': '거래 읽기·쓰기',
  'wallet:read': '지갑 읽기', 'wallet:none': '지갑 없음',
  'block_trade:read': '블록 거래 읽기', 'block_trade:none': '블록 거래 없음',
});
export function scopeSummary(items) {
  return (Array.isArray(items) ? items : []).map((s) => SCOPE_LABEL[s] || s).join(' · ');
}

export function diagLine({ account, scope, transport }) {
  const digits = account && Number.isInteger(account.digits) ? `${account.digits}자리 ` : '';
  const same = account && account.same === true ? '같음' : account && account.same === false ? '다름' : '확인 중';
  return `계정 UID ${digits}…${account ? account.tail : ''} · 인증 UID와 ${same} · 권한 ${scopeSummary(scope)} · 주문 경로 ${transport === 'ws' ? '직접' : '서버 경유'}`;
}

export function keysRow(keys) {
  const k = keys || KEYS_IDLE;
  const row = (value, tone) => ({ id: 'exchange', label: KTEXT.rowLabel, value, tone, href: '#keys' });
  if (k.status === 'ok') return row(KTEXT.rowOn(k.account ? k.account.tail : ''), 'good');
  // 끊김 동안은 주문하지 않는다 — 연결된 것처럼만 보이지 않게(기능 한계를 숨기지 않음)
  if (k.status === 'down') return row(`${KTEXT.rowOn(k.account ? k.account.tail : '')} · ${KTEXT.down}`, 'warn');
  if (k.status === 'checking') return row(KTEXT.pending, 'dim');
  if (k.status === 'bad' || k.status === 'lost') return row(KTEXT.rowBad, 'bad');
  return row(KTEXT.rowOff, 'dim');
}

const msg = (tone, text) => ({ tone, text });
// account_write_no_trade(p35 L-10): 계정 쓰기 + 거래 권한 없음 — 두 이유를 한 문구로(계정 권한만 고쳐 다시 넣었다가 K-08c를 또 받지 않게)
const SCOPE_MSG = Object.freeze({ empty: KTEXT.noScope, forbidden: KTEXT.forbidden, account_write: KTEXT.accountWrite, account_write_no_trade: KTEXT.accountWriteNoTrade, no_trade: KTEXT.noTrade, no_account: KTEXT.noAccount });

// createOxClient.login 실패 → 화면 문구(§5.8)
export function failMessage(r, member) {
  switch (r && r.reason) {
    case 'auth': return msg('bad', KTEXT.authFail);
    case 'param': return msg('bad', KTEXT.clock);
    case 'scope': return msg('bad', SCOPE_MSG[r.scope && r.scope.reason] || KTEXT.noScope);
    case 'account': return msg('bad', KTEXT.account(member ? member.uidTail : ''));
    case 'relay_auth': return msg('bad', KTEXT.relayRejected);
    case 'member': return msg('warn', VTEXT.revokedOther);
    case 'down': return msg('warn', VTEXT.network);
    default: return msg('warn', KTEXT.unknownError(r && r.code != null ? r.code : '?'));
  }
}

// 권한 거부 때 받은 권한 문자열(U2 — 대표 시험 진단용)
export function receivedScope(r) {
  return r && r.reason === 'scope' && r.scope && Array.isArray(r.scope.items) && r.scope.items.length ? r.scope.items.join(' ') : null;
}

// createOxClient.call 결과 → §5.8 표(따라가기 트랙이 쓴다): stop = 따라가기 정지, pause = 일시 정지, skip = 그 동작만 건너뜀, verify = 주문 식별자로 확인
export function outcomeInfo(o) {
  if (!o || o.ok) return { key: 'ok', text: null };
  switch (o.kind) {
    case 'ox':
      if (OX_AUTH_FAIL.includes(o.code)) return { key: 'auth', text: KTEXT.authFail, stop: true };
      if (o.code === OX_PARAM_FAIL) return { key: 'param', text: KTEXT.clock, stop: true };
      return { key: 'error', text: KTEXT.unknownError(o.code), skip: true };
    case 'down': return { key: 'down', text: KTEXT.down, pause: true };
    case 'hidden': return { key: 'hidden', text: null, pause: true };
    case 'unknown': return { key: 'unknown', text: null, verify: true };
    case 'duplicate': return { key: 'duplicate', text: null, verify: true }; // 허브 409 — 다시 보내지 않는다
    case 'blocked': return { key: 'blocked', text: null, reason: o.reason, skip: true };
    case 'nokey': return { key: 'nokey', text: KTEXT.rowBad, stop: true };
    case 'unauthorized': return { key: 'member', text: VTEXT.revokedOther, stop: true };
    case 'rate':
    case 'busy': return { key: o.kind, text: null, skip: true };
    default: return { key: 'error', text: KTEXT.unknownError(o.error || o.kind || '?'), skip: true };
  }
}

// 저장된 기록(loadOxKey — 기기 키가 붙은 것) → 로그인 자격(봉인만, 원문 없음)
const credOf = (r) => ({ clientId: r.clientId, ct: r.ct, iv: r.iv, sealKey: r.sealKey });

// 연결 상태(설계 3-2 §5.2~§5.4·§5.7). client = createOxClient(app.js가 만들어 넘김 — onState는 onClientState로 이어 준다).
// epoch: 진행 중인 연결·다시 열기·정리만의 세대 — 해제·새 연결·자격 잃음 뒤 늦게 온 결과는 버린다.
// bound: init을 돌린 회원(uidHash) — 토큰 갱신으로 회원 객체가 바뀌어도 다시 로그인하지 않게.
// 정리만(§3.4·§6.3 G1·V-19b): 회원이 없어도 정리 유예 토큰(getGrace = kv.memberGrace)이 있고 열린 매매가 있으면 키·로그인을 그대로 두고
// 위험을 줄이는 호출만(client.setCleanup) — 손절 없는 기본값의 포지션을 앱에서 정리할 길을 남긴다.
export function createKeyControl({
  config,
  vault,
  getMember = () => null,
  client,
  getGrace = async () => null,
  subtle = globalThis.crypto && globalThis.crypto.subtle,
  nav = globalThis.navigator,
  now = () => Date.now(),
  timers = globalThis,
  onChange = () => {},
}) {
  let st = { ...KEYS_IDLE };
  let rec = null;
  let epoch = 0;
  let bound = null;
  let visible = true;
  let retryTimer = null;
  let grace = null; // { token, until } — 정리만일 때만
  let noGrace = false; // 회원 없음에서 정리만 판정을 이미 했고 해당 없음 — 인증 화면 변화마다 다시 보지 않게(init·connect가 지움)
  const state = () => ({
    ...st,
    diag: st.account && Number.isInteger(st.account.digits) && Array.isArray(st.scope) ? diagLine({ account: st.account, scope: st.scope, transport: st.transport }) : null,
  });
  const set = (patch) => {
    st = { ...st, ...patch };
    onChange(state());
  };
  async function openTrades() {
    try {
      const all = await vault.ledgerAll();
      return (Array.isArray(all) ? all : []).filter((t) => t && OPEN_TRADE_STATES.includes(t.state)).length;
    } catch {
      return 0;
    }
  }
  function clearRetry() {
    if (retryTimer != null) {
      timers.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }
  // 거래소에 못 닿음 — 화면에 보이는 동안 30초 뒤 다시(복귀 이벤트를 기다리지 않음). 숨기·멈춤·해제가 끊는다
  function scheduleRetry(fn) {
    clearRetry();
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (visible) fn();
    }, OX_RELOGIN_RETRY_MS);
  }

  function suspend() {
    clearRetry();
    epoch += 1;
    bound = null;
    rec = null;
    grace = null;
    client.setCleanup(false);
    client.stop();
    st = { ...KEYS_IDLE };
    onChange(state());
  }

  // 정리만에 들어가거나(조건이 맞으면) 멈춘다. 이미 로그인돼 있으면 그대로, 아니면(앱을 다시 열었음) 저장된 키로 로그인
  async function enterCleanup() {
    clearRetry();
    epoch += 1;
    const e = epoch;
    bound = null;
    let g = null;
    try {
      g = await getGrace();
    } catch {
      g = null;
    }
    if (e !== epoch) return state();
    const graceOk = memberCapable(config) && !!g && typeof g.token === 'string' && typeof g.until === 'number' && g.until > now();
    const n = graceOk && vault && vault.kind === 'idb' ? await openTrades() : 0;
    if (e !== epoch) return state();
    if (!rec && n > 0) {
      const loaded = await loadOxKey(vault);
      if (e !== epoch) return state();
      rec = loaded.rec;
    }
    if (!graceOk || n === 0 || !rec) {
      suspend();
      noGrace = true;
      return state();
    }
    grace = { token: g.token, until: g.until };
    client.setCleanup(true);
    if (client.state().status !== 'idle') {
      set({ status: 'cleanup', pending: false, message: null });
      return state();
    }
    set({ ...KEYS_IDLE, status: 'cleanup', pending: true, account: { tail: rec.accountTail, digits: null, same: null }, scope: rec.scope });
    const r = await client.login(credOf(rec));
    if (e !== epoch) return state();
    if (!r.ok) {
      if (r.reason === 'member') { // 유예 토큰도 허브가 받지 않음
        suspend();
        noGrace = true;
        return state();
      }
      if (['down', 'error', 'stale'].includes(r.reason)) {
        set({ pending: false, message: msg('warn', KTEXT.down) });
        scheduleRetry(() => {
          if (st.status === 'cleanup' && client.state().status === 'idle') enterCleanup();
        });
        return state();
      }
      client.stop();
      set({ status: 'bad', pending: false, message: failMessage(r, null), receivedScope: receivedScope(r) });
      return state();
    }
    const acct = await accountCheck({ uid: r.uid, member: null, mode: 'off', subtle });
    if (e !== epoch) return state();
    if (!acct.ok || acct.hash !== rec.accountUidHash) {
      client.stop();
      set({ status: 'bad', pending: false, message: msg('bad', KTEXT.reconnect) });
      return state();
    }
    set({ pending: false, message: null, transport: r.transport, scope: r.scope.items, account: { tail: acct.tail, digits: acct.digits, same: null } });
    return state();
  }

  // 다시 열기(§5.4-9): 저장된 키로 1~8을 다시 — 계정이 저장된 것과 다르면 따라가기 정지·다시 연결
  async function init() {
    clearRetry();
    const member = getMember();
    if (!keysCapable(config, member)) {
      if (!member && memberCapable(config)) return enterCleanup();
      suspend();
      return state();
    }
    epoch += 1;
    const e = epoch;
    bound = member.uidHash;
    grace = null;
    noGrace = false;
    client.setCleanup(false);
    const loaded = await loadOxKey(vault);
    if (e !== epoch) return state();
    if (!loaded.rec) {
      rec = null;
      if (loaded.state === 'old') { // 예전 방식 기록 — 멈추지 않고 다시 넣어 달라고(로그인하지 않음)
        set({ ...KEYS_IDLE, status: 'lost', message: msg('warn', KTEXT.rekey) });
        return state();
      }
      const lost = loaded.state === 'lost' || (vault && vault.kind === 'idb' && (await openTrades()) > 0);
      if (e !== epoch) return state();
      set(lost ? { ...KEYS_IDLE, status: 'lost', message: msg('warn', KTEXT.reconnect) } : { ...KEYS_IDLE });
      return state();
    }
    rec = loaded.rec;
    set({ ...KEYS_IDLE, status: 'checking', account: { tail: rec.accountTail, digits: null, same: null }, scope: rec.scope });
    const r = await client.login(credOf(rec));
    if (e !== epoch) return state();
    if (!r.ok) {
      if (r.reason === 'seal') { // 이 기기 키로 봉인이 안 풀림(저장소 일부 정리 등) — 다시 연결
        client.stop();
        set({ status: 'lost', message: msg('warn', KTEXT.reconnect) });
        return state();
      }
      // 거래소에 못 닿음·거래소 일시 오류(모르는 코드)·회원 확인 실패는 키를 버리지 않는다 — down으로 두고 보이는 동안 30초마다 다시
      if (['down', 'error', 'member', 'stale'].includes(r.reason)) {
        set({ status: 'down', message: msg('warn', KTEXT.down) });
        scheduleRetry(() => {
          if (st.status === 'down' && client.state().status === 'idle') {
            bound = null;
            sync();
          }
        });
        return state();
      }
      client.stop(); // 쓸 수 없는 키 — #keys에서 다시 연결할 때까지 거래소 연결도 닫는다
      set({ status: 'bad', message: failMessage(r, member), receivedScope: receivedScope(r) });
      return state();
    }
    const acct = await accountCheck({ uid: r.uid, member, mode: config.accountMatch, subtle });
    if (e !== epoch) return state();
    if (!acct.ok || acct.hash !== rec.accountUidHash) {
      client.stop();
      set({ status: 'bad', message: msg('bad', !acct.ok && acct.reason === 'account' ? KTEXT.account(member.uidTail) : KTEXT.reconnect) });
      return state();
    }
    set({ status: 'ok', message: null, transport: r.transport, scope: r.scope.items, account: { tail: acct.tail, digits: acct.digits, same: acct.same } });
    return state();
  }

  // 인증 상태가 바뀌었을 때(app.js onMemberChange) — 회원이 없어지면 정리만 판정(유예 토큰·열린 매매), 자격이 없는 회원이면 멈추고(키는 그대로),
  // 다른 회원이면 다시 init
  function sync() {
    const m = getMember();
    if (keysCapable(config, m)) {
      if (m.uidHash !== bound) init();
      return;
    }
    if (!m && memberCapable(config)) {
      if (st.status !== 'cleanup' && !noGrace) enterCleanup();
      return;
    }
    if (bound !== null || rec || st.status !== 'none' || st.message) suspend();
  }

  // 새 키 연결(§5.2): 형식 → (시험 토큰) 체크 상자 → 오래가는 저장소 → 기기 키(kv.oxSeal)로 봉인(원문은 여기서 끝) → 로그인·권한·주문 경로
  // (ox-client가 /public/auth 바로 앞에서만 풀어 보냄) → 계정 일치 → 봉인 저장
  async function connect(input = {}) {
    const member = getMember();
    if (!keysCapable(config, member) || st.pending) return state();
    if (rec && ['ok', 'checking', 'down'].includes(st.status)) return state();
    const v = validateKeyInput(input.apiKey, input.secret);
    if (!v.ok) {
      set({ message: msg('bad', KTEXT.badInput), receivedScope: null });
      return state();
    }
    if (member.test === true && input.otherAccount !== true) {
      set({ message: msg('warn', KTEXT.testNote), receivedScope: null });
      return state();
    }
    try {
      requireDurable(vault);
    } catch {
      set({ message: msg('bad', KTEXT.cantStore), receivedScope: null });
      return state();
    }
    clearRetry();
    epoch += 1;
    const e = epoch;
    bound = member.uidHash;
    grace = null;
    noGrace = false;
    client.setCleanup(false);
    set({ pending: true, message: null, receivedScope: null });
    let sealed;
    try {
      const sealKey = await sealKeyFor(vault, subtle);
      sealed = { clientId: v.apiKey, ...(await sealOxSecret({ secret: v.secret, clientId: v.apiKey, sealKey, subtle })), sealKey };
    } catch {
      if (e === epoch) set({ pending: false, message: msg('bad', KTEXT.cantStore) }); // IndexedDB가 CryptoKey를 못 담는 기기(U14) 등
      return state();
    } finally {
      v.secret = null; // 원문 참조를 여기서 끝낸다
    }
    if (e !== epoch) return state();
    const r = await client.login(sealed);
    if (e !== epoch) return state();
    if (!r.ok) {
      client.forget(); // WS는 둔다 — #keys에서 바로 다시 시도할 때 15초를 기다리지 않게(화면을 떠나면 leaveScreen이 닫음)
      set({ pending: false, message: failMessage(r, member), receivedScope: receivedScope(r) });
      return state();
    }
    const acct = await accountCheck({ uid: r.uid, member, mode: config.accountMatch, subtle });
    if (e !== epoch) return state();
    if (!acct.ok) {
      client.forget();
      set({ pending: false, message: acct.reason === 'account' ? msg('bad', KTEXT.account(member.uidTail)) : msg('warn', KTEXT.unknownError('uid')) });
      return state();
    }
    const next = { clientId: v.apiKey, ct: sealed.ct, iv: sealed.iv, savedAt: now(), scope: r.scope.items, accountUidHash: acct.hash, accountTail: acct.tail };
    try {
      await saveOxKey(vault, next);
    } catch {
      if (e === epoch) {
        client.forget();
        set({ pending: false, message: msg('bad', KTEXT.cantStore) });
      }
      return state();
    }
    if (e !== epoch) return state();
    rec = { ...next, sealKey: sealed.sealKey };
    persistStorage(nav);
    set({ pending: false, status: 'ok', message: null, transport: r.transport, scope: r.scope.items, account: { tail: acct.tail, digits: acct.digits, same: acct.same } });
    return state();
  }

  // 연결 해제(K-09) — 이 기기의 키를 지우고 거래소 연결을 닫는다(거래소의 포지션·주문은 그대로)
  // 암호문·봉인 키를 먼저 지운다 — 둘 다 못 지우면(비밀 키가 아직 풀림) 해제됐다고 하지 않고 그대로 둔다(K-09b, 다시 누르게)
  async function disconnect({ confirm = () => false } = {}) {
    if (!rec && st.status === 'none') return false;
    if (!confirm(KTEXT.disconnectConfirm)) return false;
    const gone = await deleteOxKey(vault);
    if (!gone.ox && !gone.seal) {
      set({ message: msg('bad', KTEXT.cantDelete) });
      return false;
    }
    clearRetry();
    epoch += 1;
    rec = null;
    grace = null;
    client.setCleanup(false);
    client.stop();
    set({ ...KEYS_IDLE });
    return true;
  }

  // createOxClient.onState → 화면 상태
  function onClientState(s) {
    if (!rec || !s) return;
    if (s.status === 'bad') {
      const text = s.badReason === 'scope' ? (SCOPE_MSG[s.badScope && s.badScope.reason] || KTEXT.forbidden)
        : s.badReason === 'param' ? KTEXT.clock : s.badReason === 'seal' ? KTEXT.reconnect : KTEXT.authFail;
      set({ status: 'bad', message: msg('bad', text) });
      return;
    }
    if (st.status === 'cleanup') {
      if (s.status === 'down' && !(st.message && st.message.text === KTEXT.down)) set({ message: msg('warn', KTEXT.down) });
      else if (s.status === 'ready' && st.message) set({ message: null, transport: s.transport || st.transport });
      return;
    }
    if (st.status === 'ok' && s.status === 'down') {
      set({ status: 'down', message: msg('warn', KTEXT.down) });
      return;
    }
    if (st.status === 'down' && s.status === 'ready') {
      set({ status: 'ok', message: null, transport: s.transport || st.transport });
      return;
    }
    if (st.status === 'ok' && s.status === 'ready' && s.transport && s.transport !== st.transport) set({ transport: s.transport });
  }

  // 화면으로 돌아옴 — 클라이언트의 숨김 표시는 언제나 먼저 되돌린다(pause가 언제나 숨기므로 — 안 그러면 뒤의 로그인이 성공해도 주문이 모두 hidden).
  // 키가 없는 클라이언트의 resume은 표시만 되돌린다. 그다음 다시 열기·정리만에서 거래소에 못 닿았으면(클라이언트에 키 없음) 처음부터
  function resume() {
    visible = true;
    const idle = client.state().status === 'idle';
    client.resume();
    if (st.status === 'cleanup' && idle) {
      enterCleanup();
      return;
    }
    if (st.status === 'down' && idle) {
      bound = null;
      sync();
    }
  }
  function pause() {
    visible = false;
    clearRetry();
    client.pause();
  }

  // #keys 화면을 떠남(app.js show) — 쓸 수 있는 키 없이 열려 있는 거래소 연결(실패한 연결의 바로 다시 시도용 WS)을 닫는다
  function leaveScreen() {
    if (st.pending || st.status === 'cleanup') return;
    if (!rec || st.status === 'bad' || st.status === 'lost') client.stop();
  }
  // 따라가기 트랙: 정리만 동안 열린 매매가 바뀌면(정리 끝) 다시 판정 — 0건이면 멈춘다
  function cleanupCheck() {
    if (st.status === 'cleanup') enterCleanup();
  }
  // 중계·확인 머리글용 정리 유예 토큰(정리만일 때만, 기한 안) — app.js getToken이 회원 토큰이 없을 때 쓴다
  const graceToken = () => (grace && grace.until > now() ? grace.token : null);
  // 그 유예 토큰이 허브에서 401 — 정리만도 끝
  function graceLost(token) {
    if (grace && token === grace.token) {
      suspend();
      noGrace = true;
    }
  }

  return {
    init,
    sync,
    connect,
    disconnect,
    suspend,
    pause,
    resume,
    leaveScreen,
    cleanupCheck,
    graceToken,
    graceLost,
    onClientState,
    state,
    ready: () => st.status === 'ok' && client.ready(),
    client: () => client,
  };
}
