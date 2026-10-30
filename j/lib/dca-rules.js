// AI 신호 주문 2·3·4차 추가 진입 표(dca-rules.json, 설계 2026-10-16 §7.6 — 답장 2026-10-16 2번 표) 검사.
// 빌드(tools/build.mjs loadDcaRules)가 검사해 config.js dcaRules에 찍고, 앱은 dcaRulesOf로 다시 검사해 쓴다. 칸은 설계 표의 것뿐 —
// 모르는 칸·틀린 값이면 빌드가 멈춘다(엔진이 읽는 항목을 먼저 늘린다). 선·조건·비율은 회원 설정이 아니다(D20 — 회원이 바꾸는 것은 운용 상한뿐).
// 마지막 차수 = follow-rules.json follow.autoSl.afterStage(4)여야 한다. 파일이 없으면 dcaRules는 null이고 기본 방식(손절 방식 partner)을
// 고를 수 없다(설계 §7.5 안전장치). 다른 모듈을 가져오지 않는 순수 함수 — 브라우저 전역 없이 Node에서도 불러진다(서버 자동 실행기 P3도 같은 파일).
export const DCA_TOP_KEYS = Object.freeze(['v', 'rulesVersion', 'source', 'basis', 'avgReset', 'aliveCheck', 'bars', 'stages']);
const STAGE_KEYS = Object.freeze(['stage', 'condPct', 'cond', 'forcePct', 'availPct', 'reserveLevPct']); // reserveLevPct는 마지막 차수에만(없어도 됨)
const BARS = Object.freeze({ source: 'orangex', tf: '5m', closedOnly: true }); // 오렌지엑스 5분 완성 봉만(설계 §7.7)
const VERSION_RE = /^dca-\d{8}-r\d+$/;
const SOURCE_RE = /^[0-9A-Za-z._-]{1,40}$/; // 기록용 출처 글자 — 신호 floor와 비교하지 않는다(D18)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function fail(msg) {
  throw new Error(`dca-rules.json: ${msg}`);
}
function onlyKeys(obj, keys, where, optional = []) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) fail(`${where}에 모르는 칸 ${k} — 엔진이 읽는 항목을 먼저 늘리세요`);
  for (const k of keys) if (!optional.includes(k) && !Object.hasOwn(obj, k)) fail(`${where}.${k}가 없습니다`);
}

// 조건은 두 꼴 중 하나만 — 5분 RSI(롱 longBelow 미만 / 숏 shortAbove 초과) · 볼린저 len봉 ± k 표준편차 밖(설계 §7.7)
function checkCond(c, where) {
  if (!isObj(c) || Object.keys(c).length !== 1 || !(Object.hasOwn(c, 'rsi') || Object.hasOwn(c, 'bb'))) fail(`${where}는 { rsi } 또는 { bb } 하나만`);
  if (Object.hasOwn(c, 'rsi')) {
    const x = c.rsi;
    if (!isObj(x)) fail(`${where}.rsi는 { len, longBelow, shortAbove }`);
    onlyKeys(x, ['len', 'longBelow', 'shortAbove'], `${where}.rsi`);
    if (!isInt(x.len, 2, 50) || !isNum(x.longBelow) || !isNum(x.shortAbove) || !(x.longBelow > 0 && x.longBelow < x.shortAbove && x.shortAbove < 100)) {
      fail(`${where}.rsi는 len 2~50 정수, 0 < longBelow < shortAbove < 100`);
    }
  } else {
    const x = c.bb;
    if (!isObj(x)) fail(`${where}.bb는 { len, k }`);
    onlyKeys(x, ['len', 'k'], `${where}.bb`);
    if (!isInt(x.len, 5, 100) || !isNum(x.k) || x.k < 0.5 || x.k > 5) fail(`${where}.bb는 len 5~100 정수, k 0.5~5`);
  }
}

// 통과하면 깊게 얼린 사본을, 아니면 던진다. afterStage = follow-rules.json follow.autoSl.afterStage(마지막 차수가 이것과 같아야 함)
export function validateDcaRules(r, { afterStage } = {}) {
  if (!Number.isInteger(afterStage) || afterStage < 2) fail(`afterStage(follow-rules.json autoSl.afterStage)가 2 이상 정수가 아닙니다: ${afterStage}`);
  if (!isObj(r)) fail('객체가 아닙니다');
  onlyKeys(r, DCA_TOP_KEYS, '맨 위');
  if (r.v !== 1) fail('v는 1만');
  if (typeof r.rulesVersion !== 'string' || !VERSION_RE.test(r.rulesVersion)) fail('rulesVersion은 dca-YYYYMMDD-rN 꼴');
  if (typeof r.source !== 'string' || !SOURCE_RE.test(r.source)) fail('source는 영문·숫자·._- 1~40자');
  if (r.basis !== 'margin') fail("basis는 'margin'만(선은 증거금 기준 %)");
  if (r.avgReset !== true) fail('avgReset은 true만(차수마다 그 순간 평단에서 다시 잼)');
  if (r.aliveCheck !== true) fail('aliveCheck는 true만(다음 차수 전 포지션 생존 확인)');
  if (!isObj(r.bars)) fail("bars는 { source: 'orangex', tf: '5m', closedOnly: true }만");
  onlyKeys(r.bars, Object.keys(BARS), 'bars');
  for (const [k, v] of Object.entries(BARS)) if (r.bars[k] !== v) fail(`bars.${k}는 ${JSON.stringify(v)}만`);
  const st = r.stages;
  if (!Array.isArray(st) || st.length === 0) fail('stages는 비어 있지 않은 목록');
  for (const [i, s] of st.entries()) {
    const where = `stages[${i}]`;
    if (!isObj(s)) fail(`${where}는 객체`);
    onlyKeys(s, STAGE_KEYS, where, ['reserveLevPct']);
    if (s.stage !== i + 2) fail(`stages는 2차부터 빠짐 없이 이어진 차수(2·3·4…) — ${where}.stage ${JSON.stringify(s.stage)}`);
    if (!isNum(s.condPct) || !isNum(s.forcePct) || !(s.condPct >= 1 && s.condPct < s.forcePct && s.forcePct <= 95)) fail(`${where}.condPct·forcePct는 1 ≤ condPct < forcePct ≤ 95`);
    checkCond(s.cond, `${where}.cond`);
    if (!isNum(s.availPct) || s.availPct < 1 || s.availPct > 100) fail(`${where}.availPct는 1~100`);
    if (Object.hasOwn(s, 'reserveLevPct')) {
      if (i !== st.length - 1) fail(`${where}.reserveLevPct는 마지막 차수에만`);
      if (!isNum(s.reserveLevPct) || s.reserveLevPct < 0 || s.reserveLevPct > 0.5) fail(`${where}.reserveLevPct는 0~0.5`);
    }
  }
  const last = st[st.length - 1].stage;
  if (last !== afterStage) fail(`stages 마지막 차수(${last})가 follow-rules.json autoSl.afterStage(${afterStage})와 다릅니다`);
  return deepFreeze(structuredClone(r));
}

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

// 앱: 빌드가 config.js에 찍은 표(CONFIG.dcaRules)를 같은 config의 따라가기 규칙 afterStage로 다시 검사. 없거나 틀리면 null(던지지 않음) — 기본 방식 잠김
export function dcaRulesOf(config) {
  try {
    if (!config || !config.dcaRules) return null;
    const fr = config.followRules;
    const afterStage = fr && fr.follow && fr.follow.autoSl ? fr.follow.autoSl.afterStage : undefined;
    return validateDcaRules(config.dcaRules, { afterStage });
  } catch {
    return null;
  }
}

// n차 칸(2·3·4) — 없으면(표 없음·1차·마지막 뒤) null
export function stageRule(dca, n) {
  const list = dca && Array.isArray(dca.stages) ? dca.stages : [];
  return list.find((s) => s && s.stage === n) || null;
}

// 그 차수 증거금 비율(기준 잔고의 %, 설계 §7.6) — 마지막 차수(reserveLevPct)는 주문이 막히지 않게 배율만큼 남긴다:
// min(95, availPct − 배율 × reserveLevPct) — 0.14면 50배 93, 25배 이하는 95에서 막힘. reserveLevPct가 없으면 availPct 그대로
export function stageMarginPct(stage, lev) {
  return typeof stage.reserveLevPct === 'number' ? Math.min(95, stage.availPct - lev * stage.reserveLevPct) : stage.availPct;
}
