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

const OUT = path.resolve(process.argv[2] || "shots");
const REPO = path.resolve(__dirname, "..", "..");
const FIXED_NOW = process.env.TVG_NOW || "2026-10-30T20:15:00+02:00"; // inside the range guide.json covers
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
    poster: "https://image.tmdb.org/t/p/w342/fx_" + k + ".jpg", backdrop: "", nf: !!o.nf, others: o.others || [], link: o.nf ? "https://www.netflix.com/search?q=" + encodeURIComponent(o.orig || title) : "" };
}
function nfSearchFixture(q) {
  const base = { v: 1, q, collection: null, brand: null, titles: [], persons: [], items: {} };
  const put = (it) => { base.items[it.k] = it; return it.k; };
  if (q === "הנוקמים") {
    base.collection = { id: 86311, name: "הנוקמים - אוסף", poster: "", keys: [
      put(fxItem("m24428", "הנוקמים", { orig: "The Avengers", year: 2012, others: ["Disney Plus"] })), put(fxItem("m99861", "הנוקמים: עידן אולטרון", { orig: "Avengers: Age of Ultron", year: 2015, others: ["Disney Plus"] })),
      put(fxItem("m299536", "הנוקמים: מלחמת האינסוף", { orig: "Avengers: Infinity War", year: 2018, nf: true })), put(fxItem("m299534", "הנוקמים: סוף המשחק", { orig: "Avengers: Endgame", year: 2019, nf: true }))] };
    base.titles = [put(fxItem("t88001", "הזמר במסכה", { year: 2018 })), put(fxItem("m88002", "הכוורת", { year: 1976 })), put(fxItem("t88003", "הנוקמים: מועדון הנוקמים האגדי והמיוחד מכולם", { orig: "Avengers Assemble Forever", year: 2013, others: ["Disney Plus", "Prime Video"] }))];
    base.persons = [{ id: 3223, name: "רוברט דאוני ג׳וניור", photo: "https://image.tmdb.org/t/p/w185/fx_p3223.jpg", dept: "משחק", keys: [put(fxItem("m1726", "איש הברזל", { orig: "Iron Man", year: 2008, others: ["Disney Plus"] })), put(fxItem("m299534", "הנוקמים: סוף המשחק", { orig: "Avengers: Endgame", year: 2019, nf: true })), put(fxItem("m27205", "ההתחלה", { orig: "Inception", year: 2010, nf: true }))] }];
  } else if (q === "טום הנקס") {
    base.persons = [{ id: 31, name: "טום הנקס", photo: "https://image.tmdb.org/t/p/w185/fx_p31.jpg", dept: "משחק", keys: ["m13", "m857", "m497", "m9800"].map((k, i) => put(fxItem(k, ["פורסט גאמפ", "להציל את טוראי ריאן", "הקו הירוק", "מחוץ לזמן"][i], { year: 1994 + i, nf: i === 0 }))) }];
  } else if (q === "מארוול") {
    base.brand = { name: "Marvel Studios", keys: ["m1726", "m10138", "m24428", "t88001", "m299534"].map((k, i) => put(fxItem(k, ["איש הברזל", "איש הברזל 2", "הנוקמים", "הזמר במסכה", "הנוקמים: סוף המשחק"][i], { year: 2008 + i, nf: i === 4, others: i < 3 ? ["Disney Plus"] : [] }))) };
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
  return j;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let srv = null, base = process.argv[3];
  if (!base) { const s = await serve(); srv = s.srv; base = s.url; }
  if (!base.endsWith("/")) base += "/";
  let browser = null; // דפדפן חדש לכל מכשיר: ריצה ארוכה של כמה מכשירים ברצף עלולה להפיל את הרנדרר (Target crashed)
  let total = 0, failed = 0, auditTotal = 0; const allErrors = [];
  const RUNS = []; DEVICES.filter((x) => !process.env.TVG_ONLY || process.env.TVG_ONLY.split(",").some((o) => x.name.indexOf(o) === 0)).forEach((x) => ["main", "nfs"].forEach((p) => RUNS.push([x, p]))); // שני שלבים לכל מכשיר, בדפדפן נפרד: ריצה אחת ארוכה מדי מפילה את הרנדרר בזיכרון
  for (const [d, phase] of RUNS) { // TVG_ONLY=iphone|android|iphone_375,... מצמצם
    browser = await chromium.launch({ channel: "chrome", headless: true, args: process.env.TVG_CHROME_ARGS ? process.env.TVG_CHROME_ARGS.split(" ") : [] });
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: d.ua, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
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
    let page = null;
    const errs = [], auditRaw = [];
    const audit = (name) => runAudit(page, name, auditRaw);
    const hookPage = () => { page.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
    page.on("console", (m) => { if (m.type() !== "error") return; const u = (m.location() || {}).url || ""; if (/netflix\.json/.test(u) || (/api\/backup/.test(u) && /404/.test(m.text())) || ((/api\/snooze$/.test(u) || /api\/nf-search/.test(u)) && /502/.test(m.text()))) return; /* snooze 502 is injected by the failure scenario */ /* netflix.json is optional (404 is expected) */ errs.push("console: " + m.text() + " " + u); }); page.on("crash", () => console.log("  !! renderer crashed", d.name)); };
    const fresh = async (q) => { await page.goto(base + "index.html" + (q || ""), { waitUntil: "networkidle" }); await page.waitForTimeout(1200); };
    const snap = async (n) => { total++; await page.screenshot({ path: path.join(OUT, d.name + "_" + n + ".png") }); await audit(n); };
    const step = (n, f) => (phase === "main" ? runStep(n, f) : Promise.resolve());
    const runStep = async (name, fn) => { if (process.env.TVG_LOG) console.log("  step", name); try { await fn(); } catch (e) { failed++; errs.push("step " + name + ": " + e.message.split("\n")[0]); if (process.env.TVG_LOG) console.log("    FAIL", e.message.split("\n").slice(0, 5).join(" | ")); } };
    // netflix.json: ברירת מחדל = הקובץ האמיתי; במצב fixture = עותק עם ציונים וקצוות (בלי לגעת בקובץ במאגר)
    let nfFixture = false;
    // עמוד חדש (גם באמצע הריצה: ריצה ארוכה מאוד בעמוד אחד מפילה את הרנדרר בגלל זיכרון, ראו "fresh page" אחרי בלוק נטפליקס)
    const setupPage = async () => {
      if (page) await page.close();
      page = await ctx.newPage(); hookPage();
      await page.clock.setFixedTime(new Date(FIXED_NOW));
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
      A(/היום 22:50/.test(txt), "airing today badge: " + txt.slice(0, 400)); A(/יום א׳ 19:15/.test(txt), "airing Sunday badge");
      A(nfQueries.length === 1 && nfQueries[0] === "הנוקמים", "one debounced query: " + JSON.stringify(nfQueries));
      A(await page.evaluate(() => [].map.call(document.querySelectorAll(".nfxn"), (e) => e.textContent).join() === "1,2,3,4"), "collection numbered in order");
      await snap("20_nfs_avengers");
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(500); await snap("20_nfs_avengers_bottom");
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
      for (const s of ["לא זמין כרגע בנטפליקס", "זמין גם ב:", "Disney Plus", "🔔 תודיע לי", "כשזה מגיע לנטפליקס", "כשזה משודר בערוץ", "⏰ להזכיר לי לצפות", "הערב 21:00", "מחר 21:00", "בחירת שעה"]) A(sh.indexOf(s) >= 0, "sheet text: " + s);
      A(sh.indexOf("עונה חדשה") < 0, "no season chip for a movie");
      A(await page.evaluate(() => !document.querySelector(".nfgo")), "no Netflix button for unavailable title");
      await snap("25_nfs_sheet_alerts");
      await page.click('[data-wlkind="nf"]'); await page.waitForTimeout(500);
      A((await page.getAttribute('[data-wlkind="nf"]', "aria-pressed")) === "true", "chip pressed");
      A(wlPosts.length === 1 && wlPosts[0].items[0].k === "m24428" && wlPosts[0].items[0].on.join() === "nf" && wlPosts[0].items[0].bn === false && /^[a-z0-9]{24,48}$/.test(wlPosts[0].t), "watch POST " + JSON.stringify(wlPosts));
      A(/נודיע לך/.test(await page.textContent("#pill")), "alert toast");
      await snap("26_nfs_alert_set");
      await page.click("[data-pillact]"); await page.waitForTimeout(400); // ביטול
      A((await page.getAttribute('[data-wlkind="nf"]', "aria-pressed")) === "false", "undo unpresses"); A(wlPosts.length === 2 && wlPosts[1].items.length === 0, "undo synced empty list");
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
      await page.goto(base + "index.html?nf=m24428&tab=rems", { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
      A(await shown("#nfsheet"), "?nf= opens the sheet"); A(!/[?&](nf|tab)=/.test(page.url()), "url cleaned: " + page.url());
      A(await page.evaluate(() => TVG.tab !== "rems"), "nf takes precedence over tab");
      A((await page.textContent("#nfsheet")).indexOf("הנוקמים") >= 0 && (await page.getAttribute('[data-wlkind="nf"]', "aria-pressed")) === "true", "item + pressed chip from watchlist");
      await snap("33_nfs_from_push");
      await page.goto(base + "index.html?nf=m1", { waitUntil: "networkidle" }); await page.waitForTimeout(800); A(!(await shown("#nfsheet")), "unknown key does not open"); A(/לא מצאנו/.test(await page.textContent("#pill")), "friendly toast");
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
    const REM_NEXT = mkRem("להיוולד מחדש - פרק 74", "2026-10-30T20:27:00+02:00", "2026-10-30T21:16:00+02:00", 10);
    const REM_STARTED = mkRem("להיוולד מחדש - פרק 73", "2026-10-30T19:37:00+02:00", "2026-10-30T20:40:00+02:00", 10);
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
    await ctx.close(); await browser.close(); browser = null;
  }
  if (browser) await browser.close(); if (srv) srv.close();
  console.log("\nscreenshots:", total, "-> " + OUT, "| step failures:", failed, "| console/page errors:", allErrors.length);
  console.log("layout audit issues:", auditTotal, process.env.TVG_AUDIT_STRICT ? "(strict)" : "(report only; TVG_AUDIT_STRICT=1 to fail)");
  process.exit(allErrors.length || (process.env.TVG_AUDIT_STRICT && auditTotal) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
