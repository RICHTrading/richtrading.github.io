// 서버 자동 등록 묶음 잠그기(휴대폰 — 서버 자동 spec §5.2-3, 계획 5.8·5.14). 키 화면에 연결해 둔 키(clientId·비밀 키 — 대표 결정 7,
// server-exec.js sealConnectedKey가 kv.ox를 풀어 넘김)와 설정을 실행기 공개키로 잠가 허브에 보낸다 — 허브는 내용을 못 본 채 중계만(새 규칙 1 개정).
// 비밀 키 원문은 이 함수 안에서만 쓰고 저장하지 않는다(휴대폰 vault에는 원래의 kv.ox 암호문뿐).
// 방식: 임시 ECDH P-256 키쌍 → deriveBits(실행기 공개키, 256) → HKDF-SHA256(salt = 임시 공개키 raw 65바이트, info 'ptf-exec-enroll-v1')
//   → AES-GCM-256(iv 12바이트, AAD 'ptf-exec-enroll-v1|<fp>'). 문자열 v1.<fp>.<임시 공개키 b64u 87자>.<iv b64u 16자>.<암호문+태그 b64u>.
// 실행기 공개키는 앱 빌드 config.exec = { pubKey(raw 65바이트 b64u 87자), fp(sha256(raw) 16진 앞 16자) } — 지문이 맞지 않으면 잠그지 않는다.
// 브라우저 모듈(WebCrypto·btoa/atob만 — Buffer 없음). 같은 식을 exec/lib/enroll.js가 푼다(ENROLL_INFO·BLOB_RE는 wire.js와 같음 — 시험이 비교).
export const ENROLL_INFO = 'ptf-exec-enroll-v1';
export const BLOB_RE = /^v1\.([0-9a-f]{16})\.([A-Za-z0-9_-]{87})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{40,5400})$/;
export const ENROLL_CLIENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const ENROLL_SYMBOLS = Object.freeze(['BTC']);
const PUB_RE = /^[A-Za-z0-9_-]{87}$/;

export function b64u(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(text) {
  const t = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const utf8 = (s) => new TextEncoder().encode(s);

// 실행기 공개키(raw 65바이트 b64u) 지문 = sha256(raw) 16진 앞 16자
export async function execKeyFp(pubKey, subtle = globalThis.crypto.subtle) {
  if (typeof pubKey !== 'string' || !PUB_RE.test(pubKey)) throw new Error('exec_key');
  const raw = fromB64u(pubKey);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('exec_key');
  return hex(await subtle.digest('SHA-256', raw)).slice(0, 16);
}

// 등록 설정(spec §5.2-3): 한 매매 최대 증거금 1~100(잔고 대비 %)·동시 매매 1~10·자동 손절 켜짐/꺼짐·대상 종목(BTC)
export function validEnrollSettings(s) {
  return !!s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).sort().join(',') === 'autoSl,maxConcurrent,maxMarginPct,symbols'
    && typeof s.maxMarginPct === 'number' && Number.isFinite(s.maxMarginPct) && s.maxMarginPct >= 1 && s.maxMarginPct <= 100
    && Number.isInteger(s.maxConcurrent) && s.maxConcurrent >= 1 && s.maxConcurrent <= 10
    && typeof s.autoSl === 'boolean'
    && Array.isArray(s.symbols) && s.symbols.length >= 1 && s.symbols.every((x) => ENROLL_SYMBOLS.includes(x)) && new Set(s.symbols).size === s.symbols.length;
}

export async function sealEnrollment({ pubKey, fp, clientId, secret, settings, now = Date.now(), subtle = globalThis.crypto.subtle, cryptoImpl = globalThis.crypto }) {
  if ((await execKeyFp(pubKey, subtle)) !== fp) throw new Error('exec_key');
  if (typeof clientId !== 'string' || !ENROLL_CLIENT_RE.test(clientId)) throw new Error('bad_client');
  if (typeof secret !== 'string' || secret.length < 1 || secret.length > 128) throw new Error('bad_secret');
  if (!validEnrollSettings(settings)) throw new Error('bad_settings');
  const nonce = b64u(cryptoImpl.getRandomValues(new Uint8Array(16)));
  const plain = utf8(JSON.stringify({
    v: 1, clientId, secret, ts: now, nonce,
    settings: { maxMarginPct: settings.maxMarginPct, maxConcurrent: settings.maxConcurrent, autoSl: settings.autoSl, symbols: [...settings.symbols] },
  }));
  try {
    const curve = { name: 'ECDH', namedCurve: 'P-256' };
    const execPub = await subtle.importKey('raw', fromB64u(pubKey), curve, false, []);
    const eph = await subtle.generateKey(curve, true, ['deriveBits']);
    const ephRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
    const bits = await subtle.deriveBits({ name: 'ECDH', public: execPub }, eph.privateKey, 256);
    const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const aes = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: ephRaw, info: utf8(ENROLL_INFO) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`${ENROLL_INFO}|${fp}`) }, aes, plain));
    const blob = `v1.${fp}.${b64u(ephRaw)}.${b64u(iv)}.${b64u(ct)}`;
    if (!BLOB_RE.test(blob)) throw new Error('bad_blob');
    return blob;
  } finally {
    plain.fill(0);
  }
}
