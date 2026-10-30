// 셸(앱) ↔ 사무실(다른 출처 iframe) 메시지 — 설계 3-2 §4.2·§4.3.
// 받기: ev.origin === 사무실 출처 && ev.source === 지금 사무실 iframe 창일 때만. 그 출처(richtradingschool.github.io)는 다른 사이트들과
//   같이 쓰므로 마지막 ptf:office-ready의 path가 그 판 사무실 경로(officeUrl의 경로, 예 /ptf-office/m/)로 시작해야 '준비됨' —
//   준비 전·다른 페이지면 무료 횟수·바깥 링크도 받지 않고 아무것도 보내지 않는다(중계 포함).
// 보내기: 준비된 뒤에만, targetOrigin은 늘 사무실 출처('*' 금지). 공용판은 준비될 때마다 ptf:trial-seed(셸이 가진 최댓값).
// 무료 횟수: 셸이 기준 — used 최댓값 + limit은 셸 설정 config.trialRuns(trial.js recordTrial). 바깥 링크(ptf:open): 앱 설정 주소
//   (카카오 상담·소통방·그 판 가입 링크)와 글자까지 같을 때만 새 창(sandbox에 팝업이 없어 사무실은 스스로 못 연다) + onOpen(진짜 링크 한 줄).
//   뉴스 근거 원문(2026-10-23): 셸이 그 사무실에 보낸 분석(ptf:analysis·ptf:analysis-result)의 news https 링크(최근 100개)와 글자까지 같을 때도.
// 중계: 셸이 지금 iframe을 &relay=1로 만들었을 때(expectRelay)만 — 사무실이 스스로 적은 relay를 그대로 믿지 않는다(§4.5)
// 최신 분석(p34 §3.2, analysisReplay 판만): 준비(pathOk)될 때마다 analysis.ready, ptf:analysis-get(v:1)은 준비된 뒤에만 analysis.get.
// iframe load(p34 §3.2, 검토 1): 셸은 iframe load마다 준비를 풀고(중계·분석 멈춤) 바로 ptf:office-ping을 사무실 출처로 보낸다 —
//   사무실은 핑에 office-ready로 답한다. 자식 load 안의 office-ready가 부모 iframe load보다 먼저 처리돼도 다시 준비된다(어느 순서든)
// 요청 분석(p35 §2.11, config.analysisRequest 판만): 준비된 뒤 ptf:analysis-request(형식 맞는 것만) → requests.request({req, symbol}).
//   준비를 풀 때(iframe load·다른 경로·사무실 교체) requests.officeGone() — 옛 창의 req로 새 창에 결과를 보내지 않게
import { parseTrial, loadTrial, recordTrial, shellTrial } from './trial.js';
import { OFFICE_PING } from './office-analysis.js';
import { parseAnalysisRequest } from './analysis-request.js';
import { memberCapable } from './auto-view.js';
import { ANALYSIS_ID } from './analysis-shape.js';

export const OPEN_FEATURES = 'noopener,noreferrer';
export const NEWS_LINKS_MAX = 100;
// 보낸 분석 메시지의 기사 링크(https만) — 허브·셸 모양 검사를 거친 값
export function newsLinksOf(msg) {
  if (!msg || (msg.type !== 'ptf:analysis' && msg.type !== 'ptf:analysis-result')) return [];
  const a = msg.analysis;
  const list = a && typeof a === 'object' && Array.isArray(a.news) ? a.news : [];
  return list.map((n) => (n && typeof n.link === 'string' && n.link.startsWith('https://') ? n.link : null)).filter(Boolean);
}

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
// gains: { ready(), stop() } — 수익 알림 전달(office-gains.js, 2026-10-23 — s·j판 요청 분석 판만, 없으면 보내지 않음)
// 진입 참고가 값(2026-10-23 사무실 2차 요청 4) — 요청 분석 판(config.analysisRequest)이고 config.followRules.member 기본값이 다 있을 때만
export function entryRefOf(config) {
  const m = config && config.analysisRequest === true && config.followRules && config.followRules.member ? config.followRules.member : null;
  const v = (k) => (m && m[k] && Number.isFinite(m[k].default) && m[k].default > 0 ? m[k].default : null);
  const lev = v('lev');
  const firstPct = v('firstPct');
  const tpPct = v('tpPct');
  return lev && firstPct && tpPct ? { type: 'ptf:entry-ref', v: 1, lev, firstPct, tpPct } : null;
}

// onOpenVerify: 비활성화 s·j 사무실의 '🔒 정밀 분석'·맨 아래 띠 'UID 활성화'(대표 결정 2026-10-24·10-30 — ptf:open-verify) → UID 활성화 화면.
//   화면만 바꾼다(UID를 넣거나 보내지 않음)
// trialLeft: { ready(), changed(), stop() } — 체험 남은 횟수(office-trial.js, 대표 결정 2026-10-30 — 요청 분석 s·j판만, 없으면 묻지 않음).
//   s·j판이고 셸이 중계 아닌 주소로 만든 사무실(= 비활성화 기기)이 capable(m/)로 준비될 때 ready, 그 창에 ptf:analysis-result를 보낸 뒤 changed,
//   준비를 풀 때 stop
export function createOfficeShell({ win = globalThis.window, config, storage, getFrame, relay = null, analysis = null, requests = null, gains = null, trialLeft = null, expectRelay = () => false, onTrial = () => {}, onOpen = () => {}, onOpenTrade = () => {}, onOpenVerify = () => {} }) {
  const { origin, path } = officeTarget(config.officeUrl);
  const allow = allowedOpenUrls(config);
  const newsLinks = new Set(); // 보낸 분석의 기사 원문 링크(넣은 순서 — 넘치면 오래된 것부터 뺌)
  let ready = false;
  let trialOn = false; // 지금 준비된 창이 비활성화 사무실(체험 남은 횟수를 보낼 곳)
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
    } catch {
      return false;
    }
    for (const u of newsLinksOf(msg)) {
      newsLinks.delete(u);
      newsLinks.add(u);
      if (newsLinks.size > NEWS_LINKS_MAX) newsLinks.delete(newsLinks.values().next().value);
    }
    // 요청 결과를 보낸 뒤 체험 남은 횟수를 다시(새 표·돌려준 표·trial이 바로 보이게) — 비활성화 사무실만
    if (trialOn && trialLeft && msg && msg.type === 'ptf:analysis-result') {
      try {
        trialLeft.changed();
      } catch {
        // 남은 횟수 받기 실패는 결과 전달과 무관
      }
    }
    return true;
  }

  // 준비를 푼다 — 옛 창·다른 경로·iframe load. 중계·분석 전송도 멈춘다(새 office-ready 전에는 아무것도 보내지 않음)
  function unready() {
    ready = false;
    trialOn = false;
    if (relay) relay.stop();
    if (analysis) analysis.stop();
    if (requests) requests.officeGone();
    if (gains) gains.stop();
    if (trialLeft) trialLeft.stop();
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
    if (gains) gains.ready();
    // 진입 참고가(2026-10-23 사무실 2차 요청 4): 요청 분석 판(s·j)만 — 그 판 follow-rules 회원 기본값(배율·1차 비중·익절 %)을 사무실 패널에
    const ref = entryRefOf(config);
    if (ref) post(ref);
    // 체험 남은 횟수(대표 결정 2026-10-30): s·j판·셸이 중계 아닌 주소로 만든 창(= 비활성화 기기)·m/ 사무실(capable)일 때만
    trialOn = !!trialLeft && memberCapable(config) && config.analysisRequest === true && !expectRelay() && r.capable === true;
    if (trialOn) trialLeft.ready();
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
    // 진입 참고가 '▶ 진입가·익절가 보기'(대표 결정 2026-10-25 — 보안 규칙 22 예외): { v:1, id } — 분석 id 꼴만 넘긴다(가격 칸은 읽지 않음).
    // 셸은 그 id로 허브 분석 항목을 받아 트레이딩 탭 카드를 만든다(app.js openEntryRef) — 주문은 그 카드의 [진입하기]+확인을 회원이 눌러야만. id가 없으면 탭만
    if (d.type === 'ptf:open-trade') {
      if (d.v === 1 && config.analysisRequest === true) onOpenTrade(typeof d.id === 'string' && ANALYSIS_ID.test(d.id) ? d.id : null);
      return;
    }
    // UID 활성화 안내(대표 결정 2026-10-24): s·j판이고 셸이 중계 아닌 주소로 만든 사무실(= 비활성화 기기)일 때만
    if (d.type === 'ptf:open-verify') {
      if (d.v === 1 && memberCapable(config) && !expectRelay()) onOpenVerify();
      return;
    }
    if (d.type === 'ptf:trial') {
      const t = parseTrial(d);
      if (!t) return;
      trial = recordTrial(t, storage, config.edition, config.trialRuns, trial);
      onTrial(trial);
      return;
    }
    if (d.type === 'ptf:open' && d.v === 1 && typeof d.url === 'string' && (allow.includes(d.url) || newsLinks.has(d.url))) {
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
