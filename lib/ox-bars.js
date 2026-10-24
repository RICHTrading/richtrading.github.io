// 오렌지엑스 5분봉 받기(설계 §7.7 2026-10-19 주석 · P2a 계획 정한 것 1·9 · 검토 초점 3).
// 오렌지엑스 봉 이력은 인증 메서드(/private/get_tradingview_chart_data)뿐이라 허브는 봉을 받지 않는다 — 회원 자기 접속 토큰으로
// 읽기 전용 메서드(허용 목록 14번째, ox-client OX_CHART_METHOD)를 부른다. call은 ox-client call 모양(→ { ok, result } | { ok:false, kind… }).
// - barsParams: 끝 = 지금(초), 시작 = 끝 − (want + 1) × 5분(완성 봉 120개 + 진행 봉)
// - parseBars: 문서 응답 [{ tick(정수 초), open, high, low, close, volume, cost }]에서 tick·close만 본다 — 잘못된 줄은 버리고, tick 오름차순,
//   같은 tick은 마지막 줄, 진행 중 봉(tick + 5분 > 지금)은 뺀다. 배열이 아니거나 남는 것이 없으면 null
// - closedBars: closed()의 판단 그대로 — 요청 시각 − closeLagMs로 parseBars(봉이 닫힌 뒤 10초부터 완성 봉 — 정한 것 9), 마지막 want개
// - createOxBars: 종목마다 한 번에 하나. 성공한 값은 다음 봉이 닫힌 뒤 closeLagMs까지 다시 쓴다(같은 5분 칸 = 호출 1번),
//   실패(call 실패·던짐·closedBars null)는 retryMs 동안 다시 부르지 않고 { ok:false }
// - now는 거래소 기준 epoch ms(ox-client serverNow)다 — 요청 창·완성 봉 가르기·5분 칸이 모두 이 시계로 돌고 dca-ind condMet도 같은 시계로 봉의 나이를
//   잰다. 기기 벽시계를 그대로 넣으면 시계가 늦은 기기는 요청 창 자체가 그만큼 옛 봉이라 옛 봉 판단이 영영 안 걸리고, 10초 넘게 빠른 기기는 진행 중 봉을
//   완성 봉으로 넣는다(설계 §4.5·§11-2, P2a Task 6 검토 고침 1회차 지적 0). now()가 수가 아니면(거래소 시계를 아직 모름) 묻지 않고 { ok:false }
// - barsShape: 실측 진단(P2b '5분봉 확인(시험)' — 설계 §12 대표 실측 ③)용 응답 모양 — 가격 없음
// 실패·모자람·오래된 봉(마지막 완성 봉이 10분 넘게 옛것 — lastTick으로)이면 쓰는 쪽(dca-ind)이 그 차수 조건을 거짓으로 본다(강제 선만)
import { OX_CHART_METHOD } from './ox-client.js';

export const OX_BARS = Object.freeze({ tfMs: 300000, want: 120, closeLagMs: 10000, retryMs: 30000 });
const TF_S = OX_BARS.tfMs / 1000;
const PRICE_RE = /^\d{1,16}(\.\d{1,16})?$/; // 문자열 종가는 10진 숫자 꼴만(문서 예 '43768.900')

export function barsParams(inst, now) {
  const end = Math.floor(now / 1000);
  return { instrument_name: inst, start_timestamp: String(end - (OX_BARS.want + 1) * TF_S), end_timestamp: String(end), resolution: '5' };
}

// 종가 — 수든 문자열이든 양수만, 아니면 null
function closeOf(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && PRICE_RE.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseBars(result, now) {
  if (!Array.isArray(result)) return null;
  const byTick = new Map();
  for (const row of result) {
    if (!row || typeof row !== 'object') continue;
    const close = closeOf(row.close);
    if (!Number.isSafeInteger(row.tick) || row.tick <= 0 || close === null) continue;
    byTick.set(row.tick, close); // 같은 tick은 뒤 줄이 덮음
  }
  const ticks = [...byTick.keys()].filter((t) => t * 1000 + OX_BARS.tfMs <= now).sort((a, b) => a - b);
  if (!ticks.length) return null;
  return { closes: ticks.map((t) => byTick.get(t)), lastTick: ticks[ticks.length - 1] * 1000 };
}

// closed()와 같은 판단(P2b 진단도 같은 값을 보게): 완성 봉은 요청 시각 t − closeLagMs로 가른다(정한 것 9 '봉이 닫힌 뒤 10초부터'·설계 §7.7
// '닫힌 뒤 10초에 완성 봉') — 칸의 첫 조회·실패 쉼 뒤 다시 부름이 봉이 닫히고 10초 안에 와도 막 닫힌 봉은 빼고, 기기 시계가 거래소보다 앞선
// 만큼(closeLagMs까지)도 진행 중 봉(덜 된 종가)을 넣지 않는다(검토 고침 1회차 지적 0). 완성 봉은 마지막 want개까지(창보다 많이 온 답) — 없으면 null.
// 창(barsParams)은 요청 시각 기준 완성 120개 + 진행 봉이라, 봉이 닫히고 1~10초 사이의 첫 조회는 119개(RSI 99개·볼린저 20개에는 넉넉)
export function closedBars(result, t) {
  const p = parseBars(result, t - OX_BARS.closeLagMs);
  return p && { closes: p.closes.slice(-OX_BARS.want), lastTick: p.lastTick };
}

// 종가 지문(가격을 싣지 않고 같은지만 보려고 — FNV-1a 32비트, 16진 8자리). 종가가 없으면 null
function closeKey(v) {
  if (v === undefined || v === null) return null;
  let h = 0x811c9dc5;
  for (const c of String(v)) h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// 실측 진단(P2b '5분봉 확인(시험)' — 설계 §12 대표 실측 ③ '오렌지엑스 5분봉 조회 응답 모양', 검토 고침 1회차 지적 2): 답을 걸러 내지 않고
// 모양만 잰다. now = 그 요청의 barsParams 시각(요청 끝·시작을 같은 식으로 다시 셈), prev = 앞 진단의 barsShape(쓰는 쪽이 종목별로 메모리에만).
// → rows(받은 줄 수 — 배열이 아니면 null) · tick(tick 칸 꼴 'number'|'string'|'other'|'mixed'|'none') · unit('s'|'ms' — 1e11 이상이면 밀리초)
//   · endGapS·startGapS(가장 큰 tick − 요청 끝, 가장 작은 tick − 요청 시작 — 초, 수로 읽을 tick이 없으면 null)
//   · tail(tick이 가장 큰 두 줄 [{ tick(초), key(종가 지문) }]) · same({ last, before } — prev의 같은 tick 줄과 지문이 같은지, 모르면 null)
// 읽는 법: 몇 초 사이 두 번 눌러 same.last가 false면 마지막 줄은 진행 봉 — 그때 endGapS가 −300~0이면 tick = 봉 시작, 0~300이면 봉 끝.
// 봉이 닫히고 10초 안에 한 번·1분 뒤 한 번 눌러 막 닫힌 봉(새 진단의 그 앞 줄)의 same.before가 true면 10초 안에 확정됨(closeLagMs 여유).
// tick이 문자열·밀리초면 parseBars가 모든 줄을 버려 '받지 못함'이 되는데 그 까닭은 tick·unit으로 본다. 가격(종가)은 싣지 않는다
export function barsShape(result, now, prev = null) {
  const end = Math.floor(now / 1000);
  const start = end - (OX_BARS.want + 1) * TF_S;
  const shape = { rows: Array.isArray(result) ? result.length : null, tick: 'none', unit: null, endGapS: null, startGapS: null, tail: [], same: { last: null, before: null } };
  if (!Array.isArray(result)) return shape;
  const kinds = new Set();
  const byTick = new Map(); // tick(수) → 종가 지문, 같은 tick은 뒤 줄(parseBars와 같음)
  for (const row of result) {
    if (!row || typeof row !== 'object' || row.tick === undefined || row.tick === null) continue;
    const k = typeof row.tick;
    kinds.add(k === 'number' || k === 'string' ? k : 'other');
    const n = k === 'number' ? row.tick : k === 'string' && /^\d{1,16}$/.test(row.tick) ? Number(row.tick) : NaN;
    if (Number.isFinite(n)) byTick.set(n, closeKey(row.close));
  }
  shape.tick = kinds.size > 1 ? 'mixed' : kinds.size ? [...kinds][0] : 'none';
  if (!byTick.size) return shape;
  const ticks = [...byTick.keys()].sort((a, b) => a - b);
  const div = ticks[ticks.length - 1] >= 1e11 ? 1000 : 1; // 초 tick은 1e11(서기 5138년) 아래 — 그 위면 밀리초로 봄
  shape.unit = div === 1000 ? 'ms' : 's';
  shape.endGapS = ticks[ticks.length - 1] / div - end;
  shape.startGapS = ticks[0] / div - start;
  shape.tail = ticks.slice(-2).map((t) => ({ tick: t / div, key: byTick.get(t) }));
  const old = prev && Array.isArray(prev.tail) ? prev.tail : [];
  const same = (x) => {
    const o = old.find((y) => y && y.tick === x.tick);
    return o && o.key != null && x.key != null ? o.key === x.key : null;
  };
  shape.same = { last: same(shape.tail[shape.tail.length - 1]), before: shape.tail.length > 1 ? same(shape.tail[0]) : null };
  return shape;
}

export function createOxBars({ call, now = () => Date.now() }) {
  // 5분 칸 = 봉이 닫힌 뒤 closeLagMs부터 다음 봉이 닫힌 뒤 closeLagMs 전까지
  const slotOf = (t) => Math.floor((t - OX_BARS.closeLagMs) / OX_BARS.tfMs);
  const memo = new Map(); // 종목 → { slot, value }(성공) | { failAt }(실패 뒤 쉼)
  const flying = new Map(); // 종목 → 부르는 중인 Promise

  async function fetchOnce(inst) {
    // 요청 시각 하나로 완성 봉(closedBars — 요청 시각 − closeLagMs)·같은 칸을 판단한다 — 답이 늦게 와도 그때 진행 중이던 봉(덜 된 종가)을
    // 완성으로 보지 않게
    const t = now();
    let r = null;
    try {
      r = await call(OX_CHART_METHOD, barsParams(inst, t));
    } catch {
      r = null;
    }
    const got = r && r.ok === true ? closedBars(r.result, t) : null;
    if (!got) {
      memo.set(inst, { failAt: now() });
      return { ok: false };
    }
    const value = Object.freeze({ ok: true, closes: Object.freeze(got.closes), lastTick: got.lastTick });
    memo.set(inst, { slot: slotOf(t), value });
    return value;
  }

  function closed(inst) {
    const t = now();
    if (!Number.isFinite(t)) return Promise.resolve({ ok: false }); // 거래소 시계를 아직 모름 — 엉뚱한 시각으로 묻지 않고, 실패 쉼도 걸지 않음
    const m = memo.get(inst);
    if (m && m.value && m.slot === slotOf(t)) return Promise.resolve(m.value);
    if (m && m.failAt != null && t - m.failAt < OX_BARS.retryMs) return Promise.resolve({ ok: false }); // 실패 뒤 retryMs는 부르지 않음
    let p = flying.get(inst);
    if (!p) {
      p = fetchOnce(inst).finally(() => flying.delete(inst));
      flying.set(inst, p);
    }
    return p;
  }

  return { closed };
}
