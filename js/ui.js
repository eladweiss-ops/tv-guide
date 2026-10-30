/* js/ui.js - UI משותף: הודעה קופצת (pill), רקע כהה (scrim), מחלקת גלילה.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders. */
(function (TVG) {
  TVG.files["ui"] = 1;
  var $ = TVG.$, esc = TVG.esc;
  TVG.pill = pill;

  TVG.pillFn = null;
  TVG.pillFn2 = null;
  function pill(t, ms, actLabel, fn, act2, fn2) {
    var el = $("#pill"); TVG.pillFn = fn || null; TVG.pillFn2 = fn2 || null;
    el.innerHTML = esc(t) + (fn2 ? ' <button type="button" class="pillact" data-pillact2>' + esc(act2) + "</button>" : "") + (fn ? ' <button type="button" class="pillact" data-pillact>' + esc(actLabel || "ביטול") + "</button>" : "");
    el.hidden = false; clearTimeout(TVG.pillT); if (ms) TVG.pillT = setTimeout(function () { el.hidden = true; TVG.pillFn = null; }, fn ? Math.max(ms, 4500) : ms);
  }
  // סגירה בלחיצה על המסך שמאחורי החלון, גם בלי להסתמך על המאזין הכללי
  ["scrim", "scrim2"].forEach(function (id) {
    var el = document.getElementById(id); if (!el) return;
    el.addEventListener("click", function (e) { e.stopPropagation(); if (id === "scrim") { TVG.openSheet(false); TVG.render(); } else { var remWas = !$("#rem").hidden; TVG.closeRem(); TVG.closeFavs(); if (!remWas && TVG.closeLand) TVG.closeLand(); } });
  });
  // אנדרואיד: המקלדת לא משנה את גובה הדף, אז --kb (גובה המקלדת) מרים את החלונות התחתונים; ושדה ממוקד נגלל לתצוגה
  if (TVG.isAndroid) {
    var vv = window.visualViewport;
    var setKb = function () { var kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0; document.documentElement.style.setProperty("--kb", (kb > 80 ? kb : 0) + "px"); };
    if (vv) { vv.addEventListener("resize", setKb); vv.addEventListener("scroll", setKb); }
    document.addEventListener("focusin", function (e) {
      var t = e.target; if (!t || !t.closest || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !t.closest(".sheet")) return;
      setTimeout(function () { try { t.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (er) {} }, 350);
    });
  }
  window.addEventListener("scroll", function () { document.body.classList.toggle("scrolled", window.scrollY > 8); }, { passive: true });
})(window.TVG);
