// 수동 주문 계산(spec §5.3·§5.4) — 순수 함수. 반올림·최소 단위는 3-3 follow-math를 다시 쓴다.
import { floorTo, roundTo, numStr, decimalsOf } from './follow-math.js';

export const priceAt = ({ avg, dir, lev, pct }) => avg * (1 + (dir * (pct / 100)) / lev);
export const pctAt = ({ avg, dir, lev, price }) => dir * (price / avg - 1) * lev * 100;
export const estAvg = ({ avg, size, px, qty }) => (avg * size + px * qty) / (size + qty);
export const tpPrice = ({ avg, dir, lev, tpPct, tick }) => roundTo(priceAt({ avg, dir, lev, pct: tpPct }), tick);
export const tpDirOk = ({ dir, price, px }) => Number.isFinite(px) && px > 0 && Number.isFinite(price) && price > 0 && (dir > 0 ? price > px : price < px); // 시세가 없으면 거짓
export const changedTooMuch = (a, b, tol = 0.02) => !(a > 0) || Math.abs(b - a) / a > tol;
export const baseOf = ({ available, testMax }) => (Number.isFinite(testMax) && testMax > 0 ? Math.min(available, testMax) : available);
export const inputDigits = (px) => decimalsOf(px >= 1000 ? 0.1 : px >= 100 ? 0.01 : px >= 1 ? 0.001 : 0.00001) + 1; // 표시 자릿수 + 1(N t:931)

export function sizeFor({ base, available, pct, px, lev, inst, availCap = 0.95, bumpToMin = true }) {
  if (!(px > 0)) return { ok: false, reason: 'no_price', need: null, available };
  if (!(available > 0) || !(base > 0)) return { ok: false, reason: 'no_funds', need: null, available };
  const cap = available * availCap;
  const want = Math.min((base * pct) / 100, cap);
  let qty = floorTo((want * lev) / px, inst.step);
  let bumped = false;
  if (qty < inst.minQty || qty * px < inst.minNotional) {
    const minMargin = (Math.max(inst.minQty * px, inst.minNotional) / lev) * 1.01;
    if (!bumpToMin || minMargin > cap) return { ok: false, reason: 'below_min', need: minMargin / availCap, available };
    qty = Math.max(inst.minQty, Math.ceil(inst.minNotional / px / inst.step - 1e-9) * inst.step);
    bumped = true;
  }
  const margin = (qty * px) / lev;
  return { ok: true, qty, amount: numStr(qty, inst.step), margin, pctReal: (margin / base) * 100, bumped };
}
