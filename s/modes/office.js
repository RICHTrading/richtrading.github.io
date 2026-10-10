// 사무실 탭 = 데모 앱. 앱과 다른 출처 iframe(https://richtradingschool.github.io/ptf-office/, 설계 3-2 §4.2) —
// 같은 출처면 그 안 스크립트가 앱의 기기 저장소(회원 인증·나중의 거래소 키)를 열 수 있다.
// sandbox는 자기 출처 저장소(모의 계좌)만 쓰게 하고 맨 위 창 이동·팝업·확인 창은 막는다(바깥 링크는 셸에 ptf:open으로 부탁).
// 처음 열 때 한 번만 만들고 탭을 바꿔도 지우지 않는다(모의 계좌·화면 유지). 인증 회원(s·j)은 &relay=1 주소로 새로 만든다(§4.5).
// 인터넷이 없으면 O-07 한 줄만 두고, 다시 연결되면 만든다. DOM은 createElement·textContent로만(CSP)
export const OFFICE_QUERY = '?embed=1&vertical=1&shell=1';
export const OFFICE_SANDBOX = 'allow-scripts allow-same-origin allow-forms';
export const OFFICE_OPEN_MS = 15000;
export const OFFICE_TEXT = Object.freeze({
  offline: '사무실 화면은 인터넷 연결이 필요합니다.', // O-07
  loading: '사무실 화면을 여는 중입니다.', // s·j판이 저장된 인증을 불러오는 동안(최대 5초)
  openFallback: '새 창이 열리지 않았다면 여기를 누르세요', // 바깥 링크 — 셸의 새 창이 막혔을 때 직접 누르는 링크
});

export function officeSrc(officeUrl, { relay = false } = {}) {
  const u = new URL(officeUrl);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`사무실 주소는 http(s)만: ${officeUrl}`);
  return `${u.origin}${u.pathname}${OFFICE_QUERY}${relay ? '&relay=1' : ''}`;
}

// onLoad(iframe): 그 iframe의 load마다(처음 열기·사무실 안 이동·새로 고침) — 셸이 준비를 풀고 ptf:office-ping을 보낸다(p34 §3.2)
export function createOffice({ panel, config, doc = document, win = window, onReplace = () => {}, onLoad = () => {} }) {
  let frame = null;
  let relay = false;
  let waitingOnline = false;
  let openBar = null;
  let openTimer = null;

  // 패널을 통째로 바꿀 때(iframe 새로 만들기·오프라인) 링크 줄도 같이 사라진다
  function clearOpen() {
    if (openTimer != null) win.clearTimeout(openTimer);
    openTimer = null;
    openBar = null;
  }

  function makeFrame() {
    const f = doc.createElement('iframe');
    f.className = 'office-frame';
    f.title = '사무실';
    f.setAttribute('sandbox', OFFICE_SANDBOX);
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.src = officeSrc(config.officeUrl, { relay });
    f.addEventListener('load', () => onLoad(f));
    return f;
  }

  function showOffline() {
    const note = doc.createElement('p');
    note.className = 'office-offline';
    note.textContent = OFFICE_TEXT.offline;
    clearOpen();
    panel.replaceChildren(note);
    if (waitingOnline) return;
    waitingOnline = true;
    win.addEventListener('online', () => {
      waitingOnline = false;
      if (!frame) mount();
    }, { once: true });
  }

  function mount() {
    if (frame) return frame;
    if (win.navigator && win.navigator.onLine === false) {
      showOffline();
      return null;
    }
    frame = makeFrame();
    clearOpen();
    panel.replaceChildren(frame);
    return frame;
  }

  // s·j판이 저장된 인증을 불러오는 동안(app.js가 최대 5초 뒤 mount) — 빈 칸 대신 한 줄
  function wait() {
    if (frame) return;
    const note = doc.createElement('p');
    note.className = 'office-wait';
    note.textContent = OFFICE_TEXT.loading;
    panel.replaceChildren(note);
  }

  // 사무실이 바깥 링크를 부탁하면(ptf:open — 셸이 허용 목록을 통과시킨 주소) 셸이 새 창을 연다. 그 새 창은 iframe 안 탭의 사용자
  // 활성화에 기대고(iOS 홈 화면 앱은 미확인) noopener라 막혔는지 알 수 없다 — 버튼이 조용히 죽지 않게 진짜 링크 한 줄을 잠깐 둔다
  // (부모 창에서 직접 누르는 링크는 막히지 않는다). iframe은 옮기지 않는다(옮기면 다시 불러와 모의 화면이 날아감) — 패널 끝에 붙이고
  // CSS(.office-open)로 아래쪽에 띄운다
  function showOpenLink(url) {
    if (!frame || typeof url !== 'string' || !url.startsWith('https://')) return;
    if (!openBar) {
      openBar = doc.createElement('p');
      openBar.className = 'office-open';
      panel.append(openBar);
    }
    const a = doc.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.textContent = OFFICE_TEXT.openFallback;
    openBar.replaceChildren(a);
    openBar.hidden = false;
    if (openTimer != null) win.clearTimeout(openTimer);
    openTimer = win.setTimeout(() => {
      openTimer = null;
      if (openBar) openBar.hidden = true;
    }, OFFICE_OPEN_MS);
  }

  // 인증·해제 — 값이 바뀔 때만. 이미 떠 있으면 옛 창을 알리고(onReplace — 셸이 준비 상태·중계를 끊음) 새 주소로 다시 만든다
  function setRelay(on) {
    const next = !!on;
    if (next === relay) return;
    relay = next;
    if (!frame) return;
    onReplace();
    frame = null;
    mount();
  }

  return { mount, wait, setRelay, showOpenLink, frame: () => frame, relay: () => relay };
}
