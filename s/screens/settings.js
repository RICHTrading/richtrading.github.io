// 설정 화면 — 내용(settingsRows·settingsLinks)과 그리기(renderSettings)를 나눠 내용은 node에서 검사한다.
// 판별 버튼: 담당자판 '오렌지엑스 가입하기', 공용판은 사무실 체험을 다 썼을 때 '모바일 버전 신청'(설계 3-1 §6)
// UID 활성화 줄(V-18)·'이 기기 활성화 해제'(V-19)는 s·j판만(설계 3-2 §3.1). '거래소 연결' 줄(K-12)과 진단 줄(§5.4)은 키 화면 자격(§5.1 —
// s·j판 인증 회원이고 autoReady 또는 시험 토큰)이 있을 때만, 그 밖에는 숨긴다('준비 중' 문구 없음 — 설계 3-2 머리말)
// 옛 '텔레그램 알림 — 준비 중' 줄은 뺐다(대표 결정 2026-10-24 — 주문 알림은 웹 푸시 '주문 알림' 한 줄, push-row.js). 소통방 링크는 그대로
import { editionLinks, memberCapable } from '../lib/auto-view.js';
import { VTEXT, memberRowText } from '../lib/member.js';
import { keysCapable, keysRow, KTEXT } from '../lib/keys.js';
import { followRow } from '../lib/follow-view.js';
import { NOTICE_LINE } from '../lib/trade-view.js';
import { renderPushRow } from './push-row.js';

let lastPushRow = null; // 설정 화면을 다시 그릴 때 앞 줄의 구독을 끊는다

export const NOTICE_LINK = 'https://www.tradingview.com/';
// NOTICE 원문(app/vendor/NOTICE.lightweight-charts 두 줄을 한 줄로 — trade-view NOTICE_LINE) 중 끝 주소 앞부분 — 주소는 링크로
export const NOTICE_TEXT = NOTICE_LINE.replace(NOTICE_LINK, '').trim();

export function healthText(health) {
  switch (health && health.state) {
    case 'ok': return { text: '연결됨', tone: 'good' };
    case 'down': return { text: '연결 안 됨', tone: 'bad' };
    case 'error': return { text: `오류 (HTTP ${health.status})`, tone: 'bad' };
    default: return { text: '확인 중…', tone: 'dim' };
  }
}

// follow = 따라가기 엔진 state()(있으면 '따라가기' 줄 — 상태 줄 F-08, #follow 링크. 자격은 거래소 연결 줄과 같다)
export function settingsRows(config, health, updateNote = '', member = null, keys = null, follow = null) {
  const h = healthText(health);
  const rows = [
    { id: 'version', label: '앱 버전', value: updateNote ? `${config.version} · ${updateNote}` : config.version, tone: 'dim' },
    { id: 'server', label: '서버 연결', value: h.text, tone: h.tone },
  ];
  if (memberCapable(config)) {
    rows.push({ id: 'member', label: VTEXT.rowLabel, value: memberRowText(member), tone: member ? 'good' : 'dim', href: member ? null : '#verify' });
  }
  if (keysCapable(config, member)) {
    rows.push(keysRow(keys));
    const k = keys || {};
    if ((k.status === 'ok' || k.status === 'down') && k.diag) rows.push({ id: 'exchange-diag', label: KTEXT.diagLabel, value: k.diag, tone: 'dim' });
    if (follow) rows.push(followRow(follow));
  }
  return rows;
}

export function settingsLinks(config, trial = null, member = null) {
  const out = [
    { id: 'update', label: '업데이트 확인', action: 'update' },
    { id: 'tour', label: '튜토리얼 다시 보기', action: 'tour' }, // 첫 실행 안내(p34 §6.1 — 동업자 상단 '튜토리얼 보기')
    { id: 'install', label: '설치 방법 다시 보기', href: '#install' },
    { id: 'kakao', label: '문의하기 (카카오톡 채널)', href: config.kakao, external: true },
    { id: 'community', label: '소통방 (텔레그램)', href: config.telegram, external: true },
  ];
  if (member && memberCapable(config)) out.push({ id: 'logout', label: VTEXT.logout, action: 'logout' });
  out.push(...editionLinks(config, trial));
  return out;
}

// push = 주문 알림 구독(app/lib/push-client.js — 서버 판 회원만, 설계 2026-10-23) — 있으면 목록 바로 아래 한 줄
export function renderSettings(el, { config, health, updateNote = '', trial = null, member = null, keys = null, follow = null, onUpdate, onLogout, onTour, push = null, doc = document }) {
  el.replaceChildren();
  if (lastPushRow) lastPushRow.destroy();
  lastPushRow = null;
  const list = doc.createElement('ul');
  list.className = 'set-list';
  for (const r of settingsRows(config, health, updateNote, member, keys, follow)) {
    const li = doc.createElement('li');
    li.dataset.row = r.id;
    const k = doc.createElement('span');
    k.textContent = r.label;
    const v = doc.createElement('span');
    v.className = `set-val ${r.tone}`;
    v.textContent = r.value;
    if (r.href) {
      const a = doc.createElement('a');
      a.className = 'set-row-link';
      a.href = r.href;
      a.append(k, v);
      li.append(a);
    } else {
      li.append(k, v);
    }
    list.append(li);
  }
  const links = doc.createElement('div');
  links.className = 'set-links';
  for (const l of settingsLinks(config, trial, member)) {
    if (l.note) {
      const p = doc.createElement('p');
      p.className = 'set-note';
      p.textContent = l.note;
      links.append(p);
    }
    let node;
    if (l.action) {
      node = doc.createElement('button');
      node.type = 'button';
      const fn = { logout: onLogout, tour: onTour, update: onUpdate }[l.action];
      node.addEventListener('click', () => { if (fn) fn(); });
    } else {
      node = doc.createElement('a');
      node.href = l.href;
      if (l.external) {
        node.target = '_blank';
        node.rel = 'noopener';
      }
    }
    node.dataset.link = l.id;
    node.textContent = l.label;
    links.append(node);
  }
  // 오픈소스 고지(대표 결정 2026-10-23 요청 7 — 트레이딩 탭의 출처 줄·NOTICE 줄을 뺀 대신): 차트 라이브러리 NOTICE 원문 + tradingview.com 링크
  // (라이브러리 README 조건 'attribution notice from the NOTICE file and a link to https://www.tradingview.com/ … page of your … mobile application')
  const notice = doc.createElement('p');
  notice.className = 'set-oss';
  notice.dataset.row = 'oss';
  const t = doc.createElement('span');
  t.textContent = `${NOTICE_TEXT} `;
  const a = doc.createElement('a');
  a.href = NOTICE_LINK;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = NOTICE_LINK;
  notice.append(t, a);
  el.append(list);
  if (push) {
    const slot = doc.createElement('div');
    slot.className = 'set-push';
    slot.dataset.row = 'push';
    el.append(slot);
    lastPushRow = renderPushRow(slot, { client: push, doc });
  }
  el.append(links, notice);
}
