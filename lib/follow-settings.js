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

export const SETTINGS_V = 1;
export const CONSENT_KEEP = 50;
export const SETTING_KEYS = Object.freeze(['maxMarginPct', 'maxConcurrent']);

export function defaultSettings(rules) {
  return {
    v: SETTINGS_V,
    on: false,
    mode: null,
    maxMarginPct: rules.limits.maxMarginPct.default, // null — 회원이 직접 넣는다
    maxConcurrent: rules.limits.maxConcurrent.default,
    wakeLock: false,
    rulesVersion: rules.rulesVersion,
  };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// 저장값 → 설정. 모르는 칸은 버리고, 규칙 판이 바뀌었으면 꺼 두고(rulesChanged) 회원 값은 그대로 보여 준다(새 범위 밖이면 검사에서 걸림)
export function normalizeSettings(raw, rules) {
  const d = defaultSettings(rules);
  if (!raw || typeof raw !== 'object' || raw.v !== SETTINGS_V) return { settings: d, rulesChanged: false };
  const s = { ...d };
  if (raw.mode === 'auto' || raw.mode === 'tap') s.mode = raw.mode;
  for (const k of SETTING_KEYS) if (finite(raw[k])) s[k] = raw[k];
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
