// GET /api/nf-search?q=...  → חיפוש מלא בנטפליקס דרך TMDB (המפתח בשרת: TMDB_API_KEY)
//   {v, q, collection, brand, titles:[k], persons:[...], items:{k:{k,id,type,title,orig,year,overview,poster,backdrop,vote,nf,ds,others,link,dlink}}}
//   nf=true: יש ב-flatrate של נטפליקס ישראל; link = חיפוש בנטפליקס. ds=true: יש ב-flatrate של דיסני+ ישראל (provider 337); dlink = חיפוש בדיסני+. others = שירותים אחרים בישראל (מידע בלבד).
// שאילתה בעברית בלי שום תוצאה ב-TMDB: ויקינתונים (wbsearchentities + wbgetentities, תווית/כינוי עברי זהה לשאילתה אחרי norm, או מתחיל בה בגבול מילה כשאין זהה)
//   → מזהי TMDB מ-P4983 (סדרה, "t<id>") ו-P4947 (סרט, "m<id>"), עד 3 פריטים, ב-titles עם via:"wikidata". כשל/חריגה מתקציב 3 שניות (לשתי הקריאות יחד) = partial
//   (נשמר בזיכרון 5 דקות בלבד ומנסים שוב), כדי ש"אין תוצאות" לא יינעל ל-12 שעות. אחריו, אם עדיין אין כלום: תעתיק לאנגלית. כינוי שנלמד (alias) קודם לכל זה.
// מטמון: זיכרון + Firestore דרך _db.js (cache/nf/<hash>.json) ל-12 שעות. קצב: 30 בדקה ל-IP. שגיאות: 400 קלט, 429 קצב, 502 TMDB, 503 לא מוגדר.
// POST /api/nf-search {q, k, t} → כינוי בעברית (alias/<hash>.json), רק אחרי אישור מפורש של המשתמש בדף התוכן ("זו 'חילופי בתים'? כן, לזכור").
//   מעכשיו חיפוש q מחפש את t (גם אצל כל המשתמשים), והתשובה מסומנת alias=t כדי שהלקוח יציג "לא נכון?". אימות: q בעברית, t בלי עברית,
//   q עצמו (בלי כינוי) לא מוצא כלום (titles/collection/brand → 409; תוצאה חלקית → 503, לנסות שוב), וחיפוש t באמת מחזיר את k (אחרת 422).
//   הראשון שאושר קובע: כינוי קיים עם t אחר → 409 (אותו t → 200). POST {q, del:1, t} → מחיקה ("לא נכון?") רק אם t זהה לכינוי השמור
//   (בלי תלות באותיות גדולות/קטנות), אחרת 409; אין כינוי → 200 deleted:false. קצב: 5 בשעה ל-IP. בזיכרון: כינוי שנמצא 2 דקות, "אין כינוי" 60 שניות.
// GET /n/<k>[?s=d] (rewrite ב-vercel.json → /api/nf-search?og=<k>&s=d): דף HTML קטן לתצוגה מקדימה בוואטסאפ (og:title/description/image מ-TMDB,
//   he-IL עם נפילה ל-en-US) שמעביר מיד לאפליקציה ./?nf=<k>[&s=d]. k = m<id>|t<id>, s=d = דיסני+. מטמון: זיכרון + Firestore (cache/og/<k>.json) ל-24 שעות.
//   TMDB לא זמין: דף כללי ("זפזופ", og-join.png) עם אותה הפניה. קצב: 60 בדקה ל-IP. k לא תקין → 400.
import { createHash } from "node:crypto";
import { searchNf, cleanQuery, norm, SEARCH_TTL } from "./_nfs.js";
import { tget, shapeTitle, img, okKey } from "./_tmdb.js";
import { readJson, writeJson } from "./_push.js";
import { delJson } from "./_db.js";
import { allow, clientIp, tooMany, fail } from "./_guard.js";

const mem = new Map();      // hash -> {t, v}
export const PARTIAL_TTL = 5 * 60000;
const provCache = new Map(); // k -> {t, v}  (זמינות לפי פריט, בין חיפושים)
export const _clearCache = () => { mem.clear(); provCache.clear(); aliasMem.clear(); ogMem.clear(); };

export const CACHE_V = "6"; // להעלות בכל שינוי בלוגיקת החיפוש, כדי שתוצאות ישנות לא יוגשו מהמטמון
export const hashOf = (q) => createHash("sha256").update(CACHE_V + "|" + (norm(q) || q.toLowerCase())).digest("hex").slice(0, 32);

// ---- כינויים בעברית שנלמדו מהשימוש ----
const HEB = /[\u0590-\u05FF]/;
export const aliasPath = (q) => "alias/" + createHash("sha256").update(norm(q)).digest("hex").slice(0, 32) + ".json";
const aliasMem = new Map(); // norm(q) -> {exp, t}
export const ALIAS_HIT_TTL = 2 * 60000, ALIAS_MISS_TTL = 60000; // "אין כינוי" קצר, כדי שכינוי חדש/מחיקה יתפסו מהר בכל ה-instances
export const _clearAlias = () => aliasMem.clear();
async function aliasOf(q, rj, now) {
  if (!HEB.test(q)) return "";
  const n = norm(q), c = aliasMem.get(n);
  if (c && now < c.exp) return c.t;
  let t = "";
  try { const a = await rj(aliasPath(q), null); if (a && typeof a.t === "string") t = cleanQuery(a.t); } catch (e) { /* לא זמין: בלי כינוי */ }
  aliasMem.set(n, { exp: now + (t ? ALIAS_HIT_TTL : ALIAS_MISS_TTL), t });
  if (aliasMem.size > 2000) aliasMem.clear();
  return t;
}
const sameT = (a, b) => typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
export async function handleAlias(body, d = {}) {
  const q = cleanQuery(body && body.q), t = cleanQuery(body && body.t), k = String((body && body.k) || "");
  const now = d.now ? d.now() : Date.now(), rj = d.readJson || readJson, wj = d.writeJson || writeJson, dj = d.delJson || delJson;
  if (!q || !HEB.test(q) || q.length > 40) return { status: 400, json: { error: "bad alias" } };
  const cur = await rj(aliasPath(q), null), curT = cur && typeof cur.t === "string" ? cur.t : "";
  if (body && body.del) { // "לא נכון?": מוחקים רק את הכינוי שהלקוח ראה (t), לא כינוי אחר שנשמר בינתיים
    if (!t) return { status: 400, json: { error: "bad alias" } };
    if (!curT) { aliasMem.delete(norm(q)); return { status: 200, json: { ok: true, deleted: false } }; }
    if (!sameT(curT, t)) return { status: 409, json: { error: "alias mismatch" } };
    await dj(aliasPath(q)); aliasMem.delete(norm(q));
    return { status: 200, json: { ok: true, deleted: true } };
  }
  if (!t || HEB.test(t) || t.length > 80 || !okKey(k)) return { status: 400, json: { error: "bad alias" } };
  if (curT) return sameT(curT, t) ? { status: 200, json: { ok: true, exists: true } } : { status: 409, json: { error: "alias exists" } }; // הראשון שאושר קובע
  // כינוי רק לשאילתה שלא מוצאת כלום בעצמה (אחרת "לזכור" היה דורס תוצאות אמיתיות לכל המשתמשים)
  const own = await handleSearch(q, { ...d, noAlias: true });
  const oj = own && own.json;
  if (!own || own.status !== 200 || !oj) return { status: 503, json: { error: "retry" } };
  if (oj.collection || oj.brand || (Array.isArray(oj.titles) && oj.titles.length)) return { status: 409, json: { error: "query has results" } };
  if (oj.partial) return { status: 503, json: { error: "retry" } }; // לא בטוח שבאמת אין תוצאות (ויקינתונים/TMDB נפלו)
  const r = await handleSearch(t, d); // אימות: החיפוש באנגלית באמת מוצא את k
  const j = r && r.json, found = !!(j && j.items && j.items[k]);
  if (!found) return { status: 422, json: { error: "no match" } };
  await wj(aliasPath(q), { q, t, k, at: now });
  aliasMem.delete(norm(q));
  return { status: 200, json: { ok: true } };
}

// d (לבדיקות): {fetch, key, readJson, writeJson, now, noAlias}
export async function handleSearch(q0, d = {}) {
  const q1 = cleanQuery(q0);
  if (!q1) return { status: 400, json: { error: "bad query" } };
  if (!d.key && !process.env.TMDB_API_KEY) return { status: 503, json: { error: "not configured" } };
  const now = d.now ? d.now() : Date.now(), rj = d.readJson || readJson, wj = d.writeJson || writeJson;
  const via = d.noAlias ? "" : await aliasOf(q1, rj, now), q = via || q1; // "חילופי בתים" → "A Couple of Lies"
  const h = hashOf(q), path = `cache/nf/${h}.json`;
  const back = (v) => (via ? { ...v, q: q1, alias: via } : v); // השאילתה המקורית (הלקוח משווה למה שהוקלד) + alias, ל"לא נכון?"
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

// ---- /n/<k>: תצוגה מקדימה בוואטסאפ להמלצה 💌 ----
export const APP_URL = "https://eladweiss-ops.github.io/tv-guide/";
export const SELF_URL = "https://tv-guide-cal.vercel.app";
export const OG_GENERIC_IMG = APP_URL + "og-join.png";
export const OG_TTL = 24 * 3600 * 1000;
const ogMem = new Map(); // k -> {exp, v}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function trimText(s, n = 150) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n), sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, "") + "…";
}
// פרטי הפריט מ-TMDB (he-IL, נפילה ל-en-US). מחזיר {type,title,desc,image,w,h} או null בכשל
async function ogData(k, d) {
  const type = k[0] === "t" ? "tv" : "movie", id = +k.slice(1), path = "/" + type + "/" + id;
  const one = (lang) => tget(path, { language: lang }, d).catch(() => null);
  const [he, en] = await Promise.all([one("he-IL"), one("en-US")]);
  const ok = (x) => x && x.id === id;
  const base = ok(he) ? he : ok(en) ? en : null;
  if (!base) return null;
  const o = shapeTitle(base, ok(en) ? en : null, type);
  if (!o) return null;
  const bd = img(base.backdrop_path || (en && en.backdrop_path), "w780"), ps = img(base.poster_path || (en && en.poster_path), "w500");
  return { type, title: o.title, desc: trimText(o.overview), image: bd || ps, w: bd ? 780 : ps ? 500 : 0, h: bd ? 439 : ps ? 750 : 0 };
}
export function ogHtml(k, ds, v) {
  const target = APP_URL + "?nf=" + k + (ds ? "&s=d" : ""), self = SELF_URL + "/n/" + k + (ds ? "?s=d" : "");
  const svc = ds ? "בדיסני+" : "בנטפליקס";
  const title = v ? v.title + " · " + (v.type === "tv" ? "סדרה" : "סרט") + " " + svc : "זפזופ · המלצה " + svc;
  const desc = (v && v.desc) || "לוח שידורים, חיפוש ותזכורות – כל מה שעל המסך במקום אחד";
  const image = (v && v.image) || OG_GENERIC_IMG;
  const prop = [
    ["og:type", "website"], ["og:site_name", "זפזופ"], ["og:locale", "he_IL"], ["og:title", title], ["og:description", desc], ["og:url", self], ["og:image", image],
    ...(v && v.image && v.w ? [["og:image:width", v.w], ["og:image:height", v.h]] : []),
  ].map(([p, c]) => '<meta property="' + p + '" content="' + esc(c) + '">');
  const name = [["description", desc], ["twitter:card", "summary_large_image"], ["twitter:title", title], ["twitter:description", desc], ["twitter:image", image]]
    .map(([p, c]) => '<meta name="' + p + '" content="' + esc(c) + '">');
  const js = JSON.stringify(target); // target = כתובת קבועה + k שעבר okKey: אין תווים מיוחדים
  return [
    "<!doctype html>", '<html lang="he" dir="rtl"><head><meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>" + esc(title) + "</title>", ...name, ...prop,
    '<meta http-equiv="refresh" content="0;url=' + esc(target) + '">',
    "<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#111;color:#fff;text-align:center;padding:32px 16px}img{max-width:100%;border-radius:12px}a{display:inline-block;margin-top:16px;padding:12px 24px;border-radius:12px;background:#f97316;color:#fff;text-decoration:none;font-weight:600}</style>",
    "</head><body>", ...(v && v.image ? ['<img src="' + esc(image) + '" alt="">'] : []), "<h1>" + esc(v ? v.title : "זפזופ") + "</h1>",
    '<a href="' + esc(target) + '">פתיחה בזפזופ</a>', "<script>location.replace(" + js + ");</script>", "</body></html>",
  ].join("\n");
}
// d (לבדיקות): {fetch, key, readJson, writeJson, now}. מחזיר {status, html, generic, cache}
export async function handleOg(k0, s0, d = {}) {
  const k = String(k0 || ""), ds = s0 === "d";
  if (!okKey(k)) return { status: 400, html: "", generic: true };
  const now = d.now ? d.now() : Date.now(), rj = d.readJson || readJson, wj = d.writeJson || writeJson, path = "cache/og/" + k + ".json";
  const m = ogMem.get(k);
  if (m && now < m.exp) return { status: 200, html: ogHtml(k, ds, m.v), generic: !m.v, cache: "mem" };
  try {
    const b = await rj(path, null);
    if (b && typeof b.t === "number" && b.v && now - b.t < OG_TTL) { ogMem.set(k, { exp: b.t + OG_TTL, v: b.v }); return { status: 200, html: ogHtml(k, ds, b.v), generic: false, cache: "db" }; }
  } catch (e) { /* מטמון לא זמין */ }
  let v = null;
  try { v = await ogData(k, d); } catch (e) { console.error("nf-og tmdb", e && e.message); }
  ogMem.set(k, { exp: now + (v ? OG_TTL : PARTIAL_TTL), v }); // כשל: דף כללי, וננסה שוב אחרי 5 דקות
  if (ogMem.size > 500) for (const [x, y] of ogMem) if (now >= y.exp) ogMem.delete(x);
  if (v) try { await wj(path, { t: now, v }); } catch (e) { console.error("nf-og cache write", e && e.message); }
  return { status: 200, html: ogHtml(k, ds, v), generic: !v, cache: "miss" };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if ((req.method === "GET" || req.method === "HEAD") && req.query && req.query.og != null) {
    try {
      if (!allow("nfo:ip:" + clientIp(req), 60)) return tooMany(res);
      const r = await handleOg(String(req.query.og), String(req.query.s || ""));
      res.setHeader("content-type", r.status === 200 ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
      res.setHeader("cache-control", r.status !== 200 ? "no-store" : r.generic ? "public, max-age=300" : "public, max-age=3600");
      return res.status(r.status).end(r.status === 200 ? (req.method === "HEAD" ? "" : r.html) : "bad key");
    } catch (e) { return fail(res, e, "nf-og"); }
  }
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
