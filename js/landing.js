/* js/landing.js - דף נחיתה לתוכנית ששיתפו (?p=<ערוץ>.<YYMMDDHHMM> או הפורמט הישן <ערוץ>|<YYYY-MM-DDTHH:MM>).
   מי שמקבל קישור לא צריך את הלוח כולו: הוא צריך לא לפספס את התוכנית. לכן חלון מלא עם פעולה אחת ברורה (הוספה ליומן), תזכורת עם התראה (רק כשהתראות אפשריות), וקישור קטן ללוח.
   מצבים: ok (התוכנית בלוח) · rerun (הסתיימה, יש שידור חוזר) · ended (הסתיימה, אין) · stub (לא בלוח, אבל הקישור עצמו מכיל ערוץ+מועד עתידי) · missing.
   אזור זמן: זמני הלוח הם שעון ישראל. כל השוואה לעכשיו עוברת דרך TVG.ilTs (core.js), והתצוגה ב-"שעון ישראל" כשהמכשיר באזור אחר.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, reminder-sheet, nav, share. נרשם כשכבה ב-nav.js (#land). */
(function (TVG) {
  TVG.files["landing"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.openShared = openLanding;
  TVG.openLanding = openLanding;
  TVG.closeLand = closeLand;
  TVG.landCh = null;    // הערוץ שמוצג בדף הנחיתה: נוסף לערוצים שלי רק אם מגדירים תזכורת (reminder-sheet.js recOf), עם הודעה
  TVG.landAdded = null; // שם הערוץ שנוסף כך, להודעה אחרי סגירת חלון התזכורת

  var APP = "https://eladweiss-ops.github.io/tv-guide/";
  var CORE = ["3787", "3819", "3826"]; // כאן 11, קשת 12, רשת 13 (נבחרים מראש לבורר הערוצים של מבקר ראשון)
  var L = null; // {orig, r, cal, kind, pr, link, safari}
  var tick = 0, UA = navigator.userAgent;
  var EM = { sport: "🏆", news: "📰", life: "🌿", ent: "📺", oth: "📺" };

  // דפדפן פנימי של אפליקציה (וואטסאפ, אינסטגרם...): הורדת קובץ יומן לא עובדת בו. מחושב בכל פעם (מצב "מותקנת" יכול להשתנות)
  function inApp() {
    if (TVG.isIOS) return !TVG.isStandalone && !/CriOS|FxiOS|EdgiOS/.test(UA) && (!/Safari\//.test(UA) || /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter|GSA\//.test(UA));
    return /; wv\)|FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|TikTok|Twitter/.test(UA);
  }
  // התראות פוש אפשריות באמת: אנדרואיד עם תמיכה; באייפון רק באפליקציה שמותקנת במסך הבית
  function canRem() { return !!TVG.canPush && (!TVG.isIOS || !!TVG.isStandalone) && !inApp(); }

  function parseP(v) { // -> {id, ts} (ts = שעון קיר ישראלי כ-Date מקומי, כמו TVG.parse) או null
    v = String(v == null ? "" : v);
    var m = /^(.+)\.(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(v); // קצר: ערוץ.YYMMDDHHMM
    if (m) v = m[1] + "|20" + m[2] + "-" + m[3] + "-" + m[4] + "T" + m[5] + ":" + m[6];
    var k = v.lastIndexOf("|"), id = v.slice(0, k), st = v.slice(k + 1);
    if (k <= 0 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(st)) return null;
    return { id: TVG.IDMAP[id] || id, ts: TVG.parse(st).getTime(), raw: v };
  }
  function real(d) { return TVG.ilTs(d); }
  function status(p) { var n = Date.now(); return real(p.s) > n ? "up" : real(p.e) > n ? "live" : "past"; }
  function nextAiring(orig) { // אותו שם: קודם באותו ערוץ, אחר כך בכל ערוץ. הקרוב ביותר שעוד לא נגמר
    var t = String(orig.p.title).trim(), now = Date.now(), best = null;
    function scan(id) { (TVG.by.get(id) || []).forEach(function (p) { if (real(p.e) > now && String(p.title).trim() === t && (!best || p.s < best.p.s)) best = { id: id, p: p }; }); }
    scan(orig.id); if (best) return best;
    TVG.by.forEach(function (a, id) { if (id !== orig.id) scan(id); });
    return best;
  }
  function emojiOf(r) {
    var k = TVG.kindOf(r.id, r.p.title);
    if (k === "sport" && TVG.shareParts) return TVG.shareParts(r).emoji;
    return EM[k] || "📺";
  }
  function chB(id) { return esc(TVG.bidi(TVG.chName(id))); }
  function dayTxt(d) { return "יום " + TVG.DAYS[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1); }
  function durTxt(m, pre) {
    var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
    if (m < 1) return pre + "עוד רגע";
    if (m < 60) return pre + "בעוד " + m + " דק׳";
    if (d >= 2) return pre + "בעוד " + d + " ימים";
    if (d === 1) return pre + "בעוד יום" + (h ? " ו-" + h + " שע׳" : "");
    return pre + "בעוד " + h + " שע׳" + (mi ? " " + mi + " דק׳" : "");
  }
  function cdTxt(r, st) {
    if (st === "live") return "● משודר עכשיו";
    if (st === "up") return durTxt(Math.ceil((real(r.p.s) - Date.now()) / 60000), "מתחיל ");
    var td = dstr(r.p.s) === dstr(TVG.ilNow());
    return "שודר " + (td ? "היום" : "ב" + dayTxt(r.p.s)) + " בשעה " + hhmm(r.p.s);
  }
  function tzDiff(p) { var t = real(p.s); return TVG.ilOffMin(t) !== -new Date(t).getTimezoneOffset(); }
  function whenHtml(r, single) {
    var p = r.p, tz = tzDiff(p) ? ' <small class="lnd-tz">(שעון ישראל)</small>' : "";
    return '<div class="lnd-row"><span class="lnd-ic">🗓</span><span>' + dayTxt(p.s) + "</span></div>" +
      '<div class="lnd-row"><span class="lnd-ic">🕐</span><span>' + (single ? '<bdi dir="ltr">' + hhmm(p.s) + "</bdi>" : '<bdi dir="ltr">' + hhmm(p.s) + '</bdi> – <bdi dir="ltr">' + hhmm(p.e) + "</bdi>") + tz + "</span></div>";
  }

  function heroHtml(r, stub) {
    var p = r.p, k = TVG.kindOf(r.id, p.title), st = status(p), b = "";
    if (st === "live" || p.lv === 1) b += '<span class="lnd-b live">● שידור ישיר</span>';
    if (p.rr) b += '<span class="lnd-b">שידור חוזר</span>';
    return '<div class="lnd-hero k-' + k + '"><div class="lnd-em" aria-hidden="true">' + emojiOf(r) + "</div>" + (stub ? "" : '<div class="lnd-ch"><bdi dir="rtl">' + chB(r.id) + "</bdi></div>") +
      '<h1 class="lnd-ttl"><bdi dir="auto">' + (stub ? "תוכנית ב" + chB(r.id) : esc(p.title)) + "</bdi></h1>" + (b ? '<div class="lnd-bs">' + b + "</div>" : "") + "</div>";
  }
  function bodyHtml() {
    var h = '<div class="lnd-top"><span class="lnd-brand">📺 לוח שידורים</span><button type="button" class="glass round lnd-x" data-landclose aria-label="סגירה">✕</button></div>';
    if (L.kind === "missing") {
      var pr = L.pr, has = pr && TVG.chName(pr.id), d = pr && new Date(pr.ts);
      return h + '<div class="lnd-empty"><div class="lnd-big">🔎</div><h1>לא מצאנו את התוכנית</h1>' +
        (has ? '<p><bdi dir="rtl">' + chB(pr.id) + "</bdi> · " + dayTxt(d) + " · <bdi dir=\"ltr\">" + hhmm(d) + "</bdi></p>" : "") +
        "<p>ייתכן שהלוח התעדכן והיא כבר לא מופיעה בו. אפשר לחפש אותה בלוח השידורים.</p></div>";
    }
    if (L.kind === "ended") {
      var o = L.orig;
      return h + '<div class="lnd-empty"><div class="lnd-big">⏱</div><h1>התוכנית כבר שודרה</h1><p><b><bdi dir="auto">' + esc(o.p.title) + '</bdi></b><br><bdi dir="rtl">' + chB(o.id) + "</bdi> · " + esc(cdTxt(o, "past")) + '</p><p class="lnd-sm">אין לה שידור נוסף בימים הקרובים בלוח.</p></div>';
    }
    var r = L.r, p = r.p, st = status(p), stub = L.kind === "stub";
    if (L.kind === "rerun") h += '<div class="lnd-note">⏱ התוכנית ששיתפו איתך כבר שודרה. הנה השידור הבא שלה:</div>';
    if (stub) h += '<div class="lnd-note">פרטי התוכנית עוד לא בלוח, אבל אפשר להוסיף את המועד ליומן.</div>';
    h += heroHtml(r, stub) + '<div class="lnd-meta glass">' + whenHtml(r, stub) + "</div>" +
      '<div class="lnd-cd ' + st + '" id="lndCd" role="status">' + esc(cdTxt(r, st)) + "</div>";
    if (p.desc) h += '<p class="lnd-syn">' + esc(p.desc) + "</p>";
    return h;
  }
  function barHtml() {
    var guide = '<button type="button" class="lnd-link" data-landguide>לכל לוח השידורים</button>';
    var gbtn = '<button type="button" class="btn" data-landguide>📺 לכל לוח השידורים</button>';
    if (L.kind === "missing" || L.kind === "ended") return gbtn;
    var r = L.r, st = status(r.p);
    if (st === "live") return gbtn;
    if (L.safari) return '<div class="lnd-safari"><b>🧭 פתחו ב-Safari</b><span>הדפדפן הפנימי לא יודע להוסיף ליומן. בתפריט ⋯ (או סמל הדפדפן) בוחרים פתיחה ב-Safari, ושם מוסיפים ליומן.</span></div>' +
      '<button type="button" class="btn" data-landcopy>📋 העתקת הקישור</button>' + guide;
    var h = '<button type="button" class="btn" data-landcal>📅 הוספה ליומן</button>';
    if (L.kind !== "stub") {
      if (canRem()) h += '<button type="button" class="ghost" data-landrem>' + (TVG.hasRem(TVG.remKey(r.id, r.p.s)) ? "✓ יש תזכורת · שינוי" : "⏰ תזכורת עם התראה") + "</button>";
      else if (TVG.isIOS) h += '<p class="lnd-hint">לקבלת התראות לטלפון: הוספה למסך הבית</p>';
    }
    return h + guide;
  }
  function paint() {
    var el = $("#land"); if (!el || !L) return;
    $("#landBody").innerHTML = bodyHtml(); $("#landBar").innerHTML = barHtml();
    $("#landBody").scrollTop = 0;
    TVG.landCh = L.r && L.kind !== "stub" ? L.r.id : null;
  }
  function openLanding(v) {
    var pr = parseP(v), orig = pr ? TVG.findProg(pr.id + "|" + pr.ts) : null;
    L = { orig: orig, r: orig, kind: orig ? "ok" : "missing", pr: pr, link: pr ? APP + "?p=" + encodeURIComponent(pr.id) + "." + dstr(new Date(pr.ts)).replace(/\D/g, "").slice(2) + hhmm(new Date(pr.ts)).replace(/\D/g, "") : APP };
    TVG.landAdded = null;
    if (orig && status(orig.p) === "past") {
      var nx = nextAiring(orig);
      if (nx) { L.r = nx; L.kind = "rerun"; } else { L.r = null; L.kind = "ended"; }
    } else if (!orig && pr && TVG.chName(pr.id)) { // לא בלוח, אבל הקישור עצמו מכיל ערוץ ומועד: מציגים אותם
      var s = new Date(pr.ts), p = { title: "תוכנית ב" + TVG.chName(pr.id), desc: "", s: s, e: new Date(s.getTime() + 3600000), lv: -1, rr: 0 };
      if (status(p) === "up") { L.kind = "stub"; L.r = { id: pr.id, p: p }; L.cal = { id: "", p: p }; }
    }
    TVG.setSearch(false); if (!$("#rem").hidden) TVG.closeRem();
    paint();
    $("#land").hidden = false; $("#scrim2").hidden = false;
    // היסטוריה: #land רשום ב-nav.js כשכבה (MutationObserver על hidden), כך ש"חזור" סוגר אותו
    clearInterval(tick); tick = setInterval(update, 20000);
  }
  function update() {
    if (!L || $("#land").hidden) { clearInterval(tick); return; }
    if (!L.r || L.safari) return;
    var st = status(L.r.p), cd = $("#lndCd");
    if (!cd) return;
    if (!cd.classList.contains(st)) { paint(); return; } // עבר מ"עתידי" ל"משודר עכשיו"
    cd.textContent = cdTxt(L.r, st);
  }
  // toGuide=true: "לכל לוח השידורים". ✕ / חזרה / Escape רק סוגרים, בלי לפתוח בורר ערוצים
  function closeLand(toGuide) {
    var el = $("#land"); if (!el || el.hidden) return;
    el.hidden = true; clearInterval(tick);
    if ($("#rem").hidden && $("#favs").hidden && $("#setsheet").hidden && ($("#nfsheet").hidden)) $("#scrim2").hidden = true;
    var r = L && (L.orig || L.r), pr = L && L.pr; TVG.landCh = null; TVG.landAdded = null;
    if (r && TVG.chans().some(function (c) { return c.id === r.id; })) { // הלוח על יום/ערוץ התוכנית (אם הערוץ ברשימה שלי)
      TVG.chId = r.id; TVG.day = dstr(r.p.s); TVG.scrub = Math.round((r.p.s - TVG.dObj(TVG.day)) / 60000);
      TVG.tab = "dial"; TVG.store("tvg.tab", "dial");
    }
    TVG.render();
    if (toGuide === true && TVG.needsPick() && $("#rem").hidden && TVG.store("tvg.tab") !== "nf") { // מבקר ראשון: בורר הערוצים, עם הערוץ ששותף וערוצי הליבה מסומנים מראש
      var id = r ? r.id : pr && pr.id; if (id && TVG.by.has(id)) TVG.sel.add(id);
      CORE.forEach(function (c) { if (TVG.by.has(c)) TVG.sel.add(c); });
      TVG.openSheet(true);
    }
  }
  function fname(t) { return (String(t).replace(/[\\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "tv-guide") + ".ics"; }
  function addCal() {
    var r = L && (L.cal || L.r); if (!r) return;
    if (TVG.isIOS && inApp()) { L.safari = true; $("#landBar").innerHTML = barHtml(); return; }
    if (TVG.isAndroid) {
      if (inApp()) { location.href = TVG.gcalUrl(r); return; } // בדפדפן פנימי חלון חדש נחסם
      TVG.calAdd(r); TVG.pill("נפתח יומן Google. לוחצים שם ״שמירה״", 3500); return;
    }
    TVG.saveIcs(TVG.icsText({ id: r.id, p: r.p, lead: 15 }), fname(r.p.title)); // התראה 15 דק׳ לפני
    TVG.pill("📅 לחצו על הקובץ שהורד כדי להוסיף ליומן", 3500);
  }
  function copyLink() {
    var l = L.link, ok = function () { TVG.pill("🔗 הקישור הועתק. הדביקו אותו ב-Safari", 3000); };
    function old() { var t = document.createElement("textarea"); t.value = l; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;opacity:0"; document.body.appendChild(t); t.select(); var g = false; try { g = document.execCommand("copy"); } catch (e) {} t.remove(); if (g) ok(); else TVG.pill("לא הצלחנו להעתיק", 1800); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(l).then(ok, old); else old();
  }
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest || !L || $("#land").hidden || !t.closest("#land")) return;
    if (t.closest("[data-landguide]")) { e.stopPropagation(); closeLand(true); return; }
    if (t.closest("[data-landclose]")) { e.stopPropagation(); closeLand(); return; }
    if (t.closest("[data-landcal]")) { e.stopPropagation(); addCal(); return; }
    if (t.closest("[data-landcopy]")) { e.stopPropagation(); copyLink(); return; }
    if (t.closest("[data-landrem]")) { e.stopPropagation(); if (L.r) TVG.openRem({ id: L.r.id, p: L.r.p }); return; }
  }, true);
  // חזרה מחלון התזכורת: מרעננים את הכפתור ("✓ יש תזכורת"), ואם הערוץ נוסף לערוצים שלי בגלל התזכורת, מודיעים על כך
  try {
    new MutationObserver(function () {
      if (!L || $("#land").hidden || !$("#rem").hidden) return;
      if (L.r && L.kind !== "missing" && L.kind !== "ended" && !L.safari) $("#landBar").innerHTML = barHtml();
      if (TVG.landAdded) { var n = TVG.landAdded; TVG.landAdded = null; setTimeout(function () { TVG.pill("הוספנו את " + n + " לערוצים שלך", 2800); }, 1700); }
    }).observe($("#rem"), { attributes: true, attributeFilter: ["hidden"] });
  } catch (e) {}
})(window.TVG);
