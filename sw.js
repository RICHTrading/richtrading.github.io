// 자동 생성 — tools/build.mjs (원본: app/lib/sw-core.js + app/sw-main.js)
const VERSION = "20261030-2143";
const EDITION = "pub";
const BYPASS = ["/s/","/j/"];
const ASSETS = ["./","./app.css","./app.js","./config.js","./fonts/Galmuri11.woff2","./fonts/LICENSE-Galmuri.txt","./fonts/LICENSE-Pretendard.txt","./fonts/PretendardVariable.woff2","./guide/ox-deposit-pages/1.webp","./guide/ox-deposit-pages/2.webp","./guide/ox-deposit-pages/3.webp","./guide/ox-deposit-pages/pages.json","./help/position-mode-m1.webp","./help/position-mode-m2.webp","./help/position-mode-m3.webp","./help/position-mode-m4.webp","./help/position-mode.webp","./icons/apple-touch-icon-180.png","./icons/badge-96.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512-maskable.png","./icons/icon-512.png","./index.html","./install/guide.json","./lib/analysis-feed.js","./lib/analysis-live.js","./lib/analysis-request.js","./lib/analysis-shape.js","./lib/api-guide-text.js","./lib/auto-feed.js","./lib/auto-run-view.js","./lib/auto-sl-orders.js","./lib/auto-sl-switch.js","./lib/auto-sl.js","./lib/auto-view.js","./lib/canon-json.js","./lib/chart-draw.js","./lib/chart-feed.js","./lib/chart-markers.js","./lib/chart-my-trades.js","./lib/chart-position-overlay.js","./lib/chart-ticker.js","./lib/clean-text.js","./lib/cmd-key.js","./lib/dca-ind.js","./lib/dca-rules.js","./lib/entry-ref.js","./lib/env.js","./lib/escape.js","./lib/events-feed.js","./lib/follow-autosl.js","./lib/follow-core.js","./lib/follow-engine.js","./lib/follow-exec.js","./lib/follow-lease.js","./lib/follow-math.js","./lib/follow-rules.js","./lib/follow-settings.js","./lib/follow-store.js","./lib/follow-text.js","./lib/follow-upkeep.js","./lib/follow-view.js","./lib/hedge-text.js","./lib/hub.js","./lib/ind/big-sales.js","./lib/ind/delta.js","./lib/ind/follow-line.js","./lib/ind/pine.js","./lib/ind/tpsl-guide.js","./lib/ind/vp-box.js","./lib/indicators.js","./lib/install-plan.js","./lib/keys.js","./lib/known-orders.js","./lib/layout.js","./lib/manual-exec.js","./lib/manual-math.js","./lib/manual-quote.js","./lib/manual-store.js","./lib/member-control.js","./lib/member-feed.js","./lib/member.js","./lib/office-analysis.js","./lib/office-gains.js","./lib/office-migrate.js","./lib/office-relay.js","./lib/office-shell.js","./lib/office-trial.js","./lib/ox-bars.js","./lib/ox-client.js","./lib/ox-errors.js","./lib/ox-ws.js","./lib/push-client.js","./lib/router.js","./lib/server-cmd-flow.js","./lib/server-enroll.js","./lib/server-exec.js","./lib/server-manual.js","./lib/signal-results-view.js","./lib/sl-watch.js","./lib/sse-reader.js","./lib/store.js","./lib/strip-balance.js","./lib/sw-client.js","./lib/sw-core.js","./lib/symbol-queue.js","./lib/tour-text.js","./lib/tour.js","./lib/trade-evidence.js","./lib/trade-rules.js","./lib/trade-view.js","./lib/trade-wiring.js","./lib/trial.js","./lib/vault.js","./manifest.webmanifest","./modes/auto.js","./modes/office.js","./modes/soon.js","./modes/trade-orders.js","./modes/trade-server-orders.js","./modes/trade.js","./screens/api-guide.js","./screens/app-guide.js","./screens/auto-run.js","./screens/events.js","./screens/follow-sheet.js","./screens/follow.js","./screens/guide-view.js","./screens/hedge-guide.js","./screens/install-controller.js","./screens/install.js","./screens/keys.js","./screens/push-row.js","./screens/server-enroll.js","./screens/settings.js","./screens/strip.js","./screens/tour.js","./screens/trade-evidence.js","./screens/trade-follow.js","./screens/trade-history.js","./screens/trade-sheet.js","./screens/trade-verdict.js","./screens/verify.js","./tour/faces/ace.png","./tour/faces/bear.png","./tour/faces/blitz.png","./tour/faces/bull.png","./tour/faces/diana.png","./tour/faces/guard.png","./tour/faces/neutral.png","./tour/faces/nova.png","./tour/faces/pm.png","./tour/faces/risky.png","./tour/faces/safe.png","./tour/faces/taro.png","./tour/faces/vibe.png","./tour/home-android.webp","./tour/home-ios.webp","./tour/verdict-board.webp","./vendor/LICENSE.lightweight-charts","./vendor/NOTICE.lightweight-charts","./vendor/lightweight-charts.standalone.production.js"];
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

// 주문 알림 푸시(설계 2026-10-23 §5) — 허브가 보낸 본문 { v:1, title, body, tag }(암호는 브라우저가 풂). 꼴이 틀리거나 비면 기본 문구로
// (푸시를 받고도 알림을 띄우지 않으면 브라우저가 구독을 막을 수 있음). 알림을 누르면 트레이딩 탭(#trade)
const PUSH_DEFAULT = Object.freeze({ title: '오토 모드', body: '새 주문 알림이 있습니다' });
const PUSH_TAG_RE = /^ptf-[A-Za-z0-9-]{1,40}$/;
const shortText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
function pushNote(text) {
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
function pickClient(urls, scope, bypassPaths = []) {
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
function precacheList(files) {
  const skip = (f) => f === 'sw.js' || f === '.nojekyll' || f.endsWith('.pdf');
  return ['./', ...files.filter((f) => !skip(f)).map((f) => `./${f}`)];
}

/* global VERSION, EDITION, BYPASS, ASSETS, cacheName, strategyFor, staleCaches, pushNote, pickClient */
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

// 주문 알림(설계 2026-10-23 §5): 허브 → 푸시 서비스 → 여기. 앱이 꺼져 있어도 알림을 띄운다(본문 꼴이 틀리면 기본 문구)
self.addEventListener('push', (event) => {
  let text = null;
  try {
    text = event.data ? event.data.text() : null;
  } catch {
    text = null;
  }
  const n = pushNote(text);
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

// 알림을 누르면 이 판 창을 앞으로 + 트레이딩 탭(앱이 ptf:open-trade를 받아 #trade로), 창이 없으면 새로 연다
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const i = pickClient(list.map((c) => c.url), scope, BYPASS);
    if (i >= 0) {
      const c = list[i];
      try {
        c.postMessage({ type: 'ptf:open-trade' });
      } catch {
        // 메시지를 못 받아도 창은 앞으로
      }
      return c.focus();
    }
    return self.clients.openWindow(new URL('./#trade', scope).href);
  })());
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
