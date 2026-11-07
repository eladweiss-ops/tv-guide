/* js/sheetdrag.js - גרירה לסגירה של כל החלונות התחתונים (.sheet): תזכורת, נודניק, שיתוף, הזמנה, מעקב, דף נטפליקס, הגדרות...
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: nav (וגם motion.js).
   איך זה עובד: Pointer Events + setPointerCapture. גוררים מרצועת האחיזה העליונה (TOP פיקסלים) תמיד, ומהתוכן רק כשהוא בראשו (scrollTop 0) והגרירה כלפי מטה.
   מעל ~10px נועלים כיוון: אופקי / גלילה פנימית עוברים לדפדפן. עוקבים אחרי האצבע 1:1 (בלי קפיצה: הנקודה בה נעלנו היא אפס).
   שחרור: הקרנת תנופה (TVG.project). חצתה ~40% מגובה החלון, או מהירות כלפי מטה מעל 800px/s -> יוצא מטה בקפיץ; אחרת חוזר בקפיץ.
   יציאה = TVG.closeTop() (אותה סגירה כמו Escape / "חזור" / כפתור: close של השכבה ב-nav.js, ההיסטוריה מתנקה שם), רק אחרי שהחלון יצא מהמסך.
   הקרסים TVG.onSheetDrag(el, p) / TVG.onSheetSettle(el) מעדכנים את cardstack.js (הדף שמאחור). הרקע הכהה (scrim) דועך עם הגרירה. בהפחתת תנועה: בלי קפיץ, דעיכת שקיפות קצרה. אפשר לאחוז באמצע אנימציה: ממשיכים מהמקום החי. */
(function (TVG) {
  TVG.files["sheetdrag"] = 1;
  var $ = TVG.$;
  var TOP = 28, SLOP = 10, FLICK = 800, FRAC = 0.4;
  var d = null;     // גרירה ממתינה / פעילה
  var an = null;    // אנימציה פעילה {el, h, y, kind, to}
  var cur = null;   // החלון שמוזז כרגע: {el, y}

  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function scrimOf(el) { return $(el.id === "sheet" ? "#scrim" : "#scrim2"); }
  function alone() { return document.querySelectorAll(".sheet:not([hidden]):not(.sgh)").length < 2; } // יש חלון נוסף מתחת? אז הרקע המשותף לא דועך
  function setY(el, y) {
    var H = el.offsetHeight || 1;
    el.style.transform = y ? "translate3d(0," + y.toFixed(2) + "px,0)" : "";
    var s = scrimOf(el); if (s && alone()) s.style.opacity = y > 0 ? String(Math.max(0, 1 - y / H)) : "";
    cur = { el: el, y: y };
    if (TVG.onSheetDrag) TVG.onSheetDrag(el, y > 0 ? Math.min(1, y / H) : 0); // cardstack.js: הדף שמאחור חוזר ל-1 ביחס לירידת החלון
  }
  function reset(el) {
    el.style.transform = ""; el.style.opacity = ""; el.style.transition = ""; el.style.willChange = "";
    var s = scrimOf(el); if (s) { s.style.opacity = ""; s.style.transition = ""; }
    if (cur && cur.el === el) cur = null;
    if (an && an.el === el) { an.h.stop(); an = null; }
    if (TVG.onSheetSettle) TVG.onSheetSettle(el); // cardstack.js
  }
  function offY(el) { var r = el.getBoundingClientRect(), y = cur && cur.el === el ? cur.y : 0; return window.innerHeight - (r.top - y) + 6; } // כמה למטה כדי לצאת מהמסך

  function settle(el, from, to, v, kind) {
    if (an) an.h.stop();
    var a = an = { el: el, y: from, kind: kind, to: to };
    a.h = TVG.spring({
      from: from, to: to, v: v, response: 0.3, damping: 0.8,
      update: function (x) { if (an !== a) return; a.y = x; if (el.hidden) { reset(el); return; } setY(el, x); if (kind === "out" && x >= to - 1) { a.h.stop(); complete(el); } },
      done: function () { if (an !== a) return; if (kind === "out") complete(el); else reset(el); }
    });
  }
  function complete(el) { // החלון מחוץ למסך: סוגרים דרך שכבת הניווט, ורק אז מנקים את הסגנון
    an = null;
    if (TVG.topLayerEl() === el && !el.hidden) TVG.closeTop(); else if (!el.hidden) { settle(el, cur ? cur.y : 0, 0, 0, "back"); return; }
    reset(el);
  }
  function dismiss(el, y, v) {
    if (TVG.reducedMotion()) { // בלי תנועה: דעיכה קצרה
      var s = scrimOf(el); el.style.transition = "opacity .16s"; el.style.opacity = "0"; if (s && alone()) { s.style.transition = "opacity .16s"; s.style.opacity = "0"; }
      var a = an = { el: el, y: y, kind: "fade", h: { stop: function () { clearTimeout(tm); } } }, tm = setTimeout(function () { if (an === a) complete(el); }, 170);
      return;
    }
    settle(el, y, offY(el), v, "out");
  }
  function back(el, y, v) { if (TVG.reducedMotion()) { reset(el); return; } settle(el, y, 0, v, "back"); }

  // ---- גלילה פנימית: האם משהו בדרך מהמטרה אל החלון גלול מטה? האם בכלל יש מה לגלול? ----
  function scrollInfo(t, sheet) {
    var atTop = true, can = false;
    for (var e = t; e && e !== sheet.parentNode; e = e.parentNode) {
      if (e.nodeType !== 1) continue;
      if (e.scrollHeight > e.clientHeight + 1) { var oy = getComputedStyle(e).overflowY; if (oy === "auto" || oy === "scroll") { can = true; if (e.scrollTop > 0) atTop = false; } }
    }
    return { atTop: atTop, can: can };
  }
  // גם גלילה פנימית של הילדים של .sheet שאינם בדרך (למשל .lnd-scroll כשנוגעים ברצועה העליונה): מספיק לבדוק את הנגיעה עצמה
  var swallowT = 0;
  function swallow(e) { e.stopPropagation(); e.preventDefault(); document.removeEventListener("click", swallow, true); clearTimeout(swallowT); }

  document.addEventListener("pointerdown", function (e) {
    if (d || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    var t = e.target, sheet = t && t.closest ? t.closest(".sheet") : null; if (!sheet || sheet.hidden || TVG.topLayerEl() !== sheet) return;
    if (t.closest("input,textarea,select,[contenteditable],[data-nodrag],.lnd-isheet")) return;
    var ey = TVG.sheetEnterLive ? TVG.sheetEnterLive(sheet) : 0; // אוחזים באמצע כניסת החלון (cardstack.js): ממשיכים מהמיקום החי, בלי קפיצה
    if (ey > 0.5 && !(an && an.el === sheet)) { if (an) an.h.stop(); an = { el: sheet, y: ey, kind: "back", to: 0, h: { stop: function () {} } }; setY(sheet, ey); }
    var r = sheet.getBoundingClientRect(), zone = e.clientY - r.top < TOP, si = scrollInfo(t, sheet), grab = !!(an && an.el === sheet);
    if (e.pointerType === "mouse" && !zone && !grab) return; // עכבר: רק מרצועת האחיזה (בלי להפריע לסימון טקסט)
    var base = 0;
    if (grab) { base = an.y; an.h.stop(); an = { el: sheet, y: base, kind: "held", to: an.to, h: { stop: function () {} }, resume: an.kind }; } // אוחזים באמצע אנימציה: מקפיאים במקום החי
    d = { el: sheet, id: e.pointerId, x0: e.clientX, y0: e.clientY, touch: e.pointerType === "touch", zone: zone, si: si, grab: grab, base: base, active: false, s: [{ t: now(), p: e.clientY }] };
    d.claim = grab || zone || si.atTop;   // כלפי מטה זה שלנו
    d.claimUp = grab || !si.can;          // כלפי מעלה (גומי) רק כשאין מה לגלול
  }, true);

  document.addEventListener("pointermove", function (e) {
    if (!d || e.pointerId !== d.id) return;
    var dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      var ok = Math.abs(dy) > Math.abs(dx) && (dy > 0 ? d.claim : d.claimUp);
      if (!ok) { if (d.grab) release(0, true); d = null; return; } // אופקי / גלילה פנימית / כלפי מעלה עם תוכן גלול: לא שלנו
      d.active = true; d.sy = e.clientY; d.s = [];
      try { d.el.setPointerCapture(e.pointerId); } catch (x) {}
      d.el.style.willChange = "transform";
    }
    var raw = d.base + (e.clientY - d.sy);
    setY(d.el, raw >= 0 ? raw : -TVG.rubber(-raw, 160));
    d.s.push({ t: now(), p: e.clientY }); if (d.s.length > 12) d.s.shift();
    if (e.cancelable) e.preventDefault();
  }, true);

  // מונע מהדפדפן להתחיל גלילה/גומי שלו בגרירה ששייכת לחלון (חייב להיות non-passive; ההכרעה לפני הסף כדי שהדפדפן לא יקדים אותנו)
  // על כל חלון בנפרד (לא על המסמך): מאזין לא-פסיבי על המסמך האט כל גלילה באפליקציה, גם מחוץ לחלונות
  function onSheetMove(e) {
    if (!d || !d.touch || !e.cancelable) return;
    if (d.active) { e.preventDefault(); return; }
    var t = e.touches[0]; if (!t) return;
    var dx = t.clientX - d.x0, dy = t.clientY - d.y0;
    if (Math.abs(dy) > Math.abs(dx) && (dy > 0 ? d.claim : d.claimUp)) e.preventDefault();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".sheet"), function (el) { el.addEventListener("touchmove", onSheetMove, { passive: false, capture: true }); });

  function release(v, cancel) { // v: מהירות בפיקסלים/שנייה (חיובי = מטה)
    var el = d.el, y = cur && cur.el === el ? cur.y : 0, H = el.offsetHeight || 1, grab = d.grab, was = an && an.el === el ? an : null;
    if (!d.active) { // נגיעה בלי תנועה: אם החזקנו אנימציה, ממשיכים אותה
      if (grab && was) { var to = was.to; an = null; settle(el, y, to, 0, was.resume === "out" ? "out" : "back"); }
      return;
    }
    try { el.releasePointerCapture(d.id); } catch (x) {}
    document.addEventListener("click", swallow, true); clearTimeout(swallowT); swallowT = setTimeout(function () { document.removeEventListener("click", swallow, true); }, 350); // לא להפעיל כפתור שממנו התחילה הגרירה
    var proj = y + TVG.project(v);
    if (!cancel && el.hidden === false && (v > FLICK || (y > 0 && proj > H * FRAC))) dismiss(el, y, v); else back(el, y, v);
  }
  function up(e) {
    if (!d || e.pointerId !== d.id) return;
    var v = e.type === "pointercancel" ? 0 : TVG.velocity(d.s, now());
    release(v, e.type === "pointercancel"); d = null;
  }
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);

  // רשת ביטחון: חלון שנסגר בדרך אחרת (Escape, חזור, כפתור) באמצע גרירה/אנימציה - מנקים את הסגנון, כדי שפתיחה הבאה תהיה נקייה
  Array.prototype.forEach.call(document.querySelectorAll(".sheet"), function (el) {
    try { new MutationObserver(function () { if (el.hidden) { if (d && d.el === el) d = null; reset(el); } }).observe(el, { attributes: true, attributeFilter: ["hidden"] }); } catch (e) {}
  });
})(window.TVG);
