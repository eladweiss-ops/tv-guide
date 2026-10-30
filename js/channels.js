/* js/channels.js - בחירת ערוצים (חלון 'הערוצים שלי').
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings, search, favs, render. */
(function (TVG) {
  var $ = TVG.$, esc = TVG.esc, sel = TVG.sel, GROUPS = TVG.GROUPS, GENRES = TVG.GENRES, GNAME = TVG.GNAME;
  TVG.buildSheet = buildSheet;
  TVG.chNum = chNum;
  TVG.openSheet = openSheet;
  TVG.saveSel = saveSel;
  TVG.visible = visible;

  function openSheet(on) { $("#sheet").hidden = !on; $("#scrim").hidden = !on; if (on) { TVG.find = ""; TVG.cf = "all"; $("#chFind").value = ""; buildSheet(); TVG.setInst(); } }
  TVG.PROV = TVG.store("tvg.prov") === "hot" || TVG.store("tvg.prov") === "yes" ? TVG.store("tvg.prov") : "all";
  // ערוצי ברודקאסט וערוצים משותפים מופיעים בכל סינון
  function provOk(c, p) { return p === "all" || c._g === "broad" || c.prov === "both" || !c.prov || c.prov === p; }
  // חיפוש ערוץ: "sport" ו"ספורט" שקולים
  // מספר הערוץ כמו בשלט (11 כאן, 12 קשת, 13 רשת, 14...), לפי המספר שבסוף השם בערוצי החינם
  var CHNUM = { "ONE": 50, "5 LIVE": 56, "ערוץ 14": 14, "כאן חינוכית": 23, "ערוץ 9": 9, "ערוץ 24": 24, "מכאן": 33, "ערוץ 33": 33, "כנסת": 99, "ערוץ הכנסת": 99 };
  function chNum(c) { if (CHNUM[c.name] != null) return CHNUM[c.name]; if (c._g === "broad") { var m = c.name.match(/(\d{1,3})\s*$/); if (m) return +m[1]; } return null; }
  function hay(c) { return (c.name + " " + (chNum(c) != null ? chNum(c) : "")).toLowerCase().replace(/sport/g, "ספורט").replace(/מוזיקה/g, "מוסיקה"); }
  // אותו ערוץ אצל הספק השני: אם כבר נבחר, לא מציגים אותו שוב
  function twinSel(c) { var k = TVG.normKey(c.name); return TVG.G.channels.some(function (o) { return o.id !== c.id && sel.has(o.id) && TVG.normKey(o.name) === k; }); }
  function visible() {
    var f = TVG.find.trim().toLowerCase().replace(/^ערוץ\s*/, "").replace(/מוזיקה/g, "מוסיקה");
    return TVG.G.channels.filter(function (c) {
      if (!provOk(c, TVG.PROV)) return false;
      if (f && /^\d+$/.test(f)) { if (String(chNum(c)) !== f && hay(c).indexOf(f) < 0) return false; }
      else if (f && hay(c).indexOf(f.replace(/sport/g, "ספורט")) < 0) return false;
      if (!sel.has(c.id) && twinSel(c)) return false;
      if (TVG.cf === "sel") return sel.has(c.id);
      if (TVG.cf !== "all") return c._n === TVG.cf;
      return true;
    });
  }
  function buildSheet() {
    $("#chIntro").hidden = sel.size > 0 && !TVG.needsPick();
    var cnt = {}, pl = TVG.G.channels.filter(function (c) { return provOk(c, TVG.PROV); });
    pl.forEach(function (c) { if (c._n) cnt[c._n] = (cnt[c._n] || 0) + 1; });
    $("#pseg").innerHTML = [["all", "הכל"], ["hot", "HOT"], ["yes", "yes"]].map(function (p) {
      return '<button type="button" class="chip" data-prov="' + p[0] + '" aria-pressed="' + (TVG.PROV === p[0]) + '">' + p[1] + " (" + TVG.G.channels.filter(function (c) { return provOk(c, p[0]); }).length + ")</button>";
    }).join("");
    var chips = [["all", "הכל (" + pl.length + ")"], ["sel", "נבחרו (" + sel.size + ")"]].concat(GENRES.filter(function (g) { return cnt[g[0]]; }).map(function (g) { return [g[0], g[1] + " (" + cnt[g[0]] + ")"]; }));
    $("#cchips").innerHTML = chips.map(function (c) { return '<button type="button" class="chip" data-cchip="' + c[0] + '" aria-pressed="' + (TVG.cf === c[0]) + '">' + c[1] + "</button>"; }).join("");
    var vis = visible(), h = "";
    GROUPS.forEach(function (g) {
      var list = vis.filter(function (c) { return c._g === g[0]; });
      if (!list.length) return;
      var all = list.every(function (c) { return sel.has(c.id); });
      h += '<div class="gh"><span>' + g[1] + " (" + list.length + ')</span><button type="button" class="ghost" data-grp="' + g[0] + '">' + (all ? "בטל קבוצה" : "בחר קבוצה") + "</button></div>";
      h += list.map(function (c) {
        var nn = chNum(c);
        return '<label class="opt"><input type="checkbox" data-opt="' + esc(c.id) + '"' + (sel.has(c.id) ? " checked" : "") + "><span>" + (nn != null ? '<b class="chnum">' + nn + "</b>" : "") + esc(c.name) + "</span>" + (function () { var t = [TVG.PROV === "all" && (c.prov === "hot" || c.prov === "yes") ? c.prov.toUpperCase() : "", c._n ? GNAME[c._n] : ""].filter(Boolean).join(" · "); return t ? '<span class="sub">' + t + "</span>" : ""; })() + "</label>";
      }).join("");
    });
    $("#opts").innerHTML = h || '<p class="none" style="padding:12px 0">לא נמצא ערוץ שמתאים.</p>';
  }
  function saveSel() { TVG.store("tvg.sel", JSON.stringify(Array.from(sel))); }
})(window.TVG);
