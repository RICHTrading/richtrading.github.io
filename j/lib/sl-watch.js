// 손절 감시 때·자리(설계 2026-10-16 §15.6 D32 · §7.5) — 서버 실행기가 거래소 STOP을 걸지 않고 표시가를 지켜보다
// 그 자리에 닿으면 감소 전용 시장가로 전량 정리할 때, '지금 감시하나'와 '닿았나'만 판단하는 순수 함수(DOM·저장소·거래소 모름).
// 감시 종류: after4(기본 방식 4차 체결 뒤) · early(미리 — 다음 차수 강제 선이 청산 거리의 90%보다 바깥, Q24) ·
// forced(다음 차수를 확정 사유로 못 넣은 채 그 강제 선, Q24) · pct(직접 % 손절, Q23).
// 자리 계산은 auto-sl.js(autoSlTrigger·autoSlPassed — 청산가는 부르는 쪽이 liqOf로)와 follow-math.js(pctStopFor·earlyAutoSl)를 그대로 쓴다.
// 발동가는 이 함수 안에서만 계산하고 버린다 — 돌려주는 값은 낱말·참거짓뿐(규칙 18: 장부·기록·보고·디스크 어디에도 가격 없음).
import { autoSlTrigger, autoSlPassed, autoSlDue } from './auto-sl.js';
import { pctStopFor, earlyAutoSl } from './follow-math.js';
import { stageRule } from './dca-rules.js';

export const SL_WATCH_KINDS = Object.freeze(['after4', 'early', 'forced', 'pct']);
const AUTO_KINDS = Object.freeze(['after4', 'early', 'forced']);
const EDGE_EPS = 1e-9; // 강제 선 경계 여유(follow-math dcaDecision과 같은 값 — 정확히 선에 닿은 값을 부동소수 오차로 놓치지 않게)

const autoSlOf = (rules) => (rules && rules.follow && rules.follow.autoSl ? rules.follow.autoSl : null);

// 지금 그 매매를 감시하나 → null | 'after4' | 'early' | 'forced' | 'pct'.
// rules = 따라가기 규칙(follow-rules.json — follow.autoSl), dca = 추가 진입 표(dcaRulesOf, 없으면 null), liqPct = 지금 청산 거리(증거금 % — liqMarginPct),
// src = 청산가 출처('exchange' | 'estimate' — 모르면 추정으로 본다: 80%라 더 일찍 감시하는 쪽), autoSlOn = 회원 자동 손절 스위치,
// memberStop = memberStopOf 결과('none' | 'partial' | 'covers').
// 직접 %는 회원이 고른 손절이라 스위치·회원 직접 손절과 무관하게 감시(Q23). 손절 방식 칸이 없거나 모르는 값이면 기본 방식(follow-core와 같음)
export function slWatchKind(trade, { rules, dca = null, liqPct = null, src = null, autoSlOn = true, memberStop = 'none' } = {}) {
  if (!trade || typeof trade !== 'object') return null;
  if (trade.slMode === 'pct') return 'pct';
  if (memberStop === 'covers') return null;
  if (autoSlOn !== true) return null;
  const autoSl = autoSlOf(rules);
  if (!autoSl) return null;
  const stage = trade.stage;
  if (autoSlDue(stage, autoSl.afterStage)) return 'after4';
  if (Number.isInteger(stage)) {
    const nextStage = stageRule(dca, stage + 1);
    if (earlyAutoSl({ liqPct, nextStage, src: src === 'exchange' ? 'exchange' : 'estimate', autoSl })) return 'early';
  }
  if (trade.slForced === true) return 'forced';
  return null;
}

// 강제 선 손절 때가 됐나(§7.5): 다음 차수(stage + 1)를 확정 사유로 못 넣었고(dcaFail.stage = 다음 차수) 불리한 움직임 m(증거금 %)이 그 차수 강제 선 이상.
// 참이면 부르는 쪽이 장부에 slForced를 세운다(한 번 세우면 그대로 — 남은 차수를 포기)
export function forcedDue(trade, { dca = null, m = null } = {}) {
  if (!trade || !Number.isInteger(trade.stage) || !Number.isFinite(m)) return false;
  const n = trade.stage + 1;
  if (!trade.dcaFail || trade.dcaFail.stage !== n) return false;
  const rule = stageRule(dca, n);
  if (!rule || !Number.isFinite(rule.forcePct)) return false;
  return m >= rule.forcePct - EDGE_EPS;
}

// 표시가가 감시 자리에 닿았나(롱 mark ≤ 자리 · 숏 mark ≥ 자리 — autoSlPassed). pct = 평단 × (1 − dir × |손절%|/(100×배율)),
// 그 밖 = 평단→청산가 거리의 90%(추정 청산가면 80%) 지점. 자리를 못 구하면(청산가 없음·auto_sl_no_room·tick 없음) 거짓 —
// 부르는 쪽이 '청산가 없음'을 낱말로 기록한다(가격 없이)
export function slWatchHit({ kind, dir, avg, liq = null, src = null, lev, slPct = null, mark, tick, rules } = {}) {
  if ((dir !== 1 && dir !== -1) || !(avg > 0) || !(tick > 0)) return false;
  let trigger = null;
  if (kind === 'pct') {
    if (!Number.isFinite(slPct) || slPct === 0 || !(lev >= 1)) return false;
    trigger = pctStopFor({ dir, avg, slPct, lev, tick });
  } else if (AUTO_KINDS.includes(kind)) {
    const autoSl = autoSlOf(rules);
    if (!autoSl || !(liq > 0)) return false;
    const r = autoSlTrigger({ dir, avg, liq, src: src === 'exchange' ? 'exchange' : 'estimate', distPct: autoSl.liqDistPct, estDistPct: autoSl.estDistPct, tick });
    if (r.skip) return false;
    trigger = r.trigger;
  } else {
    return false;
  }
  return autoSlPassed({ dir, trigger, mark }) === true;
}
