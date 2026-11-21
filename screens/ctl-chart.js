// 동업자 비상 컨트롤러(#ctl) 차트(계획 2026-10-30 Task 10 — R15: screens/ctl.js에서 뺌). vendor LightweightCharts + 허브 공개 5분봉(/v1/candles —
// 트레이딩 탭 createTradeMode와 따로). 고른 회원 매매 하나의 평단·익절·청산가 선과 차수 화살표('N차')를 회원 앱 트레이딩 탭과 같은 함수
// (lib/chart-position-overlay.js — ctl-view ctlOverlay)로 그린다(대표 결정 2026-10-30 저녁 B — 청산가 선은 이 화면에만, 자동 손절 발동가 선은 없음).
// - 처음 그릴 때 라이브러리·그 종목 하루치(288봉). 같은 종목이면 끝 봉 3개만 잇는다 — 사이가 비었으면(오래 숨김·접힘) 하루치를 다시
// - 종목이 바뀌면 전 선·마커를 지우고 그 종목 하루치를 새로. 그 종목 하루치를 못 받으면(허브가 봉을 주지 않는 종목 404 등) 봉·선·마커를 비우고 그 종목을
//   '없음'(missing — 화면 머리 줄 '차트 없음')으로 둔다. 그 뒤 같은 종목 draw는 끝 봉 3개로만 확인하고 받으면 하루치(최종 검토 고침 F7 — 10초마다 288봉 다시 안 함)
// - clear(): 로그아웃·세션 끝(최종 검토 고침 F2) — 기다리던 draw를 버리고(도는 것도 그리지 않음) 선·마커를 지움
// - 고른 매매가 있으면 그 선 가격까지 보이게 눈금을 넓힌다(라이브러리는 가격선을 눈금에 넣지 않아 화면 밖 선이 안 보임)
// - draw가 겹치면(목록 주기·고르기·접기) 마지막 것만 이어서 그린다 — 고르기를 잃지 않음. 값은 메모리에만(저장·기록 없음)
// DOM은 라이브러리가 box 안에 만든다(이 파일은 vendor 스크립트 태그 하나만 — CSP: 같은 출처 파일, 인라인 없음)
import { ctlOverlay, CTL_TF } from '../lib/ctl-view.js';
import { mergeChartMarkers, createPositionLines, EMPTY_OVERLAY, OVERLAY_TF_MS } from '../lib/chart-position-overlay.js';
import { toChartTime } from '../lib/chart-draw.js';

export const CTL_CHART_BARS = 288; // 5분봉 하루
const TAIL_BARS = 3;
const STEP_MS = OVERLAY_TF_MS[CTL_TF];
const LIB = 'vendor/lightweight-charts.standalone.production.js';
const CHART_OPTS = {
  autoSize: true,
  layout: { background: { type: 'solid', color: '#06060c' }, textColor: '#a0a0b8', fontFamily: 'Galmuri11, monospace', fontSize: 11, attributionLogo: false },
  grid: { vertLines: { color: '#10101a' }, horzLines: { color: '#10101a' } },
  rightPriceScale: { borderColor: '#1c1c28' },
  timeScale: { borderColor: '#1c1c28', timeVisible: true, secondsVisible: false, rightOffset: 4 },
  localization: { locale: 'ko-KR' },
};
const CANDLE_OPTS = { upColor: '#3fb950', downColor: '#f85149', borderUpColor: '#3fb950', borderDownColor: '#f85149', wickUpColor: '#3fb950', wickDownColor: '#f85149' };
// 봉 시각 = 차트 시각(KST — 트레이딩 탭과 같음, 체결 화살표 시각과 같은 기준)
const toBar = (b) => ({ time: toChartTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c });

export function createCtlChart({ doc, win, box, loadLib = null, loadCandles }) {
  const st = { chart: null, series: null, loading: null, sym: null, first: 0, last: 0, extent: null, next: null, loop: null, gen: 0, miss: null };
  const lines = createPositionLines();

  function libLoader() {
    if (loadLib) return loadLib();
    if (win && win.LightweightCharts) return Promise.resolve(win.LightweightCharts);
    return new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = LIB;
      s.addEventListener('load', () => (win.LightweightCharts ? resolve(win.LightweightCharts) : reject(new Error('chart_lib'))));
      s.addEventListener('error', () => reject(new Error('chart_lib')));
      doc.head.append(s);
    });
  }
  // 눈금 = 봉 범위 ∪ 고른 매매의 선 가격
  function autoscale(orig) {
    const r = orig();
    const x = st.extent;
    if (!x || !r || !r.priceRange) return r;
    return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, x.lo), maxValue: Math.max(r.priceRange.maxValue, x.hi) } };
  }
  async function ensureChart() {
    if (st.chart) return true;
    if (!st.loading) {
      st.loading = (async () => {
        try {
          const LW = await libLoader();
          st.chart = LW.createChart(box, CHART_OPTS);
          st.series = st.chart.addCandlestickSeries({ ...CANDLE_OPTS, autoscaleInfoProvider: autoscale });
        } catch {
          st.chart = null;
          st.series = null;
        } finally {
          st.loading = null;
        }
      })();
    }
    await st.loading;
    return !!st.chart;
  }
  async function bars(symbol, limit) {
    try {
      const r = await loadCandles({ symbol, tf: CTL_TF, limit });
      return r && r.ok && Array.isArray(r.bars) && r.bars.length ? r.bars : null;
    } catch {
      return null;
    }
  }
  function clearOverlay() {
    st.extent = null;
    lines.apply(st.series, []);
    st.series.setMarkers([]);
  }
  async function run({ symbol, trade }) {
    const g = st.gen;
    if (!(await ensureChart()) || g !== st.gen) return;
    let full = st.sym !== symbol;
    let got;
    if (full && st.miss === symbol) {
      got = await bars(symbol, TAIL_BARS); // 못 받던 종목 — 끝 봉으로만 확인, 오면 하루치
      if (got) got = await bars(symbol, CTL_CHART_BARS);
    } else {
      got = await bars(symbol, full ? CTL_CHART_BARS : TAIL_BARS);
      if (!full && got && got[0].t > st.last + STEP_MS) {
        full = true; // 끝 봉만 이으면 빈 시간이 빠진 채 붙는다
        got = await bars(symbol, CTL_CHART_BARS);
      }
    }
    if (g !== st.gen) return; // 기다리는 사이 clear(로그아웃) — 그리지 않음
    try {
      if (full && !got) {
        clearOverlay();
        st.series.setData([]); // 다른 종목 봉 위에 그 종목 선을 그리지 않음
        st.sym = null;
        st.miss = symbol;
        return;
      }
      if (full) st.miss = null;
      if (got && full) {
        clearOverlay(); // 전 선·마커
        st.series.setData(got.map(toBar));
        st.sym = symbol;
        st.first = got[0].t;
        st.last = got.at(-1).t;
      } else if (got) {
        for (const b of got) {
          if (b.t < st.last) continue;
          st.series.update(toBar(b));
          st.last = b.t;
        }
      }
      if (st.sym !== symbol) {
        clearOverlay();
        return;
      }
      const ov = trade ? ctlOverlay(trade) : EMPTY_OVERLAY;
      const ps = ov.lines.map((l) => l.price);
      st.extent = ps.length ? { lo: Math.min(...ps), hi: Math.max(...ps) } : null; // 선을 바꾸기 전에 — 선 바꿈이 눈금을 다시 셈
      lines.apply(st.series, ov.lines);
      st.series.setMarkers(mergeChartMarkers([], ov.markers, [{ t: st.first }, { t: st.last }])); // 받은 봉 범위 밖 화살표는 버림
    } catch {
      st.sym = null; // 다음 draw에 하루치를 다시
    }
  }
  // { symbol, trade: 고른 매매 | null } — 겹치면 마지막 요청만 이어서
  function draw({ symbol, trade = null }) {
    st.next = { symbol, trade };
    if (!st.loop) {
      st.loop = (async () => {
        try {
          while (st.next) {
            const req = st.next;
            st.next = null;
            await run(req);
          }
        } finally {
          st.loop = null;
        }
      })();
    }
    return st.loop;
  }
  // 로그아웃·세션 끝(F2): 기다리던 draw를 버리고 도는 draw도 그리지 않게(세대), 선·마커를 지움. 봉(공개 시세)은 두고 다음 draw가 새로 그림
  function clear() {
    st.gen += 1;
    st.next = null;
    st.miss = null;
    if (!st.series) return;
    try {
      clearOverlay();
    } catch {
      st.sym = null;
    }
  }
  // 봉을 못 받아 비워 둔 종목(화면 머리 줄 '차트 없음') | null
  return { draw, clear, missing: () => st.miss, symbol: () => st.sym };
}
