// 차트 봉 받기(spec §3.3) — N 피드와 같은 순서: 첫 로드 300봉(긴 모드 3,200) → 10초마다 끝 3봉(새 봉 붙임·같은 시각 바꿈) → 자르기.
// 요청 번호(seq)로 늦게 온 다른 종목·시간 단위 응답을 버린다. 마지막 성공이 10분 넘었으면(숨었다 돌아옴·보이는 채 허브/망이 끊겼다 돌아옴)
// 또는 끝 3봉이 가진 마지막 봉과 이어지지 않으면(빈칸) 붙이지 않고 전체를 다시 받는다 — 빈칸 위로 지표를 계산하지 않게(Review Focus 1)
export const FEED = Object.freeze({ pollMs: 10000, first: 300, long: 3200, trim: Object.freeze({ normal: Object.freeze([600, 400]), long: Object.freeze([4800, 3200]) }), reloadAfterMs: 600000 });
const TF_MS = Object.freeze({ '5m': 300000, '15m': 900000, '1h': 3600000 });

export function createChartFeed({ fetchCandles, timers = globalThis, now = () => Date.now(), onBars = () => {}, onStatus = () => {} }) {
  let sym = null, tf = '5m', long = false, bars = [], seq = 0, timer = null, okAt = -Infinity, loading = false, paused = false;
  let again = false; // 허브가 partial(요청보다 덜 줌) — 다음 주기에 끝 3봉 대신 전체를 다시
  const status = (r) => onStatus(r.stale ? 'stale' : 'live');
  async function full() {
    const my = ++seq;
    loading = true;
    onStatus('loading');
    let r;
    try {
      r = await fetchCandles({ symbol: sym, tf, limit: long ? FEED.long : FEED.first });
    } catch {
      r = { ok: false };
    } finally {
      if (my === seq) loading = false; // 실패·시간 초과여도 풀어 10초 갱신이 이어지게(검토 38)
    }
    if (my !== seq) return;
    if (!r.ok) { onStatus('down'); return; }
    bars = r.bars;
    again = r.partial === true;
    okAt = now();
    status(r);
    onBars(bars, { full: true });
  }
  async function tick() {
    if (!sym || loading || paused) return;
    // 첫 로드가 실패했거나·허브가 덜 줬거나(partial)·마지막 성공이 10분 넘었으면 끝 3봉이 아니라 전체를 다시
    if (!bars.length || again || now() - okAt > FEED.reloadAfterMs) return full();
    const my = seq;
    let r;
    try {
      r = await fetchCandles({ symbol: sym, tf, limit: 3 });
    } catch {
      r = { ok: false }; // 주기 안에서 던지면 setInterval 밖으로 새지 않게 — N tick의 catch(chart:177)처럼 '시세 연결 안 됨'
    }
    if (my !== seq) return;
    if (!r.ok) { onStatus('down'); return; }
    const step = TF_MS[tf];
    if (r.bars.length && step && r.bars[0].t > bars.at(-1).t + step) return full(); // 빈칸 — 이어 붙이지 않음
    for (const b of r.bars) {
      const last = bars.at(-1);
      if (!last || b.t > last.t) bars.push(b);
      else if (b.t === last.t) bars[bars.length - 1] = b;
    }
    const [hi, lo] = long ? FEED.trim.long : FEED.trim.normal;
    if (bars.length > hi) bars = bars.slice(-lo);
    okAt = now();
    status(r);
    onBars(bars, { full: false });
  }
  function stop() { if (timer != null) { timers.clearInterval(timer); timer = null; } }
  function start() { stop(); timer = timers.setInterval(tick, FEED.pollMs); }
  function load(nextSym, nextTf = tf, { long: nextLong = long } = {}) {
    sym = nextSym; tf = nextTf; long = nextLong; bars = []; paused = false;
    const p = full();
    start();
    return p;
  }
  function live(px) {
    const last = bars.at(-1);
    if (!last || !(px > 0)) return;
    last.c = px;
    if (px > last.h) last.h = px;
    if (px < last.l) last.l = px;
    onBars(bars, { live: true });
  }
  function pause() { paused = true; stop(); }
  function resume() {
    paused = false;
    if (!sym) return Promise.resolve();
    start();
    return now() - okAt > FEED.reloadAfterMs ? full() : tick();
  }
  return { load, live, pause, resume, stop, bars: () => bars, state: () => ({ sym, tf, long }) };
}
