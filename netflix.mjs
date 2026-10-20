// שולף מ-TMDB מה פופולרי וחדש בנטפליקס ישראל לקובץ netflix.json.
//
// הרצה (PowerShell):
//   $env:TMDB_API_KEY = "המפתח שלך"
//   node netflix.mjs
//
// המפתח נלקח מ-themoviedb.org (Settings, API). אפשר להשתמש גם במפתח v3 (קצר)
// וגם ב-"API Read Access Token" (ארוך, מתחיל ב-eyJ).
// הסקריפט לא נבדק מול ה-API האמיתי של TMDB (אין לו מפתח), רק מול תשובה מדומה.

import { writeFile } from "node:fs/promises";

const KEY = process.env.TMDB_API_KEY;
if (!KEY) {
  console.error("חסר TMDB_API_KEY");
  process.exit(1);
}
const BEARER = KEY.length > 60;
const NETFLIX = "8"; // מזהה נטפליקס ב-TMDB
const LIMIT = 30;

async function tmdb(path, params) {
  const u = new URL("https://api.themoviedb.org/3" + path);
  const all = {
    language: "he-IL",
    watch_region: "IL",
    with_watch_providers: NETFLIX,
    with_watch_monetization_types: "flatrate",
    ...params,
  };
  for (const [k, v] of Object.entries(all)) u.searchParams.set(k, v);
  if (!BEARER) u.searchParams.set("api_key", KEY);
  const res = await fetch(u, { headers: BEARER ? { Authorization: "Bearer " + KEY } : {} });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()).results || [];
}

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};

function shape(r, type) {
  return {
    id: r.id,
    type,
    title: r.title || r.name || "",
    orig: r.original_title || r.original_name || "",
    overview: (r.overview || "").trim(),
    poster: r.poster_path || "",
    date: r.release_date || r.first_air_date || "",
    rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : 0,
    pop: r.popularity || 0,
  };
}

export function build(popMovies, popTv, newMovies, newTv) {
  const clean = (a) => a.filter((x) => x.title).map(({ pop, ...x }) => x);
  const byPop = (a, b) => b.pop - a.pop;
  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "");
  const popular = [...popMovies, ...popTv].sort(byPop).slice(0, LIMIT);
  const fresh = [...newMovies, ...newTv].sort(byPop).slice(0, LIMIT).sort(byDate);
  return { popular: clean(popular), new: clean(fresh) };
}

async function main() {
  const from = day(-60), to = day(0);
  const [pm, pt, nm, nt] = await Promise.all([
    tmdb("/discover/movie", { sort_by: "popularity.desc" }),
    tmdb("/discover/tv", { sort_by: "popularity.desc" }),
    tmdb("/discover/movie", { sort_by: "popularity.desc", "primary_release_date.gte": from, "primary_release_date.lte": to }),
    tmdb("/discover/tv", { sort_by: "popularity.desc", "first_air_date.gte": from, "first_air_date.lte": to }),
  ]);
  const out = build(
    pm.map((r) => shape(r, "movie")),
    pt.map((r) => shape(r, "tv")),
    nm.map((r) => shape(r, "movie")),
    nt.map((r) => shape(r, "tv"))
  );
  if (!out.popular.length && !out.new.length) {
    console.error("TMDB לא החזיר תוצאות. netflix.json לא עודכן.");
    process.exit(1);
  }
  await writeFile("netflix.json", JSON.stringify({ updated: new Date().toISOString(), ...out }));
  console.log(`netflix.json: ${out.popular.length} popular, ${out.new.length} new`);
}

main();
