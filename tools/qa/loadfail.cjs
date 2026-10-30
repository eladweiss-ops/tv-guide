#!/usr/bin/env node
/*
 * Checks the load-failure recovery in index.html:  node tools/qa/loadfail.cjs [outDir]
 *  1. js/search.js returns 404 once  -> one automatic refresh (?r2=) and the app comes up.
 *  2. js/search.js always 404        -> one refresh, then the Hebrew "נסו שוב" screen.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright-core");
const REPO = path.resolve(__dirname, "..", "..");
const OUT = path.resolve(process.argv[2] || "loadfail"); fs.mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/json" };
let mode = "once", hits = 0;
const srv = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (u === "/js/search.js") { hits++; if (mode === "always" || hits === 1) { res.statusCode = 404; return res.end("nf"); } }
  const f = path.join(REPO, decodeURIComponent(u === "/" ? "/index.html" : u));
  if (!f.startsWith(REPO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("nf"); }
  res.setHeader("Content-Type", MIME[path.extname(f)] || "application/octet-stream"); res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(f).pipe(res);
}).listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const b = await chromium.launch({ channel: "chrome", headless: true });
  let ok = true; const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) ok = false; };
  for (const m of ["once", "always"]) {
    mode = m; hits = 0;
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, locale: "he-IL" });
    await ctx.addInitScript(() => { try { if (!localStorage.getItem("tvg.sel")) { localStorage.setItem("tvg.sel", JSON.stringify(["208", "199", "3787"])); localStorage.setItem("tvg.bkAt", "1"); } } catch (e) {} });
    const p = await ctx.newPage();
    await p.goto(base + "index.html", { waitUntil: "networkidle" }); await p.waitForTimeout(2500);
    const st = await p.evaluate(() => ({ url: location.href, booted: !!window.TVG.booted, retry: !!document.getElementById("tvgRetry"), text: document.body.innerText.slice(0, 60) }));
    console.log(m, JSON.stringify(st), "search.js hits:", hits);
    await p.screenshot({ path: path.join(OUT, "loadfail_" + m + ".png") });
    if (m === "once") { check(/r2=/.test(st.url) && st.booted && !st.retry, "one 404 -> auto refresh with ?r2= and app boots"); }
    else { check(/r2=/.test(st.url) && !st.booted && st.retry, "persistent 404 -> one refresh, then 'נסו שוב' screen (no loop)"); check(hits === 2, "exactly 2 attempts"); }
    await ctx.close();
  }
  await b.close(); srv.close(); process.exit(ok ? 0 : 1);
});
