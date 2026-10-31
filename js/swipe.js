/* js/swipe.js - החלקה בין ימים.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, motion, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial.
   תחושה: התוכן עוקב אחרי האצבע 1:1 (מהנקודה שבה ננעל הכיוון, בלי קפיצה); בשחרור מקרינים תנופה (TVG.project) ומחליטים אם לעבור יום;
   יוצא/חוזר בקפיץ (TVG.spring) שממשיך מהמהירות של האצבע. ביום הראשון/האחרון יש התנגדות גומי וחוזר. כיוון: dx>0 = היום הבא (כמו תמיד, RTL). */
(function (TVG) {
  TVG.files["swipe"] = 1;
  var $ = TVG.$;
  var LOCK = 10, COMMIT = 0.2; // סף נעילת כיוון (px); יום חדש כשהמיקום המוקרן עובר 20% מרוחב המסך

  // ---- החלקה בין ימים ----
  var sw = null, an = null; // an: אנימציה פעילה {h, el, x, dir, commit}
  function stepDay(dir) {
    var days = TVG.allDays(), i = days.indexOf(TVG.day), n = i + dir;
    if (n < 0 || n >= days.length) { TVG.pill("אין עוד ימים", 1000); return; }
    TVG.day = days[n]; TVG.scrub = null; TVG.scrollNext = TVG.tab === "grid"; TVG.render();
    var w = $(".dialwrap") || $(".list"); if (w) w.classList.add(dir > 0 ? "from-l" : "from-r");
    TVG.pill(TVG.dayLabel(TVG.day), 1100);
  }
  function hasDay(dir) { var days = TVG.allDays(), n = days.indexOf(TVG.day) + dir; return n >= 0 && n < days.length; }
  function wrapEl() { return $(".dialwrap") || $(".list"); }
  function W() { return window.innerWidth || 375; }
  function paint(el, x, edge) { // x = הזזה; הדעיכה רק במעבר ליום חדש (לא בגומי בקצה)
    if (!el) return;
    el.style.transform = x ? "translate3d(" + x.toFixed(2) + "px,0,0)" : "";
    var f = edge ? 0 : Math.abs(x) / (W() * 0.5); el.style.opacity = f > 0.01 ? String(Math.max(0, 1 - f * f)) : "";
  }
  function clearEl(el) { if (el) { el.style.transform = ""; el.style.opacity = ""; el.style.willChange = ""; } }
  function stopAn() { if (an) { an.h.stop(); an = null; } }

  document.addEventListener("touchstart", function (e) {
    var held = null;
    if (an) { // אוחזים באמצע אנימציה: חזרה - ממשיכים מהמקום החי; יציאה - מסיימים את המעבר מיד
      if (an.commit) { var dr = an.dir; stopAn(); stepDay(dr); } else { held = { el: an.el, x: an.x }; stopAn(); }
    }
    if ((TVG.tab !== "dial" && TVG.tab !== "grid" && TVG.tab !== "now") || TVG.q.trim() || e.touches.length !== 1 || e.target.closest("#dial,.sheet,select,.days")) { sw = null; if (held) clearEl(held.el); return; }
    var t = e.touches[0], cd = TVG.tab === "now" ? e.target.closest("[data-cid]") : null;
    if (TVG.tab === "now" && !cd) { sw = null; if (held) clearEl(held.el); return; }
    sw = { sx: t.clientX, sy: t.clientY, dx: 0, x: 0, lock: null, card: cd, el: held ? held.el : null, base: held ? held.x : 0, ox: 0, s: [{ t: performance.now(), p: t.clientX }], hint: "" };
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (!sw) return;
    var t = e.touches[0], dx = t.clientX - sw.sx, dy = t.clientY - sw.sy;
    if (!sw.lock && (Math.abs(dx) > LOCK || Math.abs(dy) > LOCK)) {
      sw.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? "h" : "v";
      if (sw.lock === "h") { sw.ox = dx; if (!sw.card && !sw.el) sw.el = wrapEl(); if (sw.el) sw.el.style.willChange = "transform"; } // הנקודה שבה ננעלנו = אפס: בלי קפיצה
      else if (sw.base && sw.el) { var el0 = sw.el; sw.el = null; TVG.spring({ from: sw.base, to: 0, response: 0.3, damping: 0.8, update: function (x) { paint(el0, x, true); }, done: function () { clearEl(el0); } }); sw.base = 0; } // אחזנו באמצע ויצאנו לגלילה אנכית: חוזר למקום
    }
    if (sw.lock !== "h") return;
    sw.dx = dx; if (e.cancelable) e.preventDefault();
    sw.s.push({ t: performance.now(), p: t.clientX }); if (sw.s.length > 12) sw.s.shift();
    if (sw.card) { sw.card.style.transition = "none"; sw.card.style.transform = "translateX(" + Math.round(dx * 0.5) + "px)"; sw.card.style.opacity = String(Math.max(0.45, 1 - Math.abs(dx) / 420)); return; }
    var raw = sw.base + dx - sw.ox, dir = raw > 0 ? 1 : -1, ok = hasDay(dir), x = ok ? raw : dir * TVG.rubber(Math.abs(raw), 110);
    sw.x = x; paint(sw.el, x, !ok);
    var days = TVG.allDays(), n = days.indexOf(TVG.day) + dir, txt = Math.abs(raw) > 40 ? (ok ? (dir > 0 ? "היום הבא: " : "היום הקודם: ") + TVG.dayLabel(days[n]) : "אין עוד ימים") : "";
    if (txt && txt !== sw.hint) TVG.pill(txt); sw.hint = txt;
  }, { passive: false });

  function swEnd() {
    if (!sw) return;
    var s = sw; sw = null;
    var v = TVG.velocity(s.s, performance.now()), dx = s.dx;
    if (s.card) {
      var cd = s.card, proj = dx + TVG.project(v) * 0.5;
      if (s.lock === "h" && Math.abs(proj) > 60 && dx * proj >= 0) { TVG.stepCard(cd.getAttribute("data-cid"), proj > 0 ? 1 : -1); if (cd.isConnected && !cd.getAttribute("data-busy")) { cd.style.transition = "transform .25s cubic-bezier(.2,.8,.2,1), opacity .25s"; cd.style.transform = ""; cd.style.opacity = ""; } return; }
      if (s.lock !== "h") { cd.style.transition = ""; return; }
      var x0 = Math.round(dx * 0.5);
      cd.style.transition = "none";
      TVG.spring({ from: x0, to: 0, v: v * 0.5, response: 0.3, damping: 0.8, update: function (x) { cd.style.transform = x ? "translateX(" + x.toFixed(1) + "px)" : ""; cd.style.opacity = String(Math.max(0.45, 1 - Math.abs(x * 2) / 420)); }, done: function () { cd.style.transform = ""; cd.style.opacity = ""; cd.style.transition = ""; } });
      return;
    }
    if (s.lock !== "h") { // נגיעה/גלילה אנכית: אם אחזנו באמצע חזרה - ממשיכים לחזור
      var he = s.el; if (he && s.base) { TVG.spring({ from: s.base, to: 0, response: 0.3, damping: 0.8, update: function (nx) { paint(he, nx, true); }, done: function () { clearEl(he); } }); } else clearEl(he);
      return;
    }
    $("#pill").hidden = true;
    var el = s.el, x = s.x || 0, proj2 = x + TVG.project(v), dir = proj2 > 0 ? 1 : -1;
    if (hasDay(dir) && Math.abs(proj2) > W() * COMMIT && (x === 0 || x * proj2 > 0)) { // עוברים יום: יוצאים בקפיץ בכיוון האצבע, ואז מצייר היום החדש (נכנס עם from-l / from-r)
      var tgt = dir * W() * 0.5, a = an = { el: el, x: x, dir: dir, commit: true, h: null }, fin = false;
      var go = function () { if (fin) return; fin = true; if (an === a) an = null; if (a.h) a.h.stop(); clearEl(el); stepDay(dir); };
      a.h = TVG.spring({ from: x, to: tgt, v: v, response: 0.3, damping: 0.8, update: function (nx) { a.x = nx; paint(el, nx); if (Math.abs(nx) >= Math.abs(tgt) * 0.97) go(); }, done: go });
      return;
    }
    if (!hasDay(x > 0 ? 1 : -1) && Math.abs(s.dx - s.ox + s.base) > 70) TVG.pill("אין עוד ימים", 1000); // בקצה: כמו קודם, הודעה אחרי משיכה ארוכה
    var b = an = { el: el, x: x, dir: 0, commit: false, h: null };
    b.h = TVG.spring({ from: x, to: 0, v: v, response: 0.3, damping: 0.8, update: function (nx) { b.x = nx; paint(el, nx, !hasDay(nx > 0 ? 1 : -1)); }, done: function () { if (an === b) an = null; clearEl(el); } });
  }
  document.addEventListener("touchend", swEnd);
  document.addEventListener("touchcancel", swEnd);
})(window.TVG);
