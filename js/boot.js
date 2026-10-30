/* js/boot.js - עליית האפליקציה: תוויות גרסה, רענון, טעינת הנתונים ו-render ראשון.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings, search, favs, render, channels, events, update, backup. */
(function (TVG) {
  TVG.files["boot"] = 1;
  // כל הקבצים ברשימה חייבים להיות נטענו; אחרת לא עולים, וההתאוששות ב-index.html תרענן.
  for (var fi = 0; fi < TVG.list.length; fi++) if (!TVG.files[TVG.list[fi]]) { TVG.failed.push(TVG.list[fi]); return; }
  var $ = TVG.$, sel = TVG.sel, VERSION = TVG.VERSION, BUILD = TVG.BUILD;

  $("#bkVer").textContent = "גרסה " + VERSION + " · " + BUILD;
  $("#verTag").textContent = "גרסה " + VERSION;
  if (TVG.store("tvg.lastVer") !== VERSION) { var hadVer = TVG.store("tvg.lastVer"); TVG.store("tvg.lastVer", VERSION); if (hadVer) setTimeout(function () { TVG.pill("✨ עודכנת לגרסה " + VERSION, 2600); }, 1200); }

  // רענון "עכשיו" כל דקה, וגם כשחוזרים לדף
  function refresh() { if (!TVG.G || document.hidden || TVG.q.trim() || !$("#sheet").hidden || !$("#rem").hidden) return; if (TVG.tab === "now") TVG.render(); else if (TVG.tab === "dial" && TVG.scrub == null && !TVG.dragging) TVG.updateDial(TVG.dialT()); }
  setInterval(refresh, 60000);
  document.addEventListener("visibilitychange", refresh);

  if (TVG.store("tvg.v5") !== "1") { TVG.store("tvg.v5", "1"); TVG.store("tvg.theme", "dark"); } // העיצוב החדש נולד כהה; אפשר לחזור לבהיר בהגדרות
  TVG.setTheme(TVG.store("tvg.theme") || "dark");
  TVG.setInst();
  TVG.load().then(function (r) {
    TVG.G = r.g; TVG.isSample = r.s; TVG.classify(); TVG.index();
    try { var saved = JSON.parse(TVG.store("tvg.sel") || "null"); if (Array.isArray(saved)) saved.forEach(function (id) { id = TVG.IDMAP[id] || id; if (TVG.by.has(id)) sel.add(id); }); if (sel.size !== saved.length && !TVG.isSample && TVG.G.channels.length > 50) TVG.saveSel(); } catch (e) {}
    var st0 = TVG.store("tvg.tab"); TVG.tab = (st0 === "grid" || st0 === "now" || st0 === "rems") ? st0 : "dial";
    TVG.scrollNext = TVG.tab === "grid";
    TVG.render();
    if (TVG.afterBoot) TVG.afterBoot(); // nav.js: מקום אחד לפרמטרים בכתובת, קדימות rem > p > q > tab
    if (TVG.needsPick() && $("#rem").hidden &&TVG.store("tvg.tab") !== "nf") TVG.openSheet(true);
    // לשונית נטפליקס מופיעה רק אם הקובץ netflix.json קיים
    fetch("netflix.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        if (!j || !(j.popular || []).length && !(j["new"] || []).length) return;
        TVG.NF = j;
        if (TVG.store("tvg.tab") === "nf") { TVG.tab = "nf"; if (!$("#sheet").hidden) TVG.openSheet(false); }
        TVG.render();
      }).catch(function () {});
  });
  TVG.booted = true;
})(window.TVG);
