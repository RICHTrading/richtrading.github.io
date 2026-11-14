// 따라가기 설정·동의(설계 3-2 §6.1·§6.2) — 순수 함수. 저장은 follow-store(kv.follow·kv.consent).
// - 방식(② auto / ③ tap)은 미리 고르지 않는다. 한 매매 최대 증거금은 기본값 없이 회원이 넣어야 켤 수 있다(대표 결정 2026-10-07).
// - 그 밖 값의 기본·범위는 규칙 파일(follow-rules.json)에서. rulesVersion이 바뀌면 꺼 두고 다시 확인을 받는다.
// - 단일 모드(§6.1 2026-10-07 저녁): 성향 칸이 없다 — 동의 기록의 style은 'single'(기록 모양은 설계 §6.2 그대로).
// - 동의 기록은 기기에만(허브로 보내지 않음, 대표 결정). 화면에 보인 동의 문구 전체의 SHA-256을 textHash로 남기고, 회원이 파일로 저장할 수 있다.
// - p34(대표 결정 2026-10-08): 칸은 한 매매 최대 증거금·동시 건수뿐 — 직접 손절·하루 손실 한도·가격 차이 한도는 없앴다(옛 저장값은 버림).
//   자동 손절 스위치(kv.autoSl)는 설정 밖이다(따라가기가 켜진 동안에도 바뀌고 트레이딩 탭과 같은 스위치) — 동의 기록에는 그때 값을 정보로만
//   (settings.autoSl), 다시 동의를 묻는 비교에는 넣지 않는다. 요약 줄·동의 문구에는 그때 값을 보인다(autoSlOn).
import { CONSENT_VERSION, FTEXT } from './follow-text.js';
import { TEXT } from './auto-view.js';
import { canonJson } from './canon-json.js';

export const SETTINGS_V = 1;
export const CONSENT_KEEP = 50;
export const SETTING_KEYS = Object.freeze(['maxMarginPct', 'maxConcurrent']);
// AI 신호 설정 칸(설계 2026-10-16 §6, 서버 전용 §15.19-2·12) — 운용 상한·배율·1차 비중·익절·손절 방식·직접 손절·우세 약함 건너뛰기·자동 손절 스위치·자동매매 켜짐.
// 기본·범위는 규칙 파일 member(autoSl은 follow.autoSl.default). auto는 '자동매매 켜짐'(등록과 따로 — 기본 꺼짐)이라 설정 지문(settingsPrint)에는 넣지 않는다.
// 옛 칸(mode·maxConcurrent)·옛 검사(validateSettings)는 뜻 그대로 — 옛 길·옛 시험이 쓴다.
export const SIGNAL_SETTING_KEYS = Object.freeze(['maxMarginPct', 'lev', 'firstPct', 'tpPct', 'slMode', 'slPct', 'skipWeak', 'autoSl', 'auto']);
const NUM_KEYS = Object.freeze(['lev', 'firstPct', 'tpPct', 'slPct']);
const BOOL_KEYS = Object.freeze(['skipWeak', 'autoSl', 'auto']);

const memberOf = (rules) => (rules && rules.member) || {};
const defOf = (rules, k) => {
  const r = memberOf(rules)[k];
  return r && Object.hasOwn(r, 'default') ? r.default : null;
};
const autoSlDefault = (rules) => !(rules && rules.follow && rules.follow.autoSl && rules.follow.autoSl.default === false);

export function defaultSettings(rules) {
  return {
    v: SETTINGS_V,
    on: false,
    mode: null,
    maxMarginPct: rules.limits.maxMarginPct.default, // null — 회원이 직접 넣는다
    maxConcurrent: rules.limits.maxConcurrent.default,
    wakeLock: false,
    rulesVersion: rules.rulesVersion,
    lev: defOf(rules, 'lev'),
    firstPct: defOf(rules, 'firstPct'),
    tpPct: defOf(rules, 'tpPct'),
    slMode: defOf(rules, 'slMode'),
    slPct: defOf(rules, 'slPct'), // 양수로 저장(50 = 증거금 −50%)
    skipWeak: defOf(rules, 'skipWeak') === true,
    autoSl: autoSlDefault(rules),
    auto: false,
  };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// 저장값 → 설정. 모르는 칸은 버리고, 규칙 판이 바뀌었으면 꺼 두고(rulesChanged) 회원 값은 그대로 보여 준다(새 범위 밖이면 검사에서 걸림)
// 신호 칸은 형식이 맞을 때만 저장값(수는 유한수, slMode는 choices 안, 불리언 칸은 불리언) — 아니면 기본값
export function normalizeSettings(raw, rules) {
  const d = defaultSettings(rules);
  if (!raw || typeof raw !== 'object' || raw.v !== SETTINGS_V) return { settings: d, rulesChanged: false };
  const s = { ...d };
  if (raw.mode === 'auto' || raw.mode === 'tap') s.mode = raw.mode;
  for (const k of SETTING_KEYS) if (finite(raw[k])) s[k] = raw[k];
  for (const k of NUM_KEYS) if (finite(raw[k])) s[k] = raw[k];
  const choices = memberOf(rules).slMode && Array.isArray(memberOf(rules).slMode.choices) ? memberOf(rules).slMode.choices : [];
  if (choices.includes(raw.slMode)) s.slMode = raw.slMode;
  for (const k of BOOL_KEYS) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  s.wakeLock = raw.wakeLock === true;
  const rulesChanged = raw.rulesVersion !== rules.rulesVersion;
  s.on = raw.on === true && !rulesChanged;
  return { settings: s, rulesChanged };
}

// 입력칸 글자 → 숫자(빈칸·형식 밖은 null). 쉼표 소수점도 받는다(한국 키보드)
export function parseNum(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  return /^\d{1,3}(\.\d{1,2})?$/.test(t) ? Number(t) : null;
}

const inRange = (v, r, int) => finite(v) && v >= r.min && v <= r.max && (!int || Number.isInteger(v));
export function validateSettings(s, rules) {
  const L = rules.limits;
  const errors = {};
  if (s.mode !== 'auto' && s.mode !== 'tap') errors.mode = FTEXT.invalid.mode;
  if (!inRange(s.maxMarginPct, L.maxMarginPct, true)) errors.maxMarginPct = FTEXT.invalid.maxMarginPct(L.maxMarginPct.min, L.maxMarginPct.max);
  if (!inRange(s.maxConcurrent, L.maxConcurrent, true)) errors.maxConcurrent = FTEXT.invalid.maxConcurrent(L.maxConcurrent.min, L.maxConcurrent.max);
  return { ok: Object.keys(errors).length === 0, errors };
}

// AI 신호 설정 검사(설계 §6) — 오류는 칸 이름과 같은 코드 낱말만(문구는 휴대폰 화면 단계에서). 기본 방식('partner')인데 추가 진입 표가 없으면 slModeLocked
export function validateSignalSettings(s, rules, { dcaRules = null } = {}) {
  const L = rules.limits;
  const M = memberOf(rules);
  const errors = {};
  const x = s || {};
  if (!inRange(x.maxMarginPct, L.maxMarginPct, true)) errors.maxMarginPct = 'maxMarginPct';
  for (const k of ['lev', 'firstPct', 'tpPct']) if (!M[k] || !inRange(x[k], M[k], true)) errors[k] = k;
  const choices = M.slMode && Array.isArray(M.slMode.choices) ? M.slMode.choices : [];
  if (!choices.includes(x.slMode)) errors.slMode = 'slMode';
  else if (x.slMode === 'partner' && !dcaRules) errors.slMode = 'slModeLocked';
  if (x.slMode === 'pct' && (!M.slPct || !inRange(x.slPct, M.slPct, true))) errors.slPct = 'slPct';
  for (const k of BOOL_KEYS) if (typeof x[k] !== 'boolean') errors[k] = k;
  return { ok: Object.keys(errors).length === 0, errors };
}

// 직접 % 손절선이 가까우면 오지 않는 차수(설계 §6 직접 손절 %): 차수마다 forcePct < slPct → 그대로, condPct < slPct ≤ forcePct → 조건부 선에서만(condOnly),
// condPct ≥ slPct → 오지 않음(never). 기본 방식·표 없음이면 둘 다 빈 배열
export function stageLimitOf({ slMode, slPct, dcaRules } = {}) {
  const out = { condOnly: [], never: [] };
  if (slMode !== 'pct' || !dcaRules || !Array.isArray(dcaRules.stages) || !finite(slPct)) return out;
  for (const st of dcaRules.stages) {
    if (st.forcePct < slPct) continue;
    if (st.condPct < slPct) out.condOnly.push(st.stage);
    else out.never.push(st.stage);
  }
  return out;
}

// 설정 지문(§15.19-12 — 동의 지문): sha256(정렬 JSON(SIGNAL_SETTING_KEYS 칸만, auto 뺌)) → 64자 16진. 정렬 JSON은 canon-json.js(exec/lib/wire.js canonicalJson과
// 같은 바이트 — 시험이 비교). 값은 수·글·불리언·null만, 그 밖은 null. Node·브라우저 둘 다 globalThis.crypto.subtle(비동기)
export const PRINT_KEYS = Object.freeze(SIGNAL_SETTING_KEYS.filter((k) => k !== 'auto').slice().sort());
const printVal = (v) => (finite(v) || typeof v === 'string' || typeof v === 'boolean' ? v : null);
export async function settingsPrint(s, subtle = globalThis.crypto.subtle) {
  const x = s || {};
  return sha256Hex(canonJson(Object.fromEntries(PRINT_KEYS.map((k) => [k, printVal(x[k])]))), subtle);
}

// D37(설계 2026-10-16 §15.20): 회원이 고르는 칸은 자동 손절·자동매매 켜짐·이번 실행(run — 횟수·종료 시각·시작 시각·센 횟수)뿐.
// 배율·1차·익절·운용 상한은 규칙 autoRun 고정, 손절 방식은 기본 방식, 약한 신호 건너뛰기 없음 — 저장 파일에 옛 칸이 남아 있어도 닿지 않는다
// (신호 길·직접 % 감시 코드는 지우지 않고 관문 — 다시 열려면 이 함수 한 곳). 규칙에 autoRun이 없으면 옛 동작(저장값 그대로 — 옛 규칙 판 시험).
export const AUTO_KEYS = Object.freeze(['autoSl', 'auto', 'run']);
export const RUN_KEYS = Object.freeze(['max', 'until', 'startedAt', 'done']);
// 자동매매 여러 종목(대표 결정 2026-10-23 '동업자판과 같게'): run.symbols = 회원이 고른 종목(규칙 autoRun.symbols 안, 한 번에 autoRun.maxSymbols개).
// 옛 run(종목 칸 없음 — D37 BTC 하나)은 ['BTC']로 읽는다. 저장값이 규칙 목록 밖이면 그 종목만 뺀다(남는 것이 없으면 빈 목록 — 새 진입 없음)
export const RUN_SYMBOLS_KEY = 'symbols';
export const LEGACY_RUN_SYMBOLS = Object.freeze(['BTC']);
const SYM_RE = /^[A-Z0-9]{1,20}$/;
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const symList = (v) => Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && SYM_RE.test(x)) && new Set(v).size === v.length;
// 규칙이 허용하는 자동매매 종목(autoRun 없음 = 옛 판 BTC 하나)·한 번에 고르는 수
export const autoSymbols = (rules) => (rules && rules.autoRun && Array.isArray(rules.autoRun.symbols) ? [...rules.autoRun.symbols] : [...LEGACY_RUN_SYMBOLS]);
export const autoMaxSymbols = (rules) => (rules && rules.autoRun && Number.isInteger(rules.autoRun.maxSymbols) ? rules.autoRun.maxSymbols : 1);
const maxRange = (rules) => (rules && rules.autoRun && rules.autoRun.maxTrades) || { min: 1, max: 1000 };
const okMax = (v, rules) => v === null || (Number.isInteger(v) && v >= maxRange(rules).min && v <= maxRange(rules).max);
function normRun(raw, rules) {
  if (!isPlain(raw)) return null;
  const keys = Object.keys(raw);
  const withSym = Object.hasOwn(raw, RUN_SYMBOLS_KEY);
  if (keys.length !== RUN_KEYS.length + (withSym ? 1 : 0) || !RUN_KEYS.every((k) => keys.includes(k))) return null;
  if (!okMax(raw.max, rules)) return null;
  if (!(raw.until === null || finite(raw.until))) return null;
  if (!finite(raw.startedAt)) return null;
  if (!Number.isInteger(raw.done) || raw.done < 0) return null;
  if (withSym && !symList(raw.symbols)) return null;
  const allowed = autoSymbols(rules);
  const symbols = (withSym ? raw.symbols : LEGACY_RUN_SYMBOLS).filter((x) => allowed.includes(x));
  return { max: raw.max, until: raw.until, startedAt: raw.startedAt, done: raw.done, symbols };
}
export function effectiveSettings(stored, rules) {
  const x = isPlain(stored) ? stored : {};
  const autoSl = typeof x.autoSl === 'boolean' ? x.autoSl : autoSlDefault(rules);
  const auto = x.auto === true;
  const run = normRun(x.run, rules);
  const a = rules && rules.autoRun;
  if (!a) {
    return { maxMarginPct: x.maxMarginPct ?? null, lev: x.lev ?? null, firstPct: x.firstPct ?? null, tpPct: x.tpPct ?? null, slMode: x.slMode ?? null, slPct: x.slPct ?? null, skipWeak: x.skipWeak ?? false, autoSl, auto, run };
  }
  return { maxMarginPct: a.capPct, lev: a.lev, firstPct: a.firstPct, tpPct: a.tpPct, slMode: 'partner', slPct: null, skipWeak: false, autoSl, auto, run };
}

// 켜기 명령의 run 검사 — max는 null(제한 없음) 또는 횟수 범위 정수, until은 null 또는 지금 뒤·종료 시각 상한(untilMaxMin분) 안,
// symbols(있으면)는 1~autoRun.maxSymbols개·겹침 없음·규칙 목록 안. 칸이 없으면(옛 앱) 통과 — 실행기가 옛 뜻(BTC)으로 적는다
export function validateAutoRun(run, rules, now) {
  const x = isPlain(run) ? run : {};
  if (!Object.hasOwn(x, 'max') || !okMax(x.max, rules)) return { ok: false, error: 'max' };
  const capMin = (rules && rules.autoRun && rules.autoRun.untilMaxMin) || 1450;
  if (!(x.until === null || (finite(x.until) && x.until > now && x.until <= now + capMin * 60000))) return { ok: false, error: 'until' };
  if (Object.hasOwn(x, RUN_SYMBOLS_KEY)) {
    const s = x.symbols;
    const allowed = autoSymbols(rules);
    if (!symList(s) || s.length < 1 || s.length > autoMaxSymbols(rules) || !s.every((y) => allowed.includes(y))) return { ok: false, error: 'symbols' };
  }
  return { ok: true, error: null };
}

export const pickSettings = (s) => Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k] ?? null]));
const sameSettings = (a, b) => SETTING_KEYS.every((k) => (a ? a[k] ?? null : null) === (b ? b[k] ?? null : null));

// 켤 때 동의 화면(§6.2): 'full' = 처음·동의 판이나 규칙 판이 바뀜(9항목 체크), 'summary' = 방식·값을 바꿔 켬(요약 한 줄 + 다시 확인), 'none' = 같은 설정으로 다시 켬
export function consentNeeded(records, { rulesVersion, mode, settings }) {
  const list = Array.isArray(records) ? records : [];
  const same = list.filter((r) => r && r.v === CONSENT_VERSION && r.rulesVersion === rulesVersion);
  const last = same[same.length - 1];
  if (!last) return 'full';
  if (last.mode !== mode || !sameSettings(last.settings, settings)) return 'summary';
  return 'none';
}

// autoSlOn = 자동 손절 스위치 지금 값(kv.autoSl — 설정 밖이라 따로 넘긴다). 모르면 null(규칙 기본으로 보임)
export function summaryLine(settings, rules, { autoSlOn = null } = {}) {
  const on = typeof autoSlOn === 'boolean' ? autoSlOn : !(rules.follow.autoSl && rules.follow.autoSl.default === false);
  return FTEXT.summary({ mode: settings.mode, rulesVersion: rules.rulesVersion, mult: rules.follow.weightMultiplier, autoSlOn: on, maxMarginPct: settings.maxMarginPct });
}

// 화면에 보인 동의 문구 전체(textHash의 원문) — L-01·법정 고지 5줄·고지·F-03·F-05·F-11 9항목·요약 한 줄
// lev는 받기만 한다 — 10-08부터 F-05에 배율 숫자가 없어(화면 문구 규칙) 문구가 배율로 바뀌지 않는다(부르는 쪽 모양은 그대로)
export function consentText({ settings, rules, autoSlOn = null }) {
  return [FTEXT.intro, ...TEXT.legal, TEXT.notice, FTEXT.limits, FTEXT.how, ...FTEXT.consentItems, summaryLine(settings, rules, { autoSlOn })].join('\n');
}

export async function sha256Hex(text, subtle = globalThis.crypto.subtle) {
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeConsent({ ed, settings, rules, lev = 50, appVersion, now = Date.now(), subtle = globalThis.crypto.subtle, autoSlOn = null }) {
  return {
    v: CONSENT_VERSION,
    at: now,
    ed,
    mode: settings.mode,
    style: 'single',
    rulesVersion: rules.rulesVersion,
    settings: { ...pickSettings(settings), autoSl: typeof autoSlOn === 'boolean' ? autoSlOn : null }, // autoSl은 정보(비교 안 함)
    textHash: await sha256Hex(consentText({ settings, rules, lev, autoSlOn }), subtle),
    appVersion: String(appVersion ?? ''),
  };
}

// 회원이 내려받는 동의 기록 파일(F-18 '파일로 저장') — 기기에만 있는 기록을 회원이 스스로 보일 수 있게
export function consentFile(records, now = Date.now()) {
  const d = new Date(now + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  return {
    name: `ptf-follow-consent-${d}.json`,
    text: `${JSON.stringify({ kind: 'ptf-follow-consent', savedAt: now, records: Array.isArray(records) ? records : [] }, null, 2)}\n`,
  };
}
