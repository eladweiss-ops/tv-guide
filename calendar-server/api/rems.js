// GET  /api/rems?t=TOKEN        → רשימת התזכורות (לשחזור באפליקציה)
// POST /api/rems {t, rems:[...]} → שמירת הרשימה (היומן המנוי מתעדכן ממנה). מגבלות: ראו README
import { okToken, load, save, clean } from "./_store.js";
import { reschedule } from "./_push.js";
import { allow, clientIp, tooMany, readBody, fail } from "./_guard.js";

export const MAX_BODY = 65536;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "GET") {
      const t = String(req.query.t || "");
      if (!okToken(t)) return res.status(400).json({ error: "bad token" });
      return res.status(200).json({ rems: await load(t) });
    }
    if (req.method === "POST") {
      if (!allow("rems:ip:" + clientIp(req), 60)) return tooMany(res);
      const rb = readBody(req, MAX_BODY);
      if (!rb.ok) return res.status(rb.status).json({ error: rb.error });
      const body = rb.body;
      if (!okToken(body.t)) return res.status(400).json({ error: "bad token" });
      if (!allow("rems:t:" + body.t, 30)) return tooMany(res);
      const rems = clean(body.rems);
      await save(body.t, rems);
      const sch = await reschedule(body.t, rems).catch((e) => { console.error("reschedule", e && e.message); return { error: "schedule failed" }; });
      return res.status(200).json({ ok: true, n: rems.length, sch });
    }
    return res.status(405).end();
  } catch (e) {
    return fail(res, e, "rems");
  }
}
