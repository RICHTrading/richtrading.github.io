// 주문 칸(p2 spec 4판 §2.1 ⑧~⑪·§2.2·§2.3·§5 — 계획 Task 25 step 5, p40 T13) — N 매매 화면 꼴: 2 카드 · 3 진입 내역 · 4 상태 · 5 알림 기록 + 시트.
// 판정 상자(1)는 따로(screens/trade-verdict.js, T12). 시트는 주문 칸 밖 자리(slots.sheet — screens/trade-sheet.js)에만: 5초 다시 그리기(render)는
// slots.orders만 바꾸고 시트 자리는 건드리지 않는다(입력칸 초점·휴대폰 키보드 유지, 검토 18·33). 그리기는 겹쳐 돌지 않는다(진행 중이면 끝난 뒤 한 번만 다시).
// 주문은 회원이 카드·시트의 마지막 버튼을 누를 때만 나간다(넘겨받은 exec — app.js의 수동 실행기). 동작이 진행 중인 종목은 그 종목의 주문 버튼을 모두 잠근다(spec §2.1).
// 자동 손절 버튼은 따라가기 엔진의 스위치 하나(toggleAutoSl — app.js가 엔진 setAutoSl 뒤 수동 실행기 applySwitch)를 부른다 — 확인 시트·잠김·맞추는 중.
// 자동 손절 발동가·남은 거리·청산가는 어디에도 그리지 않는다(보안 규칙 18, 카드 청산가 줄 없음 — spec §2.3). 잔고 배지(M-02)는 없다 — 상단 띠가 잔고를 보인다
// (CEO 2026-10-10), 시험 토큰의 기준 잔고 상한 줄만. 수량 계산 줄(M-04·M-10)은 그 계산에 쓴 사용 가능 금액을 보인다.
// DOM은 createElement·textContent만(CSP — style 속성·HTML 문자열 없음, 시트 위치는 클래스).
import {
  MTEXT, tradePanelState, panelLine, capLine, reasonText, clearText, logText, cardModel, stateLine, endedRecent, consentLines, CONSENT_V,
} from '../lib/trade-view.js';
import { AUTO_SL_TEXT } from '../lib/auto-sl.js';
import { fmtPrice } from '../lib/indicators.js';
import { fmtHM } from '../lib/auto-view.js';
import { entryFills } from '../lib/manual-store.js';
import { openSheet, closeSheet } from '../screens/trade-sheet.js';

const KAKAO = 'https://pf.kakao.com/_ICyin/chat?bot=true';
export const TOAST_MS = 30000; // 동작 결과 한 줄을 보이는 시간
export const PRE_LINES_MS = 2000; // 진입 전 선 — 지금 가격으로 2초마다(N t:686)
const CALC_MS = 350; // 추가 진입 비중 입력 뒤 계산까지
const LOG_ROWS = 10;
const SIDE = Object.freeze({ long: '롱', short: '숏' });
// 진입 내역 상태(M-22) — 그 밖(보내는 중·결과 모름·모르는 상태)은 '확인 중'(영문 상태를 그대로 보이지 않음)
const ST_WORD = Object.freeze({ filled: '진입 완료', adopted: '진입 완료', partial: '일부 체결', failed: '실패' });
// 카드가 동작하는 상태(열린 포지션 카드·상태·알림 기록) — nostore·connect·loading은 카드 한 줄만(verify는 칸 없음 — ⚡ 카드가 인증 입구)
const FULL = Object.freeze(['grace', 'blocked', 'symbol_off', 'ready']);
const CONSENT_ALL = '네 항목을 모두 체크해 주세요.';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const usd = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const px$ = (x) => (num(x) !== null && x > 0 ? fmtPrice(x) : '–');
const plain = (x) => fmtPrice(x).replace(/,/g, '');
const parseNum = (s) => Number(String(s ?? '').replace(/[,%\s]/g, ''));

export function createOrderPanel({
  doc = globalThis.document, slots, config = {}, rules, followRules = null, exec, store, chart, getCtx, price = () => null, sha256,
  toggleAutoSl = async () => null, kakaoUrl = KAKAO, now = () => Date.now(), timers = globalThis,
  go = (hash) => { globalThis.location.hash = hash; },
}) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  // 자동 손절 4차 기준(따라가기 규칙 follow.autoSl.afterStage — 트레이딩 규칙에는 자동 손절 값이 없다). ctx.autoSl에 없을 때만
  const AFTER = followRules && followRules.follow && followRules.follow.autoSl && Number.isInteger(followRules.follow.autoSl.afterStage) ? followRules.follow.autoSl.afterStage : 4;
  const busy = new Set(); // 동작이 진행 중인 종목 — 그 종목의 주문 버튼 모두 disabled
  let draft = null; // 1차 진입 전 카드 { symbol, side, q } — 기록·포지션이 생기거나 종목이 바뀌면 버림
  let toast = null; // 동작 결과 한 줄 { text, at, symbol }
  let lastCtx = null;
  let seenSym = null; // symbolChanged가 마지막으로 본 종목
  let drawnKey = null; // 차트에 넣은 선·화살표(같으면 다시 넣지 않음 — setFills는 지표를 다시 계산한다)
  let preTimer = null;
  let sheet = null; // 이 칸이 연 시트(다른 화면이 연 시트는 건드리지 않음)
  let consentDone = null; // 열린 동의 시트의 끝내기(시트가 다른 것으로 바뀌면 거절로)
  let drawing = null;
  let again = false;

  // 버튼 — 그 종목이 진행 중이면 잠금. 잠긴 버튼은 눌러도 아무것도 안 함(브라우저도 disabled는 click을 보내지 않음)
  function btn(text, cls, fn, sym = null) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (sym && busy.has(sym)) b.disabled = true;
    b.addEventListener('click', () => {
      if (b.disabled || (sym && busy.has(sym))) return;
      fn();
    });
    return b;
  }
  const box = (n, label) => {
    const b = el('div', 'tv-box tv2-box');
    if (n) b.append(el('span', 'tv-num', String(n)));
    if (label) b.append(el('span', 'tv-label', label));
    return b;
  };
  const say = (text, symbol) => { toast = text ? { text, at: now(), symbol } : null; };

  // 진행 중 잠금 — 같은 종목 동작은 하나씩(spec §2.1). 끝나면 풀고 다시 그린다. 이미 진행 중이면 null
  async function act(symbol, fn) {
    if (busy.has(symbol)) return null;
    busy.add(symbol);
    render();
    try {
      return await fn();
    } catch {
      return { ok: false, reason: 'down' };
    } finally {
      busy.delete(symbol);
      render();
    }
  }

  // 시트 — 이 칸이 연 것만 닫는다. 새로 열면 열려 있던 동의 시트는 거절로 끝
  function open(opts) {
    if (consentDone) consentDone(false);
    sheet = openSheet(slots.sheet, { doc, ...opts });
    return sheet;
  }
  function shut() {
    if (sheet) closeSheet(slots.sheet, sheet);
    sheet = null;
  }
  const sheetGone = () => !!sheet && !(slots.sheet.children && slots.sheet.children[0] === sheet);

  // 겹치지 않게 — 진행 중이면 끝난 뒤 한 번만 다시(검토 33). 돌려줌 = 이번 그리기(다시 그리기 포함)가 끝나는 약속
  function render() {
    if (drawing) {
      again = true;
      return drawing;
    }
    drawing = (async () => {
      try {
        do {
          again = false;
          await draw();
        } while (again);
      } catch {
        // 다음 주기
      } finally {
        drawing = null;
      }
    })();
    return drawing;
  }

  async function draw() {
    let ctx;
    try {
      ctx = await getCtx();
    } catch {
      return; // 다음 주기
    }
    if (!ctx || typeof ctx !== 'object') return;
    lastCtx = ctx;
    if (sheetGone()) { // 다른 화면이 시트 자리를 바꿈 — 이 칸 시트는 닫힌 것
      sheet = null;
      if (consentDone) consentDone(false);
    }
    if (draft && (draft.symbol !== ctx.symbol || ctx.rec || ctx.pos)) dropDraft();
    const st = ctx.pending === true ? 'pending' : tradePanelState(ctx);
    if (st === 'pub') {
      const parts = [];
      if (config.tradeNotice === true) {
        const p = el('p', 'trade-note', MTEXT.t13);
        const a = el('a', 'trade-link', MTEXT.t13link);
        a.href = kakaoUrl;
        a.rel = 'noopener';
        a.target = '_blank';
        p.append(' ', a);
        parts.push(p);
      }
      slots.orders.replaceChildren(...parts);
      return;
    }
    // verify(s·j판 미인증): 칸을 그리지 않는다 — 'UID 인증하기'는 같은 탭 맨 위 ⚡ 오토 모드 카드에 A-03과 한 쌍으로 하나만(자동매매 탭을 합친
    // 검토 2026-10-10 — 예전 이 칸의 버튼과 둘이 됨), N-11은 판정 상자에 한 번
    if (st === 'pending' || st === 'none' || st === 'norules' || st === 'verify') {
      slots.orders.replaceChildren();
      syncChart(ctx, false);
      return;
    }
    const S = ctx.symbol;
    const parts = [];
    if (ctx.hubDown) parts.push(el('p', 'tv2-warn', ctx.transport === 'ws' ? MTEXT.m29ws : MTEXT.m29relay));
    const card = box(2);
    if (st === 'nostore') card.append(el('p', 'tv2-warn', MTEXT.m17nostore));
    else if (st === 'connect') card.append(el('p', 'tv2-line', MTEXT.connect), btn('오렌지엑스 연결', 'tv2-one', () => go('#keys')));
    else if (st === 'loading') card.append(el('p', 'tv2-line', panelLine(st, ctx)));
    else drawCard(card, ctx, st);
    if (toast && toast.symbol === S && now() - toast.at < TOAST_MS) card.append(el('p', 'tv2-hint tv2-toast', toast.text));
    parts.push(card);
    if (FULL.includes(st)) {
      if (ctx.diag) parts.push(el('p', 'trade-note', ctx.diag)); // 시험 토큰 진단(가격 없음) — 카드 밖
      if (ctx.rec && ctx.pos) parts.push(history(ctx.rec));
      const sb = box(4, '상태');
      sb.append(el('p', 'tv2-line', stateLine({ rec: ctx.rec, pos: ctx.pos, ended: ctx.ended, now: now(), symbol: S })));
      const lg = box(5, '알림 기록');
      for (const x of (Array.isArray(ctx.log) ? ctx.log : []).slice(-LOG_ROWS).reverse()) {
        const t = logText(x);
        lg.append(el('div', 'tv-logrow', `${t.icon} · ${t.text} · ${fmtHM(x && x.at)}`));
      }
      parts.push(sb, lg, el('p', 'trade-note', MTEXT.m23));
    }
    if (st !== 'nostore') parts.push(el('p', 'trade-note', MTEXT.m25));
    slots.orders.replaceChildren(...parts);
    syncChart(ctx, FULL.includes(st));
  }

  // 카드 안(grace·blocked·symbol_off·ready): 시험 상한 줄 · 상태 줄 · 포지션 카드 | 정리만 | 확인 중 | 진입 · 자동 손절 확인 필요
  function drawCard(card, ctx, st) {
    const S = ctx.symbol;
    const cap = capLine(ctx);
    if (cap) card.append(el('div', 'tv2-ox', cap));
    const line = panelLine(st, ctx);
    if (line) card.append(el('p', 'tv2-warn', line));
    if (ctx.rec && ctx.pos && ctx.rec.state !== 'detached') drawPosition(card, ctx, st);
    else if (ctx.pos) {
      // M-20 — 따라가기로 연 포지션(기록 없음) / 이 기기 기록에 없음·분리됨: 정리만(spec §5.9)
      card.append(el('div', 'tv2-title', `${S}/USDT · ${ctx.pos.size < 0 ? '숏' : '롱'} 포지션`));
      card.append(el('p', 'tv2-hint', !ctx.rec && ctx.foreignPos === 'follow' ? MTEXT.m20follow : MTEXT.m20outside));
      const a = el('div', 'tv2-acts');
      a.append(btn('포지션 정리', 'red', () => openClose(ctx), S));
      card.append(a);
    } else if (ctx.rec) {
      card.append(el('div', 'tv2-title', `${S}/USDT · ${MTEXT.m01}`), el('p', 'tv2-hint', reasonText('checking')));
    } else if (st === 'ready') drawEntry(card, ctx);
    if (ctx.checkNeeded) {
      card.append(el('p', 'tv2-warn', AUTO_SL_TEXT.checkNeeded));
      const g = el('div', 'tv2-go one');
      g.append(btn(AUTO_SL_TEXT.clear, 'ghost', () => clearCheck(S), S));
      card.append(g, el('p', 'tv2-hint', AUTO_SL_TEXT.clearHelp));
    }
  }

  // ── 1차 진입(M-03·M-04) ──
  function drawEntry(card, ctx) {
    const S = ctx.symbol;
    const noPx = !(price(ctx.inst) > 0);
    if (!draft) {
      card.append(el('div', 'tv2-title', `${S}/USDT · ${MTEXT.m01}`));
      const g = el('div', 'tv2-go');
      for (const side of ['long', 'short']) {
        const b = btn(side === 'long' ? '롱 진입' : '숏 진입', side, () => startDraft(S, side), S);
        if (noPx) b.disabled = true;
        g.append(b);
      }
      card.append(g, el('p', 'tv2-hint', `1차 진입 · 비중 ${rules.entry.firstPct}% · 격리 · ${rules.tabs.coin.lev}× · 익절 +${rules.entry.tpPct}% 함께`), el('p', 'tv2-hint', MTEXT.m03sl));
      if (noPx) card.append(el('p', 'tv2-warn', MTEXT.m19price));
      return;
    }
    const d = draft;
    const q = d.q;
    card.append(el('div', 'tv2-title', `${S}/USDT · 1차 진입 전`));
    if (!q.ok) {
      const below = q.reason === 'below_min' && num(q.need) !== null && num(q.available) !== null;
      card.append(el('p', 'tv2-warn', below ? MTEXT.m05(S, usd(q.need), usd(q.available)) : reasonText(q.reason)));
      const g = el('div', 'tv2-go one');
      g.append(btn(MTEXT.close, 'ghost', () => { dropDraft(); render(); }));
      card.append(g);
      return;
    }
    const grid = el('div', 'tv2-grid');
    const left = el('div', 'tv2-left');
    for (const [a, b] of [['포지션', SIDE[d.side] || '—'], ['마진', '격리'], ['레버리지', `${q.lev}×`], ['비중', `${Math.round(q.pctReal)}% · 약 ${usd(q.margin)} USDT (사용 가능 ${usd(q.available)} USDT)`], ['예상 수량', `${q.amount} ${S}`]]) {
      const r = el('div', 'tv2-kv');
      r.append(el('span', 'lbl', a), el('span', 'v', b));
      left.append(r);
    }
    const right = el('div', 'tv2-right');
    right.append(el('div', 'lbl', '진입가'), el('div', 'val', px$(price(q.inst) || q.px)), el('div', 'lbl', '익절가'), el('div', 'tpv', `${px$(q.tp)} (+${rules.entry.tpPct}%)`));
    grid.append(left, right);
    card.append(grid);
    if (q.bumped) card.append(el('p', 'tv2-hint', MTEXT.m06(Math.round(q.pctReal))));
    const g = el('div', 'tv2-go draft');
    const enter = btn('▶ 진입', '', () => submitDraft(d), S);
    if (noPx) enter.disabled = true;
    g.append(enter, btn('취소', 'ghost', () => { dropDraft(); render(); }));
    card.append(g, el('p', 'tv2-hint', MTEXT.m04note), el('p', 'tv2-hint', MTEXT.m04cfg(q.lev)));
    if (noPx) card.append(el('p', 'tv2-warn', MTEXT.m19price));
  }
  // 진입 전 선 — 지금 가격 기준 평단·익절(2초마다, N t:686). 카드를 버리면 멈추고 다음 그리기가 선을 다시 맞춘다
  function startPreLines(d) {
    stopPreLines();
    const dir = d.side === 'long' ? 1 : -1;
    const tick = () => {
      if (draft !== d) return;
      const p = price(d.q.inst);
      if (p > 0) chart.setOrderLines({ avg: p, tp: p * (1 + (dir * rules.entry.tpPct) / 100 / d.q.lev), tpPct: rules.entry.tpPct });
    };
    tick();
    preTimer = timers.setInterval(tick, PRE_LINES_MS);
  }
  function stopPreLines() {
    if (preTimer !== null) timers.clearInterval(preTimer);
    preTimer = null;
  }
  function dropDraft() {
    if (!draft) return;
    draft = null;
    stopPreLines();
    drawnKey = null;
  }
  function startDraft(S, side) {
    return act(S, async () => {
      if (!(await consentOk(S))) return;
      const q = await exec.quote({ symbol: S, side, tab: 'coin' });
      if (!lastCtx || lastCtx.symbol !== S || lastCtx.rec || lastCtx.pos) return; // 그 사이 종목이 바뀌었거나 포지션이 생김
      say(null);
      draft = { symbol: S, side, q: q && typeof q === 'object' ? q : { ok: false, reason: 'down' } };
      if (draft.q.ok) startPreLines(draft);
    });
  }
  function submitDraft(d) {
    if (!d || !d.q.ok) return null;
    const q = d.q;
    say('주문 중…', d.symbol);
    return act(d.symbol, async () => {
      const r = await exec.openFirst({ mid: q.mid, symbol: d.symbol, inst: q.inst, side: d.side, tab: 'coin', shown: { qty: q.qty, margin: q.margin } });
      if (r && r.ok) {
        if (draft === d) dropDraft();
        say(logText({ key: 'entry1', symbol: d.symbol, arg: { side: d.side, price: r.fill ? num(r.fill.price) : null } }).text, d.symbol);
      } else if (r && r.reason === 'changed' && r.quote && r.quote.ok && draft === d) {
        d.q = r.quote; // 바뀐 계산을 보이고 다시 누르게(같은 카드 = 같은 식별자)
        say(reasonText('changed'), d.symbol);
      } else if (r && r.reason === 'auto_sl_check') {
        say(null); // 카드의 '확인했습니다' 줄(AUTO_SL_TEXT.checkNeeded)이 같은 글을 보인다
      } else say(reasonText(r && r.reason), d.symbol);
    });
  }

  // ── 포지션 카드(M-07·M-08·M-09·M-30) ──
  function drawPosition(card, ctx, st) {
    const rec = ctx.rec;
    const S = rec.symbol;
    const cur = price(rec.inst);
    const m = cardModel({ rec, pos: ctx.pos, px: cur, autoSl: { afterStage: AFTER, ...ctx.autoSl }, cond: ctx.cond });
    card.append(el('div', 'tv2-title', m.title));
    const grid = el('div', 'tv2-grid');
    const left = el('div', 'tv2-left');
    for (const [a, b] of m.left) {
      const r = el('div', 'tv2-kv');
      r.append(el('span', 'lbl', a), el('span', 'v', b));
      left.append(r);
    }
    const right = el('div', 'tv2-right');
    for (const [a, b, c] of m.right) right.append(el('div', 'lbl', a), el('div', c === 'val' ? 'val' : 'tpv', b));
    grid.append(left, right);
    const pct = m.pnl.pct;
    const pnl = el('div', `tv2-pnl${pct !== null && pct < 0 ? ' down' : ''}`);
    pnl.append(el('span', 'lbl', '현재 수익률'), el('span', `big ${pct !== null && pct < 0 ? 'down' : 'up'}`, pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '–'), el('span', 'meta', '증거금 기준 · 실시간'));
    const cells = el('div', 'tv2-cells');
    for (const [a, b] of [['현재가', px$(m.pnl.cur)], ['평단가', px$(m.pnl.avg)], ['평가손익', m.pnl.usdt !== null ? `${m.pnl.usdt >= 0 ? '+' : ''}${m.pnl.usdt.toFixed(2)} USDT` : '–']]) {
      const c = el('div', 'tv2-cell');
      c.append(el('span', 'lbl', a), el('b', '', b));
      cells.append(c);
    }
    pnl.append(cells);
    card.append(grid, pnl, el('div', 'tv2-asl-word', m.autoSl));
    for (const w of m.warns) card.append(el('p', 'tv2-warn', w));
    if (m.retry) {
      const g = el('div', 'tv2-go one');
      g.append(btn(AUTO_SL_TEXT.retry, 'ghost', () => retry(S), S));
      card.append(g);
    }
    const noPx = !(cur > 0);
    const acts = el('div', 'tv2-acts');
    if (st === 'ready' && rec.state === 'open') {
      const b = btn('추가 진입', '', () => openAdd(ctx), S);
      if (noPx) b.disabled = true;
      acts.append(b);
    }
    if (ctx.cond) {
      const b = btn('익절가 변경', '', () => openTp(ctx), S);
      if (noPx) b.disabled = true;
      acts.append(b);
    }
    const on = !!ctx.autoSl.on;
    const asl = btn(on ? AUTO_SL_TEXT.on : AUTO_SL_TEXT.off, `asl${on ? ' on' : ''}`, () => toggleAsl(S, !on), S);
    asl.title = AUTO_SL_TEXT.desc; // M-31(버튼 설명 — 손절가 숫자 없음)
    asl.setAttribute('aria-pressed', String(on));
    const locked = on && st === 'grace'; // 끄기 잠금은 정리 유예뿐(p34 offLocked)
    if (locked) asl.disabled = true;
    acts.append(asl, btn('포지션 정리', 'red', () => openClose(ctx), S));
    card.append(acts);
    if (noPx) card.append(el('p', 'tv2-hint', MTEXT.m19price)); // 5초 안 시세 없음 — 수익률 –, 추가 진입·익절가 변경 잠금(정리는 됨)
    if (locked) card.append(el('p', 'tv2-hint', AUTO_SL_TEXT.offLocked));
    if (!ctx.cond) card.append(el('p', 'tv2-hint', MTEXT.m18));
  }

  // 3 진입 내역(M-22) — 차수 · 비중 · 상태 · 체결가 · 시각
  function history(rec) {
    const b = box(3, '진입 내역');
    const t = el('div', 'tv2-tbl');
    const th = el('div', 'th');
    for (const h of ['차수', '비중', '상태', '체결가', '시각']) th.append(el('span', '', h));
    t.append(th);
    (Array.isArray(rec.fills) ? rec.fills : []).filter((f) => f && /^(?:e1|a\d+)$/.test(String(f.kind))).forEach((f, i) => {
      const done = f.state === 'filled' || f.state === 'adopted';
      const r = el('div', `tr${done ? ' done' : ''}`);
      r.append(
        el('span', 'c1', `${i + 1}차`),
        el('span', '', Number.isFinite(Number(f.pct)) && f.pct !== null ? `${Math.round(Number(f.pct))}%` : '—'),
        el('span', 'st', Object.hasOwn(ST_WORD, String(f.state)) ? ST_WORD[f.state] : '확인 중'),
        el('span', 'r', num(f.price) !== null && f.price > 0 && done ? fmtPrice(f.price) : '—'),
        el('span', 'r', Number.isFinite(f.at) ? fmtHM(f.at) : '—'),
      );
      t.append(r);
    });
    b.append(t);
    return b;
  }

  // 차트 선·체결 화살표(spec §3.5): 이 기기 기록의 열린 포지션(분리됨 아님)이면 평단·익절·체결, 매매가 끝난 뒤 12초는 그대로, 그 밖은 지움.
  // 같은 값이면 다시 넣지 않는다. 1차 진입 전 카드가 있으면 진입 전 선(preTimer)이 맡는다
  function syncChart(ctx, show) {
    if (draft) return;
    let spec = null;
    let fills = null;
    if (show && ctx.rec && ctx.pos && ctx.rec.state !== 'detached') {
      spec = { avg: num(ctx.pos.avg), tp: num(ctx.pos.tp), tpPct: ctx.rec.tpPct };
      fills = { symbol: ctx.rec.symbol, side: ctx.rec.side, list: entryFills(ctx.rec).filter((f) => Number.isFinite(f.at)).map((f) => ({ at: f.at })) };
    } else if (show && !ctx.pos && endedRecent(ctx.ended, now(), ctx.symbol)) {
      return; // 매매 종료 12초 동안 선·화살표 그대로(spec §2.1 ⑩)
    }
    const key = JSON.stringify([ctx.symbol, spec, fills]);
    if (key === drawnKey) return;
    drawnKey = key;
    chart.setOrderLines(spec);
    chart.setFills(fills);
  }

  // ── 시트들(주문 칸 밖 자리) ──
  const row = (a, b) => [a, b];
  async function openAdd(ctx) {
    const rec = ctx.rec;
    const S = rec.symbol;
    if (busy.has(S)) return;
    const coid = await exec.nextAddCoid(S); // 시트 하나 = 식별자 하나(같은 시트에서 다시 눌러도 같은 주문)
    if (!coid) {
      say(reasonText('changed'), S);
      render();
      return;
    }
    const input = el('input', 'tvm-input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = String(rules.add.default);
    input.setAttribute('aria-label', '비중 (%)');
    const out = el('div', 'tvm-msg');
    let q = null;
    let seq = 0;
    let timer = null;
    const pctNow = () => parseNum(input.value);
    const posNow = () => (lastCtx && lastCtx.symbol === S && lastCtx.pos ? lastCtx.pos : ctx.pos);
    const line = (r) => {
      const p = posNow();
      const size = Math.abs(Number(p && p.size)) || 0;
      const avg = num(p && p.avg);
      const next = avg !== null && size + r.qty > 0 ? (avg * size + r.px * r.qty) / (size + r.qty) : null;
      return `증거금 약 ${usd(r.margin)} USDT (사용 가능 ${usd(r.available)} USDT)${next !== null ? ` · 진입 후 평단가 약 ${fmtPrice(next)}` : ''}`;
    };
    const calc = async () => {
      const my = ++seq;
      const pct = pctNow();
      if (!(pct > 0 && pct <= 100)) {
        q = null;
        out.textContent = MTEXT.m11;
        return;
      }
      let r;
      try {
        r = await exec.quote({ symbol: S, side: rec.side, tab: rec.tab || 'coin', pct, lev: rec.lev });
      } catch {
        r = { ok: false, reason: 'down' };
      }
      if (my !== seq) return;
      q = r && r.ok ? { ...r, pct } : null;
      out.textContent = r && r.ok ? line(r) : reasonText(r && r.reason);
    };
    input.addEventListener('input', () => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => { timer = null; calc(); }, CALC_MS);
    });
    const chips = el('div', 'tvm-chips');
    for (const c of rules.add.chips) {
      const b = el('button', '', `${c}%`);
      b.type = 'button';
      b.addEventListener('click', () => { input.value = String(c); calc(); });
      chips.append(b);
    }
    const inRow = el('label', 'tvm-in');
    inRow.append(el('span', '', '비중 (%)'), input);
    open({
      title: `${S} ${SIDE[rec.side] || ''} · 지금 추가 진입하시겠습니까?`,
      rows: [row('현재가', px$(price(rec.inst))), inRow, chips, out, row('익절가', `새 평단 기준 +${rec.tpPct}%로 다시 설정`)],
      actions: [
        ['▶ 추가 진입', async () => {
          if (!q || q.pct !== pctNow()) { // 계산 전이거나 넣은 값과 다른 계산 — 다시 계산하고 한 번 더 누르게
            await calc();
            return;
          }
          const sent = q;
          const r = await act(S, () => exec.add({ symbol: S, pct: sent.pct, shown: { qty: sent.qty, margin: sent.margin }, coid }));
          if (!r) return;
          if (r.ok) {
            shut();
            say(logText({ key: 'add', symbol: S, arg: { stage: r.stage } }).text, S);
          } else if (r.reason === 'changed' && r.quote && r.quote.ok) {
            q = { ...r.quote, pct: sent.pct };
            out.textContent = `${reasonText('changed')} · ${line(r.quote)}`;
          } else {
            shut();
            say(reasonText(r.reason), S);
          }
          render();
        }],
        ['취소', () => shut(), 'ghost'],
      ],
      note: `${MTEXT.m10note} ${MTEXT.m10cap}`,
    });
    calc();
  }

  function openTp(ctx) {
    const rec = ctx.rec;
    const S = rec.symbol;
    const pos = ctx.pos;
    const dir = rec.side === 'long' ? 1 : -1;
    const input = el('input', 'tvm-input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = num(pos.tp) !== null && pos.tp > 0 ? String(pos.tp) : ''; // 기본값 = 거래소의 지금 익절가(검토 28)
    input.setAttribute('aria-label', '익절가');
    const pl = el('b', '', '–');
    const msg = el('div', 'tvm-msg');
    const show = () => {
      const v = parseNum(input.value);
      pl.textContent = v > 0 && pos.avg > 0 ? `증거금 기준 약 ${(dir * (v / pos.avg - 1) * rec.lev * 100).toFixed(1)}%` : '–';
    };
    input.addEventListener('input', show);
    const chips = el('div', 'tvm-chips');
    for (const c of rules.tp.chips) {
      const b = el('button', '', `+${c}%`);
      b.type = 'button';
      b.addEventListener('click', () => { input.value = plain(pos.avg * (1 + (dir * c) / 100 / rec.lev)); show(); });
      chips.append(b);
    }
    const plRow = el('div', 'tvm-row');
    plRow.append(el('span', '', '도달 시 손익'), pl);
    const inRow = el('label', 'tvm-in');
    inRow.append(el('span', '', '익절가'), input);
    open({
      title: `${S} ${SIDE[rec.side] || ''} · 익절가를 변경하시겠습니까?`,
      rows: [row('평단가', px$(pos.avg)), row('현재가', px$(price(rec.inst))), inRow, chips, plRow, msg],
      actions: [
        ['익절가 변경', async () => {
          const v = parseNum(input.value);
          if (!(v > 0)) {
            msg.textContent = MTEXT.m14(dir > 0);
            return;
          }
          const r = await act(S, () => exec.changeTp({ symbol: S, price: v }));
          if (!r) return;
          if (!r.ok && r.reason === 'tp_dir') { // 시트 그대로 — 고쳐서 다시
            msg.textContent = MTEXT.m14(dir > 0);
            return;
          }
          shut();
          say(r.ok ? logText({ key: 'tp_changed', symbol: S }).text : reasonText(r.reason), S);
          render();
        }],
        ['취소', () => shut(), 'ghost'],
      ],
      note: MTEXT.m12note,
    });
    show();
  }

  // 포지션 정리(M-15, 빨강) — 어느 포지션이든(수동·분리됨·따라가기·바깥) 정리만은 된다
  function openClose(ctx) {
    const S = ctx.symbol;
    const pos = ctx.pos;
    const dir = pos.size > 0 ? 1 : -1;
    const cur = price(ctx.inst);
    const lev = ctx.rec ? ctx.rec.lev : null;
    const pct = lev && cur > 0 && pos.avg > 0 ? dir * (cur / pos.avg - 1) * lev * 100 : null;
    const upl = num(pos.upl);
    const est = [upl !== null ? `${upl >= 0 ? '+' : ''}${upl.toFixed(2)} USDT` : '', pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : ''].filter(Boolean).join(' · ');
    open({
      title: '포지션을 시장가로 전량 정리하시겠습니까?',
      rows: [row('종목', `${S}/USDT 무기한`), row('방향', dir > 0 ? '롱' : '숏'), row('평단가', px$(pos.avg)), row('현재가', px$(cur)), row('예상 손익', `${est || '–'} (거래 비용 제외)`)],
      actions: [
        ['시장가 전량 정리', async () => {
          const r = await act(S, () => exec.close({ symbol: S }));
          if (!r) return;
          shut();
          say(r.ok ? (r.tpLeft ? MTEXT.m15left : '포지션을 정리했습니다') : reasonText(r.reason), S);
          render();
        }, 'red'],
        ['취소', () => shut(), 'ghost'],
      ],
      red: true,
      note: MTEXT.m15note,
    });
  }

  // 자동 손절 버튼 — 엔진 스위치 하나(toggleAutoSl): confirm → 빨간 확인 시트(끄기 = confirmed), locked → offLocked, busy → 맞추는 중
  function aslResult(r, on, S) {
    if (r && r.confirm) {
      openConfirm(S);
      return;
    }
    if (r && r.ok) say(on ? AUTO_SL_TEXT.toastOn : AUTO_SL_TEXT.toastOff, S);
    else if (r && r.locked) say(AUTO_SL_TEXT.offLocked, S);
    else if (r && r.busy) say(AUTO_SL_TEXT.busy, S);
    else if (r && typeof r.error === 'string' && r.error) say(r.error, S);
    else say(reasonText('down'), S);
  }
  function toggleAsl(S, on) {
    return act(S, async () => aslResult(await toggleAutoSl(on, {}), on, S));
  }
  function openConfirm(S) {
    open({
      title: AUTO_SL_TEXT.label,
      rows: [el('p', 'tvm-msg', AUTO_SL_TEXT.confirmOff)],
      actions: [
        [AUTO_SL_TEXT.confirmGo, async () => {
          const r = await act(S, () => toggleAutoSl(false, { confirmed: true }));
          if (!r) return;
          shut();
          aslResult(r.confirm ? { ok: false } : r, false, S);
          render();
        }, 'red'],
        [AUTO_SL_TEXT.confirmCancel, () => shut(), 'ghost'],
      ],
      red: true,
    });
  }
  function retry(S) {
    return act(S, async () => {
      const r = await exec.retry({ symbol: S });
      say(r && r.ok ? null : reasonText(r && r.reason), S);
    });
  }
  // '확인했습니다'(p35 §5.3 — 실행기가 종목 큐 안에서 포지션부터 확인)
  function clearCheck(S) {
    return act(S, async () => {
      const r = await exec.clearCheck({ symbol: S });
      say(r && r.ok ? null : clearText(r && r.reason), S);
    });
  }

  // 처음 쓸 때 4항목(M-26) — kv.manual.consent에 { v, at, ed, rulesVersion, textHash, appVersion }(3-3 따라가기 동의 kv.consent와 섞지 않음)
  async function consentOk(S) {
    const lines = consentLines({ rules });
    const hash = await sha256(lines.join('\n'));
    let list = [];
    try {
      const r = await store.get();
      list = r && Array.isArray(r.consent) ? r.consent : [];
    } catch {
      list = [];
    }
    if (list.some((c) => c && c.v === CONSENT_V && c.textHash === hash && c.rulesVersion === rules.rulesVersion)) return true;
    return new Promise((resolve) => {
      const checks = lines.map((t) => {
        const l = el('label', 'tvm-check');
        const c = el('input');
        c.type = 'checkbox';
        l.append(c, el('span', '', t));
        return { l, c };
      });
      const msg = el('div', 'tvm-msg');
      let mine = null;
      const finish = (v) => {
        if (consentDone !== finish) return;
        consentDone = null;
        if (sheet === mine) shut();
        resolve(v);
      };
      mine = open({
        title: '처음 쓸 때 확인',
        rows: [...checks.map((x) => x.l), msg],
        actions: [
          ['확인하고 쓰기', async () => {
            if (!checks.every((x) => x.c.checked)) {
              msg.textContent = CONSENT_ALL;
              return;
            }
            try {
              await store.update((r) => {
                r.consent = [...(Array.isArray(r.consent) ? r.consent : []), { v: CONSENT_V, at: now(), ed: config.edition, rulesVersion: rules.rulesVersion, textHash: hash, appVersion: config.version }];
              });
            } catch {
              say(MTEXT.m17store, S);
              finish(false);
              return;
            }
            finish(true);
          }],
          ['취소', () => finish(false), 'ghost'],
        ],
      });
      consentDone = finish; // open()이 앞 동의 시트를 끝낸 뒤에 건다
    });
  }

  // 종목을 바꾸면(app.js onSymbol — 탭이 다시 보일 때도 같은 종목으로 불림): 다른 종목이면 1차 진입 전 카드·결과 줄을 버리고 선을 다시 맞춘다
  function symbolChanged(s) {
    if (s !== seenSym) {
      seenSym = s;
      if (draft && draft.symbol !== s) dropDraft();
      drawnKey = null;
      if (toast && toast.symbol !== s) toast = null;
    }
    return render();
  }
  function dispose() {
    stopPreLines();
    if (consentDone) consentDone(false);
    shut();
  }

  return { render, tick: () => render(), symbolChanged, dispose };
}
