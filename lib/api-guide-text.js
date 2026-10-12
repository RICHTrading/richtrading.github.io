// 오렌지엑스 API 연결 가이드(앱용 — 2026-10-12 설계 §5.1, 대표 결정 7) — 앱 키 화면 안 단계(app/screens/api-guide.js)와 PDF(tools/make_api_guide.py ← tools/api-guide-json.mjs)가
// 같이 쓰는 원본 하나. 사진은 운영 측이 보낸 오렌지엑스 캡처(docs/aside/shots/ — 계정 정보 없음) pc-00-otp-notice·pc-01-permissions·mo-01-permissions에 고를 칸 표시를 얹은 셋
// (tools/make_api_shots.py → app/guide/api-guide/). IP 칸 캡처는 쓰지 않는다 — 키는 'No IP restriction.'.
// 창의 실제 칸(캡처 확인): 권한 Account·Trade·Wallet 각각 None / Read / Read and Write, IP Whitelist 필수 선택('No IP restriction.' 또는 'Only IPs …'),
// 키 만들기 전 구글 OTP 등록, 한 계정 키 최대 8개. 이 앱의 키 = Account Read · Trade Read and Write · Wallet Read · No IP restriction. —
// 휴대폰 따라가기·주문과 ④ 서버 자동이 같은 키를 쓴다(서버 자동은 새 키 없음). 동업자 가이드(partnerOk:false)는 쓰지 않는다.
// 화면 문구 규칙: '대표'·레퍼럴류·가입 링크 없음
export const API_GUIDE_IMAGES = Object.freeze(['00-otp.png', '01-permissions.png', '02-permissions-mobile.png']);
export const API_GUIDE_PDF = 'ptf-api-guide.pdf';
export const API_GUIDE = Object.freeze({
  title: '오렌지엑스 API 연결 가이드(앱용)',
  lead: '이 앱의 내 자동매매·주문에 쓰는 거래 전용 API 키를 만들어 키 화면에 연결합니다. ④ 서버 자동도 이 키를 그대로 씁니다 — 키를 따로 만들지 않습니다.',
  pdfLink: 'PDF로 보기(사진 포함)',
  steps: Object.freeze([
    Object.freeze({ id: 'otp', title: '구글 OTP 먼저', text: "API 키를 만들려면 구글 OTP(Google Authenticator)를 먼저 등록해야 합니다. 등록 전에는 'Please set up your Google Authenticator' 알림이 뜹니다 — 오렌지엑스 보안(Security) 설정에서 먼저 켭니다.", img: '00-otp.png' }),
    Object.freeze({ id: 'add', title: '새 키 추가', text: "PC 웹 또는 모바일 웹에서 오렌지엑스에 로그인해 orangex.com/user-center/api(API 관리)를 열고 'Add a New Key'를 누릅니다. 이름(Name for the API Key)은 알아보기 쉽게 적습니다. 한 계정에 키는 최대 8개까지 만들 수 있습니다.", img: null }),
    Object.freeze({ id: 'perm', title: '권한·IP 고르기', text: "Account는 Read, Trade는 Read and Write, Wallet은 Read, IP Whitelist는 'No IP restriction.'을 고릅니다(사진의 빨간 표시). Wallet이나 Account를 Read and Write로 고른 키는 이 앱도 서버도 받지 않습니다(출금·계정 쓰기 권한 없음).", img: '01-permissions.png' }),
    Object.freeze({ id: 'mobile', title: '모바일 웹', text: '휴대폰 브라우저에서도 같은 창이 열립니다 — 같은 칸을 고릅니다.', img: '02-permissions-mobile.png' }),
    Object.freeze({ id: 'copy', title: '키 두 개 복사', text: 'Confirm을 누른 뒤 만든 API 키와 비밀 키(Secret)를 바로 복사합니다. 비밀 키는 다시 볼 수 없을 수 있습니다.', img: null }),
    Object.freeze({ id: 'paste', title: '앱 키 화면에 붙여넣기', text: "이 앱의 키 화면(오렌지엑스 연결)에 두 키를 붙여 넣고 '연결하기'를 누릅니다. 비밀 키는 이 휴대폰에만 암호화해 보관합니다.", img: null }),
    Object.freeze({ id: 'server', title: '(원하면) ④ 서버 자동 켜기', text: "화면이 꺼져도 자동매매를 하려면 내 자동매매 화면에서 '④ 서버 자동(화면 꺼져도)'을 고르고 동의합니다. 연결해 둔 이 키를 서버에 암호화해 맡기며, 키를 다시 넣지 않습니다.", img: null }),
  ]),
  notes: Object.freeze([
    "'No IP restriction.'(IP 제한 없음) 키라 키가 새면 어디서나 쓰일 수 있습니다 — 키를 남에게 보이지 말고, 의심되면 오렌지엑스 API 관리에서 바로 삭제하세요.",
    '서버 자동은 이 서버와 운영 PC가 켜져 있을 때 동작합니다.',
    "키를 지우려면 이 앱 키 화면의 '연결 해제'와 함께 오렌지엑스 API 관리에서도 삭제하세요.",
  ]),
});
