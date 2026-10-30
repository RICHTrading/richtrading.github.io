// 첫 실행 안내 장 고르기(순수, p34 설계 §6.1·§6.2) — CONFIG·회원 상태·탭 상태·이벤트 유무·셸이 가진 최신 분석으로 판별 장 목록을 만든다.
// 동업자 tour.js(12장: 소개 → 탭 → … → 직원 5묶음 → 판정 보드 → 차트 → 체험 vs 정식)를 우리 탭·휴대폰에 맞춰 더 자세하게(수호·준현 12~15장, 공용 12~13장).
// 대표 결정 2026-10-10: 자동매매 탭을 트레이딩 탭으로 합침 — S10(오토 모드)은 트레이딩 버튼을 비춘다(안내는 사무실 탭에서 돌아
// 트레이딩 패널 안 ⚡ 카드는 보이지 않으므로 버튼을 비추고 글이 '트레이딩 탭 맨 위 오토 모드'를 말함)
// - 옛 S11(오토 모드 켜기 설명)은 대표 결정 2026-10-26으로 지웠다(S10 대표 문장 한 장)
// - 끝 표 키 줄(계정 연결)은 autoReady 또는 keysCapable일 때만(검토 18 — autoReady:false 빌드의 실제 회원에게는 없다)
// - S12 자동 손절 줄은 규칙(config.followRules.follow.autoSl)이 있을 때만 함께(검토 7)
// - 끝 장 버튼은 하나(검토 35): s·j 비활성화 '▶ 체험 시작' → UID 활성화 화면, 활성화된 기기 '확인', 공용판 '▶ 시작'(+ 카카오톡 문의)
import { TOUR_TEXT, AGENTS } from './tour-text.js';
import { keysCapable } from './keys.js';
import { serverBuildReady } from './server-exec.js';

export const tourKey = (edition) => `ptf-tour-${edition}-v1`;
export const apiTourKey = (edition) => `ptf-tour-api-${edition}-v1`;
const MEMBER_EDS = Object.freeze(['s', 'j']);
const AGENT_IDS = Object.freeze(Object.keys(AGENTS));
const OFFICE = '#panel-office';
const TRADE_BTN = '.mode-btn[data-mode="trade"]';

const agentsOf = (ids) => ids.map((id) => ({ id, name: AGENTS[id][0], desc: AGENTS[id][1] }));

// 셸이 가진 최신 분석(계약 Analysis)의 turns → 말한 직원 이름(순서대로·한 번씩, 13명 안만)
export function analysisNames(analysis) {
  const turns = analysis && Array.isArray(analysis.turns) ? analysis.turns : [];
  const out = [];
  for (const t of turns) {
    if (!t || !AGENT_IDS.includes(t.id)) continue;
    const name = String(t.id).toUpperCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// 장 하나의 화면 글(시험·검사용) — 제목은 빼고 본문 문단·직원·그림 설명·표·작은 글
export function stepText(s) {
  const parts = [...(s.paras || [])];
  for (const a of s.agents || []) parts.push(`${a.name} ${a.desc}`);
  for (const f of s.figures || []) parts.push(f.cap);
  if (s.table) parts.push(...s.table.head, ...s.table.rows.flat());
  parts.push(...(s.small || []));
  return parts.join(' ');
}

export function tourSteps({ config, member = null, tradeOpen = false, hasEvents = false, analysis = null }) {
  const T = TOUR_TEXT;
  const memberEd = !!config && MEMBER_EDS.includes(config.edition);
  const capable = memberEd && keysCapable(config, member);
  const runs = Number.isInteger(config && config.trialRuns) ? config.trialRuns : 0;
  const steps = [];
  const add = (s) => steps.push({ paras: [], small: [], agents: [], figures: [], ...s });

  // S1에 '앱 받기' 버튼은 없다(대표 결정 2026-10-09 — 세 판 모두. 앱 받기 창은 UID 활성화 화면의 가입 줄 아래에서)
  // 대표 결정 2026-10-12: 홈 화면 추가 안내(그림 둘 — 아이폰 Safari·안드로이드 Chrome)는 첫 장에(옛 S14 '설치·문의'에서 옮김)
  add({ id: 'S1', target: null, title: T.s1Title, paras: [...(memberEd ? T.s1 : T.s1Pub), T.s1Home], figures: [...T.s1Figures], big: true });
  add({ id: 'S2', target: '#modes', title: T.s2Title, paras: [tradeOpen ? T.s2 : T.s2Soon] });
  // p35 §2.13: 요청 분석 판(수호·준현 — config.analysisRequest)은 '자동 분석 종목은 다시 보기, 다른 종목은 새 분석 요청'
  const request = memberEd && config.analysisRequest === true;
  if (!memberEd) add({ id: 'S3', target: OFFICE, title: T.s3PubTitle, paras: T.s3Pub(runs) });
  // p37 D4: 실시간 직원 말 판(config.analysisLive)만 '말을 마치는 대로 바로 보이고, 끝까지 못 가면 거둠' 한 줄 더
  else if (request) add({ id: 'S3', target: OFFICE, title: T.s3ReqTitle, paras: T.s3Req(analysisNames(analysis), config.analysisLive === true) });
  else add({ id: 'S3', target: OFFICE, title: T.s3Title, paras: T.s3(analysisNames(analysis)) });
  add({ id: 'S4', target: OFFICE, title: T.s4Title, agents: agentsOf(['taro', 'diana', 'nova', 'vibe']), agent: true });
  add({ id: 'S5', target: OFFICE, title: T.s5Title, agents: agentsOf(['bull', 'bear']), agent: true });
  add({ id: 'S6', target: OFFICE, title: T.s6Title, agents: agentsOf(['blitz', 'guard']), agent: true });
  add({ id: 'S7', target: OFFICE, title: T.s7Title, agents: agentsOf(['risky', 'safe', 'neutral']), small: [T.s7Small], agent: true });
  add({ id: 'S8', target: OFFICE, title: T.s8Title, agents: agentsOf(['ace', 'pm']), small: [T.s8Small], agent: true });
  // 사무실은 다른 출처 iframe이라 판정 칸을 비출 수 없다 — 상자 안 예시 그림(대표 결정 2026-10-12)
  add({ id: 'S9', target: OFFICE, title: T.s9Title, paras: [T.s9], figures: [T.s9Figure] });
  // 회원 전용 가격 줄은 뺐다(대표 결정 2026-10-12). s·j는 대표 문장(2026-10-26), 공용판은 AI 오토 모드 보기 글
  add({ id: 'S10', target: TRADE_BTN, title: T.s10Title, paras: [memberEd ? T.s10 : T.s10Pub] });
  // S11(오토 모드 켜기 설명)은 S10과 겹쳐 뺐다(대표 결정 2026-10-26 — S10 한 장으로)
  if (tradeOpen) add({ id: 'S12', target: TRADE_BTN, title: T.s12Title, paras: [T.s12] }); // 자동 손절 줄은 뺐다(대표 2026-10-27)
  if (hasEvents) add({ id: 'S13', target: '#evt-chip', title: T.s13Title, paras: [T.s13] });
  add({ id: 'S14', target: '#settings-btn', title: T.s14Title, paras: [T.s14] });

  if (memberEd) {
    const verified = !!member;
    const keyRow = verified ? capable : config.autoReady === true;
    add({
      id: 'END', target: null, title: T.endTitle, final: true,
      table: { head: [...T.endHead], rows: [...(request ? [T.endReqRow, ...T.endRows.slice(1)] : T.endRows), ...(keyRow ? [T.endKeyRow] : [])] },
      paras: [T.endUid, T.endWhy],
      finalLabel: verified ? T.ok : T.start,
      finalAction: verified ? 'close' : 'verify',
    });
  } else {
    add({
      id: 'END', target: null, title: T.endPubTitle, final: true,
      table: { head: [...T.endPubHead], rows: T.endPubRows(runs, config.fullFollow === true) },
      paras: [T.endPubNote],
      finalLabel: T.startPub,
      finalAction: 'close',
      extra: config.kakao ? [{ text: T.kakao, href: config.kakao }] : [],
    });
  }
  return steps;
}

// 인증 직후 계정 연결 한 장(§6.4) — 상단 띠의 '🔗 오렌지엑스 계정 연결'을 비춘다. 서버 판(config — serverBuildReady)은 주문·키 맡김이 서버(대표 결정 2026-10-23)
export function apiStep(config = null) {
  const server = serverBuildReady(config);
  const T = TOUR_TEXT;
  return { id: 'API', target: '#strip-account', title: T.apiTitle, paras: [server ? T.apiServer : T.api], small: [server ? T.apiSmallServer : T.apiSmall], agents: [], final: true, finalLabel: T.ok, finalAction: 'close' };
}

// 처음 켤 때 자동 안내는 셸의 첫 받기(최신 분석 — S3 직원 이름, 거래소 이벤트 — S13 장)를 잠깐 기다린 뒤 장을 고른다.
// 장은 시작할 때 한 번 고르므로, 받기 전에 시작하면 허브가 먼(퍼널) 휴대폰에서 그 장·이름이 빠진다(p34 종단 확인 2026-10-08).
// 받기가 모두 끝나면(실패도) 바로, 늦으면 TOUR_DATA_WAIT_MS 뒤 그대로 진행한다. 기다릴 받기가 없으면 타이머 없이 바로
export const TOUR_DATA_WAIT_MS = 2500;
export function tourDataWait(pendings, { ms = TOUR_DATA_WAIT_MS, timers = globalThis } = {}) {
  const list = (Array.isArray(pendings) ? pendings : []).filter((p) => p && typeof p.then === 'function');
  if (!list.length) return Promise.resolve();
  return new Promise((resolve) => {
    let handle = null;
    const finish = () => {
      if (handle != null) timers.clearTimeout(handle);
      handle = null;
      resolve();
    };
    handle = timers.setTimeout(finish, ms);
    Promise.allSettled(list).then(finish);
  });
}

// 처음 켤 때 자동으로 띄울지: 'show' | 'mark'(띄우지 않고 기록만 — 따라가기 켜짐·키 연결 기기, 검토 5) | 'none'
// escape(인앱 브라우저 — 바깥 브라우저로 다시 열면 그때)·덮는 화면이 열려 있으면 기록도 하지 않는다
export function autoTourDecision({ seen = false, escape = false, followOn = false, keysLinked = false, screen = null } = {}) {
  if (seen || escape || screen) return 'none';
  if (followOn || keysLinked) return 'mark';
  return 'show';
}

// 인증 직후 계정 연결 한 장: keysCapable·키 미연결('none')·처음일 때만
export function apiTourDecision({ config, member, keysStatus = 'none', seen = false }) {
  return !seen && keysStatus === 'none' && keysCapable(config, member);
}
