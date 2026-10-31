// GET /api/nf-search?q=...  → חיפוש מלא בנטפליקס דרך TMDB (המפתח בשרת: TMDB_API_KEY)
//   {v, q, collection, brand, titles:[k], persons:[...], items:{k:{k,id,type,title,orig,year,overview,poster,backdrop,vote,nf,others,link}}}
//   nf=true: יש ב-flatrate של נטפליקס ישראל; link = חיפוש בנטפליקס. others = שירותים אחרים בישראל (מידע בלבד).
// מטמון: זיכרון + Blob (cache/nf/<hash>.json) ל-12 שעות. קצב: 30 בדקה ל-IP. שגיאות: 400 קלט, 429 קצב, 502 TMDB, 503 לא מוגדר.
import { createHash } from "node:crypto";
import { searchNf, cleanQuery, norm, SEARCH_TTL } from "./_nfs.js";
import { readJson, writeJson } from "./_push.js";
import { allow, clientIp, tooMany, fail } from "./_guard.js";

const mem = new Map();      // hash -> {t, v}
const provCache = new Map(); // k -> {t, v}  (זמינות לפי פריט, בין חיפושים)
export const _clearCache = () => { mem.clear(); provCache.clear(); };

export const hashOf = (q) => createHash("sha256").update(norm(q) || q.toLowerCase()).digest("hex").slice(0, 32);

// d (לבדיקות): {fetch, key, readJson, writeJson, now}
export async function handleSearch(q0, d = {}) {
  const q = cleanQuery(q0);
  if (!q) return { status: 400, json: { error: "bad query" } };
  if (!d.key && !process.env.TMDB_API_KEY) return { status: 503, json: { error: "not configured" } };
  const now = d.now ? d.now() : Date.now(), h = hashOf(q), path = `cache/nf/${h}.json`;
  const m = mem.get(h);
  if (m && now - m.t < SEARCH_TTL) return { status: 200, json: m.v, cache: "mem" };
  const rj = d.readJson || readJson, wj = d.writeJson || writeJson;
  try {
    const b = await rj(path, null);
    if (b && typeof b.t === "number" && b.v && now - b.t < SEARCH_TTL) { mem.set(h, { t: b.t, v: b.v }); return { status: 200, json: b.v, cache: "blob" }; }
  } catch (e) { /* מטמון לא זמין: ממשיכים לחיפוש חי */ }
  let out;
  try { out = await searchNf(q, { ...d, provCache }); }
  catch (e) {
    console.error("nf-search tmdb", e && e.message);
    return { status: e && e.status === 503 ? 503 : 502, json: { error: e && e.status === 503 ? "not configured" : "upstream" } };
  }
  if (!out) return { status: 400, json: { error: "bad query" } };
  mem.set(h, { t: now, v: out });
  if (mem.size > 500) for (const [k, v] of mem) if (now - v.t >= SEARCH_TTL) mem.delete(k);
  try { await wj(path, { t: now, v: out }); } catch (e) { console.error("nf-search cache write", e && e.message); }
  return { status: 200, json: out, cache: "miss" };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).end();
  try {
    if (!allow("nfs:ip:" + clientIp(req), 30)) return tooMany(res);
    const r = await handleSearch(String((req.query && req.query.q) || ""));
    res.setHeader("cache-control", r.status === 200 ? "public, max-age=300" : "no-store");
    return res.status(r.status).json(r.json);
  } catch (e) {
    return fail(res, e, "nf-search");
  }
}
