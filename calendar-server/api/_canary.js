// 🐤 בדיקה יומית של כל השרשרת שבה תזכורות עוברות: ה-cron היומי (/api/watch-check) מתזמן ב-QStash הודעה ל-/api/fire בעוד 5 דקות
// (אותו יעד ואותו אימות כמו תזכורת אמיתית: fireDest, סוד/חתימת QStash), ו-/api/fire רושם stats/canary {at, ok}.
// סטטוס ציבורי בלי שום מידע אישי: GET /api/status (rewrite ל-/api/push?status=1) → {canaryAt, canaryOk, canaryPlan, canaryLag}.
// הניטור (tools/monitor/health.mjs) מתריע כשהבדיקה האחרונה ישנה מ-26 שעות או נכשלה.
import { QBASE, fireDest } from "./_snz.js";
import { ilDay } from "./_rlog.js";

export const CANARY = "stats/canary.json";  // {plan, planAt, id, at, ok, lag}
export const CANARY_DELAY = 5 * 60000;
export const CANARY_MAX_LAG = 10 * 60000;   // הגיע יותר מ-10 דקות אחרי המתוכנן = QStash מעכב (תזכורות היו מאחרות)

// d: {readJson, writeJson, fetch?, now?, token?}
export async function scheduleCanary(d) {
  const token = d.token !== undefined ? d.token : process.env.QSTASH_TOKEN;
  if (!token) return { skipped: "no QSTASH_TOKEN" };
  const now = d.now ? d.now() : Date.now(), at = now + CANARY_DELAY, fx = d.fetch || fetch;
  const r = await fx(`${QBASE()}/v2/publish/${fireDest()}`, {
    method: "POST", signal: !d.fetch && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    headers: { authorization: "Bearer " + token, "content-type": "application/json", "upstash-not-before": String(Math.floor(at / 1000)), "upstash-retries": "2", "upstash-deduplication-id": "canary-" + ilDay(now) },
    body: JSON.stringify({ canary: 1, at }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.messageId) return { error: "publish failed", status: r.status };
  const cur = (await d.readJson(CANARY, null)) || {};
  await d.writeJson(CANARY, { ...cur, plan: at, planAt: now, id: j.messageId });
  return { scheduled: at };
}

// הודעת QStash {canary:1, at} ב-/api/fire (אחרי האימות). d: {readJson, writeJson, now?}
export async function fireCanary(b, d) {
  const now = d.now ? d.now() : Date.now();
  const at = Number.isFinite(+b.at) ? +b.at : 0, lag = at ? now - at : null;
  const cur = (await d.readJson(CANARY, null)) || {};
  const ok = !!at && Math.abs(lag) <= CANARY_MAX_LAG;
  await d.writeJson(CANARY, { ...cur, at: now, ok, lag });
  console.log("canary", ok ? "ok" : "late", lag);
  return { status: 200, json: { canary: true, ok } };
}

// לסטטוס הציבורי: רק זמנים ודגל
let memo = { t: 0, v: null };
export async function canaryStatus(d, now = Date.now()) {
  if (memo.v && now - memo.t < 60000) return memo.v;
  const c = (await d.readJson(CANARY, null)) || {};
  const v = { canaryAt: c.at || null, canaryOk: c.at ? !!c.ok : null, canaryPlan: c.plan || null, canaryLag: c.lag == null ? null : c.lag };
  memo = { t: now, v };
  return v;
}
export const _resetCanaryMemo = () => { memo = { t: 0, v: null }; };
