/* js/motion.js - תנועה נוזלית: קפיץ (spring) קטן בלי ספרייה + עזרים לתנועת אצבע.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui. כל מי שזקוק לו קורא לו בזמן ריצה.
   TVG.spring({from, to, v, response, damping, update(x, v), done()}) -> {stop(), x}
     v ביחידות לשנייה (פיקסלים/שנייה); response = זמן תגובה בשניות; damping = יחס שיכוך (0.8 = עדין, קצת גלישה).
     מתחיל מהערך החי ומהמהירות של האצבע, לכן אין קפיצה בשחרור. ב"הפחתת תנועה" אין קפיץ: קופץ ישר ליעד (בפריים הבא).
   TVG.rubber(x, dim) - התנגדות גומי של אפל: מרחק גרירה גולמי -> מרחק מוצג (תמיד קטן מ-dim).
   TVG.project(v) - הקרנת תנופה (הדעיכה של אפל, d=0.998): כמה פיקסלים עוד יעבור בלי עצירה.
   TVG.velocity(samples, now) - מהירות מדגימות [{t, p}] של האצבע. */
(function (TVG) {
  TVG.files["motion"] = 1;
  var raf = window.requestAnimationFrame ? function (f) { return window.requestAnimationFrame(f); } : function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  var caf = window.cancelAnimationFrame ? function (i) { window.cancelAnimationFrame(i); } : clearTimeout;

  TVG.reducedMotion = function () { try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } };

  TVG.spring = function (o) {
    var x = o.from, v = o.v || 0, to = o.to, eps = o.eps || 0.4, id = 0, dead = false, last = 0;
    var w = 2 * Math.PI / (o.response || 0.3), k = w * w, c = 2 * (o.damping == null ? 0.8 : o.damping) * w; // מסה 1: קשיחות ושיכוך מתוך response/damping
    var h = { x: x, stop: function () { dead = true; if (id) caf(id); id = 0; } };
    function finish() { x = to; h.x = x; if (o.update) o.update(x, 0); if (o.done) o.done(); }
    if (TVG.reducedMotion() && !o.keepMotion) { id = raf(function () { id = 0; if (!dead) finish(); }); return h; }
    function frame(now) {
      id = 0; if (dead) return;
      var dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60, n = Math.max(1, Math.ceil(dt * 240)), s = dt / n; last = now;
      while (n--) { v += (-k * (x - to) - c * v) * s; x += v * s; } // אינטגרציה במקטעים קטנים: יציב גם בפריים איטי
      if (Math.abs(x - to) < eps && Math.abs(v) < eps * 10) { finish(); return; }
      h.x = x; if (o.update) o.update(x, v);
      if (!dead) id = raf(frame);
    }
    id = raf(function (t) { last = 0; frame(t); });
    return h;
  };

  TVG.rubber = function (x, dim) { dim = dim || 200; return (1 - 1 / (x * 0.55 / dim + 1)) * dim; };
  TVG.project = function (v) { return (v / 1000) * 0.998 / (1 - 0.998); };

  // מהירות (יח'/שנייה) מהדגימות האחרונות; אם האצבע עמדה לפני השחרור (אין דגימה ב-80ms האחרונים) = 0
  TVG.velocity = function (samples, now) {
    var n = samples.length; if (n < 2 || now - samples[n - 1].t > 80) return 0;
    var i = n - 1; while (i > 0 && samples[n - 1].t - samples[i - 1].t <= 100) i--;
    var dt = samples[n - 1].t - samples[i].t; return dt > 0 ? (samples[n - 1].p - samples[i].p) * 1000 / dt : 0;
  };
})(window.TVG);
