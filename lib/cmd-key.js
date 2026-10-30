// 기기 명령 키(설계 2026-10-16 §15.8·§15.19-5·6) — 허브가 뚫려도 회원 명령을 꾸미지 못하게 휴대폰이 명령마다 서명한다.
// - 키: ECDSA P-256, 개인키 extractable:false(['sign']) — 이 판 기기 저장소 kv.cmdKey에 CryptoKeyPair 그대로(IndexedDB 구조 복제). 메모리 저장소면 멈춤(규칙 14 requireDurable).
//   개인키는 꺼낼 수 없으므로 서버·허브·기록 어디로도 나가지 않는다. 공개키(devPub = raw 65바이트 base64url)만 등록 묶음 v2 평문에 들어간다(server-enroll.js — 허브는 못 봄).
// - dev = sha256(devPub raw) 16진 앞 16자 — 실행기는 그 회원에 등록된 기기 공개키(최대 3) 중 dev가 맞는 것으로 확인한다.
// - 서명 글 = 정렬 JSON(canon-json.js — exec/lib/wire.js canonicalJson과 같은 바이트) { v, kind, args, ts, nonce, dev }(memberHash 없음 — §15.19-5),
//   꼴 = WebCrypto ECDSA SHA-256 P1363(r‖s 64바이트) base64url 86자 — 실행기는 dsaEncoding 'ieee-p1363'으로 확인.
// - 키는 부를 때마다 기기 저장소에서 다시 읽는다(모듈 상태 없음 — 다른 탭이 만든 키도 그대로).
import { requireDurable } from './vault.js';
import { canonJson } from './canon-json.js';
import { b64u } from './server-enroll.js';

export const CMD_KEY_KV = 'cmdKey';
// = exec/lib/wire.js CMD_KEYS·CMD_KINDS·CMD_ID_RE(브라우저라 wire.js를 가져올 수 없음 — 시험이 비교)
export const CMD_KEYS = Object.freeze(['v', 'kind', 'args', 'ts', 'nonce', 'dev', 'sig']);
export const CMD_SIGN_KEYS = Object.freeze(CMD_KEYS.filter((k) => k !== 'sig'));
export const CMD_KINDS = Object.freeze(['on', 'off', 'settings', 'manual_entry', 'add', 'close', 'ack']);
export const CMD_ID_RE = /^c[0-9a-f]{16}$/;
export const CMD_MAX_BYTES = 2048;

const isKey = (k, type) => !!k && typeof k === 'object' && Object.prototype.toString.call(k) === '[object CryptoKey]' && k.type === type
  && !!k.algorithm && k.algorithm.name === 'ECDSA' && k.algorithm.namedCurve === 'P-256';
export function isCmdKeyPair(kp) {
  return !!kp && typeof kp === 'object' && isKey(kp.privateKey, 'private') && kp.privateKey.extractable === false
    && Array.isArray(kp.privateKey.usages) && kp.privateKey.usages.length === 1 && kp.privateKey.usages[0] === 'sign'
    && isKey(kp.publicKey, 'public');
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const exactKeys = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

export function createCmdKey({ vault, subtle = globalThis.crypto && globalThis.crypto.subtle } = {}) {
  async function read() {
    try {
      return await vault.get(CMD_KEY_KV);
    } catch {
      return null;
    }
  }
  // 있으면 그것, 없거나 깨졌으면 새로 만들어 저장하고 다시 읽은 것(두 탭이 동시에 만들어도 저장된 쪽 — vault.js sealKeyFor와 같은 꼴)
  async function pair() {
    requireDurable(vault);
    const cur = await read();
    if (isCmdKeyPair(cur)) return cur;
    const fresh = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    await vault.set(CMD_KEY_KV, { privateKey: fresh.privateKey, publicKey: fresh.publicKey });
    const back = await read();
    if (!isCmdKeyPair(back)) {
      try {
        await vault.del(CMD_KEY_KV);
      } catch {
        // 지우기 실패 — 다음에 다시 만든다
      }
      throw new Error('cmd_key_store');
    }
    return back;
  }
  async function ids(kp) {
    const raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey)); // 공개키만 — 개인키는 꺼낼 수 없음
    if (raw.length !== 65 || raw[0] !== 4) throw new Error('cmd_key_pub');
    return { devPub: b64u(raw), dev: hex(await subtle.digest('SHA-256', raw)).slice(0, 16) };
  }
  return {
    async ensure() {
      return ids(await pair());
    },
    // cmdNoSig = { v, kind, args, ts, nonce, dev } 칸 정확히 — 이 기기 키의 dev가 아니면 서명하지 않는다
    async sign(cmdNoSig) {
      requireDurable(vault);
      if (!exactKeys(cmdNoSig, CMD_SIGN_KEYS)) throw new Error('cmd_shape');
      const kp = await pair();
      const { dev } = await ids(kp);
      if (cmdNoSig.dev !== dev) throw new Error('cmd_dev');
      const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(canonJson(cmdNoSig))));
      if (sig.length !== 64) throw new Error('cmd_sig');
      return b64u(sig);
    },
  };
}
