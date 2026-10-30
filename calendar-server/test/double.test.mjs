// node --test calendar-server/test/*.mjs  - תזכורת כפולה ("וגם בתחילת השידור")
import test from "node:test";
import assert from "node:assert/strict";
import { clean, wantedSchedule, START_SUFFIX } from "../api/_rems.js";

const NOW = Date.now();
const mk = (o = {}) => ({ k: "5|" + (NOW + 3600000), title: "חדשות", ch: "קשת 12", ts: NOW + 3600000, end: NOW + 7200000, lead: 10, ...o });

test("clean שומר dbl רק כשיש התראה מוקדמת", () => {
  assert.equal(clean([mk({ dbl: 1 })])[0].dbl, 1);
  assert.equal(clean([mk({ dbl: true })])[0].dbl, 1);
  assert.equal(clean([mk({ dbl: 1, lead: 0 })])[0].dbl, undefined);
  assert.equal(clean([mk()])[0].dbl, undefined);
  assert.equal(clean([mk({ dbl: 0 })])[0].dbl, undefined);
});

test("wantedSchedule: בלי dbl רק התראה אחת", () => {
  const w = wantedSchedule([mk()], NOW);
  assert.deepEqual(Object.keys(w), [mk().k]);
  assert.equal(w[mk().k], NOW + 3600000 - 600000);
});

test("wantedSchedule: עם dbl נוספת הודעה ברגע ההתחלה", () => {
  const r = mk({ dbl: 1 }), w = wantedSchedule([r], NOW);
  assert.equal(w[r.k], r.ts - 600000);
  assert.equal(w[r.k + START_SUFFIX], r.ts);
});

test("wantedSchedule: תוכנית שכבר התחילה או lead=0 לא מקבלות התראת התחלה", () => {
  assert.equal(Object.keys(wantedSchedule([mk({ dbl: 1, lead: 0 })], NOW)).length, 1);
  assert.equal(Object.keys(wantedSchedule([mk({ dbl: 1, ts: NOW - 1000, end: NOW + 100000 })], NOW)).length, 0);
});

// ---- ביטול נודניק (undo בהודעה באפליקציה) ----
process.env.FIRE_SECRET = "test-secret-not-real";
process.env.QSTASH_TOKEN = "qs-test";
process.env.QSTASH_URL = "https://qstash.example";
const { handleSnooze } = await import("../api/_snz.js");
const TOK = "abcdefghij0123456789abcd";
const okToken = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);
function deps() {
  const store = {}, calls = [];
  return { calls, store, now: () => NOW, okToken, load: async () => [mk()],
    readJson: async (p, d) => store[p] ?? d, writeJson: async (p, o) => { store[p] = JSON.parse(JSON.stringify(o)); },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ messageId: "m" + calls.length }) }; } };
}

test("cancel מוחק את הנודניק שתוזמן ולא מתזמן חדש", async () => {
  const d = deps(), r = mk();
  const a = await handleSnooze({ k: r.k, t: TOK, m: 10 }, d);
  assert.equal(a.json.ok, true);
  assert.equal(d.calls.length, 1);
  const c = await handleSnooze({ k: r.k, t: TOK, m: 0, cancel: 1 }, d);
  assert.equal(c.status, 200);
  assert.equal(c.json.cancelled, true);
  assert.equal(d.calls.length, 2);
  assert.equal(d.calls[1].init.method, "DELETE");
  assert.match(d.calls[1].url, /\/v2\/messages\/m1$/);
  const again = await handleSnooze({ k: r.k, t: TOK, m: 0, cancel: 1 }, d);
  assert.equal(again.json.cancelled, false);
  assert.equal(d.calls.length, 2);
});

test("cancel בלי טוקן -> 403, ו-m:0 בלי cancel נדחה (שרת ישן לא ינדנד בטעות)", async () => {
  const d = deps(), r = mk();
  assert.equal((await handleSnooze({ k: r.k, cancel: 1 }, d)).status, 403);
  assert.equal((await handleSnooze({ k: r.k, t: TOK, m: 0 }, d)).status, 400);
});
