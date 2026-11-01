/* js/largetitle.js - כותרת גדולה שמתכווצת בגלילה (כמו באפל) + סרגל קומפקטי בדף התוכן של נטפליקס. חלק ממרחב השמות TVG. נטען אחרי: nav.
   א. דפי המסכים: הכותרת הגדולה (#ttl) מצטמצמת ודועכת בגלילה 0..60px, וכותרת קטנה (17px, 600) באותו טקסט, ממורכזת, דועכת פנימה (#cbar).
      רק transform + opacity (בלי לגעת בפריסה). הכפתורים (≡ ☆ ⚙) נשארים במקום; הכותרת הקטנה זזה הצידה רק כמה שצריך כדי לא לגעת בהם.
      הסרגל השקוף (רקע + טשטוש + קו תחתון) דועך פנימה ביחד עם הכותרת - רק כשיש תוכן מתחתיו (header.top::before עם --cp).
      בלשונית "היום" הכותרת העליונה לא צמודה (css), לכן שם הסרגל הקומפקטי הוא אלמנט קבוע משלו.
   ב. דף תוכן נטפליקס (#nfsheet): בגלילת התוכן תמונת הראש זזה לאט מהתוכן (פרלקסה), ומופיע סרגל קומפקטי בראש החלון עם שם התוכן (#nfcb).
      סרגל הכפתורים התחתון הקבוע לא נוגע.
   גלילה: מאזין passive אחד, עדכון ב-rAF אחד לפריים. הפחתת תנועה: מעבר מיידי בסף (30px), בלי אינטרפולציה. */
(function (TVG) {
  TVG.files["largetitle"] = 1;
  var $ = TVG.$;
  var RANGE = 60, RM_AT = 30, NF_RANGE = 36, NF_BAR = 56;
  var ttl, head, hb, bar, bt, hdr, dial = false;
  var lastP = -1, lastNf = -1, rafId = 0, nfEl = null, nfBar = null, nfImgEl = null, nfTxt = "";

  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function q(x) { return Math.round(x * 500) / 500; } // לא כותבים סגנון על שינוי זעיר

  // ---- א. כותרת מסך ----
  function measure() { // אחרי שינוי טקסט/כיוון/גודל מסך: מיקום הכותרת הקטנה. קריאות פריסה כאן בלבד, לא בגלילה
    if (!bar) return;
    var txt = ttl.textContent; if (bt.textContent !== txt) bt.textContent = txt;
    var vw = document.documentElement.clientWidth, hr = hb.getBoundingClientRect(), free0 = hr.right + 12, free1 = vw - 16;
    bt.style.maxWidth = Math.max(60, free1 - free0) + "px";
    var w = bt.scrollWidth, c = vw / 2;
    if (c - w / 2 < free0) c = free0 + w / 2;
    if (c + w / 2 > free1) c = (free0 + free1) / 2;
    bt.style.left = c.toFixed(1) + "px";
    var hrct = head.getBoundingClientRect(), top0 = hdr.getBoundingClientRect().top;
    bar.style.setProperty("--cy", (hrct.top - top0 + hrct.height / 2).toFixed(1) + "px");
  }
  function apply() {
    rafId = 0;
    var sy = window.pageYOffset || 0, rm = TVG.reducedMotion(), p;
    if (rm) p = sy >= RM_AT ? 1 : 0; else p = clamp(sy / RANGE);
    p = q(p);
    var d = document.body.classList.contains("tab-dial"); if (d !== dial) { dial = d; lastP = -1; }
    if (p !== lastP) {
      lastP = p;
      var big = rm ? (p ? 0 : 1) : 1 - clamp(p / 0.5), small = rm ? p : clamp((p - 0.35) / 0.4); // חפיפה קלה: אין רגע שבו שתיהן עמומות
      ttl.style.opacity = big === 1 ? "" : String(q(big));
      ttl.style.transform = rm || p === 0 ? "" : "translate3d(0," + (-6 * p).toFixed(2) + "px,0) scale(" + (1 - 0.28 * p).toFixed(3) + ")";
      hdr.style.setProperty("--cp", String(q(rm ? p : clamp(p / 0.5))));
      // בלשונית "היום" הכותרת העליונה מתגללת החוצה: הסרגל הקבוע מופיע כשהיא כבר כמעט איננה
      var bp = dial ? (rm ? (sy >= 56 ? 1 : 0) : clamp((sy - 34) / 28)) : 1;
      bar.style.opacity = dial ? String(q(bp)) : small === 0 ? "0" : "1";
      bt.style.opacity = String(q(small)); bt.style.transform = "translate3d(-50%," + ((1 - small) * 7).toFixed(2) + "px,0)";
    }
    nfUpdate();
  }
  function onScroll(e) {
    if (rafId) return;
    rafId = window.requestAnimationFrame ? window.requestAnimationFrame(apply) : setTimeout(apply, 16);
  }

  // ---- ב. דף תוכן נטפליקס ----
  function nfUpdate() {
    var body = $("#nfsBody"), sh = $("#nfsheet"); if (!body || !sh || sh.hidden) { if (lastNf !== 0) nfReset(); return; }
    var st = body.scrollTop, h2 = body.querySelector("#nfsT"), img = body.querySelector(".nfbd img");
    if (nfBar && h2) { var tx = h2.textContent; if (tx !== nfTxt) { nfTxt = tx; nfBar.firstChild.textContent = tx; } }
    var rm = TVG.reducedMotion();
    if (img) {
      var t = st > 0 ? "translate3d(0," + (st * 0.5).toFixed(1) + "px,0)" : st < 0 ? "scale(" + (1 - st / 240).toFixed(3) + ")" : "";
      if (rm) t = "";
      if (img !== nfImgEl) { nfImgEl = img; img.style.transformOrigin = "50% 0"; }
      img.style.transform = t;
    }
    var t0 = 0; // רגע שבו שם התוכן מגיע מתחת לסרגל
    if (h2) t0 = h2.getBoundingClientRect().top - body.getBoundingClientRect().top + st - NF_BAR + 10;
    var np = rm ? (st >= t0 && t0 > 0 ? 1 : 0) : clamp((st - t0) / NF_RANGE);
    np = q(np);
    if (np !== lastNf) { lastNf = np; nfBar.style.opacity = String(np); nfBar.style.visibility = np === 0 ? "hidden" : "visible"; nfBar.style.transform = "translate3d(0," + ((1 - np) * -8).toFixed(2) + "px,0)"; if (rm) nfBar.style.transform = ""; }
  }
  function nfReset() { lastNf = 0; if (nfBar) { nfBar.style.opacity = "0"; nfBar.style.visibility = "hidden"; } nfEl = null; nfImgEl = null; nfTxt = ""; }

  function init() {
    ttl = $("#ttl"); hdr = document.querySelector("header.top"); head = document.querySelector("header.top .head"); hb = document.querySelector("header.top .hb");
    if (!ttl || !hdr || !head || !hb) return;
    bar = document.createElement("div"); bar.id = "cbar"; bar.setAttribute("aria-hidden", "true");
    bt = document.createElement("span"); bt.className = "cbt"; bar.appendChild(bt); document.body.appendChild(bar);
    var sh = $("#nfsheet");
    if (sh) { nfBar = document.createElement("div"); nfBar.id = "nfcb"; nfBar.setAttribute("aria-hidden", "true"); var sp = document.createElement("span"); sp.setAttribute("dir", "auto"); nfBar.appendChild(sp); sh.insertBefore(nfBar, sh.firstChild); }
    try { new MutationObserver(function () { measure(); lastP = -1; onScroll(); }).observe(ttl, { childList: true, characterData: true, subtree: true }); } catch (e) {}
    if (sh) {
      try { new MutationObserver(function () { lastNf = -1; nfUpdate(); }).observe($("#nfsBody"), { childList: true }); } catch (e) {}
      try { new MutationObserver(function () { lastNf = -1; nfUpdate(); }).observe(sh, { attributes: true, attributeFilter: ["hidden"] }); } catch (e) {}
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", function (e) { if (e.target && e.target.id === "nfsBody") onScroll(e); }, { capture: true, passive: true });
    window.addEventListener("resize", function () { measure(); lastP = -1; onScroll(); });
    measure(); apply();
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); }); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  TVG.largeTitleUpdate = function () { measure(); lastP = -1; onScroll(); };
})(window.TVG);
