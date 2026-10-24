// 원웨이 안내 창(헤지 모드 계정 — 대표 결정 2026-10-19) 문구 한 곳. 창 그리기는 app/screens/hedge-guide.js, 판단은 app/lib/ox-errors.js.
// 창 글(title·body·steps·warn·ok)은 대표가 채팅에서 본 초안 그대로. line은 주문 실패 한 줄(트레이딩 탭 결과 줄·자동매매 기록 줄),
// enableLine은 켜기 확인 한 줄(#follow 알림 띠 — 켜기의 배율 확인 probeLeverage가 헤지로 거절됨: 주문을 보낸 적이 없고 켜지 않았다, 검토 2026-10-19),
// offLine은 켜진 뒤 꺼짐 한 줄(대표 결정 2026-10-19 '자동으로 끄기' — 켜진 자동매매의 자동 진입·추가 진입이 헤지로 막혀 엔진이 껐다, 엔진 probeNote 'hedge_off':
// #follow 알림 띠·트레이딩 탭 ⚡ 줄 상태 글. 켤 때 확인을 못 해 켜졌다가 나중의 확인이 헤지로 거절된 경우도 — 회원은 켜진 것을 봤다).
// 그림은 대표가 준 오렌지엑스 PC 설정 화면 캡처(docs/aside/shots/pc-03-position-mode.png — sha256 고정)에서 흰 Preferences 창만 자른 것
// (tools/make_api_shots.py → app/help/position-mode.webp — 세 판 공용, 빌드가 미리 받기 목록에 넣음). 휴대폰 오렌지엑스 앱 캡처는 아직 없다.
// 화면 문구 규칙: '대표'·레퍼럴류·수익 보장 없음
export const HEDGE_IMAGE = 'help/position-mode.webp';
export const HEDGE_TEXT = Object.freeze({
  title: "오렌지엑스 포지션 모드를 '원웨이'로 바꿔 주세요",
  body: '계정이 양방향(Hedge) 모드라 배율을 맞추지 못했습니다. 이 앱은 원웨이 모드에서만 주문합니다.',
  steps: Object.freeze(['① 오렌지엑스 선물 화면 설정 → Preferences → Trading → Position Mode', '② One-Way Mode 선택']),
  warn: 'USDT 무기한에 열린 포지션·미체결 주문이 있으면 바꿀 수 없습니다 — 먼저 정리하세요. 바꾸면 모든 USDT 무기한 종목에 적용됩니다.',
  ok: '확인',
  alt: '오렌지엑스 PC 설정 창 — Preferences의 Trading에서 Position Mode를 One-Way Mode로 고른 화면',
  line: '계정이 양방향(Hedge) 모드라 주문하지 못했습니다 — 오렌지엑스에서 포지션 모드를 원웨이(One-Way)로 바꿔 주세요.',
  enableLine: '계정이 양방향(Hedge) 모드라 오토 모드를 켜지 않았습니다 — 오렌지엑스에서 포지션 모드를 원웨이(One-Way)로 바꿔 주세요.',
  offLine: '계정이 양방향(Hedge) 모드라 오토 모드를 껐습니다 — 오렌지엑스에서 포지션 모드를 원웨이(One-Way)로 바꾼 뒤 다시 켜 주세요.',
});
