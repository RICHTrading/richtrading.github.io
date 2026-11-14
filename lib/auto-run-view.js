// D37 자동매매 창·서버 상태 칸 순수 모델(설계 2026-10-16 §15.20, 계획 2026-10-22 작업 7) — 서버 판(serverBuildReady) 화면만 쓴다.
// - 고르기(pick) → 켜기 명령 run { max, until }: 횟수 칩(1·3·5·10·제한 없음·직접 1~100)·종료 시각(없음·2시간 뒤·6시간 뒤·시각 지정 — 지난 시각이면 다음 날,
//   10분 단위). 범위는 follow-settings validateAutoRun(실행기와 같은 검사 — 지금 뒤·24시간 10분 안)
// - 회원 상태(server-exec checkServerState 결과) → 창 단계 none·setup·running·stopped, 상태 줄·진행 줄(N / M회 · HH:MM까지)·총 수익
//   (대표 답 Q30 2026-10-22 — 이번 시작 뒤 신호 매매만, 끝난 매매의 pnlUsdt 합·거래 비용 제외. '전체'로 바뀌면 runPnl 거르기 한 줄)
// - 멈춤(stopped)은 동업자 창처럼 멈춘 지 1시간 안만(그 뒤 설정 창). 보고에 멈춘 시각이 없어 화면이 본 시각(stoppedAt — 켜짐→꺼짐을 본 때)을 넘기고,
//   모르면 종료 시각으로 멈춘 경우만 until을 그 시각으로 본다(관리자 판단 — 앱을 다시 열면 직접 멈춤·횟수 끝은 설정 창부터)
// - 서버 상태 칸(트레이딩 탭 매매 카드): 방향·배율·차수 n/4·손절 감시 중·서버 연결 확인 중 — 가격 없음. 추가 진입 버튼은 수동 매매에만·다음 차수 하나(D31·Q26)
import { AUTO_TEXT } from './follow-text.js';
import { validateAutoRun, LEGACY_RUN_SYMBOLS } from './follow-settings.js';
import { fmtHM, fmtUsdt } from './auto-view.js';

// symbols = 고른 종목(자동매매 여러 종목 — 대표 결정 2026-10-23, 동업자 오토 창처럼 처음은 BTC 하나)
export const PICK_DEFAULT = Object.freeze({ count: 3, custom: '', until: 'none', h: 18, m: 0, autoSl: true, symbols: Object.freeze(['BTC']) });
const HOUR = 3600000;
const DAY = 86400000;
const STOPPED_SHOW_MS = HOUR; // 멈춘 지 1시간 안은 진행 창(동업자 창 _showLast와 같은 뜻)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const LIVE = new Set(['open', 'opening', 'closing']);
const SIDE = Object.freeze({ long: '롱', short: '숏' });
const STOP_CODES = Object.freeze(['run_done', 'run_until', 'hedge_off']);

const localTz = (ms) => -new Date(ms).getTimezoneOffset();
// 고른 종료 시각 → ms | null. 시각 지정은 그 시간대의 오늘 h:m — 지금 이하면 다음 날(같은 시각도 지난 것으로)
export function untilOf(pick, nowMs, tzOffsetMin = localTz(nowMs)) {
  const p = isObj(pick) ? pick : {};
  if (p.until === '2h') return nowMs + 2 * HOUR;
  if (p.until === '6h') return nowMs + 6 * HOUR;
  if (p.until !== 'at') return null;
  const h = Number(p.h);
  const m = Number(p.m);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59 || m % 10 !== 0) return NaN; // 꼴 밖 — runArgsOf가 until로 거절
  const tz = tzOffsetMin * 60000;
  const dayStart = Math.floor((nowMs + tz) / DAY) * DAY - tz;
  let t = dayStart + h * HOUR + m * 60000;
  if (t <= nowMs) t += DAY;
  return t;
}

// 고르기 → 켜기 명령 run { max, until, symbols } | 오류 낱말('count' | 'until' | 'symbols')
export function runArgsOf(pick, nowMs, rules, tzOffsetMin = localTz(nowMs)) {
  const p = isObj(pick) ? pick : {};
  let max;
  if (p.count === 'custom') {
    const t = String(p.custom ?? '').trim();
    max = /^\d{1,3}$/.test(t) ? Number(t) : NaN;
  } else max = p.count === null ? null : p.count;
  const until = untilOf(p, nowMs, tzOffsetMin);
  const symbols = Array.isArray(p.symbols) ? [...p.symbols] : [...LEGACY_RUN_SYMBOLS];
  const v = validateAutoRun({ max, until, symbols }, rules, nowMs);
  if (!v.ok) return { ok: false, error: v.error === 'max' ? 'count' : v.error === 'symbols' ? 'symbols' : 'until' };
  return { ok: true, run: { max, until, symbols } };
}

// 총 수익(Q30 권장안 — 이번 시작 뒤 자동매매 매매만): src 'signal'·openedAt ≥ startedAt·끝남(closedAt)·pnlUsdt 유한수의 합(소수 둘째 자리), 없으면 null
export function runPnl(trades, startedAt) {
  if (!fin(startedAt)) return null;
  const rows = (Array.isArray(trades) ? trades : []).filter((t) => isObj(t) && t.src === 'signal' && fin(t.openedAt) && t.openedAt >= startedAt && fin(t.closedAt) && fin(t.pnlUsdt));
  if (!rows.length) return null;
  return Math.round(rows.reduce((a, t) => a + t.pnlUsdt, 0) * 100) / 100;
}

// 회원 상태 → 창 모델. stoppedAt = 화면이 켜짐→꺼짐(또는 새 멈춤 알림)을 본 시각(없으면 null)
// 종목 = 보고 settings.symbols(이번 실행에 고른 종목 — 여러 종목 2026-10-23), 칸이 없으면(옛 실행기) symbol(BTC) 하나
export function runSymbolsOf(st, symbol = 'BTC') {
  const s = isObj(st) && isObj(st.settings) ? st.settings : null;
  return s && Array.isArray(s.symbols) && s.symbols.length ? [...s.symbols] : [symbol];
}
export function autoRunModel(st, { now = Date.now(), symbol = 'BTC', stoppedAt = null, relayPhase = null } = {}) {
  const none = { phase: 'none', kicker: AUTO_TEXT.kicker, status: '', progress: '', pnl: null, pnlLine: null, stopWhy: null, open: [] };
  if (!isObj(st) || st.ok !== true || !(st.status === 'on' || st.status === 'closing')) return none;
  const s = isObj(st.settings) && Object.hasOwn(st.settings, 'done') ? st.settings : null; // D37 꼴만(옛 8칸 꼴은 run 없음)
  const run = s && fin(s.startedAt) ? s : null;
  const trades = Array.isArray(st.trades) ? st.trades : [];
  const syms = runSymbolsOf(st, symbol);
  const open = trades.filter((t) => isObj(t) && t.src === 'signal' && LIVE.has(t.state) && syms.includes(t.symbol));
  const openSyms = syms.filter((x) => open.some((t) => t.symbol === x));
  const progress = run ? AUTO_TEXT.progress(run.done, run.max, fin(run.until) ? fmtHM(run.until) : null) : '';
  const pnl = run ? runPnl(trades, run.startedAt) : null;
  const pnlLine = pnl === null ? null : `${AUTO_TEXT.pnl} ${fmtUsdt(pnl)} · ${AUTO_TEXT.pnlNote}`;
  const base = { kicker: AUTO_TEXT.runKicker(syms), progress, pnl, pnlLine, open, symbols: syms };
  if (st.auto === true) {
    // 열린 매매가 없을 때만 중계 단계 글(설계 2026-10-22 §11) — 모르는 단계·옛 허브(null)면 옛 글
    const idle = typeof relayPhase === 'string' && Object.hasOwn(AUTO_TEXT.relay, relayPhase) ? AUTO_TEXT.relay[relayPhase] : AUTO_TEXT.running;
    return { ...base, phase: 'running', status: open.length ? AUTO_TEXT.trading(openSyms) : idle, stopWhy: null };
  }
  if (!run) return { ...none, phase: 'setup' };
  const notes = Array.isArray(st.notes) ? st.notes.filter((x) => isObj(x) && STOP_CODES.includes(x.code)) : [];
  const last = notes.length ? notes.reduce((a, b) => (b.n > a.n ? b : a)) : null;
  const why = last ? last.code : 'member_off';
  let ref = fin(stoppedAt) ? stoppedAt : null;
  if (ref === null && why === 'run_until' && fin(run.until)) ref = run.until;
  if (ref === null || now - ref > STOPPED_SHOW_MS || now < ref - 60000) return { ...none, phase: 'setup' };
  return { ...base, phase: 'stopped', status: AUTO_TEXT.stopped(AUTO_TEXT.stopWhy[why]), stopWhy: why };
}

// 서버 상태 칸 한 줄(트레이딩 탭 매매 카드 — 화면 ⑤): 방향·배율·차수·손절 감시·서버 연결. 가격 없음
export function tradeStatusLine(t, { execUp = true } = {}) {
  if (!isObj(t)) return '';
  const stage = Number.isInteger(t.stage) && t.stage >= 1 ? t.stage : 1;
  let line = `${SIDE[t.side] || ''} ${Number.isInteger(t.lev) ? t.lev : '-'}× · ${stage}/4차`;
  if (t.slWatch) line += ' · 손절 감시 중';
  if (execUp === false) line += ' · 서버 연결 확인 중';
  return line;
}

// 추가 진입 버튼(D31·Q26) — 수동 매매·열림·다음 차수 2~4일 때만
export function addButtonOf(t) {
  if (!isObj(t) || t.src !== 'manual' || t.state !== 'open') return null;
  const n = t.nextStage;
  if (!Number.isInteger(n) || n < 2 || n > 4) return null;
  return { stage: n, text: `${n}차 진입` };
}
