// 셸 → 사무실 리치 서버 AI 최신 분석 전달(p34 §3.2, 견본 test/fixtures/app-analysis-contract.json = 데모 앱 lite/test/analysis-contract.json).
// 보내기(post)는 office-shell이 한다(사무실 준비·출처 검사). 메시지는 계약 키만 새로 만든다 — 회원 토큰·키·잔고·따라가기 상태는 없다.
//   ready(info)  ptf:office-ready(pathOk) 뒤 늘 1회 — 가진 값이면 바로, 첫 받기가 진행 중이면 끝나는 대로(최대 5초 — 받기 제한),
//                받기에 실패했거나 값이 없으면 analysis:null·up:false(견본 analysisNone — 사무실이 '옛 셸'로 오판하지 않게, 검토 9)
//   changed(v)   받은 값의 id·autopilot·up·stale·off·sched(p35)·canRequest가 바뀔 때만 reply:false
//   get()        ptf:analysis-get — 가진 값이 있으면 받기를 기다리지 않고 바로 reply:true(검토 8·33), 다시 받기는 뒤에서(3초에 1번),
//                새 값이 다르면 changed()가 reply:false로 한 번 더. 한 번도 못 받았으면 그 받기가 끝난 뒤 답
//   stop()       iframe load·다른 경로·사무실 교체 — 기다리던 전송은 버린다(옛 문서에 보내지 않음)
import { ANALYSIS_GET_MIN_MS, ANALYSIS_NONE } from './analysis-feed.js';

// p35 §7.2: 끝 두 칸 — sched(스케줄러 상태, 허브가 모르면 null)·canRequest(이 셸이 요청 분석을 아는가 — 옛 셸이면 사무실이 기다리지 않음)
export const ANALYSIS_MESSAGE_KEYS = Object.freeze(['type', 'v', 'reply', 'up', 'stale', 'off', 'analysis', 'autopilot', 'sched', 'canRequest']);
export const OFFICE_PING = Object.freeze({ type: 'ptf:office-ping', v: 1 });

// up이 거짓이면(받기 실패·허브가 우리 앱을 못 읽음) autopilot·sched는 모름(null) — 옛 '분석 중'·'다음 분석'이 '연결 끊김' 줄과 같이 남지 않게(p35 §3.2·§10-4)
export function analysisMessage(reply, value, canRequest = false) {
  const v = value || ANALYSIS_NONE;
  const up = v.up === true;
  return {
    type: 'ptf:analysis',
    v: 1,
    reply: reply === true,
    up,
    stale: v.stale === true,
    off: v.off === true,
    analysis: v.analysis || null,
    autopilot: (up && v.autopilot) || null,
    sched: (up && v.sched) || null,
    canRequest: canRequest === true,
  };
}

// 바뀜 판정 — sched만 바뀌어도(분석 중 종목·마지막 성공 시각 등) 사무실 안내 줄이 옛 상태에 머물지 않게 보낸다(p35 §2.11)
const keyOf = (v, canRequest) => {
  const m = analysisMessage(false, v, canRequest);
  return JSON.stringify({ id: m.analysis ? m.analysis.id : null, autopilot: m.autopilot, up: m.up, stale: m.stale, off: m.off, sched: m.sched, canRequest: m.canRequest });
};

// canRequest: () => boolean — 요청 분석 판(config.analysisRequest)이고 요청 모듈이 있을 때 참(app.js)
export function createOfficeAnalysis({ post, feed, canRequest = () => false }) {
  let active = false;
  let epoch = 0;
  let holding = false; // 받기를 기다렸다가 보낼 전송이 있다 — 그동안의 바뀜 알림은 그 전송이 대신한다
  let lastKey = null;

  const can = () => canRequest() === true;

  function send(reply, value) {
    lastKey = keyOf(value, can());
    post(analysisMessage(reply, value, can()));
  }

  function later(p, reply) {
    const my = epoch;
    holding = true;
    p.then(() => {
      if (my !== epoch || !active) return;
      holding = false;
      send(reply, feed.current());
    }, () => {});
  }

  function stop() {
    active = false;
    holding = false;
    epoch += 1;
  }

  return {
    ready(info) {
      if (!info || info.pathOk !== true) {
        stop();
        return;
      }
      stop();
      active = true;
      const p = feed.pending();
      if (!feed.received() && p) later(p, false);
      else send(false, feed.current());
    },
    changed(value) {
      if (!active || holding) return;
      if (keyOf(value, can()) !== lastKey) send(false, value);
    },
    get() {
      if (!active) return;
      if (feed.received()) {
        send(true, feed.current());
        feed.refreshSoon(ANALYSIS_GET_MIN_MS); // 바뀌면 changed()가 reply:false로
        return;
      }
      const p = feed.pending() || feed.refreshSoon(ANALYSIS_GET_MIN_MS);
      if (p) later(p, true);
      else send(true, feed.current());
    },
    stop,
    active: () => active,
  };
}
