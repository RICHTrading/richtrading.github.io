// 앱 설정 — tools/build.mjs가 판마다 version·edition·appUrl·signupUrl·officeUrl·trialRuns를 바꿔 쓴다(editions.json).
// 여기 값은 개발 기본값 = 공용판. autoReady는 3-3(자동 따라 주문) 게시 전까지 false — 그 전에는 어느 판도 '자동 주문'을 말하지 않는다.
// hub·oxWs를 바꾸면 app/index.html CSP의 connect-src도, officeUrl의 출처를 바꾸면 frame-src도 같이 바꿀 것(test/html.test.mjs·app-office-endpoints·app-keys-build가 확인)
export const CONFIG = {
  version: '20261010-1758',
  edition: "pub",
  appUrl: "https://richtrading.github.io/",
  signupUrl: null,
  // 사무실 탭(데모 앱) — 앱과 다른 출처(설계 3-2 §4.2). 공용판 pub/, 담당자판(s·j) m/
  officeUrl: "https://richtradingschool.github.io/ptf-office/pub/",
  // 무료 분석 횟수(판의 office.trial_runs, 0 = 제한 없음) — '다 씀'은 셸이 이 값으로 판단한다(사무실이 보낸 limit은 보지 않음)
  trialRuns: 5,
  // 사무실 ▶ ANALYZE = 리치 서버 AI 최신 분석 다시 보기(p34 §3) — 판의 office.analysis_replay(수호·준현 true). 켜진 판만 허브 /v1/analysis/latest를 읽어 사무실에 넘긴다
  analysisReplay: false,
  // 사무실 ▶ ANALYZE = 다른 종목 새 분석 요청(p35 §2.11 B안) — 판의 office.analysis_request(수호·준현 true). 켜진 판만 허브 POST /v1/analysis/request
  analysisRequest: false,
  // 요청 분석의 실시간 직원 말(p37 D4) — 판의 office.analysis_live(수호·준현 true, analysis_request 판만). 켜진 판만 실행 중인 요청 표의
  // 허브 GET /v1/analysis/request/<표>/turns를 3초마다 받아 사무실에 ptf:analysis-turns로 넘긴다
  analysisLive: false,
  // 거래소 이벤트 칩·창(p34 §5.4) — 판의 events(기본 true). 개발 기본값은 끔, 빌드가 판 값으로 찍는다
  events: true,
  // 판별 값 셋 — 빌드가 editions.json 판 값으로 찍는다(tools/build.mjs stampConfig). autoReady = 3-3 자동 따라 주문.
  // tradeReady = 2단계 수동 주문(p2 spec §1.3): 트레이딩 탭 주문 칸을 실제 회원에게 연다(키 화면도 — keysCapable, 따라가기는 아님).
  //   켜진 판이 있으면 --strict가 oxTpsl.cond·stopChecked 둘 다 true를 요구한다(checkTradeReady·checkStopChecked).
  // tradeNotice = 공용판에만 — s·j판 중 하나라도 tradeReady일 때 공용판 트레이딩 탭의 T-13 안내 한 줄(tools/editions.mjs가 검사)
  autoReady: false,
  tradeReady: false,
  tradeNotice: false,
  hub: 'https://richtrade.tail03e06c.ts.net',
  kakao: 'https://pf.kakao.com/_ICyin/chat?bot=true',
  telegram: 'https://t.me/+lSc9tuwXMaNmNDE1',
  // 오렌지엑스 WS(설계 3-2 §5.4) — 휴대폰이 직접 서명 로그인한다. 시험 빌드는 --test-endpoints ox=ws://127.0.0.1:<포트>가 바꾼다(CSP connect-src도 같이)
  oxWs: 'wss://api.orangex.com/ws/api/v1',
  // 로그인 방식(app/lib/ox-ws.js OX_AUTH_MODES): 'credentials' = client_id + client_secret(실측 2026-10-08 대표 키로 되는 유일한 방식 —
  // 비밀 키는 이 기기에 암호화해 두고 로그인 때만 이 기기 → 오렌지엑스로), 'signature' = 문서 서명식(지금은 거래소가 10000으로 거절 — 고쳐지면 되돌림)
  oxAuth: 'credentials',
  // 키 권한 허용 목록에서 account:read_write를 받을지(§5.4-6) — T11에서 배율 변경에 계정 쓰기가 필요하다고 확인되면 true + K-03 ② '계정 읽기·쓰기'
  oxScope: { allowAccountWrite: false },
  // 계정 일치(§5.4-8): 'exact' = get_account_msg uid 해시가 인증 UID 해시와 같아야 연결(시험 토큰은 진단만).
  // 'off'(비교만)는 U3(b)대로 '인증한 UID 계정의 키입니다' 체크 상자와 함께여야 한다 — 그 상자가 생길 때까지 빌드가 거부(tools/build.mjs checkAccountMatch)
  accountMatch: 'exact',
  // 진입 뒤 익절·손절 맞추기(설계 3-2 §6.9): false = 진입 주문에 붙인 값만(어긋나면 tpsl_not_synced·다음 추가 진입 안 함),
  // true = 조건 주문(STOP·IF_TOUCHED, reduce_only)으로 다시 건다 — 대표 시험 T6·T7(U7)에서 조건 주문 동작이 확인된 뒤에만 켠다.
  // stopChecked(p34 §2.5): 자동 손절 STOP(reduce_only·표시가 발동)이 실거래소에서 되는지 대표 소액 시험(TM-A3·A4)으로 확인했는가 —
  // 자동 손절은 cond와 무관하게 STOP을 쓴다. --strict 게시에서 어느 판이든 autoReady·tradeReady가 true면 이 값이 true여야 한다.
  // manualTestCond(p2 spec §5.6-2): 시험 토큰의 트레이딩 탭 수동 주문만 조건 주문 모드(cond가 켜진 것처럼 — 게시판에서 익절가 변경 시연 TM5).
  // 따라가기 엔진은 cond만 본다(follow-engine.js). 조건 주문이 실거래소에서 안 되면(U28) false로 내리고 다시 게시
  oxTpsl: { cond: false, stopChecked: false, manualTestCond: true },
  // 따라가기 규칙 — 빌드가 follow-rules.json을 검사해 이 자리에 찍는다(app/lib/follow-rules.js). null이면 따라가기를 켤 수 없다
  followRules: {"rulesVersion":"20261008a-r1","source":"20261008a","note":"동업자 최신판 20261008a 규칙 — 자동 손절(4차 진입 뒤 청산가 바로 앞, 기본 켜짐). 하루 손실 한도·가격 차이 한도 없음. 한 매매 최대 증거금은 기본값 없음(회원 직접 입력)","follow":{"weightMultiplier":1,"stages":"all","tp":"signal","sl":"signal","autoSl":{"default":true,"afterStage":4,"liqGapPct":0.2}},"limits":{"maxMarginPct":{"default":null,"min":5,"max":100},"maxConcurrent":{"default":3,"min":1,"max":3}}},
  // 수동 매매 규칙 — 빌드가 trade-rules.json을 검사해 이 자리에 찍는다(app/lib/trade-rules.js). null이면 주문 칸을 열 수 없다
  tradeRules: {"rulesVersion":"20261008a-m1","source":"20261008a","tabs":{"coin":{"lev":50,"watch":["BTC","ETH","SOL","XRP","DOGE"]},"stock":{"lev":25,"watch":[],"names":{}}},"entry":{"firstPct":13,"tpPct":10},"add":{"chips":[13,15,33,100],"default":15},"tp":{"chips":[5,10,20,30]},"availCap":0.95,"bumpToMin":true,"tpAfterAdd":"keep","indicators":{"custom":true,"backtest":true}},
  // 동업자 가이드 PDF(p34 §6.7) — 빌드가 app/guide/ox-guides.json에서 partnerOk:true로 이 판에 실은 파일만 true로 찍는다.
  // deposit = guide/ox-deposit.pdf(입금·사용 가이드), api = guide/ox-api.pdf(API 연결 가이드). 화면은 true인 링크만 그린다
  guides: {"deposit":true,"api":false},
  // 오렌지엑스 앱 받기(p34 §6.3 — 동업자 tour.js:89·91, 2026-10-02 확인). APK 직접 주소는 넣지 않는다(내려받기를 바로 일으키지 않게)
  oxApps: { ios: 'https://apps.apple.com/kr/app/id6455259516', android: 'https://www.orangex.com/download' },
  // 정식 모바일 버전(s·j)에 따라가기가 열렸는지 — 공용판 안내 끝 표의 ' · 따라가기'에만 쓴다. 빌드가 s·j판 autoReady로 찍는다(공용판은 그 값을 모르므로)
  fullFollow: false,
};
