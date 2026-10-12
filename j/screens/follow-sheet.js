// ③ 한 번 눌러 주문 시트(#follow-sheet — 어느 탭에서든 맨 위, 설계 3-2 §6.13, 문구 F-10)와 ② 켜짐 띠(#follow-band, F-14).
// 시트는 가장 오래된 것 하나를 보인다. 남은 시간은 초 단위로 줄고(app.js가 1초마다 update), 지나면 '이 주문 내기'를 막고 만료 문구.
// 결정은 회원이 한다 — 누르면 엔진이 그 순간 조건을 다시 보고 낸다. DOM은 createElement·textContent로만(CSP)
// p34: 가격 차이 줄 없음(가격 차이 한도를 없앰). 손절 칸은 신호 손절 가격만 — 자동 손절이 켜져 있으면 '없음(4차 진입 뒤 자동)'(가격 없음)
import { FTEXT } from '../lib/follow-text.js';
import { TEXT } from '../lib/auto-view.js';
import { sheetLines } from '../lib/follow-view.js';

export function renderSheet(box, { onGo = () => {}, onSkip = () => {}, doc = document }) {
  const p = (cls) => {
    const n = doc.createElement('p');
    n.className = cls;
    return n;
  };
  const title = p('sheet-title');
  const signal = p('sheet-signal');
  const reason = p('sheet-reason');
  const mine = p('sheet-mine');
  const tpsl = p('sheet-tpsl');
  const left = p('sheet-left');
  const expired = p('sheet-expired');
  expired.textContent = FTEXT.sheetExpired;
  const who = p('sheet-who');
  who.textContent = FTEXT.sheetWho;
  // 3-1 법정 고지 5줄 + 고지(원금 손실) — 따라가기 화면·시트·키 화면에 그대로(§8.1 끝)
  const legal = doc.createElement('ul');
  legal.className = 'sheet-legal';
  for (const line of TEXT.legal) {
    const li = doc.createElement('li');
    li.textContent = line;
    legal.append(li);
  }
  const notice = p('sheet-notice');
  notice.textContent = TEXT.notice;
  const go = doc.createElement('button');
  go.type = 'button';
  go.id = 'sheet-go';
  go.className = 'big-btn';
  const skip = doc.createElement('button');
  skip.type = 'button';
  skip.id = 'sheet-skip';
  skip.className = 'big-btn alt';
  skip.textContent = FTEXT.sheetSkip;
  let key = null;
  go.addEventListener('click', () => { if (key && !go.disabled) onGo(key); });
  skip.addEventListener('click', () => { if (key) onSkip(key); });
  box.replaceChildren(title, signal, reason, mine, tpsl, left, expired, go, skip, who, legal, notice);
  box.hidden = true;

  function update(sheets, now, { autoSlOn = false } = {}) {
    const s = Array.isArray(sheets) && sheets.length ? sheets[0] : null;
    key = s ? s.key : null;
    box.hidden = !s;
    if (!s) return;
    const l = sheetLines(s, now, { autoSlOn });
    const set = (n, t) => {
      n.textContent = t || '';
      n.hidden = !t;
    };
    set(title, l.title);
    set(signal, l.signal);
    set(reason, l.reason);
    set(mine, l.mine);
    set(tpsl, l.tpsl);
    set(left, l.left);
    expired.hidden = !l.expired;
    go.textContent = l.go;
    go.disabled = l.expired;
  }
  return { update, go, skip };
}

// 보이는 동안 root(html)에 has-band — 본문(#main)·새 버전 알림이 띠 높이(--band-h)만큼 내려가 탭 첫 줄(사무실 중계 띠 등)을 가리지 않는다(p34 종단 확인)
export function renderBand(el, st, root = null) {
  const on = !!(st && st.band);
  el.hidden = !on;
  el.textContent = on ? FTEXT.band : '';
  if (root && root.classList) root.classList.toggle('has-band', on);
}
