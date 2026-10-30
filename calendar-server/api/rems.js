// GET  /api/rems?t=TOKEN        → רשימת התזכורות (לשחזור באפליקציה)
// POST /api/rems {t, rems:[...]} → שמירת הרשימה (היומן המנוי מתעדכן ממנה)
import { okToken, load, save, clean } from "./_store.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "GET") {
      const t = String(req.query.t || "");
      if (!okToken(t)) return res.status(400).json({ error: "bad token" });
      if (req.query.selftest === "1" && t.startsWith("selftest")) { // בדיקת כתיבה בלי POST
        await save(t, clean([{ k: "0|" + (Date.now() + 864e5), title: "בדיקה", ch: "", ts: Date.now() + 864e5, end: Date.now() + 864e5 + 36e5, lead: 10 }]));
      }
      return res.status(200).json({ rems: await load(t) });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (!okToken(body.t)) return res.status(400).json({ error: "bad token" });
      const rems = clean(body.rems);
      await save(body.t, rems);
      return res.status(200).json({ ok: true, n: rems.length });
    }
    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
