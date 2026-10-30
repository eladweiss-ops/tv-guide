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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let srv = null, base = process.argv[3];
  if (!base) { const s = await serve(); srv = s.srv; base = s.url; }
  if (!base.endsWith("/")) base += "/";
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let total = 0, failed = 0; const allErrors = [];
  for (const d of DEVICES) {
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: d.ua, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
    await ctx.addInitScript((sel) => { try { if (!localStorage.getItem("tvg.sel")) { localStorage.setItem("tvg.sel", JSON.stringify(sel)); localStorage.setItem("tvg.bkAt", "1"); localStorage.setItem("tvg.v5", "1"); localStorage.setItem("tvg.theme", "light"); } } catch (e) {} }, SEL);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
    page.on("console", (m) => { if (m.type() !== "error") return; const u = (m.location() || {}).url || ""; if (/netflix\.json$/.test(u)) return; /* netflix.json is optional (404 is expected) */ errs.push("console: " + m.text() + " " + u); });
    const fresh = async (q) => { await page.goto(base + "index.html" + (q || ""), { waitUntil: "networkidle" }); await page.waitForTimeout(1200); };
    const snap = async (n) => { total++; await page.screenshot({ path: path.join(OUT, d.name + "_" + n + ".png") }); };
    const step = async (name, fn) => { try { await fn(); } catch (e) { failed++; errs.push("step " + name + ": " + e.message.split("\n")[0]); } };
    await page.clock.setFixedTime(new Date(FIXED_NOW));

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
    await step("dark", async () => { await fresh(); await page.click("#setBtn"); await page.waitForTimeout(500); await page.click('[data-theme-set="dark"]'); await page.waitForTimeout(400); await page.click("[data-setclose]"); await page.waitForTimeout(500); await snap("10_dark_dial"); });

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
    await ctx.close();
  }
  await browser.close(); if (srv) srv.close();
  console.log("\nscreenshots:", total, "-> " + OUT, "| step failures:", failed, "| console/page errors:", allErrors.length);
  process.exit(allErrors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
