// 5분봉 지표 — AI 신호 주문 2·3·4차 추가 진입 조건(설계 2026-10-16 §7.7 · P2a 계획 정한 것 9·10 · 검토 초점 3).
// 오렌지엑스 5분 완성 봉 종가(ox-bars.js closed() → { closes, lastTick })로 RSI14·볼린저를 계산하고, dca-rules.json의 cond 칸이 맞는지 가른다.
// 식은 표준 정의로 직접 쓴다(동업자 공개 화면 코드는 옮기지 않는다 — 저작권 고지, 비교 보고서 S1). 동업자 오토와 같은 식인지는 Q15(대표가 동업자에게).
// - rsiWilder: 마지막 rsiBars(99)개 종가 → 변화 98개. 처음 len개 변화의 평균 이익·평균 손실로 시작하고 그 뒤 avg = (avg × (len − 1) + x) / len.
//   평균 손실이 0이면 100, 평균 이익도 0이면 50(정한 것 10)
// - bollinger: 마지막 len개의 평균 mid ± k × 표준편차(÷len — 모집단). k는 부르는 쪽이 dca-rules.json에서 가져온다
// - condMet: 롱은 rsi < longBelow · px < lower, 숏은 rsi > shortAbove · px > upper(같으면 거짓). 봉이 없거나(실패 결과) 모자라거나, 마지막 완성 봉이
//   닫힌 지 staleMs(10분)를 넘었거나, 모르는 꼴이면 모두 거짓 — 그 차수는 강제 선만 동작한다(설계 §7.7, 덜 들어가는 쪽). 던지지 않는다
// 다른 모듈을 가져오지 않는 순수 함수 — 브라우저 전역 없이 Node에서도 불러진다(서버 자동 실행기 P3도 같은 파일). dir은 follow-math dirOf의 1(롱)·−1(숏)
// now는 lastTick과 같은 거래소 기준 epoch ms(ox-client serverNow)다 — 이 파일은 기기 벽시계를 읽지 않고 부르는 쪽이 준 now와 lastTick의 차이로만 봉의 나이를 잰다.
// 기기 벽시계를 그대로 넣으면 시계가 늦은 기기는 요청 창 자체가 그만큼 옛 봉이라 나이가 늘 작게 재져 옛 봉 판단이 영영 안 걸린다(설계 §4.5·§11-2,
// P2a Task 6 검토 고침 1회차 지적 0). now가 수가 아니면(거래소 시계를 아직 모름) 거짓
export const IND = Object.freeze({ rsiBars: 99, bbBars: 20, tfMs: 300000, staleMs: 600000 });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// closes의 마지막 n개 — 배열이 아니거나 n개가 안 되거나 그 안에 유한한 수가 아닌 것이 있으면 null(창 앞의 값은 보지 않음)
function lastN(closes, n) {
  if (!Array.isArray(closes) || closes.length < n) return null;
  const w = closes.slice(-n);
  return w.every(isNum) ? w : null;
}

export function rsiWilder(closes, len = 14) {
  if (!Number.isInteger(len) || len < 2 || len >= IND.rsiBars) return null;
  const w = lastN(closes, IND.rsiBars);
  if (!w) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= len; i++) {
    const d = w[i] - w[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let ag = gain / len;
  let al = loss / len;
  for (let i = len + 1; i < w.length; i++) {
    const d = w[i] - w[i - 1];
    ag = (ag * (len - 1) + (d > 0 ? d : 0)) / len;
    al = (al * (len - 1) + (d < 0 ? -d : 0)) / len;
  }
  if (al === 0) return ag === 0 ? 50 : 100;
  return 100 - 100 / (1 + ag / al);
}

export function bollinger(closes, len = IND.bbBars, k) {
  if (!Number.isInteger(len) || len < 2 || !isNum(k) || k < 0) return null;
  const w = lastN(closes, len);
  if (!w) return null;
  const mid = w.reduce((s, v) => s + v, 0) / len;
  const sd = Math.sqrt(w.reduce((s, v) => s + (v - mid) ** 2, 0) / len); // 모집단(÷len)
  return { mid, upper: mid + k * sd, lower: mid - k * sd };
}

export function condMet(arg) {
  const { cond, dir, bars, now, px } = arg && typeof arg === 'object' ? arg : {};
  if (dir !== 1 && dir !== -1) return false;
  if (!bars || bars.ok === false || !isNum(bars.lastTick) || !isNum(now)) return false; // closes 모양(배열·개수·수)은 아래 rsiWilder·bollinger가 봄
  if (now - (bars.lastTick + IND.tfMs) > IND.staleMs) return false; // 마지막 완성 봉이 닫힌 지 staleMs 넘게 옛것
  const keys = cond && typeof cond === 'object' ? Object.keys(cond) : [];
  if (keys.length !== 1) return false; // {} 이거나 두 꼴이 같이 있음
  if (keys[0] === 'rsi') {
    const x = cond.rsi;
    if (!x || !Number.isInteger(x.len) || !isNum(x.longBelow) || !isNum(x.shortAbove)) return false;
    const rsi = rsiWilder(bars.closes, x.len);
    return rsi !== null && (dir === 1 ? rsi < x.longBelow : rsi > x.shortAbove);
  }
  if (keys[0] === 'bb') {
    const x = cond.bb;
    if (!x || !Number.isInteger(x.len) || !isNum(px)) return false;
    const b = bollinger(bars.closes, x.len, x.k);
    return b !== null && (dir === 1 ? px < b.lower : px > b.upper);
  }
  return false;
}
