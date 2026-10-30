/* js/settings.js - הגדרות: התקנה כאפליקציה, ערכת נושא, חלון ההגדרות.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe. */
(function (TVG) {
  TVG.files["settings"] = 1;
  var $ = TVG.$;
  TVG.openSet = openSet;
  TVG.setInst = setInst;
  TVG.setTheme = setTheme;

  // ---- התקנה כאפליקציה ----
  TVG.dip = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); TVG.dip = e; setInst(); });
  function setInst() {
    var box = $("#instBox"); if (!box) return;
    var sa = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    if (sa) { box.hidden = true; return; }
    box.hidden = false; $("#instBtn").hidden = !TVG.dip;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    $("#instTxt").textContent = TVG.dip ? "אפשר להתקין את הלוח כאפליקציה, והוא ייפתח במסך מלא." : ios ? "בספארי: לוחצים על כפתור השיתוף ואז על ״הוסף למסך הבית״." : "בתפריט הדפדפן: ״הוסף למסך הבית״ או ״התקן אפליקציה״.";
  }
  function openSet() { TVG.closeFavs(); $("#setsheet").hidden = false; $("#scrim2").hidden = false; setInst(); }

  var themeSel = "light";
  function setTheme(t) {
    if (t !== "dark" && t !== "auto") t = "light";
    themeSel = t; TVG.store("tvg.theme", t);
    var eff = t === "auto" ? (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
    document.documentElement.setAttribute("data-theme", eff);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", eff === "dark" ? "#0E0F14" : "#f2f2f7");
    document.querySelectorAll("[data-theme-set]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-set") === t)); });
  }
  if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (themeSel === "auto") setTheme("auto"); }); } catch (e) {} }
})(window.TVG);
