// node --test calendar-server/test/*.mjs  - 🌙 הערב שלך ב-19:00: טקסט ההתראה, שעון קיץ/חורף, בלי פריטים = בלי שליחה, לעולם לא פעמיים ביום, תזמון והמשך
import test from "node:test";
import assert from "node:assert/strict";

console.error = () => {}; console.log = () => {};
const T = await import("../api/_tonight.js");
const { ilToMs } = await import("../api/_series.js");
const { default: cronH } = await import("../api/watch-check.js");

const LRM = "‎";
const TOK = "abcdefghij0123456789abcd", TOK2 = "zyxwvutsrq9876543210zyxw", TOK3 = "mnopqrstuv0123456789mnop", TOK4 = "qqqqqqqqqq0123456789qqqq", TOK5 = "rrrrrrrrrr0123456789rrrr";
const DAY = "2026-11-10", NOW = ilToMs(DAY + "T19:00"); // שלישי, שעון חורף: 17:00 UTC
const clone = (o) => JSON.parse(JSON.stringify(o));

// לוח קטן: קשת (בגיבוי "3819", בלוח שם וואלה "קשת" -> "קשת 12"), ספורט 5+ ושידור כפול SD/HD שמתאחד
function guide(day = DAY) {
  const P = (ch, hm, title, desc) => ({ ch, start: day + "T" + hm, title, ...(desc ? { desc } : {}) });
  return {
    updated: day + "T03:00",
    channels: [{ id: "3819", name: "קשת" }, { id: "3830", name: "ספורט 5+" }, { id: "3831", name: "ספורט 5+ HD" }, { id: "3840", name: "ערוץ E!" }],
    programs: [
      P("3819", "18:00", "שבע עם"), P("3819", "20:00", "המהדורה המרכזית"), P("3819", "21:00", "הכלה מאיסטנבול", "פרק חדש"), P("3819", "22:00", "ארץ נהדרת"), P("3819", "23:30", "לילה"),
      P("3830", "18:30", "אולפן ספורט"), P("3830", "20:30", "ליגת העל: מ. חיפה - ה. באר שבע"), P("3830", "22:30", "מגזין"),
      P("3831", "20:30", "ליגת העל: מ. חיפה - ה. באר שבע"), // כפילות של אותו ערוץ (HD): מתאחדת
      P("3840", "19:30", "E! News"), P("3840", "21:30", "סלבס"),
    ],
  };
}
const bk = (o) => ({ at: 1, data: { "tvg.sel": JSON.stringify(["3819", "3830", "3840"]), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])) } });
function world(users, g = guide()) {
  const s = {}, sent = [];
  for (const [t, data, rems] of users) { s[`backup/${t}.json`] = data; s[`push/${t}.json`] = [{ endpoint: "https://fcm.googleapis.com/x" }]; if (rems) s[`rems/${t}.json`] = rems; }
  const list = async (col) => Object.keys(s).filter((k) => k.startsWith(col + "/")).map((k) => ({ id: k.slice(col.length + 1).replace(/\.json$/, ""), value: clone(s[k]) }));
  const d = {
    list, readJson: async (p, dd) => (p in s ? clone(s[p]) : dd), writeJson: async (p, o) => { s[p] = clone(o); },
    load: async (t) => s[`rems/${t}.json`] || [], sendTo: async (t, pl) => { sent.push({ t, ...pl }); return { ok: 1, total: 1 }; },
    guide: async () => g, now: () => NOW,
  };
  return { s, sent, d };
}

test("שעון קיץ/חורף: 19:00 בישראל = 16:00 UTC בקיץ, 17:00 UTC בחורף, גם ביום המעבר", () => {
  const utc = (ds) => new Date(T.tnAt(Date.parse(ds + "T09:00:00Z"))).toISOString().slice(11, 16);
  assert.equal(utc("2026-07-01"), "16:00");
  assert.equal(utc("2026-12-01"), "17:00");
  assert.equal(utc("2026-03-27"), "16:00"); // שישי: מעבר לשעון קיץ ב-02:00 באותו לילה
  assert.equal(utc("2026-03-26"), "17:00");
  assert.equal(utc("2026-10-25"), "17:00"); // ראשון: חזרה לשעון חורף ב-02:00
  assert.equal(utc("2026-10-24"), "16:00");
  // סוף הערב 04:00 גם כשהלילה חוצה מעבר שעון
  assert.equal(new Date(T.tonightEnd(ilToMs("2026-10-24T19:00"))).toISOString(), "2026-10-25T02:00:00.000Z");
  assert.equal(new Date(T.tonightEnd(ilToMs("2026-10-25T00:30"))).toISOString(), "2026-10-25T02:00:00.000Z"); // אחרי חצות: 04:00 של אותו לילה (כבר +02:00)
});

test("טקסט ההתראה: 'שעה · כותרת · ערוץ', ערוצים מאוחדים, LRM סביב ספרות ולטינית, תג וכתובת", async () => {
  const w = world([[TOK, bk({ "tvg.fav": ["הכלה מאיסטנבול", "סלבס"], "tvg.topics": ["הפועל באר שבע"] })]]);
  const r = await T.runTonight(w.d);
  assert.equal(r.sent, 1); assert.equal(w.sent.length, 1);
  const p = w.sent[0];
  assert.equal(p.title, "🌙 הערב שלך");
  assert.equal(p.tag, "tn19"); assert.equal(p.url, "./?tab=dial&tn=1");
  assert.deepEqual(p.body.split("\n"), [
    "20:30 · ליגת העל: מ. חיפה - ה. באר שבע · ספורט " + LRM + "5+" + LRM, // נושא (ה. באר שבע = הפועל באר שבע), פעם אחת למרות ה-HD
    "21:00 · הכלה מאיסטנבול · קשת " + LRM + "12" + LRM,
    "21:30 · סלבס · ערוץ " + LRM + "E!" + LRM,
  ]);
  assert.deepEqual(w.s[`tn/${TOK}.json`], { d: DAY, at: NOW, n: 3 });
});

test("ועוד N: עד 3 שורות; 'ועוד אחד' / 'ועוד 2'", async () => {
  const four = world([[TOK, bk({ "tvg.fav": ["המהדורה המרכזית", "הכלה מאיסטנבול", "ארץ נהדרת", "לילה"] })]]);
  await T.runTonight(four.d);
  assert.deepEqual(four.sent[0].body.split("\n").slice(3), ["ועוד אחד"]);
  const five = world([[TOK, bk({ "tvg.fav": ["המהדורה המרכזית", "הכלה מאיסטנבול", "ארץ נהדרת", "לילה", "סלבס"] })]]);
  await T.runTonight(five.d);
  const lines = five.sent[0].body.split("\n");
  assert.equal(lines.length, 4); assert.equal(lines[3], "ועוד 2");
  assert.ok(lines[0].startsWith("20:00 · המהדורה המרכזית"));
});

test("בלי פריטים הערב = בלי שליחה; כבוי; שידור שכבר התחיל; על הכול כבר יש תזכורת / מעקב", async () => {
  const w = world([
    [TOK, bk({ "tvg.fav": ["לא משודר בכלל"] })],                                     // אין פריטים
    [TOK2, bk({ "tvg.fav": ["הכלה מאיסטנבול"], "tvg.tn19": "0" })],                  // כבוי בהגדרות
    [TOK3, bk({ "tvg.fav": ["אולפן ספורט"] })],                                       // 18:30-20:30: התחיל לפני חצי שעה (בכרטיס "משודר עכשיו"), לא בהתראה
    [TOK4, bk({ "tvg.fav": ["הכלה מאיסטנבול"] }), [{ k: "3819|" + ilToMs(DAY + "T21:00"), ts: ilToMs(DAY + "T21:00") }]], // כבר יש תזכורת
    [TOK5, bk({ "tvg.fol": [{ title: "ארץ נהדרת", mode: "new", u: 1 }] })],         // סדרה במעקב: תזכורת אוטומטית
  ]);
  const r = await T.runTonight(w.d);
  assert.equal(w.sent.length, 0);
  assert.equal(r.sent, 0); assert.equal(r.off, 1); assert.equal(r.none, 1); assert.equal(r.covered, 3);
  assert.equal(Object.keys(w.s).filter((k) => k.startsWith("tn/")).length, 0, "לא מסמנים מי שלא קיבל");
  // בלי מועדפים/נושאים/מעקב בכלל: לא קוראים אפילו את התזכורות
  const w2 = world([[TOK, bk({})]]); let loads = 0; w2.d.load = async () => { loads++; return []; };
  assert.equal((await T.runTonight(w2.d)).none, 1); assert.equal(loads, 0);
  // ברירת מחדל: בלי המפתח = פעיל
  const w3 = world([[TOK, bk({ "tvg.fav": ["הכלה מאיסטנבול"] })]]); await T.runTonight(w3.d); assert.equal(w3.sent.length, 1);
});

test("לעולם לא פעמיים ביום: ריצה חוזרת (ניסיון חוזר של QStash) מדלגת; למחרת שולחים שוב", async () => {
  const w = world([[TOK, bk({ "tvg.fav": ["הכלה מאיסטנבול"] })]]);
  await T.runTonight(w.d);
  const r2 = await T.runTonight(w.d);
  assert.equal(w.sent.length, 1); assert.equal(r2.dup, 1);
  // הסימון נכתב לפני השליחה: גם שליחה שזרקה לא תישלח שוב
  const w4 = world([[TOK, bk({ "tvg.fav": ["הכלה מאיסטנבול"] })]]); let n = 0;
  w4.d.sendTo = async () => { n++; throw new Error("push down"); };
  assert.equal((await T.runTonight(w4.d)).fail, 1); await T.runTonight(w4.d); assert.equal(n, 1);
  // יום אחר
  const D2 = "2026-11-11", w2 = world([[TOK, bk({ "tvg.fav": ["הכלה מאיסטנבול"] })]], guide(D2));
  w2.s[`tn/${TOK}.json`] = { d: DAY, at: NOW }; w2.d.now = () => ilToMs(D2 + "T19:00");
  await T.runTonight(w2.d); assert.equal(w2.sent.length, 1);
});

test("חלון זמן והודעה ישנה: לא שולחים ב-23:00 או בהודעה של אתמול; משתמשים בלי פוש לא נבדקים", async () => {
  const w = world([[TOK, bk({ "tvg.fav": ["לילה"] })]]);
  w.d.now = () => ilToMs(DAY + "T23:00");
  assert.equal((await T.runTonight(w.d)).skipped, "window");
  w.d.now = () => NOW;
  assert.equal((await T.runTonight({ ...w.d, day: "2026-11-09" })).skipped, "stale");
  w.s[`push/${TOK}.json`] = [];
  const r = await T.runTonight(w.d); assert.equal(r.users, 0); assert.equal(w.sent.length, 0);
  const w2 = world([[TOK, bk({ "tvg.fav": ["לילה"] })]]); w2.d.guide = async () => null;
  assert.equal((await T.runTonight(w2.d)).skipped, "no guide");
});

test("scheduleTonight: הודעה אחת ל-19:00 היום (not-before), פעם ביום, לא אחרי 19:00, מתג חירום", async () => {
  const s = {}, calls = [];
  const d = { readJson: async (p, dd) => (p in s ? clone(s[p]) : dd), writeJson: async (p, o) => { s[p] = clone(o); }, token: "qs",
    fetch: async (u, o) => { calls.push({ u, o }); return { ok: true, json: async () => ({ messageId: "msg_" + calls.length }) }; } };
  const morning = Date.parse("2026-07-01T06:00:00Z"); // קיץ
  const r = await T.scheduleTonight({ ...d, now: () => morning });
  assert.equal(r.scheduled, "2026-07-01"); assert.equal(calls.length, 1);
  assert.match(calls[0].u, /\/v2\/publish\/https:\/\/tv-guide-cal\.vercel\.app\/api\/fire/);
  assert.equal(calls[0].o.headers["upstash-not-before"], String(Date.parse("2026-07-01T16:00:00Z") / 1000));
  assert.deepEqual(JSON.parse(calls[0].o.body), { tn: 1, d: "2026-07-01" });
  assert.equal((await T.scheduleTonight({ ...d, now: () => morning + 3600000 })).dup, true); assert.equal(calls.length, 1);
  const winter = Date.parse("2026-12-01T06:00:00Z");
  await T.scheduleTonight({ ...d, now: () => winter });
  assert.equal(calls[1].o.headers["upstash-not-before"], String(Date.parse("2026-12-01T17:00:00Z") / 1000));
  assert.equal((await T.scheduleTonight({ ...d, now: () => Date.parse("2026-12-02T17:30:00Z") })).skipped, "late");
  assert.equal((await T.scheduleTonight({ ...d, token: "" })).skipped, "no QSTASH_TOKEN");
  process.env.TN19_OFF = "1"; assert.equal((await T.scheduleTonight({ ...d, now: () => Date.parse("2026-12-03T06:00:00Z") })).skipped, "off"); delete process.env.TN19_OFF;
  const bad = await T.scheduleTonight({ ...d, now: () => Date.parse("2026-12-04T06:00:00Z"), fetch: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal(bad.error, "publish failed"); assert.equal(s[T.TN_STATS].d, "2026-12-01", "כישלון לא נרשם כהצלחה");
});

test("fireTonight: נגמר הזמן -> הודעת המשך מאותה נקודה, בלי כפילויות; קלט שגוי -> 400", async () => {
  const w = world([[TOK, bk({ "tvg.fav": ["הכלה מאיסטנבול"] })], [TOK2, bk({ "tvg.fav": ["סלבס"] })]]);
  const pubs = []; let clock = 0;
  const d = { ...w.d, token: "qs", clock: () => clock, deadline: 1, fetch: async (u, o) => { pubs.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ messageId: "m" }) }; } };
  w.d.sendTo = async (t, pl) => { w.sent.push({ t, ...pl }); clock = 5; return { ok: 1 }; }; d.sendTo = w.d.sendTo;
  const r = await T.fireTonight({ tn: 1, d: DAY }, d);
  assert.equal(r.status, 200); assert.equal(r.json.sent, 1); assert.equal(r.json.more, 1); assert.equal(r.json.next, "m");
  assert.deepEqual(pubs[0], { tn: 1, d: DAY, from: 1 });
  clock = 0; const r2 = await T.fireTonight(pubs[0], d);
  assert.equal(r2.json.sent, 1); assert.equal(r2.json.more, undefined);
  assert.deepEqual(w.sent.map((x) => x.t).sort(), [TOK, TOK2].sort());
  assert.equal((await T.fireTonight({ tn: 1, d: "x" }, d)).status, 400);
});

test("watch-check: ה-cron היומי מתזמן את 🌙 הערב שלך (וכישלון שם לא מפיל את הבדיקה)", async () => {
  process.env.CRON_SECRET = "cs";
  const mk = () => { const r = { code: 200, setHeader() {}, status(c) { r.code = c; return r; }, json(o) { r.body = o; return r; }, end() { return r; } }; return r; };
  const base = { listUsers: async () => [], listFol: async () => [], guide: async () => null, cleanCache: undefined, cleanParties: async () => 0, fetch: async () => ({ ok: false, json: async () => ({}) }) };
  let got = null;
  const r = mk(); await cronH({ method: "GET", headers: { authorization: "Bearer cs" } }, r, { ...base, scheduleTonight: async (o) => { got = o; return { scheduled: DAY }; } });
  assert.equal(r.code, 200); assert.deepEqual(r.body.tn, { scheduled: DAY }); assert.equal(typeof got.readJson, "function");
  const r2 = mk(); await cronH({ method: "GET", headers: { authorization: "Bearer cs" } }, r2, { ...base, scheduleTonight: async () => { throw new Error("x"); } });
  assert.equal(r2.code, 200); assert.deepEqual(r2.body.tn, { error: true });
});

test("/api/fire {tn:1}: בלי סוד/חתימה 403; עם הסוד מנותב ל-🌙 (הודעה של יום אחר = דילוג, בלי לגעת באחסון)", async () => {
  process.env.FIRE_SECRET = "test-secret-not-real";
  const { default: fireH } = await import("../api/fire.js");
  const mk = () => { const r = { code: 200, setHeader() {}, status(c) { r.code = c; return r; }, json(o) { r.body = o; return r; }, end() { return r; } }; return r; };
  const req = (o) => ({ method: "POST", headers: {}, query: {}, body: { tn: 1, d: "2020-01-01" }, ...o });
  let r = mk(); await fireH(req({}), r); assert.equal(r.code, 403);
  r = mk(); await fireH(req({ query: { s: "test-secret-not-real" } }), r); assert.equal(r.code, 200); assert.deepEqual(r.body, { skipped: "stale" });
  r = mk(); await fireH(req({ query: { s: "test-secret-not-real" }, body: { tn: 1, d: "bad" } }), r); assert.equal(r.code, 400);
});
