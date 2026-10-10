// 따라가기 규칙 파일(follow-rules.json, 설계 3-2 §6.1 '규칙 파일') 검사 — 빌드(tools/build.mjs)와 앱이 같이 쓴다.
// 값·범위·안전 한도(한 매매 최대 증거금 제외)는 코드에 박지 않고 이 파일에서 읽는다. 지금 값은 동업자 최신판 20261008a 규칙(20261008a-r1)이고,
// 동업자 매매 설정이 바뀌면 그 규칙대로 파일을 바꾸고 rulesVersion을 올린다 — 회원은 바뀐 값을 보고 다시 확인한다(동의 기록에 rulesVersion).
// 엔진이 모르는 칸이 생기면(새 규칙) 빌드가 멈춘다 — 엔진이 읽는 항목을 늘린 뒤에 통과하게(조용히 무시하지 않음).
// 한 매매 최대 증거금은 기본값이 없다(대표 결정 2026-10-07: 회원이 직접 입력) — default가 null이 아니면 멈춘다.
// p34(대표 결정 2026-10-08, 동업자 최신판 20261008a): 자동 손절 autoSl { default(켜짐), afterStage(4차 뒤), liqGapPct(청산가 앞 %) } — 트레이딩 탭도 이 값을 읽는다.
// 회원 직접 손절(memberSl)·하루 손실 한도(dailyLossPct)·가격 차이 한도(slipPct)는 없앴다 — 옛 파일에 남아 있으면 '모르는 칸'으로 멈춘다.
export const RULES_TOP_KEYS = Object.freeze(['rulesVersion', 'source', 'note', 'follow', 'limits']);
export const RULES_FOLLOW_KEYS = Object.freeze(['weightMultiplier', 'stages', 'tp', 'sl', 'autoSl']);
export const RULES_LIMIT_KEYS = Object.freeze(['maxMarginPct', 'maxConcurrent']);
export const RULES_AUTOSL_KEYS = Object.freeze(['default', 'afterStage', 'liqGapPct']);
const NAME_RE = /^[A-Za-z0-9._-]{1,40}$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fail(msg) {
  throw new Error(`follow-rules.json: ${msg}`);
}
function onlyKeys(obj, keys, where) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) fail(`${where}에 모르는 칸 ${k} — 엔진이 읽는 항목을 먼저 늘리세요`);
  for (const k of keys) if (k !== 'note' && !Object.hasOwn(obj, k)) fail(`${where}.${k}가 없습니다`);
}
function range(v, where, { lo, hi, int = false, nullDefault = false }) {
  if (!isObj(v)) fail(`${where}는 { default, min, max }`);
  onlyKeys(v, ['default', 'min', 'max'], where);
  const okNum = (x) => isNum(x) && (!int || Number.isInteger(x)) && x >= lo && x <= hi;
  if (!okNum(v.min) || !okNum(v.max) || !(v.min < v.max)) fail(`${where}.min·max는 ${lo}~${hi}${int ? ' 정수' : ''}이고 min < max`);
  if (nullDefault) {
    if (v.default !== null) fail(`${where}.default는 null이어야 합니다(회원이 직접 입력 — 대표 결정 2026-10-07)`);
  } else if (!okNum(v.default) || v.default < v.min || v.default > v.max) {
    fail(`${where}.default는 min~max 안의 숫자`);
  }
}

// 통과하면 얼린 사본을, 아니면 던진다
export function validateRules(r) {
  if (!isObj(r)) fail('객체가 아닙니다');
  onlyKeys(r, RULES_TOP_KEYS, '맨 위');
  if (typeof r.rulesVersion !== 'string' || !NAME_RE.test(r.rulesVersion)) fail('rulesVersion은 영문·숫자·._- 1~40자');
  if (typeof r.source !== 'string' || !NAME_RE.test(r.source)) fail('source는 영문·숫자·._- 1~40자');
  if (Object.hasOwn(r, 'note') && typeof r.note !== 'string') fail('note는 문자열');
  const f = r.follow;
  if (!isObj(f)) fail('follow가 객체가 아닙니다');
  onlyKeys(f, RULES_FOLLOW_KEYS, 'follow');
  if (!isNum(f.weightMultiplier) || f.weightMultiplier <= 0 || f.weightMultiplier > 1) fail('follow.weightMultiplier는 0 초과 1 이하');
  if (f.stages !== 'all') fail("follow.stages는 'all'만(모든 차수) — 다른 값은 엔진이 아직 모릅니다");
  if (f.tp !== 'signal') fail("follow.tp는 'signal'만");
  if (f.sl !== 'signal') fail("follow.sl은 'signal'만");
  const a = f.autoSl;
  if (!isObj(a)) fail('follow.autoSl이 객체가 아닙니다');
  onlyKeys(a, RULES_AUTOSL_KEYS, 'follow.autoSl');
  if (typeof a.default !== 'boolean') fail('follow.autoSl.default는 true/false');
  if (!Number.isInteger(a.afterStage) || a.afterStage < 1 || a.afterStage > 20) fail('follow.autoSl.afterStage는 1~20 정수');
  if (!isNum(a.liqGapPct) || a.liqGapPct < 0.05 || a.liqGapPct > 1 || Math.abs(Math.round(a.liqGapPct * 100) - a.liqGapPct * 100) > 1e-9) fail('follow.autoSl.liqGapPct는 0.05~1(소수 둘째 자리까지)');
  const l = r.limits;
  if (!isObj(l)) fail('limits가 객체가 아닙니다');
  onlyKeys(l, RULES_LIMIT_KEYS, 'limits');
  range(l.maxMarginPct, 'limits.maxMarginPct', { lo: 1, hi: 100, int: true, nullDefault: true });
  range(l.maxConcurrent, 'limits.maxConcurrent', { lo: 1, hi: 10, int: true });
  return deepFreeze(structuredClone(r));
}

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

// 앱: 빌드가 config.js에 찍은 규칙(CONFIG.followRules). 없거나 깨졌으면 null — 따라가기를 켤 수 없다(화면이 그 사실을 보인다)
export function rulesOf(config) {
  try {
    return config && config.followRules ? validateRules(config.followRules) : null;
  } catch {
    return null;
  }
}
