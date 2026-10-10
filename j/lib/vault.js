// 기기 저장소(설계 3-2 §3.1·§5.3) — IndexedDB `ptf-<판>-vault` v1, 저장소 kv(키-값)·ledger(따라가기 장부, keyPath id).
// 판마다 DB가 따로라 s판 인증이 j판에 보이지 않는다. 공용판은 이 DB를 열지 않는다(vaultName이 거부).
// IndexedDB가 막힌 브라우저(사생활 보호 모드 등)에서는 openVaultOrMemory가 이번 실행 동안만 메모리에 둔다 — 앱을 닫으면 다시 인증.
//   회원 토큰은 그래도 된다. 그러나 따라가기 장부(ledger)·거래소 키(CryptoKey, §5.3)는 메모리에 두면 안 된다 — 앱을 닫으면
//   장부가 사라져 거래소에 남은 포지션을 놓치거나 같은 신호로 두 번 열 수 있다. 키 연결·따라가기 코드는 시작 전에
//   requireDurable(vault)를 불러 kind가 'memory'면 멈춘다(키·따라가기 트랙 계약).
// 거래소 키(kv.ox, 설계 3-2 §5.3 — 2026-10-08 개정)는 비밀 키를 이 기기·이 판의 꺼낼 수 없는 AES-GCM 키(kv.oxSeal)로 암호화한 것만 —
//   saveOxKey·sealKeyFor가 저장한 뒤 다시 읽어 그대로인지 본다(U14). 평문은 어디에도 저장하지 않는다.
export const VAULT_VERSION = 1;
export const VAULT_EDITIONS = Object.freeze(['s', 'j']);

export function vaultName(edition) {
  if (!VAULT_EDITIONS.includes(edition)) throw new Error(`이 판(${String(edition)})은 기기 저장소를 쓰지 않습니다`);
  return `ptf-${edition}-vault`;
}

function wrap(db) {
  // 다른 탭(새 앱 버전)이 v2로 열면 이 연결이 업그레이드를 막지 않게 스스로 닫는다 — 이 탭은 다음 실행에서 다시 연다
  db.onversionchange = () => {
    try {
      db.close();
    } catch {
      // 이미 닫힘
    }
  };
  const run = (store, mode, fn) => new Promise((resolve, reject) => {
    let out;
    try {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error('idb_tx'));
      tx.onabort = () => reject(tx.error || new Error('idb_abort'));
    } catch (e) {
      reject(e);
    }
  });
  // 한 readwrite 거래 안에서 읽고(get) → fn(지금 값) → 쓰기(put, undefined면 delete). fn은 동기(거래가 닫히지 않게).
  // 두 탭이 같이 고쳐도 IndexedDB가 거래를 차례로 돌려 한쪽이 덮지 않는다(p34 kv.autoSl·kv.autoSlOrders — 모르는 칸 보존)
  const update = (key, fn) => new Promise((resolve, reject) => {
    let out;
    try {
      const tx = db.transaction('kv', 'readwrite');
      const s = tx.objectStore('kv');
      const g = s.get(key);
      g.onsuccess = () => {
        try {
          out = fn(g.result);
          if (out === undefined) s.delete(key);
          else s.put(out, key);
        } catch (e) {
          try {
            tx.abort();
          } catch {
            // 이미 끝남
          }
          reject(e);
        }
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error('idb_tx'));
      tx.onabort = () => reject(tx.error || new Error('idb_abort'));
    } catch (e) {
      reject(e);
    }
  });
  return {
    kind: 'idb',
    get: (key) => run('kv', 'readonly', (s) => s.get(key)),
    set: (key, value) => run('kv', 'readwrite', (s) => s.put(value, key)).then(() => true),
    del: (key) => run('kv', 'readwrite', (s) => s.delete(key)).then(() => true),
    update,
    ledgerAll: () => run('ledger', 'readonly', (s) => s.getAll()).then((v) => (Array.isArray(v) ? v : [])),
    // 따라가기 장부(설계 3-2 §6.4) — 매매 하나 = 줄 하나(keyPath id). 쓰기는 follow-store가 requireDurable 뒤에만
    ledgerGet: (id) => run('ledger', 'readonly', (s) => s.get(id)),
    ledgerPut: (trade) => run('ledger', 'readwrite', (s) => s.put(trade)).then(() => true),
    ledgerDel: (id) => run('ledger', 'readwrite', (s) => s.delete(id)).then(() => true),
    close: () => {
      try {
        db.close();
      } catch {
        // 이미 닫힘
      }
    },
  };
}

export async function openVault({ edition, idb = globalThis.indexedDB, timeoutMs = 5000 } = {}) {
  const name = vaultName(edition);
  if (!idb || typeof idb.open !== 'function') throw new Error('no_idb');
  return new Promise((resolve, reject) => {
    let r;
    try {
      r = idb.open(name, VAULT_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => reject(new Error('idb_timeout')), timeoutMs);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('ledger')) db.createObjectStore('ledger', { keyPath: 'id' });
    };
    r.onsuccess = () => {
      clearTimeout(timer);
      resolve(wrap(r.result));
    };
    r.onerror = () => {
      clearTimeout(timer);
      reject(r.error || new Error('idb_open'));
    };
  });
}

export function memoryVault() {
  const kv = new Map();
  return {
    kind: 'memory',
    get: async (k) => (kv.has(k) ? structuredClone(kv.get(k)) : undefined),
    set: async (k, v) => {
      kv.set(k, structuredClone(v));
      return true;
    },
    del: async (k) => {
      kv.delete(k);
      return true;
    },
    update: async (k, fn) => {
      const out = fn(kv.has(k) ? structuredClone(kv.get(k)) : undefined);
      if (out === undefined) kv.delete(k);
      else kv.set(k, structuredClone(out));
      return out;
    },
    ledgerAll: async () => [],
    // 메모리 저장소에는 장부를 두지 않는다(앱을 닫으면 사라져 거래소 포지션을 놓친다 — requireDurable)
    ledgerGet: async () => undefined,
    ledgerPut: async () => {
      throw new Error('memory_vault');
    },
    ledgerDel: async () => true,
    close: () => {},
  };
}

export async function openVaultOrMemory(opts) {
  try {
    return await openVault(opts);
  } catch {
    return memoryVault();
  }
}

// 키 연결·따라가기 트랙 계약 — 장부·CryptoKey를 쓰기 전에 부른다(위 머리 주석)
export function requireDurable(vault) {
  if (!vault || vault.kind !== 'idb') throw new Error('기기 저장소(IndexedDB)를 쓸 수 없어 키 연결·따라가기를 켤 수 없습니다');
  return vault;
}

// ── 거래소 키(설계 3-2 §5.2·§5.3 kv.ox — 2026-10-08 개정: client_credentials 로그인) ──
// 실측(2026-10-08 대표 키): 문서의 client_signature 서명 로그인은 어떤 서명 문자열로도 10000으로 거절되고 client_credentials
// (client_id + client_secret)만 된다 — 그래서 로그인마다 비밀 키 원문이 필요하다. 원문은 저장하지 않고,
// 이 기기·이 판 기기 저장소에 한 번 만든 꺼낼 수 없는 AES-GCM 256 키(kv.oxSeal, extractable:false, ['encrypt','decrypt'])로 암호화한
// { ct, iv }만 kv.ox에 둔다. 풀기(openOxSecret)는 /public/auth 바로 앞에서만(ox-client.js) — 풀린 원문은 보낸 즉시 버린다.
// kv.ox = { clientId, ct, iv, savedAt, scope: [권한 항목], accountUidHash, accountTail } — 정해진 7칸만 골라 저장(원문·토큰·기기 키 칸은 버림).
// 메모리 저장소에는 두지 않는다(requireDurable). 저장한 뒤 다시 읽어 그대로인지 본다 — IndexedDB가 CryptoKey를 못 담는 기기(U14)면 지우고 실패.
// 예전 기록(꺼낼 수 없는 HMAC CryptoKey만, 암호문 없음)은 loadOxKey가 'old' — 키를 다시 넣어 달라고 한다(멈추지 않음).
export const OX_RECORD_FIELDS = Object.freeze(['accountTail', 'accountUidHash', 'clientId', 'ct', 'iv', 'savedAt', 'scope']);
export const OX_SEAL_KV = 'oxSeal';
export const OX_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const sealAad = (clientId) => new TextEncoder().encode(`ptf-ox|${clientId}`);

export function isSealKey(k) {
  return !!k && typeof k === 'object' && Object.prototype.toString.call(k) === '[object CryptoKey]'
    && k.type === 'secret' && k.extractable === false && !!k.algorithm && k.algorithm.name === 'AES-GCM' && k.algorithm.length === 256
    && Array.isArray(k.usages) && k.usages.length === 2 && k.usages.includes('encrypt') && k.usages.includes('decrypt');
}

const isBytes = (b, min, max) => b instanceof Uint8Array && b.length >= min && b.length <= max;

export function validOxRecord(r) {
  return !!r && typeof r === 'object'
    && typeof r.clientId === 'string' && /^\S{1,256}$/.test(r.clientId)
    && isBytes(r.ct, GCM_TAG_BYTES + 1, GCM_TAG_BYTES + 256 * 4)
    && isBytes(r.iv, OX_IV_BYTES, OX_IV_BYTES)
    && typeof r.savedAt === 'number' && Number.isFinite(r.savedAt)
    && Array.isArray(r.scope) && r.scope.length > 0 && r.scope.every((s) => typeof s === 'string')
    && typeof r.accountUidHash === 'string' && /^[0-9a-f]{64}$/.test(r.accountUidHash)
    && typeof r.accountTail === 'string' && r.accountTail.length >= 1 && r.accountTail.length <= 4;
}

// 이 기기·이 판의 봉인 키 — 있으면 그것, 없거나 깨졌으면 새로 만들어 저장하고 다시 읽은 것을 쓴다(두 탭이 동시에 만들어도 저장된 쪽으로)
export async function sealKeyFor(vault, subtle = globalThis.crypto.subtle) {
  requireDurable(vault);
  let k = null;
  try {
    k = await vault.get(OX_SEAL_KV);
  } catch {
    k = null;
  }
  if (isSealKey(k)) return k;
  const fresh = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await vault.set(OX_SEAL_KV, fresh);
  let back;
  try {
    back = await vault.get(OX_SEAL_KV);
  } catch {
    back = null;
  }
  if (!isSealKey(back)) {
    try {
      await vault.del(OX_SEAL_KV);
    } catch {
      // 지우기 실패 — 다음에 다시 만든다
    }
    throw new Error('ox_store');
  }
  return back;
}

// 비밀 키 → { ct, iv }(AES-GCM, 무작위 iv, AAD = 키 id — 다른 키 id의 기록에 옮겨 붙이면 안 풀림)
export async function sealOxSecret({ secret, clientId, sealKey, subtle = globalThis.crypto.subtle, cryptoImpl = globalThis.crypto }) {
  const iv = cryptoImpl.getRandomValues(new Uint8Array(OX_IV_BYTES));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: sealAad(clientId) }, sealKey, new TextEncoder().encode(String(secret))));
  return { ct, iv };
}

// { clientId, ct, iv, sealKey } → 비밀 키 원문. 부른 쪽은 /public/auth에 넣어 보낸 즉시 버린다(모듈 상태에 두지 않음). 실패하면 던진다
export async function openOxSecret({ clientId, ct, iv, sealKey }, subtle = globalThis.crypto.subtle) {
  if (!isSealKey(sealKey) || !(ct instanceof Uint8Array) || !(iv instanceof Uint8Array)) throw new Error('ox_seal');
  return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: sealAad(clientId) }, sealKey, ct));
}

const sameBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);

export async function saveOxKey(vault, rec) {
  requireDurable(vault);
  if (!validOxRecord(rec)) throw new Error('ox_record');
  const clean = {};
  for (const k of OX_RECORD_FIELDS) clean[k] = rec[k];
  await vault.set('ox', clean);
  let back;
  try {
    back = await vault.get('ox');
  } catch {
    back = null;
  }
  if (!validOxRecord(back) || !sameBytes(back.ct, rec.ct) || !sameBytes(back.iv, rec.iv)) {
    try {
      await vault.del('ox');
    } catch {
      // 지우기 실패 — 다음 불러오기가 'lost'로 본다
    }
    throw new Error('ox_store');
  }
  return true;
}

// { rec: { …kv.ox, sealKey } | null, state: 'ok' | 'none' | 'lost' | 'old' }
export async function loadOxKey(vault) {
  if (!vault || vault.kind !== 'idb') return { rec: null, state: 'none' };
  let r;
  let sealKey;
  try {
    r = await vault.get('ox');
    if (r !== undefined && r !== null) sealKey = await vault.get(OX_SEAL_KV);
  } catch {
    return { rec: null, state: 'lost' };
  }
  if (r === undefined || r === null) return { rec: null, state: 'none' };
  if (typeof r === 'object' && Object.hasOwn(r, 'key') && !Object.hasOwn(r, 'ct')) return { rec: null, state: 'old' };
  if (!validOxRecord(r) || !isSealKey(sealKey)) return { rec: null, state: 'lost' };
  const rec = {};
  for (const k of OX_RECORD_FIELDS) rec[k] = r[k];
  rec.sealKey = sealKey;
  return { rec, state: 'ok' };
}

// 연결 해제: 암호문(kv.ox)과 이 판·기기 봉인 키(kv.oxSeal)를 따로 지운다 — 하나만 지워져도 남은 암호문은 풀 수 없다.
// 둘 다 실패해야 비밀 키가 남는다(부른 쪽은 그때 '지웠다'고 하지 않는다). 다음 연결은 sealKeyFor가 새 봉인 키를 만든다
export async function deleteOxKey(vault) {
  const del = async (key) => {
    try {
      await vault.del(key);
      return true;
    } catch {
      return false;
    }
  };
  const ox = await del('ox');
  const seal = await del(OX_SEAL_KV);
  return { ox, seal };
}

// 저장 뒤 '지우지 말아 달라' 요청(§5.2) — 지원 안 하거나 거절해도 그대로 진행
export async function persistStorage(nav = globalThis.navigator) {
  try {
    if (nav && nav.storage && typeof nav.storage.persist === 'function') return (await nav.storage.persist()) === true;
  } catch {
    // 지원 안 함
  }
  return false;
}
