// localStorage는 사생활 보호 모드·쿠키 차단에서 접근만 해도 던질 수 있다 — 화면이 멈추지 않게 감싼다.
// storage를 생략하면 localStorage, null이면 '저장소 없음'
function pick(storage) {
  return storage === undefined ? globalThis.localStorage : storage;
}

export function safeGet(key, fallback = null, storage) {
  try {
    const s = pick(storage);
    if (!s) return fallback;
    const v = s.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function safeSet(key, value, storage) {
  try {
    const s = pick(storage);
    if (!s) return false;
    s.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}
