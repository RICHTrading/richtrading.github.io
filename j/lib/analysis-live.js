// 실시간 직원 말(p37 설계 §3.3·§3.4 — 대표 결정 2026-10-09 D4) — 셸 쪽 순수 모듈(import 없음).
// 허브 공개 GET /v1/analysis/request/<표>/turns?after=N 응답 검사(parseTurnsResp)와 사무실에 보낼 ptf:analysis-turns 만들기(turnsMessage).
// 받기·차례(running일 때 3초마다, 멈춤·꺼짐은 한 번만 알리고 상태 GET으로 되돌아감)는 analysis-request.js가 한다.
// 계약: test/fixtures/live-contract.json rev 1(keys.publicResp·publicTurn·toOffice·liveStates·stops·limits) — 시험이 비교한다.
// 셸은 직원 글을 고치지 않는다(허브가 리포트와 같은 거르기를 이미 함) — 모양·길이만 보고, 하나라도 틀리면 그 응답 전체를 실패로 센다

export const LIVE_IDS = Object.freeze(['taro', 'vibe', 'blitz', 'guard']); // 스캘핑 직원 넷만(R6 — ACE·PM 없음)
export const LIVE_STATES = Object.freeze(['off', 'wait', 'on', 'ended', 'aborted']);
export const LIVE_STOPS = Object.freeze(['cut', 'fail']); // aborted일 때만: cut = 런은 계속(끝에 원문 재생) · fail = 내보낼 수 없는 런(R14)
export const TURNS_RESP_KEYS = Object.freeze(['ok', 'v', 'status', 'live', 'stop', 'next', 'turns']);
export const LIVE_TURN_KEYS = Object.freeze(['n', 'id', 'name', 'role', 'turn', 'bubble', 'report']);
export const TURNS_MESSAGE_KEYS = Object.freeze(['type', 'v', 'req', 'symbol', 'live', 'stop', 'turns']);
export const TO_OFFICE_LIVE = Object.freeze(['on', 'aborted']); // 사무실에는 새 말(on — 허브 on·ended)과 멈춤(aborted — 허브 aborted·말을 보낸 뒤 off)만
export const REQ_LIVE_POLL_MS = 3000; // 실행 중 3초마다(분당 20 — 허브 IP 분당 120 안, 이 동안 상태 GET은 쉰다)
export const LIVE_LIMITS = Object.freeze({ turnsMax: 8, afterMax: 8, name: 24, role: 24, bubble: 600, report: 8000, turnMin: 1, turnMax: 99 });

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const strIn = (v, lo, hi) => typeof v === 'string' && v.length >= lo && v.length <= hi;
// 말이 없어야 하는 상태(허브 §3.3 표 — off·wait·aborted는 turns [])
const NO_TURNS = new Set(['off', 'wait', 'aborted']);

// 직원 말 하나 → 계약 키 순서의 새 객체 | null
function cleanTurn(t) {
  const L = LIVE_LIMITS;
  if (!exactKeys(t, LIVE_TURN_KEYS) || !intIn(t.n, 1, L.turnsMax) || !LIVE_IDS.includes(t.id)) return null;
  if (!strIn(t.name, 1, L.name) || !strIn(t.role, 1, L.role)) return null;
  if (!(t.turn === null || intIn(t.turn, L.turnMin, L.turnMax))) return null;
  if (!strIn(t.bubble, 1, L.bubble) || !strIn(t.report, 0, L.report)) return null;
  return { n: t.n, id: t.id, name: t.name, role: t.role, turn: t.turn, bubble: t.bubble, report: t.report };
}

// 허브 공개 turns 응답 → { status, live, stop, next, turns } | null(응답 전체 실패 — 상태 GET 실패와 같은 셈).
// parseStatus: status 칸 검사(analysis-request.js parseStatusExact — 상태 경로와 같은 REQUEST_KEYS 정확히 + parseRequestResp), 실패면 null
export function parseTurnsResp(b, parseStatus) {
  if (!exactKeys(b, TURNS_RESP_KEYS) || b.ok !== true || b.v !== 1 || !LIVE_STATES.includes(b.live)) return null;
  if (b.live === 'aborted' ? !LIVE_STOPS.includes(b.stop) : b.stop !== null) return null;
  if (!intIn(b.next, 0, LIVE_LIMITS.afterMax) || !Array.isArray(b.turns) || b.turns.length > LIVE_LIMITS.turnsMax) return null;
  if (NO_TURNS.has(b.live) && b.turns.length) return null;
  const turns = [];
  for (const raw of b.turns) {
    const t = cleanTurn(raw);
    if (!t || (turns.length && t.n <= turns[turns.length - 1].n)) return null; // n 오름차순·겹침 없음
    turns.push(t);
  }
  const status = typeof parseStatus === 'function' ? parseStatus(b.status) : null;
  if (!status) return null;
  return { status, live: b.live, stop: b.stop, next: b.next, turns };
}

// 사무실로 보낼 ptf:analysis-turns — req·symbol은 그 요청의 사무실 값(ptf:analysis-result와 같은 규칙). aborted면 turns [], on이면 stop null
export function turnsMessage(sub, live, stop, turns) {
  const aborted = live === 'aborted';
  return {
    type: 'ptf:analysis-turns', v: 1, req: sub.req, symbol: sub.symbol, live, stop: aborted ? stop : null,
    turns: aborted ? [] : turns.map((t) => ({ n: t.n, id: t.id, name: t.name, role: t.role, turn: t.turn, bubble: t.bubble, report: t.report })),
  };
}
