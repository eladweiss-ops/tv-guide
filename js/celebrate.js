/* js/celebrate.js - חגיגה קטנה אחרי פעולה עם רגש, בשני שלבים:
   1. "קפיצה": אימוג׳י אחד גדול (⏰/🍿/💌) קופץ במקום שהוקש, עם ניצוצות, חצי שנייה – נראה גם כשהחלון התחתון פתוח (שכבה #fxpop, z 25: מעל החלונות 21, מתחת להודעה 30).
   2. "עלייה": אימוג׳ים עולים מתחתית המסך, מאטים, שוקעים אל מאחורי סרגל הלשוניות ומתנדנדים שם, ודוהים. מחכה עד שאין חלון תחתון פתוח (אחרת הם מאחוריו ולא רואים).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, ui, motion.
   TVG.celebrate(kind) - kind: "rem" (תזכורת: קפיצה תמיד, עלייה לכל היותר פעם ב-6 שעות – הראשונה בערב), "party" (מגיע / ערב חדש), "share" (שליחה לחבר).
   שכבת העלייה (#fx, z 8) מתחת לסרגל (10), לכפתור "עכשיו" (9), לחלונות (21) ולהודעה (30): אף פעם לא מסתירה כפתור, חלון או הודעה.
   ב"הפחתת תנועה" – כלום (ההודעה לבד מספיקה). */
(function (TVG) {
  TVG.files["celebrate"] = 1;
  var SETS = {
    rem: ["⏰", "🔔", "📺", "✨", "⭐", "🛋️", "🍫", "🎬"],
    party: ["🍿", "🎉", "🥳", "🍕", "🥤", "🙌", "💛", "✨"],
    share: ["💌", "💛", "😊", "👍", "✨", "🧡", "📺", "😂"]
  };
  var POP = { rem: "⏰", party: "🍿", share: "💌" };
  var N = 7, PASS = 0.85, REST = 0.9, GAP = 6 * 36e5; // כמות; שקיפות בזמן מעבר ובמנוחה (נראים בבירור); מרווח מינימלי בין עליות של תזכורת
  var layer = null, popLayer = null, live = [], tap = null, waiting = null;
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var T = function (x, y, s, r) { return "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + s + ") rotate(" + r.toFixed(1) + "deg)"; };

  // איפה הוקש לאחרונה: שם קופץ האימוג׳י (בדרך כלל הכפתור שיצר את התזכורת)
  document.addEventListener("pointerdown", function (e) { tap = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
  function sheetOpen() { return !!document.querySelector(".sheet:not([hidden])"); }
  function clear() { live.forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); }); live = []; }

  TVG.celebrate = function (kind) {
    try {
      if (TVG.reducedMotion() || !document.body.animate) return;
      pop(kind);
      if (kind === "rem") { // תזכורת היא פעולה שגרתית: העלייה רק פעם ב-6 שעות (הקפיצה – תמיד)
        var last = +TVG.store("tvg.cel") || 0; // ערך ישן (תאריך כמחרוזת) → NaN → 0: חוגגים
        if (Date.now() - last < GAP) return;
        TVG.store("tvg.cel", String(Date.now()));
      }
      afterSheets(function () { rise(kind); });
    } catch (e) {} // קישוט בלבד: אף פעם לא שוברים פעולה
  };

  // מחכים שכל החלונות התחתונים ייסגרו (עד דקה וחצי), ועוד רגע לאנימציית הסגירה
  function afterSheets(fn) {
    if (waiting) clearTimeout(waiting);
    var t0 = Date.now();
    (function chk() {
      waiting = null;
      if (!sheetOpen()) { waiting = setTimeout(function () { waiting = null; if (!sheetOpen()) fn(); else chk(); }, 280); return; }
      if (Date.now() - t0 < 90000) waiting = setTimeout(chk, 300);
    })();
  }

  function pop(kind) {
    if (!popLayer) { popLayer = document.createElement("div"); popLayer.id = "fxpop"; popLayer.setAttribute("aria-hidden", "true"); document.body.appendChild(popLayer); }
    var W = window.innerWidth, H = window.innerHeight, fresh = tap && Date.now() - tap.t < 4000;
    var cx = fresh ? Math.min(Math.max(tap.x, 40), W - 40) : W / 2, cy = fresh ? Math.min(Math.max(tap.y - 34, 50), H - 50) : H * 0.6;
    var el = document.createElement("i"); el.textContent = POP[kind] || POP.rem; el.className = "pop"; popLayer.appendChild(el);
    var a = el.animate([
      { transform: T(cx - 26, cy - 26, 0.3, -12), opacity: 0 },
      { transform: T(cx - 26, cy - 40, 1.35, 8), opacity: 1, offset: 0.35 },
      { transform: T(cx - 26, cy - 46, 1.15, -4), opacity: 1, offset: 0.7 },
      { transform: T(cx - 26, cy - 80, 0.9, 0), opacity: 0 }
    ], { duration: 950, easing: "cubic-bezier(.2,.8,.3,1)", fill: "both" });
    a.onfinish = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    for (var k = 0; k < 6; k++) (function (k) { // ניצוצות לכל הכיוונים
      var s = document.createElement("i"), ang = (k / 6) * 2 * Math.PI + rnd(-0.3, 0.3), d = rnd(42, 70);
      s.textContent = "✨"; s.className = "spk"; popLayer.appendChild(s);
      var b = s.animate([
        { transform: T(cx - 9, cy - 40, 0.4, 0), opacity: 0 },
        { transform: T(cx - 9 + Math.cos(ang) * d * 0.6, cy - 40 + Math.sin(ang) * d * 0.6, 1, 20), opacity: 1, offset: 0.4 },
        { transform: T(cx - 9 + Math.cos(ang) * d, cy - 40 + Math.sin(ang) * d, 0.6, 40), opacity: 0 }
      ], { duration: 800, delay: 120, easing: "ease-out", fill: "both" });
      b.onfinish = function () { if (s.parentNode) s.parentNode.removeChild(s); };
    })(k);
  }

  function rise(kind) {
    var set = SETS[kind] || SETS.rem;
    if (!layer) { layer = document.createElement("div"); layer.id = "fx"; layer.setAttribute("aria-hidden", "true"); document.body.appendChild(layer); }
    clear();
    var W = window.innerWidth, H = window.innerHeight;
    var dock = document.querySelector(".dock"), r = dock ? dock.getBoundingClientRect() : null; // fixed: offsetParent תמיד null, לכן לפי המידות
    if (r && !(r.width > 0 && r.top < H)) r = null;
    var restTop = r ? r.top - 16 : H - 110, restBot = r ? r.top + 8 : H - 86; // מנוחה: מציצים מעל הקצה העליון של הסרגל ושוקעים מאחוריו
    var em = set.slice().sort(function () { return Math.random() - 0.5; });
    for (var k = 0; k < N; k++) fly(em[k % em.length], k, W, H, restTop, Math.max(restTop, restBot));
  }

  function fly(ch, k, W, H, restTop, restBot) {
    var el = document.createElement("i"), inner = document.createElement("b"), size = rnd(26, 38);
    inner.textContent = ch; el.appendChild(inner); el.style.fontSize = size + "px";
    layer.appendChild(el); live.push(el);
    var x = (W - 48) * ((k + 0.5) / N) + rnd(-12, 12) + 24 - size / 2;
    var y0 = H + 8, rest = rnd(restTop, restBot), peak = H - rnd(0.26, 0.36) * H, rot = rnd(-18, 18);
    var a = el.animate([
      { transform: T(x, y0, 0.5, 0), opacity: 0 },
      { transform: T(x + rnd(-8, 8), peak, 1.1, rot), opacity: PASS, offset: 0.45 },
      { transform: T(x, peak + 14, 1.04, rot * 0.6), opacity: PASS, offset: 0.6 },
      { transform: T(x, rest, 0.95, rot * 0.3), opacity: REST }
    ], { duration: rnd(2600, 3100), delay: k * 140 + rnd(0, 80), easing: "cubic-bezier(.3,.7,.3,1)", fill: "both" });
    a.onfinish = function () {
      el.style.transform = T(x, rest, 0.95, rot * 0.3); el.style.opacity = REST; a.cancel();
      var amp = rnd(4, 9), sx = rnd(2, 5), rr = rnd(3, 7);
      inner.animate([
        { transform: "translate(" + (-sx) + "px,0) rotate(" + (-rr) + "deg)" },
        { transform: "translate(" + sx + "px," + (-amp) + "px) rotate(" + rr + "deg)" }
      ], { duration: rnd(1800, 2800), direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
      setTimeout(function () {
        var f = el.animate([{ opacity: REST }, { opacity: 0 }], { duration: 1200, fill: "forwards" });
        f.onfinish = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      }, rnd(4500, 6000));
    };
  }
})(window.TVG);
