// 서버 명령 흐름(설계 2026-10-16 §15.8·§15.9·§15.20 D37, 계획 2026-10-22 작업 8) — 휴대폰은 주문하지 않고 실행기에 명령만 보낸다(서버 전용).
// - sendAndWait: 명령을 한 번 보내고(server-exec cmd — 기기 서명) 결과를 1초마다 30초까지 묻는다. 30초 넘으면 'pending'(다시 보내지 않음 — 회원 상태 30초 주기에 맡김),
//   끝나면 회원 상태를 한 번 새로 받는다.
// - startAuto: 첫 켜기 = 연결해 둔 키를 실행기 공개키로 잠금(seal = sealConnectedKey) → 등록(enroll — 등록 ≠ 켜기, D30) → 상태가 on이 될 때까지
//   1초마다 60초 → 자동 손절이 다르면 settings { autoSl } → on { consent, run }. 이미 등록돼 있으면 바로 on. enrollOnly(수동 주문 등록 — 작업 12)면 등록까지만.
//   동의 창·기기 동의 기록은 없다(대표 결정 2026-10-23 '동의 문구는 그냥 다 빼 의미 없어'). on의 consent 칸 { ver: SERVER_CONSENT_VERSION, print: 설정 지문 }은
//   실행기 명령 꼴(exec/lib/cmd.js — 판·설정 지문을 맞춰 봄)이라 그대로 채워 보낸다(실행기를 바꾸지 않음 — 재배포 없음)
//   돌려줌 { ok, error 낱말, step: 실패한 단계 seal·enroll·settings·on | null }
// - CMD_ERR_TEXT·cmdErrText: 명령 결과 낱말 → 화면 한 줄(짧게 — 할 일만)
import { AUTO_TEXT, FTEXT, SERVER_CONSENT_VERSION } from './follow-text.js';
import { HEDGE_TEXT } from './hedge-text.js';
import { settingsPrint, effectiveSettings } from './follow-settings.js';

export const CMD_WAIT_MS = 30000;
export const CMD_STEP_MS = 1000;
export const ENROLL_WAIT_MS = 60000;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const CMD_ERR_TEXT = Object.freeze({
  stale_stage: '이미 들어갔습니다',
  manual_off: '지금은 수동 주문이 닫혀 있습니다',
  hedge_mode: HEDGE_TEXT.line,
  run: AUTO_TEXT.badUntil,
  symbols: AUTO_TEXT.badSymbols, // 실행기 켜기 검사 — 종목 1~3개·규칙 목록 안(2026-10-23)
  pending: AUTO_TEXT.waitResult,
  rate: '잠시 뒤 다시 눌러 주세요',
});
export function cmdErrText(code) {
  if (typeof code === 'string' && Object.hasOwn(CMD_ERR_TEXT, code)) return CMD_ERR_TEXT[code];
  if (typeof code === 'string' && Object.hasOwn(FTEXT.serverErr, code)) return FTEXT.serverErr[code];
  return FTEXT.serverDown;
}

async function refreshSafe(server) {
  try {
    await server.refresh();
  } catch {
    // 상태 받기 실패 — 30초 주기가 다시
  }
}

export async function sendAndWait(server, kind, args, { sleep = realSleep, now = () => Date.now(), waitMs = CMD_WAIT_MS, stepMs = CMD_STEP_MS } = {}) {
  let c;
  try {
    c = await server.cmd(kind, args);
  } catch {
    c = { ok: false, error: 'down' };
  }
  if (!c || c.ok !== true) return { ok: false, error: c && typeof c.error === 'string' ? c.error : 'down' };
  const t0 = now();
  let out = { ok: false, error: 'pending' };
  while (now() - t0 < waitMs) {
    await sleep(stepMs);
    let r;
    try {
      r = await server.cmdResult(c.id);
    } catch {
      r = null;
    }
    if (r && r.state === 'done') {
      out = r.ok === true ? { ok: true, error: null } : { ok: false, error: typeof r.error === 'string' ? r.error : 'failed' };
      break;
    }
    if (r && r.state === 'expired') {
      out = { ok: false, error: 'expired' };
      break;
    }
  }
  await refreshSafe(server);
  return out;
}

const stateOf = (server) => {
  try {
    const s = server.state();
    return isObj(s) && s.ok === true ? s : null;
  } catch {
    return null;
  }
};
const fail = (step, error) => ({ ok: false, error: typeof error === 'string' && error ? error : 'down', step });

export async function startAuto({
  server, seal, vault, config, rules, autoSl = true, run = null,
  sleep = realSleep, now = () => Date.now(), subtle = globalThis.crypto && globalThis.crypto.subtle, enrollOnly = false,
} = {}) {
  let st = stateOf(server);
  if (!st) {
    await refreshSafe(server);
    st = stateOf(server);
  }
  if (!st) return fail('enroll', 'down');
  if (st.status === 'none' || st.status === 'off') {
    // 첫 켜기 — 키 잠금 → 등록
    let s;
    try {
      s = await seal({ vault, config, now: now(), subtle });
    } catch {
      s = { ok: false, error: 'key_open' };
    }
    if (!s || s.ok !== true) return fail('seal', s && s.error);
    let e;
    try {
      e = await server.enroll(s.blob);
    } catch {
      e = { ok: false, error: 'down' };
    }
    if (!e || e.ok !== true) return fail('enroll', e && e.error);
    st = stateOf(server);
  }
  // 등록 결과 기다림(상태 on까지 — 1초마다 60초)
  const t0 = now();
  while (!st || st.status !== 'on') {
    if (st && st.status === 'error') return fail('enroll', st.error || 'enroll');
    if (st && st.status === 'closing') return fail('enroll', 'closing'); // 키 지우는 중 — 켜지 않음
    if (now() - t0 >= ENROLL_WAIT_MS) return fail('enroll', 'pending');
    await sleep(CMD_STEP_MS);
    await refreshSafe(server);
    st = stateOf(server);
  }
  if (enrollOnly) return { ok: true, error: null, step: null };
  const cur = isObj(st.settings) && typeof st.settings.autoSl === 'boolean' ? st.settings.autoSl : null;
  if (cur !== autoSl) {
    const r = await sendAndWait(server, 'settings', { autoSl }, { sleep, now });
    if (!r.ok) return fail('settings', r.error);
  }
  const print = await settingsPrint(effectiveSettings({ autoSl }, rules), subtle);
  const r = await sendAndWait(server, 'on', { consent: { ver: SERVER_CONSENT_VERSION, print }, run }, { sleep, now });
  if (!r.ok) return fail('on', r.error);
  return { ok: true, error: null, step: null };
}
