/* js/render-rems.js - מסך 'תזכורות'.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push. */
(function (TVG) {
  TVG.files["render-rems"] = 1;
  var esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.vRems = vRems;
  TVG.missX = missX;

  TVG.askK = null;
  TVG.askT = null;
  TVG.prevTab = null;
  function vRems() {
    var now = Date.now(), up = TVG.REMS.filter(function (x) { return x.end > now; });
    var pbtn = '<button type="button" class="btn pbtn" data-personal>➕ תזכורת אישית</button>';
    var fh = TVG.folRows ? TVG.folRows() : ""; // 📺 סדרות במעקב: שורה אחת לכל סדרה (series.js)
    var mh = missHtml(now); // 😅 פספסת? מתחת לתזכורות הקרובות
    if (!up.length && fh) return TVG.statusCards() + pbtn + fh + mh; // יש מעקב אחרי סדרות: לא כותבים "אין תזכורות פעילות" (הן נגזרות בשרת ולא ברשימה הזו)
    if (!up.length) return TVG.statusCards() + pbtn + '<h2 class="sech">התזכורות שלי</h2><p class="none">אין תזכורות פעילות. לחיצה על ⏰ ליד תוכנית מוסיפה תזכורת ליומן, והיא תופיע כאן.</p>' + mh;
    var h = TVG.statusCards() + pbtn + (TVG.srv() ? "" : '<p class="remnote">ביטול מוריד את התזכורת מכאן ופותח ביומן קובץ ביטול; אם האירוע נשאר ביומן, מוחקים אותו שם.</p>') + fh, last = "";
    up.forEach(function (x) {
      var d = new Date(x.ts), dl = TVG.dayLabel(dstr(d));
      if (dl !== last) { h += '<h2 class="sech">' + dl + "</h2>"; last = dl; }
      var live = x.ts <= now;
      var fp = TVG.findProg(x.k), ds = (fp && fp.p.desc) || x.desc || "";
      var nfl = /^nf\|/.test(x.k) ? (ds.match(/https:\/\/www\.(?:netflix|disneyplus)\.com\/[^\s"<>]+/) || [])[0] : ""; // תזכורת צפייה בנטפליקס/דיסני+: קישור במקום כתובת גולמית
      var syn = nfl ? '<div class="rsyn"><a class="nfrl" href="' + esc(nfl) + '" target="_blank" rel="noopener">▶ פתיחה ב' + (/disneyplus/.test(nfl) ? "דיסני+" : "נטפליקס") + '</a></div>' : ds ?'<div class="rsyn"><p class="rclamp">' + esc(ds) + "</p>" + (ds.length > 90 ? '<button type="button" class="moreb" data-more data-l="הרחב">הרחב…</button>' : "") + "</div>" : "";
      h += '<div class="srow"><button type="button" class="go" data-jump="' + esc(x.k) + '"><span class="time">' + hhmm(d) + '</span><span class="ttl">' + esc(x.title) + '<br><span class="sub"><bdi>' + esc(x.ch) + "</bdi> · <bdi>" + (live ? (x.id ? "משודר עכשיו" : "עכשיו") : "🔔 " + esc(!x.id && !x.lead ? "בזמן" : TVG.leadTxt(x.lead, x.ts))) + "</bdi></span></span></button>" + syn +
        (live ? "</div>" : TVG.askK === x.k
          ? '</div><div class="confirm"><span>לבטל את התזכורת?</span><button type="button" class="btn sm danger" data-remcancel="' + esc(x.k) + '">כן, לבטל</button><button type="button" class="ghost sm" data-remkeep>להשאיר</button></div>'
          : '<span class="rbts">' + (TVG.srv() ? '<button type="button" class="rbt" data-ledit="' + esc(x.k) + '" aria-label="שינוי מועד ההתראה: ' + esc(x.title) + '">🔔</button>' : "") + '<button type="button" class="rbt" data-remask="' + esc(x.k) + '" aria-label="ביטול התזכורת: ' + esc(x.title) + '">✕</button></span></div>');
    });
    return h + mh;
  }

  // ---- 😅 פספסת? תזכורות לתוכניות ששודרו ב-3 הימים האחרונים, עם השידור החוזר הקרוב (7 ימים) ----
  // reminders.js מוריד תזכורת מהרשימה שעתיים אחרי סוף השידור (וגם בעלייה), ולכן שומרים עותק משלנו: tvg.miss = [{k,id,ts,end,title,ch,desc,x}]
  // (x=1: הוסר בידי המשתמש). רק תזכורות לתוכנית בלוח (ערוץ|זמן): לא נטפליקס (nf|), ערב צפייה (w|) או תזכורת אישית (p|). אנחנו לא יודעים אם צפית, ולכן הניסוח רך.
  var MISS_MS = 3 * 864e5, WEEK = 7 * 864e5, MISS_SHOW = 3;
  TVG.missOpen = false;
  function progKey(k) { return /^[^|]+\|\d+$/.test(String(k || "")); }
  function missLoad() { try { var a = JSON.parse(TVG.store("tvg.miss") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function missSync() {
    var now = Date.now(), cut = now - MISS_MS, live = {}, seen = {}, out = [], ch = false;
    TVG.REMS.forEach(function (x) { if (progKey(x.k)) live[x.k] = x; });
    missLoad().forEach(function (m) {
      if (!m || !m.k || seen[m.k] || !(m.ts >= cut) || (m.end > now && !live[m.k])) { ch = true; return; } // ישן, כפול, או בוטל לפני סוף השידור
      seen[m.k] = 1; out.push(m);
    });
    Object.keys(live).forEach(function (k) {
      var x = live[k]; if (seen[k] || !(x.ts >= cut)) return;
      out.push({ k: x.k, id: x.id, ts: x.ts, end: x.end, title: x.title, ch: x.ch, desc: String(x.desc || "").slice(0, 120) }); ch = true;
    });
    if (ch) TVG.store("tvg.miss", JSON.stringify(out));
    return out;
  }
  var save0 = TVG.saveRems; // לפני שהרשימה מנוקה משידורים שנגמרו: מעתיקים אותם
  TVG.saveRems = function () { missSync(); return save0.apply(this, arguments); };
  missSync();
  function missX(k, on) {
    var a = missSync(); a.forEach(function (m) { if (m.k === k) { if (on) m.x = 1; else delete m.x; } });
    TVG.store("tvg.miss", JSON.stringify(a));
  }
  function nrm(s) { return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
  function dsig(s) { return String(s || "").replace(/[^\p{L}]/gu, "").slice(0, 40); }
  function pn(p) { if (p._mn == null) p._mn = nrm(p.title); return p._mn; }
  function pf(p) { if (p._mf == null) p._mf = TVG.folKey ? TVG.folKey(p.title) : ""; return p._mf; }
  // השידור הבא: אותו פרק (שם זהה, ותקציר זהה כשיש לשניהם) קודם בערוצים שלי ואז בכל הערוצים; אחר כך פרק אחר של אותה סדרה. כותרת כללית ("חדשות", "NBA") רק עם תקציר זהה.
  // שידור בלילה (02:00-06:59) רק כשאין אחר
  var RC = { g: null, at: 0, m: {} };
  function rerunOf(m, now) {
    if (RC.g !== TVG.G || now - RC.at > 60000) RC = { g: TVG.G, at: now, m: {} };
    if (m.k in RC.m) return RC.m[m.k];
    var t = nrm(m.title), d = dsig(m.desc), fk = TVG.folKey ? TVG.folKey(m.title) : "", gen = TVG.folGeneric ? TVG.folGeneric(m.title) : false, lim = now + WEEK, mine = {}, best = [];
    TVG.chans().forEach(function (c) { mine[c.id] = 1; });
    if (t) TVG.by.forEach(function (arr, id) {
      for (var i = 0; i < arr.length; i++) {
        var p = arr[i], ps = p.s.getTime(), r; if (ps <= now || ps > lim) continue;
        if (pn(p) === t) { var pd = dsig(p.desc), same = d && pd && pd === d; r = gen ? (same ? 0 : -1) : (!d || !pd || same ? 0 : 2); }
        else r = !gen && fk.length >= 2 && pf(p) === fk ? 2 : -1;
        if (r < 0) continue;
        r += (mine[id] ? 0 : 1) + (p.s.getHours() >= 2 && p.s.getHours() < 7 ? 4 : 0);
        if (!best[r] || ps < best[r].p.s.getTime()) best[r] = { id: id, p: p, same: r % 4 < 2 };
      }
    });
    for (var b = 0; b < 8 && !best[b]; b++);
    return (RC.m[m.k] = best[b] || null);
  }
  function whenTxt(d, now) {
    var n = new Date(now), y = new Date(n), tm = new Date(n), s = dstr(d); y.setDate(y.getDate() - 1); tm.setDate(tm.getDate() + 1);
    return (s === dstr(n) ? "היום" : s === dstr(y) ? "אתמול" : s === dstr(tm) ? "מחר" : "ביום " + TVG.DAYS[d.getDay()]) + " ב-" + hhmm(d);
  }
  function missHtml(now) {
    if (!TVG.by || !TVG.by.size) return "";
    var upT = {}, seenT = {}, rows = [];
    TVG.REMS.forEach(function (x) { if (x.ts > now) upT[nrm(x.title)] = 1; }); // כבר יש תזכורת קרובה לאותה תוכנית: אין מה להציע
    missSync().filter(function (m) { return !m.x && m.end <= now; }).sort(function (a, b) { return b.ts - a.ts; }).forEach(function (m) {
      var t = nrm(m.title); if (!t || upT[t] || seenT[t]) return; seenT[t] = 1; // אותה תוכנית פעמיים: רק האחרונה
      rows.push({ m: m, r: rerunOf(m, now) });
    });
    if (!rows.length) return "";
    var h = "";
    rows.forEach(function (x, i) {
      if (i === MISS_SHOW) h += '<div class="missrest"' + (TVG.missOpen ? "" : " hidden") + ">";
      var m = x.m, r = x.r, v = r ? TVG.remKey(r.id, r.p.s) : "", on = r && !!TVG.hasRem(v);
      var mch = TVG.chNice(TVG.chName(m.id) || m.ch), rch = r ? TVG.chNice(TVG.chName(r.id)) : "";
      var aired = '<span class="sub"><span>' + whenTxt(new Date(m.ts), now) + "</span><span>·</span><bdi>" + esc(mch) + "</bdi></span>";
      var nxt = r ? '<span class="mnext">' + "<span>" + (r.same ? "🔁 שוב " : "📺 פרק נוסף ") + whenTxt(r.p.s, now) + "</span>" + (rch === mch ? "" : "<span>·</span><bdi>" + esc(rch) + "</bdi>") + "</span>" : '<span class="mnext none">אין שידור חוזר בשבוע הקרוב</span>';
      var body = '<span class="ttl"><bdi>' + esc(m.title) + "</bdi></span>" + aired + nxt;
      h += '<div class="srow missrow">' + (r ? '<button type="button" class="go" data-jump="' + esc(v) + '">' + body + "</button>" : '<div class="go">' + body + "</div>") +
        '<span class="rbts">' + (r ? '<button type="button" class="rbt' + (on ? " on" : "") + '" data-rem="' + esc(v) + '" aria-label="' + (on ? "יש תזכורת לשידור החוזר: " : "תזכורת לשידור החוזר: ") + esc(m.title) + '">' + (on ? "✓" : "⏰") + "</button>" : "") +
        '<button type="button" class="missx" data-missx="' + esc(m.k) + '" aria-label="הסרה מהרשימה: ' + esc(m.title) + '">✕</button></span></div>';
    });
    if (rows.length > MISS_SHOW) h += "</div>" + (TVG.missOpen ? "" : '<button type="button" class="linkb missmore" data-missmore>עוד ' + (rows.length - MISS_SHOW) + " ›</button>");
    return '<section class="miss" aria-label="פספסת?"><h2 class="sech">😅 פספסת?</h2><div class="misslist">' + h + "</div></section>";
  }
})(window.TVG);
