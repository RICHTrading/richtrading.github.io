// 휴대폰 환경 판별 — 설치 안내를 고르는 데만 쓴다(UA는 바꿀 수 있으니 보안 판단에 쓰지 않는다)
const IN_APP = [
  ['kakaotalk', /KAKAOTALK/i],
  ['instagram', /\bInstagram/i],
  ['facebook', /\bFB[\w_]+\/|\bFBAN|\bFBAV|\bFacebook/i],
  ['line', /\bLine\//i],
  ['naver', /NAVER\(inapp/i],
  ['band', /\bBAND\//i],
  ['daum', /DaumApps/i],
];

export function detectEnv({ ua = '', maxTouchPoints = 0, standalone = false, telegram = false, supportsAnchor = false } = {}) {
  const s = String(ua);
  const ipadDesktop = /Macintosh/.test(s) && maxTouchPoints > 1;
  const ios = /iPhone|iPod|iPad/.test(s) || ipadDesktop;
  const android = !ios && /Android/i.test(s);
  const os = ios ? 'ios' : android ? 'android' : 'other';

  let inApp = telegram ? 'telegram' : null; // 텔레그램은 UA 표시가 없어 전역 객체로만 안다
  if (!inApp) {
    for (const [name, re] of IN_APP) {
      if (re.test(s)) { inApp = name; break; }
    }
  }
  const otherIosBrowser = /CriOS\/|FxiOS\/|EdgiOS\//.test(s);
  if (!inApp && android && /;\s*wv\)/.test(s)) inApp = 'webview';
  if (!inApp && ios && !ipadDesktop && !otherIosBrowser && !/Safari\//.test(s)) inApp = 'webview';

  let browser = 'other';
  if (/SamsungBrowser\//.test(s)) browser = 'samsung';
  else if (/CriOS\//.test(s)) browser = 'crios';
  else if (/FxiOS\/|Firefox\//.test(s)) browser = 'firefox';
  else if (/EdgiOS\/|EdgA\/|Edg\//.test(s)) browser = 'edge';
  else if (ios && /Safari\//.test(s)) browser = 'safari';
  else if (/Chrome\//.test(s)) browser = 'chrome';
  else if (/Safari\//.test(s)) browser = 'safari';

  let iosMajor = null;
  let iosAmbiguous = false;
  if (ios) {
    const ver = /Version\/(\d+)/.exec(s);
    const osv = /OS (\d+)_(\d+)/.exec(s);
    if (ver && browser === 'safari') {
      iosMajor = Number(ver[1]); // Safari 주 버전 = iOS 주 버전
    } else if (osv) {
      const major = Number(osv[1]);
      const minor = Number(osv[2]);
      if (major === 18 && minor >= 6) {
        // iOS 26은 UA의 OS 값을 18_6 이후로 얼려 둔다 — Version이 없으면 18인지 26인지 모른다
        iosAmbiguous = true;
        iosMajor = supportsAnchor ? 26 : 18;
      } else {
        iosMajor = major;
      }
    } else if (ver) {
      iosMajor = Number(ver[1]);
    }
  }
  return { os, iosMajor, iosAmbiguous, browser, inApp, standalone: !!standalone };
}

export function readEnv(win = globalThis) {
  const nav = win.navigator || {};
  let standalone = false;
  try {
    standalone = !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true;
  } catch {
    standalone = false;
  }
  let supportsAnchor = false;
  try {
    supportsAnchor = !!(win.CSS && win.CSS.supports && win.CSS.supports('anchor-name: --a'));
  } catch {
    supportsAnchor = false;
  }
  const telegram = 'TelegramWebview' in win || 'TelegramWebviewProxy' in win || 'TelegramWebviewProxyProto' in win;
  return detectEnv({ ua: nav.userAgent || '', maxTouchPoints: nav.maxTouchPoints || 0, standalone, telegram, supportsAnchor });
}
