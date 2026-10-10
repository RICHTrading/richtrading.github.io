// 자동 생성 — tools/build.mjs (원본: app/lib/sw-core.js + app/sw-main.js)
const VERSION = "20261010-1758";
const EDITION = "j";
const BYPASS = [];
const ASSETS = ["./","./app.css","./app.js","./config.js","./fonts/Galmuri11.woff2","./fonts/LICENSE-Galmuri.txt","./fonts/LICENSE-Pretendard.txt","./fonts/PretendardVariable.woff2","./icons/apple-touch-icon-180.png","./icons/badge-96.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512-maskable.png","./icons/icon-512.png","./index.html","./install/guide.json","./lib/analysis-feed.js","./lib/analysis-live.js","./lib/analysis-request.js","./lib/analysis-shape.js","./lib/auto-feed.js","./lib/auto-sl-orders.js","./lib/auto-sl-switch.js","./lib/auto-sl.js","./lib/auto-view.js","./lib/chart-draw.js","./lib/chart-feed.js","./lib/chart-markers.js","./lib/chart-position-overlay.js","./lib/chart-ticker.js","./lib/clean-text.js","./lib/env.js","./lib/escape.js","./lib/events-feed.js","./lib/follow-autosl.js","./lib/follow-core.js","./lib/follow-engine.js","./lib/follow-exec.js","./lib/follow-lease.js","./lib/follow-math.js","./lib/follow-rules.js","./lib/follow-settings.js","./lib/follow-store.js","./lib/follow-text.js","./lib/follow-upkeep.js","./lib/follow-view.js","./lib/hub.js","./lib/ind/big-sales.js","./lib/ind/delta.js","./lib/ind/follow-line.js","./lib/ind/pine.js","./lib/ind/tpsl-guide.js","./lib/ind/vp-box.js","./lib/indicators.js","./lib/install-plan.js","./lib/keys.js","./lib/manual-exec.js","./lib/manual-math.js","./lib/manual-store.js","./lib/member-control.js","./lib/member-feed.js","./lib/member.js","./lib/office-analysis.js","./lib/office-migrate.js","./lib/office-relay.js","./lib/office-shell.js","./lib/ox-client.js","./lib/ox-ws.js","./lib/router.js","./lib/sse-reader.js","./lib/store.js","./lib/strip-balance.js","./lib/sw-client.js","./lib/sw-core.js","./lib/symbol-queue.js","./lib/tour-text.js","./lib/tour.js","./lib/trade-rules.js","./lib/trade-view.js","./lib/trade-wiring.js","./lib/trial.js","./lib/vault.js","./manifest.webmanifest","./modes/auto.js","./modes/office.js","./modes/soon.js","./modes/trade-orders.js","./modes/trade.js","./screens/app-guide.js","./screens/events.js","./screens/follow-sheet.js","./screens/follow.js","./screens/install-controller.js","./screens/install.js","./screens/keys.js","./screens/settings.js","./screens/strip.js","./screens/tour.js","./screens/trade-follow.js","./screens/trade-sheet.js","./screens/trade-verdict.js","./screens/verify.js","./tour/faces/ace.png","./tour/faces/bear.png","./tour/faces/blitz.png","./tour/faces/bull.png","./tour/faces/diana.png","./tour/faces/guard.png","./tour/faces/neutral.png","./tour/faces/nova.png","./tour/faces/pm.png","./tour/faces/risky.png","./tour/faces/safe.png","./tour/faces/taro.png","./tour/faces/vibe.png","./vendor/LICENSE.lightweight-charts","./vendor/NOTICE.lightweight-charts","./vendor/lightweight-charts.standalone.production.js"];
// 서비스 워커 판단 규칙 — node에서 검사하고, tools/build.mjs가 export를 떼어 판마다 sw.js 앞에 붙인다.
// 판(공용 / · 담당자판 /s/·/j/)은 같은 출처라 캐시 저장소를 같이 쓴다 → 캐시 이름에 판을 넣고 자기 판 것만 정리한다(설계 3-1 §12)
const CACHE_PREFIX = 'ptf-';
const LEGACY_CACHE = /^ptf-\d/; // 판 나누기 전(1단계) 공용판 캐시 이름 ptf-<날짜 버전>

function cachePrefix(edition) {
  return `${CACHE_PREFIX}${edition}-`;
}

function cacheName(edition, version) {
  return `${cachePrefix(edition)}${version}`;
}

// bypassPaths: 공용판 SW(범위 '/')만 ['/s/', '/j/'] — 그 아래 요청은 각 판 SW와 네트워크에 맡긴다
function strategyFor({ url, method, mode }, origin, bypassPaths = []) {
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

function staleCaches(keys, edition, version) {
  const mine = cachePrefix(edition);
  const current = cacheName(edition, version);
  return keys.filter((k) => k !== current && (k.startsWith(mine) || (edition === 'pub' && LEGACY_CACHE.test(k))));
}

// 미리 받을 파일 = 앱 루트 + 판 출력의 파일(sw.js·.nojekyll·PDF 제외). 사무실(office/)은 다른 출처라 넣지 않는다 —
// 출력에 없는 주소가 하나라도 있으면 install의 cache.addAll이 실패해 새 버전이 영영 설치되지 않는다
function precacheList(files) {
  const skip = (f) => f === 'sw.js' || f === '.nojekyll' || f.endsWith('.pdf');
  return ['./', ...files.filter((f) => !skip(f)).map((f) => `./${f}`)];
}

/* global VERSION, EDITION, BYPASS, ASSETS, cacheName, strategyFor, staleCaches */
// 서비스 워커 본체 — tools/build.mjs가 앞에 VERSION·EDITION·BYPASS·ASSETS·sw-core.js 함수를 붙여 판마다 sw.js로 만든다.
// 캐시는 자기 판 이름(ptf-<판>-<버전>)만 쓰고 자기 판 옛 캐시만 지운다 — 같은 출처의 다른 판 캐시는 건드리지 않는다

self.addEventListener('install', (event) => {
  // cache: 'reload' — GitHub Pages가 주는 max-age=600 HTTP 캐시를 건너뛰고 새 파일을 받는다
  event.waitUntil(caches.open(cacheName(EDITION, VERSION)).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(staleCaches(keys, EDITION, VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 새 버전은 사용자가 '적용'을 누를 때만 넘어간다 — 주문 입력 중 화면이 저절로 바뀌지 않게
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const how = strategyFor({ url: req.url, method: req.method, mode: req.mode }, self.location.origin, BYPASS);
  if (how === 'bypass') return;
  event.respondWith(how === 'navigate' ? fromInstalled(req) : cacheFirst(req));
});

// 화면 이동: 지금 버전이 미리 받아 둔 화면을 그대로 준다(주소 뒤 ?… 는 무시하고 찾는다 — 홈 화면 바로가기 등).
// 네트워크의 새 HTML을 옛 JS·CSS와 섞어 주지 않고, 화면 응답을 캐시에 덮어쓰지도 않는다.
// 미리 받지 않은 주소(예: PDF 안내서)만 네트워크로
async function fromInstalled(req) {
  const cache = await caches.open(cacheName(EDITION, VERSION));
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(req);
  } catch {
    return Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(cacheName(EDITION, VERSION));
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
