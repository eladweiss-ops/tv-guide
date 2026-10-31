// GET  /api/backup?t=TOKEN          → ההגדרות השמורות {data:{...}}
// POST /api/backup {t, data:{...}}   → שמירת ההגדרות (ערוצים, מועדפים, נושאים, תזכורות...)
import { readJson, writeJson } from "./_db.js";
import { okToken } from "./_store.js";
import { allow, clientIp, tooMany, readBody, fail } from "./_guard.js";

const KEYS = ["tvg.sel", "tvg.fav", "tvg.prov", "tvg.theme", "tvg.lead", "tvg.tab", "tvg.rem", "tvg.calmode", "tvg.recent", "tvg.topics"];
const path = (t) => `backup/${t}.json`;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "GET") {
      const t = String(req.query.t || "");
      if (!okToken(t)) return res.status(400).json({ error: "bad token" });
      const j = await readJson(path(t), null);
      if (!j) return res.status(404).json({ error: "not found" });
      res.setHeader("cache-control", "no-store");
      return res.status(200).json(j);
    }
    if (req.method === "POST") {
      if (!allow("bk:ip:" + clientIp(req), 30)) return tooMany(res);
      const rb = readBody(req, 262144);
      if (!rb.ok) return res.status(rb.status).json({ error: rb.error });
      const body = rb.body;
      if (!okToken(body.t)) return res.status(400).json({ error: "bad token" });
      if (!allow("bk:t:" + body.t, 12)) return tooMany(res);
      const data = {}; let size = 0;
      for (const k of KEYS) {
        const v = body.data && body.data[k];
        if (typeof v !== "string" || v.length > 60000) continue;
        data[k] = v; size += v.length;
      }
      if (size > 200000) return res.status(413).json({ error: "too big" });
      const cur = await readJson(path(body.t), null); // גיבוי זהה לשמור: לא כותבים שוב (חוסך מכסת כתיבות)
      if (!cur || JSON.stringify(cur.data) !== JSON.stringify(data)) await writeJson(path(body.t), { at: Date.now(), data });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).end();
  } catch (e) {
    return fail(res, e, "backup");
  }
}
