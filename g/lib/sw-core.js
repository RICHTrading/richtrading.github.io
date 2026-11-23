// 서비스 워커 판단 규칙 — node에서 검사하고, tools/build.mjs가 export를 떼어 판마다 sw.js 앞에 붙인다.
// 판(공용 / · 담당자판 /s/·/j/)은 같은 출처라 캐시 저장소를 같이 쓴다 → 캐시 이름에 판을 넣고 자기 판 것만 정리한다(설계 3-1 §12)
export const CACHE_PREFIX = 'ptf-';
const LEGACY_CACHE = /^ptf-\d/; // 판 나누기 전(1단계) 공용판 캐시 이름 ptf-<날짜 버전>

export function cachePrefix(edition) {
  return `${CACHE_PREFIX}${edition}-`;
}

export function cacheName(edition, version) {
  return `${cachePrefix(edition)}${version}`;
}

// bypassPaths: 공용판 SW(범위 '/')만 ['/s/', '/j/'] — 그 아래 요청은 각 판 SW와 네트워크에 맡긴다
export function strategyFor({ url, method, mode }, origin, bypassPaths = []) {
  if (method !== 'GET') return 'bypass';
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'bypass';
  }
  if (u.origin !== origin) return 'bypass'; // 허브·거래소·시세는 손대지 않는다(실시간 연결·키가 붙은 요청)
  if (bypassPaths.some((p) => u.pathname.startsWith(p) || u.pathname === p.replace(/\/$/, ''))) return 'bypass';
  // 화면 이동(앱)은 지금 버전 캐시 먼저 — 새 HTML이 옛 JS·CSS와 섞이지 않게. 사무실은 다른 출처라 위에서 이미 bypass(설계 3-2 §4.2).
  // 새 버전은 sw.js가 바뀌면 설치·대기 → 사용자가 '적용'을 눌러야 넘어간다(오프라인에서도 바로 뜬다)
  if (mode === 'navigate') return 'navigate';
  return 'cache-first'; // 버전별 캐시 — 새 버전은 새 sw.js가 통째로 다시 받는다
}

export function staleCaches(keys, edition, version) {
  const mine = cachePrefix(edition);
  const current = cacheName(edition, version);
  return keys.filter((k) => k !== current && (k.startsWith(mine) || (edition === 'pub' && LEGACY_CACHE.test(k))));
}

// 주문 알림 푸시(설계 2026-10-23 §5) — 허브가 보낸 본문 { v:1, title, body, tag }(암호는 브라우저가 풂). 꼴이 틀리거나 비면 기본 문구로
// (푸시를 받고도 알림을 띄우지 않으면 브라우저가 구독을 막을 수 있음). 알림을 누르면 트레이딩 탭(#trade)
export const PUSH_DEFAULT = Object.freeze({ title: '오토 모드', body: '새 주문 알림이 있습니다' });
const PUSH_TAG_RE = /^ptf-[A-Za-z0-9-]{1,40}$/;
const shortText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
export function pushNote(text) {
  let j = null;
  try {
    j = typeof text === 'string' && text.length <= 4096 ? JSON.parse(text) : null;
  } catch {
    j = null;
  }
  const ok = !!j && typeof j === 'object' && j.v === 1;
  const title = ok && shortText(j.title, 40) ? j.title : PUSH_DEFAULT.title;
  const body = ok && shortText(j.body, 120) ? j.body : PUSH_DEFAULT.body;
  const options = { body, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { hash: '#trade' } };
  if (ok && typeof j.tag === 'string' && PUSH_TAG_RE.test(j.tag)) {
    options.tag = j.tag;
    options.renotify = true;
  }
  return { title, options };
}

// 알림을 눌렀을 때 쓸 창 — 이 SW 범위 안이고 다른 판 경로(bypass — 공용판 SW의 /s/·/j/)가 아닌 첫 창의 차례 | -1
export function pickClient(urls, scope, bypassPaths = []) {
  let base;
  try {
    base = new URL(scope);
  } catch {
    return -1;
  }
  return urls.findIndex((u) => {
    let x;
    try {
      x = new URL(u);
    } catch {
      return false;
    }
    return x.origin === base.origin && x.pathname.startsWith(base.pathname) && !bypassPaths.some((p) => x.pathname.startsWith(p));
  });
}

// 미리 받을 파일 = 앱 루트 + 판 출력의 파일(sw.js·.nojekyll·PDF 제외). 사무실(office/)은 다른 출처라 넣지 않는다 —
// 출력에 없는 주소가 하나라도 있으면 install의 cache.addAll이 실패해 새 버전이 영영 설치되지 않는다
export function precacheList(files) {
  const skip = (f) => f === 'sw.js' || f === '.nojekyll' || f.endsWith('.pdf');
  return ['./', ...files.filter((f) => !skip(f)).map((f) => `./${f}`)];
}
