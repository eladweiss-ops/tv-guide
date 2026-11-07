/* tools/qa/rec.cjs - בדיקה ממוקדת: 💌 המלצה עם מילה אישית, מה שהחבר רואה, קוביות דירוג כקישורים, חגיגת תזכורת.
   node tools/qa/rec.cjs <outDir>   (מגיש את המאגר מקומית; לא כותב לשרת האמיתי) */
const fs = require("fs"), path = require("path"), http = require("http");
const { chromium } = require("playwright-core");
const REPO = path.resolve(__dirname, "..", ".."), OUT = path.resolve(process.argv[2] || "qa-rec");
fs.mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
let fails = 0;
const A = (c, m) => { if (!c) { fails++; console.log("  FAIL " + m); } else console.log("  ok   " + m); };

(async () => {
  const srv = await new Promise((r) => { const s = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p); if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("nf"); }
    res.setHeader("Content-Type", MIME[path.extname(f)] || "application/octet-stream"); res.setHeader("Cache-Control", "no-store"); fs.createReadStream(f).pipe(res);
  }).listen(0, "127.0.0.1", () => r(s)); });
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const nf = JSON.parse(fs.readFileSync(path.join(REPO, "netflix.json"), "utf8"));
  const K = Object.keys(nf.items).find((k) => nf.items[k].imdb_id && nf.items[k].type === "tv") || nf.hero;
  const g = JSON.parse(fs.readFileSync(path.join(REPO, "guide.json"), "utf8"));
  const now = Date.now(), fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const nowIl = fmt.format(new Date(now + 3 * 36e5)).replace(" ", "T");
  const prog = g.programs.filter((p) => p.ch === "3819" && p.start > nowIl).sort((a, b) => (a.start < b.start ? -1 : 1))[0];
  const pv = prog.ch + "." + prog.start.replace(/\D/g, "").slice(2);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const w of [375, 393]) {
    console.log("== " + w);
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 375 ? 812 : 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
    await ctx.route(/tv-guide-cal\.vercel\.app/, (r) => (r.request().method() === "GET" ? r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }) : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: "{\"ok\":true}" })));
    await ctx.route(/image\.tmdb\.org/, (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="780" height="440"><rect width="100%" height="100%" fill="#2b4a6f"/></svg>' }));
    await ctx.addInitScript(() => { try { if (!localStorage.getItem("tvg.sel")) { localStorage.setItem("tvg.sel", JSON.stringify(["3819", "3787", "199"])); localStorage.setItem("tvg.bkAt", "1"); localStorage.setItem("tvg.theme", "dark"); localStorage.setItem("tvg.name", "אלעד"); } } catch (e) {} });
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const shot = (n) => page.screenshot({ path: path.join(OUT, w + "_" + n + ".png") });

    // 1. דף תוכן: קוביות דירוג כקישורים + כפתור 💌
    await page.goto(base + "index.html?nf=" + K, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
    const tiles = await page.$$eval("#nfsheet a.nfr", (a) => a.map((x) => x.href));
    A(tiles.length === 0 || /imdb\.com\/(title\/tt\d+\/reviews|find)/.test(tiles[0]), "rating tiles are links: " + tiles.join(" | ").slice(0, 160));
    A(!!(await page.$("#nfsBar [data-nfrec]")), "💌 button in the bar");
    const bar = await page.evaluate(() => [...document.querySelectorAll("#nfsBar .nfbar2 > *")].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(r.width), sw: b.scrollWidth, cw: b.clientWidth }; }));
    A(bar.every((b) => b.sw <= b.cw + 1), "bar buttons don't overflow: " + JSON.stringify(bar));
    await page.evaluate(() => { const b = document.querySelector("#nfsBody"); b.scrollTop = 200; }); await page.waitForTimeout(300); await shot("01_nf_page");
    // 2. 💌 → חלון המלצה, הקלדת מילה אישית
    await page.click("#nfsBar [data-nfrec]"); await page.waitForTimeout(500);
    A(await page.evaluate(() => !document.querySelector("#rem").hidden && document.querySelector("#rem").classList.contains("over")), "share sheet over the content page");
    A(!(await page.$("#remBody [data-shmode]")), "no card chips for streaming");
    await page.fill("#shMsg", "זו הסדרה שסיפרתי לך עליה בצהריים"); await page.waitForTimeout(300);
    const prev = await page.textContent("#shPrev");
    A(/💬 זו הסדרה שסיפרתי/.test(prev) && /tv-guide-cal\.vercel\.app\/n\/[mt]\d+$/.test(prev.trim()) && !/%D7/.test(prev), "preview has the note; link stays short (no Hebrew in it)");
    await page.evaluate(() => document.activeElement && document.activeElement.blur()); await shot("02_rec_sheet");
    await page.evaluate(() => { const b = document.querySelector("#remBody"); if (b) b.scrollTop = 9999; }); await shot("02b_rec_sheet_bottom");
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    A(await page.evaluate(() => document.querySelector("#rem").hidden && !document.querySelector("#nfsheet").hidden && !document.querySelector("#scrim2").hidden), "Escape closes only the share sheet; page + scrim stay");
    // 3. החבר פותח את הקישור: הדף נפתח גם כשהקישור מגיע לפני שרשימת נטפליקס נטענה
    await page.goto(base + "index.html?nf=" + K, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
    A(await page.evaluate(() => !document.querySelector("#nfsheet").hidden), "friend link ?nf= opens the content page");
    // 3b. תוכן מחוץ לרשימות: נפתח מהשם שבקישור (t=)
    await page.goto(base + "index.html?nf=t999999&t=" + encodeURIComponent("סדרה לדוגמה"), { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
    A(/סדרה לדוגמה/.test((await page.textContent("#nfsBody")) || "") && !/[?&]t=/.test(page.url()), "item outside the lists opens from its title; url cleaned");
    await shot("03_friend_stub");
    // 3c. דיסני+: הקישור מסומן s=d, ואצל החבר (דפדפן נקי) נטען disney.json לפני הפתיחה
    const DK = Object.keys(JSON.parse(fs.readFileSync(path.join(REPO, "disney.json"), "utf8")).items).find((k) => !nf.items[k]);
    if (DK) {
      const c2 = await browser.newContext({ viewport: { width: w, height: 812 }, locale: "he-IL", userAgent: IPHONE_UA, isMobile: true, hasTouch: true });
      await c2.route(/tv-guide-cal\.vercel\.app/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: "{}" }));
      await c2.addInitScript(() => { try { localStorage.setItem("tvg.sel", JSON.stringify(["3819"])); localStorage.setItem("tvg.bkAt", "1"); } catch (e) {} });
      const p2 = await c2.newPage();
      await p2.goto(base + "index.html?nf=" + DK + "&s=d", { waitUntil: "networkidle" }); await p2.waitForTimeout(1800);
      A(await p2.evaluate(() => !document.querySelector("#nfsheet").hidden && /דיסני\+/.test(document.querySelector("#nfsBar").textContent)), "Disney+ link opens the Disney+ page in a clean browser");
      await p2.click("#nfsBar [data-nfrec]"); await p2.waitForTimeout(400);
      A(/(\/n\/[mt]\d+\?s=d|\?nf=[mt]\d+&s=d&t=\S+)$/.test((await p2.textContent("#shPrev")).trim()), "💌 from a Disney+ page marks s=d");
      await c2.close();
    } else console.log("  (no Disney-only item to test)");
    await page.goto(base + "index.html", { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    const r = await page.evaluate((v) => { const x = TVG.findProg(v); if (x) TVG.openShare(x); return !!x; }, prog.ch + "|" + new Date(Date.parse(prog.start + ":00+02:00")).getTime());
    if (r) { await page.fill("#shMsg", "נראה את זה יחד?"); await page.waitForTimeout(300); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await shot("05_share_tv"); A(/💬 נראה את זה יחד/.test(await page.textContent("#shPrev")), "tv share preview has the note"); }
    // 5. חגיגה: קפיצה במקום ההקשה, מעל חלון פתוח
    await page.evaluate(() => { localStorage.removeItem("tvg.cel"); document.querySelector("#rem").hidden = false; });
    await page.mouse.click(w / 2, 600); await page.evaluate(() => TVG.celebrate("rem")); await page.waitForTimeout(330);
    A(await page.evaluate(() => !!document.querySelector("#fxpop .pop")), "pop is shown over the open sheet");
    await shot("06_pop_over_sheet");
    A(await page.evaluate(() => !document.querySelector("#fx") || document.querySelectorAll("#fx i").length === 0), "rise waits while a sheet is open");
    await page.evaluate(() => TVG.closeRem()); await page.waitForTimeout(1500);
    A(await page.evaluate(() => document.querySelectorAll("#fx i").length > 0), "rise starts after the sheet closes");
    await shot("07_rise_after_close");
    A(errs.length === 0, "no page errors " + errs.join(" | "));
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(fails ? "FAILED " + fails : "ALL OK");
})().catch((e) => { console.error(e); process.exit(1); });
