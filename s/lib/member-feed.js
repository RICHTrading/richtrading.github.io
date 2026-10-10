// 회원 송출 받기(설계 3-2 §3.4·§3.5) — auto-feed를 fetch 전송·회원 주소(/v1/member/*)·토큰 머리글로 감싼 얇은 층.
// 토큰은 Authorization 머리글로만(주소·쿼리에 넣지 않음), 앱 버전은 X-Ptf-App-Version(허브의 follow 판정용).
// event: follow(이 연결의 마지막 값)·event: rehearsal(시험 토큰, 최근 20건)을 모아 스냅샷에 { member: true, follow, rehearsal }로 붙인다.
//   follow는 연결별 값이다 — 새 연결(onConnect)·stop()에서 지운다. 끊긴 동안 허브가 따라가기를 껐을 수 있으므로 옛 enabled:true를
//   받은 시각만 보고 새 값처럼 쓰면 안 된다(허브는 새 연결마다 event: live 바로 뒤에 event: follow를 보낸다 — 허브 트랙에 요청).
//   리허설은 id|kind|rseq로 거른다(허브 rseq가 다시 1부터여도 새 신호를 버리지 않게), 시각·rseq 순 최근 20건.
// 401은 onUnauthorized(본문, 이 연결의 토큰) — 어느 토큰이 해제됐는지는 부른 쪽(member-control)이 가린다.
import { createAutoFeed, feedUrls } from './auto-feed.js';
import { MEMBER_LIST_KINDS } from './auto-view.js';
import { memberHeaders } from './member.js';

export const REHEARSAL_KEEP = 20;
export const memberUrls = (hub) => feedUrls(hub, '/v1/member', MEMBER_LIST_KINDS);
export const memberSeq = (s) => (s && typeof s === 'object' && s.feed && typeof s.feed === 'object' ? s.feed.seq : undefined);
const rehearsalKey = (r) => `${r.id}|${r.kind}|${r.rseq}`;
const atOf = (r) => (typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0);
const byTime = (a, b) => (atOf(a) - atOf(b)) || (a.rseq - b.rseq);

export function createMemberFeed({
  hub,
  token,
  version,
  onUpdate = () => {},
  onAlert = () => {},
  onEvent = () => {},
  onUnauthorized = () => {},
  now = () => Date.now(),
  feedFactory = createAutoFeed,
  ...rest
}) {
  let last = null;
  let follow = null;
  let rehearsal = [];
  const snap = () => (last ? { ...last, member: true, follow, rehearsal: rehearsal.slice() } : null);
  const publish = () => {
    const s = snap();
    if (s) onUpdate(s);
  };
  const feed = feedFactory({
    ...rest,
    hub,
    now,
    urls: memberUrls(hub),
    transport: 'fetch',
    auth: () => memberHeaders(token, version),
    listKinds: MEMBER_LIST_KINDS,
    seqOf: memberSeq,
    otherTypes: ['follow', 'rehearsal'],
    onUpdate: (s) => {
      last = s;
      publish();
    },
    onAlert,
    onEvent,
    onUnauthorized: (body) => onUnauthorized(body, token),
    onConnect: () => {
      if (follow) {
        follow = null;
        publish();
      }
    },
    onOther: (type, data, meta) => {
      if (!data || typeof data !== 'object') return;
      const source = meta && meta.source === 'stream' ? 'stream' : 'replay';
      if (type === 'follow') {
        follow = { ...data, source, receivedAt: now() };
        publish();
      } else if (type === 'rehearsal') {
        if (!Number.isInteger(data.rseq)) return;
        const key = rehearsalKey(data);
        if (rehearsal.some((r) => rehearsalKey(r) === key)) return;
        rehearsal = [...rehearsal, { ...data, source }].sort(byTime).slice(-REHEARSAL_KEEP);
        publish();
      }
    },
  });
  return {
    start: () => feed.start(),
    stop: () => {
      follow = null;
      feed.stop();
    },
    snapshot: snap,
  };
}
