// 셸(앱) ↔ 사무실(다른 출처 iframe) 메시지 — 설계 3-2 §4.2·§4.3.
// 받기: ev.origin === 사무실 출처 && ev.source === 지금 사무실 iframe 창일 때만. 그 출처(richtradingschool.github.io)는 다른 사이트들과
//   같이 쓰므로 마지막 ptf:office-ready의 path가 그 판 사무실 경로(officeUrl의 경로, 예 /ptf-office/m/)로 시작해야 '준비됨' —
//   준비 전·다른 페이지면 무료 횟수·바깥 링크도 받지 않고 아무것도 보내지 않는다(중계 포함).
// 보내기: 준비된 뒤에만, targetOrigin은 늘 사무실 출처('*' 금지). 공용판은 준비될 때마다 ptf:trial-seed(셸이 가진 최댓값).
// 무료 횟수: 셸이 기준 — used 최댓값 + limit은 셸 설정 config.trialRuns(trial.js recordTrial). 바깥 링크(ptf:open): 앱 설정 주소
//   (카카오 상담·소통방·그 판 가입 링크)와 글자까지 같을 때만 새 창(sandbox에 팝업이 없어 사무실은 스스로 못 연다) + onOpen(진짜 링크 한 줄).
// 중계: 셸이 지금 iframe을 &relay=1로 만들었을 때(expectRelay)만 — 사무실이 스스로 적은 relay를 그대로 믿지 않는다(§4.5)
// 최신 분석(p34 §3.2, analysisReplay 판만): 준비(pathOk)될 때마다 analysis.ready, ptf:analysis-get(v:1)은 준비된 뒤에만 analysis.get.
// iframe load(p34 §3.2, 검토 1): 셸은 iframe load마다 준비를 풀고(중계·분석 멈춤) 바로 ptf:office-ping을 사무실 출처로 보낸다 —
//   사무실은 핑에 office-ready로 답한다. 자식 load 안의 office-ready가 부모 iframe load보다 먼저 처리돼도 다시 준비된다(어느 순서든)
// 요청 분석(p35 §2.11, config.analysisRequest 판만): 준비된 뒤 ptf:analysis-request(형식 맞는 것만) → requests.request({req, symbol}).
//   준비를 풀 때(iframe load·다른 경로·사무실 교체) requests.officeGone() — 옛 창의 req로 새 창에 결과를 보내지 않게
import { parseTrial, loadTrial, recordTrial, shellTrial } from './trial.js';
import { OFFICE_PING } from './office-analysis.js';
import { parseAnalysisRequest } from './analysis-request.js';

export const OPEN_FEATURES = 'noopener,noreferrer';

export function officeTarget(officeUrl) {
  const u = new URL(officeUrl);
  return { origin: u.origin, path: u.pathname };
}

export function allowedOpenUrls(config) {
  return [config.kakao, config.telegram, config.signupUrl].filter((u) => typeof u === 'string' && u.startsWith('https://'));
}

export function parseReady(data, path) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.type !== 'ptf:office-ready' || data.v !== 1) return null;
  return { relay: data.relay === true, capable: data.capable === true, pathOk: typeof data.path === 'string' && data.path.startsWith(path) };
}

// relay: { ready(info), stop() } — 실계좌 송출 중계(office-relay.js, s·j판만). getFrame: 지금 사무실 iframe(없으면 null).
// expectRelay: 셸이 지금 iframe을 &relay=1로 만들었는지(office.relay()). onOpen(url): 허용된 바깥 링크마다(office.showOpenLink).
// analysis: { ready(info), stop(), get() } — 최신 분석 전달(office-analysis.js, analysisReplay 판만 — 없으면 분석 메시지를 받지도 보내지도 않음)
// requests: { request({req, symbol}), officeGone() } — 요청 분석 전달(analysis-request.js, analysisRequest 판만 — 없으면 요청 메시지를 버림)
export function createOfficeShell({ win = globalThis.window, config, storage, getFrame, relay = null, analysis = null, requests = null, expectRelay = () => false, onTrial = () => {}, onOpen = () => {} }) {
  const { origin, path } = officeTarget(config.officeUrl);
  const allow = allowedOpenUrls(config);
  let ready = false;
  let trial = shellTrial(loadTrial(storage, config.edition), config.trialRuns);

  const frameWin = () => {
    const f = getFrame();
    return f && f.contentWindow ? f.contentWindow : null;
  };

  function post(msg) {
    const w = frameWin();
    if (!ready || !w) return false;
    try {
      w.postMessage(msg, origin);
      return true;
    } catch {
      return false;
    }
  }

  // 준비를 푼다 — 옛 창·다른 경로·iframe load. 중계·분석 전송도 멈춘다(새 office-ready 전에는 아무것도 보내지 않음)
  function unready() {
    ready = false;
    if (relay) relay.stop();
    if (analysis) analysis.stop();
    if (requests) requests.officeGone();
  }

  function onReady(r) {
    if (!r.pathOk) {
      unready();
      return;
    }
    ready = true;
    if (config.edition === 'pub') post({ type: 'ptf:trial-seed', v: 1, used: trial ? trial.used : 0 });
    if (relay) {
      // 데모·중계는 셸이 정한다(§4.5) — 셸이 만든 주소(&relay=1 있음/없음)와 사무실이 말한 relay가 같을 때만 시작
      if (r.relay === expectRelay()) relay.ready(r);
      else relay.stop();
    }
    // 최신 분석(p34 §3.2) — 데모(미인증)·중계 모두, 준비될 때마다 늘 1회
    if (analysis) analysis.ready(r);
  }

  function onMessage(ev) {
    if (!ev || ev.origin !== origin) return;
    const w = frameWin();
    if (!w || ev.source !== w) return;
    const d = ev.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    if (d.type === 'ptf:office-ready') {
      const r = parseReady(d, path);
      if (r) onReady(r);
      return;
    }
    if (!ready) return;
    if (d.type === 'ptf:analysis-get') {
      if (d.v === 1 && analysis && config.analysisReplay === true) analysis.get();
      return;
    }
    if (d.type === 'ptf:analysis-request') {
      const r = requests && config.analysisRequest === true ? parseAnalysisRequest(d) : null;
      if (r) requests.request(r);
      return;
    }
    if (d.type === 'ptf:trial') {
      const t = parseTrial(d);
      if (!t) return;
      trial = recordTrial(t, storage, config.edition, config.trialRuns, trial);
      onTrial(trial);
      return;
    }
    if (d.type === 'ptf:open' && d.v === 1 && typeof d.url === 'string' && allow.includes(d.url)) {
      try {
        win.open(d.url, '_blank', OPEN_FEATURES);
      } catch {
        // 브라우저가 새 창을 막음 — 아래 진짜 링크 한 줄로 연다
      }
      // noopener라 막혔는지 알 수 없다(늘 null) — 부모 창에서 직접 누르는 링크를 같이 둔다(결정 11)
      onOpen(d.url);
    }
  }

  win.addEventListener('message', onMessage);
  return {
    post,
    // 사무실 iframe을 새로 만들 때(인증·해제) — 새 창이 office-ready를 보낼 때까지 아무것도 보내지 않는다
    reset() {
      unready();
    },
    // 지금 사무실 iframe의 load(처음 열기·사무실 안 이동·새로 고침, p34 §3.2) — 준비를 풀고 핑. 핑만은 준비 검사 없이 사무실 출처로
    // (다른 출처로 넘어간 창에는 브라우저가 전달하지 않는다, 내용 없음). 창이 없으면 false
    frameLoaded() {
      unready();
      const w = frameWin();
      if (!w) return false;
      try {
        w.postMessage({ ...OFFICE_PING }, origin);
        return true;
      } catch {
        return false;
      }
    },
    isReady: () => ready,
    trial: () => trial,
  };
}
