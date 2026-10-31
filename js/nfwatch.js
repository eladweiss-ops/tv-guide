/* js/nfwatch.js - בדף התוכן של נטפליקס: "🔔 תודיע לי" (רשימת מעקב בשרת, בדיקה יומית) ו"⏰ להזכיר לי לצפות" (תזכורת אישית רגילה),
   ובהגדרות: רשימת "התראות נטפליקס" עם הסרה. חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, netflix.
   אחסון מקומי: tvg.wl = [{k,title,orig,type,poster,link,y,on:["nf"|"season"|"tv"],at,bn,bc}] (גם בגיבוי). שרת: POST /api/watch (כל הרשימה, רק עם מנוי פוש). */
(function (TVG) {
  TVG.files["nfwatch"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.nfAlerts = alertsHtml;
  TVG.nfWatchRem = watchRemHtml;
  TVG.wlItem = wlItem;
  TVG.wlRender = wlRender;
  TVG.wlSync = wlSync;

  var MAX = 50, API = TVG.CAL_API;
  var RE_K = /^[mt][0-9]{1,9}$/, RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\//, RE_NF = /^https:\/\/www\.netflix\.com\//;
  var KINDS = [["nf", "כשזה מגיע לנטפליקס", "כשזה מגיע לנטפליקס"], ["season", "עונה חדשה", "כשיוצאת עונה חדשה"], ["tv", "כשזה משודר בערוץ", "כשזה משודר בערוץ"]];
  function kindName(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === k) return KINDS[i][2]; return ""; }
  // אותו קישור שהשרת בונה (calendar-server/api/_tmdb.js nfLink): חיפוש בנטפליקס לפי השם המקורי, ואם אין אז העברי
  function nfLink(title, orig) { var q = String(orig || title || "").slice(0, 100); return q ? "https://www.netflix.com/search?q=" + encodeURIComponent(q) : ""; }
  // 21:00 הערב / מחר לפי שעון ישראל (גם כשהמכשיר באזור אחר)
  function at21(addDays) { var w = TVG.ilNow(); w.setDate(w.getDate() + addDays); w.setHours(21, 0, 0, 0); return new Date(TVG.ilTs(w)); }
  // d אמיתי -> שעון קיר ישראלי (לתצוגה)
  function ilWall(d) { return new Date(TVG.ilNow().getTime() + (d.getTime() - Date.now())); }

  // ---- רשימת המעקב ----
  TVG.WL = [];
  try { (JSON.parse(TVG.store("tvg.wl") || "[]") || []).forEach(function (x) { if (x && RE_K.test(x.k || "") && x.title && Array.isArray(x.on) && x.on.length) TVG.WL.push(x); }); } catch (e) { TVG.WL = []; }
  function wlSave() { TVG.store("tvg.wl", JSON.stringify(TVG.WL)); }
  function wlFind(k) { for (var i = 0; i < TVG.WL.length; i++) if (TVG.WL[i].k === k) return TVG.WL[i]; return null; }
  function wlHas(k, kind) { var w = wlFind(k); return !!w && w.on.indexOf(kind) >= 0; }
  function remOf(k) { // תזכורת צפייה שמורה (נשמרת מקומית עם פרטי הפריט), לפתיחה אחרי רענון/הודעה
    for (var i = TVG.REMS.length - 1; i >= 0; i--) { var r = TVG.REMS[i]; if (r.k.indexOf("nf|" + k + "|") === 0) return r; }
    return null;
  }
  // פריט "דל" לפתיחה מהודעה/תזכורת. ev: "nf" = ההודעה אמרה שהגיע לנטפליקס (תמיד ▶ פתח בנטפליקס), "rem" = מתזכורת צפייה
  function wlItem(k, ev) {
    var w = wlFind(k), r = remOf(k), nx = r && r.nx;
    if (!w && !nx) return null;
    var title = w ? w.title : nx.t || r.title, orig = w ? w.orig || "" : "", type = (w ? w.type : nx.ty) === "tv" ? "tv" : "movie", poster = w ? w.poster : nx.p;
    var link = (w && RE_NF.test(w.link || "") && w.link) || (nx && RE_NF.test(nx.l || "") && nx.l) || "";
    var avail = ev === "nf" || (ev === "rem" && !!(nx && nx.l)); // נפתח מ"הגיע" או מתזכורת שנוצרה כשהיה בנטפליקס
    return { k: k, type: type, title: title, orig: orig, poster: RE_IMG.test(poster || "") ? poster : "", year: w && w.y || 0, nf: avail, link: avail ? link || nfLink(title, orig) : "", others: [], _wl: true };
  }
  // סנכרון לשרת: רק כשההתראות פעילות (השרת מקבל רק מי שיש לו מנוי פוש). אחרת נשמר מקומית וייסנכרן כשיופעלו
  function wlSync() {
    if (!TVG.pushOn) { TVG.store("tvg.wlDirty", "1"); return Promise.resolve(false); }
    var t; try { t = TVG.myTok(); } catch (e) { return Promise.resolve(false); }
    return fetch(API + "/api/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: t, items: TVG.WL }) })
      .then(function (r) { if (!r.ok) throw 0; TVG.store("tvg.wlDirty", "0"); return true; })
      .catch(function () { TVG.store("tvg.wlDirty", "1"); return false; });
  }
  if (TVG.store("tvg.wlDirty") === "1") setTimeout(wlSync, 4000); // שמירה שנכשלה / נשמר בלי פוש: ניסיון חוזר בעלייה הבאה

  function setKind(x, kind, on) { // ללא הודעות. מחזיר true אם השתנה, null אם הרשימה מלאה
    var w = wlFind(x.k);
    if (on) {
      if (w && w.on.indexOf(kind) >= 0) return false;
      if (!w) {
        if (TVG.WL.length >= MAX) return null;
        w = { k: x.k, title: String(x.title).slice(0, 120), orig: String(x.orig || "").slice(0, 120), type: x.type === "tv" ? "tv" : "movie", poster: RE_IMG.test(x.poster || "") ? x.poster : "", link: nfLink(x.title, x.orig), y: +x.year > 0 ? +x.year : 0, on: [], at: Date.now() };
        // בסיס "לא בנטפליקס" נשלח רק מתשובה שלמה (לא חלקית, לא ממצב לא ידוע); אחרת השרת קובע בסיס בבדיקה הראשונה
        if (x.nf === false && !x._p && !x._wl) { w.bn = false; w.bc = 1; }
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

  function pushHint() {
    if (TVG.pushOn) return "";
    if (TVG.isIOS && !TVG.isStandalone) return '<p class="credit">ההתראות עובדות רק מהאפליקציה שבמסך הבית: בספארי לוחצים על כפתור השיתוף ואז על ״הוסף למסך הבית״.</p>';
    return '<p class="credit">ההתראות מגיעות כהתראת פוש, והן כבויות כרגע. <button type="button" class="linkbtn" data-pushon>להפעלת התראות</button></p>';
  }
  function alertsHtml(x) {
    var chips = KINDS.filter(function (kd) {
      if (kd[0] === "nf") return !TVG.nfIsNf(x) || wlHas(x.k, "nf");   // כבר בנטפליקס: אין מה להתריע
      if (kd[0] === "season") return x.type === "tv";
      return true;
    }).map(function (kd) {
      return '<button type="button" class="chip" data-wlkind="' + kd[0] + '" aria-pressed="' + wlHas(x.k, kd[0]) + '">' + kd[1] + "</button>";
    }).join("");
    return '<div class="nfgrp" role="group" aria-label="התראות"><div class="lbl">🔔 תודיע לי</div><div class="chips lp">' + chips + "</div>" + pushHint() + "</div>";
  }

  // ---- ⏰ להזכיר לי לצפות ----
  function myRems(k) { var now = Date.now(); return TVG.REMS.filter(function (r) { return r.k.indexOf("nf|" + k + "|") === 0 && r.ts > now; }); }
  function dayTxt(w) { var t = dstr(w), n = TVG.ilNow(); if (t === dstr(n)) return "הערב"; n.setDate(n.getDate() + 1); return t === dstr(n) ? "מחר" : TVG.dayLabel(t); }
  function watchRemHtml(x) {
    var tonight = at21(0), ok = tonight.getTime() > Date.now() + 5 * 60000, rs = myRems(x.k);
    var h = '<div class="nfgrp" role="group" aria-label="תזכורת צפייה"><div class="lbl">⏰ להזכיר לי לצפות</div><div class="chips lp">' +
      (ok ? '<button type="button" class="chip" data-nfrem="tonight">הערב 21:00</button>' : "") +
      '<button type="button" class="chip" data-nfrem="tomorrow">מחר 21:00</button>' +
      '<button type="button" class="chip" data-nfrem="pick" aria-pressed="' + (TVG.nfPick === x.k) + '">בחירת שעה</button></div>';
    if (TVG.nfPick === x.k) {
      var d = ilWall(at21(1)), min = ilWall(new Date(Date.now() + 120000)); // השדה בשעון ישראל
      h += '<div class="lpcustom"><input type="datetime-local" data-nfremdt min="' + TVG.localVal(min) + '" value="' + TVG.localVal(d) + '" aria-label="מועד התזכורת"><button type="button" class="ghost sm" data-nfremset>קביעה</button></div>';
    }
    rs.forEach(function (r) { var d = ilWall(new Date(r.ts)); h += '<p class="credit nfremd">⏰ יש תזכורת: ' + esc(dayTxt(d)) + " ב־" + hhmm(d) + "</p>"; });
    return h + "</div>";
  }
  function createRem(x, d) {
    var ts = d.getTime();
    if (!(ts > Date.now() + 60000)) { TVG.pill("בחרו זמן עתידי", 1600); return; }
    var nf = TVG.nfIsNf(x), link = nf && /^https:\/\/www\.netflix\.com\//.test(x.link || "") ? x.link : "";
    // הפרטים נשמרים ברשומה (מקומית) כדי שהקשה על התזכורת תפתח את דף התוכן גם אחרי רענון
    var rec = { k: "nf|" + x.k + "|" + ts, id: "", ts: ts, end: ts + 2 * 3600000, title: String(x.title).slice(0, 120), ch: nf ? "נטפליקס" : "צפייה", desc: link ? "▶ לצפייה בנטפליקס: " + link : "", lead: 0, at: Date.now(),
      nx: { t: String(x.title).slice(0, 120), ty: x.type === "tv" ? "tv" : "movie", p: RE_IMG.test(x.poster || "") ? x.poster : "", l: link } };
    if (TVG.hasRem(rec.k)) { TVG.pill("כבר יש תזכורת לזמן הזה ✓", 1600); return; }
    if (TVG.addRec(rec, d) === "pending") return; // הפעלת התראות בדרך; ההודעה (עם ביטול) מגיעה מ-push.js
    TVG.nfPick = null; TVG.render(); if (TVG.nfReopen) TVG.nfReopen();
    var w = ilWall(d), same = dstr(w) === dstr(TVG.ilNow());
    TVG.pill("⏰ נזכיר לך " + (same ? "" : dayTxt(w) + " ") + "ב־" + hhmm(w), 5000, "ביטול", function () { undoRem(rec.k); });
  }
  function undoRem(k) {
    TVG.REMS = TVG.REMS.filter(function (r) { return r.k !== k; }); TVG.saveRems(); TVG.syncRems(); TVG.render(); if (TVG.nfReopen) TVG.nfReopen(); TVG.pill("בוטל", 1200);
  }
  TVG.nfUndoRem = undoRem;

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

  // הודעה אחרי הוספת התראה: בלי פוש לא מציגים "נודיע לך" (זה לא נכון), אלא הסבר ישר
  function addedToast(kind, undo) {
    if (TVG.pushOn) { TVG.pill("🔔 נודיע לך " + kindName(kind), 4500, "ביטול", undo); return; }
    if (TVG.isIOS && !TVG.isStandalone) { TVG.pill("נשמר, אבל התראות עובדות רק מהאפליקציה שבמסך הבית", 6000, "ביטול", undo); return; }
    if (TVG.canPush) TVG.pill("נשמר. ההתראות כבויות, אז לא נוכל להודיע", 6500, "להפעלת התראות", function () { TVG.enablePush(); }, "ביטול", undo);
    else TVG.pill("נשמר, אבל המכשיר הזה לא תומך בהתראות", 5000, "ביטול", undo);
  }

  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var wk = t.closest("[data-wlkind]");
    if (wk) {
      var x = TVG.nfGet(TVG.nfOpen); if (!x) return;
      var kind = wk.getAttribute("data-wlkind"), on = !wlHas(x.k, kind), r = setKind(x, kind, on);
      if (r === null) { TVG.pill("אפשר לעקוב אחרי עד " + MAX + " תכנים", 2400); return; }
      if (TVG.nfReopen) TVG.nfReopen();
      if (!on) { // הסרה דרך הצ'יפ: אפשר להחזיר
        TVG.pill("ההתראה הוסרה", 4500, "החזר", function () { setKind(x, kind, true); if (TVG.nfReopen) TVG.nfReopen(); TVG.pill("הוחזרה ✓", 1200); });
        return;
      }
      addedToast(kind, function () { setKind(x, kind, false); if (TVG.nfReopen) TVG.nfReopen(); TVG.pill("בוטל", 1200); });
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
      var x3 = TVG.nfGet(TVG.nfOpen), inp = $("[data-nfremdt]"), d = null;
      if (inp && inp.value) { var m = inp.value.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/); if (m) d = new Date(TVG.ilTs(new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]))); } // השעה שנבחרה היא שעון ישראל
      if (!x3) return;
      if (!d || isNaN(d)) { TVG.pill("בחרו תאריך ושעה", 1500); return; }
      createRem(x3, d); return;
    }
    var rm = t.closest("[data-wlrm]"); if (rm) { wlRemove(rm.getAttribute("data-wlrm")); return; }
  });
  TVG.nfPick = null;
})(window.TVG);
