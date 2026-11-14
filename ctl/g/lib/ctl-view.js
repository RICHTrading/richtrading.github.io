// 동업자 비상 컨트롤러(#ctl) 보기 계산 — DOM 없음(screens/ctl.js가 그린다, 시험은 이것을 바로 부름).
// 손익% = 방향 × (표시가 − 평단)/평단 × 배율 × 100(소수 1자리) — 허브 mark는 BTC 5분봉 끝 값뿐이라 BTC 매매만 셈하고 나머지·mark 없음은 '—'.
// 손절가(자동 손절 발동가)·남은 거리는 받지도 그리지도 않는다(보안 규칙 18). 거래소 청산가는 고른 포지션의 차트 선에만(ctlOverlay — 대표 결정
// 2026-10-30 저녁 B, 규칙 18 예외·규칙 27, 숫자는 글로 쓰지 않고 canvas 선 축 표시뿐). 회원 손익은 %만(금액 없음)
import { CTL_TEXT } from './ctl-text.js';
import { fmtPct } from './auto-view.js';
import { positionOverlay, OVERLAY_TEXT } from './chart-position-overlay.js';

export const MARK_SYMBOL = 'BTC';
export const CTL_TF = '5m'; // 컨트롤러 차트 봉(허브 공개 봉 5분)
export const DEEP_PCT = -60; // 필터 '−60% 아래'
export const LOW_BAL = 50; // 필터 '잔고 50 미만'(동업자판 nofund와 같은 50 USDT)
export const FILTER_KEYS = Object.freeze(['auto', 'pos', 'deep', 'low']);
export const SORT_KEYS = Object.freeze(['bal', 'pnl']);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

// 가격 — 큰 값은 소수 1자리까지(67,210.5 · 62,000), 작은 코인은 자릿수를 늘림. 0 이하·값 없음은 '—'
export function fmtPx(v) {
  if (!num(v) || v <= 0) return CTL_TEXT.dash;
  const d = v >= 1000 ? 1 : v >= 100 ? 2 : v >= 1 ? 4 : 6;
  return v.toLocaleString('en-US', { maximumFractionDigits: d });
}
// USDT 금액 — 소수 2자리(1,500.46)
export function fmtUsd(v) {
  return num(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : CTL_TEXT.dash;
}
export const markText = (mark) => `BTCUSDT 무기한 · 표시가 ${num(mark) && mark > 0 ? fmtPx(mark) : CTL_TEXT.dash}`;

export function pnlPct(t, mark) {
  if (!t || t.symbol !== MARK_SYMBOL || !num(mark) || mark <= 0 || !num(t.avg) || t.avg <= 0 || !num(t.lev) || t.lev <= 0) return null;
  const dir = t.side === 'long' ? 1 : t.side === 'short' ? -1 : 0;
  if (!dir) return null;
  const v = round1((dir * (mark - t.avg) / t.avg) * t.lev * 100);
  return Object.is(v, -0) ? 0 : v;
}
const pnlText = (p) => (p == null ? CTL_TEXT.dash : fmtPct(p));

// 회원 줄 포지션 한 줄 — '롱 3차 · 평단 67,210 · −64.0%'(BTC 밖은 앞에 종목)
export function posLine(t, mark) {
  const sym = t.symbol === MARK_SYMBOL ? '' : `${t.symbol} `;
  return `${sym}${CTL_TEXT.side[t.side] || t.side} ${t.stage}차 · 평단 ${fmtPx(t.avg)} · ${pnlText(pnlPct(t, mark))}`;
}

// 포지션 탭 칸 — [UID, '종목 방향', '배율×', '차수', '평단', '손익%', '출처']
export function posCells(m, t, mark) {
  return [m.uid || CTL_TEXT.uidWait, `${t.symbol} ${CTL_TEXT.side[t.side] || t.side}`, `${t.lev}×`, `${t.stage}차`, `평단 ${fmtPx(t.avg)}`, pnlText(pnlPct(t, mark)),
    t.src ? CTL_TEXT.src[t.src] || t.src : CTL_TEXT.dash];
}

// 오토 칸 — 키 끊김(목록 status 'error' — 키 로그인 실패 중이거나 실행기가 키를 지움, 2026-11-14 — 끝나지 않은 매매가 있으면 포지션 남음)이 맨 앞,
// 실행기에 키가 없으면(enrolled false) '키 미등록', 아니면 켜짐·꺼짐·모름
export function autoWord(m) {
  if (m.status === 'error') return { text: Array.isArray(m.trades) && m.trades.length ? CTL_TEXT.autoWord.deadOpen : CTL_TEXT.autoWord.dead, tone: 'bad' };
  if (!m.enrolled) return { text: CTL_TEXT.autoWord.none, tone: 'dim' };
  if (m.auto === true) return { text: CTL_TEXT.autoWord.on, tone: 'good' };
  if (m.auto === false) return { text: CTL_TEXT.autoWord.off, tone: 'warn' };
  return { text: CTL_TEXT.autoWord.unknown, tone: 'dim' };
}
export const balText = (m) => (m.bal ? fmtUsd(m.bal.equity) : CTL_TEXT.dash);
// 포지션 탭 줄 — 그 회원 총 시드·들어간 금액·남은 금액(2026-11-02 동업자): 잔고(총자산)·사용(총자산 − 가용, 0 아래면 0)·가용
export function balLine(m) {
  if (!m.bal) return CTL_TEXT.balLine(CTL_TEXT.dash);
  const { equity, avail } = m.bal;
  return CTL_TEXT.balLine(fmtUsd(equity), fmtUsd(num(equity) && num(avail) ? Math.max(0, round2(equity - avail)) : null), fmtUsd(avail));
}
export const lowBal = (m) => (m.bal ? m.bal.equity < LOW_BAL : m.funded === false);

export function agoText(at, nowMs) {
  if (!num(at)) return CTL_TEXT.dash;
  const d = Math.max(0, nowMs - at);
  if (d < 60000) return CTL_TEXT.ago.now;
  if (d < 3600000) return CTL_TEXT.ago.min(Math.floor(d / 60000));
  if (d < 86400000) return CTL_TEXT.ago.hour(Math.floor(d / 3600000));
  const k = new Date(at + 9 * 3600000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
}

// 필터(모두 맞아야) — 잔고를 못 읽은 회원(bal null)은 '잔고 50 미만'에만 50 미만 표식(funded false)으로 걸리고 다른 필터·정렬에서는 빠지지 않는다
export function passes(m, filters, mark) {
  for (const f of filters) {
    if (f === 'auto' && m.auto !== true) return false;
    if (f === 'pos' && !m.trades.length) return false;
    if (f === 'deep' && !m.trades.some((t) => { const p = pnlPct(t, mark); return p != null && p <= DEEP_PCT; })) return false;
    if (f === 'low' && !lowBal(m)) return false;
  }
  return true;
}

const worstPnl = (m, mark) => {
  const ps = m.trades.map((t) => pnlPct(t, mark)).filter((p) => p != null);
  return ps.length ? Math.min(...ps) : null;
};
// 정렬 — 'bal' 잔고 적은 순, 'pnl' 손실 큰 순. 값 없는 회원은 끝(제자리 차례), null이면 허브 명단 차례 그대로
export function sortRows(list, key, mark) {
  if (!SORT_KEYS.includes(key)) return list.slice();
  const val = key === 'bal' ? (m) => (m.bal ? m.bal.equity : null) : (m) => worstPnl(m, mark);
  return list.map((m, i) => ({ m, i, v: val(m) })).sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    return a.v - b.v || a.i - b.i;
  }).map((x) => x.m);
}

// 요약 카드 — 인원·롱(롱 매매가 있는 회원)·숏·없음(매매 없는 회원)·평균 차수(매매)·평균 손익(손익을 셀 수 있는 매매)·잔고 합(잔고를 읽은 회원)
export function summaryOf(list, mark) {
  const trades = list.flatMap((m) => m.trades);
  const pnls = trades.map((t) => pnlPct(t, mark)).filter((p) => p != null);
  const bals = list.filter((m) => m.bal).map((m) => m.bal.equity);
  return {
    n: list.length,
    long: list.filter((m) => m.trades.some((t) => t.side === 'long')).length,
    short: list.filter((m) => m.trades.some((t) => t.side === 'short')).length,
    none: list.filter((m) => !m.trades.length).length,
    avgStage: trades.length ? round1(trades.reduce((s, t) => s + t.stage, 0) / trades.length) : null,
    avgPnl: pnls.length ? round1(pnls.reduce((s, p) => s + p, 0) / pnls.length) : null,
    balSum: bals.length ? round2(bals.reduce((s, b) => s + b, 0)) : null,
  };
}
export function summaryLines(s) {
  const T = CTL_TEXT.sum;
  return [`${T.n} ${s.n}`, `${T.long} ${s.long}`, `${T.short} ${s.short}`, `${T.none} ${s.none}`,
    `${T.stage} ${s.avgStage == null ? CTL_TEXT.dash : s.avgStage.toFixed(1)}`, `${T.pnl} ${pnlText(s.avgPnl)}`,
    `${T.bal} ${s.balSum == null ? CTL_TEXT.dash : `${fmtUsd(s.balSum)} USDT`}`];
}

// 고른 포지션(계획 2026-10-30 Task 10) — pick = { h, id } | null. 그 회원·그 매매가 지금 목록에 있을 때만 { m, t }(정리·익절로 사라지면 null)
export function pickOf(members, pick) {
  if (!pick || !Array.isArray(members)) return null;
  const m = members.find((x) => x.h === pick.h);
  const t = m ? m.trades.find((x) => x.id === pick.id) : null;
  return t ? { m, t } : null;
}

// 고른 매매 하나 → 차트 선(평단·익절·청산가 — 값이 있는 것만)·체결 화살표('N차' — 롱 ▲ 봉 아래·숏 ▼ 봉 위, 5분 칸). 회원 앱 트레이딩 탭과 같은 함수,
// 선 제목만 CTL_TEXT.lines(체결 { at, stage, px } → 차수 번호를 체결 번호로 — 같은 차수 일부 체결은 화살표 하나)
export function ctlOverlay(t) {
  return positionOverlay({
    positions: [{ ...t, fills: t.fills.map((f) => ({ at: f.at, fill: f.stage })) }],
    events: [], symbol: t.symbol, tf: CTL_TF, text: { ...OVERLAY_TEXT, ...CTL_TEXT.lines },
  });
}

// 새 진입 확인 시트의 '건너뛸 회원 n명'(계획 2026-10-30 Task 11) — 키 미등록·오토 켜짐 아님·그 종목 매매 있음·잔고 50 미만(명단 funded false)인 회원 수.
// 화면 셈일 뿐이고 진짜 판정은 허브(키 미등록·잔고 50 미만)·서버(오토·그 종목 매매·모드)가 한다
export function enterSkips(list, symbol) {
  return (Array.isArray(list) ? list : []).filter((m) => !m.enrolled || m.auto !== true || m.funded === false || m.trades.some((t) => t.symbol === symbol)).length;
}

// 수동 모드 열기 확인 시트의 '건너뛸 회원 n명'(계획 2026-10-30 Task 12 — 대표 결정 2026-11-01 R17) — 키 미등록·오토 켜짐 아님·잔고 50 미만·그 종목에 같은 방향
// 수동 매매가 아닌 매매(신호·반대 방향)가 있는 회원 수. 목록 꼴은 수동 모드 포지션(free)을 가르지 않으므로(보고 꼴 그대로 — R17) 같은 방향 수동 매매는 더 사기로 센다 —
// 화면 셈일 뿐이고 진짜 판정은 서버(free 아닌 매매 has_trade·4차 max_stage·오토·모드)
export function buySkips(list, symbol, dir) {
  return (Array.isArray(list) ? list : []).filter((m) => !m.enrolled || m.auto !== true || m.funded === false
    || m.trades.some((t) => t.symbol === symbol && !(t.side === dir && t.src === 'manual'))).length;
}

// 수동 모드 닫기 확인 시트의 '건너뛸 회원 n명'(계획 Task 13 — 대표 결정 2026-11-01 R18) — 그 종목 포지션이 없는 회원 수(키 미등록 회원은 매매가 없어 여기 듦).
// 화면 셈일 뿐이고 진짜 판정은 서버(그 종목 끝나지 않은 매매 no_trade·detached·too_small·모드)
export function reduceSkips(list, symbol) {
  return (Array.isArray(list) ? list : []).filter((m) => !m.trades.some((t) => t.symbol === symbol)).length;
}

// 수동 추가 확인 시트의 '건너뛸 회원 n명'(대표 요청 2026-11-04) — 그 종목 포지션이 없는 회원 수. 화면 셈일 뿐이고 진짜 판정은 서버
export const addmSkips = (list, symbol) => reduceSkips(list, symbol);

// 명령 결과 한 줄 — 결과가 난 회원은 완료·사유, 아직이면 대기, 허브가 expired로 끝냈으면 응답 없음
export function resultText(r, state) {
  if (r) return r.ok ? CTL_TEXT.result.ok : CTL_TEXT.result[r.error] || CTL_TEXT.result.failed;
  return state === 'expired' ? CTL_TEXT.result.late : CTL_TEXT.result.wait;
}
