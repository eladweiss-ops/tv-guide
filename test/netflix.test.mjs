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

test("mergeRow: סרטים וסדרות לסירוגין גם כשלסדרות פופולריות גבוהה בהרבה", async () => {
  const { mergeRow } = await import("../netflix.mjs");
  const m = Array.from({ length: 20 }, (_, i) => ({ type: "movie", id: i, pop: 10 - i * 0.1 }));
  const t = Array.from({ length: 20 }, (_, i) => ({ type: "tv", id: 100 + i, pop: 900 - i }));
  const r = mergeRow(m, t, (a, b) => b.pop - a.pop);
  assert.equal(r.length, 20);
  assert.equal(r.filter((x) => x.type === "movie").length, 10);
  assert.equal(r[0].type, "movie"); assert.equal(r[1].type, "tv");
});

// ---------- שורות חדשות ----------
import { newRowSpecs, place, finalize, ROW_META, NEW_ORDER } from "../netflix.mjs";

// mock עשיר: מזהים שונים לפי שאילתה (כך שורות לא חופפות), ורושם כל קריאת discover
function richMock(log) {
  const base = tmdbMock();
  return async (u, i) => {
    const url = new URL(String(u));
    const d = url.pathname.match(/^\/3\/discover\/(movie|tv)$/);
    if (!d) return base(u, i);
    const q = Object.fromEntries(url.searchParams);
    log.push({ type: d[1], q });
    const { page, ...rest } = q;
    const seed = [...JSON.stringify(rest)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 50000, 7);
    const pg = Number(page || 1);
    return json({ results: Array.from({ length: 20 }, (_, n) => ({ id: seed * 100 + (pg - 1) * 20 + n + (d[1] === "tv" ? 50000000 : 0), popularity: 100 - n, release_date: "2026-10-0" + (1 + (n % 9)) })) });
  };
}

test("שאילתות discover של השורות החדשות: שפה/מדינה/ז'אנרים/תאריכים", () => {
  const s = newRowSpecs(Date.UTC(2026, 9, 31));
  assert.deepEqual(Object.keys(s), NEW_ORDER);
  const has = (row, type, k, v) => s[row].some(([t, e]) => t === type && e[k] === v);
  for (const t of ["movie", "tv"]) assert.ok(has("israeli", t, "with_original_language", "he") && has("israeli", t, "with_origin_country", "IL"));
  assert.equal(s.series.length, 1); assert.equal(s.series[0][0], "tv");
  assert.equal(s.movies[0][0], "movie");
  assert.ok(has("comedy", "movie", "with_genres", "35") && has("comedy", "tv", "with_genres", "35"));
  assert.ok(has("crime", "movie", "with_genres", "80|53") && has("crime", "tv", "with_genres", "80|9648"));
  assert.ok(has("docu", "movie", "with_genres", "99") && has("docu", "tv", "with_genres", "99"));
  assert.ok(has("family", "movie", "with_genres", "10751|16") && has("family", "tv", "with_genres", "10751|10762"));
  assert.ok(has("week", "movie", "primary_release_date.gte", "2026-10-01") && has("week", "tv", "first_air_date.lte", "2026-10-31"));
});

test("run: שורות חדשות נשלפות עם פרמטרי נטפליקס ישראל, rowMeta, ובלי שדות מיותרים", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  const log = [];
  globalThis.fetch = richMock(log);
  const out = await run({ tmdbKey: "k", omdbKey: "", dir });
  assert.equal(log.length, 6 + 2 * (4 + 2 + 1 + 1 + 8));
  for (const c of log) {
    assert.equal(c.q.watch_region, "IL"); assert.equal(c.q.with_watch_providers, "8");
    assert.equal(c.q.language, "he-IL"); assert.equal(c.q.include_adult, "false");
  }
  assert.ok(log.some((c) => c.q.page === "2"), "עמוד שני");
  for (const n of NEW_ORDER) {
    assert.ok(out.rows[n] && out.rows[n].length >= 4 && out.rows[n].length <= 24, n + ": " + (out.rows[n] || []).length);
    assert.ok(out.rowMeta[n].title);
  }
  assert.ok(out.rows.series.every((k) => k[0] === "t") && out.rows.movies.every((k) => k[0] === "m"));
  const wk = out.rows.week.map((k) => out.items[k].date);
  assert.deepEqual(wk, [...wk].sort().reverse());
  const cnt = {}; for (const r of Object.values(out.rows)) for (const k of r) cnt[k] = (cnt[k] || 0) + 1;
  assert.ok(Math.max(...Object.values(cnt)) <= 2, "כל פריט בעד 2 שורות");
  assert.deepEqual(new Set(Object.keys(out.items)), new Set(Object.keys(cnt)), "אין פריטים יתומים");
  const it = Object.values(out.items)[0];
  assert.ok(!("vote" in it) && !("imdb_id" in it) && !("vote_count" in it));
  assert.ok(!Object.values(it).some((v) => v === ""));
  assert.ok(JSON.stringify(out).length < 1.5e6);
  JSON.parse(await readFile(join(dir, "netflix.json"), "utf8"));
});

test("place ו-finalize: עד 2 שורות לפריט, שורה קטנה מדי נושרת, שדות ריקים נגרעים", () => {
  const c = Array.from({ length: 6 }, (_, i) => ({ type: "movie", id: i }));
  const counts = new Map([["m0", 2], ["m1", 1]]);
  assert.deepEqual(place(c, 3, counts).map((r) => r.id), [1, 2, 3]);
  assert.equal(counts.get("m1"), 2);
  const items = Object.fromEntries(["m1", "m2", "m3", "m4", "m5", "m6"].map((k) => [k, { id: 1, title: "x", poster: "p", vote: 5, imdb_id: "tt", orig: "", genres: [] }]));
  const f = finalize({ popular: ["m1", "m2"], recent: ["m1", "m2"], top: ["m1"], israeli: ["m1", "m3", "m4", "m5", "m6"], week: ["m3", "m4"], series: ["m3"] }, items);
  assert.ok(!f.rows.israeli.includes("m1"), "m1 כבר בשלוש שורות קיימות: נשאר שם (שורות קיימות לא משתנות) ויורד מהחדשה");
  assert.ok(!f.rows.week && !f.rowMeta.week, "שורה עם פחות מ-4 לא נכתבת");
  assert.deepEqual(Object.keys(f.rowMeta).sort(), Object.keys(f.rows).sort());
  assert.ok(f.items.m3 && !("vote" in f.items.m3) && !("orig" in f.items.m3) && !("genres" in f.items.m3));
  assert.ok(ROW_META.israeli.title.includes("ישראלי"));
});

test("OMDb: חסרים לגמרי קודם לפג-תוקף, גם בתקרה", async () => {
  const now = 1e12, day = 86400000, calls = [];
  globalThis.fetch = async (u) => { calls.push(new URL(String(u)).searchParams.get("i")); return json({ imdbRating: "7.0", imdbVotes: "5,000", Ratings: [] }); };
  await fillRatings(["ttOld", "ttNew1", "ttNew2"], { ttOld: { t: now - 20 * day, r: {} } }, "K", { cap: 2, now });
  assert.deepEqual(calls, ["ttNew1", "ttNew2"]);
});

test("run: תקרת OMDb ברמת הריצה (omdbCap), ובלי מפתחות לא נכשל", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  const log = [], inner = richMock([]);
  globalThis.fetch = async (u, i) => { if (new URL(String(u)).hostname === "www.omdbapi.com") log.push(String(u)); return inner(u, i); };
  await run({ tmdbKey: "k", omdbKey: "o", dir, omdbCap: 5 });
  assert.equal(log.length, 5);
  const out = await run({ tmdbKey: "k", omdbKey: "", dir: await mkdtemp(join(tmpdir(), "nf-")) });
  assert.ok(out && out.rows.israeli);
});

test("run: שאילתת שורה חדשה שנכשלת לא מפילה את השאר", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  const inner = richMock([]);
  globalThis.fetch = async (u, i) => (decodeURIComponent(String(u)).includes("with_genres=99") ? json({}, 500, { "retry-after": "0" }) : inner(u, i));
  console.error = () => {};
  const out = await run({ tmdbKey: "k", dir });
  assert.ok(out && !out.rows.docu && out.rows.comedy);
});

// ---------- דיסני+: אותו בונה, הגדרת שירות אחרת ----------
import { runAll, SERVICES, disneyRowSpecs, DISNEY_ORDER, DISNEY_META, resolveProvider } from "../netflix.mjs";

// richMock + רשימת ספקים לישראל (לחיפוש "Disney Plus" לפי שם)
function disneyMock(log, { providers } = {}) {
  const inner = richMock(log);
  return async (u, i) => {
    const url = new URL(String(u));
    if (url.pathname === "/3/watch/providers/movie") {
      if (providers === "fail") return json({}, 500, { "retry-after": "0" });
      return json({ results: providers || [{ provider_id: 8, provider_name: "Netflix" }, { provider_id: 2337, provider_name: "Disney Plus" }] });
    }
    return inner(u, i);
  };
}

test("דיסני+: הגדרת שירות, שורות ושאילתות (מארוול/לוקאספילם/פיקסאר, ילדים)", () => {
  assert.equal(SERVICES.disney.file, "disney.json"); assert.equal(SERVICES.netflix.file, "netflix.json");
  const s = disneyRowSpecs(Date.UTC(2026, 9, 31));
  assert.deepEqual(Object.keys(s), DISNEY_ORDER);
  const has = (row, type, k, v) => s[row].some(([t, e]) => t === type && e[k] === v);
  for (const [row, id] of [["marvel", "420"], ["starwars", "1"], ["pixar", "3"]]) for (const t of ["movie", "tv"]) assert.ok(has(row, t, "with_companies", id), row + " " + t);
  assert.ok(has("kids", "movie", "with_genres", "10751|16") && has("kids", "tv", "with_genres", "10762|10751|16"));
  assert.ok(has("week", "movie", "primary_release_date.gte", "2026-10-01"));
  for (const n of [...SERVICES.disney.base, ...DISNEY_ORDER]) assert.ok(DISNEY_META[n].title, n);
  assert.equal(DISNEY_META.popular.title, "🔥 הכי נצפים"); assert.equal(DISNEY_META.top.title, "🏆 הכי מדורגים");
});

test("resolveProvider: לפי שם בזמן ריצה, ונפילה ל-337", async () => {
  const mk = (r) => async () => { if (r === "fail") throw new Error("down"); return { results: r }; };
  assert.equal(await resolveProvider(mk([{ provider_id: 2337, provider_name: "Disney Plus" }]), SERVICES.disney), "2337");
  assert.equal(await resolveProvider(mk([{ provider_id: 9, provider_name: "Hulu" }]), SERVICES.disney), "337");
  console.error = () => {};
  assert.equal(await resolveProvider(mk("fail"), SERVICES.disney), "337");
  assert.equal(await resolveProvider(mk([]), SERVICES.netflix), "8"); // נטפליקס: בלי חיפוש
});

test("run disney: ספק מזוהה לפי שם, קישור דיסני+, שורות, כתיבה ל-disney.json בלבד", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ds-"));
  const log = [];
  globalThis.fetch = disneyMock(log);
  const out = await run({ tmdbKey: "k", omdbKey: "", dir, service: "disney" });
  assert.ok(out && out.v === 2 && out.hero);
  assert.ok(log.length > 10);
  for (const c of log) assert.equal(c.q.with_watch_providers, "2337");
  for (const n of ["popular", "top", ...DISNEY_ORDER]) { assert.ok(out.rows[n] && out.rows[n].length >= 4, n); assert.equal(out.rowMeta[n].title, DISNEY_META[n].title); }
  assert.ok(!out.rows.recent && !out.rows.israeli, "אין שורות נטפליקס");
  assert.ok(Object.values(out.items).every((it) => it.link.startsWith("https://www.disneyplus.com/he-il/search?q=")));
  const cnt = {}; for (const r of Object.values(out.rows)) for (const k of r) cnt[k] = (cnt[k] || 0) + 1;
  assert.ok(Math.max(...Object.values(cnt)) <= 2); assert.deepEqual(new Set(Object.keys(out.items)), new Set(Object.keys(cnt)));
  JSON.parse(await readFile(join(dir, "disney.json"), "utf8"));
  await assert.rejects(readFile(join(dir, "netflix.json"), "utf8"));
});

test("run disney: אין נתונים לישראל, הקטלוג של בריטניה מסומן region:GB", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ds-"));
  const log = [], inner = disneyMock(log);
  globalThis.fetch = async (u, i) => {
    const url = new URL(String(u));
    if (url.pathname.startsWith("/3/discover/") && url.searchParams.get("watch_region") === "IL") return json({ page: 1, total_results: 0, total_pages: 0, results: [] });
    return inner(u, i);
  };
  const out = await run({ tmdbKey: "k", omdbKey: "", dir, service: "disney" });
  assert.ok(out && out.region === "GB" && out.rows.popular.length >= 4);
  assert.ok(log.filter((c) => c.q.watch_region).every((c) => c.q.watch_region === "GB"));
  assert.equal(JSON.parse(await readFile(join(dir, "disney.json"), "utf8")).region, "GB");
  // עם נתונים לישראל: בלי region
  globalThis.fetch = disneyMock([]);
  const o2 = await run({ tmdbKey: "k", omdbKey: "", dir, service: "disney" });
  assert.ok(o2 && !("region" in o2));
});

test("run disney: זיהוי ספק נכשל משתמש ב-337", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ds-"));
  const log = [];
  globalThis.fetch = disneyMock(log, { providers: "fail" });
  console.error = () => {};
  const out = await run({ tmdbKey: "k", dir, service: "disney" });
  assert.ok(out);
  for (const c of log) assert.equal(c.q.with_watch_providers, "337");
});

test("runAll: שני הקבצים, מכסת OMDb אחת משותפת (לא יותר מ-300), וכשל בדיסני+ לא פוגע בנטפליקס", async () => {
  const dir = await mkdtemp(join(tmpdir(), "both-"));
  const calls = [], inner = disneyMock([]);
  globalThis.fetch = async (u, i) => { if (new URL(String(u)).hostname === "www.omdbapi.com") calls.push(String(u)); return inner(u, i); };
  const out = await runAll({ tmdbKey: "k", omdbKey: "o", dir, omdbCap: 40 });
  assert.ok(out.netflix && out.disney);
  assert.equal(calls.length, 40, "התקרה משותפת: " + calls.length);
  assert.equal(new Set(calls).size, calls.length, "אין בקשה כפולה לאותו imdb_id בין השירותים");
  JSON.parse(await readFile(join(dir, "netflix.json"), "utf8")); JSON.parse(await readFile(join(dir, "disney.json"), "utf8"));
  const cache = JSON.parse(await readFile(join(dir, "ratings-cache.json"), "utf8"));
  assert.ok(Object.keys(cache).length >= 40);
  // ברירת מחדל: 300
  const calls2 = [], inner2 = disneyMock([]);
  globalThis.fetch = async (u, i) => { if (new URL(String(u)).hostname === "www.omdbapi.com") calls2.push(1); return inner2(u, i); };
  await runAll({ tmdbKey: "k", omdbKey: "o", dir: await mkdtemp(join(tmpdir(), "both-")) });
  assert.ok(calls2.length <= 300 && calls2.length > 0, "בקשות OMDb: " + calls2.length);
  // כשל בדיסני+ (תוצאות דלילות) משאיר נטפליקס
  const dir3 = await mkdtemp(join(tmpdir(), "both-")), inner3 = disneyMock([]);
  globalThis.fetch = async (u, i) => (new URL(String(u)).searchParams.get("with_watch_providers") === "2337" ? json({ results: [] }) : inner3(u, i));
  console.error = () => {};
  const o3 = await runAll({ tmdbKey: "k", dir: dir3 });
  assert.ok(o3.netflix && o3.disney === null);
  await assert.rejects(readFile(join(dir3, "disney.json"), "utf8"));
});

test("שני השירותים: אותה סכמה בדיוק", async () => {
  const dir = await mkdtemp(join(tmpdir(), "both-"));
  globalThis.fetch = disneyMock([]);
  const o = await runAll({ tmdbKey: "k", dir });
  assert.deepEqual(Object.keys(o.netflix), Object.keys(o.disney));
  assert.deepEqual(Object.keys(Object.values(o.netflix.items)[0]).sort(), Object.keys(Object.values(o.disney.items)[0]).sort());
});
