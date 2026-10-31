#!/usr/bin/env node
/*
 * יוצר את og-image.png (1200x630): הכרטיס שוואטסאפ מציג מעל הקישור. נראה ככפתור גדול אחד ללחיצה (האתר סטטי: אותה תמונה לכל הקישורים).
 *   node tools/og/make-og.cjs            (כותב ל-og-image.png בשורש הפרויקט)
 *   node tools/og/make-og.cjs join       (כותב ל-og-join.png: התמונה של קישור ההזמנה לאפליקציה, join/)
 * דורש Chrome מותקן ו-playwright-core (cd tools/qa && npm install), ורשת (גופן Heebo מ-Google Fonts; בלי רשת נופל לגופן מערכת).
 */
const fs = require("fs"), path = require("path");
const { chromium } = require(path.join(__dirname, "..", "qa", "node_modules", "playwright-core"));
const REPO = path.resolve(__dirname, "..", "..");
const icon = "data:image/png;base64," + fs.readFileSync(path.join(REPO, "icon-192.png")).toString("base64");

const JOIN = process.argv[2] === "join";
const bodyShare = `
  <div class="brand"><img src="${icon}" alt=""><span>לוח שידורים</span></div>
  <div class="btn"><div class="big"><i>📅</i>לחצו לשמירה ביומן</div><div class="sub">פרטי התוכנית, תזכורת והוספה ליומן</div></div>
  <div class="hand">👆</div>`;
const bodyJoin = `
  <div class="jwrap">
    <img class="jicon" src="${icon}" alt="">
    <div class="jtxt"><div class="jname">לוח שידורים</div><div class="jline">כל הערוצים. מסך אחד.</div></div>
  </div>
  <div class="jchips"><span>⏰ תזכורת לפני השידור</span><span>📺 מעקב אחרי סדרות</span><span>🍿 נטפליקס וערב צפייה</span></div>
  <div class="jcta">חינם · בלי הרשמה · לחצו להתחלה 👆</div>`;
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@500;600;800;900&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body { font-family: Heebo, "Segoe UI", Arial, sans-serif; position: relative; color: #fff;
    background: radial-gradient(900px 520px at 85% -10%, #3a3f78 0%, rgba(58,63,120,0) 70%), radial-gradient(800px 500px at 0% 110%, #2b2350 0%, rgba(43,35,80,0) 70%), #14151d; }
  .brand { position: absolute; top: 44px; right: 56px; display: flex; align-items: center; gap: 18px; }
  .brand img { width: 84px; height: 84px; border-radius: 22px; box-shadow: 0 10px 26px rgba(0,0,0,.45); }
  .brand span { font-size: 40px; font-weight: 800; color: rgba(255,255,255,.88); }
  .btn { position: absolute; left: 56px; right: 56px; top: 168px; height: 330px; border-radius: 96px;
    background: linear-gradient(180deg, #FFB340 0%, #FF9F0A 45%, #FF7A00 100%);
    box-shadow: 0 34px 70px rgba(255,122,0,.42), 0 10px 0 #C95F00, inset 0 3px 0 rgba(255,255,255,.55), inset 0 -10px 24px rgba(160,60,0,.25);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
  .btn::before { content: ""; position: absolute; left: 34px; right: 34px; top: 14px; height: 120px; border-radius: 80px 80px 140px 140px / 80px 80px 60px 60px; background: linear-gradient(180deg, rgba(255,255,255,.38), rgba(255,255,255,0)); }
  .big { position: relative; font-size: 94px; font-weight: 900; line-height: 1.15; text-shadow: 0 4px 0 rgba(150,60,0,.35); white-space: nowrap; }
  .big i { font-style: normal; margin-left: 16px; }
  .sub { position: relative; font-size: 38px; font-weight: 600; color: rgba(255,255,255,.96); text-shadow: 0 2px 0 rgba(150,60,0,.3); }
  .hand { position: absolute; left: 120px; bottom: 30px; font-size: 64px; }
  .jwrap { position: absolute; top: 70px; right: 64px; left: 64px; display: flex; align-items: center; gap: 40px; }
  .jicon { width: 190px; height: 190px; border-radius: 46px; box-shadow: 0 18px 40px rgba(0,0,0,.5); flex: none; }
  .jname { font-size: 92px; font-weight: 900; line-height: 1.05; }
  .jline { font-size: 50px; font-weight: 600; color: rgba(255,255,255,.82); margin-top: 6px; }
  .jchips { position: absolute; top: 318px; right: 64px; left: 64px; display: flex; gap: 14px; justify-content: space-between; }
  .jchips span { font-size: 29px; font-weight: 700; padding: 14px 20px; border-radius: 999px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16); white-space: nowrap; }
  .jcta { position: absolute; left: 64px; right: 64px; bottom: 56px; height: 128px; border-radius: 64px; display: flex; align-items: center; justify-content: center; font-size: 52px; font-weight: 900;
    background: linear-gradient(180deg, #FFB340 0%, #FF9F0A 45%, #FF7A00 100%); box-shadow: 0 24px 50px rgba(255,122,0,.4), 0 8px 0 #C95F00, inset 0 3px 0 rgba(255,255,255,.5); text-shadow: 0 3px 0 rgba(150,60,0,.35); }
</style></head><body>${JOIN ? bodyJoin : bodyShare}
</body></html>`;

(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const pg = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await pg.setContent(html, { waitUntil: "networkidle" });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(REPO, JOIN ? "og-join.png" : "og-image.png") });
  await b.close();
  console.log((JOIN ? "og-join.png" : "og-image.png") + " written");
})();
