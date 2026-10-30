// שולף מ-TMDB (+ ציונים מ-OMDb) מה פופולרי, יצא לאחרונה ומדורג בנטפליקס ישראל, לקובץ netflix.json.
//
// הרצה (PowerShell):
//   $env:TMDB_API_KEY = "..."      # חובה. v3 (קצר) או Read Access Token (מתחיל ב-eyJ)
//   $env:OMDB_API_KEY = "..."      # אופציונלי. בלעדיו אין ציוני IMDb/RT/Metacritic
//   node netflix.mjs
//
// הסקריפט אף פעם לא מפיל את הצנרת: בכל כשל (רשת, מפתח, תשובה ריקה או דלילה) הוא משאיר
// את netflix.json הקודם ויוצא עם קוד 0. לא כותבים אם popular < 10 או שחסר סוג שלם (סרטים/סדרות).
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
//     "top":     [...]                    // הכי מדורגים (עם מינימום הצבעות)
//   },
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
//       "link": "https://www.netflix.com/search?q=..",  // חיפוש בנטפליקס לפי orig (אם שונה מהעברית) אחרת title
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
export const ROW_LIMIT = 20;
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

const disc = {
  language: "he-IL",
  include_adult: "false",
  watch_region: "IL",
  with_watch_providers: NETFLIX,
  with_watch_monetization_types: "flatrate",
};

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const key = (type, id) => (type === "movie" ? "m" : "t") + id;

async function list(tmdb, type, extra) {
  try {
    const j = await tmdb("/discover/" + type, { ...disc, ...extra });
    return (j.results || []).slice(0, ROW_LIMIT).map((r) => ({ type, id: r.id, pop: r.popularity || 0 }));
  } catch (e) {
    console.error("discover " + type + ": " + e.message);
    return [];
  }
}

// ---------- מיזוג ושליפת פרטים ----------
// סרטים וסדרות לסירוגין, כל אחד לפי הסדר שלו. ציוני הפופולריות של TMDB לא בני השוואה בין הסוגים
// (סדרות תמיד גבוהות יותר), ומיון משותף השאיר שורה של סדרות בלבד.
export function mergeRow(a, b, sorter) {
  const x = [...a].sort(sorter), y = [...b].sort(sorter), out = [];
  for (let i = 0; out.length < ROW_LIMIT && (i < x.length || i < y.length); i++) {
    if (i < x.length) out.push(x[i]);
    if (i < y.length && out.length < ROW_LIMIT) out.push(y[i]);
  }
  return out;
}

const hasHeb = (s) => /[֐-׿]/.test(s || "");

// he = תשובת he-IL (עם append_to_response), en = תשובת en-US (או null)
export function shapeItem(type, he, en) {
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
    link: "https://www.netflix.com/search?q=" + encodeURIComponent(origOut || title),
    trailer: tr ? tr.key : "",
    vote: he.vote_average ? Math.round(he.vote_average * 10) / 10 : 0,
    vote_count: he.vote_count || 0,
  };
  if (type === "movie") it.runtime = he.runtime || 0;
  else it.seasons = he.number_of_seasons || 0;
  return it;
}

async function details(tmdb, type, id) {
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
  return shapeItem(type, he, en);
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
  const todo = [...new Set(ids)].filter((id) => id && !isFresh(cache[id], now));
  for (const id of todo) {
    if (used >= cap) break;
    used++;
    try {
      const res = await fetchRetry(`https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&i=${encodeURIComponent(id)}`, {}, { retry: false });
      if (res.status === 401 || res.status === 429) {
        console.error(`אזהרה: OMDb החזיר ${res.status} (מפתח לא תקין או חריגה ממכסה). מפסיק לשלוף ציונים.`);
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

// opts: { tmdbKey, omdbKey, dir, now }
export async function run(opts = {}) {
  const tmdbKey = String(opts.tmdbKey ?? process.env.TMDB_API_KEY ?? "").trim();
  const omdbKey = String(opts.omdbKey ?? process.env.OMDB_API_KEY ?? "").trim();
  const dir = opts.dir ?? ".";
  if (!tmdbKey) {
    console.error("חסר TMDB_API_KEY, מדלג");
    return null;
  }
  const tmdb = makeTmdb(tmdbKey);
  const from = day(-60), to = day(0);
  const byPop = (a, b) => b.pop - a.pop;
  const specs = [
    ["movie", { sort_by: "popularity.desc" }],
    ["tv", { sort_by: "popularity.desc" }],
    ["movie", { sort_by: "popularity.desc", "primary_release_date.gte": from, "primary_release_date.lte": to }],
    ["tv", { sort_by: "popularity.desc", "first_air_date.gte": from, "first_air_date.lte": to }],
    ["movie", { sort_by: "vote_average.desc", "vote_count.gte": 500 }],
    ["tv", { sort_by: "vote_average.desc", "vote_count.gte": 200 }],
  ];
  const [pm, pt, nm, nt, tm, tt] = await pool(specs.map(([t, e]) => () => list(tmdb, t, e)));
  const refs = {
    popular: mergeRow(pm, pt, byPop),
    recent: mergeRow(nm, nt, byPop),
    top: [...tm, ...tt],
  };
  const uniq = new Map();
  for (const r of Object.values(refs).flat()) uniq.set(key(r.type, r.id), r);

  const items = {};
  await pool(
    [...uniq.entries()].map(([k, r]) => async () => {
      try {
        const it = await details(tmdb, r.type, r.id);
        if (it.title && it.poster) items[k] = it;
      } catch (e) {
        console.error("details " + k + ": " + e.message);
      }
    })
  );

  const rows = {};
  for (const [name, arr] of Object.entries(refs)) rows[name] = arr.map((r) => key(r.type, r.id)).filter((k) => items[k]);
  rows.recent.sort((a, b) => (items[b].date || "").localeCompare(items[a].date || ""));
  rows.top.sort((a, b) => items[b].vote - items[a].vote);
  rows.top = rows.top.slice(0, ROW_LIMIT);

  const types = new Set(rows.popular.map((k) => items[k].type));
  if (rows.popular.length < MIN_POPULAR || !types.has("movie") || !types.has("tv")) {
    console.error(`TMDB החזיר תוצאות דלילות (popular=${rows.popular.length}, סוגים=${[...types].join("/") || "אין"}). netflix.json לא עודכן.`);
    return null;
  }

  if (omdbKey) {
    try {
      const cachePath = dir + "/ratings-cache.json";
      const cache = await readCache(cachePath);
      const now = opts.now ?? Date.now();
      const used = await fillRatings(Object.values(items).map((i) => i.imdb_id), cache, omdbKey, { now });
      for (const id of Object.keys(cache)) if (!cache[id] || now - (cache[id].t || 0) > CACHE_DAYS * 2 * 86400000) delete cache[id];
      await writeFile(cachePath, JSON.stringify(cache));
      console.log(`OMDb: ${used} בקשות`);
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

  const out = { v: SCHEMA, updated: new Date().toISOString(), hero: pickHero(rows.popular, items), rows, items };
  await writeFile(dir + "/netflix.json", JSON.stringify(out));
  console.log(`netflix.json: ${rows.popular.length} popular, ${rows.recent.length} recent, ${rows.top.length} top`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => console.error("netflix.mjs נכשל: " + e.message));
}
