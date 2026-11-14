// 거래소 이벤트(p34 §5 — 대표 결정 2026-10-08-3 "동업자꺼랑 같이 이벤트 표시도") — 허브 GET /v1/events(토큰 없음, 동업자판 /api/events를
// 화이트리스트로 옮긴 것)를 받아 상단 띠 칩·창(screens/events.js)에 넘긴다. 운영자 계정 진행 상황(동업자 me)은 허브가 버려 여기 없다(§5.5).
// 받기: 켤 때 한 번 + 앱이 화면에 있을 때 3분마다(동업자 화면과 같음) + 다시 보일 때 한 번. 실패는 앞 값을 그대로 둔다(알림 없음) —
// 단 마지막 성공 받기가 6시간(EVENTS_STALE_MS)을 넘으면 칩·창을 지운다(p35 D-1 — 허브가 꺼진 채 하루 넘게 켠 휴대폰에 옛 이벤트가 남지 않게).
// 응답의 updated가 72시간(EVENTS_MAX_AGE_MS — 허브 events.maxAgeHours와 같은 값)을 넘으면 칩 없음(screens/events.js, 받는 쪽도).
// 화면 글: 허브가 먼저 거르고 앱이 한 번 더 — 레퍼럴류·'대표'·가입 링크(affiliates·/b/·ref=…)·그 판 가입 코드가 든 줄은 빼고,
// 연결·연락처는 지운다 — note·footer·표 값·과제 이름은 연결이 있던 문장을 통째로(p35 §4.5), 제목·칩은 연결만.
// '수수료'는 원문 그대로(p35 §4 — 열린 질문 16 ①). hubUrl은 https 오렌지엑스 주소만(쿼리·# 지움)
import { BANNED_RE, cleanText, dropLinkSentences } from './clean-text.js';

export const EVENTS_POLL_MS = 180000;
export const EVENTS_STALE_MS = 6 * 3600000;
export const EVENTS_MAX_AGE_MS = 72 * 3600000;
export const EVENTS_FIELDS = Object.freeze(['up', 'off', 'updated', 'events']);
export const EVENT_BODY_KEYS = Object.freeze(['boost', 'deposit', 'volume', 'tasks', 'windowDays', 'footer', 'hubUrl']);
export const EVENT_LIMITS = Object.freeze({ title: 60, chip: 40, rowName: 30, rowValue: 160, rows: 8, note: 300, tiers: 10, taskName: 60, tasks: 10, footer: 300, hubUrl: 300, amount: 1e9 });

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
const amount = (v) => (Number.isInteger(v) && v >= 0 && v <= EVENT_LIMITS.amount ? v : null);

function tiers(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => Array.isArray(t) && amount(t[0]) != null && amount(t[1]) != null)
    .map((t) => [t[0], t[1]])
    .slice(0, EVENT_LIMITS.tiers);
}

function shapeBoost(b) {
  if (!isObj(b)) return null;
  const title = str(b.title, EVENT_LIMITS.title);
  if (!title) return null;
  const rows = (Array.isArray(b.rows) ? b.rows : [])
    .filter((r) => Array.isArray(r) && str(r[0], EVENT_LIMITS.rowName) != null && str(r[1], EVENT_LIMITS.rowValue) != null)
    .map((r) => [r[0], r[1]])
    .slice(0, EVENT_LIMITS.rows);
  return { title, chip: str(b.chip, EVENT_LIMITS.chip) || '', rows, note: str(b.note, EVENT_LIMITS.note) || '' };
}

const isEmpty = (e) => !e.boost && !e.deposit.length && !e.volume.length && !e.tasks.length;

// GET /v1/events 본문 → { up, off, updated, events: Events|null } | null(모양이 틀리면 — 받는 쪽은 앞 값 유지)
export function parseEvents(body) {
  if (!isObj(body) || body.ok !== true || body.v !== 1) return null;
  let events = null;
  const e = body.events;
  if (isObj(e)) {
    events = {
      boost: shapeBoost(e.boost),
      deposit: tiers(e.deposit),
      volume: tiers(e.volume),
      tasks: (Array.isArray(e.tasks) ? e.tasks : [])
        .filter((t) => Array.isArray(t) && str(t[0], EVENT_LIMITS.taskName) && amount(t[1]) != null)
        .map((t) => [t[0], t[1]])
        .slice(0, EVENT_LIMITS.tasks),
      windowDays: Number.isInteger(e.windowDays) && e.windowDays >= 1 && e.windowDays <= 365 ? e.windowDays : null,
      footer: str(e.footer, EVENT_LIMITS.footer) || '',
      hubUrl: str(e.hubUrl, EVENT_LIMITS.hubUrl),
    };
    if (isEmpty(events)) events = null;
  }
  const up = typeof body.updated === 'number' && Number.isFinite(body.updated) && body.updated > 0 ? body.updated : null;
  return { up: body.up === true, off: body.off === true, updated: up, events };
}

// 그 판 가입 코드(signupUrl 마지막 경로 조각) — 화면 글·링크에 있으면 그 줄을 뺀다(가입 코드는 인증 화면의 그 판 줄에만, §6.5).
// 다른 판 코드는 앱이 모른다(config.js에 다른 판 코드를 넣지 않음) — 허브가 모든 판 코드를 걸러 준다(§5.1·§5.2)
function ownCode(config) {
  try {
    const parts = new URL(config.signupUrl).pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

// 가입·추천 링크 꼴(호스트 affiliates·경로 /affiliates/·/b/·/invite·/register·/signup·쿼리 ref·code·invite·referral·aff).
// uid 쿼리는 버리지 않고 지운다(설계 §5.1 시험 예 '?uid=123#a → 쿼리·# 지움' — 계정 값이 붙어 와도 나가지 않게)
const SIGNUP_LINK_RE = /affiliates|\/b\/|[?&](ref|code|invite|inviteCode|referral|aff)=|\/(register|signup|invite)\b/i;

// hubUrl(거래소에서 받기) — https 오렌지엑스 주소만, 가입·추천 꼴·그 판 코드면 null, 쿼리·#은 지움(허브가 먼저 같은 검사 + 허용 접두)
export function safeHubUrl(raw, config) {
  if (typeof raw !== 'string' || raw.length > EVENT_LIMITS.hubUrl) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!(host === 'orangex.com' || host.endsWith('.orangex.com')) || host.startsWith('affiliates.')) return null;
  if (SIGNUP_LINK_RE.test(`${u.pathname}${u.search}`)) return null;
  const code = ownCode(config);
  if (code && raw.includes(code)) return null;
  return `${u.origin}${u.pathname}`;
}

// 한 줄(표 한 줄·과제·제목·note·footer) 거르기 — 빼야 하면 null.
// sentences: 연결·연락처가 있던 문장을 통째로 뺀다(note·footer·표 값·과제 이름 — §4.5). 아니면 연결만 지운다(제목·칩·표 이름)
function line(raw, code, { sentences = false } = {}) {
  if (typeof raw !== 'string') return null;
  if (BANNED_RE.test(raw) || /대표/.test(raw) || SIGNUP_LINK_RE.test(raw) || (code && raw.includes(code))) return null;
  const t = (sentences ? dropLinkSentences(raw) : cleanText(raw)).replace(/ {2,}/g, ' ');
  return t || null;
}
const sentence = (raw, code) => line(raw, code, { sentences: true });

// 화면에 그릴 이벤트(Events → 거른 Events, 모두 빠지면 null)
export function eventsView(events, config) {
  if (!isObj(events)) return null;
  const code = ownCode(config);
  let boost = null;
  if (events.boost) {
    const title = line(events.boost.title, code);
    if (title) {
      const rows = events.boost.rows
        .map((r) => (line(`${r[0]} ${r[1]}`, code) ? [line(r[0], code), sentence(r[1], code)] : null))
        .filter((r) => r && r[0] && r[1]);
      boost = { title, chip: line(events.boost.chip, code) || '', rows, note: sentence(events.boost.note, code) || '' };
    }
  }
  const tasks = events.tasks.map((t) => [sentence(t[0], code), t[1]]).filter((t) => t[0]);
  const out = {
    boost,
    deposit: events.deposit.slice(),
    volume: events.volume.slice(),
    tasks,
    windowDays: events.windowDays,
    footer: sentence(events.footer, code) || '',
    hubUrl: safeHubUrl(events.hubUrl, config),
  };
  return isEmpty(out) ? null : out;
}

// 마지막 성공 받기가 오래돼 지울 때 보내는 값 — 칩·창 지움(오류 문구 없음)
export const EVENTS_GONE = Object.freeze({ up: false, off: false, updated: null, events: null });

export function createEventsFeed({ load, timers = globalThis, now = () => Date.now(), onChange = () => {} }) {
  let visible = true;
  let timer = null;
  let inflight = null;
  let lastOkAt = null; // 마지막 성공 받기 시각(이 기기 시계)
  let gone = false; // 오래돼 이미 지웠나(한 번만 알림)

  function tell(r) {
    try {
      onChange(r);
    } catch {
      // 그리는 쪽 오류가 다음 받기를 막지 않게
    }
  }

  // 마지막 성공이 6시간 넘었으면 칩·창을 지운다(한 번만)
  function checkStale() {
    if (gone || lastOkAt == null || now() - lastOkAt <= EVENTS_STALE_MS) return;
    gone = true;
    tell({ ...EVENTS_GONE });
  }

  function refresh() {
    if (inflight) return inflight;
    checkStale();
    inflight = (async () => {
      let r = null;
      try {
        r = await load();
      } catch {
        r = null;
      }
      inflight = null;
      if (r) {
        lastOkAt = now();
        gone = false;
        tell(r);
      } else {
        checkStale();
      }
      return r;
    })();
    return inflight;
  }

  function sync() {
    if (visible && timer == null) timer = timers.setInterval(refresh, EVENTS_POLL_MS);
    else if (!visible && timer != null) {
      timers.clearInterval(timer);
      timer = null;
    }
  }

  return {
    start() {
      sync();
      refresh();
    },
    setVisible(v) {
      const was = visible;
      visible = !!v;
      sync();
      if (visible && !was) refresh();
    },
    refresh,
    // 받는 중이면 그 받기, 아니면 null — 첫 실행 안내가 첫 받기를 기다린다(app/lib/tour.js tourDataWait)
    pending: () => inflight,
  };
}
