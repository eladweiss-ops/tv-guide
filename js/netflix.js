/* js/netflix.js - לשונית 'סטרימינג' (נטפליקס ודיסני+, סכמה v2 לשניהם): כרטיס ראשי, שורות פוסטרים, דף תוכן בחלון תחתון.
   המתג בראש הלשונית (tvg.svc) בוחר שירות; disney.json נטען בעצלתיים בהחלפה הראשונה (TVG.DS). מזהה הלשונית נשאר nf (קישורים ישנים).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid. */
(function (TVG) {
  TVG.files["netflix"] = 1;
  var $ = TVG.$, esc = TVG.esc;
  TVG.vNf = vNf;
  TVG.nfPrep = nfPrep;
  TVG.openNf = openNf;
  TVG.closeNf = closeNf;
  TVG.nfNorm = normT;   // נרמול כותרות (גם להתאמה ללוח בחיפוש נטפליקס, nfsearch.js)
  TVG.nfGet = getItem;
  TVG.nfIsNf = isNf;
  TVG.nfReopen = reopen;
  TVG.nfSvc = svcOf;         // "disney" | "netflix": באיזה שירות הפריט נפתח (svc בפריט מ-disney.json, או ds בלבד בחיפוש)
  TVG.nfIsDs = isDs;         // זמין בדיסני+
  TVG.nfLinkOf = linkOf;     // קישור "▶ פתח ב…" לפי השירות
  TVG.nfSvcName = svcName;

  TVG.nfAfterRender = afterRender;
  TVG.nfFavs = function () { return FAVS.slice(); };
  TVG.nfIsFav = isFav;
  TVG.openNfList = openNfList;
  TVG.closeNfList = closeNfList;

  // סדר השורות במסך (שורה שלא בנתונים נדלגת; שורה לא מוכרת עם כותרת ב-rowMeta באה בסוף). 'recent' ליד 'week' כי הן קרובות
  var ORDER = ["popular", "israeli", "week", "recent", "series", "movies", "top", "comedy", "crime", "docu", "family"];
  var ORDER_DS = ["popular", "week", "series", "movies", "kids", "marvel", "starwars", "pixar", "top"];
  var TITLES = { popular: "הכי נצפים", recent: "יצא לאחרונה", top: "הכי מדורגים" }; // ברירת מחדל כשאין rowMeta (נתונים ישנים)
  var FAV_TITLE = "⭐ השמורים שלי", FAV_MAX = 200, FAV_ROW = 16, LAZY_FIRST = 3;
  var RE_NAME = /^[a-z][a-z0-9]{0,15}$/;
  function cleanTitle(s) { return typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 40) : ""; }

  // ---- נתונים: בדיקת סכמה v2 ונרמול. מחזיר null כשאין מה להציג (הלשונית נשארת מוסתרת) ----
  var RE_LINK = /^https:\/\/www\.netflix\.com\//, RE_DLINK = /^https:\/\/www\.disneyplus\.com\//, RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\//, RE_TR = /^[A-Za-z0-9_-]{11}$/;
  // שדה לא תקין מושמט (לא הפריט כולו)
  function clean(x, re, svc) {
    var o = {}, k;
    for (k in x) if (Object.prototype.hasOwnProperty.call(x, k)) o[k] = x[k];
    if (svc === "disney") o.svc = "disney"; else delete o.svc;
    if (!re.test(o.link || "")) delete o.link;
    if (!RE_IMG.test(o.poster || "")) delete o.poster;
    if (!RE_IMG.test(o.backdrop || "")) delete o.backdrop;
    if (!RE_TR.test(o.trailer || "")) delete o.trailer;
    return o;
  }
  // svc: "netflix" (ברירת מחדל) | "disney": איזה קובץ זה. פריטי דיסני+ מסומנים svc:"disney" (הקישור חייב להיות של דיסני+)
  function nfPrep(j0, svc) {
    svc = svc === "disney" ? "disney" : "netflix";
    var j = j0, order = svc === "disney" ? ORDER_DS : ORDER;
    if (j0 && typeof j0 === "object" && j0.items && typeof j0.items === "object") {
      j = { v: j0.v, updated: j0.updated, hero: j0.hero, rows: j0.rows, items: {} };
      Object.keys(j0.items).forEach(function (k) { if (j0.items[k] && typeof j0.items[k] === "object") j.items[k] = clean(j0.items[k], svc === "disney" ? RE_DLINK : RE_LINK, svc); });
    }
    if (!j || typeof j !== "object" || !(j.v >= 2) || !j.items || typeof j.items !== "object") return null;
    var rows = {}, titles = {}, names = [], seen = {}, flat = [], meta = j0 && j0.rowMeta && typeof j0.rowMeta === "object" ? j0.rowMeta : {};
    var src0 = j.rows && typeof j.rows === "object" ? j.rows : {};
    order.concat(Object.keys(src0).filter(function (n) { return order.indexOf(n) < 0; }).slice(0, 12)).forEach(function (n) {
      if (!RE_NAME.test(n)) return;
      var src = src0[n], out = [], title = cleanTitle(meta[n] && meta[n].title) || (svc === "disney" ? "" : TITLES[n]) || "";
      if (!title) return;
      (Array.isArray(src) ? src : []).forEach(function (k) { if (j.items[k] && j.items[k].title && out.indexOf(k) < 0) out.push(k); });
      if (!out.length) return;
      rows[n] = out; titles[n] = title; names.push(n); flat = flat.concat(out);
    });
    if (!names.length) return null;
    var hero = j.hero && j.items[j.hero] && j.items[j.hero].title ? j.hero : null;
    if (!hero) flat.some(function (k) { if (j.items[k].backdrop) { hero = k; return true; } return false; });
    if (!hero) hero = flat[0];
    var all = [];
    flat.concat(Object.keys(j.items)).forEach(function (k) { if (!seen[k] && j.items[k] && j.items[k].title) { seen[k] = 1; all.push(k); } });
    return { v: j.v, updated: j.updated, hero: hero, rows: rows, titles: titles, names: names, items: j.items, all: all, svc: svc };
  }

  // ---- ⭐ שמורים (tvg.nffav): תמונת מצב של הפריט, כדי שיעבוד גם לתוצאות חיפוש. נפרד מ-tvg.fav (מועדפי שידור) ----
  var RE_KEY = /^[A-Za-z0-9_]{1,24}$/;
  var FAVS = loadFavs();
  function loadFavs() {
    var a = [], seenK = {};
    try { a = JSON.parse(TVG.store("tvg.nffav") || "[]"); } catch (e) { a = []; }
    if (!Array.isArray(a)) a = [];
    return a.filter(function (f) {
      if (!f || typeof f !== "object" || !RE_KEY.test(f.k || "") || typeof f.title !== "string" || !f.title || seenK[f.k]) return false;
      seenK[f.k] = 1; return true;
    }).map(function (f) {
      var o = { k: f.k, title: f.title.slice(0, 120), type: f.type === "tv" ? "tv" : "movie", poster: RE_IMG.test(f.poster || "") ? f.poster : "", y: +f.y > 0 ? +f.y : 0, at: +f.at || 0 };
      if (f.svc === "disney") o.svc = "disney"; // בלי svc = נטפליקס (שמורים ישנים)
      return o;
    }).sort(function (a2, b2) { return b2.at - a2.at; }).slice(0, FAV_MAX);
  }
  function saveFavs() { TVG.store("tvg.nffav", JSON.stringify(FAVS)); }
  function favIdx(k) { for (var i = 0; i < FAVS.length; i++) if (FAVS[i].k === k) return i; return -1; }
  function isFav(k) { return favIdx(k) >= 0; }
  function favAdd(k, x, at) {
    if (!RE_KEY.test(k) || !x || !x.title || favIdx(k) >= 0) return;
    var f = { k: k, title: String(x.title).slice(0, 120), type: x.type === "tv" ? "tv" : "movie", poster: RE_IMG.test(x.poster || "") ? x.poster : "", y: +x.year > 0 ? +x.year : 0, at: at || Date.now() };
    if (svcOf(x) === "disney") f.svc = "disney";
    FAVS.unshift(f);
    FAVS.sort(function (a, b) { return b.at - a.at; }); if (FAVS.length > FAV_MAX) FAVS.length = FAV_MAX;
    saveFavs();
  }
  function favDel(k) { var i = favIdx(k); if (i < 0) return null; var f = FAVS.splice(i, 1)[0]; saveFavs(); return f; }
  function favRestore(f) { if (!f || favIdx(f.k) >= 0) return; FAVS.push(f); FAVS.sort(function (a, b) { return b.at - a.at; }); if (FAVS.length > FAV_MAX) FAVS.length = FAV_MAX; saveFavs(); }
  // פריט (כמו ב-NF.items) מתמונת המצב: לפתיחת הדף. nfEnsure (nfsearch.js) משלים תקציר וזמינות מהחיפוש
  function favItem(k) {
    var i = favIdx(k); if (i < 0) return null; var f = FAVS[i], d = f.svc === "disney";
    return { k: f.k, type: f.type, title: f.title, orig: "", year: f.y, poster: f.poster, genres: [], link: (d ? "https://www.disneyplus.com/he-il/search?q=" : "https://www.netflix.com/search?q=") + encodeURIComponent(f.title), others: [], svc: d ? "disney" : undefined, _wl: true };
  }

  // ---- שירות פעיל ----
  TVG.svc = TVG.store("tvg.svc") === "disney" ? "disney" : "netflix"; // נשמר במכשיר
  TVG.DS = null; TVG.dsState = "idle"; // idle | loading | err | ok
  function curSvc() { return TVG.svc === "disney" ? "disney" : "netflix"; }
  function curData() { return curSvc() === "disney" ? TVG.DS : TVG.NF; }
  function isDs(x) { return !!x && (x.svc === "disney" || x.ds === true); }
  // באיזה שירות "▶ פתח ב…": פריט מ-disney.json, או תוצאת חיפוש שאינה בנטפליקס ובכל זאת בדיסני+
  function svcOf(x) { return x && (x.svc === "disney" || (x.nf === false && x.ds === true && RE_DLINK.test(x.dlink || ""))) ? "disney" : "netflix"; }
  function linkOf(x) { return !x ? "" : svcOf(x) === "disney" ? (x.svc === "disney" ? x.link : x.dlink) || "" : x.link || ""; }
  function svcName(x) { return svcOf(x) === "disney" ? "דיסני+" : "נטפליקס"; }
  function svcSwitchHtml() {
    var c = curSvc();
    return '<div class="seg nfsvc" role="group" aria-label="שירות סטרימינג">' +
      '<button type="button" data-nfsvc="netflix" aria-pressed="' + (c === "netflix") + '">נטפליקס</button>' +
      '<button type="button" data-nfsvc="disney" aria-pressed="' + (c === "disney") + '"><bdi>דיסני+</bdi></button></div>';
  }
  // disney.json: נטען רק כשצריך. שגיאה/ריק = מצב err עם "נסו שוב"
  function loadDs() {
    if (TVG.dsState !== "idle") return;
    TVG.dsState = "loading";
    fetch("disney.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { var d = nfPrep(j, "disney"); if (!d) throw 0; TVG.DS = d; TVG.dsState = "ok"; })
      .catch(function () { TVG.dsState = "err"; })
      .then(function () { if (TVG.tab === "nf" && curSvc() === "disney") TVG.render(); if (TVG.nfOpen) reopen(); });
  }
  function dsWaitHtml() {
    if (TVG.dsState === "err") return '<div class="nfempty"><b>לא הצלחנו לטעון את דיסני+</b><span>בדקו את החיבור ונסו שוב.</span><button type="button" class="ghost" data-nfdsretry>נסו שוב</button></div>';
    var sec = ""; for (var i = 0; i < 3; i++) sec += '<section class="nfsec" aria-hidden="true"><h2 class="sech nfskh"></h2><div class="nfrow">' + skelRow() + "</div></section>";
    return '<div role="status" aria-label="טוענים את דיסני+"><div class="nfhero nfsk0" aria-hidden="true"></div>' + sec + "</div>";
  }

  // ---- עזרים ----
  function imdbOf(x) { var r = x.ratings; return r && typeof r.imdb === "number" && r.imdb > 0 ? r.imdb : null; }
  function fmtRate(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function imgUrl(u) { return /^https:\/\//.test(u || "") ? u : ""; }
  function runtimeTxt(m) {
    if (!(m > 0)) return "";
    return m < 60 ? m + " דק׳" : Math.floor(m / 60) + " שע׳" + (m % 60 ? " " + (m % 60) + " דק׳" : "");
  }
  function lenTxt(x) {
    if (x.type === "tv") return x.seasons > 0 ? (x.seasons === 1 ? "עונה אחת" : x.seasons + " עונות") : "";
    return runtimeTxt(x.runtime);
  }
  // שם מקורי מוצג רק בכתב לטיני (גם עם סימנים כמו é) ורק אם שונה מהכותרת אחרי נרמול
  function normT(t) { t = String(t || "").toLowerCase(); try { t = t.normalize("NFD"); } catch (e) {} return t.replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\u0590-\u05ff]+/g, ""); }
  function showOrig(x) { var o = x.orig || ""; return /[A-Za-z]/.test(o) && /^[\u0020-\u024F\u2010-\u206F]+$/.test(o) && normT(o) !== normT(x.title); }
  function kindTxt(x) { return x.type === "tv" ? "סדרה" : "סרט"; }
  function bdis(a) { return a.filter(Boolean).map(function (s) { return "<bdi>" + esc(s) + "</bdi>"; }).join(" · "); }
  function imdbChip(x, cls) { var v = imdbOf(x); return v ? '<span class="nfimdb ' + (cls || "") + '" title="דירוג IMDb"><bdi dir="ltr">⭐ ' + fmtRate(v) + "</bdi></span>" : ""; }
  function tmdbCredit() {
    return '<p class="credit nfcredit"><span>נתונים ותמונות:</span> <a class="tmdbmark" href="https://www.themoviedb.org" target="_blank" rel="noopener" aria-label="TMDB">TMDB</a></p>';
  }

  // ---- כרטיסים ----
  function poster(x, k) {
    var u = imgUrl(x.poster);
    return '<span class="nfp' + (u ? "" : " er") + '">' + (u ? '<img loading="lazy" decoding="async" draggable="false" alt="פוסטר: ' + esc(x.title) + '" src="' + esc(u) + '">' : "") +
      '<span class="nfph" aria-hidden="true">🎬</span>' + imdbChip(x, "onp") + (k && isFav(k) ? '<span class="nfsv" title="שמור">★</span>' : "") + "</span>";
  }
  function card(k, x) {
    return '<button type="button" class="nfc" data-nfopen="' + esc(k) + '">' + poster(x, k) + '<span class="nft"><bdi>' + esc(x.title) + "</bdi></span></button>";
  }
  // כרטיס של שמור (תמונת מצב): בלחיצה ארוכה מסירים
  function favCard(f) {
    var x = { title: f.title, poster: f.poster };
    return '<button type="button" class="nfc" data-nfopen="' + esc(f.k) + '" data-nffc="' + esc(f.k) + '"' + (f.svc === "disney" ? ' data-nfpref="disney"' : "") + ">" + poster(x) + '<span class="nft"><bdi>' + esc(f.title) + "</bdi></span></button>";
  }
  function moreChip(name) { return '<button type="button" class="nfmore" data-nfmore="' + esc(name) + '" aria-label="עוד"><i aria-hidden="true">›</i><span>עוד</span></button>'; }
  function skelRow() { var s = ""; for (var i = 0; i < 4; i++) s += '<span class="nfc nfsk" aria-hidden="true"><span class="nfp"></span><span class="nft"></span></span>'; return s; }
  function rowCards(name, NF) { return NF.rows[name].map(function (k) { return card(k, NF.items[k]); }).join("") + moreChip(name); }
  function favRowHtml() {
    if (!FAVS.length) return "";
    return '<section class="nfsec" data-nfrow="fav"><h2 class="sech">' + FAV_TITLE + '<span class="nfsub">לחיצה ארוכה להסרה</span></h2><div class="nfrow">' +
      FAVS.slice(0, FAV_ROW).map(favCard).join("") + (FAVS.length > FAV_ROW ? moreChip("fav") : "") + "</div></section>";
  }
  function heroHtml(k, x) {
    var u = imgUrl(x.backdrop) || imgUrl(x.poster);
    var meta = [x.year ? String(x.year) : "", (x.genres || []).slice(0, 2).join(", ") || kindTxt(x)];
    return '<button type="button" class="nfhero" data-nfopen="' + esc(k) + '">' +
      (u ? '<img class="nfhi" decoding="async" alt="" src="' + esc(u) + '">' : "") +
      '<span class="nfhg"><span class="nfchips"><span class="nfchip">' + kindTxt(x) + "</span>" + imdbChip(x) + "</span>" +
      '<span class="nfht"><bdi>' + esc(x.title) + '</bdi></span><span class="nfhm">' + bdis(meta) + "</span>" +
      (x.overview ? '<span class="nfho">' + esc(x.overview) + "</span>" : "") + "</span></button>";
  }

  function vNf() {
    var t = TVG.q.trim().toLowerCase(), h = "";
    // בחיפוש תמיד רשימות נטפליקס + חיפוש מלא (nfsearch.js, עם תג לכל שירות); המתג מוצג רק בלי חיפוש
    var NF = t ? TVG.NF : curData(), sw = t ? "" : svcSwitchHtml();
    if (!t && curSvc() === "disney" && !TVG.DS) { if (TVG.dsState === "idle") loadDs(); return sw + dsWaitHtml(); }
    if (!NF || !NF.items) return '<p class="none">אי אפשר לטעון את רשימת הסטרימינג כרגע. נסו שוב מאוחר יותר.</p>';
    if (t) {
      var res = NF.all.filter(function (k) {
        var x = NF.items[k];
        return x.title.toLowerCase().indexOf(t) >= 0 || (x.orig || "").toLowerCase().indexOf(t) >= 0 || (x.genres || []).join(" ").toLowerCase().indexOf(t) >= 0;
      });
      // חיפוש מלא (שרת, nfsearch.js): מתחיל אחרי 400ms ו-2 תווים. תוצאות מקומיות מופיעות מיד.
      var rem = TVG.nfRemote ? TVG.nfRemote(res) : { html: "", any: false };
      h = (res.length ? '<h2 class="sech">נמצאו ' + res.length + " ברשימות נטפליקס</h2>" + '<div class="nfgrid">' + res.map(function (k) { return card(k, NF.items[k]); }).join("") + "</div>" : "") + rem.html;
      if (!res.length && !rem.any) h = '<div class="nfempty"><b>לא נמצא <bdi>״' + esc(TVG.q.trim()) + '״</bdi> במאגר</b><span>לפעמים השם בעברית בנטפליקס שונה מהשם במאגר. נסו את השם באנגלית, שחקן או במאי, או חפשו ישירות בנטפליקס.</span>' +
        '<a class="ghost" href="https://www.netflix.com/search?q=' + encodeURIComponent(TVG.q.trim()) + '" target="_blank" rel="noopener">🔎 חיפוש בנטפליקס</a></div>';
    } else {
      h += sw;
      if (NF.hero && NF.items[NF.hero]) h += heroHtml(NF.hero, NF.items[NF.hero]);
      var fr = favRowHtml(), n = fr ? 1 : 0;
      h += fr;
      // שורות מתחת לקפל נבנות רק כשמתקרבים אליהן (afterRender), כדי שהלשונית תישאר מהירה באייפון
      NF.names.forEach(function (name) {
        var title = esc(NF.titles[name]);
        if (n++ < LAZY_FIRST) h += '<section class="nfsec" data-nfrow="' + name + '"><h2 class="sech">' + title + '</h2><div class="nfrow">' + rowCards(name, NF) + "</div></section>";
        else h += '<section class="nfsec" data-nfrow="' + name + '" data-nflz="' + name + '"><h2 class="sech">' + title + '</h2><div class="nfrow">' + skelRow() + "</div></section>";
      });
    }
    return h + tmdbCredit();
  }

  // ---- תמונות: שלד בזמן טעינה, ומקום חלופי לתמונה שנכשלה ----
  document.addEventListener("load", function (e) {
    var im = e.target; if (!im || im.tagName !== "IMG" || !im.parentNode || !im.parentNode.classList) return;
    im.parentNode.classList.add("ld");
  }, true);
  document.addEventListener("error", function (e) {
    var im = e.target; if (!im || im.tagName !== "IMG" || !im.parentNode || !im.parentNode.classList) return;
    if (im.parentNode.classList.contains("nfp") || im.parentNode.classList.contains("nfbd")) im.parentNode.classList.add("er");
    if (im.className === "nfhi") im.style.display = "none";
  }, true);

  // ---- דף תוכן ----
  function ratesHtml(x) {
    var r = x.ratings || {}, a = [], im = imdbOf(x);
    if (im) a.push('<span class="nfr im"><b><bdi dir="ltr">⭐ ' + fmtRate(im) + "</bdi></b><i>IMDb</i></span>");
    if (typeof r.rt === "number") a.push('<span class="nfr rt"><b><bdi dir="ltr">🍅 ' + Math.round(r.rt) + "%</bdi></b><i>Rotten Tomatoes</i></span>");
    if (typeof r.mc === "number") a.push('<span class="nfr mc"><b><bdi dir="ltr">' + Math.round(r.mc) + "</bdi></b><i>Metacritic</i></span>");
    return a.length ? '<div class="nfrates">' + a.join("") + "</div>" : "";
  }
  function pageHtml(x) {
    var bd = imgUrl(x.backdrop), u = bd || imgUrl(x.poster);
    var h = '<div class="nfbd' + (u ? "" : " er") + (bd ? "" : " ispo") + '">' + (u ? '<img alt="" decoding="async" src="' + esc(u) + '">' : "") + '<span class="nfph" aria-hidden="true">🎬</span></div>';
    h += '<div class="nfpg"><h2 id="nfsT"><bdi>' + esc(x.title) + "</bdi></h2>";
    if (showOrig(x)) h += '<div class="nforig"><bdi dir="ltr">' + esc(x.orig) + "</bdi></div>";
    h += '<div class="nfmeta">' + bdis([kindTxt(x), x.year ? String(x.year) : "", lenTxt(x), (x.genres || []).slice(0, 3).join(", ")]) + "</div>";
    h += ratesHtml(x);
    h += '<p class="nfov" dir="auto">' + (x.overview ? esc(x.overview) : "אין עדיין תקציר בעברית לתוכן הזה.") + "</p>";
    // "חברים שראו": שלב 3. אין נתונים אמיתיים, לכן אין בלוק בכלל.
    if (RE_TR.test(x.trailer || "")) h += '<a class="ghost nftr" href="https://www.youtube.com/watch?v=' + esc(x.trailer) + '" target="_blank" rel="noopener">🎬 טריילר</a>';
    // זמינות, 🔔 התראות, ⏰ תזכורת צפייה (nfsearch.js / nfwatch.js)
    if (TVG.nfAvail) h += TVG.nfAvail(x);
    if (TVG.nfAlerts) h += TVG.nfAlerts(x);
    if (TVG.nfWatchRem) h += TVG.nfWatchRem(x);
    return h + "</div>";
  }
  // פריט לפי מפתח: רשימות נטפליקס, תוצאות חיפוש מלא, או פריט ברשימת ההתראות (כשפותחים מהודעה)
  // ev: "nf" (נפתח מהודעת "הגיע לנטפליקס") / "rem" (מתזכורת צפייה). לפריט שההודעה אמרה שהגיע: תמיד זמין עם קישור, גם אם החיפוש (במטמון) עדיין אומר אחרת
  // פריט בשני הקבצים (אותו מפתח TMDB): קודם של השירות שממנו נפתח (שמור/השירות הפעיל)
  var prefSvc = null;
  function lookup(k) {
    var ds = TVG.DS && TVG.DS.items && TVG.DS.items[k], nf = TVG.NF && TVG.NF.items && TVG.NF.items[k];
    return (prefSvc || curSvc()) === "disney" ? ds || nf || null : nf || ds || null;
  }
  function getItem(k) {
    var ev = TVG.nfOpenEv, x = lookup(k) || (TVG.nfX && TVG.nfX[k]) || null, w = TVG.wlItem ? TVG.wlItem(k, ev) : null;
    if (!x) return w || favItem(k);
    if (ev === "nf" && x.nf === false) x = Object.assign({}, x, { nf: true, link: x.link || (w && w.link) || "" });
    return x;
  }
  // פריט מרשימות נטפליקס (netflix.json) זמין בנטפליקס מעצם היותו שם; בתוצאות חיפוש יש שדה nf מפורש
  function isNf(x) { return !x || (x.svc !== "disney" && x.nf !== false); } // פריט מ-disney.json אינו (בהכרח) בנטפליקס
  function barHtml(x, k) {
    // 💌 יתווסף בשלב 3 (חברים); עד אז לא מציגים כפתורים מתים.
    var dsv = svcOf(x) === "disney", lk = linkOf(x), ok = (dsv ? isDs(x) && RE_DLINK.test(lk) : isNf(x) && RE_LINK.test(lk));
    var sv = k && RE_KEY.test(k) ? isFav(k) : null;
    // ⭐ שמירה ו-🍿 באותה שורה (משניים, 44px): הכתום נשאר אחד, למטה
    var row = (sv === null ? "" : '<button type="button" class="ghost nffv' + (sv ? " on" : "") + '" data-nffav="' + esc(k) + '" aria-pressed="' + sv + '">' + (sv ? "★ שמור" : "⭐ שמירה") + "</button>") + (TVG.partyNfBtn ? TVG.partyNfBtn() : ""); /* 🍿 ערב צפייה */
    return (ok ? '<a class="btn nfgo" href="' + esc(lk) + '" target="_blank" rel="noopener">▶ פתח ב' + (dsv ? "דיסני+" : "נטפליקס") + "</a>" : '<p class="none nfnolink">אין קישור ישיר ל' + (dsv ? "דיסני+" : "נטפליקס") + " לתוכן הזה.</p>") +
      (row ? '<div class="nfbar2">' + row + "</div>" : "") +
      '<button type="button" class="ghost nfcl" data-nfclose>סגירה</button>';
  }
  function openNf(k, ev, pref) {
    TVG.nfOpenEv = ev || null; prefSvc = pref === "disney" ? "disney" : null;
    var x = getItem(k);
    if (!x && ev === "rem" && !TVG.nfRemTry && TVG.calTok && TVG.CAL_API) { // תזכורת שלא שמורה במכשיר הזה (נוצרה בספארי/מכשיר אחר): מושכים מהשרת ומנסים שוב פעם אחת
      TVG.nfRemTry = true;
      fetch(TVG.CAL_API + "/api/rems?t=" + TVG.calTok, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var rec = j && Array.isArray(j.rems) && j.rems.filter(function (r) { return r && typeof r.k === "string" && r.k.indexOf("nf|" + k + "|") === 0; })[0];
        if (rec && !TVG.hasRem(rec.k)) { TVG.REMS.push(rec); TVG.saveRems(); }
        openNf(k, ev, pref);
      }).catch(function () { openNf(k, ev, pref); }).then(function () { TVG.nfRemTry = false; });
      return;
    }
    if (!x) { TVG.nfOpenEv = null; if (TVG.pill) TVG.pill("לא מצאנו את התוכן הזה", 2200); return; }
    TVG.nfOpen = k;
    $("#nfsBody").innerHTML = pageHtml(x); $("#nfsBar").innerHTML = barHtml(x, k); $("#nfsBody").scrollTop = 0;
    $("#nfsheet").hidden = false; $("#scrim2").hidden = false;
    if (TVG.nfEnsure) TVG.nfEnsure(x); // פריט בלי פרטים (נפתח מהודעה): משלימים מהחיפוש
    // היסטוריה: #nfsheet רשום ב-nav.js כשכבה (MutationObserver על hidden)
  }
  // ציור מחדש של הדף הפתוח (אחרי שינוי התראה/תזכורת/נתונים), בלי לקפוץ לראש
  function reopen() {
    var x = TVG.nfOpen && getItem(TVG.nfOpen); if (!x || $("#nfsheet").hidden) return;
    var sc = $("#nfsBody").scrollTop;
    $("#nfsBody").innerHTML = pageHtml(x); $("#nfsBar").innerHTML = barHtml(x, TVG.nfOpen); $("#nfsBody").scrollTop = sc;
  }
  function closeNf() {
    if (!$("#nfsheet") || $("#nfsheet").hidden) return;
    $("#nfsheet").hidden = true; TVG.nfOpen = null; prefSvc = null;
    scrimOff();
  }
  // הרקע הכהה נעלם רק כשאין אף חלון פתוח מתחתיו (רשימת 'עוד' יכולה להיות פתוחה מתחת לדף תוכן)
  function scrimOff() {
    var any = ["#rem", "#favs", "#setsheet", "#land", "#nflist", "#nfsheet"].some(function (s) { var e = $(s); return e && !e.hidden; });
    if (!any) $("#scrim2").hidden = true;
  }

  // ---- שורות מתחת לקפל: נבנות כשמתקרבים אליהן ----
  var io = null;
  function fillRow(sec) {
    var name = sec.getAttribute("data-nflz"), NF = curData(); sec.removeAttribute("data-nflz");
    var r = sec.querySelector(".nfrow"); if (r && NF && NF.rows[name]) r.innerHTML = rowCards(name, NF);
  }
  function afterRender() {
    if (io) { try { io.disconnect(); } catch (e) {} io = null; }
    var secs = Array.prototype.slice.call(document.querySelectorAll("#main [data-nflz]")); if (!secs.length) return;
    if (!("IntersectionObserver" in window)) { secs.forEach(fillRow); return; }
    io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); fillRow(en.target); } }); }, { rootMargin: "0px 0px 700px 0px" });
    secs.forEach(function (s) { io.observe(s); });
  }

  // ---- רשימה מלאה ('עוד ›'): חלון תחתון עם כל פריטי השורה ----
  var listName = null;
  function listData(name) {
    var NF = curData();
    if (name === "fav") return FAVS.length ? { title: FAV_TITLE, types: FAVS.map(function (f) { return f.type; }), cards: FAVS.map(favCard) } : null;
    if (!NF || !NF.rows[name]) return null;
    return { title: NF.titles[name], types: NF.rows[name].map(function (k) { return NF.items[k].type; }), cards: NF.rows[name].map(function (k) { return card(k, NF.items[k]); }) };
  }
  function listHtml(d) {
    var tv = d.types.filter(function (t) { return t === "tv"; }).length, n = d.types.length;
    var what = tv === n ? (n === 1 ? "סדרה" : "סדרות") : tv === 0 ? (n === 1 ? "סרט" : "סרטים") : "סרטים וסדרות";
    return '<div class="nfl-in"><h2 id="nflT">' + esc(d.title) + '</h2><p class="nfl-n">' + n + " " + what + (listName === "fav" ? " · לחיצה ארוכה להסרה" : "") + '</p><div class="nfgrid">' + d.cards.join("") + "</div></div>";
  }
  function openNfList(name) {
    var d = listData(name); if (!d) return;
    listName = name;
    $("#nflBody").innerHTML = listHtml(d); $("#nflBody").scrollTop = 0;
    $("#nflist").hidden = false; $("#scrim2").hidden = false;
  }
  function refreshList() {
    if (!listName || $("#nflist").hidden) return;
    var d = listData(listName); if (!d) { closeNfList(); return; }
    var sc = $("#nflBody").scrollTop; $("#nflBody").innerHTML = listHtml(d); $("#nflBody").scrollTop = sc;
  }
  function closeNfList() {
    if (!$("#nflist") || $("#nflist").hidden) return;
    $("#nflist").hidden = true; listName = null;
    scrimOff();
  }

  // ---- שמירה/הסרה: מעדכנים רק את מה שהשתנה (שורת השמורים, כוכבים על פוסטרים, הכפתור, הרשימה), בלי לצייר מחדש ולקפוץ ----
  function patchMain() {
    var main = $("#main"); if (TVG.tab !== "nf" || !curData() || TVG.q.trim() || !main) return;
    var cur = main.querySelector('[data-nfrow="fav"]'), html = favRowHtml(), h0 = document.documentElement.scrollHeight;
    if (!html) { if (cur) cur.parentNode.removeChild(cur); }
    else {
      var tmp = document.createElement("div"); tmp.innerHTML = html; var nu = tmp.firstChild;
      if (cur) cur.parentNode.replaceChild(nu, cur);
      else { var hero = main.querySelector(".nfhero"); if (hero && hero.nextSibling) main.insertBefore(nu, hero.nextSibling); else if (hero) main.appendChild(nu); else main.insertBefore(nu, main.firstChild); }
    }
    Array.prototype.forEach.call(main.querySelectorAll("[data-nfopen]"), function (c) {
      var p = c.querySelector(".nfp"); if (!p || c.hasAttribute("data-nffc")) return;
      var on = isFav(c.getAttribute("data-nfopen")), b = p.querySelector(".nfsv");
      if (on && !b) p.insertAdjacentHTML("beforeend", '<span class="nfsv" title="שמור">★</span>'); else if (!on && b) p.removeChild(b);
    });
    var d = document.documentElement.scrollHeight - h0;
    if (d && window.scrollY > 4) window.scrollBy(0, d); // השורה נוספה/הוסרה מעל מה שרואים: משאירים את התצוגה במקום
  }
  function favChanged() { patchMain(); refreshList(); if (TVG.nfOpen && !$("#nfsheet").hidden) reopen(); }
  function toggleFav(k) {
    if (!RE_KEY.test(k)) return;
    if (isFav(k)) {
      var f = favDel(k); favChanged();
      TVG.pill("הוסר מהשמורים", 4500, "החזר", function () { favRestore(f); favChanged(); });
    } else {
      var x = getItem(k); if (!x) return;
      favAdd(k, x); favChanged();
      TVG.pill("⭐ נשמר בשמורים", 4000, "ביטול", function () { favDel(k); favChanged(); });
    }
  }

  // לחיצה ארוכה על שמור = הסרה (עם 'החזר'). ההקשה שאחריה לא פותחת את הדף
  var lp = null, lpSuppress = false;
  function lpClear() { if (lp) { clearTimeout(lp.t); lp = null; } }
  document.addEventListener("pointerdown", function (e) {
    lpSuppress = false;
    var c = e.target.closest && e.target.closest("[data-nffc]"); if (!c || (e.pointerType === "mouse" && e.button !== 0)) return;
    lpClear();
    var k = c.getAttribute("data-nffc");
    lp = { x: e.clientX, y: e.clientY, t: setTimeout(function () { lp = null; lpSuppress = true; if (isFav(k)) { try { if (navigator.vibrate) navigator.vibrate(12); } catch (er) {} toggleFav(k); } }, 550) };
  });
  document.addEventListener("pointermove", function (e) { if (lp && Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > 8) lpClear(); });
  ["pointerup", "pointercancel"].forEach(function (n) { document.addEventListener(n, lpClear); });
  document.addEventListener("contextmenu", function (e) { if (e.target.closest && e.target.closest("[data-nffc]")) e.preventDefault(); });
  document.addEventListener("click", function (e) { if (lpSuppress) { lpSuppress = false; e.preventDefault(); e.stopPropagation(); } }, true);

  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var sv0 = t.closest("[data-nfsvc]");
    if (sv0) {
      var ns = sv0.getAttribute("data-nfsvc") === "disney" ? "disney" : "netflix";
      if (ns !== curSvc()) { TVG.svc = ns; TVG.store("tvg.svc", ns); TVG.render(); window.scrollTo(0, 0); }
      return;
    }
    if (t.closest("[data-nfdsretry]")) { TVG.dsState = "idle"; TVG.render(); return; }
    var fv = t.closest("[data-nffav]"); if (fv) { toggleFav(fv.getAttribute("data-nffav")); return; }
    var mo = t.closest("[data-nfmore]"); if (mo) { openNfList(mo.getAttribute("data-nfmore")); return; }
    var o = t.closest("[data-nfopen]"); if (o) { e.preventDefault(); openNf(o.getAttribute("data-nfopen"), null, o.getAttribute("data-nfpref")); return; }
    if (t.closest("[data-nfclose]")) closeNf();
    if (t.closest("[data-nflclose]")) closeNfList();
  });
  // Escape וכפתור "חזור": nav.js סוגר את השכבה העליונה
})(window.TVG);
