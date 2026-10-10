// 트레이딩 탭 판단·문구(spec §2·§3·§4.8·§8.1) — DOM 없는 순수 함수. 아래쪽 '주문 칸'은 2e 수동 주문(계획 Task 25, p40 T11),
// 맨 아래 '판정 상자'(verdictModel·detailRows — spec §6·N 문구, p40 T12)는 주문 칸과 따로.
import { STD_DEFAULT, STD_KEYS, fmtPrice } from './indicators.js';
import { AUTO_SL_TEXT, autoSlDue, autoSlWord } from './auto-sl.js';
import { KTEXT } from './keys.js';
import { stageOf, entryFills } from './manual-store.js';
import { fmtHM } from './auto-view.js';

export const TF_KEYS = Object.freeze(['5m', '15m', '1h']);
export const TF_LABEL = Object.freeze({ '5m': '5m', '15m': '15m', '1h': '1H' }); // T-03
export const STD_LABELS = Object.freeze({ ma20: 'MA20', ma50: 'MA50', ma200: 'MA200', ema20: 'EMA20', bb: '볼린저', vol: '거래량', rsi: 'RSI', macd: 'MACD' });
export const CUSTOM_KEYS = Object.freeze(['bigs', 'tpsl', 'delta', 'vp', 'follow']);
export const CUSTOM_LABELS = Object.freeze({ bigs: '빅세일즈', tpsl: 'TP/SL가이드', delta: '델타', vp: 'VP박스', follow: '리치 지표' });
export const SUB_LABELS = Object.freeze({ rsi: 'RSI 14', macd: 'MACD 12·26·9', delta: '델타 거래량' }); // T-05
export const IND_DEFAULT_ALL = Object.freeze({ ...STD_DEFAULT, bigs: false, tpsl: false, delta: false, vp: false, follow: false });
// 대표 지표 파일을 못 불러왔을 때 설명줄(켜진 칩이 아무것도 그리지 않는 이유를 숨기지 않음 — 다시 켜면 다시 시도)
export const indFailText = (key) => `${CUSTOM_LABELS[key] || key} 불러오지 못함`;
// T-08 — 마지막 낱말은 https://www.tradingview.com/ 링크, 그 아래 T-15 NOTICE 줄(attributionLogo:false의 조건 — 라이브러리 README)
export const SOURCE_PARTS = Object.freeze({ text: '봉 이력: 해외 거래소 공개 시세(오렌지엑스와 조금 다를 수 있음) · 실시간 가격: 오렌지엑스 · 차트: ', link: Object.freeze({ text: 'TradingView Lightweight Charts™', href: 'https://www.tradingview.com/' }) });
export const SOURCE_LINE = `${SOURCE_PARTS.text}${SOURCE_PARTS.link.text}`;
export const NOTICE_LINE = 'TradingView Lightweight Charts™ Copyright (с) 2024 TradingView, Inc. https://www.tradingview.com/'; // app/vendor/NOTICE 두 줄을 한 줄로(원문 그대로 — с는 U+0441)
export const tabLabel = (tab, rules) => `${tab === 'stock' ? '주식' : '코인'} ${rules.tabs[tab].lev}×`;
export const mineChipText = ({ symbol, side }) => `내 포지션 ${symbol} ${side === 'long' ? '롱' : '숏'}`;
export const BACKTEST_HEAD = 'GUIDE 백테스트';
export const IND_HELP = '지표와 표시(매수·익절·Buy·Sell·TP·SL 등)는 이 기기가 차트 봉으로 계산한 참고 표시입니다. 매매 권유가 아닙니다.'; // T-07
const STATE = { loading: '불러오는 중', down: '시세 연결 안 됨', stale: '봉 갱신 지연', nolive: '실시간 시세 없음' };
const customOn = (rules) => !!(rules && rules.indicators && rules.indicators.custom);

export const chipDefs = (rules) => [
  ...STD_KEYS.map((key) => ({ key, label: STD_LABELS[key], group: 'std' })),
  ...(customOn(rules) ? CUSTOM_KEYS.map((key) => ({ key, label: CUSTOM_LABELS[key], group: 'custom' })) : []),
];
export const indsKey = (ed) => `ptf-${ed}-inds-v1`;
export function loadInds(storage, ed, rules) {
  const out = { ...IND_DEFAULT_ALL };
  try {
    const saved = JSON.parse(storage.getItem(indsKey(ed)) || 'null');
    if (saved && typeof saved === 'object') for (const k of Object.keys(out)) if (typeof saved[k] === 'boolean') out[k] = saved[k];
  } catch {
    // 저장소가 막힘·글자가 깨짐 — 기본값
  }
  if (!customOn(rules)) for (const k of CUSTOM_KEYS) out[k] = false;
  return out;
}
export function saveInds(storage, ed, inds) {
  try { storage.setItem(indsKey(ed), JSON.stringify(inds)); } catch { /* 저장 못 함 — 이번 화면만 */ }
}

// 기기 저장 ptf-<판>-trade = { tab, sym: { coin, stock }, tf }(spec §2.1 — 기본 coin·BTC·5m). 감시 목록 밖 종목·모르는 칸은 버린다
export const viewKey = (ed) => `ptf-${ed}-trade`;
export function loadView(storage, ed, rules) {
  const coin = rules ? rules.tabs.coin.watch : ['BTC'];
  const stock = rules ? rules.tabs.stock.watch : [];
  const out = { tab: 'coin', sym: { coin: coin.includes('BTC') ? 'BTC' : coin[0] || 'BTC', stock: stock[0] || null }, tf: '5m' };
  try {
    const saved = JSON.parse(storage.getItem(viewKey(ed)) || 'null');
    if (saved && typeof saved === 'object') {
      if (saved.sym && coin.includes(saved.sym.coin)) out.sym.coin = saved.sym.coin;
      if (saved.sym && stock.includes(saved.sym.stock)) out.sym.stock = saved.sym.stock;
      if (TF_KEYS.includes(saved.tf)) out.tf = saved.tf;
      if (saved.tab === 'stock' && stock.length && out.sym.stock) out.tab = 'stock';
    }
  } catch {
    // 저장소가 막힘·글자가 깨짐 — 기본값
  }
  return out;
}
export function saveView(storage, ed, view) {
  try { storage.setItem(viewKey(ed), JSON.stringify({ tab: view.tab, sym: { coin: view.sym.coin, stock: view.sym.stock }, tf: view.tf })); } catch { /* 이번 화면만 */ }
}

export const needsLong = (inds) => !!(inds.tpsl || inds.vp);
export const instOf = (sym) => `${sym}-USDT-PERPETUAL`;
// 상태줄에 보일 상태: 허브 봉은 받는데 실시간 종목이 없으면(instruments에 없거나 active 아님·못 받음) '실시간 시세 없음'(spec §3.3). live = true | false | null(아직 모름)
export function chartState(feedState, live) {
  const s = feedState || 'loading';
  return s === 'live' && live === false ? 'nolive' : s;
}
export function statusLine({ sym, tf, state, px }) {
  const head = `${sym}/USDT · 오렌지엑스 · ${String(tf).toUpperCase()} · `;
  if (state === 'live') return `${head}실시간${Number.isFinite(px) ? ` · ${fmtPrice(px)}` : ''}`;
  return head + (STATE[state] || STATE.loading);
}
export const initialVisibleBars = (width) => Math.max(50, Math.min(180, Math.floor(width / 6)));
export const subPanes = (inds) => ['rsi', 'macd', 'delta'].filter((k) => inds[k]);

// 봉 전체를 다시 넣은 뒤 보이는 범위(spec §3.1 ①): 처음·종목·시간 단위 변경(reset)이면 최근 봉(폭/6개 + 미래 6칸).
// 그 밖(긴 모드 3,200봉으로 다시 받기·숨었다 10분 뒤 다시 받기·600 → 400 자르기)은 오른쪽 끝을 보던 중이면 끝 기준 그대로(새 봉을 따라감),
// 지난 봉을 보던 중이면 왼쪽 끝 봉의 시각을 새 자료에서 찾아 같은 봉이 보이게. 그 봉이 없으면 최근 봉으로
export function keepRange({ reset, range, oldTimes, newTimes, width }) {
  const n = newTimes.length;
  const recent = () => ({ from: Math.max(0, n - initialVisibleBars(width)), to: n + 6 });
  if (reset || !range || !oldTimes.length || !n) return recent();
  const shift = (d) => ({ from: range.from + d, to: range.to + d });
  if (range.to >= oldTimes.length - 1) return shift(n - oldTimes.length);
  const i = Math.max(0, Math.min(oldTimes.length - 1, Math.floor(range.from)));
  const j = newTimes.indexOf(oldTimes[i]);
  return j < 0 ? recent() : shift(j - i);
}

// 10초 갱신·실시간 틱 뒤 캔들 시리즈를 맞추는 방식: 보이던 봉과 앞(첫 봉 시각)·길이가 이어지면 보이던 마지막 봉부터 update
// (마감된 그 봉의 마지막 값 + 새 봉 — N tick이 바뀐 봉마다 update, chart:165-171), 앞이 잘렸거나(600 → 400) 이어지지 않으면 setData
export function planUpdate(shown, bars) {
  const k = shown.length - 1;
  if (k < 0 || !bars.length || bars.length < shown.length || bars[0].t !== shown[0] || bars[k].t !== shown[k]) return { kind: 'set' };
  return { kind: 'update', from: k };
}

// ── 주문 칸(2e 수동 주문 — spec 4판 §2.2·§5·§5.9·§5.13·§8.1 M, 계획 Task 25 · p40 T11) ──
// 판정 상자(verdictModel·detailRows·N 문구)는 따로(p40 T12). 자동 손절 낱말·문구는 공용 auto-sl.js 그대로(따라가기와 같은 글).
// 잔고 배지 M-02('사용 가능 {N} USDT')는 없다 — CEO 2026-10-10: 상단 띠(#strip)가 잔고를 늘 보인다. 시험 토큰의 기준 잔고 상한 줄만 남긴다.
// 수량 계산을 설명하는 줄(M-04·M-10의 '사용 가능 {y} USDT')은 주문 칸이 그 계산 값으로 그린다.
export const CONSENT_V = 'manual-2026-10-08b';
export const END_SHOW_MS = 12000;
export const MTEXT = Object.freeze({
  m01: '주문 · 오렌지엑스 실계좌',
  m02test: (n) => `시험용: 기준 잔고 ${n} USDT 상한`,
  m03sl: '손절은 자동 손절(4차 진입 뒤 — 1~3차에는 손절 없음)',
  m04note: '[진입]을 누르면 오렌지엑스에 시장가로 실제 주문이 나가고, 익절가(+10%)는 자동으로 설정됩니다. 주문은 회원님 계정에서 회원님 키로 나갑니다.',
  m04cfg: (lev) => `이 종목의 오렌지엑스 마진·배율 설정을 격리·${lev}×로 바꾸며, 정리한 뒤에도 그 설정은 그대로 남습니다.`,
  m05: (sym, need, have) => `잔고가 부족합니다. ${sym}는 최소 주문 단위가 커서 사용 가능 잔고가 약 ${need} USDT 이상 필요합니다. 지금은 ${have} USDT입니다.`,
  m06: (w) => `잔고가 작아 이 종목의 최소 주문 수량에 맞췄습니다(비중 약 ${w}%).`,
  m08on: '지금은 손절이 없습니다 — 자동 손절은 4차 진입 뒤에 걸립니다.',
  m08off: '자동 손절이 꺼져 있어 손절이 없습니다.',
  m10note: '[추가 진입]을 누르면 오렌지엑스에 바로 시장가 주문이 나갑니다.',
  m10cap: '100%는 사용 가능 잔고의 95%까지입니다(거래 비용·가격 변동 여유).',
  m11: '비중은 1~100% 사이로 넣어 주세요.',
  m12note: '가격이 익절가에 닿으면 포지션이 전량 정리됩니다. 오렌지엑스에 걸어 두는 주문이라 앱을 꺼도 동작합니다.',
  m14: (up) => `익절가는 지금 가격보다 ${up ? '높아야' : '낮아야'} 합니다`,
  m15note: '이 앱이 건 익절·자동 손절 주문은 함께 취소됩니다. 오렌지엑스 앱에서 직접 건 주문은 그대로 남습니다.',
  // 정리는 됐지만 이 앱이 건 익절 주문 취소가 거래소에 닿았는지 확인하지 못함(검토 2 — 끝난 기록 tpLeft, 정리 주기가 다시 취소)
  m15left: "포지션을 정리했습니다. 다만 이 앱이 건 익절 주문 취소를 아직 확인하지 못해 다시 취소하는 중입니다 — 오렌지엑스 앱 '조건 주문'에서도 확인하세요.",
  m17store: '기록을 읽지 못했습니다 — 잠시 뒤 다시 해 주세요.',
  m17nostore: '이 기기에서는 주문 기록을 저장할 수 없어 실주문을 쓸 수 없습니다.', // spec §5.7(434) — 메모리 저장소(사생활 보호 모드)
  m18: '익절가 변경은 이 앱에서 아직 할 수 없습니다 — 필요하면 오렌지엑스 앱에서 바꾸세요. 진입 때 건 익절(+10%)은 거래소에 걸려 있습니다.',
  m19stale: "이전 매매의 보호 주문이 남아 있어 진입하지 않았습니다 — 오렌지엑스 앱 '조건 주문'에서 확인하세요.",
  m19price: '시세 확인 중 — 잠시 뒤 다시 눌러 주세요',
  m20follow: '따라가기로 연 포지션입니다 — 추가 진입·익절·자동 손절은 따라가기가 관리합니다. 여기서는 정리만 할 수 있고, 정리하면 따라가기에서 빠집니다.',
  m20outside: '이 기기 기록에 없는 포지션입니다(오렌지엑스 앱이나 다른 기기에서 연 것) — 여기서는 정리만 할 수 있습니다.',
  m21: Object.freeze({ tp: '익절 체결 ✅', sl: '자동 손절 체결', close: '포지션 정리', gone: '포지션이 거래소에서 닫혔습니다(익절·손절·청산 중 하나 — 오렌지엑스 앱에서 확인)' }),
  m23: '이 화면은 2·3·4차 진입 시점을 알려 주지 않습니다 — 추가 진입은 직접 판단해 누르세요.',
  m24: '인증이 풀려 새 주문은 할 수 없습니다. 열린 포지션은 정리할 수 있습니다.',
  m25: '이 주문 칸은 회원님이 직접 고른 주문을 회원님 오렌지엑스 계정에서 회원님 키로 내는 도구입니다. 무엇을 언제 얼마나 주문할지는 회원님이 정합니다. 원금 손실이 날 수 있고 높은 배율에서는 증거금 전부를 잃을 수 있습니다. 하루 손실 한도 같은 자동 제한은 없습니다. 리치 서버가 꺼져 있거나 연결이 끊기면 이 앱에서 주문·정리를 못 할 수 있으니 그때는 오렌지엑스 앱에서 직접 확인·정리하세요.',
  m29relay: '리치 서버에 연결되지 않아 이 앱에서 주문·정리를 할 수 없습니다 — 오렌지엑스 앱에서 직접 확인·정리하세요.',
  m29ws: '리치 서버에 연결되지 않아 새 주문은 할 수 없습니다. 정리는 할 수 있습니다.',
  m30tp: '익절 주문이 거래소에 없을 수 있습니다 — "다시 걸기"를 누르거나 오렌지엑스 앱에서 확인하세요.',
  m30tpUnknown: '익절 확인 안 됨',
  // M-19 종목 줄 — 주문 가능 종목은 회원 상태 manual.symbols(허브가 정함)
  symbolOff: (list) => {
    const names = [].concat(list ?? []).filter((x) => x !== null && x !== undefined && x !== '').map(String);
    return names.length ? `이 종목은 주문할 수 없습니다 · 주문 가능 종목: ${names.join(', ')}` : '이 종목은 주문할 수 없습니다';
  },
  connect: '오렌지엑스 연결이 필요합니다.',
  loading: '계정 확인 중…',
  t13: '실주문은 담당자에게 받은 모바일 버전에서 UID 인증과 오렌지엑스 연결 뒤 쓸 수 있습니다.',
  t13link: '카카오로 문의하기',
  // 판정 상자(spec 4판 §6·§8.1 N — p40 T12). N-02 줄은 verdictModel이 만든다. 2판 N-12(운영 측 계정 매매)는 없다
  verdictLabel: '판정',
  n03: '근거 보기 ▾',
  n04: (sym, t, v) => `이 종목의 최근 분석이 없습니다 · 최신: ${sym} ${t} ${v}`,
  n05: '판정 없음 — 리치 서버 AI의 분석 결과를 아직 받지 못했습니다.',
  n06: (sym) => `리치 서버 AI가 ${sym}를 분석하는 중입니다 — 끝나면 여기에 나옵니다.`,
  n07: '휴대폰에서는 분석을 새로 실행하지 않습니다. 리치 서버 AI가 마지막으로 끝낸 분석만 보여 주며, 시간이 지난 결과일 수 있습니다.',
  n08: (h) => `${h}시간 전 분석입니다 — 지금 시장과 다를 수 있습니다.`,
  n09: (sym, t) => `${sym} · ${t} 분석 근거`, // N-09 상세 시트 제목
  n09fail: '근거를 불러오지 못했습니다 — 잠시 뒤 다시 눌러 주세요.', // 근거 보기 실패(판정 줄은 그대로 — N-05 판정 없음과 다름, 검토 9)
  n10: '불특정 다수에게 같은 내용으로 제공하는 투자 참고 정보이며 개별 투자 상담이 아닙니다. 투자 판단과 손익은 본인에게 있습니다.',
  n11off: 'UID 인증 후 AI 최신 분석이 열립니다.',
  n11on: 'UID 인증 후 AI 최신 분석과 주문 칸이 열립니다.',
  n13: (m) => `레벨 숨김 — 오래된 분석(${m}분 전)`,
  close: '닫기',
});

// 사유 → 문장(M-17·M-19). 내부 낱말(blocked·ox:·_)을 그대로 보이지 않는다
const REASON = Object.freeze({
  busy_window: '다른 창에서 주문 중입니다',
  checking: '결과를 확인하는 중입니다…',
  changed: '값이 바뀌었습니다 — 확인하고 다시 눌러 주세요',
  has_position: '이미 이 종목에 포지션이 있습니다',
  foreign_orders: '이 종목에 오렌지엑스 앱에서 건 미체결 주문이 있어 새로 진입할 수 없습니다 — 오렌지엑스 앱에서 확인하세요',
  stale_orders: MTEXT.m19stale,
  auto_sl_check: AUTO_SL_TEXT.checkNeeded,
  pos_changed: '포지션이 바뀌어 주문하지 않았습니다 — 다시 확인해 주세요',
  cfg_changed: '오렌지엑스 앱에서 배율·마진 방식이 바뀌어 추가 진입을 막았습니다',
  symbol_off: '이 종목은 주문할 수 없습니다',
  no_price: MTEXT.m19price,
  no_funds: '주문에 쓸 잔고가 없어 주문하지 않았습니다',
  below_min: '금액이 너무 작아 이 종목의 최소 주문 수량에 못 미칩니다',
  not_listed: '이 종목은 지금 오렌지엑스에서 주문할 수 없습니다',
  lev_denied: KTEXT.levDenied,
  margin_cfg: '이 종목의 마진·배율 설정을 바꾸지 못해 주문하지 않았습니다 — 오렌지엑스 앱에서 이 종목의 주문·포지션을 확인하세요',
  hidden: '앱이 화면에서 벗어나 주문하지 않았습니다',
  unknown: '주문 결과를 확인하지 못했습니다 — 오렌지엑스 앱에서 확인해 주세요(같은 주문을 다시 보내지 않았습니다).',
  not_filled: '주문이 체결되지 않았습니다 — 오렌지엑스 앱에서 확인해 주세요',
  close_failed: '정리하지 못했습니다. 오렌지엑스에서 직접 확인해 주세요.',
  tp_dir: '익절가가 지금 가격의 반대쪽입니다',
  locked: AUTO_SL_TEXT.offLocked,
  no_record: '이 기기 기록에서 이 매매를 찾지 못했습니다 — 다시 확인해 주세요',
  no_cond: MTEXT.m18,
  bad_pct: MTEXT.m11,
  store: MTEXT.m17store,
  nostore: MTEXT.m17nostore,
  'blocked:off': '지금은 새 주문을 받지 않습니다(운영 중지) — 열린 포지션 정리는 할 수 있습니다',
  'blocked:test_only': '시험 기간이라 시험용 인증에서만 주문할 수 있습니다',
  'blocked:app_version': '앱을 업데이트해야 주문할 수 있습니다',
  'blocked:test_cap': '시험용 주문 한도를 넘었습니다',
  'blocked:grace': MTEXT.m24,
});
const DOWN_TEXT = '주문을 넣지 못했습니다 — 잠시 뒤 다시 해 주세요';
export function reasonText(reason) {
  const r = typeof reason === 'string' ? reason : '';
  if (Object.hasOwn(REASON, r)) return REASON[r];
  if (r.startsWith('ox:')) return `주문을 넣지 못했습니다 — 거래소 오류(코드 ${/^[\w.-]{1,24}$/.test(r.slice(3)) ? r.slice(3) : '?'})`;
  if (r.startsWith('blocked:')) return REASON['blocked:off'];
  return DOWN_TEXT;
}
// '확인했습니다'(자동 손절 정리 확인 — keeper confirmInst: 포지션부터) 결과 → 문장(p35 §5.3 고침 2)
const CLEAR = Object.freeze({ has_position: AUTO_SL_TEXT.clearHasPos, still_open: AUTO_SL_TEXT.clearStillOpen, error: AUTO_SL_TEXT.clearError });
export function clearText(reason) {
  if (Object.hasOwn(CLEAR, String(reason))) return CLEAR[reason];
  if (reason === 'busy_window') return reasonText(reason);
  return AUTO_SL_TEXT.clearError;
}

// 알림 기록 한 줄(spec §2.1 ⑪·M-16·M-21) — 기록의 키를 한국어 문장으로. 내부 낱말(entry·add·asl·fail:·unclear·filled·end_)을 그대로 보이지 않는다(검토 19·32)
const SIDE_WORD = Object.freeze({ long: '롱', short: '숏' });
export function logText(e) {
  const x = e && typeof e === 'object' ? e : {};
  const sym = typeof x.symbol === 'string' && x.symbol ? `${x.symbol} ` : '';
  const arg = x.arg && typeof x.arg === 'object' ? x.arg : {};
  switch (x.key) {
    case 'entry1': {
      const sd = Object.hasOwn(SIDE_WORD, String(arg.side)) ? `${SIDE_WORD[arg.side]} ` : '';
      return { icon: '▶', text: `${sym}${sd}1차 진입 · 체결 ${Number.isFinite(arg.price) ? fmtPrice(arg.price) : '—'}` };
    }
    case 'add': return { icon: '▶', text: `${sym}${Number.isInteger(arg.stage) ? `${arg.stage}차` : '추가'} 진입 · 체결` };
    case 'tp_changed': return { icon: '✅', text: `${sym}익절가를 변경했습니다` };
    case 'tp_fail': return { icon: '■', text: `${sym}${MTEXT.m30tp}` };
    case 'asl_set': return { icon: '■', text: `${sym}4차 진입 뒤 자동 손절을 걸었습니다` };
    case 'asl_on': return { icon: '■', text: AUTO_SL_TEXT.toastOn };
    case 'asl_off': return { icon: '■', text: AUTO_SL_TEXT.toastOff };
    case 'asl_fail': case 'asl_no_room': return { icon: '■', text: `${sym}자동 손절 주문을 걸지 못했습니다` };
    case 'asl_stale': return { icon: '■', text: `${sym}자동 손절 주문을 바꾸는 횟수를 넘어 이전 주문을 그대로 두었습니다` };
    case 'asl_unclear': return { icon: '■', text: `${sym}자동 손절 주문 결과를 확인하지 못했습니다 — 오렌지엑스 앱에서 확인하세요` };
    case 'asl_left': return { icon: '■', text: `${sym}이 앱이 건 자동 손절 주문이 거래소에 남아 있을 수 있습니다 — 오렌지엑스 앱에서 확인하세요` };
    case 'entry_fail': return { icon: '■', text: `${sym}${reasonText(typeof x.arg === 'string' ? x.arg : 'down')}` };
    case 'detached': return { icon: '■', text: `${sym}${MTEXT.m20outside}` };
    case 'end_tp': return { icon: '✅', text: MTEXT.m21.tp };
    case 'end_sl': return { icon: '■', text: MTEXT.m21.sl };
    case 'end_close': return { icon: '■', text: MTEXT.m21.close };
    case 'tp_left': return { icon: '■', text: `${sym}이 앱이 건 익절 주문 취소를 확인하지 못했습니다 — 다시 취소합니다. 오렌지엑스 앱 '조건 주문'에서도 확인하세요` };
    default: return { icon: '■', text: MTEXT.m21.gone };
  }
}

// 주문 칸 상태(spec §2.2 — 앞 조건이 우선). ctx = { ed, member, grace, graceOpen, keysCapable, tradeReady, durable, rulesOk, keyStatus, keyPending, manual, symbol }
//   none: 키 자격(keysCapable)이 없거나, 판이 tradeReady가 아닌데 실제 회원(spec §1.3 — tradeReady:false인 동안 주문 칸은 시험 토큰에게만, 검토 5).
//     keysCapable은 autoReady(따라가기)로도 참이라 그것만으로는 주문 칸을 열지 않는다(안내 tradeOpenFor와 같은 조건)
//   durable: 장부를 쓸 오래가는 저장소(vault.kind 'idb') — 아니면 nostore(spec §5.7, 보안 규칙 14·17)
//   rulesOk: config.tradeRules와 따라가기 규칙(자동 손절 값 — rulesOf) 둘 다 — 아니면 norules(칸을 그리지 않음, none처럼)
//   keyStatus: keys.js 상태(none·checking·ok·bad·lost·down·cleanup) 그대로 — 'ready'(keys.ready())도 받음. keyPending = 키 확인 중
const KEY_CONNECT = Object.freeze(['none', 'bad', 'lost']);
const KEY_OK = Object.freeze(['ok', 'ready']);
export function tradePanelState(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  if (c.ed === 'pub') return 'pub';
  if (!c.member && c.grace && c.graceOpen) return 'grace';
  if (!c.member) return 'verify';
  if (!c.keysCapable || !(c.tradeReady === true || c.member.test === true)) return 'none';
  if (c.durable !== true) return 'nostore';
  if (!c.rulesOk) return 'norules';
  if (KEY_CONNECT.includes(c.keyStatus)) return 'connect';
  if (c.keyPending === true || !KEY_OK.includes(c.keyStatus)) return 'loading';
  if (!c.manual || c.manual.enabled !== true) return 'blocked';
  if (!Array.isArray(c.manual.symbols) || !c.manual.symbols.includes(c.symbol)) return 'symbol_off';
  return 'ready';
}
// 상태별 한 줄(카드 위). verify(칸 없음 — 'UID 인증하기'는 ⚡ 오토 모드 카드에 하나, N-11은 판정 상자에 한 번)·none·norules(칸 없음)·pub(T-13은 tradeNotice일 때 칸이)·ready는 줄 없음
export function panelLine(state, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  switch (state) {
    case 'grace': return MTEXT.m24;
    case 'nostore': return MTEXT.m17nostore;
    case 'connect': return MTEXT.connect;
    case 'loading': return c.keyStatus === 'down' ? KTEXT.down : MTEXT.loading;
    case 'blocked': return reasonText(`blocked:${(c.manual && c.manual.reason) || 'off'}`);
    case 'symbol_off': return MTEXT.symbolOff(c.manual && Array.isArray(c.manual.symbols) ? c.manual.symbols : []);
    default: return null;
  }
}
// 시험 토큰의 기준 잔고 상한 줄(M-02 시험 꼴) — 값은 회원 상태 manual.limits.maxBase(코드에 박지 않음). 실제 회원·값 없음이면 null
export function capLine(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const n = c.manual && c.manual.limits ? c.manual.limits.maxBase : null;
  if (!c.member || c.member.test !== true || typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return MTEXT.m02test(n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
}

// 조건 모드면 익절가 = 미체결 ptf.<mid>.t<k>의 trigger_price(가장 큰 k), 없거나 첨부 모드면 포지션 take_profit_price(검토 13·28)
const TP_TAIL = /\.t([1-9]\d{0,2})$/;
export function positionView({ pos, orders = [], mid, cond } = {}) {
  if (!pos) return null;
  if (!cond) return { ...pos };
  const pre = `ptf.${mid}.t`;
  let best = null;
  let bestK = 0;
  for (const x of Array.isArray(orders) ? orders : []) {
    const id = x && x.custom_order_id;
    const m = typeof id === 'string' && id.startsWith(pre) ? TP_TAIL.exec(id) : null;
    if (m && Number(m[1]) > bestK) { bestK = Number(m[1]); best = x; }
  }
  const tp = best ? Number(best.trigger_price) : NaN;
  return { ...pos, tp: Number.isFinite(tp) && tp > 0 ? tp : pos.tp || null };
}

// 카드(M-07 — 청산가 줄 없음, N과 같음). a = { on, turningOff, afterStage, pending? }(pending = 이 매매의 자동 손절 주문이 기기 목록에 남음, 없으면 turningOff)
// 자동 손절 낱말 = 공용 autoSlWord(차수 = 체결로 센 진입 줄 — manual-store stageOf). 다시 걸기 = 켜짐·4차·unclear|failed|none(+ 조건 익절 unknown)
const RETRY_SL = Object.freeze(['unclear', 'failed', 'none']);
const pctSigned = (x) => `${x >= 0 ? '+' : ''}${x}%`;
export function cardModel({ rec, pos, px, autoSl: a, cond }) {
  const fills = entryFills(rec);
  const k = fills.length;
  const dir = rec.side === 'long' ? 1 : -1;
  const fmt = (x) => (Number.isFinite(x) ? fmtPrice(x) : '—');
  const avg = pos && pos.avg > 0 ? pos.avg : null;
  const tpPct = pos && pos.tp > 0 && avg ? Math.round(dir * (pos.tp / avg - 1) * rec.lev * 1000) / 10 : null;
  const sl = rec.autoSl && typeof rec.autoSl === 'object' ? rec.autoSl : null;
  const slState = sl && typeof sl.state === 'string' ? sl.state : 'none';
  const due = autoSlDue(k, a.afterStage);
  const word = autoSlWord({ state: rec.state, sigStage: stageOf(rec), autoSl: sl }, { on: a.on, afterStage: a.afterStage, pending: !!(a.pending ?? a.turningOff) });
  const warns = [];
  if (a.turningOff) warns.push(AUTO_SL_TEXT.turningOff);
  else if (!a.on) warns.push(MTEXT.m08off);
  else if (!due) warns.push(MTEXT.m08on);
  else if (slState === 'failed') warns.push(AUTO_SL_TEXT.failed);
  else if (slState === 'unclear' || slState === 'none') warns.push(AUTO_SL_TEXT.retryHelp);
  let retry = a.on === true && due && RETRY_SL.includes(slState);
  const tpUnknown = !!cond && !!rec.tp && rec.tp.state === 'unknown';
  if (tpUnknown) { warns.push(MTEXT.m30tp); retry = true; }
  const weights = fills.map((f, i) => (Number.isFinite(Number(f.pct)) && f.pct !== null ? `${i + 1}차 ${Math.round(Number(f.pct))}%` : `${i + 1}차`)).join(' · ');
  return {
    title: `${rec.symbol}/USDT · ${k ? `시장가 ${k}차 진입${k > 1 ? ' 완료' : ''}` : '시장가 1차 진입 확인 중'}`,
    left: [['포지션', SIDE_WORD[rec.side] || '—'], ['마진', '격리'], ['레버리지', `${rec.lev}×`], ['비중', weights || '—']],
    right: [[k > 1 ? '평단가' : '진입가', fmt(avg), 'val'], ['익절가', pos && pos.tp > 0 ? `${fmt(pos.tp)}${tpPct === null ? '' : ` (${pctSigned(tpPct)})`}` : (tpUnknown ? MTEXT.m30tpUnknown : '익절 없음'), 'tp']],
    pnl: { pct: avg && Number.isFinite(px) && px > 0 ? dir * (px / avg - 1) * rec.lev * 100 : null, usdt: pos && Number.isFinite(pos.upl) ? pos.upl : null, cur: Number.isFinite(px) && px > 0 ? px : null, avg },
    autoSl: word,
    warns,
    retry,
    closeOnly: rec.state !== 'open', // '분리됨'(spec §5.9) — 정리만, M-20 둘째 줄
    note: rec.state === 'detached' ? MTEXT.m20outside : null,
  };
}

// 끝난 매매(12초 — N t:416-422). symbol을 주면 그 종목의 마지막 끝만
export function endedRecent(ended, now, symbol = null) {
  const list = Array.isArray(ended) ? ended : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i];
    if (!e || (symbol && e.symbol !== symbol)) continue;
    return Number.isFinite(e.closedAt) && now - e.closedAt <= END_SHOW_MS ? e : null;
  }
  return null;
}
// 4 상태(M-34)
export function stateLine({ rec, pos, ended = [], now = Date.now(), symbol = null }) {
  if (rec && pos) return rec.closing ? '● 포지션 정리 중' : `● 포지션 보유 중 · ${stageOf(rec)}차 진입`;
  const e = endedRecent(ended, now, symbol);
  if (e) return `■ 매매 종료 — ${Object.hasOwn(MTEXT.m21, String(e.end)) ? MTEXT.m21[e.end] : MTEXT.m21.gone}`;
  return '● 대기';
}

// 처음 쓸 때 4항목(M-26 — 4판: 배율 줄과 자동 손절 줄을 다른 항목으로, cond와 무관한 한 꼴). 기록 꼴 { v: CONSENT_V, at, ed, rulesVersion, textHash, appVersion }
export function consentLines({ rules }) {
  return [
    '주문은 제가 직접 누를 때만, 제 오렌지엑스 계정에서 제 키로 나갑니다. 분석·지표는 참고 정보이고 주문을 대신 정하지 않습니다.',
    `주문은 시장가·격리·배율 코인 ${rules.tabs.coin.lev}× · 주식 ${rules.tabs.stock.lev}×로 나가고, 그 종목의 오렌지엑스 마진·배율 설정이 바뀌어 남습니다.`,
    '1~3차 동안은 손절이 없습니다. 자동 손절을 켜 두면 4차 진입 뒤 청산가 바로 앞에 손절 주문이 걸리고, 그 가격은 화면에 보이지 않습니다.',
    '원금 손실이 날 수 있고 높은 배율에서는 증거금 전부를 잃을 수 있으며, 앱·서버·거래소 오류로 주문이 늦거나 빠질 수 있습니다. 리치 서버가 꺼지면 이 앱에서 정리를 못 할 수 있어 오렌지엑스 앱에서 직접 정리해야 합니다.',
  ];
}

// ── 판정 상자(spec 4판 §6·§8.1 N-02~N-13 — 계획 Task 25 판정 부분, p40 T12) ──
// 입력은 셸이 가진 공개 최신 분석(analysis-shape.js parseLatest 값 — { up, stale, off, analysis, autopilot, bySymbol, levelsMaxMin, sched }, ok 칸 없음)과
// 상세(parseItem 값 — Analysis). 문장은 우리 앱 원문 그대로이고, 셸 화면 규칙상 '대표'가 든 문장(직원 말은 그 말풍선째)만 뺀다.
// 주문 칸과 떨어뜨린다 — 판정 방향으로 주문을 만들거나 미리 채우는 값은 내지 않는다(§6, 변호사 질문 13).
export const VERDICT_STALE_H = 6; // N-08(spec staleHours)
export const LEVELS_MAX_MIN = 60; // 허브 levelsMaxMin이 없을 때(spec §6 기본 60분)
const BOSS_RE = /대표/;
// '대표'가 든 문장만 뺀 글('' = 남는 문장 없음). 문장 끝은 . ! ? 。 … 또는 줄바꿈
function noBoss(s) {
  if (typeof s !== 'string') return '';
  if (!BOSS_RE.test(s)) return s;
  return s.split(/(?<=[.!?。…])\s+|\n+/).filter((x) => x.trim() && !BOSS_RE.test(x)).join(' ').trim();
}
// 화면에 쓰는 종목 이름 — 분석 display(이름 칸에 '대표'가 있으면 종목 코드)
export const analysisName = (x) => (typeof x.display === 'string' && x.display && !BOSS_RE.test(x.display) ? x.display : x.symbol);
// 판정 낱말(N-02): bias LONG·SHORT 그대로, PASS → 관망, 없으면 action 원문(BUY·SELL·HOLD)
export function verdictWord(h) {
  const x = h && typeof h === 'object' ? h : {};
  if (x.bias === 'LONG' || x.bias === 'SHORT') return x.bias;
  if (x.bias === 'PASS') return '관망';
  return typeof x.action === 'string' ? x.action : '';
}
// 판정 낱말 + 확신도(정수일 때만 %) — 둘 다 없으면 —
function verdictValue(h) {
  const c = h && Number.isInteger(h.confidence) ? `${h.confidence}%` : '';
  return [verdictWord(h), c].filter(Boolean).join(' ') || '—';
}
const minutesAgo = (now, at) => Math.max(0, Math.floor((now - at) / 60000));
const agoText = (now, at) => { const m = minutesAgo(now, at); return m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`; };

// → { kind: 'head'|'other'|'none', line, headId, notes[] }. 받기 실패(up:false — 셸은 앞 머리를 들고 있어도)·꺼짐(off)·머리 0개면 N-05.
// N-06: 자동 운영(autopilot) 또는 이 PC 분석 스케줄러(p35 sched — 살아 있다고 알려진 때만)가 그 종목을 분석 중
export function verdictModel({ latest, symbol, now = Date.now() } = {}) {
  const live = !!latest && typeof latest === 'object' && latest.up === true && latest.off !== true;
  const list = live && Array.isArray(latest.bySymbol) ? latest.bySymbol.filter((x) => x && typeof x.symbol === 'string' && Number.isFinite(x.at)) : [];
  const notes = [];
  const ap = live ? latest.autopilot : null;
  const sc = live ? latest.sched : null;
  const running = (ap && ap.running === true && ap.runningSymbol === symbol) || (sc && sc.up === true && sc.running === true && sc.runningSymbol === symbol);
  if (symbol && running) notes.push(MTEXT.n06(symbol));
  if (!list.length) return { kind: 'none', line: MTEXT.n05, headId: null, notes };
  const h = list.find((x) => x.symbol === symbol);
  if (!h) {
    const l = list[0]; // 허브가 최근 순으로 준다 — 첫 칸 = 가장 늦은 분석
    return { kind: 'other', line: MTEXT.n04(analysisName(l), fmtHM(l.at), verdictValue(l)), headId: null, notes };
  }
  const hours = Math.floor((now - h.at) / 3600000);
  if (hours >= VERDICT_STALE_H) notes.push(MTEXT.n08(hours));
  return { kind: 'head', line: `${analysisName(h)} · ${fmtHM(h.at)}(${agoText(now, h.at)}) · ${verdictValue(h)}`, headId: typeof h.id === 'string' ? h.id : null, notes };
}

// 상세 시트 줄(N-09) → [[라벨, 값]]: 판정·확신도·진입·손절·목표(분석 시각이 levelsMaxMin을 넘으면 대신 N-13 — spec §6 레벨 숨김)·근거·직원 말(이름 + 말풍선)
export function detailRows({ analysis: a, now = Date.now(), levelsMaxMin = LEVELS_MAX_MIN } = {}) {
  if (!a || typeof a !== 'object') return [];
  const lim = Number.isInteger(levelsMaxMin) && levelsMaxMin > 0 ? levelsMaxMin : LEVELS_MAX_MIN;
  const min = minutesAgo(now, a.at);
  const rows = [
    ['판정', verdictWord({ bias: a.scalp && typeof a.scalp === 'object' ? a.scalp.bias : null, action: a.action }) || '—'],
    ['확신도', Number.isInteger(a.confidence) ? `${a.confidence}%` : '—'],
  ];
  if (min > lim) rows.push(['레벨', MTEXT.n13(min)]);
  else for (const [k, v] of [['진입', a.entry], ['손절', a.stop], ['목표', a.target]]) rows.push([k, noBoss(v) || '—']);
  const why = noBoss(a.rationale);
  if (why) rows.push(['근거', why]);
  for (const t of Array.isArray(a.turns) ? a.turns : []) {
    const name = t && typeof t.name === 'string' ? t.name : '';
    const bubble = t && typeof t.bubble === 'string' ? t.bubble : '';
    if (!name || !bubble || BOSS_RE.test(name) || BOSS_RE.test(bubble)) continue;
    rows.push([name, bubble]);
  }
  return rows;
}
