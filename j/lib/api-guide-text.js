// 오렌지엑스 API 연결 가이드(앱용 — 2026-10-12 설계 §5.1, 대표 결정 7) — 앱 키 화면 안 단계(app/screens/api-guide.js)와 PDF(tools/make_api_guide.py ← tools/api-guide-json.mjs)가
// 같이 쓰는 원본 하나. 사진은 운영 측이 보낸 오렌지엑스 캡처(docs/aside/shots/ — 계정 정보 없음) pc-03-position-mode·pc-00-otp-notice·pc-01-permissions·mo-01-permissions에 고를 칸 표시를 얹은 넷
// (tools/make_api_shots.py → app/guide/api-guide/). IP 칸 캡처는 쓰지 않는다 — 키는 'No IP restriction.'.
// 창의 실제 칸(캡처 확인): 권한 Account·Trade·Wallet 각각 None / Read / Read and Write, IP Whitelist 필수 선택('No IP restriction.' 또는 'Only IPs …'),
// 키 만들기 전 구글 OTP 등록, 한 계정 키 최대 8개. 이 앱의 키 = Trade Read and Write(필수) · 나머지(Account·Wallet) Read(권장) · No IP restriction. —
// 휴대폰은 Account Read·Read and Write 둘 다 받는다(대표 결정 2026-10-19 → 되돌림(K-11 원인은 헤지 모드 5147 — docs/research/2026-10-19-ox-hedge-5147.md) →
// 대표 결정 2026-10-20 '읽기 쓰기든 상관 없이', config.oxScope.allowAccountWrite). 서버 자동 실행기(보안 규칙 23(b))도 같은 허용 목록('서버도 둘 다 받기').
// 권한 단계는 대표 검토(2026-10-20 — '그냥 트레이드만 read and write 필수고 나머지는 read 권장 이라고 짧게')로 짧은 꼴 — 사진(01·02)의 빨간 표시(Account Read·
// Trade Read and Write·Wallet Read)와 같다. Account Read 키로 배율을 바꾸지 못하면 K-11(keys.js levDeniedText — 거래소 코드가 있으면 배율 직접 맞추기·Read and Write
// 키로 다시 연결)이 할 일을 말한다. Wallet Read and Write(출금)는 앱·서버 모두 거절. 휴대폰 따라가기·주문과 ④ 서버 자동이 같은 키를 쓴다(서버 자동은 새 키 없음).
// 동업자 가이드(partnerOk:false)는 쓰지 않는다.
// Account Read and Write는 오렌지엑스 문서상 '계정 설정 관리·하위 계정 추가 등'(docs/research/2026-10-19-ox-account-write-scope.md)이라 '거래 전용'이라 하지 않는다 —
// 머리말은 '출금 권한 없음'. 알림 첫 줄의 '(Account가 Read and Write면 계정 설정 변경까지)'(검토 2026-10-19)는 권한 단계가 '나머지는 Read(권장)'로 바뀐 뒤
// 대표 결정 2026-10-20(문구 줄이기 — 대표 승인)으로 뺐다(새면 어디서나 쓰일 수 있다는 말은 그대로). 계정 쓰기의 쓰임은 K-05a·동의 ⑦에 남는다(보안 규칙 5)
// 대표 결정 2026-10-20(문구 줄이기 묶음 A): 서버 자동(④) 글 — 머리말 둘째 문장(serverLead)·8단계(server)·알림(serverNotes) — 은 서버 자동이 있는 판
// (server-exec.js serverBuildReady — 빌드가 serverExec·실행기 공개키를 찍은 판)에서만 그린다(apiGuideView). 게시 세 판은 서버 자동이 없어 화면·PDF 모두 빠진다
// (PDF는 한 벌 — tools/api-guide-json.mjs 기본이 서버 자동 없음, --server면 그 글까지). 1~3단계도 짧게(포지션 모드는 '모든 USDT 무기한 종목에 적용' 남김 — 대표)
// 2026-10-19(대표 결정 ④): 맨 앞에 '포지션 모드를 원웨이로' — 헤지(양방향) 모드 계정은 이 앱의 배율 맞추기(posId 0)를 오렌지엑스가 5147로 거절한다
// (docs/research/2026-10-19-ox-hedge-5147.md). 경로 문장은 원웨이 안내 창(app/lib/hedge-text.js)과 같고, 사진은 대표 PC 설정 화면 캡처
// (docs/aside/shots/pc-03-position-mode.png)에서 흰 Preferences 창만 자른 것(03-position-mode.png — 키를 만들기 전에 맞추게 맨 앞 단계).
// 화면 문구 규칙: '대표'·레퍼럴류·가입 링크 없음
export const API_GUIDE_IMAGES = Object.freeze(['03-position-mode.png', '00-otp.png', '01-permissions.png', '02-permissions-mobile.png']);
export const API_GUIDE_PDF = 'ptf-api-guide.pdf';
export const API_GUIDE = Object.freeze({
  title: '오렌지엑스 API 연결 가이드(앱용)',
  lead: '이 앱의 오토 모드·주문에 쓰는 API 키(출금 권한 없음)를 만들어 키 화면에 연결합니다.',
  serverLead: '④ 서버 자동도 이 키를 그대로 씁니다 — 키를 따로 만들지 않습니다.', // 서버 자동이 있는 판만(apiGuideView)
  pdfLink: 'PDF로 보기(사진 포함)',
  steps: Object.freeze([
    Object.freeze({ id: 'mode', title: '포지션 모드를 원웨이로', text: '키를 만들기 전에 오렌지엑스 선물 화면 설정 → Preferences → Trading → Position Mode에서 One-Way Mode를 고릅니다. 양방향(Hedge)이면 이 앱이 주문하지 못합니다. 열린 포지션·미체결 주문은 먼저 정리하세요 — 바꾸면 모든 USDT 무기한 종목에 적용됩니다.', img: '03-position-mode.png' }),
    Object.freeze({ id: 'otp', title: '구글 OTP 먼저', text: '키를 만들려면 먼저 오렌지엑스 보안(Security) 설정에서 구글 OTP(Google Authenticator)를 켭니다(안 켜면 사진의 알림이 뜹니다).', img: '00-otp.png' }),
    Object.freeze({ id: 'add', title: '새 키 추가', text: "PC나 휴대폰 웹에서 orangex.com/user-center/api(API 관리)를 열고 'Add a New Key'를 누릅니다(이름은 알아보기 쉽게, 계정당 최대 8개).", img: null }),
    Object.freeze({ id: 'perm', title: '권한·IP 고르기', text: "Trade는 Read and Write(필수), 나머지는 Read(권장), IP는 'No IP restriction.'을 고릅니다. 출금 권한(Wallet Read and Write)이 있는 키는 받지 않습니다.", img: '01-permissions.png' }),
    Object.freeze({ id: 'mobile', title: '모바일 웹', text: '휴대폰 브라우저에서도 같은 창이 열립니다 — 같은 칸을 고릅니다.', img: '02-permissions-mobile.png' }),
    Object.freeze({ id: 'copy', title: '키 두 개 복사', text: 'Confirm을 누른 뒤 만든 API 키와 비밀 키(Secret)를 바로 복사합니다. 비밀 키는 다시 볼 수 없을 수 있습니다.', img: null }),
    Object.freeze({ id: 'paste', title: '앱 키 화면에 붙여넣기', text: "이 앱의 키 화면(오렌지엑스 연결)에 두 키를 붙여 넣고 '연결하기'를 누릅니다. 비밀 키는 이 휴대폰에만 암호화해 보관합니다.", img: null }),
    // server: true — 서버 자동이 있는 판만(apiGuideView)
    Object.freeze({ id: 'server', title: '(원하면) ④ 서버 자동 켜기', text: "오토 모드 화면에서 '⚡ 오토 모드 시작'을 누르면 연결해 둔 이 키를 서버에 암호화해 맡기며, 키를 다시 넣지 않습니다.", img: null, server: true }), // 대표 결정 2026-10-23 — 동의 창 없음(옛 '④ 서버 자동(화면 꺼져도)'을 고르고 동의)
  ]),
  notes: Object.freeze([
    "'No IP restriction.' 키라 새면 어디서나 쓰일 수 있습니다 — 남에게 보이지 말고, 의심되면 오렌지엑스 API 관리에서 바로 삭제하세요.",
    "키를 지우려면 이 앱 키 화면의 '연결 해제'와 함께 오렌지엑스 API 관리에서도 삭제하세요.",
  ]),
  serverNotes: Object.freeze(['서버 자동은 이 서버와 운영 PC가 켜져 있을 때 동작합니다.']), // = FTEXT.serverLimit, 서버 자동이 있는 판만(apiGuideView)
});

// 그 판에 보일 가이드(화면 screens/api-guide.js·PDF tools/api-guide-json.mjs가 같이 씀) — serverExec = 서버 자동이 있는 판(server-exec.js serverBuildReady)일 때만
// 서버 자동 글(머리말 둘째 문장·8단계·알림 한 줄)을 넣는다(대표 결정 2026-10-20 — 게시 세 판에는 없는 기능을 안내하지 않음)
export function apiGuideView({ serverExec = false } = {}) {
  const on = serverExec === true;
  return {
    title: API_GUIDE.title,
    lead: on ? `${API_GUIDE.lead} ${API_GUIDE.serverLead}` : API_GUIDE.lead,
    pdfLink: API_GUIDE.pdfLink,
    steps: API_GUIDE.steps.filter((s) => on || s.server !== true),
    notes: on ? [API_GUIDE.notes[0], ...API_GUIDE.serverNotes, ...API_GUIDE.notes.slice(1)] : [...API_GUIDE.notes],
  };
}
