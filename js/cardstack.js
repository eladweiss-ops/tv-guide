/* js/cardstack.js - "החלון הקופץ דוחף את הדף אחורה" (כמו חלון מוצג באפל): כשחלון תחתון נפתח, כל הדף (כותרת + תוכן + שורת הלשוניות)
   מצטמצם ל-0.94, יורד 10px ונהיה כרטיס עם פינות מעוגלות, ומסביבו נחשף רקע כהה. בסגירה חוזר. חלק ממרחב השמות TVG. נטען אחרי: nav, sheetdrag, motion.
   מבנה (למה זה לא שובר אלמנטים קבועים):
   - מזיזים רק את .page (כותרת + תוכן; מתגלל עם החלון, לכן transform-origin = מרכז המסך בקואורדינטות של הדף, ומתעדכן בגלילה) ואת .dock (קבוע;
     אותו transform ואותו מרכז מסך). .sheet / .scrim / .pill / #ptyGo הם אחים של .page ב-body, לא בתוכו: transform לא נוגע בהם.
   - הכרטיס המעוגל והרקע הכהה = אלמנט אחד קבוע (#stkf) בלי תוכן, עם box-shadow ענק שצובע את כל מה שמחוץ לכרטיס ("טבעת"), באותו transform ורדיוס.
     אין clip-path ואין רקע על .page, והכתמים הצבעוניים ברקע (body::before/after) נשארים בתוך הכרטיס כמו קודם.
   - הרקע הכהה (scrim) קיים והוא זה שמעמעם; לא מוסיפים עמעום משלנו.
   קפיץ: TVG.spring (response .35, damping 1.0), מתחיל מהערך החי ומהמהירות החיה, לכן אפשר להפוך כיוון באמצע (פתיחה/סגירה/פתיחה).
   חיבור לגרירה: sheetdrag.js קורא TVG.onSheetDrag(el, p) (p = 0..1 כמה החלון ירד) ו-TVG.onSheetSettle(el): הרקע חוזר ל-1 ביחס ישר ל-p.
   חלון מעל חלון: רק הדף מצטמצם; החלון התחתון מצטמצם עדין ל-0.97 (המאפיין scale, לא מתנגש ב-transform של הגרירה).
   יציאת החלון: רוח רפאים חזותית (ראו ghostOut). הפחתת תנועה: אין שינוי גודל בכלל (נשאר רק הרקע הכהה הקיים). כניסת החלון (WAAPI): החלקה מלמטה + דעיכת scrim; מתבטלת ברגע שאוחזים בחלון. */
(function (TVG) {
  TVG.files["cardstack"] = 1;
  var $ = TVG.$;
  var SCALE = 0.06, LIFT = 10, RADIUS = 22, LOW = 0.03;      // 0.94 / +10px / פינות 22 / החלון התחתון 0.97
  var RESP = 0.35, DAMP = 1.0;
  var EASE_IN = "cubic-bezier(.32,.72,0,1)";
  var page = null, dock = null, frame = null;
  var amt = 0, amt2 = 0, p = 0, count = 0;     // amt: הדף אחורה (0..1), amt2: חלון תחתון אחורה, p: התקדמות הגרירה של החלון העליון
  var v1 = 0, v2 = 0, s1 = null, s2 = null;
  var lowEls = [], on = false, ent = null, scrimEnt = null;
  var vw = 0, vh = 0, fx = [];

  function reduced() { return TVG.reducedMotion(); }
  function openSheets() { return Array.prototype.slice.call(document.querySelectorAll(".sheet:not([hidden]):not(.sgh)")); }
  function topSheet(list) { var t = TVG.topLayerEl && TVG.topLayerEl(); return t && !t.hidden && /(^|\s)sheet(\s|$)/.test(t.className) ? t : list[list.length - 1] || null; }

  function setOrigin() { // מרכז המסך בקואורדינטות של .page (הוא מתגלל עם החלון)
    vw = document.documentElement.clientWidth; vh = window.innerHeight;
    page.style.transformOrigin = (vw / 2 - page.offsetLeft) + "px " + ((window.pageYOffset || 0) + vh / 2 - page.offsetTop) + "px";
  }
  function setDockOrigin() { // אלמנטים קבועים (שורת הלשוניות, הכותרת הקטנה): מודדים בלי transform (פעם אחת בהפעלה)
    fx = [dock, document.getElementById("cbar")].filter(Boolean);
    fx.forEach(function (el) {
      var t = el.style.transform; el.style.transform = ""; var r = el.getBoundingClientRect(); el.style.transform = t;
      el.style.transformOrigin = (vw / 2 - r.left) + "px " + (vh / 2 - r.top) + "px";
    });
  }
  function activate() {
    if (on) return; on = true;
    document.documentElement.classList.add("stk");
    setOrigin(); setDockOrigin(); frame.hidden = false;
  }
  function deactivate() {
    if (!on) return; on = false;
    document.documentElement.classList.remove("stk");
    page.style.transform = ""; page.style.transformOrigin = "";
    fx.forEach(function (el) { el.style.transform = ""; el.style.transformOrigin = ""; }); fx = [];
    frame.hidden = true; frame.style.transform = ""; frame.style.borderRadius = "";
    lowEls.forEach(function (e) { e.style.scale = ""; }); lowEls = [];
  }

  function render() {
    var e = count >= 2 ? amt : amt * (1 - p), lo = amt2 * (count >= 2 ? 1 - p : 1);
    if (e < 0.001 && lo < 0.001 && amt < 0.001 && amt2 < 0.001 && count === 0) { deactivate(); return; }
    if (!on) activate();
    if (e < 0) e = 0;
    var t = "translate3d(0," + (LIFT * e).toFixed(2) + "px,0) scale(" + (1 - SCALE * e).toFixed(4) + ")";
    page.style.transform = t; frame.style.transform = t;
    for (var j = 0; j < fx.length; j++) fx[j].style.transform = t;
    frame.style.borderRadius = (RADIUS * Math.min(e, 1)).toFixed(2) + "px";
    var ls = lo > 0.001 ? String((1 - LOW * lo).toFixed(4)) : "";
    for (var i = 0; i < lowEls.length; i++) lowEls[i].style.scale = ls;
  }

  function go(which, to) { // קפיץ לערך חדש, מהערך והמהירות החיים
    if (which === 1) {
      if (s1) s1.stop();
      s1 = TVG.spring({ from: amt, to: to, v: v1, response: RESP, damping: DAMP, eps: 0.002, update: function (x, v) { amt = x; v1 = v; render(); }, done: function () { amt = to; v1 = 0; s1 = null; render(); } });
    } else {
      if (s2) s2.stop();
      s2 = TVG.spring({ from: amt2, to: to, v: v2, response: RESP, damping: DAMP, eps: 0.002, update: function (x, v) { amt2 = x; v2 = v; render(); }, done: function () { amt2 = to; v2 = 0; s2 = null; render(); } });
    }
  }

  // ---- מצב: כמה חלונות פתוחים ----
  function sync() {
    var list = openSheets(), n = list.length, was = count;
    if (reduced()) { count = n; amt = amt2 = p = 0; if (s1) s1.stop(); if (s2) s2.stop(); s1 = s2 = null; deactivate(); return; }
    if (n < was && p > 0) { if (was >= 2) amt2 *= 1 - p; else amt *= 1 - p; } // החלון העליון יצא באמצע גרירה: מקפלים את ההתקדמות לערך החי
    p = 0; count = n;
    if (n >= 2) { var tp = topSheet(list); lowEls = list.filter(function (e) { return e !== tp; }); }
    if (n === 0 && !s1 && amt === 0) { render(); return; }
    go(1, n >= 1 ? 1 : 0); go(2, n >= 2 ? 1 : 0);
    render();
  }
  var q = false;
  function schedule() { if (q) return; q = true; Promise.resolve().then(function () { Promise.resolve().then(function () { q = false; sync(); }); }); } // אחרי שכבת הניווט (nav.js) מעדכנת את סדר החלונות

  // ---- כניסת החלון: החלקה מלמטה + scrim דועך (WAAPI: לא מתנגש ב-style.transform של הגרירה, ומתבטל ברגע שאוחזים) ----
  function cancelEnt() {
    if (ent) { try { ent.a.cancel(); } catch (e) {} ent = null; }
    if (scrimEnt) { try { scrimEnt.cancel(); } catch (e) {} scrimEnt = null; }
  }
  function enter(el) {
    if (reduced() || !el.animate) return;
    cancelEnt();
    try {
      var a = el.animate([{ transform: "translate3d(0,calc(100% + 24px),0)" }, { transform: "translate3d(0,0,0)" }], { duration: 440, easing: EASE_IN });
      ent = { el: el, a: a }; a.onfinish = a.oncancel = function () { if (ent && ent.a === a) ent = null; };
    } catch (e) {}
  }
  function scrimIn(s) {
    if (reduced() || !s.animate) return;
    try { var a = scrimEnt = s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" }); a.onfinish = a.oncancel = function () { if (scrimEnt === a) scrimEnt = null; }; } catch (e) {}
  }

  // ---- יציאת החלון (סגירה שאינה גרירה: כפתור, Escape, חזור, הקשה על ה-scrim) ----
  // החלון האמיתי נסגר מיד, בדיוק כמו קודם (hidden=true דרך אותו מסלול: nav.js, היסטוריה, sheetdrag, scrim - שום מצב לא מתעכב).
  // לפני כן מצלמים "רוח רפאים" (#sgh): עותק חזותי בלבד (בלי id, inert, בלי לחיצות) באותו מקום בדיוק, שיורד בקפיץ (response .3, damping 1)
  // וה-scrim דועך בסנכרון, ובינתיים הדף חוזר (cardstack). פתיחה חדשה באמצע יציאה מסלקת את הרוח מיד. הפחתת תנועה: דעיכה של 140ms.
  var hidDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden"), ghosts = [];
  function killGhost(el) {
    for (var i = ghosts.length - 1; i >= 0; i--) if (ghosts[i].src === el) { ghosts[i].stop(); ghosts.splice(i, 1); }
  }
  function ghostOut(el, isScrim) {
    var cs = getComputedStyle(el), r = el.getBoundingClientRect(), op = parseFloat(cs.opacity);
    if (!r.height || !(op > 0.02)) return;                                   // כבר דעך (גרירה/הפחתת תנועה של sheetdrag)
    if (!isScrim && r.top >= window.innerHeight - 2) return;                  // כבר מחוץ למסך (נסגר בגרירה)
    killGhost(el);
    var g = el.cloneNode(true), all = g.querySelectorAll("[id]"), i, rm = reduced();
    for (i = 0; i < all.length; i++) all[i].removeAttribute("id"); g.removeAttribute("id");
    g.classList.add("sgh"); g.setAttribute("aria-hidden", "true"); g.setAttribute("inert", ""); g.style.pointerEvents = "none"; g.style.transition = "none"; g.style.animation = "none";
    var m = /matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+)\)/.exec(cs.transform), y0 = m ? parseFloat(m[1]) : 0;
    g.style.transform = cs.transform === "none" ? "" : cs.transform; g.style.opacity = String(op);
    var a = el.querySelectorAll("*"); document.body.appendChild(g);
    var b = g.querySelectorAll("*"); if (el.scrollTop) g.scrollTop = el.scrollTop;
    for (i = 0; i < a.length; i++) if (a[i].scrollTop) b[i].scrollTop = a[i].scrollTop;
    var h = { src: el, sp: null, wa: null, stop: function () { if (h.sp) h.sp.stop(); if (h.wa) { try { h.wa.cancel(); } catch (e) {} } if (g.parentNode) g.parentNode.removeChild(g); } };
    ghosts.push(h);
    function end() { var k = ghosts.indexOf(h); if (k >= 0) ghosts.splice(k, 1); h.stop(); }
    if (rm || !g.animate) { try { h.wa = g.animate([{ opacity: op }, { opacity: 0 }], { duration: 140, easing: "linear", fill: "forwards" }); h.wa.onfinish = end; } catch (e) { end(); } return; }
    var off = window.innerHeight - (r.top - y0) + 6;
    h.sp = TVG.spring({ from: isScrim ? 0 : y0, to: isScrim ? 1 : off, v: 0, response: 0.3, damping: 1.0, eps: isScrim ? 0.002 : 0.4,
      update: function (x) { if (isScrim) g.style.opacity = String((op * (1 - x)).toFixed(3)); else g.style.transform = "translate3d(0," + x.toFixed(2) + "px,0)"; },
      done: end });
  }
  function patchHidden(el, isScrim) {
    if (!hidDesc || !hidDesc.get || !hidDesc.set) return;
    Object.defineProperty(el, "hidden", { configurable: true, enumerable: true,
      get: function () { return hidDesc.get.call(this); },
      set: function (v) {
        var was = hidDesc.get.call(this);
        if (v && !was) { if (isScrim ? scrimEnt : ent && ent.el === this) cancelEnt(); try { ghostOut(this, isScrim); } catch (e) {} } else if (!v && was) killGhost(this);
        hidDesc.set.call(this, v);
      } });
  }
  // sheetdrag.js מבקש: אוחזים בחלון באמצע הכניסה -> המיקום החי (translateY) והפסקת האנימציה, כדי שהגרירה תתחיל משם בלי קפיצה
  TVG.sheetEnterLive = function (el) {
    if (!ent || ent.el !== el) return 0;
    var m = /matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([-\d.]+)\)/.exec(getComputedStyle(el).transform), y = m ? parseFloat(m[1]) : 0;
    cancelEnt(); return y;
  };

  // ---- הקרסים של sheetdrag.js ----
  TVG.onSheetDrag = function (el, prog) {
    if (ent && ent.el === el) cancelEnt();
    if (el.hidden || count < 1 || !on) return;
    p = prog < 0 ? 0 : prog > 1 ? 1 : prog; render();
  };
  TVG.onSheetSettle = function (el) { if (!el.hidden && p) { p = 0; render(); } };

  function init() {
    page = document.querySelector(".page"); dock = document.querySelector(".dock"); if (!page || !dock) return;
    frame = document.createElement("div"); frame.id = "stkf"; frame.hidden = true; frame.setAttribute("aria-hidden", "true"); document.body.appendChild(frame);
    Array.prototype.forEach.call(document.querySelectorAll(".sheet"), function (e) { patchHidden(e, false); });
    Array.prototype.forEach.call(document.querySelectorAll(".scrim"), function (e) { patchHidden(e, true); });
    var mo = new MutationObserver(function (recs) {
      var chg = false;
      for (var i = 0; i < recs.length; i++) {
        var t = recs[i].target; if (!t.classList) continue;
        if (t.classList.contains("sheet")) {
          chg = true;
          if (!t.hidden && recs[i].oldValue !== null) enter(t); // נפתח עכשיו
        } else if (t.classList.contains("scrim") && !t.hidden && recs[i].oldValue !== null) scrimIn(t);
      }
      if (chg) schedule();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true, subtree: true });
    window.addEventListener("scroll", function () { if (on) setOrigin(); }, { passive: true });
    window.addEventListener("resize", function () { if (on) { setOrigin(); setDockOrigin(); render(); } });
    sync();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(window.TVG);
