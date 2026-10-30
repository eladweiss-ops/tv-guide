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
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let total = 0, failed = 0; const allErrors = [];
  for (const d of DEVICES.filter((x) => !process.env.TVG_ONLY || process.env.TVG_ONLY.split(",").indexOf(x.name) >= 0)) {
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: d.ua, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
    await ctx.addInitScript((sel) => { try { if (!localStorage.getItem("tvg.sel")) { localStorage.setItem("tvg.sel", JSON.stringify(sel)); localStorage.setItem("tvg.bkAt", "1"); localStorage.setItem("tvg.v5", "1"); localStorage.setItem("tvg.theme", "light"); } } catch (e) {} }, SEL);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
    page.on("console", (m) => { if (m.type() !== "error") return; const u = (m.location() || {}).url || ""; if (/netflix\.json/.test(u)) return; errs.push("console: " + m.text() + " " + u); });
    const fresh = async (q) => { await page.goto(base + "index.html" + (q || ""), { waitUntil: "networkidle" }); await page.waitForTimeout(1200); };
    const snap = async (n) => { total++; await page.screenshot({ path: path.join(OUT, d.name + "_" + n + ".png") }); };
    const step = async (name, fn) => { try { await fn(); } catch (e) { failed++; errs.push("step " + name + ": " + e.message.split("\n")[0]); } };
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    // netflix.json: ברירת מחדל = הקובץ האמיתי; במצב fixture = עותק עם ציונים וקצוות (בלי לגעת בקובץ במאגר)
    let nfFixture = false;
    await page.route("**/netflix.json*", async (route) => {
      if (!nfFixture) return route.continue();
      await route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(nfFixtureData()) });
    });

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

    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(d.name, "scrollWidth/clientWidth", overflow.sw + "/" + overflow.cw, "errors:", errs.length);
    errs.forEach((e) => { console.log("   ", e); allErrors.push(d.name + " " + e); });
    await ctx.close();
  }
  await browser.close(); if (srv) srv.close();
  console.log("\nscreenshots:", total, "-> " + OUT, "| step failures:", failed, "| console/page errors:", allErrors.length);
  process.exit(allErrors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
