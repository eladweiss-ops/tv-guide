/* js/render-common.js - רכיבי תצוגה משותפים: תקציר, שורת שידור, 'עוד מעט'.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems. */
(function (TVG) {
  TVG.files["render-common"] = 1;
  var esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr, FAV = TVG.FAV;
  TVG.inMin = inMin;
  TVG.soonHtml = soonHtml;
  TVG.synBox = synBox;
  TVG.synBtn = synBtn;
  TVG.tapDial = tapDial;

  function tapDial() {
    var T = TVG.scrub == null ? TVG.dialT() : TVG.scrub, now = new Date(), sg = null;
    if (TVG.D) TVG.D.segs.forEach(function (x) { if (T >= x.a && T < x.b) sg = x; });
    if (!sg) return;
    if (sg.p.s > now) TVG.openRem({ id: TVG.chId, p: sg.p }); else TVG.pill(sg.p.e > now ? "התוכנית משודרת עכשיו" : "התוכנית כבר שודרה", 1400);
  }
  function inMin(d, now) { var m = Math.max(1, Math.round((d - now) / 60000)); return m < 60 ? m + " דק׳" : Math.floor(m / 60) + " שע׳" + (m % 60 ? " " + (m % 60) + " דק׳" : ""); }
  function synBtn(v) { return '<button type="button" class="synb" data-syn="' + esc(v) + '" aria-expanded="false">תקציר</button>'; }
  function synBox(v, p, cid) { return '<div class="syn" data-synbox="' + esc(v) + '" hidden>' + TVG.synText(p, cid) + (TVG.shareBtn ? TVG.shareBtn(p, cid) : "") + "</div>"; }
  function airRow(c, p, sub) {
    var v = c.id + "|" + p.s.getTime();
    return '<div class="srow k-' + TVG.kindOf(c.id, p.title) + '"><button type="button" class="go" data-jump="' + esc(v) + '"><span class="time">' + hhmm(p.s) + '</span><span class="ttl">' + esc(p.title) + '<br><span class="sub">' + esc(sub) + "</span></span></button>" + synBtn(v) +
      '<button type="button" class="rbt' + (TVG.hasRem(v) ? " on" : "") + '" data-rem="' + esc(v) + '" aria-label="תזכורת: ' + esc(p.title) + '">' + (TVG.hasRem(v) ? "✓" : "⏰") + "</button></div>" + synBox(v, p, c.id);
  }
  function soonHtml(now) {
    var soon = [], favs = [];
    TVG.chans().forEach(function (c) {
      var a = TVG.by.get(c.id) || [], first = true;
      a.forEach(function (p) {
        if (p.s <= now) return;
        if (first) { soon.push({ c: c, p: p }); first = false; }
        if ((FAV.has(p.title) || (TVG.TOPICS.length && TVG.TOPICS.some(function (tp) { return TVG.topicHit(p, TVG.topicAlts(tp)); }))) && favs.length < 200) favs.push({ c: c, p: p });
      });
    });
    soon.sort(function (x, y) { return x.p.s - y.p.s; });
    favs.sort(function (x, y) { return x.p.s - y.p.s; });
    var h = "";
    if (soon.length) h += '<h2 class="sech">מתחיל בקרוב</h2>' + soon.slice(0, 3).map(function (x) { return airRow(x.c, x.p, x.c.name + " · בעוד " + inMin(x.p.s, now)); }).join("");
    if (favs.length) h += '<h2 class="sech">★ המועדפים שלי, בקרוב</h2>' + favs.slice(0, 6).map(function (x) { return airRow(x.c, x.p, x.c.name + " · " + TVG.dayLabel(dstr(x.p.s))); }).join("");
    return h;
  }
})(window.TVG);
