// node --test calendar-server/test/*.mjs  - /api/nf-search (TMDB מדומה, בלי רשת)
import test from "node:test";
import assert from "node:assert/strict";

process.env.TMDB_API_KEY = "k".repeat(32);
delete process.env.BLOB_READ_WRITE_TOKEN;
console.error = () => {};
const { handleSearch, _clearCache, hashOf } = await import("../api/nf-search.js");
const nfh = (await import("../api/nf-search.js")).default;
const { searchNf, cleanQuery, norm } = await import("../api/_nfs.js");
const { tmdbAuth } = await import("../api/_tmdb.js");
const { _resetLimits } = await import("../api/_guard.js");

const jr = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
function mockRes() {
  const r = { code: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => r;
  return r;
}

// TMDB מדומה: מחזיר לפי נתיב. calls = רשימת הכתובות
function tmdb(over = {}) {
  const calls = [];
  const fx = async (url, init) => {
    const u = new URL(url); calls.push({ path: u.pathname.replace("/3", ""), q: u.searchParams, init });
    const p = u.pathname.replace("/3", "");
    if (over[p]) { const v = typeof over[p] === "function" ? over[p](u) : over[p]; return v && v.__status ? jr({}, v.__status) : jr(v); }
    if (/\/watch\/providers$/.test(p)) return jr({ results: {} });
    return jr({ results: [] });
  };
  fx.calls = calls; return fx;
}
const mov = (id, title, o = {}) => ({ id, title, original_title: title, release_date: "2019-04-24", overview: "תקציר", poster_path: "/abcde12345.jpg", backdrop_path: "/bd12345.jpg", vote_average: 8.26, ...o });

test.beforeEach(() => { _clearCache(); _resetLimits(); });

test("tmdbAuth: מפתח ארוך = Bearer, קצר = api_key", () => {
  assert.ok(tmdbAuth("x".repeat(80)).headers.authorization.startsWith("Bearer "));
  assert.equal(tmdbAuth("short").qs.api_key, "short");
  assert.equal(tmdbAuth(""), null);
});

test("cleanQuery: אורך, תווי בקרה ורווחים", () => {
  assert.equal(cleanQuery("a"), "");
  assert.equal(cleanQuery("  הנוקמים \n"), "הנוקמים");
  assert.equal(cleanQuery("x".repeat(61)), "");
  assert.equal(cleanQuery(5), "");
});

test("חיפוש רגיל: he-IL עם נפילה לאנגלית, זמינות נטפליקס ושירותים אחרים", async () => {
  const fx = tmdb({
    "/search/multi": (u) => u.searchParams.get("language") === "he-IL"
      ? { results: [{ media_type: "movie", ...mov(603, "", { original_title: "The Matrix", overview: "" }) }, { media_type: "tv", id: 5, name: "סדרה", original_name: "Show", first_air_date: "2020-01-01", overview: "x" }] }
      : { results: [{ media_type: "movie", id: 603, title: "The Matrix", original_title: "The Matrix", overview: "Neo wakes" }] },
    "/movie/603/watch/providers": { results: { IL: { flatrate: [{ provider_id: 8, provider_name: "Netflix" }, { provider_id: 119, provider_name: "Prime Video" }] } } },
    "/tv/5/watch/providers": { results: { IL: { flatrate: [{ provider_id: 119, provider_name: "Prime Video" }], rent: [{ provider_id: 8 }] } } },
  });
  const out = await searchNf("matrix", { fetch: fx });
  const m = out.items.m603, s = out.items.t5;
  assert.equal(m.title, "The Matrix"); // נפילה לאנגלית כשהעברית ריקה
  assert.equal(m.overview, "Neo wakes");
  assert.equal(m.nf, true);
  assert.equal(m.link, "https://www.netflix.com/search?q=The%20Matrix");
  assert.deepEqual(m.others, ["Prime Video"]);
  assert.equal(s.nf, false); assert.equal(s.link, ""); // rent לא נחשב, רק flatrate
  assert.deepEqual(s.others, ["Prime Video"]);
  assert.deepEqual(out.titles, ["m603", "t5"]);
  assert.equal(fx.calls.find((c) => c.path === "/search/multi").q.get("api_key"), "k".repeat(32));
});

test("אוסף: 'הנוקמים' מחזיר את הסרטים לפי סדר יציאה", async () => {
  const fx = tmdb({
    "/search/multi": { results: [] },
    "/search/collection": { results: [{ id: 86311, name: "הנוקמים - אוסף", poster_path: "/col12345.jpg" }] },
    "/collection/86311": { name: "הנוקמים - אוסף", poster_path: "/col12345.jpg", parts: [mov(299534, "הנוקמים: סוף המשחק", { release_date: "2019-04-24" }), mov(24428, "הנוקמים", { release_date: "2012-04-25" }), mov(99861, "הנוקמים: עידן אולטרון", { release_date: "2015-04-22" })] },
    "/movie/24428/watch/providers": { results: { IL: { flatrate: [{ provider_id: 337, provider_name: "Disney Plus" }] } } },
  });
  const out = await searchNf("הנוקמים", { fetch: fx });
  assert.deepEqual(out.collection.keys, ["m24428", "m99861", "m299534"]);
  assert.equal(out.collection.name, "הנוקמים - אוסף");
  assert.equal(out.items.m24428.nf, false);
  assert.deepEqual(out.items.m24428.others, ["Disney Plus"]);
});

test("מותג: 'מארוול' עובר דרך כינוי ל-Marvel Studios ו-discover לפי with_companies", async () => {
  const fx = tmdb({
    "/search/multi": { results: [] },
    "/search/company": (u) => ({ results: u.searchParams.get("query") === "Marvel Studios" ? [{ id: 420, name: "Marvel Studios" }] : [] }),
    "/discover/movie": { results: [mov(1, "ברזל", { popularity: 50 }), mov(2, "ת'ור", { popularity: 90 })] },
    "/discover/tv": { results: [{ id: 9, name: "וונדה", first_air_date: "2021-01-15", popularity: 70 }] },
  });
  const out = await searchNf("מארוול", { fetch: fx });
  assert.equal(out.brand.name, "Marvel Studios");
  assert.deepEqual(out.brand.keys, ["m2", "t9", "m1"]); // לפי פופולריות
  assert.equal(fx.calls.find((c) => c.path === "/discover/movie").q.get("with_companies"), "420");
});

test("אדם: known_for + קרדיטים מובילים (רק עם 100+ הצבעות), אפס כפילויות", async () => {
  const fx = tmdb({
    "/search/multi": { results: [{ media_type: "person", id: 31, name: "טום הנקס", profile_path: "/ph12345.jpg", known_for_department: "Acting", known_for: [{ media_type: "movie", ...mov(13, "פורסט גאמפ") }] }] },
    "/person/31/combined_credits": { cast: [{ media_type: "movie", ...mov(13, "פורסט גאמפ"), vote_count: 9000 }, { media_type: "movie", ...mov(857, "להציל את טוראי ריאן"), vote_count: 12000 }, { media_type: "tv", id: 77, name: "קטן", vote_count: 3 }] },
  });
  const out = await searchNf("טום הנקס", { fetch: fx });
  assert.equal(out.persons.length, 1);
  assert.equal(out.persons[0].name, "טום הנקס");
  assert.equal(out.persons[0].dept, "משחק");
  assert.deepEqual(out.persons[0].keys, ["m13", "m857"]);
  assert.ok(!out.items.t77);
});

test("רשימה לבנה: תמונות רק מ-image.tmdb.org, קישורים רק לנטפליקס, מחרוזות מנוקות ואורך מוגבל", async () => {
  const fx = tmdb({
    "/search/multi": { results: [{ media_type: "movie", id: 1, title: "<img src=x onerror=1>\u0000" + "א".repeat(500), original_title: "O", overview: "ב".repeat(900), poster_path: "https://evil.example/x.jpg", backdrop_path: "/../../etc", vote_average: 7, extra: "secret", adult: true }, { media_type: "movie", id: "x", title: "bad" }, { media_type: "person", id: 7, name: "P", profile_path: "javascript:1", known_for: [] }] },
    "/movie/1/watch/providers": { results: { IL: { flatrate: [{ provider_id: 8 }, { provider_id: 2, provider_name: "<b>" + "z".repeat(99) + "</b>" }] } } },
  });
  const out = await searchNf("test", { fetch: fx });
  const it = out.items.m1;
  assert.equal(it.poster, ""); assert.equal(it.backdrop, "");
  assert.ok(it.title.length <= 120 && !/\u0000/.test(it.title));
  assert.ok(it.overview.length <= 400);
  assert.equal(it.extra, undefined); assert.equal(it.adult, undefined);
  assert.ok(it.others[0].length <= 30);
  assert.match(it.link, /^https:\/\/www\.netflix\.com\/search\?q=/);
  assert.equal(out.persons[0].photo, "");
  assert.equal(Object.keys(out.items).length, 1);
  assert.deepEqual(Object.keys(out).sort(), ["brand", "collection", "items", "persons", "q", "titles", "v"]);
  for (const v of Object.values(out.items)) for (const f of [v.poster, v.backdrop]) assert.ok(f === "" || f.startsWith("https://image.tmdb.org/t/p/"));
});

test("מטמון: אותה שאילתה פעמיים = קריאה אחת ל-TMDB; Firestore משרת instance חדש", async () => {
  const fx = tmdb({ "/search/multi": { results: [{ media_type: "movie", ...mov(1, "א") }] } });
  const store = {};
  const d = { fetch: fx, readJson: async (p, dflt) => store[p] ?? dflt, writeJson: async (p, o) => { store[p] = JSON.parse(JSON.stringify(o)); }, now: () => 1_000_000 };
  const a = await handleSearch("matrix", d); assert.equal(a.cache, "miss");
  const n = fx.calls.length;
  const b = await handleSearch("  Matrix ", d); assert.equal(b.cache, "mem"); assert.equal(fx.calls.length, n);
  assert.ok(store[`cache/nf/${hashOf("matrix")}.json`], "נכתב לאחסון");
  _clearCache();
  const c = await handleSearch("matrix", d); assert.equal(c.cache, "db"); assert.equal(fx.calls.length, n);
  // אחרי 12 שעות: חיפוש חי
  const e = await handleSearch("matrix", { ...d, now: () => 1_000_000 + 12 * 3600 * 1000 + 1 }); assert.equal(e.cache, "miss");
});

test("שגיאות: שאילתה קצרה 400, בלי מפתח 503, TMDB נופל 502 (ולא נשמר במטמון)", async () => {
  assert.equal((await handleSearch("a", { fetch: tmdb() })).status, 400);
  const saved = process.env.TMDB_API_KEY; delete process.env.TMDB_API_KEY;
  assert.equal((await handleSearch("matrix", { fetch: tmdb() })).status, 503);
  process.env.TMDB_API_KEY = saved;
  const down = async () => jr({}, 500);
  const store = {};
  const d = { fetch: down, readJson: async () => null, writeJson: async (p, o) => { store[p] = o; } };
  assert.equal((await handleSearch("matrix", d)).status, 502);
  assert.deepEqual(store, {});
});

test("handler: GET בלבד, 429 אחרי 30 בקשות לדקה ל-IP, כותרות מטמון", async () => {
  const req = { method: "GET", headers: { "x-real-ip": "9.9.9.9" }, query: { q: "a" } };
  let r = mockRes(); await nfh({ ...req, method: "POST" }, r); assert.equal(r.code, 405);
  r = mockRes(); await nfh(req, r); assert.equal(r.code, 400); assert.equal(r.headers["cache-control"], "no-store");
  for (let i = 0; i < 29; i++) await nfh(req, mockRes());
  r = mockRes(); await nfh(req, r); assert.equal(r.code, 429); assert.equal(r.body.error, "rate"); assert.equal(r.headers["retry-after"], "60");
  // IP אחר לא מושפע
  r = mockRes(); await nfh({ ...req, headers: { "x-real-ip": "8.8.8.8" } }, r); assert.equal(r.code, 400);
});

test("norm: נרמול עברית/לטינית זהה ללקוח (הדגשים והפיסוק נשמטים)", () => {
  assert.equal(norm("Amélie: The Movie!"), "ameliethemovie");
  assert.equal(norm("הנוקמים: סוף המשחק"), "הנוקמיםסוףהמשחק");
});

test("C: כשל בתת-קריאה (זמינות / אוסף / חיפוש) = partial, לא נשמר ל-Firestore, ובזיכרון רק 5 דקות", async () => {
  const { PARTIAL_TTL } = await import("../api/nf-search.js");
  const mk = (failPath) => tmdb({
    "/search/multi": { results: [{ media_type: "movie", ...mov(1, "א") }] },
    [failPath]: { __status: 500 },
  });
  for (const failPath of ["/movie/1/watch/providers", "/search/collection", "/search/company"]) {
    const out = await searchNf("matrix", { fetch: mk(failPath) });
    assert.equal(out.partial, true, failPath);
  }
  assert.equal((await searchNf("matrix", { fetch: tmdb({ "/search/multi": { results: [{ media_type: "movie", ...mov(1, "א") }] } }) })).partial, undefined, "תשובה שלמה: בלי partial");
  // en-US נופל (he בסדר): גם חלקי
  const fxEn = tmdb({ "/search/multi": (u) => (u.searchParams.get("language") === "en-US" ? { __status: 500 } : { results: [{ media_type: "movie", ...mov(1, "א") }] }) });
  assert.equal((await searchNf("matrix", { fetch: fxEn })).partial, true);
  // handleSearch: חלקי לא נכתב לאחסון, ופג אחרי 5 דקות; שלם נכתב
  const store = {}, wr = async (p, o) => { store[p] = o; };
  const base = { readJson: async () => null, writeJson: wr, now: () => 1_000_000 };
  const bad = mk("/movie/1/watch/providers");
  let r = await handleSearch("matrix", { ...base, fetch: bad }); assert.equal(r.json.partial, true); assert.deepEqual(store, {}, "לא נכתב");
  const n = bad.calls.length;
  r = await handleSearch("matrix", { ...base, fetch: bad, now: () => 1_000_000 + PARTIAL_TTL - 1 }); assert.equal(r.cache, "mem"); assert.equal(bad.calls.length, n);
  r = await handleSearch("matrix", { ...base, fetch: bad, now: () => 1_000_000 + PARTIAL_TTL + 1 }); assert.equal(r.cache, "miss", "אחרי 5 דקות: חיפוש חי");
  _clearCache();
  const good = tmdb({ "/search/multi": { results: [{ media_type: "movie", ...mov(1, "א") }] } });
  await handleSearch("matrix", { ...base, fetch: good }); assert.equal(Object.keys(store).length, 1, "שלם נכתב");
  // כותרת מטמון: חלקי no-store
  _clearCache(); const res = mockRes();
  const savedFetch = globalThis.fetch; globalThis.fetch = bad;
  try { await nfh({ method: "GET", headers: { "x-real-ip": "7.7.7.7" }, query: { q: "partialq" } }, res); } finally { globalThis.fetch = savedFetch; }
  assert.equal(res.headers["cache-control"], "no-store");
});
