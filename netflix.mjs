// שולף מ-TMDB (+ ציונים מ-OMDb) מה פופולרי, חדש ומדורג בנטפליקס ישראל, לקובץ netflix.json.
//
// הרצה (PowerShell):
//   $env:TMDB_API_KEY = "..."      # חובה. v3 (קצר) או Read Access Token (מתחיל ב-eyJ)
//   $env:OMDB_API_KEY = "..."      # אופציונלי. בלעדיו אין ציוני IMDb/RT/Metacritic
//   node netflix.mjs
//
// הסקריפט אף פעם לא מפיל את הצנרת: בכל כשל (רשת, מפתח, תשובה ריקה) הוא משאיר
// את netflix.json הקודם ויוצא עם קוד 0.
//
// מבנה netflix.json (v = גרסת סכמה):
// {
//   "v": 2,
//   "updated": "ISO date",
//   "hero": "m603",                       // מפתח פריט לכרטיס העליון (הכי מדורג מבין הפופולריים, עם backdrop)
//   "rows": {                             // שורות, כל אחת רשימת מפתחות לפי הסדר
//     "popular": ["m603", "t1396"],       // הכי נצפים
//     "new":     [...],                   // חדש (60 הימים האחרונים)
//     "top":     [...]                    // הכי מדורגים (עם מינימום הצבעות)
//   },
//   "items": {                            // מפתח = "m"|"t" + מזהה TMDB; כל פריט פעם אחת
//     "m603": {
//       "id": 603, "type": "movie",       // movie | tv
//       "title": "מטריקס", "orig": "The Matrix", "year": 1999,
//       "overview": "...",                // עברית, ואם חסר אז אנגלית
//       "poster": "https://image.tmdb.org/t/p/w342/..",
//       "backdrop": "https://image.tmdb.org/t/p/w780/..",
//       "genres": ["פעולה", "מדע בדיוני"],
//       "runtime": 136,                   // דקות (סרט)  |  "seasons": 5 (סדרה)
//       "imdb_id": "tt0133093",
//       "link": "https://www.netflix.com/search?q=..",  // תמיד חיפוש בנטפליקס: קישור TMDB מוביל לדף של TMDB ולא לנטפליקס
//       "trailer": "vKQi3bBA1y8",         // מפתח YouTube, אם יש
//       "vote": 8.2,                      // ציון TMDB (גיבוי כשאין IMDb)
//       "ratings": { "imdb": 8.7, "rt": 83, "mc": 73 }  // רק שדות שקיימים; ללא OMDb חסר
//     }
//   }
// }
//
// ratings-cache.json: { "tt0133093": { "t": <ms>, "r": {imdb, rt, mc} } }. תקף 7 ימים,
// נשלפים רק חסרים/ישנים, עד 300 בקשות OMDb בהרצה (מכסה חינמית: 1000 ליום).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const SCHEMA = 2;
export const NETFLIX = "8"; // מזהה נטפליקס ב-TMDB
export const ROW_LIMIT = 20;
export const OMDB_CAP = 300;
export const CACHE_DAYS = 7;
const IMG = "https://image.tmdb.org/t/p/";

// ---------- TMDB ----------
function makeTmdb(key) {
  const bearer = key.length > 60;
  return async function tmdb(path, params = {}) {
    const u = new URL("https://api.themoviedb.org/3" + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (!bearer) u.searchParams.set("api_key", key);
    const res = await fetch(u, { headers: bearer ? { Authorization: "Bearer " + key } : {} });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  };
}

const disc = {
  language: "he-IL",
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
export function mergeRow(a, b, sorter) {
  return [...a, ...b].sort(sorter).slice(0, ROW_LIMIT);
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
  const it = {
    id: he.id,
    type,
    title,
    orig: orig && orig !== title ? orig : "",
    year: date ? Number(date.slice(0, 4)) : 0,
    overview,
    poster: he.poster_path ? IMG + "w342" + he.poster_path : "",
    backdrop: he.backdrop_path ? IMG + "w780" + he.backdrop_path : "",
    genres: (he.genres || []).map((g) => g.name).filter(Boolean),
    imdb_id: he.imdb_id || ext.imdb_id || "",
    link: "https://www.netflix.com/search?q=" + encodeURIComponent(title),
    trailer: tr ? tr.key : "",
    vote: he.vote_average ? Math.round(he.vote_average * 10) / 10 : 0,
  };
  if (type === "movie") it.runtime = he.runtime || 0;
  else it.seasons = he.number_of_seasons || 0;
  return it;
}

async function details(tmdb, type, id) {
  const he = await tmdb(`/${type}/${id}`, {
    language: "he-IL",
    append_to_response: "external_ids,videos,watch/providers",
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
  const n = parseFloat(String(s).replace("%", "").split("/")[0]);
  return Number.isFinite(n) ? n : null;
};

// מקבל תשובת OMDb, מחזיר {imdb, rt, mc} רק עם שדות תקפים ("N/A" נזרק)
export function parseOmdb(j) {
  const r = {};
  if (!j || j.Response === "False") return r;
  if (j.imdbRating && j.imdbRating !== "N/A") {
    const n = num(j.imdbRating);
    if (n != null) r.imdb = n;
  }
  for (const s of j.Ratings || []) {
    if (!s || !s.Value || s.Value === "N/A") continue;
    const n = num(s.Value);
    if (n == null) continue;
    if (s.Source === "Rotten Tomatoes") r.rt = n;
    else if (s.Source === "Metacritic") r.mc = n;
    else if (s.Source === "Internet Movie Database" && r.imdb == null) r.imdb = n;
  }
  return r;
}

export const isFresh = (e, now = Date.now()) => !!e && typeof e.t === "number" && now - e.t < CACHE_DAYS * 86400000;

// cache: אובייקט שמשתנה במקום. מחזיר מספר בקשות שנעשו.
export async function fillRatings(ids, cache, omdbKey, { cap = OMDB_CAP, now = Date.now() } = {}) {
  let used = 0;
  const todo = [...new Set(ids)].filter((id) => id && !isFresh(cache[id], now));
  for (const id of todo) {
    if (used >= cap) break;
    used++;
    try {
      const res = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&i=${encodeURIComponent(id)}`);
      if (!res.ok) {
        if (res.status === 401 || res.status === 429) break;
        continue;
      }
      const j = await res.json();
      if (j.Response === "False" && /limit|invalid api/i.test(j.Error || "")) break;
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
  let best = null;
  for (const k of rowIds) {
    const it = items[k];
    if (!it || !it.backdrop) continue;
    if (!best || score(it) > score(items[best])) best = k;
  }
  return best || "";
}

async function readJson(path, dflt) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return dflt;
  }
}

// opts: { tmdbKey, omdbKey, dir, now }
export async function run(opts = {}) {
  const tmdbKey = opts.tmdbKey ?? process.env.TMDB_API_KEY;
  const omdbKey = opts.omdbKey ?? process.env.OMDB_API_KEY;
  const dir = opts.dir ?? ".";
  if (!tmdbKey) {
    console.error("חסר TMDB_API_KEY, מדלג");
    return null;
  }
  const tmdb = makeTmdb(tmdbKey);
  const from = day(-60), to = day(0);
  const byPop = (a, b) => b.pop - a.pop;
  const [pm, pt, nm, nt, tm, tt] = await Promise.all([
    list(tmdb, "movie", { sort_by: "popularity.desc" }),
    list(tmdb, "tv", { sort_by: "popularity.desc" }),
    list(tmdb, "movie", { sort_by: "popularity.desc", "primary_release_date.gte": from, "primary_release_date.lte": to }),
    list(tmdb, "tv", { sort_by: "popularity.desc", "first_air_date.gte": from, "first_air_date.lte": to }),
    list(tmdb, "movie", { sort_by: "vote_average.desc", "vote_count.gte": 500 }),
    list(tmdb, "tv", { sort_by: "vote_average.desc", "vote_count.gte": 200 }),
  ]);
  const refs = {
    popular: mergeRow(pm, pt, byPop),
    new: mergeRow(nm, nt, byPop),
    top: [...tm, ...tt],
  };
  const uniq = new Map();
  for (const r of Object.values(refs).flat()) uniq.set(key(r.type, r.id), r);

  const items = {};
  await Promise.all(
    [...uniq.entries()].map(async ([k, r]) => {
      try {
        const it = await details(tmdb, r.type, r.id);
        if (it.title) items[k] = it;
      } catch (e) {
        console.error("details " + k + ": " + e.message);
      }
    })
  );

  const rows = {};
  for (const [name, arr] of Object.entries(refs)) rows[name] = arr.map((r) => key(r.type, r.id)).filter((k) => items[k]);
  rows.new.sort((a, b) => items[b].year - items[a].year);
  rows.top.sort((a, b) => items[b].vote - items[a].vote);
  rows.top = rows.top.slice(0, ROW_LIMIT);

  if (!rows.popular.length) {
    console.error("TMDB לא החזיר תוצאות. netflix.json לא עודכן.");
    return null;
  }

  if (omdbKey) {
    const cachePath = dir + "/ratings-cache.json";
    const cache = await readJson(cachePath, {});
    const now = opts.now ?? Date.now();
    const used = await fillRatings(Object.values(items).map((i) => i.imdb_id), cache, omdbKey, { now });
    for (const id of Object.keys(cache)) if (now - (cache[id].t || 0) > CACHE_DAYS * 2 * 86400000) delete cache[id];
    await writeFile(cachePath, JSON.stringify(cache));
    console.log(`OMDb: ${used} בקשות`);
    for (const it of Object.values(items)) {
      const e = cache[it.imdb_id];
      if (e && e.r && Object.keys(e.r).length) it.ratings = e.r;
    }
  } else {
    console.log("OMDB_API_KEY לא הוגדר, ללא ציונים");
  }

  const out = { v: SCHEMA, updated: new Date().toISOString(), hero: pickHero(rows.popular, items), rows, items };
  await writeFile(dir + "/netflix.json", JSON.stringify(out));
  console.log(`netflix.json: ${rows.popular.length} popular, ${rows.new.length} new, ${rows.top.length} top`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => console.error("netflix.mjs נכשל: " + e.message));
}
