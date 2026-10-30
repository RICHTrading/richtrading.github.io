// 셸 → 사무실 체험 남은 횟수(대표 결정 2026-10-30 — 동업자 의견 '체험·정밀 분석 버튼 나누지 말고 정밀 분석 하나만 두고 몇 회 남았는지 알 수 있게').
// 비활성화 사무실(s·j판 m/ — 셸이 중계 아닌 주소로 만든 창, office-shell이 고름)이 준비될 때(ready)와 요청 결과(ptf:analysis-result)를 보낸 뒤(changed)
// 허브 POST /v1/analysis/trial { v:1, dev: kv.reqDev }(토큰 없음 — 요청 분석과 같은 기기 값)로 묻고 { type:'ptf:trial-left', v:1, left, limit }를 보낸다.
// 사무실은 맨 아래 띠('오늘 N/5회 남음')를 고치고 0이면 정밀 분석을 잠긴 모양으로(누를 때만 안내 — 메시지만으로는 아님).
// 보내지 않는 때: 활성화 회원(묻지도 않음)·허브 null(회원·명단 꺼짐)·실패(연결·429·5xx)·모양 틀림 — 사무실은 '하루 N회' 글 그대로, 앞 값은 거두지 않음.
// office-ready는 load마다 두세 번 오므로 TRIAL_FRESH_MS 안의 값이면 묻지 않고 그 값을 다시 보낸다. 묻는 중에 또 오면 끝난 뒤 한 번만 더.
// 기기 값은 허브 본문에만(기록·저장·사무실로 보내지 않음)
import { DEV_RE } from './analysis-request.js';

export const TRIAL_FRESH_MS = 15000;
export const TRIAL_LIMIT_MAX = 50; // 허브 analysis.request.trialPerDay 상한과 같음
const RESP_KEYS = Object.freeze(['ok', 'v', 'limit', 'left']);

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

// 허브 답 { status, body } → { limit, left } | 'member'(null 둘 — 체험 셈 밖) | null(실패·모양 틀림)
export function parseTrialResp(r) {
  if (!r || r.status !== 200) return null;
  const b = r.body;
  if (!exactKeys(b, RESP_KEYS) || b.ok !== true || b.v !== 1) return null;
  if (b.limit === null && b.left === null) return 'member';
  const { limit, left } = b;
  if (!Number.isInteger(limit) || !Number.isInteger(left) || limit < 0 || limit > TRIAL_LIMIT_MAX || left < 0 || left > limit) return null;
  return { limit, left };
}

export function trialLeftMessage({ left, limit }) {
  return { type: 'ptf:trial-left', v: 1, left, limit };
}

// load(dev) → { status, body } | null (hub.js postTrialLeft), devId() → kv.reqDev 약속, post(msg) → 보냈나(office-shell.post),
// member() → 지금 활성화 회원인가(app.js state.member)
export function createOfficeTrial({ load, devId, post, member = () => false, now = () => Date.now(), freshMs = TRIAL_FRESH_MS }) {
  let on = false; // 사무실 준비됨(office-shell이 비활성화 사무실이라고 고른 창)
  let gen = 0; // 준비가 풀릴 때마다 새 번호 — 옛 창으로의 답은 보내지 않는다
  let last = null;
  let lastAt = -Infinity;
  let inflight = false;
  let inflightGen = -1;
  let again = false;

  const send = (v) => {
    try {
      return post(trialLeftMessage(v)) !== false;
    } catch {
      return false;
    }
  };

  async function refresh(force) {
    if (!on || member()) return;
    if (inflight) {
      // 묻는 중 — 같은 창의 준비 알림이면 그 답을 기다리고, 결과 뒤(force)·새 창이면 끝난 뒤 한 번 더
      if (force || inflightGen !== gen) again = true;
      return;
    }
    inflight = true;
    inflightGen = gen;
    const g = gen;
    try {
      let dev = null;
      try {
        dev = await devId();
      } catch {
        dev = null;
      }
      if (typeof dev !== 'string' || !DEV_RE.test(dev)) return;
      let r = null;
      try {
        r = await load(dev);
      } catch {
        r = null;
      }
      const p = parseTrialResp(r);
      if (!p || p === 'member') return;
      last = p;
      lastAt = now();
      if (on && g === gen && !member()) send(p);
    } finally {
      inflight = false;
      if (again) {
        again = false;
        refresh(true);
      }
    }
  }

  return {
    // 비활성화 사무실 준비(office-ready) — 막 받은 값이면 그것을, 아니면 묻는다
    ready() {
      on = true;
      if (member()) return;
      if (last && now() - lastAt < freshMs) {
        send(last);
        return;
      }
      refresh(false);
    },
    // 요청 결과를 사무실에 보낸 뒤 — 새 표(셈 하나 씀)·돌려준 표(셈 돌아옴)·trial이 바로 보이게 늘 다시 묻는다
    changed() {
      refresh(true);
    },
    stop() {
      on = false;
      gen += 1;
      again = false;
    },
    last: () => last,
  };
}
