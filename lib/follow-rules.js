// 따라가기 규칙 파일(follow-rules.json, 설계 3-2 §6.1 '규칙 파일') 검사 — 빌드(tools/build.mjs)와 앱이 같이 쓴다.
// 값·범위·안전 한도(한 매매 최대 증거금 제외)는 코드에 박지 않고 이 파일에서 읽는다. 지금 값은 답장 2026-10-16 규칙(20261016-r1 — 아래 AI 신호 주문 줄)이고,
// 동업자 매매 설정이 바뀌면 그 규칙대로 파일을 바꾸고 rulesVersion을 올린다 — 회원은 바뀐 값을 보고 다시 확인한다(동의 기록에 rulesVersion).
// 엔진이 모르는 칸이 생기면(새 규칙) 빌드가 멈춘다 — 엔진이 읽는 항목을 늘린 뒤에 통과하게(조용히 무시하지 않음).
// 한 매매 최대 증거금은 기본값이 없다(대표 결정 2026-10-07: 회원이 직접 입력) — default가 null이 아니면 멈춘다.
// p34(대표 결정 2026-10-08, 동업자 최신판 20261008a): 자동 손절 autoSl { default(켜짐), afterStage(4차 뒤) } — 트레이딩 탭도 이 값을 읽는다.
// 자리(20261016-r1, 설계 2026-10-16 §7.5): liqDistPct(평단→청산가 거리 % — 그 지점에 STOP, 50~99 정수)·estDistPct(청산가가 추정값일 때 거리 %,
// 50~liqDistPct 정수 — 더 일찍)·early(미리 거는 자동 손절 — 계획 정한 것 11). 옛 liqGapPct(청산가 앞 가격 %)가 남아 있으면 '모르는 칸'으로 멈춘다.
// 회원 직접 손절(memberSl)·하루 손실 한도(dailyLossPct)·가격 차이 한도(slipPct)는 없앴다 — 옛 파일에 남아 있으면 '모르는 칸'으로 멈춘다.
// AI 신호 주문(설계 2026-10-16 §6·§7.3, 판 20261016-r1 — 계획 정한 것 2 '규칙 파일은 P3까지 합집합'): 회원 설정 범위 member
// { lev·firstPct·tpPct·slMode·slPct·skipWeak }, 늦은 회원 문턱 lateEntry [{ minLev, maxLev, pct }](member.lev 범위를 빈틈·겹침 없이),
// 바깥 한계 signal { maxAgeMin, maxMovePct }를 더했다. 옛 칸(follow.weightMultiplier·stages·tp·sl·limits.maxConcurrent)은 그것을 읽는
// 서버 자동 실행기·등록 화면이 바뀌는 P3까지 남긴다(휴대폰 신호 길은 읽지 않음). 운용 상한 limits.maxMarginPct는 1~100(기본값 없음 그대로).
// D37(설계 2026-10-16 §15.20, 판 20261022-r1): 자동매매 고정 값 autoRun { lev·firstPct·tpPct(각각 member 범위 안 정수)·capPct(운용 상한 1~100)·
// symbols(자동매매 종목 목록 — 판 20261023-r1부터 여러 종목)·maxSymbols(한 번에 고르는 종목 수 — 동업자 오토 창 3)·maxTrades { min 1, max ≤ 1000 }(횟수 범위)·
// untilMaxMin(종료 시각 상한 분, 60~2880) }. 회원이 고르는 것은 종목·횟수·종료 시각·자동 손절뿐 — 저장된 설정은 follow-settings.js effectiveSettings로 읽는다.
// 칸이 없으면(옛 규칙 판 시험) 옛 동작(관리자 판단 — 있으면 검사).
import { OX_MAX_LEV } from './ox-client.js';

export const RULES_TOP_KEYS = Object.freeze(['rulesVersion', 'source', 'note', 'follow', 'limits', 'member', 'lateEntry', 'signal', 'autoRun']);
export const RULES_AUTORUN_KEYS = Object.freeze(['lev', 'firstPct', 'tpPct', 'capPct', 'symbols', 'maxSymbols', 'maxTrades', 'untilMaxMin']);
// 자동매매 종목 이름 꼴(오렌지엑스 선물 앞 이름 — <이름>-USDT-PERPETUAL의 <이름>)·목록 상한
const AUTO_SYMBOL_RE = /^[A-Z0-9]{1,20}$/;
const AUTO_SYMBOLS_MAX = 20;
const OPTIONAL_TOP = Object.freeze(['note', 'autoRun']);
export const RULES_FOLLOW_KEYS = Object.freeze(['weightMultiplier', 'stages', 'tp', 'sl', 'autoSl']);
export const RULES_LIMIT_KEYS = Object.freeze(['maxMarginPct', 'maxConcurrent']);
export const RULES_AUTOSL_KEYS = Object.freeze(['default', 'afterStage', 'liqDistPct', 'estDistPct', 'early']);
export const RULES_MEMBER_KEYS = Object.freeze(['lev', 'firstPct', 'tpPct', 'slMode', 'slPct', 'skipWeak']);
export const RULES_SIGNAL_KEYS = Object.freeze(['maxAgeMin', 'maxMovePct']);
const LATE_KEYS = Object.freeze(['minLev', 'maxLev', 'pct']);
const SL_MODES = Object.freeze(['partner', 'pct']); // 손절 방식 — 기본 방식(2·3·4차 + 자동 손절) | 직접 손절 %(설계 §6)
// 직접 손절 % 상한 = 배율별 예상 청산 폭(증거금 % ≈ 100 − 0.38 × 배율)보다 5%p 앞 — 배율 상한 50이면 76(설계 §6 '직접 손절 %')
const slPctCap = (levMax) => 95 - 0.38 * levMax;
const NAME_RE = /^[A-Za-z0-9._-]{1,40}$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fail(msg) {
  throw new Error(`follow-rules.json: ${msg}`);
}
function onlyKeys(obj, keys, where, optional = ['note']) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) fail(`${where}에 모르는 칸 ${k} — 엔진이 읽는 항목을 먼저 늘리세요`);
  for (const k of keys) if (!optional.includes(k) && !Object.hasOwn(obj, k)) fail(`${where}.${k}가 없습니다`);
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
  onlyKeys(r, RULES_TOP_KEYS, '맨 위', OPTIONAL_TOP);
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
  if (!Number.isInteger(a.liqDistPct) || a.liqDistPct < 50 || a.liqDistPct > 99) fail('follow.autoSl.liqDistPct는 50~99 정수(평단→청산가 거리 %)');
  if (!Number.isInteger(a.estDistPct) || a.estDistPct < 50 || a.estDistPct > a.liqDistPct) fail(`follow.autoSl.estDistPct는 50~liqDistPct(${a.liqDistPct}) 정수(청산가가 추정값일 때 거리 %)`);
  if (typeof a.early !== 'boolean') fail('follow.autoSl.early는 true/false(미리 거는 자동 손절)');
  const l = r.limits;
  if (!isObj(l)) fail('limits가 객체가 아닙니다');
  onlyKeys(l, RULES_LIMIT_KEYS, 'limits');
  range(l.maxMarginPct, 'limits.maxMarginPct', { lo: 1, hi: 100, int: true, nullDefault: true });
  range(l.maxConcurrent, 'limits.maxConcurrent', { lo: 1, hi: 10, int: true });
  checkMember(r.member);
  checkLateEntry(r.lateEntry, r.member.lev);
  checkSignal(r.signal);
  if (Object.hasOwn(r, 'autoRun')) checkAutoRun(r.autoRun, r.member);
  return deepFreeze(structuredClone(r));
}

// 회원 설정 범위(설계 §6) — 배율은 거래소 천장(OX_MAX_LEV) 안, 비중·익절·직접 손절은 정수 %, 손절 방식·약한 신호 건너뛰기는 고르는 칸
function checkMember(m) {
  if (!isObj(m)) fail('member가 객체가 아닙니다');
  onlyKeys(m, RULES_MEMBER_KEYS, 'member');
  range(m.lev, 'member.lev', { lo: 1, hi: OX_MAX_LEV, int: true });
  range(m.firstPct, 'member.firstPct', { lo: 1, hi: 100, int: true });
  range(m.tpPct, 'member.tpPct', { lo: 1, hi: 100, int: true });
  range(m.slPct, 'member.slPct', { lo: 1, hi: 100, int: true });
  const cap = slPctCap(m.lev.max);
  if (m.slPct.max > cap) fail(`member.slPct.max는 95 − 0.38 × member.lev.max(${m.lev.max}) = ${cap} 이하(배율별 예상 청산 폭보다 5%p 앞)`);
  const sm = m.slMode;
  if (!isObj(sm)) fail('member.slMode는 { default, choices }');
  onlyKeys(sm, ['default', 'choices'], 'member.slMode');
  if (!Array.isArray(sm.choices) || sm.choices.length !== SL_MODES.length || sm.choices.some((c, i) => c !== SL_MODES[i])) fail(`member.slMode.choices는 정확히 ${JSON.stringify(SL_MODES)}`);
  if (!sm.choices.includes(sm.default)) fail('member.slMode.default는 choices 안의 값');
  const sw = m.skipWeak;
  if (!isObj(sw)) fail('member.skipWeak는 { default }');
  onlyKeys(sw, ['default'], 'member.skipWeak');
  if (typeof sw.default !== 'boolean') fail('member.skipWeak.default는 true/false');
}

// 늦은 회원 문턱(설계 §7.3 ③) — 배율 칸마다 %, 칸들이 member.lev의 min~max를 빈틈·겹침 없이 덮어야 한다(범위 밖으로 넘친 칸도 멈춤)
function checkLateEntry(rows, lev) {
  if (!Array.isArray(rows) || rows.length === 0) fail('lateEntry는 { minLev, maxLev, pct } 칸의 목록(비어 있지 않음)');
  for (const [i, row] of rows.entries()) {
    const where = `lateEntry[${i}]`;
    if (!isObj(row)) fail(`${where}는 { minLev, maxLev, pct }`);
    onlyKeys(row, LATE_KEYS, where);
    if (!Number.isInteger(row.minLev) || !Number.isInteger(row.maxLev) || row.minLev > row.maxLev) fail(`${where}.minLev·maxLev는 정수이고 minLev ≤ maxLev`);
    if (!isNum(row.pct) || row.pct < 0.01 || row.pct > 2) fail(`${where}.pct는 0.01~2(%)`);
  }
  let next = lev.min; // 낮은 배율 칸부터 이어 붙여 본다
  for (const row of [...rows].sort((a, b) => a.minLev - b.minLev)) {
    if (row.minLev !== next) fail(`lateEntry는 배율 ${lev.min}~${lev.max}(member.lev)를 빈틈·겹침 없이 덮어야 합니다 — 배율 ${next} 자리에 ${row.minLev}~${row.maxLev} 칸`);
    next = row.maxLev + 1;
  }
  if (next !== lev.max + 1) fail(`lateEntry는 배율 ${lev.min}~${lev.max}(member.lev)를 빈틈·겹침 없이 덮어야 합니다 — 배율 ${next - 1}에서 끝남`);
}

// 바깥 한계(설계 §7.3 ①) — 신호 나이(분)·신호 가격에서 움직인 폭(%)
function checkSignal(s) {
  if (!isObj(s)) fail('signal이 객체가 아닙니다');
  onlyKeys(s, RULES_SIGNAL_KEYS, 'signal');
  if (!Number.isInteger(s.maxAgeMin) || s.maxAgeMin < 1 || s.maxAgeMin > 30) fail('signal.maxAgeMin은 1~30 정수(분)');
  if (!isNum(s.maxMovePct) || s.maxMovePct < 0.1 || s.maxMovePct > 5) fail('signal.maxMovePct는 0.1~5(%)');
}

// D37 자동매매 고정 값(설계 §15.20) — 배율·1차·익절은 member 범위 안 정수, 운용 상한 1~100, 종목 목록·한 번에 고르는 수, 횟수 범위, 종료 시각 상한(분)
function checkAutoRun(a, member) {
  if (!isObj(a)) fail('autoRun이 객체가 아닙니다');
  onlyKeys(a, RULES_AUTORUN_KEYS, 'autoRun', []);
  for (const k of ['lev', 'firstPct', 'tpPct']) {
    const r = member[k];
    if (!Number.isInteger(a[k]) || a[k] < r.min || a[k] > r.max) fail(`autoRun.${k}는 member.${k} 범위(${r.min}~${r.max}) 안 정수`);
  }
  if (!Number.isInteger(a.capPct) || a.capPct < 1 || a.capPct > 100) fail('autoRun.capPct는 1~100 정수(운용 상한 %)');
  // 판 20261023-r1(대표 결정 2026-10-23 '동업자판과 같게'): 종목 목록(관심 종목 — 코인 탭)·한 번에 고를 수 있는 수(동업자 오토 창 3종목)
  const s = a.symbols;
  if (!Array.isArray(s) || s.length < 1 || s.length > AUTO_SYMBOLS_MAX || !s.every((x) => typeof x === 'string' && AUTO_SYMBOL_RE.test(x)) || new Set(s).size !== s.length) {
    fail(`autoRun.symbols는 대문자 종목 이름(선물 앞 이름) 1~${AUTO_SYMBOLS_MAX}개·겹침 없음`);
  }
  if (!Number.isInteger(a.maxSymbols) || a.maxSymbols < 1 || a.maxSymbols > Math.min(10, s.length)) fail(`autoRun.maxSymbols는 1~${Math.min(10, s.length)} 정수(한 번에 고르는 종목 수 — 목록 수 이하)`);
  const m = a.maxTrades;
  if (!isObj(m)) fail('autoRun.maxTrades는 { min, max }');
  onlyKeys(m, ['min', 'max'], 'autoRun.maxTrades', []);
  if (m.min !== 1 || !Number.isInteger(m.max) || m.max < 1 || m.max > 1000) fail('autoRun.maxTrades는 { min 1, max 1~1000 정수 }');
  if (!Number.isInteger(a.untilMaxMin) || a.untilMaxMin < 60 || a.untilMaxMin > 2880) fail('autoRun.untilMaxMin은 60~2880 정수(분)');
}

// 늦은 회원 문턱 % — 그 배율을 덮는 lateEntry 칸의 pct. 덮는 칸이 없으면(배율 범위 밖·정수 아님·규칙 없음) null(부르는 쪽은 들어가지 않는 쪽으로)
export function lateThresholdPct(rules, lev) {
  const rows = rules && Array.isArray(rules.lateEntry) ? rules.lateEntry : [];
  const row = rows.find((x) => x && x.minLev <= lev && lev <= x.maxLev);
  return row ? row.pct : null;
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
