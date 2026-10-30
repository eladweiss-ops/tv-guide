/* js/swipe.js - החלקה בין ימים.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial. */
(function (TVG) {
  TVG.files["swipe"] = 1;
  var $ = TVG.$;

  // ---- החלקה בין ימים ----
  var sw = null;
  function stepDay(dir) {
    var days = TVG.allDays(), i = days.indexOf(TVG.day), n = i + dir;
    if (n < 0 || n >= days.length) { TVG.pill("אין עוד ימים", 1000); return; }
    TVG.day = days[n]; TVG.scrub = null; TVG.scrollNext = TVG.tab === "grid"; TVG.render();
    var w = $(".dialwrap") || $(".list"); if (w) w.classList.add(dir > 0 ? "from-l" : "from-r");
    TVG.pill(TVG.dayLabel(TVG.day), 1100);
  }
  document.addEventListener("touchstart", function (e) {
    if ((TVG.tab !== "dial" && TVG.tab !== "grid" && TVG.tab !== "now") || TVG.q.trim() || e.touches.length !== 1 || e.target.closest("#dial,.sheet,select,.days")) { sw = null; return; }
    var t = e.touches[0], cd = TVG.tab === "now" ? e.target.closest("[data-cid]") : null;
    if (TVG.tab === "now" && !cd) { sw = null; return; }
    sw = { x: t.clientX, y: t.clientY, dx: 0, lock: null, card: cd };
  }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!sw) return;
    var t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (!sw.lock && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) sw.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? "h" : "v";
    if (sw.lock !== "h") return;
    sw.dx = dx; if (e.cancelable) e.preventDefault();
    if (sw.card) { sw.card.style.transition = "none"; sw.card.style.transform = "translateX(" + Math.round(dx * 0.5) + "px)"; sw.card.style.opacity = String(Math.max(0.45, 1 - Math.abs(dx) / 420)); return; }
    var days = TVG.allDays(), n = days.indexOf(TVG.day) + (dx > 0 ? 1 : -1);
    if (Math.abs(dx) > 40) TVG.pill(n >= 0 && n < days.length ? (dx > 0 ? "היום הבא: " : "היום הקודם: ") + TVG.dayLabel(days[n]) : "אין עוד ימים");
  }, { passive: false });
  function swEnd() {
    if (!sw) return;
    $("#main").style.transform = "";
    var dx = sw.dx, lock = sw.lock, cd = sw.card; sw = null;
    if (cd) {
      if (lock === "h" && Math.abs(dx) > 60) { TVG.stepCard(cd.getAttribute("data-cid"), dx > 0 ? 1 : -1); if (cd.isConnected && !cd.getAttribute("data-busy")) { cd.style.transition = "transform .25s cubic-bezier(.2,.8,.2,1), opacity .25s"; cd.style.transform = ""; cd.style.opacity = ""; } return; }
      cd.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1), opacity .28s"; cd.style.transform = ""; cd.style.opacity = "";
      setTimeout(function () { cd.style.transition = ""; }, 300); return;
    }
    if (lock === "h") { $("#pill").hidden = true; if (Math.abs(dx) > 70) stepDay(dx > 0 ? 1 : -1); }
  }
  document.addEventListener("touchend", swEnd);
  document.addEventListener("touchcancel", swEnd);
})(window.TVG);
