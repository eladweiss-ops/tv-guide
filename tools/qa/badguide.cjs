/* tools/qa/badguide.cjs – "לוח פגום": נתון זמני מבחוץ לא משנה הגדרה שמורה של המשתמש.
 *   node tools/qa/badguide.cjs
 * תרחיש תקלת 28.11: וואלה הפיל את ספורט 3/4 ליום אחד. האפליקציה מחקה אותם לתמיד מהערוצים שנבחרו, וכך הוחמץ משחק חי של מכבי חיפה.
 * הבדיקה מגישה לוח בלי ספורט 3/4, ואז לוח מלא, ומוודאת: הבחירה נשמרת, שינוי ערוצים ביום הנפילה לא מוחק, הערוץ חוזר לבד.
 * יוצאת עם 1 בכשל. דפדפן אחד (Chrome מותקן). */
const path = require("path"), fs = require("fs"), http = require("http");
const REPO = path.resolve(__dirname, "..", "..");
const { chromium } = require("playwright-core");
const DROP_IDS = ["3761", "3762", "3763"];
let DROP = false;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(REPO, p);
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("nf"); }
  res.setHeader("Cache-Control", "no-store");
  if (p === "/guide.json" && DROP) {
    const g = JSON.parse(fs.readFileSync(f, "utf8"));
    g.channels = g.channels.filter((c) => !DROP_IDS.includes(c.id)); g.programs = g.programs.filter((x) => !DROP_IDS.includes(x.ch));
    res.setHeader("Content-Type", MIME[".json"]); return res.end(JSON.stringify(g));
  }
  res.setHeader("Content-Type", MIME[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(0, "127.0.0.1", async () => {
  const url = "http://127.0.0.1:" + srv.address().port + "/";
  const g0 = JSON.parse(fs.readFileSync(path.join(REPO, "guide.json"), "utf8"));
  if (!DROP_IDS.some((id) => g0.channels.some((c) => c.id === id))) { console.log("SKIP: ספורט 3/4 לא בלוח הנוכחי, אין מה לבדוק"); srv.close(); return; }
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await b.newContext({ timezoneId: "Asia/Jerusalem" });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  await pg.route(/vercel\.app/, (r) => r.fulfill({ status: 200, body: "{}" }));
  await pg.addInitScript(() => { if (!localStorage.getItem("tvg.sel")) localStorage.setItem("tvg.sel", JSON.stringify(["208", "199", "3761", "3763"])); });
  const boot = async () => { await pg.goto(url); await pg.waitForFunction(() => window.TVG && TVG.booted && TVG.by && TVG.by.size > 0, null, { timeout: 30000 }); };
  const ls = () => pg.evaluate(() => JSON.parse(localStorage.getItem("tvg.sel")));
  let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  try {
    DROP = true; await boot();
    let s = await ls();
    ok(s.includes("3761") && s.includes("3763"), "יום נפילה: ספורט 3/4 נשארים בבחירה השמורה");
    await pg.evaluate(() => { TVG.sel.add("223"); TVG.saveSel(); });
    s = await ls(); ok(s.includes("3761") && s.includes("223"), "שינוי ערוצים ביום נפילה לא מוחק את ספורט 3");
    DROP = false; await boot();
    ok(await pg.evaluate(() => TVG.sel.has(TVG.IDMAP["3761"] || "3761")), "למחרת: ספורט 3 חוזר לבד לערוצים שלי");
    ok(!errs.length, "בלי שגיאות JS " + errs.join(" | "));
  } catch (e) { ok(false, "חריגה: " + e.message); }
  await b.close(); srv.close();
  process.exitCode = fail ? 1 : 0;
});
