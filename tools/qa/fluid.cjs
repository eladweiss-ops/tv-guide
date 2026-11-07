#!/usr/bin/env node
/*
 * בדיקות "תחושת אצבע נוזלית": גרירה לסגירה של חלונות תחתונים (js/sheetdrag.js), החלקת ימים (js/swipe.js), הפחתת תנועה / שקיפות / ניגודיות.
 *
 *   TVG_NO_WRITES=1 TVG_CHROME_ARGS=--disable-gpu node tools/qa/fluid.cjs <outDir> [device-prefix,...]
 *
 * מגע אמיתי דרך CDP (tools/qa/touch.cjs). בכל מכשיר: בדיקות עם ציון עובר/נכשל + הקלטת screencast של גרירה איטית, זריקה, החזרה בקפיץ והחלקת יום,
 * שמוצאת ל-mp4 (60fps) ולגיליון תמונות (contact sheet) באמצעות ffmpeg (חייב להיות ב-PATH). אין כתיבה לשרת החי: בקשות לא-GET לשרת התזכורות נחסמות.
 */
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process");
const { chromium } = require("playwright-core");
const T = require("./touch.cjs");

const OUT = path.resolve(process.argv[2] || "fluid");
const ONLY = (process.argv[3] || process.env.TVG_ONLY || "").split(",").filter(Boolean);
const REPO = path.resolve(__dirname, "..", "..");
const FIXED_NOW = process.env.TVG_NOW || (new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem" }).format(new Date()) + "T20:15:00" + (/GMT+3/.test(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "short" }).format(new Date())) ? "+03:00" : "+02:00")); // היום ב-20:15 (שעון ישראל)
const SEL = ["208", "199", "3787", "3819", "3547", "334", "3588", "301", "255", "315", "559", "223"];
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const androidUA = (m) => "Mozilla/5.0 (Linux; Android 14; " + m + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DEVICES = [
  { name: "iphone_375", w: 375, h: 812, dpr: 3, ua: IPHONE_UA }, { name: "iphone_393", w: 393, h: 852, dpr: 3, ua: IPHONE_UA },
  { name: "android_360", w: 360, h: 780, dpr: 3, ua: androidUA("SM-S911B") }, { name: "android_412", w: 412, h: 839, dpr: 2.625, ua: androidUA("Pixel 7") },
].filter((d) => !ONLY.length || ONLY.some((o) => d.name.indexOf(o) === 0));
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

let pass = 0, fail = 0; const errs = [];
const A = (c, m) => { if (c) { pass++; console.log("   ok   " + m); } else { fail++; console.log("   FAIL " + m); } };

function saveClip(frames, name) { // frames -> mp4 60fps + contact sheet
  if (!frames.length) { console.log("   (no frames) " + name); return; }
  const dir = path.join(OUT, name + "_frames"); fs.mkdirSync(dir, { recursive: true });
  let list = "";
  frames.forEach((f, i) => {
    const fn = path.join(dir, String(i).padStart(4, "0") + ".jpg"); fs.writeFileSync(fn, Buffer.from(f.data, "base64"));
    const dur = i < frames.length - 1 ? Math.max(0.001, frames[i + 1].t - f.t) : 0.05;
    list += "file '" + fn.replace(/\\/g, "/") + "'\nduration " + dur.toFixed(4) + "\n";
  });
  list += "file '" + path.join(dir, String(frames.length - 1).padStart(4, "0") + ".jpg").replace(/\\/g, "/") + "'\n";
  fs.writeFileSync(path.join(dir, "list.txt"), list);
  const mp4 = path.join(OUT, name + ".mp4");
  cp.execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", "fps=60,pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p", mp4]);
  cp.execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", "fps=30,scale=120:-1,tile=15x3", "-frames:v", "1", path.join(OUT, name + "_contact.png")]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("   clip " + name + ": " + frames.length + " frames, " + (frames[frames.length - 1].t - frames[0].t).toFixed(2) + "s");
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { srv, url } = await serve();
  for (const d of DEVICES) {
    console.log("== " + d.name);
    const browser = await chromium.launch({ channel: "chrome", headless: true, args: process.env.TVG_CHROME_ARGS ? process.env.TVG_CHROME_ARGS.split(" ") : [] });
    const mk = async (extra) => {
      const ctx = await browser.newContext(Object.assign({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: d.ua, locale: "he-IL", timezoneId: "Asia/Jerusalem" }, extra || {}));
      await ctx.addInitScript((sel) => { try { if (!localStorage.getItem("tvg.sel")) { localStorage.setItem("tvg.sel", JSON.stringify(sel)); localStorage.setItem("tvg.bkAt", "1"); localStorage.setItem("tvg.v5", "1"); localStorage.setItem("tvg.theme", "light"); } } catch (e) {} }, SEL);
      await ctx.route(/tv-guide-cal\.vercel\.app/, (r) => (r.request().method() === "GET" ? r.continue() : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: "{\"ok\":true}" })));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errs.push(d.name + " pageerror: " + e));
      page.on("console", (m) => { if (m.type() === "error" && !/netflix\.json|api\/backup/.test((m.location() || {}).url || "")) errs.push(d.name + " console: " + m.text()); });
      await page.clock.setFixedTime(new Date(FIXED_NOW));
      const cdp = await ctx.newCDPSession(page);
      return { ctx, page, cdp };
    };
    const fresh = async (page, q) => { await page.goto(url + "index.html" + (q || ""), { waitUntil: "networkidle" }); await page.waitForTimeout(1000); };
    const openRem = async (page) => { await page.click('[data-tab="grid"]'); await page.waitForTimeout(500); await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(600); };
    const st = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s), r = e.getBoundingClientRect(); return { hidden: e.hidden, top: r.top, h: r.height, tr: e.style.transform, op: e.style.opacity, hist: history.state, url: location.pathname + location.search }; }, sel);

    // ---------- 1. חלון תזכורת: גרירה איטית 30% -> חוזר, זריקה -> נסגר, היסטוריה נקייה ----------
    {
      const { ctx, page, cdp } = await mk();
      await fresh(page); await openRem(page);
      const s0 = await st(page, "#rem"); A(!s0.hidden && !!(s0.hist && s0.hist.tvgLayer), "rem open, layer pushed to history");
      const cx = d.w / 2, y0 = s0.top + 14, H = s0.h;
      // א. איטית 30% בלי תנופה
      await T.startFrameLog(page, "#rem");
      const cast = await T.startCast(cdp);
      await T.drag(cdp, [[cx, y0], [cx, y0 + H * 0.3]], 700, { hold: 250 });
      const mid = await st(page, "#rem"); A(mid.tr.indexOf("translate3d") === 0, "drag follows finger (transform set while holding)");
      await T.sleep(60);
      await page.waitForTimeout(900);
      const f1 = await T.stopFrameLog(page); const fr1 = await cast.stop();
      const s1 = await st(page, "#rem"); A(!s1.hidden && s1.tr === "" && Math.abs(s1.top - s0.top) < 1, "slow 30% release: springs back open (top " + s1.top.toFixed(1) + " vs " + s0.top.toFixed(1) + ")");
      A(!!(s1.hist && s1.hist.tvgLayer), "history untouched after spring-back");
      saveClip(fr1, d.name + "_1_slow_springback");
      // רציפות: מקסימום קפיצה בין פריימים סמוכים
      const ys = f1.map((r) => r[1]); let mj = 0; for (let i = 1; i < ys.length; i++) mj = Math.max(mj, Math.abs(ys[i] - ys[i - 1]));
      A(mj < H * 0.12, "no jump between frames (max step " + mj.toFixed(1) + "px of sheet " + H.toFixed(0) + ")");
      // ב. זריקה מהירה
      await T.startFrameLog(page, "#rem");
      const cast2 = await T.startCast(cdp);
      await T.drag(cdp, [[cx, y0], [cx, y0 + 130]], 100);
      await page.waitForTimeout(900);
      const f2 = await T.stopFrameLog(page); const fr2 = await cast2.stop();
      const s2 = await st(page, "#rem"); A(s2.hidden, "fast flick: sheet closed");
      A(!s2.hist && !/rem=/.test(s2.url), "flick: history back to base (state=" + JSON.stringify(s2.hist) + ", url " + s2.url + ")");
      A(await page.evaluate(() => document.querySelector("#scrim2").hidden && document.querySelector("#scrim2").style.opacity === "" && document.querySelector("#rem").style.transform === ""), "flick: scrim hidden and styles reset");
      const ys2 = f2.map((r) => r[1]), sc2 = f2.map((r) => r[3]); A(Math.max.apply(null, ys2) > H * 0.9, "flick: exited downward (max y " + Math.max.apply(null, ys2).toFixed(0) + ")");
      A(sc2.some((v) => v < 0.6 && v > 0) , "flick: scrim faded with the drag");
      saveClip(fr2, d.name + "_2_flick_close");
      // ג. אחרי הסגירה אפשר לפתוח שוב נקי
      await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(500);
      const s3 = await st(page, "#rem"); A(!s3.hidden && s3.tr === "" && Math.abs(s3.top - s0.top) < 1, "reopen after drag-close is clean");
      // ד. Escape / כפתור סוגרים כרגיל (אותה דרך)
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      const s4 = await st(page, "#rem"); A(s4.hidden && !s4.hist, "Escape still closes, history clean");
      // ה. גרירה כלפי מעלה: גומי (לא עוזבת את המקום מעבר ל-~160px) ואז חוזר
      await page.evaluate(() => document.querySelector("[data-rem]").click()); await page.waitForTimeout(500);
      const s5 = await st(page, "#rem");
      await T.drag(cdp, [[cx, s5.top + 14], [cx, s5.top - 200]], 400, { hold: 100, release: false });
      const up = await st(page, "#rem"); const dy = /translate3d\(0px,\s*(-?[\d.]+)px/.exec(up.tr);
      A(dy && +dy[1] < 0 && +dy[1] > -120, "upward drag rubber-bands (y=" + (dy ? dy[1] : "none") + ", finger moved -214)");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(800);
      const s6 = await st(page, "#rem"); A(!s6.hidden && s6.tr === "" && Math.abs(s6.top - s5.top) < 1, "upward rubber-band springs back, stays open");
      // ו. כפתור סגירה עדיין עובד אחרי גרירות
      await page.evaluate(() => document.querySelector("[data-remclose]") && document.querySelector("[data-remclose]").click()); await page.waitForTimeout(400);
      await ctx.close();
    }

    // ---------- 2. גלילה פנימית: תוכן גלול לא מזיז את החלון; בראש התוכן - כן ----------
    {
      const { ctx, page, cdp } = await mk();
      await fresh(page); await page.click("#setBtn"); await page.waitForTimeout(700);
      const info = await page.evaluate(() => { const s = document.querySelector("#setsheet"); s.scrollTop = 240; const r = s.getBoundingClientRect(); return { top: r.top, h: r.height, sc: s.scrollTop, max: s.scrollHeight - s.clientHeight }; });
      A(info.max > 120, "settings sheet scrollable (max " + info.max + ")");
      const cx = d.w / 2, y = info.top + info.h * 0.55;
      await T.drag(cdp, [[cx, y], [cx, y + 160]], 500, { hold: 100, release: false });
      const mid = await st(page, "#setsheet"); const sc1 = await page.evaluate(() => document.querySelector("#setsheet").scrollTop);
      A(mid.tr === "", "scrollTop>0: sheet NOT moved by the drag (transform '" + mid.tr + "')");
      A(sc1 < 240, "scrollTop>0: content scrolled instead (" + 240 + " -> " + sc1 + ")");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(900);
      const sTop = await page.evaluate(() => { const s = document.querySelector("#setsheet"); s.scrollTop = 0; return s.scrollTop; });
      A(sTop === 0, "scrolled to top"); const r0 = await st(page, "#setsheet");
      await T.drag(cdp, [[cx, r0.top + r0.h * 0.5], [cx, r0.top + r0.h * 0.5 + 80]], 300, { hold: 100, release: false });
      const mid2 = await st(page, "#setsheet"); A(mid2.tr.indexOf("translate3d") === 0, "scrollTop=0 + downward drag from content moves the sheet");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(900);
      // אופקי: לא חוטף
      const r1 = await st(page, "#setsheet"); await T.drag(cdp, [[cx - 80, r1.top + r1.h * 0.5], [cx + 80, r1.top + r1.h * 0.5 + 10]], 300, { hold: 50, release: false });
      const mid3 = await st(page, "#setsheet"); A(mid3.tr === "", "horizontal swipe does not move the sheet");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(500);
      await ctx.close();
    }

    // ---------- 3. אחיזה באמצע אנימציה: ממשיך מהמקום החי (בלי קפיצה) ----------
    {
      const { ctx, page, cdp } = await mk();
      await fresh(page); await openRem(page);
      const s0 = await st(page, "#rem"), cx = d.w / 2;
      await T.drag(cdp, [[cx, s0.top + 14], [cx, s0.top + 14 + s0.h * 0.3]], 400, { hold: 80 }); // משחרר -> חוזר בקפיץ
      await page.waitForTimeout(70);
      const live = await page.evaluate(() => { const r = document.querySelector("#rem").getBoundingClientRect(); return r.top; });
      const cy = live + 14; // אוחזים בנקודה שעל החלון עכשיו
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: cy + 14, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx, y: cy + 20, id: 1 }] });
      await page.waitForTimeout(40);
      const held = await page.evaluate(() => document.querySelector("#rem").getBoundingClientRect().top);
      A(Math.abs(held - live) < s0.h * 0.12, "grab mid-animation: no snap (live " + live.toFixed(1) + " -> held " + held.toFixed(1) + ")");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(900);
      const s1 = await st(page, "#rem"); A(!s1.hidden && s1.tr === "", "after release settles open");
      await ctx.close();
    }

    // ---------- 4. הפחתת תנועה: סוגר בדעיכה, בלי קפיץ ----------
    {
      const { ctx, page, cdp } = await mk({ reducedMotion: "reduce" });
      await fresh(page); await openRem(page);
      const s0 = await st(page, "#rem"), cx = d.w / 2;
      A(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), "reduced-motion emulation active");
      await T.startFrameLog(page, "#rem");
      await T.drag(cdp, [[cx, s0.top + 14], [cx, s0.top + 14 + 110]], 90);
      await page.waitForTimeout(700);
      const f = await T.stopFrameLog(page); const s1 = await st(page, "#rem");
      A(s1.hidden && !s1.hist, "reduced-motion flick: closed, history clean");
      const ys = f.map((r) => r[1]), tail = ys.filter((v, i) => i > ys.findIndex((x) => x > 20) + 3 && v > 0);
      A(tail.length === 0 || Math.max.apply(null, tail) - Math.min.apply(null, tail) < 60, "reduced-motion: no slide-out spring after release (y span after release " + (tail.length ? (Math.max.apply(null, tail) - Math.min.apply(null, tail)).toFixed(0) : "0") + ")");
      A(f.some((r) => r[2] < 1), "reduced-motion: opacity fade used");
      // החלקה לא קופצת: בתוך dismiss מהיר בלי תנועה
      await ctx.close();
    }

    // ---------- 5. החלקת יום ----------
    {
      const { ctx, page, cdp } = await mk();
      await fresh(page); await page.click('[data-tab="grid"]'); await page.waitForTimeout(700);
      const day0 = await page.evaluate(() => TVG.day), days = await page.evaluate(() => TVG.allDays());
      const i0 = days.indexOf(day0); // היום (לא בהכרח הראשון: ימים שעברו מ-past/ לפניו)
      A(days.length >= 2 && i0 >= 0 && i0 < days.length - 1, "days available: " + days.length + ", today at " + i0);
      const midY = d.h * 0.55, wrapSel = ".list";
      // dx>0 = היום הבא (כמו תמיד)
      await T.drag(cdp, [[d.w * 0.25, midY], [d.w * 0.7, midY]], 120); await page.waitForTimeout(800);
      const day1 = await page.evaluate(() => TVG.day); A(day1 === days[i0 + 1], "swipe right (dx>0) -> next day (" + day0 + " -> " + day1 + ")");
      await T.drag(cdp, [[d.w * 0.7, midY], [d.w * 0.25, midY]], 120); await page.waitForTimeout(800);
      const day2 = await page.evaluate(() => TVG.day); A(day2 === day0, "swipe left (dx<0) -> previous day (" + day2 + ")");
      // קצה: היום הראשון, החלקה שמאלה = אין יום קודם -> גומי וחוזר
      await page.evaluate((first) => { TVG.day = first; TVG.render(); }, days[0]); await page.waitForTimeout(500);
      await T.startFrameLog(page, wrapSel);
      const cast = await T.startCast(cdp);
      await T.drag(cdp, [[d.w * 0.7, midY], [d.w * 0.15, midY]], 300, { hold: 150, release: false });
      const edge = await page.evaluate(() => { const w = document.querySelector(".list"); return { tr: w.style.transform, op: w.style.opacity }; });
      const m = /translate3d\(([-\d.]+)px/.exec(edge.tr); A(m && +m[1] < 0 && +m[1] > -110, "first day: rubber-band at the edge (x=" + (m ? m[1] : "none") + ", finger -216)");
      A(edge.op === "", "edge rubber-band does not fade the list");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(800);
      const f = await T.stopFrameLog(page), fr = await cast.stop();
      const d3 = await page.evaluate(() => ({ day: TVG.day, tr: document.querySelector(".list").style.transform })); A(d3.day === days[0] && d3.tr === "", "first day: stays, returns to rest");
      saveClip(fr, d.name + "_5_day_edge_rubber");
      // יום אחרון
      await page.evaluate((last) => { TVG.day = last; TVG.render(); }, days[days.length - 1]); await page.waitForTimeout(500);
      await T.drag(cdp, [[d.w * 0.25, midY], [d.w * 0.85, midY]], 250); await page.waitForTimeout(800);
      const d4 = await page.evaluate(() => ({ day: TVG.day, tr: document.querySelector(".list").style.transform })); A(d4.day === days[days.length - 1] && d4.tr === "", "last day: swipe right stays on last day, rubber returns");
      // החלקה עם תנופה (קצרה אבל מהירה) עוברת יום; איטית וקצרה לא
      await page.evaluate((first) => { TVG.day = first; TVG.render(); }, days[0]); await page.waitForTimeout(500);
      await T.drag(cdp, [[d.w * 0.45, midY], [d.w * 0.5, midY]], 600, { hold: 200 }); await page.waitForTimeout(600);
      A((await page.evaluate(() => TVG.day)) === days[0], "tiny slow drag does not change day");
      const cast2 = await T.startCast(cdp); await T.startFrameLog(page, wrapSel);
      await T.drag(cdp, [[d.w * 0.4, midY], [d.w * 0.6, midY]], 60); await page.waitForTimeout(900);
      const fr2 = await cast2.stop(); const f2 = await T.stopFrameLog(page);
      A((await page.evaluate(() => TVG.day)) === days[1], "short fast flick passes a day (momentum projection)");
      saveClip(fr2, d.name + "_6_day_flick");
      // גלילה אנכית לא נחסמת
      const sy0 = await page.evaluate(() => window.scrollY); await T.drag(cdp, [[d.w * 0.5, d.h * 0.8], [d.w * 0.5 + 6, d.h * 0.3]], 300); await page.waitForTimeout(600);
      A((await page.evaluate(() => window.scrollY)) > sy0 + 50, "vertical scroll still works (scrollY " + sy0 + " -> " + (await page.evaluate(() => window.scrollY)) + ")");
      await ctx.close();
    }

    // ---------- 6. נגישות: ניגודיות / שקיפות / forced-colors (צילומים) ----------
    {
      const modes = [["contrast_more", { contrast: "more" }], ["forced_colors", { forcedColors: "active" }]];
      for (const th of ["light", "dark"]) {
        for (const [nm, em] of modes) {
          const { ctx, page } = await mk();
          await fresh(page); await page.evaluate((t) => { TVG.setTheme(t); }, th); try { await page.emulateMedia(em); } catch (e) { console.log("   emulateMedia unsupported " + nm); }
          await openRem(page); await page.screenshot({ path: path.join(OUT, d.name + "_a11y_" + nm + "_" + th + "_sheet.png") });
          await page.evaluate(() => { TVG.closeTop && TVG.closeTop(); }); await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(OUT, d.name + "_a11y_" + nm + "_" + th + "_grid.png") });
          await ctx.close();
        }
        // שקיפות מופחתת: CDP
        const { ctx, page, cdp } = await mk();
        await fresh(page); await page.evaluate((t) => { TVG.setTheme(t); }, th);
        let ok = true;
        try { await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] }); } catch (e) { ok = false; }
        const on = await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches);
        console.log("   reduced-transparency emulation: cdp " + ok + ", matches " + on);
        if (on) A(await page.evaluate(() => { const s = document.querySelector("header.top"); return getComputedStyle(s).backdropFilter === "none"; }), th + ": header backdrop-filter none under reduced transparency");
        await openRem(page);
        if (on) A(await page.evaluate(() => getComputedStyle(document.querySelector("#rem")).backdropFilter === "none"), th + ": sheet backdrop-filter none under reduced transparency");
        await page.screenshot({ path: path.join(OUT, d.name + "_a11y_reduced_transparency_" + th + "_sheet.png") });
        await ctx.close();
      }
    }
    await browser.close();
  }
  srv.close();
  console.log("\nfluid: pass " + pass + " fail " + fail + " | console/page errors: " + errs.length);
  errs.slice(0, 10).forEach((e) => console.log("  " + e));
  process.exit(fail || errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
