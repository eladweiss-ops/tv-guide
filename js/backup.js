/* js/backup.js - גיבוי בענן וקישור אישי לשחזור.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings, search, favs, render, channels, events, update. */
(function (TVG) {
  var $ = TVG.$, CAL_API = TVG.CAL_API;
  TVG.myTok = myTok;

  // ---- גיבוי אוטומטי בענן + קישור אישי לשחזור ----
  var BK = ["tvg.sel", "tvg.fav", "tvg.prov", "tvg.theme", "tvg.lead", "tvg.tab", "tvg.rem", "tvg.calmode", "tvg.calTok", "tvg.recent", "tvg.topics"];
  var BKSET = {}; BK.forEach(function (k) { if (k !== "tvg.calTok") BKSET[k] = 1; });
  var APP_URL = location.origin + location.pathname.replace(/index\.html$/, "");
  function myTok() { if (!TVG.calTok) { TVG.calTok = TVG.newTok(); TVG.store("tvg.calTok", TVG.calTok); } return TVG.calTok; }
  function myLink() { return APP_URL + "?r=" + myTok(); }
  var bkTimer = 0,
      bkBusy = false;
  function bkPush() {
    if (TVG.isSample || !TVG.store("tvg.sel") || TVG.store("tvg.sel") === "[]") return;
    var d = {}; BK.forEach(function (k) { if (BKSET[k]) { var v = TVG.store(k); if (v != null) d[k] = v; } });
    bkBusy = true;
    fetch(CAL_API + "/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: myTok(), data: d }) })
      .then(function (r) { if (!r.ok) throw 0; localStorage.setItem("tvg.bkAt", String(Date.now())); bkShow(); })
      .catch(function () {}).then(function () { bkBusy = false; });
  }
  window.__tvgBk = function (k) { if (!BKSET[k] || TVG.restoring) return; clearTimeout(bkTimer); bkTimer = setTimeout(bkPush, 2500); };
  function bkShow() {
    var at = +(TVG.store("tvg.bkAt") || 0), el = $("#bkState"); if (!el) return;
    el.textContent = at ? "☁️ גובה לאחרונה: " + new Date(at).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "☁️ עוד לא גובה";
  }
  TVG.restoring = false;
  function tokFrom(txt) {
    txt = String(txt || "").trim();
    var m = txt.match(/[?&]r=([a-z0-9]{24,48})/) || txt.match(/^([a-z0-9]{24,48})$/);
    return m ? m[1] : "";
  }
  function restoreTok(t) {
    TVG.restoring = true; TVG.pill("משחזר…", 4000);
    return fetch(CAL_API + "/api/backup?t=" + t, { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }).then(function (j) {
      var d = j && j.data || {};
      if (!d["tvg.sel"]) throw 404;
      Object.keys(d).forEach(function (k) { if (BKSET[k] && typeof d[k] === "string") localStorage.setItem(k, d[k]); });
      localStorage.setItem("tvg.calTok", t); localStorage.setItem("tvg.bkAt", String(j.at || Date.now()));
      TVG.pill("✓ הכול חזר! טוען מחדש…", 2000);
      setTimeout(function () { location.replace(APP_URL); }, 900);
      return true;
    }).catch(function (e) { TVG.restoring = false; TVG.pill(e === 404 ? "לא מצאתי גיבוי לקישור הזה" : "השחזור נכשל, נסו שוב", 2200); return false; });
  }
  function restoreOld(c) { // קוד גיבוי ישן TVG1:
    var o = JSON.parse(decodeURIComponent(escape(atob(c.slice(5)))));
    BK.forEach(function (k) { if (typeof o[k] === "string") localStorage.setItem(k, o[k]); });
    TVG.pill("שוחזר, טוען מחדש…"); setTimeout(function () { location.reload(); }, 600);
  }
  function restoreText(txt) {
    var c = String(txt || "").trim();
    if (c.replace(/\s+/g, "").indexOf("TVG1:") === 0) { try { restoreOld(c.replace(/\s+/g, "")); } catch (e) { TVG.pill("הקוד לא תקין", 1600); } return; }
    var t = tokFrom(c); if (!t) { TVG.pill("זה לא נראה כמו קישור אישי", 1800); return; }
    restoreTok(t);
  }
  $("#bkShare").addEventListener("click", function () {
    var link = myLink(); bkPush();
    var txt = "הקישור האישי שלי ללוח השידורים (לשחזור במכשיר חדש):";
    if (navigator.share) navigator.share({ title: "לוח שידורים - קישור אישי", text: txt, url: link }).catch(function () {});
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(function () { TVG.pill("הקישור הועתק", 1600); }, function () { $("#bkCode").value = link; });
    else $("#bkCode").value = link;
  });
  $("#bkRestore").addEventListener("click", function () { restoreText($("#bkCode").value); });
  $("#chRestore").addEventListener("click", function () {
    var v = window.prompt("הדביקו כאן את הקישור האישי שלכם:");
    if (v) restoreText(v);
  });
  bkShow();
  // נפתח מקישור אישי (?r=...)
  (function () {
    var t = tokFrom(location.search);
    if (!t) { if (TVG.store("tvg.sel") && !TVG.store("tvg.bkAt")) setTimeout(bkPush, 4000); return; }
    if (t === TVG.calTok) { history.replaceState(null, "", APP_URL); return; }
    var has = TVG.store("tvg.sel") && TVG.store("tvg.sel") !== "[]";
    if (!has || window.confirm("לשחזר את ההגדרות מהקישור האישי? מה שבחרתם במכשיר הזה יוחלף.")) restoreTok(t);
    else history.replaceState(null, "", APP_URL);
  })();
})(window.TVG);
