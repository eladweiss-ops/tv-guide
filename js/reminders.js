/* js/reminders.js - תזכורות: מצב (מועדפים, REMS), סנכרון לשרת, יומן ICS, בניית כפתורי תזכורת/מועדף.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data. */
(function (TVG) {
  TVG.files["reminders"] = 1;
  var esc = TVG.esc;
  TVG.calUrl = calUrl;
  TVG.chName = chName;
  TVG.favBtn = favBtn;
  TVG.gcalUrl = gcalUrl;
  TVG.findProg = findProg;
  TVG.hasRem = hasRem;
  TVG.icsText = icsText;
  TVG.newTok = newTok;
  TVG.pullRems = pullRems;
  TVG.remBtn = remBtn;
  TVG.remCount = remCount;
  TVG.remKey = remKey;
  TVG.saveFav = saveFav;
  TVG.saveRems = saveRems;
  TVG.srv = srv;
  TVG.syncRems = syncRems;
  TVG.tonightEnd = tonightEnd;

  // תזכורת: קובץ יומן (.ics) עם התראה לפני תחילת התוכנית. אתר סטטי לא יכול לשלוח פוש כשהוא סגור, אבל יומן הטלפון יכול.
  TVG.lead = +(TVG.store("tvg.lead") || 10);
  TVG.rem = null;
  TVG.tapPending = false;
  TVG.tapAt = null;
  TVG.pillT = null;
  var FAV = new Set();
  TVG.FAV = FAV; try { JSON.parse(TVG.store("tvg.fav") || "[]").forEach(function (t) { FAV.add(t); }); } catch (e) {}
  function saveFav() { TVG.store("tvg.fav", JSON.stringify(Array.from(FAV))); }
  // ---- התזכורות שלי: רשימת התזכורות שנוספו ליומן, כדי למנוע כפילויות ולאפשר ביטול ----
  TVG.REMS = []; try { TVG.REMS = JSON.parse(TVG.store("tvg.rem") || "[]") || []; } catch (e) { TVG.REMS = []; }
  function saveRems() {
    var cut = Date.now() - 2 * 3600000; TVG.REMS = TVG.REMS.filter(function (x) { return x.end > cut; }); // שידורים שהסתיימו יורדים מהרשימה
    TVG.REMS.sort(function (a, b) { return a.ts - b.ts; }); TVG.store("tvg.rem", JSON.stringify(TVG.REMS));
  }
  saveRems();
  function remKey(id, s) { return id + "|" + (s.getTime ? s.getTime() : s); }
  function hasRem(k) { return TVG.REMS.filter(function (x) { return x.k === k; })[0] || null; }
  // "הערב" נגמר ב-04:00 בבוקר: אחרי חצות זה עדיין אותו ערב
  function tonightEnd() { var d = new Date(); if (d.getHours() >= 4) d.setDate(d.getDate() + 1); d.setHours(4, 0, 0, 0); return d.getTime(); }
  function remCount() { var now = Date.now(), end = tonightEnd(); return TVG.REMS.filter(function (x) { return x.ts > now && x.ts < end; }).length; }
  // ---- יומן ייעודי "לוח שידורים" (יומן מנוי). השרת שומר את הרשימה ומגיש אותה כיומן ----
  var CAL_API = "https://tv-guide-cal.vercel.app";
  TVG.CAL_API = CAL_API;
  TVG.calMode = TVG.store("tvg.calmode") || "";
  // באנדרואיד אי אפשר להירשם ליומן מנוי (webcal). גיבוי שהגיע מאייפון מנורמל ליומן רגיל; התזכורות ממשיכות להסתנכרן כל עוד פוש פעיל
  var calNorm = false;
  if (TVG.isAndroid && TVG.calMode === "sub") { TVG.calMode = "ics"; TVG.store("tvg.calmode", "ics"); calNorm = true; }
  TVG.calTok = TVG.store("tvg.calTok") || "";
  TVG.syncBad = TVG.store("tvg.remDirty") === "1";
  function newTok() { var a = new Uint8Array(20); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (v, i) { a[i] = Math.random() * 256; }); return Array.from(a).map(function (b) { return (b % 36).toString(36); }).join("") + Date.now().toString(36); }
  function calUrl() { return CAL_API.replace(/^https?:/, "webcal:") + "/cal/" + TVG.calTok + ".ics"; }
  TVG.pushOn = TVG.store("tvg.push") === "1";
  if (calNorm && TVG.pushOn) setTimeout(function () { TVG.syncRems(); }, 0);
  function srv() { return TVG.calMode === "sub" || TVG.pushOn; } // התזכורות נשמרות בשרת (יומן מנוי או התראות פוש)
  function syncRems() {
    if (!srv() || !TVG.calTok) return Promise.resolve(true);
    return fetch(CAL_API + "/api/rems", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: TVG.calTok, rems: TVG.REMS }) })
      .then(function (r) {
        if (r.status === 429) { var e = new Error("rate"); e.retry = Math.min(120, Math.max(5, +r.headers.get("retry-after") || 60)); throw e; } // קצב: ניסיון חוזר שקט
        if (r.status === 413) { var e2 = new Error("big"); e2.big = true; throw e2; } // הרשימה גדולה מדי: ניסיון חוזר לא יעזור
        if (!r.ok) throw 0;
        TVG.syncBad = false; TVG.store("tvg.remDirty", "0"); return true;
      })
      .catch(function (e) {
        TVG.syncBad = true; TVG.store("tvg.remDirty", "1");
        if (e && e.retry && !syncRetry) { syncRetry = setTimeout(function () { syncRetry = 0; syncRems(); }, e.retry * 1000); }
        else if (e && e.big && TVG.pill) TVG.pill("רשימת התזכורות גדולה מדי לסנכרון עם השרת. מחקו תזכורות ישנות", 4000);
        return false;
      });
  }
  var syncRetry = 0;
  function pullRems() { // שחזור הרשימה מהשרת (למשל אחרי התקנה מחדש וקוד גיבוי)
    if (!srv() || !TVG.calTok || TVG.REMS.length) return;
    fetch(CAL_API + "/api/rems?t=" + TVG.calTok, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && Array.isArray(j.rems) && j.rems.length && !TVG.REMS.length) { TVG.REMS = j.rems; saveRems(); if (TVG.G) TVG.render(); }
    }).catch(function () {});
  }
  function remBtn(p, cid, small) {
    if (!cid || p.s <= new Date()) return "";
    var on = !!hasRem(remKey(cid, p.s));
    return '<button type="button" class="btn rem' + (small ? " sm" : "") + (on ? " on" : "") + '" data-rem="' + esc(cid) + "|" + p.s.getTime() + '"' + (small ? ' aria-label="' + (on ? "יש תזכורת" : "תזכיר לי (התראה ביומן)") + '">' + (on ? "✓" : "⏰") : ">" + (on ? "✓ יש תזכורת ביומן" : "⏰ תזכיר לי (התראה ביומן)")) + "</button>";
  }
  function favBtn(p) {
    var on = FAV.has(p.title);
    return '<button type="button" class="ghost fav" data-fav="' + esc(p.title) + '" aria-pressed="' + on + '">' + (on ? "★ במועדפים" : "☆ הוסף למועדפים") + "</button>";
  }
  function icsEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;"); }
  function icsT(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
  function findProg(v) {
    var k = v.lastIndexOf("|"), id = v.slice(0, k), ts = +v.slice(k + 1);
    var p = (TVG.by.get(id) || []).filter(function (x) { return x.s.getTime() === ts; })[0];
    return p ? { id: id, p: p } : null;
  }
  // קישור "הוספה ליומן Google" (באנדרואיד webcal/‏.ics לא עובדים). אי אפשר להעביר דרכו שעת התראה מדויקת
  function gcalUrl(r) {
    try {
      var p = r.p, ch = chName(r.id), ttl = p.title + (ch ? " (" + ch + ")" : ""), desc = Array.from(p.desc || "").slice(0, 300).join("");
      return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(ttl) + "&dates=" + icsT(p.s) + "/" + icsT(p.e) + "&details=" + encodeURIComponent(desc);
    } catch (e) { return "https://calendar.google.com/calendar"; }
  }
  function chName(id) { return (TVG.G.channels.filter(function (c) { return c.id === id; })[0] || {}).name || ""; }
  function icsText(r, cancel) {
    var p = r.p, ch = chName(r.id), ttl = p.title + (ch ? " (" + ch + ")" : "");
    if (cancel) return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tv-guide//HE", "METHOD:CANCEL", "BEGIN:VEVENT",
      "UID:" + r.id + "-" + p.s.getTime() + "@tv-guide", "SEQUENCE:1", "STATUS:CANCELLED", "DTSTAMP:" + icsT(new Date()), "DTSTART:" + icsT(p.s), "DTEND:" + icsT(p.e),
      "SUMMARY:" + icsEsc("בוטל: " + ttl), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tv-guide//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      "UID:" + r.id + "-" + p.s.getTime() + "@tv-guide", "SEQUENCE:0", "DTSTAMP:" + icsT(new Date()), "DTSTART:" + icsT(p.s), "DTEND:" + icsT(p.e),
      "SUMMARY:" + icsEsc(ttl), "DESCRIPTION:" + icsEsc((p.desc || "").slice(0, 300)),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(ttl), "TRIGGER:-PT" + (r.lead != null ? r.lead : TVG.lead) + "M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  }
})(window.TVG);
