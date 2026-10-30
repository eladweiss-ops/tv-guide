/* js/snooze.js - חלון הנודניק (הקשה על התראה = ./?rem=<key>): שעון ספירה קטן, צ׳יפים 5/10/בהתחלה, "להזכיר שוב", "פתיחה בלוח".
   וגם הצ׳יפ "וגם בתחילת השידור" בחלון התזכורת (שמירה ברשומה: dbl=1; השרת מתזמן התראה שנייה).
   משתמש באותו חלון תחתון של התזכורת (#rem). חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, nav. */
(function (TVG) {
  TVG.files["snooze"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.openSnooze = openSnooze;

  var RING_WIN = 30 * 60000; // החישוק מתמלא ככל שמתקרבים להתחלה (חלון של חצי שעה)
  var R = 19, CIRC = 2 * Math.PI * R;
  var SZ = null; // {k, ts, end, title, ch, pick, timer, busy}

  function bd(s) { return "<bdi>" + esc(s) + "</bdi>"; }
  function dur(min) { // "5 דק׳" / "שעה" / "שעה ו-5 דק׳" / "3 שע׳"
    if (min < 60) return min + " דק׳";
    var h = Math.floor(min / 60), m = min % 60;
    return (h === 1 ? "שעה" : h === 2 ? "שעתיים" : h + " שע׳") + (m ? " ו-" + m + " דק׳" : "");
  }
  function status(ms) {
    if (ms > 0) { var m = Math.ceil(ms / 60000); return ms < 60000 ? "מתחיל בעוד פחות מדקה" : "מתחיל בעוד " + dur(m); }
    var ago = Math.floor(-ms / 60000);
    return ago < 1 ? "התחיל זה עתה" : "התחיל לפני " + dur(ago);
  }
  function clockTxt(ms) {
    if (ms <= 0) return "▶";
    var s = Math.ceil(ms / 1000);
    if (s >= 3600) return Math.floor(s / 3600) + "ש׳";
    return TVG.p2(Math.floor(s / 60)) + ":" + TVG.p2(s % 60);
  }
  function startM(ts) { return Math.ceil((ts - Date.now()) / 60000); }
  function startOk(ts) { var m = startM(ts); return m >= 1 && m <= 60; }

  function chip(v, label) { return '<button type="button" class="chip" data-snzm="' + v + '" aria-pressed="' + (SZ.pick === v) + '">' + label + "</button>"; }

  function msgHtml(title, text, hasProg) {
    return (title ? "<h2>" + title + "</h2>" : "") + '<p class="remnote">' + text + "</p>" +
      '<button type="button" class="btn" data-remclose>סגירה</button>' +
      (hasProg ? '<button type="button" class="ghost" data-snzopen>פתיחה בלוח</button>' : "");
  }
  function show(html) { $("#remBody").innerHTML = html; $("#rem").hidden = false; $("#scrim2").hidden = false; }

  function openSnooze(k) {
    k = String(k || "");
    stopTimer();
    var x = TVG.hasRem(k), pr = TVG.G ? TVG.findProg(k) : null;
    TVG.rem = null; TVG.LP = null;
    SZ = { k: k, pick: 5, timer: 0, busy: false };
    if (!x) { // תזכורת לא קיימת / פגה: הודעה ידידותית
      SZ.prog = pr; SZ.msg = 1;
      show(msgHtml(pr ? esc(pr.p.title) : "", "התזכורת הזו כבר לא פעילה: או שהתוכנית הסתיימה, או שהתזכורת בוטלה.", !!pr));
      return;
    }
    SZ.ts = x.ts; SZ.end = x.end; SZ.title = x.title; SZ.ch = x.ch; SZ.prog = pr;
    if (Date.now() >= x.end) { SZ.msg = 1; show(msgHtml(esc(x.title), "התוכנית הזו כבר הסתיימה, אז אין מה להזכיר שוב.", !!pr)); return; }
    var ms = x.ts - Date.now();
    show('<div id="snzRoot" data-k="' + esc(k) + '">' +
      '<div class="snzhd"><div class="snzring" aria-hidden="true"><svg viewBox="0 0 46 46" width="56" height="56"><circle class="tr" cx="23" cy="23" r="' + R + '"></circle><circle class="pg" id="snzPg" cx="23" cy="23" r="' + R + '" stroke-dasharray="' + CIRC.toFixed(2) + '"></circle></svg><b id="snzClk"></b></div>' +
      '<div class="snzwho"><div class="snzst" id="snzSt" role="timer"></div><div class="meta"><span>' + bd(x.ch) + "</span><span>" + hhmm(new Date(x.ts)) + "</span></div></div></div>" +
      "<h2>" + esc(x.title) + "</h2>" +
      '<div class="lbl">להזכיר שוב</div><div class="chips lp" role="group" aria-label="להזכיר שוב בעוד">' + chip(5, "5 דק׳") + chip(10, "10 דק׳") + '<button type="button" class="chip" data-snzm="start" id="snzStart" aria-pressed="false">בהתחלה</button></div>' +
      '<button type="button" class="btn" data-snzgo>💤 להזכיר שוב</button>' +
      (pr ? '<button type="button" class="ghost" data-snzopen>פתיחה בלוח</button>' : "") + "</div>");
    tick(); SZ.timer = setInterval(tick, 1000);
  }
  function stopTimer() { if (SZ && SZ.timer) clearInterval(SZ.timer); if (SZ) SZ.timer = 0; }
  function tick() {
    var root = $("#snzRoot");
    if (!SZ || !root || root.getAttribute("data-k") !== SZ.k || $("#rem").hidden) { stopTimer(); return; }
    var ms = SZ.ts - Date.now(), pg = $("#snzPg"), st = $("#snzSt"), ck = $("#snzClk"), sb = $("#snzStart");
    st.textContent = status(ms); ck.textContent = clockTxt(ms);
    var frac = ms <= 0 ? 1 : Math.max(0.03, Math.min(1, 1 - ms / RING_WIN));
    pg.setAttribute("stroke-dashoffset", (CIRC * (1 - frac)).toFixed(2));
    root.classList.toggle("started", ms <= 0);
    var ok = startOk(SZ.ts);
    sb.hidden = ms > 0 && startM(SZ.ts) > 60; // רחוק מדי (מעל שעה): אין טעם להציג
    sb.disabled = !ok;
    if (SZ.pick === "start" && !ok) setPick(5);
  }
  function setPick(v) {
    SZ.pick = v;
    var cs = document.querySelectorAll("[data-snzm]");
    for (var i = 0; i < cs.length; i++) cs[i].setAttribute("aria-pressed", String(cs[i].getAttribute("data-snzm") === String(v)));
  }

  function post(body) {
    return fetch(TVG.CAL_API + "/api/snooze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); });
  }
  function go() {
    if (!SZ || SZ.busy) return;
    var m = SZ.pick === "start" ? startM(SZ.ts) : SZ.pick, k = SZ.k;
    if (!(m >= 1 && m <= 60)) { TVG.pill("אי אפשר להזכיר בהתחלה, בחרו זמן אחר", 2000); return; }
    var btn = $("[data-snzgo]"); SZ.busy = true; if (btn) { btn.disabled = true; btn.textContent = "רגע…"; }
    var fail = function () { SZ.busy = false; if (btn) { btn.disabled = false; btn.textContent = "💤 להזכיר שוב"; } TVG.pill("לא הצלחנו לקבוע נודניק, נסו שוב", 2400); };
    if (!TVG.calTok) { fail(); return; }
    post({ k: k, t: TVG.calTok, m: m }).then(function (r) {
      SZ.busy = false;
      if (r.status === 404) { var pr = SZ.prog; stopTimer(); show(msgHtml(esc(SZ.title || ""), "התזכורת הזו כבר לא פעילה: או שהתוכנית הסתיימה, או שהתזכורת בוטלה.", !!pr)); return; }
      if (r.status !== 200 || !r.j || !r.j.ok) { fail(); return; }
      var at = r.j.at || (Date.now() + m * 60000);
      stopTimer(); TVG.closeRem();
      TVG.pill("💤 נזכיר לך ב-" + hhmm(new Date(at)), 5000, "ביטול", function () { undo(k); });
    }).catch(fail);
  }
  // ביטול אמיתי: השרת מוחק את ההודעה המתוזמנת (m:0 גם גורם לשרת ישן לדחות את הבקשה במקום לתזמן נודניק חדש)
  function undo(k) {
    if (!TVG.calTok) return;
    post({ k: k, t: TVG.calTok, m: 0, cancel: 1 }).then(function (r) {
      if (r.status === 200 && r.j && r.j.ok) TVG.pill("הנודניק בוטל", 1600);
      else TVG.pill("לא הצלחנו לבטל, נסו שוב", 2200);
    }).catch(function () { TVG.pill("לא הצלחנו לבטל, נסו שוב", 2200); });
  }

  // "פתיחה בלוח": סוגר את החלון, עובר ללשונית הלוח בערוץ וביום של התוכנית, גולל אליה ומסמן אותה לרגע
  function openInGuide() {
    var pr = SZ && SZ.prog; if (!pr) return;
    stopTimer(); TVG.closeRem();
    if (!TVG.chans().some(function (c) { return c.id === pr.id; })) { TVG.sel.add(pr.id); TVG.saveSel(); TVG.pill("הערוץ נוסף לערוצים שלך", 1600); }
    if (!$("#qwrap").hidden) TVG.setSearch(false);
    TVG.prevTab = TVG.tab; TVG.chId = pr.id; TVG.day = dstr(pr.p.s); TVG.scrub = null; TVG.tab = "grid"; TVG.store("tvg.tab", "grid"); TVG.scrollNext = false;
    TVG.render();
    setTimeout(function () {
      var row = document.querySelector('[data-pts="' + pr.p.s.getTime() + '"]'); if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" }); row.classList.add("hl");
      setTimeout(function () { row.classList.remove("hl"); }, 2800);
    }, 80);
  }

  // ---- "וגם בתחילת השידור" בחלון התזכורת ----
  function toggleDbl() {
    if (TVG.LP) {
      var xs = TVG.REMS.filter(function (x) { return TVG.LP.keys.indexOf(x.k) >= 0 && x.ts > Date.now() && x.lead > 0; });
      if (!xs.length) return;
      var on = !xs.every(function (x) { return x.dbl; });
      xs.forEach(function (x) { if (on) x.dbl = 1; else delete x.dbl; });
      TVG.saveRems(); TVG.syncRems(); TVG.openLead(TVG.LP.keys); TVG.render();
      TVG.pill(on ? "🔔 נזכיר גם בתחילת השידור" : "בלי התראה בתחילת השידור", 1500);
      return;
    }
    if (!TVG.rem) return;
    TVG.rem.dbl = !TVG.rem.dbl; TVG.openRem(TVG.rem);
  }

  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var c = t.closest("[data-snzm]");
    if (c && SZ) { if (c.disabled) return; var v = c.getAttribute("data-snzm"); setPick(v === "start" ? "start" : +v); return; }
    if (t.closest("[data-snzgo]")) { go(); return; }
    if (t.closest("[data-snzopen]")) { openInGuide(); return; }
    if (t.closest("[data-dbl]")) { toggleDbl(); return; }
  });
  // כשהחלון נסגר (רקע/חזרה/Escape) השעון מפסיק לרוץ לבד ב-tick הבא
})(window.TVG);
