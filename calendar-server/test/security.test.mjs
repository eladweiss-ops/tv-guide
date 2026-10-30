// node --test calendar-server/test/*.mjs  (בלי רשת ובלי סודות אמיתיים)
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.FIRE_SECRET = "test-secret-not-real";
process.env.QSTASH_TOKEN = "qs-test";
process.env.QSTASH_URL = "https://qstash.example";
delete process.env.BLOB_READ_WRITE_TOKEN;
console.error = () => {}; // השרת רושם שגיאות ללוג; בבדיקות שקט
delete process.env.QSTASH_CURRENT_SIGNING_KEY;
delete process.env.QSTASH_NEXT_SIGNING_KEY;

const snz = await import("../api/_snz.js");
const { encToken, decToken, signSnz, signSnzLegacy, verifySnz, SNZ_TTL } = snz;
const { allow, _resetLimits, readBody } = await import("../api/_guard.js");
const { validEndpoint, validSub } = await import("../api/_val.js");
const { verifyQstashJwt, fireAuthorized, fireAuth, safeEq } = await import("../api/_sig.js");
const { esc } = await import("../api/_ics.js");
const { reschedule, MAX_SCHED, MAX_PUBLISH_DAY } = await import("../api/_push.js");
const remsH = (await import("../api/rems.js")).default;
const pushH = (await import("../api/push.js")).default;
const { default: fireH, handleFire } = await import("../api/fire.js");
const snoozeH = (await import("../api/snooze.js")).default;

const TOK = "abcdefghij0123456789abcd";
const NOW = 1_800_000_000_000;
const file = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

function mockRes() {
  const r = { code: 200, headers: {}, body: undefined, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
const mkReq = (over = {}) => ({ method: "POST", headers: {}, query: {}, body: {}, ...over });

// ---------- הגבלת קצב ----------
test("allow: חלון קבוע, מתאפס אחרי החלון", () => {
  _resetLimits();
  for (let i = 0; i < 3; i++) assert.ok(allow("k", 3, 1000, 100));
  assert.ok(!allow("k", 3, 1000, 200));
  assert.ok(allow("other", 3, 1000, 200));
  assert.ok(allow("k", 3, 1000, 1200));
});

test("rems POST: 429 {error:'rate'} אחרי 30 בקשות לדקה לאותו טוקן", async () => {
  _resetLimits();
  const tok = "ratelimitrems0123456789ab";
  let last;
  for (let i = 0; i < 31; i++) {
    last = mockRes();
    await remsH(mkReq({ headers: { "x-real-ip": "1.1." + i }, body: { t: tok, rems: [] } }), last);
  }
  assert.equal(last.code, 429);
  assert.deepEqual(last.body, { error: "rate" });
  assert.equal(last.headers["retry-after"], "60");
});

test("rems POST: מגבלת IP", async () => {
  _resetLimits();
  let last;
  for (let i = 0; i < 61; i++) { last = mockRes(); await remsH(mkReq({ headers: { "x-real-ip": "9.9.9.9" }, body: { t: "BAD" } }), last); }
  assert.equal(last.code, 429);
});

test("push POST (כולל test:1), backup ו-snooze מוגבלים", async () => {
  _resetLimits();
  const tok = "ratelimitpush0123456789ab";
  const codes = [];
  for (let i = 0; i < 5; i++) { const r = mockRes(); await pushH(mkReq({ headers: { "x-real-ip": "2.2.2." + i }, body: { t: tok, test: 1 } }), r); codes.push(r.code); }
  assert.equal(codes[3], 429, "test:1 מוגבל ל-3 לדקה");
  _resetLimits();
  const bk = (await import("../api/backup.js")).default;
  let r;
  for (let i = 0; i < 31; i++) { r = mockRes(); await bk(mkReq({ headers: { "x-real-ip": "3.3.3.3" }, body: { t: "BAD" } }), r); }
  assert.equal(r.code, 429);
  _resetLimits();
  for (let i = 0; i < 61; i++) { r = mockRes(); await snoozeH(mkReq({ headers: { "x-real-ip": "4.4.4.4" }, body: {} }), r); }
  assert.equal(r.code, 429);
});

test("מגבלת גודל גוף: rems 256KB (בבתים), push 4KB, backup 256KB", async () => {
  _resetLimits();
  let r = mockRes();
  await remsH(mkReq({ body: { t: TOK, rems: [{ k: "x".repeat(270000) }] } }), r);
  assert.equal(r.code, 413);
  // הגבלה בבתים ולא בתווים: 150K אותיות עבריות = 300KB בבתים אבל רק 150K תווים
  r = mockRes();
  await remsH(mkReq({ body: JSON.stringify({ t: TOK, pad: "א".repeat(150000) }) }), r);
  assert.equal(r.code, 413);
  assert.equal(readBody({ headers: {}, body: JSON.stringify({ p: "א".repeat(60) }) }, 100).status, 413);
  assert.ok(readBody({ headers: {}, body: { p: "a".repeat(60) } }, 100).ok);
  assert.equal(readBody({ headers: {}, body: { p: "א".repeat(60) } }, 100).status, 413);
  // רשימה של 300 תזכורות טיפוסיות נכנסת בנוחות
  const big = Array.from({ length: 300 }, (_, i) => ({ k: "12|" + (1800000000000 + i), title: "כותרת תוכנית ארוכה למדי", ch: "קשת 12", desc: "ד".repeat(150), ts: 1, end: 2, lead: 10 }));
  assert.ok(readBody({ headers: {}, body: { t: TOK, rems: big } }, 262144).ok);
  r = mockRes();
  await pushH(mkReq({ headers: { "content-length": "5000" }, body: { t: TOK } }), r);
  assert.equal(r.code, 413);
  r = mockRes();
  await pushH(mkReq({ body: JSON.stringify({ t: TOK, pad: "x".repeat(5000) }) }), r);
  assert.equal(r.code, 413);
  assert.equal(readBody({ headers: {}, body: "{not json" }, 100).status, 400);
  assert.equal(readBody({ headers: {}, body: "[1]" }, 100).ok, true); // מערך הוא אובייקט; okToken ידחה בהמשך
});

// ---------- תקרה, diff ותקציב ב-reschedule ----------
function mkSched(over = {}) {
  const store = {}, calls = [];
  return {
    store, calls,
    getSubs: async () => [{ endpoint: "https://fcm.googleapis.com/x", keys: {} }],
    readJson: async (p, d) => store[p] ?? d,
    writeJson: async (p, o) => { store[p] = JSON.parse(JSON.stringify(o)); },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ messageId: "m" + calls.length }) }; },
    now: () => NOW,
    ...over,
  };
}
const mkRems = (n, off = 0) => Array.from({ length: n }, (_, i) => ({ k: `k${i + off}`, title: "t", ts: NOW + (i + 1 + off) * 3600000, end: NOW + (i + 2 + off) * 3600000, lead: 10 }));

test("reschedule: תקרה של 60, הקרובות מתוזמנות", async () => {
  const d = mkSched();
  const out = await reschedule(TOK, mkRems(75), d);
  assert.equal(MAX_SCHED, 60);
  assert.equal(out.added, 60); assert.equal(out.capped, 15); assert.equal(out.total, 60);
  assert.equal(d.calls.length, 60);
  const sched = d.store[`sched/${TOK}.json`];
  assert.ok(sched.k0 && sched.k59 && !sched.k60);
});

test("reschedule: diff - בלי שינוי אין קריאות, שינוי אחד = מחיקה+פרסום אחד", async () => {
  const d = mkSched();
  const rems = mkRems(5);
  await reschedule(TOK, rems, d);
  d.calls.length = 0;
  const same = await reschedule(TOK, rems, d);
  assert.equal(d.calls.length, 0); assert.equal(same.added, 0); assert.equal(same.removed, 0);
  const changed = rems.map((r, i) => i === 2 ? { ...r, ts: r.ts + 3600000, end: r.end + 3600000 } : r);
  const out = await reschedule(TOK, changed, d);
  assert.equal(out.added, 1); assert.equal(out.removed, 1);
  assert.deepEqual(d.calls.map((c) => c.init.method), ["DELETE", "POST"]);
});

test("reschedule: תקציב פרסומים יומי לכל טוקן", async () => {
  const d = mkSched();
  d.store[`sched/${TOK}.json`] = { __q: { d: Math.floor(NOW / 86400000), n: MAX_PUBLISH_DAY - 2 } };
  const out = await reschedule(TOK, mkRems(5), d);
  assert.equal(out.added, 2); assert.equal(out.limited, "daily");
  // יום חדש מאפס
  d.now = () => NOW + 86400000;
  const out2 = await reschedule(TOK, mkRems(5, 24), d);
  assert.ok(out2.added >= 1 && !out2.limited);
});

test("reschedule: כתובת עם סוד; עם מפתחות עדיין סוד; בלי סוד רק עם QSTASH_STRICT=1", async () => {
  let d = mkSched();
  await reschedule(TOK, mkRems(1), d);
  assert.match(d.calls[0].url, /\/api\/fire\?s=test-secret-not-real$/);
  process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_current";
  try {
    d = mkSched();
    await reschedule(TOK, mkRems(1), d);
    assert.match(d.calls[0].url, /\/api\/fire\?s=test-secret-not-real$/, "מעבר מדורג: ?s= נשאר גם כשיש מפתחות");
    process.env.QSTASH_STRICT = "1";
    d = mkSched();
    await reschedule(TOK, mkRems(1), d);
    assert.ok(d.calls[0].url.endsWith("/v2/publish/https://tv-guide-cal.vercel.app/api/fire"));
    assert.ok(!d.calls[0].url.includes("test-secret"));
    delete process.env.QSTASH_CURRENT_SIGNING_KEY; // STRICT בלי מפתחות לא מסיר את הסוד
    d = mkSched();
    await reschedule(TOK, mkRems(1), d);
    assert.match(d.calls[0].url, /\?s=/);
  } finally { delete process.env.QSTASH_CURRENT_SIGNING_KEY; delete process.env.QSTASH_STRICT; }
});

// ---------- אימות מנוי פוש ----------
const P = "B".repeat(87), A = "a".repeat(22);
const sub = (endpoint, keys = { p256dh: P, auth: A }) => ({ endpoint, keys });

test("validEndpoint: מארחים מותרים", () => {
  for (const u of [
    "https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QAbc", "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://foo.push.services.mozilla.com/x", "https://wns2-par02p.notify.windows.com/w/?token=1", "https://db5p.notify.windows.com/x",
  ]) assert.ok(validEndpoint(u), u);
});

test("validEndpoint: SSRF נדחה", () => {
  for (const u of [
    "http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://[::1]/x", "https://2130706433/x",
    "https://fcm.googleapis.com:8443/x", "https://evil.com/x", "https://fcm.googleapis.com.evil.com/x", "https://evilpush.apple.com.attacker.io/",
    "https://notpush.apple.com/x", "https://user:pw@fcm.googleapis.com/x", "https://localhost/x", "ftp://fcm.googleapis.com/x", "not a url", "", null, 5,
    "https://fcm.googleapis.com@evil.com/x", "https://evil.com/fcm.googleapis.com",
  ]) assert.ok(!validEndpoint(u), String(u));
  assert.ok(!validEndpoint("https://fcm.googleapis.com/" + "a".repeat(1100)));
});

test("validSub: מפתחות base64url באורך סביר", () => {
  const ep = "https://fcm.googleapis.com/fcm/send/x";
  assert.ok(validSub(sub(ep)));
  assert.ok(!validSub(sub(ep, { p256dh: P }))); assert.ok(!validSub(sub(ep, { auth: A })));
  assert.ok(!validSub(sub(ep, { p256dh: "short", auth: A })));
  assert.ok(!validSub(sub(ep, { p256dh: P, auth: "a".repeat(100) })));
  assert.ok(!validSub(sub(ep, { p256dh: "+".repeat(87), auth: A })));
  assert.ok(!validSub(sub(ep, { p256dh: P, auth: "!".repeat(22) })));
  assert.ok(!validSub(null)); assert.ok(!validSub({ endpoint: ep })); assert.ok(!validSub({ endpoint: ep, keys: "x" }));
});

test("push POST: מנוי לא תקין -> 400 לפני כל גישה לאחסון", async () => {
  _resetLimits();
  for (const s of [sub("https://evil.com/x"), sub("https://169.254.169.254/x"), { endpoint: "https://fcm.googleapis.com/x" }, "str"]) {
    const r = mockRes();
    await pushH(mkReq({ body: { t: TOK, sub: s } }), r);
    assert.equal(r.code, 400, JSON.stringify(s));
    assert.deepEqual(r.body, { error: "bad subscription" });
  }
});

// ---------- /api/fire ----------
const b64u = (x) => Buffer.from(x).toString("base64url");
function jwt(body, key, over = {}, hdr = { alg: "HS256", typ: "JWT" }) {
  const c = { iss: "Upstash", sub: "https://tv-guide-cal.vercel.app/api/fire", exp: Math.floor(NOW / 1000) + 300, nbf: Math.floor(NOW / 1000) - 5, iat: Math.floor(NOW / 1000), jti: "j", body: createHash("sha256").update(body).digest("base64url"), ...over };
  const h = b64u(JSON.stringify(hdr)), p = b64u(JSON.stringify(c));
  return `${h}.${p}.${createHmac("sha256", key).update(h + "." + p).digest("base64url")}`;
}

test("verifyQstashJwt: תקין, מפתח הבא, ושגיאות", () => {
  const body = JSON.stringify({ t: TOK, k: "k", at: 1 });
  assert.ok(verifyQstashJwt(jwt(body, "cur"), ["cur", "next"], body, NOW));
  assert.ok(verifyQstashJwt(jwt(body, "next"), ["cur", "next"], body, NOW), "מפתח NEXT (רוטציה)");
  assert.ok(!verifyQstashJwt(jwt(body, "evil"), ["cur", "next"], body, NOW));
  assert.ok(!verifyQstashJwt(jwt(body, "cur"), ["cur"], body + " ", NOW), "גוף שונה");
  assert.ok(!verifyQstashJwt(jwt(body, "cur", { exp: Math.floor(NOW / 1000) - 600 }), ["cur"], body, NOW), "פג תוקף");
  assert.ok(!verifyQstashJwt(jwt(body, "cur", { sub: "https://other.example/api/fire" }), ["cur"], body, NOW), "יעד אחר");
  assert.ok(!verifyQstashJwt(jwt(body, "cur", { iss: "x" }), ["cur"], body, NOW));
  assert.ok(!verifyQstashJwt(jwt(body, "cur", {}, { alg: "none" }), ["cur"], body, NOW));
  assert.ok(!verifyQstashJwt("a.b", ["cur"], body, NOW));
  assert.ok(!verifyQstashJwt(undefined, ["cur"], body, NOW));
  assert.ok(verifyQstashJwt(jwt(body, "cur", { sub: "https://tv-guide-cal.vercel.app/api/fire?s=old" }), ["cur"], body, NOW), "הודעה ישנה עם ?s בכתובת");
});

test("fireAuthorized: סוד ישן (תאימות), חתימה, ודחייה", () => {
  const body = "{}";
  assert.ok(fireAuthorized({ query: { s: "test-secret-not-real" }, headers: {} }, body, NOW));
  assert.ok(!fireAuthorized({ query: { s: "wrong" }, headers: {} }, body, NOW));
  assert.ok(!fireAuthorized({ query: {}, headers: {} }, body, NOW));
  assert.ok(!fireAuthorized({ query: { s: ["a", "b"] }, headers: {} }, body, NOW));
  // חתימה בלי מפתחות מוגדרים -> נדחית
  assert.ok(!fireAuthorized({ query: {}, headers: { "upstash-signature": jwt(body, "cur") } }, body, NOW));
  process.env.QSTASH_CURRENT_SIGNING_KEY = "cur";
  try {
    assert.ok(fireAuthorized({ query: {}, headers: { "upstash-signature": jwt(body, "cur") } }, body, NOW));
    assert.ok(!fireAuthorized({ query: {}, headers: { "upstash-signature": jwt(body, "nope") } }, body, NOW));
    assert.ok(fireAuthorized({ query: { s: "test-secret-not-real" }, headers: {} }, body, NOW), "הסוד הישן עדיין עובד כשיש מפתחות");
  } finally { delete process.env.QSTASH_CURRENT_SIGNING_KEY; }
  const s = process.env.FIRE_SECRET; delete process.env.FIRE_SECRET;
  assert.ok(!fireAuthorized({ query: { s: "" }, headers: {} }, body, NOW), "בלי FIRE_SECRET סוד ריק לא עובר");
  process.env.FIRE_SECRET = s;
  assert.ok(safeEq("abc", "abc") && !safeEq("abc", "abcd"));
});

test("fire handler: 403 בלי אימות, 405 ל-GET, 400 לגוף שגוי עם סוד תקין", async () => {
  let r = mockRes();
  await fireH(mkReq({ body: JSON.stringify({ t: TOK, k: "k" }) }), r);
  assert.equal(r.code, 403);
  r = mockRes();
  await fireH(mkReq({ method: "GET" }), r);
  assert.equal(r.code, 405);
  r = mockRes();
  await fireH(mkReq({ query: { s: "test-secret-not-real" }, body: "{bad" }), r);
  assert.equal(r.code, 400);
  // גוף כזרם (bodyParser כבוי)
  const stream = { method: "POST", headers: {}, query: { s: "test-secret-not-real" }, async *[Symbol.asyncIterator]() { yield Buffer.from('{"t":"BAD"}'); } };
  r = mockRes();
  await fireH(stream, r);
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "bad request");
});

// ---------- HKDF: הפרדת מפתחות + תאימות לאחור ----------
test("HKDF: חתימה חדשה שונה מהישנה, ושתיהן תקפות באימות", () => {
  const o = encToken(TOK), a = NOW - 1000;
  const neu = signSnz(o, "k", a), old = signSnzLegacy(o, "k", a);
  assert.notEqual(neu, old);
  assert.equal(old, createHmac("sha256", process.env.FIRE_SECRET).update(`snz1|${o}|k|${a}`).digest("hex"), "הנוסחה הישנה לא השתנתה");
  assert.ok(verifySnz(o, "k", a, neu, NOW));
  assert.ok(verifySnz(o, "k", a, old, NOW), "חתימה בדרך הישנה עדיין תקפה בחלון 6 השעות");
  assert.ok(!verifySnz(o, "k", a, old, a + SNZ_TTL + 1));
  assert.ok(!verifySnz(o, "other", a, old, NOW));
});

test("HKDF: הצפנת טוקן ישנה (sha256) עדיין מפוענחת, וחדשה לא נפתחת במפתח הישן", () => {
  const legacyKey = createHash("sha256").update("snz-enc|" + process.env.FIRE_SECRET).digest();
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", legacyKey, iv);
  const ct = Buffer.concat([c.update(TOK, "utf8"), c.final()]);
  const old = Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
  assert.equal(decToken(old), TOK);
  const neu = encToken(TOK);
  assert.equal(decToken(neu), TOK);
  const b = Buffer.from(neu, "base64url");
  assert.throws(() => { const d = createDecipheriv("aes-256-gcm", legacyKey, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); Buffer.concat([d.update(b.subarray(28)), d.final()]); });
});

test("HKDF: מפתחות תלויים ב-FIRE_SECRET", () => {
  const o = "abc", a = NOW, s1 = signSnz(o, "k", a);
  const prev = process.env.FIRE_SECRET; process.env.FIRE_SECRET = "different-secret";
  const s2 = signSnz(o, "k", a);
  process.env.FIRE_SECRET = prev;
  assert.notEqual(s1, s2);
});

// ---------- ICS ----------
test("ICS esc: backslash, נקודה-פסיק, פסיק, שורה חדשה ותווי בקרה", () => {
  assert.equal(esc("a;b"), "a\\;b");
  assert.equal(esc("a,b"), "a\\,b");
  assert.equal(esc("a\\b"), "a\\\\b");
  assert.equal(esc("a\\;b"), "a\\\\\\;b");
  assert.equal(esc("l1\r\nl2\nl3\rl4"), "l1\\nl2\\nl3\\nl4");
  assert.equal(esc("x\u0000y\u0007z\u001bw\u007fv\u0085u t"), "xyzwvut");
  assert.equal(esc("a\tb"), "a b");
  assert.equal(esc(null), "");
  assert.ok(!/[\r\u0000-\u0008\u000b-\u001f]/.test(esc("BEGIN:VEVENT\r\nATTENDEE:x\u0000")), "אי אפשר להזריק שורה חדשה");
  assert.equal(esc("שלום; עולם, טוב"), "שלום\\; עולם\\, טוב");
  assert.ok(!file("../api/cal.js").includes('"\\;"'), "באג ה-\\; הישן לא חזר");
});

// ---------- selftest ו-500 גנרי ----------
test("selftest הוסר מ-rems.js", async () => {
  assert.ok(!/selftest/.test(file("../api/rems.js")));
  _resetLimits();
  const r = mockRes();
  await remsH({ method: "GET", headers: {}, query: { t: "selftest0123456789abcdefg", selftest: "1" } }, r);
  assert.equal(r.code, 500); // נכשל בקריאה מהלוב (אין טוקן) ולא בכתיבה; אין מסלול כתיבה
  assert.deepEqual(r.body, { error: "server error" });
});

test("500: גוף גנרי בלי e.message, בכל ה-handlers", async () => {
  _resetLimits();
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(" "));
  try {
    const cases = [
      [remsH, { body: { t: TOK, rems: [] } }],
      [(await import("../api/backup.js")).default, { body: { t: TOK, data: { "tvg.sel": "[]" } } }],
      [fireH, { query: { s: "test-secret-not-real" }, body: JSON.stringify({ t: TOK, k: "k" }) }],
    ];
    for (const [h, over] of cases) {
      const r = mockRes();
      await h(mkReq(over), r);
      assert.equal(r.code, 500);
      assert.deepEqual(r.body, { error: "server error" });
      assert.ok(!JSON.stringify(r.body).includes("token"), "ללא פרטי שגיאה");
    }
    assert.ok(logs.length >= 3, "הפרטים נרשמו בלוג בשרת");
  } finally { console.error = orig; }
});

test("snooze: מגבלת קצב לטוקן אחרי אימות (429)", async () => {
  const { handleSnooze } = snz;
  const rem = { k: "5|1", title: "x", ch: "", ts: NOW + 600000, end: NOW + 4200000, lead: 10 };
  const deps = { okToken: () => true, load: async () => [rem], readJson: async (p, d) => d, writeJson: async () => {}, fetch: async () => ({ ok: true, json: async () => ({ messageId: "m" }) }), now: () => NOW, rate: () => false };
  const r = await handleSnooze({ k: rem.k, t: TOK }, deps);
  assert.equal(r.status, 429); assert.deepEqual(r.json, { error: "rate" });
});

// ---------- vercel.json ----------
test("vercel.json: Referrer-Policy ו-nosniff על /api ועל /cal, וה-CORS נשמר", () => {
  const v = JSON.parse(file("../vercel.json"));
  const by = (src) => Object.fromEntries(v.headers.find((h) => h.source === src).headers.map((h) => [h.key, h.value]));
  for (const src of ["/api/(.*)", "/cal/(.*)"]) {
    const h = by(src);
    assert.equal(h["Referrer-Policy"], "no-referrer");
    assert.equal(h["X-Content-Type-Options"], "nosniff");
  }
  assert.equal(by("/api/(.*)")["Access-Control-Allow-Origin"], "*");
  assert.deepEqual(v.rewrites, [{ source: "/cal/:t.ics", destination: "/api/cal?t=:t" }]);
});

// ---------- מצב אימות JWT בלוג ----------
test("fireAuth: מדווח מצב JWT בלי סודות, סוד ישן ממשיך לעבוד", () => {
  const body = "{}";
  const mk = (sig, q = {}) => ({ query: q, headers: sig ? { "upstash-signature": sig } : {} });
  assert.equal(fireAuth(mk(null), body, NOW).jwt, "nokeys");
  process.env.QSTASH_CURRENT_SIGNING_KEY = "cur";
  try {
    assert.equal(fireAuth(mk(null, { s: "test-secret-not-real" }), body, NOW).jwt, "none");
    assert.deepEqual(fireAuth(mk(jwt(body, "cur")), body, NOW), { ok: true, via: "jwt", jwt: "ok" });
    assert.equal(fireAuth(mk(jwt(body, "bad")), body, NOW).jwt, "signature");
    assert.equal(fireAuth(mk(jwt(body, "cur", { exp: 1 })), body, NOW).jwt, "expired");
    assert.equal(fireAuth(mk(jwt(body, "cur", { sub: "https://x.example/api/fire" })), body, NOW).jwt, "url");
    assert.equal(fireAuth(mk(jwt(body, "cur")), body + " ", NOW).jwt, "body");
    assert.equal(fireAuth(mk("a.b"), body, NOW).jwt, "malformed");
    const both = fireAuth(mk(jwt(body, "bad"), { s: "test-secret-not-real" }), body, NOW);
    assert.deepEqual(both, { ok: true, via: "secret", jwt: "signature" }, "JWT לא תקין לא חוסם בזמן המעבר");
  } finally { delete process.env.QSTASH_CURRENT_SIGNING_KEY; }
});

test("fire handler רושם מצב אימות בלוג ללא סודות", async () => {
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(" "));
  try {
    const r = mockRes();
    await fireH(mkReq({ query: { s: "test-secret-not-real" }, body: "{bad" }), r);
    const r2 = mockRes();
    await fireH(mkReq({ body: "{}" }), r2);
    assert.equal(r2.code, 403);
  } finally { console.log = orig; }
  assert.ok(logs.some((l) => /^fire auth allowed via=secret jwt=nokeys$/.test(l)));
  assert.ok(logs.some((l) => /^fire auth denied via=none jwt=nokeys$/.test(l)));
  assert.ok(!logs.join("\n").includes("test-secret-not-real"));
});

// ---------- fire: תזמון המשך ----------
test("handleFire: אחרי שליחה ו-dropSched קורא ל-reschedule בלי התזכורת שנורתה", async () => {
  const rems = mkRems(3), order = [];
  const d = {
    load: async () => rems,
    sendTo: async () => { order.push("send"); return { ok: 1, total: 1 }; },
    dropSched: async (t, k) => { order.push("drop:" + k); },
    reschedule: async (t, rs) => { order.push("resched:" + rs.map((x) => x.k).join(",")); return { added: 1 }; },
  };
  const at = rems[0].ts - 10 * 60000;
  const r = await handleFire({ t: TOK, k: "k0", at }, d, NOW);
  assert.deepEqual(order, ["send", "drop:k0", "resched:k1,k2"]);
  assert.deepEqual(r.json.sch, { added: 1 });
});

test("handleFire: כשל ב-reschedule לא מפיל את הירי; נודניק ותזכורת מבוטלת לא מתזמנים", async () => {
  const rems = mkRems(2); let called = 0;
  const base = { load: async () => rems, sendTo: async () => ({ ok: 1 }), dropSched: async () => {}, reschedule: async () => { called++; throw new Error("boom"); } };
  const orig = console.error; console.error = () => {};
  try {
    const r = await handleFire({ t: TOK, k: "k0", at: rems[0].ts - 600000 }, base, NOW);
    assert.equal(r.status, 200); assert.equal(r.json.ok, 1); assert.equal(called, 1);
  } finally { console.error = orig; }
  assert.equal((await handleFire({ t: TOK, k: "k0", snooze: 1 }, base, NOW)).json.ok, 1);
  assert.equal(called, 1);
  assert.deepEqual((await handleFire({ t: TOK, k: "nope" }, base, NOW)).json, { skipped: "cancelled" });
});

test("תזכורות 61+ ותקציב יומי שאופס מתוזמנות בירי הבא", async () => {
  const d = mkSched(), rems = mkRems(65), key = "sched/" + TOK + ".json";
  await reschedule(TOK, rems, d);
  assert.equal(Object.keys(d.store[key]).filter((k) => k !== "__q").length, 60);
  delete d.store[key].k0; // k0 נורתה ונמחקה; הירי קורא ל-reschedule ואז k60 נכנסת
  const out = await reschedule(TOK, rems.filter((x) => x.k !== "k0"), d);
  assert.equal(out.added, 1); assert.ok(d.store[key].k60);
  const d2 = mkSched();
  d2.store[key] = { __q: { d: Math.floor(NOW / 86400000), n: MAX_PUBLISH_DAY } };
  assert.equal((await reschedule(TOK, mkRems(3), d2)).limited, "daily");
  d2.now = () => NOW + 86400000;
  const o2 = await reschedule(TOK, mkRems(3, 24), d2);
  assert.ok(o2.added > 0 && !o2.limited);
});

// ---------- sendTo ----------
test("sendTo מדלג על מנוי לא תקין בלי בקשת רשת ובלי מחיקה", async () => {
  const { sendTo } = await import("../api/_push.js");
  const good = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: P, auth: A } };
  const bad = { endpoint: "http://169.254.169.254/latest", keys: { p256dh: P, auth: A } };
  const sent = []; let written = 0;
  const d = { getSubs: async () => [good, bad], setSubs: async () => { written++; }, send: async (s) => { sent.push(s.endpoint); } };
  const r = await sendTo(TOK, { title: "x" }, d);
  assert.deepEqual(sent, [good.endpoint]);
  assert.deepEqual(r, { ok: 1, total: 2 });
  assert.equal(written, 0, "המנוי הלא תקין לא נמחק");
});

// ---------- לקוח ----------
test("js/reminders.js מבחין בין 429/413 לשגיאת רשת", () => {
  const c = file("../../js/reminders.js");
  assert.match(c, /r\.status === 429/); assert.match(c, /retry-after/); assert.match(c, /r\.status === 413/);
  assert.match(c, /גדולה מדי/);
});
