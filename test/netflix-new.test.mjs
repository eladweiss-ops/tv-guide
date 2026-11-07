// טופ 10 של נטפליקס ישראל, "חדש בנטפליקס" (תמונת מצב של הקטלוג), שמות בעברית (ויקינתונים + nf-he.json), דוקו ספורט
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseTop10, stripSeason, pickMatch, updateSeen, arrivals, seenText, cleanHe, applyHe, hebrewTitles, newRowSpecs, SPORT_KW,
  run, finalize, SERVICES, TOP10_URLS, WIKI_SPARQL,
} from "../netflix.mjs";

const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => (typeof o === "string" ? o : JSON.stringify(o)), headers: { get: () => null } });
const html = (s, status = 200) => ({ ok: status < 400, status, text: async () => s, json: async () => { throw new Error("not json"); }, headers: { get: () => null } });
const realFetch = globalThis.fetch, realErr = console.error, realLog = console.log;
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realErr; console.log = realLog; });
const NOW = Date.UTC(2026, 10, 8, 3);

// עמוד Tudum מדומה באותו מבנה כמו האמיתי (8.11.2026): כל פריט פעמיים (כרטיסים + טבלה)
function tudum(list, { week = "2026-11-01", country = "IL" } = {}) {
  const ent = (g) => list.map((e) => `"PulseTop10ItemEntity:top10-${g}-${e.vid}":{"__typename":"PulseTop10ItemEntity","id":"top10-${g}-${e.vid}","theme":null,"top10":{"__typename":"Top10Data","weekEndDate":"${week}","category":"${e.show ? "SERIES" : "MOVIES"}","weeklyRank":${e.rank},"weeklyHoursViewed":null,"videoId":${e.vid}}}`).join(",");
  const vid = () => list.map((e) => `"top10Video":{"__typename":"Top10PulseVideo","title":"${e.title}","videoId":${e.vid},"shortSynopsis":"x","releaseYear":${e.year || 2026},"parentShow":${e.show ? `{"__typename":"Top10PulseVideo","title":"${e.show}"}` : "null"},"number":1},"displayVideo":{"__typename":"PulseDisplayVideo","video":{"__typename":"${e.show ? "Season" : "Movie"}","videoId":${e.vid},${e.show ? `"parentShow":{"__typename":"Show","unifiedEntityId":"Video:${e.sid}","videoId":${e.sid},"isAvailable":true,"availabilityStartTime":"${e.avail || "2020-01-01"}T07:00:00.000Z"` : `"availabilityStartTime":"${e.avail || "2020-01-01"}T07:00:00.000Z"`}}}`).join(",");
  return `<html>{"country":"${country}","countryName":"x"}{${ent("A")},${ent("B")}}[${vid()}][${vid()}]</html>`;
}
const TV = [
  { rank: 1, vid: 81970499, sid: 81970498, title: "The One About Matthew Perry: Season 1", show: "The One About Matthew Perry", avail: "2026-10-27" },
  { rank: 2, vid: 81944881, sid: 81944880, title: "A Couple of Lies: Limited Series", show: "A Couple of Lies", avail: "2026-10-30" },
  { rank: 3, vid: 81423428, sid: 80994082, title: "Lupin: Part 4", show: "Lupin", avail: "2021-01-08" },
  { rank: 4, vid: 81010119, sid: 80994082, title: "Lupin: Part 1", show: "Lupin", avail: "2021-01-08" },
  { rank: 5, vid: 81958126, sid: 81288983, title: "The Diplomat: Season 4", show: "The Diplomat" },
  { rank: 6, vid: 70195807, sid: 70196154, title: "Unforgettable: Season 1", show: "Unforgettable", year: 2011 },
];
const MV = [
  { rank: 1, vid: 81902147, title: "Sonic the Hedgehog 3", year: 2024 },
  { rank: 2, vid: 82063750, title: "Hot Wheels Let\\'s Race: Attack of the T-Rex", avail: "2026-10-19" },
  { rank: 3, vid: 769773, title: "Money Train", year: 1995 },
];

test("parseTop10: דירוג, כפילויות, עונות של אותה סדרה, מזהה הסדרה, תאריך עלייה, ופענוח", () => {
  const tv = parseTop10(tudum(TV), NOW);
  assert.deepEqual(tv.map((e) => e.rank), [1, 2, 3, 5, 6], "Lupin פעם אחת, בדירוג הגבוה");
  assert.deepEqual(tv.map((e) => e.title), ["The One About Matthew Perry", "A Couple of Lies", "Lupin", "The Diplomat", "Unforgettable"]);
  assert.equal(tv[1].nfid, "81944880", "מזהה הסדרה, לא של העונה");
  assert.equal(tv[1].avail, "2026-10-30");
  assert.equal(tv[4].year, 2011);
  const mv = parseTop10(tudum(MV), NOW);
  assert.equal(mv.length, 3);
  assert.equal(mv[1].title, "Hot Wheels Let's Race: Attack of the T-Rex");
  assert.equal(mv[0].nfid, "81902147");
  // סדר במסמך שונה מהדירוג: לפי weeklyRank
  assert.deepEqual(parseTop10(tudum([MV[2], MV[0], MV[1]]), NOW).map((e) => e.rank), [1, 2, 3]);
});

test("parseTop10: עמוד של מדינה אחרת, שבוע ישן, או HTML אחר = ריק", () => {
  assert.deepEqual(parseTop10(tudum(TV, { country: "US" }), NOW), []);
  assert.deepEqual(parseTop10(tudum(TV, { week: "2026-09-01" }), NOW), []);
  assert.deepEqual(parseTop10("<html>blocked</html>", NOW), []);
  assert.deepEqual(parseTop10(null, NOW), []);
});

test("stripSeason", () => {
  assert.equal(stripSeason("Nobody Wants This: Season 3"), "Nobody Wants This");
  assert.equal(stripSeason("Lupin: Part 4"), "Lupin");
  assert.equal(stripSeason("A Couple of Lies: Limited Series"), "A Couple of Lies");
  assert.equal(stripSeason("Hot Wheels Let's Race: Attack of the T-Rex"), "Hot Wheels Let's Race: Attack of the T-Rex");
  assert.equal(stripSeason("Sonic the Hedgehog 3"), "Sonic the Hedgehog 3");
});

test("pickMatch: שם זהה + בקטלוג קודם; בלי שם זהה רק מהקטלוג; שנה לסרטים", () => {
  const cat = new Map([["t336240", 1]]);
  const res = [{ id: 1, name: "A Couple of Lies", first_air_date: "2019-01-01", popularity: 50 }, { id: 336240, name: "A Couple of Lies", original_name: "Bytet", first_air_date: "2026-10-30", popularity: 5 }];
  assert.equal(pickMatch(res, { title: "A Couple of Lies", year: 2026 }, "tv", cat).id, 336240);
  assert.equal(pickMatch([{ id: 9, name: "Something Else" }], { title: "A Couple of Lies" }, "tv", new Map()), null);
  assert.equal(pickMatch([{ id: 9, name: "Something Else" }], { title: "A Couple of Lies" }, "tv", new Map([["t9", 1]])).id, 9);
  const mv = [{ id: 1, title: "Money Train", release_date: "2019-01-01", popularity: 90 }, { id: 2, title: "Money Train", release_date: "1995-11-22", popularity: 9 }];
  assert.equal(pickMatch(mv, { title: "Money Train", year: 1995 }, "movie", new Map()).id, 2);
});

// ---------- תמונת מצב ----------
const crawl = (keys, ok = true) => ({ ok, map: new Map(keys.map((k) => [k, { type: k[0] === "m" ? "movie" : "tv", id: +k.slice(1), pop: 1 }])) });

test("updateSeen/arrivals: seed בלי 'חדש', פריט שמופיע אחרי ימי החסד חדש 30 יום, ונמחק אחרי 60 יום בלי שנראה", () => {
  let s = updateSeen(null, crawl(["m1", "t2"]), { today: "2026-11-01" });
  assert.equal(s.seed, "2026-11-01"); assert.deepEqual(s.k.m1, ["", "2026-11-01"]);
  assert.equal(arrivals(s, "2026-11-01").size, 0);
  // יום אחרי: פריט חדש עדיין בימי החסד (סריקה ראשונה יכולה לפספס)
  s = updateSeen(s, crawl(["m1", "t2", "m3"]), { today: "2026-11-02" });
  assert.equal(arrivals(s, "2026-11-02").size, 0);
  // מוריד הגשם (t256711) עולה לנטפליקס ב-8.11
  s = updateSeen(s, crawl(["m1", "t2", "m3", "t256711"]), { today: "2026-11-08" });
  assert.deepEqual([...arrivals(s, "2026-11-08")], [["t256711", "2026-11-08"]]);
  assert.equal(arrivals(s, "2026-12-07").size, 1); assert.equal(arrivals(s, "2026-12-09").size, 0, "אחרי 30 יום כבר לא חדש");
  // "אחרון" מתעדכן רק פעם בשבוע (פחות שינויים בקובץ)
  const s2 = updateSeen(s, crawl(["m1", "t2", "m3", "t256711"]), { today: "2026-11-09" });
  assert.deepEqual(s2.k.m1, s.k.m1);
  // לא נראה 60 יום: נמחק
  const s3 = updateSeen(s, crawl(["t256711"]), { today: "2027-01-08" });
  assert.ok(!s3.k.m1 && s3.k.t256711);
});

test("updateSeen: סריקה חלקית לא מוסיפה פריטים חדשים, ולא יוצרת seed; ירידה חדה בכמות = חלקית", () => {
  assert.equal(updateSeen(null, crawl(["m1"], false), { today: "2026-11-01" }).seed, "");
  let s = updateSeen(null, crawl(Array.from({ length: 10 }, (_, i) => "m" + i)), { today: "2026-11-01" });
  s = updateSeen(s, crawl(["m1", "m99"], false), { today: "2026-11-10" });
  assert.ok(!s.k.m99);
  s = updateSeen(s, crawl(["m1", "m2", "m98"]), { today: "2026-11-10" }); // 3 מתוך 10: חלקית
  assert.ok(!s.k.m98);
  s = updateSeen(s, crawl([...Array.from({ length: 10 }, (_, i) => "m" + i), "m97"]), { today: "2026-11-10" });
  assert.deepEqual(s.k.m97, ["2026-11-10", "2026-11-10"]);
});

test("updateSeen: החלפת אזור (דיסני+ בריטניה -> ישראל) מתחילה seed חדש; מזהי נטפליקס נשמרים; קובץ קריא ותקין", () => {
  let s = updateSeen(null, crawl(["m1"]), { today: "2026-11-01", region: "GB" });
  s.nf.m1 = "123";
  s = updateSeen(s, crawl(["m1", "m2"]), { today: "2026-11-20", region: "" });
  assert.equal(s.seed, "2026-11-20"); assert.equal(arrivals(s, "2026-11-20").size, 0); assert.equal(s.nf.m1, "123");
  const txt = seenText(s);
  assert.deepEqual(JSON.parse(txt), s);
  assert.ok(txt.split("\n").length >= 4, "שורה לכל מפתח");
  assert.ok(updateSeen({ v: 1, k: [] }, crawl(["m1"]), { today: "2026-11-01" }).seed, "קובץ פגום = seed חדש");
});

// ---------- עברית ----------
test("cleanHe/applyHe: הסרת תיאור בסוגריים, האנגלי ל-orig, קישור חיפוש לפי האנגלי", () => {
  assert.equal(cleanHe("מוריד הגשם (סדרת טלוויזיה)"), "מוריד הגשם");
  const base = "https://www.netflix.com/search?q=";
  const it = { title: "A Couple of Lies", orig: "Bytet", link: base + "Bytet" };
  applyHe(it, "חילופי בתים", base);
  assert.deepEqual(it, { title: "חילופי בתים", orig: "A Couple of Lies", link: base + "A%20Couple%20of%20Lies" });
  const direct = { title: "X", orig: "", link: "https://www.netflix.com/title/5" };
  applyHe(direct, "איקס", base); assert.equal(direct.link, "https://www.netflix.com/title/5");
  const heb = { title: "שובר שורות", orig: "Breaking Bad" };
  applyHe(heb, "abc", base); assert.equal(heb.title, "שובר שורות", "לא עברית: לא מוחלף");
});

test("hebrewTitles: שאילתה אחת לוויקינתונים לפי P4983/P4947, ותיקון ידני גובר", async () => {
  const calls = [];
  globalThis.fetch = async (u, init) => {
    calls.push({ u: String(u), body: String(init && init.body), ua: init && init.headers && init.headers["user-agent"] });
    return json({ results: { bindings: [{ tv: { value: "256711" }, l: { value: "מוריד הגשם (סדרת טלוויזיה)" } }, { mv: { value: "940721" }, l: { value: "גודזילה מינוס אחד" } }] } });
  };
  const items = { t256711: { title: "The Rainmaker", orig: "" }, m940721: { title: "Godzilla Minus One", orig: "ゴジラ-1.0" }, t336240: { title: "A Couple of Lies", orig: "Bytet" }, t1: { title: "שובר שורות" } };
  const r = await hebrewTitles(items, { overrides: { t336240: "חילופי בתים", t404: "לא קיים", t1: "" } });
  assert.equal(calls.length, 1); assert.equal(calls[0].u, WIKI_SPARQL); assert.ok(/tv-guide/.test(calls[0].ua));
  const q = new URLSearchParams(calls[0].body).get("query");
  assert.ok(q.includes("P4983") && q.includes("P4947") && q.includes('"256711"') && q.includes('"940721"') && !q.includes('"1"'));
  assert.equal(items.t256711.title, "מוריד הגשם"); assert.equal(items.t256711.orig, "The Rainmaker");
  assert.equal(items.m940721.title, "גודזילה מינוס אחד"); assert.equal(items.m940721.orig, "Godzilla Minus One");
  assert.equal(items.t336240.title, "חילופי בתים");
  assert.equal(items.t1.title, "שובר שורות");
  assert.deepEqual(r, { need: 3, wiki: 2, overrides: 1 });
  // כשל ויקינתונים: בלי שינוי, לא זורק; התיקון הידני עדיין חל
  globalThis.fetch = async () => json({}, 504);
  console.log = () => {};
  const it2 = { t336240: { title: "A Couple of Lies", orig: "Bytet" }, t5: { title: "Eng" } };
  await hebrewTitles(it2, { overrides: { t336240: "חילופי בתים" } });
  assert.equal(it2.t336240.title, "חילופי בתים"); assert.equal(it2.t5.title, "Eng");
});

test("nf-he.json במאגר: JSON תקין, מפתחות m/t ושמות בעברית", async () => {
  const o = JSON.parse(await readFile(new URL("../nf-he.json", import.meta.url), "utf8"));
  assert.equal(o.t336240, "חילופי בתים");
  for (const [k, v] of Object.entries(o)) { assert.match(k, /^[mt]\d+$/); assert.match(v, /[֐-׿]/); }
});

test("דוקו ספורט: ז'אנר 99 + מילות מפתח ספורט; דוקו הרגיל בלעדיהן", () => {
  const s = newRowSpecs(NOW);
  for (const [t, e] of s.sportdoc) { assert.equal(e.with_genres, "99"); assert.equal(e.with_keywords, SPORT_KW); assert.ok(["movie", "tv"].includes(t)); }
  for (const [, e] of s.docu) { assert.equal(e.with_genres, "99"); assert.equal(e.without_keywords, SPORT_KW); }
  assert.ok(SPORT_KW.split("|").includes("159290"), "sports documentary");
});

test("finalize: top10 ריקה לא נכתבת; מלאה נכתבת ראשונה בלי סינון 2-שורות", () => {
  const items = Object.fromEntries(["m1", "m2", "m3", "m4", "m5"].map((k) => [k, { title: k, poster: "p" }]));
  const f = finalize({ top10: [], popular: ["m1"], recent: [], top: [] }, items, SERVICES.netflix);
  assert.ok(!("top10" in f.rows) && !("top10" in f.rowMeta) && f.rows.popular);
  const g = finalize({ top10: ["m1", "m2", "m3", "m4", "m5"], popular: ["m1"], recent: ["m1"], top: [] }, items, SERVICES.netflix);
  assert.deepEqual(Object.keys(g.rows)[0], "top10"); assert.equal(g.rows.top10.length, 5); assert.equal(g.rowMeta.top10.title, "🔥 טופ 10 בישראל");
});

// ---------- ריצה מלאה עם מוקים ----------
// קטלוג (2 עמודים לכל סוג, מיון לפי שם), חיפוש, פרטים, Tudum וויקינתונים
function fullMock({ log = [], top10 = true, extraCatalog = [] } = {}) {
  const det = { t336240: { name: "A Couple of Lies", original_name: "Bytet" }, t256711: { name: "The Rainmaker", original_name: "The Rainmaker", first_air_date: "2025-08-15" } };
  return async (u, init) => {
    const url = new URL(String(u));
    if (url.href === TOP10_URLS.tv) return top10 ? html(tudum(TV)) : html("forbidden", 403);
    if (url.href === TOP10_URLS.movie) return top10 ? html(tudum(MV)) : html("forbidden", 403);
    if (url.href === WIKI_SPARQL) return json({ results: { bindings: [{ tv: { value: "256711" }, l: { value: "מוריד הגשם (סדרת טלוויזיה)" } }] } });
    if (url.hostname !== "api.themoviedb.org") return json({}, 404);
    const p = url.pathname, q = Object.fromEntries(url.searchParams);
    const s = p.match(/^\/3\/search\/(movie|tv)$/);
    if (s) {
      const ids = { "A Couple of Lies": 336240, "The One About Matthew Perry": 300001, Lupin: 96677, "The Diplomat": 202411, Unforgettable: 39351, "Sonic the Hedgehog 3": 939243, "Money Train": 11517 };
      const id = ids[q.query];
      return json({ results: id ? [{ id, name: q.query, title: q.query, popularity: 50, first_air_date: "2011-01-01", release_date: q.query === "Money Train" ? "1995-11-22" : "2024-12-19" }] : [] });
    }
    const d = p.match(/^\/3\/discover\/(movie|tv)$/);
    if (d) {
      log.push({ type: d[1], q });
      if (/\.asc$/.test(q.sort_by || "")) { // סריקת קטלוג
        const pg = Number(q.page || 1), base = d[1] === "movie" ? 7000 : 8000;
        const res = Array.from({ length: 20 }, (_, n) => ({ id: base + (pg - 1) * 20 + n, popularity: 1 + n }));
        if (pg === 2) for (const k of extraCatalog) if ((k[0] === "m") === (d[1] === "movie")) res.push({ id: +k.slice(1), popularity: 80, first_air_date: "2025-08-15" });
        return json({ page: pg, total_pages: 2, total_results: 40, results: res });
      }
      const { page, ...rest } = q;
      const seed = [...JSON.stringify(rest)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 50000, 7);
      const pg = Number(page || 1);
      return json({ results: Array.from({ length: 20 }, (_, n) => ({ id: seed * 100 + (pg - 1) * 20 + n + (d[1] === "tv" ? 50000000 : 0), popularity: 100 - n, release_date: "2026-10-0" + (1 + (n % 9)) })) });
    }
    const m = p.match(/^\/3\/(movie|tv)\/(\d+)$/);
    if (m) {
      const k = (m[1] === "movie" ? "m" : "t") + m[2], x = det[k] || {}, en = q.language === "en-US";
      return json({ id: +m[2], title: en && m[1] === "movie" ? "English " + k : "", name: x.name || (en ? "English " + k : ""), original_title: "Orig", original_name: x.original_name || "Orig",
        overview: "תקציר", release_date: "2026-09-01", first_air_date: x.first_air_date || "2026-09-01", vote_average: 8, vote_count: 400,
        backdrop_path: "/b.jpg", poster_path: "/p.jpg", genres: [{ name: "דרמה" }], external_ids: {}, videos: { results: [] } });
    }
    return json({}, 404);
  };
}

test("run: טופ 10 ראשון עם קישורים ישירים, 'חדש בנטפליקס' עם מוריד הגשם (תמונת מצב בלעדיו), שמות בעברית", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nf-"));
  await writeFile(join(dir, "nf-he.json"), JSON.stringify({ t336240: "חילופי בתים" }));
  console.log = () => {}; console.error = () => {};
  // לילה 1 (31.10): seed, בלי מוריד הגשם
  globalThis.fetch = fullMock();
  const o1 = await run({ tmdbKey: "k", dir, now: Date.UTC(2026, 9, 31, 3) });
  assert.ok(o1);
  const s1 = JSON.parse(await readFile(join(dir, "netflix-seen.json"), "utf8"));
  assert.equal(s1.seed, "2026-10-31"); assert.ok(!s1.k.t256711); assert.equal(Object.keys(s1.k).length, 80);
  // לילה 2 (8.11): מוריד הגשם הופיע בקטלוג
  const log = [];
  globalThis.fetch = fullMock({ log, extraCatalog: ["t256711"] });
  const out = await run({ tmdbKey: "k", dir, now: NOW });
  assert.equal(Object.keys(out.rows)[0], "top10", "טופ 10 ראשונה");
  assert.deepEqual(out.rows.top10.slice(0, 4), ["t300001", "m939243", "t336240", "m11517"], "סדרות וסרטים לסירוגין לפי הדירוג");
  assert.ok(!out.rows.top10.includes("m0"), "Hot Wheels לא הותאם: לא בשורה");
  assert.equal(out.items.t336240.link, "https://www.netflix.com/title/81944880");
  assert.equal(out.items.t336240.nfid, "81944880");
  assert.equal(out.items.t336240.title, "חילופי בתים"); assert.equal(out.items.t336240.orig, "A Couple of Lies");
  assert.ok(out.rows.week.includes("t256711"), "מוריד הגשם ב'חדש בנטפליקס' אף שיצא ב-2025");
  assert.equal(out.items.t256711.title, "מוריד הגשם"); assert.equal(out.items.t256711.orig, "The Rainmaker");
  assert.equal(out.rows.week[0], "t256711", "הכי חדש ראשון (הגיע היום)");
  assert.ok(out.rows.week.includes("t336240") || out.rows.top10.includes("t336240"));
  assert.equal(out.rowMeta.week.title, "✨ חדש בנטפליקס");
  assert.ok(out.rows.sportdoc && out.rowMeta.sportdoc.title === "⚽ דוקו ספורט");
  assert.ok(log.some((c) => c.q.with_keywords === SPORT_KW && c.q.with_genres === "99"));
  for (const c of log) { assert.equal(c.q.watch_region, "IL"); assert.equal(c.q.with_watch_providers, "8"); }
  const cnt = {}; for (const [n, r] of Object.entries(out.rows)) for (const k of r) cnt[k] = (cnt[k] || 0) + 1;
  for (const n of SERVICES.netflix.order) for (const k of out.rows[n] || []) assert.ok(cnt[k] <= 2 || ["top10", "popular", "recent", "top"].some((b) => (out.rows[b] || []).includes(k)), k);
  const s2 = JSON.parse(await readFile(join(dir, "netflix-seen.json"), "utf8"));
  assert.deepEqual(s2.k.t256711, ["2026-11-08", "2026-11-08"]);
  assert.equal(s2.nf.t336240, "81944880", "מזהה נטפליקס נשמר להמשך");
  // לילה 3: נטפליקס חוסם (403) – אין שורת טופ 10, אבל הקישור הישיר נשאר מהזיכרון
  globalThis.fetch = fullMock({ top10: false, extraCatalog: ["t256711"] });
  const o3 = await run({ tmdbKey: "k", dir, now: NOW + 86400000 });
  assert.ok(o3 && !o3.rows.top10 && !o3.rowMeta.top10);
  if (o3.items.t336240) assert.equal(o3.items.t336240.link, "https://www.netflix.com/title/81944880");
  assert.ok(o3.rows.week.includes("t256711"));
});

test("run disney: תמונת מצב נפרדת (disney-seen.json), בלי טופ 10 ובלי קישורי נטפליקס", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ds-"));
  const inner = fullMock();
  const urls = [];
  globalThis.fetch = async (u, i) => {
    urls.push(String(u));
    const url = new URL(String(u));
    if (url.pathname === "/3/watch/providers/movie") return json({ results: [{ provider_id: 2337, provider_name: "Disney Plus" }] });
    return inner(u, i);
  };
  console.log = () => {}; console.error = () => {};
  const out = await run({ tmdbKey: "k", dir, service: "disney", now: NOW });
  assert.ok(out && !out.rows.top10);
  assert.ok(!urls.some((u) => u.includes("netflix.com")));
  assert.ok(Object.values(out.items).every((it) => !it.nfid && it.link.startsWith("https://www.disneyplus.com/")));
  assert.ok(JSON.parse(await readFile(join(dir, "disney-seen.json"), "utf8")).seed);
  await assert.rejects(readFile(join(dir, "netflix-seen.json"), "utf8"));
});
