// node --test calendar-server/test/*.mjs  - 🌙 הערב שלך: השרת (api/_tonight.js) חייב לבחור בדיוק את מה שהכרטיס בלקוח בוחר (js/render-dial.js tonightList).
// מריצים את קוד הלקוח האמיתי (core, data, series, channels, search, render-dial) ב-vm, בשעון ישראל ובזמן קבוע, על הלוח האמיתי (guide.json) ועל פרופילים רבים.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepGuide, userOf, tonightList, tonightEnd } from "../api/_tonight.js";
import { ilToMs } from "../api/_series.js";

process.env.TZ = "Asia/Jerusalem"; // הלקוח עובד בשעון המכשיר (ישראל)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = fs.readFileSync(path.join(ROOT, "guide.json"), "utf8");

function client(nowMs) {
  const RealDate = Date;
  class FDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(nowMs); } static now() { return nowMs; } }
  const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : any), apply: () => any, construct: () => any });
  const LS = {};
  const win = { TVG: { files: {}, CAL_API: "" }, addEventListener() {}, location: { search: "", href: "http://x/", origin: "http://x", pathname: "/" } };
  const ctx = vm.createContext({ window: win, document: any, navigator: { userAgent: "" }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: (k) => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); } }, location: win.location,
    setTimeout() {}, clearTimeout() {}, Intl, Date: FDate, Math, JSON, Object, Array, String, Number, RegExp, Map, Set, URLSearchParams, console });
  const T = win.TVG;
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  run("core");
  T.FAV = new Set(); // js/reminders.js (לא נטען כאן: DOM)
  T.tonightEnd = function () { const d = new FDate(); if (d.getHours() >= 4) d.setDate(d.getDate() + 1); d.setHours(4, 0, 0, 0); return d.getTime(); }; // העתק מילולי של reminders.js
  for (const f of ["data", "series", "channels", "search", "render-dial"]) run(f);
  T.G = JSON.parse(RAW); T.classify(); T.index();
  return { T, FDate };
}

// הלוח האמיתי: ערב שיש לו גם את הלילה שאחריו
const g0 = JSON.parse(RAW);
const days = [...new Set(g0.programs.map((p) => p.start.slice(0, 10)))].sort();
const DAY = days[Math.min(2, days.length - 2)];

test("parity: tonightEnd ו-04:00 זהים ללקוח (גם אחרי חצות)", () => {
  for (const hm of ["19:00", "12:00", "23:59", "00:30", "03:59", "04:00"]) {
    const now = ilToMs(DAY + "T" + hm), { T } = client(now);
    assert.equal(tonightEnd(now), T.tonightEnd(), hm);
  }
});

test("parity: הערוצים, האיחוד והמיון זהים ללקוח", () => {
  const { T } = client(ilToMs(DAY + "T19:00"));
  const G = prepGuide(JSON.parse(RAW));
  assert.deepEqual(G.channels.map((c) => [c.id, c.name, c._g, c._n, c.prov]), JSON.parse(JSON.stringify(T.G.channels.map((c) => [c.id, c.name, c._g, c._n, c.prov]))));
  assert.deepEqual(G.IDMAP, JSON.parse(JSON.stringify(T.IDMAP)));
  let n = 0;
  for (const c of G.channels) {
    const a = G.by.get(c.id), b = T.by.get(c.id);
    assert.equal(a.length, b.length, c.name);
    for (let i = 0; i < a.length; i++) { assert.equal(a[i].s, b[i].s.getTime()); assert.equal(a[i].e, b[i].e.getTime()); assert.equal(a[i].title, b[i].title); assert.equal(a[i].desc, b[i].desc); n++; }
  }
  assert.ok(n > 10000, "לוח אמיתי");
});

test("parity: tonightList זהה לכרטיס בלקוח – 120 פרופילים (מועדפים, נושאים, מעקב, ערוצים, בלי ערוצים), 19:00 ו-21:30", () => {
  const ids = g0.channels.map((c) => String(c.id));
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a, n) => { const o = []; for (let i = 0; i < n; i++) o.push(a[Math.floor(rnd() * a.length)]); return [...new Set(o)]; };
  const evTitles = [...new Set(g0.programs.filter((p) => p.start >= DAY + "T18:00" && p.start <= DAY + "T23:59").map((p) => p.title))];
  const TOPICS = ["מכבי חיפה", "הפועל באר שבע", 'בית"ר ירושלים', "חדשות", "ברצלונה", "nba", "שף", "מכבי תל אביב", "  ", "פורמולה"];
  let total = 0, nonEmpty = 0;
  for (const hm of ["19:00", "21:30"]) {
    const now = ilToMs(DAY + "T" + hm), { T, FDate } = client(now);
    const G = prepGuide(JSON.parse(RAW));
    for (let k = 0; k < 60; k++) {
      const sel = k % 10 === 0 ? [] : pick(ids, 3 + Math.floor(rnd() * 40));
      const fav = pick(evTitles, Math.floor(rnd() * 8)), topics = pick(TOPICS, Math.floor(rnd() * 3)).filter((x) => x.trim());
      const fol = pick(evTitles, Math.floor(rnd() * 3)).map((title, i) => ({ title, mode: "new", u: 1, x: i === 2 ? 1 : undefined }));
      const data = { "tvg.sel": JSON.stringify(sel), "tvg.fav": JSON.stringify(fav), "tvg.topics": JSON.stringify(topics), "tvg.fol": JSON.stringify(fol) };
      // לקוח: אותו מצב כמו אחרי עלייה (boot.js: sel דרך IDMAP)
      T.sel.clear(); sel.forEach((id) => { id = T.IDMAP[id] || id; if (T.by.has(id)) T.sel.add(id); });
      T.FAV.clear(); fav.forEach((t) => T.FAV.add(t)); T.TOPICS = topics;
      T.FOL = fol.map((x) => ({ ...x, k: T.folKey(x.title) })).filter((x) => x.k);
      const want = T.tonightList(new FDate(now)).map((x) => [x.c.id, x.p.s.getTime(), x.p.title, x.why, !!x.fol]);
      const got = tonightList(G, userOf(data), now).map((x) => [x.c.id, x.p.s, x.p.title, x.why, !!x.fol]);
      assert.deepEqual(got, JSON.parse(JSON.stringify(want)), `profile ${hm} #${k}`);
      total += got.length; if (got.length) nonEmpty++;
    }
  }
  // סף נמוך: הכמות תלויה בלוח של היום, וזו רק בדיקה שההשוואה לא ריקה
  assert.ok(nonEmpty > 20 && total > 60,  `בדיקה אמיתית: ${nonEmpty} פרופילים עם פריטים, ${total} פריטים`);
});
