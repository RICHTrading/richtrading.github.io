// 실행기 둘 사이 옮기기의 앱 몫(계획 2026-11-12 Task 11 — 허브 단계는 hub/lib/exec-moves.js): 앱이 화면에 있을 때 허브 자리(GET /v1/member/server/seat)를 묻고
// 조용히 잇는다(화면 글 없음 — 실패는 다음에 열 때 다시). 키 입력·동의 창 없음: 이미 등록한 회원이 기기에 연결해 둔 같은 키를 옮길 곳 공개키로 다시 잠가 보낸다.
// 아래 A·B는 지금 자리·옮길 곳 — 고르게(2026-11-13 결정)로 B → A도 같은 길(seat 지문이 옮길 곳)
// (잠그기는 주입 — server-exec.js sealConnectedKey, 원문은 그 함수 지역 변수에만·이 모듈에는 키·묶음 상태 없음).
// 기기 칸 kv.serverMove = { v:1, fp: 옮길 곳 지문, settings: 옮기기 전 자리 실행기 상태의 settings(D37 autoSl·max·until·startedAt·done·symbols), auto, at } —
// 기기 vault에만(허브로 보내지 않음 — 규칙 17 '휴대폰 vault' 목록에 더할 것), 끝나면·중단되면·24시간 지나면 지움. requireDurable 먼저(메모리 저장소면 멈춤 — 규칙 14).
// moveTick 한 번:
// - seat move 'enroll': 칸이 없거나 다른 지문이면 지금 상태(자리 실행기 on — auto·settings)를 적고 그 지문 키로 잠가 등록 → 'enrolled'.
//   이 빌드가 모르는 지문·상태 모름이면 아무것도 안 함(옮길 곳이 A여도 — B → A — 아는 지문이면 잠금). 등록 거절 exec_key·reseat(R-d — 옮기는 중) = 중단(칸 지움 'aborted'), 끊김(down)은 칸 그대로 'error'
//   (허브가 enroll 10분이면 중단), 그 밖 거절은 칸 지움 'error'
// - seat move 'wait'(B가 대기 등록을 쥠·A 오토 끄는 중·release — A가 놓을 때까지) → 'idle'
// - seat move null·execFp = 칸 지문·상태 on: settings 명령(저장한 autoSl) → 저장한 오토가 켜져 있었고 run이 아직 유효(남은 횟수 ≥ 1 또는 무제한,
//   종료 시각 없음 또는 1분 넘게 남음)하고 지금 오토가 꺼져 있으면 on(같은 종료 시각·남은 횟수·같은 종목) → 칸 지움 'settled'. B 상태가 아직 on이 아니면 'idle'
// - seat move null·execFp ≠ 칸 지문(허브가 중단함) → 칸 지움 'aborted'. restore(R-f — 옮기기가 A 오토를 끈 뒤 중단)가 참이고 지금 상태 on·오토 꺼짐·
//   저장한 오토 켜짐·run 유효면 그 자리 실행기에 on 하나(지문은 자리 실행기 지금 autoSl 값으로) 먼저
// - 명령이 끊기거나 잠깐인 답(RETRY_ERRORS — down·pending·rate·busy·exec_down·exec_off·expired 등)이면 칸 그대로 'error'(다음 자리 묻기에서 다시),
//   그 밖 명령 거절은 칸 지움
import { requireDurable } from './vault.js';
import { sendAndWait } from './server-cmd-flow.js';
import { SERVER_CONSENT_VERSION } from './follow-text.js';
import { settingsPrint, effectiveSettings } from './follow-settings.js';
import { hasKeyFp } from './server-exec.js';

export const MOVE_KV = 'serverMove';
export const SEAT_POLL_MS = 300000;
export const SEAT_FAST_MS = 5000;
export const MOVE_FORGET_MS = 24 * 3600 * 1000; // 허브 MOVE_FORGET_MS·restore 칸 수명과 같음
const RUN_MARGIN_MS = 60000; // 종료 시각이 이만큼도 안 남았으면 다시 켜지 않음(실행기 validateAutoRun은 지금 뒤여야 받음)
const FP_RE = /^[0-9a-f]{16}$/;
// 잠깐인 답 — 칸 그대로 다음에 다시(최종 검토 I2: 실행기 늦음·죽음 exec_down, 정리만 exec_off, 결과 시간 초과 expired·not_found, 보고 전 not_enrolled,
// 실행기 모드 mode). 그 밖 낱말(bad_request·not_allowed 등 분명한 거절)만 칸 지움. 칸은 어차피 24시간에 지워짐
const RETRY_ERRORS = Object.freeze(['down', 'pending', 'rate', 'busy', 'exec_down', 'exec_off', 'expired', 'not_found', 'not_enrolled', 'mode']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// D37 자동 설정 꼴(server-exec okAutoSettings가 이미 거른 값) 중 다시 켤 때 쓰는 칸만 본다
const runSettings = (s) => isObj(s) && typeof s.autoSl === 'boolean' && (s.max === null || Number.isInteger(s.max)) && (s.until === null || num(s.until))
  && Number.isInteger(s.done) && Array.isArray(s.symbols);
const okMove = (m) => isObj(m) && m.v === 1 && typeof m.fp === 'string' && FP_RE.test(m.fp) && typeof m.auto === 'boolean' && num(m.at)
  && (m.settings === null || runSettings(m.settings));

// 저장한 run → on 명령 run(남은 횟수·같은 종료 시각·같은 종목), 다시 켤 수 없으면 null
export function resumeRun(settings, nowMs) {
  if (!runSettings(settings)) return null;
  const left = settings.max === null ? null : settings.max - settings.done;
  if (left !== null && left < 1) return null;
  if (settings.until !== null && !(settings.until > nowMs + RUN_MARGIN_MS)) return null;
  const run = { max: left, until: settings.until };
  if (settings.symbols.length) run.symbols = [...settings.symbols];
  return run;
}

async function freshState(server) {
  try {
    await server.refresh();
  } catch {
    // 받기 실패 — 아래에서 모름
  }
  let s = null;
  try {
    s = server.state();
  } catch {
    s = null;
  }
  return isObj(s) && s.ok === true ? s : null;
}

export async function moveTick({
  server, seal, vault, config, rules, now = () => Date.now(), sleep = realSleep, subtle = globalThis.crypto && globalThis.crypto.subtle,
} = {}) {
  try {
    requireDurable(vault);
  } catch {
    return 'error';
  }
  let mv;
  try {
    mv = await vault.get(MOVE_KV);
  } catch {
    return 'error';
  }
  const drop = async (out) => {
    try {
      await vault.del(MOVE_KV);
    } catch {
      return 'error';
    }
    return out;
  };
  if (mv !== undefined && mv !== null && !okMove(mv)) {
    await drop('idle');
    mv = null;
  }
  if (mv && now() - mv.at > MOVE_FORGET_MS) return drop('aborted');
  if (!mv) mv = null;
  if (!server || typeof server.seat !== 'function') return 'idle';
  let seat = null;
  try {
    seat = await server.seat();
  } catch {
    seat = null;
  }
  if (!seat) return 'idle'; // 옛 허브·끊김 — 다음에 다시
  const wait = { sleep, now };
  const onArgs = async (autoSl, run) => ({ consent: { ver: SERVER_CONSENT_VERSION, print: await settingsPrint(effectiveSettings({ autoSl }, rules), subtle) }, run });

  if (seat.move === 'enroll') {
    if (mv && mv.fp === seat.execFp) return 'idle'; // 이미 대기 등록을 보냄 — 옮길 곳 보고를 기다림
    // 이 빌드가 아는 키로만 — 모르는 지문을 A로 잠가 보내지 않음. 고르게(2026-11-13 결정): 옮길 곳은 A·B 어느 쪽이든(B가 더 차면 B → A) —
    // 허브는 옮길 곳 ≠ 지금 자리일 때만 enroll을 준다(exec-seats markMove)
    if (!hasKeyFp(config, seat.execFp)) return 'idle';
    const st = await freshState(server);
    if (!st || st.status !== 'on' || typeof st.auto !== 'boolean' || !Object.hasOwn(st, 'settings')) return 'error';
    let s;
    try {
      s = await seal({ vault, config, now: now(), subtle, fp: seat.execFp });
    } catch {
      s = { ok: false, error: 'key_open' };
    }
    if (!s || s.ok !== true) return 'error'; // 키 없음·못 풂 — 등록하지 않음(그 회원은 A에 그대로, 허브는 10분 뒤 중단)
    const settings = runSettings(st.settings) ? structuredClone(st.settings) : null;
    try {
      await vault.set(MOVE_KV, { v: 1, fp: seat.execFp, settings, auto: st.auto === true, at: now() });
    } catch {
      return 'error';
    }
    let e;
    try {
      e = await server.enroll(s.blob);
    } catch {
      e = { ok: false, error: 'down' };
    }
    if (e && e.ok === true) return 'enrolled';
    const err = e && typeof e.error === 'string' ? e.error : 'down';
    if (err === 'exec_key' || err === 'reseat') return drop('aborted');
    if (err === 'down') return 'error'; // 닿았는지 모름 — 칸 그대로(허브가 10분 뒤 중단하면 aborted로 지움)
    return drop('error');
  }
  if (seat.move === 'wait') return 'idle';
  // move null
  if (!mv) return 'idle'; // 기기 칸 없음 — restore가 와도 이 기기는 할 일 없음(허브 칸은 24시간에 지워짐)
  if (seat.execFp !== mv.fp) {
    // 허브가 옮기기를 중단함 — restore면 그 자리 실행기 오토를 저장한 run으로 다시
    if (seat.restore === true && mv.auto === true) {
      const st = await freshState(server);
      const run = resumeRun(mv.settings, now());
      const cur = st && isObj(st.settings) && typeof st.settings.autoSl === 'boolean' ? st.settings.autoSl : null;
      if (st && st.status === 'on' && st.auto === false && run && cur !== null) {
        const r = await sendAndWait(server, 'on', await onArgs(cur, run), wait);
        if (!r.ok && RETRY_ERRORS.includes(r.error)) return 'error';
      }
    }
    return drop('aborted');
  }
  // 끝 — 자리가 옮길 곳(B)이고 A가 놓음. B 상태 on이 되면 설정 → 오토
  const st = await freshState(server);
  if (!st || st.status !== 'on') return 'idle';
  if (mv.settings) {
    const r = await sendAndWait(server, 'settings', { autoSl: mv.settings.autoSl }, wait);
    if (!r.ok) return RETRY_ERRORS.includes(r.error) ? 'error' : drop('error');
  }
  const run = mv.auto === true ? resumeRun(mv.settings, now()) : null;
  if (run && st.auto === false) {
    const r = await sendAndWait(server, 'on', await onArgs(mv.settings.autoSl, run), wait);
    if (!r.ok) return RETRY_ERRORS.includes(r.error) ? 'error' : drop('error');
  }
  return drop('settled');
}

// 보이는 동안만 돈다: 보이게 되면 한 번 바로, 그 뒤 SEAT_POLL_MS(기기 칸이 있으면 — 옮기는 중 SEAT_FAST_MS, 칸 없이 'error'면 SEAT_FAST_MS 뒤 한 번만 다시).
// 한 번에 하나만(진행 중이면 겹쳐 부르지 않음)
export function createMoveLoop({ run, moving = async () => false, timers = globalThis, pollMs = SEAT_POLL_MS, fastMs = SEAT_FAST_MS } = {}) {
  let visible = false;
  let stopped = false;
  let busy = false;
  let timer = null;
  let retried = false; // 바로 앞 주기가 error 뒤 5초 다시였나(최종 검토 M2 — 한 번만)
  const clear = () => {
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
  };
  async function kick() {
    if (busy || stopped || !visible) return;
    busy = true;
    clear();
    let out = null;
    try {
      out = await run();
    } catch {
      // 다음 주기에 다시
    }
    let fast = false;
    try {
      fast = (await moving()) === true;
    } catch {
      fast = false;
    }
    // M2: 기기 칸이 생기기 전 error(첫 자리 묻기·잠그기 실패)면 5분 대신 5초 뒤 한 번만 다시
    const retry = !fast && out === 'error' && !retried;
    retried = retry;
    if (retry) fast = true;
    busy = false;
    if (stopped || !visible) return;
    clear();
    timer = timers.setTimeout(() => { timer = null; kick(); }, fast ? fastMs : pollMs);
  }
  return {
    setVisible(v) {
      visible = v === true;
      if (visible) kick();
      else clear();
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
