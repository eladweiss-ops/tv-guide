/* js/favs.js - חלון המועדפים.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings, search. */
(function (TVG) {
  TVG.files["favs"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr, FAV = TVG.FAV;
  TVG.closeFavs = closeFavs;
  TVG.favHtml = favHtml;
  TVG.openFavs = openFavs;
  TVG.updFav = updFav;

  function updFav() { $("#fvCount").textContent = FAV.size ? String(FAV.size) : ""; }
  function favHtml() {
    var now = new Date(), next = {};
    if (FAV.size) TVG.G.channels.forEach(function (c) {
      (TVG.by.get(c.id) || []).forEach(function (p) { if (p.s > now && FAV.has(p.title) && (!next[p.title] || p.s < next[p.title].p.s)) next[p.title] = { c: c, p: p }; });
    });
    var titles = Array.from(FAV).sort(function (a, b) { return a.localeCompare(b, "he"); });
    var h = "<h2>המועדפים שלי</h2>";
    h += titles.length ? titles.map(function (t) {
      var n = next[t], sub = n ? "הבא: " + TVG.dayLabel(dstr(n.p.s)) + " " + hhmm(n.p.s) + " · " + n.c.name : "אין שידור בימים הקרובים";
      return '<div class="srow"><button type="button" class="go sg" data-favsearch="' + esc(t) + '"><span class="ttl">' + esc(t) + '<br><span class="sub">' + esc(sub) + '</span></span></button><button type="button" class="rbt" data-favdel="' + esc(t) + '" aria-label="הסר מהמועדפים: ' + esc(t) + '">✕</button></div>';
    }).join("") : '<p class="none">עדיין אין מועדפים. מחפשים תוכנית וסומנים בכוכב, או לוחצים על "הוסף למועדפים" בכרטיס של תוכנית.</p>';
    h += '<h2 class="sech">נושאים שאני עוקב אחריהם</h2>';
    h += TVG.TOPICS.length ? TVG.TOPICS.map(function (t) {
      var a = TVG.topicAirs(t), live = a.filter(function (x) { return x.p.s <= now; }).length, n = a.filter(function (x) { return x.p.s > now; })[0];
      var sub = (live ? "● משודר עכשיו · " : "") + (n ? "הבא: " + TVG.dayLabel(dstr(n.p.s)) + " " + hhmm(n.p.s) + " · " + n.c.name : "אין שידור בימים הקרובים") + (a.length ? " · " + a.length + " שידורים" : "");
      return '<div class="srow"><button type="button" class="go sg" data-topic="' + esc(t) + '"><span class="ttl">⭐ ' + esc(t) + '<br><span class="sub">' + esc(sub) + '</span></span></button><button type="button" class="rbt" data-topicdel="' + esc(t) + '" aria-label="הפסקת מעקב: ' + esc(t) + '">✕</button></div>';
    }).join("") : '<p class="none">אפשר לעקוב אחרי קבוצה, שחקן או שף: מחפשים למשל "מכבי חיפה" או "חיים כהן" ולוחצים "לעקוב".</p>';
    h += '<button type="button" class="btn" data-favadd>הוספת תוכנית</button><button type="button" class="ghost" data-topicadd>הוספת נושא למעקב</button>';
    if (titles.length > 1) h += '<button type="button" class="ghost" data-favclear>' + (TVG.delArm ? "בטוח? לחיצה נוספת תסיר את כולם" : "הסר הכל") + "</button>";
    h += '<button type="button" class="ghost" data-favclose>סגירה</button>';
    return h;
  }
  function openFavs() { TVG.delArm = false; $("#favBody").innerHTML = favHtml(); $("#favs").hidden = false; $("#scrim2").hidden = false; }
  function closeFavs() { if (TVG.closeNf) TVG.closeNf(); $("#favs").hidden = true; $("#setsheet").hidden = true; if ($("#rem").hidden) $("#scrim2").hidden = true; }
})(window.TVG);
