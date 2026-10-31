/* js/nfwatch.js - בדף התוכן של נטפליקס: "🔔 תודיע לי" (רשימת מעקב בשרת, בדיקה יומית) ו"⏰ להזכיר לי לצפות" (תזכורת אישית רגילה),
   ובהגדרות: רשימת "התראות נטפליקס" עם הסרה. חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, netflix.
   אחסון מקומי: tvg.wl = [{k,title,orig,type,poster,on:["nf"|"season"|"tv"],at,bn}] (גם בגיבוי). שרת: POST /api/watch (כל הרשימה). */
(function (TVG) {
  TVG.files["nfwatch"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.nfAlerts = alertsHtml;
  TVG.nfWatchRem = watchRemHtml;
  TVG.wlItem = wlItem;
  TVG.wlRender = wlRender;
  TVG.wlSync = wlSync;

  var MAX = 50, API = TVG.CAL_API;
  var RE_K = /^[mt][0-9]{1,9}$/, RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\//;
  var KINDS = [["nf", "כשזה מגיע לנטפליקס", "כשזה מגיע לנטפליקס"], ["season", "עונה חדשה", "כשיוצאת עונה חדשה"], ["tv", "כשזה משודר בערוץ", "כשזה משודר בערוץ"]];
  function kindName(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === k) return KINDS[i][2]; return ""; }

  // ---- רשימת המעקב ----
  TVG.WL = [];
  try { (JSON.parse(TVG.store("tvg.wl") || "[]") || []).forEach(function (x) { if (x && RE_K.test(x.k || "") && x.title && Array.isArray(x.on) && x.on.length) TVG.WL.push(x); }); } catch (e) { TVG.WL = []; }
  function wlSave() { TVG.store("tvg.wl", JSON.stringify(TVG.WL)); }
  function wlFind(k) { for (var i = 0; i < TVG.WL.length; i++) if (TVG.WL[i].k === k) return TVG.WL[i]; return null; }
  function wlHas(k, kind) { var w = wlFind(k); return !!w && w.on.indexOf(kind) >= 0; }
  // פריט "דל" לפתיחה מהודעה: רק מה שיש ברשימה; nfsearch.js משלים פרטים וזמינות (ensure)
  function wlItem(k) {
    var w = wlFind(k); if (!w) return null;
    return { k: w.k, type: w.type === "tv" ? "tv" : "movie", title: w.title, orig: w.orig || "", poster: RE_IMG.test(w.poster || "") ? w.poster : "", nf: false, others: [], _wl: true };
  }
  function wlSync() {
    var t; try { t = TVG.myTok(); } catch (e) { return Promise.resolve(false); }
    return fetch(API + "/api/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: t, items: TVG.WL }) })
      .then(function (r) { if (!r.ok) throw 0; TVG.store("tvg.wlDirty", "0"); return true; })
      .catch(function () { TVG.store("tvg.wlDirty", "1"); return false; });
  }
  if (TVG.store("tvg.wlDirty") === "1") setTimeout(wlSync, 4000); // שמירה שנכשלה: ניסיון חוזר בעלייה הבאה

  function setKind(x, kind, on) { // ללא הודעות. מחזיר true אם השתנה
    var w = wlFind(x.k);
    if (on) {
      if (w && w.on.indexOf(kind) >= 0) return false;
      if (!w) {
        if (TVG.WL.length >= MAX) return null;
        w = { k: x.k, title: String(x.title).slice(0, 120), orig: String(x.orig || "").slice(0, 120), type: x.type === "tv" ? "tv" : "movie", poster: RE_IMG.test(x.poster || "") ? x.poster : "", on: [], at: Date.now(), bn: TVG.nfIsNf(x) };
        TVG.WL.push(w);
      }
      w.on.push(kind);
    } else {
      if (!w || w.on.indexOf(kind) < 0) return false;
      w.on = w.on.filter(function (o) { return o !== kind; });
      if (!w.on.length) TVG.WL = TVG.WL.filter(function (o) { return o.k !== x.k; });
    }
    wlSave(); wlSync(); return true;
  }

  function alertsHtml(x) {
    var chips = KINDS.filter(function (kd) {
      if (kd[0] === "nf") return !TVG.nfIsNf(x) || wlHas(x.k, "nf");   // כבר בנטפליקס: אין מה להתריע
      if (kd[0] === "season") return x.type === "tv";
      return true;
    }).map(function (kd) {
      return '<button type="button" class="chip" data-wlkind="' + kd[0] + '" aria-pressed="' + wlHas(x.k, kd[0]) + '">' + kd[1] + "</button>";
    }).join("");
    return '<div class="nfgrp" role="group" aria-label="התראות"><div class="lbl">🔔 תודיע לי</div><div class="chips lp">' + chips + "</div>" +
      (TVG.pushOn ? "" : '<p class="credit">ההתראות מגיעות כהתראת פוש. <button type="button" class="linkbtn" data-pushon>להפעלת התראות</button></p>') + "</div>";
  }

  // ---- ⏰ להזכיר לי לצפות ----
  function at21(addDays) { var d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(21, 0, 0, 0); return d; }
  function myRems(k) { var now = Date.now(); return TVG.REMS.filter(function (r) { return r.k.indexOf("nf|" + k + "|") === 0 && r.ts > now; }); }
  function dayTxt(d) { var t = dstr(d); return t === dstr(new Date()) ? "הערב" : t === dstr(new Date(Date.now() + 864e5)) ? "מחר" : TVG.dayLabel(t); }
  function watchRemHtml(x) {
    var tonight = at21(0), ok = tonight.getTime() > Date.now() + 5 * 60000, rs = myRems(x.k);
    var h = '<div class="nfgrp" role="group" aria-label="תזכורת צפייה"><div class="lbl">⏰ להזכיר לי לצפות</div><div class="chips lp">' +
      (ok ? '<button type="button" class="chip" data-nfrem="tonight">הערב 21:00</button>' : "") +
      '<button type="button" class="chip" data-nfrem="tomorrow">מחר 21:00</button>' +
      '<button type="button" class="chip" data-nfrem="pick" aria-pressed="' + (TVG.nfPick === x.k) + '">בחירת שעה</button></div>';
    if (TVG.nfPick === x.k) {
      var d = at21(1), min = new Date(Date.now() + 120000);
      h += '<div class="lpcustom"><input type="datetime-local" data-nfremdt min="' + TVG.localVal(min) + '" value="' + TVG.localVal(d) + '" aria-label="מועד התזכורת"><button type="button" class="btn sm" data-nfremset>קביעה</button></div>';
    }
    rs.forEach(function (r) { var d = new Date(r.ts); h += '<p class="credit nfremd">⏰ יש תזכורת: ' + esc(dayTxt(d)) + " ב־" + hhmm(d) + "</p>"; });
    return h + "</div>";
  }
  function createRem(x, d) {
    var ts = d.getTime();
    if (!(ts > Date.now() + 60000)) { TVG.pill("בחרו זמן עתידי", 1600); return; }
    var link = TVG.nfIsNf(x) && /^https:\/\/www\.netflix\.com\//.test(x.link || "") ? x.link : "";
    var rec = { k: "nf|" + x.k + "|" + ts, id: "", ts: ts, end: ts + 2 * 3600000, title: String(x.title).slice(0, 120), ch: "נטפליקס", desc: link ? "▶ לצפייה בנטפליקס: " + link : "", lead: 0, at: Date.now() };
    if (TVG.hasRem(rec.k)) { TVG.pill("כבר יש תזכורת לזמן הזה ✓", 1600); return; }
    if (TVG.addRec(rec, d) === "pending") return; // הפעלת התראות בדרך; ההודעה מגיעה משם
    TVG.nfPick = null; TVG.render(); if (TVG.nfReopen) TVG.nfReopen();
    TVG.pill("⏰ נזכיר לך " + (dstr(d) === dstr(new Date()) ? "" : dayTxt(d) + " ") + "ב־" + hhmm(d), 5000, "ביטול", function () {
      TVG.REMS = TVG.REMS.filter(function (r) { return r.k !== rec.k; }); TVG.saveRems(); TVG.syncRems(); TVG.render(); if (TVG.nfReopen) TVG.nfReopen(); TVG.pill("בוטל", 1200);
    });
  }

  // ---- הגדרות: רשימת ההתראות ----
  function wlRender() {
    var box = $("#wlList"); if (!box) return;
    if (!TVG.WL.length) { box.innerHTML = '<p class="none">עדיין אין התראות. בדף של סרט או סדרה (לשונית נטפליקס) בוחרים ״🔔 תודיע לי״.</p>'; return; }
    box.innerHTML = TVG.WL.map(function (w) {
      return '<div class="wlrow"><span class="wlt"><b><bdi>' + esc(w.title) + '</bdi></b><span class="wls">' + w.on.map(function (o) { return "🔔 " + esc(kindName(o)); }).join(" · ") + "</span></span>" +
        '<button type="button" class="rbt" data-wlrm="' + esc(w.k) + '" aria-label="הסרת ההתראה: ' + esc(w.title) + '">✕</button></div>';
    }).join("");
  }
  function wlRemove(k) {
    var w = wlFind(k); if (!w) return;
    var idx = TVG.WL.indexOf(w);
    TVG.WL = TVG.WL.filter(function (o) { return o.k !== k; }); wlSave(); wlSync(); wlRender();
    TVG.pill("ההתראה הוסרה", 5000, "ביטול", function () {
      if (!wlFind(k)) { TVG.WL.splice(Math.min(idx, TVG.WL.length), 0, w); wlSave(); wlSync(); wlRender(); if (TVG.nfReopen) TVG.nfReopen(); TVG.pill("הוחזרה ✓", 1200); }
    });
    if (TVG.nfReopen) TVG.nfReopen();
  }

  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var wk = t.closest("[data-wlkind]");
    if (wk) {
      var x = TVG.nfGet(TVG.nfOpen); if (!x) return;
      var kind = wk.getAttribute("data-wlkind"), on = !wlHas(x.k, kind), r = setKind(x, kind, on);
      if (r === null) { TVG.pill("אפשר לעקוב אחרי עד " + MAX + " תכנים", 2400); return; }
      if (TVG.nfReopen) TVG.nfReopen();
      if (!on) return;
      var undo = function () { setKind(x, kind, false); if (TVG.nfReopen) TVG.nfReopen(); TVG.pill("בוטל", 1200); };
      if (!TVG.pushOn) TVG.pill("🔔 נודיע לך", 5000, "ביטול", undo); // בלי פוש: הקישור "להפעלת התראות" בקבוצה עצמה
      else TVG.pill("🔔 נודיע לך " + kindName(kind), 4500, "ביטול", undo);
      return;
    }
    var nr = t.closest("[data-nfrem]");
    if (nr) {
      var x2 = TVG.nfGet(TVG.nfOpen); if (!x2) return;
      var w = nr.getAttribute("data-nfrem");
      if (w === "pick") { TVG.nfPick = TVG.nfPick === x2.k ? null : x2.k; if (TVG.nfReopen) TVG.nfReopen(); return; }
      createRem(x2, at21(w === "tonight" ? 0 : 1)); return;
    }
    if (t.closest("[data-nfremset]")) {
      var x3 = TVG.nfGet(TVG.nfOpen), inp = $("[data-nfremdt]"), d = inp && inp.value ? new Date(inp.value) : null;
      if (!x3) return;
      if (!d || isNaN(d)) { TVG.pill("בחרו תאריך ושעה", 1500); return; }
      createRem(x3, d); return;
    }
    var rm = t.closest("[data-wlrm]"); if (rm) { wlRemove(rm.getAttribute("data-wlrm")); return; }
  });
  TVG.nfPick = null;
})(window.TVG);
