/* js/celebrate.js - חגיגה קטנה אחרי פעולה עם רגש: אימוג׳ים עולים מתחתית המסך, מאטים, שוקעים אל מאחורי סרגל הלשוניות ומתנדנדים שם, ודוהים.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, ui, motion.
   TVG.celebrate(kind) - kind: "rem" (תזכורת; פעם ביום לכל היותר), "party" (מגיע / ערב חדש), "share" (שליחה לחבר).
   שכבה אחת קבועה (#fx, z 8) מתחת לסרגל (10), לכפתור "עכשיו" (9), לחלונות (21) ולהודעה (30): אף פעם לא מסתירים כפתור, חלון או הודעה.
   מעל התוכן הם עוברים שקופים למחצה, כדי שהטקסט תמיד ייקרא. ב"הפחתת תנועה" – כלום (ההודעה לבד מספיקה). */
(function (TVG) {
  TVG.files["celebrate"] = 1;
  var SETS = {
    rem: ["⏰", "🔔", "📺", "✨", "⭐", "🛋️", "🍫", "🎬"],
    party: ["🍿", "🎉", "🥳", "🍕", "🥤", "🙌", "💛", "✨"],
    share: ["💌", "💛", "😊", "👍", "✨", "🧡", "📺", "😂"]
  };
  var N = 7, PASS = 0.4, REST = 0.75; // כמות; שקיפות בזמן מעבר מעל התוכן; שקיפות במנוחה מאחורי הסרגל
  var layer = null, live = [];
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var T = function (x, y, s, r) { return "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + s + ") rotate(" + r.toFixed(1) + "deg)"; };

  function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function clear() { live.forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); }); live = []; }

  TVG.celebrate = function (kind) {
    try {
      if (TVG.reducedMotion() || !document.body.animate) return;
      if (kind === "rem") { // תזכורת היא פעולה שגרתית: חוגגים רק את הראשונה בכל יום
        if (TVG.store("tvg.cel") === today()) return;
        TVG.store("tvg.cel", today());
      }
      var set = SETS[kind] || SETS.rem;
      if (!layer) { layer = document.createElement("div"); layer.id = "fx"; layer.setAttribute("aria-hidden", "true"); document.body.appendChild(layer); }
      clear();
      var W = window.innerWidth, H = window.innerHeight;
      var dock = document.querySelector(".dock"), r = dock ? dock.getBoundingClientRect() : null; // fixed: offsetParent תמיד null, לכן לפי המידות
      if (r && !(r.width > 0 && r.top < H)) r = null;
      var restTop = r ? r.top - 16 : H - 110, restBot = r ? r.top + 8 : H - 86; // מנוחה: מציצים מעל הקצה העליון של הסרגל ושוקעים מאחוריו
      var em = set.slice().sort(function () { return Math.random() - 0.5; });
      for (var k = 0; k < N; k++) fly(em[k % em.length], k, W, H, restTop, Math.max(restTop, restBot));
    } catch (e) {} // קישוט בלבד: אף פעם לא שוברים פעולה
  };

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
