// 판정 상자(spec 4판 §6·§8.1 N — 계획 Task 25 판정 부분, p40 T12) — 트레이딩 탭 '1 판정' 자리(.trade-verdict, modes/trade.js onOrderSlot의 verdict).
// 주문 칸과 따로 그린다: s·j판 인증 회원이면 주문 칸 상태(키·tradeReady)와 무관하게 보인다(spec §6 — 분석은 보인다). 공용판 = 빈칸,
// s·j판 미인증 = N-11 한 줄(같은 글을 두 번 보이지 않음, T13). 'UID 인증하기'는 탭 맨 위 ⚡ 오토 모드 카드에 하나만 — 주문 칸 자리는 빈칸
// (자동매매 탭을 합친 검토 2026-10-10).
// '판정대로 진입' 버튼·판정 방향으로 미리 채운 주문은 없다(§6, 변호사 질문 13) — 이 파일은 주문 모듈을 부르지 않는다.
// 데이터 = 셸이 가진 공개 최신 분석 하나(app/lib/analysis-feed.js — 사무실 탭과 같은 받기, 트레이딩 탭이 보이면 주기). 상세는 '근거 보기 ▾'를
// 누를 때만 GET /v1/analysis/item/<id>(fetchItem) → 시트(sheetSlot — 주문 칸 밖 자리). 문장은 우리 앱 원문 그대로, '대표'가 든 문장·직원 말은
// 화면이 뺀다(trade-view detailRows). DOM은 createElement·textContent만(CSP).
import { MTEXT, verdictModel, detailRows, analysisName, LEVELS_MAX_MIN } from '../lib/trade-view.js';
import { fmtHM } from '../lib/auto-view.js';
import { openSheet, closeSheet } from './trade-sheet.js';

// update({ ed, member, pending, latest, symbol, now }): pending = 저장된 인증을 불러오는 중(그동안 미인증 글을 잠깐 보이지 않음)
export function renderVerdict(slot, { doc = globalThis.document, sheetSlot = null, fetchItem = async () => null, config = {}, now: clock = () => Date.now() } = {}) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  let last = null; // 마지막 update 인자(근거를 받은 뒤 다시 그리기·시트 판단)
  let shownSymbol = null; // 지금 그린 종목 — 바뀌면 이 상자가 연 시트를 닫는다
  let loading = null; // 근거를 받는 중인 분석 id
  let failFor = null; // 근거를 못 받은 분석 id — 그 머리가 그대로인 동안 근거 실패 줄(n09fail)
  let sheet = null; // 이 상자가 연 시트(다른 화면이 연 시트는 건드리지 않음)

  function dropSheet() {
    if (sheet && sheetSlot) closeSheet(sheetSlot, sheet);
    sheet = null;
  }
  function box() {
    const b = el('div', 'tv-box tv-verdict');
    b.append(el('span', 'tv-num', '1'), el('span', 'tv-label', MTEXT.verdictLabel));
    return b;
  }

  function update(args = {}) {
    last = args;
    const { ed, member = null, pending = false, latest = null, symbol = null, now = clock() } = args;
    if (ed === 'pub' || (!member && pending)) {
      dropSheet();
      shownSymbol = null;
      slot.replaceChildren();
      return;
    }
    if (!member) {
      dropSheet(); // 인증이 풀리면 근거 시트도
      shownSymbol = null;
      const b = box();
      b.append(el('p', 'tv-line', config && config.tradeReady === true ? MTEXT.n11on : MTEXT.n11off));
      slot.replaceChildren(b);
      return;
    }
    if (shownSymbol !== null && symbol !== shownSymbol) dropSheet(); // 옛 종목 근거를 새 종목 아래 두지 않음
    shownSymbol = symbol;
    const v = verdictModel({ latest, symbol, now });
    if (failFor && failFor !== v.headId) failFor = null;
    const b = box();
    b.append(el('p', 'tv-line', v.line));
    if (v.headId) {
      const more = el('button', 'tv-more', MTEXT.n03);
      more.type = 'button';
      more.disabled = loading !== null;
      more.setAttribute('aria-haspopup', 'dialog');
      const id = v.headId;
      more.addEventListener('click', () => openDetail(id, symbol));
      b.append(more);
    }
    if (failFor) b.append(el('p', 'tv-warn', MTEXT.n09fail)); // 판정 줄은 그대로 — 근거(상세)만 못 받음(N-05 '판정 없음'이 아님, 검토 9)
    for (const n of v.notes) b.append(el('p', 'tv-note', n));
    b.append(el('p', 'trade-note', MTEXT.n07), el('p', 'trade-note', MTEXT.n10));
    slot.replaceChildren(b);
  }
  const redraw = () => { if (last) update(last); };

  async function openDetail(id, symbol) {
    if (loading) return;
    loading = id;
    failFor = null;
    redraw();
    let a = null;
    try {
      a = await fetchItem(id);
    } catch {
      a = null;
    }
    loading = null;
    // 받는 동안 인증이 풀렸거나 종목이 바뀌었으면 열지 않는다
    if (!last || !last.member || last.ed === 'pub' || last.symbol !== symbol) { redraw(); return; }
    if (!a || typeof a !== 'object' || a.id !== id) {
      failFor = id;
      redraw();
      return;
    }
    redraw();
    if (!sheetSlot) return;
    const lv = last.latest && Number.isInteger(last.latest.levelsMaxMin) ? last.latest.levelsMaxMin : LEVELS_MAX_MIN;
    const rows = detailRows({ analysis: a, now: clock(), levelsMaxMin: lv });
    sheet = openSheet(sheetSlot, {
      doc,
      title: MTEXT.n09(analysisName(a), fmtHM(a.at)),
      rows,
      actions: [[MTEXT.close, () => dropSheet(), 'ghost']],
      note: MTEXT.n10,
    });
  }

  return { update };
}
