// התראת טלגרם על משתמש חדש (api/_notify.js + api/backup.js). בלי רשת: fetch ו-Firestore מדומים
import test from "node:test";
import assert from "node:assert/strict";
import { memBackend } from "./helpers/fakedb.mjs";
import { _setBackend, readJson } from "../api/_db.js";
import { _resetLimits } from "../api/_guard.js";
import { buildMessage, escapeHtml, MAX_PER_HOUR } from "../api/_notify.js";

const bkH = (await import("../api/backup.js")).default;
const realFetch = globalThis.fetch;
const res = () => { const r = { code: 200, headers: {}, setHeader(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(o) { r.body = o; return r; }, end() { return r; } }; return r; };
let n = 0;
const tok = () => "notifytok" + String(++n).padStart(3, "0") + "abcdefghijklmnop"; // 24+ תווים a-z0-9
const post = async (t, src, ip = "9.9.9." + (n % 200)) => {
  const r = res();
  await bkH({ method: "POST", headers: { "x-real-ip": ip }, query: {}, body: { t, data: { "tvg.sel": "[1]" }, ...(src ? { src } : {}) } }, r);
  return r;
};
function setup({ env = true, fetchImpl } = {}) {
  _setBackend(memBackend()); _resetLimits();
  if (env) { process.env.TELEGRAM_BOT_TOKEN = "123:FAKE_TEST_TOKEN"; process.env.TELEGRAM_CHAT_ID = "555"; }
  else { delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID; }
  const calls = [];
  globalThis.fetch = fetchImpl || (async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true }) }; });
  return calls;
}
const done = () => { globalThis.fetch = realFetch; _setBackend(null); delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID; };

test("גיבוי ראשון: התראה אחת עם מקור ומכשיר בעברית ומספר משתמשים", async () => {
  const calls = setup();
  const r = await post(tok(), { s: "join", d: "iphone-app" });
  assert.equal(r.code, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/bot123:FAKE_TEST_TOKEN/sendMessage");
  assert.equal(calls[0].body.chat_id, "555");
  assert.equal(calls[0].body.parse_mode, "HTML");
  assert.equal(calls[0].body.text, ["👤 <b>משתמש חדש בזפזופ</b>", "הגיע מ: קישור ההזמנה", "מכשיר: אייפון (אפליקציה)", "סה״כ משתמשים: 1"].map((l) => "‏" + l).join("\n"));
  done();
});

test("גיבוי שני לאותו טוקן (גם עם תוכן שונה): אין התראה, והמונה לא זז", async () => {
  const calls = setup(); const t = tok();
  await post(t, { s: "share", d: "desktop" });
  await bkH({ method: "POST", headers: { "x-real-ip": "1.1.1.1" }, query: {}, body: { t, data: { "tvg.sel": "[2]" }, src: { s: "share", d: "desktop" } } }, res());
  await post(t, { s: "share", d: "desktop" });
  assert.equal(calls.length, 1);
  assert.equal((await readJson("stats/users.json", null)).n, 1);
  done();
});

test("מספר המשתמשים עולה, ומקורות שונים מתורגמים", async () => {
  const calls = setup();
  await post(tok(), { s: "party", d: "iphone-safari" });
  await post(tok(), { s: "whatsapp", d: "android-browser" });
  await post(tok(), { s: "mycampaign", d: "android-app" });
  await post(tok(), { s: "direct", d: "ipad" });
  const t = calls.map((c) => c.body.text);
  assert.match(t[0], /הגיע מ: ערב צפייה/); assert.match(t[0], /אייפון \(ספארי\)/); assert.match(t[0], /סה״כ משתמשים: 1/);
  assert.match(t[1], /וואטסאפ/); assert.match(t[1], /אנדרואיד \(דפדפן\)/); assert.match(t[1], /סה״כ משתמשים: 2/);
  assert.match(t[2], /קמפיין: mycampaign/); assert.match(t[2], /אנדרואיד \(אפליקציה\)/);
  assert.match(t[3], /ישיר/); assert.match(t[3], /אייפד/); assert.match(t[3], /סה״כ משתמשים: 4/);
  done();
});

test("שחזור (src.s=restore): אין התראה ואין ספירה", async () => {
  const calls = setup();
  const r = await post(tok(), { s: "restore", d: "iphone-app" });
  assert.equal(r.code, 200);
  assert.equal(calls.length, 0);
  assert.equal(await readJson("stats/users.json", null), null);
  done();
});

test("בלי src (לקוח ישן): התראה עם 'לא ידוע'", async () => {
  const calls = setup();
  await post(tok(), null);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.text, /הגיע מ: לא ידוע/); assert.match(calls[0].body.text, /מכשיר: לא ידוע/);
  done();
});

test("בלי משתני סביבה: אין שליחה, אין שגיאה, התשובה 200 והגיבוי נשמר", async () => {
  const calls = setup({ env: false }); const t = tok();
  const r = await post(t, { s: "join", d: "desktop" });
  assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true });
  assert.equal(calls.length, 0);
  assert.ok(await readJson(`backup/${t}.json`, null));
  done();
});

test("תקרה: 10 בשעה, העודפים נספרים ומצטרפים להתראה הראשונה בשעה הבאה", async () => {
  const calls = setup();
  const { notifyNewUser } = await import("../api/_notify.js");
  const H = 3600000, t0 = Math.floor(Date.now() / H) * H + 1000;
  for (let i = 0; i < MAX_PER_HOUR + 3; i++) await notifyNewUser({ s: "direct", d: "desktop" }, t0 + i);
  assert.equal(calls.length, MAX_PER_HOUR);
  assert.ok(!calls.some((c) => /בשעה האחרונה/.test(c.body.text)));
  await notifyNewUser({ s: "direct", d: "desktop" }, t0 + H + 5);
  assert.equal(calls.length, MAX_PER_HOUR + 1);
  const last = calls[calls.length - 1].body.text;
  assert.match(last, /ועוד 3 משתמשים חדשים בשעה האחרונה/);
  assert.match(last, /סה״כ משתמשים: 14/);
  await notifyNewUser({ s: "direct", d: "desktop" }, t0 + H + 9);
  assert.ok(!/ועוד/.test(calls[calls.length - 1].body.text), "הסיכום נשלח פעם אחת");
  done();
});

test("בריחת HTML: בהודעה ובשדות לא תקינים", async () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), "&lt;a href=\"x\"&gt;&amp;&lt;/a&gt;");
  const m = buildMessage({ s: "<script>", d: "<b>x</b>" }, 3);
  assert.ok(!/<script>/.test(m) && !/<b>x/.test(m));
  assert.match(m, /הגיע מ: ישיר/);
  assert.match(m, /<b>משתמש חדש בזפזופ<\/b>/);
  assert.equal((m.match(/<b>/g) || []).length, 1);
  const calls = setup();
  await post(tok(), { s: "a&b", d: "desktop" }); // לא עובר את התבנית: ישיר
  assert.match(calls[0].body.text, /ישיר/);
  done();
});

test("ההודעה לא מכילה טוקן משתמש, IP או User-Agent", async () => {
  const calls = setup(); const t = tok();
  const r = res();
  await bkH({ method: "POST", headers: { "x-real-ip": "8.8.4.4", "user-agent": "SecretAgent/9.9" }, query: {}, body: { t, data: { "tvg.sel": "[1]" }, src: { s: "join", d: "desktop" } } }, r);
  const txt = JSON.stringify(calls[0].body);
  assert.ok(!txt.includes(t) && !txt.includes("8.8.4.4") && !txt.includes("SecretAgent"));
  done();
});

test("טלגרם נכשל (שגיאה / סטטוס כשל / תקיעה): הגיבוי עדיין 200", async () => {
  for (const f of [
    async () => { throw new Error("network down"); },
    async () => ({ ok: false, status: 500 }),
    (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  ]) {
    setup({ fetchImpl: f }); const t = tok();
    const r = await post(t, { s: "join", d: "desktop" });
    assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true });
    assert.ok(await readJson(`backup/${t}.json`, null));
    done();
  }
});
