// 운영 측 실계좌 자동매매 송출 화면 판단 — 상태 줄·이벤트 문구·성적 줄·배율 표시·알림 여부·판별 안내를 순수 함수로(node에서 검사).
// 설계 3-1 §6·§11. 공개 송출에는 가격이 없다 — 여기서도 가격·금액·미실현 %를 만들지 않는다.
// 대표 결정 2026-10-10: 자동매매 탭을 트레이딩 탭으로 합쳤다 — 차트 위 '⚡ 오토 모드' 카드(이름표 '운영 측 실계좌'·상태 줄·오토 종목·A-03·인증 입구)와
// 주문 칸 아래 운영 측 열린 포지션·가격 안내·최근 매매 흐름·성적·새 매매 알림 스위치·내 따라가기 설정(그리기는 modes/auto.js). 옛 탭 머리 줄·'정보 제공용' 안내·
// autoReady 안내 줄은 합친 화면(주문 칸이 있음)에 없다 — 자동 따라가기 기능 한계는 따라갈 수 있는 기기의 ⚡ 줄(FTEXT.quickNote)
import { trialUsedUp } from './trial.js';

export const LIST_KINDS = Object.freeze(['entry', 'dca', 'tp', 'sl', 'close', 'liq', 'untracked', 'lost']);
export const ALERT_WINDOW_MS = 2 * 60 * 1000;
export const ALERTS_KEY = 'ptf-auto-alerts';
export const PCT_BASIS = '증거금 기준 · 거래 비용 제외'; // 설계 §11 "모든 %에"
const FEE_EXCL = '거래 비용 제외'; // 회원 본인 USDT 줄(p35 F-7)
const PCT_KINDS = Object.freeze(['tp', 'sl', 'close', 'liq']); // 결과 %를 문구에 붙이는 종류

// 유사투자자문업 신고번호 — 사용자에게 받으면 여기 한 곳만 채운다(문자열, 예: '2026-123'). null이면 번호 괄호 없이.
// TEXT.notice(원금 손실 문장)는 따라가기 화면·시트(followCapable 기기)·키 화면(keysCapable — p40부터 tradeReady 기기 포함)이, TEXT.legal(다섯 줄)은
// 따라가기 화면(동의)·시트·키 화면이 그린다(트레이딩 탭 주문 칸이 열린 기기는 주문 칸 안내 M-25·처음 쓸 때 동의에도 원금 손실 문장 — trade-view.js MTEXT) —
// 자동매매 탭 아래 고지 박스는 2026-10-10 결정으로 뺐고(그 자리에 내 따라가기 설정), 두 탭을 합친 트레이딩 탭도 같은 결정으로 법정 다섯 줄을 뺐다.
// 그 뒤로 공용판·미인증 기기의 셸에는 원금 손실 문장이 없다(CLAUDE.md 열린 질문)
export const REGISTRATION_NO = null;
const LEGAL_HEAD = '플러스에셋파트너스 주식회사는 「자본시장과 금융투자업에 관한 법률」 제101조에 따라 신고한 유사투자자문업자입니다.';
export function legalHead(no = REGISTRATION_NO) {
  const n = typeof no === 'string' ? no.trim() : '';
  return /^[0-9A-Za-z-]{1,30}$/.test(n) ? `${LEGAL_HEAD} (신고번호: ${n})` : LEGAL_HEAD;
}

export const TEXT = Object.freeze({
  title: '⚡ 오토 모드', // 트레이딩 탭 차트 위 카드 제목(2026-10-10 합침) — 따라갈 수 있는 기기는 같은 글의 켜기·끄기 줄 제목(FTEXT.quickTitle)
  // 합친 화면 검토(2026-10-10): 송출 상태 줄·열린 포지션·흐름·새 매매 알림은 운영 측 실계좌 것이다. 회원 자기 ⚡ 켜기·끄기 줄(바로 위)·주문 칸
  // (회원 자기 포지션 — 청산가 없음, 바로 위)과 같은 화면이라 누구 것인지 이름표(카드 상태 줄 앞)·제목·알림 머리에 밝힌다(tour S10과 같은 말)
  owner: '운영 측 실계좌',
  openTitle: '운영 측 열린 포지션',
  flowTitle: '운영 측 최근 매매 흐름',
  flowNote: `% = ${PCT_BASIS}`,
  flowEmpty: '아직 기록된 매매가 없습니다.',
  genericPriceNote: '가격 정보는 UID 인증 회원 전용입니다.',
  pubPriceNote: '가격 정보는 모바일 버전에서 볼 수 있습니다(담당자 안내).',
  partnerPriceNote: 'UID 인증 후 가격 정보가 열립니다.', // 설계 3-2 §8.1 A-03 — 담당자판 미인증 + 'UID 인증하기'
  signup: '오렌지엑스 가입하기',
  trialEnd: '활성화를 위해서는 문의를 통해 정식 버전 링크를 받아 주세요',
  apply: '모바일 버전 신청(카카오 문의)',
  notice: '실제 계좌 실시간 기록(손절·청산 포함, 증거금 기준·거래 비용 미반영) · 원금 손실이 날 수 있고 손실은 투자자 본인에게 귀속됩니다 · 과거·현재 기록은 미래 수익을 보장하지 않습니다 · 개별 투자 상담은 하지 않습니다',
  // 유사투자자문업 신고 서류 '초기화면 고지문구'(7_초기화면_고지문구.pdf)의 표준 고지 다섯 줄 — 첫 줄은 운영사 신고 사실
  legal: Object.freeze([
    legalHead(),
    '본 서비스는 불특정 다수를 대상으로 한 투자정보 제공이며, 투자자문업·투자일임업 인가를 받지 않았습니다.',
    '제공 정보는 투자 참고자료일 뿐 1:1 개별 투자자문이나 매매 권유가 아닙니다.',
    '투자에 대한 최종 판단과 손익의 책임은 회원 본인에게 있으며, 회사는 어떠한 수익도 보장하지 않습니다.',
    '과거의 수익률이 미래의 수익을 보장하지 않습니다.',
  ]),
  alertSwitch: '새 매매 알림(앱이 화면에 켜져 있을 때 · 이 기기에 저장)',
  levUnknown: '배율 정보 없음',
});
export const TRIAL_END_MESSAGE = TEXT.trialEnd;

const KST_MS = 9 * 60 * 60 * 1000;
const MAX_MS = 8.64e15 - KST_MS;
function kst(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || Math.abs(ms) > MAX_MS) return null;
  const d = new Date(ms + KST_MS);
  return { mo: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: String(d.getUTCHours()).padStart(2, '0'), mm: String(d.getUTCMinutes()).padStart(2, '0') };
}
export function fmtMD(ms) { const k = kst(ms); return k ? `${k.mo}/${k.d}` : ''; }
export function fmtHM(ms) { const k = kst(ms); return k ? `${k.hh}:${k.mm}` : ''; }
export function fmtMDHM(ms) { const k = kst(ms); return k ? `${k.mo}/${k.d} ${k.hh}:${k.mm}` : ''; }

export function fmtPct(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%`;
}

// 회원 본인 따라가기 손익 USDT(p34 §4.3) — 소수 2자리·천 단위 쉼표·부호 +·−(U+2212, fmtPct와 같게). 운영 측 실계좌 금액에는 쓰지 않는다
export function fmtUsdt(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) >= 1e12) return null;
  const r = Math.round(v * 100) / 100;
  const [i, f] = Math.abs(r).toFixed(2).split('.');
  const body = `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${body} USDT`;
}

// 카드의 배율은 숫자만(예: 20×) — 같은 줄 청산 경고 문장은 넣지 않는다(대표 결정 2026-10-07, 설계 §6).
// 원금 손실 위험 고지(TEXT.notice·동의 ⑥)는 따라가기 화면·시트·키 화면에 남는다(트레이딩 탭은 주문 칸이 열린 기기만 M-25·동의 문장 —
// 자동매매 탭 고지 박스와 트레이딩 탭 법정 다섯 줄은 2026-10-10에 뺌). 배율 1~200 밖이면 "배율 정보 없음"
export function levLine(lev) {
  if (typeof lev !== 'number' || !Number.isFinite(lev) || lev < 1 || lev > 200) return TEXT.levUnknown;
  return `${lev}×`;
}

// 열린 포지션 카드의 배율 줄 — 배포판 매매 카드처럼 마진 모드를 앞에(E2, 2026-10-07 저녁): "격리 50×". 숫자만, 청산 문장 없음
export function cardLevLine(lev) {
  const l = levLine(lev);
  return l === TEXT.levUnknown ? l : `격리 ${l}`;
}

const posInt = (n) => Number.isInteger(n) && n > 0;
export function stageText(stage, maxStage) {
  if (!posInt(stage)) return '';
  return posInt(maxStage) ? `${stage}/${maxStage}차` : `${stage}차`;
}

// 흐름 낱말(E1, 배포판 맞춤 2026-10-07 저녁): "1차 진입"·"N차 진입"·"익절 체결"·"포지션 정리". 차수가 없으면 "진입"·"추가 진입",
// 운영 측 직접 추가 진입은 "직접 추가 진입". 손절·청산·추적 종료·결과 미확인은 그대로
function entryHead(b, ev) {
  return posInt(ev.stage) ? `${b} ${ev.stage}차 진입` : `${b} 진입`;
}
function dcaHead(b, ev) {
  if (ev.manual === true) return `${b} 직접 추가 진입`;
  return posInt(ev.stage) ? `${b} ${ev.stage}차 진입` : `${b} 추가 진입`;
}
const WORD = Object.freeze({ tp: '익절 체결', sl: '손절', liq: '청산', close: '포지션 정리' });

const SIDE = Object.freeze({ long: '롱', short: '숏' });
function label(x) {
  const sym = typeof x.symbol === 'string' && x.symbol.trim() ? x.symbol.trim().slice(0, 20) : '?';
  const side = typeof x.side === 'string' && Object.hasOwn(SIDE, x.side) ? SIDE[x.side] : '';
  return side ? `${sym} ${side}` : sym;
}

export function eventText(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const b = label(ev);
  const pct = fmtPct(ev.resultPct);
  const withPct = (word) => (pct ? `${b} ${word} · ${pct}` : `${b} ${word}`);
  let s;
  switch (ev.kind) {
    case 'entry': s = entryHead(b, ev); break;
    case 'dca': s = dcaHead(b, ev); break;
    case 'adjust': s = `${b} 익절·손절가 조정`; break;
    case 'tp':
    case 'sl':
    case 'liq':
    case 'close': s = withPct(WORD[ev.kind]); break;
    case 'untracked': s = `${b} 추적 종료 — 거래소 포지션은 남아 있을 수 있음 · 결과 미확인`; break;
    case 'lost': s = `${b} 결과 미확인(기록에서 사라짐)`; break;
    default: return null;
  }
  return ev.late === true ? `${s} (늦게 확인)` : s;
}

// 맨 위 알림 배너 — 어느 탭에서든 맥락 없이 뜨므로 결과 %에 기준을 같이 붙인다(설계 §11 "모든 %에"). 머리는 이름표(TEXT.owner) — 배너는
// 트레이딩 패널 맨 앞, 회원 자기 주문 칸과 같은 화면이라 방금 누른 진입의 체결로 읽히지 않게(합친 화면 검토 2026-10-10)
export function alertText(ev) {
  const t = eventText(ev);
  if (!t) return null;
  const body = PCT_KINDS.includes(ev.kind) && fmtPct(ev.resultPct) ? `${t} (${PCT_BASIS})` : t;
  return `${TEXT.owner} · ${body}`;
}

export function toneFor(ev) {
  switch (ev && ev.kind) {
    case 'tp': return 'good';
    case 'sl':
    case 'liq': return 'bad';
    case 'untracked':
    case 'lost': return 'warn';
    case 'close': {
      const v = ev.resultPct;
      if (typeof v === 'number' && v > 0) return 'good';
      if (typeof v === 'number' && v < 0) return 'bad';
      return 'dim';
    }
    default: return 'dim';
  }
}

function openList(state) {
  return state && typeof state === 'object' && Array.isArray(state.open) ? state.open.filter((o) => o && typeof o === 'object') : [];
}

// 앞 조건이 우선(설계 §6). "멈춤"이라고 쓰지 않는다 — 방어형 오토는 autoOn에 잡히지 않는다
export function statusLine({ state, hubDown }) {
  if (hubDown) return { text: '연결 안 됨', tone: 'bad' };
  if (!state || typeof state !== 'object') return { text: '불러오는 중…', tone: 'dim' };
  if (state.stale === true || state.degraded === true) {
    const t = fmtHM(state.updated);
    return { text: t ? `송출 지연 · 마지막 갱신 ${t}` : '송출 지연', tone: 'warn' };
  }
  const n = openList(state).length;
  if (n > 0) return { text: `● 포지션 보유 중 ${n}건`, tone: 'good' };
  if (state.autoOn === true) return { text: '● 자동매매 켜짐 · 진입 대기', tone: 'good' };
  return { text: '○ 지금 열린 포지션 없음', tone: 'dim' };
}

export function symbolsLine(state) {
  const list = state && Array.isArray(state.autoSymbols) ? state.autoSymbols.filter((s) => typeof s === 'string' && /^[A-Z0-9]{1,20}$/.test(s)) : [];
  return list.length ? `오토 종목: ${list.join(', ')}` : null;
}

export function statsLine(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const since = fmtMD(stats.since);
  if (!since) return null;
  const n = (k) => (Number.isInteger(stats[k]) && stats[k] >= 0 ? stats[k] : 0);
  const parts = [`송출 시작(${since}) 이후 종료 ${n('closed')}건`, `익절 ${n('tp')}`, `손절 ${n('sl')}`, `청산 ${n('liq')}`];
  if (n('other') > 0) parts.push(`기타 종료 ${n('other')}`);
  if (n('unknown') > 0) parts.push(`결과 미확인 ${n('unknown')}`);
  return parts.join(' · ');
}

export function openCard(o) {
  if (!o || typeof o !== 'object') return null;
  const opened = fmtMDHM(o.openedAt);
  return {
    id: typeof o.id === 'string' ? o.id : '',
    title: label(o),
    lev: cardLevLine(o.lev),
    stage: stageText(o.stage, o.maxStage),
    time: opened ? `${opened} 진입` : '',
  };
}

// 실시간으로 받은 이벤트 중: 8종 · 늦지 않음 · 기기 시각으로 2분 안 · 접속(목록 채움) 때 번호보다 큼(설계 §6 알림)
export function shouldAlert(ev, { now, baselineSeq }) {
  return !!ev && typeof ev === 'object'
    && LIST_KINDS.includes(ev.kind)
    && ev.late !== true
    && Number.isInteger(ev.seq)
    && Number.isInteger(baselineSeq)
    && ev.seq > baselineSeq
    && typeof ev.at === 'number' && Number.isFinite(ev.at)
    && Math.abs(now - ev.at) <= ALERT_WINDOW_MS;
}

const HTTPS = /^https:\/\/[^\s"'<>]+$/;
// 담당자판(s·j) 미인증 = A-03 + 'UID 인증하기'(#verify, 설계 3-2 §3.6). 그 밖 판(검사용 dev 등)에는 인증 입구가 없다
export function editionNotes(config, trial) {
  const c = config && typeof config === 'object' ? config : {};
  if (c.edition === 'pub') {
    const cta = trialUsedUp(trial) && typeof c.kakao === 'string' && HTTPS.test(c.kakao)
      ? { message: TEXT.trialEnd, text: TEXT.apply, href: c.kakao }
      : null;
    return { priceNote: TEXT.pubPriceNote, signup: null, cta, verify: null };
  }
  const signup = typeof c.signupUrl === 'string' && HTTPS.test(c.signupUrl) ? { text: TEXT.signup, href: c.signupUrl } : null;
  if (memberCapable(c)) return { priceNote: TEXT.partnerPriceNote, signup, cta: null, verify: { text: MEMBER_TEXT.verify, href: '#verify' } };
  return { priceNote: TEXT.genericPriceNote, signup, cta: null, verify: null };
}

export function editionLinks(config, trial) {
  const n = editionNotes(config, trial);
  if (n.signup) return [{ id: 'signup', label: n.signup.text, href: n.signup.href, external: true }];
  if (n.cta) return [{ id: 'apply', label: n.cta.text, href: n.cta.href, external: true, note: n.cta.message }];
  return [];
}

// followLink: 인증이 풀렸는데 따라가기로 연 포지션이 남은 s·j판(F-20 '내 포지션 정리'로 가는 길, app.js followScreenOk)
// memberPending: s·j판이 저장된 인증을 아직 불러오는 중(앱을 켠 직후) — 가입하기·'UID 인증하기'·A-03을 그리지 않는다. 인증된 기기를 켤 때
// 미인증 화면이 잠깐 비치지 않게(검토 2026-10-10 — 인증된 기기에는 가입하기가 없어야 함). 공용판은 기다릴 인증이 없어 그대로
export function autoViewModel({ config = {}, snap = null, trial = null, memberNote = null, followLink = false, memberPending = false } = {}) {
  // loaded=false(화면으로 돌아와 다시 채우는 중·실패) — 숨어 있던 동안 닫혔을 수 있는 옛 상태는 상태 줄·카드·종목·성적에 쓰지 않는다
  const fresh = !(snap && snap.loaded === false);
  const state = fresh && snap && snap.state && typeof snap.state === 'object' ? snap.state : null;
  const hubDown = !!(snap && snap.hubDown);
  const events = snap && Array.isArray(snap.events) ? snap.events.filter((e) => e && typeof e === 'object' && Number.isInteger(e.seq)) : [];
  const shown = editionNotes(config, trial);
  const notes = memberPending === true && memberCapable(config) ? { ...shown, priceNote: null, signup: null, verify: null } : shown;
  const flow = events
    .filter((e) => LIST_KINDS.includes(e.kind))
    .sort((a, b) => b.seq - a.seq)
    .map((e) => ({ seq: e.seq, time: fmtMDHM(e.at), text: eventText(e), tone: toneFor(e) }))
    .filter((f) => f.text);
  return {
    title: TEXT.title,
    badge: null,
    memberNote: typeof memberNote === 'string' && memberNote ? memberNote : null, // 해제 사유(V-14·V-16·V-17)
    owner: TEXT.owner, // 상태 줄 앞 이름표 — 이 상태 줄은 운영 측 실계좌 것(회원 자기 ⚡ 켜기·끄기 줄과 따로)
    status: statusLine({ state, hubDown }),
    symbols: hubDown ? null : symbolsLine(state),
    openTitle: TEXT.openTitle,
    cards: openList(state).map(openCard).filter(Boolean),
    priceNote: notes.priceNote,
    verify: notes.verify,
    follow: followLink ? { text: MEMBER_TEXT.follow, href: '#follow' } : null,
    signup: notes.signup,
    cta: notes.cta,
    flowTitle: TEXT.flowTitle,
    flowNote: TEXT.flowNote,
    flowEmpty: TEXT.flowEmpty,
    flow,
    stats: state ? statsLine(state.stats) : null,
    // 고지 박스(TEXT.notice·legal)는 없다(2026-10-10). 그 자리 '내 따라가기 설정'은 회원 화면(memberViewModel)에만 — 공개 화면은 늘 없음
    mySettings: null,
    alertSwitch: TEXT.alertSwitch,
  };
}

// 화면에 나가는 문자열 전부(문구 검사용)
export function viewTexts(vm) {
  return [
    vm.title, vm.badge, vm.memberNote, vm.owner, vm.status && vm.status.text, vm.symbols, vm.openTitle,
    ...vm.cards.flatMap((c) => [c.title, c.lev, c.stage, c.time, ...(c.prices || []), ...(c.fills || []), c.frozen, c.mine]),
    vm.priceNote, vm.verify && vm.verify.text, vm.follow && vm.follow.text, vm.mineTotal, vm.signup && vm.signup.text, vm.cta && vm.cta.message, vm.cta && vm.cta.text,
    vm.flowTitle, vm.flowNote, vm.flowEmpty, ...vm.flow.flatMap((f) => [f.time, f.text]),
    vm.stats, ...mySettingsTexts(vm.mySettings), vm.alertSwitch,
  ].filter((t) => typeof t === 'string' && t !== '');
}
function mySettingsTexts(m) {
  if (!m || typeof m !== 'object') return [];
  const rows = Array.isArray(m.rows) ? m.rows : [];
  return [m.title, ...rows.flatMap((r) => [r.label, r.value, r.note]), m.edit && m.edit.text];
}

// ── 인증 회원(설계 3-2 §3.1·§3.6) — UID 인증·회원 송출은 담당자판(s·j)만. 공용판에는 들어가는 곳이 없다 ──
export const MEMBER_EDITIONS = Object.freeze(['s', 'j']);
export function memberCapable(config) {
  return !!config && typeof config === 'object' && MEMBER_EDITIONS.includes(config.edition);
}
// 회원 송출 목록(흐름)은 조정(adjust)도 받는다(설계 3-2 §3.6 A-06) — 알림 대상은 3-1 LIST_KINDS 그대로
export const MEMBER_LIST_KINDS = Object.freeze([...LIST_KINDS, 'adjust']);

// ── 인증 회원 화면(설계 3-2 §3.6, 문구 §8.1 A-01~A-07) ──
// 회원 송출에는 가격이 있다 — 평단·익절가·손절가·청산가·체결가·비중. 배율은 숫자만(20×), 금액·수량은 없다.
export const MEMBER_TEXT = Object.freeze({
  badge: '인증 회원', // A-01
  badgeTest: (md) => `시험용 인증 · ${md}까지`, // A-01
  badgeTestNoDate: '시험용 인증',
  priceNote: `인증 회원 전용 가격 정보입니다 · % = ${PCT_BASIS}`, // A-02
  verify: 'UID 인증하기', // A-03 버튼
  rehearsal: '[리허설]', // A-07
  noTp: '익절 없음', // A-04
  noSl: '손절 없음',
  noLiq: '청산가 정보 없음',
  noWeight: '비중 정보 없음', // A-05
  fillsPartial: '(앞 체결 기록 일부 없음)',
  frozen: '신호 일시 고정(신호 원천 상태 확인 중)',
  follow: '따라가기', // 따라가기 화면(#follow) 버튼 — 인증이 풀렸는데 따라가기로 연 포지션이 남은 s·j판의 정리 길(F-20)만(2026-10-10 합침 뒤)
  missed: '놓친 신호(실행 안 함)', // A-07 — 따라가기가 실행하지 않은 신호(엔진 missed)
  // p34 §4.3 — 이 기기 장부의 회원 본인 따라가기(가격 없음, 손익은 회원 본인 돈 · 거래 비용 제외). p35 F-7: 값이 있는 USDT 줄 셋 모두
  // '거래 비용 제외'를 같은 줄에(CLAUDE.md 화면 문구 예외 ②)
  mineOpen: (word, v) => ['내 따라가기 · 열림', word, `평가 ${fmtUsdt(v) ?? '-'}`, fmtUsdt(v) ? FEE_EXCL : null].filter(Boolean).join(' · '),
  mineDone: (pct, v) => {
    const parts = [fmtPct(pct), fmtUsdt(v)].filter(Boolean);
    return parts.length ? `내 결과 ${parts.join(' · ')} · ${FEE_EXCL}` : '내 결과 -';
  },
  mineTotal: (v) => `내 따라가기 합계(이 기기 · ${FEE_EXCL}) ${fmtUsdt(v) ?? '-'}`,
});

// 가격: 1,000 이상 소수 1자리, 100 이상 2자리, 1 이상 3자리, 그 밖 5자리, 천 단위 쉼표(§3.6)
export function fmtPrice(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v >= 1e15) return null;
  const d = v >= 1000 ? 1 : v >= 100 ? 2 : v >= 1 ? 3 : 5;
  const [i, f] = v.toFixed(d).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
}

// 비중: 소수 2자리까지(뒤 0 없음) — 13 → 13%, 13.05 → 13.05%
export function fmtWeight(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1000) return null;
  const r = Math.round(v * 100) / 100;
  return r > 0 ? `${r}%` : null;
}

const weightPart = (w) => {
  const s = fmtWeight(w);
  return s ? `비중 ${s}` : MEMBER_TEXT.noWeight;
};
const joinParts = (...parts) => parts.filter((p) => typeof p === 'string' && p !== '').join(' · ');

// A-06 — 진입·추가 진입은 체결가·비중(추가 진입은 평단), 조정은 익절·손절가, 끝 종류는 결과 %·가격. untracked·lost는 3-1 문구
export function memberEventText(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const b = label(ev);
  const price = fmtPrice(ev.price);
  const pct = fmtPct(ev.resultPct);
  const avg = fmtPrice(ev.avg);
  let s;
  switch (ev.kind) {
    case 'entry':
      s = joinParts(entryHead(b, ev), price, weightPart(ev.weightPct));
      break;
    case 'dca':
      s = joinParts(dcaHead(b, ev), price, weightPart(ev.weightPct), avg ? `평단 ${avg}` : null);
      break;
    case 'adjust': {
      const tp = fmtPrice(ev.tp);
      const sl = fmtPrice(ev.sl);
      s = joinParts(`${b} 익절·손절가 조정`, tp ? `익절 ${tp}` : MEMBER_TEXT.noTp, sl ? `손절 ${sl}` : MEMBER_TEXT.noSl);
      break;
    }
    case 'tp':
    case 'sl':
    case 'liq':
    case 'close': s = joinParts(`${b} ${WORD[ev.kind]}`, pct, price); break;
    case 'untracked':
    case 'lost':
      return eventText(ev);
    default:
      return null;
  }
  return ev.late === true ? `${s} (늦게 확인)` : s;
}

export function rehearsalText(ev) {
  const t = memberEventText(ev);
  return t ? `${MEMBER_TEXT.rehearsal} ${t}` : null;
}

// 체결 줄 머리 — 허브는 운영 측이 직접 연 매매(origin manual)의 진입 체결에도 manual:true를 붙인다. 진입 체결(체결 1번)은 차수('1차 …'),
// '직접 추가'는 추가 체결만(트레이딩 탭 합침 검토 2026-10-10 — 차트 마커 chart-position-overlay fillText·흐름 '1차 진입'과 같은 규칙)
function fillLine(f) {
  const price = fmtPrice(f.price);
  if (!price) return null;
  const n = posInt(f.stage) ? f.stage : posInt(f.fill) ? f.fill : null;
  const added = f.manual === true && f.fill !== 1;
  const head = added ? `직접 추가 ${price}` : n ? `${n}차 ${price}` : price;
  return `${head} · ${weightPart(f.weightPct)}`;
}

// A-04·A-05 — 3-1 카드 아래에 가격 줄·체결 줄. 배율은 숫자만
export function memberCard(o, { rehearsal = false } = {}) {
  const base = openCard(o);
  if (!base) return null;
  const avg = fmtPrice(o.avg);
  const tp = fmtPrice(o.tp);
  const sl = fmtPrice(o.sl);
  const liq = fmtPrice(o.liq);
  const tpPct = fmtPct(o.tpPct);
  const slPct = fmtPct(o.slPct);
  const prices = [
    avg ? `평단 ${avg}` : null,
    tp ? (tpPct ? `익절 ${tp} (${tpPct})` : `익절 ${tp}`) : MEMBER_TEXT.noTp,
    sl ? (slPct ? `손절 ${sl} (${slPct})` : `손절 ${sl}`) : MEMBER_TEXT.noSl,
    liq ? `청산가 ${liq}` : MEMBER_TEXT.noLiq,
  ].filter(Boolean);
  const fills = (Array.isArray(o.fills) ? o.fills : [])
    .filter((f) => f && typeof f === 'object')
    .sort((a, b) => (Number.isFinite(a.fill) ? a.fill : 0) - (Number.isFinite(b.fill) ? b.fill : 0))
    .map(fillLine)
    .filter(Boolean);
  if (o.fillsComplete === false) fills.push(MEMBER_TEXT.fillsPartial);
  return {
    ...base,
    title: rehearsal ? `${MEMBER_TEXT.rehearsal} ${base.title}` : base.title,
    prices,
    fills,
    frozen: o.frozen === true ? MEMBER_TEXT.frozen : null,
    rehearsal: !!rehearsal,
  };
}

// 회원 상태 → 3-1 상태 모양(feed 필드 + open) — 상태 줄·종목·성적 판단을 그대로 쓴다
export function memberStateView(ms) {
  if (!ms || typeof ms !== 'object') return null;
  const feed = ms.feed && typeof ms.feed === 'object' ? ms.feed : {};
  return { ...feed, ok: ms.ok === true, open: Array.isArray(ms.open) ? ms.open : [] };
}

export function memberBadge(member) {
  if (!member || typeof member !== 'object') return null;
  if (member.test === true) {
    const md = fmtMD(member.testUntil);
    return md ? MEMBER_TEXT.badgeTest(md) : MEMBER_TEXT.badgeTestNoDate;
  }
  return MEMBER_TEXT.badge;
}

// 송출 흐름(번호 내림차순)에 리허설(시각순)을 끼워 넣는다 — 송출끼리의 순서는 그대로
function mergeFlow(a, b) {
  const at = (x) => (typeof x.at === 'number' && Number.isFinite(x.at) ? x.at : -Infinity);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && at(a[i]) >= at(b[j]))) out.push(a[i++]);
    else out.push(b[j++]);
  }
  return out;
}

// 이 기기 따라가기 장부 줄(p34 §4.3) — 열림이면 상태 낱말·평가, 끝났으면 내 결과(가격 없음)
function mineLine(m) {
  if (!m || typeof m !== 'object') return null;
  if (['open', 'opening', 'closing', 'unclear', 'detached'].includes(m.state)) return MEMBER_TEXT.mineOpen(typeof m.word === 'string' ? m.word : null, m.eval);
  if (m.state === 'closed') return MEMBER_TEXT.mineDone(m.resultPct, m.pnl);
  return null;
}

// followLink: 따라가기 화면(#follow)을 열 수 있음(app.js followScreenOk) — 회원 화면에서는 끝난 매매 합계(mineTotal)만 정한다. 옛 '따라가기' 버튼은
// 트레이딩 탭 합침(2026-10-10)으로 없다 — ⚡ 오토 모드 줄의 '설정 ›'이 #follow(인증이 풀린 기기의 정리 길은 공개 화면 autoViewModel의 follow 버튼).
// missed: 따라가기가 실행하지 않은 신호의 흐름 번호(송출 seq 문자열·'r<rseq>')
// mine(p34): 이 기기 장부의 매매 id → { state, word, eval, pnl, resultPct }(엔진 state().mine — 가격 없음), mineTotal: 끝난 매매 USDT 합계(회원 본인 돈 · 이 기기)
// mySettings(2026-10-10): 내 따라가기 설정(follow-view.js mySettingsView — 자격이 있을 때만 auto.js가 넘김). 인증된 기기는 '오렌지엑스 가입하기'를 그리지 않는다
export function memberViewModel({ config = {}, snap = null, trial = null, member = null, followLink = false, missed = null, mine = null, mineTotal = null, mySettings = null } = {}) {
  const fresh = !(snap && snap.loaded === false);
  const ms = fresh && snap && snap.state && typeof snap.state === 'object' ? snap.state : null;
  const view = memberStateView(ms);
  const base = autoViewModel({ config, snap: snap && typeof snap === 'object' ? { ...snap, state: view } : null, trial });
  const open = view ? view.open.filter((o) => o && typeof o === 'object') : [];
  const rehOpen = ms && ms.rehearsal && typeof ms.rehearsal === 'object' && Array.isArray(ms.rehearsal.open)
    ? ms.rehearsal.open.filter((o) => o && typeof o === 'object')
    : [];
  const events = snap && Array.isArray(snap.events) ? snap.events.filter((e) => e && typeof e === 'object' && Number.isInteger(e.seq)) : [];
  const regular = events
    .filter((e) => MEMBER_LIST_KINDS.includes(e.kind))
    .sort((a, b) => b.seq - a.seq)
    .map((e) => ({ seq: e.seq, at: e.at, time: fmtMDHM(e.at), text: memberEventText(e), tone: toneFor(e) }))
    .filter((f) => f.text);
  const atNum = (x) => (typeof x.at === 'number' && Number.isFinite(x.at) ? x.at : 0);
  const rehearsal = (snap && Array.isArray(snap.rehearsal) ? snap.rehearsal : [])
    .filter((e) => e && typeof e === 'object' && Number.isInteger(e.rseq))
    .sort((a, b) => (atNum(b) - atNum(a)) || (b.rseq - a.rseq)) // 시각 내림차순 — 허브 rseq가 다시 1부터여도(member-feed와 같은 기준)
    .map((e) => ({ seq: `r${e.rseq}`, at: e.at, time: fmtMDHM(e.at), text: rehearsalText(e), tone: toneFor(e) }))
    .filter((f) => f.text);
  const withMine = (c) => (c && mine && typeof mine === 'object' && Object.hasOwn(mine, c.id) && mineLine(mine[c.id]) ? { ...c, mine: mineLine(mine[c.id]) } : c);
  return {
    ...base,
    badge: memberBadge(member),
    memberNote: null,
    cards: [...open.map((o) => memberCard(o)), ...rehOpen.map((o) => memberCard(o, { rehearsal: true }))].filter(Boolean).map(withMine),
    priceNote: MEMBER_TEXT.priceNote,
    verify: null,
    signup: null, // 이 기기는 이미 UID 인증됨 — 가입 안내를 다시 보이지 않는다(2026-10-10)
    mySettings: mySettings && typeof mySettings === 'object' && Array.isArray(mySettings.rows) ? mySettings : null,
    follow: null, // ⚡ 오토 모드 줄의 '설정 ›'(screens/trade-follow.js)이 대신한다
    mineTotal: followLink && typeof mineTotal === 'number' && Number.isFinite(mineTotal) ? MEMBER_TEXT.mineTotal(mineTotal) : null,
    flow: mergeFlow(regular, rehearsal).map((f) => ({
      seq: f.seq, time: f.time, text: missed && missed.has(String(f.seq)) ? `${f.text} · ${MEMBER_TEXT.missed}` : f.text, tone: f.tone,
    })),
  };
}
