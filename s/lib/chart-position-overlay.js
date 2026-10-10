// 트레이딩 탭 큰 차트 위 운영 측 자동매매 포지션(p40, 대표 결정 2026-10-10) — 회원 송출(가격 포함, s·j판 인증 회원)의
// 열린 포지션·최근 매매 흐름을 차트 종목·시간 단위에 맞춰 선(평단·익절·청산가)과 캔들 마커(체결 N차·끝)로 바꾼다.
// 순수 함수(positionOverlay·overlaySource·mergeChartMarkers)와 선을 시리즈에 붙이는 얇은 층(createPositionLines)만 — 어느 탭이
// 포지션 목록을 그리는지와 무관하다(자동매매 탭을 트레이딩 탭으로 합친 뒤 — 대표 결정 2026-10-10 — 에도 그대로 쓴다).
// 그리지 않는 것: 손절가(신호 손절 — 대표가 고르지 않음), 회원 자기 자동 손절(CLAUDE.md 규칙 18 — 값이 어디에도 없다), 회원 자기 거래소 포지션,
// 리허설 포지션. 값은 메모리에만 — 저장·요청 없음.
import { toChartTime } from './chart-draw.js';
import { instOf } from './trade-view.js';

export const OVERLAY_CAP = 30; // 마커 상한 — 열린 매매 것은 늘 두고, 끝난 매매는 최근 것부터 매매 단위로
export const OVERLAY_TF_MS = Object.freeze({ '5m': 300000, '15m': 900000, '1h': 3600000 }); // = chart-feed TF_MS
export const OVERLAY_TEXT = Object.freeze({
  avg: '평단',
  tp: '익절',
  liq: '청산가',
  fill: (n) => `${n}차`,
  manual: '직접 추가', // 운영 측 직접 추가 진입(열린 포지션 카드 체결 줄 auto-view fillLine과 같은 낱말·같은 규칙)
  entry: '진입', // 차수·체결 번호를 모르는 진입
  end: Object.freeze({ tp: '익절', close: '정리', liq: '청산', sl: '손절' }),
});
export const OVERLAY_COLORS = Object.freeze({
  avg: '#c8c8dc', // 중립(회원 자기 평단 금색 #f5a623과 다름)
  tp: '#3fb950',
  liq: '#f0883e',
  entry: '#58a6ff',
  end: Object.freeze({ tp: '#3fb950', close: '#a0a0b8', liq: '#f0883e', sl: '#f85149', bad: '#f85149' }),
});
export const EMPTY_OVERLAY = Object.freeze({ lines: Object.freeze([]), markers: Object.freeze([]) });

const SYM_RE = /^[A-Z0-9]{1,20}$/;
const LINE_KINDS = Object.freeze(['avg', 'tp', 'liq']);
const LINE_STYLES = Object.freeze([2, 3, 1, 4]); // v4 LineStyle: 2 Dashed · 3 LargeDashed · 1 Dotted · 4 SparseDotted — 같은 종목 포지션마다 다르게
const FILL_KINDS = Object.freeze(['entry', 'dca']);
const END_MARK_KINDS = Object.freeze(['tp', 'close', 'liq', 'sl']); // 끝 마커를 그리는 종류
const END_KINDS = Object.freeze([...END_MARK_KINDS, 'untracked', 'lost']); // 이것이 흐름에 있으면 그 매매는 끝(선 지움)
const SIDE = Object.freeze({
  long: Object.freeze({ position: 'belowBar', shape: 'arrowUp', exit: 'aboveBar' }),
  short: Object.freeze({ position: 'aboveBar', shape: 'arrowDown', exit: 'belowBar' }),
});

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const okId = (v) => typeof v === 'string' && v !== '' && v.length <= 64;
const okPrice = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e15;
const okAt = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 8.64e15;
const posInt = (n) => Number.isInteger(n) && n > 0;
const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const seqOf = (e) => (Number.isInteger(e.seq) ? e.seq : -1);
// 앱의 다른 곳(따라가기 엔진)과 같은 맞춤: inst가 있으면 그것, 없으면 symbol → <SYM>-USDT-PERPETUAL
function instOfItem(x) {
  if (typeof x.inst === 'string' && x.inst) return x.inst;
  return typeof x.symbol === 'string' && SYM_RE.test(x.symbol) ? instOf(x.symbol) : null;
}
const fillKey = (f) => (posInt(f.fill) ? `f${f.fill}` : `a${f.at}`);
// 진입(흐름 kind 'entry' · 상태 체결 1번)은 manual이어도 차수 — 허브는 직접 연 매매(origin manual)의 진입 체결에도 manual:true를 붙이고,
// 최근 매매 흐름은 그것을 'N차 진입'으로 쓴다(auto-view entryHead). '직접 추가'는 추가 진입(dca)만(흐름 '직접 추가 진입'과 같게)
const isEntryFill = (f) => f.kind === 'entry' || f.fill === 1;
function fillText(f) {
  if (f.manual === true && !isEntryFill(f)) return OVERLAY_TEXT.manual;
  if (posInt(f.stage)) return OVERLAY_TEXT.fill(f.stage);
  if (posInt(f.fill)) return OVERLAY_TEXT.fill(f.fill);
  return OVERLAY_TEXT.entry;
}
function endColor(e) {
  if (e.kind !== 'close') return OVERLAY_COLORS.end[e.kind];
  const v = e.resultPct;
  if (typeof v === 'number' && v > 0) return OVERLAY_COLORS.end.tp;
  if (typeof v === 'number' && v < 0) return OVERLAY_COLORS.end.bad;
  return OVERLAY_COLORS.end.close;
}

// 회원 송출 스냅샷(member-feed — member:true)에서만 그릴 거리를 꺼낸다. 공개 송출(가격 없음)·null·다시 채우는 중(loaded:false — 숨어 있던 동안
// 닫혔을 수 있는 옛 상태)·상태 없음은 null. 리허설(시험 토큰의 연습 신호)은 넘기지 않는다
export function overlaySource(snap) {
  if (!isObj(snap) || snap.member !== true || snap.loaded === false) return null;
  const st = isObj(snap.state) ? snap.state : null;
  if (!st) return null;
  return { positions: Array.isArray(st.open) ? st.open : [], events: Array.isArray(snap.events) ? snap.events : [] };
}

// (열린 포지션, 최근 흐름 이벤트, 차트 종목, 시간 단위) → { lines, markers }
// lines: [{ key, kind, id, price, title, color, lineWidth, lineStyle, axisLabelVisible }] — 열린 시각 순, 같은 종목 여럿이면 제목에 번호
// markers: [{ time(차트 시각 — 체결 시각이 든 봉), position, shape, color, text, size }] — 시각 순
export function positionOverlay({ positions = [], events = [], symbol, tf, cap = OVERLAY_CAP } = {}) {
  if (typeof symbol !== 'string' || !SYM_RE.test(symbol)) return EMPTY_OVERLAY;
  const want = instOf(symbol);
  const evs = list(events).filter((e) => okId(e.id));
  const ended = new Set(evs.filter((e) => END_KINDS.includes(e.kind)).map((e) => e.id));
  const onChart = list(positions).filter((p) => okId(p.id) && instOfItem(p) === want);
  const at0 = (p) => (okAt(p.openedAt) ? p.openedAt : Infinity);
  const open = onChart.filter((p) => !ended.has(p.id)).sort((a, b) => at0(a) - at0(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const lines = [];
  open.forEach((p, k) => {
    const n = open.length > 1 ? ` ${k + 1}` : '';
    const lineStyle = LINE_STYLES[k % LINE_STYLES.length];
    for (const kind of LINE_KINDS) {
      if (!okPrice(p[kind])) continue;
      lines.push({ key: `${p.id}|${kind}`, kind, id: p.id, price: p[kind], title: `${OVERLAY_TEXT[kind]}${n}`, color: OVERLAY_COLORS[kind], lineWidth: 1, lineStyle, axisLabelVisible: true });
    }
  });

  const step = OVERLAY_TF_MS[tf];
  if (!step) return lines.length ? { lines, markers: [] } : EMPTY_OVERLAY;
  const time = (at) => toChartTime(Math.floor(at / step) * step);
  const fillMark = (f, side) => ({ time: time(f.at), position: side.position, shape: side.shape, color: OVERLAY_COLORS.entry, text: fillText(f), size: 1 });
  const endMark = (e, side) => ({ time: time(e.at), position: side.exit, shape: 'circle', color: endColor(e), text: OVERLAY_TEXT.end[e.kind], size: 1 });

  // 열린 매매: 회원 상태의 체결(fills) + 흐름의 진입 이벤트(상태 fills가 덜 왔을 때) — 체결 번호로 한 번만
  const openIds = new Set(open.map((p) => p.id));
  const openMarks = [];
  for (const p of open) {
    const side = SIDE[p.side];
    if (!side) continue;
    const fills = new Map();
    for (const f of list(p.fills)) if (okAt(f.at) && !fills.has(fillKey(f))) fills.set(fillKey(f), f);
    for (const e of evs) if (e.id === p.id && FILL_KINDS.includes(e.kind) && okAt(e.at) && !fills.has(fillKey(e))) fills.set(fillKey(e), e);
    for (const f of fills.values()) openMarks.push(fillMark(f, side));
  }

  // 그 밖의 이 종목 매매(끝난 것 — 흐름에 있는 것, 상태에 남은 닫힌 포지션의 체결 포함)
  const groups = new Map();
  const group = (id) => {
    if (!groups.has(id)) groups.set(id, { side: null, fills: new Map(), end: null, last: -Infinity });
    return groups.get(id);
  };
  for (const p of onChart) {
    if (openIds.has(p.id)) continue;
    const g = group(p.id);
    if (SIDE[p.side]) g.side = p.side;
    for (const f of list(p.fills)) if (okAt(f.at) && !g.fills.has(fillKey(f))) { g.fills.set(fillKey(f), f); g.last = Math.max(g.last, f.at); }
  }
  for (const e of evs) {
    if (openIds.has(e.id) || !okAt(e.at) || instOfItem(e) !== want) continue;
    const fill = FILL_KINDS.includes(e.kind);
    const end = END_MARK_KINDS.includes(e.kind);
    if (!fill && !end) continue;
    const g = group(e.id);
    if (!g.side && SIDE[e.side]) g.side = e.side;
    if (fill && !g.fills.has(fillKey(e))) g.fills.set(fillKey(e), e);
    if (end && (!g.end || seqOf(e) > seqOf(g.end))) g.end = e;
    g.last = Math.max(g.last, e.at);
  }
  const room = Math.max(0, (Number.isInteger(cap) && cap >= 0 ? cap : OVERLAY_CAP) - openMarks.length);
  const rest = [];
  for (const g of [...groups.values()].filter((x) => x.side).sort((a, b) => b.last - a.last)) {
    const side = SIDE[g.side];
    const marks = [...[...g.fills.values()].map((f) => fillMark(f, side)), ...(g.end ? [endMark(g.end, side)] : [])];
    if (!marks.length) continue;
    if (rest.length + marks.length > room) break;
    rest.push(...marks);
  }
  const markers = [...openMarks, ...rest].sort((a, b) => a.time - b.time);
  return lines.length || markers.length ? { lines, markers } : EMPTY_OVERLAY;
}

// 캔들 시리즈 마커는 한 목록(v4 setMarkers는 시각 순만 받는다) — 지표 마커(mergeMarkers 결과, 이미 차트 시각·시각 순)에 포지션 마커를 더해
// 시각 순으로. 받은 봉 범위 밖 포지션 마커는 버린다(라이브러리가 가장 가까운 봉에 붙이지 않게). 같은 시각은 지표 마커가 먼저(안정 정렬)
export function mergeChartMarkers(base, extra, bars) {
  const out = Array.isArray(base) ? base.slice() : [];
  if (Array.isArray(bars) && bars.length && Array.isArray(extra) && extra.length) {
    const lo = toChartTime(bars[0].t);
    const hi = toChartTime(bars[bars.length - 1].t);
    for (const m of extra) if (m && m.time >= lo && m.time <= hi) out.push(m);
  }
  return out.sort((a, b) => a.time - b.time);
}

// 선을 캔들 시리즈에 — 키별로 하나. 같은 값이면 그대로(중복 없음), 값이 바뀌면 그 선만 applyOptions(없으면 지우고 다시), 빠진 키는 지움.
// 시리즈가 바뀌면(차트를 다시 만듦) 옛 선을 지우고 새 시리즈에 만든다. 라이브러리에는 선 옵션만 넘긴다
const lineOptions = (l) => ({ price: l.price, color: l.color, lineWidth: l.lineWidth, lineStyle: l.lineStyle, lineVisible: true, axisLabelVisible: l.axisLabelVisible === true, title: l.title });
export function createPositionLines() {
  let series = null;
  const live = new Map(); // key → { pl, sig }
  const drop = (pl) => {
    try { series.removePriceLine(pl); } catch { /* 이미 없음 */ }
  };
  function clear() {
    if (series) for (const v of live.values()) drop(v.pl);
    live.clear();
  }
  function apply(s, lines) {
    if (s !== series) {
      clear();
      series = s || null;
    }
    if (!series) return;
    const want = new Map((Array.isArray(lines) ? lines : []).filter((l) => l && typeof l.key === 'string').map((l) => [l.key, l]));
    for (const [k, v] of [...live]) if (!want.has(k)) { drop(v.pl); live.delete(k); }
    for (const [k, l] of want) {
      const opts = lineOptions(l);
      const sig = JSON.stringify(opts);
      const cur = live.get(k);
      if (cur && cur.sig === sig) continue;
      if (cur && cur.pl && typeof cur.pl.applyOptions === 'function') {
        cur.pl.applyOptions(opts);
        cur.sig = sig;
        continue;
      }
      if (cur) drop(cur.pl);
      live.set(k, { pl: series.createPriceLine(opts), sig });
    }
  }
  return { apply, clear, size: () => live.size };
}
