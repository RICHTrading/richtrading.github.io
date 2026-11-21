// N 기본 8종(spec §4.1) — N public/chart.js L203-226 계산을 한 글자씩 옮김(20261008a). DOM·라이브러리 없음.
// 다른 점: 봉 배열을 인자로, 값을 돌려줌, 보조 창 정렬은 부르는 쪽이 null 자리를 빈 점으로(N chart:228은 걸러 어긋남).
// 가격 꼴 precisionFor·fmtPrice = N chart:40-51. 설명줄 = N chart:262·265·271·287·301의 글자(<b> 태그 없이 — CSP, spec §4.8).
// 대조 시험 test/indicators.test.mjs(참조본 test/fixtures/n-ind-ref.mjs·golden test/fixtures/ind-golden.json), 옮김 확인 tools/check_ind_ref.mjs.
export function precisionFor(px) {
  if (!Number.isFinite(px) || px <= 0) return 2;
  if (px >= 1000) return 1;
  if (px >= 100) return 2;
  if (px >= 1) return 3;
  if (px >= 0.01) return 5;
  return 7;
}
export function fmtPrice(px) {
  const p = precisionFor(px);
  return Number(px).toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p });
}
export function sma(vals, n) { const out = new Array(vals.length).fill(null); let s = 0; for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
export function ema(vals, n) { const out = new Array(vals.length).fill(null); const k = 2 / (n + 1); let e = null; for (let i = 0; i < vals.length; i++) { e = e == null ? vals[i] : vals[i] * k + e * (1 - k); if (i >= n - 1) out[i] = e; } return out; }
export function bbands(vals, n, mult) {
  const mid = sma(vals, n); const up = new Array(vals.length).fill(null); const lo = new Array(vals.length).fill(null);
  for (let i = n - 1; i < vals.length; i++) { let ss = 0; for (let j = i - n + 1; j <= i; j++) ss += (vals[j] - mid[i]) ** 2; const sd = Math.sqrt(ss / n); up[i] = mid[i] + mult * sd; lo[i] = mid[i] - mult * sd; }
  return { mid, up, lo };
}
export function rsi(vals, n) {
  const out = new Array(vals.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1]; const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
export function macd(vals) {
  const f = ema(vals, 12), sl = ema(vals, 26); const line = vals.map((_, i) => (f[i] != null && sl[i] != null ? f[i] - sl[i] : null));
  const first = line.findIndex((x) => x != null);
  const valid = line.map((x) => (x == null ? 0 : x)); const sig0 = ema(valid, 9);
  const sig = line.map((x, i) => (x == null || i < first + 8 ? null : sig0[i]));
  const hist = line.map((x, i) => (x == null || sig[i] == null ? null : x - sig[i]));
  return { line, sig, hist };
}

export const STD_KEYS = Object.freeze(['ma20', 'ma50', 'ma200', 'ema20', 'bb', 'vol', 'rsi', 'macd']);
export const STD_DEFAULT = Object.freeze({ ma20: true, ma50: false, ma200: false, ema20: false, bb: true, vol: true, rsi: false, macd: false });
export const STD_MIN_BARS = Object.freeze({ ma20: 20, ma50: 50, ma200: 200, ema20: 20, bb: 20, vol: 1, rsi: 15, macd: 35 });
// N chart:260·265·268-269·275·282·294-295·299
export const STD_COLORS = Object.freeze({
  ma20: '#f5a623', ma50: '#4a9de8', ma200: '#c678dd', ema20: '#56d4c8',
  bbOuter: 'rgba(154,164,255,.9)', bbMid: 'rgba(154,164,255,.45)',
  volUp: 'rgba(63,185,80,.45)', volDown: 'rgba(248,81,73,.45)',
  rsi: '#ffd166', macdLine: '#ff8fab', macdSig: '#4a9de8', macdUp: 'rgba(63,185,80,.6)', macdDown: 'rgba(248,81,73,.6)',
});
const NAME = { ma20: 'MA20', ma50: 'MA50', ma200: 'MA200', ema20: 'EMA20', bb: 'BB', rsi: 'RSI', macd: 'MACD' };

// 켜진 지표(inds)만 계산 — 최소 봉 수가 안 차면 그 지표 자리는 없고 설명줄에 "{지표} 봉 부족"(spec §4.8). 설명줄 순서 = N(MA·EMA·BB·RSI·MACD)
export function computeStd(bars, inds) {
  const c = bars.map((b) => b.c);
  const n = bars.length;
  const out = { lines: {}, legend: [] };
  const short = (k) => out.legend.push({ key: k, text: `${NAME[k]} 봉 부족` });
  for (const [k, len] of [['ma20', 20], ['ma50', 50], ['ma200', 200]]) {
    if (!inds[k]) continue;
    if (n < len) { short(k); continue; }
    const a = sma(c, len);
    out.lines[k] = a;
    if (a.at(-1) != null) out.legend.push({ key: k, text: `${NAME[k]} ${fmtPrice(a.at(-1))}` });
  }
  if (inds.ema20) {
    if (n < 20) short('ema20');
    else { const a = ema(c, 20); out.lines.ema20 = a; out.legend.push({ key: 'ema20', text: `EMA20 ${fmtPrice(a.at(-1))}` }); }
  }
  if (inds.bb) {
    if (n < 20) short('bb');
    else { const b = bbands(c, 20, 2); out.bb = b; if (b.up.at(-1) != null) out.legend.push({ key: 'bb', text: `BB ${fmtPrice(b.up.at(-1))} / ${fmtPrice(b.lo.at(-1))}` }); }
  }
  if (inds.vol && bars.some((b) => Number(b.v) > 0)) out.vol = bars.map((b) => ({ value: Number(b.v) || 0, color: b.c >= b.o ? STD_COLORS.volUp : STD_COLORS.volDown }));
  if (inds.rsi) {
    if (n < 15) short('rsi');
    else { const r = rsi(c, 14); out.rsi = r; if (r.at(-1) != null) out.legend.push({ key: 'rsi', text: `RSI ${r.at(-1).toFixed(1)}` }); }
  }
  if (inds.macd) {
    if (n < 35) short('macd');
    else { const m = macd(c); out.macd = m; if (m.hist.at(-1) != null) out.legend.push({ key: 'macd', text: `MACD ${m.line.at(-1).toFixed(2)} / ${m.sig.at(-1).toFixed(2)}` }); }
  }
  return out;
}

// 설명줄 조각만(spec §4.1 내보냄 목록) — 그리는 쪽은 textContent + 지표별 클래스로 넣는다
export function legendStd(bars, inds) { return computeStd(bars, inds).legend; }
