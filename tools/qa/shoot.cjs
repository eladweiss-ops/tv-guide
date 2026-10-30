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
    page.on("console", (m) => { if (m.type() !== "error") return; const u = (m.location() || {}).url || ""; if (/netflix\.json$/.test(u) || (/api\/snooze$/.test(u) && /502/.test(m.text()))) return; /* snooze 502 is injected by the failure scenario */ /* netflix.json is optional (404 is expected) */ errs.push("console: " + m.text() + " " + u); });
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

    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(d.name, "scrollWidth/clientWidth", overflow.sw + "/" + overflow.cw, "errors:", errs.length);
    errs.forEach((e) => { console.log("   ", e); allErrors.push(d.name + " " + e); });
    await ctx.close();
  }
  await browser.close(); if (srv) srv.close();
  console.log("\nscreenshots:", total, "-> " + OUT, "| step failures:", failed, "| console/page errors:", allErrors.length);
  process.exit(allErrors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
