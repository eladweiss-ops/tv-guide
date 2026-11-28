// GET  /api/rems?t=TOKEN        → רשימת התזכורות (לשחזור באפליקציה). כוללת תזכורות קבוצה שהשרת הוסיף ועוד לא אושרו (srv:1, ks)
// GET  /api/rems?t=TOKEN&log=1  → יומן התזכורות של 30 הימים האחרונים (רק לבעל הטוקן): {days, keys:{k:[אירועים]}, n}
// POST /api/rems {t, rems:[...], tx?:[...]} → שמירת הרשימה (היומן המנוי מתעדכן ממנה). מגבלות: ראו README
//   tx = tvg.teamX של הלקוח (מפתחות שהוא כבר ראה/טיפל בהם). תזכורת ששרת הוסיף ונמצאת ב-rems או ב-tx – מאושרת ויורדת מהממתינות;
//   אחרת היא נשארת (לקוח ישן שלא שולח tx לא מוחק אותה בשקט) ומוחזרת ב-srv כדי שהלקוח יצרף אותה.
import { okToken, loadOwn, load, save, clean } from "./_store.js";
import { reschedule, readJson, writeJson } from "./_push.js";
import { tmPath, normTm, reconcile } from "./_team.js";
import { logEv, readLog } from "./_rlog.js";
import { allow, clientIp, tooMany, readBody, fail } from "./_guard.js";

export const MAX_BODY = 262144;

// d (לבדיקות): {loadOwn, save, readJson, writeJson, reschedule, log, now}
export async function saveRems(body, d = {}) {
  const now = d.now ? d.now() : Date.now(), t = body.t;
  const rems = clean(body.rems);
  const tx = Array.isArray(body.tx) ? body.tx.slice(0, 2000).map(String) : null;
  const rj = d.readJson || readJson, wj = d.writeJson || writeJson;
  const prev = await (d.loadOwn || loadOwn)(t).catch(() => null);
  const tm = normTm(await rj(tmPath(t), null));
  const rc = reconcile(tm.pend, rems, tx, now);
  if (rc.keep.length !== tm.pend.length) await wj(tmPath(t), { ...tm, pend: rc.keep, at: now });
  await (d.save || save)(t, rems);
  // יומן: מה הלקוח הוסיף/מחק לעומת השמירה הקודמת, ומה מהממתינות של השרת אושר
  const ev = [];
  if (prev) {
    const pk = new Set(prev.map((r) => r && r.k)), nk = new Set(rems.map((r) => r.k));
    for (const r of rems) if (!pk.has(r.k)) ev.push({ k: r.k, e: "created", by: "client", ts: r.ts, lead: r.lead });
    for (const r of prev) if (r && !nk.has(r.k) && r.ts > now) ev.push({ k: r.k, e: "deleted", by: "client", ts: r.ts });
  }
  for (const x of rc.dropped) ev.push({ k: x.k, e: x.why === "adopted" ? "adopted" : "dismissed", by: "client" });
  if (ev.length) await (d.log || logEv)(t, ev);
  const sch = await (d.reschedule || reschedule)(t, rems).catch((e) => { console.error("reschedule", e && e.message); return { error: "schedule failed" }; });
  const out = { ok: true, n: rems.length, sch };
  if (rc.keep.length) out.srv = rc.keep; // ממתינות שהלקוח עוד לא ראה: הלקוח מצרף אותן
  return out;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "GET") {
      const t = String(req.query.t || "");
      if (!okToken(t)) return res.status(400).json({ error: "bad token" });
      if (req.query.log) {
        if (!allow("rlog:ip:" + clientIp(req), 20) || !allow("rlog:t:" + t, 10)) return tooMany(res);
        res.setHeader("cache-control", "no-store");
        return res.status(200).json(await readLog(t));
      }
      return res.status(200).json({ rems: await load(t) });
    }
    if (req.method === "POST") {
      if (!allow("rems:ip:" + clientIp(req), 60)) return tooMany(res);
      const rb = readBody(req, MAX_BODY);
      if (!rb.ok) return res.status(rb.status).json({ error: rb.error });
      const body = rb.body;
      if (!okToken(body.t)) return res.status(400).json({ error: "bad token" });
      if (!allow("rems:t:" + body.t, 30)) return tooMany(res);
      return res.status(200).json(await saveRems(body));
    }
    return res.status(405).end();
  } catch (e) {
    return fail(res, e, "rems");
  }
}
