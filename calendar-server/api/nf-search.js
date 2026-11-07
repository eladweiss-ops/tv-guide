// GET /api/nf-search?q=...  → חיפוש מלא בנטפליקס דרך TMDB (המפתח בשרת: TMDB_API_KEY)
//   {v, q, collection, brand, titles:[k], persons:[...], items:{k:{k,id,type,title,orig,year,overview,poster,backdrop,vote,nf,ds,others,link,dlink}}}
//   nf=true: יש ב-flatrate של נטפליקס ישראל; link = חיפוש בנטפליקס. ds=true: יש ב-flatrate של דיסני+ ישראל (provider 337); dlink = חיפוש בדיסני+. others = שירותים אחרים בישראל (מידע בלבד).
// שאילתה בעברית בלי שום תוצאה ב-TMDB: ויקינתונים (wbsearchentities + wbgetentities, תווית/כינוי עברי זהה לשאילתה אחרי norm, או מתחיל בה כשאין זהה)
//   → מזהי TMDB מ-P4983 (סדרה, "t<id>") ו-P4947 (סרט, "m<id>"), עד 3 פריטים, ב-titles עם via:"wikidata". כשל/timeout (4 שניות) בוויקינתונים = partial
//   (נשמר בזיכרון 5 דקות בלבד ומנסים שוב), כדי ש"אין תוצאות" לא יינעל ל-12 שעות. אחריו, אם עדיין אין כלום: תעתיק לאנגלית. כינוי שנלמד (alias) קודם לכל זה.
// מטמון: זיכרון + Firestore דרך _db.js (cache/nf/<hash>.json) ל-12 שעות. קצב: 30 בדקה ל-IP. שגיאות: 400 קלט, 429 קצב, 502 TMDB, 503 לא מוגדר.
// POST /api/nf-search {q, k, t} → לומד כינוי בעברית (alias/<hash>.json): חיפוש בעברית שלא מצא, ואחריו בחירת k מחיפוש t באנגלית.
//   מעכשיו חיפוש q מחפש את t (גם אצל כל המשתמשים). אימות: q בעברית, t בלי עברית, וחיפוש t באמת מחזיר את k. הראשון קובע. קצב: 5 בשעה ל-IP.
import { createHash } from "node:crypto";
import { searchNf, cleanQuery, norm, SEARCH_TTL } from "./_nfs.js";
import { readJson, writeJson } from "./_push.js";
import { allow, clientIp, tooMany, fail } from "./_guard.js";

const mem = new Map();      // hash -> {t, v}
export const PARTIAL_TTL = 5 * 60000;
const provCache = new Map(); // k -> {t, v}  (זמינות לפי פריט, בין חיפושים)
export const _clearCache = () => { mem.clear(); provCache.clear(); aliasMem.clear(); };

export const CACHE_V = "5"; // להעלות בכל שינוי בלוגיקת החיפוש, כדי שתוצאות ישנות לא יוגשו מהמטמון
export const hashOf = (q) => createHash("sha256").update(CACHE_V + "|" + (norm(q) || q.toLowerCase())).digest("hex").slice(0, 32);

// ---- כינויים בעברית שנלמדו מהשימוש ----
const HEB = /[\u0590-\u05FF]/;
export const aliasPath = (q) => "alias/" + createHash("sha256").update(norm(q)).digest("hex").slice(0, 32) + ".json";
const aliasMem = new Map(); // norm(q) -> {exp, t}
export const _clearAlias = () => aliasMem.clear();
async function aliasOf(q, rj, now) {
  if (!HEB.test(q)) return "";
  const n = norm(q), c = aliasMem.get(n);
  if (c && now < c.exp) return c.t;
  let t = "";
  try { const a = await rj(aliasPath(q), null); if (a && typeof a.t === "string") t = cleanQuery(a.t); } catch (e) { /* לא זמין: בלי כינוי */ }
  aliasMem.set(n, { exp: now + 10 * 60000, t });
  if (aliasMem.size > 2000) aliasMem.clear();
  return t;
}
export async function handleAlias(body, d = {}) {
  const q = cleanQuery(body && body.q), t = cleanQuery(body && body.t), k = String((body && body.k) || "");
  if (!q || !HEB.test(q) || q.length > 40 || !t || HEB.test(t) || t.length > 80 || !/^[mt][0-9]{1,9}$/.test(k)) return { status: 400, json: { error: "bad alias" } };
  const now = d.now ? d.now() : Date.now(), rj = d.readJson || readJson, wj = d.writeJson || writeJson;
  try { const old = await rj(aliasPath(q), null); if (old && old.t) return { status: 200, json: { ok: true, kept: true } }; } catch (e) { return { status: 503, json: { error: "store" } }; }
  const r = await handleSearch(t, d); // אימות: החיפוש באנגלית באמת מוצא את k
  const j = r && r.json, found = !!(j && j.items && j.items[k]);
  if (!found) return { status: 422, json: { error: "no match" } };
  await wj(aliasPath(q), { q, t, k, at: now });
  aliasMem.delete(norm(q));
  return { status: 200, json: { ok: true } };
}

// d (לבדיקות): {fetch, key, readJson, writeJson, now}
export async function handleSearch(q0, d = {}) {
  const q1 = cleanQuery(q0);
  if (!q1) return { status: 400, json: { error: "bad query" } };
  if (!d.key && !process.env.TMDB_API_KEY) return { status: 503, json: { error: "not configured" } };
  const now = d.now ? d.now() : Date.now(), rj = d.readJson || readJson, wj = d.writeJson || writeJson;
  const via = await aliasOf(q1, rj, now), q = via || q1; // "חילופי בתים" → "A Couple of Lies"
  const h = hashOf(q), path = `cache/nf/${h}.json`;
  const back = (v) => (via ? { ...v, q: q1 } : v); // התשובה עם השאילתה המקורית (הלקוח משווה למה שהוקלד)
  const m = mem.get(h);
  if (m && now < m.exp) return { status: 200, json: back(m.v), cache: "mem" };
  try {
    const b = await rj(path, null);
    if (b && typeof b.t === "number" && b.v && now - b.t < SEARCH_TTL) { mem.set(h, { exp: b.t + SEARCH_TTL, v: b.v }); return { status: 200, json: back(b.v), cache: "db" }; }
  } catch (e) { /* מטמון לא זמין: ממשיכים לחיפוש חי */ }
  let out;
  try { out = await searchNf(q, { ...d, provCache }); }
  catch (e) {
    console.error("nf-search tmdb", e && e.message);
    return { status: e && e.status === 503 ? 503 : 502, json: { error: e && e.status === 503 ? "not configured" : "upstream" } };
  }
  if (!out) return { status: 400, json: { error: "bad query" } };
  const part = !!out.partial; // תוצאה חלקית (כשל בתת-קריאה): רק זיכרון ל-5 דקות, לא נכתבת ל-Firestore
  mem.set(h, { exp: now + (part ? PARTIAL_TTL : SEARCH_TTL), v: out });
  if (mem.size > 500) for (const [k, v] of mem) if (now >= v.exp) mem.delete(k);
  if (!part) try { await wj(path, { t: now, v: out }); } catch (e) { console.error("nf-search cache write", e && e.message); }
  return { status: 200, json: back(out), cache: "miss" };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "POST") {
    try {
      if (!allow("nfa:ip:" + clientIp(req), 5, 3600000)) return tooMany(res);
      let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
      const r = await handleAlias(body || {});
      res.setHeader("cache-control", "no-store");
      return res.status(r.status).json(r.json);
    } catch (e) { return fail(res, e, "nf-alias"); }
  }
  if (req.method !== "GET") return res.status(405).end();
  try {
    if (!allow("nfs:ip:" + clientIp(req), 30)) return tooMany(res);
    const r = await handleSearch(String((req.query && req.query.q) || ""));
    res.setHeader("cache-control", r.status === 200 && !(r.json && r.json.partial) ? "public, max-age=300" : "no-store");
    return res.status(r.status).json(r.json);
  } catch (e) {
    return fail(res, e, "nf-search");
  }
}
