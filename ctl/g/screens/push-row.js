// 주문 알림 한 줄(설계 2026-10-23 §3) — 서버 판 자동매매 창(#follow)과 설정 화면에 같은 모양으로. 이름표 '주문 알림' + 버튼 하나 + 상태 한 줄.
// 켜기 버튼은 누른 그 자리에서 client.enable()을 부른다(권한 창은 사용자 손짓 안에서만). DOM은 createElement·textContent로만(CSP)
import { PUSH_TEXT, pushRowModel } from '../lib/push-client.js';

export function renderPushRow(el, { client, doc = globalThis.document }) {
  const node = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const box = node('div', 'push-row');
  const head = node('div', 'push-head');
  const label = node('span', 'push-label', PUSH_TEXT.label);
  const btn = node('button', 'push-btn');
  btn.type = 'button';
  head.append(label, btn);
  const line = node('p', 'push-line');
  const msg = node('p', 'push-msg');
  msg.setAttribute('role', 'status');
  box.append(head, line, msg);
  el.append(box);

  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    if (btn.dataset.act === 'off') client.disable();
    else client.enable();
  });

  function paint(st) {
    const m = pushRowModel(st);
    box.hidden = !m.show;
    line.textContent = m.line;
    btn.hidden = !m.btn;
    btn.dataset.act = m.btn || '';
    btn.textContent = m.btn === 'off' ? PUSH_TEXT.off : PUSH_TEXT.on;
    btn.disabled = m.disabled;
    btn.setAttribute('aria-pressed', m.btn === 'off' ? 'true' : 'false');
    msg.textContent = m.msg;
    msg.hidden = !m.msg;
  }
  const off = client.onChange(paint);
  paint(client.state());
  return { el: box, destroy: off, paint };
}
