// node --test calendar-server/test/*.mjs  - /api/watch (רשימת מעקב), /api/watch-check (זיהוי אירועים, כפילויות, סוד ה-cron)
import test from "node:test";
import assert from "node:assert/strict";

process.env.TMDB_API_KEY = "k".repeat(32);
delete process.env.BLOB_READ_WRITE_TOKEN;
console.error = () => {};
const { handleWatch, default: watchH, MAX_BODY } = await import("../api/watch.js");
const { cleanWl, MAX_WL, publicWl } = await import("../api/_wl.js");
const { runCheck, checkItem, ilStamp, whenHe, titleMatch, broadcastsOf, MAX_PUSH_USER } = await import("../api/_wcheck.js");
const { default: cronH, cronAuth } = await import("../api/watch-check.js");
const { _resetLimits } = await import("../api/_guard.js");

const TOK = "abcdefghij0123456789abcd", TOK2 = "zyxwvutsrq9876543210zyxw";
const NOW = Date.parse("2026-10-30T17:00:00Z"); // 19:00 בישראל, יום ו׳ (30.10.2026)
function mockRes() {
  const r = { code: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => r;
  return r;
}
const blobStore = () => { const s = {}; return { s, readJson: async (p, d) => (p in s ? JSON.parse(JSON.stringify(s[p])) : d), writeJson: async (p, o) => { s[p] = JSON.parse(JSON.stringify(o)); } }; };
const item = (o = {}) => ({ k: "m603", title: "מטריקס", orig: "The Matrix", on: ["nf"], bn: false, ...o });
test.beforeEach(() => _resetLimits());

// ---------- /api/watch ----------
test("cleanWl: ולידציה, סוג מהמפתח, season רק לסדרות, פריט בלי on נזרק", () => {
  const { items } = cleanWl([
    item(), item({ k: "m603" }), // כפילות
    { k: "t5", title: "סדרה", on: ["season", "tv", "bogus"] },
    { k: "m7", title: "סרט", on: ["season"] },            // season לא חוקי לסרט -> אין on -> נזרק
    { k: "x1", title: "bad", on: ["nf"] }, { k: "m1; DROP", title: "bad", on: ["nf"] }, { k: "m2", title: "", on: ["nf"] }, null, "str",
    { k: "m9", title: "א", on: ["nf"], poster: "https://evil.example/p.jpg" },
    { k: "m10", title: "ב", on: ["nf"], poster: "https://image.tmdb.org/t/p/w342/abc.jpg", type: "tv", st: { fired: { nf: 1 } } },
  ]);
  assert.deepEqual(items.map((x) => x.k), ["m603", "t5", "m9", "m10"]);
  assert.deepEqual(items[1].on, ["season", "tv"]);
  assert.equal(items[2].poster, ""); assert.equal(items[3].poster, "https://image.tmdb.org/t/p/w342/abc.jpg");
  assert.equal(items[3].type, "movie"); assert.equal(items[3].st, undefined); // st מהלקוח לא נכנס
  assert.deepEqual(items[0].st, { nf: false, fired: {} }); // בסיס נטפליקס מ-bn
});

test("cleanWl: תקרה 50 + שימור מצב בדיקה קיים לפי מפתח", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ k: "m" + (i + 1), title: "t" + i, on: ["nf"] }));
  const r = cleanWl(many);
  assert.equal(r.items.length, MAX_WL); assert.equal(r.capped, 10);
  const prev = [{ k: "m1", st: { nf: true, fired: { nf: 5 } } }];
  assert.deepEqual(cleanWl([{ k: "m1", title: "א", on: ["nf"], bn: false }], prev).items[0].st, { nf: true, fired: { nf: 5 } });
  assert.equal(publicWl(prev)[0].st, undefined);
});

test("handleWatch: שמירה וקריאה (בלי st בתשובה), טוקן שגוי 400", async () => {
  const b = blobStore();
  assert.equal((await handleWatch("POST", { t: "bad", items: [] }, b)).status, 400);
  assert.equal((await handleWatch("GET", { t: "bad" }, b)).status, 400);
  const r = await handleWatch("POST", { t: TOK, items: [item()] }, b);
  assert.deepEqual(r.json, { ok: true, n: 1 });
  assert.ok(b.s[`wl/${TOK}.json`].items[0].st, "המצב נשמר בשרת");
  const g = await handleWatch("GET", { t: TOK }, b);
  assert.equal(g.json.items.length, 1); assert.equal(g.json.items[0].st, undefined);
  assert.equal((await handleWatch("GET", { t: TOK2 }, b)).json.items.length, 0); // טוקן אחר לא רואה
});

test("POST /api/watch: 413 על גוף גדול, 400 טוקן, 429 לטוקן (30) ול-IP (60)", async () => {
  const mk = (body, ip = "1.1.1.1") => ({ method: "POST", headers: { "x-real-ip": ip }, body });
  let r = mockRes(); await watchH(mk({ t: TOK, items: [{ k: "m1", title: "x".repeat(MAX_BODY), on: ["nf"] }] }), r); assert.equal(r.code, 413);
  r = mockRes(); await watchH(mk({ t: "x", items: [] }), r); assert.equal(r.code, 400);
  r = mockRes(); await watchH({ method: "PUT", headers: {}, body: {} }, r); assert.equal(r.code, 405);
  r = mockRes(); await watchH({ method: "POST", headers: {}, body: "{bad" }, r); assert.equal(r.code, 400);
  _resetLimits();
  // ללא Blob אמיתי הכתיבה נכשלת (500) אחרי שהקצב נבדק; מספיק לספור 429
  let last;
  for (let i = 0; i < 31; i++) { last = mockRes(); await watchH(mk({ t: TOK, items: [] }, "2.2.2." + i), last); }
  assert.equal(last.code, 429); assert.equal(last.body.error, "rate"); assert.equal(last.headers["retry-after"], "60");
  _resetLimits();
  for (let i = 0; i < 61; i++) { last = mockRes(); await watchH(mk({ t: "t" + String(i).padStart(24, "a"), items: [] }, "3.3.3.3"), last); }
  assert.equal(last.code, 429);
});

// ---------- זיהוי אירועים ----------
const guide = {
  channels: [{ id: "12", name: "קשת 12" }, { id: "13", name: "רשת 13" }],
  programs: [
    { ch: "12", start: "2026-11-05T21:00", title: "מטריקס" },
    { ch: "13", start: "2026-11-05T21:00", title: "מטריקס" },             // אותה שעה בערוץ אחר: מאוחד
    { ch: "13", start: "2026-11-02T22:30", title: "The Matrix: Reloaded" }, // גזע לפני ':' תואם את orig? לא: 'The Matrix' מול 'The Matrix' -> כן
    { ch: "12", start: "2026-12-30T21:00", title: "מטריקס" },                // מעבר ל-7 ימים
    { ch: "12", start: "2026-10-29T21:00", title: "מטריקס" },                // עבר
    { ch: "12", start: "2026-11-03T20:00", title: "מטריקס המהפכה" },         // לא התאמה מלאה
  ],
};
const mkCtx = (o = {}) => ({ nowStamp: ilStamp(NOW), budget: { n: 8 }, prov: async () => ({ nf: false }), detail: async () => ({ number_of_seasons: 4 }), guide: async () => guide, ...o });

test("ilStamp / whenHe: שעון ישראל ותווית יום", () => {
  assert.equal(ilStamp(NOW), "2026-10-30T19:00");
  assert.equal(whenHe("2026-11-05T21:00", "2026-10-30T19:00"), "ביום ה׳ ב-21:00");
  assert.equal(whenHe("2026-11-07T21:00", "2026-10-30T19:00"), "בשבת ב-21:00");
  assert.equal(whenHe("2026-10-30T23:30", "2026-10-30T19:00"), "היום ב-23:30");
});

test("titleMatch / broadcastsOf: שוויון או גזע, חלון 7 ימים, איחוד שעות כפולות", () => {
  assert.ok(titleMatch("מטריקס", item())); assert.ok(titleMatch("The Matrix: Reloaded", item()));
  assert.ok(!titleMatch("מטריקס המהפכה", item())); assert.ok(!titleMatch("x", item({ title: "x", orig: "" }))); // קצר מ-3
  const bs = broadcastsOf(guide, item(), "2026-10-30T19:00");
  assert.deepEqual(bs.map((b) => b.start + "|" + b.ch), ["2026-11-02T22:30|רשת 13", "2026-11-05T21:00|קשת 12"]);
});

test("נטפליקס: בסיס שקט, 'הגיע' פעם אחת בלבד, ואין פוש חוזר", async () => {
  // בלי בסיס מהלקוח: הבדיקה הראשונה רק מתעדת
  let r = await checkItem({ ...item({ on: ["nf"] }), bn: undefined }, mkCtx({ prov: async () => ({ nf: false }) }));
  assert.equal(r.events.length, 0); assert.equal(r.st.nf, false);
  // עדיין לא: שקט
  r = await checkItem({ ...item(), st: r.st }, mkCtx()); assert.equal(r.events.length, 0);
  // הגיע
  r = await checkItem({ ...item(), st: r.st }, mkCtx({ prov: async () => ({ nf: true }) }));
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].title, "🔔 מטריקס הגיע לנטפליקס"); assert.equal(r.events[0].key, "nf");
  assert.equal(r.st.nf, true);
  // ריצה נוספת: אין חזרה
  const r2 = await checkItem({ ...item(), st: r.st }, mkCtx({ prov: async () => ({ nf: true }) }));
  assert.equal(r2.events.length, 0);
  // ירד וחזר: fired.nf מונע התראה נוספת
  const r3 = await checkItem({ ...item(), st: { ...r2.st, nf: false } }, mkCtx({ prov: async () => ({ nf: true }) }));
  assert.equal(r3.events.length, 0);
});

test("עונה חדשה: בסיס שקט, עלייה במספר העונות = פוש יחיד, פרק ראשון בשבוע הקרוב", async () => {
  const it = { k: "t1396", type: "tv", title: "שובר שורות", orig: "Breaking Bad", on: ["season"] };
  let r = await checkItem(it, mkCtx({ detail: async () => ({ number_of_seasons: 4 }) }));
  assert.equal(r.events.length, 0); assert.equal(r.st.s, 4);
  r = await checkItem({ ...it, st: r.st }, mkCtx({ detail: async () => ({ number_of_seasons: 5, next_episode_to_air: { season_number: 5, episode_number: 1, air_date: "2026-11-20" } }) }));
  assert.equal(r.events.length, 1); assert.equal(r.events[0].title, "🆕 עונה 5 של שובר שורות"); assert.equal(r.events[0].body, "מתחילה ב-20.11");
  // אותה עונה שוב: לא נשלח
  const r2 = await checkItem({ ...it, st: r.st }, mkCtx({ detail: async () => ({ number_of_seasons: 5 }) })); assert.equal(r2.events.length, 0);
  // עונה שכבר ידועה אבל הפרק הראשון שלה השבוע (לא הוכרזה בפוש)
  const soon = await checkItem({ ...it, st: { s: 5, fired: {} } }, mkCtx({ detail: async () => ({ number_of_seasons: 5, next_episode_to_air: { season_number: 5, episode_number: 1, air_date: "2026-11-03" } }) }));
  assert.equal(soon.events.length, 1); assert.equal(soon.events[0].key, "s5");
  // פרק 3 לא מפעיל כלום, וסרט לא נבדק בכלל
  const mid = await checkItem({ ...it, st: { s: 5, fired: {} } }, mkCtx({ detail: async () => ({ number_of_seasons: 5, next_episode_to_air: { season_number: 5, episode_number: 3, air_date: "2026-11-03" } }) }));
  assert.equal(mid.events.length, 0);
  const mv = await checkItem(item({ on: ["season"] }), mkCtx({ detail: async () => { throw new Error("should not be called"); } })); assert.equal(mv.events.length, 0);
});

test("משודר בערוץ: פוש אחד על הקרוב ביותר, השאר נרשמים; ריצה חוזרת שקטה; שידור חדש מתריע", async () => {
  const it = item({ on: ["tv"] });
  let r = await checkItem(it, mkCtx());
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].title, "📺 מטריקס"); assert.equal(r.events[0].body, "משודר ביום ב׳ ב-22:30 ברשת 13");
  assert.ok(r.st.fired["b:2026-11-02T22:30"] && r.st.fired["b:2026-11-05T21:00"], "כל שידורי השבוע נרשמו");
  const r2 = await checkItem({ ...it, st: r.st }, mkCtx()); assert.equal(r2.events.length, 0);
  const g2 = { ...guide, programs: guide.programs.concat([{ ch: "12", start: "2026-11-06T18:30", title: "מטריקס" }]) };
  const r3 = await checkItem({ ...it, st: r.st }, mkCtx({ guide: async () => g2 }));
  assert.equal(r3.events.length, 1); assert.match(r3.events[0].body, /ביום ו׳ ב-18:30 בקשת 12/);
  // שידור שעבר נמחק מהרשומה
  const r4 = await checkItem({ ...it, st: { fired: { "b:2026-10-01T20:00": 1 } } }, mkCtx({ guide: async () => ({ channels: [], programs: [] }) }));
  assert.equal(r4.st.fired["b:2026-10-01T20:00"], undefined);
  // אין לוח (נפל): אין אירוע ואין שינוי
  const r5 = await checkItem(it, mkCtx({ guide: async () => null })); assert.equal(r5.events.length, 0);
});

test("תקציב פוש למשתמש", async () => {
  const its = Array.from({ length: 12 }, (_, i) => ({ k: "m" + (100 + i), title: "סרט" + i, type: "movie", on: ["nf"], st: { nf: false, fired: {} } }));
  const ctx = mkCtx({ prov: async () => ({ nf: true }) });
  let n = 0; for (const it of its) n += (await checkItem(it, ctx)).events.length;
  assert.equal(n, MAX_PUSH_USER);
});

// ---------- runCheck ----------
function world(over = {}) {
  const b = blobStore(), sent = [], tmdbCalls = [];
  b.s[`wl/${TOK}.json`] = { items: [{ ...cleanWl([item({ on: ["nf", "tv"] })]).items[0] }, ...cleanWl([{ k: "t1396", title: "שובר שורות", on: ["season"] }]).items] };
  const fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://eladweiss-ops.github.io/tv-guide/guide.json")) return { ok: true, json: async () => guide };
    tmdbCalls.push(new URL(u).pathname);
    if (/watch\/providers/.test(u)) return { ok: true, json: async () => ({ results: { IL: { flatrate: over.nf ? [{ provider_id: 8 }] : [] } } }) };
    if (/\/tv\//.test(u)) return { ok: true, json: async () => ({ number_of_seasons: over.seasons || 4 }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { b, sent, tmdbCalls, d: { now: () => NOW, fetch, key: "k".repeat(32), listTokens: async () => [TOK, TOK2], readJson: b.readJson, writeJson: b.writeJson, getSubs: async (t) => (t === TOK ? [{ endpoint: "e" }] : []), sendTo: async (t, p) => { sent.push({ t, p }); return { ok: 1, total: 1 }; } } };
}

test("runCheck: ריצה ראשונה שולחת רק שידור; נטפליקס+עונה רק כשמשהו משתנה; כתיבת מצב; דילוג על משתמש בלי מנוי", async () => {
  const w = world();
  let out = await runCheck(w.d);
  assert.equal(out.users, 1); assert.equal(out.skipped, 0); assert.equal(out.sent, 1);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].p.title, "📺 מטריקס"); assert.equal(w.sent[0].p.url, "./?nf=m603"); assert.equal(w.sent[0].p.tag, "wl-m603-b:2026-11-02T22:30");
  const st = w.b.s[`wl/${TOK}.json`].items;
  assert.equal(st[0].st.nf, false); assert.equal(st[1].st.s, 4);
  // ריצה שנייה: כלום
  out = await runCheck(w.d); assert.equal(out.sent, 0); assert.equal(w.sent.length, 1);
  // הגיע לנטפליקס ועונה חדשה: שני פושים בדיוק
  const w2 = { ...w, d: { ...w.d, fetch: world({ nf: true, seasons: 5 }).d.fetch } };
  out = await runCheck(w2.d);
  assert.deepEqual(w.sent.slice(1).map((x) => x.p.title), ["🔔 מטריקס הגיע לנטפליקס", "🆕 עונה 5 של שובר שורות"]);
  out = await runCheck(w2.d); assert.equal(w.sent.length, 3, "אין פוש כפול");
});

test("runCheck: TMDB נופל = אין פוש ואין התקדמות; משתמש בלי רשימה נדלג; שינוי רשימה בזמן הריצה נשמר", async () => {
  const w = world();
  const bad = async (u) => (String(u).includes("guide.json") ? { ok: true, json: async () => ({ channels: [], programs: [] }) } : { ok: false, status: 500, json: async () => ({}) });
  const out = await runCheck({ ...w.d, fetch: bad });
  assert.equal(out.sent, 0);
  assert.equal(w.b.s[`wl/${TOK}.json`].items[0].st.nf, false); // הבסיס מ-bn נשמר
  // המשתמש הוסיף פריט בזמן שהבדיקה רצה: לא נמחק
  const w2 = world();
  const orig = w2.d.sendTo;
  w2.d.sendTo = async (t, p) => { const cur = w2.b.s[`wl/${t}.json`]; cur.items.push({ k: "m77", title: "חדש", type: "movie", on: ["nf"], at: 1 }); return orig(t, p); };
  await runCheck(w2.d);
  assert.ok(w2.b.s[`wl/${TOK}.json`].items.some((x) => x.k === "m77"));
});

test("runCheck: קריאות TMDB מאוחדות בין פריטים/משתמשים (מטמון לריצה)", async () => {
  const w = world();
  w.b.s[`wl/${TOK2}.json`] = { items: cleanWl([item({ on: ["nf"] })]).items };
  w.d.getSubs = async () => [{ endpoint: "e" }];
  await runCheck(w.d);
  assert.equal(w.tmdbCalls.filter((p) => p === "/3/movie/603/watch/providers").length, 1);
});

// ---------- סוד ה-cron ----------
test("watch-check: בלי CRON_SECRET 503, סוד שגוי/חסר 401, נכון 200; GET בלבד", async () => {
  const saved = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
  const w = world();
  const call = async (headers, method = "GET") => { const r = mockRes(); await cronH({ method, headers }, r, w.d); return r; };
  assert.equal((await call({})).code, 503);
  process.env.CRON_SECRET = "s3cret-value";
  assert.equal((await call({})).code, 401);
  assert.equal((await call({ authorization: "Bearer wrong" })).code, 401);
  assert.equal((await call({ authorization: "s3cret-value" })).code, 401);
  assert.equal(w.sent.length, 0, "בלי הרשאה לא רץ כלום");
  const ok = await call({ authorization: "Bearer s3cret-value" });
  assert.equal(ok.code, 200); assert.equal(ok.body.users, 1);
  assert.equal((await call({ authorization: "Bearer s3cret-value" }, "POST")).code, 405);
  assert.equal(cronAuth({ headers: {} }, ""), 503);
  if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
});

test("vercel.json: cron יומי על /api/watch-check", async () => {
  const { readFileSync } = await import("node:fs");
  const v = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(v.crons, [{ path: "/api/watch-check", schedule: "0 6 * * *" }]);
});

// ---------- אחסון אמיתי (_db.js) מול Firestore מדומה: נתיבים חוקיים, מיפוי מזהים, listTokens ----------
test("אחסון Firestore: watch/nf-search כותבים דרך _db.js, listTokens מוצא את המשתמשים", async () => {
  const { fakeFirestoreClient } = await import("./helpers/fakedb.mjs");
  const { _setBackend, firestoreBackend } = await import("../api/_db.js");
  const cl = fakeFirestoreClient(); _setBackend(firestoreBackend(cl));
  try {
    const r = await handleWatch("POST", { t: TOK, items: [item()] });
    assert.deepEqual(r.json, { ok: true, n: 1 });
    assert.ok(cl.data.has(`wl/${TOK}`), "wl/<t> ב-Firestore");
    assert.equal((await handleWatch("GET", { t: TOK })).json.items[0].k, "m603");
    await handleWatch("POST", { t: TOK2, items: [item({ k: "m7" })] });
    const { listTokens } = await import("../api/watch-check.js");
    assert.deepEqual((await listTokens()).sort(), [TOK, TOK2].sort());
    const { handleSearch, _clearCache } = await import("../api/nf-search.js");
    _clearCache();
    const fx = async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) });
    const s = await handleSearch("matrix", { fetch: fx });
    assert.equal(s.status, 200);
    assert.ok([...cl.data.keys()].some((k) => k.startsWith("cache/nf__")), "מטמון החיפוש נכתב");
    _clearCache();
    assert.equal((await handleSearch("matrix", { fetch: fx })).cache, "db");
  } finally { _setBackend(null); }
});
