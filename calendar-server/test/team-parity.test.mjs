// node --test calendar-server/test/*.mjs  - ⚽ הקבוצה שלי: השרת (api/_team.js) חייב למצוא בדיוק את המשחקים שהלקוח (js/team.js) מוצא,
// ולהוסיף בדיוק את התזכורות ש-teamSync בלקוח היה מוסיף (אותו מפתח, ערוץ, זמנים, lead). מריצים את קוד הלקוח האמיתי
// (core, data, reminders, reminder-sheet, team) ב-vm, בשעון ישראל ובזמן קבוע, על הלוח האמיתי (guide.json).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepGuide, userChans } from "../api/_tonight.js";
import { games, autoAdds, teamUserOf } from "../api/_team.js";
import { ilToMs } from "../api/_series.js";

process.env.TZ = "Asia/Jerusalem"; // הלקוח עובד בשעון המכשיר (ישראל)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = fs.readFileSync(path.join(ROOT, "guide.json"), "utf8");

// לקוח אחד במצב נתון (localStorage), בזמן קבוע
function client(nowMs, ls = {}, raw = RAW) {
  const RealDate = Date;
  class FDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(nowMs); } static now() { return nowMs; } }
  const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : any), apply: () => any, construct: () => any });
  const LS = { ...ls };
  const win = { TVG: { files: {}, CAL_API: "" }, addEventListener() {}, location: { search: "", href: "http://x/", origin: "http://x", pathname: "/" } };
  const posts = [];
  const ctx = vm.createContext({ window: win, document: any, navigator: { userAgent: "" }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: (k) => (k in LS ? LS[k] : null), setItem: (k, v) => { LS[k] = String(v); } }, location: win.location,
    fetch: (u, o) => { posts.push({ u, o }); return new Promise(() => {}); },
    setTimeout() {}, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {}, Intl, Date: FDate, Math, JSON, Object, Array, String, Number, RegExp, Map, Set, URLSearchParams, Uint8Array, Promise, console });
  const T = win.TVG;
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  run("core"); run("data"); run("channels"); run("reminders"); run("reminder-sheet");
  T.render = () => {}; T.pill = () => {};
  run("team");
  T.G = JSON.parse(raw); T.classify(); T.index();
  T.sel.clear(); for (let id of JSON.parse(LS["tvg.sel"] || "[]")) { id = T.IDMAP[id] || id; if (T.by.has(id)) T.sel.add(id); } // boot.js
  T.gen = "all";
  return { T, FDate, LS, posts };
}

const g0 = JSON.parse(RAW);
const days = [...new Set(g0.programs.map((p) => p.start.slice(0, 10)))].sort();
const DAY0 = days[Math.min(1, days.length - 1)];
const NOWS = [DAY0 + "T12:00", days[Math.min(3, days.length - 1)] + "T20:30"];
const TEAMS = ["מכבי חיפה", "מכבי תל אביב", "הפועל באר שבע", "הפועל תל אביב", 'בית"ר ירושלים', "ברצלונה", "ריאל מדריד"];
const SPORTS = ["fb", "bb", ""];
const SEL = [[], ["289", "301", "3547", "205"], g0.channels.slice(0, 40).map((c) => String(c.id))];

const gRow = (g) => [g.c.id, g.p.s, g.p.title, g.sp, g.a, g.b, (g.alts || []).map((a) => [a.c.id, a.p.s])];

test("parity: games() – אותם משחקים, אותו ערוץ ראשי, אותם ערוצים מקבילים ושידורים חוזרים (קבוצות × ענף × ערוצים × זמן)", () => {
  let total = 0, reps = 0;
  for (const hm of NOWS) {
    const now = ilToMs(hm), G = prepGuide(JSON.parse(RAW));
    for (const sel of SEL) {
      const { T, FDate } = client(now, { "tvg.sel": JSON.stringify(sel) });
      for (const n of TEAMS) for (const sport of SPORTS) {
        const want = T.teamLib.games([{ n, sport }], new FDate(now));
        const got = games(G, [{ n, sport }], now, userChans(G, sel, now).map((c) => c.id));
        const w = (r) => r.map((g) => [g.c.id, g.p.s.getTime(), g.p.title, g.sp, g.a, g.b, (g.alts || []).map((a) => [a.c.id, a.p.s.getTime()])]);
        assert.deepEqual(got.games.map(gRow), JSON.parse(JSON.stringify(w(want.games))), `${hm} ${n} ${sport} sel=${sel.length}`);
        assert.deepEqual(got.reps.map(gRow), JSON.parse(JSON.stringify(w(want.reps))), `reps ${hm} ${n} ${sport}`);
        total += got.games.length; reps += got.reps.length;
      }
      // כמה קבוצות ביחד: הקבוצה הראשונה שמתאימה קובעת
      const multi = [{ n: "מכבי חיפה", sport: "" }, { n: "מכבי תל אביב", sport: "bb" }, { n: "הפועל באר שבע", sport: "fb" }];
      assert.deepEqual(games(G, multi, now, userChans(G, sel, now).map((c) => c.id)).games.map((g) => [g.c.id, g.p.s, g.t.n]),
        JSON.parse(JSON.stringify(T.teamLib.games(multi, new FDate(now)).games.map((g) => [g.c.id, g.p.s.getTime(), g.t.n]))));
    }
  }
  // בלי רצפה: בשבוע שקט (או בפגרה) הלוח האמיתי יכול להיות בלי משחקים, והפריסה לא אמורה להיחסם בגלל זה. הכיסוי הלא-ריק – בבדיקה על הלוח הקבוע למטה
  console.log(`team parity (live guide): ${total} games, ${reps} replays`);
});

test("parity: התזכורות ש-teamSync בלקוח מוסיף = autoAdds בשרת (מפתח, ערוץ, ts, end, כותרת, תקציר, lead), כולל tvg.teamX ותזכורות קיימות", () => {
  let n = 0;
  for (const hm of NOWS) {
    const now = ilToMs(hm), G = prepGuide(JSON.parse(RAW));
    for (const [i, teams] of [[{ n: "מכבי חיפה", sport: "" }], [{ n: "מכבי תל אביב", sport: "bb" }, { n: "הפועל באר שבע", sport: "fb" }], [{ n: "מכבי תל אביב", sport: "" }, { n: "ברצלונה", sport: "" }]].entries()) {
      for (const lead of ["10", "60", "1440", undefined]) {
        const sel = SEL[(i + n) % SEL.length];
        // מצב התחלתי: תזכורת קיימת אחת ומפתח אחד ב-teamX (כדי לבדוק שגם הם מכובדים)
        const base = client(now, { "tvg.sel": JSON.stringify(sel) }), G2 = base.T.teamLib.games(teams, new base.FDate(now)).games.filter((g) => g.p.s.getTime() > now + 60000);
        const useEx = lead !== undefined; // בלי lead: מצב נקי (בלי תזכורת קיימת ובלי teamX)
        const ex = useEx && G2[0] ? [{ k: G2[0].c.id + "|" + G2[0].p.s.getTime(), title: "x", ts: G2[0].p.s.getTime(), end: G2[0].p.e.getTime(), lead: 10 }] : [];
        const tx = useEx && G2[1] ? [G2[1].c.id + "|" + G2[1].p.s.getTime()] : [];
        const data = { "tvg.sel": JSON.stringify(sel), "tvg.teams": JSON.stringify(teams), "tvg.teamAuto": "1", "tvg.teamX": JSON.stringify(tx), "tvg.rem": JSON.stringify(ex), "tvg.push": "1", "tvg.calTok": "abcdefghij0123456789abcd" };
        if (lead) data["tvg.lead"] = lead;
        const { T } = client(now, data);
        T.teamSync(true);
        const want = T.REMS.filter((r) => !ex.some((e) => e.k === r.k));
        const u = teamUserOf(data), own = new Set(ex.map((r) => r.k)), dn = new Set(u.tx);
        const got = autoAdds(G, u, now, (k) => own.has(k), (k) => dn.has(k)).map((a) => a.rec);
        assert.deepEqual(got, JSON.parse(JSON.stringify(want)), `${hm} #${i} lead=${lead}`);
        n += got.length;
      }
    }
  }
  console.log(`team parity (live guide): ${n} reminders`);
});

// לוח קבוע (לא תלוי בעדכון הלילי): משחק חי בשני ערוצים, שידור חוזר, כדורסל, ותוכנית "תקציר" – הלקוח והשרת חייבים להסכים, והתוצאה לא ריקה
const FIXED = JSON.stringify({ updated: "2026-11-29T03:10:00.000Z",
  channels: [{ id: "289", name: "ערוץ הספורט" }, { id: "301", name: "5+ LIVE" }, { id: "3819", name: "קשת" }, { id: "520", name: "ספורט 1" }, { id: "3550", name: "5GOLD" }],
  programs: [
    { ch: "289", start: "2026-11-30T20:30", title: "אולפן ליגת העל" },
    { ch: "289", start: "2026-11-30T21:00", title: "ישיר! ליגת ווינר: מכבי חיפה - ביתר ירושלים", desc: "כדורגל, ליגת העל", lv: 1 },
    { ch: "289", start: "2026-11-30T23:00", title: "תקציר: מכבי חיפה - ביתר ירושלים" },
    { ch: "289", start: "2026-12-01T02:00", title: "ליגת ווינר: מכבי חיפה - ביתר ירושלים (ש.ח)", desc: "כדורגל" },
    { ch: "289", start: "2026-12-01T04:00", title: "סגירה" },
    { ch: "301", start: "2026-11-30T20:55", title: "ישיר! ליגת ווינר: מ. חיפה - ב. ירושלים", desc: "כדורגל", lv: 1 },
    { ch: "301", start: "2026-11-30T23:00", title: "סגירה" },
    { ch: "520", start: "2026-12-02T20:00", title: "יורוליג: מכבי ת\"א - ריאל מדריד", desc: "כדורסל, יורוליג", lv: 1 },
    { ch: "520", start: "2026-12-02T22:00", title: "ליגת ווינר: הפועל ב\"ש - מכבי ת\"א", desc: "כדורגל" },
    { ch: "520", start: "2026-12-03T00:00", title: "סגירה" },
    { ch: "3550", start: "2026-12-01T12:00", title: "ליגת ווינר: מכבי חיפה - הפועל ב\"ש", desc: "כדורגל 95/96" },
    { ch: "3550", start: "2026-12-01T14:00", title: "סגירה" },
    { ch: "3819", start: "2026-11-29T20:00", title: "חדשות" },
  ] });

test("parity על לוח קבוע: games ו-teamSync זהים ולא ריקים (מכבי חיפה, מכבי ת״א, הפועל ב״ש × ענף × ערוצים)", () => {
  const now = ilToMs("2026-11-29T12:00"), G = prepGuide(JSON.parse(FIXED));
  let games0 = 0, recs = 0;
  for (const sel of [[], ["289"], ["301", "520"]]) {
    const { T, FDate } = client(now, { "tvg.sel": JSON.stringify(sel) }, FIXED);
    for (const n of ["מכבי חיפה", "מכבי תל אביב", "הפועל באר שבע"]) for (const sport of SPORTS) {
      const want = T.teamLib.games([{ n, sport }], new FDate(now)).games.map((g) => [g.c.id, g.p.s.getTime(), g.p.title, (g.alts || []).map((a) => a.c.id)]);
      const got = games(G, [{ n, sport }], now, userChans(G, sel, now).map((c) => c.id)).games.map((g) => [g.c.id, g.p.s, g.p.title, g.alts.map((a) => a.c.id)]);
      assert.deepEqual(got, JSON.parse(JSON.stringify(want)), `${n} ${sport} ${sel}`);
      games0 += got.length;
    }
    const teams = [{ n: "מכבי חיפה", sport: "" }, { n: "מכבי תל אביב", sport: "" }];
    const data = { "tvg.sel": JSON.stringify(sel), "tvg.teams": JSON.stringify(teams), "tvg.teamAuto": "1", "tvg.lead": "30", "tvg.push": "1", "tvg.calTok": "abcdefghij0123456789abcd" };
    const c = client(now, data, FIXED); c.T.teamSync(true);
    const got = autoAdds(G, teamUserOf(data), now, () => false, () => false).map((a) => a.rec);
    assert.deepEqual(got, JSON.parse(JSON.stringify(c.T.REMS)), `teamSync ${sel}`);
    recs += got.length;
  }
  assert.ok(games0 >= 12 && recs >= 6, `${games0} משחקים, ${recs} תזכורות`);
});
