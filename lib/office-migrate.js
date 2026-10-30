// 옛 같은 출처 사무실 캐시 지우기(설계 3-2 §4.2). 게시된 1단계 공용판 서비스 워커(범위 '/')는 ./office/를 미리 받아 두고 화면을
// 캐시에서 준다 — 그 휴대폰이 '적용'을 누르지 않으면 새 게시본에 office/가 없어도 옛 앱이 캐시의 같은 출처 데모 코드를 계속 띄운다
// (회원 기기의 ptf-<판>-vault와 같은 출처). 새 s·j판 SW는 자기 판 캐시만 정리하므로, 어느 판이든 켤 때 ptf- 캐시의 office/ 항목만
// 지우고 공용판 SW에 새 버전을 확인시킨다. 지운 뒤 옛 앱의 사무실 칸은 네트워크로 가서 404 — 옛 SW는 404를 캐시에 넣지 않는다.
// 강제 skip은 하지 않는다('적용'을 눌러야 넘어가는 규칙). 무엇이 실패해도 앱 부팅은 그대로(throw하지 않음)
import { CACHE_PREFIX } from './sw-core.js';

export const OLD_OFFICE_PATH = /(^|\/)office\//;

export async function purgeSameOriginOffice({
  cacheStorage = globalThis.caches,
  serviceWorker = globalThis.navigator && globalThis.navigator.serviceWorker,
} = {}) {
  let removed = 0;
  try {
    if (cacheStorage && typeof cacheStorage.keys === 'function') {
      for (const name of await cacheStorage.keys()) {
        if (!name.startsWith(CACHE_PREFIX)) continue;
        const cache = await cacheStorage.open(name);
        for (const req of await cache.keys()) {
          let p = '';
          try {
            p = new URL(req.url).pathname;
          } catch {
            continue;
          }
          if (OLD_OFFICE_PATH.test(p) && (await cache.delete(req))) removed += 1;
        }
      }
    }
  } catch {
    // 저장소가 막힘 — 이번에는 건너뛴다
  }
  try {
    if (serviceWorker && typeof serviceWorker.getRegistration === 'function') {
      const reg = await serviceWorker.getRegistration('/');
      if (reg && typeof reg.update === 'function') await reg.update();
    }
  } catch {
    // 오프라인 등 — 다음에 켤 때 다시
  }
  return removed;
}
