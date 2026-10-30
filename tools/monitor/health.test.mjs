import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGuide, evaluateNetflix, evaluateCaches, parseSiteFiles, runHealth, israelNow, T } from "./health.mjs";

// שישי 2026-10-30 12:00 שעון ישראל (UTC+2 אחרי המעבר לשעון חורף) – מחר שבת
const NOW = new Date("2026-10-30T10:00:00Z");
const day = (n) => new Date(Date.parse("2026-10-30T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// לוח מזויף: כל הערוצים המרכזיים + 125 ערוצי HOT, 80 תוכניות ביום, 8 ימים (עובר את רצפת הכמות)
function fakeGuide({ skip = {}, updated = "2026-10-30T09:00:00Z", fillDesc = true, drop = [] } = {}) {
  let channels = [
    { id: "k11", name: "HD כאן" }, { id: "k12", name: "קשת" }, { id: "k13", name: "רשת SD" }, { id: "x14", name: "ערוץ 14" },
    { id: "xi24", name: "i24NEWS" }, { id: "xk", name: "ערוץ הכנסת" }, { id: "xkids", name: "כאן חינוכית" },
    { id: "s1", name: "ספורט 1 HD" }, { id: "s5", name: "ספורט 5+" },
  ];
  for (let i = 0; i < 125; i++) channels.push({ id: "h" + i, name: "HOT ערוץ " + i });
  channels = channels.filter((c) => !drop.includes(c.id));
  const programs = [];
  for (const c of channels) for (let d = 0; d < 8; d++) {
    if ((skip[c.id] || []).includes(day(d))) continue;
    for (let j = 0; j < 24; j++) programs.push({ ch: c.id, start: day(d) + "T" + String(j).padStart(2, "0") + ":00", title: "t", ...(fillDesc && j % 2 ? { desc: "d" } : {}) });
  }
  return { updated, channels, programs };
}

test("לוח תקין – אין בעיות", () => {
  const r = evaluateGuide(fakeGuide(), NOW);
  assert.deepEqual(r.problems, []);
  assert.equal(r.info.channelsReport["ערוץ 14"].found, true);
});

test("לוח ישן מ-30 שעות", () => {
  const r = evaluateGuide(fakeGuide({ updated: "2026-10-29T03:00:00Z" }), NOW);
  assert.ok(r.problems.some((p) => p.includes("לא התעדכן")));
});

test("ערוץ ללא תוכניות היום מסומן", () => {
  const r = evaluateGuide(fakeGuide({ skip: { k12: [day(0)] } }), NOW);
  assert.ok(r.problems.some((p) => p.startsWith("קשת 12") && p.includes("1 מתוך 4")));
});

test("חריג שבת: ערוץ 14 בלי תוכניות בשבת תקין", () => {
  assert.equal(new Date(day(1) + "T12:00:00Z").getUTCDay(), 6); // מחר שבת
  assert.deepEqual(evaluateGuide(fakeGuide({ skip: { x14: [day(1)] } }), NOW).problems, []);
});

test("חריג השבת לא חל על ערוץ אחר או על שישי", () => {
  assert.ok(evaluateGuide(fakeGuide({ skip: { k13: [day(1)] } }), NOW).problems.some((p) => p.startsWith("רשת 13")));
  assert.ok(evaluateGuide(fakeGuide({ skip: { x14: [day(0)] } }), NOW).problems.some((p) => p.startsWith("ערוץ 14")));
});

test("ערוץ 14 דורש 5 ימים, כאן חינוכית 2", () => {
  assert.ok(evaluateGuide(fakeGuide({ skip: { x14: [day(4)] } }), NOW).problems.some((p) => p.startsWith("ערוץ 14")));
  assert.deepEqual(evaluateGuide(fakeGuide({ skip: { xkids: [day(2), day(3)] } }), NOW).problems, []);
  assert.ok(evaluateGuide(fakeGuide({ skip: { xkids: [day(1)] } }), NOW).problems.some((p) => p.startsWith("כאן חינוכית")));
});

test("רצפת תקצירים", () => {
  assert.ok(evaluateGuide(fakeGuide({ fillDesc: false }), NOW).problems.some((p) => p.includes("עם תקציר")));
  assert.ok(T.MIN_SYNOPSIS_PCT >= 35);
});

test("ערוץ חסר בלוח", () => {
  assert.ok(evaluateGuide(fakeGuide({ drop: ["xi24"] }), NOW).problems.some((p) => p.includes("i24NEWS") && p.includes("לא נמצא")));
});

test("נטפליקס", () => {
  const items = Object.fromEntries(Array.from({ length: 50 }, (_, i) => ["t" + i, i < 5 ? { ratings: { imdb: 7 }, vote: 7 } : { vote: 7 }]));
  const ok = evaluateNetflix({ v: 2, updated: "2026-10-30T08:00:00Z", items }, NOW);
  assert.deepEqual(ok.problems, []); assert.equal(ok.info.rated, 5);
  assert.ok(evaluateNetflix({ v: 1, updated: "2026-10-30T08:00:00Z", items }, NOW).problems.length);
  assert.ok(evaluateNetflix({ v: 2, updated: "2026-10-30T08:00:00Z", items: {} }, NOW).problems.some((p) => p.includes("פריטים")));
  assert.ok(evaluateNetflix({ v: 2, updated: "2026-10-28T08:00:00Z", items }, NOW).problems.some((p) => p.includes("לא התעדכן")));
});

test("מטמוני המחשב בבית", () => {
  const hot = { "1|2026-11-02T01:57": {}, "1|2026-10-30T10:00": {} };
  assert.deepEqual(evaluateCaches(hot, { x14: { at: "2026-10-30T08:00:00Z" } }, NOW).problems, []);
  const stale = evaluateCaches({ "1|2026-10-29T23:00": {} }, { x14: { at: "2026-10-27T08:00:00Z" } }, NOW);
  assert.equal(stale.problems.length, 2);
  assert.ok(stale.problems.some((p) => p.startsWith("המחשב בבית לא עדכן את ערוץ 14/HOT מאז")));
});

test("israelNow ושעון חורף/קיץ", () => {
  assert.equal(israelNow(new Date("2026-10-30T22:30:00Z")).slice(0, 10), "2026-10-31"); // 00:30 בישראל
  assert.equal(israelNow(new Date("2026-07-01T21:30:00Z")).slice(0, 13), "2026-07-02 00"); // UTC+3
});

test("parseSiteFiles", () => {
  const h = 'var VERSION = "1.34", BUILD = "2026-10-30.34"; TVG.list = ["core","data","boot"];';
  assert.deepEqual(parseSiteFiles(h), { build: "2026-10-30.34", files: ["core", "data", "boot"] });
});

test("runHealth עם fetch מזויף: הכול תקין, ורק GET", async () => {
  const guide = fakeGuide(), calls = [];
  const idx = 'var BUILD = "B1"; TVG.list = ["core","boot"];';
  const nf = { v: 2, updated: "2026-10-30T09:00:00Z", items: Object.fromEntries(Array.from({ length: 50 }, (_, i) => ["t" + i, {}])) };
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET" });
    const u = url.replace(/\?.*/, "");
    const res = (body, ct = "application/json") => ({ status: 200, headers: { get: () => ct }, json: async () => body, text: async () => body });
    if (u.endsWith("index.html")) return res(idx, "text/html");
    if (u.endsWith("guide.json")) return res(guide);
    if (u.endsWith("netflix.json")) return res(nf);
    if (u.endsWith("hot-cache.json")) return res({ "1|2026-11-02T01:57": {} });
    if (u.endsWith("extra-cache.json")) return res({ x14: { at: "2026-10-30T08:00:00Z" } });
    if (u.endsWith("/api/push")) return res({ scheduler: true });
    if (u.endsWith("/api/rems")) { assert.match(url, /t=[a-z0-9]{30}$/); return res({ rems: [] }); }
    if (u.endsWith(".ics")) return res("BEGIN", "text/calendar; charset=utf-8");
    return res("x", "text/plain");
  };
  const r = await runHealth({ fetchFn, now: NOW });
  assert.deepEqual(r.problems, []);
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.ok(calls.some((c) => c.url.includes("js/core.js?v=B1")));
});

test("runHealth: 404 על קובץ js וה-scheduler כבוי", async () => {
  const fetchFn = async (url) => {
    const u = url.replace(/\?.*/, "");
    const res = (body, status = 200, ct = "application/json") => ({ status, headers: { get: () => ct }, json: async () => body, text: async () => body });
    if (u.endsWith("index.html")) return res('BUILD = "B1"; TVG.list = ["core"];', 200, "text/html");
    if (u.endsWith("core.js")) return res("", 404);
    if (u.endsWith("/api/push")) return res({ scheduler: false });
    return res({}, 500);
  };
  const r = await runHealth({ fetchFn, now: NOW });
  assert.ok(r.problems.includes("js/core.js: HTTP 404"));
  assert.ok(r.problems.some((p) => p.includes("scheduler")));
  assert.equal(r.ok, false);
});
