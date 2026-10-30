/* js/render.js - render() - מפנה למסך הפעיל.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings, search, favs. */
(function (TVG) {
  TVG.files["render"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm;
  TVG.render = render;

  function render() {
    var note = TVG.isSample ? '<div class="note"><b>מוצגים נתוני דוגמה.</b> הדף לא מצא את <code>guide.json</code>. פתח אותו דרך שרת (<code>npx serve</code>) ולא ישירות מהקובץ.</div>' : "";
    var nf = TVG.tab === "nf" && TVG.NF, rems = TVG.tab === "rems";
    var picking = !nf && !rems && TVG.needsPick(), searching = !nf && !!TVG.q.trim(), srchOpen = !$("#qwrap").hidden && !TVG.q.trim();
    var chips = (!picking && !searching && !srchOpen && !nf && !rems && TVG.tab !== "dial") ? TVG.chipsHtml() : "";
    $("#q").placeholder = TVG.favPick ? "איזו תוכנית להוסיף למועדפים?" : TVG.topicAdd ? "קבוצה, שחקן, שף… (למשל: מכבי חיפה)" : "חיפוש תוכנית בכל הלוח";
    var body = srchOpen ? TVG.recentHtml() : nf ? TVG.vNf() : (searching ? TVG.vSearch() : rems ? TVG.vRems() : (picking ? TVG.vPick() : (TVG.tab === "dial" ? TVG.vDial() : (TVG.tab === "now" ? TVG.vNow() : TVG.vGrid()))));
    var isl = "";
    if (!nf && !searching && !picking && !srchOpen) {
      var nowMs = Date.now(), nx = TVG.REMS.filter(function (x) { return x.ts > nowMs && x.ts < TVG.tonightEnd(); })[0];
      if (nx) { var mm = Math.max(1, Math.round((nx.ts - nowMs) / 60000)); isl = '<button type="button" class="island" data-jump="' + esc(nx.k) + '"><span>⏰ ' + esc(nx.title) + "</span><b>" + (mm < 60 ? "בעוד " + mm + " דק׳" : "ב-" + hhmm(new Date(nx.ts))) + "</b></button>"; }
    }
    $("#main").innerHTML = isl + (nf ? "" : note) + chips + body;
    document.body.classList.toggle("tab-dial", TVG.tab === "dial" && !nf && !picking && !searching && !srchOpen);
    $("#tabNf").setAttribute("aria-selected", String(!!nf));
    $("#chCount").textContent = ""; // מספר הערוצים הוא לא התראה - לא מציגים
    TVG.updFav();
    $("#ttl").textContent = (searching || srchOpen) ? "חיפוש" : ({ dial: "היום", now: "עכשיו", grid: "לוח", nf: "נטפליקס", rems: "התזכורות שלי" }[nf ? "nf" : TVG.tab] || "לוח שידורים");
    if (searching) $("#qwrap").hidden = false;
    $("#tabDial").setAttribute("aria-selected", String(TVG.tab === "dial"));
    $("#tabNow").setAttribute("aria-selected", String(TVG.tab === "now"));
    $("#tabGrid").setAttribute("aria-selected", String(TVG.tab === "grid"));
    $("#tabRems").setAttribute("aria-selected", String(rems));
    var rcn = TVG.remCount(); $("#remCount").textContent = rcn ? String(rcn) : "";
    $("#tabNf").hidden = !TVG.NF;
    if (TVG.scrollNext && TVG.tab === "grid" && !TVG.q.trim()) {
      var el = document.querySelector(".row.now"); if (el) el.scrollIntoView({ block: "center" });
    }
    TVG.scrollNext = false;
    if (TVG.D && TVG.tab === "dial" && !nf && !picking && !searching && !srchOpen && $("#dial")) TVG.updateDial(TVG.dialT());
    var dsel = document.querySelector('.days .day[aria-pressed="true"]'); if (dsel && dsel.scrollIntoView) dsel.scrollIntoView({ block: "nearest", inline: "center" });
  }
})(window.TVG);
