// 리치 서버 AI 최신 분석 받기(p34 §3.1) — analysisReplay 판(수호·준현)만 만든다(공용판은 부르지 않음).
// 언제: ⓪ 앱을 켤 때 한 번(사무실이 준비되기 전에 값을 갖고 있게) · ① 사무실 탭이 보이고 앱이 화면에 있을 때 60초마다
//       (p35 §2.11 — 받은 sched.up이면 30초, sched.running이면 15초: '분석 중' 줄이 늦게 뜨거나 끝난 뒤 오래 남지 않게)
//       · ② 사무실이 ptf:analysis-get을 보낼 때(refreshSoon — 3초에 1번까지) · ③ 앱이 다시 보일 때 한 번. 숨으면 멈춘다.
// p40 T12: 트레이딩 탭 판정 상자도 이 받기 하나를 쓴다 — 주기는 앱이 화면에 있고 (사무실 탭 또는 트레이딩 탭)이 보일 때(setTradeTab), 두 번째 주기는 없다.
// 한 번에 하나만 받는다(진행 중이면 같은 받기를 기다림). 실패는 앞 분석을 지우지 않고 up:false로(사무실이 "연결 끊김" 줄) — sched·autopilot은 null(모름).
// 이 받기는 허브 메모리 값만 읽는다 — 분석을 일으키지 않는다(요청 분석은 analysis-request.js, p35 §2.11)
export const ANALYSIS_POLL_MS = 60000;
export const ANALYSIS_GET_MIN_MS = 3000;
export const ANALYSIS_POLL_UP_MS = 30000;
export const ANALYSIS_POLL_RUN_MS = 15000;
// 한 번도 받지 못했을 때의 값(분석 없음·연결 끊김) — 사무실 메시지 견본 analysisNone과 같은 뜻
export const ANALYSIS_NONE = Object.freeze({ up: false, stale: false, off: false, analysis: null, autopilot: null, bySymbol: Object.freeze([]), levelsMaxMin: null, sched: null });

// 받은 값으로 정하는 주기 — 허브가 답했고(up) 스케줄러가 살아 있으면 30초, 분석이 도는 중이면 15초, 모르면 60초
export function pollMsOf(v) {
  const s = v && v.up === true ? v.sched : null;
  if (s && s.up === true && s.running === true) return ANALYSIS_POLL_RUN_MS;
  if (s && s.up === true) return ANALYSIS_POLL_UP_MS;
  return ANALYSIS_POLL_MS;
}

export function createAnalysisFeed({ load, timers = globalThis, now = () => Date.now(), onChange = () => {} }) {
  let value = null; // 마지막 값(받기 성공 값, 실패면 up:false로 바꾼 값)
  let received = false; // 한 번이라도 받았나(분석이 null이어도 받은 것)
  let inflight = null;
  let lastAt = -Infinity; // 마지막 받기를 시작한 시각
  let visible = true;
  let officeTab = false;
  let tradeTab = false; // 트레이딩 탭이 보이나(덮는 화면 없이) — 판정 상자(p40 T12)
  let timer = null;
  let timerMs = null; // 지금 주기(받은 값이 바뀌면 다시 정함)

  function current() {
    return value ? { ...value } : { ...ANALYSIS_NONE, bySymbol: [] };
  }

  function refresh() {
    if (inflight) return inflight;
    lastAt = now();
    inflight = (async () => {
      let r = null;
      try {
        r = await load();
      } catch {
        r = null;
      }
      if (r) {
        value = r;
        received = true;
      } else {
        // 앞 분석·종목별 머리는 남기고, 스케줄러·자동 운영 칸은 '모름'(null) — 허브가 꺼진 동안 옛 '분석 중'을 살아 있는 값처럼 보내지 않게(p35 §3.2)
        value = value ? { ...value, up: false, sched: null, autopilot: null } : { ...ANALYSIS_NONE, bySymbol: [] };
      }
      inflight = null;
      const v = current();
      sync(); // 받은 sched로 주기를 다시 정함
      try {
        onChange(v);
      } catch {
        // 받는 쪽 오류가 다음 받기를 막지 않게
      }
      return v;
    })();
    return inflight;
  }

  function sync() {
    const want = visible && (officeTab || tradeTab);
    const ms = pollMsOf(value);
    if (timer != null && (!want || ms !== timerMs)) {
      timers.clearInterval(timer);
      timer = null;
    }
    if (want && timer == null) {
      timerMs = ms;
      timer = timers.setInterval(refresh, ms);
    }
  }

  return {
    start() {
      refresh();
    },
    // 앱이 화면에 보이나(visibilitychange) — 다시 보이면 한 번(③)
    setVisible(v) {
      const was = visible;
      visible = !!v;
      sync();
      if (visible && !was) refresh();
    },
    // 사무실 탭이 보이나(덮는 화면 없이) — 마지막 받기가 60초 넘었으면 바로 한 번
    setOfficeTab(on) {
      const was = officeTab;
      officeTab = !!on;
      sync();
      if (officeTab && !was && visible && now() - lastAt >= pollMsOf(value)) refresh();
    },
    // 트레이딩 탭이 보이나(덮는 화면 없이, p40 T12 판정 상자) — 사무실 탭과 같은 주기 하나, 켜질 때 마지막 받기가 주기보다 오래면 바로 한 번
    setTradeTab(on) {
      const was = tradeTab;
      tradeTab = !!on;
      sync();
      if (tradeTab && !was && visible && now() - lastAt >= pollMsOf(value)) refresh();
    },
    // ptf:analysis-get(②) — 진행 중이면 그 받기, minMs 안에 받았으면 null(다시 받지 않음), 아니면 새로 받기
    refreshSoon(minMs = ANALYSIS_GET_MIN_MS) {
      if (inflight) return inflight;
      if (now() - lastAt < minMs) return null;
      return refresh();
    },
    pending: () => inflight,
    received: () => received,
    current,
  };
}
