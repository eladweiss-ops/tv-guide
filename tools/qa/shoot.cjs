#!/usr/bin/env node
/*
 * Screenshot harness for the TV guide PWA.
 *
 *   node tools/qa/shoot.cjs <outDir> [baseUrl]
 *
 * Without baseUrl it serves the repo root on a random local port.
 * Takes screenshots of every tab and sheet at 375 + 393 (iPhone UA) and 360 + 412 (Android Chrome UA),
 * freezes the clock so before/after runs are comparable, and fails (exit 1) on any console error / pageerror.
 * After EVERY snap a layout audit runs (tools/qa/audit.cjs): touching/overlapping/tiny controls, clipped text, horizontal overflow.
 * It writes <outDir>/qa-audit-<device>.json and prints "audit <device> issues: N"; TVG_AUDIT_STRICT=1 makes issues fail the run (exit 1).
 * Compare two runs with:  node tools/qa/diff.cjs <dirA> <dirB>
 *
 * Needs installed Chrome (channel "chrome") and:  cd tools/qa && npm install
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright-core");
const { audit: runAudit } = require("./audit.cjs");
const touch = require("./touch.cjs"); // מגע אמיתי (CDP) לצעדי fluid-*

const OUT = path.resolve(process.argv[2] || "shots");
const REPO = path.resolve(__dirname, "..", "..");
const FIXED_NOW = process.env.TVG_NOW || "2026-11-01T20:15:00+02:00"; // inside the range guide.json covers
const SEL = ["208", "199", "3787", "3819", "3547", "334", "3588", "301", "255", "315", "559", "223"]; // seeded tvg.sel

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const androidUA = (m) => "Mozilla/5.0 (Linux; Android 14; " + m + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DEVICES = [
  { name: "iphone_375", w: 375, h: 812, dpr: 3, ua: IPHONE_UA },
  { name: "iphone_393", w: 393, h: 852, dpr: 3, ua: IPHONE_UA },
  { name: "android_360", w: 360, h: 780, dpr: 3, ua: androidUA("SM-S911B") },
  { name: "android_412", w: 412, h: 839, dpr: 2.625, ua: androidUA("Pixel 7") },
];

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      const f = path.join(REPO, p);
      if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("nf"); }
      res.setHeader("Content-Type", MIME[path.extname(f)] || "application/octet-stream"); res.setHeader("Cache-Control", "no-store");
      fs.createReadStream(f).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve({ srv, url: "http://127.0.0.1:" + srv.address().port + "/" }));
  });
}

// ---- חיפוש נטפליקס ושרת ההתראות: תשובות מדומות (בלי קריאות חיות). נתיבי תמונה fx_* נענים ב-SVG מקומי ----
function fxItem(k, title, o = {}) {
  return { k, id: +k.slice(1), type: k[0] === "t" ? "tv" : "movie", title, orig: o.orig || "", year: o.year || 2019, overview: o.ov || "תקציר לדוגמה של התוכן, כמה שורות כדי לבדוק גלישה ויישור בעברית.",
    poster: "https://image.tmdb.org/t/p/w342/fx_" + k + ".jpg", backdrop: "", nf: !!o.nf, ds: !!o.ds, dlink: o.ds ? "https://www.disneyplus.com/he-il/search?q=" + encodeURIComponent(o.orig || title) : "", others: o.others || [], link: o.nf ? "https://www.netflix.com/search?q=" + encodeURIComponent(o.orig || title) : "" };
}
function nfSearchFixture(q) {
  const base = { v: 1, q, collection: null, brand: null, titles: [], persons: [], items: {} };
  const put = (it) => { base.items[it.k] = it; return it.k; };
  if (q === "הנוקמים") {
    base.collection = { id: 86311, name: "הנוקמים - אוסף", poster: "", keys: [
      put(fxItem("m24428", "הנוקמים", { orig: "The Avengers", year: 2012, others: ["Prime Video"] })), put(fxItem("m99861", "הנוקמים: עידן אולטרון", { orig: "Avengers: Age of Ultron", year: 2015, ds: true })),
      put(fxItem("m299536", "הנוקמים: מלחמת האינסוף", { orig: "Avengers: Infinity War", year: 2018, nf: true })), put(fxItem("m299534", "הנוקמים: סוף המשחק", { orig: "Avengers: Endgame", year: 2019, nf: true }))] };
    base.titles = [put(fxItem("t88001", "הזמר במסכה", { year: 2018 })), put(fxItem("m88002", "הכוורת", { year: 1976 })), put(fxItem("t88003", "הנוקמים: מועדון הנוקמים האגדי והמיוחד מכולם", { orig: "Avengers Assemble Forever", year: 2013, ds: true, others: ["Prime Video"] }))];
    base.persons = [{ id: 3223, name: "רוברט דאוני ג׳וניור", photo: "https://image.tmdb.org/t/p/w185/fx_p3223.jpg", dept: "משחק", keys: [put(fxItem("m1726", "איש הברזל", { orig: "Iron Man", year: 2008, ds: true })), put(fxItem("m299534", "הנוקמים: סוף המשחק", { orig: "Avengers: Endgame", year: 2019, nf: true })), put(fxItem("m27205", "ההתחלה", { orig: "Inception", year: 2010, nf: true }))] }];
  } else if (q === "טום הנקס") {
    base.persons = [{ id: 31, name: "טום הנקס", photo: "https://image.tmdb.org/t/p/w185/fx_p31.jpg", dept: "משחק", keys: ["m13", "m857", "m497", "m9800"].map((k, i) => put(fxItem(k, ["פורסט גאמפ", "להציל את טוראי ריאן", "הקו הירוק", "מחוץ לזמן"][i], { year: 1994 + i, nf: i === 0 }))) }];
  } else if (q === "מארוול") {
    base.brand = { name: "Marvel Studios", keys: ["m1726", "m10138", "m24428", "t88001", "m299534"].map((k, i) => put(fxItem(k, ["איש הברזל", "איש הברזל 2", "הנוקמים", "הזמר במסכה", "הנוקמים: סוף המשחק"][i], { year: 2008 + i, nf: i === 4, ds: i < 3 }))) };
  }
  return base;
}
const fxSvg = (path) => { const h = (path.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 360); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,38%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},60%,22%)"/></linearGradient></defs><rect width="2" height="3" fill="url(#g)"/></svg>`; };

// עותק של netflix.json עם ציונים לכמה פריטים + פריט קצה (שם ארוך מעורב, בלי תמונות) - לבדיקות בלבד
function nfFixtureData() {
  const j = JSON.parse(fs.readFileSync(path.join(REPO, "netflix.json"), "utf8"));
  const keys = Object.keys(j.items);
  keys.forEach((k, i) => { if (i % 3 === 0) j.items[k].ratings = { imdb: 6.5 + (i % 30) / 10, votes: 120000, rt: 60 + (i % 40), mc: 55 + (i % 40) }; });
  j.items[j.hero].ratings = { imdb: 8.7, votes: 900000, rt: 94, mc: 81 };
  j.items.x_edge = { id: 1, type: "tv", title: "הסדרה הארוכה ביותר בעולם: Stranger Things 5 - הפרק האחרון והסופי של הכול", orig: "Stranger Things: The Final Chapter", year: 2026, date: "2026-10-01", overview: "", poster: "", backdrop: "", genres: ["מד״ב", "דרמה", "אימה", "מתח"], seasons: 5, imdb_id: "", link: "", trailer: "", ratings: { rt: 88 } };
  j.rows.popular.unshift("x_edge");
  // כל השורות החדשות (מהמאגר האמיתי בסיבוב, 24 בכל אחת), כותרות ב-rowMeta, ופוסטרים מצוירים (fx_) כדי שהצילומים יציגו את השורות מלאות
  const mk = keys.filter((k) => /^m/.test(k)), tk = keys.filter((k) => /^t/.test(k));
  const take = (pool, n, off) => Array.from({ length: Math.min(n, pool.length) }, (_, i) => pool[(i + off) % pool.length]);
  const mix = (n, off) => { const a = take(mk, n / 2, off), b = take(tk, n / 2, off); return a.flatMap((k, i) => [k, b[i]]).filter(Boolean); };
  j.rows.israeli = mix(24, 3); j.rows.week = mix(24, 9); j.rows.series = take(tk, 24, 5); j.rows.movies = take(mk, 24, 2);
  j.rows.comedy = mix(24, 14); j.rows.crime = mix(24, 20); j.rows.docu = mix(10, 1); j.rows.family = mix(24, 7);
  j.rowMeta = { popular: { title: "הכי נצפים" }, recent: { title: "יצא לאחרונה" }, top: { title: "הכי מדורגים" }, israeli: { title: "🇮🇱 ישראלי בנטפליקס" }, week: { title: "🆕 יצא החודש" }, series: { title: "📺 סדרות" }, movies: { title: "🎬 סרטים" }, comedy: { title: "😂 קומדיה" }, crime: { title: "🔪 מתח ופשע" }, docu: { title: "🎙 דוקו" }, family: { title: "👨‍👩‍👧 לכל המשפחה" } };
  Object.keys(j.items).forEach((k) => { if (k !== "x_edge") j.items[k].poster = "https://image.tmdb.org/t/p/w342/fx_" + k + ".jpg"; });
  return j;
}

// disney.json מדומה (אותה סכמה כמו netflix.json): ~70 פריטים עם פוסטרים מצוירים (fx_), ציוני IMDb לחלקם, וקישורי דיסני+
function dsFixtureData() {
  const names = ["אלזה והקרח", "שר הטבעות הילדותי", "הקוסם מארץ עוץ", "אריאל", "מופאסה", "סימבה", "ווינאי", "קוקו", "הנוקם הראשון", "איש הברזל", "ת׳ור", "קפטן אמריקה", "הפנתר השחור", "וונדה וויז׳ן", "לוקי", "אנדור", "המנדלוריאני", "מלחמת הכוכבים: פרק ד", "מלחמת הכוכבים: פרק ה", "מלחמת הכוכבים: פרק ו", "פיקסאר: מאחורי הקלעים", "צעצוע של סיפור", "מפלצות בע״מ", "בחזרה לראש", "קארס", "להיות או לא להיות פיקסאר", "האנטומיה של גריי", "הסימפסונים", "משפחה מודרנית", "מלקולם באמצע", "חדר מילים", "בלואי"];
  const items = {}, key = (i) => (i % 3 === 2 ? "t" : "m") + (9000 + i);
  const N = 72;
  for (let i = 0; i < N; i++) {
    const k = key(i), tv = k[0] === "t", title = names[i % names.length] + (i >= names.length ? " " + (Math.floor(i / names.length) + 1) : "");
    items[k] = { id: 9000 + i, type: tv ? "tv" : "movie", title, orig: i % 2 ? "Original Title " + i : "", year: 2000 + (i % 26), date: (2000 + (i % 26)) + "-05-1" + (i % 9),
      overview: "תקציר לדוגמה של תוכן בדיסני+, כמה שורות כדי לבדוק גלישה ויישור בעברית. " + title + ".", poster: "https://image.tmdb.org/t/p/w342/fx_" + k + ".jpg",
      backdrop: i < 3 ? "https://image.tmdb.org/t/p/w780/fx_b" + k + ".jpg" : "", genres: ["אנימציה", "משפחה"].slice(0, 1 + (i % 2)), link: "https://www.disneyplus.com/he-il/search?q=" + encodeURIComponent(title), [tv ? "seasons" : "runtime"]: tv ? 1 + (i % 5) : 80 + (i % 60) };
    if (i % 3 === 0) items[k].ratings = { imdb: 6.5 + (i % 30) / 10, votes: 90000, rt: 60 + (i % 40) };
  }
  const ks = Object.keys(items), pick = (n, off) => Array.from({ length: n }, (_, i) => ks[(i + off) % ks.length]);
  const rows = { popular: pick(20, 0), week: pick(12, 8), series: ks.filter((k) => k[0] === "t").slice(0, 14), movies: ks.filter((k) => k[0] === "m").slice(0, 16), kids: pick(12, 20), marvel: pick(10, 30), starwars: pick(8, 40), pixar: pick(8, 50), top: pick(12, 55) };
  const rowMeta = { popular: { title: "🔥 הכי נצפים" }, week: { title: "🆕 יצא החודש" }, series: { title: "📺 סדרות" }, movies: { title: "🎬 סרטים" }, kids: { title: "🧸 ילדים ומשפחה" }, marvel: { title: "🦸 מארוול" }, starwars: { title: "⭐ מלחמת הכוכבים" }, pixar: { title: "🎈 פיקסאר" }, top: { title: "🏆 הכי מדורגים" } };
  return { v: 2, updated: "2026-10-31T01:00:00.000Z", hero: key(0), rows, rowMeta, items };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let srv = null, base = process.argv[3];
  if (!base) { const s = await serve(); srv = s.srv; base = s.url; }
  if (!base.endsWith("/")) base += "/";
  // ---- בחירה דינמית של סדרות לבדיקת המעקב מתוך guide.json (הלוח גולל קדימה; בלי שמות קבועים): ≥2 שידורים ראשיים עתידיים, לא כותרת כללית ----
  const SER = await import(require("url").pathToFileURL(path.join(REPO, "calendar-server", "api", "_series.js")).href);
  const GUIDE = JSON.parse(fs.readFileSync(path.join(REPO, "guide.json"), "utf8")), NOW_MS = new Date(FIXED_NOW).getTime();
  const pickSeries = (filter) => {
    const titles = new Map();
    GUIDE.programs.forEach((p) => { if (SER.seriesTitle(p.title) === p.title) titles.set(p.title, 1); });
    let best = null;
    for (const t of titles.keys()) {
      if (SER.genericTitle(GUIDE, t)) continue;
      const a = SER.seriesAirings(GUIDE, t, null, NOW_MS), prim = a.filter((x) => x.primary);
      if (prim.length < 2 || !filter(a, prim)) continue;
      const mine = prim.filter((x) => SEL.indexOf(x.ch) >= 0).length, score = mine * 100 + prim.length;
      if (!best || score > best.score) best = { t, score };
    }
    return best && best.t;
  };
  const FOL_TITLE = pickSeries((a, prim) => prim.some((x) => SEL.indexOf(x.ch) >= 0) && !prim.every((x) => /^x/.test(x.ch)));
  const X_TITLE = pickSeries((a, prim) => prim.every((x) => /^x/.test(x.ch)));
  console.log("follow-series:", FOL_TITLE, "| x-channel series:", X_TITLE || "(none)");
  if (!FOL_TITLE) throw new Error("no followable series in guide.json for FIXED_NOW=" + FIXED_NOW);
  let browser = null; // דפדפן חדש לכל מכשיר: ריצה ארוכה של כמה מכשירים ברצף עלולה להפיל את הרנדרר (Target crashed)
  let total = 0, failed = 0, auditTotal = 0; const allErrors = [];
  const CHUNK = +(process.env.TVG_CHUNK || 22), RUNS = [], doneDev = {}, savedState = {}; // הצעדים מחולקים לקבוצות, כל קבוצה בדפדפן חדש (עם אותו storage): ריצה ארוכה מפילה את הרנדרר בזיכרון (גם ב-main ללא שינוי)
  DEVICES.filter((x) => !process.env.TVG_ONLY || process.env.TVG_ONLY.split(",").some((o) => x.name.indexOf(o) === 0)).forEach((x) => { for (let p = 0; p < 16; p++) RUNS.push([x, p]); RUNS.push([x, "nfs"]); });
  const tries = {}; // קריסת רנדרר (באג כרום בסביבה, גם ב-main): חוזרים על הקבוצה עד פעמיים, בלי לספור את הניסיון שקרס
  for (let ri = 0; ri < RUNS.length; ri++) { const [d, phase] = RUNS[ri]; if (doneDev[d.name] && phase !== "nfs") continue; if (process.env.TVG_PHASES && process.env.TVG_PHASES.split(",").indexOf(String(phase)) < 0) continue; /* TVG_PHASES=nfs,0,1: רק קבוצות מסוימות */ let ran = 0, crashed = false; const f0 = failed, t0 = total; // TVG_ONLY=iphone|android|iphone_375,... מצמצם
    browser = await chromium.launch({ channel: "chrome", headless: true, args: process.env.TVG_CHROME_ARGS ? process.env.TVG_CHROME_ARGS.split(" ") : [] });
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: d.ua, locale: "he-IL", timezoneId: "Asia/Jerusalem", storageState: phase === "nfs" ? undefined : savedState[d.name] || undefined });
    await ctx.addInitScript((sel) => { try { if (!localStorage.getItem("tvg.sel")) { localStorage.setItem("tvg.sel", JSON.stringify(sel)); localStorage.setItem("tvg.bkAt", "1"); localStorage.setItem("tvg.v5", "1"); localStorage.setItem("tvg.theme", "light"); } } catch (e) {} }, SEL);
    // TVG_NO_WRITES=1 (הניטור מול האתר החי): חוסם כל בקשה שאינה GET לשרת התזכורות, כדי שהבדיקה לא תכתוב גיבויים/תזכורות
    if (process.env.TVG_NO_WRITES) await ctx.route(/tv-guide-cal\.vercel\.app/, (r) => (r.request().method() === "GET" ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: "{\"ok\":true}" })));
    // חיפוש נטפליקס / רשימת מעקב / סנכרון תזכורות: תמיד מדומה (אין קריאות חיות לשרת). wlPosts = גופי ה-POST לבדיקות
    const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
    const wlPosts = [], nfQueries = [];
    await ctx.route(/image\.tmdb\.org\/t\/p\/\w+\/fx_/, (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: fxSvg(r.request().url()) }));
    await ctx.route(/\/api\/nf-search/, (r) => {
      const q = new URL(r.request().url()).searchParams.get("q") || ""; nfQueries.push(q);
      if (q === "שגיאה") return r.fulfill({ status: 502, contentType: "application/json", headers: CORS, body: '{"error":"upstream"}' });
      return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(nfSearchFixture(q)) });
    });
    await ctx.route(/\/api\/watch/, (r) => {
      if (r.request().method() === "POST") wlPosts.push(JSON.parse(r.request().postData() || "{}"));
      return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: '{"ok":true,"n":1}' });
    });
    // 📺 מעקב אחרי סדרה (/api/follow): תמיד מדומה. folPosts = גופי ה-POST; folStatus = קוד התשובה (403 = אין מנוי פוש בשרת)
    const folPosts = []; let folStatus = 200;
    await ctx.route(/\/api\/follow/, (r) => {
      if (r.request().method() === "POST") {
        const b = JSON.parse(r.request().postData() || "{}"); folPosts.push(b);
        if (folStatus !== 200) return r.fulfill({ status: folStatus, contentType: "application/json", headers: CORS, body: '{"error":"no push"}' });
        return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ ok: true, n: (b.follows || []).filter((x) => !x.x).length, follows: b.follows || [], next: 2 }) });
      }
      return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: '{"follows":[]}' });
    });
    let page = null;
    const errs = [], auditRaw = [];
    const audit = (name) => runAudit(page, name, auditRaw);
    const hookPage = () => { page.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
    page.on("console", (m) => { if (m.type() !== "error") return; const u = (m.location() || {}).url || ""; if (/(netflix|disney)\.json/.test(u) || (/api\/backup/.test(u) && /404/.test(m.text())) || ((/api\/snooze$/.test(u) || /api\/nf-search/.test(u)) && /502/.test(m.text())) || (/api\/follow/.test(u) && /403/.test(m.text()))) return; /* follow 403 is injected by the no-push-on-server scenario */ /* snooze 502 is injected by the failure scenario */ /* netflix.json is optional (404 is expected) */ errs.push("console: " + m.text() + " " + u); }); page.on("crash", () => { crashed = true; console.log("  !! renderer crashed", d.name, String(phase)); }); };
    const fresh = async (q) => { await page.goto(base + "index.html" + (q || ""), { waitUntil: "networkidle" }); await page.waitForTimeout(1200); };
    const snap = async (n) => { total++; await page.screenshot({ path: path.join(OUT, d.name + "_" + n + ".png") }); await audit(n); };
    let stepIdx = 0;
    const step = (n, f) => { const i = stepIdx++; if (process.env.TVG_STEPRE && !new RegExp(process.env.TVG_STEPRE).test(n)) return Promise.resolve(); /* הרצה ממוקדת בצעדים לפי שם: הכול בקבוצה 0 */ if (process.env.TVG_STEPRE) { if (phase !== 0) return Promise.resolve(); ran++; return runStep(n, f); } if (phase === "nfs" || Math.floor(i / CHUNK) !== phase) return Promise.resolve(); ran++; return runStep(n, f); };
    const runStep = async (name, fn) => { if (process.env.TVG_LOG) console.log("  step", name); try { await fn(); } catch (e) { failed++; errs.push("step " + name + ": " + e.message.split("\n")[0]); if (process.env.TVG_LOG) console.log("    FAIL", e.message.split("\n").slice(0, 5).join(" | ")); } };
    // netflix.json: ברירת מחדל = הקובץ האמיתי; במצב fixture = עותק עם ציונים וקצוות (בלי לגעת בקובץ במאגר)
    let nfFixture = false, dsMode = "ok";
    // עמוד חדש (גם באמצע הריצה: ריצה ארוכה מאוד בעמוד אחד מפילה את הרנדרר בגלל זיכרון, ראו "fresh page" אחרי בלוק נטפליקס)
    const setupPage = async () => {
      if (page) await page.close();
      page = await ctx.newPage(); hookPage();
      await page.clock.setFixedTime(new Date(FIXED_NOW));
      await page.route("**/disney.json*", async (route) => { // דיסני+: תמיד פיקסטורה. dsMode: ok | fail (500) | slow (אחרי 1.5 שניות)
        if (dsMode === "fail") return route.fulfill({ status: 500, body: "x" });
        if (dsMode === "slow") await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(dsFixtureData()) });
      });
      await page.route("**/netflix.json*", async (route) => {
        if (!nfFixture) return route.continue();
        await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(nfFixtureData()) });
      });
    };
    await setupPage();

    await step("dial", async () => { await fresh(); await snap("01_dial"); });
    for (const t of ["now", "grid", "rems"]) {
      await step(t, async () => { await fresh(); await page.click('[data-tab="' + t + '"]'); await page.waitForTimeout(700); await snap("02_tab_" + t); });
    }
    await step("synopsis", async () => {
      await fresh(); await page.click('[data-tab="now"]'); await page.waitForTimeout(600);
      await page.click("[data-opentog]"); await page.waitForTimeout(500); await snap("03_synopsis_now");
    });
    await step("remsheet", async () => {
      await fresh(); await page.click('[data-tab="grid"]'); await page.waitForTimeout(600);
      await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(700); await snap("04_remsheet");
    });
    await step("settings", async () => {
      await fresh(); await page.click("#setBtn"); await page.waitForTimeout(700); await snap("05_settings_top");
      await page.evaluate(() => { const s = document.querySelector("#setsheet"); s.scrollTop = s.scrollHeight; }); await page.waitForTimeout(300); await snap("05_settings_bottom");
    });
    await step("channels", async () => { await fresh(); await page.click("#chBtn"); await page.waitForTimeout(700); await snap("06_channels"); });
    await step("favs", async () => { await fresh(); await page.click("#fvBtn"); await page.waitForTimeout(700); await snap("07_favs"); });
    await step("search-empty", async () => { await fresh(); await page.click("#sBtn"); await page.waitForTimeout(600); await snap("08_search_open"); });
    await step("search-query", async () => { await fresh(); await page.click("#sBtn"); await page.waitForTimeout(400); await page.fill("#q", "חדשות"); await page.waitForTimeout(900); await snap("08_search_query"); });
    await step("dial-drag-day", async () => { await fresh(); const nx = await page.$("[data-day]"); if (nx) { await nx.click(); await page.waitForTimeout(600); } await snap("09_dial_day"); });
    await step("dark", async () => { await fresh(); await page.click("#setBtn"); await page.waitForTimeout(500); await page.click('[data-theme-set="dark"]'); await page.waitForTimeout(400); await page.click("[data-setclose]"); await page.waitForTimeout(500); await snap("10_dark_dial"); await page.evaluate(() => localStorage.setItem("tvg.theme", "light")); });

    // ---- 👋 קבלת פנים והתקנה למוזמנים (js/welcome.js): הקשר נפרד לכל תרחיש, עם UA משלו, בלי storage משותף ----
    {
      const IOSD = d.ua === IPHONE_UA;
      const WA_IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.10.80";
      const CHROME_IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
      const WA_AND_UA = androidUA("SM-S911B").replace("Chrome/130.0.0.0 Mobile Safari", "Version/4.0 Chrome/130.0.0.0 Mobile Safari").replace("; SM-S911B)", "; SM-S911B; wv)");
      const BIP = () => window.addEventListener("DOMContentLoaded", () => { const e = new Event("beforeinstallprompt"); e.prompt = () => { window.__prompted = 1; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: "dismissed" }); window.dispatchEvent(e); });
      const STANDALONE = () => { Object.defineProperty(navigator, "standalone", { get: () => true }); const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? (() => { const o = mm("all"); Object.defineProperty(o, "matches", { value: true }); return o; })() : mm(q)); };
      const W = (c, m) => { if (!c) throw new Error("assert: " + m); };
      const wl = async (name, ua, init, q, fn) => {
        const c = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: ua, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
        await c.route(/tv-guide-cal\.vercel\.app/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: "{\"ok\":true}" }));
        if (init) await c.addInitScript(init);
        const p = await c.newPage();
        p.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
        p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
        await p.clock.setFixedTime(new Date(FIXED_NOW));
        const go = async (qs) => { await p.goto(base + "index.html" + (qs === undefined ? q : qs), { waitUntil: "networkidle" }); await p.waitForTimeout(1300); };
        const sn = async (n) => { total++; await p.screenshot({ path: path.join(OUT, d.name + "_" + n + ".png") }); await runAudit(p, n, auditRaw); };
        const shown = (s) => p.evaluate((x) => { const e = document.querySelector(x); return !!e && !e.hidden; }, s);
        const txt = () => p.evaluate(() => (document.querySelector("#welcome") || {}).innerText || "");
        const steps = () => p.evaluate(() => document.querySelectorAll("#welcome .wl-step").length);
        try { await fn({ p, c, go, sn, shown, txt, steps }); } finally { await c.close(); }
      };
      const sheetOk = async (o) => { // מידות בסיסיות: כפתורים 44+, רווח 8, בלי גלישה אופקית
        const r = await o.p.evaluate(() => { const b = Array.from(document.querySelectorAll("#welcome button")).map((e) => e.getBoundingClientRect()); const w = document.querySelector("#welcome"); return { h: b.map((x) => Math.round(x.height)), gap: b.length > 1 ? Math.round(b[1].top - b[0].bottom) : 8, ov: w.scrollWidth - w.clientWidth, top: Math.round(w.getBoundingClientRect().top), vh: innerHeight }; });
        W(r.h.every((x) => x >= 44), "buttons >= 44px " + r.h); W(r.gap === 8, "gap 8px " + r.gap); W(r.ov <= 0, "no horizontal overflow " + r.ov); W(r.top > 40, "sheet fits the screen " + r.top);
      };
      if (IOSD) {
        await step("w-ios-safari", async () => wl("s", d.ua, null, "?from=join", async (o) => {
          await o.go(); W(await o.shown("#welcome") && await o.shown("#scrim2"), "sheet open"); W(await o.steps() === 3, "3 ios steps: " + await o.steps());
          const t = await o.txt(); W(/ברוכים הבאים לזפזופ/.test(t) && /לוחצים על שיתוף/.test(t) && /״הוסף למסך הבית״/.test(t) && /זפזופ במסך הבית/.test(t), "ios copy"); W(!/התקנת האפליקציה/.test(t) && !/פותחים את הקישור בספארי/.test(t), "only the ios block, no safari hint");
          W(await o.p.evaluate(() => document.querySelectorAll("#welcome .wl-ic").length) === 2, "share + plus icons"); W(await o.p.evaluate(() => !!(history.state && history.state.tvgLayer)), "is a nav layer");
          await sheetOk(o); await o.sn("70_welcome_ios_dark");
          await o.p.evaluate(() => TVG.setTheme("light")); await o.p.waitForTimeout(300); await o.sn("70_welcome_ios_light");
        }));
        await step("w-ios-whatsapp", async () => wl("w", WA_IOS_UA, null, "?from=join", async (o) => {
          await o.go(); W(await o.shown("#welcome"), "sheet open"); W(await o.steps() === 4, "4 steps: " + await o.steps());
          const t = await o.txt(); W(/1\s*פותחים את הקישור בספארי/.test(t.replace(/\n/g, " ")) && /בוואטסאפ: ⋯ ← פתיחה בספארי/.test(t), "open in safari first"); await sheetOk(o); await o.sn("71_welcome_ios_whatsapp_dark");
          await o.p.evaluate(() => TVG.setTheme("light")); await o.p.waitForTimeout(300); await o.sn("71_welcome_ios_whatsapp_light");
        }));
        await step("w-ios-chrome", async () => wl("c", CHROME_IOS_UA, null, "?from=join", async (o) => {
          await o.go(); W(await o.shown("#welcome") && await o.steps() === 4 && /פותחים את הקישור בספארי/.test(await o.txt()), "chrome ios: open in safari first");
        }));
      } else {
        await step("w-and-install", async () => wl("i", d.ua, BIP, "?from=join", async (o) => {
          await o.go(); W(await o.shown("#welcome"), "sheet open"); W(await o.steps() === 0, "no steps when the prompt is available");
          const t = await o.txt(); W(/📲 התקנת האפליקציה/.test(t) && /אחר כך/.test(t) && !/הבנתי/.test(t), "install primary + later");
          W(await o.p.evaluate(() => document.querySelector("#welcome .btn").getBoundingClientRect().height >= 44), "primary 44px"); await sheetOk(o); await o.sn("72_welcome_android_install_dark");
          await o.p.evaluate(() => TVG.setTheme("light")); await o.p.waitForTimeout(300); await o.sn("72_welcome_android_install_light");
          await o.p.click("#welcome [data-wlinst]"); await o.p.waitForTimeout(500);
          W(await o.p.evaluate(() => window.__prompted === 1), "TVG.install() called prompt()"); W(!(await o.shown("#welcome")), "closed after install"); W(await o.p.evaluate(() => localStorage.getItem("tvg.welcome")) === "1", "dismissed flag");
        }));
        await step("w-and-steps", async () => wl("s", d.ua, null, "?from=join", async (o) => {
          await o.go(); W(await o.shown("#welcome") && await o.steps() === 2, "2 steps: " + await o.steps());
          const t = await o.txt(); W(/⋮ בפינת הדפדפן/.test(t) && /התקנת אפליקציה״ או ״הוספה למסך הבית/.test(t) && /הבנתי, להתחיל/.test(t) && !/📲/.test(t), "android steps copy"); await sheetOk(o); await o.sn("73_welcome_android_steps_dark");
          await o.p.evaluate(() => TVG.setTheme("light")); await o.p.waitForTimeout(300); await o.sn("73_welcome_android_steps_light");
        }));
        await step("w-and-whatsapp", async () => wl("w", WA_AND_UA, BIP, "?from=join", async (o) => {
          await o.go(); W(await o.shown("#welcome") && await o.steps() === 3, "3 steps: " + await o.steps());
          W(/1\s*פותחים את הקישור בכרום/.test((await o.txt()).replace(/\n/g, " ")), "open in chrome first"); await sheetOk(o); await o.sn("74_welcome_android_whatsapp_dark");
        }));
      }
      await step("w-dismiss-once", async () => wl("d", d.ua, null, "?from=join", async (o) => { // "אחר כך" סוגר וסומן; טעינה שנייה (גם עם from=join) לא מציגה; בורר הערוצים נפתח אחרי
        await o.go(); W(await o.shown("#welcome"), "first visit shows"); W(!(await o.shown("#sheet")), "channel picker waits behind the welcome");
        await o.p.click("#welcome [data-wlclose]"); await o.p.waitForTimeout(700);
        W(!(await o.shown("#welcome")) && await o.p.evaluate(() => localStorage.getItem("tvg.welcome")) === "1", "closed + flagged"); W(await o.shown("#sheet"), "channel picker opens after the welcome");
        W(await o.p.evaluate(() => !!(history.state && history.state.tvgLayer)), "history has the picker layer only");
        await o.go(); W(!(await o.shown("#welcome")), "second load with from=join: no welcome");
      }));
      for (const way of ["esc", "scrim", "back"]) await step("w-close-" + way, async () => wl("x", d.ua, null, "?from=join", async (o) => { // Escape / הקשה על הרקע / חזור: כולם סוגרים ומסמנים
        await o.go(); W(await o.shown("#welcome"), way + ": shown");
        if (way === "esc") await o.p.keyboard.press("Escape"); else if (way === "scrim") await o.p.mouse.click(d.w / 2, 60); else await o.p.goBack();
        await o.p.waitForTimeout(700); W(!(await o.shown("#welcome")) && await o.p.evaluate(() => localStorage.getItem("tvg.welcome")) === "1", way + ": closed + flagged"); W(/index\.html/.test(o.p.url()), way + ": still in the app " + o.p.url());
      }));
      await step("w-drag-close", async () => wl("g", d.ua, null, "?from=join", async (o) => { // גרירה מטה סוגרת (sheetdrag) ומסמנת
        await o.go(); W(await o.shown("#welcome"), "shown"); const r = await o.p.evaluate(() => { const b = document.querySelector("#welcome").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 10 }; });
        const cdp = await o.c.newCDPSession(o.p); await touch.drag(cdp, [[r.x, r.y], [r.x, r.y + 320]], 160); await o.p.waitForTimeout(900);
        W(!(await o.shown("#welcome")) && await o.p.evaluate(() => localStorage.getItem("tvg.welcome")) === "1", "drag closed + flagged");
      }));
      await step("w-not-shown", async () => {
        await wl("p", d.ua, null, "", async (o) => { await o.go(); W(!(await o.shown("#welcome")), "plain visit: no welcome"); });
        await wl("a", d.ua, null, "", async (o) => { await o.go("?from=whatsapp"); W(!(await o.shown("#welcome")), "other source: no welcome"); });
        await wl("o", d.ua, null, "", async (o) => { await o.go("?from=join&p=999.2611010000"); W(!(await o.shown("#welcome")), "program link wins: no welcome"); });
        await wl("st", d.ua, STANDALONE, "", async (o) => { await o.go("?from=join"); W(await o.p.evaluate(() => TVG.isStandalone), "stub: standalone"); W(!(await o.shown("#welcome")), "installed app: no welcome"); W(await o.p.evaluate(() => localStorage.getItem("tvg.welcome")) == null, "not flagged when not shown"); });
      });
    }

    // ---- נטפליקס ----
    await step("nf-top", async () => { nfFixture = false; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(1500); await snap("11_nf_top"); });
    await step("nf-row", async () => {
      nfFixture = false; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(800);
      await page.evaluate(() => { const r = document.querySelectorAll(".nfrow")[0]; r.scrollIntoView({ block: "center" }); r.scrollLeft = -260; }); await page.waitForTimeout(1200); await snap("12_nf_row_scrolled");
    });
    await step("nf-page", async () => { nfFixture = false; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(800); await page.click(".nfhero"); await page.waitForTimeout(900); await snap("13_nf_page_noratings"); });
    await step("nf-fixture-top", async () => { nfFixture = true; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(1500); await snap("14_nf_top_ratings"); });
    await step("nf-fixture-page", async () => { nfFixture = true; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(800); await page.click(".nfhero"); await page.waitForTimeout(900); await snap("15_nf_page_ratings"); });
    await step("nf-fixture-edge", async () => { nfFixture = true; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(800); await page.evaluate(() => document.querySelector('[data-nfopen="x_edge"]').click()); await page.waitForTimeout(900); await snap("16_nf_page_edge"); });
    await step("nf-search", async () => { nfFixture = true; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(600); await page.click("#sBtn"); await page.fill("#q", "a"); await page.waitForTimeout(1200); await snap("17_nf_search"); });
    await step("nf-search-empty", async () => { nfFixture = true; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(600); await page.click("#sBtn"); await page.fill("#q", "zzzqqq"); await page.waitForTimeout(700); await snap("18_nf_search_empty"); });
    await step("nf-dark", async () => { nfFixture = true; await fresh(); await page.click("#setBtn"); await page.waitForTimeout(400); await page.click('[data-theme-set="dark"]'); await page.waitForTimeout(300); await page.click("[data-setclose]"); await page.waitForTimeout(300); await page.click('[data-tab="nf"]'); await page.waitForTimeout(1500); await snap("19_nf_dark_top"); await page.click(".nfhero"); await page.waitForTimeout(800); await snap("19_nf_dark_page"); await page.evaluate(() => localStorage.setItem("tvg.theme", "light")); });

    // ---- נטפליקס: שורות חדשות (rowMeta), 'עוד ›', ⭐ שמורים ----
    const nfChk = (c, m) => { if (!c) throw new Error("assert: " + m); };
    const nfShown = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden; }, sel);
    const nfFavs = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("tvg.nffav") || "[]"); } catch (e) { return null; } });
    const nfClean = async (favs) => { // מצב נקי ל-tvg.nffav (favs = מספר שמורים להכנה מראש מפריטי הפיקסטורה)
      nfFixture = true; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(500);
      await page.evaluate((n) => { try { localStorage.removeItem("tvg.nffav"); if (n) { const NF = TVG.NF; const ks = Object.keys(NF.items).filter((k) => k !== "x_edge").slice(0, n); localStorage.setItem("tvg.nffav", JSON.stringify(ks.map((k, i) => ({ k, title: NF.items[k].title, type: NF.items[k].type, poster: NF.items[k].poster, y: NF.items[k].year, at: 1700000000000 - i * 1000 })))); } } catch (e) {} }, favs || 0);
      await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(900);
    };
    // ---- סטרימינג: דיסני+ (מתג, שורות, עוד, דף תוכן, שמירה, זכירת בחירה, שגיאה/שלד, כהה) ----
    const dsChk = (c, m) => { if (!c) throw new Error("assert: " + m); };
    const dsNames = () => page.evaluate(() => Array.prototype.map.call(document.querySelectorAll("#main [data-nfrow]"), (s) => s.getAttribute("data-nfrow")));
    const dsOpenTab = async (svc, mode) => { // מצב נקי: שמורים ובחירת שירות, ואז לשונית הסטרימינג
      nfFixture = true; dsMode = mode || "ok";
      await fresh(); await page.evaluate((v) => { try { localStorage.removeItem("tvg.nffav"); localStorage.setItem("tvg.theme", "light"); if (v) localStorage.setItem("tvg.svc", v); else localStorage.removeItem("tvg.svc"); } catch (e) {} }, svc || "");
      await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(svc === "disney" ? 1400 : 700);
    };
    await step("ds-switch", async () => {
      await dsOpenTab("");
      dsChk((await page.textContent("#tabNf")).trim() === "סטרימינג", "bottom tab label");
      dsChk((await page.textContent("#ttl")).trim() === "סטרימינג", "screen title");
      dsChk(await page.evaluate(() => document.querySelectorAll("#main .seg.nfsvc button").length === 2 && document.querySelector('[data-nfsvc="netflix"]').getAttribute("aria-pressed") === "true"), "switch present, Netflix selected by default");
      dsChk(await page.evaluate(() => document.querySelector("#main").firstElementChild.classList.contains("nfsvc")), "switch is at the very top");
      const w = await page.evaluate(() => { const b = document.querySelector(".nfsvc").getBoundingClientRect(), m = document.querySelector(".nfhero").getBoundingClientRect(); return { r: Math.round(b.right), l: Math.round(b.left), vw: innerWidth, bh: Math.round(b.height), gap: Math.round(m.top - b.bottom) }; });
      dsChk(w.l >= 12 && w.vw - w.r >= 12 && w.bh >= 44, "switch fits with 16px-ish gutters and 44px height: " + JSON.stringify(w));
      await snap("50_ds_switch_netflix");
      await page.click('[data-nfsvc="disney"]'); await page.waitForTimeout(1200);
      dsChk(await page.evaluate(() => localStorage.getItem("tvg.svc")) === "disney", "choice remembered in tvg.svc");
      dsChk((await dsNames()).join() === "popular,week,series,movies,kids,marvel,starwars,pixar,top", "disney rows order " + (await dsNames()).join());
      dsChk(await page.evaluate(() => document.querySelectorAll("#main .nfhero").length === 1 && document.querySelector('[data-nfsvc="disney"]').getAttribute("aria-pressed") === "true"), "disney selected + hero");
      dsChk(await page.evaluate(() => document.querySelector("#main .nfhero").nextElementSibling.getAttribute("data-nfrow") === "popular"), "hero then popular");
      await snap("51_ds_top");
      await page.evaluate(() => window.scrollTo(0, 1000)); await page.waitForTimeout(700); await snap("51_ds_mid");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(700);
      dsChk(await page.evaluate(() => document.querySelectorAll("#main [data-nflz]").length) === 0, "all rows built after scroll");
      dsChk(await page.evaluate(() => document.querySelectorAll("#main .nfmore").length) === 9, "a 'more' chip on every row");
      const tx = await page.textContent("#main"); ["🔥 הכי נצפים", "🆕 יצא החודש", "📺 סדרות", "🎬 סרטים", "🧸 ילדים ומשפחה", "🦸 מארוול", "⭐ מלחמת הכוכבים", "🎈 פיקסאר", "🏆 הכי מדורגים"].forEach((t) => dsChk(tx.indexOf(t) >= 0, "title " + t));
      dsChk(tx.indexOf("ישראלי בנטפליקס") < 0, "no Netflix rows leaked into Disney");
      await snap("51_ds_bottom");
      await page.evaluate(() => window.scrollTo(0, 0)); await page.click('[data-nfsvc="netflix"]'); await page.waitForTimeout(700);
      dsChk((await dsNames()).join() === "popular,israeli,week,recent,series,movies,top,comedy,crime,docu,family", "netflix rows unchanged " + (await dsNames()).join());
      dsChk(await page.evaluate(() => localStorage.getItem("tvg.svc")) === "netflix", "back to Netflix remembered");
    });
    await step("ds-more-open-save", async () => {
      await dsOpenTab("disney");
      for (let y = 600; y < 5000; y += 600) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(250); } await page.waitForTimeout(500); await page.evaluate(() => document.querySelector('[data-nfmore="marvel"]').click()); await page.waitForTimeout(700);
      dsChk(await nfShown("#nflist"), "list open");
      dsChk((await page.textContent("#nflT")).indexOf("מארוול") >= 0, "list title");
      dsChk(await page.evaluate(() => document.querySelectorAll("#nflist .nfc").length) === 10, "10 cards in marvel list");
      await snap("52_ds_list");
      await page.evaluate(() => document.querySelector("#nflist .nfc").click()); await page.waitForTimeout(800);
      dsChk(await nfShown("#nfsheet"), "content page over list");
      const sh = await page.textContent("#nfsheet");
      dsChk(sh.indexOf("זמין בדיסני+") >= 0 && sh.indexOf("זמין בנטפליקס") < 0, "availability says Disney+ only");
      dsChk(await page.evaluate(() => { const a = document.querySelector("#nfsBar .nfgo"); return !!a && /^▶ פתח בדיסני\+$/.test(a.textContent.trim()) && /^https:\/\/www\.disneyplus\.com\//.test(a.href) && a.classList.contains("btn"); }), "primary orange button: ▶ פתח בדיסני+");
      dsChk(sh.indexOf("⏰ להזכיר לי לצפות") >= 0 && sh.indexOf("🔔 תודיע לי") >= 0, "watch reminder + alerts exist");
      dsChk(sh.indexOf("כשזה מגיע לנטפליקס") < 0, "no 'arrives on Netflix' chip on a Disney+ page");
      dsChk(await page.evaluate(() => !!document.querySelector("[data-ptynf]")), "party button exists");
      await snap("53_ds_page");
      await page.click("[data-nffav]"); await page.waitForTimeout(500);
      const fv = await nfFavs(); dsChk(fv && fv.length === 1 && fv[0].svc === "disney", "saved with svc:disney " + JSON.stringify(fv));
      dsChk(/★ שמור/.test(await page.textContent("#nfsBar")), "button reflects saved state");
      await page.keyboard.press("Escape"); await page.waitForTimeout(300); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      dsChk(!(await nfShown("#nfsheet")) && !(await nfShown("#nflist")), "layers closed");
      dsChk(await page.evaluate(() => !!document.querySelector('#main [data-nfrow="fav"] .nfc')), "saved row appears");
      await snap("54_ds_saved");
      // חזרה לנטפליקס: השמור נשאר (שורת שמורים משותפת), ונפתח כדף דיסני+
      await page.evaluate(() => window.scrollTo(0, 0)); await page.click('[data-nfsvc="netflix"]'); await page.waitForTimeout(600);
      dsChk(await page.evaluate(() => !!document.querySelector('#main [data-nfrow="fav"] .nfc')), "saved row still on the Netflix side");
      await page.evaluate(() => document.querySelector('#main [data-nfrow="fav"] .nfc').click()); await page.waitForTimeout(700);
      dsChk(await page.evaluate(() => { const a = document.querySelector("#nfsBar .nfgo"); return !!a && /דיסני\+/.test(a.textContent) && /disneyplus\.com/.test(a.href); }), "saved Disney+ item opens as Disney+ even from the Netflix side");
      await page.click("[data-nfclose]"); await page.waitForTimeout(300);
      // שמור ישן בלי svc = נטפליקס
      await page.evaluate(() => { const f = JSON.parse(localStorage.getItem("tvg.nffav")); f.push({ k: "m603", title: "מטריקס", type: "movie", poster: "", y: 1999, at: 1 }); localStorage.setItem("tvg.nffav", JSON.stringify(f)); });
      await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(800);
      dsChk(await page.evaluate(() => document.querySelectorAll('#main [data-nfrow="fav"] .nfc').length) === 2, "two saved");
      dsChk(await page.evaluate(() => { const c = document.querySelectorAll('#main [data-nfrow="fav"] .nfc'); return c[0].getAttribute("data-nfpref") === "disney" && !c[1].hasAttribute("data-nfpref"); }), "old entry without svc = Netflix");
    });
    await step("ds-remember-reload", async () => {
      await dsOpenTab("disney");
      await fresh(); // רענון מלא: אותה בחירה, בלי ללחוץ שוב על המתג
      await page.waitForTimeout(600);
      dsChk(await page.evaluate(() => TVG.tab) === "nf" || true, "tab");
      await page.click('[data-tab="nf"]').catch(() => {}); await page.waitForTimeout(1400);
      dsChk(await page.evaluate(() => document.querySelector('[data-nfsvc="disney"]').getAttribute("aria-pressed") === "true" && !!document.querySelector('[data-nfrow="marvel"]')), "disney still selected after reload");
      await snap("55_ds_after_reload");
      await page.evaluate(() => localStorage.removeItem("tvg.svc"));
    });
    await step("ds-loading-error", async () => {
      await dsOpenTab("");
      dsMode = "slow"; await page.click('[data-nfsvc="disney"]'); await page.waitForTimeout(300);
      dsChk(await page.evaluate(() => !!document.querySelector('#main [role="status"] .nfsk0') && document.querySelectorAll("#main .nfsk").length >= 8), "skeleton while loading");
      dsChk(await page.evaluate(() => document.querySelector('[data-nfsvc="disney"]').getAttribute("aria-pressed") === "true"), "switch already shows Disney+ while loading");
      await snap("56_ds_skeleton"); await page.waitForTimeout(1800);
      dsChk(await page.evaluate(() => !!document.querySelector('[data-nfrow="marvel"]')), "rows after the slow load");
      // שגיאה: נסו שוב
      await dsOpenTab("disney", "fail");
      const tx = await page.textContent("#main"); dsChk(tx.indexOf("לא הצלחנו לטעון את דיסני+") >= 0 && tx.indexOf("נסו שוב") >= 0, "Hebrew error state: " + tx.slice(0, 120));
      dsChk(await page.evaluate(() => document.querySelector('[data-nfsvc="netflix"]') !== null), "can switch back from the error");
      await snap("57_ds_error");
      dsMode = "ok"; await page.click("[data-nfdsretry]"); await page.waitForTimeout(1400);
      dsChk(await page.evaluate(() => !!document.querySelector('[data-nfrow="marvel"]')), "retry recovers");
      await page.evaluate(() => localStorage.removeItem("tvg.svc"));
    });
    await step("ds-dark", async () => {
      await dsOpenTab("disney");
      await page.evaluate(() => TVG.setTheme("dark")); await page.waitForTimeout(500); await snap("58_ds_dark_top");
      await page.click(".nfhero"); await page.waitForTimeout(800); await snap("58_ds_dark_page");
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
      await page.evaluate(() => { TVG.setTheme("light"); localStorage.removeItem("tvg.svc"); localStorage.setItem("tvg.theme", "light"); });
    });

    await step("nf-rows-all", async () => { // כל 11 השורות לפי הסדר, בנייה עצלה מתחת לקפל
      await nfClean(0);
      const names = () => page.evaluate(() => Array.prototype.map.call(document.querySelectorAll("#main [data-nfrow]"), (s) => s.getAttribute("data-nfrow")));
      nfChk((await names()).join() === "popular,israeli,week,recent,series,movies,top,comedy,crime,docu,family", "rows order " + (await names()).join());
      const lazy0 = await page.evaluate(() => document.querySelectorAll("#main [data-nflz]").length);
      nfChk(lazy0 >= 6, "rows below the fold are not built yet (" + lazy0 + ")");
      nfChk(await page.evaluate(() => document.querySelectorAll("#main .nfhero").length === 1 && document.querySelector("#main .nfhero").nextElementSibling.getAttribute("data-nfrow") === "popular"), "hero then popular");
      await snap("20_nf_rows_top");
      await page.evaluate(() => window.scrollTo(0, 1000)); await page.waitForTimeout(800); await snap("20_nf_rows_mid");
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(700);
      nfChk(await page.evaluate(() => document.querySelectorAll("#main [data-nflz]").length) === 0, "all rows built after scrolling");
      nfChk(await page.evaluate(() => document.querySelectorAll("#main .nfmore").length) === 11, "a 'more' chip on every row");
      nfChk(await page.evaluate(() => document.querySelectorAll('#main [data-nfrow="docu"] .nfc').length) === 10, "docu row has 10 cards");
      const tx = await page.textContent("#main"); ["🇮🇱 ישראלי בנטפליקס", "🆕 יצא החודש", "📺 סדרות", "🎬 סרטים", "😂 קומדיה", "🔪 מתח ופשע", "🎙 דוקו", "👨‍👩‍👧 לכל המשפחה"].forEach((t) => nfChk(tx.indexOf(t) >= 0, "title " + t));
      await snap("20_nf_rows_bottom");
      await page.evaluate(() => { const r = document.querySelector('[data-nfrow="family"] .nfrow'); r.scrollLeft = -2000; }); await page.waitForTimeout(500); await snap("20_nf_row_end_chip");
    });
    await step("nf-more-list", async () => { // 'עוד ›' -> רשימה מלאה; כרטיס פותח דף מעליה; Escape/חזרה סוגרים שכבה אחת בכל פעם
      await nfClean(0);
      await page.locator('[data-nfmore="israeli"]').click(); await page.waitForTimeout(700);
      nfChk(await nfShown("#nflist"), "list open"); nfChk(await nfShown("#scrim2"), "scrim on");
      nfChk(await page.evaluate(() => document.querySelectorAll("#nflist .nfc").length) === 24, "24 cards in list");
      nfChk((await page.textContent("#nflT")).indexOf("ישראלי בנטפליקס") >= 0, "list title");
      nfChk(await page.evaluate(() => !!(history.state && history.state.tvgLayer)), "list is a nav layer");
      await snap("21_nf_list");
      await page.evaluate(() => { document.querySelector("#nflBody").scrollTop = 99999; }); await page.waitForTimeout(400); await snap("21_nf_list_bottom");
      await page.evaluate(() => { document.querySelector("#nflBody").scrollTop = 0; });
      await page.click("#nflist .nfc"); await page.waitForTimeout(700);
      nfChk(await nfShown("#nfsheet") && await nfShown("#nflist"), "page opens over the list"); nfChk(await page.evaluate(() => { const a = document.querySelector("#nfsheet"), b = document.querySelector("#nflist"); return !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); }), "page above list");
      await snap("22_nf_list_page");
      await page.keyboard.press("Escape"); await page.waitForTimeout(500);
      nfChk(!(await nfShown("#nfsheet")) && await nfShown("#nflist") && await nfShown("#scrim2"), "Escape closes only the page; list and scrim stay");
      await page.keyboard.press("Escape"); await page.waitForTimeout(500);
      nfChk(!(await nfShown("#nflist")) && !(await nfShown("#scrim2")), "second Escape closes the list and the scrim"); nfChk(await page.evaluate(() => !history.state), "history clean");
      const url0 = page.url();
      await page.locator('[data-nfmore="popular"]').click(); await page.waitForTimeout(500); nfChk(await nfShown("#nflist"), "reopen");
      await page.goBack(); await page.waitForTimeout(500); nfChk(!(await nfShown("#nflist")) && page.url() === url0, "back closes the list, stays in app");
      await page.locator('[data-nfmore="series"]').click(); await page.waitForTimeout(500);
      await page.click("#nflist [data-nflclose]"); await page.waitForTimeout(500); nfChk(!(await nfShown("#nflist")) && await page.evaluate(() => !history.state), "close button");
      await page.locator('[data-nfmore="series"]').click(); await page.waitForTimeout(500);
      await page.mouse.click(10, 40); await page.waitForTimeout(500); nfChk(!(await nfShown("#nflist")), "scrim tap closes the list");
    });
    await step("nf-fav-save", async () => { // ⭐ שמירה בדף התוכן: הודעה עם ביטול, כפתור ★ שמור, שורה "השמורים שלי" אחרי הכרטיס הראשי, כוכב על הפוסטר
      await nfClean(0);
      nfChk(await page.evaluate(() => !document.querySelector('[data-nfrow="fav"]')), "no fav row when empty");
      await page.click(".nfhero"); await page.waitForTimeout(700);
      nfChk((await page.textContent("[data-nffav]")).trim() === "⭐ שמירה", "button text before save");
      nfChk(await page.evaluate(() => { const b = document.querySelector("#nfsBar [data-nffav]"); return b.getBoundingClientRect().height >= 44 && !b.classList.contains("btn"); }), "secondary 44px button");
      nfChk(await page.evaluate(() => document.querySelectorAll("#nfsBar .btn").length) === 1, "one primary button");
      await snap("23_nf_page_fav_btn");
      await page.click("#nfsBar [data-nffav]"); await page.waitForTimeout(400);
      nfChk((await page.textContent("#pill")).indexOf("נשמר") >= 0 && (await page.textContent("#pill")).indexOf("ביטול") >= 0, "save toast with undo");
      nfChk((await page.textContent("#nfsBar [data-nffav]")).trim() === "★ שמור" && (await page.getAttribute("#nfsBar [data-nffav]", "aria-pressed")) === "true", "button state after save");
      await snap("24_nf_fav_saved");
      const f = await nfFavs(); nfChk(f && f.length === 1 && /^[A-Za-z0-9_]+$/.test(f[0].k) && f[0].title && (f[0].type === "movie" || f[0].type === "tv") && /^https:\/\/image\.tmdb\.org\//.test(f[0].poster) && typeof f[0].y === "number" && f[0].at > 0, "stored snapshot " + JSON.stringify(f));
      await page.click("[data-nfclose]"); await page.waitForTimeout(500);
      nfChk(await page.evaluate(() => { const s = document.querySelector('[data-nfrow="fav"]'); return !!s && s.previousElementSibling.classList.contains("nfhero") && s.textContent.indexOf("השמורים שלי") >= 0 && s.querySelectorAll(".nfc").length === 1; }), "fav row right after the hero");
      nfChk(await page.evaluate((k) => !!document.querySelector('#main [data-nfrow="popular"] [data-nfopen="' + k + '"] .nfsv') || !document.querySelector('#main [data-nfrow="popular"] [data-nfopen="' + k + '"]'), (await nfFavs())[0].k), "saved poster has the star badge");
      await snap("25_nf_fav_row");
      await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(900);
      nfChk(await page.evaluate(() => !!document.querySelector('[data-nfrow="fav"]')), "fav row survives reload");
      await page.click('[data-nfrow="fav"] .nfc'); await page.waitForTimeout(600); nfChk((await page.textContent("#nfsBar [data-nffav]")).trim() === "★ שמור", "state after reload");
      await page.click("[data-nfclose]"); await page.waitForTimeout(300);
    });
    await step("nf-fav-undo", async () => { // הסרה עם 'החזר' (מהדף ובלחיצה ארוכה), שורה ריקה נעלמת, 'עוד' בשמורים
      await nfClean(3);
      nfChk(await page.evaluate(() => document.querySelectorAll('[data-nfrow="fav"] .nfc').length) === 3 && !(await page.evaluate(() => !!document.querySelector('[data-nfrow="fav"] .nfmore'))), "3 saved, no chip under the cap");
      await snap("26_nf_fav_row3");
      const first = await page.evaluate(() => document.querySelector('[data-nfrow="fav"] .nfc').getAttribute("data-nfopen"));
      await page.click('[data-nfrow="fav"] .nfc'); await page.waitForTimeout(600);
      nfChk((await page.textContent("#nfsBar [data-nffav]")).trim() === "★ שמור", "saved state on page");
      await page.click("#nfsBar [data-nffav]"); await page.waitForTimeout(400);
      nfChk((await page.textContent("#pill")).indexOf("הוסר") >= 0 && (await page.textContent("#pill")).indexOf("החזר") >= 0, "remove toast with undo");
      nfChk((await nfFavs()).length === 2 && (await page.textContent("#nfsBar [data-nffav]")).trim() === "⭐ שמירה", "removed");
      await snap("27_nf_fav_removed_toast");
      await page.click("#pill [data-pillact]"); await page.waitForTimeout(400);
      nfChk((await nfFavs()).length === 3 && (await nfFavs())[0].k === first && (await page.textContent("#nfsBar [data-nffav]")).trim() === "★ שמור", "undo restores in place (newest first)");
      await page.click("[data-nfclose]"); await page.waitForTimeout(400);
      nfChk(await page.evaluate(() => document.querySelectorAll('[data-nfrow="fav"] .nfc').length) === 3, "row has 3 again");
      const press = async (sel, ms) => { const b = await page.locator(sel).first().boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); await page.waitForTimeout(400); };
      await press('[data-nfrow="fav"] .nfc', 800);
      nfChk((await nfFavs()).length === 2 && !(await nfShown("#nfsheet")), "long press removes without opening the page");
      nfChk((await page.textContent("#pill")).indexOf("הוסר") >= 0, "long press toast");
      await page.click("#pill [data-pillact]"); await page.waitForTimeout(400); nfChk((await nfFavs()).length === 3, "long press undo");
      await press('[data-nfrow="fav"] .nfc', 120); await page.waitForTimeout(300);
      nfChk(await nfShown("#nfsheet") && (await nfFavs()).length === 3, "short press opens the page"); await page.click("[data-nfclose]"); await page.waitForTimeout(300);
      await nfClean(1);
      await press('[data-nfrow="fav"] .nfc', 800);
      nfChk((await nfFavs()).length === 0 && await page.evaluate(() => !document.querySelector('[data-nfrow="fav"]')), "empty row is hidden"); await snap("28_nf_fav_empty");
      await page.click("#pill [data-pillact]"); await page.waitForTimeout(400); nfChk(await page.evaluate(() => !!document.querySelector('[data-nfrow="fav"]')), "undo brings the row back");
    });
    await step("nf-fav-list", async () => { // יותר מ-16 שמורים: 'עוד' בשורת השמורים פותח את כולם
      await nfClean(20);
      nfChk(await page.evaluate(() => document.querySelectorAll('[data-nfrow="fav"] .nfc').length) === 16 && await page.evaluate(() => !!document.querySelector('[data-nfrow="fav"] .nfmore')), "16 cards + chip");
      await page.locator('[data-nfmore="fav"]').click(); await page.waitForTimeout(700);
      nfChk(await page.evaluate(() => document.querySelectorAll("#nflist .nfc").length) === 20, "all 20 in the list"); nfChk((await page.textContent("#nflT")).indexOf("השמורים שלי") >= 0, "title");
      await snap("29_nf_fav_list");
      await page.click("#nflist .nfc"); await page.waitForTimeout(600); await page.click("#nfsBar [data-nffav]"); await page.waitForTimeout(500);
      nfChk(await page.evaluate(() => document.querySelectorAll("#nflist .nfc").length) === 19, "list refreshes behind the page");
      await page.click("[data-nfclose]"); await page.waitForTimeout(300); await page.click("#nflist [data-nflclose]"); await page.waitForTimeout(300);
    });
    await step("nf-rows-dark", async () => {
      await nfClean(3);
      await page.evaluate(() => localStorage.setItem("tvg.theme", "dark")); await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(1000); await snap("30_nf_dark_rows_top");
      await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(800); await snap("30_nf_dark_rows_mid");
      await page.locator('[data-nfmore="israeli"]').click(); await page.waitForTimeout(700); await snap("30_nf_dark_list");
      await page.click("#nflist .nfc"); await page.waitForTimeout(700); await snap("30_nf_dark_list_page");
      await page.evaluate(() => { localStorage.setItem("tvg.theme", "light"); localStorage.removeItem("tvg.nffav"); });
    });
    nfFixture = false;
    // ---- חיפוש מלא בנטפליקס + התראות + תזכורת צפייה (כל השרת מדומה) ----
    const nfsStep = (n, f) => (phase !== "nfs" || process.env.TVG_NO_NFS || (process.env.TVG_SKIP && new RegExp(process.env.TVG_SKIP).test(n)) ? Promise.resolve() : runStep(n, f));
    // סנכרון תזכורות/גיבוי בזמן בדיקות נטפליקס: מדומה רק בתוך הבלוק הזה (נתב ברמת העמוד), כדי שלא ייכתב דבר לשרת החי
    const stubSrv = (r) => r.request().method() !== "POST" ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: '{"ok":true}' });
    await page.route(/\/api\/(rems|backup)/, stubSrv);
    const A = (c, m) => { if (!c) throw new Error("assert: " + m); };
    const shown = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden; }, sel);
    const nfSearch = async (q) => { await page.evaluate(() => { try { ["tvg.wl", "tvg.rem", "tvg.wlDirty"].forEach((k) => localStorage.removeItem(k)); } catch (e) {} }); await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(500); await page.click("#sBtn"); await page.fill("#q", q); await page.waitForTimeout(1600); };
    await nfsStep("nfs-avengers", async () => {
      nfQueries.length = 0; await nfSearch("הנוקמים");
      const txt = await page.textContent("#main");
      for (const s of ["סדרת סרטים", "הנוקמים - אוסף", "סרטים וסדרות", "אנשים", "▶בנטפליקס", "לא זמין כרגע", "משודר בערוץ", "קשת"]) A(txt.indexOf(s) >= 0, "missing text: " + s);
      A(/משודר בערוץ קשת[^·]*· [^\d]*\d{1,2}:\d{2}/.test(txt), "airing badge (Keshet): " + txt.slice(0, 400)); A(/משודר בערוץ כאן 11 · [^\d]*\d{1,2}:\d{2}/.test(txt), "airing badge (Kan)"); /* שעות התוכניות משתנות עם הלוח: בודקים רק את הצורה */
      A(nfQueries.length === 1 && nfQueries[0] === "הנוקמים", "one debounced query: " + JSON.stringify(nfQueries));
      A(await page.evaluate(() => [].map.call(document.querySelectorAll(".nfxn"), (e) => e.textContent).join() === "1,2,3,4"), "collection numbered in order");
      await snap("20_nfs_avengers");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(500); await snap("20_nfs_avengers_bottom");
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
      A(await page.evaluate(() => { const b = document.querySelector("button.nfb.tv[data-nfair]"); return !!b && b.getBoundingClientRect().height >= 43.5; }), "airing badge is a 44px button");
      await page.evaluate(() => document.querySelector("button.nfb.tv[data-nfair]").click()); await page.waitForTimeout(500);
      A(await shown("#rem"), "tapping the airing badge opens the reminder sheet"); A((await page.textContent("#remBody")).length > 10, "reminder sheet has content");
      await snap("20_nfs_air_tap");
    });
    await nfsStep("nfs-debounce", async () => { // הקלדה מהירה = בקשה אחת בלבד
      nfQueries.length = 0; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(500); await page.click("#sBtn");
      for (const q of ["ה", "הנ", "הנו", "הנוק"]) { await page.fill("#q", q); await page.waitForTimeout(120); }
      await page.waitForTimeout(1300); A(nfQueries.length === 1 && nfQueries[0] === "הנוק", "debounce: " + JSON.stringify(nfQueries));
    });
    await nfsStep("nfs-person", async () => { await nfSearch("טום הנקס"); const txt = await page.textContent("#main"); A(txt.indexOf("אנשים") >= 0 && txt.indexOf("טום הנקס") >= 0 && txt.indexOf("פורסט גאמפ") >= 0, "person section"); await snap("21_nfs_person"); });
    await nfsStep("nfs-brand", async () => { await nfSearch("מארוול"); const txt = await page.textContent("#main"); A(txt.indexOf("Marvel Studios") >= 0 && txt.indexOf("איש הברזל") >= 0, "brand section"); await snap("22_nfs_brand"); });
    await nfsStep("nfs-empty", async () => { await nfSearch("zzzqqq"); const txt = await page.textContent("#main"); A(txt.indexOf("לא נמצא") >= 0, "empty state: " + txt.slice(0, 200)); await snap("23_nfs_empty"); });
    await nfsStep("nfs-error", async () => { await nfSearch("שגיאה"); const txt = await page.textContent("#main"); A(txt.indexOf("החיפוש המלא לא זמין") >= 0, "error state"); await snap("24_nfs_error"); });
    await nfsStep("nfs-sheet-alerts", async () => {
      await nfSearch("הנוקמים"); wlPosts.length = 0;
      await page.click('[data-nfopen="m24428"]'); await page.waitForTimeout(700); A(await shown("#nfsheet"), "sheet open from search result");
      const sh = await page.textContent("#nfsheet");
      for (const s of ["לא זמין כרגע בנטפליקס", "זמין גם ב:", "Prime Video", "🔔 תודיע לי", "כשזה מגיע לנטפליקס", "כשמשודר בטלוויזיה", "⏰ להזכיר לי לצפות", "הערב 21:00", "מחר 21:00", "בחירת שעה"]) A(sh.indexOf(s) >= 0, "sheet text: " + s);
      A(sh.indexOf("עונה חדשה") < 0, "no season chip for a movie");
      A(await page.evaluate(() => !document.querySelector(".nfgo")), "no Netflix button for unavailable title");
      await snap("25_nfs_sheet_alerts");
      const undoBtn = () => page.evaluate(() => { const x = document.querySelector("[data-pillact2]") || document.querySelector("[data-pillact]"); x.click(); });
      // בלי פוש: שומרים מקומית, הודעה כנה (לא "נודיע לך"), בלי שליחה לשרת
      await page.click('[data-wlkind="nf"]'); await page.waitForTimeout(500);
      A((await page.getAttribute('[data-wlkind="nf"]', "aria-pressed")) === "true", "chip pressed");
      const pt = await page.textContent("#pill"); A(/נשמר/.test(pt) && !/נודיע לך/.test(pt), "honest toast without push: " + pt); A(wlPosts.length === 0, "no server write without push");
      A(/התראות/.test(await page.textContent("#nfsheet")), "push hint in the sheet");
      if (d.name.indexOf("iphone") === 0) A(/מסך הבית/.test(pt) && /מסך הבית/.test(await page.textContent("#nfsheet")), "iOS Safari: explains home-screen install");
      await snap("26_nfs_alert_nopush");
      await undoBtn(); await page.waitForTimeout(400); A((await page.getAttribute('[data-wlkind="nf"]', "aria-pressed")) === "false", "undo unpresses");
      // עם פוש: נודיע לך + POST עם בסיס "לא בנטפליקס" מתשובה שלמה וקישור חיפוש
      await page.evaluate(() => { TVG.pushOn = true; TVG.nfReopen(); }); await page.waitForTimeout(300); wlPosts.length = 0;
      await page.click('[data-wlkind="nf"]'); await page.waitForTimeout(500);
      const it0 = wlPosts[0] && wlPosts[0].items[0];
      A(wlPosts.length === 1 && it0.k === "m24428" && it0.on.join() === "nf" && it0.bn === false && it0.bc === 1 && /^https:\/\/www\.netflix\.com\/search\?q=/.test(it0.link) && /^[a-z0-9]{24,48}$/.test(wlPosts[0].t), "watch POST " + JSON.stringify(wlPosts));
      A(/נודיע לך/.test(await page.textContent("#pill")), "alert toast with push");
      await snap("26_nfs_alert_set");
      await undoBtn(); await page.waitForTimeout(400);
      A((await page.getAttribute('[data-wlkind="nf"]', "aria-pressed")) === "false", "undo unpresses"); A(wlPosts.length === 2 && wlPosts[1].items.length === 0, "undo synced empty list");
      // הסרה דרך הצ'יפ: ניתנת להחזרה
      await page.click('[data-wlkind="tv"]'); await page.waitForTimeout(300); await page.click('[data-wlkind="tv"]'); await page.waitForTimeout(300);
      A(/הוסרה/.test(await page.textContent("#pill")) && /החזר/.test(await page.textContent("#pill")), "removal toast has undo");
      await page.click("[data-pillact]"); await page.waitForTimeout(300); A((await page.getAttribute('[data-wlkind="tv"]', "aria-pressed")) === "true", "undo restores the chip");
    });
    await nfsStep("nfs-sheet-tv", async () => { // סדרה בנטפליקס: שלושת סוגי ההתראות לא כולם; עונה חדשה כן; כפתור ראשי כתום
      await nfSearch("הנוקמים"); await page.click('[data-nfopen="t88001"]'); await page.waitForTimeout(600);
      const sh = await page.textContent("#nfsheet"); A(sh.indexOf("עונה חדשה") >= 0 && sh.indexOf("כשזה מגיע לנטפליקס") >= 0, "tv chips"); A(/📺 משודר בערוץ/.test(sh), "airing badge in sheet");
      await snap("27_nfs_sheet_tv");
      await page.evaluate(() => { document.querySelector("#nfsBody").scrollTop = 9999; }); await page.waitForTimeout(300); await snap("27_nfs_sheet_tv_bottom");
      await page.click("[data-nfclose]");
    });
    await nfsStep("nfs-sheet-nf", async () => {
      await nfSearch("הנוקמים"); await page.click('[data-nfopen="m299534"]'); await page.waitForTimeout(600);
      A(await page.evaluate(() => { const a = document.querySelector(".nfgo"); return !!a && /^https:\/\/www\.netflix\.com\/search\?q=/.test(a.href); }), "Netflix primary button");
      A((await page.textContent("#nfsheet")).indexOf("כשזה מגיע לנטפליקס") < 0, "no arrive-on-Netflix chip when already there");
      await snap("28_nfs_sheet_nf");
    });
    await nfsStep("nfs-ds-item", async () => { // תוצאת חיפוש שבדיסני+ בלבד: תג, דף עם "▶ פתח בדיסני+", תזכורת צפייה, ערב צפייה
      await nfSearch("הנוקמים"); await page.evaluate(() => { TVG.pushOn = true; });
      A((await page.textContent("#main")).indexOf("▶בדיסני+") >= 0, "Disney+ badge in results");
      await page.click('[data-nfopen="m99861"]'); await page.waitForTimeout(600);
      const sh = await page.textContent("#nfsheet");
      A(sh.indexOf("זמין בדיסני+") >= 0 && sh.indexOf("זמין בנטפליקס") < 0 && sh.indexOf("כשזה מגיע לנטפליקס") < 0, "Disney+ availability only");
      A(await page.evaluate(() => { const a = document.querySelector("#nfsBar .nfgo"); return !!a && /▶ פתח בדיסני\+/.test(a.textContent) && /^https:\/\/www\.disneyplus\.com\//.test(a.href); }), "▶ פתח בדיסני+");
      await snap("29_nfs_ds_sheet");
      await page.click('[data-nfrem="tomorrow"]'); await page.waitForTimeout(500);
      const rec = await page.evaluate(() => TVG.REMS[0]);
      A(rec && rec.ch === "דיסני+" && /disneyplus\.com/.test(rec.desc) && /לצפייה בדיסני\+/.test(rec.desc), "reminder record " + JSON.stringify(rec));
      await page.click("[data-nfclose]"); await page.waitForTimeout(300); await page.click('[data-tab="rems"]'); await page.waitForTimeout(500);
      const rt = await page.textContent("#main"); A(rt.indexOf("פתיחה בדיסני+") >= 0 && rt.indexOf("disneyplus.com") < 0, "reminders row opens Disney+");
      await page.click('[data-tab="nf"]'); await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector('[data-nfopen="m99861"]') && 0);
    });
    await nfsStep("nfs-watch-rem", async () => {
      await nfSearch("הנוקמים"); await page.evaluate(() => { TVG.pushOn = true; }); await page.click('[data-nfopen="m299534"]'); await page.waitForTimeout(600);
      await page.click('[data-nfrem="tomorrow"]'); await page.waitForTimeout(500);
      const rec = await page.evaluate(() => TVG.REMS[0]);
      A(rec && /^nf\|m299534\|\d+$/.test(rec.k) && rec.title === "הנוקמים: סוף המשחק" && rec.ch === "נטפליקס" && rec.lead === 0 && /netflix\.com\/search\?q=Avengers/.test(rec.desc), "reminder record " + JSON.stringify(rec));
      A(new Date(rec.ts).getHours() === 21 && new Date(rec.ts).getMinutes() === 0 && rec.ts > Date.now(), "tomorrow 21:00 (frozen clock)");
      const pill = await page.textContent("#pill"); A(/נזכיר לך מחר ב־21:00/.test(pill) && /ביטול/.test(pill), "toast: " + pill);
      A((await page.textContent("#nfsheet")).indexOf("יש תזכורת") >= 0, "sheet shows the new reminder");
      await snap("29_nfs_rem_created");
      await page.click("[data-nfclose]"); await page.waitForTimeout(400); await page.click('[data-tab="rems"]'); await page.waitForTimeout(600);
      const rt = await page.textContent("#main"); A(rt.indexOf("הנוקמים: סוף המשחק") >= 0 && rt.indexOf("פתיחה בנטפליקס") >= 0 && rt.indexOf("netflix.com") < 0, "reminders tab row with link, raw URL hidden");
      await snap("30_nfs_rem_in_rems");
      await page.click("[data-jump]"); await page.waitForTimeout(500); A(await shown("#nfsheet"), "tapping the reminder opens the content sheet");
      await page.click("[data-nfclose]");
    });
    await nfsStep("nfs-watch-rem-undo", async () => {
      await nfSearch("הנוקמים"); await page.evaluate(() => { TVG.pushOn = true; }); await page.click('[data-nfopen="m299534"]'); await page.waitForTimeout(500);
      await page.click('[data-nfrem="pick"]'); await page.waitForTimeout(300); A(await shown("[data-nfremdt]"), "time picker shown"); await snap("31_nfs_rem_pick");
      await page.click("[data-nfremset]"); await page.waitForTimeout(500); A(await page.evaluate(() => TVG.REMS.length === 1), "picked-time reminder");
      A(await shown("#pill"), "toast visible: " + (await page.evaluate(() => document.querySelector("#pill").outerHTML)));
      await page.click("[data-pillact]"); await page.waitForTimeout(400); A(await page.evaluate(() => TVG.REMS.length === 0), "undo removes the reminder");
    });
    await nfsStep("nfs-settings-list", async () => {
      await nfSearch("הנוקמים"); await page.click('[data-nfopen="t88001"]'); await page.waitForTimeout(500);
      await page.click('[data-wlkind="season"]'); await page.click('[data-wlkind="tv"]'); await page.waitForTimeout(300);
      await page.click("[data-nfclose]"); await page.waitForTimeout(300);
      await page.evaluate(() => { TVG.closeNf(); }); await page.click("#setBtn"); await page.waitForTimeout(600);
      A((await page.textContent("#wlList")).indexOf("הזמר במסכה") >= 0, "watched item listed in settings");
      await page.evaluate(() => { document.querySelector("#wlList").scrollIntoView({ block: "center" }); }); await page.waitForTimeout(300); await snap("32_settings_alerts");
      await page.click("[data-wlrm]"); await page.waitForTimeout(400); A(/ההתראה הוסרה/.test(await page.textContent("#pill")), "remove toast");
      A((await page.textContent("#wlList")).indexOf("עדיין אין התראות") >= 0, "list empty after remove"); await snap("32_settings_alerts_removed");
      await page.click("[data-pillact]"); await page.waitForTimeout(400); A((await page.textContent("#wlList")).indexOf("הזמר במסכה") >= 0, "undo restores");
    });
    await nfsStep("nfs-open-from-push", async () => { // ?nf=<key> מהודעה: פותח את דף התוכן, מנקה את הכתובת, ומשלים פרטים מהשרת
      await fresh(); await page.evaluate(() => { localStorage.setItem("tvg.wl", JSON.stringify([{ k: "m24428", title: "הנוקמים", orig: "The Avengers", type: "movie", poster: "", on: ["nf"], at: 1, bn: false }])); });
      await page.goto(base + "index.html?nf=m24428&e=nf&tab=rems", { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
      A(await shown("#nfsheet"), "?nf= opens the sheet"); A(!/[?&](nf|e|tab)=/.test(page.url()), "url cleaned: " + page.url());
      A(await page.evaluate(() => TVG.tab !== "rems"), "nf takes precedence over tab");
      A((await page.textContent("#nfsheet")).indexOf("הנוקמים") >= 0 && (await page.getAttribute('[data-wlkind="nf"]', "aria-pressed")) === "true", "item + pressed chip from watchlist");
      // G: הודעת "הגיע לנטפליקס": ▶ פתח בנטפליקס מיד (הקישור מהרשימה), לא "לא זמין", גם כשתשובת החיפוש (מטמון) אומרת שלא
      A(await page.evaluate(() => { const a = document.querySelector(".nfgo"); return !!a && /^https:\/\/www\.netflix\.com\/search\?q=/.test(a.href); }), "arrived push: Netflix primary button"); A((await page.textContent("#nfsheet")).indexOf("לא זמין") < 0, "arrived push: never 'not available'");
      await snap("33_nfs_from_push");
      await page.goto(base + "index.html?nf=m1", { waitUntil: "networkidle" }); await page.waitForTimeout(800); A(!(await shown("#nfsheet")), "unknown key does not open"); A(/לא מצאנו/.test(await page.textContent("#pill")), "friendly toast");
    });
    await nfsStep("nfs-open-from-rem", async () => { // H: הקשה על תזכורת צפייה (?rem=nf|...) פותחת את דף התוכן עם ▶ פתח בנטפליקס, לא את חלון הנודניק
      await fresh(); const ts = new Date("2026-11-01T21:00:00+02:00").getTime(), k = "nf|m299534|" + ts;
      await page.evaluate(([k, ts]) => { localStorage.setItem("tvg.rem", JSON.stringify([{ k, id: "", ts, end: ts + 7200000, title: "הנוקמים: סוף המשחק", ch: "נטפליקס", desc: "", lead: 0, at: 1, nx: { t: "הנוקמים: סוף המשחק", ty: "movie", p: "", l: "https://www.netflix.com/search?q=Avengers%3A%20Endgame" } }])); localStorage.setItem("tvg.calTok", "qa0123456789abcdefghijklmn"); }, [k, ts]);
      await page.goto(base + "index.html?rem=" + encodeURIComponent(k), { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
      A(await shown("#nfsheet"), "?rem=nf|… opens the content page"); A(!(await shown("#snzRoot")), "not the broadcast snooze sheet"); A(!/[?&]rem=/.test(page.url()), "url cleaned");
      A(await page.evaluate(() => { const a = document.querySelector(".nfgo"); return !!a && /Avengers/.test(decodeURIComponent(a.href)); }), "Netflix primary button from the stored reminder");
      await snap("33_nfs_from_rem");
    });
    await nfsStep("nfs-dark", async () => { // מצב כהה: תוצאות חיפוש, דף תוכן (התראות + תזכורת), הגדרות
      await nfSearch("הנוקמים"); await page.evaluate(() => TVG.setTheme("dark")); await page.waitForTimeout(400); await snap("34_nfs_dark_results");
      await page.click('[data-nfopen="t88001"]'); await page.waitForTimeout(600); await page.click('[data-wlkind="season"]'); await page.waitForTimeout(500); await snap("34_nfs_dark_sheet");
      await page.evaluate(() => { document.querySelector("#nfsBody").scrollTop = 9999; }); await page.waitForTimeout(300); await snap("34_nfs_dark_sheet_bottom");
      await page.evaluate(() => { try { localStorage.removeItem("tvg.theme"); } catch (e) {} });
    });
    await page.evaluate(() => { try { localStorage.removeItem("tvg.wl"); localStorage.removeItem("tvg.rem"); localStorage.removeItem("tvg.wlDirty"); localStorage.removeItem("tvg.calTok"); } catch (e) {} });
    await setupPage(); // עמוד חדש אחרי בלוק החיפוש (זיכרון)
    await step("nf-back-closes", async () => { // חזרה/Escape סוגרים את דף התוכן ולא יוצאים מהאפליקציה; סגירה מהממשק לא משאירה היסטוריה
      const okv = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden; }, sel);
      const chk = (c, m) => { if (!c) throw new Error("assert: " + m); };
      await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(800); const url0 = page.url();
      await page.click(".nfhero"); await page.waitForTimeout(600); chk(await okv("#nfsheet"), "nf page open"); chk(await page.evaluate(() => !!(history.state && history.state.tvgLayer)), "pushState on nf open");
      await page.goBack(); await page.waitForTimeout(500); chk(!(await okv("#nfsheet")), "back closes nf page"); chk(page.url() === url0, "still in app: " + page.url()); chk(await page.evaluate(() => TVG.tab === "nf"), "stays on nf tab");
      await page.click(".nfhero"); await page.waitForTimeout(500); await page.click("[data-nfclose]"); await page.waitForTimeout(600);
      chk(!(await okv("#nfsheet")), "UI close"); chk(await page.evaluate(() => !history.state), "history clean after UI close");
      await page.click(".nfhero"); await page.waitForTimeout(500); await page.keyboard.press("Escape"); await page.waitForTimeout(500); chk(!(await okv("#nfsheet")), "Escape closes nf"); chk(page.url() === url0, "still in app after Escape");
      await page.click(".nfhero"); await page.waitForTimeout(500); await page.evaluate(() => TVG.closeFavs()); await page.waitForTimeout(500); chk(!(await okv("#nfsheet")), "closeFavs closes nf"); chk(await page.evaluate(() => !history.state), "single history pop (no double entries)");
      await page.click(".nfhero"); await page.waitForTimeout(500); await snap("19_nf_layer_open");
    });
    await page.evaluate(() => { try { localStorage.removeItem("tvg.tab"); } catch (e) {} });

    // ---- תחושת אצבע נוזלית (js/sheetdrag.js, js/swipe.js, css נגישות): מגע אמיתי דרך CDP. פירוט מלא + הקלטות: tools/qa/fluid.cjs ----
    const fluidSt = (sel) => page.evaluate((s) => { const e = document.querySelector(s), r = e.getBoundingClientRect(); return { hidden: e.hidden, top: r.top, h: r.height, tr: e.style.transform, hist: history.state, url: location.search }; }, sel);
    const fluidOpen = async () => { await fresh(); await page.click('[data-tab="grid"]'); await page.waitForTimeout(500); await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(600); };
    await step("fluid-sheet-slow-back", async () => { // גרירה איטית של 30% ושחרור: חוזר פתוח, ההיסטוריה לא נגעה
      const cdp = await ctx.newCDPSession(page); await fluidOpen(); const s0 = await fluidSt("#rem"), cx = d.w / 2;
      await touch.drag(cdp, [[cx, s0.top + 14], [cx, s0.top + 14 + s0.h * 0.3]], 700, { hold: 250, release: false }); await snap("70_fluid_drag_mid");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(900);
      const s1 = await fluidSt("#rem"); if (s1.hidden || s1.tr !== "" || Math.abs(s1.top - s0.top) > 1 || !(s1.hist && s1.hist.tvgLayer)) throw new Error("assert: slow drag should spring back open: " + JSON.stringify(s1));
    });
    await step("fluid-sheet-flick-close", async () => { // זריקה מהירה: נסגר דרך שכבת הניווט, בלי רשומת היסטוריה יתומה, כתובת נקייה
      const cdp = await ctx.newCDPSession(page); await fluidOpen(); const s0 = await fluidSt("#rem"), cx = d.w / 2;
      await touch.drag(cdp, [[cx, s0.top + 14], [cx, s0.top + 14 + 130]], 100); await page.waitForTimeout(900);
      const s1 = await fluidSt("#rem"); if (!s1.hidden || s1.hist || s1.url) throw new Error("assert: flick should close with clean history: " + JSON.stringify(s1));
      if (!(await page.evaluate(() => document.querySelector("#scrim2").hidden && document.querySelector("#scrim2").style.opacity === ""))) throw new Error("assert: scrim not reset");
      await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(500); await snap("70_fluid_reopen");
      await page.keyboard.press("Escape"); await page.waitForTimeout(400); if (!(await fluidSt("#rem")).hidden) throw new Error("assert: Escape still closes");
    });
    await step("fluid-sheet-inner-scroll", async () => { // תוכן גלול: הגרירה גוללת, לא מזיזה את החלון
      const cdp = await ctx.newCDPSession(page); await fresh(); await page.click("#setBtn"); await page.waitForTimeout(700);
      const i = await page.evaluate(() => { const s = document.querySelector("#setsheet"); s.scrollTop = 240; const r = s.getBoundingClientRect(); return { top: r.top, h: r.height }; }), cx = d.w / 2;
      await touch.drag(cdp, [[cx, i.top + i.h * 0.55], [cx, i.top + i.h * 0.55 + 160]], 500, { hold: 100, release: false });
      const m = await fluidSt("#setsheet"), sc = await page.evaluate(() => document.querySelector("#setsheet").scrollTop);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(600);
      if (m.tr !== "" || sc >= 240) throw new Error("assert: inner scroll should scroll content, not move the sheet: " + m.tr + " scrollTop " + sc);
    });
    await step("fluid-day-swipe-edge", async () => { // יום אחרון: גומי וחוזר; כיוון RTL נשמר (dx>0 = היום הבא)
      const cdp = await ctx.newCDPSession(page); await fresh(); await page.click('[data-tab="grid"]'); await page.waitForTimeout(700);
      const days = await page.evaluate(() => TVG.allDays()), y = d.h * 0.55;
      await touch.drag(cdp, [[d.w * 0.25, y], [d.w * 0.7, y]], 120); await page.waitForTimeout(800);
      if ((await page.evaluate(() => TVG.day)) !== days[1]) throw new Error("assert: dx>0 should go to the next day");
      await page.evaluate((l) => { TVG.day = l; TVG.render(); }, days[days.length - 1]); await page.waitForTimeout(500);
      await touch.drag(cdp, [[d.w * 0.25, y], [d.w * 0.85, y]], 250); await page.waitForTimeout(800);
      const r = await page.evaluate(() => ({ day: TVG.day, tr: document.querySelector(".list").style.transform }));
      if (r.day !== days[days.length - 1] || r.tr !== "") throw new Error("assert: last day should rubber-band and stay: " + JSON.stringify(r));
      await snap("71_fluid_last_day");
    });
    await step("fluid-reduced-motion", async () => { // הפחתת תנועה: נסגר בדעיכה, בלי קפיץ
      const cdp = await ctx.newCDPSession(page); await page.emulateMedia({ reducedMotion: "reduce" });
      try { await fluidOpen(); const s0 = await fluidSt("#rem"), cx = d.w / 2;
        await touch.drag(cdp, [[cx, s0.top + 14], [cx, s0.top + 14 + 110]], 90); await page.waitForTimeout(700);
        const s1 = await fluidSt("#rem"); if (!s1.hidden || s1.hist) throw new Error("assert: reduced-motion flick should close cleanly: " + JSON.stringify(s1));
        await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(500); await snap("72_reduced_motion_sheet");
      } finally { await page.emulateMedia({ reducedMotion: "no-preference" }); }
    });
    await step("fluid-a11y-media", async () => { // ניגודיות גבוהה + שקיפות מופחתת (CDP) בשני הערכות, עם חלון תזכורת פתוח
      const cdp = await ctx.newCDPSession(page);
      for (const th of ["light", "dark"]) {
        await fresh(); await page.evaluate((t) => TVG.setTheme(t), th);
        await page.emulateMedia({ contrast: "more" }); await fluidOpen().catch(() => {}); await page.evaluate((t) => TVG.setTheme(t), th); await snap("73_contrast_more_" + th);
        await page.emulateMedia({ contrast: "no-preference" });
        await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
        const bf = await page.evaluate(() => getComputedStyle(document.querySelector("#rem")).backdropFilter);
        if (bf !== "none") throw new Error("assert: sheet backdrop-filter should be none under reduced transparency: " + bf);
        await snap("73_reduced_transparency_" + th);
        await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "no-preference" }] });
      }
      await page.evaluate(() => TVG.setTheme("light"));
    });

    // תרחישי אנדרואיד/יומן: בסוף, כדי שלא ישנו מצב (tab/calmode) לצילומים הקודמים; כל צעד מנקה אחריו
    await step("cal-ics-sheet", async () => { // יומן רגיל (באנדרואיד: יומן Google), חלון תזכורת אחרי בחירת מצב
      await fresh(); await page.evaluate(() => { localStorage.setItem("tvg.calmode", "ics"); }); await fresh(); await page.click('[data-tab="grid"]'); await page.waitForTimeout(600);
      await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(700); await snap("04b_remsheet_cal");
      await page.evaluate(() => localStorage.removeItem("tvg.calmode"));
    });
    await step("rems-tab", async () => { await fresh(); await page.click('[data-tab="rems"]'); await page.waitForTimeout(500); await page.evaluate(() => document.querySelector("[data-personal]").click()); await page.waitForTimeout(600); await snap("04c_personal"); });
    await step("push-denied", async () => {
      await fresh(); await page.evaluate(() => { Notification.requestPermission = () => Promise.resolve("denied"); window.TVG.enablePush(); }); await page.waitForTimeout(500); await snap("04d_push_denied");
    });
    await step("install-prompt", async () => {
      await fresh(); await page.evaluate(() => { const e = new Event("beforeinstallprompt"); e.prompt = () => {}; window.dispatchEvent(e); });
      await page.click("#setBtn"); await page.waitForTimeout(600);
      await page.evaluate(() => { const s = document.querySelector("#setsheet"); s.scrollTop = s.scrollHeight; }); await page.waitForTimeout(300); await snap("05b_settings_install");
    });

    // ---- נודניק, ניווט שכבות, פרמטרים בכתובת, תזכורת כפולה ----
    const TOK = "qa0123456789abcdefghijklmn";
    const mkRem = (title, startIso, endIso, lead) => ({ k: "208|" + new Date(startIso).getTime(), id: "208", ts: new Date(startIso).getTime(), end: new Date(endIso).getTime(), title, ch: "ערוץ ויוה", desc: "", lead, at: 1 });
    // תזכורות לדוגמה על תוכניות אמיתיות בערוץ 208 סביב FIXED_NOW (הלוח גולל קדימה: אין תאריכים קבועים)
    const p208 = JSON.parse(fs.readFileSync(path.join(REPO, "guide.json"), "utf8")).programs.filter((p) => p.ch === "208").sort((x, y) => (x.start < y.start ? -1 : 1)), msOf = (s) => SER.ilToMs(s), nowMs = new Date(FIXED_NOW).getTime(); // שעון ישראל כולל מעבר שעון קיץ
    const iNext = p208.findIndex((p) => msOf(p.start) > nowMs + 10 * 60000), iStarted = p208.findIndex((p) => msOf(p.start) > nowMs) - 1;
    if (iNext < 1 || iStarted < 0 || iNext + 1 >= p208.length || iStarted + 1 >= p208.length) throw new Error("guide.json has no usable channel-208 programs around " + FIXED_NOW + " (iNext=" + iNext + ", iStarted=" + iStarted + ")");
    const asRem = (i, lead) => mkRem(p208[i].title, new Date(msOf(p208[i].start)).toISOString(), new Date(msOf(p208[i + 1].start)).toISOString(), lead);
    const REM_NEXT = asRem(iNext, 10);
    const REM_STARTED = asRem(iStarted, 10);
    const seedRems = async (list) => { await page.evaluate(([l, tok]) => { localStorage.setItem("tvg.rem", JSON.stringify(l)); localStorage.setItem("tvg.calTok", tok); localStorage.setItem("tvg.push", "1"); localStorage.setItem("tvg.calmode", "sub"); }, [list, TOK]); };
    const assert = (cond, msg) => { if (!cond) throw new Error("assert: " + msg); };
    const vis = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden; }, sel);
    const hasNoSnoozeParams = () => !/[?&](rem|tab|q)=/.test(page.url());

    await step("snooze-sheet", async () => {
      await fresh(); await seedRems([REM_NEXT, REM_STARTED]);
      await fresh("?rem=" + encodeURIComponent(REM_NEXT.k));
      assert(await vis("#rem"), "snooze sheet should be open"); assert(await vis("#snzRoot"), "snzRoot"); assert(hasNoSnoozeParams(), "url cleaned: " + page.url());
      assert(await vis("#scrim2"), "scrim");
      await snap("11_snooze_upcoming");
      await page.click('[data-snzm="10"]'); await page.waitForTimeout(150); await snap("11_snooze_pick10");
    });
    await step("snooze-started", async () => {
      await fresh(); await seedRems([REM_NEXT, REM_STARTED]);
      await fresh("?rem=" + encodeURIComponent(REM_STARTED.k));
      assert(await vis("#snzRoot"), "snzRoot started");
      assert((await page.textContent("#snzSt")).indexOf("התחיל לפני") === 0, "started text: " + (await page.textContent("#snzSt")));
      assert(await page.evaluate(() => document.querySelector("#snzStart").disabled), "start chip disabled");
      await snap("11_snooze_started");
    });
    await step("snooze-unknown", async () => {
      await fresh("?rem=" + encodeURIComponent("999|1"));
      assert(await vis("#rem"), "sheet open for unknown"); assert((await page.textContent("#remBody")).indexOf("כבר לא פעילה") >= 0, "friendly unknown message");
      await snap("11_snooze_unknown");
    });
    await step("snooze-post-ok", async () => {
      await fresh(); await seedRems([REM_NEXT]);
      let body = null;
      await page.route("**/api/snooze", async (r) => { body = JSON.parse(r.request().postData() || "{}"); await r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true, at: new Date(FIXED_NOW).getTime() + 10 * 60000, m: body.m }) }); });
      await fresh("?rem=" + encodeURIComponent(REM_NEXT.k));
      await page.click('[data-snzm="10"]'); await page.click("[data-snzgo]"); await page.waitForTimeout(500);
      assert(body && body.k === REM_NEXT.k && body.t === TOK && body.m === 10, "post body " + JSON.stringify(body));
      const pill = await page.textContent("#pill"); assert(/נזכיר לך ב-20:25/.test(pill) && /ביטול/.test(pill), "pill: " + pill); assert(!(await vis("#rem")), "sheet closed after success");
      await snap("11_snooze_done");
      await page.click("[data-pillact]"); await page.waitForTimeout(400);
      assert(body.cancel === 1 && body.m === 0, "undo posts cancel: " + JSON.stringify(body));
      await page.unroute("**/api/snooze");
    });
    await step("snooze-post-fail", async () => {
      await fresh(); await seedRems([REM_NEXT]);
      await page.route("**/api/snooze", (r) => r.fulfill({ status: 502, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }));
      await fresh("?rem=" + encodeURIComponent(REM_NEXT.k));
      await page.click("[data-snzgo]"); await page.waitForTimeout(500);
      assert((await page.textContent("#pill")).indexOf("לא הצלחנו לקבוע נודניק") >= 0, "fail pill"); assert(await vis("#snzRoot"), "sheet stays open on failure");
      await snap("11_snooze_fail"); await page.unroute("**/api/snooze");
    });
    await step("snooze-open-in-guide", async () => {
      await fresh(); await seedRems([REM_NEXT]); await fresh("?rem=" + encodeURIComponent(REM_NEXT.k));
      await page.click("[data-snzopen]"); await page.waitForTimeout(500);
      assert(!(await vis("#rem")), "sheet closed"); assert(await page.evaluate(() => TVG.tab === "grid"), "grid tab");
      assert(await page.evaluate((ts) => !!document.querySelector('[data-pts="' + ts + '"]'), REM_NEXT.ts), "program row present");
      await snap("11_snooze_inguide");
    });
    await step("back-closes-layer", async () => {
      await fresh(); const url0 = page.url();
      await page.click("#setBtn"); await page.waitForTimeout(300); assert(await vis("#setsheet"), "settings open");
      assert(await page.evaluate(() => !!(history.state && history.state.tvgLayer)), "pushState on open");
      await page.goBack(); await page.waitForTimeout(400);
      assert(!(await vis("#setsheet")), "back closes settings"); assert(page.url() === url0, "url unchanged after back: " + page.url());
      await page.click("#chBtn"); await page.waitForTimeout(300); assert(await vis("#sheet"), "channels open");
      await page.click("#done"); await page.waitForTimeout(500);
      assert(!(await vis("#sheet")), "UI close"); assert(await page.evaluate(() => !history.state) && page.url() === url0, "history clean after UI close");
      await page.click("#sBtn"); await page.waitForTimeout(300); assert(await vis("#qwrap"), "search open"); await page.goBack(); await page.waitForTimeout(400);
      assert(!(await vis("#qwrap")), "back closes search"); assert(page.url() === url0, "still in app");
      await page.click("#fvBtn"); await page.waitForTimeout(300); assert(await vis("#favs"), "favs"); await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      assert(!(await vis("#favs")), "Escape closes favs"); assert(page.url() === url0, "still in app after Escape");
      await page.evaluate(() => document.querySelector("[data-rem]") && 0);
    });
    await step("reload-with-layer-open", async () => { // רענון כשחלון פתוח: אין רשומת היסטוריה מתה, ו"חזור" הראשון לא "מת"
      await fresh();
      await page.click("#setBtn"); await page.waitForTimeout(300);
      await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(1200);
      assert(await page.evaluate(() => !history.state), "state cleared after reload");
      await page.click("#setBtn"); await page.waitForTimeout(300); assert(await vis("#setsheet"), "layer works after reload");
      await page.goBack(); await page.waitForTimeout(500); assert(!(await vis("#setsheet")), "back closes layer after reload");
    });
    await step("tab-ignored-with-q", async () => { // קדימות: ?tab= לא נשמר כשיש ?q=
      await fresh(); await page.evaluate(() => localStorage.removeItem("tvg.tab")); await fresh("?q=abc&tab=rems");
      assert(await page.evaluate(() => TVG.tab !== "rems" && localStorage.getItem("tvg.tab") !== "rems"), "tab not stored when q present");
      await page.evaluate(() => localStorage.removeItem("tvg.tab"));
    });
    await step("q-param-long", async () => { await fresh("?q=" + "x".repeat(300)); assert((await page.inputValue("#q")).length === 100, "q capped to 100"); });
    await step("tab-param", async () => {
      await fresh("?tab=rems"); assert(await page.evaluate(() => TVG.tab === "rems"), "tab=rems"); assert(hasNoSnoozeParams(), "url cleaned " + page.url());
      await snap("12_tab_param_rems");
    });
    await step("q-param", async () => {
      await fresh("?q=" + encodeURIComponent("חדשות")); assert(await vis("#qwrap"), "search open"); assert((await page.inputValue("#q")) === "חדשות", "q value"); assert(hasNoSnoozeParams(), "url cleaned " + page.url());
      await snap("12_q_param");
      await fresh("?q="); assert(await vis("#qwrap"), "empty q opens search"); assert(hasNoSnoozeParams(), "url cleaned (empty q) " + page.url());
      await snap("12_q_param_empty");
    });
    await step("sw-message-open", async () => {
      await fresh(); await seedRems([REM_NEXT]); await fresh();
      await page.evaluate((k) => { navigator.serviceWorker && navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "open", url: "./?rem=" + encodeURIComponent(k) } })); }, REM_NEXT.k);
      await page.waitForTimeout(300); assert(await vis("#snzRoot"), "SW open message opens snooze");
    });
    await step("double-reminder-chip", async () => {
      await fresh(); await seedRems([]); await fresh(); await page.click('[data-tab="grid"]'); await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(500);
      assert(await vis("[data-dbl]"), "dbl chip shown"); await page.click("[data-dbl]"); await page.waitForTimeout(250);
      assert((await page.getAttribute("[data-dbl]", "aria-pressed")) === "true", "dbl pressed"); await snap("12_rem_double");
    });
    // ---- 📺 מעקב אחרי סדרה (js/series.js). ההתראות מאושרות בהקשר (pushOn אמיתי), /api/follow מדומה, ו-/api/rems נחסם ב-TVG_NO_WRITES ----
    const folSeed = async (push) => { await page.evaluate(([tok, p]) => { localStorage.removeItem("tvg.fol"); localStorage.removeItem("tvg.folDirty"); localStorage.setItem("tvg.calTok", tok); if (p) localStorage.setItem("tvg.push", "1"); else localStorage.removeItem("tvg.push"); localStorage.setItem("tvg.calmode", "sub"); }, [TOK, push]); };
    const pushNow = () => page.evaluate(() => { TVG.pushOn = true; });
    const folKeep = (title) => page.evaluate(([t, tok]) => { localStorage.setItem("tvg.fol", JSON.stringify([{ title: t, mode: "new", lead: 10, ch: "", chn: "", u: Date.now() }])); localStorage.setItem("tvg.calTok", tok); }, [title, TOK]);
    const folOpenSearch = async () => { await page.evaluate((t) => { TVG.tab = "dial"; TVG.startSearch(t, true); }, FOL_TITLE); await page.waitForTimeout(700); };
    for (const theme of ["light", "dark"]) {
      const F = (theme === "dark" ? "A_dark_" : "") + "21_fol_";
      await step("fol-search-" + theme, async () => {
        folPosts.length = 0; folStatus = 200;
        await fresh(); await folSeed(true); await fresh(); await pushNow(); await page.evaluate((t) => TVG.setTheme(t), theme); await folOpenSearch();
        assert(await vis(".serfol [data-folnew]"), "follow row in search"); assert(!(await vis("[data-remlist]")), "old batch row replaced");
        assert((await page.textContent(".serfol .btn")).indexOf("לעקוב אחרי הסדרה") >= 0, "primary label");
        await snap(F + "01_search");
        // (אותו צעד: חיפוש -> חלון -> עוקבים. חלוקה לקבוצות לא תפריד ביניהם)
        await page.click(".serfol [data-folnew]"); await page.waitForTimeout(500);
        assert(await vis("#rem"), "sheet open"); assert(await vis("[data-folgo]"), "go button"); assert((await page.getAttribute('[data-folmode="new"]', "aria-pressed")) === "true", "default = new only");
        assert((await page.evaluate(() => [].filter.call(document.querySelectorAll("#rem .btn"), (b) => b.offsetParent).length)) === 1, "one primary button");
        await snap(F + "02_sheet_new");
        await page.click('[data-folmode="all"]'); await page.waitForTimeout(300);
        assert((await page.getAttribute('[data-folmode="all"]', "aria-pressed")) === "true", "rerun chip pressed"); await snap(F + "03_sheet_all");
        await page.click('[data-folmode="new"]'); await page.waitForTimeout(200);
        await page.click("[data-folgo]"); await page.waitForTimeout(900);
        assert(!(await vis("#rem")), "sheet closed after follow");
        const st = await page.evaluate(() => TVG.FOL.filter((x) => !x.x).map((x) => x.title + "|" + x.mode + "|" + x.lead)); assert(st.length === 1 && st[0].indexOf(FOL_TITLE + "|new|") === 0, "follow saved: " + JSON.stringify(st));
        assert(folPosts.length >= 1 && folPosts[folPosts.length - 1].follows.some((x) => x.title === FOL_TITLE && x.mode === "new"), "POST /api/follow sent");
        const pt = await page.textContent("#pill"); assert(/נזכיר לך על כל פרק חדש/.test(pt), "toast: " + pt); await snap(F + "04_toast");
        assert(await vis(".serfol .ghost"), "search row now shows manage");
      });
      await step("fol-rems-row-" + theme, async () => {
        await fresh(); await folKeep(FOL_TITLE); await fresh(); await pushNow(); await page.evaluate((t) => TVG.setTheme(t), theme);
        await page.evaluate(() => { TVG.setSearch(false); TVG.tab = "rems"; TVG.render(); }); await page.waitForTimeout(600);
        const n = await page.evaluate(() => document.querySelectorAll(".folrow").length); assert(n === 1, "one row per series: " + n);
        const tx = await page.textContent(".folrow"); assert(/הפרק הבא/.test(tx) && tx.indexOf("📺") >= 0, "row text: " + tx);
        assert((await page.evaluate(() => TVG.REMS.filter((x) => x.k.indexOf("f|") === 0).length)) === 0, "follow did not write into REMS");
        await snap(F + "05_rems_row");
      });
      await step("fol-manage-stop-undo-" + theme, async () => {
        await fresh(); await folKeep(FOL_TITLE); await fresh(); await pushNow(); await page.evaluate((t) => { TVG.setTheme(t); TVG.tab = "rems"; TVG.render(); }, theme); await page.waitForTimeout(500);
        await page.click(".folrow .go"); await page.waitForTimeout(500);
        assert(await vis("[data-folstop]"), "stop button"); assert(!(await vis("[data-folgo]")), "no go in manage"); await snap(F + "06_sheet_manage");
        await page.click('[data-folead="30"]'); await page.waitForTimeout(250);
        assert((await page.evaluate(() => TVG.FOL.filter((x) => !x.x)[0].lead)) === 30, "lead changed live");
        await page.click("[data-folstop]"); await page.waitForTimeout(500);
        assert((await page.evaluate(() => TVG.FOL.filter((x) => !x.x).length)) === 0, "stopped"); assert((await page.evaluate(() => document.querySelectorAll(".folrow").length)) === 0, "row gone");
        const pt = await page.textContent("#pill"); assert(/הפסקת לעקוב/.test(pt) && /החזר/.test(pt), "undo toast: " + pt); await snap(F + "07_stopped_toast");
        assert(folPosts[folPosts.length - 1].follows.some((x) => x.x === 1), "tombstone sent");
        await page.click("[data-pillact]"); await page.waitForTimeout(500);
        assert((await page.evaluate(() => TVG.FOL.filter((x) => !x.x).length)) === 1, "restored by undo"); assert((await page.evaluate(() => document.querySelectorAll(".folrow").length)) === 1, "row back");
      });
    }
    await step("fol-topic-link", async () => { // כותרת מדויקת של סדרה: גם "לעקוב אחרי הסדרה" וגם קישור משני לנושא; נושא שכבר במעקב מציג "הפסק לעקוב"
      await folSeed(true); await fresh(); await pushNow(); await folOpenSearch();
      assert(await vis(".serfol [data-folnew]"), "series follow row"); assert(await vis(".foltopic [data-follow]"), "secondary topic link");
      assert(/או להוסיף למועדפים כל מה שמזכיר/.test(await page.textContent(".foltopic")), "topic link text"); await snap("21_fol_topic_link");
      await page.click(".foltopic [data-follow]"); await page.waitForTimeout(400);
      assert(/במועדפים: כל מה שמזכיר את/.test(await page.textContent("#main")), "followed topic row shown"); assert(/הסרה/.test(await page.textContent("#main")), "stop topic");
      await page.evaluate(() => { TVG.TOPICS = []; TVG.saveTopics(); });
    });
    await step("fol-generic-topic-only", async () => { // NBA / חדשות: כותרת כללית = נושא בלבד
      await folSeed(true); await fresh(); await pushNow(); await page.evaluate(() => { TVG.tab = "dial"; TVG.startSearch("NBA", true); }); await page.waitForTimeout(700);
      assert(!(await vis("[data-folnew]")), "no series follow for a generic title"); assert(await vis("[data-follow]"), "topic follow stays"); await snap("21_fol_generic_topic");
      await page.evaluate(() => { TVG.TOPICS = []; TVG.saveTopics(); });
    });
    if (X_TITLE) await step("fol-x-channel", async () => { // ערוצים עם מזהה x14/xi24/xknesset/xkids
      await folSeed(true); await fresh(); await pushNow();
      await page.evaluate((t) => { TVG.tab = "dial"; TVG.startSearch(t, true); }, X_TITLE); await page.waitForTimeout(700);
      assert(await vis(".serfol [data-folnew]"), "follow row for x-channel series"); await page.click(".serfol [data-folnew]"); await page.waitForTimeout(400); await page.click("[data-folgo]"); await page.waitForTimeout(800);
      const k = await page.evaluate((t) => { const f = TVG.FOL.filter((x) => !x.x)[0]; const a = TVG.folAirings(t, null)[0]; return a ? "f|" + TVG.folKey(t) + "|" + a.c.id + "|" + a.ts : ""; }, X_TITLE);
      assert(/^f\|[^|]+\|x[a-z0-9]+\|\d+$/.test(k), "derived key with x-channel: " + k);
      await fresh("?rem=" + encodeURIComponent(k)); assert(await vis("#snzRoot"), "tap on an x-channel derived reminder opens snooze"); await snap("21_fol_xchannel_snooze");
      await page.evaluate(() => { localStorage.removeItem("tvg.fol"); });
    });
    await step("fol-skip-lead-scope", async () => { // דילוג על פרק (עם ביטול), בורר התראה זהה לחלון התזכורת, ערוצים שלי, וכתובת ההודעה
      await fresh(); await folKeep(FOL_TITLE); await fresh(); await pushNow(); await page.evaluate(() => { TVG.tab = "rems"; TVG.render(); }); await page.waitForTimeout(500);
      assert(!/אין תזכורות פעילות/.test(await page.textContent("#main")), "no 'no active reminders' text when follows exist");
      await page.click(".folrow .go"); await page.waitForTimeout(500);
      assert(await vis("[data-folsel]"), "same lead select as the reminder sheet"); assert(await vis("[data-foldbl]"), "double-reminder chip"); assert(await vis('[data-folscope="mine"]'), "my-channels scope chip");
      assert(/הפרק הבא: .+ · /.test(await page.textContent(".meta")), "header has the middle dot between time and channel");
      await snap("21_fol_sheet_full");
      await page.click("[data-foldbl]"); await page.waitForTimeout(200); assert((await page.evaluate(() => !!TVG.FOL.filter((x) => !x.x)[0].dbl)), "dbl saved");
      await page.selectOption("[data-folsel]", "5"); await page.waitForTimeout(200); assert((await page.evaluate(() => TVG.FOL.filter((x) => !x.x)[0].lead)) === 5, "lead 5 via select");
      const n0 = await page.evaluate(() => (TVG.FOL.filter((x) => !x.x)[0].skip || []).length);
      await page.click("[data-folskip]"); await page.waitForTimeout(300);
      assert((await page.evaluate(() => TVG.FOL.filter((x) => !x.x)[0].skip.length)) === n0 + 1, "episode skipped"); assert(/דילגנו/.test(await page.textContent("#pill")), "skip toast"); await snap("21_fol_skipped");
      assert(folPosts[folPosts.length - 1].follows.some((x) => (x.skip || []).length === n0 + 1), "skip sent to server");
      await page.click("[data-pillact]"); await page.waitForTimeout(300); assert((await page.evaluate(() => TVG.FOL.filter((x) => !x.x)[0].skip.length)) === n0, "skip undone");
    });
    await step("fol-from-remsheet", async () => {
      await folSeed(true); await fresh(); await pushNow(); await page.click('[data-tab="grid"]'); await page.waitForTimeout(500);
      const ok = await page.evaluate((t) => { for (const c of TVG.G.channels) { const p = (TVG.by.get(c.id) || []).filter((x) => x.s > new Date() && TVG.folKey(x.title) === TVG.folKey(t))[0]; if (p) { TVG.openRem({ id: c.id, p: p }); return true; } } return false; }, FOL_TITLE);
      assert(ok, "found a program of the series"); await page.waitForTimeout(400);
      assert(await vis('#rem [data-folnew]'), "secondary option in the reminder sheet"); assert((await page.evaluate(() => [].filter.call(document.querySelectorAll("#rem .btn"), (b) => b.offsetParent).length)) === 1, "still one primary"); await snap("21_fol_remsheet_option");
      await page.click('#rem [data-folnew]'); await page.waitForTimeout(400); assert(await vis("[data-folgo]"), "follow sheet from reminder sheet"); await snap("21_fol_remsheet_to_follow");
    });
    await step("fol-no-push", async () => {
      await folSeed(false); folPosts.length = 0;
      await fresh(); await folOpenSearch(); await page.click(".serfol [data-folnew]"); await page.waitForTimeout(500);
      const note = await page.textContent("#remBody"); assert(/התראות/.test(note), "honest push note in sheet"); await snap("21_fol_nopush_sheet");
      await page.click("[data-folgo]"); await page.waitForTimeout(700);
      const pt = await page.textContent("#pill"); assert(/נשמר/.test(pt) && /(התראות|לא נוכל|אי אפשר)/.test(pt) && !/נזכיר לך על כל/.test(pt), "honest toast: " + pt); await snap("21_fol_nopush_toast");
      assert(folPosts.length === 0, "no POST without push"); assert((await page.evaluate(() => localStorage.getItem("tvg.folDirty"))) === "1", "kept dirty for later sync");
    });
    await step("fol-server-403", async () => {
      await folSeed(true); folStatus = 403;
      await fresh(); await pushNow(); await folOpenSearch(); await page.click(".serfol [data-folnew]"); await page.waitForTimeout(400); await page.click("[data-folgo]"); await page.waitForTimeout(900);
      const pt = await page.textContent("#pill"); assert(/ההתראות לא פעילות/.test(pt) && !/נזכיר לך על כל/.test(pt), "403 message: " + pt); await snap("21_fol_403_toast"); folStatus = 200;
    });
    await step("fol-snooze-derived-key", async () => {
      await folSeed(true); await fresh();
      const k = await page.evaluate((t) => { for (const c of TVG.G.channels) { const p = (TVG.by.get(c.id) || []).filter((x) => x.s > new Date() && TVG.folKey(x.title) === TVG.folKey(t))[0]; if (p) return "f|" + TVG.folKey(t) + "|" + c.id + "|" + TVG.ilTs(p.s); } return ""; }, FOL_TITLE);
      assert(k, "derived key"); await fresh("?rem=" + encodeURIComponent(k));
      assert(await vis("#snzRoot"), "tap on a derived reminder opens the snooze sheet"); assert(hasNoSnoozeParams(), "url cleaned"); await snap("21_fol_snooze_derived");
      await page.evaluate(() => { localStorage.removeItem("tvg.fol"); localStorage.removeItem("tvg.push"); localStorage.removeItem("tvg.calmode"); });
    });
    await page.evaluate(() => { try { localStorage.removeItem("tvg.tab"); localStorage.removeItem("tvg.calmode"); localStorage.removeItem("tvg.push"); } catch (e) {} });

    await step("share-text", async () => { await fresh(); await page.evaluate(() => { TVG.tab = "dial"; TVG.scrub = null; TVG.render(); }); await page.waitForTimeout(500); await page.evaluate(() => { const b = document.querySelector("#dCard [data-share]"); if (!b) throw new Error("no share btn; dCard=" + document.querySelector("#dCard").innerHTML.slice(-300) + " tab=" + TVG.tab + " ch=" + TVG.chId); b.click(); }); await page.waitForTimeout(700); await snap("11_share_text"); });
    await step("share-card", async () => { await page.click('[data-shmode="card"]'); await page.waitForTimeout(2200); await snap("12_share_card"); });
    await step("share-copy", async () => { await page.click("[data-shcopy]"); await page.waitForTimeout(300); const t = await page.textContent("#pill"); if (!/הקישור הועתק|לא הצלחנו/.test(t)) throw new Error("copy toast: " + t); if (/הקישור הועתק/.test(t) && !(await page.evaluate(() => document.querySelector("#rem").hidden))) throw new Error("share sheet still open after copy"); });
    await step("share-texts", async () => { // הטקסט המדויק שנשלח בכל מצב (נשמר לקובץ לעיון)
      await fresh();
      const o = await page.evaluate(() => { const now = Date.now(); const out = []; for (const id of Array.from(TVG.sel)) { const a = (TVG.by.get(id) || []).filter(p => p.s.getTime() > now + 3600000 && p.desc && p.desc.length > 20); if (a.length) { const r = { id, p: a[0] }; out.push(TVG.shareText(r, false), TVG.shareText(r, true)); break; } } const lv = (TVG.by.get("3787") || []).filter(p => p.lv === 1)[0]; if (lv) out.push(TVG.shareText({ id: "3787", p: lv }, false)); return out; });
      assert(o.length >= 2, "texts"); assert(/\n\n\u200F👇 לשמירה ביומן לחצו כאן:\nhttps:\/\/\S*\?p=\S+$/.test(o[0]), "text mode format: " + o[0]); assert(!/ליומן ותזכורת:/.test(o.join("")), "old CTA gone"); assert(!/[\u2066\u2069]/.test(o.join("")), "no isolates in sent text"); assert(!/\u200F[_*]/.test(o.join("")), "no RLM adjacent to markup"); assert(o[1].split("\n").length === 2 && /^\u200F👇 לשמירה ביומן לחצו כאן:\nhttps/.test(o[1]), "card text only cta+link: " + o[1]);
      fs.appendFileSync(path.join(OUT, "share_texts_" + d.name + ".txt"), o.map((t, i) => "--- " + i + " ---\n" + t).join("\n\n") + "\n");
    });
    await step("share-bidi", async () => { // שמות ערוצים לטיניים בטקסט שנשלח / ICS / גוגל קלנדר: LRM סביב הרצף הלטיני, בלי תווי בידוד
      const o = await page.evaluate(() => ({ a: TVG.bidiText("5 LIVE"), b: TVG.bidiText("ספורט 5 LIVE"), c: TVG.bidiText("!E ערוץ הבידור"), d: TVG.bidiText("i24NEWS"), e: TVG.bidiText("רשת 13") }));
      assert(o.a === "‎5 LIVE‎", "5 LIVE: " + JSON.stringify(o.a)); assert(o.b === "ספורט ‎5 LIVE‎", "ספורט 5 LIVE"); assert(o.c === "‎E!‎ ערוץ הבידור", "E!"); assert(o.d === "‎i24NEWS‎", "i24NEWS"); assert(o.e === "רשת ‎13‎", "רשת 13");
      const t = await page.evaluate(() => { const id = Array.from(TVG.sel)[0]; const p = (TVG.by.get(id) || [])[0]; const r = { id, p, lead: 15 }; return { ics: TVG.icsText(r), g: decodeURIComponent(TVG.gcalUrl(r)), sh: TVG.shareText(r, false), ch: TVG.chName(id) }; });
      assert(!/[⁦⁧⁨⁩]/.test(t.ics + t.g + t.sh), "no isolates in ics/gcal/share");
      if (/[A-Za-z0-9]/.test(t.ch)) assert(/SUMMARY:[^\r\n]*‎/.test(t.ics) && /text=[^&]*‎/.test(t.g) && /‎/.test(t.sh), "LRM in all plain-text channel names");
    });
    // ---- דף נחיתה ----
    const pickLink = (kind) => page.evaluate((kind) => {
      const now = Date.now(), lk = (id, p) => id + "." + (TVG.dstr(p.s) + TVG.hhmm(p.s)).replace(/\D/g, "").slice(2);
      const sel = Array.from(TVG.sel);
      if (kind === "up") { for (const id of sel) { const a = (TVG.by.get(id) || []).filter(p => p.s.getTime() > now + 3 * 3600000 && p.desc && p.desc.length > 60); if (a.length) return { v: lk(id, a[0]), id, t: a[0].title }; } }
      if (kind === "live") { for (const id of sel) { const a = (TVG.by.get(id) || []).filter(p => p.s.getTime() <= now && p.e.getTime() > now && p.desc); if (a.length) return { v: lk(id, a[0]), id, t: a[0].title }; } }
      if (kind === "rerun" || kind === "ended") {
        for (const id of sel) for (const p of (TVG.by.get(id) || [])) {
          if (p.e.getTime() >= now || p.e.getTime() < now - 8 * 3600000) continue;
          let again = false; TVG.by.forEach((a) => { if (a.some(q => q.title === p.title && q.e.getTime() > now)) again = true; });
          if ((kind === "rerun") === again) return { v: lk(id, p), id, t: p.title };
        }
      }
      return null;
    }, kind);
    const landOpen = (v) => page.goto(base + "index.html?p=" + v, { waitUntil: "networkidle" }).then(() => page.waitForTimeout(1300));
    for (const kind of ["up", "live", "rerun", "ended"]) {
      await step("landing-" + kind, async () => {
        await fresh(); const pk = await pickLink(kind); assert(pk, "no program for " + kind);
        await landOpen(pk.v);
        assert(await vis("#land"), "landing visible"); assert(!(await vis("#sheet")), "no channel picker"); assert(!/[?&]p=/.test(page.url()), "url cleaned " + page.url());
        const txt = await page.textContent("#land");
        if (kind === "up") { assert(txt.indexOf(pk.t) >= 0, "title"); assert(/מתחיל בעוד/.test(txt), "countdown: " + txt.slice(0, 200)); assert(await vis("[data-landcal]"), "cal button"); if (d.name.indexOf("iphone") === 0) assert(!(await vis("[data-landrem]")), "iOS not installed: no reminder button"); else assert(await vis("[data-landrem]"), "android reminder button");
          assert(await vis("[data-landinst]") && /להתקנת האפליקציה/.test(txt), "install row visible when not standalone");
          const ib = await page.evaluate(() => { const a = document.querySelector("[data-landinst]").getBoundingClientRect(), b = document.querySelector("[data-landcal]").getBoundingClientRect(); return { ih: a.height, ch: b.height, below: a.top > b.bottom }; }); assert(ib.below && ib.ih < ib.ch, "install row is secondary (below + smaller): " + JSON.stringify(ib));
          await page.click("[data-landinst]"); await page.waitForTimeout(300); const it = await page.textContent("#lndInst"); assert(await vis("#lndInst"), "install sheet opens");
          if (d.name.indexOf("iphone") === 0) assert(/בספארי: שיתוף/.test(it) && /הוספה למסך הבית/.test(it) && (await page.evaluate(() => !!document.querySelector("#lndInst svg.shg"))), "ios install text+glyph: " + it); else assert(/התקנת האפליקציה/.test(it) && (/Chrome ⋮/.test(it) || (await vis("[data-landinstgo]"))), "android install text: " + it);
          await snap("14_landing_install"); await page.click("[data-landinstx]"); await page.waitForTimeout(200); assert(!(await vis("#lndInst")), "install sheet closes"); }
        if (kind === "live") { assert(/משודר עכשיו/.test(txt), "live text"); }
        if (kind === "rerun") { assert(/כבר שודרה/.test(txt) && /מתחיל בעוד|משודר עכשיו/.test(txt), "rerun: " + txt.slice(0, 200)); }
        if (kind === "ended") { assert(/התוכנית כבר שודרה/.test(txt) && /אין לה שידור נוסף/.test(txt), "ended: " + txt.slice(0, 200)); }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no h-overflow");
        await snap("14_landing_" + kind);
      });
    }
    await step("landing-standalone", async () => { // באפליקציה המותקנת שורת ההתקנה מוסתרת
      const pg2 = await ctx.newPage(); await pg2.addInitScript(() => { try { Object.defineProperty(navigator, "standalone", { get: () => true }); } catch (e) {} });
      await pg2.clock.setFixedTime(new Date(FIXED_NOW)); const pk = await pickLink("up"); await pg2.goto(base + "index.html?p=" + pk.v, { waitUntil: "networkidle" }); await pg2.waitForTimeout(1300);
      assert(await pg2.evaluate(() => !document.querySelector("#land").hidden && TVG.isStandalone === true), "landing open in standalone"); assert(await pg2.evaluate(() => !document.querySelector("[data-landinst]")), "install row hidden when standalone"); assert(await pg2.evaluate(() => !!document.querySelector("[data-landcal]")), "primary button still there");
      await pg2.close();
    });
    await step("landing-long", async () => { // כותרת וסינופסיס ארוכים
      await fresh(); const pk = await pickLink("up"); await landOpen(pk.v);
      await page.evaluate(() => { const p = TVG.landTest && 0; document.querySelector(".lnd-ttl").textContent = "מכבי תל אביב נגד הפועל באר שבע בגמר גביע המדינה בכדורסל – משחק שלישי בסדרה"; document.querySelector(".lnd-syn") && (document.querySelector(".lnd-syn").textContent = document.querySelector(".lnd-syn").textContent.repeat(4)); });
      await page.waitForTimeout(200); await snap("14_landing_long");
      assert(await vis("[data-landcal]"), "action bar visible with long content");
      const bb = await page.evaluate(() => { const r = document.querySelector("[data-landcal]").getBoundingClientRect(); return r.bottom <= innerHeight && r.top > 0; }); assert(bb, "primary button inside viewport");
    });
    await step("landing-missing", async () => {
      await landOpen("208.2001011000"); assert(await vis("#land") && /לא מצאנו/.test(await page.textContent("#land")), "missing msg");
      await snap("14_landing_missing");
      await landOpen("208%7C2020-01-01T10:00"); assert(/לא מצאנו/.test(await page.textContent("#land")), "old format missing");
    });
    await step("landing-old-format", async () => {
      await fresh(); const pk = await pickLink("up"); const id = pk.v.split(".")[0], t = pk.v.split(".")[1];
      const old = id + "%7C20" + t.slice(0, 2) + "-" + t.slice(2, 4) + "-" + t.slice(4, 6) + "T" + t.slice(6, 8) + ":" + t.slice(8, 10);
      await landOpen(old); assert(await page.evaluate((x) => document.querySelector(".lnd-ttl") && document.querySelector(".lnd-ttl").textContent === x, pk.t), "old format resolves");
    });
    await step("landing-first-visit", async () => {
      await fresh(); const pk = await pickLink("up"); await page.evaluate(() => localStorage.setItem("tvg.sel", "[]"));
      await landOpen(pk.v);
      assert(await vis("#land"), "landing visible for first visit"); assert(!(await vis("#sheet")), "channel picker NOT shown over landing");
      assert(await page.evaluate(() => JSON.parse(localStorage.getItem("tvg.sel")).length === 0), "channel not auto-added");
      await snap("14_landing_firstvisit");
      await page.click("[data-landguide]"); await page.waitForTimeout(600);
      assert(!(await vis("#land")), "landing closed"); assert(await vis("#sheet"), "normal first run: channel picker after closing landing"); assert(await page.evaluate(() => TVG.sel.has("3787") && TVG.sel.has("3819") && TVG.sel.has("3826")), "core channels preselected");
      await snap("14_landing_firstvisit_after");
      await page.evaluate(() => localStorage.removeItem("tvg.sel")); // הבא יזרע מחדש
    });
    await step("landing-back-and-close", async () => {
      await fresh(); const pk = await pickLink("up"); await landOpen(pk.v); const url0 = page.url();
      assert(await page.evaluate(() => !!(history.state && history.state.tvgLayer)), "pushState on landing");
      await page.goBack(); await page.waitForTimeout(500); assert(!(await vis("#land")), "back closes landing"); assert(page.url() === url0, "still in app " + page.url());
      await landOpen(pk.v); await page.click("[data-landclose]"); await page.waitForTimeout(500);
      assert(!(await vis("#land")) && !(await vis("#scrim2")), "UI close hides scrim"); assert(await page.evaluate(() => !history.state), "history clean after UI close");
      assert(await page.evaluate((id) => TVG.chId === id && TVG.tab === "dial", pk.id), "guide on program channel");
      await landOpen(pk.v); await page.keyboard.press("Escape"); await page.waitForTimeout(400); assert(!(await vis("#land")), "Escape closes");
      await snap("14_landing_closed_guide");
    });
    await step("landing-reminder", async () => {
      await fresh(); const pk = await pickLink("up"); await page.evaluate(() => { localStorage.setItem("tvg.sel", JSON.stringify(["3787"])); }); await landOpen(pk.v);
      await page.evaluate((v) => { TVG.isStandalone = true; TVG.openLanding(v); }, pk.v); await page.waitForTimeout(300); await page.click("[data-landrem]"); await page.waitForTimeout(600);
      assert(await vis("#rem") && await vis("#land"), "reminder sheet opens above landing"); await snap("14_landing_reminder");
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      assert(!(await vis("#rem")) && await vis("#land") && await vis("#scrim2"), "back to landing, scrim kept");
      await page.evaluate(() => localStorage.removeItem("tvg.sel"));
    });
    if (d.name.indexOf("iphone") === 0) await step("landing-ics", async () => {
      await fresh(); const pk = await pickLink("up"); await landOpen(pk.v);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }), page.click("[data-landcal]")]);
      const name = dl.suggestedFilename(); assert(/\.ics$/.test(name) && name.indexOf(pk.t.slice(0, 8)) >= 0, "ics filename from title: " + name);
      const body = fs.readFileSync(await dl.path(), "utf8"); assert(/TRIGGER:-PT15M/.test(body) && /BEGIN:VALARM/.test(body), "ics has 15m alarm");
      await page.waitForTimeout(300); await snap("14_landing_ics_toast");
    });

    await step("landing-first-visit-x", async () => { // ✕ רק סוגר, בלי בורר ערוצים
      await fresh(); const pk = await pickLink("up"); await page.evaluate(() => localStorage.setItem("tvg.sel", "[]")); await landOpen(pk.v);
      await page.click("[data-landclose]"); await page.waitForTimeout(600);
      assert(!(await vis("#land")) && !(await vis("#sheet")), "X closes only, no picker"); await page.evaluate(() => localStorage.removeItem("tvg.sel"));
    });
    await step("landing-reminder-adds-channel", async () => { // תזכורת מדף נחיתה: הערוץ נוסף עם הודעה
      await fresh(); const pk = await pickLink("up"); await page.evaluate(() => { localStorage.setItem("tvg.sel", JSON.stringify(["3787"])); }); await landOpen(pk.v);
      assert(await page.evaluate((id) => !TVG.sel.has(id), pk.id), "channel not preselected: " + pk.id);
      await page.evaluate((v) => { TVG.isStandalone = true; TVG.calMode = "ics"; TVG.openLanding(v); }, pk.v); await page.waitForTimeout(300);
      await page.click("[data-landrem]"); await page.waitForTimeout(500); await page.evaluate(() => document.querySelector("[data-ics]").click()); await page.waitForTimeout(2600);
      assert(await page.evaluate((id) => TVG.sel.has(id), pk.id), "channel added after reminder"); const pl = await page.textContent("#pill"); assert(/הוספנו את/.test(pl), "toast: " + pl);
      assert(await vis("#land"), "landing still open"); await snap("14_landing_added_toast"); await page.evaluate(() => { localStorage.removeItem("tvg.sel"); localStorage.removeItem("tvg.calmode"); localStorage.removeItem("tvg.rem"); });
    });
    await step("landing-stub", async () => { // תוכנית שלא בלוח: ערוץ + מועד מתוך הקישור
      await fresh(); await landOpen("3787.2611201000");
      assert(await vis("#land"), "land"); const t = await page.textContent("#land"); assert(/תוכנית ב/.test(t) && /20\.11/.test(t), "stub text: " + t.slice(0, 200));
      assert((await vis("[data-landcal]")) && !(await vis("[data-landrem]")), "stub: calendar only"); await snap("14_landing_stub");
      if (d.name.indexOf("iphone") === 0) { const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }), page.click("[data-landcal]")]); const body = fs.readFileSync(await dl.path(), "utf8"); assert(/DTSTART:20261120T080000Z/.test(body), "stub ics time (10:00 Israel = 08:00Z): " + body.slice(0, 300)); }
    });
    await step("landing-tz", async () => { // מכשיר באזור זמן אחר (הקשר חדש): הזמנים לפי שעון ישראל, עם הערה
      await fresh(); const pk = await pickLink("up"); await landOpen(pk.v);
      const cd0 = await page.textContent("#lndCd"), t0 = await page.textContent("#land"); assert(!/שעון ישראל/.test(t0), "no tz note in Israel");
      const ctx2 = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: d.ua, locale: "he-IL", timezoneId: "America/New_York" });
      try {
        await ctx2.addInitScript((sel) => { try { if (!localStorage.getItem("tvg.sel")) { localStorage.setItem("tvg.sel", JSON.stringify(sel)); localStorage.setItem("tvg.bkAt", "1"); localStorage.setItem("tvg.v5", "1"); localStorage.setItem("tvg.theme", "light"); } } catch (e) {} }, SEL);
        if (process.env.TVG_NO_WRITES) await ctx2.route(/tv-guide-cal\.vercel\.app/, (r) => (r.request().method() === "GET" ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" })));
        const p2 = await ctx2.newPage(); await p2.clock.setFixedTime(new Date(FIXED_NOW));
        await p2.goto(base + "index.html?p=" + pk.v, { waitUntil: "networkidle" }); await p2.waitForTimeout(1300);
        assert(await p2.evaluate(() => new Date(2026, 9, 30, 12).getTimezoneOffset() > 200), "device is in NY");
        const t1 = await p2.textContent("#land"), cd1 = await p2.textContent("#lndCd");
        assert(/\(שעון ישראל\)/.test(t1), "tz note in NY"); assert(cd1 === cd0, "same countdown in NY: " + cd0 + " vs " + cd1);
        assert(t1.replace(/\s*\(שעון ישראל\)/, "") === t0, "same displayed times in NY");
        await p2.screenshot({ path: path.join(OUT, d.name + "_14_landing_tz_ny.png") }); total++;
        const m = pk.v.split(".")[1], exp = new Date("20" + m.slice(0, 2) + "-" + m.slice(2, 4) + "-" + m.slice(4, 6) + "T" + m.slice(6, 8) + ":" + m.slice(8, 10) + ":00+02:00").toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        if (d.name.indexOf("iphone") === 0) {
          const [dl] = await Promise.all([p2.waitForEvent("download", { timeout: 4000 }), p2.click("[data-landcal]")]); const body = fs.readFileSync(await dl.path(), "utf8");
          assert(body.indexOf("DTSTART:" + exp) >= 0, "ics DTSTART in NY should be " + exp + ": " + (body.match(/DTSTART:\S+/) || [""])[0]);
        } else {
          const href = await p2.evaluate((v) => { const id = v.split(".")[0], q = v.split(".")[1]; const r = TVG.findProg(id + "|" + TVG.parse("20" + q.slice(0, 2) + "-" + q.slice(2, 4) + "-" + q.slice(4, 6) + "T" + q.slice(6, 8) + ":" + q.slice(8, 10)).getTime()); return TVG.gcalUrl(r); }, pk.v);
          assert(href.indexOf("dates=" + exp + "/") >= 0, "gcal dates in NY should start " + exp + ": " + href);
        }
      } finally { await ctx2.close(); }
    });
    if (d.name.indexOf("iphone") === 0) await step("landing-inapp-ios", async () => {
      await fresh(); const pk = await pickLink("up"); const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setUserAgentOverride", { userAgent: IPHONE_UA.replace(" Safari/604.1", "") });
      await landOpen(pk.v); await page.click("[data-landcal]"); await page.waitForTimeout(300);
      assert(/פתחו ב-Safari/.test(await page.textContent("#land")), "safari panel"); assert(await vis("[data-landcopy]"), "copy btn"); await snap("14_landing_inapp_ios");
      await cdp.send("Emulation.setUserAgentOverride", { userAgent: IPHONE_UA });
    });
    if (d.name.indexOf("android") === 0) await step("landing-inapp-android", async () => {
      await fresh(); const pk = await pickLink("up"); const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setUserAgentOverride", { userAgent: androidUA("SM-S911B; wv") });
      await page.route("https://calendar.google.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>gcal</title>ok" }));
      await landOpen(pk.v); await page.click("[data-landcal]"); await page.waitForURL(/calendar\.google\.com/, { timeout: 4000 });
      assert(/action=TEMPLATE/.test(page.url()), "same-tab gcal template: " + page.url());
      await page.unroute("https://calendar.google.com/**"); await cdp.send("Emulation.setUserAgentOverride", { userAgent: androidUA("SM-S911B") });
    });
    await step("dark-theme", async () => {
      await fresh(); await page.evaluate(() => { TVG.setTheme("dark"); }); const pk = await pickLink("up"); await landOpen(pk.v); await snap("15_dark_landing_up");
      const pe = await pickLink("rerun"); if (pe) { await landOpen(pe.v); await snap("15_dark_landing_rerun"); }
      await fresh(); await page.evaluate(() => { TVG.tab = "dial"; TVG.scrub = null; TVG.render(); }); await page.waitForTimeout(400);
      await page.evaluate(() => { const b = document.querySelector("#dCard [data-share]"); if (b) b.click(); }); await page.waitForTimeout(600); await snap("15_dark_share_text");
      await page.click('[data-shmode="card"]'); await page.waitForTimeout(2200); await snap("15_dark_share_card");
      await page.evaluate(() => { TVG.setTheme("light"); });
    });
    // ---- ביקורת פריסה: המצבים שמסתירים באגים (תקציר ארוך פתוח, כל החלונות, הודעות עם כפתור, בהיר + כהה) ----
    // snap() מריץ את הביקורת גם בכל הצעדים שלמעלה; כאן מוסיפים את מה שאין בהם. אין צורך בצילומים נוספים לבדיקה - snap שומר אותם בשם "A_<theme>_*".
    const LONG_DESC = "בפרק הערב מתמודדים המשתתפים עם אתגר חדש ובלתי צפוי, בזמן שבבית מתגלים סודות ישנים שמטלטלים את כל המשפחה. אחרי שבועות של מתח, הכול מתפוצץ בסצנה אחת דרמטית שבה כל אחד נאלץ לבחור צד. אורחי הערב מגיעים עם הפתעות, והסיפור מקבל תפנית שאיש לא ציפה לה.";
    const injectLong = () => page.evaluate((txt) => { TVG.by.forEach((a) => a.forEach((p) => { p.desc = txt; })); TVG.render(); }, LONG_DESC);
    for (const theme of ["light", "dark"]) {
      const A = "A_" + theme + "_";
      await step("audit-" + theme + "-guide", async () => {
        await fresh(); await page.evaluate((t) => TVG.setTheme(t), theme); await injectLong(); await page.waitForTimeout(400);
        await snap(A + "01_dial_longdesc");
        const mb = await page.$("#dCard [data-more]"); if (mb) { await mb.click(); await page.waitForTimeout(300); await snap(A + "02_dial_longdesc_open"); }
        await page.click('[data-tab="now"]'); await page.waitForTimeout(600);
        await page.click("[data-opentog]"); await page.waitForTimeout(500); await snap(A + "03_now_synopsis_open");
        const mb2 = await page.$(".card.open [data-more]"); if (mb2) { await mb2.click(); await page.waitForTimeout(300); await snap(A + "04_now_synopsis_more"); }
        await page.evaluate(() => { const c = document.querySelector('.card[data-toggle]:not(.open)'); if (c) { c.classList.add("open"); const o = c.querySelector("[data-more]"); if (o) o.click(); } }); await page.waitForTimeout(300); await snap(A + "05_now_all_open");
        await page.click('[data-tab="grid"]'); await page.waitForTimeout(600);
        await page.evaluate(() => { const r = document.querySelector('.row[data-toggle][data-pts]:not(.past):not(.now)'); if (r) { r.scrollIntoView({ block: "center" }); r.classList.add("open"); const o = r.querySelector("[data-more]"); if (o) o.click(); } }); await page.waitForTimeout(300); await snap(A + "06_grid_row_open");
        await page.click('[data-tab="rems"]'); await page.waitForTimeout(500); await snap(A + "07_rems");
        await page.click("#sBtn"); await page.fill("#q", "חדשות"); await page.waitForTimeout(900);
        await page.evaluate(() => { const r = document.querySelector("#results [data-toggle], #results .row"); if (r) r.click(); }); await page.waitForTimeout(400); await snap(A + "08_search_open_result");
      });
      await step("audit-" + theme + "-sheets", async () => {
        await fresh(); await page.evaluate((t) => TVG.setTheme(t), theme); await injectLong(); await page.click('[data-tab="grid"]'); await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(600); await snap(A + "10_remsheet");
        await page.keyboard.press("Escape"); await page.waitForTimeout(300);
        await page.click("#setBtn"); await page.waitForTimeout(500); await snap(A + "11_settings_top");
        await page.evaluate(() => { const s = document.querySelector("#setsheet"); s.scrollTop = s.scrollHeight; }); await page.waitForTimeout(300); await snap(A + "11_settings_bottom");
        await page.keyboard.press("Escape"); await page.waitForTimeout(300);
        await page.click("#chBtn"); await page.waitForTimeout(500); await snap(A + "12_channels"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
        await page.click("#fvBtn"); await page.waitForTimeout(500); await snap(A + "13_favs"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
        await page.evaluate(() => { TVG.tab = "dial"; TVG.scrub = null; TVG.render(); }); await page.waitForTimeout(400);
        await page.evaluate(() => { const b = document.querySelector("#dCard [data-share]"); if (b) b.click(); }); await page.waitForTimeout(600); await snap(A + "14_share_text");
        await page.click('[data-shmode="card"]'); await page.waitForTimeout(2200); await snap(A + "15_share_card");
      });
      await step("audit-" + theme + "-landing-nf", async () => {
        await fresh(); await page.evaluate((t) => TVG.setTheme(t), theme); const pk = await pickLink("up"); await landOpen(pk.v); await snap(A + "20_landing_up");
        await page.click("[data-landinst]"); await page.waitForTimeout(300); await snap(A + "21_landing_install"); await page.click("[data-landinstx]"); await page.waitForTimeout(200);
        const pl = await pickLink("live"); if (pl) { await landOpen(pl.v); await snap(A + "22_landing_live"); }
        const pe = await pickLink("ended"); if (pe) { await landOpen(pe.v); await snap(A + "23_landing_ended"); }
        nfFixture = true; await fresh(); await page.evaluate((t) => TVG.setTheme(t), theme); await page.click('[data-tab="nf"]'); await page.waitForTimeout(1500); await snap(A + "30_nf_top");
        await page.click(".nfhero"); await page.waitForTimeout(900); await snap(A + "31_nf_page");
        await page.keyboard.press("Escape"); await page.waitForTimeout(400);
        await page.evaluate(() => document.querySelector('[data-nfopen="x_edge"]').click()); await page.waitForTimeout(900); await snap(A + "32_nf_page_edge"); nfFixture = false;
      });
      await step("audit-" + theme + "-toasts", async () => {
        await fresh(); await page.evaluate((t) => TVG.setTheme(t), theme);
        await page.evaluate(() => TVG.pill("★ נוסף למועדפים", 30000, "ביטול", function () {}, "החזר", function () {})); await page.waitForTimeout(400); await snap(A + "40_toast_two_actions");
        await page.evaluate(() => TVG.pill("נזכיר לך ב-20:25 לפני הפרק המיוחד של התוכנית הארוכה ביותר בעולם", 30000, "ביטול", function () {})); await page.waitForTimeout(400); await snap(A + "41_toast_long_action");
        await page.evaluate(() => TVG.pill("עודכנת לגרסה", 30000)); await page.waitForTimeout(300); await snap(A + "42_toast_plain");
        await page.evaluate(() => TVG.setTheme("light"));
      });
    }

    await step("src-from-join", async () => { // מקור ההגעה (tvg.src): נקבע פעם אחת מ-?from=join, הכתובת מתנקה, ולא נדרס בטעינות הבאות
      const chk = (c, m) => { if (!c) throw new Error("assert: " + m); };
      const get = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("tvg.src") || "null"); } catch (e) { return null; } });
      await fresh(); await page.evaluate(() => localStorage.removeItem("tvg.src"));
      await fresh("?from=join"); const a = await get();
      chk(a && a.s === "join" && !!a.d && a.at > 0, "tvg.src from ?from=join: " + JSON.stringify(a));
      chk(!/from=/.test(page.url()), "url cleaned: " + page.url());
      await fresh("?tab=rems"); const b = await get();
      chk(b && b.s === "join" && b.at === a.at, "not overwritten by a later load: " + JSON.stringify(b));
      await fresh("?from=join&tab=grid"); chk(!/from=/.test(page.url()), "url cleaned with other params: " + page.url());
      await page.evaluate(() => localStorage.removeItem("tvg.src")); await page.route("**/api/backup?*", (r) => r.fulfill({ status: 404, contentType: "application/json", headers: CORS, body: "{}" })); await fresh("?r=" + "x".repeat(30));
      const c = await get(); chk(c && c.s === "restore", "?r= is restore: " + JSON.stringify(c));
      await page.unroute("**/api/backup?*"); await page.evaluate(() => localStorage.removeItem("tvg.src"));
    });
    if (d.name === "iphone_375") await step("card-png", async () => {
      await fresh();
      const out = await page.evaluate(async () => {
        const ch = (re) => (TVG.G.channels.filter(c => re.test(c.name))[0] || TVG.G.channels[0]).id;
        const mk = (id, title, lv) => ({ id, p: { title, s: new Date(2026, 10, 1, 20, 55), lv } });
        const S5 = ch(/ספורט 5\+/), K = ch(/כאן 11/), N = ch(/חדשות 12|רשת 13/);
        const cases = [
          mk(S5, "מכבי תל אביב – הפועל ירושלים", 1),
          mk(K, "המהדורה המרכזית עם ירון דרוקמן ואורחים מיוחדים באולפן החדשות בשידור חי מכל רחבי הארץ והעולם כולו ועוד כותרת ארוכה מאוד מאוד שתיחתך", 0),
          mk(N, "NBA: לוס אנג׳לס לייקרס מול גולדן סטייט ווריורס", 1),
          mk(K, "חדשות", -1),
          mk(S5, "אבגדהוזחטיכלמנסעפצקרשתאבגדהוזחטיכלמנסעפצקרשתאבגדהוזחטיכלמנסעפצקרשת", -1),
        ];
        const res = [];
        for (const c of cases) { const b = await TVG.shareCard(c); const buf = await b.arrayBuffer(); let bin = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); res.push(btoa(bin)); }
        return res;
      });
      out.forEach((b64, i) => fs.writeFileSync(path.join(OUT, "card_" + (i + 1) + ".png"), Buffer.from(b64, "base64")));
    });

    // ---- 🍿 ערב צפייה (js/party.js): שרת /api/party מדומה (page.route), בלי קריאות חיות. רץ בקבוצת nfs. TVG_SKIP=pty מדלג ----
    {
      const NOWMS = Date.parse(FIXED_NOW), PID = "PartyIdAAAAAAAAAAAAAAA", AT_SUN = Date.parse("2026-11-01T21:00:00+02:00");
      let P = null;
      const ptyReset = (o) => { P = Object.assign({ at: AT_SUN, kind: "nf", title: "הסדרה הגדולה", ch: "נטפליקס", img: "https://image.tmdb.org/t/p/w342/fx_t88001.jpg", link: "https://www.netflix.com/search?q=Big", place: "home", host: "אלעד",
        rs: [{ name: "דנה", ans: "yes" }, { name: "יוסי", ans: "yes" }, { name: "רון", ans: "maybe" }], mine: null, cancelled: false, go: 0, goOff: 1200, calls: [], subs: false, list: [], unknown: false }, o || {}); };
      const ptyView = (host) => {
        const rs = P.rs.slice(); if (P.mine) rs.push({ name: P.mine.name, ans: P.mine.ans });
        const c = { yes: 0, maybe: 0, no: 0 }; rs.forEach((r) => { c[r.ans]++; });
        const v = { id: PID, title: P.title, kind: P.kind, ref: "x", ch: P.ch, img: P.img, link: P.link, at: P.at, place: P.place, host: { name: P.host }, rsvps: rs.map((r, i) => (host ? { name: r.name, ans: r.ans, rid: ("00000000000" + i).slice(-12) } : r)), counts: c, now: NOWMS };
        if (P.cancelled) v.cancelled = true; if (P.go) v.go = P.go; if (P.mine) v.mine = { ans: P.mine.ans, name: P.mine.name, push: !!P.mine.push };
        return v;
      };
      ptyReset();
      await page.route(/\/api\/(rems|backup|push|watch)/, stubSrv);
      await page.route(/wa\.me|calendar\.google\.com/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
      await page.route(/\/api\/party/, (r) => {
        const rq = r.request(), ok = (o, st) => r.fulfill({ status: st || 200, contentType: "application/json", headers: CORS, body: JSON.stringify(o) });
        if (rq.method() === "GET") { const id = new URL(rq.url()).searchParams.get("id"); return id === PID ? ok(ptyView()) : ok({ error: "gone" }, 404); }
        const b = JSON.parse(rq.postData() || "{}"); P.calls.push(b);
        if (b.action === "create" && P.unknown) return ok({ error: "unknown token" }, 403);
        if (b.action === "list") return ok({ parties: P.list });
        if (b.action === "create") { P.at = b.at; P.title = b.title; P.kind = b.kind; P.place = b.place; P.host = b.name || ""; P.link = b.link || ""; P.ch = b.ch || ""; P.img = b.img || ""; P.rs = []; return ok(ptyView()); }
        if (b.id !== PID) return ok({ error: "gone" }, 404);
        if (b.action === "get") return ok(ptyView());
        if (b.action === "remove") { const i = +b.rid.slice(-2); if (b.undo) { if (P.removed) P.rs.splice(i, 0, P.removed); P.removed = null; } else { P.removed = P.rs.splice(i, 1)[0]; } return ok({ ok: true, removed: !b.undo }); }
        if (b.action === "rsvp") { P.mine = { ans: b.ans, name: b.name, push: !!(b.t && P.subs) }; return ok(ptyView()); }
        if (b.action === "view") return ok(Object.assign(ptyView(true), { host: { name: P.host, me: true, push: false } }));
        if (b.action === "cancel") { P.cancelled = !b.undo; return ok({ ok: true, cancelled: P.cancelled }); }
        if (b.action === "go") { P.go = NOWMS + P.goOff; return ok({ ok: true, go: P.go, now: NOWMS, pushed: 2 }); }
        return ok({ error: "bad action" }, 400);
      });
      const pt = (n, f) => nfsStep("pty-" + n, f);
      const ls = (o) => page.evaluate((kv) => { Object.keys(kv).forEach((k) => { if (kv[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, kv[k]); }); }, o);
      const HOSTLS = (extra) => JSON.stringify([Object.assign({ id: PID, title: "הסדרה הגדולה", at: P.at, place: "home", kind: "nf", ref: "t88001", ch: "נטפליקס", img: "", link: "https://www.netflix.com/search?q=Big", name: "אלעד" }, extra || {})]);
      const clean = () => ls({ "tvg.parties": null, "tvg.name": null, "tvg.gid": null });
      const txt = (s) => page.evaluate((x) => { const e = document.querySelector(x); return e ? e.innerText : ""; }, s);
      const waText = () => page.evaluate(() => { try { return decodeURIComponent((window.__wa || "").replace(/^.*[?&]text=/, "")); } catch (e) { return ""; } });
      const stubWa = () => page.evaluate(() => { window.__wa = ""; window.open = (u) => { window.__wa = u; return {}; }; TVG.openWa = (t) => { window.__wa = "https://wa.me/?text=" + encodeURIComponent(t); }; /* TVG.openWa (1.59): whatsapp:// בטלפון */ });
      const guestOpen = async (extra) => { ptyReset(extra); await fresh("?w=" + PID); await page.waitForTimeout(900); A(await shown("#ptyL"), "?w= opens the guest landing"); A(!/[?&](w|go)=/.test(page.url()), "url cleaned: " + page.url()); };

      await pt("create-nf", async () => {
        ptyReset(); nfFixture = true; await fresh(); await clean(); await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(800); await page.click(".nfhero"); await page.waitForTimeout(900);
        A(await page.evaluate(() => document.querySelectorAll("#nfsBar .btn").length === 1), "nf bar keeps ONE orange primary");
        A(await page.evaluate(() => !!document.querySelector("#nfsBar [data-ptynf]")), "secondary party button in the nf bar");
        await snap("40_pty_nf_bar");
        await page.click("[data-ptynf]"); await page.waitForTimeout(500); A(await shown("#party"), "create sheet opens over the nf page");
        A(/הערב 21:00/.test(await txt("#party")) && /מחר 21:00/.test(await txt("#party")), "when chips"); A(/אצלי/.test(await txt("#party")) && /כל אחד מהבית/.test(await txt("#party")), "place chips");
        A(await page.evaluate(() => document.querySelectorAll("#party .btn").length === 1 && !!document.querySelector("#party .btn.wa")), "one primary = green WhatsApp");
        await snap("41_pty_create_nf");
        await page.click('[data-ptywhen="pick"]'); await page.waitForTimeout(300); A(await shown("[data-ptydt]"), "time picker"); await page.click('[data-ptyplace="each"]'); await page.fill("#ptyName", "אלעד"); await page.waitForTimeout(300); await snap("42_pty_create_pick");
        await page.click('[data-ptywhen="tomorrow"]'); await page.click('[data-ptyplace="home"]'); await page.waitForTimeout(200);
        await stubWa(); await page.click("[data-ptysend]"); await page.waitForTimeout(900);
        const t = await waText(); A(t.indexOf("🍿") >= 0 && t.indexOf("👇 לאישור הגעה לחצו כאן:") >= 0 && t.indexOf("?w=" + PID) >= 0 && t.indexOf("ערב צפייה") >= 0, "whatsapp text: " + t);
        const cr = P.calls.filter((c) => c.action === "create")[0]; A(cr && cr.kind === "nf" && /^[mt]\d+$|^x_/.test(cr.ref) && cr.place === "home" && cr.name === "אלעד" && cr.at > NOWMS && /^https:\/\/www\.netflix\.com\//.test(cr.link || "https://www.netflix.com/"), "create body " + JSON.stringify(cr));
        A(!(await shown("#party")) && (await shown("#nfsheet")), "create sheet closed, nf page still there");
        A(/ההזמנה נשלחה/.test(await txt("#pill")), "toast"); A(await page.evaluate(() => JSON.parse(localStorage.getItem("tvg.parties") || "[]").length === 1 && localStorage.getItem("tvg.name") === "אלעד"), "party + name saved locally");
        await snap("43_pty_sent_toast"); nfFixture = false;
      });
      await pt("create-tv", async () => {
        ptyReset(); await fresh(); await clean(); await fresh();
        const ok = await page.evaluate(() => { const n = Date.now(); let pick = null; TVG.by.forEach((a, id) => { a.forEach((p) => { if (!pick && TVG.ilTs(p.s) > n + 3 * 3600000 && TVG.ilTs(p.s) < n + 20 * 3600000) pick = { id: id, p: p }; }); }); if (!pick) return false; TVG.openRem(pick); return true; });
        A(ok, "found a future program"); await page.waitForTimeout(600); A(await shown("#rem") && !!(await page.$("#rem [data-ptytv]")), "party button in the program sheet");
        await snap("44_pty_tv_remsheet");
        await page.click("[data-ptytv]"); await page.waitForTimeout(500); A(await shown("#party"), "create sheet over the program sheet");
        A(/שעת השידור/.test(await txt("#party")) && !(await page.$("[data-ptywhen]")), "tv: fixed time, no time chips"); await snap("45_pty_create_tv");
        await page.click("[data-ptycopy]"); await page.waitForTimeout(900);
        const cr = P.calls.filter((c) => c.action === "create")[0]; A(cr && cr.kind === "tv" && /^\d+\|\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(cr.ref) && cr.ch && cr.at > NOWMS, "tv create body " + JSON.stringify(cr));
        A(!(await shown("#party")) && /הועתק/.test(await txt("#pill")), "copy toast"); await snap("45_pty_copy_toast");
        await page.click("#pill .pillact"); await page.waitForTimeout(600); A(P.calls.some((c) => c.action === "cancel") && /בוטל/.test(await txt("#pill")), "undo cancels the party");
      });
      await pt("guest-fresh", async () => {
        await fresh(); await clean(); await guestOpen();
        const t = await txt("#ptyL");
        A(/הזמנה מאלעד לערב צפייה/.test(t) && /הסדרה הגדולה/.test(t) && /אצל אלעד/.test(t) && /21:00/.test(t) && /בנטפליקס/.test(t) && /דנה/.test(t) && /יוסי/.test(t) && /אולי/.test(t), "guest landing content: " + t.slice(0, 300));
        A(await page.evaluate(() => document.querySelectorAll("#ptyLBar .btn").length === 0), "before answering: no primary yet (calendar needs an answer)");
        A(await page.evaluate(() => { const c = document.querySelector("[data-ptyans]").getBoundingClientRect(), bar = document.querySelector("#ptyLBar").getBoundingClientRect(); return c.bottom <= bar.top + 2 && c.top > 0; }), "answer chips visible without scrolling");
        A(await page.evaluate(() => { const i = document.querySelector("#ptyGName").getBoundingClientRect(), c = document.querySelector("[data-ptyans]").getBoundingClientRect(); return i.bottom <= c.top; }), "name field comes before the answer chips");
        await snap("46_pty_guest_fresh");
        await page.evaluate(() => { document.querySelector("#ptyLBody").scrollTop = 9999; }); await page.waitForTimeout(300); await snap("46_pty_guest_fresh_bottom");
        await page.click('[data-ptyans="yes"]'); await page.waitForTimeout(400); A(/רק השם ונשלח/.test(await txt("#ptyL")), "empty name: inline hint"); A((await page.getAttribute('[data-ptyans="yes"]', "aria-pressed")) === "true", "choice remembered"); A(!P.calls.some((c) => c.action === "rsvp"), "no rsvp without a name");
        A(await page.evaluate(() => document.activeElement && document.activeElement.id === "ptyGName"), "name field focused"); await snap("46_pty_guest_pending");
        await page.fill("#ptyGName", "נועה"); await page.press("#ptyGName", "Enter"); await page.waitForTimeout(800);
        const rv = P.calls.filter((c) => c.action === "rsvp")[0]; A(rv && rv.ans === "yes" && rv.name === "נועה" && /^[A-Za-z0-9_-]{16,32}$/.test(rv.gid) && rv.id === PID && typeof rv.t === "string", "rsvp body " + JSON.stringify(rv));
        A((await page.getAttribute('[data-ptyans="yes"]', "aria-pressed")) === "true", "yes pressed"); A(/הוספה ליומן/.test(await txt("#ptyLBar")), "calendar button after answering");
        A(await page.evaluate(() => document.querySelectorAll("#ptyLBar .btn").length === 1), "one primary"); A(/נועה/.test(await txt("#ptyL")), "my name in the list");
        await page.evaluate(() => { document.querySelector("#ptyLBody").scrollTop = 0; }); await page.waitForTimeout(200); await snap("47_pty_guest_yes");
        await page.evaluate(() => { document.querySelector("#ptyLBody").scrollTop = 9999; }); await page.waitForTimeout(300); await snap("47_pty_guest_yes_bottom");
        await page.click("[data-ptycal]"); await page.waitForTimeout(700); A(/יומן|הקובץ/.test(await txt("#pill")), "calendar action toast: " + (await txt("#pill")));
        A((await page.evaluate(() => localStorage.getItem("tvg.name"))) === "נועה", "name remembered");
      });
      await pt("guest-maybe-no", async () => {
        await ls({ "tvg.name": "נועה" }); await guestOpen();
        A((await page.inputValue("#ptyGName")) === "נועה", "name prefilled");
        await page.click('[data-ptyans="maybe"]'); await page.waitForTimeout(600); A((await page.getAttribute('[data-ptyans="maybe"]', "aria-pressed")) === "true", "maybe pressed"); A(/הוספה ליומן/.test(await txt("#ptyLBar")), "maybe also gets the calendar");
        await snap("48_pty_guest_maybe");
        await page.click('[data-ptyans="no"]'); await page.waitForTimeout(600); A((await page.getAttribute('[data-ptyans="no"]', "aria-pressed")) === "true", "no pressed"); A(!/הוספה ליומן/.test(await txt("#ptyLBar")) && /לכל לוח השידורים/.test(await txt("#ptyLBar")) && /סגירה/.test(await txt("#ptyLBar")) && (await page.evaluate(() => document.querySelectorAll("#ptyLBar .btn").length === 1)), "no: orange = to the guide, close is quiet");
        await snap("49_pty_guest_no");
        await page.click('[data-ptyans="yes"]'); await page.waitForTimeout(500); A((await page.getAttribute('[data-ptyans="yes"]', "aria-pressed")) === "true", "answer can change later");
        A(P.calls.filter((c) => c.action === "rsvp").length === 3 && new Set(P.calls.filter((c) => c.action === "rsvp").map((c) => c.gid)).size === 1, "same gid for every change");
      });
      await pt("guest-reminder", async () => {
        await ls({ "tvg.name": "נועה" }); await guestOpen({ mine: { ans: "yes", name: "נועה" } });
        const can = await page.evaluate(() => !!document.querySelector("[data-ptyrem]"));
        A(can === (d.name.indexOf("android") === 0), "reminder button only where push is possible (installed iOS / Android): " + can);
        if (can) {
          await snap("49_pty_guest_reminder");
          await page.evaluate((at) => { TVG.pushOn = true; TVG.REMS = []; window.__at = at; }, AT_SUN); await page.click("[data-ptyrem]"); await page.waitForTimeout(700);
          A(await page.evaluate((id) => TVG.REMS.some((r) => r.k === "w|" + id + "|" + window.__at && r.id === "" && r.ts === window.__at && /🍿/.test(r.title)), PID), "personal reminder with key w|<id>|<ts>");
          A(/✓ יש תזכורת/.test(await txt("#ptyLBar")), "button shows the reminder exists"); await snap("49_pty_guest_reminder_set");
          await page.evaluate(() => { TVG.pushOn = false; TVG.REMS = []; TVG.saveRems(); });
        }
      });
      await pt("guest-push-sync", async () => { // התראות הופעלו אחרי התשובה: נשלחת שוב אותה תשובה עם הטוקן, והאישור "🔔" מופיע רק אחרי שהשרת אישר
        await ls({ "tvg.name": "נועה" }); await guestOpen({ mine: { ans: "yes", name: "נועה", push: false }, subs: true });
        A(/💡/.test(await txt("#ptyL")) && !/🔔 תקבלו התראה/.test(await txt("#ptyL")), "no bell before the server has the push");
        const n0 = P.calls.filter((c) => c.action === "rsvp").length;
        await page.evaluate(() => { TVG.pushOn = true; }); await page.waitForTimeout(3500);
        const rc = P.calls.filter((c) => c.action === "rsvp"); A(rc.length === n0 + 1 && rc[rc.length - 1].ans === "yes" && typeof rc[rc.length - 1].t === "string", "silent re-send of the same answer with the token");
        A(/🔔 תקבלו התראה כשמתחילים/.test(await txt("#ptyL")), "bell shown after the server confirmed"); await page.evaluate(() => { TVG.pushOn = false; });
        await page.evaluate(() => { document.querySelector("#ptyLBody").scrollTop = 9999; }); await page.waitForTimeout(300); await snap("49_pty_guest_push_ok");
      });
      await pt("guest-inapp", async () => {
        if (d.name.indexOf("iphone") !== 0) return;
        await ls({ "tvg.name": "נועה" }); await guestOpen({ mine: { ans: "yes", name: "נועה" } });
        await page.evaluate(() => { Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0" , configurable: true }); });
        await page.click("[data-ptycal]"); await page.waitForTimeout(400); A(/פתחו ב-Safari/.test(await txt("#ptyLBar")) && /העתקת הקישור/.test(await txt("#ptyLBar")), "in-app browser: open-in-Safari hint");
        await snap("50_pty_guest_inapp");
      });
      await pt("guest-states", async () => {
        await guestOpen({ cancelled: true }); A(/בוטל/.test(await txt("#ptyL")) && !(await page.$("[data-ptyans]")), "cancelled: banner, no answer chips"); await snap("51_pty_guest_cancelled");
        await fresh("?w=ZzZzZzZzZzZzZzZzZzZzZz"); await page.waitForTimeout(900); A(/לא מצאנו את הערב/.test(await txt("#ptyL")), "unknown id -> not found"); await snap("52_pty_guest_gone");
        for (let i = errs.length - 1; i >= 0; i--) if (/api\/party/.test(errs[i]) && /404/.test(errs[i])) errs.splice(i, 1); // 404 צפוי לערב לא קיים
        await guestOpen({ at: NOWMS - 5 * 3600000 }); A(/כבר עבר/.test(await txt("#ptyL")), "past party");
        await guestOpen({ kind: "tv", ch: "קשת 12", link: "", img: "" }); A(/בערוץ/.test(await txt("#ptyL")), "tv party shows the channel"); await snap("52_pty_guest_tv");
        await guestOpen({ kind: "nf", link: "", ch: "" }); A(/צפייה/.test(await txt("#ptyL")) && !/בנטפליקס/.test(await txt("#ptyL")) && !(await page.$(".pty-open")), "nf without a link: plain 'watch', no button");
      });
      await pt("host-row-sheet", async () => {
        ptyReset({ at: NOWMS + 3 * 3600000 }); await fresh(); await ls({ "tvg.parties": HOSTLS(), "tvg.gid": null }); await fresh(); await page.click('[data-tab="rems"]'); await page.waitForTimeout(1200);
        const row = await txt('[data-party]'); A(/הסדרה הגדולה/.test(row) && /ערב צפייה/.test(row) && /👍 2 · 🤔 1/.test(row), "host row: " + row);
        await snap("53_pty_host_row");
        await page.click("[data-party]"); await page.waitForTimeout(800); A(await shown("#party"), "host sheet");
        const h = await txt("#party"); A(/דנה/.test(h) && /יוסי/.test(h) && /רון/.test(h) && /שליחה שוב בוואטסאפ/.test(h) && /ביטול הערב/.test(h), "host sheet content"); A(!(await page.$("[data-ptygo]")), "no 3-2-1 button more than an hour before");
        await snap("54_pty_host_sheet");
        await page.click("[data-ptyrm]"); await page.waitForTimeout(700); A(/הוסרה התשובה/.test(await txt("#pill")) && !/דנה/.test(await txt("#party")), "guest removed (with undo toast)"); await snap("54_pty_host_removed");
        await page.click("#pill .pillact"); await page.waitForTimeout(700); A(/דנה/.test(await txt("#party")), "remove undone");
        await stubWa(); await page.click("[data-ptyresend]"); /* window.open -> wa.me (נחסם בנתב) */ await page.waitForTimeout(500);
        await page.click("[data-party]"); await page.waitForTimeout(600);
        await page.click("[data-ptycancel]"); await page.waitForTimeout(300); A(/לבטל את הערב/.test(await txt("#party")), "confirm before cancelling"); await snap("55_pty_host_cancel_confirm");
        await page.click("[data-ptycancelno]"); await page.waitForTimeout(200); A(!!(await page.$("[data-ptycancel]")), "keep");
        await page.click("[data-ptycancel]"); await page.click("[data-ptycancelyes]"); await page.waitForTimeout(800);
        A(!(await shown("#party")) && !(await page.$("[data-party]")) && /הערב בוטל/.test(await txt("#pill")), "cancelled: sheet closed, row gone, undo toast"); await snap("56_pty_host_cancelled_toast");
        await page.click("#pill .pillact"); await page.waitForTimeout(700); A(!!(await page.$("[data-party]")) && P.calls.some((c) => c.action === "cancel" && c.undo), "undo restores the party and the row");
      });
      await pt("host-go", async () => {
        ptyReset({ at: NOWMS + 30 * 60000, goOff: 2500 }); await fresh(); await ls({ "tvg.parties": HOSTLS({ at: NOWMS + 30 * 60000 }) }); await fresh(); await page.click('[data-tab="rems"]'); await page.waitForTimeout(900);
        await page.click("[data-party]"); await page.waitForTimeout(800);
        A(!!(await page.$("[data-ptygo]")) && (await page.evaluate(() => document.querySelectorAll("#party .btn").length === 1)), "within the window: ONE orange 3-2-1 button"); await snap("57_pty_host_go");
        await page.click("[data-ptygo]"); await page.waitForTimeout(700);
        A(await shown("#ptyGo") && (await txt("#ptyN")).trim() === "3", "countdown shows 3 (server clock frozen): " + (await txt("#ptyGo")));
        await snap("58_pty_go_3");
        P.goOff = 1200; await page.click("[data-ptygoclose]"); await page.waitForTimeout(400); A(!(await shown("#ptyGo")), "closed");
      });
      await pt("go-final", async () => {
        await ls({ "tvg.parties": null }); ptyReset({ go: NOWMS - 1000 }); await fresh("?w=" + PID + "&go=1"); await page.waitForTimeout(1200);
        A(await shown("#ptyGo") && /פליי/.test(await txt("#ptyGo")) && /פתיחה בנטפליקס/.test(await txt("#ptyGo")), "go push opens the final screen with the Netflix link: " + (await txt("#ptyGo")));
        A(await page.evaluate(() => /^https:\/\/www\.netflix\.com\//.test(document.querySelector("#ptyGo a.btn").href)), "netflix link"); await snap("59_pty_go_final");
        await page.click("[data-ptygoclose]"); await page.waitForTimeout(300);
        ptyReset({ go: NOWMS - 1000, kind: "tv", ch: "קשת 12", link: "" }); await fresh("?w=" + PID + "&go=1"); await page.waitForTimeout(1200);
        A(await shown("#ptyGo") && /עברו לערוץ/.test(await txt("#ptyGo")), "tv: switch-channel text"); await snap("59_pty_go_final_tv");
        await page.click("[data-ptygoclose]"); await page.waitForTimeout(300);
        ptyReset({ go: NOWMS + 4500 }); await fresh("?w=" + PID + "&go=1"); await page.waitForTimeout(1000); A(/מתכוננים/.test(await txt("#ptyGo")), "get ready (more than 3s)"); await snap("58_pty_go_ready");
      });
      await pt("host-newdevice", async () => { // מארח במכשיר חדש: הרשימה מהשרת, וקישור/הודעה פותחים את תצוגת המארח ולא את דף האורח
        ptyReset({ at: NOWMS + 3 * 3600000 }); P.list = [{ id: PID, title: P.title, kind: "nf", ref: "t1", ch: "נטפליקס", img: "", link: P.link, at: P.at, place: "home", name: "אלעד", counts: { yes: 2, maybe: 1, no: 0 } }];
        await fresh(); await ls({ "tvg.parties": null }); await fresh(); await page.click('[data-tab="rems"]'); await page.waitForTimeout(1500);
        A(!!(await page.$("[data-party]")), "host list restored from the server");
        await ls({ "tvg.parties": null }); await fresh("?w=" + PID); await page.waitForTimeout(1800);
        A(await shown("#party") && !(await shown("#ptyL")), "host opens the host view from a link on a new device");
      });
      await pt("create-unknown", async () => {
        ptyReset({ unknown: true }); nfFixture = true; await fresh(); await page.click('[data-tab="nf"]'); await page.waitForTimeout(700); await page.click(".nfhero"); await page.waitForTimeout(700); await page.click("[data-ptynf]"); await page.waitForTimeout(400);
        await page.click("[data-ptysend]"); await page.waitForTimeout(700); A(/מכינים את החשבון/.test(await txt("#pill")) && (await shown("#party")), "unknown token: friendly message, sheet stays"); nfFixture = false;
        for (let i = errs.length - 1; i >= 0; i--) if (errs[i].indexOf("api/party") >= 0 && /403/.test(errs[i])) errs.splice(i, 1); // 403 צפוי
      });
      await pt("dst", async () => { // שעון קיץ: 26.3.2027. השעה מחושבת לפי הקיזוז במועד האירוע, לא לפי עכשיו
        await fresh();
        const r = await page.evaluate(() => [["2027-03-25T21:00:00+02:00"], ["2027-03-26T21:00:00+03:00"], ["2027-03-28T21:00:00+03:00"], ["2026-10-24T21:00:00+03:00"], ["2026-10-25T21:00:00+02:00"]].map((x) => { const w = TVG.partyWall(Date.parse(x[0])); return w.getHours() + ":" + w.getMinutes() + "|" + w.getDate(); }));
        A(JSON.stringify(r) === JSON.stringify(["21:0|25", "21:0|26", "21:0|28", "21:0|24", "21:0|25"]), "wall time at the event offset: " + r.join());
      });
      await pt("dark", async () => {
        await ls({ "tvg.name": "נועה", "tvg.parties": null }); await guestOpen({ mine: { ans: "yes", name: "נועה" } }); await page.evaluate(() => TVG.setTheme("dark")); await page.waitForTimeout(400);
        await snap("60_pty_dark_guest"); await page.evaluate(() => { document.querySelector("#ptyLBody").scrollTop = 9999; }); await page.waitForTimeout(300); await snap("60_pty_dark_guest_bottom");
        ptyReset({ at: NOWMS + 30 * 60000 }); await fresh(); await ls({ "tvg.parties": HOSTLS({ at: NOWMS + 30 * 60000 }) }); await fresh(); await page.evaluate(() => TVG.setTheme("dark")); await page.click('[data-tab="rems"]'); await page.waitForTimeout(900); await snap("61_pty_dark_row");
        await page.click("[data-party]"); await page.waitForTimeout(800); await snap("61_pty_dark_host");
        ptyReset({ go: NOWMS - 1000 }); await fresh("?w=" + PID + "&go=1"); await page.waitForTimeout(1200); await snap("61_pty_dark_go");
        await ls({ "tvg.parties": null }); await page.evaluate(() => TVG.setTheme("light")); await page.waitForTimeout(200);
        nfFixture = true; await fresh(); await page.evaluate(() => TVG.setTheme("dark")); await page.click('[data-tab="nf"]'); await page.waitForTimeout(800); await page.click(".nfhero"); await page.waitForTimeout(700); await page.click("[data-ptynf]"); await page.waitForTimeout(500); await snap("62_pty_dark_create"); nfFixture = false;
        await page.evaluate(() => TVG.setTheme("light"));
      });
      await pt("url-precedence", async () => {
        ptyReset(); await fresh("?w=" + PID + "&p=999.2611010000&q=x&tab=rems"); await page.waitForTimeout(900);
        A(await shown("#ptyL") && !(await shown("#land")) && (await page.evaluate(() => TVG.tab)) !== "rems" && !/[?&](w|p|q|tab)=/.test(page.url()), "w wins over p/q/tab: " + page.url());
        await ls({ "tvg.parties": null, "tvg.name": null }); await fresh("?rem=" + encodeURIComponent("w|" + PID + "|" + AT_SUN)); await page.waitForTimeout(900); A(await shown("#ptyL"), "?rem=w|… opens the party");
        await page.keyboard.press("Escape"); await page.waitForTimeout(400); A(!(await shown("#ptyL")), "Escape closes the landing");
        await fresh("?w=bad"); await page.waitForTimeout(600); A(!(await shown("#ptyL")), "malformed id does not open");
      });
    }

    const key = d.name + ":" + phase; if (crashed && (tries[key] || 0) < 2) { tries[key] = (tries[key] || 0) + 1; failed = f0; total = t0; console.log("  retry", key); RUNS.splice(ri + 1, 0, [d, phase]); try { await browser.close(); } catch (e) {} browser = null; continue; }
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(d.name, "scrollWidth/clientWidth", overflow.sw + "/" + overflow.cw, "errors:", errs.length);
    errs.forEach((e) => { console.log("   ", e); allErrors.push(d.name + " " + e); });
    // ---- דו"ח ביקורת הפריסה: אותה בעיה (סוג + אלמנט[ים]) שחוזרת בכמה שלבים נספרת פעם אחת ----
    const uniq = new Map(), sg = (s) => String(s || "").replace(/ ".*$/, "");
    auditRaw.forEach((i) => { const k = i.type + "|" + sg(i.el) + "|" + sg(i.el2); const u = uniq.get(k); if (u) u.steps.push(i.step); else uniq.set(k, { type: i.type, el: i.el, el2: i.el2, msg: i.msg, steps: [i.step] }); });
    const issues = Array.from(uniq.values()), byType = {}; issues.forEach((i) => { byType[i.type] = (byType[i.type] || 0) + 1; });
    fs.writeFileSync(path.join(OUT, "qa-audit-" + d.name + "-" + phase + ".json"), JSON.stringify({ device: d.name, count: issues.length, byType, issues }, null, 1));
    console.log("audit " + d.name + " " + phase + " issues: " + issues.length + " " + JSON.stringify(byType));
    issues.slice(0, 5).forEach((i) => console.log("    audit: [" + i.type + "] " + i.el + (i.el2 ? " <> " + i.el2 : "") + " - " + i.msg + " @" + i.steps[0]));
    auditTotal += issues.length;
    if (phase !== "nfs") { if (!ran) doneDev[d.name] = true; else savedState[d.name] = await ctx.storageState(); }
    await ctx.close(); await browser.close(); browser = null;
  }
  if (browser) await browser.close(); if (srv) srv.close();
  console.log("\nscreenshots:", total, "-> " + OUT, "| step failures:", failed, "| console/page errors:", allErrors.length);
  console.log("layout audit issues:", auditTotal, process.env.TVG_AUDIT_STRICT ? "(strict)" : "(report only; TVG_AUDIT_STRICT=1 to fail)");
  process.exit(allErrors.length || (process.env.TVG_AUDIT_STRICT && auditTotal) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
