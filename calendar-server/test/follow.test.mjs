// node --test calendar-server/test/*.mjs  - מעקב אחרי סדרות (📺): מסווג שידור ראשי/חוזר, מיזוג מעקבים, /api/follow, גזירת תזכורות, תקציב משותף, ירי/נודניק, ושלב ה-cron
import test from "node:test";
import assert from "node:assert/strict";

process.env.FIRE_SECRET = "test-secret-not-real";
process.env.QSTASH_TOKEN = "qs-test";
process.env.QSTASH_URL = "https://qstash.example";
delete process.env.FIREBASE_SERVICE_ACCOUNT;
console.error = () => {};
console.log = () => {};

import fs from "node:fs";
import { memBackend } from "./helpers/fakedb.mjs";
const be = memBackend();
(await import("../api/_db.js"))._setBackend(be);
const { classify, parseTitle, seriesKey, seriesTitle, seriesAirings, ilToMs, normT, chDisplay, isGeneric, genericTitle, dayCap, ID_RE } = await import("../api/_series.js");
const { cleanOne, mergeFollows, deriveItems, withDerived, dupOfManual, pruneDerived, MAX_FOLLOWS, MAX_PER_FOLLOW, MAX_PER_USER_DAY } = await import("../api/_fol.js");
const { handleFollow, default: followH, MAX_BODY } = await import("../api/follow.js");
const { reschedule, MAX_SCHED, MAX_PUBLISH_DAY, DER_RESERVE, writeJson, readJson } = await import("../api/_push.js");
const { runFollowCheck, refreshUser, rederive, derivedStillAired, _resetGuide } = await import("../api/_fcheck.js");
const { default: cronH, listFol } = await import("../api/watch-check.js");
const { handleFire } = await import("../api/fire.js");
const { handleSnooze, remPayload } = await import("../api/_snz.js");
const { loadAll, load, okToken } = await import("../api/_store.js");
const { _resetLimits } = await import("../api/_guard.js");

const TOK = "abcdefghij0123456789abcd", TOK2 = "zyxwvutsrq9876543210zyxw", TOK3 = "mnopqrstuv0123456789mnop";
const NOW = Date.parse("2026-11-01T08:00:00Z"); // 10:00 בישראל, יום א׳ 1.11.2026 (אחרי חזרה לשעון חורף)
const SUB = [{ endpoint: "https://fcm.googleapis.com/x", keys: {} }];
const mockRes = () => { const r = { code: 200, headers: {}, body: undefined }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; }; r.status = (c) => { r.code = c; return r; }; r.json = (o) => { r.body = o; return r; }; r.end = () => r; return r; };
test.beforeEach(() => { _resetLimits(); _resetGuide(); be.m.clear(); });

// ---------- לוח לדוגמה ----------
const P = (ch, start, title, o = {}) => ({ ch, start, title, ...o });
const guide = {
  channels: [{ id: "12", name: "קשת 12" }, { id: "13", name: "רשת 13" }, { id: "3787", name: "HD כאן 11" }, { id: "3788", name: "כאן 11" }],
  programs: [
    // הזמר במסכה: פרק חדש בשני 21:30, אותו פרק שוב ביום ג׳ בצהריים (rr) ולמחרת בלילה (בלי rr, אותו תקציר)
    P("12", "2026-11-02T21:30", "הזמר במסכה", { desc: "החשיפה השביעית של העונה. מי המפורסם עומד מאחורי המסכה" }),
    P("12", "2026-11-03T11:45", "הזמר במסכה", { desc: "החשיפה השביעית של העונה. מי המפורסם עומד מאחורי המסכה", rr: 1 }),
    P("12", "2026-11-04T01:45", "הזמר במסכה", { desc: "החשיפה השביעית של העונה. מי המפורסם עומד מאחורי המסכה" }),
    P("12", "2026-11-09T21:30", "הזמר במסכה", { desc: "החשיפה השמינית של העונה. מי המפורסם עומד מאחורי המסכה" }),
    // פרק בכותרת: הנדר 4 - פרק 130 שלוש פעמים
    P("13", "2026-11-01T09:19", "הנדר 4 - פרק 130"), P("13", "2026-11-01T15:02", "הנדר 4 - פרק 130"), P("13", "2026-11-03T20:00", "הנדר 4 - פרק 131"),
    // תאומי SD/HD באותה שעה
    P("3787", "2026-11-02T20:00", "חדשות הערב מיוחד", { lv: 1 }), P("3788", "2026-11-02T20:00", "חדשות הערב מיוחד", { lv: 1 }),
    // ארץ נהדרת: רק בכותרת/תקציר "עונה חדשה"
    P("12", "2026-11-05T21:30", "ארץ נהדרת", { desc: "ארץ נהדרת בעונה חדשה עם איל קיציס" }),
    P("12", "2026-11-07T13:45", "ארץ נהדרת", { desc: "ארץ נהדרת בעונה חדשה עם איל קיציס", rr: 1 }),
    // תוכנית אחרת עם שם דומה: לא מתאים
    P("12", "2026-11-04T22:00", "הזמר במסכה: המופע המיוחד"),
    P("12", "2026-11-04T23:00", "סתם תוכנית"),
  ],
};
const gd = () => Promise.resolve(guide);
const fol = (title, o = {}) => ({ title, mode: "new", lead: 10, u: NOW, ...o });

// ---------- המסווג ----------
test("parseTitle/seriesKey: סימון פרק מפורש בלבד, בלי לבלוע סדרות שונות", () => {
  assert.deepEqual(parseTitle("הנדר 4 - פרק 130"), { stem: "הנדר 4", ep: "e130" });
  assert.deepEqual(parseTitle("טילדה 2: 7"), { stem: "טילדה 2", ep: "e7" });
  assert.deepEqual(parseTitle("The Voice All Stars - פרק 9"), { stem: "The Voice All Stars", ep: "e9" });
  assert.deepEqual(parseTitle("שירים ראשונים פרק 114"), { stem: "שירים ראשונים", ep: "e114" });
  assert.equal(parseTitle("NCIS: ההתחלה 2").stem, "NCIS: ההתחלה 2", "לא חותכים לפי נקודתיים");
  assert.notEqual(seriesKey("NCIS: ההתחלה 2"), seriesKey("NCIS"));
  assert.equal(seriesKey("הנדר 4 - פרק 130"), seriesKey("הנדר 4 - פרק 5"));
  assert.equal(parseTitle("הזמר במסכה").ep, "");
  assert.ok(!seriesKey("x|y z").includes("|"), "המפתח בלי | (בגלל פורמט f|סדרה|ערוץ|ts)");
});

test("ilToMs: שעון ישראל כולל מעבר שעון קיץ", () => {
  assert.equal(ilToMs("2026-11-01T10:00"), Date.parse("2026-11-01T08:00:00Z"));  // חורף UTC+2
  assert.equal(ilToMs("2026-10-23T19:00"), Date.parse("2026-10-23T16:00:00Z"));  // קיץ UTC+3 (השעון חזר ב-25.10)
  assert.ok(Number.isNaN(ilToMs("bad")));
});

const A = (ch, start, title, o = {}) => ({ ch, start, title, ...o });
const prim = (r) => r.map((x) => (x.primary ? "P" : "r")).join("");

test("classify: ישיר תמיד ראשי; rr חוזר; אותו פרק ללא rr: המוקדם ראשי והבא חוזר", () => {
  const r = classify([
    A("1", "2026-11-02T21:30", "מבצע", { desc: "פרק על חקירה גדולה בצפון" }),
    A("1", "2026-11-03T14:00", "מבצע", { desc: "פרק על חקירה גדולה בצפון" }),
    A("1", "2026-11-04T21:30", "מבצע", { desc: "פרק חדש על ניצולים מהשואה" }),
    A("1", "2026-11-05T09:00", "מבצע", { desc: "פרק ישן", rr: 1 }),
    A("1", "2026-11-06T20:00", "ישיר: מבצע", { desc: "פרק ישן", rr: 1, lv: 1 }),
  ]);
  assert.equal(prim(r), "PrPrP");
});

test("classify: תקציר גנרי שחוזר כל יום אינו מזהה פרק (סדרה יומית) - כל הימים ראשיים", () => {
  const rows = [];
  for (let d = 2; d <= 8; d++) rows.push(A("9", `2026-11-0${d}T20:00`, "פרוטוקול", { desc: "תוכנית אירוח יומית עם אורחים ושיחות על האקטואליה" }));
  const r = classify(rows);
  assert.ok(r.every((x) => x.primary), prim(r));
});

test("classify: בלי תקציר ובלי rr - המשבצת הרגילה ראשית, שעת לילה וחריגים חוזרים", () => {
  const rows = [
    A("5", "2026-11-02T21:00", "דרמה"), A("5", "2026-11-09T21:00", "דרמה"),   // שני 21:00 (פעמיים)
    A("5", "2026-11-04T14:00", "דרמה"), A("5", "2026-11-05T03:00", "דרמה"),
  ];
  assert.equal(prim(classify(rows)), "PPrr");
});

test("classify: בלי מידע בכלל - שידור בודד בשעות היום נשאר ראשי, בלילה חוזר", () => {
  assert.equal(prim(classify([A("5", "2026-11-02T20:30", "חדשה")])), "P");
  assert.equal(prim(classify([A("5", "2026-11-02T03:30", "חדשה")])), "r");
});

test("classify: סימוני טקסט - 'עונה חדשה' ראשי, 'שידור חוזר' חוזר, גם בלי rr", () => {
  const r = classify([A("1", "2026-11-02T22:00", "דרמה", { desc: "בעונה חדשה" }), A("1", "2026-11-03T14:00", "דרמה", { desc: "שידור חוזר של הפרק" })]);
  assert.equal(prim(r), "Pr");
});

test("seriesAirings: התאמת כותרת מדויקת בלבד, סינון קבוצת ערוצים, ללא עבר", () => {
  const a = seriesAirings(guide, "הזמר במסכה", null, NOW);
  assert.equal(a.length, 4, "בלי 'הזמר במסכה: המופע המיוחד'");
  assert.deepEqual(a.map((x) => x.primary), [true, false, false, true]);
  assert.equal(seriesAirings(guide, "הזמר במסכה", ["13"], NOW).length, 0, "ערוץ אחר");
  assert.equal(seriesAirings(guide, "הנדר 4 - פרק 99", null, NOW).length, 2, "גזע הסדרה, לא הפרק (השידור של 09:19 כבר עבר)");
  assert.deepEqual(seriesAirings(guide, "הנדר 4", null, NOW).map((x) => x.primary), [false, true], "15:02 הוא חזרה על פרק שכבר שודר ב-09:19");
  assert.equal(seriesAirings(guide, "הזמר במסכה", null, ilToMs("2026-11-09T21:30")).length, 0, "ts חייב להיות אחרי עכשיו");
});

// ---------- מיזוג מעקבים ----------
test("cleanOne: מפתח נגזר מהכותרת, ערוץ/קבוצה/lead/mode מנוקים, מחיקה = tombstone", () => {
  const c = cleanOne({ k: "evil|key", title: "הנדר 4 - פרק 130", ch: "13", chs: ["13", "99", "bad", "<x>"], chn: "רשת 13", mode: "weird", lead: 99999, dbl: 1 }, NOW);
  assert.equal(c.k, seriesKey("הנדר 4")); assert.equal(c.title, "הנדר 4");
  assert.deepEqual(c.chs, ["13", "99"]); assert.equal(c.mode, "new"); assert.equal(c.lead, 10080, "אותה תקרה כמו ברשימת התזכורות הרגילה"); assert.equal(c.dbl, 1);
  assert.deepEqual(cleanOne({ title: "הנדר 4", x: 1, u: 5 }, NOW), { k: seriesKey("הנדר 4"), title: "הנדר 4", u: 5, x: 1 });
  assert.equal(cleanOne({ title: "א" }, NOW), null); assert.equal(cleanOne(null), null); assert.equal(cleanOne({ title: "" }), null);
  assert.equal(cleanOne({ title: "abc", lead: 0, dbl: 1 }, NOW).dbl, undefined, "dbl דורש lead>0");
  assert.equal(cleanOne({ title: "abc", u: NOW + 9e9 }, NOW).u, NOW + 3600000, "u לא מהעתיד");
});

test("mergeFollows: המאוחר מנצח לפי u, מחיקה מנצחת רק אם חדשה יותר, תקרה 30 לחדשים", () => {
  const B = NOW - 86400000, ex = [fol("סדרה אחת", { u: B + 100, mode: "all" })];
  let r = mergeFollows([fol("סדרה אחת", { u: B + 50, mode: "new" })], ex, NOW);
  assert.equal(r.follows[0].mode, "all", "ישן לא דורס");
  r = mergeFollows([{ title: "סדרה אחת", x: 1, u: B + 200 }], ex, NOW);
  assert.equal(r.follows[0].x, 1);
  r = mergeFollows([fol("סדרה אחת", { u: B + 300 })], r.follows, NOW);
  assert.equal(r.follows[0].x, undefined, "מעקב חדש יותר מהמחיקה מחיה");
  const many = Array.from({ length: 40 }, (_, i) => fol("סדרה מספר " + String.fromCharCode(1488 + (i % 27)) + String.fromCharCode(1488 + ((i * 7) % 27)) + i));
  r = mergeFollows(many, [], NOW);
  assert.equal(r.follows.filter((x) => !x.x).length, MAX_FOLLOWS); assert.equal(r.capped, 10);
  const tomb = mergeFollows([], [{ title: "ישנה מאוד", x: 1, u: NOW - 31 * 86400000 }], NOW);
  assert.equal(tomb.follows.length, 0, "tombstone אחרי 30 יום נמחק");
});

// ---------- גזירה ----------
test("deriveItems: רק ראשיים כברירת מחדל, גם חוזרים עם mode=all; מפתח f|סדרה|ערוץ|ts; תאומים באותה שעה פעם אחת", () => {
  const f1 = cleanOne(fol("הזמר במסכה"), NOW), f2 = cleanOne(fol("הזמר במסכה", { mode: "all" }), NOW);
  const d1 = deriveItems([f1], guide, NOW);
  assert.equal(d1.length, 2);
  assert.equal(d1[0].k, `f|${f1.k}|12|${ilToMs("2026-11-02T21:30")}`);
  assert.equal(d1[0].ts, ilToMs("2026-11-02T21:30")); assert.equal(d1[0].ch, "קשת 12"); assert.equal(d1[0].lead, 10); assert.equal(d1[0].fl, 10);
  assert.ok(d1[0].end > d1[0].ts);
  assert.equal(deriveItems([f2], guide, NOW).length, 4);
  const twins = deriveItems([cleanOne(fol("חדשות הערב מיוחד"), NOW)], guide, NOW);
  assert.equal(twins.length, 1, "SD/HD באותה שעה = תזכורת אחת");
  const pinned = deriveItems([cleanOne(fol("חדשות הערב מיוחד", { ch: "3788", chn: "כאן 11", chs: ["3788"] }), NOW)], guide, NOW);
  assert.equal(pinned[0].c, "3788", "הערוץ שנקבע");
  assert.equal(deriveItems([cleanOne(fol("הזמר במסכה", { ch: "13", chs: ["13"] }), NOW)], guide, NOW).length, 0);
});

test("deriveItems: תקרה לסדרה, שידור שהתחיל לא נגזר, lead מותאם לשידור קרוב, ויציבות בגזירה חוזרת", () => {
  const prog = [];
  for (let i = 0; i < 30; i++) prog.push(P("12", `2026-11-${String(2 + (i % 9)).padStart(2, "0")}T${String(7 + Math.floor(i / 9) * 4).padStart(2, "0")}:00`, "יומית", { desc: "פרק " + i + " של הסדרה היומית הארוכה", lv: 1 }));
  const g = { channels: guide.channels, programs: prog };
  const f = cleanOne(fol("יומית"), NOW);
  const out = deriveItems([f], g, NOW);
  assert.equal(out.length, MAX_PER_FOLLOW);
  assert.equal(deriveItems([cleanOne(fol("בקרוב"), NOW)], { channels: guide.channels, programs: [P("12", "2026-11-01T10:01", "בקרוב", { lv: 1 })] }, NOW).length, 0, "שידור בעוד דקה אחת: מדלגים");
  const soonG = { channels: guide.channels, programs: [P("12", "2026-11-01T10:05", "בקרוב", { lv: 1 })] };
  const soon = deriveItems([cleanOne(fol("בקרוב"), NOW)], soonG, NOW);
  assert.equal(soon.length, 1);
  assert.equal(soon[0].lead, 4, "התחלה בעוד 5 דק׳ עם lead=10: ההתראה בעוד כדקה");
  // יציבות: גזירה חוזרת מאוחר יותר לא משנה lead של פריט קיים (מונע פוש כפול)
  const again = deriveItems([cleanOne(fol("בקרוב"), NOW)], soonG, NOW + 90000, soon);
  assert.deepEqual(again, soon);
});

test("dupOfManual / withDerived: אין כפילות עם תזכורת ידנית (אותו ערוץ+זמן, או אותה שעה ואותה סדרה)", () => {
  const f = cleanOne(fol("הזמר במסכה"), NOW);
  const der = deriveItems([f], guide, NOW);
  const manual1 = { k: `12|${der[0].ts}`, title: "הזמר במסכה", ts: der[0].ts, end: der[0].end, lead: 10 };
  const manual2 = { k: `9999|${der[1].ts}`, title: "הזמר במסכה", ts: der[1].ts, end: der[1].end, lead: 10 }; // ערוץ תאום ממוזג: מפתח שונה
  assert.equal(dupOfManual(der[0], [manual1]), true); assert.equal(dupOfManual(der[1], [manual2]), true);
  assert.equal(dupOfManual(der[0], [manual2]), false);
  assert.equal(deriveItems([f], guide, NOW, []).length, 2, "הגזירה לא תלויה בתזכורות ידניות (ביטול ידנית מחזיר את התזכורת מיד)");
  assert.equal(withDerived([manual1, manual2], der, NOW).length, 2, "שתי הנגזרות כפולות לידניות: לא מתווספות");
  assert.equal(withDerived([], der, NOW).length, 2);
  assert.equal(withDerived([{ k: der[0].k, title: "x", ts: der[0].ts }], der, NOW).length, 2, "אותו מפתח לא נכפל");
});

// ---------- /api/follow ----------
const mkSched = () => {
  const store = {}, calls = [];
  return { store, calls, getSubs: async () => SUB, readJson: async (p, d) => { const v = await readJson(p, d); return v; }, writeJson: async (p, o) => writeJson(p, o),
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ messageId: "m" + calls.length }) }; }, now: () => NOW };
};
const mkDeps = (sch = mkSched(), o = {}) => ({ getSubs: sch.getSubs, guide: gd, now: () => NOW, reschedule: (t, rems) => reschedule(t, rems, sch), ...o });
const setSubs = (t, v = SUB) => writeJson(`push/${t}.json`, v);

test("POST /api/follow: טוקן שגוי 400; בלי מנוי פוש 403 ולא נכתב דבר", async () => {
  assert.equal((await handleFollow("POST", { t: "bad", follows: [] }, mkDeps())).status, 400);
  assert.equal((await handleFollow("GET", { t: "bad" })).status, 400);
  const r = await handleFollow("POST", { t: TOK, follows: [fol("הזמר במסכה")] }, mkDeps(undefined, { getSubs: async () => [] }));
  assert.equal(r.status, 403); assert.equal(r.json.error, "no push");
  assert.equal(be.m.size, 0, "לא נכתב מסמך");
  const g = await handleFollow("GET", { t: TOK });
  assert.equal(g.status, 200); assert.deepEqual(g.json.follows, [], "GET בלי מנוי מותר ומחזיר רשימה ריקה");
});

test("POST /api/follow: שומר, גוזר, מתזמן ב-QStash עם מפתח f|; GET מחזיר; טוקן אחר לא רואה", async () => {
  await setSubs(TOK);
  const sch = mkSched();
  const r = await handleFollow("POST", { t: TOK, follows: [fol("הזמר במסכה", { lead: 30 })] }, mkDeps(sch));
  assert.equal(r.status, 200); assert.equal(r.json.n, 1); assert.equal(r.json.next, 2);
  const doc = JSON.parse(be.m.get(`fol/${TOK}`));
  assert.ok(doc.derived.length === 2 && doc.derived[0].k.startsWith("f|"));
  const posts = sch.calls.filter((c) => c.init.method === "POST").map((c) => JSON.parse(c.init.body));
  assert.equal(posts.length, 2); assert.ok(posts.every((p) => p.k.startsWith("f|") && p.t === TOK));
  const at0 = +sch.calls[0].init.headers["upstash-not-before"];
  assert.equal(at0, Math.floor((ilToMs("2026-11-02T21:30") - 30 * 60000) / 1000), "ההתראה 30 דק׳ לפני");
  const g = await handleFollow("GET", { t: TOK });
  assert.equal(g.json.follows.length, 1); assert.equal(g.json.follows[0].lead, 30);
  assert.deepEqual((await handleFollow("GET", { t: TOK2 })).json.follows, []);
});

test("POST /api/follow: הסרה (tombstone) מבטלת את התזמונים; הכול ריק = המסמך נמחק", async () => {
  await setSubs(TOK);
  const sch = mkSched();
  await handleFollow("POST", { t: TOK, follows: [fol("הזמר במסכה")] }, mkDeps(sch));
  assert.equal(Object.keys((await readJson(`sched/${TOK}.json`, {}))).filter((k) => k.startsWith("f|")).length, 2);
  const r = await handleFollow("POST", { t: TOK, follows: [{ title: "הזמר במסכה", x: 1, u: NOW + 5000 }] }, mkDeps(sch, { now: () => NOW + 10000 }));
  assert.equal(r.json.n, 0);
  assert.equal(Object.keys((await readJson(`sched/${TOK}.json`, {}))).filter((k) => k.startsWith("f|")).length, 0, "התזמונים בוטלו");
  assert.equal(sch.calls.filter((c) => c.init.method === "DELETE").length, 2);
  assert.ok((await readJson(`fol/${TOK}.json`, null)).derived.length === 0);
});

test("POST /api/follow: תקרה 30, מכשיר ישן לא דורס חדש, ומחשב מנוי לא מיוצר ממסמכים למי שאין", async () => {
  await setSubs(TOK);
  const names = Array.from({ length: 35 }, (_, i) => "סדרה " + "אבגדהוזחטיכלמנסעפצקרשת"[i % 22] + "אבגדהוזחטיכלמנ"[Math.floor(i / 22) * 3 % 14] + i);
  const r = await handleFollow("POST", { t: TOK, follows: names.map((n) => fol(n)) }, mkDeps());
  assert.equal(r.json.n, MAX_FOLLOWS); assert.equal(r.json.capped, 5);
  const r2 = await handleFollow("POST", { t: TOK, follows: [fol(names[0], { u: 1, mode: "all" })] }, mkDeps());
  assert.equal(r2.json.follows.find((f) => f.title === names[0]).mode, "new", "u ישן לא דורס");
});

test("handler: 413 גוף גדול, 400 טוקן, 405, 429 לטוקן (30) ול-IP (60), GET עם no-store", async () => {
  const mk = (body, ip = "1.1.1.1") => ({ method: "POST", headers: { "x-real-ip": ip }, body });
  let r = mockRes(); await followH(mk({ t: TOK, follows: [{ title: "x".repeat(MAX_BODY) }] }), r); assert.equal(r.code, 413);
  r = mockRes(); await followH(mk({ t: "x", follows: [] }), r); assert.equal(r.code, 400);
  r = mockRes(); await followH({ method: "PUT", headers: {}, body: {} }, r); assert.equal(r.code, 405);
  r = mockRes(); await followH({ method: "POST", headers: {}, body: "{bad" }, r); assert.equal(r.code, 400);
  r = mockRes(); await followH({ method: "GET", headers: {}, query: { t: TOK } }, r); assert.equal(r.code, 200); assert.equal(r.headers["cache-control"], "no-store");
  _resetLimits();
  let last;
  for (let i = 0; i < 31; i++) { last = mockRes(); await followH(mk({ t: TOK, follows: [] }, "2.2.2." + i), last); }
  assert.equal(last.code, 429); assert.equal(last.headers["retry-after"], "60");
  _resetLimits();
  for (let i = 0; i < 61; i++) { last = mockRes(); await followH(mk({ t: "t" + String(i).padStart(24, "a"), follows: [] }, "3.3.3.3"), last); }
  assert.equal(last.code, 429);
});

// ---------- תקציב משותף ----------
const manualRem = (i, o = {}) => ({ k: `${100 + i}|${NOW + (i + 1) * 3600000}`, title: "ידנית " + i, ch: "c", ts: NOW + (i + 1) * 3600000, end: NOW + (i + 2) * 3600000, lead: 10, ...o });
const derivedAt = (i, o = {}) => ({ k: `f|abc|12|${NOW + (i + 1) * 60000}`, c: "12", title: "נגזרת " + i, ch: "קשת 12", ts: NOW + (i + 1) * 60000 * 5, end: NOW + (i + 1) * 60000 * 5 + 3600000, lead: 0, fl: 10, ...o });

test("reschedule: תזכורות שנגזרו נספרות באותה תקרת 60, ושל המשתמש קודמות גם אם רחוקות יותר", async () => {
  const sch = mkSched();
  const der = Array.from({ length: 50 }, (_, i) => ({ ...derivedAt(i), k: `f|abc|12|${NOW + (i + 1) * 300000}` }));
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [{ k: "abc", title: "אבג", u: NOW }], derived: der });
  const rems = Array.from({ length: 30 }, (_, i) => manualRem(i, { k: `u${i}`, ts: NOW + (100 + i) * 3600000, end: NOW + (101 + i) * 3600000 }));
  const out = await reschedule(TOK, rems, sch);
  assert.equal(out.total, MAX_SCHED); assert.equal(out.capped, 20);
  const keys = sch.calls.filter((c) => c.init.method === "POST").map((c) => JSON.parse(c.init.body).k);
  assert.equal(keys.filter((k) => k.startsWith("u")).length, 30, "כל 30 של המשתמש");
  assert.equal(keys.filter((k) => k.startsWith("f|")).length, 30, "הנגזרות ממלאות את השאר");
});

test("reschedule: תקציב יומי - נגזרות לא נוגעות ב-DER_RESERVE האחרונים", async () => {
  const sch = mkSched();
  await writeJson(`sched/${TOK}.json`, { __q: { d: Math.floor(NOW / 86400000), n: MAX_PUBLISH_DAY - DER_RESERVE } });
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [{ k: "abc", title: "אבג", u: NOW }], derived: [derivedAt(0), derivedAt(1)] });
  let out = await reschedule(TOK, [manualRem(0)], sch);
  assert.equal(out.added, 1, "רק של המשתמש"); assert.equal(out.limited, "daily");
  assert.ok(!sch.calls.some((c) => c.init.body && JSON.parse(c.init.body).k.startsWith("f|")));
});

test("reschedule: נגזרת כפולה לתזכורת ידנית באותו שידור לא מתוזמנת", async () => {
  const sch = mkSched();
  const d0 = derivedAt(0);
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [{ k: "abc", title: "אבג", u: NOW }], derived: [d0] });
  const out = await reschedule(TOK, [{ k: `12|${d0.ts}`, title: "נגזרת 0", ts: d0.ts, end: d0.end, lead: 5 }], sch);
  assert.equal(out.added, 1);
  assert.equal(JSON.parse(sch.calls[0].init.body).k, `12|${d0.ts}`);
});

// ---------- ירי ונודניק ----------
test("fire: מפתח f| נמצא דרך loadAll ונשלח כ-📺, ו-snooze מוצא אותו", async () => {
  const d0 = { ...derivedAt(0), title: "הזמר במסכה", ts: NOW + 600000, lead: 10 };
  await writeJson(`fol/${TOK}.json`, { v: 1, follows: [{ k: "abc", title: "אבג", u: NOW }], derived: [d0] });
  assert.equal((await load(TOK)).length, 0); assert.equal((await loadAll(TOK)).length, 1);
  const sent = [];
  const r = await handleFire({ t: TOK, k: d0.k, at: NOW }, { load: loadAll, sendTo: async (t, p) => { sent.push(p); return { ok: 1, total: 1 }; }, dropSched: async () => {}, reschedule: async () => ({}) }, NOW);
  assert.equal(r.json.ok, 1);
  assert.equal(sent[0].title, "📺 הזמר במסכה"); assert.match(sent[0].body, /^קשת 12 · (מתחיל|התחיל)/, "אותה צורה כמו תזכורת רגילה: ערוץ · מתי");
  assert.equal(sent[0].url, "./?rem=" + encodeURIComponent(d0.k)); assert.equal(sent[0].tag, d0.k);
  assert.equal((await handleFire({ t: TOK, k: "f|nope|1|2", at: NOW }, { load: loadAll }, NOW)).json.skipped, "cancelled");
  const calls = [];
  const sz = await handleSnooze({ k: d0.k, t: TOK, m: 5 }, { okToken, load: loadAll, readJson, writeJson, fetch: async (u, i) => { calls.push(i); return { ok: true, json: async () => ({ messageId: "z1" }) }; }, now: () => NOW });
  assert.equal(sz.status, 200); assert.equal(JSON.parse(calls[0].body).snooze, 1);
  assert.equal(remPayload({ ...d0, k: "5|1" }, { now: NOW }).title, "⏰ הזמר במסכה", "תזכורת רגילה לא השתנתה");
});

// ---------- cron ----------
const mkUsers = (n) => Array.from({ length: n }, (_, i) => ({ t: "u" + String(i).padStart(23, "0") + "x", doc: { v: 1, follows: [cleanOne(fol("הזמר במסכה"), NOW)], derived: [], chk: 0 } }));

test("runFollowCheck: מרענן, מדלג בלי פוש ומי שנבדק לאחרונה, שומר מצב, מכבד deadline והתחלה מסתובבת", async () => {
  const sch = mkSched();
  const users = mkUsers(4);
  for (const u of users.slice(0, 3)) await setSubs(u.t);
  for (const u of users) await writeJson(`fol/${u.t}.json`, u.doc);
  const base = { listFol: async () => users, getSubs: async (t) => (await readJson(`push/${t}.json`, [])), readJson, writeJson, load, reschedule: (t, rems) => reschedule(t, rems, sch), guide: gd, now: () => NOW };
  let out = await runFollowCheck({ ...base, deadline: Date.now() + 60000 });
  assert.deepEqual({ u: out.users, r: out.refreshed, s: out.skipped }, { u: 4, r: 3, s: 1 });
  const saved = await readJson(`fol/${users[0].t}.json`, null);
  assert.equal(saved.derived.length, 2); assert.equal(saved.chk, NOW);
  // פעם שנייה: נבדקו עכשיו -> מדולגים
  users.forEach((u, i) => { if (i < 3) u.doc.chk = NOW - 3600000; });
  out = await runFollowCheck({ ...base, deadline: Date.now() + 60000 });
  assert.equal(out.refreshed, 0);
  // deadline קרוב: partial בלי לעבד אף אחד
  users.forEach((u) => { u.doc.chk = 0; });
  out = await runFollowCheck({ ...base, deadline: Date.now() + 5000 });
  assert.equal(out.partial, true); assert.equal(out.refreshed, 0);
  // deadline נגמר באמצע הלולאה
  let calls = 0;
  const slow = { ...base, getSubs: async (t) => { if (++calls === 2) await new Promise((r) => setTimeout(r, 40)); return SUB; }, deadline: Date.now() + 10000 + 25 };
  out = await runFollowCheck(slow);
  assert.equal(out.partial, true); assert.ok(out.refreshed >= 1 && out.refreshed < 4, JSON.stringify(out));
});

test("runFollowCheck: כשל בלוח (guide=null) לא מוחק נגזרות קיימות ולא נחשב בדיקה מוצלחת", async () => {
  const sch = mkSched();
  const t = TOK, old = [{ ...derivedAt(0), k: `f|${seriesKey("הזמר במסכה")}|12|${NOW + 3600000}` }];
  await setSubs(t);
  const doc = { v: 1, follows: [cleanOne(fol("הזמר במסכה"), NOW)], derived: old, chk: 0 };
  await writeJson(`fol/${t}.json`, doc);
  const out = await refreshUser(t, doc, { guide: async () => null, load, readJson, writeJson, reschedule: (tt, rems) => reschedule(tt, rems, sch), now: () => NOW });
  assert.equal(out.stale, true);
  const saved = await readJson(`fol/${t}.json`, null);
  assert.deepEqual(saved.derived, old); assert.equal(saved.chk, 0);
});

test("cron /api/watch-check: שלב המעקב רץ, listFol מוצא משתמשים, והפלט כולל follow", async () => {
  await setSubs(TOK); await writeJson(`fol/${TOK}.json`, { v: 1, follows: [cleanOne(fol("הזמר במסכה"), NOW)], derived: [] });
  assert.deepEqual((await listFol()).map((u) => u.t), [TOK]);
  process.env.CRON_SECRET = "cs"; const res = mockRes();
  const sch = mkSched();
  await cronH({ method: "GET", headers: { authorization: "Bearer cs" } }, res, { listUsers: async () => [], listFol: async () => [{ t: TOK, doc: await readJson(`fol/${TOK}.json`, null) }], guide: gd, now: () => NOW, follow: { reschedule: (t, rems) => reschedule(t, rems, sch) }, cleanCache: undefined, fetch: async () => ({ ok: false }) });
  assert.equal(res.code, 200);
  assert.equal(res.body.follow.refreshed, 1);
  assert.equal((await readJson(`fol/${TOK}.json`, null)).derived.length > 0, true);
  assert.ok(sch.calls.some((c) => c.init.method === "POST"), "תוזמן ב-QStash");
  delete process.env.CRON_SECRET;
});

test("normT: זהה לנרמול של הלקוח והחיפוש בנטפליקס", () => {
  assert.equal(normT("Café — NCIS: 2"), "cafencis2"); assert.equal(normT("הזמר  במסכה!"), "הזמרבמסכה");
});
