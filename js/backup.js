/* js/backup.js - גיבוי בענן וקישור אישי לשחזור.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings, search, favs, render, channels, events, update. */
(function (TVG) {
  TVG.files["backup"] = 1;
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
  // ---- אישור לפני שחזור מקישור אישי: אף פעם לא משחזרים בשקט ----
  function hasOwnData() {
    var sel = TVG.store("tvg.sel"), rem = TVG.store("tvg.rem");
    return !!(sel && sel !== "[]") || !!(rem && rem !== "[]" && rem !== "{}");
  }
  var cfmEl = null;
  function askRestore(hasData) { // מחזיר Promise<boolean>; ברירת המחדל (מיקוד, Esc, לחיצה על הרקע) היא ביטול
    return new Promise(function (resolve) {
      if (!cfmEl) {
        cfmEl = document.createElement("div");
        cfmEl.innerHTML = '<div class="scrim" style="z-index:90"></div>' +
          '<section class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="bkCfmT" style="z-index:91"><div class="sheet-in">' +
          '<h2 id="bkCfmT">לשחזר מקישור אישי?</h2>' +
          '<p id="bkCfmP1"></p><p id="bkCfmP2" style="font-weight:700"></p>' +
          '<button class="btn" type="button" id="bkCfmYes"></button><button class="ghost" type="button" id="bkCfmNo"></button>' +
          '</div></section>';
        document.body.appendChild(cfmEl);
      }
      var scrim = cfmEl.firstChild, sheet = cfmEl.lastChild, yes = sheet.querySelector("#bkCfmYes"), no = sheet.querySelector("#bkCfmNo"), prev = document.activeElement;
      sheet.querySelector("#bkCfmP1").textContent = "הקישור הזה משחזר הגדרות, ערוצים ותזכורות מגיבוי אישי. מרגע השחזור המכשיר הזה ישמור ויסנכרן תזכורות תחת הזהות של הקישור הזה. אם הקישור לא שלכם, אל תמשיכו.";
      sheet.querySelector("#bkCfmP2").textContent = hasData ? "במכשיר הזה כבר יש הגדרות ותזכורות משלכם. שחזור יחליף אותן ויעביר את המכשיר לזהות של הקישור." : "";
      sheet.querySelector("#bkCfmP2").hidden = !hasData;
      yes.textContent = hasData ? "כן, להחליף ולשחזר" : "שחזור"; yes.className = hasData ? "btn danger" : "btn";
      no.textContent = hasData ? "לא, להשאיר את מה שיש" : "ביטול";
      function done(v) {
        document.removeEventListener("keydown", onKey, true);
        scrim.hidden = true; sheet.hidden = true;
        yes.onclick = no.onclick = scrim.onclick = null;
        try { if (prev && prev.focus) prev.focus(); } catch (e) {}
        resolve(v);
      }
      function onKey(e) { if (e.key === "Escape") { e.preventDefault(); done(false); } }
      document.addEventListener("keydown", onKey, true);
      yes.onclick = function () { done(true); };
      no.onclick = scrim.onclick = function () { done(false); };
      scrim.hidden = false; sheet.hidden = false;
      no.focus();
    });
  }
  // מבקש אישור מפורש ואז משחזר. onNo נקרא כשהמשתמש מסרב
  function confirmRestore(t, onNo) {
    if (t === TVG.calTok) { TVG.pill("זה כבר הקישור של המכשיר הזה", 1800); if (onNo) onNo(); return Promise.resolve(false); }
    return askRestore(hasOwnData()).then(function (ok) {
      if (!ok) { if (onNo) onNo(); return false; }
      return restoreTok(t);
    });
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
    confirmRestore(t);
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
    confirmRestore(t, function () { history.replaceState(null, "", APP_URL); }); // תמיד עם אישור מפורש, גם במכשיר חדש
  })();
})(window.TVG);
