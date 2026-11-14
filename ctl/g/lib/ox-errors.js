// 오렌지엑스 오류 판단(공용 — 트레이딩 탭 수동 주문 manual-exec·자동매매 follow-exec·켜기 확인 ox-client probeLeverage가 같이 쓴다).
// 헤지(양방향) 모드 계정: 이 앱은 원웨이 주문(position_side BOTH·배율 변경 posId 0)만 낸다. 대표 실거래 확인(2026-10-18 허브 기록 — 시각·메서드·코드만)에서
// 헤지 계정의 배율 변경(posId 0)을 오렌지엑스가 5147로 거절했고(계정 읽기·읽기쓰기 키 모두), 원웨이로 바꾸자 같은 키로 됐다.
// 오렌지엑스 공개 문서에는 오류 코드 표가 없어 5147의 뜻은 이 실측으로만 안다 — docs/research/2026-10-19-ox-hedge-5147.md.
// 거래소 글에 hedge·position side가 든 거절(예전 판단 — 가짜 오렌지엑스의 BOTH 주문 거부)도 같이 헤지로 본다.

export const OX_HEDGE_CODE = 5147; // 헤지 계정의 원웨이 배율 변경 거절(실측) — 이 값은 여기 한 곳
const HEDGE_MSG = /hedge|position\s*side/i;

// 결과(Outcome — ox-client call 모양)가 거래소 오류일 때 그 코드(정수), 아니면 null
export function oxCodeOf(o) {
  if (!o || typeof o !== 'object' || o.kind !== 'ox') return null;
  const n = typeof o.code === 'string' && /^-?\d{1,10}$/.test(o.code) ? Number(o.code) : o.code;
  return Number.isInteger(n) ? n : null;
}

// 헤지(양방향) 모드 계정의 거절인가 — 거래소 오류(kind 'ox')이고 코드 5147이거나 글에 hedge·position side
export function isHedgeModeError(o) {
  if (!o || typeof o !== 'object' || o.kind !== 'ox') return false;
  return oxCodeOf(o) === OX_HEDGE_CODE || HEDGE_MSG.test(String(o.message || ''));
}
