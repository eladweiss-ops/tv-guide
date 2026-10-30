/* js/update.js - עדכון אוטומטי (checkUpdate) ומשימות רקע בעליה.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings, search, favs, render, channels, events. */
(function (TVG) {
  // ---- עדכון אוטומטי של האפליקציה ----
  // VERSION ו-BUILD מוגדרים ב-index.html בלבד (מקור יחיד). בכל שינוי מעלים אותם שם.
  // VERSION מוצג למשתמש (בהגדרות, ובהודעה אחרי עדכון). BUILD נבדק מול index.html בשרת, וגם משמש כ-?v= לקובצי css/js.
  var VERSION = TVG.VERSION, BUILD = TVG.BUILD, bootAt = Date.now(), lastChk = 0;
  function checkUpdate() { if (TVG.restoring || /[?&]r=/.test(location.search)) return;
    if (Date.now() - lastChk < 120000) return; lastChk = Date.now();
    fetch("index.html?u=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
      var m = t.match(/BUILD = "(\d{4}-[^"]+)"/); if (!m || m[1] === BUILD) return;
      var tried = null; try { tried = sessionStorage.getItem("tvg.try"); sessionStorage.setItem("tvg.try", m[1]); } catch (e) {}
      if (tried === m[1]) return; // כבר ניסינו לטעון את הגרסה הזו, לא נכנסים ללולאה
      location.replace("./?v=" + encodeURIComponent(m[1]));
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    if (Date.now() - bootAt > 3 * 3600000) { location.reload(); return; } // נתונים טריים אחרי הפסקה ארוכה
    if (TVG.syncBad) TVG.syncRems();
    if (TVG.store("tvg.calJust") === "1") { TVG.store("tvg.calJust", "0"); TVG.calWelcome(); }
    checkUpdate();
  });
  setTimeout(checkUpdate, 1500);
  TVG.pullRems(); if (TVG.syncBad) TVG.syncRems();
  if (TVG.pushOn && TVG.canPush) setTimeout(function () { TVG.pushReg().catch(function () {}); }, 3000);
  if (TVG.store("tvg.calJust") === "1") { TVG.store("tvg.calJust", "0"); setTimeout(TVG.calWelcome, 800); }
})(window.TVG);
