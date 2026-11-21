// 동업자 비상 컨트롤러 새 진입(enter — 계획 2026-10-30 Task 11, 대표 결정 2026-10-30 저녁 A)·수동 모드 열기(buy — Task 12)·닫기(reduce — Task 13, 대표 결정 2026-11-01) 인자 규칙.
// 허브(hub/lib/ctl-routes.js — 켤 때 저장소 규칙 파일)와
// 앱(#ctl 입력 칸 — 빌드가 찍은 config.tradeRules·followRules)이 같이 쓴다. DOM·브라우저 전역 없음.
// - 종목 = 자동 종목(follow-rules autoRun.symbols) 차례로 trade-rules 코인 관심 종목(tabs.coin.watch)에 든 것 — 실행기 허용 종목 기본값과 같다(판단 R12)
// - 배율 상한 = tabs.coin.lev, 기본 비중·익절 % = entry.firstPct·tpPct, 익절 칩 = tp.chips(회원 트레이딩 탭과 같은 값)
// - 값 경계는 실행기 manualEntryCheck(회원 수동 1차)와 같다 — 배율 정수 1~상한·비중 1~100·익절 1~1000(test/ctl-enter-rules.test.mjs가 같은 격자로 비교)
import { autoSymbols } from './follow-settings.js';

export const CTL_ENTER_ARGS_KEYS = Object.freeze(['symbol', 'dir', 'lev', 'pct', 'tpPct']); // = exec/lib/wire.js(시험이 비교)
export const CTL_ENTER_DIRS = Object.freeze(['long', 'short']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

// tradeRules = 검사한 trade-rules(validateTradeRules), followRules = 검사한 follow-rules(validateRules) → { symbols, maxLev, firstPct, tpPct, tpChips } | null
// (규칙이 없거나 꼴이 모자라거나 종목이 비면 null — 그 판은 '새 진입'을 쓰지 않음)
export function enterRulesOf(tradeRules, followRules) {
  if (!isObj(tradeRules) || !isObj(followRules)) return null;
  const coin = isObj(tradeRules.tabs) ? tradeRules.tabs.coin : null;
  const entry = tradeRules.entry;
  const tp = tradeRules.tp;
  if (!isObj(coin) || !Array.isArray(coin.watch) || !Number.isInteger(coin.lev) || coin.lev < 1 || !isObj(entry) || !isObj(tp) || !Array.isArray(tp.chips)) return null;
  const symbols = autoSymbols(followRules).filter((s) => coin.watch.includes(s));
  if (!symbols.length) return null;
  return Object.freeze({
    symbols: Object.freeze(symbols), maxLev: coin.lev, firstPct: entry.firstPct, tpPct: entry.tpPct, tpChips: Object.freeze([...tp.chips]),
  });
}

// args = { symbol, dir, lev, pct, tpPct } — 칸 정확히·종목은 규칙 안·방향 롱/숏·배율 정수 1~상한·비중 1~100·익절 1~1000
export function enterArgsOk(args, er) {
  if (!isObj(er) || !Array.isArray(er.symbols) || !isObj(args)) return false;
  const keys = Object.keys(args);
  if (keys.length !== CTL_ENTER_ARGS_KEYS.length || !CTL_ENTER_ARGS_KEYS.every((k) => Object.hasOwn(args, k))) return false;
  return typeof args.symbol === 'string' && er.symbols.includes(args.symbol) && CTL_ENTER_DIRS.includes(args.dir)
    && Number.isInteger(args.lev) && args.lev >= 1 && args.lev <= er.maxLev && inRange(args.pct, 1, 100) && inRange(args.tpPct, 1, 1000);
}

// 입력 칸 처음 값 — 첫 종목·롱·배율 상한·기본 비중·기본 익절(회원 트레이딩 탭 기본과 같음)
export const enterDefaults = (er) => ({ symbol: er.symbols[0], dir: 'long', lev: er.maxLev, pct: er.firstPct, tpPct: er.tpPct });

// ── 대표 결정 2026-11-01(설계 §9-9·10, 계획 Task 12 — 판단 R16·R17) ──
// R16 기본 새 진입(enter) = AI 진입과 같은 값만: enterArgsOk이고 배율·비중·익절이 enterDefaults와 같을 때만 참 — 종목·방향만 고른다(허브 400 bad_args·앱 기본 탭)
export function enterFixedOk(args, er) {
  if (!enterArgsOk(args, er)) return false;
  const d = enterDefaults(er);
  return args.lev === d.lev && args.pct === d.pct && args.tpPct === d.tpPct;
}

// R17 수동 모드 열기(buy) — 칸은 enter와 같은 다섯(= exec/lib/wire.js CTL_BUY_ARGS_KEYS), 익절 %는 null(익절 없음) 또는 1~1000, 비중 = 사용 가능 잔고의 1~100%.
// 배율은 새 포지션에만(같은 방향 수동 포지션이 있으면 실행기가 그 포지션 배율로 더 삼). 값 경계는 실행기 manualEntryCheck(free)와 같다(시험이 같은 격자로 비교)
export const CTL_BUY_ARGS_KEYS = Object.freeze(['symbol', 'dir', 'lev', 'pct', 'tpPct']);
export const BUY_PCT_CHIPS = Object.freeze([25, 50, 75, 100]);
export function buyArgsOk(args, er) {
  if (!isObj(er) || !Array.isArray(er.symbols) || !isObj(args)) return false;
  const keys = Object.keys(args);
  if (keys.length !== CTL_BUY_ARGS_KEYS.length || !CTL_BUY_ARGS_KEYS.every((k) => Object.hasOwn(args, k))) return false;
  return typeof args.symbol === 'string' && er.symbols.includes(args.symbol) && CTL_ENTER_DIRS.includes(args.dir)
    && Number.isInteger(args.lev) && args.lev >= 1 && args.lev <= er.maxLev && inRange(args.pct, 1, 100) && (args.tpPct === null || inRange(args.tpPct, 1, 1000));
}
// 수동 칸 처음 값 — 첫 종목·롱·배율 상한·비중 25%·익절 없음
export const buyDefaults = (er) => ({ symbol: er.symbols[0], dir: 'long', lev: er.maxLev, pct: BUY_PCT_CHIPS[0], tpPct: null });

// R18 수동 모드 닫기(reduce — 계획 Task 13): 칸 둘 { symbol, pct }(= exec/lib/wire.js CTL_REDUCE_ARGS_KEYS), 종목은 규칙 안, pct = 그 종목 포지션을 줄일 비중 % — 정수 1~100
// (100이면 실행기가 전량 정리와 같은 길로). 실행기는 그 종목 열린 매매마다 포지션 크기 × pct/100(거래소 수량 단위 아래로)
export const CTL_REDUCE_ARGS_KEYS = Object.freeze(['symbol', 'pct']);
export const REDUCE_PCT_CHIPS = Object.freeze([25, 50, 75, 100]);
const REDUCE_SYMBOL_RE = /^[A-Z0-9]{2,10}$/; // = exec/lib/wire.js 신호 종목 꼴(봉투 검사 ctlReduceArgsOk와 같음)
// 꼴만(칸 정확히 둘·종목 대문자 2~10·pct 정수 1~100) — 규칙 파일을 못 읽은 허브는 이것만 본다(검토 고침 4 — 줄이기는 새 진입 규칙에 기대지 않음, 실행기가 다시 봄)
export function reduceArgsShapeOk(args) {
  if (!isObj(args)) return false;
  const keys = Object.keys(args);
  if (keys.length !== CTL_REDUCE_ARGS_KEYS.length || !CTL_REDUCE_ARGS_KEYS.every((k) => Object.hasOwn(args, k))) return false;
  return typeof args.symbol === 'string' && REDUCE_SYMBOL_RE.test(args.symbol) && Number.isInteger(args.pct) && args.pct >= 1 && args.pct <= 100;
}
// 꼴 + 종목이 규칙 종목 안
export function reduceArgsOk(args, er) {
  if (!isObj(er) || !Array.isArray(er.symbols)) return false;
  return reduceArgsShapeOk(args) && er.symbols.includes(args.symbol);
}
// 닫기 칸 처음 값 — 첫 종목·가장 작은 칩(25%)
export const reduceDefaults = (er) => ({ symbol: er.symbols[0], pct: REDUCE_PCT_CHIPS[0] });

// 수동 추가(addm — 대표 요청 2026-11-04): 칸 둘 { symbol, pct }(= exec/lib/wire.js CTL_ADDM_ARGS_KEYS), 종목은 규칙 안, pct = 그 회원 사용 가능 잔고의 % — 정수 1~100.
// 위험을 늘리는 명령이라 줄이기와 달리 규칙이 없으면 거짓(꼴만으로 받지 않음). 실행기가 잔고 × min(95, 100 − 배율 × 0.48)%에서 자름
export const CTL_ADDM_ARGS_KEYS = Object.freeze(['symbol', 'pct']);
export const ADDM_PCT_CHIPS = Object.freeze([10, 25, 50, 100]);
export const addmArgsOk = (args, er) => reduceArgsOk(args, er);
// 처음 값 — 첫 종목·가장 작은 칩
export const addmDefaults = (er) => ({ symbol: er.symbols[0], pct: ADDM_PCT_CHIPS[0] });
