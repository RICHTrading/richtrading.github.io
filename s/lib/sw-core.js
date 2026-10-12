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

// 미리 받을 파일 = 앱 루트 + 판 출력의 파일(sw.js·.nojekyll·PDF 제외). 사무실(office/)은 다른 출처라 넣지 않는다 —
// 출력에 없는 주소가 하나라도 있으면 install의 cache.addAll이 실패해 새 버전이 영영 설치되지 않는다
export function precacheList(files) {
  const skip = (f) => f === 'sw.js' || f === '.nojekyll' || f.endsWith('.pdf');
  return ['./', ...files.filter((f) => !skip(f)).map((f) => `./${f}`)];
}
