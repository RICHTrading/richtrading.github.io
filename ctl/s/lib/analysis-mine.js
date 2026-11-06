// 롱·숏 둘 다(설계 2026-11-03 §2-d '셸 고침' — 계획 Task 8): both 칸 종목(최신 분석 latest의 splitSymbols)의 '내 판' 받기와 셸 메모리 캐시.
// 허브 POST /v1/analysis/mine(load — app.js가 열쇠를 정한다: 활성화 회원은 회원 열쇠, 아니면 이 기기 요청 구분 값)으로 종목마다 판 하나를 받아
// 이 모듈의 메모리에만 둔다(기기 저장·사무실 iframe·주소·기록에 없음). 허브는 같은 열쇠면 그 칸 안 언제 물어도 같은 판을 준다 —
//   · mine 답은 min(칸 끝 end, 받은 시각 + 60초)까지 다시 묻지 않는다(end 전에는 새 칸이 생기지 않지만, 폰 시계가 늦거나 칸이 중간에 끝나고
//     같은 5분 안에 다시 생기는 경우를 60초로 줄인다). end부터는 다시(허브는 grace 동안 같은 판 또는 새 칸)
//   · single·none 답은 30초, 받기 실패는 10초 뒤에(want), 429는 60초 쉰다(허브 IP 분당 30 — 같은 Wi-Fi 기기가 나눠 씀)
//   · 받기가 실패해도 가진 mine 판은 end + 2분(허브 relay.splitGraceSec 기본과 같은 창)까지 그대로 보인다(fresh 물음 — 요청 결과는 예외)
//   · fresh 물음(요청 결과)은 진행 중인 일반 받기에 합류하지 않고 새로 묻는다. 캐시는 늦게 시작한 받기의 답만 남긴다(늦게 끝난 옛 받기가 덮지 않음)
//   · 인증이 바뀌면(reset) 열쇠가 바뀌므로 판·id·받는 중 결과를 모두 버린다(rekeyMine은 받기 값의 공유 종목 판도 뺀다).
//     latest splitSymbols에서 빠진 종목(칸이 하나짜리 런에 끝남·비우기·꺼짐)은 keepOnly가 지운다
// id → 판(최근 10개): 진입 참고가 카드(사무실 ptf:open-trade의 id)가 판 id(공개 item은 404)로 찾는다. 판을 고치지 않고 그대로 돌려준다
import { parseMineResp } from './analysis-shape.js';

export const MINE_TTL_MS = 30000;
export const MINE_RETRY_MS = 10000;
export const MINE_RATE_MS = 60000;
export const MINE_KEEP_MS = 120000;
export const MINE_IDS_MAX = 10;
export const MINE_MAX_MS = 60000;

// 열쇠가 바뀜(저장된 인증을 불러옴·활성화·해제·다른 회원 — app.js mineReset): 캐시를 버리고, 받기 값(analysis-feed)의 공유 종목(BTC) 내 판을
// 바로 뺀 뒤(새 사무실 준비·판정 상자가 옛 열쇠의 판을 읽지 않게 — 알림까지), both 칸 종목이 있으면 최신 분석을 한 번 더(받는 중이면 그 뒤에 —
// 그 받기는 옛 열쇠일 수 있고, 그 mine 답은 reset으로 버려진다)
export function rekeyMine({ mine, feed = null }) {
  mine.reset();
  if (!feed) return;
  if (typeof feed.dropShared === 'function') feed.dropShared();
  const again = () => {
    const v = feed.current();
    if (Array.isArray(v.splitSymbols) && v.splitSymbols.length) feed.refreshSoon(0);
  };
  const p = feed.pending();
  if (p) p.then(again, again);
  else again();
}

// load(symbol, { timeoutMs? }) → { status, body } | null(연결 실패) — app/lib/hub.js postAnalysisMine
export function createAnalysisMine({ load, now = () => Date.now() }) {
  let epoch = 0; // reset마다 +1 — 받는 중이던 옛 열쇠의 답은 버린다
  let seq = 0; // 받기를 시작한 차례 — 캐시는 늦게 시작한 받기의 답만 남김
  const bySym = new Map(); // 종목 → { res, until, seq }
  const inflight = new Map(); // 종목 → 받기 약속
  const retryAt = new Map(); // 종목 → 실패 뒤 다시 받을 수 있는 때(want)
  let blockedUntil = 0; // 429 — 허브 IP 분당 제한(열쇠와 무관 — reset에도 남김)
  const ids = new Map(); // 판 id → 판(넣은 차례 = 최근)

  const fresh = (e, t) => !!e && t < e.until;
  const keepable = (e, t) => !!e && e.res.state === 'mine' && t <= e.res.end + MINE_KEEP_MS;

  function remember(a) {
    ids.delete(a.id);
    ids.set(a.id, a);
    while (ids.size > MINE_IDS_MAX) ids.delete(ids.keys().next().value);
  }

  async function fetchOne(symbol, timeoutMs) {
    const my = epoch;
    const mySeq = ++seq;
    let r = null;
    try {
      r = await load(symbol, Number.isFinite(timeoutMs) ? { timeoutMs } : {});
    } catch {
      r = null;
    }
    if (my !== epoch) return null; // 그사이 인증이 바뀜 — 옛 열쇠의 판
    const t = now();
    let res = r && r.status === 200 ? parseMineResp(r.body) : null;
    if (res && res.state === 'mine' && res.analysis.symbol !== symbol) res = null; // 물은 종목과 다른 판은 버림
    if (!res) {
      if (r && r.status === 429) blockedUntil = t + MINE_RATE_MS;
      retryAt.set(symbol, t + MINE_RETRY_MS);
      return null;
    }
    retryAt.delete(symbol);
    const prev = bySym.get(symbol);
    if (prev && prev.seq > mySeq) return res; // 늦게 시작한 받기가 이미 답함 — 캐시·id는 그 답 그대로(부른 쪽에는 자기 답)
    bySym.set(symbol, { res, seq: mySeq, until: res.state === 'mine' && res.end > t ? Math.min(res.end, t + MINE_MAX_MS) : t + MINE_TTL_MS });
    if (res.state === 'mine') remember(res.analysis);
    return res;
  }

  // 판 하나 → { state:'mine', end, analysis } | { state:'single' } | { state:'none' } | null(받지 못함).
  // fresh = 캐시를 쓰지 않고, 진행 중인 받기에도 합류하지 않고 새로 묻는다(요청 분석 결과 — 막 끝난 런의 칸 — 진행 중 일반 받기는 그 앞에 시작해
  // 앞 칸 판일 수 있음), 그때는 받기가 실패해도 옛 판으로 대신하지 않는다. 일반 물음은 진행 중인 가장 늦은 받기(fresh 포함)에 합류
  function get(symbol, { timeoutMs = null, fresh: force = false } = {}) {
    const t = now();
    const e = bySym.get(symbol);
    if (!force && fresh(e, t)) return Promise.resolve(e.res);
    if (t < blockedUntil) return Promise.resolve(!force && keepable(e, t) ? e.res : null);
    let p = force ? null : inflight.get(symbol);
    if (!p) {
      const q = fetchOne(symbol, timeoutMs);
      p = q.finally(() => { if (inflight.get(symbol) === p) inflight.delete(symbol); });
      inflight.set(symbol, p);
    }
    return p.then((res) => {
      if (res || force) return res;
      const e2 = bySym.get(symbol);
      return keepable(e2, now()) ? e2.res : null;
    });
  }

  return {
    get,
    // 지금 가진 값(받지 않음) — 살아 있는 답, 또는 end + 2분 안의 mine 판
    peek(symbol) {
      const t = now();
      const e = bySym.get(symbol);
      return fresh(e, t) || keepable(e, t) ? e.res : null;
    },
    // 없거나 지난 값이면 뒤에서 한 번 받고 끝나면 onDone() — 살아 있는 값·받는 중·실패 뒤 10초·429 쉼이면 받지 않는다(false)
    want(symbol, onDone) {
      const t = now();
      if (fresh(bySym.get(symbol), t) || inflight.has(symbol) || t < blockedUntil || t < (retryAt.get(symbol) || 0)) return false;
      get(symbol).then(() => {
        try {
          if (typeof onDone === 'function') onDone();
        } catch {
          // 다시 그리기 오류는 받기와 무관
        }
      });
      return true;
    },
    item: (id) => (typeof id === 'string' && ids.has(id) ? ids.get(id) : null),
    keepOnly(symbols) {
      const keep = new Set(Array.isArray(symbols) ? symbols : []);
      for (const s of [...bySym.keys()]) if (!keep.has(s)) bySym.delete(s);
      for (const s of [...retryAt.keys()]) if (!keep.has(s)) retryAt.delete(s);
    },
    reset() {
      epoch += 1;
      bySym.clear();
      inflight.clear();
      retryAt.clear();
      ids.clear();
    },
  };
}
