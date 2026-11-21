// 서버 판 수동 주문 명령(설계 2026-10-16 §15.8·D30·D31·D36, 계획 2026-10-22 작업 11) — 휴대폰은 주문하지 않고 실행기에 명령만(기기 서명 — server-exec cmd).
// - quote: 시트에 보일 수량·증거금(manual-quote — 옛 휴대폰 계산 그대로, 실행기가 같은 식으로 다시 확인하고 2% 넘게 다르면 changed)
// - openFirst → manual_entry { symbol, dir, lev, pct, tpPct, shown: { qty, margin } } — 가격 칸 없음(주문은 모두 시장가 — 실행기가 시세로, D36)
// - add → add { tradeId, stage }(다음 차수 하나 — 비율은 실행기가 표에서, D31. 휴대폰은 비중을 보내지 않음) · close → close { tradeId }
// - 돌려줌 { ok, reason } — reason = 명령 결과 낱말(stale_stage·hedge_mode·pending …, 부르는 쪽이 한 줄·창)
// 익절가 변경·다시 걸기·'확인했습니다'는 없다(서버가 맡음)
import { sendAndWait } from './server-cmd-flow.js';

export function createServerManual({ server, quote, rules, flow = sendAndWait, sleep, now } = {}) {
  const opts = { ...(sleep ? { sleep } : {}), ...(now ? { now } : {}) };
  const firstPct = () => (rules && rules.entry && Number.isFinite(rules.entry.firstPct) ? rules.entry.firstPct : null);
  const tpPct = () => (rules && rules.entry && Number.isFinite(rules.entry.tpPct) ? rules.entry.tpPct : null);
  async function send(kind, args) {
    let r;
    try {
      r = await flow(server, kind, args, opts);
    } catch {
      r = { ok: false, error: 'down' };
    }
    return r && r.ok === true ? { ok: true, reason: null } : { ok: false, reason: r && typeof r.error === 'string' ? r.error : 'down' };
  }
  return {
    quote: (args) => quote(args),
    openFirst({ symbol, side, q }) {
      const pct = q && Number.isFinite(q.pctReal) ? q.pctReal : firstPct();
      return send('manual_entry', { symbol, dir: side, lev: q.lev, pct, tpPct: tpPct(), shown: { qty: q.qty, margin: q.margin } });
    },
    add: ({ tradeId, stage }) => send('add', { tradeId, stage }),
    close: ({ tradeId }) => send('close', { tradeId }),
  };
}
