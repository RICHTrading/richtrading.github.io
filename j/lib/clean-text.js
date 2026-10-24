// 화면에 그리는 바깥 문장 거르기(p34 §2.4·§5.2) — 허브가 먼저 거르고 앱이 한 번 더(받는 쪽도 거름).
//   1. 제어문자 지움   2. 연결·연락처 지움(주소·t.me·카카오·이메일·@계정·한국 전화 — 숫자 범위·날짜·'@1269' 같은 가격은 그대로)
// '수수료'는 원문 그대로 둔다(p35 §4 — 열린 질문 16 대표 답 ①: 중계하는 원문은 바꾸지 않음. '수수료' 금지는 우리가 쓰는 문구에만).
// 레퍼럴·추천인·페이백·수익 보장류(BANNED_RE)는 바꿔 쓰면 뜻이 달라지므로 그 줄·문장을 통째로 뺀다(부르는 쪽이 판단)
export const BANNED_RE = /레퍼럴|리퍼럴|추천인|추천\s?코드|페이백|리베이트|캐시백|referral|rebate|수익\s*보장|보장\s*수익|원금\s*보장|확정\s*수익/i;

export function stripLinks(text) {
  return String(text)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/\b(t\.me|open\.kakao\.com|pf\.kakao\.com|bit\.ly)\/\S*/gi, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '')
    .replace(/(?<![\w.])@(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{4,}/g, '')
    .replace(/\b01[016-9][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '')
    .replace(/\b0\d{1,2}-\d{3,4}-\d{4}\b/g, '');
}

export function cleanText(text, { multiline = false } = {}) {
  if (typeof text !== 'string') return '';
  const t = multiline ? text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return stripLinks(t).trim();
}

// 문장 나누기 — 허브 dropBannedSentences(hub/lib/analysis-view.js)와 같은 경계: . ! ? 。 … 뒤 공백(또는 끝), 그리고 줄바꿈.
// [문장, 뒤 구분자] 목록(이어 붙이면 원문)
const SENTENCE_END = '.!?。…';
export function splitSentences(s) {
  const parts = [];
  let buf = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\n') {
      parts.push([buf, '\n']);
      buf = '';
      continue;
    }
    buf += c;
    if (SENTENCE_END.includes(c)) {
      let j = i + 1;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j += 1;
      if (j > i + 1 || j >= s.length) {
        parts.push([buf, s.slice(i + 1, j)]);
        buf = '';
        i = j - 1;
      }
    }
  }
  if (buf) parts.push([buf, '']);
  return parts;
}

// 연결·연락처가 있던 문장은 통째로 뺀다(p35 §4.5 — 링크만 지우면 '…확인하세요. 문의'처럼 낱말이 덩그러니 남는다).
// 이벤트의 note·footer·표 값·과제 이름에만 쓴다(제목·칩은 cleanText로 연결만 지움 — 제목이 비면 boost 전체가 사라지므로)
export function dropLinkSentences(text) {
  if (typeof text !== 'string') return '';
  return splitSentences(text.replace(/[\u0000-\u001f\u007f]/g, ' '))
    .filter(([sent]) => stripLinks(sent) === sent)
    .map(([sent, sep]) => sent + sep)
    .join('')
    .trim();
}
