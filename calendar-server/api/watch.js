// GET  /api/watch?t=TOKEN          → {items:[...]}  רשימת המעקב (🔔 תודיע לי)
// POST /api/watch {t, items:[...]} → שמירת הרשימה כולה (עד 50). פריט: {k:"m603"|"t1396", title, orig?, poster?, on:["nf","season","tv"], bn?:bool}
// אימות כמו /api/rems: טוקן אישי, קצב (60 ל-IP, 30 לטוקן בדקה), גוף עד 32KB. הבדיקה היומית: /api/watch-check
import { okToken } from "./_store.js";
import { readJson, writeJson, getSubs } from "./_push.js";
import { delJson } from "./_db.js";
import { cleanWl, publicWl } from "./_wl.js";
import { allow, clientIp, tooMany, readBody, fail } from "./_guard.js";

export const MAX_BODY = 32768;
const path = (t) => `wl/${t}.json`;

// d (לבדיקות): {readJson, writeJson, delJson, getSubs, now}
export async function handleWatch(method, input, d = {}) {
  const rj = d.readJson || readJson, wj = d.writeJson || writeJson, dj = d.delJson || delJson, gs = d.getSubs || getSubs;
  if (method === "GET") {
    if (!okToken(input.t)) return { status: 400, json: { error: "bad token" } };
    const cur = await rj(path(input.t), { items: [] });
    return { status: 200, json: { items: publicWl(cur && cur.items) } };
  }
  if (!okToken(input.t)) return { status: 400, json: { error: "bad token" } };
  // כתיבה רק למי שיש לו מנוי פוש (בלי פוש אין מה לשלוח, וזה חוסם יצירת מסמכים בכמות ע"י טוקנים אקראיים)
  const subs = await gs(input.t);
  if (!Array.isArray(subs) || !subs.length) return { status: 403, json: { error: "no push" } };
  const cur = await rj(path(input.t), { items: [] });
  const { items, capped } = cleanWl(input.items, cur && cur.items, d.now ? d.now() : Date.now());
  if (!items.length) { if (cur && Array.isArray(cur.items) && cur.items.length) await dj(path(input.t)); } // רשימה ריקה = מוחקים את המסמך
  else await wj(path(input.t), { items });
  const out = { ok: true, n: items.length };
  if (capped) out.capped = capped;
  return { status: 200, json: out };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "GET") {
      if (!allow("wl:ip:" + clientIp(req), 120)) return tooMany(res);
      const r = await handleWatch("GET", { t: String((req.query && req.query.t) || "") });
      res.setHeader("cache-control", "no-store");
      return res.status(r.status).json(r.json);
    }
    if (req.method === "POST") {
      if (!allow("wl:ip:" + clientIp(req), 60)) return tooMany(res);
      const rb = readBody(req, MAX_BODY);
      if (!rb.ok) return res.status(rb.status).json({ error: rb.error });
      if (!okToken(rb.body.t)) return res.status(400).json({ error: "bad token" });
      if (!allow("wl:t:" + rb.body.t, 30)) return tooMany(res);
      const r = await handleWatch("POST", rb.body);
      return res.status(r.status).json(r.json);
    }
    return res.status(405).end();
  } catch (e) {
    return fail(res, e, "watch");
  }
}
