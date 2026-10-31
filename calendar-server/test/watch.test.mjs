// node --test calendar-server/test/*.mjs  - /api/watch (רשימת מעקב), /api/watch-check (זיהוי אירועים, כפילויות, זמן, סוד ה-cron)
import test from "node:test";
import assert from "node:assert/strict";

process.env.TMDB_API_KEY = "k".repeat(32);
console.error = () => {};
const { handleWatch, default: watchH, MAX_BODY } = await import("../api/watch.js");
const { cleanWl, MAX_WL, publicWl } = await import("../api/_wl.js");
const { runCheck, checkItem, ilStamp, whenHe, titleMatch, broadcastsOf, MAX_PUSH_USER, TV_COOLDOWN_MS } = await import("../api/_wcheck.js");
const { default: cronH, cronAuth, cleanNfCache, listUsers } = await import("../api/watch-check.js");
const { _resetLimits } = await import("../api/_guard.js");

const TOK = "abcdefghij0123456789abcd", TOK2 = "zyxwvutsrq9876543210zyxw", TOK3 = "mnopqrstuv0123456789mnop";
const NOW = Date.parse("2026-10-30T17:00:00Z"); // 19:00 בישראל, יום ו׳ (30.10.2026)
function mockRes() {
  const r = { code: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => r;
  return r;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const store = () => { const s = {}; return { s, readJson: async (p, d) => (p in s ? clone(s[p]) : d), writeJson: async (p, o) => { s[p] = clone(o); }, delJson: async (p) => { delete s[p]; }, getSubs: async () => [{ endpoint: "e" }] }; };
const item = (o = {}) => ({ k: "m603", title: "מטריקס", orig: "The Matrix", on: ["nf"], bn: false, bc: 1, ...o });
test.beforeEach(() => _resetLimits());

// ---------- /api/watch ----------
test("cleanWl: ולידציה, סוג מהמפתח, season רק לסדרות, קישור ושנה, פריט בלי on נזרק", () => {
  const { items } = cleanWl([
    item(), item({ k: "m603" }), // כפילות
    { k: "t5", title: "סדרה", on: ["season", "tv", "bogus"] },
    { k: "m7", title: "סרט", on: ["season"] },            // season לא חוקי לסרט -> אין on -> נזרק
    { k: "x1", title: "bad", on: ["nf"] }, { k: "m1; DROP", title: "bad", on: ["nf"] }, { k: "m2", title: "", on: ["nf"] }, null, "str",
    { k: "m9", title: "א", on: ["nf"], poster: "https://evil.example/p.jpg", link: "https://evil.example/x", y: 3000 },
    { k: "m10", title: "ב", on: ["nf"], poster: "https://image.tmdb.org/t/p/w342/abc.jpg", link: "https://www.netflix.com/search?q=b", y: 1999, type: "tv", st: { fired: { nf: 1 } } },
  ]);
  assert.deepEqual(items.map((x) => x.k), ["m603", "t5", "m9", "m10"]);
  assert.deepEqual(items[1].on, ["season", "tv"]);
  assert.equal(items[2].poster, ""); assert.equal(items[2].link, ""); assert.equal(items[2].y, 0);
  assert.equal(items[3].poster, "https://image.tmdb.org/t/p/w342/abc.jpg"); assert.equal(items[3].link, "https://www.netflix.com/search?q=b"); assert.equal(items[3].y, 1999);
  assert.equal(items[3].type, "movie"); assert.equal(items[3].st, undefined); // st מהלקוח לא נכנס
  assert.deepEqual(items[0].st, { nf: false, fired: {} }); // בסיס "לא בנטפליקס" רק עם bn=false ו-bc=1 (תשובה שלמה)
});

test("בסיס נטפליקס: רק מתשובה שלמה. בלי bc, או bn=true, אין בסיס והוא נקבע בבדיקה הראשונה", () => {
  const { items } = cleanWl([item({ bc: undefined }), item({ k: "m2", bn: true }), item({ k: "m3", bn: undefined }), item({ k: "m4" })]);
  assert.equal(items[0].st, undefined); assert.equal(items[1].st, undefined); assert.equal(items[2].st, undefined);
  assert.deepEqual(items[3].st, { nf: false, fired: {} });
});

test("cleanWl: תקרה 50 + שימור מצב בדיקה קיים לפי מפתח", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ k: "m" + (i + 1), title: "t" + i, on: ["nf"] }));
  const r = cleanWl(many);
  assert.equal(r.items.length, MAX_WL); assert.equal(r.capped, 10);
  const prev = [{ k: "m1", st: { nf: true, fired: { nf: 5 } } }];
  assert.deepEqual(cleanWl([{ k: "m1", title: "א", on: ["nf"], bn: false, bc: 1 }], prev).items[0].st, { nf: true, fired: { nf: 5 } });
  assert.equal(publicWl(prev)[0].st, undefined);
});

test("handleWatch: שמירה וקריאה (בלי st בתשובה), טוקן שגוי 400", async () => {
  const b = store();
  assert.equal((await handleWatch("POST", { t: "bad", items: [] }, b)).status, 400);
  assert.equal((await handleWatch("GET", { t: "bad" }, b)).status, 400);
  const r = await handleWatch("POST", { t: TOK, items: [item()] }, b);
  assert.deepEqual(r.json, { ok: true, n: 1 });
  assert.ok(b.s[`wl/${TOK}.json`].items[0].st, "המצב נשמר בשרת");
  const g = await handleWatch("GET", { t: TOK }, b);
  assert.equal(g.json.items.length, 1); assert.equal(g.json.items[0].st, undefined);
  assert.equal((await handleWatch("GET", { t: TOK2 }, b)).json.items.length, 0); // טוקן אחר לא רואה
});

test("B: POST רק למי שיש לו מנוי פוש (403 אחרת); רשימה ריקה מוחקת את המסמך", async () => {
  const b = store();
  const nop = { ...b, getSubs: async () => [] };
  const r0 = await handleWatch("POST", { t: TOK, items: [item()] }, nop);
  assert.equal(r0.status, 403); assert.equal(r0.json.error, "no push"); assert.deepEqual(b.s, {}, "לא נכתב דבר");
  await handleWatch("POST", { t: TOK, items: [item()] }, b); assert.ok(b.s[`wl/${TOK}.json`]);
  const r1 = await handleWatch("POST", { t: TOK, items: [] }, b);
  assert.deepEqual(r1.json, { ok: true, n: 0 }); assert.equal(`wl/${TOK}.json` in b.s, false, "המסמך נמחק");
  await handleWatch("POST", { t: TOK2, items: [] }, b); assert.deepEqual(b.s, {}, "רשימה ריקה למי שאין לו מסמך: אין כתיבה");
});

test("POST /api/watch: 413 על גוף גדול, 400 טוקן, 429 לטוקן (30) ול-IP (60)", async () => {
  const mk = (body, ip = "1.1.1.1") => ({ method: "POST", headers: { "x-real-ip": ip }, body });
  let r = mockRes(); await watchH(mk({ t: TOK, items: [{ k: "m1", title: "x".repeat(MAX_BODY), on: ["nf"] }] }), r); assert.equal(r.code, 413);
  r = mockRes(); await watchH(mk({ t: "x", items: [] }), r); assert.equal(r.code, 400);
  r = mockRes(); await watchH({ method: "PUT", headers: {}, body: {} }, r); assert.equal(r.code, 405);
  r = mockRes(); await watchH({ method: "POST", headers: {}, body: "{bad" }, r); assert.equal(r.code, 400);
  _resetLimits();
  let last;
  for (let i = 0; i < 31; i++) { last = mockRes(); await watchH(mk({ t: TOK, items: [] }, "2.2.2." + i), last); }
  assert.equal(last.code, 429); assert.equal(last.body.error, "rate"); assert.equal(last.headers["retry-after"], "60");
  _resetLimits();
  for (let i = 0; i < 61; i++) { last = mockRes(); await watchH(mk({ t: "t" + String(i).padStart(24, "a"), items: [] }, "3.3.3.3"), last); }
  assert.equal(last.code, 429);
});

// ---------- זיהוי אירועים ----------
const guide = {
  channels: [{ id: "12", name: "קשת 12" }, { id: "13", name: "רשת 13" }, { id: "9", name: "HOT" }],
  programs: [
    { ch: "12", start: "2026-11-05T21:00", title: "מטריקס" },
    { ch: "13", start: "2026-11-05T21:00", title: "מטריקס" },             // אותה שעה בערוץ אחר: מאוחד
    { ch: "13", start: "2026-11-02T22:30", title: "The Matrix: Reloaded" }, // גזע: תואם רק לסדרה
    { ch: "12", start: "2026-12-30T21:00", title: "מטריקס" },                // מעבר ל-7 ימים
    { ch: "12", start: "2026-10-29T21:00", title: "מטריקס" },                // עבר
    { ch: "12", start: "2026-11-03T20:00", title: "מטריקס המהפכה" },         // לא התאמה מלאה
  ],
};
const mkCtx = (o = {}) => ({ nowStamp: ilStamp(NOW), now: NOW, budget: { n: 8 }, prov: async () => ({ nf: false }), detail: async () => ({ seasons: [] }), guide: async () => guide, ...o });

test("ilStamp / whenHe: שעון ישראל, תווית יום, מקף עברי לפני השעה", () => {
  assert.equal(ilStamp(NOW), "2026-10-30T19:00");
  assert.equal(whenHe("2026-11-05T21:00", "2026-10-30T19:00"), "ביום ה׳ ב־21:00");
  assert.equal(whenHe("2026-11-07T21:00", "2026-10-30T19:00"), "בשבת ב־21:00");
  assert.equal(whenHe("2026-10-30T23:30", "2026-10-30T19:00"), "היום ב־23:30");
});

test("E: סרט = שוויון מלא בלבד; סדרה = גם גזע; שנה בלוח חייבת להתאים", () => {
  const movie = { type: "movie", title: "מועדון קרב", orig: "Fight Club", y: 1999 }, show = { ...movie, type: "tv" };
  assert.ok(titleMatch("מועדון קרב", movie));
  assert.ok(!titleMatch("מועדון קרב: לחברים בלבד", movie), "רגרסיה: סרט לא תואם כותרת ארוכה יותר");
  assert.ok(!titleMatch("Fight Club (2022)", movie)); assert.ok(titleMatch("Fight Club", movie));
  assert.ok(titleMatch("מועדון קרב: לחברים בלבד", show), "סדרה: גזע תואם");
  assert.ok(titleMatch("מועדון קרב - פרק 4", show));
  assert.ok(!titleMatch("מועדון קרב המהפכה", show));
  assert.ok(titleMatch("מועדון קרב", movie, { year: 1999 }) && titleMatch("מועדון קרב", movie, { year: 2000 }));
  assert.ok(!titleMatch("מועדון קרב", movie, { year: 2014 }), "שנה שונה = לא אותו סרט");
  assert.ok(titleMatch("מועדון קרב", movie, {}) && titleMatch("מועדון קרב", { ...movie, y: 0 }, { year: 2014 }), "בלי שנה באחד הצדדים: לא בודקים");
  assert.ok(!titleMatch("x", { type: "movie", title: "x", orig: "" })); // קצר מ-3
});

test("broadcastsOf: חלון 7 ימים, איחוד שעות כפולות; סרט לא תופס 'גזע'", () => {
  const show = { type: "tv", title: "מטריקס", orig: "The Matrix", on: ["tv"] }, movie = { ...show, type: "movie" };
  assert.deepEqual(broadcastsOf(guide, show, "2026-10-30T19:00").map((b) => b.start + "|" + b.ch), ["2026-11-02T22:30|רשת 13", "2026-11-05T21:00|קשת 12"]);
  assert.deepEqual(broadcastsOf(guide, movie, "2026-10-30T19:00").map((b) => b.start + "|" + b.ch), ["2026-11-05T21:00|קשת 12"]);
});

test("נטפליקס: בסיס שקט, 'הגיע' פעם אחת בלבד, ואין פוש חוזר", async () => {
  let r = await checkItem({ ...item({ on: ["nf"] }), bn: undefined, bc: undefined }, mkCtx({ prov: async () => ({ nf: false }) }));
  assert.equal(r.events.length, 0); assert.equal(r.st.nf, false);
  r = await checkItem({ ...item(), st: r.st }, mkCtx()); assert.equal(r.events.length, 0);
  r = await checkItem({ ...item(), st: r.st }, mkCtx({ prov: async () => ({ nf: true }) }));
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].title, "🔔 מטריקס הגיע לנטפליקס"); assert.equal(r.events[0].key, "nf");
  assert.equal(r.st.nf, true);
  const r2 = await checkItem({ ...item(), st: r.st }, mkCtx({ prov: async () => ({ nf: true }) }));
  assert.equal(r2.events.length, 0);
  const r3 = await checkItem({ ...item(), st: { ...r2.st, nf: false } }, mkCtx({ prov: async () => ({ nf: true }) }));
  assert.equal(r3.events.length, 0);
  // undo מחזיר את המצב לפני האירוע (פוש שנכשל לא נחשב כשוגר)
  const r4 = await checkItem({ ...item(), st: { nf: false, fired: {} } }, mkCtx({ prov: async () => ({ nf: true }) }));
  r4.events[0].undo(r4.st); assert.equal(r4.st.nf, false); assert.equal(r4.st.fired.nf, undefined);
});

test("F: עונה חדשה לפי air_date של העונה (עד היום+7), לא לפי עלייה במספר העונות", async () => {
  const it = { k: "t1396", type: "tv", title: "שובר שורות", orig: "Breaking Bad", on: ["season"] };
  const seasons = (list) => async () => ({ number_of_seasons: list.length, seasons: list.map((d, i) => ({ season_number: i + 1, air_date: d })) });
  // בסיס: עונה אחרונה ששודרה
  let r = await checkItem(it, mkCtx({ detail: seasons(["2008-01-20", "2009-03-08", "2010-03-21", "2011-07-17"]) }));
  assert.equal(r.events.length, 0); assert.equal(r.st.s, 4);
  // עונה 5 נוספה ל-TMDB עם תאריך רחוק: אין התראה (המספר עלה, אבל התאריך רחוק)
  r = await checkItem({ ...it, st: r.st }, mkCtx({ detail: seasons(["2008-01-20", "2009-03-08", "2010-03-21", "2011-07-17", "2027-03-01"]) }));
  assert.equal(r.events.length, 0, "תאריך רחוק, אין פוש");
  // התאריך מתקרב (עד שבוע): פוש אחד
  r = await checkItem({ ...it, st: r.st }, mkCtx({ detail: seasons(["2008-01-20", "2009-03-08", "2010-03-21", "2011-07-17", "2026-11-04"]) }));
  assert.equal(r.events.length, 1); assert.equal(r.events[0].title, "🆕 עונה 5 של שובר שורות"); assert.equal(r.events[0].body, "מתחילה ב־04.11");
  // לא חוזר, גם אחרי ששודרה
  const again = await checkItem({ ...it, st: r.st }, mkCtx({ detail: seasons(["2008-01-20", "2009-03-08", "2010-03-21", "2011-07-17", "2026-11-04"]), nowStamp: "2026-11-06T10:00" }));
  assert.equal(again.events.length, 0); assert.equal(again.st.s, 5);
  // סרט לא נבדק בכלל
  const mv = await checkItem(item({ on: ["season"] }), mkCtx({ detail: async () => { throw new Error("no"); } })); assert.equal(mv.events.length, 0);
  // undo
  const f = await checkItem({ ...it, st: { s: 4, fired: {} } }, mkCtx({ detail: seasons(["2008-01-20", "2009-03-08", "2010-03-21", "2011-07-17", "2026-11-04"]) }));
  f.events[0].undo(f.st); assert.equal(f.st.s, 4); assert.equal(f.st.fired.s5, undefined);
});

test("D: משודר בערוץ: פוש אחד לשבוע על השידור הקרוב ביותר, בלי 'בHOT'", async () => {
  const it = { k: "t603", type: "tv", title: "מטריקס", orig: "The Matrix", on: ["tv"] };
  let r = await checkItem(it, mkCtx());
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].title, "📺 מטריקס"); assert.equal(r.events[0].body, "משודר ביום ב׳ ב־22:30 ב־רשת 13"); // הקרוב ביותר
  assert.ok(r.st.fired.tvAt);
  const r2 = await checkItem({ ...it, st: r.st }, mkCtx({ now: NOW + 86400000 })); assert.equal(r2.events.length, 0, "בתוך 7 ימים: שקט");
  const g2 = { channels: guide.channels, programs: [{ ch: "9", start: "2026-11-09T21:00", title: "מטריקס" }] };
  const r3 = await checkItem({ ...it, st: r.st }, mkCtx({ now: NOW + TV_COOLDOWN_MS + 1, nowStamp: "2026-11-06T19:00", guide: async () => g2 }));
  assert.equal(r3.events.length, 1); assert.equal(r3.events[0].body, "משודר ביום ב׳ ב־21:00 ב־HOT"); assert.ok(!/בHOT/.test(r3.events[0].body));
  // אין לוח (נפל): אין אירוע
  const r5 = await checkItem(it, mkCtx({ guide: async () => null })); assert.equal(r5.events.length, 0);
  // undo: משחזר את tvAt הקודם
  r3.events[0].undo(r3.st); assert.equal(r3.st.fired.tvAt, r.st.fired.tvAt);
});

test("תקציב פוש למשתמש", async () => {
  const its = Array.from({ length: 12 }, (_, i) => ({ k: "m" + (100 + i), title: "סרט" + i, type: "movie", on: ["nf"], st: { nf: false, fired: {} } }));
  const ctx = mkCtx({ prov: async () => ({ nf: true }) });
  let n = 0; for (const it of its) n += (await checkItem(it, ctx)).events.length;
  assert.equal(n, MAX_PUSH_USER);
});

// ---------- runCheck ----------
function world(over = {}) {
  const b = store(), sent = [], tmdbCalls = [];
  b.s[`wl/${TOK}.json`] = { items: [{ ...cleanWl([item({ on: ["nf", "tv"], type: "tv", k: "t603" })]).items[0] }, ...cleanWl([{ k: "t1396", title: "שובר שורות", on: ["season"] }]).items] };
  const fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://eladweiss-ops.github.io/tv-guide/guide.json")) return { ok: true, json: async () => guide };
    tmdbCalls.push(new URL(u).pathname);
    if (/watch\/providers/.test(u)) return { ok: true, json: async () => ({ results: { IL: { flatrate: over.nf ? [{ provider_id: 8 }] : [] } } }) };
    if (/\/tv\//.test(u)) return { ok: true, json: async () => ({ seasons: [{ season_number: 4, air_date: "2011-07-17" }].concat(over.s5 ? [{ season_number: 5, air_date: "2026-11-03" }] : []) }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const d = { now: () => NOW, fetch, key: "k".repeat(32), listUsers: async () => Object.keys(b.s).filter((p) => p.startsWith("wl/")).map((p) => ({ t: p.slice(3, -5), wl: clone(b.s[p]) })),
    readJson: b.readJson, writeJson: b.writeJson, getSubs: async (t) => (t === TOK || over.allSubs ? [{ endpoint: "e" }] : []), sendTo: async (t, p) => { sent.push({ t, p }); return { ok: 1, total: 1 }; } };
  return { b, sent, tmdbCalls, d };
}

test("runCheck: ריצה ראשונה שולחת רק שידור; נטפליקס+עונה רק כשמשהו משתנה; מצב נכתב; דילוג על משתמש בלי מנוי", async () => {
  const w = world();
  let out = await runCheck(w.d);
  assert.equal(out.users, 1); assert.equal(out.sent, 1); assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].p.title, "📺 מטריקס"); assert.equal(w.sent[0].p.url, "./?nf=t603&e=tv"); assert.equal(w.sent[0].p.tag, "wl-t603-tvAt");
  const st = w.b.s[`wl/${TOK}.json`].items;
  assert.equal(st[0].st.nf, false); assert.equal(st[1].st.s, 4);
  out = await runCheck(w.d); assert.equal(out.sent, 0);
  const w2 = { ...w, d: { ...w.d, fetch: world({ nf: true, s5: true }).d.fetch } };
  out = await runCheck(w2.d);
  assert.deepEqual(w.sent.slice(1).map((x) => x.p.title), ["🔔 מטריקס הגיע לנטפליקס", "🆕 עונה 5 של שובר שורות"]);
  assert.deepEqual(w.sent.slice(1).map((x) => x.p.url), ["./?nf=t603&e=nf", "./?nf=t1396&e=season"]);
  out = await runCheck(w2.d); assert.equal(w.sent.length, 3, "אין פוש כפול");
});

test("A: פוש שנכשל (ok:0 או חריגה) לא נרשם כשוגר ויישלח שוב; הצלחה נכתבת מיד", async () => {
  const w = world();
  await runCheck(w.d); // בסיס + שידור
  const w2 = { ...w, d: { ...w.d, fetch: world({ nf: true }).d.fetch } };
  let mode = "zero"; const log = [];
  w2.d.sendTo = async (t, p) => { log.push(p.title); if (mode === "zero") return { ok: 0, total: 1 }; if (mode === "throw") throw new Error("push down"); return { ok: 1, total: 1 }; };
  let out = await runCheck(w2.d); assert.equal(out.failed, 1); assert.equal(out.sent, 0);
  assert.equal(w.b.s[`wl/${TOK}.json`].items[0].st.nf, false, "הבסיס לא התקדם");
  assert.equal(w.b.s[`wl/${TOK}.json`].items[0].st.fired.nf, undefined);
  mode = "throw"; out = await runCheck(w2.d); assert.equal(out.failed, 1);
  mode = "ok"; out = await runCheck(w2.d); assert.equal(out.sent, 1); assert.equal(w.b.s[`wl/${TOK}.json`].items[0].st.nf, true);
  mode = "ok"; out = await runCheck(w2.d); assert.equal(out.sent, 0);
});

test("A: ההתקדמות נכתבת אחרי כל פוש, גם אם הריצה נקטעת באמצע", async () => {
  const w = world({ nf: true });
  w.b.s[`wl/${TOK}.json`].items = [0, 1, 2].map((i) => cleanWl([item({ k: "m" + (200 + i), on: ["nf"] })]).items[0]);
  const writes = [];
  const wj = w.b.writeJson; w.d.writeJson = async (p, o) => { writes.push(o.items.filter((x) => x.st && x.st.fired && x.st.fired.nf).length); return wj(p, o); };
  let calls = 0; w.d.sendTo = async () => { calls++; if (calls === 2) throw new Error("boom"); return { ok: 1, total: 1 }; };
  const out = await runCheck(w.d);
  assert.equal(out.sent, 2); assert.equal(out.failed, 1);
  assert.deepEqual(writes, [1, 2], "כתיבה מיד אחרי כל פריט שהשתנה; הכישלון לא משנה ולא נכתב");
});

test("A: דד-ליין נבדק גם בתוך לולאת הפריטים (מרווח 10 שניות), והמשתמשים מסתובבים יום-יום", async () => {
  const w = world({ allSubs: true });
  w.b.s[`wl/${TOK2}.json`] = { items: cleanWl([item({ k: "m7" })]).items }; w.b.s[`wl/${TOK3}.json`] = { items: cleanWl([item({ k: "m8" })]).items };
  w.b.s[`wl/${TOK}.json`].items = Array.from({ length: 5 }, (_, i) => cleanWl([item({ k: "m" + (300 + i) })]).items[0]);
  // מרווח: deadline = עכשיו+5 שניות, והמרווח 10 שניות -> כבר מאוחר, שום דבר לא רץ
  let out = await runCheck({ ...w.d, deadline: Date.now() + 5000 }); assert.equal(out.partial, true); assert.equal(out.items, 0);
  // דד-ליין שנגמר באמצע: אחרי 2 פריטים
  let n = 0; const real = Date.now; let out2;
  const d2 = { ...w.d, deadline: real() + 3600000 };
  const prov = d2.fetch; d2.fetch = async (u) => { if (/watch\/providers/.test(String(u))) { n++; if (n === 2) d2.deadline = real() + 1000; } return prov(u); };
  out2 = await runCheck(d2); assert.equal(out2.partial, true); assert.ok(out2.items < 8, "נעצר לפני הסוף: " + out2.items);
  // סיבוב: ההתחלה זזה כל יום
  const order = []; const dd = { ...world({ allSubs: true }).d };
  const b3 = store(); [TOK, TOK2, TOK3].forEach((t, i) => { b3.s[`wl/${t}.json`] = { items: cleanWl([item({ k: "m" + (400 + i) })]).items }; });
  const mk = (day) => ({ ...dd, now: () => NOW + day * 86400000, readJson: b3.readJson, writeJson: b3.writeJson, listUsers: async () => [TOK, TOK2, TOK3].map((t) => ({ t, wl: clone(b3.s[`wl/${t}.json`]) })), getSubs: async (t) => { order.push(t); return [{ endpoint: "e" }]; }, sendTo: async () => ({ ok: 1 }) });
  const firsts = []; for (let day = 0; day < 3; day++) { order.length = 0; await runCheck(mk(day)); firsts.push(order[0]); }
  assert.equal(new Set(firsts).size, 3, "נקודת התחלה שונה בכל יום: " + firsts);
});

test("runCheck: TMDB נופל = אין פוש ואין התקדמות; שינוי רשימה בזמן הריצה נשמר", async () => {
  const w = world();
  const bad = async (u) => (String(u).includes("guide.json") ? { ok: true, json: async () => ({ channels: [], programs: [] }) } : { ok: false, status: 500, json: async () => ({}) });
  const out = await runCheck({ ...w.d, fetch: bad });
  assert.equal(out.sent, 0);
  assert.equal(w.b.s[`wl/${TOK}.json`].items[0].st.nf, false); // הבסיס מ-bn+bc נשמר
  const w2 = world(); const orig = w2.d.sendTo;
  w2.d.sendTo = async (t, p) => { const cur = w2.b.s[`wl/${t}.json`]; cur.items.push({ k: "m77", title: "חדש", type: "movie", on: ["nf"], at: 1 }); return orig(t, p); };
  await runCheck(w2.d);
  assert.ok(w2.b.s[`wl/${TOK}.json`].items.some((x) => x.k === "m77"));
});

test("B: runCheck לא קורא שוב את מסמכי המשתמשים (הערכים מגיעים מ-listUsers); קריאות TMDB מאוחדות", async () => {
  const w = world({ allSubs: true });
  w.b.s[`wl/${TOK2}.json`] = { items: cleanWl([item({ k: "t603", type: "tv", on: ["nf"] })]).items };
  let reads = 0; const rj = w.d.readJson; w.d.readJson = async (p, d) => { reads++; return rj(p, d); };
  await runCheck(w.d);
  assert.equal(w.tmdbCalls.filter((p) => p === "/3/tv/603/watch/providers").length, 1);
  assert.ok(reads <= 3, "קריאות רק למיזוג לפני כתיבה: " + reads);
  const none = world({ allSubs: true }); let r2 = 0; const rj2 = none.d.readJson; none.d.readJson = async (p, d) => { r2++; return rj2(p, d); };
  await runCheck({ ...none.d, fetch: world({}).d.fetch }); await runCheck(none.d);
  assert.ok(r2 <= 2, "ריצה שאין בה שינוי לא קוראת: " + r2);
});

test("B: cleanNfCache מוחק רק מטמון חיפוש מעל 12 שעות (עד התקרה)", async () => {
  const H = 3600000, rows = [
    { id: "nf__" + "a".repeat(32), value: { t: NOW - 13 * H } }, { id: "nf__" + "b".repeat(32), value: { t: NOW - 1 * H } },
    { id: "nf__" + "c".repeat(32), value: null }, { id: "other__x", value: { t: 1 } }, { id: "nf__" + "d".repeat(32), value: { t: NOW - 20 * H } },
  ];
  const del = []; const n = await cleanNfCache(NOW, async () => rows, async (p) => { del.push(p); });
  assert.equal(n, 3); assert.deepEqual(del.sort(), ["a", "c", "d"].map((c) => `cache/nf/${c.repeat(32)}.json`).sort());
  del.length = 0; assert.equal(await cleanNfCache(NOW, async () => rows, async (p) => { del.push(p); }, 1), 1);
});

test("listUsers: מחזיר טוקן וערך מ-listJson בלי קריאה נוספת, ומסנן מזהים לא תקינים", async () => {
  const us = await listUsers(async () => [{ id: TOK, value: { items: [1] } }, { id: "bad id", value: {} }]);
  assert.deepEqual(us, [{ t: TOK, wl: { items: [1] } }]);
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

test("remPayload: תזכורת צפייה בנטפליקס = 'הגיע הזמן לצפות', לא 'מתחיל עכשיו'", async () => {
  process.env.FIRE_SECRET = "test-secret-not-real";
  const { remPayload } = await import("../api/_snz.js");
  const p = remPayload({ k: "nf|m603|123", title: "מטריקס", ch: "נטפליקס", ts: NOW, end: NOW + 7200000 }, { now: NOW });
  assert.equal(p.title, "⏰ הגיע הזמן לצפות ב־מטריקס"); assert.equal(p.body, "▶ בנטפליקס"); assert.equal(p.url, "./?rem=" + encodeURIComponent("nf|m603|123"));
  const q = remPayload({ k: "nf|m603|123", title: "מטריקס", ch: "צפייה", ts: NOW, end: NOW + 1 }, { now: NOW });
  assert.equal(q.body, "צפייה"); assert.ok(!/מתחיל/.test(q.body));
  assert.match(remPayload({ k: "208|1", title: "חדשות", ch: "קשת", ts: NOW + 60000, end: NOW + 120000 }, { now: NOW }).title, /^⏰ חדשות$/);
});

// ---------- אחסון אמיתי (_db.js) מול Firestore מדומה ----------
test("אחסון Firestore: watch/nf-search כותבים דרך _db.js, listUsers מוצא את המשתמשים, ניקוי מוחק", async () => {
  const { fakeFirestoreClient } = await import("./helpers/fakedb.mjs");
  const { _setBackend, firestoreBackend, writeJson, readJson } = await import("../api/_db.js");
  const cl = fakeFirestoreClient(); _setBackend(firestoreBackend(cl));
  try {
    assert.equal((await handleWatch("POST", { t: TOK, items: [item()] })).status, 403, "בלי מנוי פוש");
    await writeJson(`push/${TOK}.json`, [{ endpoint: "https://fcm.googleapis.com/x" }]);
    const r = await handleWatch("POST", { t: TOK, items: [item()] });
    assert.deepEqual(r.json, { ok: true, n: 1 });
    assert.ok(cl.data.has(`wl/${TOK}`), "wl/<t> ב-Firestore");
    assert.equal((await handleWatch("GET", { t: TOK })).json.items[0].k, "m603");
    await writeJson(`push/${TOK2}.json`, [{ endpoint: "https://fcm.googleapis.com/y" }]);
    await handleWatch("POST", { t: TOK2, items: [item({ k: "m7" })] });
    const us = await listUsers();
    assert.deepEqual(us.map((u) => u.t).sort(), [TOK, TOK2].sort()); assert.equal(us[0].wl.items.length, 1);
    const { handleSearch, _clearCache } = await import("../api/nf-search.js");
    _clearCache();
    const fx = async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) });
    assert.equal((await handleSearch("matrix", { fetch: fx })).status, 200);
    assert.ok([...cl.data.keys()].some((k) => k.startsWith("cache/nf__")), "מטמון החיפוש נכתב");
    _clearCache();
    assert.equal((await handleSearch("matrix", { fetch: fx })).cache, "db");
    assert.equal(await cleanNfCache(Date.now() + 13 * 3600000), 1, "ניקוי אחרי 12 שעות");
    assert.equal([...cl.data.keys()].some((k) => k.startsWith("cache/nf__")), false);
    await handleWatch("POST", { t: TOK, items: [] }); assert.equal(cl.data.has(`wl/${TOK}`), false, "רשימה ריקה מוחקת");
    assert.equal(await readJson(`wl/${TOK}.json`, null), null);
  } finally { _setBackend(null); }
});
