// node --test calendar-server/test/*.mjs  - 🐤 הבדיקה היומית (QStash → /api/fire), הסטטוס הציבורי, ויומן התזכורות (שמירה 30 יום, ירי מתועד)
import test from "node:test";
import assert from "node:assert/strict";

process.env.QSTASH_TOKEN = "qs-test";
process.env.QSTASH_URL = "https://qstash.example";
process.env.FIRE_SECRET = "test-secret-not-real";
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.QSTASH_STRICT;
console.error = () => {}; console.log = () => {};

import { memBackend } from "./helpers/fakedb.mjs";
const mem = memBackend();
(await import("../api/_db.js"))._setBackend(mem);
const db = await import("../api/_db.js");
const cn = await import("../api/_canary.js");
const rl = await import("../api/_rlog.js");
const fireH = (await import("../api/fire.js")).default;
const pushH = (await import("../api/push.js")).default;
const { _resetLimits } = await import("../api/_guard.js");

const TOK = "canarytok0123456789abcdef";
const NOW = 1_800_000_000_000;
const mockRes = () => { const r = { code: 200, headers: {}, body: undefined }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; }; r.status = (c) => { r.code = c; return r; }; r.json = (o) => { r.body = o; return r; }; r.end = () => r; return r; };
// בקשת fire עם הסוד בכתובת (כמו הודעה שתוזמנה), גוף גולמי כמו ש-QStash שולח
function fireReq(body, s = "test-secret-not-real") {
  const raw = JSON.stringify(body);
  return { method: "POST", headers: { "content-type": "application/json" }, query: { s }, url: "/api/fire?s=" + s,
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(raw); }, on(ev, f) { if (ev === "data") f(Buffer.from(raw)); if (ev === "end") f(); return this; } };
}

test("scheduleCanary: מפרסם ל-/api/fire בעוד 5 דקות, עם dedup יומי, ושומר את המתוכנן", async () => {
  mem.m.clear();
  const calls = [];
  const fx = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ messageId: "mc1" }) }; };
  const r = await cn.scheduleCanary({ readJson: db.readJson, writeJson: db.writeJson, fetch: fx, now: () => NOW });
  assert.equal(r.scheduled, NOW + cn.CANARY_DELAY);
  assert.match(calls[0].url, /\/v2\/publish\/https:\/\/tv-guide-cal\.vercel\.app\/api\/fire/);
  assert.equal(calls[0].init.headers["upstash-not-before"], String(Math.floor((NOW + cn.CANARY_DELAY) / 1000)));
  assert.match(calls[0].init.headers["upstash-deduplication-id"], /^canary-\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { canary: 1, at: NOW + cn.CANARY_DELAY });
  const c = await db.readJson(cn.CANARY, null);
  assert.equal(c.plan, NOW + cn.CANARY_DELAY); assert.equal(c.id, "mc1");
  const bad = await cn.scheduleCanary({ readJson: db.readJson, writeJson: db.writeJson, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), now: () => NOW });
  assert.equal(bad.error, "publish failed");
  assert.equal((await cn.scheduleCanary({ readJson: db.readJson, writeJson: db.writeJson, token: "" })).skipped, "no QSTASH_TOKEN");
});

test("fireCanary: בזמן → ok; באיחור של יותר מ-10 דקות → לא ok", async () => {
  mem.m.clear();
  await cn.fireCanary({ canary: 1, at: NOW }, { readJson: db.readJson, writeJson: db.writeJson, now: () => NOW + 4000 });
  let c = await db.readJson(cn.CANARY, null); assert.equal(c.ok, true); assert.equal(c.lag, 4000); assert.equal(c.at, NOW + 4000);
  await cn.fireCanary({ canary: 1, at: NOW }, { readJson: db.readJson, writeJson: db.writeJson, now: () => NOW + 11 * 60000 });
  c = await db.readJson(cn.CANARY, null); assert.equal(c.ok, false);
});

test("/api/fire {canary:1}: עובר את אותו אימות (בלי סוד → 403), ורושם stats/canary", async () => {
  mem.m.clear();
  let res = mockRes(); await fireH(fireReq({ canary: 1, at: Date.now() }, "wrong"), res); assert.equal(res.code, 403);
  assert.equal(await db.readJson(cn.CANARY, null), null);
  res = mockRes(); await fireH(fireReq({ canary: 1, at: Date.now() }), res);
  assert.equal(res.code, 200); assert.equal(res.body.canary, true); assert.equal(res.body.ok, true);
  assert.equal((await db.readJson(cn.CANARY, null)).ok, true);
});

test("GET /api/push?status=1 (= /api/status): רק זמנים ודגל, בלי מידע אישי; GET רגיל לא השתנה", async () => {
  mem.m.clear(); cn._resetCanaryMemo(); _resetLimits();
  await db.writeJson(cn.CANARY, { plan: 5, planAt: 4, id: "secret-msg-id", at: 9, ok: true, lag: 3 });
  let res = mockRes(); await pushH({ method: "GET", headers: {}, query: { status: "1" } }, res);
  assert.deepEqual(res.body, { scheduler: true, canaryAt: 9, canaryOk: true, canaryPlan: 5, canaryLag: 3 });
  res = mockRes(); await pushH({ method: "GET", headers: {}, query: {} }, res);
  assert.deepEqual(Object.keys(res.body).sort(), ["key", "scheduler"]);
  cn._resetCanaryMemo(); mem.m.clear();
  res = mockRes(); await pushH({ method: "GET", headers: {}, query: { status: "1" } }, res);
  assert.equal(res.body.canaryAt, null); assert.equal(res.body.canaryOk, null);
});

test("יומן: /api/fire מתעד ירי עם תשובת שירות הפוש לכל מכשיר (מארח וקוד, בלי endpoint), ודילוג עם סיבה", async () => {
  mem.m.clear();
  const ts = Date.now() + 3600000;
  await db.writeJson(`rems/${TOK}.json`, [{ k: "289|" + ts, title: "משחק", ch: "ספורט 5", ts, end: ts + 7200000, lead: 0 }]);
  await db.writeJson(`push/${TOK}.json`, [{ endpoint: "https://web.push.apple.com/QGx", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }]);
  const wp = (await import("web-push")).default;
  const vk = wp.generateVAPIDKeys(); process.env.VAPID_PUBLIC = vk.publicKey; process.env.VAPID_PRIVATE = vk.privateKey;
  const orig = wp.sendNotification; wp.sendNotification = async () => { const e = new Error("gone"); e.statusCode = 410; throw e; };
  const og = globalThis.fetch; globalThis.fetch = async () => ({ ok: true, json: async () => ({ messageId: "x" }) });
  try {
    let res = mockRes(); await fireH(fireReq({ t: TOK, k: "289|" + ts, at: ts }), res);
    assert.equal(res.code, 200);
    res = mockRes(); await fireH(fireReq({ t: TOK, k: "289|999", at: 1 }), res);
  } finally { wp.sendNotification = orig; globalThis.fetch = og; }
  const lg = await rl.readLog(TOK);
  const f = lg.keys["289|" + ts].find((x) => x.e === "fired");
  assert.deepEqual(f.w, [{ h: "web.push.apple.com", c: 410, e: "gone" }]);
  assert.equal(f.ok, 0); assert.equal(f.total, 1);
  assert.ok(!JSON.stringify(lg).includes("QGx"), "לא נשמר ה-endpoint");
  assert.equal(lg.keys["289|999"][0].e, "fire-skip"); assert.equal(lg.keys["289|999"][0].why, "cancelled");
});

test("יומן: logEv לא זורק כשהאחסון נופל; readLog מקבץ לפי מפתח; cleanLog מוחק רק מעל 30 יום", async () => {
  mem.m.clear();
  assert.equal(await rl.logEv(TOK, [{ k: "a", e: "x" }], { readJson: async () => { throw new Error("down"); } }), false);
  assert.equal(await rl.logEv("bad", [{ k: "a", e: "x" }]), false);
  const day = 86400000;
  await rl.logEv(TOK, [{ k: "a", e: "created" }], { now: () => NOW - 40 * day });
  await rl.logEv(TOK, [{ k: "a", e: "sched" }, { k: "b", e: "created" }], { now: () => NOW - 2 * day });
  await rl.logEv(TOK, [{ k: "a", e: "fired" }], { now: () => NOW });
  let lg = await rl.readLog(TOK, NOW);
  assert.deepEqual(lg.keys.a.map((x) => x.e), ["sched", "fired"]); assert.equal(lg.days.length, 2);
  const n = await rl.cleanLog([TOK, "bad"], NOW);
  assert.equal(n, 1);
  lg = await rl.readLog(TOK, NOW + 100 * day);
  assert.equal(lg.n, 0);
  assert.equal([...mem.m.keys()].filter((k) => k.startsWith("rlog/")).length, 2);
  process.env.RLOG_OFF = "1";
  try { assert.equal(await rl.logEv(TOK, [{ k: "a", e: "x" }]), false); } finally { delete process.env.RLOG_OFF; }
});
