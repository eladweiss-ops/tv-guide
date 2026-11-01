/* js/render-grid.js - מסך 'לוח'.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now. */
(function (TVG) {
  TVG.files["render-grid"] = 1;
  var esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr, descHtml = TVG.descHtml;
  TVG.vGrid = vGrid;
  TVG.updToNow = updToNow;
  TVG.nextDay = nextDay;
  TVG.nowDay = nowDay;

  function vGrid() {
    var now = new Date(), td = dstr(now); TVG.pickers(now); // קובע ערוץ ויום ברירת מחדל
    if (TVG.enterGrid && TVG.day === td) TVG.day = nowDay(); // כניסה ללוח אחרי חצות: מה שמשודר עכשיו התחיל אתמול - נכנסים ליום שלו (לא במעבר יום ביד)
    TVG.enterGrid = false;
    var h = TVG.pickers(now), isPast = TVG.day < td;
    var rows = (TVG.by.get(TVG.chId) || []).filter(function (p) { return dstr(p.s) === TVG.day; });
    var st = isPast && TVG.PAST.indexOf(TVG.day) >= 0 ? TVG.pastState[TVG.day] : "ok"; // אתמול שעוד לא בארכיון - כבר בלוח
    if (isPast && !st) { TVG.loadPast(TVG.day); st = "loading"; }
    if (isPast && TVG.day !== nowDay()) h += '<p class="pastlbl"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>שודר ב' + esc(dayTxt(TVG.day)) + "</p>";
    if (isPast && st === "loading" && !rows.length) return h + '<div class="list"><div class="row"><span></span><span class="none">טוען…</span></div></div>';
    h += '<div class="list">' + (rows.length ? rows.map(function (p) {
      var cls = p.s <= now && now < p.e ? " now" : (p.e <= now && !isPast ? " past" : "");
      return '<div class="row' + cls + '" data-toggle data-pts="' + p.s.getTime() + '" tabindex="0"><span class="time">' + hhmm(p.s) + '</span><span class="ttl">' + TVG.ttlHtml(p) +
        (cls === " now" ? '<span class="tag">משודר עכשיו</span>' : "") + '</span><div class="more">' + descHtml(p, TVG.chId) + "</div></div>";
    }).join("") : '<div class="row"><span></span><span class="none">אין נתונים ליום הזה.</span></div>') + "</div>";
    var nd = nextDay();
    if (nd) h += '<button type="button" class="nextday" data-nextday="' + nd + '">' + esc(dayTxt(nd, true)) + '<span aria-hidden="true">←</span></button>';
    return h;
  }

  // היום שבו התחילה התוכנית שמשודרת עכשיו בערוץ הנבחר (אחרי חצות זה אתמול); אם אין - היום
  function nowDay() {
    var a = TVG.by.get(TVG.chId) || [], n = Date.now();
    for (var i = 0; i < a.length; i++) if (a[i].s <= n && n < a[i].e) return dstr(a[i].s);
    return dstr(new Date());
  }
  // היום הבא שיש לו נתונים בלוח (אחרי היום שנבחר), או "" ביום האחרון
  function nextDay() { var days = TVG.allDays(), i = days.indexOf(TVG.day); return i >= 0 && i < days.length - 1 ? days[i + 1] : ""; }
  // "מחר, יום שני 2.11" / "יום שלישי 3.11"
  function dayTxt(ds, withTomorrow) {
    var d = TVG.dObj(ds), t = new Date(); t.setDate(t.getDate() + 1);
    return (withTomorrow && ds === dstr(t) ? "מחר, " : withTomorrow && ds === dstr(new Date()) ? "היום, " : "") + "יום " + TVG.DAYS[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1);
  }
  TVG.dayTxt = dayTxt;

  // כפתור צף "עכשיו": מופיע בלוח רק כשהתוכנית שמשודרת עכשיו מחוץ למסך, החץ מצביע לכיוון שלה
  var btn = null, raf = 0;
  function updToNow() {
    if (!btn) {
      btn = document.createElement("button"); btn.type = "button"; btn.id = "toNow"; btn.className = "tonow glass"; btn.setAttribute("data-tonow", "");
      document.body.appendChild(btn);
    }
    var grid = TVG.tab === "grid" && !TVG.q.trim() && !!document.querySelector("#main .list"), td = dstr(new Date());
    var el = grid && document.querySelector("#main .row.now"), dir = "", lbl = "עכשיו";
    var nd = grid ? nowDay() : td;
    if (grid && TVG.day && TVG.day !== nd) { dir = TVG.day < nd ? "←" : "→"; lbl = nd === td ? "חזרה להיום" : "עכשיו"; } // יום אחר: חזרה ליום של מה שמשודר עכשיו (בעברית "קדימה" בזמן הוא שמאלה)
    else if (el) {
      var r = el.getBoundingClientRect(), hd = document.querySelector("header.top"), dk = document.querySelector(".dock");
      var top = hd ? hd.getBoundingClientRect().bottom : 0, bot = dk ? dk.getBoundingClientRect().top : window.innerHeight;
      if (r.bottom < top + 8) dir = "↑"; else if (r.top > bot - 8) dir = "↓";
    }
    if (dir) btn.innerHTML = lbl === "עכשיו" ? '<span aria-hidden="true">' + dir + "</span>עכשיו" : lbl + '<span aria-hidden="true">' + dir + "</span>";
    btn.classList.toggle("show", !!dir); btn.setAttribute("aria-hidden", String(!dir)); btn.tabIndex = dir ? 0 : -1;
  }
  window.addEventListener("scroll", function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; updToNow(); }); }, { passive: true });
  window.addEventListener("resize", function () { updToNow(); });
})(window.TVG);
