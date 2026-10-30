// node --test calendar-server/test/*.mjs  (בלי רשת ובלי סודות אמיתיים)
import test from "node:test";
import assert from "node:assert/strict";

process.env.FIRE_SECRET = "test-secret-not-real";
process.env.QSTASH_TOKEN = "qs-test";
process.env.QSTASH_URL = "https://qstash.example";
const { encToken, decToken, signSnz, verifySnz, snzField, remPayload, handleSnooze, SNZ_TTL } = await import("../api/_snz.js");

const TOK = "abcdefghij0123456789abcd";
const okToken = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);
const NOW = 1_800_000_000_000;
const rem = { k: "5|1800000600000", title: "חדשות", ch: "קשת 12", ts: NOW + 600000, end: NOW + 4200000, lead: 10 };

function mkDeps(over = {}) {
  const store = {}, calls = [];
  return {
    calls, store, now: () => NOW, okToken, load: async () => [rem],
    readJson: async (p, d) => store[p] ?? d, writeJson: async (p, o) => { store[p] = JSON.parse(JSON.stringify(o)); },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ messageId: "m" + calls.length }) }; },
    ...over,
  };
}
const signed = (extra = {}) => { const a = NOW - 1000, o = encToken(TOK); return { k: rem.k, o, a, s: signSnz(o, rem.k, a), ...extra }; };

test("הצפנת טוקן הפיכה ולא חושפת את הטוקן", () => {
  const o = encToken(TOK);
  assert.ok(!o.includes(TOK));
  assert.equal(decToken(o), TOK);
  assert.equal(decToken(o.slice(0, -2) + "AA"), null);
  assert.equal(decToken("garbage"), null);
});

test("חתימה: תקינה, שגויה, פגה, ושינוי שדות", () => {
  const o = encToken(TOK), a = NOW - 5000, s = signSnz(o, "k1", a);
  assert.ok(verifySnz(o, "k1", a, s, NOW));
  assert.ok(!verifySnz(o, "k2", a, s, NOW));
  assert.ok(!verifySnz(o, "k1", a + 1, s, NOW));
  assert.ok(!verifySnz(o, "k1", a, s.replace(/^./, s[0] === "0" ? "1" : "0"), NOW));
  assert.ok(!verifySnz(o, "k1", a, "xyz", NOW));
  assert.ok(!verifySnz(o, "k1", a, s, a + SNZ_TTL + 1));
});

test("צורת הפוש: tag, url ושדה snz בלי הטוקן", () => {
  const p = remPayload(rem, { t: TOK, at: NOW, now: NOW });
  assert.equal(p.title, "⏰ חדשות");
  assert.equal(p.tag, rem.k);
  assert.equal(p.url, "./?rem=" + encodeURIComponent(rem.k));
  assert.match(p.body, /^קשת 12 · מתחיל בעוד 10 דק׳/);
  assert.deepEqual(Object.keys(p.snz).sort(), ["a", "k", "m", "o", "s", "u"]);
  assert.equal(p.snz.u, "https://tv-guide-cal.vercel.app/api/snooze");
  assert.equal(p.snz.k, rem.k);
  assert.ok(!JSON.stringify(p).includes(TOK));
  assert.ok(verifySnz(p.snz.o, p.snz.k, p.snz.a, p.snz.s, NOW));
  assert.ok(remPayload(rem, { now: NOW }).snz === undefined, "בלי טוקן אין snz");
  assert.match(remPayload(rem, { t: TOK, snooze: true, now: NOW }).body, /^💤 /);
});

test("snzField בלי FIRE_SECRET לא מחזיר כלום", () => {
  const s = process.env.FIRE_SECRET; delete process.env.FIRE_SECRET;
  assert.equal(snzField(TOK, "k", 1), undefined);
  process.env.FIRE_SECRET = s;
});

test("snooze עם חתימה: מתזמן ב-QStash בעוד 5 דק׳", async () => {
  const d = mkDeps(), r = await handleSnooze(signed(), d);
  assert.equal(r.status, 200);
  assert.equal(r.json.at, NOW + 300000);
  assert.equal(d.calls.length, 1);
  const c = d.calls[0];
  assert.ok(c.url.startsWith("https://qstash.example/v2/publish/https://tv-guide-cal.vercel.app/api/fire?s="));
  assert.equal(c.init.headers["upstash-not-before"], String(Math.floor((NOW + 300000) / 1000)));
  assert.deepEqual(JSON.parse(c.init.body), { t: TOK, k: rem.k, at: NOW + 300000, snooze: 1 });
  assert.ok(Object.keys(d.store).find((p) => p.startsWith(`snz/${TOK}/`)));
});

test("כשל publish משאיר את הנודניק הקודם (לא נמחק)", async () => {
  const d = mkDeps();
  await handleSnooze(signed(), d);
  const keyPath = Object.keys(d.store)[0], before = JSON.stringify(d.store[keyPath]);
  const t = NOW + 61000; d.now = () => t;
  d.fetch = async (url, init) => { d.calls.push({ url, init }); return { ok: false, json: async () => ({}) }; };
  const r = await handleSnooze(signed({ m: 10 }), d);
  assert.equal(r.status, 502);
  assert.equal(JSON.stringify(d.store[keyPath]), before);
  assert.ok(!d.calls.some((c) => c.init.method === "DELETE"));
});

test("שתי תזכורות במקביל לא דורסות זו את זו", async () => {
  const d = mkDeps({ load: async () => [rem, { ...rem, k: "9|x" }] });
  const a = signed(), o = encToken(TOK), b = { k: "9|x", o, a: NOW - 1000, s: signSnz(o, "9|x", NOW - 1000) };
  await Promise.all([handleSnooze(a, d), handleSnooze(b, d)]);
  assert.equal(Object.keys(d.store).length, 2);
  assert.equal(d.calls.length, 2);
});

test("dedup לפי k+m: m שונה בתוך דקה מתזמן מחדש ומוחק אחרי publish", async () => {
  const d = mkDeps();
  await handleSnooze(signed({ m: 5 }), d);
  const r = await handleSnooze(signed({ m: 10 }), d);
  assert.ok(!r.json.dup);
  assert.equal(d.calls.length, 3);
  assert.equal(d.calls[1].init.method, "POST");
  assert.equal(d.calls[2].init.method, "DELETE");
});

test("manifest: id יציב, התאמת start_url/scope, צבעים ואייקונים", async () => {
  const { readFileSync } = await import("node:fs");
  const m = JSON.parse(readFileSync(new URL("../../manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(m.id, "/tv-guide/");
  assert.equal(new URL(m.start_url, "https://u.github.io/tv-guide/").pathname, m.id);
  assert.equal(new URL(m.scope, "https://u.github.io/tv-guide/").pathname, m.id);
  assert.equal(m.theme_color, m.background_color);
  assert.ok(m.icons.some((i) => i.purpose === "maskable") && m.icons.some((i) => i.purpose === "any"));
  assert.ok(m.icons.every((i) => !/any maskable/.test(i.purpose)));
});

test("חתימה שגויה / חסרה -> 403", async () => {
  const d = mkDeps();
  assert.equal((await handleSnooze({ ...signed(), s: "0".repeat(64) }, d)).status, 403);
  assert.equal((await handleSnooze({ ...signed(), k: "other" }, d)).status, 403);
  assert.equal((await handleSnooze({ k: rem.k }, d)).status, 403);
  assert.equal(d.calls.length, 0);
});

test("m מחוץ ל-1..60 נדחה, תקין עובר", async () => {
  for (const m of [0, 61, -3, 2.5, "abc"]) assert.equal((await handleSnooze(signed({ m }), mkDeps())).status, 400, String(m));
  const r = await handleSnooze(signed({ m: 60 }), mkDeps());
  assert.equal(r.status, 200); assert.equal(r.json.at, NOW + 3600000);
});

test("הקשות חוזרות בתוך דקה לא יוצרות הודעות נוספות", async () => {
  const d = mkDeps();
  await handleSnooze(signed(), d);
  const r2 = await handleSnooze(signed(), d), r3 = await handleSnooze(signed(), d);
  assert.equal(d.calls.length, 1);
  assert.ok(r2.json.dup && r3.json.dup);
});

test("אחרי דקה: מוחק את ההודעה הקודמת ומתזמן מחדש", async () => {
  const d = mkDeps();
  await handleSnooze(signed(), d);
  let t = NOW + 61000; d.now = () => t;
  const r = await handleSnooze({ ...signed(), a: undefined, s: undefined, t: TOK }, d);
  assert.equal(r.status, 200);
  assert.equal(d.calls.length, 3);
  assert.equal(d.calls[1].init.method, "POST");
  assert.equal(d.calls[2].init.method, "DELETE");
  assert.ok(d.calls[2].url.endsWith("/v2/messages/m1"));
});

test("snooze עם טוקן אישי (מהאפליקציה)", async () => {
  const d = mkDeps();
  assert.equal((await handleSnooze({ k: rem.k, t: TOK, m: 15 }, d)).json.at, NOW + 900000);
  assert.equal((await handleSnooze({ k: rem.k, t: "BAD!" }, mkDeps())).status, 400);
});

test("תזכורת שלא קיימת -> 404; QStash נכשל -> 502", async () => {
  assert.equal((await handleSnooze(signed(), mkDeps({ load: async () => [] }))).status, 404);
  const bad = mkDeps({ fetch: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal((await handleSnooze(signed(), bad)).status, 502);
});
