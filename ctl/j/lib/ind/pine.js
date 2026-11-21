// Pine Script 계산 의미 도우미(spec §4.2) — 대표 지표 5종이 같이 쓴다(우리 코드, MPL 아님).
// na = NaN: JS의 NaN + x = NaN이 Pine na + x = na와 같다. 비교는 NaN이면 거짓(Pine v5·v6 — bool은 na가 아님).
export const isNa = (x) => typeof x !== 'number' || Number.isNaN(x);
export const nz = (x, y = 0) => (isNa(x) ? y : x);
export const sign = (x) => (isNa(x) ? NaN : Math.sign(x));
const arr = (n) => new Array(n).fill(NaN);

export function pSma(src, n) {
  const out = arr(src.length);
  for (let i = n - 1; i < src.length; i += 1) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j += 1) s += src[j];
    out[i] = s / n;
  }
  return out;
}
// Pine: sum := na(sum[1]) ? ta.sma(src, len) : alpha * src + (1 - alpha) * nz(sum[1])
function pineMa(src, n, alpha) {
  const seed = pSma(src, n);
  const out = arr(src.length);
  let prev = NaN;
  for (let i = 0; i < src.length; i += 1) {
    out[i] = isNa(prev) ? seed[i] : alpha * src[i] + (1 - alpha) * prev;
    prev = out[i];
  }
  return out;
}
export const pEma = (src, n) => pineMa(src, n, 2 / (n + 1));
export const pRma = (src, n) => pineMa(src, n, 1 / n);
export function pStdev(src, n) {
  const avg = pSma(src, n);
  const out = arr(src.length);
  for (let i = n - 1; i < src.length; i += 1) {
    let ss = 0;
    for (let j = i - n + 1; j <= i; j += 1) ss += (src[j] - avg[i]) ** 2;
    out[i] = Math.sqrt(ss / n);
  }
  return out;
}
export function trueRange(B) {
  return B.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c))));
}
export const pAtr = (B, n) => pRma(trueRange(B), n);
function extreme(src, n, hi) {
  const out = arr(src.length);
  for (let i = n - 1; i < src.length; i += 1) {
    let m = src[i];
    for (let j = i - n + 1; j < i; j += 1) m = hi ? Math.max(m, src[j]) : Math.min(m, src[j]);
    out[i] = m;
  }
  return out;
}
export const highest = (src, n) => extreme(src, n, true);
export const lowest = (src, n) => extreme(src, n, false);
export const crossover = (a, b) => a.map((x, i) => i > 0 && x > b[i] && a[i - 1] <= b[i - 1]);
export const crossunder = (a, b) => a.map((x, i) => i > 0 && x < b[i] && a[i - 1] >= b[i - 1]);
export const change = (src) => src.map((x, i) => (i === 0 ? NaN : x - src[i - 1]));
export function msum(src, n) {
  const out = arr(src.length);
  for (let i = n - 1; i < src.length; i += 1) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j += 1) s += src[j];
    out[i] = s;
  }
  return out;
}
// spec §4.2 이름 `sum(src, n)`(Pine math.sum) — msum과 같은 함수.
export const sum = msum;
// Pine ta.cum(TPSL:273 `ta.cum(volume) > 0`): 첫 봉부터의 누적 합. na 봉은 더하지 않는다(누적이 na로 굳지 않음 — U36 대조 전 가정).
export function cum(src) {
  const out = arr(src.length);
  let s = 0;
  for (let i = 0; i < src.length; i += 1) {
    s += nz(src[i]);
    out[i] = s;
  }
  return out;
}
