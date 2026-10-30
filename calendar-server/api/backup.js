// GET  /api/backup?t=TOKEN          → ההגדרות השמורות {data:{...}}
// POST /api/backup {t, data:{...}}   → שמירת ההגדרות (ערוצים, מועדפים, נושאים, תזכורות...)
import { put, list } from "@vercel/blob";
import { okToken } from "./_store.js";

const KEYS = ["tvg.sel", "tvg.fav", "tvg.prov", "tvg.theme", "tvg.lead", "tvg.tab", "tvg.rem", "tvg.calmode", "tvg.recent", "tvg.topics"];
const path = (t) => `backup/${t}.json`;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "GET") {
      const t = String(req.query.t || "");
      if (!okToken(t)) return res.status(400).json({ error: "bad token" });
      const { blobs } = await list({ prefix: path(t), limit: 1 });
      if (!blobs.length) return res.status(404).json({ error: "not found" });
      const r = await fetch(blobs[0].url + "?v=" + Date.now(), { cache: "no-store" });
      const j = r.ok ? await r.json().catch(() => null) : null;
      if (!j) return res.status(404).json({ error: "not found" });
      res.setHeader("cache-control", "no-store");
      return res.status(200).json(j);
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (!okToken(body.t)) return res.status(400).json({ error: "bad token" });
      const data = {}; let size = 0;
      for (const k of KEYS) {
        const v = body.data && body.data[k];
        if (typeof v !== "string" || v.length > 60000) continue;
        data[k] = v; size += v.length;
      }
      if (size > 200000) return res.status(413).json({ error: "too big" });
      await put(path(body.t), JSON.stringify({ at: Date.now(), data }), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
