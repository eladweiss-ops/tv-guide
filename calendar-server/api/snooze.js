// POST /api/snooze {k, m?, o+a+s | t}  → נודניק: פוש חוזר בעוד m דקות (1..60, ברירת מחדל 5)
//   מ-Service Worker: o (טוקן מוצפן), a (זמן שליחת הפוש), s (חתימת HMAC) – כמו שהגיעו בשדה snz של הפוש
//   מהאפליקציה:       t (הטוקן האישי)
// תשובה: {ok:true, at:<ms>, m, dup?}   שגיאות: 400 קלט שגוי · 403 חתימה לא תקפה · 404 אין תזכורת כזו · 502/503 תזמון נכשל
import { okToken, load } from "./_store.js";
import { readJson, writeJson } from "./_push.js";
import { handleSnooze } from "./_snz.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const r = await handleSnooze(b, { okToken, load, readJson, writeJson, fetch });
    return res.status(r.status).json(r.json);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
