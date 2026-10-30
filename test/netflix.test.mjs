import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOmdb, shapeItem, fillRatings, isFresh, run, pickHero } from "../netflix.mjs";

const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

test("parseOmdb: N/A, אחוזים וציון X/10", () => {
  assert.deepEqual(parseOmdb({ imdbRating: "8.7", Ratings: [
    { Source: "Internet Movie Database", Value: "8.7/10" },
    { Source: "Rotten Tomatoes", Value: "87%" },
    { Source: "Metacritic", Value: "72/100" }] }), { imdb: 8.7, rt: 87, mc: 72 });
  assert.deepEqual(parseOmdb({ imdbRating: "N/A", Ratings: [{ Source: "Rotten Tomatoes", Value: "N/A" }] }), {});
  assert.deepEqual(parseOmdb({ Response: "False", Error: "x" }), {});
  assert.deepEqual(parseOmdb({ Ratings: [{ Source: "Internet Movie Database", Value: "7.1/10" }] }), { imdb: 7.1 });
});

test("shapeItem: נפילה לאנגלית כשחסרה עברית", () => {
  const he = { id: 1, title: "Foo", original_title: "Foo", overview: "", release_date: "2024-05-01", genres: [{ name: "דרמה" }],
    poster_path: "/p.jpg", backdrop_path: "/b.jpg", runtime: 100, external_ids: { imdb_id: "tt1" } };
  const it = shapeItem("movie", he, { title: "Foo EN", overview: "English text" });
  assert.equal(it.overview, "English text");
  assert.equal(it.year, 2024);
  assert.equal(it.poster, "https://image.tmdb.org/t/p/w342/p.jpg");
  assert.equal(it.backdrop, "https://image.tmdb.org/t/p/w780/b.jpg");
  assert.equal(it.imdb_id, "tt1");
  assert.match(it.link, /^https:\/\/www\.netflix\.com\/search\?q=/);
  const heb = shapeItem("tv", { id: 2, name: "סדרה", original_name: "Show", overview: "תקציר", number_of_seasons: 3 }, null);
  assert.equal(heb.title, "סדרה");
  assert.equal(heb.orig, "Show");
  assert.equal(heb.overview, "תקציר");
  assert.equal(heb.seasons, 3);
});

test("מטמון: טרי לא נשלף שוב, ישן נשלף, ותקרת בקשות", async () => {
  const now = 1e12, day = 86400000;
  assert.ok(isFresh({ t: now - 6 * day }, now));
  assert.ok(!isFresh({ t: now - 8 * day }, now));
  const calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u)); return json({ imdbRating: "7.0", Ratings: [] }); };
  const cache = { ttFresh: { t: now - day, r: { imdb: 1 } }, ttStale: { t: now - 9 * day, r: {} } };
  const used = await fillRatings(["ttFresh", "ttStale", "ttNew"], cache, "K", { now });
  assert.equal(used, 2);
  assert.ok(!calls.some((c) => c.includes("ttFresh")));
  assert.equal(cache.ttStale.r.imdb, 7);
  calls.length = 0;
  const ids = Array.from({ length: 10 }, (_, i) => "tt" + i);
  const used2 = await fillRatings(ids, {}, "K", { cap: 4, now });
  assert.equal(used2, 4);
  assert.equal(calls.length, 4);
});

test("pickHero: הכי מדורג עם backdrop", () => {
  const items = { a: { backdrop: "x", vote: 7 }, b: { backdrop: "", vote: 9.9 }, c: { backdrop: "y", vote: 8, ratings: { imdb: 8.5 } } };
  assert.equal(pickHero(["a", "b", "c"], items), "c");
});

function tmdbMock({ fail = false } = {}) {
  return async (u) => {
    u = new URL(String(u));
    if (u.hostname === "www.omdbapi.com") return json({ imdbRating: "8.1", Ratings: [{ Source: "Rotten Tomatoes", Value: "90%" }] });
    if (fail) return json({}, 500);
    if (u.pathname.startsWith("/3/discover/")) return json({ results: [{ id: 10, popularity: 5 }] });
    const m = u.pathname.match(/^\/3\/(movie|tv)\/(\d+)$/);
    if (m) {
      const en = u.searchParams.get("language") === "en-US";
      return json({ id: +m[2], title: en ? "English" : "", name: en ? "English" : "", original_title: "Orig", original_name: "Orig",
        overview: en ? "EN overview" : "", release_date: "2026-09-01", first_air_date: "2026-09-01", vote_average: 8,
        backdrop_path: "/b.jpg", poster_path: "/p.jpg", genres: [{ name: "דרמה" }],
        external_ids: { imdb_id: "tt" + m[1] + m[2] }, videos: { results: [{ site: "YouTube", type: "Trailer", key: "YT1" }] } });
    }
    return json({}, 404);
  };
}

test("run: בונה netflix.json, ציונים, hero, ושומר מטמון", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  globalThis.fetch = tmdbMock();
  const out = await run({ tmdbKey: "k", omdbKey: "o", dir });
  assert.equal(out.v, 2);
  const it = out.items.m10;
  assert.equal(it.title, "English");
  assert.equal(it.trailer, "YT1");
  assert.deepEqual(it.ratings, { imdb: 8.1, rt: 90 });
  assert.ok(out.hero);
  const cache = JSON.parse(await readFile(join(dir, "ratings-cache.json"), "utf8"));
  assert.equal(Object.keys(cache).length, 2);
});

test("run: בלי OMDB_API_KEY עובד בלי ציונים", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  globalThis.fetch = tmdbMock();
  const out = await run({ tmdbKey: "k", omdbKey: "", dir });
  assert.ok(out.items.m10);
  assert.equal(out.items.m10.ratings, undefined);
});

test("run: כשל API משאיר את הקובץ הקודם", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  await writeFile(join(dir, "netflix.json"), '{"old":true}');
  globalThis.fetch = tmdbMock({ fail: true });
  assert.equal(await run({ tmdbKey: "k", omdbKey: "o", dir }), null);
  assert.equal(await readFile(join(dir, "netflix.json"), "utf8"), '{"old":true}');
});

test("run: חריגת רשת לא זורקת", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  globalThis.fetch = async () => { throw new Error("net down"); };
  assert.equal(await run({ tmdbKey: "k", dir }), null);
});
