// 설정 화면 — 내용(settingsRows·settingsLinks)과 그리기(renderSettings)를 나눠 내용은 node에서 검사한다.
// 판별 버튼: 담당자판 '오렌지엑스 가입하기', 공용판은 사무실 체험을 다 썼을 때 '모바일 버전 신청'(설계 3-1 §6)
// UID 인증 줄(V-18)·'이 기기 인증 해제'(V-19)는 s·j판만(설계 3-2 §3.1). '거래소 연결' 줄(K-12)과 진단 줄(§5.4)은 키 화면 자격(§5.1 —
// s·j판 인증 회원이고 autoReady 또는 시험 토큰)이 있을 때만, 그 밖에는 숨긴다('준비 중' 문구 없음 — 설계 3-2 머리말)
import { editionLinks, memberCapable } from '../lib/auto-view.js';
import { VTEXT, memberRowText } from '../lib/member.js';
import { keysCapable, keysRow, KTEXT } from '../lib/keys.js';
import { followRow } from '../lib/follow-view.js';

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
  rows.push({ id: 'alerts', label: '텔레그램 알림', value: '준비 중', tone: 'dim' });
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

export function renderSettings(el, { config, health, updateNote = '', trial = null, member = null, keys = null, follow = null, onUpdate, onLogout, onTour, doc = document }) {
  el.replaceChildren();
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
  el.append(list, links);
}
