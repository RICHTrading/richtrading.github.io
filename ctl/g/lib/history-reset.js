// '매매 내역 초기화'(대표 요청 2026-11-03 — 이 기기만): 설정 맨 아래 버튼으로 정한 시각 하나를 기기 저장(store.js — localStorage)에 둔다.
// 그 시각 앞에 끝난 매매는 '매매 내역' 창·트레이딩 탭 '최근 24시간' 줄에서 뺀다(follow-view since). 서버 기록(실행기 장부)은 그대로.
// 저장 = { v:1, at, h } — h는 그 회원 기기 해시(uidHash) 앞 16자(같은 기기 다른 회원에게는 적용 안 함). UID·토큰은 없다.
// storage를 생략하면 localStorage(store.js와 같음), 시험은 가짜 저장소
import { safeGet, safeSet, safeRemove } from './store.js';

export const HISTORY_RESET_TEXT = Object.freeze({
  button: '매매 내역 초기화',
  confirm: '지금까지의 매매 내역을 이 기기에서 비울까요? 열린 포지션은 그대로입니다.',
  since: (t) => `${t} 초기화`,
  undo: '전체 기록 다시 보기',
});
const FUTURE_MS = 60000; // 기기 시계 차 여유 — 그보다 미래인 값은 깨진 값으로 본다
const HASH_RE = /^[0-9a-f]{64}$/;
const pad = (n) => String(n).padStart(2, '0');

export const historyResetKey = (edition) => `ptf-${edition}-histReset`;
const tagOf = (member) => (member && typeof member.uidHash === 'string' && HASH_RE.test(member.uidHash) ? member.uidHash.slice(0, 16) : null);

// → 초기화 시각(ms) | null(없음·다른 회원·깨진 값·막힌 저장소)
export function loadHistoryReset(storage, edition, member, now = Date.now()) {
  const h = tagOf(member);
  if (!h) return null;
  const raw = safeGet(historyResetKey(edition), null, storage);
  if (raw == null) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1 || o.h !== h) return null;
    return Number.isSafeInteger(o.at) && o.at > 0 && o.at <= now + FUTURE_MS ? o.at : null;
  } catch {
    return null;
  }
}
export function saveHistoryReset(storage, edition, member, at) {
  const h = tagOf(member);
  if (!h || !Number.isSafeInteger(at) || at <= 0) return false;
  return safeSet(historyResetKey(edition), JSON.stringify({ v: 1, at, h }), storage);
}
export const clearHistoryReset = (storage, edition) => safeRemove(historyResetKey(edition), storage);
export function fmtResetAt(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
