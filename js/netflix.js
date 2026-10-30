/* js/netflix.js - לשונית 'נטפליקס' (סכמה v2): כרטיס ראשי, שורות פוסטרים, דף תוכן בחלון תחתון.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid. */
(function (TVG) {
  TVG.files["netflix"] = 1;
  var $ = TVG.$, esc = TVG.esc;
  TVG.vNf = vNf;
  TVG.nfPrep = nfPrep;
  TVG.openNf = openNf;
  TVG.closeNf = closeNf;

  var ROWS = [["popular", "הכי נצפים"], ["recent", "יצא לאחרונה"], ["top", "הכי מדורגים"]];

  // ---- נתונים: בדיקת סכמה v2 ונרמול. מחזיר null כשאין מה להציג (הלשונית נשארת מוסתרת) ----
  var RE_LINK = /^https:\/\/www\.netflix\.com\//, RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\//, RE_TR = /^[A-Za-z0-9_-]{11}$/;
  // שדה לא תקין מושמט (לא הפריט כולו)
  function clean(x) {
    var o = {}, k;
    for (k in x) if (Object.prototype.hasOwnProperty.call(x, k)) o[k] = x[k];
    if (!RE_LINK.test(o.link || "")) delete o.link;
    if (!RE_IMG.test(o.poster || "")) delete o.poster;
    if (!RE_IMG.test(o.backdrop || "")) delete o.backdrop;
    if (!RE_TR.test(o.trailer || "")) delete o.trailer;
    return o;
  }
  function nfPrep(j0) {
    var j = j0;
    if (j0 && typeof j0 === "object" && j0.items && typeof j0.items === "object") {
      j = { v: j0.v, updated: j0.updated, hero: j0.hero, rows: j0.rows, items: {} };
      Object.keys(j0.items).forEach(function (k) { if (j0.items[k] && typeof j0.items[k] === "object") j.items[k] = clean(j0.items[k]); });
    }
    if (!j || typeof j !== "object" || !(j.v >= 2) || !j.items || typeof j.items !== "object") return null;
    var rows = {}, any = false, seen = {};
    ROWS.forEach(function (r) {
      var src = j.rows && j.rows[r[0]], out = [];
      (Array.isArray(src) ? src : []).forEach(function (k) { if (j.items[k] && j.items[k].title && out.indexOf(k) < 0) out.push(k); });
      rows[r[0]] = out; if (out.length) any = true;
    });
    if (!any) return null;
    var hero = j.hero && j.items[j.hero] && j.items[j.hero].title ? j.hero : null;
    if (!hero) rows.popular.concat(rows.recent, rows.top).some(function (k) { if (j.items[k].backdrop) { hero = k; return true; } return false; });
    if (!hero) hero = rows.popular[0] || rows.recent[0] || rows.top[0];
    var all = [];
    rows.popular.concat(rows.recent, rows.top, Object.keys(j.items)).forEach(function (k) { if (!seen[k] && j.items[k] && j.items[k].title) { seen[k] = 1; all.push(k); } });
    return { v: j.v, updated: j.updated, hero: hero, rows: rows, items: j.items, all: all };
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
  function poster(x) {
    var u = imgUrl(x.poster);
    return '<span class="nfp' + (u ? "" : " er") + '">' + (u ? '<img loading="lazy" decoding="async" alt="פוסטר: ' + esc(x.title) + '" src="' + esc(u) + '">' : "") +
      '<span class="nfph" aria-hidden="true">🎬</span>' + imdbChip(x, "onp") + "</span>";
  }
  function card(k, x) {
    return '<button type="button" class="nfc" data-nfopen="' + esc(k) + '">' + poster(x) + '<span class="nft"><bdi>' + esc(x.title) + "</bdi></span></button>";
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
    var NF = TVG.NF, t = TVG.q.trim().toLowerCase(), h = "";
    if (!NF || !NF.items) return '<p class="none">אי אפשר לטעון את רשימת נטפליקס כרגע. נסו שוב מאוחר יותר.</p>';
    if (t) {
      var res = NF.all.filter(function (k) {
        var x = NF.items[k];
        return x.title.toLowerCase().indexOf(t) >= 0 || (x.orig || "").toLowerCase().indexOf(t) >= 0 || (x.genres || []).join(" ").toLowerCase().indexOf(t) >= 0;
      });
      h = res.length ? '<h2 class="sech">נמצאו ' + res.length + " ברשימות נטפליקס</h2>" + '<div class="nfgrid">' + res.map(function (k) { return card(k, NF.items[k]); }).join("") + "</div>"
        : '<div class="nfempty"><b>לא נמצא <bdi>״' + esc(TVG.q.trim()) + '״</bdi> בנטפליקס</b><span>מחפשים בשם בעברית, בשם המקורי או בז׳אנר. הרשימות כוללות רק את מה שפופולרי עכשיו.</span></div>';
    } else {
      if (NF.hero && NF.items[NF.hero]) h += heroHtml(NF.hero, NF.items[NF.hero]);
      ROWS.forEach(function (r) {
        var ks = NF.rows[r[0]]; if (!ks.length) return;
        h += '<section class="nfsec"><h2 class="sech">' + r[1] + '</h2><div class="nfrow">' + ks.map(function (k) { return card(k, NF.items[k]); }).join("") + "</div></section>";
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
    h += '<p class="nfov">' + (x.overview ? esc(x.overview) : "אין עדיין תקציר בעברית לתוכן הזה.") + "</p>";
    // "חברים שראו": שלב 3. אין נתונים אמיתיים, לכן אין בלוק בכלל.
    if (RE_TR.test(x.trailer || "")) h += '<a class="ghost nftr" href="https://www.youtube.com/watch?v=' + esc(x.trailer) + '" target="_blank" rel="noopener">🎬 טריילר</a>';
    return h + "</div>";
  }
  function barHtml(x) {
    // 💌 ו-🍿 יתווספו בשלב 3 (חברים); עד אז לא מציגים כפתורים מתים.
    var ok = RE_LINK.test(x.link || "");
    return (ok ? '<a class="btn nfgo" href="' + esc(x.link) + '" target="_blank" rel="noopener">▶ פתח בנטפליקס</a>' : '<p class="none nfnolink">אין קישור ישיר לנטפליקס לתוכן הזה.</p>') +
      '<button type="button" class="ghost nfcl" data-nfclose>סגירה</button>';
  }
  function openNf(k) {
    var x = TVG.NF && TVG.NF.items && TVG.NF.items[k]; if (!x) return;
    TVG.nfOpen = k;
    $("#nfsBody").innerHTML = pageHtml(x); $("#nfsBar").innerHTML = barHtml(x); $("#nfsBody").scrollTop = 0;
    $("#nfsheet").hidden = false; $("#scrim2").hidden = false;
    // היסטוריה: #nfsheet רשום ב-nav.js כשכבה (MutationObserver על hidden)
  }
  function closeNf() {
    if (!$("#nfsheet") || $("#nfsheet").hidden) return;
    $("#nfsheet").hidden = true; TVG.nfOpen = null;
    if ($("#rem").hidden && $("#favs").hidden && $("#setsheet").hidden) $("#scrim2").hidden = true;
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    var o = t.closest && t.closest("[data-nfopen]"); if (o) { e.preventDefault(); openNf(o.getAttribute("data-nfopen")); return; }
    if (t.closest && t.closest("[data-nfclose]")) closeNf();
  });
  // Escape וכפתור "חזור": nav.js סוגר את השכבה העליונה
})(window.TVG);
