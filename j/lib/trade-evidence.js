// 트레이딩 탭 분석 근거 창의 계산(순수 — 대표 2026-10-23, .superpowers/next-trade-evidence-2026-10-23.md). 사무실 lite(trading-floor-site-p43
// lite/evidence.js — 커밋 01b820c·a70adc2, PC판 동업자 public/trade.js chartEvidence 식)를 그대로 옮겼다 — 같은 봉이면 같은 글(test/app-trade-evidence가
// 그 저장소가 있으면 글자까지 대조). 봉 = 허브 /v1/candles 5분봉(해외 거래소 공개 시세 — 다른 거래소 이름은 쓰지 않음), 24h 고저는 그 봉에서,
// 마크·가격은 이 기기 키가 받는 오렌지엑스 시세(없으면 마크 줄 없음). 판정 → 주문으로 잇는 말은 없다(보안 규칙 22)
export const EV_TEXT = Object.freeze({
  title: '분석 근거', close: '닫기',
  chart: '■ 차트 근거', chartSub: '해외 거래소 공개 시세 5분봉 · 실시간 계산', chartWait: '차트 데이터 수신 중', chartNone: '차트 데이터를 받지 못했습니다',
  news: '■ 뉴스 근거', newsNone: '이번 분석에서 받은 기사가 없습니다', newsLink: '원문 ↗',
  debate: '■ 토론 결론', bull: '🐂 BULL 매수 근거', bear: '🐻 BEAR 매도 근거', debateNone: '토론 결과 없음',
});
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export function fmtP(n) {
  const a = Math.abs(n);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function ema(arr, n) { const k = 2 / (n + 1); let e = null; const out = []; for (const x of arr) { e = e == null ? x : x * k + e * (1 - k); out.push(e); } return out; }
function rsi(closes, n = 14) { const a = 1 / n; let up = 1e-9; let dn = 1e-9; for (let i = 1; i < closes.length; i += 1) { const ch = closes[i] - closes[i - 1]; up = a * Math.max(ch, 0) + (1 - a) * up; dn = a * Math.max(-ch, 0) + (1 - a) * dn; } return 100 - 100 / (1 + up / dn); }

// lite chartEvidence와 같은 식 — bars: 5분봉 [{t,o,h,l,c,v}](마지막은 진행 중), tk: { high24h, low24h, mark, price } | null → [{ k, t, link }]
export function chartEvidence(bars, tk, fmt = fmtP) {
  const items = [];
  if (!Array.isArray(bars) || bars.length < 60) return items;
  const done = bars.slice(0, -1);
  const closes = done.map((b) => b.c);
  const px = bars[bars.length - 1].c;
  const box = done.slice(-12);
  const h12 = Math.max(...box.map((b) => b.h));
  const l12 = Math.min(...box.map((b) => b.l));
  const mid = (h12 + l12) / 2;
  const boxw = ((h12 - l12) / mid) * 100;
  if (px >= h12) items.push({ k: 'box', t: `1H 박스 상단 ${fmt(h12)} 돌파 (돌파폭 +${((px / h12 - 1) * 100).toFixed(2)}%)`, link: '1차 진입 기준선' });
  else if (px <= l12) items.push({ k: 'box', t: `1H 박스 하단 ${fmt(l12)} 이탈 (이탈폭 ${((px / l12 - 1) * 100).toFixed(2)}%)`, link: '1차 진입 기준선' });
  else items.push({ k: 'box', t: `1H 박스 ${fmt(l12)} ~ ${fmt(h12)} 안 (폭 ${boxw.toFixed(2)}%)`, link: '돌파 대기 구간' });
  const r = rsi(closes.slice(-99));
  items.push({ k: 'rsi', t: `5m RSI14 ${r.toFixed(1)} · ${r < 35 ? '과매도권' : r > 65 ? '과매수권' : '과열 전 구간'}`, link: r < 35 || r > 65 ? '2차 조건(RSI) 근접' : '2차 조건(RSI) 여유' });
  const c20 = closes.slice(-20);
  const m = c20.reduce((a, b) => a + b, 0) / 20;
  const sd = Math.sqrt(c20.reduce((a, x) => a + (x - m) ** 2, 0) / 20);
  items.push({ k: 'boll', t: `볼린저(20,2σ) 상단 ${fmt(m + 2 * sd)} · 하단 ${fmt(m - 2 * sd)} · 중심 ${fmt(m)}`, link: '3·4차 조건선 기준' });
  const e20 = ema(closes, 20).pop();
  const e50 = ema(closes, 50).pop();
  const e200 = closes.length >= 200 ? ema(closes, 200).pop() : null;
  const align = e200 == null ? (e20 > e50 ? '20>50 상승 배열' : '20<50 하락 배열') : (e20 > e50 && e50 > e200 ? '정배열' : e20 < e50 && e50 < e200 ? '역배열' : '혼조');
  items.push({ k: 'ema', t: `EMA 20/50${e200 != null ? '/200' : ''} ${align} (${fmt(e20)} / ${fmt(e50)}${e200 != null ? ` / ${fmt(e200)}` : ''})`, link: '추세 방향' });
  const m15 = closes.length > 3 ? (closes[closes.length - 1] / closes[closes.length - 4] - 1) * 100 : 0;
  items.push({ k: 'mom', t: `15분 모멘텀 ${m15 >= 0 ? '+' : ''}${m15.toFixed(2)}%`, link: m15 >= 0 ? '상방 압력' : '하방 압력' });
  const v20 = done.slice(-20).reduce((a, b) => a + (b.v || 0), 0) / 20;
  const vl = done[done.length - 1].v || 0;
  if (v20 > 0) items.push({ k: 'vol', t: `거래량 20봉 평균 대비 ${(vl / v20).toFixed(1)}배`, link: vl / v20 >= 1.5 ? '돌파 신뢰 ↑' : '거래량 평이' });
  if (tk) {
    if (fin(tk.high24h) && fin(tk.low24h)) items.push({ k: 'hl', t: `24h 고가 ${fmt(tk.high24h)} · 저가 ${fmt(tk.low24h)}`, link: '당일 범위' });
    if (fin(tk.mark) && fin(tk.price) && tk.mark > 0) {
      const gap = (tk.price / tk.mark - 1) * 100;
      items.push({ k: 'mark', t: `마크 대비 괴리 ${gap >= 0 ? '+' : ''}${gap.toFixed(3)}%`, link: Math.abs(gap) < 0.05 ? '과열 아님' : '괴리 주의' });
    }
  }
  return items;
}

// 셸에는 24시간 시세표가 없다 — 24h 고저는 받은 5분봉의 마지막 봉 기준 24시간 안 봉에서, 마크·가격은 넘겨받은 오렌지엑스 값(둘 다 있어야 괴리 줄)
export function tickerFromBars(bars, { mark = null, price = null } = {}) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const last = bars[bars.length - 1].t;
  const day = bars.filter((b) => b && fin(b.t) && b.t > last - 86400000);
  return {
    high24h: day.length ? Math.max(...day.map((b) => b.h)) : null,
    low24h: day.length ? Math.min(...day.map((b) => b.l)) : null,
    mark: fin(mark) && mark > 0 ? mark : null,
    price: fin(price) && price > 0 ? price : null,
  };
}

// 지금 기준 지난 시간 — PC판 기사 줄의 'N분 전' 꼴
export function ageOf(at, now) {
  if (!fin(at) || at <= 0) return '';
  const d = now - at;
  if (!(d >= 60000)) return '방금';
  if (d < 3600000) return `${Math.floor(d / 60000)}분 전`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}시간 전`;
  return `${Math.floor(d / 86400000)}일 전`;
}

// lite cleanNews와 같은 결과 — 분석 news 칸 { source, title, at, link } → [{ source, title, age, link }] — https 링크만, 최대 10
export function evidenceNews(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  const s = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  return list.slice(0, 20).map((n) => {
    if (!isObj(n)) return null;
    const title = s(n.title, 200);
    if (!title) return null;
    let link = '';
    try { const u = new URL(String(n.link || '')); if (u.protocol === 'https:') link = u.href; } catch { link = ''; }
    return { source: s(n.source, 30) || '뉴스', title, age: fin(n.at) ? ageOf(n.at, now) : s(n.age, 20), link };
  }).filter(Boolean).slice(0, 10);
}

// 셸 화면 규칙 — '대표'가 든 문장은 뺀다(trade-view noBoss와 같은 자르기)
function noBoss(s) {
  if (typeof s !== 'string') return '';
  if (!/대표/.test(s)) return s;
  return s.split(/(?<=[.!?。…])\s+|\n+/).filter((x) => x.trim() && !/대표/.test(x)).join(' ').trim();
}
// 토론 결론 — 그 분석의 마지막 BULL·BEAR 말(lite와 같이 말풍선, 없으면 보고 글)
export function evidenceDebate(a) {
  const out = { bull: '', bear: '' };
  for (const t of isObj(a) && Array.isArray(a.turns) ? a.turns : []) {
    if (!isObj(t) || (t.id !== 'bull' && t.id !== 'bear')) continue;
    const text = noBoss(typeof t.bubble === 'string' && t.bubble.trim() ? t.bubble : typeof t.report === 'string' ? t.report : '');
    if (text) out[t.id] = text;
  }
  return out;
}
