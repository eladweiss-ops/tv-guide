/* js/nfsearch.js - חיפוש מלא בנטפליקס (שרת: GET /api/nf-search), תוצאות מקובצות עם תג זמינות, והתאמה ללוח השידורים.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, ... netflix. מופעל מ-vNf (netflix.js) דרך TVG.nfRemote.
   זרימה: הקלדה -> render() -> nfRemote רואה מפתח חדש -> 400ms -> fetch -> render(). תוצאות מקומיות (netflix.json) מופיעות מיד. */
(function (TVG) {
  TVG.files["nfsearch"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.nfRemote = remote;
  TVG.nfAvail = availHtml;
  TVG.nfEnsure = ensure;
  TVG.nfAiring = airing;
  TVG.nfX = {}; // k -> פריט מנוקה מתוצאות החיפוש (netflix.js getItem משתמש בו)

  var DEBOUNCE = 400, MINLEN = 2;
  var RE_LINK = /^https:\/\/www\.netflix\.com\//, RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\//, RE_K = /^[mt][0-9]{1,9}$/;
  var cache = {};                       // מפתח שאילתה -> תשובה מנוקה
  var S = { key: "", state: "idle" };   // state: loading | err | rate | ok
  var timer = 0, seq = 0;

  // ---- ניקוי תשובת השרת (עוד שכבה מעל הרשימה הלבנה בשרת) ----
  function str(v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, n) : ""; }
  function safeItem(o, partial) {
    if (!o || typeof o !== "object" || !RE_K.test(o.k || "")) return null;
    var nf = o.nf === true, title = str(o.title, 120);
    if (!title) return null;
    return {
      k: o.k, id: +o.id || 0, type: o.type === "tv" ? "tv" : "movie", title: title, orig: str(o.orig, 120), year: +o.year > 0 ? +o.year : 0,
      overview: str(o.overview, 400), poster: RE_IMG.test(o.poster || "") ? o.poster : "", backdrop: RE_IMG.test(o.backdrop || "") ? o.backdrop : "",
      nf: nf, others: (Array.isArray(o.others) ? o.others : []).map(function (s) { return str(s, 30); }).filter(Boolean).slice(0, 4),
      link: nf && RE_LINK.test(o.link || "") ? o.link : "", _p: !!partial /* תשובה חלקית: זמינות לא ודאית */
    };
  }
  function keysOf(a) { return (Array.isArray(a) ? a : []).filter(function (k) { return RE_K.test(k) && TVG.nfX[k]; }); }
  function safeRes(j) {
    if (!j || typeof j !== "object" || !j.items || typeof j.items !== "object") return null;
    Object.keys(j.items).forEach(function (k) { var it = safeItem(j.items[k], j.partial === true); if (it && it.k === k) TVG.nfX[k] = it; });
    var col = j.collection && typeof j.collection === "object" ? { name: str(j.collection.name, 120), keys: keysOf(j.collection.keys) } : null;
    var br = j.brand && typeof j.brand === "object" ? { name: str(j.brand.name, 80), keys: keysOf(j.brand.keys) } : null;
    return {
      collection: col && col.keys.length ? col : null, brand: br && br.keys.length ? br : null, titles: keysOf(j.titles),
      persons: (Array.isArray(j.persons) ? j.persons : []).slice(0, 3).map(function (p) {
        return p && str(p.name, 80) ? { name: str(p.name, 80), photo: RE_IMG.test(p.photo || "") ? p.photo : "", dept: str(p.dept, 20), keys: keysOf(p.keys) } : null;
      }).filter(function (p) { return p && p.keys.length; })
    };
  }
  function empty(r) { return !r.collection && !r.brand && !r.titles.length && !r.persons.length; }

  // ---- רשת ----
  function schedule(key) {
    clearTimeout(timer);
    var my = ++seq;
    timer = setTimeout(function () {
      fetch(TVG.CAL_API + "/api/nf-search?q=" + encodeURIComponent(key), { cache: "no-store" })
        .then(function (r) { if (r.status === 429) { var e = new Error("rate"); e.rate = true; throw e; } if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (j) {
          var res = safeRes(j); if (!res) throw new Error("shape");
          cache[key] = res;
          if (my === seq) S.state = "ok";
          done(key);
        })
        .catch(function (e) { if (my === seq) { S.state = e && e.rate ? "rate" : "err"; done(key); } });
    }, DEBOUNCE);
  }
  function done(key) { if (TVG.tab === "nf" && TVG.q.trim().toLowerCase() === key) TVG.render(); }

  // ---- התאמה ללוח השידורים: האם הכותרת משודרת בשבוע הקרוב ----
  // סרט: שוויון מלא של הכותרת המנורמלת בלבד ("מועדון קרב" לא תואם "מועדון קרב: לחברים בלבד"; ושנה כשיש בשני הצדדים).
  // סדרה: גם "גזע" (לפני ' - ' / ':' / '('). אותו כלל בשרת: calendar-server/api/_wcheck.js titleMatch.
  var IDXF = null, IDXS = null, IDXG = null, IDXT = 0; // מפתח מלא / מפתח גזע -> {mine, all}
  function stemOf(t) { return String(t || "").split(/\s+[-–:]\s+|\s*[(:]/)[0]; }
  function put(map, key, c, p, mine) {
    var e = map[key] || (map[key] = { mine: null, all: null });
    if (!e.all || p.s < e.all.p.s) e.all = { c: c, p: p };
    if (mine && (!e.mine || p.s < e.mine.p.s)) e.mine = { c: c, p: p };
  }
  function airIndex() {
    var now = Date.now();
    if (IDXF && IDXG === TVG.G && now - IDXT < 300000) return;
    IDXF = {}; IDXS = {}; IDXG = TVG.G; IDXT = now;
    if (!TVG.G) return;
    var mine = {}, end = now + 7 * 864e5;
    try { TVG.chans().forEach(function (c) { mine[c.id] = 1; }); } catch (e) {}
    TVG.G.channels.forEach(function (c) {
      (TVG.by.get(c.id) || []).forEach(function (p) {
        if (TVG.ilTs(p.e) <= now || TVG.ilTs(p.s) > end) return; // זמני הלוח הם שעון קיר ישראלי
        var a = TVG.nfNorm(p.title), b = TVG.nfNorm(stemOf(p.title));
        if (a.length >= 3) put(IDXF, a, c, p, !!mine[c.id]);
        if (b.length >= 3 && b !== a) put(IDXS, b, c, p, !!mine[c.id]);
      });
    });
  }
  // {c, p} של השידור הקרוב ביותר (ערוצים שלי קודם), או null
  function airing(x) {
    if (!x) return null;
    airIndex();
    var wants = [TVG.nfNorm(x.title), TVG.nfNorm(x.orig)].filter(function (w) { return w.length >= 3; }), maps = x.type === "tv" ? [IDXF, IDXS] : [IDXF], best = null;
    ["mine", "all"].some(function (which) {
      maps.forEach(function (m) { wants.forEach(function (w) { var e = m && m[w] && m[w][which]; if (e && (!best || e.p.s < best.p.s)) best = e; }); });
      return !!best;
    });
    return best;
  }
  var DAYS_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];
  function whenTxt(d) {
    if (TVG.ilTs(d) <= Date.now()) return "עכשיו";
    var t = hhmm(d);
    if (dstr(d) === dstr(TVG.ilNow())) return "היום " + t;
    var w = d.getDay();
    return (w === 6 ? "שבת" : "יום " + DAYS_SHORT[w]) + " " + t;
  }

  // ---- תג זמינות ----
  // תג "📺 משודר בערוץ": כפתור שפותח את השידור בלוח (חלון התזכורת): שתי הקשות לתזכורת. data-nfair = מזהה ערוץ|זמן התחלה
  function airBtn(x, a, big) {
    return '<button type="button" class="nfb' + (big ? " big" : "") + ' tv" data-nfair="' + esc(a.c.id + "|" + a.p.s.getTime()) + '" aria-label="משודר בערוץ ' + esc(a.c.name) + ', פתיחה בלוח">📺 משודר בערוץ <bdi>' + esc(a.c.name) + "</bdi> · " + esc(whenTxt(a.p.s)) + "</button>";
  }
  function badge(x) {
    if (x.nf) return '<span class="nfb nf"><i>▶</i>בנטפליקס</span>';
    var a = airing(x);
    if (a) return airBtn(x, a, false);
    return '<span class="nfb no">לא זמין כרגע</span>';
  }
  // בדף התוכן: כל מה שנכון (נטפליקס, ערוץ), ושירותים אחרים כמידע בלבד
  function availHtml(x) {
    var h = "";
    if (TVG.nfIsNf(x)) h += '<span class="nfb big nf"><i>▶</i>זמין בנטפליקס</span>';
    var a = airing(x);
    if (a) h += airBtn(x, a, true);
    if (!h) h = '<span class="nfb big no">לא זמין כרגע בנטפליקס</span>';
    var o = (x.others || []).filter(Boolean);
    return '<div class="nfav">' + h + (o.length ? '<span class="nfavo">זמין גם ב: ' + o.map(function (s) { return "<bdi>" + esc(s) + "</bdi>"; }).join(" · ") + "</span>" : "") + "</div>";
  }

  // ---- תוצאות ----
  // הכרטיס הוא div (תג הערוץ הוא כפתור נפרד; כפתור בתוך כפתור אסור): אזור ראשי = כפתור, התג בשורה משלו מתחתיו
  function img(u, alt) { return u ? '<img loading="lazy" decoding="async" alt="' + esc(alt) + '" src="' + esc(u) + '">' : ""; }
  function posterSp(x) { return '<span class="nfp' + (x.poster ? "" : " er") + '">' + img(x.poster, "פוסטר: " + x.title) + '<span class="nfph" aria-hidden="true">🎬</span></span>'; }
  function row(x, n) {
    var meta = [x.type === "tv" ? "סדרה" : "סרט", x.year ? String(x.year) : ""].filter(Boolean).map(function (s) { return "<bdi>" + esc(s) + "</bdi>"; }).join(" · ");
    return '<div class="nfx"><button type="button" class="nfxo" data-nfopen="' + esc(x.k) + '">' + (n ? '<i class="nfxn" aria-hidden="true">' + n + "</i>" : "") + posterSp(x) +
      '<span class="nfxt"><b><bdi>' + esc(x.title) + '</bdi></b><span class="nfxm">' + meta + "</span></span></button>" + '<div class="nfxb">' + badge(x) + "</div></div>";
  }
  function mini(x) { return '<div class="nfc"><button type="button" class="nfco" data-nfopen="' + esc(x.k) + '">' + posterSp(x) + '<span class="nft"><bdi>' + esc(x.title) + "</bdi></span></button>" + badge(x) + "</div>"; }
  function section(title, sub, body) {
    return '<section class="nfsec nfrs"><h2 class="sech">' + title + (sub ? ' <span class="nfsub">' + sub + "</span>" : "") + "</h2>" + body + "</section>";
  }
  function person(p) {
    var items = p.keys.map(function (k) { return TVG.nfX[k]; }).filter(Boolean);
    return '<div class="nfpr"><div class="nfprh"><span class="nfpf' + (p.photo ? "" : " er") + '">' + img(p.photo, p.name) + '<span aria-hidden="true">👤</span></span><span class="nfprt"><b><bdi>' + esc(p.name) + "</bdi></b>" +
      (p.dept ? '<span class="nfxm">' + esc(p.dept) + "</span>" : "") + '</span></div><div class="nfrow">' + items.map(mini).join("") + "</div></div>";
  }

  // localKeys: מפתחות שכבר מוצגים מרשימות נטפליקס (לא מכפילים)
  function remote(localKeys) {
    var q = TVG.q.trim(), key = q.toLowerCase();
    if (q.length < MINLEN) return { html: "", any: false };
    var r = cache[key];
    if (!r) {
      if (S.key !== key) { S.key = key; S.state = "loading"; schedule(key); }
      if (S.state === "err" || S.state === "rate")
        return { any: true, html: '<div class="nfempty"><b>' + (S.state === "rate" ? "יותר מדי חיפושים" : "החיפוש המלא לא זמין כרגע") + "</b><span>" + (S.state === "rate" ? "נסו שוב בעוד רגע." : "הרשימות שלמעלה זמינות. אפשר לנסות שוב.") +
          '</span><button type="button" class="ghost" data-nfretry>נסו שוב</button></div>' };
      return { any: true, html: '<div class="nfload" role="status"><i class="nfsp" aria-hidden="true"></i>מחפשים בנטפליקס…</div>' };
    }
    var used = {}; (localKeys || []).forEach(function (k) { used[k] = 1; });
    var h = "";
    if (r.collection) {
      r.collection.keys.forEach(function (k) { used[k] = 1; });
      h += section("סדרת סרטים", "<bdi>" + esc(r.collection.name) + "</bdi>", '<div class="nfxl">' + r.collection.keys.map(function (k, i) { return row(TVG.nfX[k], i + 1); }).join("") + "</div>");
    }
    if (r.brand) {
      var bk = r.brand.keys.filter(function (k) { return !used[k]; }); bk.forEach(function (k) { used[k] = 1; });
      if (bk.length) h += section("סרטים וסדרות", "מ-<bdi>" + esc(r.brand.name) + "</bdi>", '<div class="nfxl">' + bk.map(function (k) { return row(TVG.nfX[k]); }).join("") + "</div>");
    }
    var tk = r.titles.filter(function (k) { return !used[k]; });
    if (tk.length) h += section(r.brand ? "עוד סרטים וסדרות" : "סרטים וסדרות", "", '<div class="nfxl">' + tk.map(function (k) { return row(TVG.nfX[k]); }).join("") + "</div>");
    if (r.persons.length) h += section("אנשים", "", r.persons.map(person).join(""));
    return { any: !empty(r), html: h };
  }

  // ---- פריט בלי פרטים (נפתח מהודעה/מרשימת ההתראות): משלימים מהחיפוש ----
  function ensure(x) {
    if (!x || !x._wl) return;
    var key = String(x.title).trim().toLowerCase();
    fetch(TVG.CAL_API + "/api/nf-search?q=" + encodeURIComponent(key), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var res = safeRes(j); if (!res || !TVG.nfX[x.k]) return;
      if (TVG.nfOpen === x.k && TVG.nfReopen) TVG.nfReopen();
    }).catch(function () {});
  }

  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    if (t.closest("[data-nfretry]")) { S.key = ""; S.state = "idle"; TVG.render(); return; }
    var ab = t.closest("[data-nfair]");
    if (ab) { // "📺 משודר בערוץ…": פותח את השידור בחלון התזכורת (כמו ⏰ בלוח). שתי הקשות לתזכורת
      var rr = TVG.findProg(ab.getAttribute("data-nfair"));
      if (!rr) { TVG.pill("השידור כבר לא בלוח", 1800); return; }
      if (TVG.closeNf) TVG.closeNf();
      if (!TVG.calMode && !TVG.hasRem(TVG.remKey(rr.id, rr.p.s))) { TVG.rem = rr; TVG.askCal(); return; }
      TVG.openRem(rr);
    }
  });
  document.addEventListener("error", function (e) {
    var im = e.target; if (im && im.tagName === "IMG" && im.parentNode && im.parentNode.classList && im.parentNode.classList.contains("nfpf")) im.parentNode.classList.add("er");
  }, true);
})(window.TVG);
