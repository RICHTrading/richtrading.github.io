// 수동 매매 규칙(spec §5.2) — 빌드가 trade-rules.json을 검사해 config.js tradeRules에 찍는다. 모르는 칸·범위 밖이면 멈춘다.
// 자동 손절 값은 여기 없다(p34 §8.1) — autoSl 칸이 오면 '모르는 칸'으로 멈춘다. 값은 config.followRules.follow.autoSl(auto-sl.js autoSlRules).
export const CUSTOM_IND_FILES = Object.freeze(['lib/ind/big-sales.js', 'lib/ind/follow-line.js', 'lib/ind/delta.js', 'lib/ind/vp-box.js', 'lib/ind/tpsl-guide.js']);
const TOP = ['rulesVersion', 'source', 'tabs', 'entry', 'add', 'tp', 'availCap', 'bumpToMin', 'tpAfterAdd', 'indicators'];
const SYM_RE = /^[A-Z0-9]{1,20}$/;
const fail = (m) => { throw new Error(`trade-rules.json: ${m}`); };
const keysOnly = (o, keys, at) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail(`${at}는 객체`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`모르는 칸: ${at ? `${at}.` : ''}${k}`);
  for (const k of keys) if (!Object.hasOwn(o, k)) fail(`빠진 칸: ${at ? `${at}.` : ''}${k}`);
};
const num = (v, lo, hi, at, int = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (int && !Number.isInteger(v))) fail(`${at} 범위(${lo}~${hi})`);
};
const bool = (v, at) => { if (typeof v !== 'boolean') fail(`${at}는 true/false`); };
const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };

export function validateTradeRules(r) {
  keysOnly(r, TOP, '');
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(String(r.rulesVersion))) fail('rulesVersion');
  if (!/^\d{8}[a-z]?$/.test(String(r.source))) fail('source');
  keysOnly(r.tabs, ['coin', 'stock'], 'tabs');
  keysOnly(r.tabs.coin, ['lev', 'watch'], 'tabs.coin');
  keysOnly(r.tabs.stock, ['lev', 'watch', 'names'], 'tabs.stock');
  for (const t of ['coin', 'stock']) {
    num(r.tabs[t].lev, 1, 125, `tabs.${t}.lev`, true);
    if (!Array.isArray(r.tabs[t].watch) || r.tabs[t].watch.length > 30 || !r.tabs[t].watch.every((s) => SYM_RE.test(s))) fail(`tabs.${t}.watch`);
  }
  keysOnly(r.entry, ['firstPct', 'tpPct'], 'entry');
  num(r.entry.firstPct, 1, 100, 'entry.firstPct');
  num(r.entry.tpPct, 1, 1000, 'entry.tpPct');
  keysOnly(r.add, ['chips', 'default'], 'add');
  if (!Array.isArray(r.add.chips) || !r.add.chips.length) fail('add.chips');
  r.add.chips.forEach((c, i) => num(c, 1, 100, `add.chips[${i}]`));
  num(r.add.default, 1, 100, 'add.default');
  keysOnly(r.tp, ['chips'], 'tp');
  if (!Array.isArray(r.tp.chips) || !r.tp.chips.length) fail('tp.chips');
  r.tp.chips.forEach((c, i) => num(c, 1, 1000, `tp.chips[${i}]`));
  num(r.availCap, 0.5, 1, 'availCap');
  bool(r.bumpToMin, 'bumpToMin');
  if (r.tpAfterAdd !== 'keep') fail('tpAfterAdd는 keep');
  keysOnly(r.indicators, ['custom', 'backtest'], 'indicators');
  bool(r.indicators.custom, 'indicators.custom');
  bool(r.indicators.backtest, 'indicators.backtest');
  return deepFreeze(structuredClone(r));
}

export function tradeRulesOf(config) {
  return config && config.tradeRules ? config.tradeRules : null;
}
