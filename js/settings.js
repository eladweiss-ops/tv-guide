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
  TVG.install = install;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); TVG.dip = e; setInst(); });
  window.addEventListener("appinstalled", function () { TVG.dip = null; TVG.installed = true; TVG.store("tvg.instOffered", "1"); setInst(); });
  function install() { if (TVG.dip) { TVG.dip.prompt(); TVG.dip = null; setInst(); } }
  function setInst() {
    var box = $("#instBox"); if (!box) return;
    if (TVG.isStandalone || TVG.installed) { box.hidden = true; return; }
    box.hidden = false; $("#instBtn").hidden = !TVG.dip;
    var ios = TVG.isIOS;
    $("#instBtn").textContent = TVG.isAndroid ? "התקנת האפליקציה" : "הוסף למסך הבית";
    $("#instTxt").textContent = TVG.dip ? "אפשר להתקין את הלוח כאפליקציה, והוא ייפתח במסך מלא." : ios ? "בספארי: לוחצים על כפתור השיתוף ואז על ״הוסף למסך הבית״." : "בתפריט הדפדפן: ״הוסף למסך הבית״ או ״התקן אפליקציה״.";
  }
  function openSet() { TVG.closeFavs(); $("#setsheet").hidden = false; $("#scrim2").hidden = false; setInst(); if (TVG.wlRender) TVG.wlRender(); }

  // ---- שיתוף האפליקציה עם חברים: קישור ההזמנה join/ (תמונה ותיאור משלו בוואטסאפ) ----
  var JOIN = "https://eladweiss-ops.github.io/tv-guide/join/";
  var APPTXT = "היי! 👋 מצאתי אפליקציה ללוח שידורים: כל הערוצים במקום אחד, תזכורת לפני שהתוכנית מתחילה, מעקב אחרי סדרות ומה חדש בנטפליקס.\nחינם ובלי הרשמה. באייפון: פותחים בספארי ← שיתוף ← \"הוסף למסך הבית\".\n👇\n" + JOIN;
  function appWa() {
    var u = "https://wa.me/?text=" + encodeURIComponent(APPTXT), w = null;
    try { w = window.open(u, "_blank"); } catch (e) {}
    if (!w) location.href = u;
    TVG.pill("📤 נשלח לוואטסאפ", 1800);
  }
  function appShare() {
    if (navigator.share) { navigator.share({ title: "לוח שידורים", text: APPTXT.replace(JOIN, "").trim(), url: JOIN }).catch(function () {}); return; }
    var ok = function () { TVG.pill("🔗 הקישור הועתק", 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(APPTXT).then(ok, function () { TVG.pill(JOIN, 4000); });
    else TVG.pill(JOIN, 4000);
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#appWa, #appShare"); if (!t) return;
    if (t.id === "appWa") appWa(); else appShare();
  });

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
