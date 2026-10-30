/* js/nav.js - ניווט שכבות (כפתור "חזור" באנדרואיד / מחוות חזרה / Escape סוגרים את החלון העליון, בלי לצאת מהאפליקציה)
   ופרמטרים בכתובת (?rem= ?tab= ?q=), גם בעליית האפליקציה וגם מהודעת ה-Service Worker.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core ... channels (לפני events).
   איך זה עובד: כל שכבה היא אלמנט שמוסתר/מוצג עם hidden. MutationObserver מזהה פתיחה -> history.pushState,
   סגירה מהממשק -> history.go(-n) (ההיסטוריה נשארת נקייה), ו-popstate -> סוגר את השכבה העליונה.
   שכבה חדשה (חלון חדש): TVG.navLayer("#myId", function () { …סגירה… }). */
(function (TVG) {
  TVG.files["nav"] = 1;
  var $ = TVG.$;
  TVG.navLayer = navLayer;
  TVG.handleUrl = handleUrl;
  TVG.afterBoot = afterBoot;

  var URL_PARAMS = ["tab", "rem", "p", "q"];
  var TABS = { now: 1, grid: 1, rems: 1, dial: 1, nf: 1 };
  var layers = [];   // {n, sel, close, open}
  var depth = 0;     // כמה רשומות היסטוריה דחפנו
  var skip = 0;      // popstate שנגרמו על ידינו (go) ולא ממשתמש
  var queued = false;

  function navLayer(sel, close) {
    var el = $(sel); if (!el) return;
    var L = { n: sel, sel: sel, close: close, open: false };
    layers.push(L);
    try { new MutationObserver(schedule).observe(el, { attributes: true, attributeFilter: ["hidden"] }); } catch (e) {}
    L.open = !el.hidden;
  }
  function isOpen(L) { var el = $(L.sel); return !!el && !el.hidden; }
  function schedule() { if (queued) return; queued = true; Promise.resolve().then(function () { queued = false; sync(); }); }

  var order = []; // שכבות פתוחות לפי סדר הפתיחה (האחרונה = העליונה)
  function sync() {
    layers.forEach(function (L) {
      var o = isOpen(L), i = order.indexOf(L);
      if (o && i < 0) order.push(L); else if (!o && i >= 0) order.splice(i, 1);
    });
    try {
      while (depth < order.length) { depth++; history.pushState({ tvgLayer: order[depth - 1].n, d: depth }, "", location.href); }
      if (depth > order.length) { var n = depth - order.length; depth = order.length; skip++; history.go(-n); }
    } catch (e) {}
  }
  function closeTop() {
    var L = order[order.length - 1]; if (!L) return false;
    try { L.close(); } catch (e) {}
    if (isOpen(L)) { var el = $(L.sel); if (el) el.hidden = true; } // רשת ביטחון
    return true;
  }
  window.addEventListener("popstate", function (e) {
    var d = e.state && e.state.tvgLayer ? (e.state.d || 0) : 0;
    if (skip > 0) { skip--; depth = d; return; }
    if (d < depth) { // המשתמש חזר אחורה: סוגרים שכבה אחת (או יותר אם קפץ כמה)
      var guard = 6;
      while (depth > d && order.length && guard--) { depth--; closeTop(); sync0(); }
      depth = Math.min(depth, order.length);
    } else if (d > depth) depth = d; // "קדימה" לרשומה ישנה: sync ינקה אותה
    schedule();
  });
  function sync0() { // עדכון הרשימה אחרי סגירה סינכרונית, בלי לגעת בהיסטוריה
    layers.forEach(function (L) { var i = order.indexOf(L); if (!isOpen(L) && i >= 0) order.splice(i, 1); });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    if (closeTop()) e.preventDefault();
  });

  // רשומה שנשארה מרענון כשחלון היה פתוח: מאפסים אותה (לא מאבדים state אחר)
  try { if (history.state && history.state.tvgLayer) history.replaceState(null, "", location.href); } catch (e) {}

  navLayer("#sheet", function () { TVG.openSheet(false); TVG.render(); });
  navLayer("#setsheet", function () { TVG.closeFavs(); });
  navLayer("#favs", function () { TVG.closeFavs(); });
  navLayer("#rem", function () { TVG.closeRem(); });
  navLayer("#nfsheet", function () { if (TVG.closeNf) TVG.closeNf(); }); // דף תוכן נטפליקס (netflix.js)
  navLayer("#qwrap", function () { TVG.setSearch(false); });

  // ---- פרמטרים בכתובת ----
  // לשונית: נקבעת לפני שהאפליקציה עולה, כדי שתיפתח ישר בלשונית הנכונה
  var P0 = new URLSearchParams(location.search), bootTab = P0.get("tab");
  if (bootTab && TABS[bootTab]) TVG.store("tvg.tab", bootTab);

  function cleanUrl(drop) {
    try {
      var u = new URL(location.href), had = false;
      drop.forEach(function (k) { if (u.searchParams.has(k)) { u.searchParams.delete(k); had = true; } });
      if (had) history.replaceState(history.state, "", u.pathname + (u.search || "") + u.hash);
    } catch (e) {}
  }
  function switchTab(nt) {
    if (!TABS[nt] || nt === TVG.tab) return;
    if (nt === "nf" && !TVG.NF) return;
    if (!$("#qwrap").hidden) TVG.setSearch(false);
    TVG.prevTab = TVG.tab; TVG.SCR[TVG.tab] = window.scrollY; TVG.tab = nt; TVG.store("tvg.tab", nt);
    TVG.scrollNext = nt === "grid" && TVG.SCR.grid == null; TVG.render(); window.scrollTo(0, TVG.SCR[nt] || 0);
  }
  function openQuery(q) {
    if (!$("#qwrap").hidden && !q) { $("#q").focus(); return; }
    $("#qwrap").hidden = false; $("#q").value = q; TVG.q = q; TVG.qExact = null; $("#qx").hidden = !q;
    TVG.render(); window.scrollTo({ top: 0 }); try { $("#q").focus(); } catch (e) {}
  }
  // מטפל בכתובת (עלייה או הודעה מ-SW). u = מחרוזת כתובת או null לכתובת הנוכחית
  function handleUrl(u, isBoot) {
    var p;
    try { p = new URL(u || location.href, location.href).searchParams; } catch (e) { return; }
    if (!TVG.G) { TVG.pendingUrl = u || location.href; return; }
    // קדימות (מקום אחד): rem > p > q > tab. rem: נודניק; p: תוכנית ששיתפו (share.js); q: חיפוש; tab: לשונית (בעלייה נקבעת כבר למעלה)
    var tab = p.get("tab"), rem = p.get("rem"), pp = p.get("p"), hasQ = p.has("q"), q = p.get("q") || "";
    if (tab && !isBoot && !rem && pp == null) switchTab(tab);
    if (rem) { if (TVG.openSnooze) TVG.openSnooze(rem); }
    else if (pp != null) { if (TVG.openShared) TVG.openShared(pp); }
    else if (hasQ) openQuery(q);
    if (isBoot) cleanUrl(URL_PARAMS);
  }
  function afterBoot() {
    var pend = TVG.pendingUrl; TVG.pendingUrl = null;
    handleUrl(pend || null, !pend);
    if (pend) cleanUrl(URL_PARAMS);
  }
  try {
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", function (e) {
      var d = e.data; if (d && d.type === "open" && typeof d.url === "string") { handleUrl(d.url, false); cleanUrl(URL_PARAMS); }
    });
  } catch (e) {}
})(window.TVG);
