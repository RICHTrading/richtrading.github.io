// 수동 주문 기기 기록(spec §5.7) — ptf-<판>-vault kv.manual. 허브로 보내지 않는다(보안 규칙 17과 같은 원칙).
// 쓰기는 오래가는 저장소에서만(requireDurable — 보안 규칙 14), 한 readwrite 거래 안에서(vault.update).
// 읽기 오류·모양 불일치면 쓰지 않고 던진다 — 빈 기록 위에 이번 변경만 얹어 열린 포지션 기록을 지우지 않게(검토 14).
// 읽기는 둘: get()(화면용 — 오류면 빈 기록) · read()(판단용 — 자동 손절 keeper 어댑터, 오류·모양 불일치면 던짐, p40 T10).
// vault.update는 fn이 undefined를 돌려주면 그 키를 지운다 — 그래서 update(fn)는 fn의 돌려준 값을 쓰지 않고 늘 기록 객체를 돌려준다.
// fn은 동기 함수다(IndexedDB 거래가 닫히지 않게) — thenable을 돌려주면 던지고 쓰지 않는다.
// 손절 가격은 저장하지 않는다(화면에 낼 재료를 만들지 않음, 대표 결정 1 · 보안 규칙 18) — 기록 전체에서 가격 칸(NO_KEYS)을 지운다.
// 자동 손절 스위치(kv.autoSl)·주문 목록(kv.autoSlOrders)은 이 파일이 쓰지 않는다 — auto-sl-switch.js·auto-sl-orders.js가 같은 vault로.
//
// kv.manual = { v: 2, open: { <inst>: OpenRec }, ended: [EndedRec], log: [{ at, icon, symbol, key, arg? }], consent?: [] }
//   OpenRec = { mid, inst, symbol, side, tab, lev, openedAt, tpPct, state: 'open'|'detached',
//               fills: [{ coid, kind: 'e1'|'a<k>', pct, state: 'sending'|'filled'|'partial'|'failed'|'adopted'|'unknown', qty, price, at, recheckUntil? }],
//               tp: { k, state: 'none'|'ok'|'unknown' }, autoSl: <keeper 꼴(p34 §2.6) — 발동가 없음>|null, closing: ms|null,
//               notes: [{ at, reason, arg }](keeper 메모 — 이유만, 최근 50), avg: number|null(마지막으로 읽은 포지션 평균가) }
//   EndedRec = { mid, inst, symbol, side, lev, openedAt, closedAt, end: 'tp'|'sl'|'close'|'gone', resultPct|null, fills: <수>, autoSl|null, tpLeft?: true }
//     autoSl은 자동 손절 정리가 남았을 때만(slCleanupPending) — 공용 keeper가 나중에 마저 취소한다(T10). 정리 미완인 끝난 매매는
//     50건 정리에서 세지도 지우지도 않는다(follow-store prune과 같음 — 지워지면 남은 STOP을 아무도 모르고 그 종목 진입 막기도 풀린다).
//     tpLeft(p40 검토 2): 끝난 뒤 그 매매 익절 조건 주문(ptf.<mid>.t*) 취소를 확인하지 못함 — 정리 주기가 다시 취소하고 끝이 확인되면 지운다(같이 남김)
import { requireDurable } from './vault.js';
import { slCleanupPending } from './follow-autosl.js';

export const MANUAL_KEEP = Object.freeze({ ended: 50, log: 30, consent: 50, notes: 50 });
const NO_KEYS = Object.freeze(['sl', 'slPrice', 'slPct', 'stopPrice', 'trigger', 'triggerPrice']);
// 체결로 센 줄(진입 차수·수량) — 보내는 중·실패·결과 모름은 세지 않는다
export const FILLED = Object.freeze(['filled', 'partial', 'adopted']);
const ENTRY_KIND = /^(?:e1|a[1-9]\d?)$/;

export const blankManual = () => ({ v: 2, open: {}, ended: [], log: [] });
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
export const isManualRec = (v) => isObj(v) && v.v === 2
  && isObj(v.open) && Object.values(v.open).every(isObj)
  && Array.isArray(v.ended) && v.ended.every(isObj)
  && Array.isArray(v.log) && v.log.every(isObj)
  && (v.consent === undefined || Array.isArray(v.consent));

// 가격 칸을 어느 깊이에서든 지운다(평범한 객체·배열만 따라 내려감)
function scrub(x, seen = new WeakSet()) {
  if (!x || typeof x !== 'object' || seen.has(x)) return x;
  seen.add(x);
  if (Array.isArray(x)) {
    for (const y of x) scrub(y, seen);
    return x;
  }
  if (Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null) return x;
  for (const k of NO_KEYS) delete x[k];
  for (const y of Object.values(x)) scrub(y, seen);
  return x;
}
// keeper 메모 — { at, reason, arg }만, 최근 50개
const cleanNotes = (notes) => notes.filter(isObj).map((n) => ({ at: n.at ?? null, reason: n.reason ?? null, arg: n.arg ?? null })).slice(-MANUAL_KEEP.notes);
// 끝난 매매 — 정리 미완(자동 손절 끝 확인 전·익절 주문 남음 tpLeft)은 남기고, 나머지에서 최근 50건(순서 유지)
function trimEnded(list) {
  const keep = new Set();
  const settled = [];
  list.forEach((e, i) => {
    if (slCleanupPending(endedTrade(e)) || e.tpLeft === true) keep.add(i);
    else settled.push(i);
  });
  for (const i of settled.slice(-MANUAL_KEEP.ended)) keep.add(i);
  return list.filter((_, i) => keep.has(i));
}

// 체결로 센 1차·추가 진입 줄(순서 그대로 — 카드 비중 줄 '1차 13% · 2차 15%'도 이것으로)
export const entryFills = (o) => (o && Array.isArray(o.fills) ? o.fills : []).filter((f) => isObj(f) && ENTRY_KIND.test(String(f.kind)) && FILLED.includes(f.state));
// 진입 차수 = 체결로 센 1차·추가 진입 줄 수(자동 손절 4차 판정 — auto-sl.js autoSlDue)
export const stageOf = (o) => entryFills(o).length;
export function filledQty(o) {
  const sum = entryFills(o).reduce((a, f) => a + (Number(f.qty) > 0 ? Number(f.qty) : 0), 0);
  return Number(sum.toPrecision(12));
}
// mid가 있는 곳 — { inst }(열린 기록) | { ended: idx }(끝난 기록, 가장 최근) | null
export function findMid(rec, mid) {
  if (!rec || !mid) return null;
  for (const [inst, o] of Object.entries(isObj(rec.open) ? rec.open : {})) if (o && o.mid === mid) return { inst };
  const ended = Array.isArray(rec.ended) ? rec.ended : [];
  for (let i = ended.length - 1; i >= 0; i -= 1) if (ended[i] && ended[i].mid === mid) return { ended: i };
  return null;
}
// 공용 자동 손절 keeper(follow-autosl.js)가 보는 매매 꼴 — 열린 기록
export const toTrade = (o) => ({
  id: o.mid,
  inst: o.inst,
  symbol: o.symbol,
  side: o.side,
  lev: o.lev,
  state: o.state,
  openedAt: o.openedAt,
  fills: (Array.isArray(o.fills) ? o.fills : []).map((f) => ({ customId: f.coid, kind: f.kind, state: f.state, qty: f.qty, price: f.price, at: f.at })),
  size: filledQty(o),
  avg: o.avg ?? null,
  sigStage: stageOf(o),
  autoSl: o.autoSl || null,
  notes: o.notes || [],
  rehearsal: false,
  reason: null,
});
// 끝난 기록 — 남은 자동 손절 정리만 keeper가 본다
export const endedTrade = (e) => ({
  id: e.mid, inst: e.inst, symbol: e.symbol, side: e.side, lev: e.lev, state: 'closed', autoSl: e.autoSl || null, fills: [], size: 0, notes: [],
});

export function createManualStore(vault) {
  async function get() {
    try {
      const v = await vault.get('manual');
      return isManualRec(v) ? v : blankManual();
    } catch {
      return blankManual(); // 화면용 — 쓰기 경로는 update가 다시 읽는다
    }
  }
  // 판단용 읽기(자동 손절 keeper 어댑터 — p40 T10): 읽기 오류·모양 불일치면 던진다. 빈 기록으로 보면 목록 정리(sweep)가
  // 살아 있는 매매의 STOP을 '주인 없음'으로 취소하므로 — 던지면 그 회차는 아무것도 하지 않고 다음 주기
  async function read() {
    const v = await vault.get('manual');
    if (v === undefined || v === null) return blankManual();
    if (!isManualRec(v)) throw new Error('manual_shape');
    return v;
  }
  // fn(rec)는 동기 함수(IndexedDB 거래 안에서 불림) — 받은 rec를 고친다. 돌려준 값은 쓰지 않는다
  async function update(fn) {
    requireDurable(vault);
    return vault.update('manual', (cur) => {
      if (cur !== undefined && cur !== null && !isManualRec(cur)) throw new Error('manual_shape');
      const rec = cur === undefined || cur === null ? blankManual() : cur;
      const r = fn(rec);
      if (r && typeof r.then === 'function') throw new Error('manual_async');
      if (!isManualRec(rec)) throw new Error('manual_shape');
      for (const o of Object.values(rec.open)) if (Array.isArray(o.notes)) o.notes = cleanNotes(o.notes);
      rec.ended = trimEnded(rec.ended);
      rec.log = rec.log.slice(-MANUAL_KEEP.log);
      if (Array.isArray(rec.consent)) rec.consent = rec.consent.slice(-MANUAL_KEEP.consent);
      scrub(rec);
      return rec;
    });
  }
  return { durable: () => !!vault && vault.kind === 'idb', get, read, update };
}
