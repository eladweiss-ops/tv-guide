/* js/netflix.js - מסך 'נטפליקס'.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid. */
(function (TVG) {
  TVG.files["netflix"] = 1;
  var esc = TVG.esc;
  TVG.vNf = vNf;

  function nfDate(d, full) {
    if (!d) return "";
    var p = d.split("-");
    return full ? +p[2] + "." + +p[1] + "." + p[0] : p[0];
  }
  function vNf() {
    var list = (TVG.nfView === "new" ? TVG.NF["new"] : TVG.NF.popular) || [], t = TVG.q.trim().toLowerCase();
    if (t) list = list.filter(function (x) { return x.title.toLowerCase().indexOf(t) >= 0 || (x.orig || "").toLowerCase().indexOf(t) >= 0; });
    var h = '<div class="chips" role="group" aria-label="סוג רשימה"><button type="button" class="chip" data-nf="pop" aria-pressed="' + (TVG.nfView !== "new") + '">פופולרי עכשיו</button>' +
      '<button type="button" class="chip" data-nf="new" aria-pressed="' + (TVG.nfView === "new") + '">חדש ב-60 הימים האחרונים</button></div>';
    h += list.length ? '<div class="list">' + list.map(function (x) {
      var meta = [x.type === "tv" ? "סדרה" : "סרט", nfDate(x.date, TVG.nfView === "new"), x.rating ? "★ " + x.rating : ""].filter(Boolean).join(" · ");
      return '<div class="nf" data-toggle tabindex="0"><div class="poster">' +
        (x.poster ? '<img loading="lazy" alt="" src="https://image.tmdb.org/t/p/w185' + esc(x.poster) + '">' : "ללא תמונה") + '</div><div class="nfb"><div class="ttl">' + esc(x.title) + '</div><div class="sub">' + esc(meta) + "</div>" +
        '<p class="ov">' + (x.overview ? esc(x.overview) : "אין תקציר בעברית.") + "</p></div></div>";
    }).join("") + "</div>" : '<p class="none">לא נמצאו תוצאות.</p>';
    h += '<p class="credit">הנתונים מ-TMDB, וזמינות בנטפליקס מ-JustWatch. השירות משתמש ב-API של TMDB אך אינו מאושר או מוסמך על ידם.</p>';
    return h;
  }
})(window.TVG);
