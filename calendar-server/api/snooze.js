// POST /api/snooze {k, m?, o+a+s | t}  → נודניק: פוש חוזר בעוד m דקות (1..60, ברירת מחדל 5)
//   מ-Service Worker: o (טוקן מוצפן), a (זמן שליחת הפוש), s (חתימת HMAC) – כמו שהגיעו בשדה snz של הפוש
//   מהאפליקציה:       t (הטוקן האישי)
// תשובה: {ok:true, at:<ms>, m, dup?}   שגיאות: 400 קלט שגוי · 403 חתימה לא תקפה · 404 אין תזכורת כזו · 413 גדול מדי · 429 קצב · 502/503 תזמון נכשל
import { okToken, load } from "./_store.js";
import { readJson, writeJson } from "./_push.js";
import { handleSnooze } from "./_snz.js";
import { allow, clientIp, tooMany, readBody, fail } from "./_guard.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();
  try {
    if (!allow("snz:ip:" + clientIp(req), 60)) return tooMany(res);
    const rb = readBody(req, 4096);
    if (!rb.ok) return res.status(rb.status).json({ error: rb.error });
    const r = await handleSnooze(rb.body, { okToken, load, readJson, writeJson, fetch, rate: (t) => allow("snz:t:" + t, 20) });
    if (r.status === 429) res.setHeader("retry-after", "60");
    return res.status(r.status).json(r.json);
  } catch (e) {
    return fail(res, e, "snooze");
  }
}
