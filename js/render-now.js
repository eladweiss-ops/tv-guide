/* js/render-now.js - מסך 'עכשיו' + בוחרים (ספק/סוג).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common. */
(function (TVG) {
  TVG.files["render-now"] = 1;
  var esc = TVG.esc, DAYS = TVG.DAYS, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.pickers = pickers;
  TVG.stepCard = stepCard;
  TVG.vNow = vNow;
  TVG.vPick = vPick;

  function vPick() {
    return '<div class="note"><b>בחר את הערוצים שלך.</b> נמצאו ' + TVG.G.channels.length + ' ערוצים, וכדאי להציג רק את אלה שיש לך.</div><button type="button" class="btn" data-open="1">בחירת ערוצים</button>';
  }

  var NOWSEL = {};
  function nowIdx(a, c, now) {
    var i = a.findIndex(function (p) { return p.s <= now && now < p.e; });
    if (i < 0) return { i: -1, k: -1 };
    var t = NOWSEL[c.id], k = t ? a.findIndex(function (p) { return p.s.getTime() === t; }) : i;
    return { i: i, k: k < i ? i : k };
  }
  function nowCard(c, now) {
    var a = TVG.by.get(c.id) || [], ix = nowIdx(a, c, now), i = ix.i, k = ix.k;
    if (i < 0) return '<article class="card pc k-oth" data-cid="' + esc(c.id) + '"><div class="chn">' + esc(c.name) + '</div><p class="none">אין נתוני שידור לשעה הזו.</p></article>';
    var p = a[k], n = a[k + 1], live = k === i, pct = Math.round((now - p.s) / (p.e - p.s) * 100);
    var label = live ? "" : '<span class="badge">' + (k - i === 1 ? "הבא בתור" : "בעוד " + (k - i) + " תוכניות") + "</span>";
    var meta = '<span dir="ltr">' + hhmm(p.s) + "–" + hhmm(p.e) + "</span><span>" + (live ? "נותרו " + Math.max(1, Math.round((p.e - now) / 60000)) + " דק׳" : "מתחיל בעוד " + TVG.inMin(p.s, now) + (dstr(p.s) !== dstr(now) ? " · " + TVG.dayLabel(dstr(p.s)) : "")) + "</span>";
    var nav = (k > i ? '<button type="button" class="ghost step" data-step="-1|' + esc(c.id) + '">› חזרה</button>' : "") +
      (n ? '<button type="button" class="ghost step" data-step="1|' + esc(c.id) + '"><b>' + hhmm(n.s) + "</b>" + esc(n.title) + " ‹</button>" : "");
    return '<article class="card pc k-' + TVG.kindOf(c.id, p.title) + '" data-toggle data-cid="' + esc(c.id) + '" tabindex="0"><div class="chn">' + esc(c.name) + label + "</div>" +
      '<h2 class="cur">' + esc(p.title) + "</h2>" + '<div class="meta">' + meta + "</div>" +
      (live ? '<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div>' : "") +
      '<div class="acts">' + (live ? "" : TVG.remBtn(p, c.id, false)) + '<button type="button" class="ghost synt" data-opentog>📖 תקציר</button></div>' +
      (nav ? '<div class="nav' + (k > i && n ? " two" : "") + '">' + nav + "</div>" : "") +
      '<div class="more">' + TVG.synText(p, c.id) + TVG.favBtn(p) + TVG.shareBtn(p, c.id) + "</div></article>";
  }
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function stepCard(cid, dir) {
    var c = TVG.G.channels.filter(function (x) { return x.id === cid; })[0], now = new Date(); if (!c) return;
    var el = document.querySelector('[data-cid="' + cid + '"]'); if (!el || el.getAttribute("data-busy")) return;
    var a = TVG.by.get(cid) || [], ix = nowIdx(a, c, now); if (ix.i < 0) return;
    var nk = Math.max(ix.i, Math.min(a.length - 1, ix.k + dir));
    if (nk === ix.k) { TVG.pill(dir > 0 ? "אין תוכניות נוספות" : "זו התוכנית שמשודרת עכשיו", 1100); return; }
    NOWSEL[cid] = a[nk].s.getTime();
    if (navigator.vibrate) { try { navigator.vibrate(6); } catch (x) {} }
    var tmp = document.createElement("div"); tmp.innerHTML = nowCard(c, now); var nw = tmp.firstChild;
    if (RM) { el.replaceWith(nw); return; }
    // הכרטיס הישן גולש החוצה בכיוון האצבע, והחדש נכנס מהצד השני, והגובה משתנה בהדרגה
    var h0 = el.offsetHeight, sgn = dir > 0 ? 1 : -1;
    el.setAttribute("data-busy", "1");
    el.style.transition = "transform .18s ease-in, opacity .18s ease-in"; el.style.transform = "translateX(" + sgn * 64 + "px)"; el.style.opacity = "0";
    setTimeout(function () {
      nw.style.opacity = "0"; nw.style.transform = "translateX(" + (-sgn * 64) + "px)";
      el.replaceWith(nw);
      var h1 = nw.offsetHeight;
      nw.style.height = h0 + "px"; nw.style.overflow = "hidden"; nw.getBoundingClientRect();
      nw.style.transition = "transform .32s cubic-bezier(.2,.8,.2,1), opacity .28s ease-out, height .32s cubic-bezier(.2,.8,.2,1)";
      nw.style.height = h1 + "px"; nw.style.opacity = "1"; nw.style.transform = "none";
      setTimeout(function () { nw.style.cssText = ""; }, 360);
    }, 170);
  }

  function vNow() {
    var now = new Date(), h = "";
    TVG.chans().forEach(function (c) { h += nowCard(c, now); });
    return h;
  }

  function pickers(now) {
    var days = TVG.allDays(), list = TVG.chans();
    if (!TVG.day || days.indexOf(TVG.day) < 0) TVG.day = days.indexOf(dstr(now)) >= 0 ? dstr(now) : days[0];
    if (!TVG.chId || !list.some(function (c) { return c.id === TVG.chId; })) TVG.chId = list[0].id;
    var h = '<label class="sel"><span class="lbl">ערוץ</span><select id="chSel">' + list.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === TVG.chId ? " selected" : "") + ">" + esc(c.name) + "</option>";
    }).join("") + "</select></label>";
    h += '<div class="days" role="group" aria-label="יום">' + days.map(function (d) {
      var dt = TVG.dObj(d);
      return '<button type="button" class="day" data-day="' + d + '" aria-pressed="' + (d === TVG.day) + '"><span>' + (d === dstr(now) ? "היום" : DAYS[dt.getDay()]) + "</span><b>" + dt.getDate() + "." + (dt.getMonth() + 1) + "</b></button>";
    }).join("") + "</div>";
    return h;
  }
})(window.TVG);
