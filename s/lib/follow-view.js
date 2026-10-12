// 따라가기 화면 판단(순수 함수, node 검사) — 자격·설정 줄·시트 줄·기록 줄·화면 켜 두기 지원.
// 자격(설계 3-2 §5.1, p2 spec 머리말): s·j판 같은 판 인증 회원이고 (autoReady 또는 시험 토큰). 공용판은 따라가기 코드를 부르지 않는다.
// 키 화면 자격(keys.js keysCapable)은 tradeReady(트레이딩 탭 수동 주문)로도 열리지만 따라가기는 그것으로 열리지 않는다.
// p34: 기록 줄에 회원 본인 USDT 손익(모르면 생략), 자동 손절은 상태 낱말만(가격·거리 없음), 손익 줄(pnlLines — 이 기기 기록·거래 비용 제외·리허설 따로).
import { FTEXT, reasonText } from './follow-text.js';
import { fmtMDHM, fmtWeight, fmtPrice, fmtUsdt, fmtPct, memberCapable } from './auto-view.js';
import { validateSettings, consentNeeded } from './follow-settings.js';
import { AUTO_SL_TEXT } from './auto-sl.js';

// 따라가기 자격 = 키 화면 앞 조건(같은 판 인증) && (autoReady || 시험 토큰) — tradeReady로는 열리지 않는다(p2 spec 머리말 39).
// app.js(#follow·설정 줄·엔진 getMember·트레이딩 탭 자동매매 줄)와 첫 실행 안내 S11(tour.js)이 이것을 쓴다
export const followCapable = (config, member) => memberCapable(config) && !!member && typeof member === 'object' && member.ed === config.edition
  && (config.autoReady === true || member.test === true);

const toneOf = (t) => (t === 'good' || t === 'bad' || t === 'warn' ? t : 'dim');
// 서버 자동이 이 UID를 맡은(맡으려는) 동안 = server-exec.js SERVER_ENGAGED와 같은 목록(이 파일은 server-exec를 가져오지 않는다 — 그쪽이 이 파일을 가져옴)
const SERVER_ENGAGED_KEYS = Object.freeze(['pending', 'on', 'closing']);
const engagedOf = (server) => (server && typeof server === 'object' && SERVER_ENGAGED_KEYS.includes(server.key) ? server : null);

// 트레이딩 탭 열린 포지션 목록 끝의 '내 따라가기 설정'(2026-10-10 — 옛 자동매매 탭 고지 박스 자리, 그 탭은 트레이딩 탭으로 합침). 따라가기 화면과 같은 값을 엔진 state()에서 읽기만 한다:
// 설정(kv.follow — 켜짐·방식·한 매매 최대 증거금·동시), 자동 손절 스위치(kv.autoSl), 규칙(config.followRules — 동시 기본값·비중 배수),
// 대상 종목(회원 상태 follow.symbols, 모르면 따라가기 화면처럼 BTC). 저장·허브 요청 없음, 가격·손절가·거리 없음(규칙 18 — 자동 손절은
// 승인 문구 한 줄만). 따라가기 자격(followCapable — tradeReady만으로는 없음) 없는 기기(공용판·미인증·자격 없는 회원)에는 부르는 쪽(app.js·auto.js)이 넘기지 않는다
const modeName = (m) => (m === 'auto' ? FTEXT.modeAuto : m === 'tap' ? FTEXT.modeTap : null)?.split(' — ')[0] ?? null;
const posNum = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
// server(2026-10-12 서버 자동 — app.js가 serverView 결과를 넘김): 서버 자동이 맡은 동안 방식은 '④ 서버 자동(화면 꺼져도)', 값은 마지막 서버 동의 기록(그 값으로 등록함),
// 상태 줄은 서버 자동 글. 맡지 않으면 예전 그대로(휴대폰 따라가기 설정)
export function mySettingsView(st, { server = null } = {}) {
  if (!st || typeof st !== 'object') return null;
  const M = FTEXT.my;
  const rules = st.rules && typeof st.rules === 'object' ? st.rules : null;
  const srv = engagedOf(server);
  const sc = srv && Array.isArray(st.consents) ? [...st.consents].reverse().find((c) => c && c.mode === 'server' && c.settings && typeof c.settings === 'object') : null;
  const s = sc ? sc.settings : (st.settings && typeof st.settings === 'object' ? st.settings : {});
  const mode = srv ? FTEXT.modeServer.split(' — ')[0] : modeName(s.mode);
  const on = srv ? true : st.on === true;
  const concurrent = posNum(s.maxConcurrent) ? s.maxConcurrent
    : rules && rules.limits && rules.limits.maxConcurrent && posNum(rules.limits.maxConcurrent.default) ? rules.limits.maxConcurrent.default : null;
  const symbols = Array.isArray(st.symbols) ? st.symbols.filter((x) => typeof x === 'string' && /^[A-Z0-9]{1,20}$/.test(x)) : [];
  const mult = rules && rules.follow ? rules.follow.weightMultiplier : 1;
  const slOn = sc && typeof sc.settings.autoSl === 'boolean' ? sc.settings.autoSl
    : st.autoSl && typeof st.autoSl.on === 'boolean' ? st.autoSl.on : !(rules && rules.follow && rules.follow.autoSl && rules.follow.autoSl.default === false);
  // '켜짐'은 저장된 스위치(kv.follow.on)다 — 켜 두었는데 지금 주문이 나가지 않으면(운영 중지·다른 기기·다른 창·키·거래소·서버·한도·업데이트 —
  // 엔진은 스위치를 그대로 둔다) 설정 화면 줄(followRow)과 같은 상태 줄(F-08)을 한 줄 더(검토 2026-10-10 — 기능 한계를 숨기지 않는다).
  // 서버 자동이 맡은 동안은 서버 자동 상태 줄(초록이면 색 없음)
  const ss = st.status && typeof st.status === 'object' ? st.status : null;
  const stalled = !srv && st.on === true && ss && ss.key !== 'on' && typeof ss.text === 'string' && ss.text !== '' ? ss : null;
  const note = srv ? srv.text : stalled ? stalled.text : null;
  const tone = srv ? (srv.tone === 'good' ? null : 'warn') : stalled ? (stalled.tone === 'bad' ? 'bad' : 'warn') : null;
  return {
    title: M.title,
    rows: [
      { id: 'follow', label: M.follow, value: `${on ? M.on : M.off} · ${mode ?? M.noMode}`, note, tone },
      { id: 'maxMargin', label: M.maxMargin, value: posNum(s.maxMarginPct) ? `${s.maxMarginPct}%` : M.unset, note: null },
      { id: 'concurrent', label: M.concurrent, value: concurrent ? M.concurrentN(concurrent) : '-', note: null },
      { id: 'target', label: M.target, value: (symbols.length ? symbols : ['BTC']).join(', '), note: null },
      { id: 'signal', label: M.signal, value: posNum(mult) && mult !== 1 ? `${M.signalSame} · ${M.weight(mult)}` : M.signalSame, note: null },
      { id: 'autoSl', label: M.autoSl, value: slOn ? M.on : M.off, note: slOn ? AUTO_SL_TEXT.desc : null },
    ],
    edit: { text: M.edit, href: '#follow' },
  };
}

// 설정 화면 줄 — 상태 줄(F-08)을 값으로, #follow 링크
export function followRow(st) {
  const s = st && st.status ? st.status : { text: FTEXT.stOff, tone: 'dim' };
  return { id: 'follow', label: FTEXT.settingsRow, value: s.text, tone: toneOf(s.tone), href: '#follow' };
}

// 트레이딩 탭 ⚡ 오토 모드 켜기·끄기 줄(따라가기 — CEO 2026-10-10) — 같은 엔진 상태(state())를 그대로 보인다. 자격은 #follow와 같고(capable = followCapable),
// 없으면 줄 자체가 없다('준비 중' 없음). 버튼 하나: 켜짐이면 따라가기 화면의 끄기 글(→ follow.disable()), 꺼짐이면 저장된 방식의 켜기 글.
// quick = 저장된 설정만으로 따라가기 화면과 같은 enable 길(consentShown 'none')을 탈 수 있음 — 방식·최대 증거금(검사 통과)·같은 설정의 동의 기록·
// 규칙/동의 판 그대로·기기 저장소·키. 거짓이면 앱이 #follow를 열어 막힌 이유 줄(.follow-why)을 보인다. 트레이딩 탭은 동의를 기록하지 않는다
// server(2026-10-12 서버 자동 — serverView 결과): 서버 자동이 맡은 동안 이 줄은 서버 자동 줄 — 켜짐 '서버 자동 켜짐'·끄기 = 서버 자동 끄기(app.js가 serverExec.off('flat')),
// 끄는 중은 버튼을 막는다(지금 지우기는 따라가기 화면에서 확인 창과 함께만). 기능 한계 줄은 serverLimit. 맡지 않으면 휴대폰 줄 그대로(켤 때 등록이 안 됐으면 #follow)
export function followQuick(st, { capable = false, keysReady = false, server = null } = {}) {
  if (!capable || !st || !st.ready) return { show: false };
  const srv = engagedOf(server);
  if (srv) {
    const closing = srv.key === 'closing';
    return {
      show: true, title: FTEXT.quickTitle, note: FTEXT.serverLimit, settings: FTEXT.quickSettings,
      on: true, status: srv.key === 'on' ? FTEXT.quickServerOn : srv.text, tone: toneOf(srv.tone), button: FTEXT.serverOffBtn, quick: false,
      server: true, action: closing ? 'none' : 'serverOff', disabled: closing,
    };
  }
  const on = st.on === true;
  const s = st.settings || {};
  const status = st.status || { text: FTEXT.stOff, tone: 'dim' };
  const button = on
    ? (st.mode === 'tap' ? FTEXT.tapOff : FTEXT.autoOff)
    : (s.mode === 'tap' ? FTEXT.tapOn : s.mode === 'auto' ? FTEXT.autoOn : FTEXT.quickOn);
  return {
    show: true, title: FTEXT.quickTitle, note: FTEXT.quickNote, settings: FTEXT.quickSettings,
    on, status: status.text, tone: toneOf(status.tone), button, quick: !on && quickReady(st, keysReady),
  };
}
function quickReady(st, keysReady) {
  const s = st.settings;
  if (!s || (s.mode !== 'auto' && s.mode !== 'tap') || !st.rules) return false;
  if (st.rulesChanged || st.consentChanged || !st.durable || keysReady !== true) return false;
  if (!validateSettings(s, st.rules).ok) return false;
  return consentNeeded(st.consents, { rulesVersion: st.rules.rulesVersion, mode: s.mode, settings: s }) === 'none';
}

const SIDE = Object.freeze({ long: '롱', short: '숏' });
const STATE_TEXT = Object.freeze({
  new: '준비', opening: '주문 중', open: '열림', closing: '정리 중', closed: '종료', skipped: '건너뜀', detached: '자동매매에서 뺌', unclear: '확인 필요', shadow: '기록만(시험 기간)',
});
// F-18 기록 한 줄: 시각 · [리허설] 종목 방향 · 상태 · 사유(F-09) · 결과 % · 회원 본인 손익 USDT(p34 — 모르면 생략)
export function recordLine(t) {
  const head = `${fmtMDHM(t.openedAt)} · ${t.rehearsal ? `${FTEXT.rehearsal} ` : ''}${t.symbol || '?'} ${SIDE[t.side] || ''}`.trim();
  const parts = [head, STATE_TEXT[t.state] || t.state];
  if (t.reason && t.reason !== 'gone') parts.push(reasonText(t.reason, t.reasonArg ?? null));
  const last = Array.isArray(t.notes) && t.notes.length ? t.notes[t.notes.length - 1] : null;
  if (last && last.reason !== t.reason) parts.push(reasonText(last.reason, last.arg ?? null));
  if (Number.isFinite(t.resultPct)) parts.push(`${t.resultPct > 0 ? '+' : t.resultPct < 0 ? '−' : ''}${Math.abs(t.resultPct).toFixed(1)}%`);
  const usdt = fmtUsdt(t.pnlUsdt);
  if (usdt) parts.push(usdt);
  return parts.join(' · ');
}
// 맨 위 손익 줄(§4.3) — 끝난 매매 합계(손익 모름 수), 열린 매매 평가(열린 매매가 있을 때), [리허설] 따로(있을 때)
export function pnlLines(p) {
  if (!p || !p.done) return [];
  const out = [FTEXT.pnlTitle, FTEXT.pnlDone(p.done.n, p.done.sum, p.done.unknown)];
  if (p.openN > 0) out.push(FTEXT.pnlOpen(p.open));
  if (p.rehearsal && p.rehearsal.n > 0) out.push(FTEXT.pnlRehearsal(p.rehearsal.n, p.rehearsal.sum));
  if (p.rehearsalOpenN > 0) out.push(FTEXT.pnlRehearsalOpen(p.rehearsalOpen)); // 리허설 열린 매매는 따로(p35 F-6)
  return out;
}
// 그림자 실행 기록(T13 대조용): 낼 주문만. 종류는 흐름과 같은 한국어 낱말(E1), 주문 식별자 원문 대신 매매 id 끝 4자만(통합 보고 7)
const COID_FILL = /\.[ed](\d{1,2})$/;
function shadowKind(r) {
  const n = Number.isInteger(r.fill) && r.fill > 0 ? r.fill : (typeof r.customId === 'string' && COID_FILL.test(r.customId) ? Number(COID_FILL.exec(r.customId)[1]) : null);
  switch (r.kind) {
    case 'entry': return `${n || 1}차 진입`;
    case 'dca': return n ? `${n}차 진입` : '추가 진입';
    case 'adjust': return '익절·손절가 조정';
    case 'close': return '포지션 정리';
    case 'autoSl': return FTEXT.shadowAutoSl;
    default: return '기록';
  }
}
const priceOr = (v) => (v == null ? '없음' : fmtPrice(v) || '없음');
export function shadowLines(t) {
  const tail = typeof t.id === 'string' && /^[0-9a-z]{4,}$/i.test(t.id) ? ` · 매매 …${t.id.slice(-4)}` : '';
  return (Array.isArray(t.shadow) ? t.shadow : []).map((r) => (r.kind === 'autoSl'
    ? `${fmtMDHM(r.at)} · ${t.symbol} ${SIDE[r.side] || ''} · ${shadowKind(r)}${tail}` // 자동 손절 자리 — 가격 없음(§2.10)
    : `${fmtMDHM(r.at)} · ${t.symbol} ${SIDE[r.side] || ''} · ${shadowKind(r)} · 수량 ${r.qty == null ? '-' : r.qty} · ${r.lev == null ? '-' : `${r.lev}×`} · 익절 ${priceOr(r.tp)} · 손절 ${priceOr(r.sl)}${tail}`));
}

// 동의 기록 보기(F-18) 한 줄 — 날짜·시각·방식·규칙 판·값(p34: 최대 증거금·자동 손절(그때 값, 정보)·동시 — 옛 기록의 직접 손절·하루 손실·가격 차이는 그리지 않음)
export function consentLine(c) {
  const s = c && c.settings ? c.settings : {};
  const sl = s.autoSl === true ? '켜짐' : s.autoSl === false ? '꺼짐' : '-';
  return `${fmtMDHM(c.at)} · ${c.mode === 'server' ? '④ 서버 자동' : c.mode === 'auto' ? '② 자동' : '③ 한 번 눌러'} · 규칙 ${c.rulesVersion} · 한 매매 최대 증거금 ${s.maxMarginPct ?? '-'}% · 자동 손절 ${sl} · 동시 ${s.maxConcurrent ?? '-'}건`;
}
// 서버 자동 매매 줄(2026-10-12 설계 §10 — 허브 /v1/member/server/state trades, 이 회원 것만). 최근 순·최대 50.
// 시각 · [리허설] 종목 방향 배율 · 차수 · 상태 · 평단·정리가(이 회원 것) · 결과 % · USDT(거래 비용 제외) · 자동 손절 상태 낱말(가격 없음 — 규칙 18)
// 모양은 server-exec.js checkServerState가 이미 봤다 — 여기서는 쓰는 칸만 다시 거른다
// 상태 낱말 = 위 STATE_TEXT와 같은 글 — 서버 매매에 없는 new만 뺐다
const SERVER_STATE_TEXT = Object.freeze({ open: '열림', opening: '주문 중', closing: '정리 중', closed: '종료', unclear: '확인 필요', detached: '자동매매에서 뺌', skipped: '건너뜀', shadow: '기록만(시험 기간)' });
const okLine = (t) => !!t && typeof t === 'object' && typeof t.id === 'string' && (t.side === 'long' || t.side === 'short') && typeof t.symbol === 'string'
  && /^[A-Z0-9]{1,20}$/.test(t.symbol) && Number.isInteger(t.lev) && Number.isInteger(t.stage) && Object.hasOwn(SERVER_STATE_TEXT, t.state)
  && typeof t.openedAt === 'number' && Number.isFinite(t.openedAt);
export function serverTradeLines(trades) {
  const list = (Array.isArray(trades) ? trades : []).filter(okLine).sort((a, b) => b.openedAt - a.openedAt).slice(0, 50);
  return list.map((t) => {
    const parts = [`${fmtMDHM(t.openedAt)} · ${t.rehearsal === true ? `${FTEXT.rehearsal} ` : ''}${t.symbol} ${SIDE[t.side]} ${t.lev}×`, `${t.stage}차`, SERVER_STATE_TEXT[t.state]];
    const avg = fmtPrice(t.avg);
    if (avg) parts.push(`평단 ${avg}`);
    const exit = fmtPrice(t.exit);
    if (exit) parts.push(`정리 ${exit}`);
    const pct = fmtPct(t.resultPct);
    if (pct) parts.push(pct);
    const usdt = fmtUsdt(t.pnlUsdt);
    if (usdt) parts.push(`${usdt} · 거래 비용 제외`);
    if (typeof t.autoSl === 'string' && Object.hasOwn(AUTO_SL_TEXT.word, t.autoSl)) parts.push(AUTO_SL_TEXT.word[t.autoSl]);
    return { text: parts.join(' · '), tag: FTEXT.serverTag, rehearsal: t.rehearsal === true };
  });
}
// 트레이딩 탭 목록의 서버 매매 묶음(2026-10-12 §10) — 줄 + 합계(끝난 실제 매매의 USDT — 리허설·손익 모름은 빼고, 거래 비용 제외). 줄이 없으면 null
export function serverTradesView(trades) {
  const lines = serverTradeLines(trades);
  if (!lines.length) return null;
  const done = (Array.isArray(trades) ? trades : []).filter((t) => t && t.state === 'closed' && t.rehearsal !== true && typeof t.pnlUsdt === 'number' && Number.isFinite(t.pnlUsdt));
  const sum = Math.round(done.reduce((a, t) => a + t.pnlUsdt, 0) * 100) / 100;
  return { lines, total: done.length ? FTEXT.serverTotal(done.length, sum) : null };
}

// 시트(F-10) 줄 — 남은 시간은 화면 시각으로 초 단위 내림. autoSlOn = 자동 손절 스위치(손절 칸 '없음(4차 진입 뒤 자동)', 가격 없음)
export function sheetLines(sheet, now, { autoSlOn = false } = {}) {
  const ev = sheet.ev || {};
  const pre = sheet.rehearsal ? `${FTEXT.rehearsal} ` : '';
  if (sheet.kind === 'close') {
    return {
      title: `${pre}${FTEXT.sheetEnded}`,
      signal: `${ev.symbol || ''} ${SIDE[ev.side] || ''}`.trim(),
      reason: sheet.reason ? reasonText(sheet.reason) : null,
      mine: null, tpsl: null, left: null, expired: false, go: FTEXT.sheetClose, closeOnly: true,
    };
  }
  const left = sheet.deadline == null ? null : Math.max(0, Math.floor((sheet.deadline - now) / 1000));
  const p = sheet.preview;
  return {
    title: `${pre}${FTEXT.sheetNew}`,
    signal: FTEXT.sheetSignal(ev),
    reason: sheet.reason ? reasonText(sheet.reason) : null,
    mine: p && Number.isFinite(p.margin) && p.qty != null ? FTEXT.sheetMine((Math.round(p.margin * 10) / 10).toFixed(1), p.lev, p.amount, p.base) : null,
    tpsl: p ? FTEXT.sheetTpsl(p.tp, p.sl, autoSlOn === true) : null,
    left: left == null ? null : FTEXT.sheetLeft(left),
    expired: left !== null && left <= 0,
    go: sheet.kind === 'adjust' ? FTEXT.sheetAdjust : FTEXT.sheetGo,
    closeOnly: false,
  };
}

// 화면 켜 두기(§6.14): wakeLock이 있고 iOS 홈 화면 앱이면 18.4 이상만(그 아래는 있어도 안 됨 — F-21), 없으면 줄을 숨김
export function wakeSupport(nav, ua = '', standalone = false) {
  const has = !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
  const m = /(?:iPhone|iPad|iPod).*? OS (\d+)_(\d+)/.exec(ua);
  if (m && standalone) {
    const v = Number(m[1]) + Number(m[2]) / 100;
    if (v < 18.04) return 'ios-old';
  }
  return has ? 'ok' : 'none';
}

// 문구 검사용 — 이 파일이 만드는 글 전부
export function viewSamples() {
  const ev = { symbol: 'BTC', side: 'long', kind: 'entry', stage: 1, lev: 20, weightPct: 13 };
  return [
    recordLine({ openedAt: 0, symbol: 'BTC', side: 'long', state: 'skipped', reason: 'late', notes: [] }),
    recordLine({ openedAt: 0, symbol: 'BTC', side: 'long', state: 'closed', reason: 'auto_sl', resultPct: -71.2, pnlUsdt: -9.94, notes: [] }),
    ...Object.keys(STATE_TEXT).map((s) => STATE_TEXT[s]),
    ...Object.values(sheetLines({ kind: 'entry', ev, deadline: 1000, preview: { margin: 32.5, lev: 20, qty: 0.005, amount: '0.005', base: 'BTC', tp: 64150, sl: null }, reason: 'manual_signal' }, 0, { autoSlOn: true })).filter((x) => typeof x === 'string'),
    ...Object.values(sheetLines({ kind: 'close', ev, reason: 'signal_unclear' }, 0)).filter((x) => typeof x === 'string'),
    ...pnlLines({ done: { n: 2, sum: 3.5, unknown: 1 }, rehearsal: { n: 1, sum: -2.7, unknown: 0 }, openN: 1, open: -1.25 }),
    consentLine({ at: 0, mode: 'auto', rulesVersion: 'r', settings: { maxMarginPct: 25, maxConcurrent: 3, autoSl: true } }),
    fmtWeight(13),
  ];
}
