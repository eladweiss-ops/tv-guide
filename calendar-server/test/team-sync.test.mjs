// node --test calendar-server/test/*.mjs  - ⚽ תזכורות קבוצה בצד השרת: הוספה, אי-כפילות, תיאום מול שמירות של הלקוח (POST /api/rems),
// מחיקה בידי המשתמש נשארת מחיקה, ירי ונודניק מוצאים את התזכורת, נקודת הקצה (סוד, לוח ישן, ריצה כפולה, מתג חירום).
import test from "node:test";
import assert from "node:assert/strict";

process.env.QSTASH_TOKEN = "qs-test";
process.env.QSTASH_URL = "https://qstash.example";
process.env.FIRE_SECRET = "test-secret-not-real";
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.TEAMSYNC_OFF;
console.error = () => {}; console.log = () => {};

import { memBackend } from "./helpers/fakedb.mjs";
const mem = memBackend();
(await import("../api/_db.js"))._setBackend(mem);
const db = await import("../api/_db.js");
const { ilToMs } = await import("../api/_series.js");
const { prepGuide } = await import("../api/_tonight.js");
const team = await import("../api/_team.js");
const { reschedule } = await import("../api/_push.js");
const { saveRems } = await import("../api/rems.js");
const { load, loadAll, loadOwn } = await import("../api/_store.js");
const { handleFire } = await import("../api/fire.js");
const wc = await import("../api/watch-check.js");
const { readLog } = await import("../api/_rlog.js");
const { _resetLimits } = await import("../api/_guard.js");

const TOK = "teamtok0123456789abcdefgh";
const NOW = ilToMs("2026-11-29T12:00");
// לוח קטן: משחק של מכבי חיפה מחר ב-21:00 בשני ערוצים (ספורט 5 ו-5 LIVE), שידור חוזר בלילה, ומשחק כדורסל של מכבי ת"א
const GUIDE = {
  updated: "2026-11-29T03:10:00.000Z",
  channels: [{ id: "289", name: "ערוץ הספורט" }, { id: "301", name: "5+ LIVE" }, { id: "3819", name: "קשת" }, { id: "520", name: "ספורט 1" }],
  programs: [
    { ch: "289", start: "2026-11-30T20:30", title: "אולפן ליגת העל" },
    { ch: "289", start: "2026-11-30T21:00", title: "ישיר! ליגת ווינר: מכבי חיפה - ביתר ירושלים", desc: "כדורגל, ליגת העל", lv: 1 },
    { ch: "289", start: "2026-11-30T23:00", title: "מבזק" },
    { ch: "289", start: "2026-12-01T02:00", title: "ליגת ווינר: מכבי חיפה - ביתר ירושלים (ש.ח)", desc: "כדורגל" },
    { ch: "289", start: "2026-12-01T04:00", title: "סגירה" },
    { ch: "301", start: "2026-11-30T20:55", title: "ישיר! ליגת ווינר: מכבי חיפה - ביתר ירושלים", desc: "כדורגל", lv: 1 },
    { ch: "301", start: "2026-11-30T23:00", title: "סגירה" },
    { ch: "520", start: "2026-12-02T20:00", title: "יורוליג: מכבי ת\"א - ריאל מדריד", desc: "כדורסל, יורוליג", lv: 1 },
    { ch: "520", start: "2026-12-02T22:00", title: "סגירה" },
    { ch: "3819", start: "2026-11-29T20:00", title: "חדשות" },
  ],
};
const G = prepGuide(GUIDE);
const BK = (o = {}) => ({ at: 1, data: { "tvg.sel": JSON.stringify(["289", "3819"]), "tvg.teams": JSON.stringify([{ n: "מכבי חיפה", sport: "" }]), "tvg.teamAuto": "1", "tvg.lead": "30", ...o } });
const SUB = [{ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }];
const KEY = "289|" + ilToMs("2026-11-30T21:00"), ALT = "301|" + ilToMs("2026-11-30T20:55");

let calls = [];
const fx = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ messageId: "m" + calls.length }) }; };
const resched = (t, rems) => reschedule(t, rems, { fetch: fx, now: () => NOW });
const deps = () => ({ readJson: db.readJson, writeJson: db.writeJson, loadOwn, reschedule: resched, now: () => NOW });
async function reset(bk = BK()) {
  mem.m.clear(); calls = []; _resetLimits();
  await db.writeJson(`push/${TOK}.json`, SUB);
  if (bk) await db.writeJson(`backup/${TOK}.json`, bk);
}
const published = () => calls.filter((c) => /\/v2\/publish\//.test(c.url)).map((c) => JSON.parse(c.init.body));
const syncWith = async () => { const b = await db.readJson(`backup/${TOK}.json`, null); return team.syncUser(TOK, b.data, G, NOW, deps()); };

test("syncUser: מוסיף תזכורת אחת למשחק (ערוץ מהערוצים שלי, בלי שידור חוזר), עם lead של המשתמש, ומתזמן ב-QStash", async () => {
  await reset();
  const r = await syncWith();
  assert.equal(r.added, 1);
  const tm = await db.readJson(team.tmPath(TOK), null);
  assert.equal(tm.pend.length, 1);
  const p = tm.pend[0];
  assert.equal(p.k, KEY); assert.equal(p.id, "289"); assert.equal(p.ch, "ספורט 5"); assert.equal(p.lead, 30); assert.equal(p.srv, 1);
  assert.deepEqual(p.ks.sort(), [ALT, KEY].sort());
  assert.equal(p.end, ilToMs("2026-11-30T23:00"));
  assert.ok(tm.done.includes(KEY) && tm.done.includes(ALT));
  const pub = published();
  assert.equal(pub.length, 1); assert.deepEqual(pub[0], { t: TOK, k: KEY, at: p.ts - 30 * 60000 });
  // היומן: נוצרה בידי השרת, ותוזמנה
  const lg = await readLog(TOK, NOW);
  assert.ok(lg.keys[KEY].some((x) => x.e === "created" && x.by === "server"));
  assert.ok(lg.keys[KEY].some((x) => x.e === "sched" && x.id && x.fa === p.ts - 30 * 60000));
});

test("syncUser: אידמפוטנטי – ריצה שנייה לא מוסיפה ולא מפרסמת שוב", async () => {
  await reset();
  await syncWith(); const n = calls.length;
  const r = await syncWith();
  assert.equal(r.added, 0); assert.equal(calls.length, n);
});

test("syncUser: לא מוסיף כשכבוי, כשיש כבר תזכורת (גם בערוץ המקביל), או כשהמפתח ב-tvg.teamX של הלקוח", async () => {
  await reset(BK({ "tvg.teamAuto": "0" }));
  assert.equal((await syncWith()).skipped, "off");
  await reset(BK({ "tvg.teams": "[]" }));
  assert.equal((await syncWith()).skipped, "off");
  await reset();
  await db.writeJson(`rems/${TOK}.json`, [{ k: ALT, title: "x", ch: "5 LIVE", ts: ilToMs("2026-11-30T20:55"), end: ilToMs("2026-11-30T23:00"), lead: 10 }]);
  assert.equal((await syncWith()).added, 0);
  await reset(BK({ "tvg.teamX": JSON.stringify([ALT]) }));
  assert.equal((await syncWith()).added, 0);
});

test("syncUser: ענף – קבוצה בכדורסל לא מקבלת את משחק הכדורגל; 'שניהם' מקבל", async () => {
  await reset(BK({ "tvg.teams": JSON.stringify([{ n: "מכבי חיפה", sport: "bb" }, { n: "מכבי תל אביב", sport: "bb" }]) }));
  await syncWith();
  const tm = await db.readJson(team.tmPath(TOK), null);
  assert.deepEqual(tm.pend.map((p) => p.k), ["520|" + ilToMs("2026-12-02T20:00")]);
});

test("תיאום: שמירה של לקוח ישן (בלי tx) לא מוחקת תזכורת של השרת; היא חוזרת ב-srv ונשארת מתוזמנת", async () => {
  await reset(); await syncWith(); calls = [];
  const out = await saveRems({ t: TOK, rems: [] }, { reschedule: resched, now: () => NOW });
  assert.deepEqual(out.srv.map((x) => x.k), [KEY]);
  assert.equal(calls.filter((c) => c.init.method === "DELETE").length, 0, "התזמון לא בוטל");
  assert.deepEqual((await load(TOK)).map((r) => r.k), [KEY]); // GET /api/rems / יומן מנוי / ירי רואים אותה
});

test("תיאום: הלקוח קלט (המפתח ברשימה שלו) → יורדת מהממתינות, בלי תזמון כפול (אותו מפתח)", async () => {
  await reset(); await syncWith(); calls = [];
  const p = (await db.readJson(team.tmPath(TOK), null)).pend[0];
  const rec = { k: p.k, id: p.id, ts: p.ts, end: p.end, title: p.title, ch: p.ch, desc: p.desc, lead: p.lead };
  const out = await saveRems({ t: TOK, rems: [rec], tx: [KEY, ALT] }, { reschedule: resched, now: () => NOW });
  assert.equal(out.srv, undefined);
  assert.equal((await db.readJson(team.tmPath(TOK), null)).pend.length, 0);
  assert.equal(calls.length, 0, "אין פרסום ואין מחיקה: אותה הודעה מתוזמנת");
  assert.ok((await readLog(TOK, NOW)).keys[KEY].some((x) => x.e === "adopted"));
});

test("תיאום: המשתמש מחק (לא ברשימה, כן ב-tx) → התזמון נמחק, והשרת לא מוסיף שוב גם בריצה הבאה", async () => {
  await reset(); await syncWith();
  const p = (await db.readJson(team.tmPath(TOK), null)).pend[0];
  const rec = { k: p.k, title: p.title, ch: p.ch, ts: p.ts, end: p.end, lead: p.lead };
  await saveRems({ t: TOK, rems: [rec], tx: [KEY, ALT] }, { reschedule: resched, now: () => NOW }); // קלט
  calls = [];
  await saveRems({ t: TOK, rems: [], tx: [KEY, ALT] }, { reschedule: resched, now: () => NOW }); // מחק
  assert.equal(calls.filter((c) => c.init.method === "DELETE").length, 1, "ההודעה ב-QStash בוטלה");
  // הגיבוי של הלקוח עוד לא התעדכן (בלי teamX) – עדיין לא מוסיפים: done של השרת
  calls = [];
  assert.equal((await syncWith()).added, 0);
  assert.equal(published().length, 0);
  assert.deepEqual(await load(TOK), []);
  assert.ok((await readLog(TOK, NOW)).keys[KEY].some((x) => x.e === "deleted" && x.by === "client"));
});

test("תיאום: מחיקה לפני שהלקוח שמר אי פעם (רק tx) → dismissed, והתזמון נמחק", async () => {
  await reset(); await syncWith(); calls = [];
  const out = await saveRems({ t: TOK, rems: [], tx: [ALT] }, { reschedule: resched, now: () => NOW });
  assert.equal(out.srv, undefined);
  assert.equal(calls.filter((c) => c.init.method === "DELETE").length, 1);
  assert.ok((await readLog(TOK, NOW)).keys[KEY].some((x) => x.e === "dismissed"));
});

test("אין פוש כפול: הלקוח הוסיף את אותו משחק בעצמו במקביל (אותו מפתח) → הודעה אחת", async () => {
  await reset(); await syncWith();
  const p = (await db.readJson(team.tmPath(TOK), null)).pend[0];
  calls = [];
  await saveRems({ t: TOK, rems: [{ k: p.k, title: p.title, ch: p.ch, ts: p.ts, end: p.end, lead: 30 }] }, { reschedule: resched, now: () => NOW }); // לקוח ישן, בלי tx
  assert.equal(calls.length, 0);
  const sched = await db.readJson(`sched/${TOK}.json`, {});
  assert.deepEqual(Object.keys(sched).filter((k) => !k.startsWith("__")), [KEY]);
});

test("משחק שנעלם מהלוח: התזכורת הממתינה יורדת, התזמון נמחק, ואם המשחק חוזר – מתווסף שוב", async () => {
  await reset(); await syncWith(); calls = [];
  const g2 = prepGuide({ ...GUIDE, programs: GUIDE.programs.filter((p) => !/מכבי חיפה/.test(p.title)) });
  const b = await db.readJson(`backup/${TOK}.json`, null);
  const r = await team.syncUser(TOK, b.data, g2, NOW, deps());
  assert.equal(r.pruned, 1);
  assert.equal((await db.readJson(team.tmPath(TOK), null)).pend.length, 0);
  assert.equal(calls.filter((c) => c.init.method === "DELETE").length, 1);
  calls = [];
  assert.equal((await syncWith()).added, 1);
});

test("ירי ונודניק מוצאים תזכורת ממתינה של השרת; fire שולח ומתעד את תשובת שירות הפוש", async () => {
  await reset(); await syncWith();
  const p = (await db.readJson(team.tmPath(TOK), null)).pend[0];
  assert.ok((await loadAll(TOK)).some((r) => r.k === KEY));
  const sent = [];
  const r = await handleFire({ t: TOK, k: KEY, at: p.ts - 30 * 60000 }, { load: loadAll, sendTo: async (t, pl) => { sent.push(pl); return { ok: 1, total: 1 }; }, dropSched: async () => {}, reschedule: async () => ({}) }, p.ts - 30 * 60000);
  assert.equal(r.json.ok, 1); assert.equal(sent.length, 1); assert.equal(sent[0].tag, KEY);
});

test("reschedule: תזכורת ממתינה שנורתה זה עתה (__f) לא מתוזמנת שוב גם בירי מאוחר", async () => {
  await reset(); await syncWith();
  const p = (await db.readJson(team.tmPath(TOK), null)).pend[0], at = p.ts - 30 * 60000, late = at + 90000;
  const sched = await db.readJson(`sched/${TOK}.json`, {});
  sched.__f = { [KEY]: { at, w: late } }; delete sched[KEY];
  await db.writeJson(`sched/${TOK}.json`, sched);
  calls = [];
  await reschedule(TOK, [], { fetch: fx, now: () => late });
  assert.equal(published().length, 0);
});

test("runTeamSync: רק משתמשים עם פוש ועם ⚽ אוטומטי; מתג חירום TEAMSYNC_OFF", async () => {
  await reset();
  const other = "othertok0123456789abcdefg";
  await db.writeJson(`backup/${other}.json`, BK()); // בלי פוש
  const r = await team.runTeamSync({ list: db.listJson, ...deps(), guide: async () => GUIDE });
  assert.equal(r.users, 1); assert.equal(r.auto, 1); assert.equal(r.added, 1);
  assert.equal(await db.readJson(team.tmPath(other), null), null);
  process.env.TEAMSYNC_OFF = "1";
  try { assert.equal((await team.runTeamSync({ list: db.listJson, ...deps(), guide: async () => GUIDE })).skipped, "off"); }
  finally { delete process.env.TEAMSYNC_OFF; }
});

const mockRes = () => { const r = { code: 200, headers: {}, body: undefined }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; }; r.status = (c) => { r.code = c; return r; }; r.json = (o) => { r.body = o; return r; }; r.end = () => r; return r; };

test("POST /api/team-sync: סוד (401/503), לוח ישן → stale, ריצה כפולה על אותו לוח → dup", async () => {
  await reset();
  const req = (h = {}, q = {}) => ({ method: "POST", headers: h, query: { job: "team", ...q } });
  delete process.env.CRON_SECRET;
  let res = mockRes(); await wc.default(req(), res); assert.equal(res.code, 503);
  process.env.CRON_SECRET = "cron-test-secret";
  try {
    res = mockRes(); await wc.default(req({ authorization: "Bearer nope" }), res); assert.equal(res.code, 401);
    const td = { guide: async () => GUIDE, list: db.listJson, loadOwn, reschedule: resched, now: () => NOW };
    res = mockRes(); await wc.default(req({ authorization: "Bearer cron-test-secret" }, { u: "2026-11-29T09:00:00.000Z" }), res, { team: td });
    assert.equal(res.code, 200); assert.equal(res.body.stale, true);
    res = mockRes(); await wc.default(req({ authorization: "Bearer cron-test-secret" }, { u: GUIDE.updated }), res, { team: td });
    assert.equal(res.body.added, 1);
    res = mockRes(); await wc.default(req({ authorization: "Bearer cron-test-secret" }, { u: GUIDE.updated }), res, { team: td });
    assert.equal(res.body.dup, true);
    res = mockRes(); await wc.default({ method: "GET", headers: {}, query: { job: "team" } }, res, { team: td }); assert.equal(res.code, 401);
  } finally { delete process.env.CRON_SECRET; }
});

test("GET /api/rems?log=1: היומן של 30 הימים האחרונים, רק עם הטוקן; טוקן שגוי 400", async () => {
  await reset(); await syncWith();
  const rh = (await import("../api/rems.js")).default;
  let res = mockRes(); await rh({ method: "GET", headers: {}, query: { t: TOK, log: "1" } }, res);
  assert.equal(res.code, 200); assert.ok(res.body.keys[KEY] && res.body.n >= 2);
  res = mockRes(); await rh({ method: "GET", headers: {}, query: { t: "x", log: "1" } }, res); assert.equal(res.code, 400);
  res = mockRes(); await rh({ method: "GET", headers: {}, query: { t: TOK } }, res);
  assert.equal(res.body.rems[0].srv, 1); // GET רגיל: כולל את הממתינה (הלקוח מצרף)
});
