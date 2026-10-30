// נקרא על ידי QStash בדיוק בזמן ההתראה. שולח פוש אם התזכורת עדיין קיימת ולא שונתה.
import { load } from "./_store.js";
import { sendTo, remPayload, dropSched } from "./_push.js";
import { START_SUFFIX } from "./_rems.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.FIRE_SECRET || req.query.s !== process.env.FIRE_SECRET) return res.status(403).end();
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const rems = await load(b.t);
    const r = rems.find((x) => x.k === b.k);
    if (!r) return res.status(200).json({ skipped: "cancelled" });
    if (b.snooze) { // נודניק: הודעה נפרדת, לא נוגעים בתזמון הרגיל (sched)
      return res.status(200).json(await sendTo(b.t, remPayload(r, { t: b.t, at: Date.now(), snooze: true })));
    }
    if (b.st) { // התראה שנייה ברגע ההתחלה ("וגם בתחילת השידור")
      if (!r.dbl || !(r.lead > 0) || Math.abs(r.ts - b.at) > 120000) return res.status(200).json({ skipped: "changed" });
      const o2 = await sendTo(b.t, remPayload(r, { t: b.t, at: Date.now() }));
      await dropSched(b.t, b.k + START_SUFFIX);
      return res.status(200).json(o2);
    }
    const at = r.ts - (r.lead || 0) * 60000;
    if (Math.abs(Math.max(at, 0) - b.at) > 120000 && at > Date.now() + 60000) return res.status(200).json({ skipped: "changed" });
    const out = await sendTo(b.t, remPayload(r, { t: b.t, at: Date.now() }));
    await dropSched(b.t, b.k);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
