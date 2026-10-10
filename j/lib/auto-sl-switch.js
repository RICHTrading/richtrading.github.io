// 자동 손절 스위치(p34 설계 §2.2·§8.1) — 따라가기 화면·트레이딩 탭 카드가 같은 값 하나를 쓴다(동업자판처럼 계정 전체).
// 저장: IndexedDB ptf-<판>-vault kv.autoSl = { v: 1, on, at, listed?, listedType?, noMarket? } — 없으면 규칙 기본(follow-rules.json autoSl.default, 켜짐).
// noMarket(p35 검토 2·3): 이 기기에서 type market 미체결 조회를 거래소·중계가 확정 거절함(파라미터 오류) — 그 뒤 정리는 그 조회를 하지 않는다.
// 그 조회에 우리 STOP이 보이면(markListed('market')) 지운다. listedType 'market'인 기기는 noMarket을 보지 않는다.
// 쓰기는 set·markListed·markNoMarket만 — vault.update(한 거래)로 모르는 칸을 지우지 않고, 쓰기 전 requireDurable(보안 규칙 14).
// 바꾸면 BroadcastChannel('ptf-<판>-autosl')로 { type: 'changed' }만(값 없이) — 받는 탭은 저장소에서 다시 읽는다.
// 맞추는 쪽(정리 주기·가벼운 주기)은 매번 read()로 저장소 값을 다시 본다(메모리 사본으로 판단하지 않음).
import { requireDurable } from './vault.js';

export const autoSlChannelName = (edition) => `ptf-${edition}-autosl`;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function createAutoSlSwitch({
  vault,
  rules,
  edition = 's',
  now = () => Date.now(),
  makeChannel = (name) => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null),
} = {}) {
  const def = !(rules && rules.follow && rules.follow.autoSl && rules.follow.autoSl.default === false);
  const listeners = new Set();
  let ch = null;
  try {
    ch = makeChannel(autoSlChannelName(edition));
  } catch {
    ch = null;
  }
  if (ch) {
    ch.onmessage = (e) => {
      if (!e || !isObj(e.data) || e.data.type !== 'changed') return;
      for (const fn of listeners) {
        try {
          fn();
        } catch {
          // 받는 쪽 오류는 무시
        }
      }
    };
  }
  const post = () => {
    try {
      if (ch) ch.postMessage({ type: 'changed' });
    } catch {
      // 닫힌 채널
    }
  };

  async function read() {
    let v;
    try {
      v = vault ? await vault.get('autoSl') : undefined;
    } catch {
      v = undefined;
    }
    const ok = isObj(v) && v.v === 1 && typeof v.on === 'boolean';
    const listedType = isObj(v) && v.listedType === 'market' ? 'market' : null;
    return {
      on: ok ? v.on : def,
      listed: isObj(v) && v.listed === true,
      listedType,
      noMarket: isObj(v) && v.noMarket === true && listedType !== 'market',
      at: ok && Number.isFinite(v.at) ? v.at : null,
    };
  }
  async function set(on) {
    requireDurable(vault);
    await vault.update('autoSl', (cur) => ({ ...(isObj(cur) ? cur : {}), v: 1, on: !!on, at: now() }));
    post();
  }
  // 이 기기에서 우리 STOP이 미체결 조회에 보였다(§2.7 listed) — type 'market' 조회에서만 보였으면 그 조회를 쓴다
  async function markListed(type = null) {
    requireDurable(vault);
    await vault.update('autoSl', (cur) => {
      const base = isObj(cur) ? { ...cur } : {};
      if (type === 'market') delete base.noMarket; // 그 조회가 된다 — 거절 기록은 옛 것(중계를 고친 뒤 등)
      return { ...base, v: 1, on: typeof base.on === 'boolean' ? base.on : def, at: Number.isFinite(base.at) ? base.at : null, listed: true, listedType: type === 'market' ? 'market' : (base.listedType ?? null) };
    });
  }
  // type market 미체결 조회를 거래소·중계가 확정 거절했다(p35 검토 2·3) — market을 배운 기기면 적지 않는다
  async function markNoMarket() {
    requireDurable(vault);
    await vault.update('autoSl', (cur) => {
      const base = isObj(cur) ? cur : {};
      if (base.listedType === 'market') return base;
      return { ...base, v: 1, on: typeof base.on === 'boolean' ? base.on : def, at: Number.isFinite(base.at) ? base.at : null, noMarket: true };
    });
  }
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function close() {
    listeners.clear();
    try {
      if (ch) ch.close();
    } catch {
      // 이미 닫힘
    }
  }
  return { read, set, markListed, markNoMarket, onChange, close, defaultOn: def };
}
