/* js/search.js - חיפוש חכם, נושאים למעקב, חיפושים אחרונים, תצוגת תוצאות.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings. */
(function (TVG) {
  TVG.files["search"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr, FAV = TVG.FAV;
  TVG.addRecent = addRecent;
  TVG.isTopic = isTopic;
  TVG.recentHtml = recentHtml;
  TVG.saveTopics = saveTopics;
  TVG.setSearch = setSearch;
  TVG.startSearch = startSearch;
  TVG.topicAirs = topicAirs;
  TVG.topicAlts = topicAlts;
  TVG.topicHit = topicHit;
  TVG.vSearch = vSearch;

  // ---- חיפוש בכל הלוח, השלמות אוטומטיות וניהול מועדפים ----
  function titleIndex() {
    var now = new Date();
    if (TVG.TI && now - TVG.TIt < 600000) return TVG.TI;
    var m = new Map();
    TVG.G.channels.forEach(function (c) {
      (TVG.by.get(c.id) || []).forEach(function (p) {
        if (p.e <= now) return;
        var e = m.get(p.title); if (!e) { e = { t: p.title, tl: p.title.toLowerCase(), chs: {} }; m.set(p.title, e); }
        e.chs[c.id] = (e.chs[c.id] || 0) + 1;
      });
    });
    TVG.TI = Array.from(m.values()); TVG.TIt = now; return TVG.TI;
  }
  function tokOk(tl, toks) { for (var i = 0; i < toks.length; i++) if (tl.indexOf(toks[i]) < 0) return false; return true; }
  // חיפוש חכם: קיצורים של קבוצות וערים ("מ. תא", "ת״א", "ב״ש") ומילים נרדפות לענפים
  function canon(x) {
    return (" " + String(x || "").toLowerCase().replace(/[״”“]/g, '"').replace(/[׳’]/g, "'").replace(/תל[-־]אביב/g, "תל אביב") + " ")
      .replace(/([\s\-–(])ת"?א(?=[\s\-–),.:])/g, "$1תל אביב")
      .replace(/([\s\-–(])ב"?ש(?=[\s\-–),.:])/g, "$1באר שבע").replace(/([\s\-–(])פ"ת(?=[\s\-–),.:])/g, "$1פתח תקווה").replace(/([\s\-–(])ק"ש(?=[\s\-–),.:])/g, "$1קריית שמונה")
      .replace(/([\s\-–(])מ\.\s?(?=\S)/g, "$1מכבי ").replace(/([\s\-–(])ה\.\s?(?=\S)/g, "$1הפועל ").replace(/([\s\-–(])ב\.\s?(?=\S)/g, '$1בית"ר ')
      .replace(/\s+/g, " ");
  }
  var SYN = { "כדורסל": ["כדורסל", "סל", "יורוליג", "יורוקאפ", "nba"], "כדורגל": ["כדורגל", "ליגת העל", "ליגה", "פרמייר", "ליגת האלופות", "גביע"], "טניס": ["טניס", "atp", "wta"] };
  function smartOk(hc, toks) {
    for (var i = 0; i < toks.length; i++) { var alts = SYN[toks[i]] || [toks[i]], ok = false; for (var j = 0; j < alts.length; j++) if (hc.indexOf(alts[j]) >= 0) { ok = true; break; } if (!ok) return false; }
    return true;
  }
  function pc(p) { if (p._c == null) p._c = canon(p.title + " " + (p.desc || "")); return p._c; }
  function suggestions(term) {
    var toks = term.toLowerCase().split(/\s+/).filter(Boolean); if (!toks.length) return [];
    var mine = TVG.scope === "mine" ? new Set(TVG.chans().map(function (c) { return c.id; })) : null, out = [];
    titleIndex().forEach(function (e) {
      if (!tokOk(e.tl, toks)) return;
      var n = 0, k = 0; Object.keys(e.chs).forEach(function (id) { if (!mine || mine.has(id)) { n += e.chs[id]; k++; } });
      if (n) out.push({ t: e.t, n: n, k: k, pre: e.tl.indexOf(toks[0]) === 0 ? 0 : 1 });
    });
    out.sort(function (a, b) { return a.pre - b.pre || b.n - a.n || a.t.length - b.t.length; });
    return out.slice(0, 6);
  }
  function starBtn(title) {
    var on = FAV.has(title);
    return '<button type="button" class="rbt star" data-fav="' + esc(title) + '" aria-pressed="' + on + '" aria-label="מועדף: ' + esc(title) + '">' + (on ? "★" : "☆") + "</button>";
  }
  // ---- נושאים למעקב: קבוצה, אדם, מילה - נמצאים בשם התוכנית או בתקציר ----
  TVG.TOPICS = []; try { TVG.TOPICS = JSON.parse(TVG.store("tvg.topics") || "[]") || []; } catch (e) { TVG.TOPICS = []; }
  function saveTopics() { TVG.store("tvg.topics", JSON.stringify(TVG.TOPICS)); }
  function isTopic(t) { return TVG.TOPICS.some(function (x) { return x.toLowerCase() === String(t).trim().toLowerCase(); }); }
  // וואלה מקצרת שמות קבוצות: "מכבי חיפה" מופיע גם כ"מ. חיפה", "הפועל באר שבע" כ"ה. באר שבע"
  function topicAlts(t) {
    t = String(t).trim().toLowerCase(); var a = [t], m;
    if ((m = t.match(/^מכבי\s+(.+)$/))) a.push("מ. " + m[1], "מ." + m[1]);
    if ((m = t.match(/^הפועל\s+(.+)$/))) a.push("ה. " + m[1], "ה." + m[1]);
    if ((m = t.match(/^בית"?ר\s+(.+)$/))) a.push("ב. " + m[1]);
    return a;
  }
  function topicHit(p, alts) { var h = (p.title + " " + (p.desc || "")).toLowerCase(), hc = pc(p); return alts.some(function (a) { return h.indexOf(a) >= 0 || hc.indexOf(canon(a).trim()) >= 0; }); }
  function topicAirs(t, limit) {
    var now = new Date(), alts = topicAlts(t), out = [];
    TVG.G.channels.forEach(function (c) { (TVG.by.get(c.id) || []).forEach(function (p) { if (p.e > now && topicHit(p, alts)) out.push({ c: c, p: p }); }); });
    out.sort(function (a, b) { return a.p.s - b.p.s; });
    return limit ? out.slice(0, limit) : out;
  }
  TVG.sWhen = "all";
  TVG.topicAdd = false;
  TVG.sKind = "all";
  TVG.LASTHITS = [];
  // שידור חוזר? סימון מפורש מהמקור (mako, HOT), סימון בשם/תקציר, או אותו פרק שכבר שודר קודם. זה ניחוש טוב, לא מידע רשמי.
  function epKey(p) { return String(p.title).replace(/\s*[-–:]\s*(עונה חדשה|פרק|ספיישל).*$/, "").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 14) + "|" + String(p.desc || "").replace(/[^\p{L}]/gu, "").slice(0, 40); }
  function stemOf(t) { return String(t).split(/\s+[-–:]\s+/)[0].replace(/[^\p{L}\p{N}]/gu, ""); }
  function markReruns(list) { // list: [{p}] ממוין לפי זמן
    var seen = {}, NEWRX = /עונה חדשה|פרק חדש|בכורה|חדש!/;
    // כשלסדרה יש שידור שמסומן במפורש כחדש (למשל "עונה חדשה: פרק 7"), כל השאר הם שידורים חוזרים
    var hasNew = {}; list.forEach(function (x) { if (NEWRX.test(x.p.title + " " + (x.p.desc || ""))) hasNew[stemOf(x.p.title)] = 1; });
    list.forEach(function (x) {
      var p = x.p, txt = p.title + " " + (p.desc || ""), k = p.desc ? epKey(p) : null;
      var isNew = /עונה חדשה|פרק חדש|בכורה|חדש!/.test(txt);
      var night = p.s.getHours() < 6; // סדרות בין חצות לשש בבוקר הן כמעט תמיד שידור חוזר
      if (p.lv === 1 || /^ישיר/.test(p.title)) { x.rr = false; x.lv = true; if (k && !seen[k]) seen[k] = p.s.getTime(); return; }
      if (p.lv === 0 && TVG.kindOf(x.c ? x.c.id : "", p.title) === "sport") { x.rr = true; return; } // ספורט שהאתר מסמן כלא-ישיר = מוקלט
      x.rr = !isNew && (p.rr || night || !!hasNew[stemOf(p.title)] || /ש\.ח|\(שח\)|שידור חוזר|מקוצר/.test(txt) || (k && seen[k] && seen[k] < p.s.getTime() - 30 * 60000));
      if (k && !seen[k]) seen[k] = p.s.getTime();
    });
  }
  // ---- חיפושים אחרונים ----
  TVG.RECENT = []; try { TVG.RECENT = JSON.parse(TVG.store("tvg.recent") || "[]") || []; } catch (e) { TVG.RECENT = []; }
  function addRecent(text, exact) {
    text = String(text || "").trim(); if (text.length < 2) return;
    TVG.RECENT = TVG.RECENT.filter(function (r) { return r.t !== text; }); TVG.RECENT.unshift({ t: text, x: !!exact }); TVG.RECENT = TVG.RECENT.slice(0, 8);
    TVG.store("tvg.recent", JSON.stringify(TVG.RECENT));
  }
  TVG.favPick = false;
  function favBanner() { return TVG.favPick ? '<div class="remall"><span>⭐ מוסיפים למועדפים: מקלידים שם ובוחרים</span><button type="button" class="ghost sm" data-favpickoff>ביטול</button></div>' : ""; }
  function tonightPicks() { // תוכניות שמשודרות הערב בערוצים שלי, לבחירה מהירה
    var now = new Date(), end = TVG.tonightEnd(), seen = {}, out = [];
    TVG.chans().forEach(function (c) { (TVG.by.get(c.id) || []).forEach(function (p) { if (p.s > now && p.s < end && !seen[p.title] && !FAV.has(p.title) && p.e - p.s >= 25 * 60000) { seen[p.title] = 1; out.push(p); } }); });
    out.sort(function (a, b) { return a.s - b.s; });
    return out.slice(0, 10);
  }
  function recentHtml() {
    if (TVG.favPick) {
      var tp = tonightPicks();
      return favBanner() + (tp.length ? '<h2 class="sech">משודר הערב בערוצים שלך</h2><div class="recent">' + tp.map(function (p) { return '<span class="rchip"><button type="button" data-favpick="' + esc(p.title) + '">☆ ' + esc(p.title) + "</button></span>"; }).join("") + "</div>" : "");
    }
    if (!TVG.RECENT.length) return '<p class="none">מקלידים שם של תוכנית, קבוצה או ערוץ. החיפושים האחרונים שלך יופיעו כאן.</p>';
    return '<div class="rech"><h2 class="sech">חיפושים אחרונים</h2><button type="button" class="ghost sm" data-recclear>ניקוי</button></div><div class="recent">' +
      TVG.RECENT.map(function (r, i) { return '<span class="rchip"><button type="button" data-recent="' + i + '">🕘 ' + esc(r.t) + '</button><button type="button" class="rx" data-recdel="' + i + '" aria-label="הסרה: ' + esc(r.t) + '">✕</button></span>'; }).join("") + "</div>";
  }
  function vSearch() {
    var now = new Date(), term = TVG.q.trim().toLowerCase(), toks = term.split(/\s+/).filter(Boolean), hits = [], alts = topicAlts(term);
    var ctoks = canon(term).trim().split(" ").filter(Boolean);
    var list = TVG.scope === "mine" ? TVG.chans() : TVG.G.channels, dEnd = new Date(now); dEnd.setHours(23, 59, 59, 999); var wEnd = now.getTime() + 7 * 864e5, tEnd = TVG.tonightEnd();
    list.forEach(function (c) {
      (TVG.by.get(c.id) || []).forEach(function (p) {
        if (p.e <= now) return;
        if (TVG.sWhen === "live" && p.s > now) return;
        if (TVG.sWhen === "today" && p.s >= tEnd) return;
        if (TVG.sWhen === "week" && p.s.getTime() >= wEnd) return;
        var hay = (p.title + " " + p.desc).toLowerCase();
        if (TVG.qExact ? p.title === TVG.qExact : (tokOk(hay, toks) || topicHit(p, alts.slice(1)) || smartOk(pc(p), ctoks))) hits.push({ c: c, p: p, viaDesc: !TVG.qExact && !tokOk(p.title.toLowerCase(), toks) });
      });
    });
    hits.sort(function (a, b) { return a.p.s - b.p.s; });
    // אותו שידור בשני ערוצים תאומים (SD/HD, או כאן וערוץ 1) - מציגים פעם אחת
    var twin = {}; hits = hits.filter(function (x) { var k = x.p.s.getTime() + "|" + String(x.p.title).replace(/[^\p{L}]/gu, "").slice(0, 8); if (twin[k]) return false; twin[k] = 1; return true; });
    var series = TVG.qExact || isTopic(TVG.q.trim());
    markReruns(hits);
    if (series) { var nNew = hits.filter(function (x) { return !x.rr; }).length, nRr = hits.length - nNew; if (TVG.sKind === "new") hits = hits.filter(function (x) { return !x.rr; }); else if (TVG.sKind === "rerun") hits = hits.filter(function (x) { return x.rr; }); }
    var h = favBanner() + '<div class="chips" role="group" aria-label="היקף חיפוש"><button type="button" class="chip" data-scope="all" aria-pressed="' + (TVG.scope === "all") + '">כל הלוח</button><button type="button" class="chip" data-scope="mine" aria-pressed="' + (TVG.scope === "mine") + '">הערוצים שלי</button>' +
      (TVG.qExact ? '<button type="button" class="chip xchip" data-clearx="1" aria-label="ביטול הבחירה">' + esc(TVG.qExact) + " ✕</button>" : "") + "</div>" +
      '<div class="chips" role="group" aria-label="מתי">' + [["all", "הכל"], ["live", "● משודר עכשיו"], ["today", "הערב"], ["week", "השבוע"]].map(function (w) { return '<button type="button" class="chip" data-when="' + w[0] + '" aria-pressed="' + (TVG.sWhen === w[0]) + '">' + w[1] + "</button>"; }).join("") + "</div>";
    if (!TVG.qExact && term.length >= 2 && !TVG.favPick) {
      var tt = TVG.q.trim(), fol = isTopic(tt);
      h += '<div class="remall follow"><span>' + (fol ? "✓ אתה עוקב אחרי \"" + esc(tt) + "\"" : "⭐ לעקוב אחרי \"" + esc(tt) + "\"? כל שידור שמזכיר את זה, בשם או בתקציר") + "</span>" +
        '<button type="button" class="' + (fol ? "ghost" : "btn") + ' sm" data-follow="' + esc(tt) + '">' + (fol ? "הפסק לעקוב" : "לעקוב") + "</button></div>";
    }
    if (!TVG.qExact) {
      var rmatch = TVG.RECENT.filter(function (r) { return r.t.toLowerCase().indexOf(term) === 0 && r.t.toLowerCase() !== term; }).slice(0, 3);
      if (rmatch.length) h += '<div class="recent">' + rmatch.map(function (r) { return '<span class="rchip"><button type="button" data-recent="' + TVG.RECENT.indexOf(r) + '">🕘 ' + esc(r.t) + "</button></span>"; }).join("") + "</div>";
      var sg = suggestions(term);
      if (sg.length) h += '<h2 class="sech">הצעות</h2>' + sg.map(function (x) {
        if (TVG.favPick) return '<div class="srow"><button type="button" class="go sg" data-favpick="' + esc(x.t) + '"><span class="ttl">' + esc(x.t) + '<br><span class="sub">' + x.n + " שידורים · " + x.k + (x.k === 1 ? " ערוץ" : " ערוצים") + '</span></span></button><button type="button" class="btn sm" data-favpick="' + esc(x.t) + '">' + (FAV.has(x.t) ? "★ כבר שם" : "☆ הוסף") + "</button></div>";
        return '<div class="srow"><button type="button" class="go sg" data-sug="' + esc(x.t) + '"><span class="ttl">' + esc(x.t) + '<br><span class="sub">' + x.n + " שידורים · " + x.k + (x.k === 1 ? " ערוץ" : " ערוצים") + "</span></span></button>" + starBtn(x.t) + "</div>";
      }).join("");
    }
    if (!hits.length) return h + '<p class="none">לא נמצאו שידורים עתידיים בשם הזה.</p>';
    if (series) h += '<div class="chips seg3" role="group" aria-label="סוג שידור">' + [["all", "הכל"], ["new", "✨ פרקים חדשים (" + nNew + ")"], ["rerun", "🔁 שידורים חוזרים (" + nRr + ")"]].map(function (w) { return '<button type="button" class="chip" data-kind="' + w[0] + '" aria-pressed="' + (TVG.sKind === w[0]) + '">' + w[1] + "</button>"; }).join("") + "</div>";
    if (series) {
      var todo = hits.filter(function (x) { return !TVG.hasRem(TVG.remKey(x.c.id, x.p.s)); }).length;
      var what = TVG.sKind === "new" ? "הפרקים החדשים" : TVG.sKind === "rerun" ? "השידורים החוזרים" : "השידורים";
      h += '<div class="remall"><span>' + (todo ? "⏰ להזכיר לך לפני " + (todo === 1 ? "השידור" : "כל " + todo + " " + what) + "?" : "✓ יש תזכורת לכל " + what) + "</span>" +
        (todo ? '<button type="button" class="btn sm" data-remlist>' + (TVG.srv() ? "כן, להזכיר" : "להקים תזכורות") + "</button>" : "") + "</div>";
    }
    TVG.LASTHITS = hits;
    // סדר: קודם מה שמשודר עכשיו, אחר כך שידורים ישירים וחדשים לפי שעה, ובסוף השידורים החוזרים
    var liveNow = function (x) { return x.p.s <= now && now < x.p.e; }, isLive = function (x) { return /ישיר|LIVE/i.test(x.p.title) || x.p.rr === 0 && /ישיר/.test(x.p.desc || ""); };
    var g1 = hits.filter(liveNow), gl = hits.filter(function (x) { return !liveNow(x) && x.lv; }), g2 = hits.filter(function (x) { return !liveNow(x) && !x.rr && !x.lv; }), g3 = hits.filter(function (x) { return !liveNow(x) && x.rr; });
    var row = function (x) {
      var v = x.c.id + "|" + x.p.s.getTime();
      var tag = liveNow(x) ? '<span class="tagk now">● עכשיו</span> ' : (x.lv || isLive(x)) ? '<span class="tagk live">ישיר</span> ' : x.rr ? '<span class="tagk rr">' + (TVG.kindOf(x.c.id, x.p.title) === "sport" ? "📼 מוקלט" : "🔁 חוזר") + "</span> " : (series ? '<span class="tagk nw">✨ חדש</span> ' : "");
      return '<div class="srow k-' + TVG.kindOf(x.c.id, x.p.title) + '"><button type="button" class="go" data-jump="' + esc(v) + '"><span class="time">' + hhmm(x.p.s) + '</span><span class="ttl">' + tag + esc(x.p.title) + (x.viaDesc ? '<br><span class="sub">' + esc(x.p.desc.length > 70 ? x.p.desc.slice(0, 68) + "…" : x.p.desc) + "</span>" : "") + '<br><span class="sub">' + esc(x.c.name) + " · " + TVG.dayLabel(dstr(x.p.s)) + "</span></span></button>" + starBtn(x.p.title) +
        TVG.synBtn(v) + '<button type="button" class="rbt' + (TVG.hasRem(v) ? " on" : "") + '" data-rem="' + esc(v) + '" aria-label="תזכורת: ' + esc(x.p.title) + '">' + (TVG.hasRem(v) ? "✓" : "⏰") + "</button></div>" + TVG.synBox(v, x.p, x.c.id);
    };
    var cap = 80;
    if (g1.length) h += '<h2 class="sech">● משודר עכשיו (' + g1.length + ")</h2>" + g1.slice(0, cap).map(row).join("");
    if (gl.length) h += '<h2 class="sech">📡 שידורים ישירים (' + gl.length + ")</h2>" + gl.slice(0, cap).map(row).join("");
    if (g2.length) h += '<h2 class="sech">' + (g1.length || gl.length ? "עוד בהמשך" : "שידורים קרובים") + " (" + g2.length + ")</h2>" + g2.slice(0, cap).map(row).join("");
    if (g3.length) h += '<h2 class="sech">🔁 חוזרים ומוקלטים (' + g3.length + ")</h2>" + g3.slice(0, cap).map(row).join("");
    return h;
  }
  function startSearch(text, exact) {
    TVG.closeFavs(); $("#qwrap").hidden = false; $("#qx").hidden = !text; $("#q").value = text || ""; TVG.q = text || ""; TVG.qExact = exact ? text : null;
    TVG.render(); if (!exact) $("#q").focus(); window.scrollTo({ top: 0 });
  }
  function setSearch(on) { if (!on) { TVG.favPick = false; TVG.topicAdd = false; TVG.sWhen = "all"; TVG.sKind = "all"; } $("#qwrap").hidden = !on; if (on) { $("#q").focus(); TVG.render(); } else { if (TVG.q) { $("#q").value = ""; TVG.q = ""; TVG.qExact = null; $("#qx").hidden = true; } TVG.render(); } }
})(window.TVG);
