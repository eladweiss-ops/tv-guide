// ▶ טריילר לתוכנית מהלוח: GET /api/nf-search?vid=<שם>[&y=<שנה>] → {yt, k, name} או {} כשאין התאמה בטוחה.
// התאמה בטוחה בלבד (כמו בתקצירים – אף פעם לא "הכי קרוב"): ב-TMDB צריך להיות פריט אחד בדיוק (סרט/סדרה) שהשם העברי או המקורי שלו
// זהה לשם התוכנית אחרי ניקוי ("- פרק 3", "עונה חדשה", מספר עונה), ואם ידועה שנה – הפרש של שנה לכל היותר. שניים עם אותו שם = לא בטוח = {}.
// הסרטון: YouTube בלבד, Trailer לפני Teaser, רשמי קודם, עברית קודם ואז אנגלית. מטמון: זיכרון + Firestore (cache/vid/<hash>.json),
// 14 יום כשנמצא, 3 ימים כשלא, 5 דקות כשנכשל.
import { createHash } from "node:crypto";
import { tget } from "./_tmdb.js";
import { norm } from "./_nfs.js";
import { readJson, writeJson } from "./_push.js";

export const VID_V = "1"; // להעלות בכל שינוי בלוגיקת ההתאמה
const HIT_TTL = 14 * 864e5, MISS_TTL = 3 * 864e5, FAIL_TTL = 5 * 60000;
const mem = new Map();
export const _clearVid = () => mem.clear();

// "הייתי שם - עונה חדשה: אסון הצונאמי" -> "הייתי שם"; "קארפול קריוקי 4 - דני סנדרסון" -> "קארפול קריוקי"; "האוס - פרק 12" -> "האוס"
export function cleanTitle(t) {
  let s = String(t || "").replace(/\([^)]*\)/g, " ").replace(/^\s*(ישיר|LIVE|שידור חוזר)\s*[!:-]*\s*/i, "");
  s = s.split(/\s+[-–:|]\s+|:\s/)[0];
  s = s.replace(/\s+(עונה|פרק|ע'|פ')\s*\d*.*$/, "").replace(/\s+עונה חדשה.*$/, "").replace(/\s+\d{1,2}$/, "");
  return s.replace(/\s+/g, " ").trim();
}
const yearOf = (x) => { const m = String(x.release_date || x.first_air_date || "").match(/^(\d{4})/); return m ? +m[1] : 0; };

export function pickMatch(results, q, y) {
  const n = norm(q);
  if (n.length < 2) return null;
  const exact = (results || []).filter((x) => (x.media_type === "movie" || x.media_type === "tv") &&
    [x.title, x.name, x.original_title, x.original_name].some((t) => t && norm(t) === n));
  const ok = y ? exact.filter((x) => !yearOf(x) || Math.abs(yearOf(x) - y) <= 1) : exact;
  return ok.length === 1 ? ok[0] : null;
}
export function pickVideo(list) {
  const v = (list || []).filter((x) => x && x.site === "YouTube" && /^[\w-]{6,20}$/.test(x.key || "") && (x.type === "Trailer" || x.type === "Teaser"));
  v.sort((a, b) => (a.type === "Trailer" ? 0 : 1) - (b.type === "Trailer" ? 0 : 1) || (b.official ? 1 : 0) - (a.official ? 1 : 0));
  return v[0] || null;
}

// d (לבדיקות): {fetch, key, readJson, writeJson, now}
export async function handleVid(t0, y0, d = {}) {
  const q = cleanTitle(String(t0 || "").slice(0, 120)), y = /^(19|20)\d\d$/.test(String(y0 || "")) ? +y0 : 0;
  if (norm(q).length < 2) return { status: 400, json: { error: "bad title" } };
  const now = d.now ? d.now() : Date.now(), rj = d.readJson || readJson, wj = d.writeJson || writeJson;
  const h = createHash("sha256").update(VID_V + "|" + norm(q) + "|" + y).digest("hex").slice(0, 32), path = "cache/vid/" + h + ".json";
  const m = mem.get(h);
  if (m && now < m.exp) return { status: 200, json: m.v, cache: "mem" };
  try {
    const b = await rj(path, null);
    if (b && typeof b.t === "number" && b.v && now - b.t < (b.v.yt ? HIT_TTL : MISS_TTL)) { mem.set(h, { exp: b.t + (b.v.yt ? HIT_TTL : MISS_TTL), v: b.v }); return { status: 200, json: b.v, cache: "db" }; }
  } catch (e) { /* מטמון לא זמין */ }
  let v = {};
  try {
    const s = await tget("/search/multi", { query: q, language: "he-IL", include_adult: "false" }, d);
    const x = pickMatch(s && s.results, q, y);
    if (x) {
      const type = x.media_type === "tv" ? "tv" : "movie";
      let vid = pickVideo((await tget(`/${type}/${x.id}/videos`, { language: "he-IL" }, d)).results);
      if (!vid) vid = pickVideo((await tget(`/${type}/${x.id}/videos`, { language: "en-US" }, d)).results);
      if (vid) v = { yt: vid.key, k: (type === "tv" ? "t" : "m") + x.id, name: String(x.title || x.name || "") };
    }
  } catch (e) {
    if (e && e.status === 503) return { status: 503, json: { error: "not configured" } };
    mem.set(h, { exp: now + FAIL_TTL, v: {} });
    return { status: 200, json: {}, failed: true };
  }
  mem.set(h, { exp: now + (v.yt ? HIT_TTL : MISS_TTL), v });
  if (mem.size > 2000) mem.clear();
  try { await wj(path, { t: now, v }); } catch (e) { console.error("vid cache write", e && e.message); }
  return { status: 200, json: v, cache: "miss" };
}
