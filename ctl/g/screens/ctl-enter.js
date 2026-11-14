// 동업자 컨트롤러 새 진입 입력 칸(계획 2026-10-30 Task 11 — 대표 결정 2026-10-30 저녁 A, 판단 R15: screens/ctl.js에서 뺀 것).
// 대표 결정 2026-11-01(설계 §9-9·10, 계획 Task 12 — 판단 R16·R17): 새 진입 시트 위 탭 둘 —
// - 기본(buildEnterForm): 종목 칩(.ctl-en-sym — 규칙 종목만)·방향(.ctl-en-dir 롱/숏) + 고정 값 한 줄(.ctl-en-fixed — AI 진입과 같은 1차 % → 2~4차·배율·익절).
//   배율·비중·익절 입력은 없다. read()는 enterDefaults 값에 고른 종목·방향을 얹어 enterFixedOk를 지난 값만(아니면 null).
// - 수동(buildBuyForm — 거래소 주문 칸처럼): 종목 칩(.ctl-by-sym)·배율(input.ctl-by-lev — 정수 1~상한)·비중 %(칩 .ctl-by-pctchip BUY_PCT_CHIPS + input.ctl-by-pct)·
//   익절 %(칩 .ctl-by-tpchip + input.ctl-by-tp — 비우면 익절 없음)·더 사기 한 줄(.ctl-by-note)·[매수·롱] [매도·숏](.ctl-by-side — 누르면 onSide(방향)).
//   read(dir)는 buyArgsOk를 지난 값만(아니면 null — 화면이 '값을 확인해 주세요').
// - 수동 탭의 닫기(buildReduceForm — 계획 Task 13, R18): 종목 칩·줄일 비중 %(칩 + 정수 입력)·[줄이기]. 열기·닫기 고르기는 screens/ctl.js가 칸 위에 둔다.
// 크기·금액은 받지 않는다(서버가 회원마다 계산 — R6). DOM은 createElement·textContent만(CSP — 인라인 꾸밈 속성·HTML 문자열 넣기 없음)
import { CTL_TEXT } from '../lib/ctl-text.js';
import { enterDefaults, enterFixedOk, buyArgsOk, reduceArgsOk, addmArgsOk, CTL_ENTER_DIRS, BUY_PCT_CHIPS, REDUCE_PCT_CHIPS, ADDM_PCT_CHIPS } from '../lib/ctl-enter-rules.js';

function kit(doc) {
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const chip = (cls, text, onClick) => {
    const b = el('button', `ui-chip ${cls}`, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  // 칩 한 줄 — 이름표는 종목 줄만(방향 줄·칩 줄은 롱/숏·N% 글자가 곧 이름)
  const row = (label, kids) => {
    const r = el('div', 'ctl-en-row');
    if (label) r.append(el('span', 'ctl-en-k', label));
    r.append(...kids);
    return r;
  };
  const on = (b, yes) => {
    b.classList.toggle('on', yes);
    b.setAttribute('aria-pressed', String(yes));
  };
  return { el, chip, row, on };
}

// rules = enterRulesOf(…) 결과, init = 처음 값 { symbol, dir, … }(enterDefaults) → { node, read }
export function buildEnterForm({ doc, rules, init }) {
  const T = CTL_TEXT.enter;
  const { el, chip, row, on } = kit(doc);
  const st = { symbol: rules.symbols.includes(init.symbol) ? init.symbol : rules.symbols[0], dir: CTL_ENTER_DIRS.includes(init.dir) ? init.dir : 'long' };
  const syms = rules.symbols.map((s) => {
    const b = chip('ctl-en-sym', s, () => { st.symbol = s; paint(); });
    b.dataset.sym = s;
    return b;
  });
  const dirs = CTL_ENTER_DIRS.map((d) => {
    const b = chip(`ctl-en-dir ${d}`, T.side[d], () => { st.dir = d; paint(); });
    b.dataset.dir = d;
    return b;
  });
  const node = el('div', 'ctl-en');
  node.append(row(T.symbol, syms), row(null, dirs), el('p', 'ctl-en-fixed', T.fixed(rules)));
  function paint() {
    for (const b of syms) on(b, b.dataset.sym === st.symbol);
    for (const b of dirs) on(b, b.dataset.dir === st.dir);
  }
  paint();
  // 값은 늘 AI 진입과 같은 배율·비중·익절(R16 — 허브도 다른 값은 400 bad_args)
  function read() {
    const a = { ...enterDefaults(rules), symbol: st.symbol, dir: st.dir };
    return enterFixedOk(a, rules) ? a : null;
  }
  return { node, read };
}

// rules = enterRulesOf(…) 결과, init = 처음 값(buyDefaults — 첫 종목·배율 상한·비중 25·익절 없음), onSide(dir) = [매수·롱]·[매도·숏]을 누름 → { node, read(dir) }
export function buildBuyForm({ doc, rules, init, onSide = () => {} }) {
  const T = CTL_TEXT.buy;
  const { el, chip, row, on } = kit(doc);
  const numInput = (cls, max, step, value, label, mode) => {
    const i = el('input', cls);
    i.type = 'number';
    i.setAttribute('min', '1');
    i.setAttribute('max', String(max));
    i.setAttribute('step', step);
    i.setAttribute('inputmode', mode);
    i.setAttribute('aria-label', label);
    i.value = value == null ? '' : String(value);
    i.addEventListener('input', () => paint());
    return i;
  };
  const field = (label, inp) => {
    const l = el('label', 'ctl-field ctl-en-num');
    l.append(el('span', 'ctl-field-k', label), inp);
    return l;
  };
  const st = { symbol: rules.symbols.includes(init.symbol) ? init.symbol : rules.symbols[0] };
  const syms = rules.symbols.map((s) => {
    const b = chip('ctl-by-sym', s, () => { st.symbol = s; paint(); });
    b.dataset.sym = s;
    return b;
  });
  const lev = numInput('ctl-by-lev', rules.maxLev, '1', init.lev, CTL_TEXT.enter.lev, 'numeric');
  const pct = numInput('ctl-by-pct', 100, 'any', init.pct, T.pct, 'decimal');
  const tp = numInput('ctl-by-tp', 1000, 'any', init.tpPct, T.tp, 'decimal');
  tp.setAttribute('placeholder', T.tpNone);
  const pctChips = BUY_PCT_CHIPS.map((c) => {
    const b = chip('ctl-by-pctchip', `${c}%`, () => { pct.value = String(c); paint(); });
    b.dataset.pct = String(c);
    return b;
  });
  const tpChips = rules.tpChips.map((c) => {
    const b = chip('ctl-by-tpchip', `+${c}%`, () => { tp.value = String(c); paint(); });
    b.dataset.tp = String(c);
    return b;
  });
  const sides = el('div', 'ctl-by-sides');
  for (const d of CTL_ENTER_DIRS) {
    const b = el('button', `big-btn ctl-by-side ${d}`, d === 'short' ? T.short : T.long);
    b.type = 'button';
    b.dataset.dir = d;
    b.addEventListener('click', () => onSide(d));
    sides.append(b);
  }
  const nums = el('div', 'ctl-en-nums');
  nums.append(field(CTL_TEXT.enter.lev, lev), field(T.pct, pct), field(T.tp, tp));
  const node = el('div', 'ctl-en ctl-by');
  // 칸 이름 '열기'는 칸 위 고르기(screens/ctl.js — 열기·닫기, 계획 Task 13)가 맡는다
  node.append(row(CTL_TEXT.enter.symbol, syms), nums, row(null, pctChips), row(null, tpChips), el('p', 'ctl-by-note', T.addNote), sides);

  const text = (i) => String(i.value == null ? '' : i.value).trim();
  const numOf = (i) => (text(i) === '' ? Number.NaN : Number(text(i)));
  function paint() {
    for (const b of syms) on(b, b.dataset.sym === st.symbol);
    const p = numOf(pct);
    for (const b of pctChips) on(b, Number(b.dataset.pct) === p);
    const t = numOf(tp);
    for (const b of tpChips) on(b, Number(b.dataset.tp) === t);
  }
  paint();
  // 익절 칸이 비면 익절 없음(null)
  function read(dir) {
    const a = { symbol: st.symbol, dir, lev: numOf(lev), pct: numOf(pct), tpPct: text(tp) === '' ? null : numOf(tp) };
    return buyArgsOk(a, rules) ? a : null;
  }
  return { node, read };
}

// 수동 모드 닫기(계획 Task 13 — 대표 결정 2026-11-01 R18): 종목 칩(.ctl-rd-sym)·줄일 비중 %(칩 .ctl-rd-pctchip REDUCE_PCT_CHIPS + input.ctl-rd-pct — 정수 1~100)·
// [줄이기](.ctl-rd-run — 누르면 onRun()). read()는 reduceArgsOk를 지난 값 { symbol, pct }만(아니면 null — 화면이 '값을 확인해 주세요')
// rules = enterRulesOf(…) 결과, init = 처음 값(reduceDefaults — 첫 종목·25%) → { node, read }
export function buildReduceForm({ doc, rules, init, onRun = () => {} }) {
  const T = CTL_TEXT.reduce;
  const { el, chip, row, on } = kit(doc);
  const st = { symbol: rules.symbols.includes(init.symbol) ? init.symbol : rules.symbols[0] };
  const syms = rules.symbols.map((s) => {
    const b = chip('ctl-rd-sym', s, () => { st.symbol = s; paint(); });
    b.dataset.sym = s;
    return b;
  });
  const pct = el('input', 'ctl-rd-pct');
  pct.type = 'number';
  pct.setAttribute('min', '1');
  pct.setAttribute('max', '100');
  pct.setAttribute('step', '1');
  pct.setAttribute('inputmode', 'numeric');
  pct.setAttribute('aria-label', T.pct);
  pct.value = init.pct == null ? '' : String(init.pct);
  pct.addEventListener('input', () => paint());
  const field = el('label', 'ctl-field ctl-en-num');
  field.append(el('span', 'ctl-field-k', T.pct), pct);
  const chips = REDUCE_PCT_CHIPS.map((c) => {
    const b = chip('ctl-rd-pctchip', `${c}%`, () => { pct.value = String(c); paint(); });
    b.dataset.pct = String(c);
    return b;
  });
  const run = el('button', 'big-btn accent ctl-rd-run', T.run);
  run.type = 'button';
  run.addEventListener('click', () => onRun());
  const node = el('div', 'ctl-en ctl-rd');
  node.append(row(CTL_TEXT.enter.symbol, syms), field, row(null, chips), run);
  const text = () => String(pct.value == null ? '' : pct.value).trim();
  const numOf = () => (text() === '' ? Number.NaN : Number(text()));
  function paint() {
    for (const b of syms) on(b, b.dataset.sym === st.symbol);
    const p = numOf();
    for (const b of chips) on(b, Number(b.dataset.pct) === p);
  }
  paint();
  function read() {
    const a = { symbol: st.symbol, pct: numOf() };
    return reduceArgsOk(a, rules) ? a : null;
  }
  return { node, read };
}

// 수동 추가(대표 요청 2026-11-04): 종목 칩(.ctl-am-sym)·잔고 비중 %(칩 .ctl-am-pctchip ADDM_PCT_CHIPS + input.ctl-am-pct — 정수 1~100)·한 줄(.ctl-am-note).
// [다음]은 시트(screens/ctl.js)가 둔다. read()는 addmArgsOk를 지난 값 { symbol, pct }만(아니면 null). rules = enterRulesOf(…) 결과, init = addmDefaults → { node, read }
export function buildAddmForm({ doc, rules, init }) {
  const T = CTL_TEXT.addm;
  const { el, chip, row, on } = kit(doc);
  const st = { symbol: rules.symbols.includes(init.symbol) ? init.symbol : rules.symbols[0] };
  const syms = rules.symbols.map((s) => {
    const b = chip('ctl-am-sym', s, () => { st.symbol = s; paint(); });
    b.dataset.sym = s;
    return b;
  });
  const pct = el('input', 'ctl-am-pct');
  pct.type = 'number';
  pct.setAttribute('min', '1');
  pct.setAttribute('max', '100');
  pct.setAttribute('step', '1');
  pct.setAttribute('inputmode', 'numeric');
  pct.setAttribute('aria-label', T.pct);
  pct.value = init.pct == null ? '' : String(init.pct);
  pct.addEventListener('input', () => paint());
  const field = el('label', 'ctl-field ctl-en-num');
  field.append(el('span', 'ctl-field-k', T.pct), pct);
  const chips = ADDM_PCT_CHIPS.map((c) => {
    const b = chip('ctl-am-pctchip', `${c}%`, () => { pct.value = String(c); paint(); });
    b.dataset.pct = String(c);
    return b;
  });
  const node = el('div', 'ctl-en ctl-am');
  node.append(row(CTL_TEXT.enter.symbol, syms), field, row(null, chips), el('p', 'ctl-by-note ctl-am-note', T.note));
  const text = () => String(pct.value == null ? '' : pct.value).trim();
  const numOf = () => (text() === '' ? Number.NaN : Number(text()));
  function paint() {
    for (const b of syms) on(b, b.dataset.sym === st.symbol);
    const p = numOf();
    for (const b of chips) on(b, Number(b.dataset.pct) === p);
  }
  paint();
  function read() {
    const a = { symbol: st.symbol, pct: numOf() };
    return addmArgsOk(a, rules) ? a : null;
  }
  return { node, read };
}
