// 서버 판 트레이딩 탭 주문 칸(설계 2026-10-16 §15.20 ④⑤⑥·§15.8·D30·D31·D36·Q26, 계획 2026-10-22 작업 12) — 서버 판(SERVER_OK)만, 아니면 옛 createOrderPanel.
// 휴대폰은 주문하지 않는다: 1차·N차·정리는 실행기 명령(manual — app/lib/server-manual.js), 그 뒤 익절·2·3·4차·손절 감시는 실행기가 표대로(D30).
// - 열린 매매(서버 회원 상태 trades 중 open·opening·closing) 카드: 종목·이름표(수동 | 자동매매)·상태 칸(방향·배율·차수 n/4·손절 감시 중·서버 연결 확인 중 —
//   auto-run-view tradeStatusLine)·[n차 진입](수동 매매에만·다음 차수 하나 — 'n차 진입 하시겠습니까?' 확인 뒤, 4차 뒤 없음)·[포지션 정리](확인 뒤)
// - 지금 종목에 열린 매매가 없으면 [롱 진입]·[숏 진입] → 시트(수량·증거금·배율·익절 %·자동 손절 한 줄 — 가격 숫자 없음) → [1차 진입]
// - 등록 안 된 회원(수동 자격 있음)은 '서버 등록이 필요합니다' + [등록하기](onEnroll — 키 잠금 → 등록만(동의 창 없음 — 대표 결정 2026-10-23), on 명령 없음: 등록 ≠ 켜기, D30·§15.9)
// - 같은 종목 동작은 하나씩(응답 전 두 번 누름 무시 — 명령 1건). 결과 한 줄은 30초. 5초 다시 그리기(render)는 시트 자리를 건드리지 않는다.
// 손절가·청산가·발동가는 어디에도 그리지 않는다(보안 규칙 18). DOM은 createElement·textContent만(CSP)
// 2026-10-23 대표(합치기 — '따로 있어야 될 이유를 모르겠는데 합쳐'): 이 칸이 ⚡ AI 자동매매 카드 안(modes/trade.js — 판정 바로 아래)에 들어가고,
// 옛 ⚡ 카드 줄 '내 자동매매 · ● 내 포지션 …'은 여기 포지션 카드가 맡는다 — 회원 자기 열린 매매 전부(지금 종목 먼저)·실시간 수익률(배율 반영 ROE)·
// 미실현 손익(USDT, 거래 비용 제외)·수량·평단·익절가(AI 익절과 같은 식 — 회원 자기 평단·익절 %). 수동 자격이 없는 자동매매 회원도 포지션은 보인다(버튼만 없음).
// 가격은 넘겨받은 price(inst)(셸이 이미 받는 실시간 시세), 수량은 getState().pos[inst].size(이 기기 키로 읽은 거래소 포지션 — 5초 캐시). live()는 1초마다
// 가격 칸만 다시 쓴다(버튼·시트는 그대로). 차트(chart): 회원 trades → 내 매매 마커(serverTradeMarks — 서버 판에서 마커가 사라진 원인 고침)·평단·익절 선
import { MTEXT } from '../lib/trade-view.js';
import { serverTradeMarks } from '../lib/chart-my-trades.js';
import { AUTO_SL_TEXT } from '../lib/auto-sl.js';
import { fmtPrice } from '../lib/auto-view.js';
import { tradeStatusLine, addButtonOf } from '../lib/auto-run-view.js';
import { cmdErrText } from '../lib/server-cmd-flow.js';
import { HEDGE_TEXT } from '../lib/hedge-text.js';
import { openSheet, closeSheet } from '../screens/trade-sheet.js';
import { ER_TEXT, entryRefModel } from '../lib/entry-ref.js';
// 진입 참고가 카드(대표 결정 2026-10-25 — 보안 규칙 22 예외): setEntry(ref)로 이 칸 맨 앞에 '진입 참고가' 상자(사무실 판정판 '▶ 진입가·익절가 보기' →
// app.js가 허브 분석 항목으로 만든 값). [진입하기] → quote → 확인 시트 '{종목} {롱/숏} 1차 진입 · N× · 잔고 N%' [진입]/[취소] → manual.openFirst
// (지금 [롱 진입]·[숏 진입] 시트와 같은 명령 manual_entry — 방향은 그 판정 방향). 보이기만으로는 아무 호출도 없다. 막는 이유(자격·30분·오토 모드·
// 그 종목 열린 매매·등록 전)는 버튼 대신 한 줄 — [진입]을 누른 그때 한 번 더 본다

export const SO_TEXT = Object.freeze({
  needEnroll: '서버 등록이 필요합니다', enroll: '등록하기', long: '롱 진입', short: '숏 진입', first: '1차 진입', close: '포지션 정리', cancel: '닫기',
  manual: '수동', auto: '오토 모드', qty: '수량', margin: '증거금', lev: '배율', tp: '익절', sl: '손절',
  addConfirm: (n) => `${n}차 진입 하시겠습니까?`, closeConfirm: '포지션을 정리할까요?',
  firstDone: '1차 진입 완료', addDone: (n) => `${n}차 진입 완료`, closeDone: '정리했습니다', enrollDone: '등록됐습니다',
  sheetTitle: (side) => `${side === 'long' ? '롱' : '숏'} 1차 진입`,
  // 합친 카드 실시간 칸(2026-10-23)
  none: '○ 내 열린 포지션 없음', pct: '수익률', upl: '미실현 손익', avg: '평단', tpPx: '익절가', liveNote: '배율 반영 · 거래 비용 제외 · 실시간',
});
const LIVE = new Set(['open', 'opening', 'closing']);
const TOAST_MS = 30000;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const instOf = (sym) => `${sym}-USDT-PERPETUAL`;

// 매매 하나의 실시간 칸(순수): 수익률 % = 방향 × (현재가/평단 − 1) × 배율 × 100, 미실현 = 방향 × (현재가 − 평단) × |수량|, 익절가 = 평단 × (1 + 방향 × 익절%/(100 × 배율))
export function positionLive(t, { px = null, size = null, tpPct = null } = {}) {
  const dir = t && t.side === 'short' ? -1 : 1;
  const avg = t && fin(t.avg) && t.avg > 0 ? t.avg : null;
  const lev = t && Number.isInteger(t.lev) && t.lev > 0 ? t.lev : null;
  const cur = fin(px) && px > 0 ? px : null;
  const qty = fin(size) && size !== 0 ? Math.abs(size) : null;
  return {
    pct: avg && lev && cur ? dir * (cur / avg - 1) * lev * 100 : null,
    upl: avg && cur && qty ? dir * (cur - avg) * qty : null,
    qty,
    avg,
    tp: avg && lev && fin(tpPct) && tpPct > 0 ? avg * (1 + (dir * tpPct) / 100 / lev) : null,
  };
}
const pctText = (v) => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const uplText = (v) => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} USDT`);

export function createServerOrderPanel({
  doc = globalThis.document, slots, rules, followRules = null, manual, getState = () => ({}), onHedge = () => {}, onEnroll = async () => ({ ok: false }),
  confirmFn = (m) => globalThis.confirm(m), now = () => Date.now(), chart = null, price = () => null,
} = {}) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const busy = new Set();
  let toast = null;
  let sheet = null;
  let cells = []; // live()가 다시 쓰는 칸 — { t, size, tpPct, pct, upl }
  let drawnMarks; // 차트에 넣은 마커·선(같으면 다시 넣지 않음 — 처음은 undefined라 한 번 넣음)
  let drawnLines;
  let entry = null; // 진입 참고가 카드 값({ id, symbol, side, entry, tp, at }) | null
  let entryMsg = null; // 카드를 못 만든 이유 한 줄(불러오기 실패·진입 참고가 없음)
  const say = (text) => { toast = text ? { text, at: now() } : null; };
  // 익절 % — 수동 매매는 트레이딩 규칙 1차 익절, 신호 매매는 자동매매 고정 값(autoRun — 없으면 회원 기본값)
  const tpPctOf = (t) => {
    if (t && t.src === 'manual') return rules && rules.entry ? rules.entry.tpPct : null;
    const fr = followRules || {};
    if (isObj(fr.autoRun) && fin(fr.autoRun.tpPct)) return fr.autoRun.tpPct;
    return isObj(fr.member) && isObj(fr.member.tpPct) && fin(fr.member.tpPct.default) ? fr.member.tpPct.default : null;
  };
  const pxOf = (sym) => {
    try {
      const v = price(instOf(sym));
      return fin(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  };
  function btn(text, cls, fn, sym, id = null) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (id) b.id = id;
    if (sym && busy.has(sym)) b.disabled = true;
    b.addEventListener('click', () => {
      if (b.disabled || (sym && busy.has(sym))) return;
      fn();
    });
    return b;
  }
  async function act(sym, fn) {
    if (busy.has(sym)) return null;
    busy.add(sym);
    render();
    try {
      return await fn();
    } catch {
      return { ok: false, reason: 'down' };
    } finally {
      busy.delete(sym);
      render();
    }
  }
  const sayResult = (r, okText) => {
    if (r && r.ok === true) say(okText);
    else {
      const reason = r && r.reason;
      if (reason === 'hedge_mode') {
        try {
          onHedge();
        } catch {
          // 창은 덤
        }
      }
      say(reason === 'hedge_mode' ? HEDGE_TEXT.line : cmdErrText(reason));
    }
  };
  function shut() {
    if (sheet) closeSheet(slots.sheet, sheet);
    sheet = null;
  }
  async function openFirstSheet(sym, side) {
    let q;
    try {
      q = await manual.quote({ symbol: sym, side, tab: 'coin' });
    } catch {
      q = null;
    }
    if (!q || q.ok !== true) {
      say(cmdErrText(q && q.reason));
      render();
      return;
    }
    const tpPct = rules && rules.entry ? rules.entry.tpPct : null;
    sheet = openSheet(slots.sheet, {
      doc,
      title: SO_TEXT.sheetTitle(side),
      rows: [[SO_TEXT.qty, String(q.qty)], [SO_TEXT.margin, `${Number(q.margin).toFixed(2)} USDT`], [SO_TEXT.lev, `${q.lev}×`], [SO_TEXT.tp, `+${tpPct}%`], [SO_TEXT.sl, AUTO_SL_TEXT.desc]],
      actions: [
        [SO_TEXT.first, async () => {
          shut();
          const r = await act(sym, () => manual.openFirst({ symbol: sym, side, q }));
          if (r) sayResult(r, SO_TEXT.firstDone);
          render();
        }, 'tso-go'],
        [SO_TEXT.cancel, async () => { shut(); }, 'tso-cancel'],
      ],
    });
  }
  const kv = (label, value, cls = '') => {
    const c = el('div', `tso-kv${cls ? ` ${cls}` : ''}`);
    const v = el('b', '', value);
    c.append(el('span', 'lbl', label), v);
    return { c, v };
  };
  function fillLive(cell) {
    const m = positionLive(cell.t, { px: pxOf(cell.t.symbol), size: cell.size, tpPct: cell.tpPct });
    cell.pct.textContent = pctText(m.pct);
    cell.pct.className = `tso-pct${m.pct !== null && m.pct < 0 ? ' down' : ' up'}`;
    cell.upl.textContent = uplText(m.upl);
    cell.upl.className = `tso-upl${m.upl !== null && m.upl < 0 ? ' down' : ' up'}`;
  }
  function card(t, st, pos, manualOk) {
    const sym = t.symbol;
    const box = el('div', 'tso-card');
    const head = el('div', 'tso-head');
    head.append(el('span', 'tso-sym', sym));
    head.append(el('span', `tso-tag ${t.src === 'manual' ? 'manual' : 'auto'}`, t.src === 'manual' ? SO_TEXT.manual : SO_TEXT.auto));
    head.append(el('span', 'tso-line', tradeStatusLine(t, { execUp: !!(st.exec && st.exec.up === true) })));
    box.append(head);
    // 실시간 칸: 수익률(크게)·미실현 손익 / 수량·평단·익절가
    const p = pos && isObj(pos[instOf(sym)]) && fin(pos[instOf(sym)].size) ? pos[instOf(sym)].size : null;
    const cell = { t, size: p, tpPct: tpPctOf(t), pct: null, upl: null };
    const m = positionLive(t, { size: p, tpPct: cell.tpPct });
    const pnl = el('div', 'tso-pnl');
    const a = kv(SO_TEXT.pct, '–', 'big');
    const b = kv(SO_TEXT.upl, '–');
    cell.pct = a.v;
    cell.upl = b.v;
    pnl.append(a.c, b.c);
    const grid = el('div', 'tso-grid');
    grid.append(
      kv(SO_TEXT.qty, m.qty !== null ? `${m.qty} ${sym}` : '–').c,
      kv(SO_TEXT.avg, fmtPrice(m.avg) || '–').c,
      kv(SO_TEXT.tpPx, fmtPrice(m.tp) || '–').c,
    );
    box.append(pnl, grid, el('p', 'tso-note', SO_TEXT.liveNote));
    fillLive(cell);
    cells.push(cell);
    if (manualOk) {
      const bar = el('div', 'tso-btns');
      const ab = addButtonOf(t);
      if (ab) {
        bar.append(btn(ab.text, 'tso-add', async () => {
          let yes = false;
          try {
            yes = confirmFn(SO_TEXT.addConfirm(ab.stage)) === true;
          } catch {
            yes = false;
          }
          if (!yes) return;
          const r = await act(sym, () => manual.add({ tradeId: t.id, stage: ab.stage }));
          if (r) sayResult(r, SO_TEXT.addDone(ab.stage));
          render();
        }, sym, 'tso-add'));
      }
      if (t.state === 'open') {
        bar.append(btn(SO_TEXT.close, 'tso-close', async () => {
          let yes = false;
          try {
            yes = confirmFn(SO_TEXT.closeConfirm) === true;
          } catch {
            yes = false;
          }
          if (!yes) return;
          const r = await act(sym, () => manual.close({ tradeId: t.id }));
          if (r) sayResult(r, SO_TEXT.closeDone);
          render();
        }, sym, 'tso-close'));
      }
      if (bar.children.length) box.append(bar);
    }
    return box;
  }

  // ── 진입 참고가 카드 ──
  const refModel = () => {
    const s = getState() || {};
    return entryRefModel(entry, { now: now(), st: isObj(s.st) ? s.st : null, manualOk: !!s.manualOk, member: !!s.member, rules });
  };
  async function enterRef() {
    const r = entry;
    const m0 = refModel();
    if (!r || !m0 || m0.block) { render(); return; }
    const side = r.side === 'SHORT' ? 'short' : 'long';
    let q;
    try {
      q = await manual.quote({ symbol: r.symbol, side, tab: 'coin' });
    } catch {
      q = null;
    }
    if (!q || q.ok !== true) {
      say(cmdErrText(q && q.reason));
      render();
      return;
    }
    // 비중 = 그 판 1차 비중(카드와 같은 값) — 최소 수량에 맞춰 올렸을 때(bumped)만 실제 비중
    const firstPct = rules && rules.entry ? rules.entry.firstPct : null;
    const pct = q.bumped === true && Number.isFinite(q.pctReal) ? Math.round(q.pctReal * 10) / 10 : firstPct;
    sheet = openSheet(slots.sheet, {
      doc,
      title: ER_TEXT.confirm(r.symbol, r.side, q.lev, pct),
      actions: [
        [ER_TEXT.yes, async () => {
          shut();
          const m = entry === r ? refModel() : null; // 확인하는 사이 바뀐 것(오토 모드 켜짐·30분·다른 카드) — 그때 한 번 더
          if (!m || m.block) {
            if (m && m.block) say(m.block);
            render();
            return;
          }
          const res = await act(r.symbol, () => manual.openFirst({ symbol: r.symbol, side, q }));
          if (res) sayResult(res, SO_TEXT.firstDone);
          if (res && res.ok === true && entry === r) entry = null;
          render();
        }, 'ter-yes'],
        [ER_TEXT.no, async () => { shut(); }, 'ter-no ghost'],
      ],
    });
  }
  function entryBox() {
    if (!entry) return entryMsg ? el('p', 'tso-msg', entryMsg) : null;
    const m = refModel();
    if (!m) return null;
    const box = el('div', 'tv-box tv2-box ter');
    box.append(el('div', 'ter-title', m.title));
    const left = el('div', 'ter-left');
    const row = (lbl, val, cls) => {
      const d = el('div', '');
      d.append(el('span', 'lbl', lbl), el('b', cls || '', val));
      return d;
    };
    left.append(row(ER_TEXT.pos, m.side, entry.side === 'SHORT' ? 'short' : 'long'), row(ER_TEXT.margin, m.margin), row(ER_TEXT.lev, m.lev), row(ER_TEXT.pct, m.pct));
    const right = el('div', 'ter-right');
    const tpv = el('div', 'tpv');
    tpv.append(el('span', '', m.tp), el('small', '', m.tpPct));
    right.append(el('div', 'lbl', ER_TEXT.entry), el('div', 'val', m.entry), el('div', 'lbl tp', ER_TEXT.tp), tpv);
    const grid = el('div', 'ter-grid');
    grid.append(left, right);
    box.append(grid);
    const bar = el('div', 'ter-btns');
    if (m.block) box.append(el('p', 'ter-why', m.block));
    else bar.append(btn(ER_TEXT.go, 'ter-go', () => { enterRef(); }, entry.symbol, 'ter-go'));
    bar.append(btn(ER_TEXT.close, 'ter-close', () => { entry = null; shut(); render(); }, null, 'ter-close'));
    box.append(bar);
    return box;
  }

  // 차트: 지금 종목의 회원 trades → 내 매매 마커, 지금 종목 열린 매매(가장 최근) → 평단·익절 선. 서버 상태가 없으면 지움
  function syncChart(trades, sym) {
    if (!chart) return;
    const marks = serverTradeMarks({ trades, symbol: sym });
    const mk = JSON.stringify(marks);
    if (mk !== drawnMarks) {
      drawnMarks = mk;
      try { chart.setMyMarks(marks); } catch { /* 차트 없음 */ }
    }
    const cur = trades.filter((t) => isObj(t) && t.symbol === sym && LIVE.has(t.state)).sort((x, y) => y.openedAt - x.openedAt)[0];
    let spec = null;
    if (cur) {
      const m = positionLive(cur, { tpPct: tpPctOf(cur) });
      if (m.avg !== null) spec = { avg: m.avg, tp: m.tp, tpPct: tpPctOf(cur) };
    }
    const lk = JSON.stringify([sym, spec]);
    if (lk !== drawnLines) {
      drawnLines = lk;
      try { chart.setOrderLines(spec); } catch { /* 차트 없음 */ }
    }
  }

  function draw() {
    const s = getState() || {};
    const st = isObj(s.st) ? s.st : null;
    const sym = typeof s.symbol === 'string' ? s.symbol : 'BTC';
    const ok = !!st && st.ok === true;
    const trades = ok && Array.isArray(st.trades) ? st.trades.filter(isObj) : [];
    syncChart(trades, sym);
    cells = [];
    const enrolled = ok && st.status === 'on';
    const engaged = ok && (st.status === 'on' || st.status === 'closing');
    const open = trades.filter((t) => LIVE.has(t.state)).sort((x, y) => (x.symbol === sym ? 0 : 1) - (y.symbol === sym ? 0 : 1) || y.openedAt - x.openedAt);
    const eb = entryBox();
    const head = eb ? [eb] : [];
    if (!s.manualOk && !engaged && !open.length) {
      slots.orders.replaceChildren(...head);
      return;
    }
    const wrap = el('div', 'tv-box tv2-box tso');
    wrap.append(el('span', 'tv-label', MTEXT.m01));
    if (s.manualOk && !enrolled && !open.length) {
      wrap.append(el('p', 'tso-need', SO_TEXT.needEnroll));
      wrap.append(btn(SO_TEXT.enroll, 'tso-enroll', async () => {
        const r = await act('enroll', async () => {
          const x = await onEnroll();
          return x && x.ok === true ? { ok: true } : { ok: false, reason: x && x.error };
        });
        if (r) {
          if (r.ok) say(SO_TEXT.enrollDone);
          else say(cmdErrText(r.reason));
        }
        render();
      }, 'enroll'));
    } else {
      for (const t of open) wrap.append(card(t, st, s.pos, !!s.manualOk));
      if (s.manualOk && enrolled && !open.some((t) => t.symbol === sym)) {
        const bar = el('div', 'tso-btns');
        bar.append(btn(SO_TEXT.long, 'tso-long', () => { openFirstSheet(sym, 'long'); }, sym));
        bar.append(btn(SO_TEXT.short, 'tso-short', () => { openFirstSheet(sym, 'short'); }, sym));
        wrap.append(bar);
      } else if (!open.length) wrap.append(el('p', 'tso-none', SO_TEXT.none));
    }
    if (toast && now() - toast.at <= TOAST_MS) wrap.append(el('p', 'tso-msg', toast.text));
    slots.orders.replaceChildren(...head, wrap);
  }
  function render() {
    try {
      draw();
    } catch {
      // 다음 주기
    }
    return Promise.resolve();
  }
  // 1초 갱신 — 가격 칸만(버튼·입력·시트는 그대로)
  function live() {
    for (const c of cells) {
      try {
        fillLive(c);
      } catch {
        // 다음 회차
      }
    }
  }
  // 진입 참고가 카드 놓기(app.js openEntryRef — 허브 분석 항목에서 만든 값만) · null + fail('load'|'none')이면 그 이유 한 줄
  function setEntry(ref, { fail = null } = {}) {
    entry = isObj(ref) ? ref : null;
    entryMsg = entry ? null : fail === 'load' ? ER_TEXT.loadFail : fail === 'none' ? ER_TEXT.none : null;
    shut();
    render();
    const box = entry && slots.orders.children ? slots.orders.children[0] : null;
    if (box && typeof box.scrollIntoView === 'function') {
      try { box.scrollIntoView({ block: 'nearest' }); } catch { /* 덤 */ }
    }
  }
  // 종목을 바꾸면(칩) 다른 종목의 카드는 닫는다 — 같은 종목이면 그대로(openEntryRef가 카드 종목으로 먼저 바꿈)
  function symbolChanged(sym) {
    toast = null;
    shut();
    if (entry && sym !== entry.symbol) entry = null;
    entryMsg = null;
    render();
  }
  return { render, tick: render, live, symbolChanged, setEntry }; // tick = app.js 5초 주기(옛 주문 칸과 같은 손잡이)
}
