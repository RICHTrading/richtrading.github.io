// 상단 띠(#strip, p34 설계 §6.8) — 동업자 최신판 상단 바의 UID 배지·'🔗 오렌지엑스 계정 연결/잔고'·'📄 가이드'·거래소 이벤트 칩을 휴대폰 한 줄로.
// - 배지(s·j): 인증 'UID ••••1234 인증 ✓'(끝 4자만 — UID 원문은 기기에도 없다, 보안 규칙 12) · 시험 토큰 '시험용 인증 ✓ ~10/22' · 미인증 'UID 미인증'(→ #verify)
// - 계정 버튼: keysCapable(CONFIG, member)일 때만(검토 18 — autoReady:false 빌드의 실제 회원에게는 키·잔고 글이 없다)
// - 📄 가이드(s·j, 늘): guide/ox-deposit.pdf — 빌드가 실은 판만(config.guides.deposit). 공용판은 숨김(열린 질문 17)
// - 이벤트 칩 자리(#strip-events): 데이터 트랙(app/screens/events.js)이 #evt-chip을 넣고 strip.refresh()를 부른다. 공용판은 칩이 있을 때만 띠가 보인다.
//   칩 글자를 <span class="long">◆ 거래소 이벤트 · …</span><span class="short">◆ 이벤트</span> 두 벌로 넣으면 띠가 넘칠 때(.tight) 짧은 쪽만 보인다(§6.8)
// 띠가 보이면 html.has-strip → --strip-h 28px(#main·#follow-band·새 버전 알림이 그만큼 내려감). DOM은 createElement·textContent만(CSP)
import { fmtMD } from '../lib/auto-view.js';
import { keysCapable } from '../lib/keys.js';

export const STRIP_TEXT = Object.freeze({
  badgeOn: (tail) => `UID ••••${tail} 인증 ✓`,
  badgeOnShort: (tail) => `••••${tail} ✓`,
  badgeTest: (md) => (md ? `시험용 인증 ✓ ~${md}` : '시험용 인증 ✓'),
  badgeTestShort: '시험 ✓',
  badgeOff: 'UID 미인증',
  badgeOffShort: '미인증',
  badgePending: 'UID 확인 중…',
  badgePendingShort: '확인 중…',
  connect: '🔗 오렌지엑스 계정 연결',
  connectShort: '🔗 계정 연결',
  checking: '🔗 확인 중…',
  down: '🔗 연결 끊김',
  balance: (v) => `🔗 잔고 ${v} USDT`,
  balanceShort: (v) => `🔗 ${v}`,
  balanceLoading: '🔗 잔고 확인 중…',
  balancePeek: '🔗 잔고 보기',
  balanceUnknown: '🔗 잔고 확인 안 됨',
  balanceLater: '🔗 잠시 뒤 다시', // 따라가기 실행기가 거래소를 부르는 중(잠깐)이라 누름을 미룸 — 5초 뒤 원래 표시로
  guide: '📄 가이드',
});

const MEMBER_EDS = Object.freeze(['s', 'j']);
const GUIDE_HREF = 'guide/ox-deposit.pdf';

// 사용 가능 잔고 — 소수 2자리, 천 단위 쉼표
export function fmtUsdt(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function badgeOf(member, verify) {
  if (member && member.test) {
    const md = fmtMD(member.testUntil);
    return { text: STRIP_TEXT.badgeTest(md), short: STRIP_TEXT.badgeTestShort, tone: 'good', href: null };
  }
  if (member) return { text: STRIP_TEXT.badgeOn(member.uidTail), short: STRIP_TEXT.badgeOnShort(member.uidTail), tone: 'good', href: null };
  if (verify && verify.pending) return { text: STRIP_TEXT.badgePending, short: STRIP_TEXT.badgePendingShort, tone: 'dim', href: null };
  return { text: STRIP_TEXT.badgeOff, short: STRIP_TEXT.badgeOffShort, tone: 'warn', href: '#verify' };
}

function accountOf(keys, balance) {
  const k = keys || {};
  const b = balance || {};
  const btn = (text, short, action, tone) => ({ text, short, action, tone });
  if (k.status === 'checking') return btn(STRIP_TEXT.checking, STRIP_TEXT.checking, 'keys', 'dim');
  if (k.status === 'down') return btn(STRIP_TEXT.down, STRIP_TEXT.down, 'keys', 'warn');
  if (k.status !== 'ok') return btn(STRIP_TEXT.connect, STRIP_TEXT.connectShort, 'keys', 'accent');
  const shown = b.status === 'ok' && fmtUsdt(b.value);
  if (shown) return btn(STRIP_TEXT.balance(shown), STRIP_TEXT.balanceShort(shown), 'keys', 'good');
  if (b.status === 'unknown') return btn(STRIP_TEXT.balanceUnknown, STRIP_TEXT.balanceUnknown, 'keys', 'warn');
  if (b.status === 'loading') return btn(STRIP_TEXT.balanceLoading, STRIP_TEXT.balanceLoading, 'keys', 'dim');
  // 누르면 다시 판단(peek)만 — 키 화면으로 넘어가지 않는다
  if (b.status === 'later') return btn(STRIP_TEXT.balanceLater, STRIP_TEXT.balanceLater, 'peek', 'dim');
  // 아직 한 번도 읽지 않은 중계 경로(보이기 전 등) — 누르면 바로 읽는다(보이면 스스로 읽고 30초마다 — 대표 결정 2026-10-09)
  if (b.mode === 'relay') return btn(STRIP_TEXT.balancePeek, STRIP_TEXT.balancePeek, 'peek', 'accent');
  return btn(STRIP_TEXT.balanceLoading, STRIP_TEXT.balanceLoading, 'keys', 'dim');
}

// 따라가기 설정 화면(#follow)의 잔고 한 줄(대표 결정 2026-10-10 — 트레이딩 탭 합침 때 '설정 창에서도 잔고'): #follow는 덮는 화면(z 40)이라
// 이 띠(z 20)가 가려진다. 값은 띠와 같은 메모리 값(strip-balance state — 새 거래소 호출 없음), 글은 띠 낱말에서 '🔗 '만 뺀 것.
// 키가 정상 연결(ok)일 때만 — 그 밖(연결 전·확인 중·끊김)은 따라가기 화면의 F-02·상태 줄이 말한다. 계정 버튼과 같은 자격(keysCapable)
const noLink = (t) => t.replace(/^🔗 /, '');
export function balanceLine({ config, member = null, keys = null, balance = null }) {
  const memberEd = !!config && MEMBER_EDS.includes(config.edition);
  if (!memberEd || !keysCapable(config, member) || !keys || keys.status !== 'ok') return null;
  const b = balance || {};
  const shown = (b.status === 'ok' || b.status === 'later') && fmtUsdt(b.value);
  if (shown) return noLink(STRIP_TEXT.balance(shown));
  if (b.status === 'unknown') return noLink(STRIP_TEXT.balanceUnknown);
  return noLink(STRIP_TEXT.balanceLoading);
}

// 띠 내용(순수) — config·인증 상태·키 상태·잔고(strip-balance state)
export function stripModel({ config, member = null, verify = null, keys = null, balance = null }) {
  const memberEd = !!config && MEMBER_EDS.includes(config.edition);
  return {
    badge: memberEd ? badgeOf(member, verify) : null,
    account: memberEd && keysCapable(config, member) ? accountOf(keys, balance) : null,
    guide: memberEd && config.guides && config.guides.deposit === true ? { text: STRIP_TEXT.guide, href: GUIDE_HREF } : null,
  };
}

export function renderStrip(el, { config, root = null, doc = document, onAccount = () => {} }) {
  const two = (node, long, short) => {
    const a = doc.createElement('span');
    a.className = 'long';
    a.textContent = long;
    const b = doc.createElement('span');
    b.className = 'short';
    b.textContent = short;
    node.replaceChildren(a, b);
  };
  const badge = doc.createElement('a');
  badge.id = 'strip-badge';
  badge.className = 'strip-item strip-badge';
  const account = doc.createElement('button');
  account.type = 'button';
  account.id = 'strip-account';
  account.className = 'strip-item strip-account';
  const guide = doc.createElement('a');
  guide.id = 'strip-guide';
  guide.className = 'strip-item strip-guide';
  guide.target = '_blank';
  guide.rel = 'noopener';
  const space = doc.createElement('span');
  space.className = 'strip-space';
  const slot = doc.createElement('span');
  slot.id = 'strip-events';
  slot.className = 'strip-events';
  el.replaceChildren(badge, account, guide, space, slot);

  let model = { badge: null, account: null, guide: null };
  account.addEventListener('click', () => {
    if (model.account) onAccount(model.account.action);
  });

  function refresh() {
    const kids = slot.children ? [...slot.children] : [];
    const show = !!(model.badge || model.account || model.guide) || kids.some((c) => !c.hidden);
    el.hidden = !show;
    if (root && root.classList) root.classList.toggle('has-strip', show);
    // 넘치면 짧은 글자(.short)로 — 길이만 재고 클래스만 바꾼다(style 속성 없음)
    if (show && el.classList && typeof el.scrollWidth === 'number' && el.clientWidth > 0) {
      el.classList.remove('tight');
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('tight');
    }
  }

  function update(next) {
    model = next || model;
    const b = model.badge;
    badge.hidden = !b;
    if (b) {
      two(badge, b.text, b.short);
      badge.className = `strip-item strip-badge ${b.tone}`;
      if (b.href) badge.href = b.href;
      else if (badge.removeAttribute) badge.removeAttribute('href');
    }
    const a = model.account;
    account.hidden = !a;
    if (a) {
      two(account, a.text, a.short);
      account.className = `strip-item strip-account ${a.tone}`;
    }
    const g = model.guide;
    guide.hidden = !g;
    if (g) {
      guide.href = g.href;
      guide.textContent = g.text;
    }
    refresh();
  }

  update(model);
  return { update, refresh, eventsSlot: () => slot, el, config };
}
