import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOmdb, shapeItem, fillRatings, isFresh, run, pickHero, fetchRetry, pool } from "../netflix.mjs";

const json = (o, status = 200, headers = {}) => ({
  ok: status < 400, status, json: async () => o,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});
const realFetch = globalThis.fetch;
const realErr = console.error;
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realErr; });

test("parseOmdb: N/A, אחוזים, X/10 והצבעות", () => {
  assert.deepEqual(parseOmdb({ imdbRating: "8.7", imdbVotes: "1,234,567", Ratings: [
    { Source: "Internet Movie Database", Value: "8.7/10" },
    { Source: "Rotten Tomatoes", Value: "87%" },
    { Source: "Metacritic", Value: "72/100" }] }), { imdb: 8.7, votes: 1234567, rt: 87, mc: 72 });
  assert.deepEqual(parseOmdb({ imdbRating: "N/A", imdbVotes: "N/A", Ratings: [{ Source: "Rotten Tomatoes", Value: "N/A" }] }), {});
  assert.deepEqual(parseOmdb({ Response: "False", Error: "x" }), {});
});

test("parseOmdb: פחות מ-50 הצבעות לא מציג ציון imdb", () => {
  assert.deepEqual(parseOmdb({ imdbRating: "9.5", imdbVotes: "12", Ratings: [{ Source: "Metacritic", Value: "60/100" }] }), { mc: 60 });
  assert.deepEqual(parseOmdb({ imdbRating: "9.5", imdbVotes: "50" }), { imdb: 9.5, votes: 50 });
});

test("shapeItem: נפילה לאנגלית, date, וקישור לפי orig", () => {
  const he = { id: 1, title: "Foo", original_title: "Foo", overview: "", release_date: "2024-05-01", genres: [{ name: "דרמה" }],
    poster_path: "/p.jpg", backdrop_path: "/b.jpg", runtime: 100, external_ids: { imdb_id: "tt1" }, vote_count: 7 };
  const it = shapeItem("movie", he, { title: "Foo EN", overview: "English text" });
  assert.equal(it.overview, "English text");
  assert.equal(it.year, 2024);
  assert.equal(it.date, "2024-05-01");
  assert.equal(it.vote_count, 7);
  assert.equal(it.poster, "https://image.tmdb.org/t/p/w342/p.jpg");
  assert.match(it.link, /^https:\/\/www\.netflix\.com\/search\?q=/);
  const heb = shapeItem("tv", { id: 2, name: "סדרה", original_name: "Show", overview: "תקציר", number_of_seasons: 3 }, null);
  assert.equal(heb.title, "סדרה");
  assert.equal(heb.orig, "Show");
  assert.equal(heb.seasons, 3);
  assert.equal(heb.link, "https://www.netflix.com/search?q=Show");
});

test("מטמון: טרי לא נשלף שוב, ישן נשלף, ותקרת בקשות", async () => {
  const now = 1e12, day = 86400000;
  assert.ok(isFresh({ t: now - 6 * day }, now));
  assert.ok(!isFresh({ t: now - 8 * day }, now));
  const calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u)); return json({ imdbRating: "7.0", imdbVotes: "5,000", Ratings: [] }); };
  const cache = { ttFresh: { t: now - day, r: { imdb: 1 } }, ttStale: { t: now - 9 * day, r: {} } };
  const used = await fillRatings(["ttFresh", "ttStale", "ttNew"], cache, "K", { now });
  assert.equal(used, 2);
  assert.ok(!calls.some((c) => c.includes("ttFresh")));
  assert.equal(cache.ttStale.r.imdb, 7);
  calls.length = 0;
  const ids = Array.from({ length: 10 }, (_, i) => "tt" + i);
  assert.equal(await fillRatings(ids, {}, "K", { cap: 4, now }), 4);
  assert.equal(calls.length, 4);
});

test("OMDb: שגיאה זמנית לא נשמרת, Incorrect IMDb ID כן", async () => {
  const answers = { ttA: { Response: "False", Error: "Something went wrong." }, ttB: { Response: "False", Error: "Incorrect IMDb ID." } };
  globalThis.fetch = async (u) => json(answers[new URL(String(u)).searchParams.get("i")]);
  const cache = {};
  await fillRatings(["ttA", "ttB"], cache, "K", { now: 5 });
  assert.equal(cache.ttA, undefined);
  assert.deepEqual(cache.ttB, { t: 5, r: {} });
});

test("OMDb 401: אזהרה בלי המפתח ועצירה", async () => {
  const msgs = [];
  console.error = (m) => msgs.push(String(m));
  let n = 0;
  globalThis.fetch = async () => { n++; return json({}, 401); };
  await fillRatings(["tt1", "tt2", "tt3"], {}, "SECRETKEY", { now: 1 });
  assert.equal(n, 1);
  assert.ok(msgs.some((m) => m.includes("401")));
  assert.ok(!msgs.join("\n").includes("SECRETKEY"));
});

test("fetchRetry: 429 עם Retry-After מנסה פעם אחת נוספת", async () => {
  let n = 0;
  globalThis.fetch = async () => (++n === 1 ? json({}, 429, { "retry-after": "0" }) : json({ ok: 1 }));
  const res = await fetchRetry("http://x/");
  assert.equal(res.status, 200);
  assert.equal(n, 2);
  n = 0;
  globalThis.fetch = async () => { n++; return json({}, 503, { "retry-after": "0" }); };
  assert.equal((await fetchRetry("http://x/")).status, 503);
  assert.equal(n, 2);
});

test("pool: לא יותר מ-N במקביל", async () => {
  let cur = 0, max = 0;
  await pool(Array.from({ length: 20 }, () => async () => { cur++; max = Math.max(max, cur); await new Promise((r) => setTimeout(r, 2)); cur--; }), 8);
  assert.equal(max, 8);
});

test("pickHero: דורש מספיק הצבעות ומעדיף IMDb", () => {
  const items = {
    a: { backdrop: "x", vote: 7, vote_count: 500 },
    b: { backdrop: "x", vote: 9.9, vote_count: 3 },               // מעט הצבעות
    c: { backdrop: "y", vote: 8, vote_count: 500, ratings: { imdb: 8.5, votes: 9000 } },
    d: { backdrop: "", vote: 9, vote_count: 900 },                // בלי backdrop
    e: { backdrop: "z", vote: 5, vote_count: 10, ratings: { imdb: 6, votes: 5000 } },
  };
  assert.equal(pickHero(["a", "b", "c", "d", "e"], items), "c");
  assert.equal(pickHero(["b", "d"], items), "");
});

const N = 12;
function tmdbMock({ fail = false, onlyMovies = false, count = N, omdb } = {}) {
  return async (u) => {
    u = new URL(String(u));
    if (u.hostname === "www.omdbapi.com") return json(omdb || { imdbRating: "8.1", imdbVotes: "10,000", Ratings: [{ Source: "Rotten Tomatoes", Value: "90%" }] });
    if (fail) return json({}, 500);
    const d = u.pathname.match(/^\/3\/discover\/(movie|tv)$/);
    if (d) {
      if (onlyMovies && d[1] === "tv") return json({ results: [] });
      return json({ results: Array.from({ length: count }, (_, i) => ({ id: (d[1] === "movie" ? 100 : 200) + i, popularity: i })) });
    }
    const m = u.pathname.match(/^\/3\/(movie|tv)\/(\d+)$/);
    if (m) {
      const en = u.searchParams.get("language") === "en-US";
      return json({ id: +m[2], title: en ? "English" : "", name: en ? "English" : "", original_title: "Orig", original_name: "Orig",
        overview: en ? "EN overview" : "", release_date: "2026-09-01", first_air_date: "2026-09-01", vote_average: 8, vote_count: 400,
        backdrop_path: "/b.jpg", poster_path: "/p.jpg", genres: [{ name: "דרמה" }],
        external_ids: { imdb_id: "tt" + m[1] + m[2] }, videos: { results: [{ site: "YouTube", type: "Trailer", key: "YT1" }] } });
    }
    return json({}, 404);
  };
}

test("run: בונה netflix.json, ציונים, hero, ושומר מטמון", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  globalThis.fetch = tmdbMock();
  const out = await run({ tmdbKey: " k \n", omdbKey: " o ", dir });
  assert.equal(out.v, 2);
  assert.ok(out.rows.recent.length);
  const it = out.items.m100;
  assert.equal(it.title, "English");
  assert.deepEqual(it.ratings, { imdb: 8.1, votes: 10000, rt: 90 });
  assert.ok(out.hero);
  const cache = JSON.parse(await readFile(join(dir, "ratings-cache.json"), "utf8"));
  assert.ok(Object.keys(cache).length >= 2);
});

test("run: מטמון פגום (null / מערך) לא מונע כתיבה", async () => {
  for (const bad of ["null", "[1,2]", "5", "{not json"]) {
    const dir = await mkdtemp(join(tmpdir(), "nf-"));
    await writeFile(join(dir, "ratings-cache.json"), bad);
    globalThis.fetch = tmdbMock();
    const out = await run({ tmdbKey: "k", omdbKey: "o", dir });
    assert.ok(out, bad);
    JSON.parse(await readFile(join(dir, "netflix.json"), "utf8"));
  }
});

test("run: כשל בלתי צפוי בבלוק OMDb לא מונע כתיבה", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  // ratings-cache.json הוא תיקייה, כך שהכתיבה אליו נכשלת
  await (await import("node:fs/promises")).mkdir(join(dir, "ratings-cache.json"));
  globalThis.fetch = tmdbMock();
  console.error = () => {};
  const out = await run({ tmdbKey: "k", omdbKey: "o", dir });
  assert.ok(out);
  assert.ok(JSON.parse(await readFile(join(dir, "netflix.json"), "utf8")).v === 2);
});

test("run: בלי OMDB_API_KEY עובד בלי ציונים", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  globalThis.fetch = tmdbMock();
  const out = await run({ tmdbKey: "k", omdbKey: "", dir });
  assert.equal(out.items.m100.ratings, undefined);
});

test("run: כשל API משאיר את הקובץ הקודם", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  await writeFile(join(dir, "netflix.json"), '{"old":true}');
  globalThis.fetch = tmdbMock({ fail: true });
  console.error = () => {};
  assert.equal(await run({ tmdbKey: "k", omdbKey: "o", dir }), null);
  assert.equal(await readFile(join(dir, "netflix.json"), "utf8"), '{"old":true}');
});

test("run: סף מינימום (popular < 10, או חסר סוג) משאיר את הקובץ הקודם", async () => {
  for (const mock of [tmdbMock({ count: 3 }), tmdbMock({ onlyMovies: true, count: 15 })]) {
    const dir = await mkdtemp(join(tmpdir(), "nf-"));
    await writeFile(join(dir, "netflix.json"), '{"old":true}');
    globalThis.fetch = mock;
    console.error = () => {};
    assert.equal(await run({ tmdbKey: "k", dir }), null);
    assert.equal(await readFile(join(dir, "netflix.json"), "utf8"), '{"old":true}');
  }
});

test("run: 429 מ-TMDB עם retry עדיין מצליח", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  const inner = tmdbMock();
  let first = true;
  globalThis.fetch = async (u, i) => {
    if (first && String(u).includes("/discover/movie")) { first = false; return json({}, 429, { "retry-after": "0" }); }
    return inner(u, i);
  };
  const out = await run({ tmdbKey: "k", dir });
  assert.ok(out);
  assert.ok(Object.values(out.items).some((x) => x.type === "movie"));
});

test("run: 401 מדפיס אזהרה בלי המפתח", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  const msgs = [];
  console.error = (m) => msgs.push(String(m));
  globalThis.fetch = async () => json({}, 401);
  assert.equal(await run({ tmdbKey: "TOPSECRET", dir }), null);
  assert.ok(msgs.some((m) => m.includes("401")));
  assert.ok(!msgs.join("\n").includes("TOPSECRET"));
});

test("run: חריגת רשת לא זורקת", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  globalThis.fetch = async () => { throw new Error("net down"); };
  console.error = () => {};
  assert.equal(await run({ tmdbKey: "k", dir }), null);
});
