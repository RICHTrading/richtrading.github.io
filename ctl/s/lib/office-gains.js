// 셸 → 사무실 수익 알림 전달(2026-10-23 요청 ⑤ — 사무실 lite/gains.js가 PC판 '◆ 수익 알림 ◆' 패널로 그림).
// 허브 GET /v1/analysis/gains(토큰 없음 — 허브가 8000 중계 판정마다 공개 시세로 계산, 메모리 값)를 사무실이 준비된 동안 60초마다 받아
// 처음·바뀔 때만 { type:'ptf:gains', v:1, items } 를 보낸다. 허브 기능이 꺼져 있으면(on:false) 보내지 않는다(사무실 패널은 숨은 채).
// 받기 실패는 앞 값 그대로(보낸 것을 거두지 않음). 숨은 탭(document.hidden)에서는 받지 않는다. 공용판은 만들지 않는다(app.js).
export const GAINS_EVERY_MS = 60000;

export function gainsMessage(items) {
  return { type: 'ptf:gains', v: 1, items: Array.isArray(items) ? items.slice(0, 30) : [] };
}

export function createOfficeGains({ load, post, hidden = () => false, setTimer = setTimeout, clearTimer = clearTimeout, everyMs = GAINS_EVERY_MS }) {
  let timer = null;
  let on = false; // 사무실 준비됨
  let sentKey = null;
  let last = null;
  let busy = false;

  async function pull() {
    if (busy || !on) return;
    busy = true;
    try {
      if (hidden()) return;
      let r = null;
      try { r = await load(); } catch { r = null; }
      if (!on || !r) return;
      if (r.on !== true) return;
      last = r.items;
      const key = JSON.stringify(last);
      if (key !== sentKey && post(gainsMessage(last))) sentKey = key;
    } finally {
      busy = false;
    }
  }
  let gen = 0; // 준비마다 새 번호 — 옛 주기가 겹쳐 돌지 않게
  function loop(g) {
    timer = setTimer(() => { pull().finally(() => { if (on && g === gen) loop(g); }); }, everyMs);
  }
  return {
    // 사무실 준비(office-ready) — 가진 값이 있으면 바로 한 번, 그리고 받기
    ready() {
      on = true;
      gen += 1;
      const g = gen;
      sentKey = null;
      if (last && post(gainsMessage(last))) sentKey = JSON.stringify(last);
      if (timer) clearTimer(timer);
      timer = null;
      pull().finally(() => { if (on && g === gen) loop(g); });
    },
    stop() {
      on = false;
      gen += 1;
      if (timer) clearTimer(timer);
      timer = null;
    },
    pull,
  };
}
