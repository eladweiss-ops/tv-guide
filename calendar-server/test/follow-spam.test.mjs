// node --test calendar-server/test/*.mjs  - מעקב אחרי סדרות: מקרי הספאם האמיתיים (המפץ הגדול 9, חברים 9, מלכת היופי, הכוורת, ערוץ 14, NBA), תקרות, מרוץ כתיבה, לוח ישן, דילוג, מחיקה ידנית
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.FIRE_SECRET = "test-secret-not-real";
process.env.QSTASH_TOKEN = "qs-test";
process.env.QSTASH_URL = "https://qstash.example";
delete process.env.FIREBASE_SERVICE_ACCOUNT;
console.error = () => {}; console.log = () => {};

import { memBackend } from "./helpers/fakedb.mjs";
const be = memBackend();
(await import("../api/_db.js"))._setBackend(be);
const S = await import("../api/_series.js");
const { classify, parseTitle, seriesKey, ilToMs, chDisplay, isGeneric, genericTitle, dayCap, ID_RE } = S;
const { cleanOne, deriveItems, withDerived, pruneDerived, MAX_PER_USER_DAY } = await import("../api/_fol.js");
const { handleFollow } = await import("../api/follow.js");
const { reschedule, writeJson, readJson } = await import("../api/_push.js");
const { refreshUser, runFollowCheck, derivedStillAired, _resetGuide } = await import("../api/_fcheck.js");
const { handleFire } = await import("../api/fire.js");
const { load, loadAll } = await import("../api/_store.js");
const { _resetLimits } = await import("../api/_guard.js");

const TOK = "abcdefghij0123456789abcd";
const real = JSON.parse(fs.readFileSync(new URL("./fixtures/real-guide.json", import.meta.url), "utf8")); // עותק קטן של guide.json אמיתי (31.10.2026)
const NOW = Date.parse(real.updated);
const day = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(ms));
const hour = (ms) => +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hourCycle: "h23" }).format(new Date(ms));
const F = (title, o = {}) => cleanOne({ title, mode: "new", lead: 10, u: NOW, ...o }, NOW);
const perDay = (d) => { const m = {}; d.forEach((x) => { m[day(x.ts)] = (m[day(x.ts)] || 0) + 1; }); return m; };
const SUB = [{ endpoint: "https://fcm.googleapis.com/x", keys: {} }];
test.beforeEach(() => { _resetLimits(); _resetGuide(); be.m.clear(); });

// ---------- המקרים האמיתיים ----------
for (const t of ["המפץ הגדול 9", "חברים 9", "מלכת היופי של ירושלים - עונה 1", "הכוורת", "הפטריוטים בהגשת ינון מגל", "הזמר במסכה", "ארץ נהדרת"]) {
  test("ספאם: " + t + " - עד התראה אחת ביום, אף אחת בלילה (00:00-06:00)", () => {
    const d = deriveItems([F(t)], real, NOW, []);
    for (const [k, n] of Object.entries(perDay(d))) assert.ok(n <= 1, `${t} ${k}: ${n}`);
    assert.ok(d.every((x) => hour(x.ts) >= 6), "אין התראות בלילה: " + d.map((x) => hour(x.ts)));
    assert.ok(d.length <= 7);
  });
}
test("ספאם: חברים 9 - לא 8 ב-2 ימים ולא 3 בתוך שעה; המפץ הגדול - לא 5 מהן 4 בלילה", () => {
  const f = deriveItems([F("חברים 9")], real, NOW, []);
  const two = f.filter((x) => x.ts < NOW + 2 * 86400000);
  assert.ok(two.length <= 2, "ב-48 שעות: " + two.length);
  for (let i = 0; i + 2 < f.length; i++) assert.ok(f[i + 2].ts - f[i].ts > 3600000);
  const b = deriveItems([F("המפץ הגדול 9")], real, NOW, []);
  assert.ok(b.filter((x) => hour(x.ts) < 6).length === 0);
});
test("ספאם: מלכת היופי (אין תקציר, 32 שידורים) - מרתון חוזרות: במצב 'רק חדשים' כלום; ב'גם חוזרים' עד 4 ביום", () => {
  const t = "מלכת היופי של ירושלים - עונה 1";
  const rows = real.programs.filter((p) => p.title === t && p.ch === "315").map((p) => ({ ch: p.ch, start: p.start, title: p.title, desc: p.desc }));
  assert.ok(rows.length >= 12);
  const cl = classify(rows);
  assert.ok(cl.every((x) => !x.primary && x.why === "marathon" || +x.start.slice(11, 13) < 6), "לא הכול 'ראשי'");
  assert.equal(deriveItems([F(t)], real, NOW, []).length, 0);
  const all = deriveItems([F(t, { mode: "all" })], real, NOW, []);
  assert.ok(all.length > 0); for (const n of Object.values(perDay(all))) assert.ok(n <= 4);
});
test("הכוורת: תקציר רק בשידור הראשון (בערוץ תאום) - התראה אחת ביום ב-19:15, בשם 'כאן 11'", () => {
  const d = deriveItems([F("הכוורת")], real, NOW, []);
  assert.ok(d.length >= 3);
  assert.deepEqual(Object.values(perDay(d)).filter((n) => n !== 1), []);
  assert.ok(d.slice(0, 3).every((x) => /^19:1[0-9]$/.test(new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(x.ts))), "19:15");
  assert.ok(d.every((x) => x.ch === "כאן 11"), "שם כמו באפליקציה, והערוץ הקנוני (לא 'ערוץ 1 HD חדש'): " + [...new Set(d.map((x) => x.ch))]);
  assert.ok(d.every((x) => x.c === "3787"));
});
test("NBA וכותרות כלליות: חסומות כסדרה (נושא בלבד)", () => {
  assert.equal(genericTitle(real, "NBA"), true);
  assert.equal(deriveItems([F("NBA")], real, NOW, []).length, 0);
  assert.equal(isGeneric("חדשות", []), true); assert.equal(isGeneric("סרט", []), true); assert.equal(isGeneric("ספורט", []), true);
  const many = []; for (let i = 0; i < 40; i++) many.push({ start: `2026-11-0${1 + (i % 2)}T${String(6 + (i % 18)).padStart(2, "0")}:${String(i).padStart(2, "0")}`, title: "תוכנית כללית", ch: "1" });
  assert.equal(isGeneric("תוכנית כללית", many), true, "מעל 15 ביום");
  assert.equal(genericTitle(real, "הכוורת"), false); assert.equal(genericTitle(real, "חברים 9"), false, "תאומי SD/HD נספרים פעם אחת");
});
test("ערוץ 14 (מזהה x14): נגזר, המפתח תקין, והמזהה עובר ניקוי", () => {
  assert.ok(ID_RE.test("x14") && ID_RE.test("xi24") && ID_RE.test("xknesset") && ID_RE.test("xkids") && ID_RE.test("3787"));
  assert.ok(!ID_RE.test("x") && !ID_RE.test("a14") && !ID_RE.test("x1|2") && !ID_RE.test("1234567") && !ID_RE.test(""));
  const f = F("הפטריוטים בהגשת ינון מגל", { ch: "x14", chn: "ערוץ 14", chs: ["x14"] });
  assert.equal(f.ch, "x14"); assert.deepEqual(f.chs, ["x14"]);
  const d = deriveItems([f], real, NOW, []);
  assert.ok(d.length >= 3); assert.ok(d.every((x) => x.k.split("|")[2] === "x14" && x.c === "x14" && x.ch === "ערוץ 14"), d[0].k);
});

// ---------- מסווג ----------
const A = (ch, start, title, o = {}) => ({ ch, start, title, ...o });
test("classify: 'פרק ראשון' בלילה = חוזר (חוץ מישיר/חדש מפורש), והפרק מזוהה בשידור הבא ביום", () => {
  const r = classify([A("1", "2026-11-02T01:30", "דרמה", { desc: "פרק על סודות המשפחה הגדולה" }), A("1", "2026-11-02T20:00", "דרמה", { desc: "פרק על סודות המשפחה הגדולה" }),
    A("1", "2026-11-03T02:00", "ישיר: חדשות", { lv: 1 }), A("1", "2026-11-03T03:00", "דרמה", { desc: "עונה חדשה של הדרמה" })]);
  assert.deepEqual(r.map((x) => [x.primary, x.why]), [[false, "night"], [true, "first"], [true, "live"], [true, "new"]]);
});
test("classify: 'single' - בלי תקציר ובלי פרק: 3+ שידורים לא כולם ראשיים; משבצת שכיחה (בלי יום בשבוע) ראשית, השאר חוזרים", () => {
  const rows = ["2026-11-02T21:00", "2026-11-03T21:00", "2026-11-04T21:00", "2026-11-04T14:30", "2026-11-05T16:10"].map((s) => A("5", s, "יומית"));
  assert.deepEqual(classify(rows).map((x) => x.primary), [true, true, true, false, false]);
  const scattered = ["2026-11-02T10:21", "2026-11-02T12:51", "2026-11-03T16:39", "2026-11-04T18:02"].map((s) => A("5", s, "מרתון"));
  assert.ok(classify(scattered).every((x) => !x.primary && x.why === "marathon"));
  assert.ok(classify(scattered.slice(0, 2)).every((x) => x.primary), "פחות מ-3: לא מרתון");
});
test("dayCap: אחד ביום; שני רק ישיר/חדש מפרקים שונים בהפרש 3 שעות; 'all' עד 4", () => {
  const live = (s, e) => ({ start: s, why: "live", epk: e });
  assert.equal(dayCap([live("2026-11-02T14:00", "a"), live("2026-11-02T20:00", "b")], "new").length, 2);
  assert.equal(dayCap([live("2026-11-02T14:00", "a"), live("2026-11-02T15:00", "b")], "new").length, 1);
  assert.equal(dayCap([live("2026-11-02T14:00", "a"), live("2026-11-02T20:00", "a")], "new").length, 1);
  const first = (s) => ({ start: s, why: "first", epk: s });
  assert.equal(dayCap([first("2026-11-02T09:00"), first("2026-11-02T12:00"), first("2026-11-02T21:00")], "new").length, 1);
  assert.equal(dayCap([first("2026-11-02T09:00"), first("2026-11-02T12:00"), first("2026-11-02T21:00")], "new")[0].start, "2026-11-02T21:00", "ערב עדיף");
  const six = [9, 10, 11, 12, 13, 14].map((h) => first(`2026-11-02T${String(h).padStart(2, "0")}:00`));
  assert.equal(dayCap(six, "all").length, 4);
});
test("parseTitle: מסיר סימוני שיווק (בכורה!, חדש בערוץ!, (חדש), בכורה:) בלי לפגוע בסדרות אחרות", () => {
  for (const t of ["הסדרה - בכורה!", "הסדרה -חדש בערוץ!", "הסדרה (חדש)", "בכורה: הסדרה", "חדש ! הסדרה", "הסדרה - פרק 7 - בכורה!"]) assert.equal(parseTitle(t).stem, "הסדרה", t);
  assert.equal(parseTitle("חדשות הבוקר").stem, "חדשות הבוקר"); assert.equal(parseTitle("NCIS: ההתחלה 2").stem, "NCIS: ההתחלה 2");
  assert.equal(seriesKey("הסדרה - בכורה!"), seriesKey("הסדרה"));
});
test("chDisplay: אותם שמות כמו האפליקציה (ALIAS + cleanName)", () => {
  assert.equal(chDisplay({ id: "3787", name: "HD כאן" }), "כאן 11"); assert.equal(chDisplay({ id: "3771", name: "ערוץ 1 HD חדש" }), "ערוץ 1");
  assert.equal(chDisplay({ id: "1", name: "קשת" }), "קשת 12"); assert.equal(chDisplay({ id: "2", name: "רשת SD" }), "רשת 13"); assert.equal(chDisplay({ id: "3", name: "!E ערוץ הבידור" }), "E! ערוץ הבידור");
  assert.equal(chDisplay({ id: "4", name: "yes (copy)" }), "yes"); assert.equal(chDisplay({ id: "3185", name: "??!?" }), "ערוץ פעוטות (HOT 3185)");
});

// ---------- תאומים והערוצים שלי ----------
test("תאומים באותה שעה: מעדיפים את הערוץ שנבחר (chs), ואחרת את הקנוני (לא 'חדש'/העתק)", () => {
  const g = { updated: "x", channels: [{ id: "10", name: "ערוץ א חדש" }, { id: "11", name: "ערוץ א" }, { id: "12", name: "ערוץ ב" }],
    programs: [10, 11, 12].flatMap((c) => ["2026-11-02T21:00", "2026-11-03T21:00"].map((s) => ({ ch: String(c), start: s, title: "סדרה יפה", desc: "פרק מספר " + s + " של הסדרה היפה" }))) };
  assert.deepEqual(new Set(deriveItems([F("סדרה יפה")], g, NOW, []).map((x) => x.c)), new Set(["11"]), "קנוני: 11 (10 הוא 'חדש')");
  assert.deepEqual(new Set(deriveItems([F("סדרה יפה", { chs: ["10", "11"] })], g, NOW, []).map((x) => x.c)), new Set(["11"]), "מבין שנבחרו (10,11): הקנוני 11; 12 מחוץ לבחירה");
  assert.deepEqual(new Set(deriveItems([F("סדרה יפה", { chs: ["12"] })], g, NOW, []).map((x) => x.c)), new Set(["12"]), "'הערוצים שלי' מסנן");
});

// ---------- תקרה יומית למשתמש ----------
test("תקרה יומית למשתמש: 12 סדרות באותו יום = לא יותר מ-8 התראות מעקב (של המשתמש לא נספרות)", () => {
  const programs = [], follows = [];
  for (let i = 0; i < 12; i++) { const t = "סדרה מספר " + String.fromCharCode(1488 + i) + String.fromCharCode(1488 + ((i * 5) % 22)) + "ם"; follows.push(F(t)); programs.push({ ch: "1", start: `2026-11-02T${String(8 + i).padStart(2, "0")}:00`, title: t, desc: "פרק חדש בעונה חדשה " + i }); }
  const g = { updated: "x", channels: [{ id: "1", name: "קשת" }], programs };
  const d = deriveItems(follows, g, NOW, []);
  assert.equal(d.length, MAX_PER_USER_DAY); assert.equal(MAX_PER_USER_DAY, 8);
});

// ---------- דילוג ----------
test("דילוג על פרק: ה-ts ברשימת skip לא נגזר", () => {
  const f = F("הזמר במסכה"), all = deriveItems([f], real, NOW, []), skipTs = all[1].ts;
  const d = deriveItems([cleanOne({ ...f, skip: [skipTs, "x", -1] }, NOW)], real, NOW, []);
  assert.equal(d.length, all.length - 1); assert.ok(!d.some((x) => x.ts === skipTs));
  assert.deepEqual(cleanOne({ title: "הזמר במסכה", skip: [5, "x", 7.4] }, NOW).skip, [5, 7]);
});

// ---------- ביטול ידני מחזיר את התזכורת ----------
test("תזכורת ידנית: הגזירה לא מוותרת על השידור; רק בזמן התזמון הנגזרת נדחקת, וביטול הידנית מחזיר אותה מיד", async () => {
  await writeJson(`push/${TOK}.json`, SUB);
  const d = deriveItems([F("הזמר במסכה")], real, NOW, []);
  const manual = { k: `12|${d[0].ts}`, title: "הזמר במסכה", ts: d[0].ts, end: d[0].end, lead: 5 };
  assert.equal(deriveItems([F("הזמר במסכה")], real, NOW, []).length, d.length, "הגזירה זהה גם עם ידנית");
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [F("הזמר במסכה")], derived: d });
  const calls = []; const sch = { getSubs: async () => SUB, readJson, writeJson, now: () => NOW, fetch: async (u, i) => { calls.push({ u, i }); return { ok: true, json: async () => ({ messageId: "m" + calls.length }) }; } };
  await reschedule(TOK, [manual], sch);
  const keys1 = calls.filter((c) => c.i.method === "POST").map((c) => JSON.parse(c.i.body).k);
  assert.ok(keys1.includes(manual.k) && !keys1.includes(d[0].k), "הנגזרת נדחקה");
  await reschedule(TOK, [], sch); // ביטול הידנית
  const post = JSON.parse(calls.filter((c) => c.i.method === "POST").pop().i.body);
  assert.equal(post.k, d[0].k, "הנגזרת חזרה");
});

// ---------- מרוץ כתיבה ולוח ישן ----------
const mkD = (o = {}) => ({ getSubs: async () => SUB, guide: async () => real, now: () => NOW, readJson, writeJson, load, reschedule: async () => ({}), ...o });
test("מרוץ כתיבה: רענון (cron) עם מסמך ישן לא דורס מעקב שנוסף/נמחק בינתיים", async () => {
  const a = F("הזמר במסכה", { u: NOW - 5000 }), b = F("ארץ נהדרת", { u: NOW - 4000 });
  const stale = { v: 1, follows: [a], derived: [], chk: 0 };
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [{ ...a, x: 1, u: NOW - 1000, mode: undefined }, b], derived: [], chk: 0 }); // בינתיים: a נמחק, b נוסף
  await refreshUser(TOK, stale, mkD());
  const saved = await readJson(`fol/${TOK}.json`, null);
  assert.ok(saved.follows.some((f) => f.k === b.k && !f.x), "b נשמר");
  assert.ok(saved.follows.some((f) => f.k === a.k && f.x), "המחיקה של a נשמרה");
  assert.ok(saved.derived.length > 0 && saved.derived.every((d) => d.k.split("|")[1] === b.k), "נגזרות רק של b");
});
test("מרוץ: POST ממזג על קריאה טרייה (שני מכשירים), ומסמך שנמחק לא נוצר מחדש ע\"י cron", async () => {
  await writeJson(`push/${TOK}.json`, SUB);
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [F("ארץ נהדרת", { u: NOW - 3000 })], derived: [] });
  const r = await handleFollow("POST", { t: TOK, follows: [{ title: "הזמר במסכה", mode: "new", lead: 10, u: NOW - 2000 }] }, mkD());
  assert.equal(r.json.n, 2, "שני המעקבים");
  be.m.delete(`fol/${TOK}`);
  const out = await refreshUser(TOK, { v: 1, follows: [F("ארץ נהדרת")], derived: [] }, mkD());
  assert.equal(out.gone, true); assert.equal(await readJson(`fol/${TOK}.json`, null), null);
});
test("לוח לא נטען: נגזרות של מעקב שנעצר מסוננות, ולא יורות (גם דרך reschedule ו-loadAll)", async () => {
  await writeJson(`push/${TOK}.json`, SUB);
  const f = F("הזמר במסכה"), d = deriveItems([f], real, NOW, []);
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [{ ...f, x: 1, u: NOW + 1 }], derived: d, chk: 5 });
  const doc = await readJson(`fol/${TOK}.json`, null);
  const out = await refreshUser(TOK, doc, mkD({ guide: async () => null }));
  assert.equal(out.stale, true);
  assert.deepEqual((await readJson(`fol/${TOK}.json`, null)).derived, [], "נגזרות של מעקב שנעצר נמחקו גם בלי לוח");
  assert.deepEqual(pruneDerived(d, [{ ...f, x: 1 }]), []);
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [{ ...f, x: 1, u: NOW + 1 }], derived: d });
  assert.equal((await loadAll(TOK)).length, 0, "fire/snooze לא מוצאים אותן");
  const calls = []; await reschedule(TOK, [], { getSubs: async () => SUB, readJson, writeJson, now: () => NOW, fetch: async (u, i) => { calls.push(i); return { ok: true, json: async () => ({ messageId: "m" }) }; } });
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

// ---------- לוח שהתעדכן באמצע היום ----------
test("GET /api/follow: הלוח חדש מהגזירה האחרונה -> גוזרים מחדש (gu מתעדכן); אותו לוח -> לא", async () => {
  await writeJson(`push/${TOK}.json`, SUB);
  const f = F("הזמר במסכה");
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [f], derived: [], gu: "OLD", chk: 1 });
  let resched = 0;
  const d = mkD({ reschedule: async () => { resched++; return {}; } });
  const r1 = await handleFollow("GET", { t: TOK }, d);
  assert.equal(r1.json.follows.length, 1);
  const doc = await readJson(`fol/${TOK}.json`, null);
  assert.equal(doc.gu, real.updated); assert.ok(doc.derived.length > 0); assert.equal(resched, 1);
  await handleFollow("GET", { t: TOK }, d); assert.equal(resched, 1, "אותו לוח: בלי רענון");
});
test("fire: נגזרת ששידורה כבר לא בלוח - לא יורים, וגוזרים מחדש; קיימת בלוח - יורים", async () => {
  const f = F("הזמר במסכה"), d = deriveItems([f], real, NOW, [])[0];
  assert.equal(await derivedStillAired(d, { guide: async () => real }), true);
  assert.equal(await derivedStillAired({ ...d, ts: d.ts + 60000 }, { guide: async () => real }), false);
  assert.equal(await derivedStillAired(d, { guide: async () => null }), true, "בלי לוח: ממשיכים");
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [f], derived: [d] });
  const sent = [];
  const deps = (still) => ({ load: loadAll, sendTo: async (t, p) => { sent.push(p); return { ok: 1, total: 1 }; }, dropSched: async () => {}, reschedule: async () => ({}), checkDerived: async () => still });
  assert.equal((await handleFire({ t: TOK, k: d.k, at: d.ts - 600000 }, deps(false), d.ts - 600000)).json.skipped, "guide changed"); assert.equal(sent.length, 0);
  assert.equal((await handleFire({ t: TOK, k: d.k, at: d.ts - 600000 }, deps(true), d.ts - 600000)).json.ok, 1); assert.equal(sent.length, 1);
});

// ---------- זמן ----------
test("cron: reschedule מקבל deadline, ופרסום אחרי ה-deadline נעצר (limited=time)", async () => {
  await writeJson(`push/${TOK}.json`, SUB);
  const f = F("הזמר במסכה"); await writeJson(`fol/${TOK}.json`, { v: 1, follows: [f], derived: deriveItems([f], real, NOW, []) });
  let opts = null;
  await runFollowCheck({ listFol: async () => [{ t: TOK, doc: await readJson(`fol/${TOK}.json`, null) }], getSubs: async () => SUB, readJson, writeJson, load, guide: async () => real, now: () => NOW, deadline: Date.now() + 60000, reschedule: async (t, r, o) => { opts = o; return {}; } });
  assert.ok(opts && opts.deadline > Date.now(), "deadline מועבר לתזמון");
  const calls = [];
  const out = await reschedule(TOK, [], { getSubs: async () => SUB, readJson, writeJson, now: () => NOW + 1, deadline: Date.now() - 1, fetch: async (u, i) => { calls.push(i); return { ok: true, json: async () => ({ messageId: "m" }) }; } });
  assert.equal(calls.filter((c) => c.method === "POST").length, 0); assert.equal(out.limited, "time");
});
test("cron: הלוח נטען פעם אחת לשני השלבים", async () => {
  const { default: cronH } = await import("../api/watch-check.js");
  process.env.CRON_SECRET = "cs";
  let fetches = 0; const res = { code: 200, headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
  await writeJson(`push/${TOK}.json`, SUB); await writeJson(`wl/${TOK}.json`, { items: [{ k: "m1", title: "סרט", type: "movie", on: ["tv"] }] });
  const f = F("הזמר במסכה"); await writeJson(`fol/${TOK}.json`, { v: 1, follows: [f], derived: [] });
  await cronH({ method: "GET", headers: { authorization: "Bearer cs" } }, res, { fetch: async (u) => { if (/guide\.json/.test(u)) fetches++; return { ok: true, json: async () => real }; }, listUsers: async () => [{ t: TOK, wl: await readJson(`wl/${TOK}.json`, null) }], listFol: async () => [{ t: TOK, doc: await readJson(`fol/${TOK}.json`, null) }], now: () => NOW, key: "k".repeat(32), cleanCache: undefined, follow: { reschedule: async () => ({}) } });
  delete process.env.CRON_SECRET;
  assert.equal(res.code, 200); assert.equal(fetches, 1, "guide.json נטען פעם אחת");
});
