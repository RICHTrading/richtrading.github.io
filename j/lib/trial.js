// 사무실 탭(데모 앱 — 다른 출처 iframe)이 알려 주는 무료 분석 횟수. 셸(이 앱)이 기준을 갖는다(설계 3-2 §4.2):
// 메시지 받기(사무실 출처·지금 iframe 창·사무실 경로 검사)와 ptf:trial-seed는 office-shell.js, 여기는 모양 검사·저장·합치기만
// (used 최댓값, limit = 셸 설정 config.trialRuns).
// 공용판은 다 쓰면(used ≥ limit > 0) 트레이딩 탭 열린 포지션 칸(옛 자동매매 탭 자리 — 2026-10-10 합침)·설정에 '모바일 버전 신청' 버튼을 보인다(설계 3-1 §6·§7.3). 상태는 이 기기에 저장.
// 판끼리 같은 출처라 localStorage를 같이 쓴다 — 담당자판 사무실(횟수 제한 없음)은 {used:0, limit:0}을 보내므로
// 저장 키를 판마다 나눈다(ptf-trial-<판>). 안 나누면 /s/를 한 번 연 것만으로 공용판 신청 버튼이 사라진다
import { safeGet, safeSet } from './store.js';

export const TRIAL_KEY_PREFIX = 'ptf-trial-';
export function trialKey(edition = 'pub') {
  return `${TRIAL_KEY_PREFIX}${edition}`;
}
const MAX = 1000;
const okInt = (n) => Number.isInteger(n) && n >= 0 && n <= MAX;

export function parseTrial(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.type !== 'ptf:trial') return null;
  if (!okInt(data.used) || !okInt(data.limit)) return null;
  return { used: data.used, limit: data.limit };
}

export function trialUsedUp(t) {
  return !!t && okInt(t.used) && okInt(t.limit) && t.limit > 0 && t.used >= t.limit;
}

export function loadTrial(storage, edition = 'pub') {
  const raw = safeGet(trialKey(edition), null, storage);
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return parseTrial({ ...v, type: 'ptf:trial' });
  } catch {
    return null;
  }
}

export function saveTrial(t, storage, edition = 'pub') {
  return safeSet(trialKey(edition), JSON.stringify({ used: t.used, limit: t.limit }), storage);
}

// iOS는 다른 출처 iframe 저장소를 앱을 닫을 때 지울 수 있어 사무실이 used:0을 다시 보낼 수 있다 —
// used는 최댓값만, limit은 셸 설정(판의 office.trial_runs → config.js trialRuns)만 — 사무실이 보낸 limit은 보지 않는다
// (limit:0으로 '다 씀'을 풀 수 없고, 판 설정을 낮춰도 옛 limit에 묶여 셸의 신청 버튼이 안 뜨는 일이 없게)
export function mergeTrial(prev, next, limit) {
  if (!prev && !next) return null;
  return { used: Math.max(prev ? prev.used : 0, next ? next.used : 0), limit };
}

// 저장값을 셸 설정 limit으로 본다(켤 때)
export function shellTrial(stored, limit) {
  return stored ? { used: stored.used, limit } : null;
}

// 저장값·이번 실행의 값(memo — 저장소가 막혀도 이번 실행 동안은 줄지 않게)과 합쳐 used 최댓값 + 셸 limit을 저장(저장값과 다를 때만)하고 돌려준다
export function recordTrial(next, storage, edition = 'pub', limit = 0, memo = null) {
  const stored = loadTrial(storage, edition);
  const merged = mergeTrial(mergeTrial(memo, stored, limit), next, limit);
  if (merged && (!stored || stored.used !== merged.used || stored.limit !== merged.limit)) saveTrial(merged, storage, edition);
  return merged;
}
