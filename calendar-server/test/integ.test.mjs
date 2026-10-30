// node --test calendar-server/test/*.mjs  - אינטגרציה: תזכורת כפולה (k#s) מול האבטחה (JWT/סוד, תקרה, קצב)
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";

process.env.FIRE_SECRET = "test-secret-not-real";
process.env.QSTASH_TOKEN = "qs-test";
process.env.QSTASH_URL = "https://qstash.example";
process.env.QSTASH_CURRENT_SIGNING_KEY = "cur-key";
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.QSTASH_STRICT;
console.error = () => {};

const { reschedule, MAX_SCHED } = await import("../api/_push.js");
const { START_SUFFIX } = await import("../api/_rems.js");
const { default: fireH, handleFire } = await import("../api/fire.js");
const { handleSnooze } = await import("../api/_snz.js");
const snoozeH = (await import("../api/snooze.js")).default;
const { _resetLimits } = await import("../api/_guard.js");

const TOK = "abcdefghij0123456789abcd";
const NOW = 1_800_000_000_000;
const mockRes = () => { const r = { code: 200, headers: {}, body: undefined }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; }; r.status = (c) => { r.code = c; return r; }; r.json = (o) => { r.body = o; return r; }; r.end = () => r; return r; };
const mkReq = (o = {}) => ({ method: "POST", headers: {}, query: {}, body: {}, ...o });
const mkSched = () => {
  const store = {}, calls = [];
  return { store, calls, getSubs: async () => [{ endpoint: "https://fcm.googleapis.com/x", keys: {} }],
    readJson: async (p, d) => store[p] ?? d, writeJson: async (p, o) => { store[p] = JSON.parse(JSON.stringify(o)); },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ messageId: "m" + calls.length }) }; }, now: () => NOW };
};
const dblRem = (i, over = {}) => ({ k: `k${i}`, title: "t", ts: NOW + (i + 1) * 3600000, end: NOW + (i + 2) * 3600000, lead: 10, dbl: 1, ...over });
const bodyOf = (c) => JSON.parse(c.init.body);

test("reschedule: dbl מתזמן שתי הודעות (k ו-k#s עם st:1) והשנייה ב-ts", async () => {
  const d = mkSched(), r = dblRem(0);
  const out = await reschedule(TOK, [r], d);
  assert.equal(out.added, 2);
  const bodies = d.calls.map(bodyOf);
  assert.deepEqual(bodies.find((b) => b.st), { t: TOK, k: "k0", at: r.ts, st: 1 });
  assert.deepEqual(bodies.find((b) => !b.st), { t: TOK, k: "k0", at: r.ts - 600000 });
  const sched = d.store[`sched/${TOK}.json`];
  assert.ok(sched.k0 && sched["k0" + START_SUFFIX]);
  assert.equal(sched["k0" + START_SUFFIX].at, r.ts);
});

test("reschedule: k#s נספרות בתקרה של 60 (30 תזכורות כפולות = 60 הודעות), הקרובות קודם", async () => {
  const d = mkSched();
  const rems = Array.from({ length: 40 }, (_, i) => dblRem(i));
  const out = await reschedule(TOK, rems, d);
  assert.equal(MAX_SCHED, 60);
  assert.equal(out.added, 60); assert.equal(out.capped, 20); assert.equal(out.total, 60);
  assert.equal(d.calls.length, 60);
  const sched = d.store[`sched/${TOK}.json`];
  assert.ok(sched.k29 && sched["k29#s"] && !sched.k30 && !sched["k30#s"]);
});

test("reschedule: אין שינוי = אין קריאות; ביטול dbl מוחק רק את k#s", async () => {
  const d = mkSched(), r = dblRem(0);
  await reschedule(TOK, [r], d);
  d.calls.length = 0;
  assert.equal((await reschedule(TOK, [r], d)).added, 0); assert.equal(d.calls.length, 0);
  const out = await reschedule(TOK, [{ ...r, dbl: undefined }], d);
  assert.equal(out.removed, 1); assert.equal(out.added, 0);
  assert.equal(d.calls.length, 1); assert.equal(d.calls[0].init.method, "DELETE");
});

test("reschedule: תקציב יומי נספר לכל פרסום, גם k#s", async () => {
  const d = mkSched();
  await reschedule(TOK, [dblRem(0), dblRem(1)], d);
  assert.equal(d.store[`sched/${TOK}.json`].__q.n, 4);
});

test("handleFire st: נשלח פעם אחת, dropSched של k#s, ו-reschedule בלי k", async () => {
  const r = dblRem(0), order = [];
  const d = { load: async () => [r, dblRem(1)], sendTo: async () => { order.push("send"); return { ok: 1 }; }, dropSched: async (t, k) => order.push("drop:" + k),
    reschedule: async (t, rs) => { order.push("resched:" + rs.map((x) => x.k).join(",")); return {}; } };
  const out = await handleFire({ t: TOK, k: "k0", at: r.ts, st: 1 }, d, r.ts);
  assert.equal(out.status, 200);
  assert.deepEqual(order, ["send", "drop:k0#s", "resched:k1"]);
});

test("handleFire st: דילוג כש-dbl בוטל, lead=0, או הזמן השתנה; בלי שליחה", async () => {
  const sent = [];
  const mk = (r) => ({ load: async () => [r], sendTo: async () => { sent.push(1); return {}; }, dropSched: async () => {}, reschedule: async () => ({}) });
  const r = dblRem(0);
  for (const rr of [{ ...r, dbl: undefined }, { ...r, lead: 0 }, { ...r, ts: r.ts + 3600000, end: r.end + 3600000 }]) {
    const o = await handleFire({ t: TOK, k: "k0", at: r.ts, st: 1 }, mk(rr), r.ts);
    assert.deepEqual(o.json, { skipped: "changed" });
  }
  assert.equal(sent.length, 0);
});

test("handleFire רגיל של dbl: k#s נשמרת ו-k לא מתוזמנת שוב (אין כפל); ירי ההתחלה מנקה הכול", async () => {
  const r = dblRem(0), d = mkSched();
  await reschedule(TOK, [r], d); // k + k#s מתוזמנות
  d.calls.length = 0;
  const fireNow = r.ts - 600000;
  const fd = { load: async () => [r], sendTo: async () => ({ ok: 1 }),
    dropSched: async (t, k) => { const s = d.store[`sched/${TOK}.json`]; delete s[k]; },
    reschedule: (t, rs) => reschedule(t, rs, { ...d, now: () => fireNow }) };
  const o = await handleFire({ t: TOK, k: "k0", at: fireNow }, fd, fireNow);
  assert.equal(o.status, 200);
  assert.equal(d.calls.length, 0, "בלי פרסום ובלי מחיקה: " + JSON.stringify(d.calls.map((c) => c.init.method)));
  const sched = d.store[`sched/${TOK}.json`];
  assert.ok(!sched.k0 && sched["k0#s"]);
  const stNow = r.ts;
  const fd2 = { ...fd, reschedule: (t, rs) => reschedule(t, rs, { ...d, now: () => stNow }) };
  await handleFire({ t: TOK, k: "k0", at: r.ts, st: 1 }, fd2, stNow);
  const s2 = d.store[`sched/${TOK}.json`];
  assert.deepEqual(Object.keys(s2).filter((k) => k !== "__q"), []);
});

// ---- אימות /api/fire עם st: JWT וסוד ישן; בלי אחסון מוגדר ההגעה ל-handleFire מסתיימת בשגיאה גנרית (לא 403) ----
const b64u = (x) => Buffer.from(x).toString("base64url");
function jwt(body) {
  const now = Math.floor(Date.now() / 1000), h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ iss: "Upstash", sub: "https://tv-guide-cal.vercel.app/api/fire", exp: now + 300, nbf: now - 5, iat: now, jti: "j", body: createHash("sha256").update(body).digest("base64url") }));
  return `${h}.${p}.${createHmac("sha256", "cur-key").update(h + "." + p).digest("base64url")}`;
}
test("fire עם st: בלי אימות 403; סוד ישן ו-JWT עוברים אימות (לא 403)", async () => {
  const body = JSON.stringify({ t: TOK, k: "k0", at: NOW, st: 1 });
  let r = mockRes(); await fireH(mkReq({ body }), r); assert.equal(r.code, 403);
  r = mockRes(); await fireH(mkReq({ body, headers: { "upstash-signature": "a.b.c" } }), r); assert.equal(r.code, 403);
  r = mockRes(); await fireH(mkReq({ body, query: { s: "test-secret-not-real" } }), r); assert.notEqual(r.code, 403, "legacy ?s=");
  r = mockRes(); await fireH(mkReq({ body, headers: { "upstash-signature": jwt(body) } }), r); assert.notEqual(r.code, 403, "JWT");
  r = mockRes(); await fireH(mkReq({ body: body + " ", headers: { "upstash-signature": jwt(body) } }), r); assert.equal(r.code, 403, "גוף ששונה");
});

// ---- ביטול נודניק: אותו אימות ואותה הגבלת קצב ----
const rem = { k: "5|1", title: "x", ts: NOW + 600000, end: NOW + 4200000, lead: 10 };
const sdeps = (over = {}) => { const store = {}, calls = []; return { calls, store, now: () => NOW, okToken: (t) => /^[a-z0-9]{24,48}$/.test(t || ""), load: async () => [rem], readJson: async (p, d) => store[p] ?? d, writeJson: async (p, o) => { store[p] = o; }, fetch: async (u, i) => { calls.push({ u, i }); return { ok: true, status: 200, json: async () => ({ messageId: "m1" }) }; }, ...over }; };
test("cancel: חתימה שגויה 403, בלי אימות 403, טוקן לא תקין 400; לא נוגע ב-QStash", async () => {
  const d = sdeps();
  assert.equal((await handleSnooze({ k: rem.k, cancel: 1, m: 0 }, d)).status, 403);
  assert.equal((await handleSnooze({ k: rem.k, cancel: 1, m: 0, o: "x", a: NOW, s: "bad" }, d)).status, 403);
  assert.equal((await handleSnooze({ k: rem.k, cancel: 1, m: 0, t: "BAD" }, d)).status, 400);
  assert.equal(d.calls.length, 0);
});
test("cancel: מוגבל בקצב אחרי אימות (429) ולפני כל גישה ל-QStash", async () => {
  const d = sdeps({ rate: () => false });
  const r = await handleSnooze({ k: rem.k, cancel: 1, m: 0, t: TOK }, d);
  assert.equal(r.status, 429); assert.deepEqual(r.json, { error: "rate" });
  assert.equal(d.calls.length, 0);
});
test("cancel דרך ה-handler: מגבלת קצב לטוקן (20 לדקה) חלה", async () => {
  _resetLimits();
  const codes = [];
  for (let i = 0; i < 24; i++) { const r = mockRes(); await snoozeH(mkReq({ body: { k: rem.k, cancel: 1, m: 0, t: TOK }, headers: { "x-forwarded-for": "9.9.9.9" } }), r); codes.push(r.code); }
  assert.ok(codes.filter((c) => c === 429).length >= 2, codes.join(","));
  _resetLimits();
});

// ---- תיקוני סוכן השטן ----
const { dropSched } = await import("../api/_push.js");
test("ירי מאוחר של ההתראה המוקדמת (אחרי ts): stOnly שומר את k#s ולא מפרסם אותה מחדש", async () => {
  const r = dblRem(0), d = mkSched();
  await reschedule(TOK, [r], d);
  d.calls.length = 0;
  const late = r.ts + 60000; // דקה אחרי ההתחלה
  const fd = { load: async () => [r], sendTo: async () => ({ ok: 1 }),
    dropSched: (t, k) => dropSched(t, k, { ...d, now: () => late }),
    reschedule: (t, rs) => reschedule(t, rs, { ...d, now: () => late }) };
  await handleFire({ t: TOK, k: "k0", at: r.ts - 600000 }, fd, late);
  assert.equal(d.calls.length, 0, "בלי מחיקה ובלי פרסום");
  assert.ok(d.store[`sched/${TOK}.json`]["k0#s"]);
  // k#s שכבר נמחקה (נורתה) לא מתפרסמת מחדש ע"י stOnly
  delete d.store[`sched/${TOK}.json`]["k0#s"];
  await reschedule(TOK, [{ ...r, stOnly: 1 }], { ...d, now: () => late });
  assert.equal(d.calls.length, 0);
});

test("שמירה חוזרת של הרשימה תוך שניות אחרי ירי לא מתזמנת מחדש את ההתראה שנורתה (__f)", async () => {
  const r = dblRem(0, { dbl: undefined }), d = mkSched();
  await reschedule(TOK, [r], d);
  const fireAt = r.ts - 600000;
  await dropSched(TOK, "k0", { ...d, now: () => fireAt });
  d.calls.length = 0;
  await reschedule(TOK, [r], { ...d, now: () => fireAt + 10000 });
  assert.equal(d.calls.length, 0, "לא מפרסם שוב");
  const out = await reschedule(TOK, [r], { ...d, now: () => fireAt + 180000 });
  assert.equal(out.added, 0);
  assert.ok(!d.store[`sched/${TOK}.json`].__f, "הרישום פג");
  // שינוי זמן כן מתזמן מחדש
  const moved = { ...r, ts: r.ts + 7200000, end: r.end + 7200000 };
  await dropSched(TOK, "k0", { ...d, now: () => fireAt }); // אין רשומה, no-op
  const o2 = await reschedule(TOK, [moved], { ...d, now: () => fireAt + 5000 });
  assert.equal(o2.added, 1);
});
