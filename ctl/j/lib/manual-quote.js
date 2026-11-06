// 수동 주문 크기 계산(spec §5.3 — 옛 manual-exec.js quoteRaw를 그대로 옮김, 계획 2026-10-22 작업 11) — 읽기만(잔고 get_assets_info·종목 정보).
// 휴대폰 수동 실행기(manual-exec — 옛 길)와 서버 판 수동 명령(server-manual — 시트에 보일 수량·증거금, 실행기가 같은 식으로 다시 확인)이 같이 쓴다.
// 기준 = min(사용 가능, 시험 상한), 배율 = min(탭 배율, 종목 최대)(추가 진입은 기록의 lev), 수량은 step으로 내림. 주문은 내지 않는다
import { createExec } from './follow-exec.js';
import { dirOf } from './follow-math.js';
import { sizeFor, tpPrice, baseOf } from './manual-math.js';

export const QUOTE_INST_TTL_MS = 600000; // 종목 목록 캐시(manual-exec INST_TTL_MS와 같음 — 허브가 꺼져도 계산은 되게)
const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
};
const instOfSym = (symbol) => `${symbol}-USDT-PERPETUAL`;
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// call(method, params, opts) = 거래소 호출(읽기만 씀) · rules = 검사한 trade-rules · member() = 회원(manual.limits.maxBase — 시험 상한) · price(inst) = 지금 시세
// instruments() = 종목 목록(허브 /v1/ox/instruments) · newMid() = 새 매매 번호. assets·instOf를 넘기면 그것을 쓴다(manual-exec — 같은 캐시를 같이 쓰게)
export function createManualQuote({
  call, rules, member = () => null, price = () => null, instruments = async () => [], newMid = null, assets = null, instOf = null, now = () => Date.now(),
  rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
} = {}) {
  let ex = null;
  const assetsNow = typeof assets === 'function' ? assets : () => {
    if (!ex) ex = createExec({ call, now, cond: false });
    return ex.assets();
  };
  let cache = { at: -Infinity, list: [] };
  async function instList() {
    if (now() - cache.at < QUOTE_INST_TTL_MS && cache.list.length) return cache.list;
    try {
      const list = await instruments();
      if (Array.isArray(list) && list.length) cache = { at: now(), list };
    } catch {
      // 허브 꺼짐 — 지난 값
    }
    return cache.list;
  }
  const specOf = typeof instOf === 'function' ? instOf : async (inst) => (await instList()).find((x) => x && x.inst === inst) || null;
  const mid = typeof newMid === 'function' ? newMid : () => `m${hex(rand(6)).slice(0, 11)}`;

  async function quoteRaw({ symbol, side, tab = 'coin', pct = rules.entry.firstPct, mid: m0 = null, avg = null, lev: fixedLev = null } = {}) {
    const dir = dirOf(side);
    if (!dir || typeof symbol !== 'string' || !Object.hasOwn(rules.tabs, tab)) return fail('down');
    const pc = Number(pct);
    if (!(pc > 0 && pc <= 100)) return fail('bad_pct');
    const inst = instOfSym(symbol);
    const spec = await specOf(inst);
    if (!spec) return fail('not_listed');
    const a = await assetsNow();
    if (!a.ok || !a.view) return fail('down');
    const m = member();
    const testMax = m && m.manual && m.manual.limits ? num(m.manual.limits.maxBase) : null;
    const base = baseOf({ available: a.view.available, testMax });
    const px = price(inst);
    const tabLev = rules.tabs[tab].lev;
    const lev = Number.isInteger(fixedLev) && fixedLev > 0 ? fixedLev : Math.min(tabLev, Number(spec.maxLev) >= 1 ? Math.floor(Number(spec.maxLev)) : tabLev);
    const s = sizeFor({ base, available: a.view.available, pct: pc, px, lev, inst: spec, availCap: rules.availCap, bumpToMin: rules.bumpToMin });
    if (!s.ok) return fail(s.reason, { need: s.need, available: a.view.available });
    return {
      ok: true, mid: m0 || mid(), inst, symbol, side, tab, lev, px, qty: s.qty, amount: s.amount, margin: s.margin, available: a.view.available,
      pctReal: s.pctReal, bumped: s.bumped, tick: spec.tick, step: spec.step, tp: tpPrice({ avg: avg ?? px, dir, lev, tpPct: rules.entry.tpPct, tick: spec.tick }),
    };
  }
  // 카드·시트를 열 때(큐 밖) — 던지지 않는다
  async function quote(args) {
    try {
      return await quoteRaw(args);
    } catch {
      return fail('down');
    }
  }
  return { quote, quoteRaw };
}
