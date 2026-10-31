// שולף מ-TMDB (+ ציונים מ-OMDb) מה פופולרי, יצא לאחרונה ומדורג בנטפליקס ובדיסני+ ישראל, לקבצים netflix.json ו-disney.json
// (אותה סכמה בדיוק; בונה אחד שמקבל הגדרת שירות: SERVICES). מכסת OMDb אחת משותפת לשני השירותים בכל הרצה.
//
// הרצה (PowerShell):
//   $env:TMDB_API_KEY = "..."      # חובה. v3 (קצר) או Read Access Token (מתחיל ב-eyJ)
//   $env:OMDB_API_KEY = "..."      # אופציונלי. בלעדיו אין ציוני IMDb/RT/Metacritic
//   node netflix.mjs
//
// הסקריפט אף פעם לא מפיל את הצנרת: בכל כשל (רשת, מפתח, תשובה ריקה או דלילה) הוא משאיר
// את הקובץ הקודם של אותו שירות (כשל בשירות אחד לא משפיע על השני) ויוצא עם קוד 0. לא כותבים אם popular < 10 או שחסר סוג שלם (סרטים/סדרות).
//
// מבנה netflix.json (v = גרסת סכמה):
// {
//   "v": 2,
//   "updated": "ISO date",
//   "hero": "m603",                       // מפתח פריט לכרטיס העליון: מבין הפופולריים עם backdrop ומספיק הצבעות,
//                                         // הכי גבוה לפי IMDb, ואם אין אז לפי ציון TMDB
//   "rows": {                             // שורות, כל אחת רשימת מפתחות לפי הסדר (רק פריטים עם poster)
//     "popular": ["m603", "t1396"],       // הכי נצפים
//     "recent":  [...],                   // יצא לאחרונה (60 הימים האחרונים), לפי date יורד. לא "חדש בנטפליקס"
//     "top":     [...],                   // הכי מדורגים (עם מינימום הצבעות)
//     // שורות נוספות (עד 24 פריטים כל אחת, פריט מופיע בעד 2 שורות; שורה עם פחות מ-4 לא נכתבת):
//     "israeli", "week", "series", "movies", "comedy", "crime", "docu", "family"
//   },
//   "rowMeta": { "israeli": { "title": "🇮🇱 ישראלי בנטפליקס" }, ... },  // כותרות השורות; הלקוח מצייר לפיהן. לקוח ישן מתעלם משורות לא מוכרות
//   "items": {                            // מפתח = "m"|"t" + מזהה TMDB; כל פריט פעם אחת
//     "m603": {
//       "id": 603, "type": "movie",       // movie | tv
//       "title": "מטריקס", "orig": "The Matrix", "year": 1999, "date": "1999-03-30",
//       "overview": "...",                // עברית, ואם חסר אז אנגלית
//       "poster": "https://image.tmdb.org/t/p/w342/..",
//       "backdrop": "https://image.tmdb.org/t/p/w780/..",
//       "genres": ["פעולה", "מדע בדיוני"],
//       "runtime": 136,                   // דקות (סרט)  |  "seasons": 5 (סדרה)
//       "imdb_id": "tt0133093",
//       "link": "https://www.netflix.com/search?q=..",  // חיפוש בשירות לפי orig (אם שונה מהעברית) אחרת title. בדיסני+: https://www.disneyplus.com/he-il/search?q=..
//       "trailer": "vKQi3bBA1y8",         // מפתח YouTube, אם יש
//       "vote": 8.2, "vote_count": 25000, // TMDB
//       "ratings": { "imdb": 8.7, "votes": 2000000, "rt": 83, "mc": 73 }  // רק שדות קיימים; imdb רק עם 50+ הצבעות
//     }
//   }
// }
//
// ratings-cache.json: { "tt0133093": { "t": <ms>, "r": {imdb, votes, rt, mc} } }. תקף 7 ימים,
// נשלפים רק חסרים/ישנים, עד 300 בקשות OMDb בהרצה (מכסה חינמית: 1000 ליום).
// נשמרות רק תשובות תקינות או "Incorrect IMDb ID"; שגיאות זמניות לא נשמרות.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SCHEMA = 2;
export const NETFLIX = "8"; // מזהה נטפליקס ב-TMDB
export const DISNEY = "337"; // מזהה דיסני+ ב-TMDB (ברירת מחדל; בריצה מחפשים לפי השם "Disney Plus")
export const ROW_LIMIT = 20;
export const NEW_LIMIT = 24;   // פריטים בשורה חדשה
export const NEW_PAGES = 2;    // עמודי discover (20 בכל אחד) לכל שאילתה
export const MAX_ROWS_PER_ITEM = 2;
export const MIN_ROW = 4;      // שורה חדשה עם פחות פריטים לא נכתבת
export const OMDB_CAP = 300;
export const CACHE_DAYS = 7;
export const POOL = 8;
export const MIN_POPULAR = 10;
export const MIN_IMDB_VOTES = 50;
export const HERO_MIN_VOTES = 100;
export const HERO_MIN_IMDB_VOTES = 1000;
const IMG = "https://image.tmdb.org/t/p/";

// ---------- רשת ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch עם timeout של 15 שניות, ו-retry אחד על 429/5xx לפי Retry-After (ברירת מחדל 2 שניות)
export async function fetchRetry(url, init = {}, { retry = true } = {}) {
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
    if (!retry || attempt === 1 || !(res.status === 429 || res.status >= 500)) return res;
    const ra = Number(res.headers && res.headers.get && res.headers.get("retry-after"));
    await sleep(Math.min(Number.isFinite(ra) && ra >= 0 ? ra * 1000 : 2000, 10000));
  }
  return res;
}

// מריץ משימות במקביל, עד n בכל רגע
export async function pool(tasks, n = POOL) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (i < tasks.length) {
        const j = i++;
        out[j] = await tasks[j]();
      }
    })
  );
  return out;
}

// ---------- TMDB ----------
let warned401 = false;
function makeTmdb(key) {
  const bearer = key.length > 60;
  return async function tmdb(path, params = {}) {
    const u = new URL("https://api.themoviedb.org/3" + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (!bearer) u.searchParams.set("api_key", key);
    const res = await fetchRetry(u, { headers: bearer ? { Authorization: "Bearer " + key } : {} });
    if (res.status === 401 && !warned401) {
      warned401 = true;
      console.error("אזהרה: TMDB החזיר 401. מפתח TMDB_API_KEY לא תקין או פג תוקף (המפתח לא מודפס).");
    }
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  };
}

const discFor = (providerId) => ({
  language: "he-IL",
  include_adult: "false",
  watch_region: "IL",
  with_watch_providers: String(providerId),
  with_watch_monetization_types: "flatrate",
});
const disc = discFor(NETFLIX);

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const key = (type, id) => (type === "movie" ? "m" : "t") + id;

// pages: כמה עמודי discover לשלוף (20 תוצאות בכל אחד). עמוד שנכשל לא מפיל את השאר
async function list(tmdb, type, extra, { pages = 1, limit = ROW_LIMIT, d = disc } = {}) {
  const got = await Promise.all(
    Array.from({ length: pages }, async (_, i) => {
      try {
        const j = await tmdb("/discover/" + type, { ...d, ...extra, ...(i ? { page: String(i + 1) } : {}) });
        return j.results || [];
      } catch (e) {
        console.error("discover " + type + (i ? " עמוד " + (i + 1) : "") + ": " + e.message);
        return [];
      }
    })
  );
  const out = [], seen = new Set();
  for (const r of got.flat()) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ type, id: r.id, pop: r.popularity || 0, date: r.release_date || r.first_air_date || "" });
  }
  return out.slice(0, limit);
}

// ---------- שורות חדשות ----------
// כותרות השורות (הלקוח מצייר לפיהן, לכן כאן המקום היחיד לשנות ניסוח)
export const ROW_META = {
  popular: { title: "הכי נצפים" },
  recent: { title: "יצא לאחרונה" },
  top: { title: "הכי מדורגים" },
  israeli: { title: "🇮🇱 ישראלי בנטפליקס" },
  week: { title: "🆕 יצא החודש" }, // TMDB לא יודע מתי עלה לנטפליקס ישראל; מקרבים לפי תאריך יציאה ב-30 הימים האחרונים
  series: { title: "📺 סדרות" },
  movies: { title: "🎬 סרטים" },
  comedy: { title: "😂 קומדיה" },
  crime: { title: "🔪 מתח ופשע" },
  docu: { title: "🎙 דוקו" },
  family: { title: "👨‍👩‍👧 לכל המשפחה" },
};
export const NEW_ORDER = ["israeli", "week", "series", "movies", "comedy", "crime", "docu", "family"];

// הגדרות השאילתות: לכל שורה רשימת [סוג, פרמטרים]. שאילתות מאותו סוג מאוחדות (או).
// ב-TMDB פסיק = וגם, קו אנכי = או. בז'אנרים משתמשים ב-או (מתח או פשע), אחרת מקבלים רק את החיתוך הצר.
const popSort = { sort_by: "popularity.desc" };
export function newRowSpecs(now = Date.now()) {
  const d30 = new Date(now - 30 * 86400000).toISOString().slice(0, 10), d0 = new Date(now).toISOString().slice(0, 10);
  const genre = (m, t) => [["movie", { ...popSort, with_genres: m }], ["tv", { ...popSort, with_genres: t }]];
  return {
    israeli: [
      ["movie", { ...popSort, with_original_language: "he" }], ["movie", { ...popSort, with_origin_country: "IL" }],
      ["tv", { ...popSort, with_original_language: "he" }], ["tv", { ...popSort, with_origin_country: "IL" }],
    ],
    week: [
      ["movie", { ...popSort, "primary_release_date.gte": d30, "primary_release_date.lte": d0 }],
      ["tv", { ...popSort, "first_air_date.gte": d30, "first_air_date.lte": d0 }],
    ],
    series: [["tv", popSort]],
    movies: [["movie", popSort]],
    comedy: genre("35", "35"),
    crime: genre("80|53", "80|9648"),
    docu: genre("99", "99"),
    family: genre("10751|16", "10751|10762"),
  };
}

// מציב מועמדים בשורה לפי הסדר, בלי לעבור MAX_ROWS_PER_ITEM שורות לפריט. counts משתנה במקום
export function place(cands, limit, counts) {
  const out = [];
  for (const r of cands) {
    if (out.length >= limit) break;
    const k = key(r.type, r.id);
    if ((counts.get(k) || 0) >= MAX_ROWS_PER_ITEM) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
    out.push(r);
  }
  return out;
}

// ---------- דיסני+ ----------
// שורות דיסני+ (הכי נצפים והכי מדורגים הן שורות הבסיס). with_companies: 420 מארוול סטודיוס, 1 לוקאספילם, 3 פיקסאר
export const DISNEY_META = {
  popular: { title: "🔥 הכי נצפים" },
  week: { title: "🆕 יצא החודש" },
  series: { title: "📺 סדרות" },
  movies: { title: "🎬 סרטים" },
  kids: { title: "🧸 ילדים ומשפחה" },
  marvel: { title: "🦸 מארוול" },
  starwars: { title: "⭐ מלחמת הכוכבים" },
  pixar: { title: "🎈 פיקסאר" },
  top: { title: "🏆 הכי מדורגים" },
};
export const DISNEY_ORDER = ["week", "series", "movies", "kids", "marvel", "starwars", "pixar"];
export function disneyRowSpecs(now = Date.now()) {
  const d30 = new Date(now - 30 * 86400000).toISOString().slice(0, 10), d0 = new Date(now).toISOString().slice(0, 10);
  const co = (id) => [["movie", { ...popSort, with_companies: id }], ["tv", { ...popSort, with_companies: id }]];
  return {
    week: [
      ["movie", { ...popSort, "primary_release_date.gte": d30, "primary_release_date.lte": d0 }],
      ["tv", { ...popSort, "first_air_date.gte": d30, "first_air_date.lte": d0 }],
    ],
    series: [["tv", popSort]],
    movies: [["movie", popSort]],
    kids: [["movie", { ...popSort, with_genres: "10751|16" }], ["tv", { ...popSort, with_genres: "10762|10751|16" }]],
    marvel: co("420"),
    starwars: co("1"),
    pixar: co("3"),
  };
}

// הגדרת שירות: כל מה שמבדיל בין קבצי הפלט. base = שורות הבסיס (popular חובה, top ממוין לפי IMDb בסוף).
// resolveName: שם ספק ב-/watch/providers (מחפשים בזמן ריצה, ואם נכשל: providerId)
export const SERVICES = {
  netflix: {
    id: "netflix", file: "netflix.json", providerId: NETFLIX, resolveName: null, linkBase: "https://www.netflix.com/search?q=",
    base: ["popular", "recent", "top"], order: NEW_ORDER, meta: ROW_META, specs: newRowSpecs, priority: ["popular", "top", "israeli", "recent"],
  },
  disney: {
    id: "disney", file: "disney.json", providerId: DISNEY, resolveName: /^disney\s*(plus|\+)/i, linkBase: "https://www.disneyplus.com/he-il/search?q=",
    base: ["popular", "top"], order: DISNEY_ORDER, meta: DISNEY_META, specs: disneyRowSpecs, priority: ["popular", "top", "week"],
  },
};

// מזהה הספק ב-TMDB לפי שם (ישראל). כשל או אין התאמה: ברירת המחדל של השירות
export async function resolveProvider(tmdb, svc) {
  if (!svc.resolveName) return String(svc.providerId);
  try {
    const j = await tmdb("/watch/providers/movie", { watch_region: "IL", language: "en-US" });
    const p = ((j && j.results) || []).find((x) => x && typeof x.provider_name === "string" && svc.resolveName.test(x.provider_name) && Number.isInteger(x.provider_id));
    if (p) return String(p.provider_id);
  } catch (e) {
    console.error("providers " + svc.id + ": " + e.message + ", משתמש במזהה ברירת המחדל");
  }
  return String(svc.providerId);
}

// מועמדים לשורה חדשה: איחוד שאילתות לפי סוג, ואז סרטים וסדרות לסירוגין (או סוג אחד)
async function newRowCands(tmdb, queries, d = disc) {
  const by = { movie: new Map(), tv: new Map() };
  const lists = await pool(queries.map(([t, e]) => () => list(tmdb, t, e, { pages: NEW_PAGES, limit: NEW_PAGES * 20, d })));
  queries.forEach(([t], i) => { for (const r of lists[i]) if (!by[t].has(r.id)) by[t].set(r.id, r); });
  return mergeRow([...by.movie.values()], [...by.tv.values()], (a, b) => b.pop - a.pop, NEW_PAGES * 40);
}

// ---------- מיזוג ושליפת פרטים ----------
// סרטים וסדרות לסירוגין, כל אחד לפי הסדר שלו. ציוני הפופולריות של TMDB לא בני השוואה בין הסוגים
// (סדרות תמיד גבוהות יותר), ומיון משותף השאיר שורה של סדרות בלבד.
export function mergeRow(a, b, sorter, limit = ROW_LIMIT) {
  const x = [...a].sort(sorter), y = [...b].sort(sorter), out = [];
  for (let i = 0; out.length < limit && (i < x.length || i < y.length); i++) {
    if (i < x.length) out.push(x[i]);
    if (i < y.length && out.length < limit) out.push(y[i]);
  }
  return out;
}

const hasHeb = (s) => /[֐-׿]/.test(s || "");

// he = תשובת he-IL (עם append_to_response), en = תשובת en-US (או null)
export function shapeItem(type, he, en, linkBase = SERVICES.netflix.linkBase) {
  const orig = he.original_title || he.original_name || "";
  let title = (he.title || he.name || "").trim();
  if (!title || (!hasHeb(title) && en)) title = ((en && (en.title || en.name)) || title || orig).trim();
  let overview = (he.overview || "").trim();
  if (!overview && en) overview = (en.overview || "").trim();
  const date = he.release_date || he.first_air_date || "";
  const ext = he.external_ids || {};
  const vids = (he.videos && he.videos.results) || [];
  const tr = vids.find((v) => v.site === "YouTube" && v.type === "Trailer") || vids.find((v) => v.site === "YouTube");
  const origOut = orig && orig !== title ? orig : "";
  const it = {
    id: he.id,
    type,
    title,
    orig: origOut,
    year: date ? Number(date.slice(0, 4)) : 0,
    date,
    overview,
    poster: he.poster_path ? IMG + "w342" + he.poster_path : "",
    backdrop: he.backdrop_path ? IMG + "w780" + he.backdrop_path : "",
    genres: (he.genres || []).map((g) => g.name).filter(Boolean),
    imdb_id: he.imdb_id || ext.imdb_id || "",
    link: linkBase + encodeURIComponent(origOut || title),
    trailer: tr ? tr.key : "",
    vote: he.vote_average ? Math.round(he.vote_average * 10) / 10 : 0,
    vote_count: he.vote_count || 0,
  };
  if (type === "movie") it.runtime = he.runtime || 0;
  else it.seasons = he.number_of_seasons || 0;
  return it;
}

async function details(tmdb, type, id, linkBase) {
  const he = await tmdb(`/${type}/${id}`, {
    language: "he-IL",
    append_to_response: "external_ids,videos",
    include_video_language: "he,en,null",
  });
  let en = null;
  const title = he.title || he.name || "";
  if (!(he.overview || "").trim() || !title.trim() || !hasHeb(title)) {
    try {
      en = await tmdb(`/${type}/${id}`, { language: "en-US" });
    } catch {}
  }
  return shapeItem(type, he, en, linkBase);
}

// ---------- OMDb ----------
const num = (s) => {
  const n = parseFloat(String(s).replace(/,/g, "").replace("%", "").split("/")[0]);
  return Number.isFinite(n) ? n : null;
};

// מקבל תשובת OMDb, מחזיר {imdb, votes, rt, mc} רק עם שדות תקפים ("N/A" נזרק).
// ציון imdb מוצג רק כשיש לפחות 50 הצבעות.
export function parseOmdb(j) {
  const r = {};
  if (!j || j.Response === "False") return r;
  const votes = j.imdbVotes && j.imdbVotes !== "N/A" ? num(j.imdbVotes) : null;
  if (votes != null) r.votes = votes;
  if (j.imdbRating && j.imdbRating !== "N/A" && votes != null && votes >= MIN_IMDB_VOTES) {
    const n = num(j.imdbRating);
    if (n != null) r.imdb = n;
  }
  for (const s of j.Ratings || []) {
    if (!s || !s.Value || s.Value === "N/A") continue;
    const n = num(s.Value);
    if (n == null) continue;
    if (s.Source === "Rotten Tomatoes") r.rt = n;
    else if (s.Source === "Metacritic") r.mc = n;
  }
  if (r.imdb == null) delete r.votes;
  return r;
}

export const isFresh = (e, now = Date.now()) => !!e && typeof e === "object" && typeof e.t === "number" && now - e.t < CACHE_DAYS * 86400000;

// cache: אובייקט שמשתנה במקום. מחזיר מספר בקשות שנעשו.
export async function fillRatings(ids, cache, omdbKey, { cap = OMDB_CAP, now = Date.now() } = {}) {
  let used = 0;
  // חסרים לגמרי קודם (לפי סדר הקדימות שנמסר), ורק אחר כך מי שפג תוקפו: התקרה לא מרעיבה פריטים חדשים
  const need = [...new Set(ids)].filter((id) => id && !isFresh(cache[id], now));
  const todo = [...need.filter((id) => !cache[id]), ...need.filter((id) => cache[id])];
  for (const id of todo) {
    if (used >= cap) break;
    used++;
    try {
      const res = await fetchRetry(`https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&i=${encodeURIComponent(id)}`, {}, { retry: false });
      if (res.status === 401 || res.status === 429) {
        let msg = ""; try { msg = String((await res.json()).Error || ""); } catch (e) {}
        // אבחון בלי לחשוף את המפתח: רק אורך וצורה
        const shape = `אורך ${omdbKey.length}, ${/^[a-z0-9]+$/i.test(omdbKey) ? "אותיות/ספרות בלבד" : "מכיל תווים אחרים"}`;
        console.error(`אזהרה: OMDb החזיר ${res.status} "${msg}" (מפתח: ${shape}). מפסיק לשלוף ציונים.`);
        break;
      }
      if (!res.ok) continue;
      const j = await res.json();
      if (j.Response === "False") {
        if (/limit|invalid api/i.test(j.Error || "")) {
          console.error("אזהרה: OMDb דחה את המפתח או חרג ממכסה. מפסיק לשלוף ציונים.");
          break;
        }
        if (/incorrect imdb id/i.test(j.Error || "")) cache[id] = { t: now, r: {} };
        continue; // שגיאה זמנית אחרת: לא נשמרת
      }
      cache[id] = { t: now, r: parseOmdb(j) };
    } catch (e) {
      console.error("omdb " + id + ": " + e.message);
    }
  }
  return used;
}

// ---------- הרכבה ----------
export function pickHero(rowIds, items) {
  const score = (it) => (it.ratings && it.ratings.imdb) || it.vote || 0;
  const ok = (it) =>
    it && it.backdrop && ((it.vote_count || 0) >= HERO_MIN_VOTES || (it.ratings && it.ratings.imdb != null && (it.ratings.votes || 0) >= HERO_MIN_IMDB_VOTES));
  let best = null;
  for (const k of rowIds) {
    const it = items[k];
    if (!ok(it)) continue;
    if (!best || score(it) > score(items[best])) best = k;
  }
  return best || "";
}

async function readCache(path) {
  try {
    const c = JSON.parse(await readFile(path, "utf8"));
    return c && typeof c === "object" && !Array.isArray(c) ? c : {};
  } catch {
    return {};
  }
}

// בונה קובץ אחד לשירות אחד. ctx: { tmdb, omdbKey, dir, now, budget:{left} }. budget משותף בין שירותים: כל בקשת OMDb מורידה ממנו
async function buildService(svc, ctx) {
  const { tmdb, omdbKey, dir } = ctx;
  const pid = await resolveProvider(tmdb, svc);
  const d = discFor(pid);
  const from = day(-60), to = day(0);
  const byPop = (a, b) => b.pop - a.pop;
  const specs = [
    ["movie", { sort_by: "popularity.desc" }],
    ["tv", { sort_by: "popularity.desc" }],
    ["movie", { sort_by: "vote_average.desc", "vote_count.gte": 500 }],
    ["tv", { sort_by: "vote_average.desc", "vote_count.gte": 200 }],
  ];
  const withRecent = svc.base.includes("recent");
  if (withRecent) specs.push(
    ["movie", { sort_by: "popularity.desc", "primary_release_date.gte": from, "primary_release_date.lte": to }],
    ["tv", { sort_by: "popularity.desc", "first_air_date.gte": from, "first_air_date.lte": to }],
  );
  const [pm, pt, tm, tt, nm, nt] = await pool(specs.map(([t, e]) => () => list(tmdb, t, e, { d })));
  const refs = { popular: mergeRow(pm, pt, byPop), top: [...tm, ...tt] };
  if (withRecent) refs.recent = mergeRow(nm, nt, byPop);
  // שורות חדשות: מועמדים לכל שורה, ואז הצבה לפי סדר קבוע עם מגבלת "עד 2 שורות לפריט".
  // 'הכי מדורגים' עוד לא סופי (ממתין לציוני OMDb), לכן אכיפה סופית נעשית בסוף (enforceMax)
  const specsNew = svc.specs();
  const cands = await pool(svc.order.map((name) => () => newRowCands(tmdb, specsNew[name], d).catch((e) => { console.error("שורה " + name + ": " + e.message); return []; })));
  const counts = new Map();
  for (const r of [...refs.popular, ...(refs.recent || [])]) counts.set(key(r.type, r.id), 1);
  svc.order.forEach((name, i) => { refs[name] = place(cands[i], NEW_LIMIT, counts); });
  const uniq = new Map();
  for (const r of Object.values(refs).flat()) uniq.set(key(r.type, r.id), r);

  const items = {};
  await pool(
    [...uniq.entries()].map(([k, r]) => async () => {
      try {
        const it = await details(tmdb, r.type, r.id, svc.linkBase);
        if (it.title && it.poster) items[k] = it;
      } catch (e) {
        console.error("details " + k + ": " + e.message);
      }
    })
  );

  const rows = {};
  for (const [name, arr] of Object.entries(refs)) rows[name] = arr.map((r) => key(r.type, r.id)).filter((k) => items[k]);
  const byDate = (a, b) => (items[b].date || "").localeCompare(items[a].date || "");
  if (rows.recent) rows.recent.sort(byDate);
  if (rows.week) rows.week.sort(byDate);

  const types = new Set(rows.popular.map((k) => items[k].type));
  if (rows.popular.length < MIN_POPULAR || !types.has("movie") || !types.has("tv")) {
    console.error(`TMDB החזיר תוצאות דלילות ל-${svc.id} (popular=${rows.popular.length}, סוגים=${[...types].join("/") || "אין"}). ${svc.file} לא עודכן.`);
    return null;
  }

  if (omdbKey) {
    try {
      const cachePath = dir + "/ratings-cache.json";
      const cache = await readCache(cachePath);
      const now = ctx.now ?? Date.now();
      // סדר קדימות לתקרת הבקשות: שורות העדיפות של השירות (משם נבחר הכרטיס הראשי), ואז כל השאר
      const order = [...svc.priority.flatMap((n) => rows[n] || []), ...Object.keys(rows).flatMap((n) => rows[n]), ...Object.keys(items)];
      const used = await fillRatings(order.map((k) => items[k] && items[k].imdb_id), cache, omdbKey, { now, cap: Math.max(0, ctx.budget.left) });
      ctx.budget.left -= used;
      for (const id of Object.keys(cache)) if (!cache[id] || now - (cache[id].t || 0) > CACHE_DAYS * 2 * 86400000) delete cache[id];
      await writeFile(cachePath, JSON.stringify(cache));
      console.log(`OMDb (${svc.id}): ${used} בקשות`);
      for (const it of Object.values(items)) {
        const e = cache[it.imdb_id];
        if (e && e.r && Object.keys(e.r).length) it.ratings = e.r;
      }
    } catch (e) {
      console.error("OMDb נכשל, ממשיך בלי ציונים: " + e.message);
    }
  } else {
    console.log("OMDB_API_KEY לא הוגדר, ללא ציונים");
  }

  // מיון 'הכי מדורגים' אחרי שהציונים מ-OMDb הגיעו
  const score = (it) => (it.ratings && it.ratings.imdb != null ? it.ratings.imdb : it.vote || 0); // IMDb קודם, TMDB כגיבוי
  rows.top.sort((a, b) => score(items[b]) - score(items[a]));
  rows.top = rows.top.slice(0, ROW_LIMIT);
  const hero = pickHero(rows.popular, items);
  const { rows: outRows, items: outItems, rowMeta } = finalize(rows, items, svc);
  const out = { v: SCHEMA, updated: new Date().toISOString(), hero, rows: outRows, rowMeta, items: outItems };
  await writeFile(dir + "/" + svc.file, JSON.stringify(out));
  console.log(`${svc.file}: ${Object.keys(outItems).length} פריטים; ` + Object.keys(outRows).map((n) => `${n}=${outRows[n].length}`).join(" "));
  return out;
}

function ctxOf(opts) {
  const tmdbKey = String(opts.tmdbKey ?? process.env.TMDB_API_KEY ?? "").trim();
  const omdbKey = String(opts.omdbKey ?? process.env.OMDB_API_KEY ?? "").trim();
  if (!tmdbKey) { console.error("חסר TMDB_API_KEY, מדלג"); return null; }
  return { tmdb: makeTmdb(tmdbKey), omdbKey, dir: opts.dir ?? ".", now: opts.now, budget: opts.budget ?? { left: opts.omdbCap ?? OMDB_CAP } };
}

// opts: { tmdbKey, omdbKey, dir, now, omdbCap, service ("netflix" ברירת מחדל | "disney"), budget }
export async function run(opts = {}) {
  const ctx = ctxOf(opts);
  if (!ctx) return null;
  return buildService(SERVICES[opts.service || "netflix"], ctx);
}

// כל השירותים, בזה אחר זה, עם מכסת OMDb משותפת. כשל בשירות אחד לא מפיל את האחר. מחזיר { netflix, disney } (null = לא עודכן)
export async function runAll(opts = {}) {
  const ctx = ctxOf(opts);
  const out = {};
  for (const id of Object.keys(SERVICES)) {
    if (!ctx) { out[id] = null; continue; }
    try { out[id] = await buildService(SERVICES[id], ctx); } catch (e) { console.error(SERVICES[id].file + " נכשל: " + e.message); out[id] = null; }
  }
  return out;
}

// אכיפה סופית: פריט בעד MAX_ROWS_PER_ITEM שורות (עודף יורד מהשורות החדשות האחרונות), שורה חדשה קטנה מדי נושרת,
// פריטים שאף שורה לא מפנה אליהם נושרים, ושדות מיותרים (ריקים, ו-vote/imdb_id שהלקוח לא קורא) נגרעים מהקובץ
export function finalize(rowsIn, itemsIn, svc = SERVICES.netflix) {
  const rows = {}, base = svc.base, order = svc.order;
  for (const n of base) rows[n] = [...(rowsIn[n] || [])];
  for (const n of order) rows[n] = [...(rowsIn[n] || [])];
  const counts = new Map();
  for (const n of [...base, ...order]) {
    rows[n] = rows[n].filter((k) => {
      const c = counts.get(k) || 0;
      if (c >= MAX_ROWS_PER_ITEM && !base.includes(n)) return false;
      counts.set(k, c + 1);
      return true;
    });
  }
  const outRows = {}, rowMeta = {};
  for (const n of [...base, ...order]) {
    if (!base.includes(n) && rows[n].length < MIN_ROW) continue;
    outRows[n] = rows[n]; rowMeta[n] = svc.meta[n];
  }
  const used = new Set(Object.values(outRows).flat());
  const items = {};
  for (const k of used) {
    const it = { ...itemsIn[k] };
    for (const f of ["vote", "vote_count", "imdb_id"]) delete it[f];
    for (const f of Object.keys(it)) if (it[f] === "" || it[f] == null || (Array.isArray(it[f]) && !it[f].length)) delete it[f];
    items[k] = it;
  }
  return { rows: outRows, items, rowMeta };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runAll().catch((e) => console.error("netflix.mjs נכשל: " + e.message));
}
