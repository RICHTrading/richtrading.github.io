// 운영 측 실계좌 자동매매 송출 — 실시간 현황·열린 포지션·최근 매매 흐름·성적·판별 버튼·새 매매 알림(설계 3-1 §6).
// 인증 회원(s·j판)은 회원 송출로 바꿔 가격 줄·체결 줄·조정·리허설까지(설계 3-2 §3.6) — 연결은 하나(공개 또는 회원).
// 대표 결정 2026-10-10: 자동매매 탭을 트레이딩 탭으로 합쳤다. 이 파일은 트레이딩 탭(modes/trade.js)이 주는 두 자리에 그린다:
//  - 카드 자리(slots.card — 차트 위 '⚡ 오토 모드' 카드 안, 켜기·끄기 줄 아래): 해제 사유 줄 · 이름표 '운영 측 실계좌' · 상태 줄 · 오토 종목 ·
//    A-03 + 인증 입구('UID 인증하기'·'오렌지엑스 가입하기' — 미인증 s·j만, 저장된 인증을 불러오는 동안은 없음) · 인증이 풀린 기기의 정리 길('따라가기' → #follow F-20)
//  - 목록 자리(slots.list — 주문 칸 아래): '운영 측 열린 포지션'(카드·[리허설])·가격 안내 줄(공용판·A-02)·내 따라가기 합계·체험 끝 '모바일 버전 신청'(공용판) ·
//    '운영 측 최근 매매 흐름'(% 기준 줄) · 성적 줄 · 새 매매 알림 스위치 · 내 따라가기 설정('설정 바꾸기 ›' — 따라갈 수 있는 기기만)
//  운영 측 이름표·제목(검토 2026-10-10): 회원 자기 ⚡ 켜기·끄기 줄·주문 칸(청산가 없음)과 같은 화면이라 이 송출이 누구 것인지 밝힌다(알림 배너 머리도)
// 트레이딩 탭은 처음 보일 때 화면을 만든다 — 자리를 받기 전(mount 전)에는 그리지 않고 송출만 받는다(따라가기 엔진·사무실 중계는 그대로).
// 2026-10-10 결정: 탭 아래 고지 박스(실계좌 기록 고지·유사투자자문업 다섯 줄)는 뺐고, 그 자리에 '내 따라가기 설정'(따라갈 수 있는 기기만 —
// followCapable — tradeReady만으로는 아님(p40 통합), 값은 app.js가 엔진 상태에서 읽어 setFollow로). 인증된 기기는 '오렌지엑스 가입하기'가 없다(auto-view memberViewModel)
// 판단은 lib/auto-view.js, 연결은 lib/auto-feed.js(공개)·lib/member-feed.js(회원). DOM은 createElement·textContent로만(CSP)
// onFeed(스냅샷|null)·onLiveEvent(이벤트): 사무실 중계(설계 3-2 §4.3, app.js → office-relay) — 회원 송출일 때만 스냅샷, 지금 연결 것만
import { autoViewModel, memberViewModel, alertText, ALERTS_KEY } from '../lib/auto-view.js';
import { createAutoFeed } from '../lib/auto-feed.js';
import { createMemberFeed } from '../lib/member-feed.js';
import { followCapable } from '../lib/follow-view.js';
import { safeGet, safeSet } from '../lib/store.js';

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function extLink(doc, id, text, href, cls = 'big-btn') {
  const a = el(doc, 'a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.dataset.link = id;
  return a;
}

// 같은 앱 안 화면(#verify·#follow) — 새 창 아님
function inLink(doc, id, text, href, cls) {
  const a = el(doc, 'a', cls, text);
  a.href = href;
  a.dataset.link = id;
  return a;
}

// 내 따라가기 설정(읽기만) — 한 줄씩 이름·값(자동 손절은 승인 문구 한 줄 더), 맨 아래 '설정 바꾸기 ›' = 같은 앱 안 따라가기 화면(#follow)
function mySettingsBox(doc, m) {
  const sec = el(doc, 'section', 'auto-my');
  sec.append(el(doc, 'h3', 'auto-my-title', m.title));
  const list = el(doc, 'dl', 'auto-my-list');
  for (const r of m.rows) {
    const row = el(doc, 'div', 'auto-my-row');
    row.dataset.row = r.id;
    row.append(el(doc, 'dt', null, r.label), el(doc, 'dd', null, r.value));
    // 기능 한계 줄 — 자동 손절 승인 문구, 또는 켜 두었는데 멈춘 따라가기의 상태 줄(F-08, tone warn·bad = 색만)
    if (r.note) row.append(el(doc, 'dd', r.tone === 'warn' || r.tone === 'bad' ? `auto-my-note ${r.tone}` : 'auto-my-note', r.note));
    list.append(row);
  }
  sec.append(list, inLink(doc, 'follow-settings', m.edit.text, m.edit.href, 'big-btn alt auto-my-edit'));
  return sec;
}

// A-03('UID 인증 후 가격 정보가 열립니다.')은 'UID 인증하기'와 한 쌍(설계 3-2 A-03) — 미인증 s·j는 카드의 버튼 줄 바로 위에, 목록 자리에는 없음
// (승인된 배치 ①, 합친 화면 검토 2026-10-10). 공용판 안내·A-02(인증 회원 가격 안내)는 카드 가격 줄이 있는 목록 자리 그대로
const priceNoteInCard = (vm) => !!(vm.verify && vm.priceNote);

// 카드 자리(차트 위 ⚡ 오토 모드) — 자리 안을 통째로 바꾼다. 켜기·끄기 줄(screens/trade-follow.js)은 이 자리 밖(같은 카드의 앞 자리)
export function renderAutoCard(slot, vm, { doc = document } = {}) {
  const out = [];
  if (vm.memberNote) out.push(el(doc, 'p', 'auto-member-note', vm.memberNote)); // 해제 사유(V-14·V-16·V-17)
  if (vm.owner) out.push(el(doc, 'p', 'auto-owner', vm.owner)); // 이름표 '운영 측 실계좌' — 위 ⚡ 켜기·끄기 줄(회원 자기 것)과 따로
  out.push(el(doc, 'p', `auto-status ${vm.status.tone}`, vm.status.text));
  if (vm.symbols) out.push(el(doc, 'p', 'auto-symbols', vm.symbols));
  if (priceNoteInCard(vm)) out.push(el(doc, 'p', 'auto-price-note', vm.priceNote)); // A-03 — 바로 아래 'UID 인증하기'
  const links = [];
  if (vm.verify) links.push(inLink(doc, 'verify', vm.verify.text, vm.verify.href, 'big-btn')); // 미인증 s·j — #verify
  if (vm.signup) links.push(extLink(doc, 'signup', vm.signup.text, vm.signup.href, 'big-btn alt'));
  if (vm.follow) links.push(inLink(doc, 'follow', vm.follow.text, vm.follow.href, 'big-btn alt')); // 인증이 풀린 기기의 정리 길(F-20)
  if (links.length) {
    const box = el(doc, 'div', 'auto-links');
    box.append(...links);
    out.push(box);
  }
  slot.replaceChildren(...out);
  return slot;
}

// 목록 자리(주문 칸 아래) — 자리 안을 통째로 바꾼다
export function renderAutoList(slot, vm, { doc = document, alertsOn = true, onToggleAlerts = () => {} } = {}) {
  const open = el(doc, 'section', 'auto-open');
  open.append(el(doc, 'h3', 'auto-open-title', vm.openTitle));
  for (const c of vm.cards) {
    const card = el(doc, 'div', 'auto-card');
    card.dataset.id = c.id;
    card.append(el(doc, 'p', 'card-title', c.title), el(doc, 'p', 'card-lev', c.lev));
    if (c.stage) card.append(el(doc, 'p', 'card-stage', c.stage));
    if (c.time) card.append(el(doc, 'p', 'card-time', c.time));
    for (const line of c.prices || []) card.append(el(doc, 'p', 'card-price', line));
    for (const line of c.fills || []) card.append(el(doc, 'p', 'card-fill', line));
    if (c.frozen) card.append(el(doc, 'p', 'card-frozen', c.frozen));
    if (c.mine) card.append(el(doc, 'p', 'card-mine', c.mine)); // p34 — 이 기기 내 따라가기(상태 낱말·평가·결과, 가격 없음)
    open.append(card);
  }
  // 공용판 안내·A-02. 미인증 s·j의 A-03은 카드 자리(버튼과 한 쌍). s·j판이 인증을 불러오는 동안은 없음(memberPending)
  if (vm.priceNote && !priceNoteInCard(vm)) open.append(el(doc, 'p', 'auto-price-note', vm.priceNote));
  if (vm.mineTotal) open.append(el(doc, 'p', 'auto-mine-total', vm.mineTotal)); // 내 따라가기 합계(이 기기)
  if (vm.cta) {
    const cta = el(doc, 'div', 'auto-cta');
    cta.append(el(doc, 'p', 'cta-msg', vm.cta.message), extLink(doc, 'apply', vm.cta.text, vm.cta.href));
    open.append(cta);
  }

  const flow = el(doc, 'section', 'auto-flow');
  flow.append(el(doc, 'h3', 'auto-flow-title', vm.flowTitle), el(doc, 'p', 'auto-flow-note', vm.flowNote));
  if (vm.flow.length === 0) {
    flow.append(el(doc, 'p', 'auto-flow-empty', vm.flowEmpty));
  } else {
    const list = el(doc, 'ol', 'auto-flow-list');
    for (const f of vm.flow) {
      const li = el(doc, 'li', `flow-item ${f.tone}`);
      li.dataset.seq = String(f.seq);
      li.append(el(doc, 'span', 'flow-time', f.time), el(doc, 'span', 'flow-text', f.text));
      list.append(li);
    }
    flow.append(list);
  }

  const out = [open, flow];
  if (vm.stats) out.push(el(doc, 'p', 'auto-stats', vm.stats));
  const sw = el(doc, 'label', 'auto-switch');
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.id = 'auto-alerts-switch';
  input.checked = !!alertsOn;
  input.addEventListener('change', () => onToggleAlerts(!!input.checked));
  sw.append(input, el(doc, 'span', null, vm.alertSwitch));
  out.push(sw);
  if (vm.mySettings) out.push(mySettingsBox(doc, vm.mySettings)); // 옛 고지 박스 자리(2026-10-10)
  slot.replaceChildren(...out);
  return slot;
}

// 카드 자리·목록 자리가 그리는 칸 — 같으면 그 자리는 다시 그리지 않는다(스크롤·스위치 누름 유지)
// (priceNote는 둘 다 — 미인증 s·j의 A-03은 카드, 그 밖은 목록. 목록은 verify로 어느 쪽인지 정하므로 verify도)
const CARD_KEYS = Object.freeze(['memberNote', 'owner', 'status', 'symbols', 'priceNote', 'verify', 'signup', 'follow']);
const LIST_KEYS = Object.freeze(['openTitle', 'cards', 'priceNote', 'verify', 'mineTotal', 'cta', 'flowTitle', 'flowNote', 'flowEmpty', 'flow', 'stats', 'alertSwitch', 'mySettings']);
const pick = (vm, keys) => JSON.stringify(keys.map((k) => (vm[k] === undefined ? null : vm[k])));

// slots = { card, list } — 트레이딩 탭이 화면을 만든 뒤 mount(slots)로 넘긴다(그 전에는 그리지 않음)
// alert = { box, text, close } — index.html의 #auto-alert(트레이딩 패널 맨 앞, 흐름 안 — 다른 탭·사무실·덮는 화면을 가리지 않는다, 통합 보고 7)
// onNotify(문구): 알림을 띄울 때마다 — app.js가 다른 탭·화면에 있으면 트레이딩 버튼에 점(진동은 여기서)
// onRevoked(본문, 토큰): 회원 연결이 401(해제·만료)을 받으면 — 인증 상태(member-control)가 그 토큰이 지금 것인지 보고 해제한다
// memberPending: s·j판(app.js MEMBER_OK)은 켤 때 저장된 인증을 불러오는 동안 가입하기·'UID 인증하기'·A-03을 그리지 않는다(인증된 기기에
// 잠깐 비치지 않게, 검토 2026-10-10). 인증 알림(setMember)이나 memberLoaded()(bootMember 끝·MEMBER_BOOT_MS 타이머) 중 먼저 오는 쪽에서 풀림
export function createAutoMode({
  slots = null,
  alert = null,
  config,
  doc = document,
  win = window,
  storage,
  feedFactory = createAutoFeed,
  memberFeedFactory = createMemberFeed,
  alertMs = 8000,
  memberPending = false,
  onRevoked = () => {},
  onFeed = () => {},
  onLiveEvent = () => {},
  onNotify = () => {},
}) {
  let snap = { state: null, events: [], hubDown: false };
  let trial = null;
  let member = null; // 인증 회원이면 회원 송출(가격 포함), 아니면 공개 송출
  let pending = memberPending === true; // 저장된 인증을 아직 모름
  let memberNote = null; // 해제 사유(V-14·V-16·V-17) — 공개 화면 위 한 줄
  let running = false;
  let hideTimer = null;
  let card = slots && slots.card ? slots.card : null;
  let list = slots && slots.list ? slots.list : null;
  let drawnCard = null; // 마지막으로 그린 카드 자리 요약 — 같으면 다시 그리지 않는다
  let drawnList = null; // 목록 자리 요약(+ 알림 스위치) — 같으면 다시 그리지 않는다(스크롤·스위치 탭 유지)
  let feed = null;
  // 따라가기(설계 3-2 §6.6·§6.13) — 정리 길·흐름의 '놓친 신호', p34 내 따라가기 줄·합계, 내 따라가기 설정(2026-10-10 — 자격 있는 회원 화면에만)
  let followView = { link: false, missed: null, mine: null, total: null, settings: null };
  const alertsOn = () => safeGet(ALERTS_KEY, '1', storage) !== '0';

  function hideAlert() {
    if (hideTimer != null) {
      win.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (alert) alert.box.hidden = true;
  }

  function showAlert(ev) {
    if (!alert || !alertsOn()) return;
    const text = alertText(ev); // 결과 %가 있으면 '(증거금 기준 · 거래 비용 제외)'까지
    if (!text) return;
    alert.text.textContent = text;
    alert.box.hidden = false;
    try {
      if (win.navigator && typeof win.navigator.vibrate === 'function') win.navigator.vibrate(200);
    } catch {
      // 진동을 지원하지 않는 기기
    }
    if (hideTimer != null) win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(hideAlert, alertMs);
    try {
      onNotify(text);
    } catch {
      // 표시 보조(버튼 점) 실패는 알림에 영향 없음
    }
  }

  function viewModel() {
    // 내 따라가기 설정은 따라갈 수 있는 회원(시험 토큰 또는 autoReady)일 때만 — 넘겨받은 값이 남아 있어도 다른 회원·해제 뒤에는 그리지 않는다
    return member
      ? memberViewModel({
        config, snap, trial, member, followLink: followView.link, missed: followView.missed, mine: followView.mine, mineTotal: followView.total,
        mySettings: followCapable(config, member) ? followView.settings : null,
      })
      : autoViewModel({ config, snap, trial, memberNote, followLink: followView.link, memberPending: pending });
  }

  function render() {
    if (!card && !list) return; // 트레이딩 탭 화면을 아직 만들지 않음
    const vm = viewModel();
    if (card) {
      const key = pick(vm, CARD_KEYS);
      if (key !== drawnCard) {
        drawnCard = key;
        renderAutoCard(card, vm, { doc });
      }
    }
    if (list) {
      const on = alertsOn();
      const key = `${on ? 1 : 0}|${pick(vm, LIST_KEYS)}`;
      if (key !== drawnList) { // 스트림 재접속·변화 없는 확인 — 보이는 내용이 같다
        drawnList = key;
        renderAutoList(list, vm, {
          doc,
          alertsOn: on,
          onToggleAlerts: (next) => {
            safeSet(ALERTS_KEY, next ? '1' : '0', storage);
            if (!next) hideAlert();
          },
        });
      }
    }
  }

  // 연결 하나 — 교체된 옛 연결의 갱신·알림·401은 버린다(feed !== f)
  function makeFeed() {
    let f = null;
    const onUpdate = (s) => {
      if (feed !== f) return;
      snap = s;
      render();
      onFeed(member ? s : null); // 사무실 중계 — 회원 송출일 때만
    };
    const onAlert = (ev) => {
      if (feed === f) showAlert(ev);
    };
    if (member) {
      const token = member.token;
      f = memberFeedFactory({
        hub: config.hub,
        token,
        version: config.version,
        onUpdate,
        onAlert,
        onEvent: (ev) => {
          if (feed === f) onLiveEvent(ev);
        },
        onUnauthorized: (body) => {
          if (feed === f) onRevoked(body, token);
        },
      });
    } else {
      f = feedFactory({ hub: config.hub, onUpdate, onAlert });
    }
    return f;
  }

  if (alert && alert.close) alert.close.addEventListener('click', hideAlert);
  feed = makeFeed();

  return {
    start() {
      running = true;
      render();
      feed.start();
    },
    stop() {
      running = false;
      feed.stop();
    },
    // 트레이딩 탭이 화면을 만들면(처음 보일 때) 두 자리를 넘긴다 — 바로 지금 상태로 그림
    mount(next) {
      card = next && next.card ? next.card : null;
      list = next && next.list ? next.list : null;
      drawnCard = null;
      drawnList = null;
      render();
    },
    setTrial(t) {
      trial = t;
      render();
    },
    // 정리 길(자격)·놓친 신호(엔진 state().missed)·내 따라가기(엔진 state().mine — 가격 없음)·끝난 매매 합계·
    // 내 따라가기 설정(follow-view mySettingsView — 설정·자동 손절 스위치가 바뀔 때마다 app.js가 다시 넘김) — 바뀌면 다시 그린다(같으면 render가 건너뜀)
    setFollow({ link = false, missed = null, mine = null, total = null, settings = null } = {}) {
      followView = {
        link: !!link,
        missed: missed instanceof Set && missed.size ? missed : null,
        mine: mine && typeof mine === 'object' ? mine : null,
        total: typeof total === 'number' && Number.isFinite(total) ? total : null,
        settings: settings && typeof settings === 'object' ? settings : null,
      };
      render();
    },
    // 인증·해제·토큰 갱신 — 토큰이 바뀔 때만 연결을 새로 만든다(옛 상태는 버리고 다시 채움)
    setMember(m, { note = null } = {}) {
      pending = false; // 인증 상태를 앎(저장된 인증을 불러옴·인증·해제)
      const before = member ? member.token : null;
      member = m && typeof m === 'object' && typeof m.token === 'string' ? m : null;
      memberNote = member ? null : (typeof note === 'string' && note ? note : null);
      if ((member ? member.token : null) !== before) {
        feed.stop();
        snap = { state: null, events: [], hubDown: false };
        onFeed(null); // 옛 연결의 중계 상태를 남기지 않는다
        feed = makeFeed();
        if (running) feed.start();
      }
      render();
    },
    // 저장된 인증 불러오기가 끝남(알림이 없었어도 — 저장소 오류·멈춤): 미인증이면 그때 가입하기·'UID 인증하기'·A-03
    memberLoaded() {
      if (!pending) return;
      pending = false;
      render();
    },
    render,
  };
}
