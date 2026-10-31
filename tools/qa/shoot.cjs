#!/usr/bin/env node
/*
 * Screenshot harness for the TV guide PWA.
 *
 *   node tools/qa/shoot.cjs <outDir> [baseUrl]
 *
 * Without baseUrl it serves the repo root on a random local port.
 * Takes screenshots of every tab and sheet at 375 + 393 (iPhone UA) and 360 + 412 (Android Chrome UA),
 * freezes the clock so before/after runs are comparable, and fails (exit 1) on any console error / pageerror.
 * Compare two runs with:  node tools/qa/diff.cjs <dirA> <dirB>
 *
 * Needs installed Chrome (channel "chrome") and:  cd tools/qa && npm install
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright-core");

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
  let total = 0, failed = 0; const allErrors = [];
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
    const errs = [];
    const hookPage = () => { page.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
    page.on("console", (m) => { if (m.type() !== "error") return; const u = (m.location() || {}).url || ""; if (/netflix\.json/.test(u) || (/api\/backup/.test(u) && /404/.test(m.text())) || ((/api\/snooze$/.test(u) || /api\/nf-search/.test(u)) && /502/.test(m.text()))) return; /* snooze 502 is injected by the failure scenario */ /* netflix.json is optional (404 is expected) */ errs.push("console: " + m.text() + " " + u); }); page.on("crash", () => console.log("  !! renderer crashed", d.name)); };
    const fresh = async (q) => { await page.goto(base + "index.html" + (q || ""), { waitUntil: "networkidle" }); await page.waitForTimeout(1200); };
    const snap = async (n) => { total++; await page.screenshot({ path: path.join(OUT, d.name + "_" + n + ".png") }); };
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
    await step("share-copy", async () => { await page.click("[data-shcopy]"); await page.waitForTimeout(300); const t = await page.textContent("#pill"); if (!/הקישור הועתק|לא הצלחנו/.test(t)) throw new Error("copy toast: " + t); });
    await step("deeplink", async () => {
      await fresh();
      const v = await page.evaluate(() => { const now = Date.now(); const ids = Array.from(TVG.sel); for (const id of ids) { const a = (TVG.by.get(id) || []).filter(p => p.s.getTime() > now + 86400000 * 1.2); if (a.length) { const p = a[Math.min(3, a.length - 1)]; return id + "%7C" + TVG.dstr(p.s) + "T" + TVG.hhmm(p.s); } } return null; });
      if (!v) throw new Error("no program for deep link");
      await page.goto(base + "index.html?p=" + v + "&x=1", { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
      const u = await page.evaluate(() => location.search); if (u !== "?x=1") throw new Error("url not cleaned: " + u);
      await snap("13_deeplink");
      await page.goto(base + "index.html?p=208%7C2020-01-01T10:00", { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
      const t = await page.textContent("#pill"); if (!/כבר לא בלוח/.test(t)) throw new Error("gone toast: " + t);
      await snap("13_deeplink_gone");
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

    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(d.name, "scrollWidth/clientWidth", overflow.sw + "/" + overflow.cw, "errors:", errs.length);
    errs.forEach((e) => { console.log("   ", e); allErrors.push(d.name + " " + e); });
    await ctx.close(); await browser.close(); browser = null;
  }
  if (browser) await browser.close(); if (srv) srv.close();
  console.log("\nscreenshots:", total, "-> " + OUT, "| step failures:", failed, "| console/page errors:", allErrors.length);
  process.exit(allErrors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
