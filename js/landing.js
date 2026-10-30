/* js/landing.js - דף נחיתה לתוכנית ששיתפו (?p=<ערוץ>.<YYMMDDHHMM> או הפורמט הישן <ערוץ>|<YYYY-MM-DDTHH:MM>).
   מי שמקבל קישור לא צריך את הלוח כולו: הוא צריך לא לפספס את התוכנית. לכן חלון מלא עם פעולה אחת ברורה (הוספה ליומן), תזכורת עם התראה, וקישור קטן ללוח.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, reminder-sheet, nav, share. נרשם כשכבה ב-nav.js (#land). */
(function (TVG) {
  TVG.files["landing"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.openShared = openLanding;
  TVG.openLanding = openLanding;
  TVG.closeLand = closeLand;
  TVG.landCh = null; // הערוץ שמוצג בדף הנחיתה: נוסף לערוצים שלי רק אם מגדירים תזכורת (reminder-sheet.js)

  var L = null; // {orig, r, kind: "ok" | "rerun" | "ended" | "missing", st}
  var tick = 0;
  var EM = { sport: "🏆", news: "📰", life: "🌿", ent: "📺", oth: "📺" };

  function parseP(v) { // -> {id, ts} או null
    v = String(v == null ? "" : v);
    var m = /^(.+)\.(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(v); // קצר: ערוץ.YYMMDDHHMM
    if (m) v = m[1] + "|20" + m[2] + "-" + m[3] + "-" + m[4] + "T" + m[5] + ":" + m[6];
    var k = v.lastIndexOf("|"), id = v.slice(0, k), st = v.slice(k + 1);
    if (k <= 0 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(st)) return null;
    return { id: TVG.IDMAP[id] || id, ts: TVG.parse(st).getTime() };
  }
  function status(p) { var n = Date.now(); return p.s.getTime() > n ? "up" : p.e.getTime() > n ? "live" : "past"; }
  function nextAiring(orig) { // אותו שם: קודם באותו ערוץ, אחר כך בכל ערוץ. הקרוב ביותר שעוד לא נגמר
    var t = String(orig.p.title).trim(), now = Date.now(), best = null;
    function scan(id) { (TVG.by.get(id) || []).forEach(function (p) { if (p.e.getTime() > now && String(p.title).trim() === t && (!best || p.s < best.p.s)) best = { id: id, p: p }; }); }
    scan(orig.id); if (best) return best;
    TVG.by.forEach(function (a, id) { if (id !== orig.id) scan(id); });
    return best;
  }
  function emojiOf(r) {
    var k = TVG.kindOf(r.id, r.p.title);
    if (k === "sport" && TVG.shareParts) return TVG.shareParts(r).emoji;
    return EM[k] || "📺";
  }
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
    if (st === "up") return durTxt(Math.ceil((r.p.s.getTime() - Date.now()) / 60000), "מתחיל ");
    var td = dstr(r.p.s) === dstr(new Date());
    return "שודר " + (td ? "" : "ב") + TVG.dayLabel(dstr(r.p.s)) + " בשעה " + hhmm(r.p.s);
  }
  function whenHtml(r) {
    var p = r.p, d = p.s;
    return '<div class="lnd-row"><span class="lnd-ic">🗓</span><span>יום ' + TVG.DAYS[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1) + "</span></div>" +
      '<div class="lnd-row"><span class="lnd-ic">🕐</span><span><bdi dir="ltr">' + hhmm(d) + '</bdi> – <bdi dir="ltr">' + hhmm(p.e) + "</bdi></span></div>";
  }

  function heroHtml(r) {
    var p = r.p, k = TVG.kindOf(r.id, p.title), st = status(p), b = "";
    if (st === "live" || p.lv === 1) b += '<span class="lnd-b live">● שידור ישיר</span>';
    if (p.rr) b += '<span class="lnd-b">שידור חוזר</span>';
    return '<div class="lnd-hero k-' + k + '"><div class="lnd-em" aria-hidden="true">' + emojiOf(r) + '</div><div class="lnd-ch"><bdi dir="rtl">' + esc(TVG.bidi(TVG.chName(r.id))) + "</bdi></div>" +
      '<h1 class="lnd-ttl"><bdi dir="rtl">' + esc(p.title) + "</bdi></h1>" + (b ? '<div class="lnd-bs">' + b + "</div>" : "") + "</div>";
  }
  function bodyHtml() {
    var h = '<div class="lnd-top"><span class="lnd-brand">📺 לוח שידורים</span><button type="button" class="glass round lnd-x" data-landclose aria-label="סגירה">✕</button></div>';
    if (L.kind === "missing") {
      return h + '<div class="lnd-empty"><div class="lnd-big">🔎</div><h1>לא מצאנו את התוכנית</h1><p>ייתכן שהלוח התעדכן והיא כבר לא מופיעה בו. אפשר לחפש אותה בלוח השידורים.</p></div>';
    }
    if (L.kind === "ended") {
      var o = L.orig;
      return h + '<div class="lnd-empty"><div class="lnd-big">⏱</div><h1>התוכנית כבר שודרה</h1><p><b>' + esc(o.p.title) + "</b><br><bdi dir=\"rtl\">" + esc(TVG.bidi(TVG.chName(o.id))) + "</bdi> · " + esc(cdTxt(o, "past")) + '</p><p class="lnd-sm">אין לה שידור נוסף בימים הקרובים בלוח.</p></div>';
    }
    var r = L.r, p = r.p, st = status(p);
    if (L.kind === "rerun") h += '<div class="lnd-note">⏱ התוכנית ששיתפו איתך כבר שודרה. הנה השידור הבא שלה:</div>';
    h += heroHtml(r) + '<div class="lnd-meta glass">' + whenHtml(r) + "</div>" +
      '<div class="lnd-cd ' + st + '" id="lndCd" role="status">' + esc(cdTxt(r, st)) + "</div>";
    if (p.desc) h += '<p class="lnd-syn">' + esc(p.desc) + "</p>";
    return h;
  }
  function barHtml() {
    var guide = '<button type="button" class="lnd-link" data-landguide>לכל לוח השידורים</button>';
    if (L.kind === "missing" || L.kind === "ended") return '<button type="button" class="btn" data-landguide>📺 לכל לוח השידורים</button>';
    var r = L.r, st = status(r.p);
    if (st === "live") return '<button type="button" class="btn" data-landguide>📺 לכל לוח השידורים</button>';
    var has = TVG.hasRem(TVG.remKey(r.id, r.p.s));
    return '<button type="button" class="btn" data-landcal>📅 הוספה ליומן</button>' +
      '<button type="button" class="ghost" data-landrem>' + (has ? "✓ יש תזכורת · שינוי" : "⏰ תזכורת עם התראה") + "</button>" + guide;
  }
  function paint() {
    var el = $("#land"); if (!el || !L) return;
    $("#landBody").innerHTML = bodyHtml(); $("#landBar").innerHTML = barHtml();
    $("#landBody").scrollTop = 0;
    TVG.landCh = L.r ? L.r.id : null;
  }
  function openLanding(v) {
    var pr = parseP(v), orig = pr ? TVG.findProg(pr.id + "|" + pr.ts) : null;
    L = { orig: orig, r: orig, kind: orig ? "ok" : "missing" };
    if (orig && status(orig.p) === "past") {
      var nx = nextAiring(orig);
      if (nx) { L.r = nx; L.kind = "rerun"; } else { L.r = null; L.kind = "ended"; }
    }
    TVG.setSearch(false); if (!$("#rem").hidden) TVG.closeRem();
    paint();
    $("#land").hidden = false; $("#scrim2").hidden = false;
    // היסטוריה: #land רשום ב-nav.js כשכבה (MutationObserver על hidden), כך ש"חזור" סוגר אותו
    clearInterval(tick); tick = setInterval(update, 20000);
  }
  function update() {
    if (!L || $("#land").hidden) { clearInterval(tick); return; }
    if (L.kind === "missing" || L.kind === "ended") return;
    var st = status(L.r.p), cd = $("#lndCd");
    if (!cd) return;
    if (!cd.classList.contains(st)) { paint(); return; } // עבר מ"עתידי" ל"משודר עכשיו"
    cd.textContent = cdTxt(L.r, st);
  }
  function closeLand() {
    var el = $("#land"); if (!el || el.hidden) return;
    el.hidden = true; clearInterval(tick);
    if ($("#rem").hidden && $("#favs").hidden && $("#setsheet").hidden && ($("#nfsheet").hidden)) $("#scrim2").hidden = true;
    var r = L && (L.orig || L.r); TVG.landCh = null;
    // סגירה: הלוח על יום/ערוץ התוכנית (אם הערוץ ברשימה שלי). מבקר ראשון (אין ערוצים) מקבל את בחירת הערוצים כרגיל
    if (r && TVG.chans().some(function (c) { return c.id === r.id; })) {
      TVG.chId = r.id; TVG.day = dstr(r.p.s); TVG.scrub = Math.round((r.p.s - TVG.dObj(TVG.day)) / 60000);
      TVG.tab = "dial"; TVG.store("tvg.tab", "dial");
    }
    TVG.render();
    if (TVG.needsPick() && $("#rem").hidden && TVG.store("tvg.tab") !== "nf") TVG.openSheet(true);
  }
  function fname(t) { return (String(t).replace(/[\\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "tv-guide") + ".ics"; }
  function addCal() {
    var r = L && L.r; if (!r) return;
    if (TVG.isAndroid) { TVG.calAdd(r); TVG.pill("נפתח יומן Google. לוחצים שם ״שמירה״", 3500); return; }
    TVG.saveIcs(TVG.icsText({ id: r.id, p: r.p, lead: 15 }), fname(r.p.title)); // התראה 15 דק׳ לפני
    TVG.pill("📅 לחצו על הקובץ שהורד כדי להוסיף ליומן", 3500);
  }
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest || !L || $("#land").hidden || !t.closest("#land")) return;
    if (t.closest("[data-landclose]") || t.closest("[data-landguide]")) { e.stopPropagation(); closeLand(); return; }
    if (t.closest("[data-landcal]")) { e.stopPropagation(); addCal(); return; }
    if (t.closest("[data-landrem]")) { e.stopPropagation(); if (L.r) TVG.openRem({ id: L.r.id, p: L.r.p }); return; }
  }, true);
  // חזרה מחלון התזכורת: מרעננים את הכפתור ("✓ יש תזכורת")
  try { new MutationObserver(function () { if (L && !$("#land").hidden && $("#rem").hidden && L.r && L.kind !== "missing" && L.kind !== "ended") $("#landBar").innerHTML = barHtml(); }).observe($("#rem"), { attributes: true, attributeFilter: ["hidden"] }); } catch (e) {}
})(window.TVG);
