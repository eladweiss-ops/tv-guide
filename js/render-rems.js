/* js/render-rems.js - מסך 'תזכורות'.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push. */
(function (TVG) {
  TVG.files["render-rems"] = 1;
  var esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.vRems = vRems;

  TVG.askK = null;
  TVG.askT = null;
  TVG.prevTab = null;
  function vRems() {
    var now = Date.now(), up = TVG.REMS.filter(function (x) { return x.end > now; });
    var pbtn = '<button type="button" class="btn pbtn" data-personal>➕ תזכורת אישית</button>';
    if (!up.length) return TVG.pushCard() + TVG.calCard() + pbtn + '<h2 class="sech">התזכורות שלי</h2><p class="none">אין תזכורות פעילות. לחיצה על ⏰ ליד תוכנית מוסיפה תזכורת ליומן, והיא תופיע כאן.</p>';
    var h = TVG.pushCard() + TVG.calCard() + pbtn + (TVG.srv() ? "" : '<p class="remnote">ביטול מוריד את התזכורת מכאן ופותח ביומן קובץ ביטול; אם האירוע נשאר ביומן, מוחקים אותו שם.</p>'), last = "";
    up.forEach(function (x) {
      var d = new Date(x.ts), dl = TVG.dayLabel(dstr(d));
      if (dl !== last) { h += '<h2 class="sech">' + dl + "</h2>"; last = dl; }
      var live = x.ts <= now;
      var fp = TVG.findProg(x.k), ds = (fp && fp.p.desc) || x.desc || "";
      var nfl = /^nf\|/.test(x.k) ? (ds.match(/https:\/\/www\.netflix\.com\/[^\s"<>]+/) || [])[0] : ""; // תזכורת צפייה בנטפליקס: קישור במקום כתובת גולמית
      var syn = nfl ? '<div class="rsyn"><a class="nfrl" href="' + esc(nfl) + '" target="_blank" rel="noopener">▶ פתיחה בנטפליקס</a></div>' : ds ?'<div class="rsyn"><p class="rclamp">' + esc(ds) + "</p>" + (ds.length > 90 ? '<button type="button" class="moreb" data-more data-l="הרחב">הרחב…</button>' : "") + "</div>" : "";
      h += '<div class="srow"><button type="button" class="go" data-jump="' + esc(x.k) + '"><span class="time">' + hhmm(d) + '</span><span class="ttl">' + esc(x.title) + '<br><span class="sub"><bdi>' + esc(x.ch) + "</bdi> · <bdi>" + (live ? (x.id ? "משודר עכשיו" : "עכשיו") : "🔔 " + esc(!x.id && !x.lead ? "בזמן" : TVG.leadTxt(x.lead, x.ts))) + "</bdi></span></span></button>" + syn +
        (live ? "</div>" : TVG.askK === x.k
          ? '</div><div class="confirm"><span>לבטל את התזכורת?</span><button type="button" class="btn sm danger" data-remcancel="' + esc(x.k) + '">כן, לבטל</button><button type="button" class="ghost sm" data-remkeep>להשאיר</button></div>'
          : '<span class="rbts">' + (TVG.srv() ? '<button type="button" class="rbt" data-ledit="' + esc(x.k) + '" aria-label="שינוי מועד ההתראה: ' + esc(x.title) + '">🔔</button>' : "") + '<button type="button" class="rbt" data-remask="' + esc(x.k) + '" aria-label="ביטול התזכורת: ' + esc(x.title) + '">✕</button></span></div>');
    });
    return h;
  }
})(window.TVG);
