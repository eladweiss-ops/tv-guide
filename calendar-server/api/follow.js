// GET  /api/follow?t=TOKEN             → {follows:[...]}  מעקב אחרי סדרות (📺), כולל מחיקות אחרונות (tombstones) לצורך מיזוג בין מכשירים
// POST /api/follow {t, follows:[...]} → ממזג לפי u (המאוחר מנצח), עד 30 סדרות, גוזר מחדש את התזכורות מהלוח ומתזמן (אותו תקציב כמו /api/rems). רק למי שיש לו מנוי פוש (403 אחרת)
// פריט: {title, ch?, chn?, chs?, mode:"new"|"all", lead, dbl?, u, x?}. אימות/קצב/גוף כמו /api/watch. הבדיקה היומית: /api/watch-check (אותו cron)
import { okToken, load } from "./_store.js";
import { readJson, writeJson, getSubs, reschedule } from "./_push.js";
import { delJson } from "./_db.js";
import { mergeFollows, folPath } from "./_fol.js";
import { refreshUser } from "./_fcheck.js";
import { allow, clientIp, tooMany, readBody, fail } from "./_guard.js";

export const MAX_BODY = 32768;

// d (לבדיקות): {readJson, writeJson, delJson, getSubs, load, reschedule, guide, fetch, now}
export async function handleFollow(method, input, d = {}) {
  const rj = d.readJson || readJson, wj = d.writeJson || writeJson, dj = d.delJson || delJson, gs = d.getSubs || getSubs;
  if (!okToken(input.t)) return { status: 400, json: { error: "bad token" } };
  if (method === "GET") {
    const cur = await rj(folPath(input.t), null);
    return { status: 200, json: { follows: (cur && Array.isArray(cur.follows) ? cur.follows : []) } };
  }
  // כתיבה רק למי שיש לו מנוי פוש: בלי פוש אין תזכורות אוטומטיות, וזה גם חוסם יצירת מסמכים ע"י טוקנים אקראיים
  const subs = await gs(input.t);
  if (!Array.isArray(subs) || !subs.length) return { status: 403, json: { error: "no push" } };
  const now = d.now ? d.now() : Date.now();
  const cur = (await rj(folPath(input.t), null)) || { v: 1, follows: [], derived: [] };
  const { follows, capped } = mergeFollows(input.follows, cur.follows, now);
  const active = follows.filter((f) => !f.x).length;
  if (!follows.length) { // אין כלום (גם לא מחיקות אחרונות): מוחקים את המסמך ומבטלים תזמונים
    if (cur.follows && cur.follows.length) await dj(folPath(input.t));
    let sch; try { sch = await (d.reschedule || ((t, rems) => reschedule(t, rems)))(input.t, await (d.load || load)(input.t)); } catch (e) { sch = { error: "schedule failed" }; }
    return { status: 200, json: { ok: true, n: 0, follows: [], sch } };
  }
  const doc = { v: 1, follows, derived: Array.isArray(cur.derived) ? cur.derived : [], at: now, chk: cur.chk || 0 };
  const r = await refreshUser(input.t, doc, { ...d, readJson: rj, writeJson: wj, load: d.load || load, reschedule: d.reschedule || ((t, rems) => reschedule(t, rems)) });
  const out = { ok: true, n: active, follows, next: r.n };
  if (capped) out.capped = capped;
  if (r.stale) out.stale = true;
  return { status: 200, json: out };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "GET") {
      if (!allow("fol:ip:" + clientIp(req), 120)) return tooMany(res);
      const r = await handleFollow("GET", { t: String((req.query && req.query.t) || "") });
      res.setHeader("cache-control", "no-store");
      return res.status(r.status).json(r.json);
    }
    if (req.method === "POST") {
      if (!allow("fol:ip:" + clientIp(req), 60)) return tooMany(res);
      const rb = readBody(req, MAX_BODY);
      if (!rb.ok) return res.status(rb.status).json({ error: rb.error });
      if (!okToken(rb.body.t)) return res.status(400).json({ error: "bad token" });
      if (!allow("fol:t:" + rb.body.t, 30)) return tooMany(res);
      const r = await handleFollow("POST", rb.body);
      return res.status(r.status).json(r.json);
    }
    return res.status(405).end();
  } catch (e) {
    return fail(res, e, "follow");
  }
}
