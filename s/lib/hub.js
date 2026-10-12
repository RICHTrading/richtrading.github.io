import { parseLatest, parseItem, ANALYSIS_ID } from './analysis-shape.js';
import { parseEvents } from './events-feed.js';

const trimBase = (base) => String(base).replace(/\/+$/, '');

// 토큰 없는 공개 읽기(p34 §2.7·§5.3) — cache 'no-cache'(브라우저가 ETag로 다시 묻고 304면 캐시 본문을 준다 — 앱이 머리글을 넣지 않아
// CORS 사전 요청도 없음), cors·credentials omit·시간 제한. 실패(네트워크·200 아님·JSON 아님)는 null — 던지지 않는다
async function getPublicJson(url, { fetchImpl, timeoutMs }) {
  let res;
  try {
    res = await fetchImpl(url, { cache: 'no-cache', mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
  if (!res || res.status !== 200) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// 리치 서버 AI 최신 분석(p34 §3.1) — GET /v1/analysis/latest → 받은 값(analysis-shape.js LATEST_FIELDS) | null(실패·모양 틀림)
export async function fetchAnalysis(base, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return parseLatest(await getPublicJson(`${trimBase(base)}/v1/analysis/latest`, { fetchImpl, timeoutMs }));
}

// 분석 하나(p34 §2.7 — 트레이딩 탭 '근거 보기'용) — id 형식이 맞을 때만 요청
export async function fetchAnalysisItem(base, id, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (typeof id !== 'string' || !ANALYSIS_ID.test(id)) return null;
  return parseItem(await getPublicJson(`${trimBase(base)}/v1/analysis/item/${id}`, { fetchImpl, timeoutMs }));
}

// 요청 분석(p35 §2.11·§7.1) — POST /v1/analysis/request {v, symbol, ed, dev}(토큰 없음 — 공개 경로, Authorization 없음, 8초 제한).
// 답은 { status, body }(모양 검사는 analysis-request.js parseRequestResp) | null(연결·시간 초과). 던지지 않는다
async function sendJson(url, init, { fetchImpl, timeoutMs }) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
  if (!res || typeof res.status !== 'number') return null;
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export async function postAnalysisRequest(base, body, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  return sendJson(`${trimBase(base)}/v1/analysis/request`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { fetchImpl, timeoutMs });
}

// GET /v1/analysis/request/<표> — 표 형식(t + 16자 16진)이 맞을 때만 요청. { status, body } | null
export async function fetchAnalysisRequest(base, ticket, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (typeof ticket !== 'string' || !/^t[0-9a-f]{16}$/.test(ticket)) return null;
  return sendJson(`${trimBase(base)}/v1/analysis/request/${ticket}`, { cache: 'no-store' }, { fetchImpl, timeoutMs });
}

// 실시간 직원 말(p37 §3.3) — GET /v1/analysis/request/<표>/turns?after=N(토큰·머리글 없음 — 공개 경로, 앱 출처만, 5초 제한).
// 표 형식·after(0~8 정수)가 맞을 때만 요청. { status, body }(모양 검사는 analysis-live.js parseTurnsResp) | null
export async function fetchAnalysisTurns(base, ticket, after, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (typeof ticket !== 'string' || !/^t[0-9a-f]{16}$/.test(ticket)) return null;
  if (!Number.isInteger(after) || after < 0 || after > 8) return null;
  return sendJson(`${trimBase(base)}/v1/analysis/request/${ticket}/turns?after=${after}`, { cache: 'no-store' }, { fetchImpl, timeoutMs });
}

// 거래소 이벤트(p34 §5.3) — GET /v1/events → { up, off, updated, events } | null(실패·모양 틀림)
export async function fetchEvents(base, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return parseEvents(await getPublicJson(`${trimBase(base)}/v1/events`, { fetchImpl, timeoutMs }));
}

// 허브(이 PC) 상태 확인 — 설정 화면의 '서버 연결' 줄. 시간 안에 답이 없으면 '연결 안 됨'
export async function fetchHealth(base, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  let res;
  try {
    res = await fetchImpl(`${String(base).replace(/\/+$/, '')}/v1/health`, {
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { state: 'down' };
  }
  if (!res.ok) return { state: 'error', status: res.status };
  try {
    const data = await res.json();
    return data && data.ok === true ? { state: 'ok', data } : { state: 'error', status: res.status };
  } catch {
    return { state: 'error', status: res.status };
  }
}

// 따라가기 종목 목록(설계 3-2 §7.1 GET /v1/ox/instruments — 토큰 없음, 허브가 1시간 캐시) → items(inst·maxLev·minQty·step·tick·minNotional·active).
// 실패·모양이 다르면 던진다(엔진이 지난 값을 쓰거나 no_inst로 건너뜀)
export async function fetchInstruments(base, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const res = await fetchImpl(`${String(base).replace(/\/+$/, '')}/v1/ox/instruments`, { cache: 'no-store', mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
  const data = res && res.ok ? await res.json() : null;
  if (!data || data.ok !== true || !Array.isArray(data.items)) throw new Error('instruments');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return data.items
    .filter((x) => x && typeof x.inst === 'string' && /^[A-Z0-9]{1,20}-USDT-PERPETUAL$/.test(x.inst) && num(x.step) > 0 && num(x.tick) > 0)
    .map((x) => ({ inst: x.inst, maxLev: num(x.maxLev), minQty: num(x.minQty) ?? 0, step: x.step, tick: x.tick, minNotional: num(x.minNotional) ?? 0, active: x.active === true }));
}

// 봉 이력(p2 spec §3.2·§3.3) — 허브 GET /v1/candles(토큰 없음 — 공용판도 차트를 봄). 8초 제한·cors·credentials omit(위 fetchInstruments 꼴).
// 실패·시간 초과·모양 틀림은 { ok:false }로만 — 던지지 않는다(차트가 '시세 연결 안 됨'). 원소는 [t, o, h, l, c, v] 여섯 칸만 봉 객체로
export async function fetchCandles({ base, symbol, tf, limit, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  try {
    const r = await fetchImpl(`${trimBase(base)}/v1/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&limit=${Number(limit)}`, { cache: 'no-store', mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok !== true || !Array.isArray(j.candles)) return { ok: false };
    // partial: 허브가 전체 상한·같은 키 읽기 때문에 요청보다 덜 줌 — 피드가 다음 주기에 전체를 다시 받는다(chart-feed)
    return { ok: true, stale: j.stale === true, ...(j.partial === true ? { partial: true } : {}), bars: j.candles.filter((x) => Array.isArray(x) && x.length === 6).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })) };
  } catch {
    return { ok: false };
  }
}
