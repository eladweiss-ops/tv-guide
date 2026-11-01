/* js/render-grid.js - מסך 'לוח'.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now. */
(function (TVG) {
  TVG.files["render-grid"] = 1;
  var esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr, descHtml = TVG.descHtml;
  TVG.vGrid = vGrid;
  TVG.updToNow = updToNow;
  TVG.nextDay = nextDay;

  function vGrid() {
    var now = new Date(), h = TVG.pickers(now);
    var rows = (TVG.by.get(TVG.chId) || []).filter(function (p) { return dstr(p.s) === TVG.day; });
    h += '<div class="list">' + (rows.length ? rows.map(function (p) {
      var cls = p.s <= now && now < p.e ? " now" : (p.e <= now ? " past" : "");
      return '<div class="row' + cls + '" data-toggle data-pts="' + p.s.getTime() + '" tabindex="0"><span class="time">' + hhmm(p.s) + '</span><span class="ttl">' + TVG.ttlHtml(p) +
        (cls === " now" ? '<span class="tag">משודר עכשיו</span>' : "") + '</span><div class="more">' + descHtml(p, TVG.chId) + "</div></div>";
    }).join("") : '<div class="row"><span></span><span class="none">אין נתונים ליום הזה.</span></div>') + "</div>";
    var nd = nextDay();
    if (nd) h += '<button type="button" class="nextday" data-nextday="' + nd + '">' + esc(dayTxt(nd, true)) + '<span aria-hidden="true">←</span></button>';
    return h;
  }

  // היום הבא שיש לו נתונים בלוח (אחרי היום שנבחר), או "" ביום האחרון
  function nextDay() { var days = TVG.allDays(), i = days.indexOf(TVG.day); return i >= 0 && i < days.length - 1 ? days[i + 1] : ""; }
  // "מחר, יום שני 2.11" / "יום שלישי 3.11"
  function dayTxt(ds, withTomorrow) {
    var d = TVG.dObj(ds), t = new Date(); t.setDate(t.getDate() + 1);
    return (withTomorrow && ds === dstr(t) ? "מחר, " : "") + "יום " + TVG.DAYS[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1);
  }
  TVG.dayTxt = dayTxt;

  // כפתור צף "עכשיו": מופיע בלוח רק כשהתוכנית שמשודרת עכשיו מחוץ למסך, החץ מצביע לכיוון שלה
  var btn = null, raf = 0;
  function updToNow() {
    if (!btn) {
      btn = document.createElement("button"); btn.type = "button"; btn.id = "toNow"; btn.className = "tonow glass"; btn.setAttribute("data-tonow", "");
      document.body.appendChild(btn);
    }
    var el = TVG.tab === "grid" && !TVG.q.trim() && document.querySelector("#main .row.now"), dir = "";
    if (el) {
      var r = el.getBoundingClientRect(), hd = document.querySelector("header.top"), dk = document.querySelector(".dock");
      var top = hd ? hd.getBoundingClientRect().bottom : 0, bot = dk ? dk.getBoundingClientRect().top : window.innerHeight;
      if (r.bottom < top + 8) dir = "↑"; else if (r.top > bot - 8) dir = "↓";
    }
    if (dir) btn.innerHTML = '<span aria-hidden="true">' + dir + "</span>עכשיו";
    btn.classList.toggle("show", !!dir); btn.setAttribute("aria-hidden", String(!dir)); btn.tabIndex = dir ? 0 : -1;
  }
  window.addEventListener("scroll", function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; updToNow(); }); }, { passive: true });
  window.addEventListener("resize", function () { updToNow(); });
})(window.TVG);
