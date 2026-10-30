// נקרא על ידי QStash בדיוק בזמן ההתראה. שולח פוש אם התזכורת עדיין קיימת ולא שונתה.
// אימות: ?s=FIRE_SECRET (הודעות שכבר תוזמנו) או חתימת QStash (Upstash-Signature) כשהוגדרו מפתחות החתימה
import { load, okToken } from "./_store.js";
import { sendTo, remPayload, dropSched } from "./_push.js";
import { fireAuthorized, rawBodyOf } from "./_sig.js";
import { fail } from "./_guard.js";

export const config = { api: { bodyParser: false } }; // צריך את הגוף הגולמי לאימות תקציר החתימה

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    let raw;
    try { raw = await rawBodyOf(req); } catch (e) { return res.status(e.status || 400).end(); }
    if (!fireAuthorized(req, raw)) return res.status(403).end();
    let b;
    try { b = JSON.parse(raw || "{}"); } catch (e) { return res.status(400).json({ error: "bad request" }); }
    if (!b || !okToken(b.t) || typeof b.k !== "string") return res.status(400).json({ error: "bad request" });
    const rems = await load(b.t);
    const r = rems.find((x) => x.k === b.k);
    if (!r) return res.status(200).json({ skipped: "cancelled" });
    if (b.snooze) { // נודניק: הודעה נפרדת, לא נוגעים בתזמון הרגיל (sched)
      return res.status(200).json(await sendTo(b.t, remPayload(r, { t: b.t, at: Date.now(), snooze: true })));
    }
    const at = r.ts - (r.lead || 0) * 60000;
    if (Math.abs(Math.max(at, 0) - b.at) > 120000 && at > Date.now() + 60000) return res.status(200).json({ skipped: "changed" });
    const out = await sendTo(b.t, remPayload(r, { t: b.t, at: Date.now() }));
    await dropSched(b.t, b.k);
    return res.status(200).json(out);
  } catch (e) {
    return fail(res, e, "fire");
  }
}
