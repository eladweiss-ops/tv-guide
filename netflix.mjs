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
//     "top10":   [...],                   // נטפליקס בלבד: הטופ 10 הרשמי של נטפליקס ישראל (Tudum, שבועי), סדרות וסרטים לסירוגין לפי הדירוג.
//                                         // לא נכתבת כשהעמוד לא נגיש או שהותאמו פחות מ-5 כותרים
//     "popular": ["m603", "t1396"],       // הכי נצפים
//     "recent":  [...],                   // יצא לאחרונה (60 הימים האחרונים), לפי date יורד. לא "חדש בנטפליקס"
//     "top":     [...],                   // הכי מדורגים (עם מינימום הצבעות)
//     // שורות נוספות (עד 24 פריטים כל אחת, פריט מופיע בעד 2 שורות; שורה עם פחות מ-4 לא נכתבת):
//     "israeli", "week", "series", "movies", "comedy", "crime", "docu", "sportdoc", "family"
//     // week = חדש בשירות: מה שהופיע לראשונה בקטלוג ב-30 הימים האחרונים (netflix-seen.json / disney-seen.json) + מה שיצא ב-30 הימים האחרונים
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
//                                         // כשידוע מזהה נטפליקס (מהטופ 10, נשמר ב-netflix-seen.json): https://www.netflix.com/title/<nfid>
//       "nfid": "81944880",               // אופציונלי: מזהה הכותר בנטפליקס
//       // title: עברית מ-TMDB; אם אין – תווית עברית מוויקינתונים לפי מזהה TMDB, ואחרי הכול nf-he.json (תיקונים ידניים, גובר). האנגלי נשמר ב-orig
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
  top10: { title: "🔥 טופ 10 בישראל" }, // הרשימה הרשמית של נטפליקס (שבועית), ראו top10
  popular: { title: "הכי נצפים" },
  recent: { title: "יצא לאחרונה" },
  top: { title: "הכי מדורגים" },
  israeli: { title: "🇮🇱 ישראלי בנטפליקס" },
  week: { title: "✨ חדש בנטפליקס" }, // מה שהופיע בקטלוג נטפליקס ישראל ב-30 הימים האחרונים (netflix-seen.json) + מה שיצא ב-30 הימים האחרונים
  series: { title: "📺 סדרות" },
  movies: { title: "🎬 סרטים" },
  comedy: { title: "😂 קומדיה" },
  crime: { title: "🔪 מתח ופשע" },
  docu: { title: "🎙 דוקו" },
  sportdoc: { title: "⚽ דוקו ספורט" },
  family: { title: "👨‍👩‍👧 לכל המשפחה" },
};
// סדר ההצבה (עד 2 שורות לפריט: שורה מוקדמת כאן קודמת). סדר התצוגה נקבע בלקוח (ORDER ב-js/netflix.js)
export const NEW_ORDER = ["israeli", "week", "series", "movies", "comedy", "crime", "docu", "sportdoc", "family"];
// מילות מפתח של TMDB לספורט (נבדקו באתר TMDB 8.11.2026): sports documentary, sports, sport, football (soccer), american football,
// basketball, boxing, formula one (f1), motor sport. תמיד יחד עם ז'אנר 99 (דוקו), כך שמקבלים רק דוקו על ספורט.
// "דוקו" הרגיל מחריג אותן (without_keywords), כדי ששתי השורות לא יציגו את אותם פריטים.
export const SPORT_KW = "159290|6075|333328|13042|579|6496|209476|233981|9571";

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
    docu: [["movie", { ...popSort, with_genres: "99", without_keywords: SPORT_KW }], ["tv", { ...popSort, with_genres: "99", without_keywords: SPORT_KW }]],
    sportdoc: [["movie", { ...popSort, with_genres: "99", with_keywords: SPORT_KW }], ["tv", { ...popSort, with_genres: "99", with_keywords: SPORT_KW }]],
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
  week: { title: "✨ יצא החודש" },
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
    base: ["top10", "popular", "recent", "top"], optional: ["top10"], order: NEW_ORDER, meta: ROW_META, specs: newRowSpecs, priority: ["top10", "popular", "top", "israeli", "week", "recent"],
    seenFile: "netflix-seen.json", top10: true, titleBase: "https://www.netflix.com/title/",
  },
  disney: {
    id: "disney", file: "disney.json", providerId: DISNEY, resolveName: /^disney\s*(plus|\+)/i, fallbackRegion: "GB", linkBase: "https://www.disneyplus.com/he-il/search?q=",
    base: ["popular", "top"], order: DISNEY_ORDER, meta: DISNEY_META, specs: disneyRowSpecs, priority: ["popular", "top", "week"],
    seenFile: "disney-seen.json",
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

// ---------- טופ 10 הרשמי של נטפליקס ישראל (שבועי) ----------
// העמודים של Tudum מוטמעים עם נתוני GraphQL: לכל פריט "PulseTop10ItemEntity:top10-<רשימה>-<videoId>" עם weeklyRank,
// ו-"top10Video" עם השם המלא ("Lupin: Part 4"), releaseYear, parentShow (שם הסדרה), ו-displayVideo עם מזהה הסדרה בנטפליקס
// (parentShow.videoId; לעונה עצמה יש מזהה אחר) ו-availabilityStartTime (מתי עלה לנטפליקס). כל פריט מופיע פעמיים (כרטיסים + טבלה).
// כשל (403/מבנה שהשתנה/פחות מ-TOP10_MIN התאמות) = אין שורה, בשקט.
export const TOP10_URLS = { tv: "https://www.netflix.com/tudum/top10/israel/tv", movie: "https://www.netflix.com/tudum/top10/israel" };
export const TOP10_MIN = 5;
export const TOP10_MAX_AGE_DAYS = 21; // רשימה של שבוע ישן מזה (העמוד לא התעדכן) לא מוצגת
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export const NF_TITLE = "https://www.netflix.com/title/";
const unJs = (s) => String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, "$1");
// "Lupin: Part 4" -> "Lupin", "A Couple of Lies: Limited Series" -> "A Couple of Lies"
export const stripSeason = (t) =>
  String(t || "").replace(/:\s*(Season|Part|Volume|Vol\.|Chapter|Book|Series)\s*\d+\s*$/i, "").replace(/:\s*(Limited Series|Miniseries)\s*$/i, "").trim();

export function parseTop10(html, now = Date.now()) {
  const h = String(html || "");
  if (!/"(country|countryId)":"IL"/.test(h)) return []; // לא העמוד של ישראל (הפניה גאוגרפית?)
  const rank = new Map();
  for (const m of h.matchAll(/"PulseTop10ItemEntity:top10-[A-Za-z0-9]+-(\d+)":\{"__typename":"PulseTop10ItemEntity"[^]{0,400}?"weekEndDate":"(\d{4}-\d\d-\d\d)","category":"(\w+)","weeklyRank":(\d+)/g)) {
    if (!rank.has(m[1])) rank.set(m[1], { rank: +m[4], week: m[2] });
  }
  const vids = [...h.matchAll(/"top10Video":\{"__typename":"Top10PulseVideo","title":"((?:[^"\\]|\\.)*)","videoId":(\d+)/g)];
  const out = [], seen = new Set();
  vids.forEach((m, i) => {
    const vid = m[2], r = rank.get(vid);
    if (!r || seen.has(vid)) return;
    seen.add(vid);
    if (now - Date.parse(r.week) > TOP10_MAX_AGE_DAYS * 86400000) return;
    const end = i + 1 < vids.length ? vids[i + 1].index : m.index + 6000;
    const w = h.slice(m.index, Math.min(end, m.index + 6000));
    const full = unJs(m[1]);
    const ps = w.match(/"parentShow":\{"__typename":"Top10PulseVideo","title":"((?:[^"\\]|\\.)*)"/);
    const show = w.match(/"parentShow":\{"__typename":"Show","unifiedEntityId":"Video:(\d+)"/);
    const yr = w.match(/"releaseYear":(\d{4})/);
    const av = w.match(/"availabilityStartTime":"(\d{4}-\d\d-\d\d)T/);
    const isShow = !!ps || /"__typename":"Season"/.test(w);
    out.push({
      rank: r.rank, full, title: ps ? unJs(ps[1]) : stripSeason(full), year: yr ? +yr[1] : 0,
      nfid: isShow ? (show ? show[1] : "") : vid, avail: av ? av[1] : "",
    });
  });
  out.sort((a, b) => a.rank - b.rank);
  // אותה סדרה בכמה עונות/חלקים (Lupin 1, 3, 4): פעם אחת, בדירוג הגבוה
  const once = new Set();
  return out.filter((e) => { const k = e.nfid || e.title.toLowerCase(); if (once.has(k)) return false; once.add(k); return true; });
}

export async function fetchTop10(type) {
  try {
    const res = await fetch(TOP10_URLS[type], { headers: { "user-agent": BROWSER_UA, "accept-language": "en-US,en;q=0.9", accept: "text/html" }, signal: AbortSignal.timeout(20000) });
    if (!res || !res.ok) { console.log("top10 " + type + ": HTTP " + (res && res.status)); return []; }
    return parseTop10(await res.text());
  } catch (e) {
    console.log("top10 " + type + ": " + e.message);
    return [];
  }
}

export const normName = (s) =>
  String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9֐-׿]+/g, " ").trim();

// מחפש ב-TMDB (שם באנגלית). עדיפות: שם זהה (אחרי נרמול), נמצא בקטלוג נטפליקס ישראל (catalog), שנה קרובה, פופולריות.
// בלי שם זהה מתקבל רק פריט מהקטלוג מבין 3 התוצאות הראשונות
export function pickMatch(results, e, type, catalog) {
  let best = null, bs = -1;
  (results || []).slice(0, 10).forEach((r, i) => {
    if (!r || !Number.isInteger(r.id)) return;
    const exact = normName(r.title || r.name) === normName(e.title) || normName(r.original_title || r.original_name) === normName(e.title);
    const inCat = !!(catalog && catalog.has(key(type, r.id)));
    if (!exact && !(inCat && i < 3)) return;
    const yr = +String(r.release_date || r.first_air_date || "").slice(0, 4);
    let s = (exact ? 100 : 0) + (inCat ? 60 : 0) + Math.min(10, Math.log10(1 + (r.popularity || 0)) * 3);
    if (e.year && yr) s += type === "movie" ? (Math.abs(yr - e.year) <= 1 ? 30 : 0) : yr <= e.year ? 10 : -20;
    if (s > bs) { bs = s; best = r; }
  });
  return best;
}

async function matchTop10(tmdb, entries, type, catalog) {
  const got = await pool(entries.map((e) => async () => {
    try {
      const j = await tmdb("/search/" + type, { query: e.title, language: "en-US", include_adult: "false" });
      const r = pickMatch(j.results, e, type, catalog);
      return r ? { type, id: r.id, pop: r.popularity || 0, rank: e.rank, nfid: e.nfid, avail: e.avail, date: r.release_date || r.first_air_date || "" } : null;
    } catch (e2) { return null; }
  }), 4);
  const once = new Set();
  return got.filter((r) => r && !once.has(r.id) && once.add(r.id));
}

// ---------- "חדש בנטפליקס": תמונת מצב של הקטלוג (netflix-seen.json) ----------
// TMDB לא אומר מתי כותר עלה לנטפליקס ישראל. לכן כל לילה סורקים את כל הקטלוג (discover לפי שם, מיון יציב בין עמודים)
// ושומרים מתי ראינו כל מפתח לראשונה. פריט שהופיע לראשונה ב-30 הימים האחרונים = חדש בנטפליקס.
// מבנה: { v:1, region, seed:"YYYY-MM-DD", count, nf:{ מפתח: מזהה נטפליקס }, k:{ מפתח: [ראשון, אחרון] } }
//   ראשון "" = היה כבר בתמונה הראשונה (seed), לא ידוע מתי עלה. אחרון מתעדכן פעם בשבוע (פחות שינויים בקומיט).
//   בימים הראשונים אחרי seed (SEEN_GRACE_DAYS) פריט "חדש" לא נחשב, כי סריקה ראשונה יכולה לפספס מעט פריטים.
//   סריקה חלקית (עמוד שנכשל, חריגת זמן, או ירידה של יותר מ-30% בכמות) לא מוסיפה פריטים חדשים.
//   מפתח שלא נראה 60 יום נמחק (אם יחזור, ייחשב חדש: "חזר לנטפליקס").
export const SEEN_NEW_DAYS = 30, SEEN_PRUNE_DAYS = 60, SEEN_GRACE_DAYS = 3, SEEN_TOUCH_DAYS = 7;
export const CRAWL_MAX_PAGES = 300, CRAWL_BUDGET_MS = 150000;
const dDays = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const addDays = (a, n) => new Date(Date.parse(a) + n * 86400000).toISOString().slice(0, 10);

async function crawlType(tmdb, type, d, { maxPages = CRAWL_MAX_PAGES, deadline = Date.now() + CRAWL_BUDGET_MS } = {}) {
  const sort = { sort_by: type === "movie" ? "original_title.asc" : "original_name.asc" };
  const out = new Map();
  const add = (j) => { for (const r of (j && j.results) || []) if (r && Number.isInteger(r.id)) out.set(key(type, r.id), { type, id: r.id, pop: r.popularity || 0, date: r.release_date || r.first_air_date || "" }); };
  let p1;
  try { p1 = await tmdb("/discover/" + type, { ...d, ...sort }); } catch (e) { console.error("סריקת קטלוג " + type + ": " + e.message); return { map: out, ok: false }; }
  add(p1);
  const pages = Math.max(1, Number(p1.total_pages) || 1);
  let bad = pages > Math.min(maxPages, 500) ? 1 : 0; // יותר עמודים מהתקרה: הסריקה לא שלמה
  await pool(Array.from({ length: Math.min(pages, maxPages, 500) - 1 }, (_, i) => async () => {
    if (Date.now() > deadline) { bad++; return; }
    try { add(await tmdb("/discover/" + type, { ...d, ...sort, page: String(i + 2) })); } catch (e) { bad++; }
  }));
  return { map: out, ok: bad === 0, pages };
}

export async function crawlCatalog(tmdb, d, opts = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? CRAWL_BUDGET_MS);
  const [m, t] = await Promise.all(["movie", "tv"].map((type) => crawlType(tmdb, type, d, { ...opts, deadline })));
  const map = new Map([...m.map, ...t.map]);
  return { map, ok: m.ok && t.ok && m.map.size > 0 && t.map.size > 0, pages: { movie: m.pages || 0, tv: t.pages || 0 } };
}

// מעדכן את תמונת המצב (מחזיר אובייקט חדש). crawl: { map, ok }. today: "YYYY-MM-DD"
export function updateSeen(prev, crawl, { today, region = "" }) {
  const valid = prev && typeof prev === "object" && prev.v === 1 && prev.k && typeof prev.k === "object" && !Array.isArray(prev.k);
  const nf = valid && prev.nf && typeof prev.nf === "object" ? { ...prev.nf } : {};
  let s = valid && (prev.region || "") === (region || "") && prev.seed ? { ...prev, k: { ...prev.k }, nf } : null;
  const seeding = !s;
  if (seeding) {
    if (!crawl.ok) return { v: 1, region, seed: "", count: 0, nf, k: {} }; // seed רק מסריקה שלמה
    s = { v: 1, region, seed: today, count: 0, nf, k: {} };
  }
  const healthy = crawl.ok && (!s.count || crawl.map.size >= s.count * 0.7);
  for (const k of crawl.map.keys()) {
    const e = s.k[k];
    if (Array.isArray(e)) { if (!(dDays(e[1], today) < SEEN_TOUCH_DAYS)) s.k[k] = [e[0], today]; }
    else if (seeding) s.k[k] = ["", today];
    else if (healthy) s.k[k] = [today, today];
  }
  for (const k of Object.keys(s.k)) {
    const e = s.k[k];
    if (!Array.isArray(e) || !(dDays(e[1], today) <= SEEN_PRUNE_DAYS)) delete s.k[k];
  }
  if (healthy) s.count = crawl.map.size;
  return s;
}

// מפתח -> תאריך הופעה ראשונה, לפריטים שהופיעו ב-30 הימים האחרונים (לא ב-seed ולא בימי החסד שאחריו)
export function arrivals(s, today) {
  const out = new Map();
  if (!s || !s.seed || !s.k) return out;
  const from = addDays(s.seed, SEEN_GRACE_DAYS);
  for (const [k, e] of Object.entries(s.k)) if (Array.isArray(e) && e[0] && e[0] >= from && dDays(e[0], today) <= SEEN_NEW_DAYS) out.set(k, e[0]);
  return out;
}

// קובץ קריא בדיפים: שורה לכל מפתח, ממוין
export function seenText(s) {
  const ks = Object.keys(s.k).sort();
  const nf = Object.keys(s.nf || {}).sort();
  return "{\"v\":1,\"region\":" + JSON.stringify(s.region || "") + ",\"seed\":" + JSON.stringify(s.seed || "") + ",\"count\":" + (s.count || 0) +
    ",\n\"nf\":{" + nf.map((k) => "\n" + JSON.stringify(k) + ":" + JSON.stringify(String(s.nf[k]))).join(",") + "},\n\"k\":{" +
    ks.map((k) => "\n" + JSON.stringify(k) + ":" + JSON.stringify(s.k[k])).join(",") + "}}\n";
}

// ---------- שמות בעברית: ויקינתונים לפי מזהה TMDB (P4983 סדרה, P4947 סרט), ואז nf-he.json ----------
export const WIKI_SPARQL = "https://query.wikidata.org/sparql";
export const WIKI_UA = "tv-guide/1.0 (https://eladweiss-ops.github.io/tv-guide/; personal TV guide)"; // מדיניות ויקימדיה: UA עם דרך יצירת קשר
export const WIKI_BUDGET_MS = 15000;
export const cleanHe = (l) => String(l || "").replace(/\s*\([^)]*\)\s*$/, "").trim(); // "מוריד הגשם (סדרת טלוויזיה)" -> "מוריד הגשם"

export async function wikidataHe(keys, { budgetMs = WIKI_BUDGET_MS } = {}) {
  const out = {};
  const deadline = Date.now() + budgetMs;
  for (let i = 0; i < keys.length; i += 150) {
    const part = keys.slice(i, i + 150);
    const tv = part.filter((k) => k[0] === "t").map((k) => JSON.stringify(k.slice(1))), mv = part.filter((k) => k[0] === "m").map((k) => JSON.stringify(k.slice(1)));
    const u = [];
    if (tv.length) u.push(`{ VALUES ?tv { ${tv.join(" ")} } ?s wdt:P4983 ?tv . }`);
    if (mv.length) u.push(`{ VALUES ?mv { ${mv.join(" ")} } ?s wdt:P4947 ?mv . }`);
    if (!u.length) continue;
    const q = `SELECT ?tv ?mv ?l WHERE { ${u.join(" UNION ")} ?s rdfs:label ?l . FILTER(LANG(?l) = "he") }`;
    const left = deadline - Date.now();
    if (left <= 0) break;
    const res = await fetch(WIKI_SPARQL, {
      method: "POST", body: new URLSearchParams({ query: q }).toString(), signal: AbortSignal.timeout(left),
      headers: { "user-agent": WIKI_UA, accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" },
    });
    if (!res || !res.ok) throw new Error("wikidata " + (res && res.status));
    const j = await res.json();
    for (const b of (j && j.results && j.results.bindings) || []) {
      const k = b.tv ? "t" + b.tv.value : b.mv ? "m" + b.mv.value : "";
      const l = cleanHe(b.l && b.l.value);
      if (k && !out[k] && hasHeb(l) && l.length <= 80) out[k] = l;
    }
  }
  return out;
}

// מחליף שם לא-עברי בשם עברי. האנגלי נשמר ב-orig (שם מוצג קטן + חיפוש), וקישור חיפוש נבנה מחדש לפי האנגלי
export function applyHe(it, he, linkBase) {
  if (!it || !hasHeb(he) || it.title === he) return;
  if (!hasHeb(it.title)) it.orig = it.title;
  it.title = he;
  if (linkBase && String(it.link || "").startsWith(linkBase)) it.link = linkBase + encodeURIComponent(it.orig || he);
}

export async function hebrewTitles(items, { overrides = {}, linkBase, budgetMs } = {}) {
  const need = Object.keys(items).filter((k) => items[k] && !hasHeb(items[k].title));
  let n = 0, o = 0;
  if (need.length) {
    try {
      const he = await wikidataHe(need, { budgetMs });
      for (const k of need) if (he[k]) { applyHe(items[k], he[k], linkBase); n++; }
    } catch (e) { console.log("ויקינתונים: " + e.message + " (בלי שינוי)"); }
  }
  for (const [k, t] of Object.entries(overrides || {})) if (items[k] && typeof t === "string" && hasHeb(t)) { applyHe(items[k], t.trim(), linkBase); o++; }
  return { need: need.length, wiki: n, overrides: o };
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
  // אבחון (בלי מפתחות): איזה מזהה ספק נמצא, וכמה תוצאות מחזירה שאילתת בדיקה – עם ובלי סינון flatrate
  if (process.env.GITHUB_ACTIONS === "true") try { // רק בהרצה ב-GitHub (לא בבדיקות)
    const t1 = await tmdb("/discover/movie", Object.assign({}, d, { page: 1 }));
    const d2 = Object.assign({}, d); delete d2.with_watch_monetization_types;
    const t2 = await tmdb("/discover/movie", Object.assign({}, d2, { page: 1 }));
    console.log(`${svc.id}: provider=${pid} total(flatrate)=${t1 && t1.total_results} total(any)=${t2 && t2.total_results}`);
  } catch (e) { console.log(`${svc.id}: provider=${pid} diag failed ${e.message}`); }
  // TMDB לא מחזיר נתוני זמינות לדיסני+ בישראל (גם לא לכל כותר בנפרד; נבדק 1.11.2026). לכן: הקטלוג של אזור הגיבוי
  // (בריטניה, הקרוב ביותר לישראל), והקובץ מסומן region כדי שהלקוח יציג "ייתכנו הבדלים בישראל".
  // אם יום אחד יופיעו נתונים לישראל, הבדיקה הראשונה מחזירה תוצאות ואזור הגיבוי לא בשימוש
  let dd = d, region = "";
  if (svc.fallbackRegion) {
    const probe = await tmdb("/discover/movie", Object.assign({}, d, { page: 1 })).catch(() => null);
    if (!probe || !(probe.total_results || (probe.results || []).length)) { dd = Object.assign({}, d, { watch_region: svc.fallbackRegion }); region = svc.fallbackRegion; console.log(svc.id + ": אין נתונים לישראל ב-TMDB, הקטלוג של " + region); }
  }
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
  const [pm, pt, tm, tt, nm, nt] = await pool(specs.map(([t, e]) => () => list(tmdb, t, e, { d: dd })));
  const refs = { popular: mergeRow(pm, pt, byPop), top: [...tm, ...tt] };
  if (withRecent) refs.recent = mergeRow(nm, nt, byPop);

  // קטלוג מלא -> תמונת מצב -> מה חדש בשירות. כשל = בלי "חדש" (רק לפי תאריך יציאה), אף פעם לא מפיל
  const today = new Date(ctx.now ?? Date.now()).toISOString().slice(0, 10);
  let seen = null, arr = new Map(), catalog = new Map();
  if (svc.seenFile && ctx.seen !== false) {
    try {
      const crawl = await crawlCatalog(tmdb, dd, ctx.crawl || {});
      catalog = crawl.map;
      let prev = null;
      try { prev = JSON.parse(await readFile(dir + "/" + svc.seenFile, "utf8")); } catch (e) {}
      seen = updateSeen(prev, crawl, { today, region });
      arr = arrivals(seen, today);
      console.log(`${svc.id}: קטלוג ${catalog.size} (עמודים ${crawl.pages.movie}/${crawl.pages.tv}${crawl.ok ? "" : ", חלקי"}), seed=${seen.seed || "-"}, חדשים=${arr.size}`);
    } catch (e) { console.error("תמונת מצב " + svc.id + ": " + e.message); }
  }
  // טופ 10 הרשמי (נטפליקס בלבד): סדרות וסרטים לסירוגין, לפי הדירוג
  const nfids = new Map();
  refs.top10 = [];
  if (svc.top10 && ctx.top10 !== false) {
    try {
      const [etv, emv] = await Promise.all([fetchTop10("tv"), fetchTop10("movie")]);
      const [mtv, mmv] = await Promise.all([matchTop10(tmdb, etv, "tv", catalog), matchTop10(tmdb, emv, "movie", catalog)]);
      const all = mergeRow(mtv, mmv, (a, b) => a.rank - b.rank, 20);
      for (const r of all) {
        const k = key(r.type, r.id);
        if (/^\d{3,12}$/.test(r.nfid || "")) nfids.set(k, r.nfid);
        // מתי עלה לנטפליקס (מהעמוד עצמו): מדויק יותר מתמונת המצב
        if (r.avail && dDays(r.avail, today) <= SEEN_NEW_DAYS && dDays(r.avail, today) >= -1 && !(arr.get(k) && arr.get(k) < r.avail)) arr.set(k, r.avail);
      }
      refs.top10 = all.length >= TOP10_MIN ? all : [];
      console.log(`${svc.id}: טופ 10 – ${etv.length} סדרות, ${emv.length} סרטים, הותאמו ${all.length}${refs.top10.length ? "" : " (מעט מדי, בלי שורה)"}`);
    } catch (e) { console.error("טופ 10: " + e.message); refs.top10 = []; }
  }
  // שורות חדשות: מועמדים לכל שורה, ואז הצבה לפי סדר קבוע עם מגבלת "עד 2 שורות לפריט".
  // 'הכי מדורגים' עוד לא סופי (ממתין לציוני OMDb), לכן אכיפה סופית נעשית בסוף (enforceMax)
  const specsNew = svc.specs();
  const cands = await pool(svc.order.map((name) => () => newRowCands(tmdb, specsNew[name], dd).catch((e) => { console.error("שורה " + name + ": " + e.message); return []; })));
  // "חדש": קודם מה שהופיע בשירות לאחרונה (לפי פופולריות, סרטים וסדרות לסירוגין), ואז השלמה ממה שיצא לאחרונה.
  // התצוגה בסוף: מהחדש לישן (תאריך הגעה, או תאריך יציאה כשלא ידוע)
  const wi = svc.order.indexOf("week");
  if (wi >= 0 && arr.size) {
    const got = [];
    for (const [k] of arr) { const c = catalog.get(k) || refs.top10.find((r) => key(r.type, r.id) === k); if (c) got.push(c); }
    const first = mergeRow(got.filter((r) => r.type === "movie"), got.filter((r) => r.type === "tv"), byPop, NEW_LIMIT * 2);
    const have = new Set(first.map((r) => key(r.type, r.id)));
    cands[wi] = [...first, ...cands[wi].filter((r) => !have.has(key(r.type, r.id)))];
  }
  const counts = new Map();
  for (const r of [...refs.top10, ...refs.popular, ...(refs.recent || [])]) counts.set(key(r.type, r.id), (counts.get(key(r.type, r.id)) || 0) + 1);
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
  // מזהה נטפליקס: מהטופ 10 של היום, או ממה שנשמר בעבר. קישור ישיר לכותר במקום חיפוש
  if (svc.titleBase) {
    const keep = (seen && seen.nf) || {};
    for (const [k, id] of nfids) keep[k] = id;
    for (const k of Object.keys(items)) if (keep[k]) { items[k].nfid = String(keep[k]); items[k].link = svc.titleBase + keep[k]; }
  }
  // שמות בעברית לפריטים שאין להם (ויקינתונים), ואז תיקונים ידניים (nf-he.json) אחרונים
  if (ctx.hebrew !== false) {
    let overrides = {};
    try { const o = JSON.parse(await readFile(dir + "/nf-he.json", "utf8")); if (o && typeof o === "object" && !Array.isArray(o)) overrides = o; } catch (e) {}
    const h = await hebrewTitles(items, { overrides, linkBase: svc.linkBase }).catch(() => null);
    if (h) console.log(`${svc.id}: שמות בעברית – חסרו ${h.need}, מוויקינתונים ${h.wiki}, ידני ${h.overrides}`);
  }

  const byDate = (a, b) => (items[b].date || "").localeCompare(items[a].date || "");
  if (rows.recent) rows.recent.sort(byDate);
  const eff = (k) => arr.get(k) || items[k].date || ""; // תאריך הגעה לשירות, ואם לא ידוע אז תאריך יציאה
  if (rows.week) rows.week.sort((a, b) => eff(b).localeCompare(eff(a)));

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
  if (region) out.region = region; // הקטלוג של אזור אחר (לא ישראל)
  await writeFile(dir + "/" + svc.file, JSON.stringify(out));
  if (seen) {
    for (const k of nfids.keys()) seen.nf[k] = nfids.get(k);
    try { await writeFile(dir + "/" + svc.seenFile, seenText(seen)); } catch (e) { console.error(svc.seenFile + ": " + e.message); }
  }
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
  // הלקוח מציג את מתג דיסני+ רק כש-netflix.json מסמן disney:true (כך אין בקשת 404 ל-disney.json כשאין נתונים)
  if (out.netflix && ctx && ctx.dir) {
    try {
      let has = !!out.disney;
      if (!has) { try { await readFile(ctx.dir + "/disney.json", "utf8"); has = true; } catch (e) {} }
      const p = ctx.dir + "/netflix.json", j = JSON.parse(await readFile(p, "utf8"));
      if (has) j.disney = true; else delete j.disney;
      await writeFile(p, JSON.stringify(j));
    } catch (e) { console.error("סימון דיסני+ ב-netflix.json נכשל: " + e.message); }
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
    if ((svc.optional || []).includes(n) && !rows[n].length) continue;
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
