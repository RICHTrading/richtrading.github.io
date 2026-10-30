// 정렬 JSON(설계 2026-10-16 §15.19-6) — exec/lib/wire.js canonicalJson과 같은 바이트를 만드는 브라우저 사본(Node 전용 모듈 없음, import 줄 없음).
// 기기 명령 서명 글(app/lib/cmd-key.js)·설정 지문(follow-settings.js settingsPrint)이 쓴다 — 실행기가 같은 글자로 서명을 확인하고 지문을 다시 잰다.
// 꼴: 객체 키는 기본 sort() 순서, 배열 순서 그대로, 공백 없음, 숫자는 유한수만(JSON.stringify 글자 — -0은 0), 깊이 16까지.
// 그 밖(undefined·함수·NaN·Infinity·Date·Map·빈 칸 배열 등)은 던진다(canon_type·canon_number·canon_depth — wire.js와 같은 낱말). 시험이 두 함수를 같은 견본으로 비교한다.
const MAX_DEPTH = 16;

function isPlainObject(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}

function canon(v, depth) {
  if (depth > MAX_DEPTH) throw new Error('canon_depth');
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('canon_number');
    return JSON.stringify(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${Array.from(v, (x) => canon(x, depth + 1)).join(',')}]`;
  if (isPlainObject(v)) {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k], depth + 1)}`).join(',')}}`;
  }
  throw new Error('canon_type');
}

export function canonJson(value) {
  return canon(value, 0);
}
