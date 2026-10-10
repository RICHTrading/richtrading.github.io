// 따라가기 기기 저장(설계 3-2 §5.3·§6.2·§6.4·§6.11) — IndexedDB ptf-<판>-vault의 kv.follow(설정)·kv.consent(동의 기록, 최근 50)·ledger(장부).
// p34: 하루 손실 한도를 없애 kv.day는 쓰지 않는다(엔진 init이 dropDay로 한 번 지움). 자동 손절 스위치·주문 목록(kv.autoSl·kv.autoSlOrders)은 auto-sl-switch·auto-sl-orders가 같은 vault로.
// 쓰기는 오래가는 저장소(idb)에서만 — 메모리 저장소면 던진다(requireDurable: 앱을 닫으면 장부가 사라져 거래소 포지션을 놓치거나 같은 신호로 두 번 열 수 있다).
// 읽기 오류는 던지지 않는다(빈 값). 장부의 끝난 줄(closed·skipped·shadow)은 최근 300줄만 남긴다 — 단 자동 손절 정리 미완 매매
// (slCleanupPending — closed인데 autoSl 끝 확인 전, 장부에만 STOP 번호가 있을 수 있음)는 세지도 지우지도 않는다(p35 검토 5: 그 줄이 지워지면
// 남은 STOP을 아무도 모르고 같은 종목 진입 막기도 풀린다). 끝 확인(done·off) 뒤에야 정리 대상.
import { requireDurable } from './vault.js';
import { CONSENT_KEEP } from './follow-settings.js';
import { slCleanupPending } from './follow-autosl.js';

export const LEDGER_KEEP = 300;
export const DONE_STATES = Object.freeze(['closed', 'skipped', 'shadow']);

export function createFollowStore(vault) {
  const durable = () => requireDurable(vault);
  async function read(key) {
    try {
      return await vault.get(key);
    } catch {
      return undefined;
    }
  }
  async function trades() {
    try {
      const all = await vault.ledgerAll();
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  }
  async function consents() {
    const v = await read('consent');
    return Array.isArray(v) ? v : [];
  }
  async function prune() {
    const done = (await trades())
      .filter((t) => t && DONE_STATES.includes(t.state) && !slCleanupPending(t))
      .sort((a, b) => (a.closedAt || a.openedAt || 0) - (b.closedAt || b.openedAt || 0));
    for (const t of done.slice(0, Math.max(0, done.length - LEDGER_KEEP))) await vault.ledgerDel(t.id);
  }
  return {
    vault,
    durable: () => !!vault && vault.kind === 'idb',
    settings: () => read('follow'),
    async saveSettings(s) {
      durable();
      await vault.set('follow', s);
    },
    consents,
    async addConsent(rec) {
      durable();
      const next = [...(await consents()), rec].slice(-CONSENT_KEEP);
      await vault.set('consent', next);
      return next;
    },
    // 옛 하루 손실 기록(kv.day) 지우기 — 실패해도 그대로(p34 §3.1)
    async dropDay() {
      try {
        await vault.del('day');
      } catch {
        // 지우기 실패 — 읽는 곳이 없으니 그대로 둔다
      }
    },
    trades,
    async trade(id) {
      try {
        return (await vault.ledgerGet(id)) ?? null;
      } catch {
        return null;
      }
    },
    // 주문을 보내기 전에 체결 줄을 'sending'으로 쓰는 곳(§6.4)도 이것 — 저장이 끝난 뒤에 주문한다
    async putTrade(t) {
      durable();
      await vault.ledgerPut(structuredClone(t));
      if (DONE_STATES.includes(t.state)) await prune();
    },
  };
}

// F-18 '내 따라가기 기록(이 기기)' — 최근 100건(연 시각 내림차순)
export function recentTrades(list, n = 100) {
  return (Array.isArray(list) ? list : []).filter((t) => t && t.id).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)).slice(0, n);
}
