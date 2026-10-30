/* js/render-grid.js - מסך 'לוח'.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now. */
(function (TVG) {
  var esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr, descHtml = TVG.descHtml;
  TVG.vGrid = vGrid;

  function vGrid() {
    var now = new Date(), h = TVG.pickers(now);
    var rows = (TVG.by.get(TVG.chId) || []).filter(function (p) { return dstr(p.s) === TVG.day; });
    h += '<div class="list">' + (rows.length ? rows.map(function (p) {
      var cls = p.s <= now && now < p.e ? " now" : (p.e <= now ? " past" : "");
      return '<div class="row' + cls + '" data-toggle tabindex="0"><span class="time">' + hhmm(p.s) + '</span><span class="ttl">' + esc(p.title) +
        (cls === " now" ? '<span class="tag">משודר עכשיו</span>' : "") + '</span><div class="more">' + descHtml(p, TVG.chId) + "</div></div>";
    }).join("") : '<div class="row"><span></span><span class="none">אין נתונים ליום הזה.</span></div>') + "</div>";
    return h;
  }
})(window.TVG);
