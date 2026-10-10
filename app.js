// 모바일 앱 껍데기 — 맨 위 큰 버튼 2개(사무실·트레이딩) + ⚙ + 덮는 화면(설치 안내·설정·UID 인증·거래소 연결·따라가기).
// 대표 결정 2026-10-10: 자동매매 탭을 트레이딩 탭으로 합쳤다 — 운영 측 자동매매 송출(modes/auto.js)은 트레이딩 탭의 '⚡ 오토 모드' 카드(차트 위)와
// 열린 포지션 목록(주문 칸 아래)에 그린다. 옛 #auto 주소는 트레이딩 탭으로(lib/router.js MODE_ALIASES — 주소도 #trade로 바꿔 씀)
// 사무실 탭은 다른 출처 iframe(https://richtradingschool.github.io/ptf-office/, 설계 3-2 §4.2) — 메시지는 office-shell(사무실 출처·
// 지금 iframe 창·사무실 경로만)로만 주고받고, 인증 회원(s·j)의 사무실은 실계좌 송출 중계(office-relay, §4.3·§4.5)
// 거래소 키(#keys, 설계 3-2 §5)는 s·j판 인증 회원 + (autoReady 또는 시험 토큰)만 — 공용판은 키 화면·거래소 연결 코드를 부르지 않는다
import { CONFIG } from './config.js';
import { LAST_MODE_KEY, parseRoute, routeHash, initialRoute } from './lib/router.js'; // 옛 #auto → 트레이딩
import { safeGet, safeSet } from './lib/store.js';
import { fetchHealth, fetchAnalysis, fetchEvents, fetchAnalysisItem, postAnalysisRequest, fetchAnalysisRequest, fetchAnalysisTurns } from './lib/hub.js';
import { createAnalysisFeed } from './lib/analysis-feed.js';
import { createOfficeAnalysis } from './lib/office-analysis.js';
import { createAnalysisRequests } from './lib/analysis-request.js';
import { createEventsFeed } from './lib/events-feed.js';
import { createEventsView } from './screens/events.js';
import { loadTrial, shellTrial } from './lib/trial.js';
import { purgeSameOriginOffice } from './lib/office-migrate.js';
import { memberCapable } from './lib/auto-view.js';
import { openVaultOrMemory, memoryVault } from './lib/vault.js';
import { createMemberSession } from './lib/member.js';
import { createMemberControl, memberChannelName } from './lib/member-control.js';
import { createOfficeShell } from './lib/office-shell.js';
import { createOfficeRelay } from './lib/office-relay.js';
import { createOffice } from './modes/office.js';
import { createAutoMode } from './modes/auto.js';
import { createTradeMode } from './modes/trade.js';
import { renderSettings } from './screens/settings.js';
import { renderVerify } from './screens/verify.js';
import { renderKeys } from './screens/keys.js';
import { createOxClient } from './lib/ox-client.js';
import { createKeyControl, keysCapable, KEYS_IDLE } from './lib/keys.js';
import { createInstallController } from './screens/install-controller.js';
import { registerSW } from './lib/sw-client.js';
// 따라가기(설계 3-2 §6) — s·j판에서 기기 저장소·키 연결 뒤에만 만든다(공용판은 부르지 않음). 자격은 키 화면과 같다(followCapable)
import { fetchInstruments } from './lib/hub.js';
import { rulesOf } from './lib/follow-rules.js';
import { createFollowStore } from './lib/follow-store.js';
import { createLeaseClient } from './lib/follow-lease.js';
import { createFollowEngine } from './lib/follow-engine.js';
import { createSymbolQueue } from './lib/symbol-queue.js';
import { createUpkeep } from './lib/follow-upkeep.js';
import { consentFile } from './lib/follow-settings.js';
import { followCapable, wakeSupport, mySettingsView, followQuick } from './lib/follow-view.js';
import { renderFollow } from './screens/follow.js';
import { renderSheet, renderBand } from './screens/follow-sheet.js';
// 트레이딩 탭 ⚡ 오토 모드 켜기·끄기 줄(따라가기 — CEO 2026-10-10) — 같은 엔진(follow), 같은 자격(followCapable), s·j판만
import { renderTradeFollow } from './screens/trade-follow.js';
// 트레이딩 탭 판정 상자(p2 spec 4판 §6 — p40 T12) — 주문 칸과 따로, s·j판만. 데이터는 셸의 최신 분석 받기 하나(analysisFeed), 근거는 누를 때만 item
import { renderVerdict } from './screens/trade-verdict.js';
// 트레이딩 탭 주문 칸(2e 수동 주문 — p2 spec 4판 §5, p40 T13): 화면(modes/trade-orders.js)은 규칙이 있는 판마다, 실행기·기록·자동 손절 스위치·목록은
// s·j판 bootMember가 오래가는 저장소(idb)일 때만 만든다(공용판은 만들지 않음 — 키·장부 DB를 열지 않음, T-13 안내 한 줄만). 주문은 회원이 누를 때만
import { createOrderPanel } from './modes/trade-orders.js';
import { createManualExec } from './lib/manual-exec.js';
import { createManualStore } from './lib/manual-store.js';
import { createAutoSlSwitch } from './lib/auto-sl-switch.js';
import { createAutoSlOrders } from './lib/auto-sl-orders.js';
import { memberManualOf, instrumentsFor, condFor, watchFor } from './lib/trade-wiring.js';
import { tradePanelState, positionView } from './lib/trade-view.js';
import { AUTO_SL_TEXT } from './lib/auto-sl.js';
// 상단 띠(p34 §6.8) — 인증 배지·계정 연결/잔고·📄 가이드·거래소 이벤트 칩 자리
import { renderStrip, stripModel, balanceLine } from './screens/strip.js';
import { createStripBalance } from './lib/strip-balance.js';
// 첫 실행 안내(p34 §6.1~§6.4) — 동업자 tour.js 휴대폰판. 장 고르기는 순수(lib/tour.js), 그리기는 screens/tour.js
import { createTour } from './screens/tour.js';
import { tourSteps, apiStep, autoTourDecision, apiTourDecision, tourKey, apiTourKey, tourDataWait } from './lib/tour.js';

const $ = (s) => document.querySelector(s);
// UID 인증은 담당자판(s·j)만 — 공용판에는 들어가는 곳이 없고 기기 저장소(ptf-<판>-vault)도 열지 않는다(설계 3-2 §3.1·§5.1)
const MEMBER_OK = memberCapable(CONFIG);
// 체험 기록은 판별 키(ptf-trial-<판>) — 담당자판 사무실의 {0,0}이 공용판 기록을 덮지 않게
const state = {
  mode: 'office',
  screen: null,
  health: { state: 'pending' },
  updateNote: '',
  // limit은 셸 설정(판 trial_runs)으로 — 저장값의 옛 limit을 쓰지 않는다(결정 3)
  trial: shellTrial(loadTrial(undefined, CONFIG.edition), CONFIG.trialRuns),
  member: null,
  // s·j판은 인증 상태(control)가 생길 때까지(기기 저장소 열기, 최대 5초) '인증하기'를 잠근다 — 그 사이 누름이 소리 없이 버려지지 않게
  verify: { pending: MEMBER_OK, message: null },
  // s·j판은 저장된 인증을 불러온 뒤에 사무실을 만든다 — 인증 회원이 켤 때마다 데모를 띄웠다가 중계로 다시 띄우지 않게
  memberBooted: !MEMBER_OK,
  // 거래소 키 연결 상태(keys.js KEYS_IDLE 모양) — 설정 줄·키 화면이 쓴다
  keys: KEYS_IDLE,
  // 따라가기 엔진 상태(follow-engine state()) — 따라가기 화면·시트·띠·설정 줄·트레이딩 탭(⚡ 오토 모드 줄·놓친 신호·내 따라가기 설정)
  follow: null,
  // 회원 송출 스냅샷 { state, events, hubDown, … }(송출 onFeed — 회원이 아니면 null) — 트레이딩 탭 주문 칸이 manual(허브 판정)·hubDown을 읽는다
  memberSnap: null,
};
// 기기 저장소(IndexedDB)가 멈춰도 이만큼 뒤에는 데모 사무실을 띄운다 — 그 뒤 인증되면 onMemberChange가 중계로 바꾼다(결정 8)
const MEMBER_BOOT_MS = 5000;
const PNL_REFRESH_MS = 5000; // p34 열린 매매 평가 손익 다시 그리기
// 설치 안내(install-controller)·서비스 워커(sw-client)가 boot() 전에 채운다
// getAnalysis: 셸이 가진 최신 분석(데이터 트랙의 analysis-feed가 채움) — 첫 실행 안내 S3 직원 이름에만
const hooks = { openInstall: null, checkUpdate: null, getAnalysis: null };
let control = null; // 인증 상태(member-control) — s·j판에서 기기 저장소를 연 뒤 생긴다
let officeShell = null; // 사무실 메시지(office-shell) — boot()에서 사무실 iframe을 만들기 전에 수신을 건다
let keys = null; // 거래소 키 연결(createKeyControl) — s·j판에서 기기 저장소를 연 뒤 생긴다
let lease = null; // 따라가기 임대(createLeaseClient, §6.16) — 중계 X-Ptf-Lease·WS 직접 follow/check가 쓴다
let follow = null; // 따라가기 엔진(createFollowEngine) — s·j판에서 키 연결 뒤에 생긴다
// 공용 종목 큐(symbol-queue.js, p40) — 따라가기와 트레이딩 탭 수동 주문이 같은 것을 쓴다(같은 종목은 앞 동작 확인 뒤, 창 사이는 Web Locks 'ptf-<판>-ox-<종목>').
// s·j판에서 따라가기 엔진 바로 전에 하나 만든다. 공용판은 null
let symbolQueue = null;
let wakeSentinel = null; // 화면 켜 두기(F-13) — ② 켜짐 동안만
let balance = null; // 띠 잔고(createStripBalance) — 키 연결 뒤에. 값은 메모리에만(저장·사무실·허브 기록 없음)
let followCalls = 0; // 따라가기 실행기가 거래소를 부르는 중인 수 — 그동안 띠 잔고 주기는 건너뛴다(§6.8)
let followLastAt = 0; // 따라가기 실행기의 마지막 거래소 호출이 끝난 시각 — 그 뒤 잠깐(FOLLOW_QUIET_MS)도 잔고 주기를 건너뛴다(진입 묶음 사이)
const FOLLOW_QUIET_MS = 3000;
const followBusy = () => followCalls > 0 || Date.now() - followLastAt < FOLLOW_QUIET_MS;
// 트레이딩 탭(p2 spec §2) — boot()에서 만든다. 탭이 보일 때만 봉·시세를 받는다(show/hide). 주문 칸 자리(orderSlots)는 2e 주문 칸(p40 T13)이 채우고,
// 종목 바꿈 알림(onTradeSymbol)은 bootMember가 수동 실행기를 만들 때 주문 시세 구독(watchFor(keys))으로 건다
let tradeMode = null;
let orderSlots = null;
let onTradeSymbol = null;
// 트레이딩 탭 ⚡ 오토 모드 켜기·끄기 줄(screens/trade-follow.js) — 트레이딩 탭을 처음 열 때(onOrderSlot) s·j판만 만든다. 공용판은 null(자리 빈칸 — 카드 제목만)
let tradeFollow = null;
// 트레이딩 탭 판정 상자(screens/trade-verdict.js) — 트레이딩 탭을 처음 열 때(onOrderSlot) s·j판만. 공용판은 null(자리 빈칸)
let tradeVerdict = null;
// 트레이딩 탭 주문 칸(modes/trade-orders.js, p40 T13) — 트레이딩 탭을 처음 열 때(onOrderSlot) 규칙이 있는 판. 수동 실행기(manualExec)·기록(manualStore)·
// 자동 손절 스위치(autoSw — kv.autoSl, 따라가기 엔진과 같은 값·채널)는 s·j판 bootMember가 오래가는 저장소·규칙이 있을 때만(그 전·공용판·사생활 보호 모드는 null)
let orderPanel = null;
let manualStore = null;
let manualExec = null;
let autoSw = null;
let vaultKind = null; // 기기 저장소 종류('idb'|'memory') — 알기 전(bootMember가 열기 전)에는 주문 칸을 그리지 않는다
let tradeTimer = null; // 트레이딩 탭이 보이는 동안 5초 — 정리 주기(upkeep) + 주문 칸 다시 그리기
let lightTimer = null; // 앱이 보이는 동안 30초 — 수동 기록이 열려 있으면 가벼운 정리(자동 손절 보조 감시 — AUTO_SL_TEXT.failed의 30초)
let tradeTicking = false;
const TRADE_TICK_MS = 5000;
const MANUAL_LIGHT_MS = 30000;
// 상단 띠 — 배지·계정 버튼(keysCapable일 때만)·📄 가이드. 잔고는 두 경로 모두 보일 때 30초마다(따라가기 중에도 — 대표 결정 2026-10-09)
const strip = renderStrip($('#strip'), {
  config: CONFIG,
  root: document.documentElement,
  onAccount: (action) => {
    if (action === 'peek' && balance) balance.peek();
    else go({ mode: state.mode, screen: 'keys' });
  },
});
function syncStrip() {
  strip.update(stripModel({ config: CONFIG, member: state.member, verify: state.verify, keys: state.keys, balance: balance ? balance.state() : null }));
}
// 따라가기 설정 화면(#follow — 덮는 화면이라 띠가 가려짐)의 잔고 한 줄(대표 결정 2026-10-10): 띠와 같은 메모리 값(balance.state())의 글 — 새 거래소 호출 없음
function followBalance() {
  return balanceLine({ config: CONFIG, member: state.member, keys: state.keys, balance: balance ? balance.state() : null });
}
function syncFollowBalance() {
  if (followView && state.screen === 'follow') followView.setBalance(followBalance());
}

// ── 첫 실행 안내 ──
// S2·S12의 '트레이딩'은 주문 칸까지 말한다 — 이 회원에게 주문 칸이 열릴 때(키 자격 + tradeReady 빌드 또는 시험 토큰, p40 T13)만 S2 그대로·S12(직접 주문·
// 자동 손절), 아니면 S2를 '차트와 지표(주문 칸은 다음 업데이트에서)' 꼴로 그리고 S12는 뺀다(보이는 기능 = 실제 기능, p34 검토 6)
function tradeOpenFor() {
  return MEMBER_OK && keysCapable(CONFIG, state.member) && (CONFIG.tradeReady === true || !!(state.member && state.member.test));
}
const tourMem = { main: false, api: false }; // 저장이 막힌 브라우저 — 이번 실행 동안만 '봤음'
let tourKind = null; // 'main' | 'api' — 지금 떠 있는 안내
const tour = createTour({ doc: document, win: window, onFinish: onTourFinish });
const tourSeen = (key, mem) => safeGet(key) != null || tourMem[mem];
function markTour(key, mem) {
  if (!safeSet(key, String(Date.now()))) tourMem[mem] = true;
}
// 셸이 가진 최신 분석(데이터 트랙 — app/lib/analysis-feed.js가 채움)이 있으면 S3에 그 분석의 직원 이름
const tourAnalysis = () => (hooks.getAnalysis ? hooks.getAnalysis() : null);
function currentTourSteps() {
  return tourSteps({ config: CONFIG, member: state.member, tradeOpen: tradeOpenFor(), hasEvents: !!document.querySelector('#evt-chip'), analysis: tourAnalysis() });
}
// 사무실 탭을 바로(같은 틱에) 보이고 시작 — 사무실 패널을 비추는 장이 빠지지 않게(hashchange는 다음 작업이라 기다리지 않음)
function startTour(first) {
  if (tour.isRunning()) return false;
  const next = { mode: 'office', screen: null };
  history.replaceState(null, '', routeHash(next));
  show(next);
  tourKind = 'main';
  const ok = tour.start(currentTourSteps(), { first });
  if (!ok) tourKind = null;
  return ok;
}
// 처음 켤 때(s·j는 저장된 인증·키·따라가기를 불러온 뒤): 인앱 브라우저·덮는 화면이면 다음에, 따라가기 켜짐·키 연결 기기는 기록만(검토 5)
// 띄울 때는 첫 받기(최신 분석·거래소 이벤트)를 잠깐(최대 2.5초) 기다린 뒤 다시 판단한다 — S3 직원 이름·'거래소 이벤트' 장이 빠지지 않게(p34 종단 확인)
function maybeAutoTour({ waited = false } = {}) {
  if (tour.isRunning()) return;
  const key = tourKey(CONFIG.edition);
  const d = autoTourDecision({
    seen: tourSeen(key, 'main'),
    escape: install.plan() === 'escape',
    followOn: !!(state.follow && state.follow.on),
    keysLinked: !!(state.keys && state.keys.status && state.keys.status !== 'none'),
    screen: state.screen,
  });
  if (d === 'mark') markTour(key, 'main');
  else if (d === 'show' && !waited) {
    tourDataWait([analysisFeed ? analysisFeed.pending() : null, eventsFeed ? eventsFeed.pending() : null]).then(() => maybeAutoTour({ waited: true }));
  } else if (d === 'show') startTour(true);
}
// 인증 직후 계정 연결 한 장(§6.4) — keysCapable·키 미연결·처음일 때만, 0.9초 뒤 한 번
function maybeApiTour() {
  if (tour.isRunning()) return;
  const key = apiTourKey(CONFIG.edition);
  if (!apiTourDecision({ config: CONFIG, member: state.member, keysStatus: state.keys ? state.keys.status : 'none', seen: tourSeen(key, 'api') })) return;
  tourKind = 'api';
  if (!tour.start([apiStep()], { first: false })) tourKind = null;
}
function onTourFinish({ how, action, first, record }) {
  const kind = tourKind;
  tourKind = null;
  if (kind === 'api') {
    if (record) markTour(apiTourKey(CONFIG.edition), 'api');
    return;
  }
  if (record) markTour(tourKey(CONFIG.edition), 'main');
  // 끝 장 '▶ 체험 시작' → UID 인증 화면(검토 35). 처음 켤 때는 건너뛰어도 동업자처럼 UID 인증 화면으로(s·j 미인증만, 거기서 '체험 모드로 시작')
  if (MEMBER_OK && !state.member && (action === 'verify' || (first && how === 'skip'))) go({ mode: state.mode, screen: 'verify' });
}
// 토스트(동업자 — 화면 가운데) — '인증됐습니다'
let toastTimer = null;
function showToast(text, tone = 'good') {
  const t = $('#toast');
  if (!t) return;
  t.textContent = text;
  t.className = tone === 'bad' ? 'ui-toast bad' : 'ui-toast';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1600);
}
// 실계좌 송출 중계(s·j판만) — 사무실이 준비됐다고(ptf:office-ready: relay·capable·사무실 경로) 알린 뒤에만 보낸다
const relay = MEMBER_OK ? createOfficeRelay({ post: (msg) => (officeShell ? officeShell.post(msg) : false) }) : null;
// 리치 서버 AI 최신 분석 다시 보기(p34 §3, 판의 office.analysis_replay — 수호·준현) — 허브 /v1/analysis/latest(토큰 없음)를 받아
// 사무실(데모·중계 모두)에 ptf:analysis로 넘긴다. 공용판은 받지도 보내지도 않는다
// (받기 결과 알림 onChange는 늘 비동기 — 받기가 끝난 뒤라 아래 officeAnalysis가 이미 있다)
const ANALYSIS_ON = CONFIG.analysisReplay === true;
const analysisFeed = ANALYSIS_ON
  ? createAnalysisFeed({
    load: () => fetchAnalysis(CONFIG.hub),
    onChange: (v) => { if (officeAnalysis) officeAnalysis.changed(v); syncTradeVerdict(); },
  })
  : null;
// 요청 분석(p35 §2.11 B안, 판의 office.analysis_request — 수호·준현) — 사무실이 고른 종목을 허브에 요청하고(분석은 이 PC 스케줄러가 돌림)
// 진행·결과·실패를 사무실에 ptf:analysis-result로 알린다. 공용판은 받지도 보내지도 않는다. 요청자 구분 값은 기기 저장소 kv.reqDev(인증과 다른 값)
const REQUEST_ON = ANALYSIS_ON && CONFIG.analysisRequest === true && CONFIG.edition !== 'pub';
let vaultResolve = () => {};
const vaultReady = new Promise((r) => { vaultResolve = r; });
// 기기 저장소는 bootMember가 연다 — 요청이 먼저 오면 최대 3초 기다리고, 못 열면 이번 실행 동안만(메모리)
const vaultSoon = () => Promise.race([vaultReady, new Promise((r) => setTimeout(() => r(null), 3000))]);
const reqVault = {
  get: async (k) => { const v = await vaultSoon(); return v ? v.get(k) : undefined; },
  set: async (k, x) => { const v = await vaultSoon(); return v ? v.set(k, x) : false; },
};
const requests = REQUEST_ON
  ? createAnalysisRequests({
    config: CONFIG,
    // item의 두 번째 인자 { timeoutMs } — 첫 결과는 사무실 12초 안에 맞춰 줄인다(analysis-request.js REQ_FIRST_MS).
    // turns(p37 실시간 직원 말) — 판의 analysisLive일 때만 모듈이 부른다(running 동안 상태 GET 대신 3초마다)
    hub: {
      request: (b) => postAnalysisRequest(CONFIG.hub, b), status: (t) => fetchAnalysisRequest(CONFIG.hub, t), item: (id, o) => fetchAnalysisItem(CONFIG.hub, id, o),
      turns: (t, after) => fetchAnalysisTurns(CONFIG.hub, t, after),
    },
    vault: reqVault,
    feed: analysisFeed,
    post: (msg) => (officeShell ? officeShell.post(msg) : false),
  })
  : null;
const officeAnalysis = ANALYSIS_ON ? createOfficeAnalysis({ post: (msg) => (officeShell ? officeShell.post(msg) : false), feed: analysisFeed, canRequest: () => !!requests }) : null;
// 첫 실행 안내 S3가 그 분석의 직원 이름을 쓴다(셸이 가진 값만 — 받기를 일으키지 않음)
hooks.getAnalysis = () => (analysisFeed ? analysisFeed.current().analysis : null);
// 상단 띠는 위의 renderStrip 한 벌(외형 트랙 — { update, refresh, eventsSlot }). 이벤트 칩은 그릴 때마다 strip.eventsSlot()으로
// 자리를 찾고(띠가 안을 통째로 새로 그려도 칩이 문서 안에 남게), 칩이 바뀌면 strip.refresh()가 띠를 보이고 숨긴다(p34 §6.8, 통합)
// 거래소 이벤트 칩·창(p34 §5.4, 판의 events — 대표 결정 2026-10-08-3) — 허브 /v1/events(토큰 없음). 운영자 계정 진행 상황은 없다
const eventsView = CONFIG.events === true
  ? createEventsView({ slot: () => strip.eventsSlot(), box: $('#evt-back'), config: CONFIG, onChip: () => strip.refresh() })
  : null;
const eventsFeed = eventsView ? createEventsFeed({ load: () => fetchEvents(CONFIG.hub), onChange: (r) => eventsView.update(r) }) : null;
// 사무실 탭 — 인증 회원이면 &relay=1 주소로 새로 만든다(§4.5). 새로 만들 때 옛 창의 준비 상태·중계를 끊는다.
// iframe load마다(처음·사무실 안 이동·새로 고침) 셸이 준비를 풀고 ptf:office-ping — 사무실이 office-ready로 답하면 다시 연다(p34 §3.2)
const office = createOffice({
  panel: $('#panel-office'),
  config: CONFIG,
  onReplace: () => {
    if (officeShell) officeShell.reset();
  },
  onLoad: (f) => {
    if (officeShell && f === office.frame()) officeShell.frameLoaded();
  },
});
// 새 매매 알림을 다른 탭·덮는 화면에서 받으면 트레이딩 버튼에 점(배너는 트레이딩 패널 안이라 그 화면들을 가리지 않는다) — 트레이딩 탭을 보면 지운다
function markAutoAlert(on) {
  const b = document.querySelector('.mode-btn[data-mode="trade"]');
  if (!b) return;
  b.classList.toggle('has-alert', on);
  if (on) b.setAttribute('aria-label', '트레이딩 · 새 매매 알림');
  else b.removeAttribute('aria-label');
}
// 운영 측 자동매매 송출 — 앱이 화면에 보이는 동안 받는다(어느 탭이든 — 따라가기·사무실 중계·차트 위 포지션). 그리기는 트레이딩 탭이 화면을 만든 뒤
// 두 자리(⚡ 오토 모드 카드 · 열린 포지션 목록 — boot의 onOrderSlot → auto.mount). 새 매매 알림은 트레이딩 패널 맨 앞(#auto-alert), 다른 곳이면 버튼 점
const auto = createAutoMode({
  alert: { box: $('#auto-alert'), text: $('#auto-alert-text'), close: $('#auto-alert-close') },
  config: CONFIG,
  // s·j판은 저장된 인증을 불러오는 동안 가입하기·'UID 인증하기'를 그리지 않는다(인증된 기기를 켤 때 잠깐 비치지 않게 — 검토 2026-10-10).
  // 인증 알림(onMemberChange → setMember)·bootMember 끝·MEMBER_BOOT_MS 타이머 중 먼저 오는 쪽에서 풀림
  memberPending: MEMBER_OK,
  // 회원 연결이 401(해제·만료)을 받으면 — 인증 상태가 그 토큰이 지금 것인지 보고 해제한다
  onRevoked: (body, token) => {
    if (control) control.revoked(body, token);
  },
  // 회원 송출 스냅샷·이벤트 → 사무실 중계(공개 송출이면 null — 중계할 것 없음)와 따라가기 엔진(실시간 'stream'만 주문, 재생은 놓친 신호),
  // 트레이딩 탭 차트 위 운영 측 포지션 선·마커(p40 — 같은 스냅샷, 새 요청 없음, 공용판·미인증은 null이라 그리지 않음)
  onFeed: (snap) => {
    state.memberSnap = snap;
    if (relay) relay.update(snap);
    if (follow) follow.onFeed(snap);
    if (tradeMode) tradeMode.setAutoFeed(snap);
  },
  onLiveEvent: (ev) => {
    if (relay) relay.event(ev);
    if (follow) follow.onEvent(ev);
  },
  onNotify: () => {
    if (state.mode !== 'trade' || state.screen) markAutoAlert(true);
  },
});
const verifyView = MEMBER_OK
  ? renderVerify($('#verify-body'), { config: CONFIG, onSubmit: (raw) => { if (control) control.submit(raw); }, onGuest: () => go({ mode: state.mode, screen: null }) })
  : null;
if (verifyView) verifyView.update({ member: null, verify: state.verify });
// 거래소 연결 화면 — 자격(keysCapable)은 show()가 본다. 비밀 키는 화면이 누르는 즉시 비우고 keys.connect로만 넘긴다
const keysView = MEMBER_OK
  ? renderKeys($('#keys-body'), {
    config: CONFIG,
    onConnect: (input) => { if (keys) keys.connect(input); },
    onDisconnect: () => { if (keys) keys.disconnect({ confirm: (text) => window.confirm(text) }); },
  })
  : null;
// 따라가기 화면·시트·띠 — s·j판만. 누르는 것은 모두 엔진으로(엔진이 그 순간 조건을 다시 본다)
const followView = MEMBER_OK
  ? renderFollow($('#follow-body'), {
    wake: wakeSupport(navigator, navigator.userAgent, window.matchMedia && window.matchMedia('(display-mode: standalone)').matches),
    kakao: CONFIG.kakao, // K-11(배율 권한 없음) 바로 아래 카카오 문의 링크(p35 L-1)
    onEnable: (input) => (follow ? follow.enable(input) : null), // 결과(켜지 못한 이유)는 화면이 그 칸에 보인다
    onDisable: () => { if (follow) follow.disable(); },
    onMoveHere: () => { if (follow) follow.moveHere(); },
    onCleanup: () => { if (follow) follow.cleanupAll(); },
    onUpdate: () => checkUpdate(),
    onSaveConsents: () => { if (state.follow) downloadText(consentFile(state.follow.consents)); },
    onWake: (on) => { if (follow) follow.saveSettings({ wakeLock: on }); },
    // p34 자동 손절 스위치(트레이딩 탭과 같은 값 — 엔진이 확인 시트·잠김·맞추는 중을 돌려줌)·다시 걸기·확인했습니다
    onAutoSl: (on, o) => (follow ? follow.setAutoSl(on, o) : null),
    onAutoSlRetry: (id) => { if (follow) follow.retryAutoSl(id); },
    onAutoSlClear: (inst) => { if (follow) follow.clearAutoSlCheck(inst); },
  })
  : null;
const sheetView = MEMBER_OK
  ? renderSheet($('#follow-sheet'), { onGo: (k) => { if (follow) follow.confirmSheet(k); }, onSkip: (k) => { if (follow) follow.skipSheet(k); } })
  : null;

function show(route) {
  state.mode = route.mode || state.mode;
  // 공용판은 #verify로 와도 인증 화면을 열지 않고, 키 화면은 자격(인증 회원 + autoReady 또는 시험 토큰)이 있을 때만(§5.1)
  const prev = state.screen;
  const blocked = (route.screen === 'verify' && !MEMBER_OK) || (route.screen === 'keys' && !keysCapable(CONFIG, state.member))
    || (route.screen === 'follow' && !followScreenOk());
  state.screen = blocked ? null : route.screen || null;
  safeSet(LAST_MODE_KEY, state.mode);
  for (const b of document.querySelectorAll('.mode-btn')) {
    const on = b.dataset.mode === state.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== state.mode;
  // 트레이딩 탭: 보이면 봉(허브)·실시간 시세를 받고, 다른 탭이면 멈춘다(p2 spec §2.1 — 패널을 보인 뒤라 차트 크기가 잡힌다)
  if (tradeMode) { if (state.mode === 'trade' && document.visibilityState !== 'hidden') tradeMode.show(); else tradeMode.hide(); }
  if (state.mode === 'office') {
    if (state.memberBooted) office.mount();
    else office.wait(); // s·j판이 인증을 불러오는 동안 한 줄(최대 MEMBER_BOOT_MS)
  }
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.dataset.screen !== state.screen;
  // 최신 분석 60초 주기는 사무실 탭이 보일 때만(덮는 화면이 없을 때, p34 §3.1 ①)
  if (analysisFeed) analysisFeed.setOfficeTab(state.mode === 'office' && !state.screen);
  // 트레이딩 탭 판정 상자도 같은 받기 하나(p40 T12 — 트레이딩 탭이 보이는 동안 같은 주기, 오래됐으면 보일 때 한 번). 보일 때 'N분 전'을 다시
  if (analysisFeed) analysisFeed.setTradeTab(state.mode === 'trade' && !state.screen);
  if (state.mode === 'trade' && !state.screen) syncTradeVerdict();
  // 주문 칸 정리 주기 — 트레이딩 탭이 보이면 5초(보일 때 한 번 먼저), 다른 탭·덮는 화면이면 멈춤(앱 30초 가벼운 주기는 그대로)
  syncTradeTimers();
  if (state.mode === 'trade' && !state.screen) markAutoAlert(false); // 트레이딩 탭을 보면 점을 지운다(배너·흐름에 그 매매가 있다)
  if (state.screen === 'settings') openSettings();
  if (state.screen === 'install' && hooks.openInstall) hooks.openInstall();
  if (state.screen === 'verify' && verifyView) verifyView.update({ member: state.member, verify: state.verify });
  if (state.screen === 'keys' && keysView) keysView.update({ keys: state.keys, member: state.member });
  if (state.screen === 'follow' && followView && state.follow) followView.update(state.follow, { keysReady: followKeysReady(), balance: followBalance() });
  // #keys를 떠나면 실패한 연결의 바로 다시 시도용 거래소 WS를 닫는다(키 없이 5초마다 ping하지 않게)
  if (prev === 'keys' && state.screen !== 'keys' && keys) keys.leaveScreen();
  // #verify를 떠나면(뒤로 가기·체험 모드·인증 뒤 이동) 인증 화면이 연 앱 받기 창도 닫는다 — 다음 화면 위에 남지 않게(2026-10-09)
  if (prev === 'verify' && state.screen !== 'verify' && verifyView) verifyView.closeAppGuide();
}

// 주소 해시가 바뀌면(뒤로 가기·홈 화면 바로가기·안내·가이드 링크) — 옛 #auto(트레이딩으로 합침, 2026-10-10)는 트레이딩 탭을 열고 주소도 #trade로 바꿔 쓴다
function onHash() {
  const r = parseRoute(location.hash);
  const h = routeHash({ mode: r.mode || state.mode, screen: r.screen });
  if (r.mode && location.hash !== h) history.replaceState(null, '', h);
  show(r);
}

// 주소 해시를 바꾸면 hashchange가 show를 부른다(뒤로 가기·홈 화면 바로가기와 같은 길)
function go(route) {
  const next = { mode: route.mode || state.mode, screen: route.screen || null };
  const h = routeHash(next);
  if (location.hash === h) show(next);
  else location.hash = h;
}

function renderSettingsNow() {
  renderSettings($('#settings-body'), {
    config: CONFIG,
    health: state.health,
    updateNote: state.updateNote,
    trial: state.trial,
    member: state.member,
    keys: state.keys,
    follow: follow && followCapable(CONFIG, state.member) ? state.follow : null,
    onUpdate: checkUpdate,
    onLogout: logout,
    onTour: () => startTour(false), // '튜토리얼 다시 보기' — 인증 상태에 맞는 마지막 장
  });
}

async function openSettings() {
  state.health = { state: 'pending' };
  renderSettingsNow();
  state.health = await fetchHealth(CONFIG.hub);
  if (state.screen === 'settings') renderSettingsNow();
}

async function checkUpdate() {
  if (!hooks.checkUpdate) {
    location.reload();
    return;
  }
  state.updateNote = '확인 중…';
  renderSettingsNow();
  let found = false;
  try {
    found = await hooks.checkUpdate();
  } catch {
    found = false;
  }
  state.updateNote = found ? '새 버전 있음' : '최신 버전';
  renderSettingsNow();
}

// 이 기기 인증 해제(V-19) — 확인 창(열린 따라가기 매매가 있으면 V-19b까지)
function logout() {
  if (control) control.logout({ confirm: (text) => window.confirm(text) });
}

// 인증 상태가 바뀌면: 사무실(중계↔데모)을 먼저 바꾸고, 송출 연결(공개↔회원 — 트레이딩 탭 오토 모드)·인증 화면·설정 줄을 맞춘다
function onMemberChange({ member, notice, verify }) {
  // 이 화면에서 방금 인증에 성공함(저장된 인증 불러오기·다른 탭 알림이 아님) — 토스트 + 0.9초 뒤 계정 연결 한 장(§6.1·§6.4)
  const fresh = !state.member && !!member && !!(verify && verify.message && verify.message.ok);
  state.member = member;
  state.verify = verify;
  if (fresh) {
    showToast('인증됐습니다');
    setTimeout(maybeApiTour, 900);
  }
  office.setRelay(!!member); // 인증 → 중계 사무실, 해제(401·로그아웃) → 데모 사무실(§4.5) — 옛 사무실에 중간 상태를 보내지 않게 먼저
  auto.setMember(member, { note: notice });
  if (verifyView) verifyView.update({ member, verify });
  if (state.screen === 'settings') renderSettingsNow();
  if (keys) keys.sync(); // 인증 회원(시험 토큰 또는 autoReady)이면 저장된 키로 다시 로그인, 해제·로그아웃이면 멈춤(저장된 키는 그대로)
  if (follow) follow.setMember(member); // 해제·로그아웃이면 임대를 놓고 새 주문 없음(장부는 남김 — 정리만은 F-20)
  syncKeysScreen();
  syncFollowScreen();
  syncStrip();
  syncTradeVerdict();
  syncOrderPanel();
  syncTradeFollow();
}

// #follow를 열 수 있나: 자격(키 화면과 같음) 또는 인증이 풀렸는데 따라가기로 연 포지션이 남음(F-20 '내 포지션 정리' — §3.4 정리만)
function followScreenOk() {
  if (followCapable(CONFIG, state.member)) return true;
  return MEMBER_OK && !state.member && !!state.follow && state.follow.trades.some((t) => ['open', 'opening', 'closing'].includes(t.state));
}

// #follow 주소인데 열 수 있게 되면 열고, 없어지면 닫는다
function syncFollowScreen() {
  const want = parseRoute(location.hash).screen === 'follow';
  const can = followScreenOk();
  if (want && can && state.screen !== 'follow') show(parseRoute(location.hash));
  else if (state.screen === 'follow' && !can) go({ mode: state.mode, screen: null });
}

// 정리만(§3.4) 동안 키 연결 상태는 'cleanup'이지만 거래소 로그인은 살아 있다 — 엔진의 G5(위험을 줄이는 호출)는 그것으로 본다
function followKeysReady() {
  if (!keys) return false;
  return keys.ready() || (keys.state().status === 'cleanup' && keys.client().ready());
}

// 따라가기 엔진 상태가 바뀌면: 따라가기 화면·시트·띠·설정 줄·트레이딩 탭(⚡ 오토 모드 줄·놓친 신호·내 따라가기 설정)·화면 켜 두기
function onFollowChange(st) {
  state.follow = st;
  // 안내가 떠 있는 동안 '한 번 눌러 주문' 시트가 뜨면 안내를 바로 닫는다(기록 없이 — 다음에 다시, 검토 5)
  if (st && st.sheets && st.sheets.length && tour.isRunning()) tour.close({ record: false });
  if (followView && state.screen === 'follow') followView.update(st, { keysReady: followKeysReady(), balance: followBalance() });
  if (sheetView) sheetView.update(st.sheets, Date.now(), { autoSlOn: !!(st.autoSl && st.autoSl.on) });
  renderBand($('#follow-band'), st, document.documentElement);
  // 트레이딩 탭 송출 화면: 정리 길·놓친 신호·이 기기 내 따라가기 줄(상태 낱말·평가·결과 — 가격 없음)·끝난 매매 합계(회원 본인 돈)·
  // 내 따라가기 설정(2026-10-10 — 옛 고지 박스 자리, 엔진 상태를 읽기만: kv.follow·kv.autoSl·config.followRules. 따라갈 수 있는 기기만)
  auto.setFollow({ link: followScreenOk(), missed: st.missed, mine: st.mine, total: st.pnl && st.pnl.done && st.pnl.done.n > 0 ? st.pnl.done.sum : null,
    settings: followCapable(CONFIG, state.member) ? mySettingsView(st) : null });
  if (state.screen === 'settings') renderSettingsNow();
  syncWakeLock(st);
  syncFollowScreen();
  syncTradeFollow();
}

// 트레이딩 탭 ⚡ 오토 모드 켜기·끄기 줄(CEO 2026-10-10) — 엔진 상태·자격(#follow와 같음)·키가 바뀔 때마다 다시 그린다(자격 없으면 빈칸)
function syncTradeFollow() {
  if (tradeFollow) tradeFollow.update(followQuick(state.follow, { capable: followCapable(CONFIG, state.member), keysReady: followKeysReady() }));
}

// 트레이딩 탭 판정 상자(p40 T12) — 최신 분석 받기·인증·종목·탭 보임이 바뀔 때 다시 그린다(공용판·만들기 전이면 아무것도 안 함).
// pending: 저장된 인증을 불러오는 동안은 미인증 글(N-11)을 잠깐 보이지 않는다
function syncTradeVerdict() {
  if (!tradeVerdict || !tradeMode) return;
  tradeVerdict.update({ ed: CONFIG.edition, member: state.member, pending: !!(state.verify && state.verify.pending), latest: analysisFeed ? analysisFeed.current() : null, symbol: tradeMode.symbol(), now: Date.now() });
}

// 켜기·끄기 버튼 하나 — 따라가기 화면과 같은 엔진 길만 탄다. 끄기 = 그 화면 onDisable과 같은 follow.disable().
// 켜기 = 저장된 설정이 다 갖춰졌을 때(방식·최대 증거금·같은 설정의 동의 기록·규칙/동의 판·기기 저장소·키 — followQuick) 그 화면과 같은
// follow.enable(동의는 새로 기록하지 않음 — consentShown 'none'), 아니면 #follow를 열어 막힌 이유 줄을 보인다. 켜지 못해도(need·K-11) #follow
async function tradeFollowToggle() {
  if (!follow || !state.follow) return;
  const st = state.follow;
  if (st.on) { follow.disable(); return; }
  if (!followQuick(st, { capable: followCapable(CONFIG, state.member), keysReady: followKeysReady() }).quick) { go({ mode: state.mode, screen: 'follow' }); return; }
  const r = await follow.enable({ settings: st.settings, consentShown: 'none', lev: st.lev });
  if (!r || r.ok !== true) go({ mode: state.mode, screen: 'follow' });
}

// ── 트레이딩 탭 주문 칸(2e 수동 주문 — p40 T13) ──
// 자동 손절 버튼 — 따라가기 화면과 같은 스위치 하나(엔진 setAutoSl: 확인 시트·정리 유예 잠김·맞추는 중), 바뀌었으면 수동 매매에도 바로 적용
const toggleAutoSl = async (on, opts) => {
  if (!follow) return null;
  const r = await follow.setAutoSl(on, opts);
  if (r && r.ok && manualExec) await manualExec.applySwitch();
  return r;
};
// 주문 칸은 boot(트레이딩 탭을 처음 열 때)에, 실행기·기록은 bootMember에서 — 그 사이·공용판에는 주문 칸 상태(tradeCtx)가 이 길에 닿지 않고,
// 닿아도 주문 없이 down(기록 쓰기는 거절)
const NO_MANUAL = Object.freeze({ ok: false, reason: 'down' });
const manualProxy = {
  quote: (a) => (manualExec ? manualExec.quote(a) : NO_MANUAL),
  openFirst: (a) => (manualExec ? manualExec.openFirst(a) : NO_MANUAL),
  nextAddCoid: (s) => (manualExec ? manualExec.nextAddCoid(s) : null),
  add: (a) => (manualExec ? manualExec.add(a) : NO_MANUAL),
  changeTp: (a) => (manualExec ? manualExec.changeTp(a) : NO_MANUAL),
  close: (a) => (manualExec ? manualExec.close(a) : NO_MANUAL),
  retry: (a) => (manualExec ? manualExec.retry(a) : NO_MANUAL),
  clearCheck: (a) => (manualExec ? manualExec.clearCheck(a) : NO_MANUAL),
};
const manualStoreProxy = {
  get: async () => (manualStore ? manualStore.get() : { v: 2, open: {}, ended: [], log: [] }),
  update: async (fn) => {
    if (!manualStore) throw new Error('nostore');
    return manualStore.update(fn);
  },
};
// 처음 쓸 때 동의(M-26)의 내용 해시 — 글 그대로 sha256(16진)
async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// 인증·키가 바뀌면 주문 칸을 바로 다시(그 밖은 5초 주기) — 트레이딩 탭이 보일 때만
function syncOrderPanel() {
  if (orderPanel && state.mode === 'trade' && !state.screen && document.visibilityState !== 'hidden') orderPanel.render();
}
// 따라가기 장부에서 이 종목 포지션을 따라가기가 연 것으로 보는 상태(M-20 첫 줄 — 정리만)
const FOLLOW_HELD = Object.freeze(['open', 'opening', 'unclear', 'closing', 'detached']);
const PANEL_LIVE = Object.freeze(['grace', 'blocked', 'symbol_off', 'ready']);
// 주문 칸 판단 재료(계획 6787-6811 맞춤): 상태(tradePanelState)를 먼저 보고, 주문 칸이 동작하는 상태(+ 이 기기 기록이 없는 정리 유예)에서만 이 기기 기록·
// 거래소를 읽는다 — 포지션은 수동 실행기의 positions·positionOf(같은 5초 캐시 한 번, 따라가기와 같이 세는 호출), 미체결은 포지션이 있고 조건 익절 모드일 때만.
// 잔고(get_assets_info)는 읽지 않는다(상단 띠가 보임 — CEO 2026-10-10). 청산가는 담지 않는다(카드에 청산가 줄 없음 — 보안 규칙 18)
async function tradeCtx() {
  const symbol = tradeMode ? tradeMode.symbol() : 'BTC';
  const inst = `${symbol}-USDT-PERPETUAL`;
  const fr = rulesOf(CONFIG);
  const afterStage = fr && fr.follow && fr.follow.autoSl ? fr.follow.autoSl.afterStage : 4;
  const ks = keys ? keys.state() : KEYS_IDLE;
  const ctx = {
    ed: CONFIG.edition,
    member: state.member,
    pending: MEMBER_OK && (vaultKind === null || !!(state.verify && state.verify.pending)), // 저장된 인증·기기 저장소를 불러오는 중 — 칸을 그리지 않음
    grace: !state.member && ks.status === 'cleanup',
    graceOpen: false,
    keysCapable: keysCapable(CONFIG, state.member),
    tradeReady: CONFIG.tradeReady === true,
    durable: vaultKind === 'idb',
    rulesOk: !!(CONFIG.tradeRules && fr && manualExec),
    keyStatus: keys && keys.ready() ? 'ready' : ks.status === 'ok' ? 'checking' : ks.status,
    keyPending: !!ks.pending,
    manual: memberManualOf(state.memberSnap),
    symbol,
    inst,
    cond: condFor(CONFIG, state.member),
    hubDown: !!(state.memberSnap && state.memberSnap.hubDown),
    transport: ks.transport || null,
    rec: null, pos: null, foreignPos: null, ended: [], log: [],
    autoSl: { on: true, turningOff: false, afterStage },
    checkNeeded: false,
    diag: null,
  };
  if (!MEMBER_OK || ctx.pending || !manualExec || !manualStore || !autoSw) return ctx;
  const rec = await manualStore.get();
  ctx.rec = rec.open[inst] || null;
  ctx.ended = rec.ended;
  ctx.log = rec.log;
  const trades = state.follow && Array.isArray(state.follow.trades) ? state.follow.trades : [];
  ctx.graceOpen = Object.keys(rec.open).length > 0 || trades.some((t) => t.state === 'open' || t.state === 'opening');
  const st0 = tradePanelState(ctx);
  if (!followKeysReady() || !(PANEL_LIVE.includes(st0) || (st0 === 'verify' && ctx.grace))) {
    if (tradeMode) tradeMode.setMine([]);
    return ctx;
  }
  const all = await manualExec.exec.positions();
  if (all.ok) {
    if (tradeMode) tradeMode.setMine(all.list.map((p) => ({ symbol: p.inst.split('-')[0], side: p.size < 0 ? 'short' : 'long' })));
    if (all.list.length) ctx.graceOpen = true; // 키 로그인 뒤 거래소 포지션이 있음 — 정리 유예 카드(spec §2.2 grace)
  }
  const p = await manualExec.exec.positionOf(inst);
  const pos = p.ok && p.pos ? { size: p.pos.size, avg: p.pos.avg, tp: p.pos.tp, upl: p.pos.upl } : null;
  const oo = pos && ctx.cond ? await manualExec.exec.openOrders(inst) : null;
  ctx.pos = positionView({ pos, orders: oo && oo.ok ? oo.list : [], mid: ctx.rec ? ctx.rec.mid : '', cond: ctx.cond });
  if (ctx.pos && (!ctx.rec || ctx.rec.state === 'detached')) ctx.foreignPos = !ctx.rec && trades.some((t) => t.inst === inst && FOLLOW_HELD.includes(t.state)) ? 'follow' : 'outside';
  const ms = manualExec.state();
  ctx.checkNeeded = ms.checkNeeded.includes(inst);
  ctx.diag = state.member && state.member.test === true && ms.diag ? AUTO_SL_TEXT.diag(ms.diag) : null; // 시험 토큰 진단(가격 없음)
  const sw = await autoSw.read();
  ctx.autoSl = { on: sw.on, turningOff: await manualExec.turningOff(), afterStage };
  return ctx;
}
// 정리 주기(spec §5.5·p35 §5.3): 트레이딩 탭이 보이는 동안 5초마다 upkeep(전체 — 다시 열 때 한 번 먼저) + 주문 칸, 앱이 보이는 동안 30초마다
// 수동 기록이 열려 있으면 upkeep({ light: true })(다른 탭에 있어도 — AUTO_SL_TEXT.failed의 30초 보조 감시). 숨으면 모두 멈춤(stopTradeTimers).
// 공용판은 주기 없이 보일 때 한 번(T-13 안내 한 줄)
function syncTradeTimers() {
  const vis = document.visibilityState !== 'hidden';
  const tradeOn = vis && state.mode === 'trade' && !state.screen && !!orderPanel;
  if (tradeOn && !MEMBER_OK) orderPanel.render();
  else if (tradeOn && !tradeTimer) {
    tradeTimer = setInterval(tradeTick, TRADE_TICK_MS);
    orderPanel.render();
    tradeTick();
  } else if (!tradeOn && tradeTimer) {
    clearInterval(tradeTimer);
    tradeTimer = null;
  }
  const lightOn = vis && !!manualExec;
  if (lightOn && !lightTimer) lightTimer = setInterval(lightTick, MANUAL_LIGHT_MS);
  else if (!lightOn && lightTimer) {
    clearInterval(lightTimer);
    lightTimer = null;
  }
}
function stopTradeTimers() {
  if (tradeTimer) clearInterval(tradeTimer);
  if (lightTimer) clearInterval(lightTimer);
  tradeTimer = null;
  lightTimer = null;
}
// 5초 한 회차: 정리 주기(실행기가 겹친 호출은 진행 중인 것을 돌려줌) 뒤 주문 칸. 앞 회차가 아직이면 주문 칸만
async function tradeTick() {
  if (!orderPanel) return;
  if (tradeTicking) {
    orderPanel.tick();
    return;
  }
  tradeTicking = true;
  try {
    if (manualExec && followKeysReady()) await manualExec.upkeep();
  } catch {
    // 다음 주기
  } finally {
    tradeTicking = false;
  }
  orderPanel.tick();
}
// 30초 가벼운 회차 — 트레이딩 탭 5초 주기가 돌지 않을 때, 열린 수동 기록(또는 자동 손절 정리 미완)이 있을 때만
async function lightTick() {
  if (!manualExec || !manualStore || tradeTimer || !followKeysReady()) return;
  const r = await manualStore.get();
  if (Object.keys(r.open).length || r.ended.some((e) => e && (e.autoSl || e.tpLeft === true))) manualExec.upkeep({ light: true });
}

// 화면 켜 두기(F-13): ② 켜짐 띠가 보이는 동안 + 회원이 켰을 때만. 앱이 숨으면 브라우저가 풀고, 돌아오면 다시 청한다
async function syncWakeLock(st) {
  const want = !!(st && st.band && st.settings && st.settings.wakeLock === true && document.visibilityState === 'visible');
  if (!want) {
    if (wakeSentinel) {
      try {
        await wakeSentinel.release();
      } catch {
        // 이미 풀림
      }
      wakeSentinel = null;
    }
    return;
  }
  if (wakeSentinel && !wakeSentinel.released) return;
  try {
    wakeSentinel = await navigator.wakeLock.request('screen');
  } catch {
    wakeSentinel = null; // 지원 안 함·거절 — 화면은 F-13 줄을 이미 숨기거나 F-21
  }
}

// 동의 기록 파일 내려받기(F-18 '파일로 저장') — 기기에 있는 기록을 회원이 스스로 보관
function downloadText({ name, text }) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// #keys 주소인데 자격이 생기면(저장된 인증을 늦게 불러옴) 열고, 자격이 없어지면(해제·로그아웃) 닫는다
function syncKeysScreen() {
  const want = parseRoute(location.hash).screen === 'keys';
  const can = keysCapable(CONFIG, state.member);
  if (want && can && state.screen !== 'keys') show(parseRoute(location.hash));
  else if (state.screen === 'keys' && !can) go({ mode: state.mode, screen: null });
}

// 키 연결 상태가 바뀌면 키 화면·설정 줄을 맞춘다
function onKeysChange(s) {
  state.keys = s;
  if (keysView) keysView.update({ keys: s, member: state.member });
  if (state.screen === 'settings') renderSettingsNow();
  if (follow) follow.keysChanged(); // 키가 정상이면 켜 둔 따라가기를 다시, 끊김·bad면 상태 줄(F-08)
  if (balance) balance.sync(); // 두 경로 모두 보일 때 30초마다(경로가 바뀌면 값을 버리고 다시 읽음)
  syncStrip();
  syncFollowBalance();
  // 키가 준비되면 주문 시세 구독(따라가기가 꺼져 있어도 price()가 들어오게 — spec §2.1)·주문 칸 바로 다시
  if (onTradeSymbol && tradeMode && state.mode === 'trade' && keys && keys.ready()) onTradeSymbol(tradeMode.symbol());
  syncOrderPanel();
  syncTradeFollow();
}

// s·j판 사무실 풀기 — 저장된 인증을 불러온 뒤(bootMember) 또는 MEMBER_BOOT_MS 타이머 중 먼저 오는 쪽. 늦게 온 쪽은 중계 여부만 맞춘다
// (setRelay는 같은 값이면 아무것도 안 함 — 데모를 띄운 뒤 인증이 늦게 확인되면 그때 중계 주소로 새로 만든다)
function releaseOffice() {
  office.setRelay(!!state.member);
  if (state.memberBooted) return;
  state.memberBooted = true;
  if (state.mode === 'office') office.mount();
}

// 기기 저장소를 열고(막혀 있으면 이번 실행 동안만 메모리) 저장된 인증을 불러온다 — 실패해도 앱은 공개 송출로 계속.
// control은 반드시 만든다(저장소가 이상해도 메모리로) — 그래야 잠가 둔 '인증하기'를 풀 수 있다
async function bootMember() {
  if (!MEMBER_OK) return;
  try {
    let vault;
    try {
      vault = await openVaultOrMemory({ edition: CONFIG.edition });
    } catch {
      vault = memoryVault();
    }
    vaultKind = vault.kind; // 주문 칸 — 메모리 저장소면 실주문 없음(nostore, spec §5.7)
    vaultResolve(vault); // 요청 분석의 kv.reqDev도 같은 저장소
    if (requests) requests.devId(); // 미리 한 번 — 첫 ▶ ANALYZE가 저장소를 기다리지 않게(사무실 첫 결과 12초 안)
    const session = createMemberSession({ vault, edition: CONFIG.edition });
    // 같은 판 탭 여러 개: 토큰 갱신은 탭 잠금 안에서, 갱신하면 다른 탭에 알림(토큰 없이 — 받은 탭은 기기 저장소에서 다시 읽음)
    let channel = null;
    try {
      channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(memberChannelName(CONFIG.edition)) : null;
    } catch {
      channel = null;
    }
    control = createMemberControl({ config: CONFIG, session, locks: (navigator && navigator.locks) || null, channel, onChange: onMemberChange });
    try {
      await control.init();
    } catch {
      // 인증을 못 불러와도 공개 송출은 그대로
    }
    const st = control.state();
    state.member = st.member;
    state.verify = st.verify;
    if (verifyView) verifyView.update(st);
    syncStrip();
    syncTradeVerdict(); // 저장된 인증을 불러온 뒤(트레이딩 탭이 먼저 열려 있었으면 미인증 글 대신 판정)
    // 거래소 키(설계 3-2 §5) — 기기 저장소를 연 뒤에. 접속 토큰·키는 메모리·IndexedDB에만, 회원 토큰은 중계(/v1/ox) 머리글로만.
    // 회원 토큰을 잃었으면(로그아웃·401) 정리 유예 토큰(kv.memberGrace, 7일)으로 정리만(§3.4 — 위험을 줄이는 호출만, 허브도 그것만 받는다)
    const oxClient = createOxClient({
      config: CONFIG,
      getToken: () => (state.member ? state.member.token : keys ? keys.graceToken() : null),
      getLease: () => (lease ? lease.id() : null), // 따라가기 임대 id — 중계 X-Ptf-Lease·WS 직접 follow/check(§5.5·§6.16)
      onState: (s) => { if (keys) keys.onClientState(s); },
      onUnauthorized: (body, token) => { if (control) control.revoked(body, token); if (keys) keys.graceLost(token); },
    });
    keys = createKeyControl({ config: CONFIG, vault, getMember: () => state.member, client: oxClient, getGrace: () => session.grace(), onChange: onKeysChange });
    // 잔고는 따라가기 중에도 30초마다(대표 결정 2026-10-09 — 앱이 켜져 있어야 주문이 나가므로 그 화면에서 잔고가 보여야 함).
    // 실행기가 거래소를 부르는 중이거나 마지막 호출 뒤 3초 안이면 그 주기는 건너뛴다(허브가 429에 토큰을 60초 묶으면 따라가기 주문이 막힘 — p35 L-5)
    balance = createStripBalance({ keys, busy: followBusy, onChange: () => { syncStrip(); syncFollowBalance(); } });
    balance.setVisible(document.visibilityState !== 'hidden');
    keys.sync();
    syncKeysScreen();
    // 따라가기 실행기가 쓰는 거래소 호출 — 부르는 동안을 세어 띠 잔고가 그 주기를 건너뛰게(호출 자체는 그대로 ox-client로)
    const followClient = {
      ...oxClient,
      call: (m, p, o) => {
        followCalls += 1;
        return Promise.resolve(oxClient.call(m, p, o)).finally(() => { followCalls -= 1; followLastAt = Date.now(); });
      },
    };
    // 따라가기(§6) — 규칙은 빌드가 config에 찍은 것(rulesOf — 없으면 화면이 '규칙을 불러오지 못해 켤 수 없음'). 회원은 자격(followCapable)이 있을 때만 엔진에 보인다
    lease = createLeaseClient({
      config: CONFIG,
      getToken: () => (state.member ? state.member.token : null),
      onUnauthorized: (body, token) => { if (control) control.revoked(body, token); },
      onChange: () => { if (follow) follow.leaseChanged(); }, // 보유·거절·확인 중이 바뀌면 상태 줄을 바로(p40)
    });
    symbolQueue = createSymbolQueue({ edition: CONFIG.edition });
    follow = createFollowEngine({
      config: CONFIG,
      rules: rulesOf(CONFIG),
      store: createFollowStore(vault),
      getClient: () => (keys ? followClient : null),
      keys: { ready: followKeysReady, status: () => (keys ? keys.state().status : 'none') },
      lease,
      getMember: () => (followCapable(CONFIG, state.member) ? state.member : null),
      loadInstruments: () => fetchInstruments(CONFIG.hub),
      makeUpkeep: createUpkeep,
      vibrate: (ms) => { if (navigator.vibrate) navigator.vibrate(ms); },
      onChange: onFollowChange,
      queue: symbolQueue,
    });
    // 2단계 수동 주문(p2 spec 4판 §5 — p40 T13): 오래가는 저장소(idb)·트레이딩 규칙·따라가기 규칙(자동 손절 값 — 4차·청산가 앞 간격)이 있을 때만.
    // 자동 손절 스위치(kv.autoSl)·주문 목록(kv.autoSlOrders)은 따라가기와 같은 kv·채널(p34 §8), 종목 큐도 같은 것(symbolQueue). 거래소 호출은
    // 따라가기 실행기와 같은 셈(followClient.call — 띠 잔고가 그 주기를 건너뜀). 주문은 주문 칸에서 회원이 누를 때만(실행기는 스스로 주문하지 않음)
    if (vault.kind === 'idb' && CONFIG.tradeRules && rulesOf(CONFIG)) {
      const manualClient = { ...oxClient, call: followClient.call };
      autoSw = createAutoSlSwitch({ vault, rules: rulesOf(CONFIG), edition: CONFIG.edition });
      manualStore = createManualStore(vault);
      manualExec = createManualExec({
        call: (m, p, o) => manualClient.call(m, p, o),
        queue: symbolQueue,
        store: manualStore,
        rules: CONFIG.tradeRules,
        followRules: rulesOf(CONFIG),
        cond: () => condFor(CONFIG, state.member),
        instruments: instrumentsFor(fetchInstruments, CONFIG.hub),
        price: (i) => (keys && keys.ready() ? keys.client().price(i) : null),
        markPrice: (i) => (keys && keys.ready() ? keys.client().markPrice(i) : null),
        member: () => (state.member ? { ...state.member, manual: memberManualOf(state.memberSnap) } : null),
        isTest: () => !!(state.member && state.member.test),
        reduceOk: () => !!keys && (keys.ready() || keys.state().status === 'cleanup'),
        sw: autoSw,
        orders: createAutoSlOrders(vault),
      });
      // 주문 시세 구독 — 따라가기가 꺼져 있어도 종목을 고르면(트레이딩 탭이 보일 때·종목 바꿈·키 준비) 그 종목 시세가 들어오게(spec §2.1)
      onTradeSymbol = watchFor(keys);
      if (tradeMode && state.mode === 'trade') onTradeSymbol(tradeMode.symbol());
    }
    await follow.init();
    follow.setVisible(document.visibilityState !== 'hidden');
    syncFollowScreen();
  } finally {
    vaultResolve(null); // 저장소를 못 열었으면 요청 분석은 이번 실행 동안만(이미 열었으면 아무 일 없음)
    auto.memberLoaded(); // 인증 알림이 없었어도(저장소 오류) 오토 모드 카드 기다림을 푼다 — 미인증이면 가입하기·'UID 인증하기'
    if (vaultKind === null) vaultKind = 'memory'; // 저장소를 못 열고 멈췄으면 — 주문 칸은 nostore(기다리는 칸으로 남기지 않음)
    // 주문 칸 — 실행기를 만든 뒤 주기(30초 가벼운 주기 포함)를 맞추고 바로 다시 그린다
    syncTradeTimers();
    syncOrderPanel();
    // 인증을 불러온 뒤(실패해도) 사무실을 만든다 — 인증 회원이면 처음부터 중계 주소로(타이머가 먼저 데모를 띄웠으면 중계로 바꿈)
    releaseOffice();
    // 첫 실행 안내 — 인증·키·따라가기 상태를 안 뒤에(따라가기 켜짐·키 연결 기기는 자동으로 띄우지 않음)
    maybeAutoTour();
  }
}

function boot() {
  syncStrip(); // s·j판은 저장된 인증을 불러오는 동안 'UID 확인 중…'
  auto.setTrial(state.trial);
  // 트레이딩 탭(2d 차트·지표 + 2e 주문 칸 + 2026-10-10 합친 오토 모드·열린 포지션): 만들기만 하고 받지 않는다(처음 보일 때 라이브러리·봉).
  // 자리는 아래 onOrderSlot이 채운다 — 송출 화면(slots.auto·slots.positions)은 판마다(공용판도 — 상태 줄·오토 종목·열린 포지션·흐름·성적·체험 끝 신청),
  // ⚡ 오토 모드 켜기·끄기 줄 자리(slots.follow)는 s·j판만 채운다 — 공용판은 따라가기 코드를 부르지 않고 빈칸(숨김 — 카드 제목만)
  // 판정 상자(slots.verdict, p40 T12)도 s·j판만 — 근거 시트는 주문 칸 밖 자리(slots.sheet), 근거는 누를 때만 GET /v1/analysis/item/<id>
  tradeMode = createTradeMode({ config: CONFIG, onOrderSlot: (slots) => {
    orderSlots = slots;
    auto.mount({ card: slots.auto, list: slots.positions });
    if (MEMBER_OK && slots.follow) {
      tradeFollow = renderTradeFollow(slots.follow, { onToggle: tradeFollowToggle, onSettings: () => go({ mode: state.mode, screen: 'follow' }) });
      syncTradeFollow();
    }
    if (MEMBER_OK && slots.verdict) {
      tradeVerdict = renderVerdict(slots.verdict, { sheetSlot: slots.sheet, fetchItem: (id) => fetchAnalysisItem(CONFIG.hub, id), config: CONFIG });
      syncTradeVerdict();
    }
    // 주문 칸(p40 T13) — 규칙이 있는 판. 시트는 주문 칸 밖 자리(slots.sheet — 5초 다시 그리기가 입력칸을 떼지 않음). 공용판은 T-13 안내(tradeNotice)만 그리고
    // 실행기·기록은 없다(대리가 down). 주문은 카드·시트의 마지막 버튼을 회원이 누를 때만
    if (CONFIG.tradeRules && slots.orders) {
      orderPanel = createOrderPanel({
        slots: { orders: slots.orders, sheet: slots.sheet }, config: CONFIG, rules: CONFIG.tradeRules, followRules: rulesOf(CONFIG),
        exec: manualProxy, store: manualStoreProxy, chart: tradeMode.chartApi(), getCtx: tradeCtx,
        price: (inst) => (keys && keys.ready() ? keys.client().price(inst) : null),
        sha256: sha256Hex, toggleAutoSl, kakaoUrl: CONFIG.kakao,
      });
    }
  }, onSymbol: (s) => { if (onTradeSymbol) onTradeSymbol(s); syncTradeVerdict(); if (orderPanel) orderPanel.symbolChanged(s); } });
  tradeMode.mount($('#panel-trade'));
  for (const b of document.querySelectorAll('.mode-btn')) b.addEventListener('click', () => go({ mode: b.dataset.mode, screen: null }));
  $('#settings-btn').addEventListener('click', () => go({ mode: state.mode, screen: 'settings' }));
  for (const b of document.querySelectorAll('.back-btn')) b.addEventListener('click', () => go({ mode: state.mode, screen: null }));
  window.addEventListener('hashchange', () => onHash());
  // 사무실(다른 출처 iframe) 메시지 — 사무실 출처·지금 iframe 창·사무실 경로만 믿는다(무료 횟수·신청 링크·중계 시작).
  // 공용판은 다 쓰면 신청 버튼(셸이 최댓값을 기억, 사무실이 다시 뜨면 ptf:trial-seed로 돌려줌)
  officeShell = createOfficeShell({
    win: window,
    config: CONFIG,
    getFrame: () => office.frame(),
    relay,
    // 데모·중계는 셸이 정한다 — 지금 iframe을 &relay=1로 만들었을 때만 중계 시작(사무실이 스스로 적은 relay를 그대로 믿지 않음)
    expectRelay: () => office.relay(),
    // 최신 분석(p34 §3.2) — 준비될 때마다 1회·바뀔 때·ptf:analysis-get의 답(analysisReplay 판만, 아니면 null)
    analysis: officeAnalysis,
    // 요청 분석(p35 §2.11) — 준비된 창의 ptf:analysis-request만, 준비를 풀면 옛 창 전달을 끊음(analysisRequest 판만, 아니면 null)
    requests,
    onTrial: (t) => {
      state.trial = t;
      auto.setTrial(t);
      if (state.screen === 'settings') renderSettingsNow();
    },
    // 새 창이 막혀도(noopener라 알 수 없음) 누를 수 있는 진짜 링크 한 줄
    onOpen: (url) => office.showOpenLink(url),
  });
  // 화면에서 사라지면 연결을 닫고, 돌아오면 다시 채운다(숨어 있던 동안의 매매는 흐름에만 — 알림 없음).
  // 돌아오면 토큰 갱신 주기도 확인한다 — 뒤로 간 휴대폰 앱은 12시간 타이머가 멈춰 있을 수 있다(설계 3-2 §3.3)
  // 숨으면 거래소 WS를 닫고(주문하지 않음), 돌아오면 접속 토큰 수명을 보고 다시 연다(§5.4-1·§5.7)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (follow) follow.setVisible(false); // 임대를 놓고 새 주문 없음(그동안 온 신호는 실행하지 않는다 — F-03)
      auto.stop();
      if (keys) keys.pause();
      if (analysisFeed) analysisFeed.setVisible(false);
      if (requests) requests.setVisible(false); // 요청 상태 받기 멈춤(허브 표는 그대로)
      if (eventsFeed) eventsFeed.setVisible(false);
      if (balance) balance.setVisible(false); // 숨은 동안 잔고 조회 0건
      if (tradeMode) tradeMode.hide(); // 봉 10초 갱신·차트 WS 멈춤(p2 spec §2.1)
      stopTradeTimers(); // 주문 칸 정리 주기(5초·30초) 멈춤 — 숨은 동안 수동 주문 거래소 호출 0건
    } else {
      auto.start();
      if (analysisFeed) analysisFeed.setVisible(true); // 다시 보이면 최신 분석 한 번(p34 §3.1 ③)
      if (requests) requests.setVisible(true); // 다시 보이면 요청 상태 바로 이어 받기
      if (eventsFeed) eventsFeed.setVisible(true); // 다시 보이면 거래소 이벤트 한 번
      if (control) control.resume();
      if (keys) keys.resume();
      if (follow) follow.setVisible(true); // 임대·잠금 다시 → sending 줄 확인 → 정리(§6.11)
      if (balance) balance.setVisible(true);
      if (tradeMode && state.mode === 'trade') tradeMode.show(); // 이어 받기(10분 넘게 숨었으면 전체 다시 — chart-feed)
      syncTradeTimers(); // 다시 보이면 정리 주기 — 트레이딩 탭이면 upkeep 한 번 먼저(spec §5.5 다시 열 때 한 번)
    }
  });
  // 화면 폭이 바뀌면 띠가 넘치는지 다시 본다(넘치면 짧은 글자)
  window.addEventListener('resize', () => strip.refresh());
  // ③ 시트의 남은 시간(초) — 시트가 떠 있을 때만 1초마다
  setInterval(() => {
    if (sheetView && state.follow && state.follow.sheets.length) sheetView.update(state.follow.sheets, Date.now(), { autoSlOn: !!(state.follow.autoSl && state.follow.autoSl.on) });
  }, 1000);
  // p34 §4.2: 열린 매매 평가 손익(표시가 — 엔진은 시세마다 알리지 않음)은 화면이 보이는 동안 5초마다 다시 그린다(따라가기 화면·트레이딩 탭 열린 포지션,
  // 숨으면 안 함). ⚡ 오토 모드 줄의 상태 줄도 엔진이 알리지 않는 변화(heartbeat 끊김 → '서버 확인 안 됨')까지 따라가게(CEO 2026-10-10)
  setInterval(() => {
    if (document.visibilityState === 'hidden' || !follow) return;
    if (state.screen === 'follow' || state.mode === 'trade') onFollowChange(follow.state());
  }, PNL_REFRESH_MS);
  // 최신 분석 — 앱을 켤 때 한 번(p34 §3.1 ⓪, 사무실이 준비되기 전에 값을 갖고 있게)
  if (analysisFeed) analysisFeed.start();
  // 거래소 이벤트 — 켤 때 한 번 + 앱이 화면에 있을 때 3분마다(동업자 화면과 같음)
  if (eventsFeed) eventsFeed.start();
  // 뒤에서(숨은 채) 켜졌으면 주기는 멈춰 둔다 — 보이면 visibilitychange가 다시 받는다
  const bootVisible = document.visibilityState !== 'hidden';
  if (analysisFeed) analysisFeed.setVisible(bootVisible);
  if (eventsFeed) eventsFeed.setVisible(bootVisible);
  const first = initialRoute(location.hash, safeGet(LAST_MODE_KEY));
  history.replaceState(null, '', routeHash(first));
  show(first);
  // 옛 1단계 공용판 SW가 미리 받아 둔 같은 출처 office/를 캐시에서 지우고 공용판 SW 업데이트를 확인한다(어느 판이든, 실패해도 그대로)
  purgeSameOriginOffice().catch(() => {});
  // 기기 저장소가 멈춰도 MEMBER_BOOT_MS 뒤에는 사무실(데모)을 띄운다
  if (MEMBER_OK) setTimeout(releaseOffice, MEMBER_BOOT_MS);
  if (MEMBER_OK) setTimeout(() => auto.memberLoaded(), MEMBER_BOOT_MS); // 오토 모드 카드도 같은 상한(그 뒤 인증되면 회원 화면으로)
  // 저장된 인증을 먼저 불러온 뒤 연결한다 — 회원이 켤 때마다 공개 송출에 잠깐 붙었다 바꾸지 않게
  bootMember().finally(() => {
    if (document.visibilityState !== 'hidden') auto.start();
  });
}

// PDF 안내서는 공용판 주소만 적혀 있어 공용판에만 있다(빌드가 담당자판엔 guide/를 넣지 않음) — 담당자판 설치 화면엔 링크 없음
const install = createInstallController({
  config: CONFIG,
  navigate: (screen) => go({ mode: state.mode, screen }),
  pdfHref: CONFIG.edition === 'pub' ? 'guide/ptf-app-guide.pdf' : null,
});
hooks.openInstall = install.open;
install.setup();
const sw = registerSW({ onUpdateReady: () => { $('#update-toast').hidden = false; } });
if (sw) {
  hooks.checkUpdate = sw.check;
  $('#update-apply').addEventListener('click', () => sw.apply());
}
boot();
install.autoOpen(state.screen);
// 공용판은 기다릴 인증이 없다 — 설치 안내(인앱 브라우저)를 띄운 뒤 바로 판단(s·j판은 bootMember 끝에서)
if (!MEMBER_OK) maybeAutoTour();
