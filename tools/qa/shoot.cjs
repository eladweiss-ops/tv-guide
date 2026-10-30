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
  for (const d of DEVICES.filter((x) => !process.env.TVG_ONLY || process.env.TVG_ONLY.split(",").some((o) => x.name.indexOf(o) === 0))) { // TVG_ONLY=iphone|android|iphone_375,... מצמצם
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, userAgent: d.ua, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
    await ctx.addInitScript((sel) => { try { if (!localStorage.getItem("tvg.sel")) { localStorage.setItem("tvg.sel", JSON.stringify(sel)); localStorage.setItem("tvg.bkAt", "1"); localStorage.setItem("tvg.v5", "1"); localStorage.setItem("tvg.theme", "light"); } } catch (e) {} }, SEL);
    // TVG_NO_WRITES=1 (הניטור מול האתר החי): חוסם כל בקשה שאינה GET לשרת התזכורות, כדי שהבדיקה לא תכתוב גיבויים/תזכורות
    if (process.env.TVG_NO_WRITES) await ctx.route(/tv-guide-cal\.vercel\.app/, (r) => (r.request().method() === "GET" ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: "{\"ok\":true}" })));
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
    page.on("console", (m) => { if (m.type() !== "error") return; const u = (m.location() || {}).url || ""; if (/netflix\.json/.test(u) || (/api\/snooze$/.test(u) && /502/.test(m.text()))) return; /* snooze 502 is injected by the failure scenario */ /* netflix.json is optional (404 is expected) */ errs.push("console: " + m.text() + " " + u); });
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
    await step("deeplink-short", async () => { // הקישור הקצר החדש: ?p=<ערוץ>.<YYMMDDHHMM>
      await fresh();
      const v = await page.evaluate(() => { const now = Date.now(); for (const id of Array.from(TVG.sel)) { const a = (TVG.by.get(id) || []).filter(p => p.s.getTime() > now + 86400000); if (a.length) { const p = a[0]; return id + "." + (TVG.dstr(p.s) + TVG.hhmm(p.s)).replace(/\D/g, "").slice(2); } } return null; });
      if (!v) throw new Error("no program for short deep link");
      await page.goto(base + "index.html?p=" + v, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
      const t = await page.textContent("#pill"); if (!/ששיתפו איתך/.test(t)) throw new Error("short link not resolved: " + v + " pill=" + t);
    });
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
