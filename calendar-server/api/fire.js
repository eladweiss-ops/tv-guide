// נקרא על ידי QStash בדיוק בזמן ההתראה. שולח פוש אם התזכורת עדיין קיימת ולא שונתה.
// אימות: ?s=FIRE_SECRET (הודעות שכבר תוזמנו) או חתימת QStash (Upstash-Signature) כשהוגדרו מפתחות החתימה
import { load, okToken } from "./_store.js";
import { sendTo, remPayload, dropSched, reschedule } from "./_push.js";
import { fireAuth, rawBodyOf } from "./_sig.js";
import { fail } from "./_guard.js";

export const config = { api: { bodyParser: false } }; // צריך את הגוף הגולמי לאימות תקציר החתימה

// לוגיקת הירי (deps להזרקה בבדיקות)
export async function handleFire(b, d, now = Date.now()) {
  const rems = await d.load(b.t);
  const r = rems.find((x) => x.k === b.k);
  if (!r) return { status: 200, json: { skipped: "cancelled" } };
  if (b.snooze) { // נודניק: הודעה נפרדת, לא נוגעים בתזמון הרגיל (sched)
    return { status: 200, json: await d.sendTo(b.t, remPayload(r, { t: b.t, at: now, snooze: true })) };
  }
  const at = r.ts - (r.lead || 0) * 60000;
  if (Math.abs(Math.max(at, 0) - b.at) > 120000 && at > now + 60000) return { status: 200, json: { skipped: "changed" } };
  const out = await d.sendTo(b.t, remPayload(r, { t: b.t, at: now }));
  await d.dropSched(b.t, b.k);
  // תזמון המשך: תזכורות מעבר לתקרה (61+) או שנדחו בגלל תקציב יומי שאופס. כישלון כאן לא מפיל את ההודעה (QStash ינסה שוב וישלח פוש כפול)
  try { out.sch = await d.reschedule(b.t, rems.filter((x) => x.k !== b.k)); } catch (e) { console.error("fire reschedule", e && e.message); }
  return { status: 200, json: out };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    let raw;
    try { raw = await rawBodyOf(req); } catch (e) { return res.status(e.status || 400).end(); }
    const au = fireAuth(req, raw);
    console.log("fire auth", au.ok ? "allowed" : "denied", "via=" + au.via, "jwt=" + au.jwt); // בלי סודות; מאפשר לוודא שה-JWT תקין לפני QSTASH_STRICT=1
    if (!au.ok) return res.status(403).end();
    let b;
    try { b = JSON.parse(raw || "{}"); } catch (e) { return res.status(400).json({ error: "bad request" }); }
    if (!b || !okToken(b.t) || typeof b.k !== "string") return res.status(400).json({ error: "bad request" });
    const r = await handleFire(b, { load, sendTo, dropSched, reschedule });
    return res.status(r.status).json(r.json);
  } catch (e) {
    return fail(res, e, "fire");
  }
}
