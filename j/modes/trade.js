// 트레이딩 탭(spec §2·§3·§4) — ⚡ 오토 모드 카드·종목 줄·차트 머리(상태줄·시간 단위·지표 칩)·설명줄·큰 차트(+백테스트 표)·보조 창·출처 줄·
// 판정 상자·주문 칸·열린 포지션 목록. 판정 상자·주문 칸·시트는 onOrderSlot 자리만 준다 — 채우는 것은 app.js(판정 screens/trade-verdict.js,
// 주문 칸 modes/trade-orders.js — p40 T12·T13). 이 파일은 주문을 내지 않는다(주문 선·체결 화살표는 chartApi로 받아 그리기만).
// 대표 결정 2026-10-10: 자동매매 탭을 이 탭으로 합쳤다(맨 위 [사무실] [트레이딩] [⚙]). 위에서 아래로
//  ① '⚡ 오토 모드' 카드(.trade-auto, 탭 맨 위·차트 위): 켜기·끄기 줄 자리(follow — screens/trade-follow.js, s·j판 따라가기 자격이 있을 때만 app.js가 채움.
//    채우면 그 줄이 제목을 갖고 카드 제목 h2는 숨음 — app.css) · 제목 · 송출 자리(auto — modes/auto.js 카드 자리: 상태 줄·오토 종목·인증 입구)
//  ② 종목 칩·내 포지션 칩·시간 단위·지표 칩·차트(운영 측 포지션 선·마커)·보조 창·출처 줄(그대로)
//  ③ 판정 상자·주문 칸·시트 자리(p40-trade 자리 그대로)
//  ④ 열린 포지션 목록 자리(positions — modes/auto.js 목록 자리: 열린 포지션·가격 안내·최근 매매 흐름·성적·새 매매 알림 스위치·내 따라가기 설정)
// 법정 고지 다섯 줄(TEXT.legal)은 자동매매 탭 고지 박스를 뺀 결정(2026-10-10)을 따라 이 탭에도 두지 않는다. 이 파일은 비어 있는 자리만 만든다.
// 패널에 먼저 있던 것(새 매매 알림 #auto-alert — index.html, 패널 맨 앞)은 그대로 두고 그 뒤에 붙인다.
// 라이브러리는 탭을 처음 열 때 <script src="vendor/…">로 붙인다(CSP script-src 'self'). DOM은 createElement·textContent만(style 속성 없음).
// 만들기만 하면 아무것도 받지 않는다 — 허브 봉·종목 목록·차트 WS는 탭이 처음 보일 때부터, 숨으면 멈춘다(spec §2.1·§3.3).
import { computeStd, STD_COLORS, precisionFor } from '../lib/indicators.js';
import { createChartFeed } from '../lib/chart-feed.js';
import { createChartTicker } from '../lib/chart-ticker.js';
import { fetchCandles, fetchInstruments } from '../lib/hub.js';
import { createScenePrimitive, mergeScenes, EMPTY_SCENE, toChartTime } from '../lib/chart-draw.js';
import { mergeMarkers, deltaMarks, fillArrows } from '../lib/chart-markers.js';
import { overlaySource, positionOverlay, mergeChartMarkers, createPositionLines, EMPTY_OVERLAY } from '../lib/chart-position-overlay.js';
import { tradeRulesOf } from '../lib/trade-rules.js';
import { TEXT as AUTO_TEXT, memberCapable } from '../lib/auto-view.js';
import {
  chipDefs, loadInds, saveInds, loadView, saveView, needsLong, statusLine, chartState, keepRange, planUpdate, instOf,
  SOURCE_PARTS, NOTICE_LINE, tabLabel, mineChipText, subPanes, TF_KEYS, TF_LABEL, SUB_LABELS, BACKTEST_HEAD, IND_HELP, indFailText,
} from '../lib/trade-view.js';

const LIB = 'vendor/lightweight-charts.standalone.production.js';
// 대표 지표는 칩이 켜질 때 그 파일만 불러온다(spec §4.2). indicators.custom:false 빌드에는 파일·칩이 없다
export const IND_MODS = Object.freeze({ bigs: '../lib/ind/big-sales.js', tpsl: '../lib/ind/tpsl-guide.js', delta: '../lib/ind/delta.js', vp: '../lib/ind/vp-box.js', follow: '../lib/ind/follow-line.js' });
const LIVE_STD_MS = 2000; // 시세 틱으로는 캔들만, 지표는 최대 2초에 한 번(spec §3.3)
// 상태줄 '실시간 · 가격'의 가격은 오렌지엑스 시세가 이만큼 안에 왔을 때만(N은 10초 갱신이 머리 가격을 늘 새로 씀 — 우리 허브 봉은 해외 시세라
// 오렌지엑스 가격으로 대신 보이지 않고 가격을 뺀다). 숨김·WS 끊김이면 그 자리에서 지운다
export const LIVE_PX_FRESH_MS = 15000;
const INST_RETRY_MS = 60000; // 종목 목록을 못 받았으면 1분 뒤 다시(그동안 '실시간 시세 없음')
const SYM_RE = /^[A-Z0-9]{1,20}$/;
// N 큰 차트 설정(N chart:58-71) + 로고 끔(CSP — 출처 줄 T-08·T-15로 조건을 채움) + 크기는 라이브러리 autoSize(ResizeObserver)
const BASE_OPTS = {
  autoSize: true,
  layout: { background: { type: 'solid', color: '#06060c' }, textColor: '#a0a0b8', fontFamily: 'Galmuri11, monospace', fontSize: 12, attributionLogo: false },
  grid: { vertLines: { color: '#10101a' }, horzLines: { color: '#10101a' } },
  rightPriceScale: { borderColor: '#1c1c28', scaleMargins: { top: 0.1, bottom: 0.08 } },
  timeScale: { borderColor: '#1c1c28', timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 10 },
  crosshair: { mode: 0, vertLine: { color: '#3a3a52', labelBackgroundColor: '#2a2a3c' }, horzLine: { color: '#3a3a52', labelBackgroundColor: '#2a2a3c' } }, // 0 = CrosshairMode.Normal
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  localization: { locale: 'ko-KR' },
};
// 보조 창(N makeSub chart:236-244) — 세로 끌기는 페이지 스크롤로(spec §3.1 ②), 시간축 숨김
const SUB_OPTS = {
  ...BASE_OPTS,
  layout: { ...BASE_OPTS.layout, textColor: '#8a8aa4', fontSize: 10 },
  timeScale: { ...BASE_OPTS.timeScale, visible: false },
  rightPriceScale: { borderColor: '#1c1c28', scaleMargins: { top: 0.15, bottom: 0.1 } },
};
const CANDLE_OPTS = { upColor: '#3fb950', downColor: '#f85149', borderUpColor: '#3fb950', borderDownColor: '#f85149', wickUpColor: '#3fb950', wickDownColor: '#f85149', priceLineVisible: true, priceLineWidth: 1, priceLineStyle: 1 };
const FLAT = { priceLineVisible: false, lastValueVisible: false };

export function createTradeMode({
  doc = globalThis.document, win = globalThis.window, config, storage, hubBase = config.hub, oxWsUrl = config.oxWs,
  onOrderSlot = () => {}, onSymbol = () => {},
  timers = globalThis, now = () => Date.now(), WebSocketImpl = globalThis.WebSocket,
  loadCandles = (q) => fetchCandles({ base: hubBase, ...q }),
  loadInstruments = () => fetchInstruments(hubBase),
  importInd = (k) => import(IND_MODS[k]),
}) {
  const rules = tradeRulesOf(config);
  const ed = config.edition;
  // 기기 저장(지표 켜짐·종목·시간 단위)만 — 토큰·키·장부는 여기 두지 않는다. 막힌 저장소는 읽기·쓰기 모두 기본값으로(trade-view가 감쌈)
  const store = storage || { getItem: (k) => win.localStorage.getItem(k), setItem: (k, v) => win.localStorage.setItem(k, v) };
  const view = loadView(store, ed, rules);
  let sym = view.sym[view.tab];
  let tf = view.tf;
  let inds = loadInds(store, ed, rules);
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let panel = null, built = false, visible = false, showSeq = 0, LW = null, libP = null;
  let big = null, candles = null, scene = null;
  const lines = {}; // 큰 차트 선·막대 시리즈(키 → 시리즈)
  const subs = {}; // 보조 창(rsi·macd·delta → { el, chart, series, unlink })
  let cur = []; // 지금 그린 봉(피드 배열)
  let shownT = []; // 캔들 시리즈에 들어 있는 봉 시각
  let resetView = true; // 다음 전체 봉에서 최근 봉으로(처음·종목·시간 단위 변경 — spec §3.1 ①)
  let lastStdAt = -Infinity;
  let tpslMemo = null; // TP/SL GUIDE는 마감 봉만 — 마감 봉이 바뀔 때만 다시(spec §4.2)
  const mods = {}; // 지표 키 → 모듈 | 'loading' | 'failed'
  let insts = null, instAt = -Infinity, instBusy = false; // 실시간 구독 가능 종목(instruments active)
  let liveOk = null; // 지금 종목 실시간 — true | false | null(모름)
  let tickerOn = false;
  let orderSpec = null, priceLines = [];
  let fillState = { symbol: null, side: 'long', list: [] }; // 열린 수동 포지션의 체결(Task 25가 setFills로) — 화살표만(N t:432)
  // 운영 측 자동매매 포지션(p40, 대표 결정 2026-10-10) — 회원 송출 스냅샷(app.js onFeed, s·j판 인증 회원만)을 메모리에만.
  // 공용판은 받아도 그리지 않는다. 선(평단·익절·청산가)은 posLines, 마커는 지표 마커(indMarks)와 합쳐 한 목록으로
  const posOk = memberCapable(config);
  let autoPos = null; // { positions, events } | null
  let overlay = EMPTY_OVERLAY;
  let overlaySig = null; // 지난번 붙인 선·마커 — 같으면 다시 붙이지 않음(송출 heartbeat마다 setMarkers 하지 않게)
  let indMarks = []; // 지난 indicators()의 지표 마커(차트 시각)
  const posLines = createPositionLines();
  const ui = { state: 'loading', px: undefined, pxAt: -Infinity };

  const feed = createChartFeed({
    fetchCandles: loadCandles,
    timers,
    now,
    onBars: (bars, info) => render(bars, info),
    onStatus: (s) => {
      ui.state = s;
      head();
      if (s === 'live' && !insts) syncLive(); // 종목 목록을 못 받았으면 봉이 올 때 다시(1분 간격)
    },
  });
  const ticker = createChartTicker({
    url: oxWsUrl,
    WebSocketImpl,
    timers,
    now,
    onPrice: (inst, px) => {
      if (!visible || inst !== instOf(sym)) return;
      ui.px = px;
      ui.pxAt = now();
      feed.live(px);
      head();
    },
    onDown: () => { dropPx(); head(); },
  });
  function dropPx() { ui.px = undefined; ui.pxAt = -Infinity; }

  function loadLib() {
    if (win.LightweightCharts) return Promise.resolve(win.LightweightCharts);
    if (libP) return libP;
    libP = new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = LIB;
      s.addEventListener('load', () => (win.LightweightCharts ? resolve(win.LightweightCharts) : reject(new Error('chart_lib'))));
      s.addEventListener('error', () => reject(new Error('chart_lib')));
      doc.head.append(s);
    });
    libP.catch(() => { libP = null; }); // 다음에 보일 때 다시
    return libP;
  }
  function head() {
    if (!ui.status) return;
    const px = ui.px !== undefined && now() - ui.pxAt <= LIVE_PX_FRESH_MS ? ui.px : undefined;
    ui.status.textContent = statusLine({ sym, tf, state: chartState(ui.state, liveOk), px });
  }
  function press(b, on) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  function markSym() { for (const b of ui.syms || []) press(b, b.dataset.sym === sym); }
  function markTf() { for (const b of ui.tfs || []) b.classList.toggle('on', b.dataset.tf === tf); }
  function markChips() { for (const b of ui.chips || []) press(b, !!inds[b.dataset.ind]); }

  function build() {
    const root = el('div', 'trade');
    // ⓪ ⚡ 오토 모드 카드(2026-10-10 합침) — 켜기·끄기 줄 자리(app.js가 채움, 공용판·자격 없음은 빈칸 = 숨김) · 제목 · 송출 자리(modes/auto.js)
    const card = el('section', 'trade-auto');
    card.setAttribute('aria-label', AUTO_TEXT.title);
    const follow = el('div', 'trade-follow');
    const autoSlot = el('div', 'ta-feed');
    card.append(follow, el('h2', 'ta-title', AUTO_TEXT.title), autoSlot);
    // ① 종목 줄 — T-01 탭(지금은 코인만: 주식 목록이 비면 주식 탭 숨김) · 종목 칩(감시 목록, 가로 스크롤)
    const row = el('div', 'trade-row trade-syms');
    if (rules) row.append(el('span', 'chip tab on', tabLabel('coin', rules)));
    if (rules && rules.tabs.stock.watch.length) row.append(el('span', 'chip tab', tabLabel('stock', rules)));
    ui.syms = (rules ? rules.tabs.coin.watch : ['BTC']).map((s) => {
      const b = el('button', 'chip sym', s);
      b.type = 'button';
      b.dataset.sym = s;
      b.addEventListener('click', () => setSymbol(s));
      return b;
    });
    row.append(...ui.syms);
    markSym();
    ui.mine = el('div', 'trade-row trade-mine'); // T-01 '내 포지션' 칩 — Task 25가 setMine으로(키 연결 회원·열린 포지션 종목만)
    // ② 차트 머리 — 상태줄 T-02 · 시간 단위 T-03 · 지표 칩 T-04 + ?(T-07)
    const chartHead = el('div', 'trade-head');
    ui.status = el('span', 'chart-status');
    const tfs = el('div', 'chart-tfs');
    ui.tfs = TF_KEYS.map((k) => {
      const b = el('button', '', TF_LABEL[k]);
      b.type = 'button';
      b.dataset.tf = k;
      b.addEventListener('click', () => setTf(k));
      return b;
    });
    tfs.append(...ui.tfs);
    markTf();
    const chips = el('div', 'chart-inds');
    ui.chips = chipDefs(rules).map((c) => {
      const b = el('button', '', c.label);
      b.type = 'button';
      b.dataset.ind = c.key;
      b.addEventListener('click', () => toggle(c.key));
      return b;
    });
    markChips();
    const help = el('button', 'chip help', '?');
    help.type = 'button';
    help.setAttribute('aria-expanded', 'false');
    help.addEventListener('click', () => { ui.help.hidden = !ui.help.hidden; help.setAttribute('aria-expanded', String(!ui.help.hidden)); });
    chips.append(...ui.chips, help);
    ui.help = el('p', 'trade-help', IND_HELP);
    ui.help.hidden = true;
    chartHead.append(ui.status, tfs, chips);
    // ③ 설명줄 T-06(최대 2줄 — 누르면 펼침) ④ 큰 차트(왼쪽 위 백테스트 표 T-14) ⑤ 보조 창
    ui.legend = el('div', 'chart-legend');
    ui.legend.addEventListener('click', () => ui.legend.classList.toggle('open'));
    ui.big = el('div', 'chart-big');
    ui.table = el('div', 'bt-table');
    ui.table.hidden = true;
    ui.big.append(ui.table);
    ui.subs = el('div', 'chart-subs');
    // ⑥ 출처 T-08 + NOTICE T-15 — 로고를 끈 대신 NOTICE 문장과 TradingView 링크를 이 화면에(라이브러리 README 조건, 검토 34)
    const src = el('p', 'trade-source', SOURCE_PARTS.text);
    const a = el('a', 'trade-source-link', SOURCE_PARTS.link.text);
    a.href = SOURCE_PARTS.link.href;
    a.rel = 'noopener';
    a.target = '_blank';
    src.append(a);
    const notice = el('p', 'trade-source', NOTICE_LINE);
    const verdict = el('div', 'trade-verdict'); // ⑦ 판정 상자 — 주문 칸 상태와 따로(spec §2.1)
    const orders = el('div', 'trade-orders'); // ⑧~⑪ 주문 칸 — app.js가 채움(modes/trade-orders.js, 5초마다 이 자리만 다시 그림)
    const sheet = el('div', 'trade-sheet'); // 시트 자리 — 주문 칸 밖이라 주기 갱신이 떼었다 붙이지 않는다(입력 초점 유지)
    // ⑫ 열린 포지션·최근 매매 흐름·성적·새 매매 알림·내 따라가기 설정 자리(modes/auto.js 목록 자리) — 아래로 내리면 포지션(대표 2026-10-10)
    const positions = el('div', 'trade-autolist');
    root.append(card, row, ui.mine, chartHead, ui.help, ui.legend, ui.big, ui.subs, src, notice, verdict, orders, sheet, positions);
    panel.append(root); // 패널 맨 앞의 새 매매 알림(#auto-alert)은 그대로
    onOrderSlot({ verdict, orders, sheet, follow, auto: autoSlot, positions });
    head();
  }

  function makeCharts() {
    big = LW.createChart(ui.big, { ...BASE_OPTS, width: ui.big.clientWidth || 0, height: ui.big.clientHeight || 0 });
    candles = big.addCandlestickSeries(CANDLE_OPTS);
    scene = createScenePrimitive();
    candles.attachPrimitive(scene.primitive);
    // 브라우저 시험(Task 16-11)이 '지난 봉을 보는 중엔 안 튐'을 읽는 자리 — 숫자 하나뿐(토큰·가격 없음)
    big.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) ui.big.dataset.rangeTo = String(Math.round(r.to)); });
    if (orderSpec) setOrderLines(orderSpec);
    overlaySig = null;
    refreshOverlay(); // 차트를 만들기 전에 받은 운영 측 포지션
  }

  const T = (bars, i) => toChartTime(bars[i].t);
  // 점 하나를 만드는 함수(i → 점) — 값 없는 봉은 빈 점(보조 창 정렬, spec §4.1 ③)
  const pt = (bars, arr, colorOf) => (i) => { const v = arr[i]; return v == null || !Number.isFinite(v) ? { time: T(bars, i) } : { time: T(bars, i), value: v, ...(colorOf ? { color: colorOf(i) } : {}) }; };
  const toCandle = (b) => ({ time: toChartTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c });
  // 시리즈에 넣기: 캔들과 같은 봉 판(epoch — setCandles·clearChart마다 바뀜)에 이미 n개를 넣었고 바뀐 봉(from)부터면 그 점들만 update,
  // 아니면 setData. 앞 봉 값은 그대로인 계산(이동평균·EMA·RSI·MACD·리치 지표·델타 — 앞 봉만 보는 계산)이라 결과가 같다.
  // 휴대폰에서 3,200봉 × 시리즈 열댓 개를 10초·2초마다 setData하면 화면이 멈춘다(검토 — 4배 느린 CPU에서 긴 작업 최대 0.9초)
  const fed = new WeakMap(); // 시리즈 → { epoch, n }
  let epoch = 0;
  function put(s, n, at, from) {
    const f = fed.get(s);
    if (from != null && f && f.epoch === epoch && from <= f.n && n >= f.n) for (let i = from; i < n; i += 1) s.update(at(i));
    else { const d = new Array(n); for (let i = 0; i < n; i += 1) d[i] = at(i); s.setData(d); }
    fed.set(s, { epoch, n });
  }
  let customLegend = []; // 대표 지표 설명줄(실시간 틱은 대표 지표를 다시 계산하지 않으므로 지난 값을 그대로 붙임)
  let lastScenes = null; // 지난번 장면 조각들 — 같은 조각이면 다시 붙이지 않음(TP/SL GUIDE 장면은 봉 마감 때만 바뀜)
  function line(key, opts) {
    if (!lines[key]) lines[key] = big.addLineSeries({ lineWidth: 1, crosshairMarkerVisible: false, ...FLAT, ...opts });
    return lines[key];
  }
  function drop(key) {
    if (!lines[key]) return;
    try { big.removeSeries(lines[key]); } catch { /* 이미 없음 */ }
    delete lines[key];
  }
  function sub(key) {
    if (subs[key]) return subs[key];
    const box = el('div', 'chart-sub');
    box.dataset.sub = key;
    box.append(el('span', 'chart-sub-label', SUB_LABELS[key])); // T-05
    ui.subs.append(box);
    const chart = LW.createChart(box, { ...SUB_OPTS, width: box.clientWidth || 0, height: box.clientHeight || 0 });
    // 큰 차트와 가로 범위 양방향 맞춤(N syncRange chart:250-252) — 보조 창을 지우면 큰 차트 쪽 구독도 뗀다
    let syncing = false;
    const follow = (to) => (r) => {
      if (syncing || !r) return;
      syncing = true;
      try { to.timeScale().setVisibleLogicalRange(r); } catch { /* 빈 차트 */ }
      syncing = false;
    };
    const toSub = follow(chart);
    big.timeScale().subscribeVisibleLogicalRangeChange(toSub);
    chart.timeScale().subscribeVisibleLogicalRangeChange(follow(big));
    subs[key] = { el: box, chart, series: {}, unlink: () => big.timeScale().unsubscribeVisibleLogicalRangeChange(toSub) };
    return subs[key];
  }
  function dropSub(key) {
    const s = subs[key];
    if (!s) return;
    s.unlink();
    try { s.chart.remove(); } catch { /* 이미 없음 */ }
    s.el.remove();
    delete subs[key];
  }
  // 보조 창 순서 RSI·MACD·델타(spec §2.1 ⑤) — 켠 순서와 무관하게
  function orderSubs() {
    const want = subPanes(inds).filter((k) => subs[k]).map((k) => subs[k].el);
    const have = [...ui.subs.children];
    if (want.length === have.length && want.every((e, i) => e === have[i])) return;
    ui.subs.replaceChildren(...want);
  }
  function syncSubs() {
    const r = big.timeScale().getVisibleLogicalRange();
    if (r) for (const s of Object.values(subs)) { try { s.chart.timeScale().setVisibleLogicalRange(r); } catch { /* 빈 차트 */ } }
  }

  // 종목·시간 단위를 바꿀 때(받기 전) — 옛 종목 봉·지표가 새 이름 아래 남지 않게(spec §3.2 '허브가 못 줄 때 차트는 비우고')
  function clearChart() {
    cur = [];
    shownT = [];
    tpslMemo = null;
    epoch += 1;
    customLegend = [];
    lastScenes = null;
    indMarks = [];
    if (!big) return;
    candles.setData([]);
    candles.setMarkers([]);
    for (const s of Object.values(lines)) s.setData([]);
    for (const s of Object.values(subs)) for (const x of Object.values(s.series)) x.setData([]);
    scene.setScene(EMPTY_SCENE);
    showTable(null);
    ui.legend.replaceChildren();
  }
  function setCandles(bars, reset) {
    const range = shownT.length ? big.timeScale().getVisibleLogicalRange() : null;
    const oldT = shownT;
    const p = precisionFor(bars.at(-1).c); // N chart:92-93
    candles.applyOptions({ priceFormat: { type: 'price', precision: p, minMove: 10 ** -p } });
    candles.setData(bars.map(toCandle));
    epoch += 1; // 봉 판이 바뀜(전체·자르기) — 지표 시리즈도 setData로
    shownT = bars.map((b) => b.t);
    return keepRange({ reset, range, oldTimes: oldT, newTimes: shownT, width: ui.big.clientWidth || 0 });
  }
  function render(bars, info) {
    if (!big) return;
    if (!bars.length) { clearChart(); return; }
    cur = bars;
    let want = null;
    let from = null; // 바뀐 첫 봉 번호(null = 봉 판 전체가 새로)
    if (info.full) {
      tpslMemo = null;
      want = setCandles(bars, resetView);
      resetView = false;
    } else {
      const plan = planUpdate(shownT, bars);
      if (plan.kind === 'set') want = setCandles(bars, false);
      else {
        // 바뀐 봉부터(마감된 앞 봉의 마지막 값 + 새 봉). 보이는 범위는 라이브러리가 오른쪽 끝을 볼 때만 민다(shiftVisibleRangeOnNewBar)
        for (let i = plan.from; i < bars.length; i += 1) candles.update(toCandle(bars[i]));
        shownT.length = plan.from;
        for (let i = plan.from; i < bars.length; i += 1) shownT.push(bars[i].t);
        from = plan.from;
      }
    }
    // 실시간 틱(spec §3.3): 캔들만 바로, 기본 지표는 최대 2초에 한 번 끝 점만. 대표 지표·장면·마커는 10초 갱신·봉 판 변경 때
    // (N live는 지표를 아예 다시 계산하지 않음 — chart:181-193)
    if (info.live && from != null) { if (now() - lastStdAt >= LIVE_STD_MS) liveStd(from); }
    else indicators(from);
    if (want) big.timeScale().setVisibleLogicalRange(want);
  }

  // 대표 지표 모듈 — 없으면 불러오기를 걸고 이번에는 건너뜀(불러오면 다시 그림). 못 불러오면 그 지표만 빠지고 설명줄에 '{지표} 불러오지 못함'(다시 켜면 다시 시도)
  function modOf(k) {
    const m = mods[k];
    if (m && typeof m === 'object') return m;
    if (m) return null;
    mods[k] = 'loading';
    Promise.resolve()
      .then(() => importInd(k))
      .then((mod) => { mods[k] = mod && typeof mod === 'object' ? mod : 'failed'; }, () => { mods[k] = 'failed'; })
      .then(() => { if (big && cur.length && inds[k] && mods[k] !== 'loading') indicators(); });
    return null;
  }

  // N 기본 8종 그리기(from = 바뀐 첫 봉 — put이 그 점들만 update)
  function drawStd(r, bars, from) {
    const n = bars.length;
    for (const k of ['ma20', 'ma50', 'ma200', 'ema20']) { if (r.lines[k]) put(line(k, { color: STD_COLORS[k] }), n, pt(bars, r.lines[k]), from); else drop(k); }
    if (r.bb) {
      put(line('bbu', { color: STD_COLORS.bbOuter }), n, pt(bars, r.bb.up), from);
      put(line('bbm', { color: STD_COLORS.bbMid, lineStyle: 2 }), n, pt(bars, r.bb.mid), from);
      put(line('bbl', { color: STD_COLORS.bbOuter }), n, pt(bars, r.bb.lo), from);
    } else for (const k of ['bbu', 'bbm', 'bbl']) drop(k);
    if (r.vol) {
      if (!lines.vol) {
        lines.vol = big.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, ...FLAT });
        big.priceScale('vol').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      }
      put(lines.vol, n, (i) => ({ time: T(bars, i), value: r.vol[i].value, color: r.vol[i].color }), from);
    } else drop('vol');
    if (r.rsi) {
      const s = sub('rsi');
      if (!s.series.line) {
        s.series.line = s.chart.addLineSeries({ color: STD_COLORS.rsi, lineWidth: 1, priceLineVisible: false });
        // 70·30 점선은 보조 창 RSI 선에만(N chart:283-284) — 큰 차트 캔들에는 주문 선(평단·익절)만 가격선(spec §3.5)
        s.series.line.createPriceLine({ price: 70, color: '#f85149', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        s.series.line.createPriceLine({ price: 30, color: '#3fb950', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      }
      put(s.series.line, n, pt(bars, r.rsi), from);
    } else dropSub('rsi');
    if (r.macd) {
      const s = sub('macd');
      if (!s.series.hist) {
        s.series.hist = s.chart.addHistogramSeries(FLAT);
        s.series.line = s.chart.addLineSeries({ color: STD_COLORS.macdLine, lineWidth: 1, ...FLAT });
        s.series.sig = s.chart.addLineSeries({ color: STD_COLORS.macdSig, lineWidth: 1, ...FLAT });
      }
      put(s.series.hist, n, pt(bars, r.macd.hist, (i) => (r.macd.hist[i] >= 0 ? STD_COLORS.macdUp : STD_COLORS.macdDown)), from);
      put(s.series.line, n, pt(bars, r.macd.line), from);
      put(s.series.sig, n, pt(bars, r.macd.sig), from);
    } else dropSub('macd');
  }
  const showLegend = (legend) => ui.legend.replaceChildren(...legend.map((x) => el('span', `lg lg-${x.key}`, x.text)));
  // 실시간 틱: 기본 지표 끝 점만(진행 봉 값) + 설명줄. 대표 지표·장면·마커·보조 창 범위는 그대로
  function liveStd(from) {
    if (!big || !cur.length) return;
    const bars = cur;
    lastStdAt = now();
    const r = computeStd(bars, inds);
    drawStd(r, bars, from);
    showLegend([...r.legend, ...customLegend]);
  }

  function indicators(from = null) {
    if (!big || !cur.length) return;
    const bars = cur;
    lastStdAt = now();
    const legend = [];
    const r = computeStd(bars, inds);
    legend.push(...r.legend);
    drawStd(r, bars, from);
    const scenes = [];
    const marks = [fillState.symbol === sym ? fillArrows(fillState.list, fillState.side, barIndexOf) : []];
    let table = null;
    for (const k of Object.keys(IND_MODS)) {
      const mod = inds[k] ? modOf(k) : null;
      let res = null;
      if (mod) {
        try { res = runCustom(k, mod, bars, from); } catch { res = null; } // 한 지표가 던져도 차트 전체는 그대로
      }
      if (!res) {
        clearCustom(k);
        if (inds[k] && mods[k] === 'failed') legend.push({ key: k, text: indFailText(k) });
        continue;
      }
      legend.push(...res.legend);
      if (res.scene) scenes.push(res.scene);
      if (res.marks) marks.push(res.marks);
      if (res.table) table = res.table;
    }
    customLegend = legend.slice(r.legend.length);
    showTable(table);
    // 장면 조각이 지난번과 같은 것들이면(TP/SL GUIDE만 켬 — 봉 마감 전) 다시 붙이지 않는다
    if (!lastScenes || scenes.length !== lastScenes.length || scenes.some((x, i) => x !== lastScenes[i])) {
      scene.setScene(scenes.length ? mergeScenes(...scenes) : EMPTY_SCENE);
      lastScenes = scenes;
    }
    indMarks = mergeMarkers(marks, bars);
    applyMarkers();
    orderSubs();
    syncSubs();
    showLegend(legend);
  }

  function runCustom(k, mod, bars, from) {
    const n = bars.length;
    const last = bars.length - 1;
    if (k === 'tpsl') {
      const key = `${sym}|${tf}|${bars.length}|${bars[0].t}|${bars.length > 1 ? bars.at(-2).t : 0}`;
      if (!tpslMemo || tpslMemo.key !== key) {
        const res = mod.tpslGuide(bars);
        tpslMemo = { key, res, scene: mod.tpslScene(res), marks: mod.tpslMarkers(res), rows: mod.backtestRows(res.summary) };
      }
      return { legend: tpslMemo.res.legend, scene: tpslMemo.scene, marks: tpslMemo.marks, table: rules.indicators.backtest ? tpslMemo.rows : null };
    }
    if (k === 'bigs') { const res = mod.bigSales(bars); return { legend: res.legend, scene: mod.bigSalesScene(res, { lastIndex: last, bars }) }; }
    if (k === 'follow') {
      const res = mod.followLine(bars);
      put(line('follow', { lineWidth: 2 }), n, (i) => { const p = res.plot[i]; return p.value === undefined ? { time: T(bars, i) } : { time: T(bars, i), value: p.value, color: p.color }; }, from);
      return { legend: res.legend, scene: mod.followLineScene(res) };
    }
    if (k === 'vp') { const res = mod.vpBox(bars); return { legend: res.legend, scene: mod.vpScene(res) }; }
    if (k === 'delta') {
      const res = mod.delta(bars);
      const s = sub('delta');
      if (!s.series.total) {
        s.series.total = s.chart.addHistogramSeries(FLAT);
        s.series.higher = s.chart.addHistogramSeries(FLAT);
        s.series.lower = s.chart.addHistogramSeries(FLAT);
        s.series.total2 = s.chart.addLineSeries({ lineWidth: 2, lineType: 1, ...FLAT }); // 1 = LineType.WithSteps
      }
      for (const part of ['total', 'higher', 'lower', 'total2']) {
        const arr = res.pane[part];
        put(s.series[part], n, (i) => (Number.isFinite(arr[i].value) ? { time: T(bars, i), value: arr[i].value, color: arr[i].color } : { time: T(bars, i) }), from);
      }
      // 큰 차트: 테두리·몸통 캔들(원래 캔들 뒤에 붙여 위에 그려짐) + EMA 두 선(점마다 색)
      if (!lines.dFill) { lines.dFill = big.addCandlestickSeries(FLAT); lines.dBody = big.addCandlestickSeries({ ...FLAT, borderVisible: false }); }
      put(lines.dFill, n, (i) => ({ time: T(bars, i), ...res.candles.fill[i] }), from);
      put(lines.dBody, n, (i) => { const c = res.candles.body[i]; return Number.isFinite(c.open + c.close) ? { time: T(bars, i), open: c.open, high: c.high, low: c.low, close: c.close, color: c.color, wickColor: c.color } : { time: T(bars, i) }; }, from);
      const sig = (i) => (res.signal[i] ? '#12cef8' : '#fe3f00');
      put(line('dEmaF', {}), n, pt(bars, res.emaF, sig), from);
      put(line('dEmaS', {}), n, pt(bars, res.emaS, sig), from);
      return { legend: res.legend, marks: deltaMarks(res) };
    }
    return null;
  }
  function clearCustom(k) {
    if (k === 'tpsl') tpslMemo = null;
    if (k === 'follow') drop('follow');
    if (k === 'delta') { dropSub('delta'); for (const x of ['dFill', 'dBody', 'dEmaF', 'dEmaS']) drop(x); }
  }
  // T-14 백테스트 표 — 큰 차트 왼쪽 위, 머리를 누르면 접힘(접힘은 표 상자 클래스에 남아 다시 그려도 유지)
  function showTable(rows) {
    ui.table.hidden = !rows;
    if (!rows) { ui.table.replaceChildren(); return; }
    const h = el('div', 'bt-head', BACKTEST_HEAD);
    h.addEventListener('click', () => ui.table.classList.toggle('fold'));
    ui.table.replaceChildren(h, ...rows.map(([a, b]) => { const row = el('div', 'bt-row'); row.append(el('span', '', a), el('b', '', b)); return row; }));
  }

  // 실시간 시세(spec §3.3): <SYM>-USDT-PERPETUAL이 허브 /v1/ox/instruments에 있고 active일 때만 차트 전용 공개 WS 구독(새 연결 120초에 1번 이하).
  // 아니거나 목록을 못 받으면 WS를 열지 않고 허브 봉만 + '실시간 시세 없음'
  function applyLive() {
    if (!visible) return;
    const inst = instOf(sym);
    liveOk = !!insts && insts.has(inst);
    if (liveOk) {
      ticker.watch(inst);
      if (!tickerOn) { tickerOn = true; ticker.start(); }
    } else {
      ticker.watch(null);
      stopTicker();
    }
    head();
  }
  function stopTicker() { if (tickerOn) { tickerOn = false; ticker.stop(); } }
  function syncLive() {
    if (!visible || instBusy) return;
    if (insts || now() - instAt < INST_RETRY_MS) { applyLive(); return; }
    instBusy = true;
    instAt = now();
    Promise.resolve()
      .then(() => loadInstruments())
      .then((list) => { insts = new Set((Array.isArray(list) ? list : []).filter((x) => x && x.active === true).map((x) => x.inst)); }, () => { insts = null; })
      .then(() => { instBusy = false; applyLive(); });
  }

  function load(reset) {
    if (reset) { resetView = true; clearChart(); }
    tpslMemo = null;
    feed.load(sym, tf, { long: needsLong(inds) });
  }
  function toggle(key) {
    const wasLong = needsLong(inds);
    inds = { ...inds, [key]: !inds[key] };
    saveInds(store, ed, inds);
    markChips();
    if (inds[key] && mods[key] === 'failed') delete mods[key];
    if (!big) return;
    if (visible && needsLong(inds) && !wasLong) { load(false); return; } // TP/SL GUIDE·VP BOX — 3,200봉으로 다시(보던 범위는 keepRange)
    indicators();
  }
  function setSymbol(s) {
    if (typeof s !== 'string' || !SYM_RE.test(s) || s === sym) return;
    sym = s;
    view.sym[view.tab] = s;
    saveView(store, ed, view);
    dropPx();
    setOrderLines(null); // 종목이 바뀌면 주문 선·체결 화살표는 지운다(N chart:340) — Task 25가 그 종목 것을 다시 넣는다
    fillState = { symbol: null, side: 'long', list: [] };
    markSym();
    head();
    onSymbol(s);
    if (visible && big) { syncLive(); load(true); }
    refreshOverlay(); // 운영 측 포지션 선은 그 종목 것만(마커는 새 봉이 오면 indicators가 붙임)
  }
  function setTf(k) {
    if (k === tf || !TF_KEYS.includes(k)) return;
    tf = k;
    view.tf = k;
    saveView(store, ed, view);
    markTf();
    head();
    if (visible && big) load(true);
    refreshOverlay(); // 마커 시각을 새 시간 단위 봉으로(선은 같으면 그대로)
  }
  function setMine(list) {
    if (!ui.mine) return;
    ui.mine.replaceChildren(...(list || []).map((p) => {
      const b = el('button', 'chip mine', mineChipText(p));
      b.type = 'button';
      b.addEventListener('click', () => setSymbol(p.symbol));
      return b;
    }));
  }
  function barIndexOf(ms) { for (let i = cur.length - 1; i >= 0; i -= 1) if (cur[i].t <= ms) return i; return -1; }
  // 주문 선(spec §3.5) — 평단 금색 실선 2px(축 가격표만), 익절 초록 점선 '익절 +N%'(축 표시 없음). 손절가·청산가 선은 없다
  function setOrderLines(spec) {
    orderSpec = spec || null;
    if (!candles) return;
    for (const pl of priceLines) { try { candles.removePriceLine(pl); } catch { /* 없음 */ } }
    priceLines = [];
    if (spec) {
      if (Number.isFinite(spec.avg)) priceLines.push(candles.createPriceLine({ price: spec.avg, color: '#f5a623', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: '' }));
      if (Number.isFinite(spec.tp)) priceLines.push(candles.createPriceLine({ price: spec.tp, color: '#3fb950', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: `익절 +${spec.tpPct}%` }));
    }
    // 그린 선 개수(가격 없음) — 선은 캔버스라 DOM에 없어 브라우저 묶음(check_app --only manual '매매 종료 12초 뒤 선 0')이 이것을 본다(data-range-to와 같은 꼴)
    if (ui.big) ui.big.dataset.lines = String(priceLines.length);
  }
  function setFills(f) {
    fillState = f ? { symbol: f.symbol, side: f.side, list: f.list || [] } : { symbol: null, side: 'long', list: [] };
    indicators();
  }
  // 캔들 마커 = 지표 마커 + 운영 측 포지션 마커(v4는 시각 순 한 목록만 — 서로 덮어쓰지 않게 합친다). 포지션 마커는 지금 봉이
  // 이 종목·시간 단위 것일 때만(바꾼 직후 옛 봉에 붙이지 않게), 받은 봉 범위 안만
  function applyMarkers() {
    if (!candles) return;
    const st = feed.state();
    candles.setMarkers(mergeChartMarkers(indMarks, st.sym === sym && st.tf === tf ? overlay.markers : [], cur));
  }
  // 운영 측 포지션 선·마커를 지금 종목·시간 단위로 다시 — 같으면 붙이지 않는다. 보이는 범위는 건드리지 않는다(2d keepRange)
  function refreshOverlay() {
    overlay = posOk && autoPos ? positionOverlay({ positions: autoPos.positions, events: autoPos.events, symbol: sym, tf }) : EMPTY_OVERLAY;
    if (!candles) return;
    const sig = JSON.stringify(overlay);
    if (sig === overlaySig) return;
    overlaySig = sig;
    posLines.apply(candles, overlay.lines);
    applyMarkers();
  }
  // app.js onFeed — 회원 송출 스냅샷(가격 포함)이면 그 열린 포지션·최근 흐름, 공개 송출·해제·다시 채우는 중(null·loaded:false)이면 지운다
  function setAutoFeed(snap) {
    autoPos = posOk ? overlaySource(snap) : null;
    refreshOverlay();
  }

  return {
    mount(p) { panel = p; },
    async show() {
      if (visible) return;
      visible = true;
      const my = ++showSeq;
      if (!built) { build(); built = true; }
      if (!LW) {
        try { LW = await loadLib(); } catch { LW = null; }
        if (my !== showSeq) return; // 불러오는 동안 숨었다 다시 보임 — 뒤의 show가 이어 간다
        if (!LW) { visible = false; ui.state = 'down'; head(); return; } // 다음에 보일 때 다시
      }
      if (!big) makeCharts();
      onSymbol(sym); // 주문 시세 구독(Task 25 — ox-client.watchTicker)
      syncLive();
      const st = feed.state();
      if (st.sym !== sym || st.tf !== tf) load(true);
      else feed.resume();
    },
    hide() {
      showSeq += 1;
      if (!visible) return;
      visible = false;
      feed.pause();
      stopTicker();
      dropPx(); // 다시 보일 때 WS는 120초 간격을 기다릴 수 있다 — 그동안 옛 가격을 '실시간' 아래 두지 않음
      head();
    },
    symbol: () => sym,
    setSymbol,
    setMine,
    setAutoFeed, // 운영 측 자동매매 포지션(회원 송출 스냅샷 | null) — 차트 위 평단·익절·청산가 선과 체결·끝 마커(p40)
    // setFills(null) = 체결 화살표 지움(매매 종료 12초 뒤 — spec §3.5)
    chartApi: () => ({ setOrderLines, setFills, barIndexOf }),
  };
}
