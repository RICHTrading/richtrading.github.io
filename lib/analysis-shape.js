// 허브 /v1/analysis/latest·/v1/analysis/item/<id> 응답 모양 검사(p34 §2.3·§2.7·§10.1).
// 셸은 문장을 고치지 않는다 — 거르기(연결·연락처·레퍼럴류 문장)는 허브가 하고 사무실이 한 번 더 한다(§2.4). '수수료'는 원문 그대로(p35 §4).
// 셸은 계약 키만 새로 만들고(모르는 키는 버림), 모르는 열거값은 그 칸만 null, 재생에 꼭 필요한 칸(id·at·symbol·turns)이 틀리면 그 분석만 null(검토 28).
// 길이 상한을 넘는 문자열은 자른다(…). 분석 원문은 공개돼도 되는 정보로 본다(대표 결정 2026-10-08-5·6) — 금액·계좌·모델 이름은 칸이 없다
export const ANALYSIS_KEYS = Object.freeze(['v', 'id', 'at', 'symbol', 'display', 'kind', 'mode', 'action', 'confidence', 'pm',
  'entry', 'stop', 'target', 'rationale', 'report', 'scalp', 'plan', 'rr', 'riskOk', 'turns']);
export const HEAD_KEYS = Object.freeze(['id', 'at', 'symbol', 'display', 'action', 'confidence', 'bias']);
export const SCALP_KEYS = Object.freeze(['bias', 'entry', 'stop', 'target', 'note']);
export const PLAN_KEYS = Object.freeze(['side', 'entry', 'tp', 'sl']);
export const TURN_KEYS = Object.freeze(['id', 'name', 'role', 'turn', 'bubble', 'report', 'reconstructed']);
export const AUTOPILOT_KEYS = Object.freeze(['on', 'intervalMin', 'nextAt', 'running', 'runningSymbol', 'lastRunAt', 'waiting']);
// 스케줄러 상태(p35 §3.2 — /v1/analysis/latest 끝 칸, 공개돼도 되는 칸만: 종목 이름·시각). 모르면 허브가 up:false로 보낸다(꾸미지 않음)
export const SCHED_KEYS = Object.freeze(['up', 'symbols', 'running', 'runningSymbol', 'request', 'lastOkAt']);
// 셸이 들고 있는 받은 값(허브 응답에서 ok·v를 뗀 것) — 사무실 메시지는 이 중 up·stale·off·analysis·autopilot·sched만(office-analysis.js)
export const LATEST_FIELDS = Object.freeze(['up', 'stale', 'off', 'analysis', 'autopilot', 'bySymbol', 'levelsMaxMin', 'sched']);
export const KINDS = Object.freeze(['crypto', 'krstock', 'stock']);
export const MODES = Object.freeze(['scalp', 'algo']);
export const ACTIONS = Object.freeze(['BUY', 'SELL', 'HOLD']);
export const PM_VERDICTS = Object.freeze(['APPROVE', 'AMEND', 'REJECT', 'PM_FAILED']);
export const BIASES = Object.freeze(['LONG', 'SHORT', 'PASS']);
export const SIDES = Object.freeze(['LONG', 'SHORT']);
export const STAFF_IDS = Object.freeze(['taro', 'diana', 'nova', 'vibe', 'bull', 'bear', 'blitz', 'guard', 'risky', 'safe', 'neutral', 'ace', 'pm']);
export const LIMITS = Object.freeze({ display: 24, name: 24, role: 24, bubble: 600, report: 8000, rationale: 2000, level: 300, note: 600, turns: 30, keepSymbols: 10, schedSymbols: 20 });
export const ANALYSIS_ID = /^a[0-9a-f]{12}$/;
const SYM = /^[A-Z0-9]{1,20}$/;

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const oneOf = (v, list) => (list.includes(v) ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = (v) => (num(v) != null && v > 0 ? v : null);
function str(v, max) {
  if (typeof v !== 'string') return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

export function cleanTurn(t) {
  if (!isObj(t) || !STAFF_IDS.includes(t.id)) return null;
  const bubble = str(t.bubble, LIMITS.bubble);
  if (!bubble) return null;
  return {
    id: t.id,
    name: str(t.name, LIMITS.name) || t.id.toUpperCase(),
    role: str(t.role, LIMITS.role) || '',
    turn: Number.isInteger(t.turn) && t.turn > 0 && t.turn < 100 ? t.turn : null,
    bubble,
    report: str(t.report, LIMITS.report) || '',
    reconstructed: t.reconstructed === true,
  };
}

function cleanScalp(s) {
  if (!isObj(s)) return null;
  return { bias: oneOf(s.bias, BIASES), entry: str(s.entry, LIMITS.note), stop: str(s.stop, LIMITS.note), target: str(s.target, LIMITS.note), note: str(s.note, LIMITS.note) };
}

function cleanPlan(p) {
  if (!isObj(p) || !SIDES.includes(p.side)) return null;
  return { side: p.side, entry: pos(p.entry), tp: pos(p.tp), sl: pos(p.sl) };
}

export function cleanAnalysis(a) {
  if (!isObj(a) || a.v !== 1 || typeof a.id !== 'string' || !ANALYSIS_ID.test(a.id) || pos(a.at) == null) return null;
  if (typeof a.symbol !== 'string' || !SYM.test(a.symbol) || !Array.isArray(a.turns)) return null;
  const turns = a.turns.map(cleanTurn).filter(Boolean).slice(0, LIMITS.turns);
  if (turns.length === 0) return null;
  const conf = num(a.confidence);
  return {
    v: 1,
    id: a.id,
    at: a.at,
    symbol: a.symbol,
    display: str(a.display, LIMITS.display) || a.symbol,
    kind: oneOf(a.kind, KINDS),
    mode: oneOf(a.mode, MODES),
    action: oneOf(a.action, ACTIONS),
    confidence: conf != null && Number.isInteger(conf) && conf >= 0 && conf <= 100 ? conf : null,
    pm: oneOf(a.pm, PM_VERDICTS),
    entry: str(a.entry, LIMITS.level),
    stop: str(a.stop, LIMITS.level),
    target: str(a.target, LIMITS.level),
    rationale: str(a.rationale, LIMITS.rationale),
    report: str(a.report, LIMITS.report),
    scalp: cleanScalp(a.scalp),
    plan: cleanPlan(a.plan),
    rr: num(a.rr),
    riskOk: typeof a.riskOk === 'boolean' ? a.riskOk : null,
    turns,
  };
}

// 자동 운영 칸(§2.3 Autopilot) — intervalMin이 5~720 정수가 아니면 이 칸만 null("다음 분석 N분 뒤"가 거짓이 되지 않게)
export function cleanAutopilot(p) {
  if (!isObj(p) || !Number.isInteger(p.intervalMin) || p.intervalMin < 5 || p.intervalMin > 720) return null;
  return {
    on: p.on === true,
    intervalMin: p.intervalMin,
    nextAt: pos(p.nextAt),
    running: p.running === true,
    runningSymbol: typeof p.runningSymbol === 'string' && SYM.test(p.runningSymbol) ? p.runningSymbol : null,
    lastRunAt: pos(p.lastRunAt),
    waiting: p.waiting === true,
  };
}

// 스케줄러 칸(p35 §3.2) — 모르는 키는 버리고, symbols는 형식 맞는 종목 20개까지. 객체가 아니면 null(옛 허브 — 모름)
export function cleanSched(s) {
  if (!isObj(s)) return null;
  return {
    up: s.up === true,
    symbols: (Array.isArray(s.symbols) ? s.symbols : []).filter((x) => typeof x === 'string' && SYM.test(x)).slice(0, LIMITS.schedSymbols),
    running: s.running === true,
    runningSymbol: typeof s.runningSymbol === 'string' && SYM.test(s.runningSymbol) ? s.runningSymbol : null,
    request: s.request === true,
    lastOkAt: pos(s.lastOkAt),
  };
}

export function cleanHead(h) {
  if (!isObj(h) || typeof h.id !== 'string' || !ANALYSIS_ID.test(h.id) || pos(h.at) == null || typeof h.symbol !== 'string' || !SYM.test(h.symbol)) return null;
  const conf = num(h.confidence);
  return {
    id: h.id, at: h.at, symbol: h.symbol, display: str(h.display, LIMITS.display) || h.symbol,
    action: oneOf(h.action, ACTIONS),
    confidence: conf != null && Number.isInteger(conf) && conf >= 0 && conf <= 100 ? conf : null,
    bias: oneOf(h.bias, BIASES),
  };
}

// GET /v1/analysis/latest 본문 → 받은 값(LATEST_FIELDS) | null(봉투 모양이 틀리면 — 받는 쪽은 실패로 보고 앞 값을 유지).
// 분석 칸만 틀리면 analysis만 null — up·autopilot·sched·bySymbol은 살린다(p35 D-3: 허브가 멀쩡한데 '연결 끊김'을 말하지 않게)
export function parseLatest(body) {
  if (!isObj(body) || body.ok !== true || body.v !== 1) return null;
  const analysis = body.analysis == null ? null : cleanAnalysis(body.analysis);
  const lv = body.levelsMaxMin;
  return {
    up: body.up === true,
    stale: body.stale === true,
    off: body.off === true,
    analysis,
    autopilot: body.autopilot == null ? null : cleanAutopilot(body.autopilot),
    bySymbol: (Array.isArray(body.bySymbol) ? body.bySymbol : []).map(cleanHead).filter(Boolean).slice(0, LIMITS.keepSymbols),
    levelsMaxMin: Number.isInteger(lv) && lv > 0 && lv <= 1440 ? lv : null,
    sched: cleanSched(body.sched),
  };
}

// GET /v1/analysis/item/<id> 본문 → Analysis | null
export function parseItem(body) {
  if (!isObj(body) || body.ok !== true || body.v !== 1) return null;
  return cleanAnalysis(body.analysis);
}
