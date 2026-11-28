// node --test calendar-server/test/*.mjs  - ⚽ הצד של הלקוח בתיאום עם השרת (js/reminders.js mergeSrv/pullRems/syncRems, js/team.js teamTX/teamMark),
// על הקוד האמיתי ב-vm: תזכורת שהשרת הוסיף נקלטת פעם אחת, מסומנת כמטופלת, ומה שהמשתמש מחק לא חוזר. ה-tx נשלח עם כל שמירה.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.TZ = "Asia/Jerusalem";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOW = Date.UTC(2026, 10, 29, 10, 0);
const TOKV = "abcdefghij0123456789abcd";

function client(ls, reply) {
  const RealDate = Date;
  class FDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
  const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : any), apply: () => any, construct: () => any });
  const LS = { "tvg.push": "1", "tvg.calTok": TOKV, ...ls };
  const win = { TVG: { files: {}, CAL_API: "" }, addEventListener() {}, location: { search: "", href: "http://x/", origin: "http://x", pathname: "/" } };
  const reqs = [], timers = [];
  const ctx = vm.createContext({ window: win, document: any, navigator: { userAgent: "" }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: (k) => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); } }, location: win.location,
    fetch: (u, o) => { reqs.push({ u, o }); const j = reply(u, o); return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(j) }); },
    setTimeout(f) { timers.push(f); return timers.length; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {}, Intl, Date: FDate, Math, JSON, Object, Array, String, Number, RegExp, Map, Set, URLSearchParams, Uint8Array, Promise, console });
  const T = win.TVG;
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  run("core"); run("data"); run("channels"); run("reminders"); run("reminder-sheet");
  T.render = () => {}; T.pill = () => {};
  run("team"); run("snooze");
  return { T, LS, reqs, timers };
}
const TS = NOW + 30 * 3600000;
const srvRec = (k = "289|" + TS, ks = [k, "301|" + (TS - 300000)]) => ({ k, id: k.split("|")[0], ts: TS, end: TS + 7200000, title: "ישיר! ליגת ווינר: מכבי חיפה - ביתר ירושלים", ch: "ספורט 5", desc: "כדורגל", lead: 30, at: NOW - 1000, srv: 1, ks });
const tick = () => new Promise((r) => setImmediate(r));

test("mergeSrv: תזכורת חדשה מהשרת נקלטת (בלי srv/ks), כל המפתחות שלה ב-teamX, ולא נקלטת פעמיים", () => {
  const { T, LS } = client({}, () => ({}));
  const m = T.mergeSrv([srvRec()]);
  assert.equal(m.add.length, 1); assert.equal(m.ack, true);
  assert.equal(T.REMS.length, 1);
  assert.deepEqual(Object.keys(T.REMS[0]).sort(), ["at", "ch", "desc", "end", "id", "k", "lead", "title", "ts"]);
  assert.deepEqual(JSON.parse(LS["tvg.teamX"]).sort(), ["289|" + TS, "301|" + (TS - 300000)].sort());
  assert.deepEqual(JSON.parse(LS["tvg.rem"]).map((r) => r.k), ["289|" + TS]);
  const m2 = T.mergeSrv([srvRec()]);
  assert.equal(m2.add.length, 0); assert.equal(T.REMS.length, 1);
});

test("mergeSrv: משחק שכבר טופל כאן (מפתח מקביל ב-teamX, למשל נמחק בידי המשתמש) לא נקלט, ומבקשים לאשר לשרת", () => {
  const { T } = client({ "tvg.teamX": JSON.stringify(["301|" + (TS - 300000)]) }, () => ({}));
  const m = T.mergeSrv([srvRec()]);
  assert.equal(m.add.length, 0); assert.equal(m.ack, true); assert.equal(T.REMS.length, 0);
  // רשומה רגילה (לא srv) לא נוגעים בה
  assert.equal(T.mergeSrv([{ ...srvRec(), srv: undefined }]).ack, false);
});

test("syncRems שולח tx = tvg.teamX; תשובה עם srv נקלטת ומאושרת בשמירה נוספת", async () => {
  let n = 0;
  const { T, reqs, timers } = client({ "tvg.teamX": JSON.stringify(["5|1"]) }, (u, o) => (o && o.method === "POST" && n++ === 0 ? { ok: true, srv: [srvRec()] } : { ok: true }));
  await T.syncRems(); await tick();
  const b = JSON.parse(reqs[0].o.body);
  assert.deepEqual(b.tx, ["5|1"]); assert.deepEqual(b.rems, []);
  assert.equal(T.REMS.length, 1);
  timers.forEach((f) => f()); await tick(); // השמירה המאשרת
  const b2 = JSON.parse(reqs[1].o.body);
  assert.deepEqual(b2.rems.map((r) => r.k), ["289|" + TS]); assert.ok(b2.tx.includes("289|" + TS));
});

test("pullRems: בעלייה מצרף תזכורות שהשרת הוסיף ומאשר; שחזור לרשימה ריקה מנקה srv/ks", async () => {
  const own = { k: "3819|" + (TS + 3600000), title: "חדשות", ch: "קשת 12", ts: TS + 3600000, end: TS + 7200000, lead: 10 };
  const { T, reqs } = client({ "tvg.rem": JSON.stringify([own]) }, (u, o) => (o && o.method === "POST" ? { ok: true } : { rems: [own, srvRec()] }));
  const n = await T.pullRems(); await tick();
  assert.equal(n, 1);
  assert.deepEqual(T.REMS.map((r) => r.k).sort(), [own.k, "289|" + TS].sort());
  assert.ok(reqs.some((r) => r.o && r.o.method === "POST"), "אישור לשרת");
  const c2 = client({}, () => ({ rems: [srvRec()] }));
  await c2.T.pullRems();
  assert.equal(c2.T.REMS.length, 1); assert.equal(c2.T.REMS[0].srv, undefined); assert.equal(c2.T.REMS[0].ks, undefined);
});

test("pullRems: בלי התראות/יומן (srv() כבוי) – לא פונה לשרת, ומחזיר Promise", async () => {
  const { T, reqs } = client({ "tvg.push": "0" }, () => ({}));
  assert.equal(await T.pullRems(), 0); assert.equal(reqs.length, 0);
});

test("הקשה על התראה לתזכורת שהשרת הוסיף ועוד לא כאן (?rem=K): openSnooze מושך מהשרת ופותח אותה", async () => {
  const k = "289|" + TS;
  const { T, reqs } = client({}, (u, o) => (o && o.method === "POST" ? { ok: true } : { rems: [srvRec()] }));
  let seen = null; const orig = T.hasRem; T.hasRem = (x) => { const r = orig(x); if (x === k && r) seen = r; return r; };
  T.openSnooze(k); await tick(); await tick();
  assert.ok(reqs.some((r) => /\/api\/rems\?t=/.test(r.u)), "משך מהשרת");
  assert.ok(seen && seen.title, "נמצאה בניסיון השני");
});
