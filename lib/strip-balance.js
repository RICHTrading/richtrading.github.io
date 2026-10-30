// 상단 띠의 사용 가능 잔고(p34 설계 §6.8 · 검토 6·34 · 대표 결정 2026-10-09) — 동업자판 '🔗 잔고 N USDT'에 대응.
// - 직접 경로(transport 'ws')·중계 경로(transport 'relay') 모두: 키가 준비되고 앱이 화면에 있을 때 바로 한 번 + 30초마다
//   get_assets_info(["PERPETUAL"]). 따라가기가 켜져 있어도 읽는다 — 앱이 화면에 켜져 있어야 주문이 나가므로 그 화면에서 잔고가 늘 보여야 한다
//   (대표 결정 2026-10-09 — p35 L-5의 '따라가기 중 · 잔고는 오렌지엑스 앱에서'를 없앰).
// - 따라가기 실행기가 거래소를 부르는 중이거나 마지막 호출 뒤 잠깐(busy — app.js followBusy)이면 그 회차는 바로 읽지 않고 2초 뒤 다시 본다
//   (다음 주기 전까지 — 따라가기 점검 주기와 같은 자리에 겹쳐도 결국 한 번 읽는다, 검토 2026-10-09):
//   허브가 오렌지엑스 429에 그 접속 토큰을 60초 묶으므로(hub/lib/ox-relay.js) 진입 주문 묶음과 겹치지 않게. 경로가 바뀔 때의 첫 읽기도 같은 관문.
//   요청 제한(rate·busy)을 받으면 두 주기 쉰다.
// - 띠 버튼이 '잔고 보기'·'잠시 뒤 다시'일 때 누르면(peek) 한 번 읽는다 — 마지막 읽기 10초 안이면 읽지 않고, 실행기가 부르는 중이면 '잠시 뒤 다시'
//   (5초 뒤 원래 표시로, 값은 그대로). 잔고가 보일 때 누르면 키 화면(strip.js — 'keys').
// - 주문·정리 직후(afterOrder — 대표 실거래 확인 2026-10-19: 포지션을 정리한 뒤 띠 잔고가 늦게 바뀜): 트레이딩 탭 수동 주문(1차·추가 진입·정리·
//   익절가 변경)이 끝나거나 자동매매 장부에 체결·끝이 생기면(app.js — tradeMarks·marksMoved) 30초 주기를 기다리지 않고 곧 한 번 읽는다.
//   관문은 그대로: busy면 2초마다 다시 보고 풀리면, 요청 제한 뒤 두 주기 쉼은 그대로(쉼이 끝난 주기의 읽기가 그 몫), 마지막 읽기 10초 안이면
//   10초가 찰 때(누름과 같은 간격 — 버리지 않고 미룸). 여러 번 불러도 한 번으로 합치고, 부른 뒤에 시작한 읽기가 끝나면(성공·실패 무관) 그 몫은 끝 —
//   부르기 전에 시작한 읽기(주문 전 값일 수 있음)는 몫을 채우지 않는다. 숨은 동안 부른 몫은 다시 보일 때 한 번.
// - 실패는 두 번까지 지난 값(처음이면 '확인 중…'), 세 번 연속이면 '확인 안 됨'.
// - 값은 메모리에만(assetsView().available). 저장·사무실 메시지·기록 없음(중계 방식에서는 허브가 조회·응답을 전달만 하고 저장·기록하지 않음).
import { assetsView } from './follow-math.js';

export const BALANCE = Object.freeze({ everyMs: 30000, busyRetryMs: 2000, peekGapMs: 10000, skipAfterRate: 2, failMax: 3 });
export const BALANCE_LATER_MS = 5000;
const METHOD = '/private/get_assets_info';
const PARAMS = Object.freeze({ asset_type: Object.freeze(['PERPETUAL']) });

// 자동매매 장부의 체결·끝 표식(가격·수량 없음) — 매매 id → 체결 줄 수 × 2 + 끝(closed)이면 1. app.js가 엔진 상태가 바뀔 때마다 앞 표식과 견줘
// 늘었으면(새 체결·새로 끝남) afterOrder. 보내는 중·실패한 줄, 건너뜀·그림자(체결 없음), 분리됨, 장부 정리로 빠진 줄은 움직임이 아니다
const FILLED = Object.freeze(['filled', 'partial', 'adopted']);
export function tradeMarks(trades) {
  const marks = new Map();
  for (const t of Array.isArray(trades) ? trades : []) {
    if (!t || typeof t.id !== 'string') continue;
    const n = (Array.isArray(t.fills) ? t.fills : []).filter((f) => f && FILLED.includes(f.state)).length;
    marks.set(t.id, n * 2 + (n > 0 && t.state === 'closed' ? 1 : 0));
  }
  return marks;
}
// 앞 표식(없으면 처음 — 움직임 아님)보다 늘어난 매매가 있나
export function marksMoved(prev, next) {
  if (!(prev instanceof Map) || !(next instanceof Map)) return false;
  for (const [id, v] of next) if (v > (prev.get(id) || 0)) return true;
  return false;
}

export function createStripBalance({ keys, busy = () => false, timers = globalThis, now = () => Date.now(), onChange = () => {} }) {
  let mode = 'off';
  let status = 'idle';
  let value = null;
  let fails = 0;
  let skip = 0;
  let lastAt = 0;
  let visible = true;
  let readingEpoch = null; // 진행 중인 읽기의 경로 회차 — 옛 경로의 읽기는 새 경로의 첫 읽기를 막지 않는다
  let epoch = 0;
  let every = null;
  let laterTimer = null;
  let beforeLater = null; // '잠시 뒤 다시' 동안 가려 둔 상태
  let retryTimer = null; // busy로 건너뛴 회차의 짧은 다시 보기
  let retryUntil = 0;
  // 주문·정리 직후 몫(afterOrder) — 부른 수·채운 수. 읽기는 시작할 때 그때까지 부른 수를 기억했다가 끝나면 그만큼 채운다
  let asked = 0;
  let met = 0;
  let soonTimer = null; // 몫 읽기를 미룬 다시 보기(10초 간격·busy)

  const state = () => ({ mode, status, value, shownUntil: null });
  const emit = () => onChange(state());
  const reading = () => readingEpoch === epoch;
  const isBusy = () => {
    try {
      return busy() === true;
    } catch {
      return true;
    }
  };
  const clearEvery = () => {
    if (every != null) timers.clearInterval(every);
    every = null;
  };
  const clearRetry = () => {
    if (retryTimer != null) timers.clearTimeout(retryTimer);
    retryTimer = null;
  };
  const clearSoon = () => {
    if (soonTimer != null) timers.clearTimeout(soonTimer);
    soonTimer = null;
  };
  const clearLater = () => {
    if (laterTimer != null) timers.clearTimeout(laterTimer);
    laterTimer = null;
    if (beforeLater != null && status === 'later') status = beforeLater;
    beforeLater = null;
  };
  function modeNow() {
    try {
      if (!keys || !keys.ready()) return 'off';
      return keys.state().transport === 'ws' ? 'ws' : 'relay';
    } catch {
      return 'off';
    }
  }

  async function read() {
    if (reading()) return false;
    const e = epoch;
    const covers = asked; // 이 읽기를 시작하기 전에 부른 주문 뒤 몫까지만 채운다
    readingEpoch = e;
    let o;
    try {
      o = await keys.client().call(METHOD, { asset_type: [...PARAMS.asset_type] });
    } catch {
      o = { ok: false, kind: 'error' };
    } finally {
      if (readingEpoch === e) readingEpoch = null;
    }
    if (e !== epoch) return false; // 경로가 바뀌었거나 멈춤 — 늦은 결과는 버린다
    lastAt = now();
    clearRetry();
    if (covers > met) met = covers;
    if (laterTimer == null) beforeLater = null;
    if (o && o.ok) {
      const v = assetsView(o.result);
      fails = 0;
      status = v ? 'ok' : 'unknown';
      value = v ? v.available : null;
    } else {
      if (o && (o.kind === 'rate' || o.kind === 'busy')) skip = BALANCE.skipAfterRate; // 요청 제한 — 두 주기 쉼
      fails += 1;
      if (fails >= BALANCE.failMax) {
        status = 'unknown';
        value = null;
      } else if (value == null) {
        status = 'loading';
      }
    }
    emit();
    pump(); // 이 읽기 뒤에도 남은 몫(읽는 도중에 부름)이면 10초 간격을 지켜 한 번 더
    return true;
  }

  // 주문 뒤 몫 읽기 — 꺼짐·숨음·요청 제한 쉼·읽는 중이면 지금은 아무것도 안 한다(보임·쉼이 끝난 주기·읽기 끝이 다시 맡음).
  // 마지막 읽기 10초 안이면 10초가 찰 때, busy면 2초마다 다시 보고 풀리면 한 번
  function pump() {
    clearSoon();
    if (asked <= met || mode === 'off' || !visible || skip > 0 || reading()) return;
    const wait = lastAt ? lastAt + BALANCE.peekGapMs - now() : 0;
    if (wait > 0) {
      soonTimer = timers.setTimeout(pump, wait);
      return;
    }
    if (isBusy()) {
      soonTimer = timers.setTimeout(pump, BALANCE.busyRetryMs);
      return;
    }
    read();
  }

  // 주문·정리 직후(app.js — 수동 주문 동작이 끝남·자동매매 체결·끝): 30초 주기를 기다리지 않고 곧 한 번(관문 그대로, 여러 번 불러도 한 번).
  // 이미 미룬 다시 보기가 있으면 그대로 둔다(부를 때마다 미루지 않게). 키가 없으면(off) false
  function afterOrder() {
    if (mode === 'off') return false;
    asked += 1;
    if (soonTimer == null) pump();
    return true;
  }

  // busy로 건너뛴 회차 — 2초마다 다시 보고, 풀리면 한 번 읽는다. 다음 주기(또는 정한 시각) 전까지만
  function retryBusy() {
    retryTimer = null;
    if (mode === 'off' || !visible || reading()) return;
    if (isBusy()) {
      if (now() + BALANCE.busyRetryMs < retryUntil) retryTimer = timers.setTimeout(retryBusy, BALANCE.busyRetryMs);
      return;
    }
    read();
  }
  function scheduleRetry() {
    if (retryTimer != null) return;
    retryUntil = now() + BALANCE.everyMs - BALANCE.busyRetryMs;
    retryTimer = timers.setTimeout(retryBusy, BALANCE.busyRetryMs);
  }
  // 지금 읽거나(한가하면), busy면 짧게 다시 보기를 건다
  function readOrRetry() {
    if (isBusy()) scheduleRetry();
    else read();
  }

  function tick() {
    if (mode === 'off' || !visible) return;
    if (skip > 0) {
      skip -= 1;
      return;
    }
    readOrRetry();
  }

  function startEvery() {
    if (every == null) every = timers.setInterval(tick, BALANCE.everyMs);
  }

  // 키 상태가 바뀌었을 때(app.js onKeysChange)·처음 — 경로가 바뀌면 값을 버리고 새로(첫 읽기도 busy 관문을 지난다)
  function sync() {
    const m = modeNow();
    if (m !== mode) {
      epoch += 1;
      clearEvery();
      clearRetry();
      clearSoon(); // 남은 주문 뒤 몫은 새 경로의 첫 읽기가 채운다(그 읽기가 끝나며 다시 봄)
      clearLater();
      mode = m;
      status = 'idle';
      value = null;
      fails = 0;
      skip = 0;
      lastAt = 0;
      emit();
    }
    if (mode !== 'off' && visible) {
      startEvery();
      if (status === 'idle') {
        status = 'loading';
        emit();
        readOrRetry();
      }
    }
  }

  // 앱이 숨으면 멈추고, 돌아오면 30초 넘게 지났을 때 한 번(busy 관문) + 주기 다시. 숨은 동안 부른 주문 뒤 몫은 30초가 안 지났어도 한 번(같은 관문)
  function setVisible(v) {
    visible = !!v;
    if (!visible) {
      clearEvery();
      clearRetry();
      clearSoon();
      return;
    }
    if (mode === 'off') {
      sync();
      return;
    }
    startEvery();
    if (status === 'idle') {
      sync();
      return;
    }
    if (!reading() && now() - lastAt >= BALANCE.everyMs && skip === 0) readOrRetry();
    pump();
  }

  // 누름('잔고 보기'·'잠시 뒤 다시') — 한 번 읽는다. 마지막 읽기 10초 안이면 읽지 않고, 실행기가 부르는 중이면 '잠시 뒤 다시'(5초 뒤 원래 표시로)
  async function peek() {
    if (mode === 'off' || reading()) return false;
    if (lastAt && now() - lastAt < BALANCE.peekGapMs) return false;
    if (isBusy()) {
      if (status !== 'later') beforeLater = status;
      status = 'later';
      emit();
      if (laterTimer != null) timers.clearTimeout(laterTimer);
      const e = epoch;
      laterTimer = timers.setTimeout(() => {
        laterTimer = null;
        if (e !== epoch || status !== 'later') return;
        status = beforeLater != null ? beforeLater : value != null ? 'ok' : 'idle';
        beforeLater = null;
        emit();
      }, BALANCE_LATER_MS);
      return false;
    }
    clearLater();
    if (value == null) {
      status = 'loading';
      emit();
    }
    return read();
  }

  function stop() {
    epoch += 1;
    clearEvery();
    clearRetry();
    clearSoon();
    clearLater();
  }

  return { sync, setVisible, peek, afterOrder, state, stop };
}
