/* js/reminder-sheet.js - חלון התזכורת: בורר זמן התראה, פתיחה/ביטול/הוספה מהירה, הרשמה ליומן.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui. */
(function (TVG) {
  TVG.files["reminder-sheet"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.askCal = askCal;
  TVG.calWelcome = calWelcome;
  TVG.calAdd = calAdd;
  TVG.cancelRem = cancelRem;
  TVG.closeRem = closeRem;
  TVG.downloadIcs = downloadIcs;
  TVG.fitLead = fitLead;
  TVG.leadTxt = leadTxt;
  TVG.localVal = localVal;
  TVG.openLead = openLead;
  TVG.openRem = openRem;
  TVG.quickAdd = quickAdd;
  TVG.saveIcs = saveIcs;
  TVG.setLead = setLead;
  TVG.setupCal = setupCal;
  TVG.useIcs = useIcs;

  // ---- בחירת מועד ההתראה ----
  var LEAD_MAIN = [10, 30, 60];
  var LEAD_MORE = [0, 5, 15, 45, 120, 180, 1440];
  function leadName(m) {
    if (!m) return "בתחילת השידור";
    if (m < 60) return m + " דק׳ לפני";
    if (m === 60) return "שעה לפני"; if (m === 120) return "שעתיים לפני";
    if (m === 1440) return "יום לפני";
    if (m % 60 === 0 && m < 1440) return m / 60 + " שעות לפני";
    return "";
  }
  function shortLead(m) { return m === 0 ? "בהתחלה" : m === 1440 ? "יום לפני" : leadName(m).replace(" לפני", ""); }
  function isStdLead(m) { return LEAD_MAIN.indexOf(m) >= 0 || LEAD_MORE.indexOf(m) >= 0; }
  function leadTxt(m, ts) { // "10 דק׳ לפני", או לשעה מסוימת: "ב־19:45" / "ב־ראשון 19:45"
    if (isStdLead(m) && leadName(m)) return leadName(m);
    var a = new Date(ts - m * 60000), same = dstr(a) === dstr(new Date(ts));
    return "ב־" + (same ? "" : TVG.dayLabel(dstr(a)) + " ") + hhmm(a);
  }
  function okLead(ts, m) { return ts - m * 60000 > Date.now() + 30000; }
  // התוכנית מתחילה בקרוב מהזמן שנבחר: ההתראה תקפוץ בעוד כדקה
  function soonLead(ts) { return Math.max(0, Math.floor((ts - Date.now() - 60000) / 60000)); }
  function fitLead(ts, m) { return okLead(ts, m) ? m : soonLead(ts); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function localVal(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  TVG.LP = null; // {keys:[...]} לעריכת תזכורות קיימות, או null לתזכורת חדשה (rem)
  function leadPicker(ts, cur, allowCustom) {
    var custom = !isStdLead(cur) && allowCustom;
    var h = '<div class="lbl">מתי להזכיר?</div><div class="chips lp" role="group">' + LEAD_MAIN.filter(function (m) { return okLead(ts, m); }).map(function (m) {
      return '<button type="button" class="chip" data-lp="' + m + '" aria-pressed="' + (cur === m) + '">' + leadName(m).replace(" לפני", "") + "</button>";
    }).join("");
    var sl = soonLead(ts);
    if (sl > 0 && !okLead(ts, 10)) h += '<button type="button" class="chip" data-lp="' + sl + '" aria-pressed="' + (cur === sl) + '">בעוד דקה</button>';
    var more = LEAD_MORE.filter(function (m) { return okLead(ts, m); }), inMore = more.indexOf(cur) >= 0;
    h += '<label class="lpsel' + (inMore || custom ? " on" : "") + '"><select data-lpsel aria-label="עוד אפשרויות">' +
      '<option value=""' + (!inMore && !custom ? " selected" : "") + ">עוד</option>" +
      more.map(function (m) { return '<option value="' + m + '"' + (cur === m ? " selected" : "") + ">" + shortLead(m) + "</option>"; }).join("") +
      (allowCustom ? '<option value="custom"' + (custom ? " selected" : "") + ">🕒 אחר…</option>" : "") + "</select></label></div>";
    if (allowCustom) {
      var now = new Date(Date.now() + 60000), max = new Date(ts - 60000), val = new Date(ts - (cur || 0) * 60000);
      if (val > max) val = max; if (val < now) val = now;
      h += '<div class="lpcustom" data-lpbox' + (custom ? "" : " hidden") + '><input type="datetime-local" data-lpdt min="' + localVal(now) + '" max="' + localVal(max) + '" value="' + localVal(val) + '" aria-label="מועד ההתראה">' +
        '<button type="button" class="btn sm" data-lpset>קביעה</button></div>';
    }
    if (TVG.calMode === "sub" && !TVG.pushOn && ts - Date.now() < 25 * 60000) h += '<p class="credit">⚠️ היומן המנוי מתעדכן בערך כל רבע שעה, אז התראה לתוכנית שמתחילה בקרוב עלולה להגיע באיחור.</p>';
    h += '<p class="credit lpnow">⏰ ההתראה: ' + esc(leadTxt(cur, ts)) + " · " + (function () { var a = new Date(ts - cur * 60000); return TVG.dayLabel(dstr(a)) + " " + hhmm(a); })() + "</p>";
    return h;
  }
  function setLead(m) {
    if (TVG.LP) {
      var n = 0;
      TVG.REMS.forEach(function (x) { if (TVG.LP.keys.indexOf(x.k) >= 0 && x.ts > Date.now()) { x.lead = TVG.LP.keys.length > 1 ? fitLead(x.ts, m) : m; n++; } });
      if (!n) { TVG.pill("השעה הזו כבר עברה", 1600); return; }
      TVG.saveRems(); TVG.syncRems(); openLead(TVG.LP.keys); TVG.render();
      TVG.pill("⏰ ההתראה עודכנה", 1300);
      return;
    }
    if (!TVG.rem) return;
    if (!okLead(TVG.rem.p.s.getTime(), m)) { TVG.pill("השעה הזו כבר עברה", 1600); return; }
    TVG.rem.lead = m; if (isStdLead(m)) { TVG.lead = m; TVG.store("tvg.lead", String(m)); }
    openRem(TVG.rem);
  }
  function openLead(keys) { // שינוי מועד ההתראה לתזכורות שכבר נוספו
    var xs = TVG.REMS.filter(function (x) { return keys.indexOf(x.k) >= 0 && x.ts > Date.now(); });
    if (!xs.length) return;
    TVG.LP = { keys: keys }; TVG.rem = null;
    var x = xs[0], one = xs.length === 1;
    $("#remBody").innerHTML = "<h2>" + esc(one ? x.title : xs.length + " תזכורות") + "</h2>" +
      (one ? '<div class="meta"><span>' + esc(x.ch) + "</span><span>" + TVG.dayLabel(dstr(new Date(x.ts))) + "</span><span>" + hhmm(new Date(x.ts)) + "</span></div>" : '<p class="remnote">הבחירה תחול על כולן.</p>') +
      leadPicker(x.ts, x.lead, one) +
      '<button type="button" class="btn" data-remclose>סיום</button>' +
      (TVG.srv() ? '<p class="credit">השינוי יגיע ליומן "לוח שידורים" בעדכון הבא שלו.</p>' : "");
    $("#rem").hidden = false; $("#scrim2").hidden = false;
  }
  function openRem(r) {
    TVG.rem = r; TVG.LP = null;
    if (r.lead == null) r.lead = fitLead(r.p.s.getTime(), TVG.lead);
    var ex = TVG.hasRem(TVG.remKey(r.id, r.p.s));
    if (ex) {
      $("#remBody").innerHTML = "<h2>" + esc(r.p.title) + '</h2><div class="meta"><span>' + esc(TVG.chName(r.id)) + "</span><span>" + TVG.dayLabel(dstr(r.p.s)) + "</span><span>" + hhmm(r.p.s) + "</span></div>" +
        '<p class="remnote">✓ כבר יש תזכורת ביומן לתוכנית הזו, ' + esc(leadTxt(ex.lead, ex.ts)) + ".</p>" +
        (TVG.srv() ? '<button type="button" class="ghost" data-ledit="' + esc(ex.k) + '">🔔 שינוי מועד ההתראה</button>' : "") +
        '<button type="button" class="btn" data-remcancel="' + esc(ex.k) + '">ביטול התזכורת</button><button type="button" class="ghost" data-remclose>סגירה</button>' +
        '<p class="credit">' + (TVG.srv() ? "הביטול ימחק את האירוע מיומן \"לוח שידורים\" בעדכון הבא שלו." : TVG.isAndroid ? "הביטול מוריד את התזכורת מהרשימה. אם האירוע נוסף ל-Google Calendar, מוחקים אותו שם." : "הביטול מוריד את התזכורת מהרשימה ופותח ביומן קובץ ביטול. אם האירוע עדיין מופיע ביומן, מוחקים אותו שם.") + "</p>";
      $("#rem").hidden = false; $("#scrim2").hidden = false; return;
    }
    $("#remBody").innerHTML = "<h2>" + esc(r.p.title) + '</h2><div class="meta"><span>' + esc(TVG.chName(r.id)) + "</span><span>" + TVG.dayLabel(dstr(r.p.s)) + "</span><span>" + hhmm(r.p.s) + "</span></div>" +
      leadPicker(r.p.s.getTime(), r.lead, true) +
      '<button type="button" class="btn" data-ics>' + (TVG.pushOn ? "⏰ הוספת תזכורת" : TVG.isAndroid ? "📅 הוספה ל-Google Calendar" : "הוספה ליומן עם תזכורת") + '</button><button type="button" class="ghost" data-remclose>סגירה</button>' +
      (TVG.srv() ? "" : TVG.isAndroid ? '<p class="credit">ייפתח Google Calendar עם האירוע מוכן לשמירה. ההתראה שם לפי ברירת המחדל של היומן, לא בדיוק למועד שבחרת.</p>' : '<p class="credit">הקובץ נפתח ביומן של הטלפון, וההתראה תופיע בזמן שבחרת.</p>');
    $("#rem").hidden = false; $("#scrim2").hidden = false;
  }
  function closeRem() { $("#rem").hidden = true; $("#scrim2").hidden = true; TVG.rem = null; TVG.LP = null; }
  function saveIcs(text, name) {
    var url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
    var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
  // הוספה ליומן הרגיל: באייפון קובץ .ics שנפתח ביומן, באנדרואיד קישור ל-Google Calendar (קובץ .ics שם רק יורד)
  function calAdd(r) {
    if (!TVG.isAndroid) { saveIcs(TVG.icsText(r), "reminder.ics"); return; }
    var w = null; try { w = window.open(TVG.gcalUrl(r), "_blank", "noopener"); } catch (e) {}
    if (!w) location.href = TVG.gcalUrl(r);
  }
  function downloadIcs() {
    if (!TVG.rem) return;
    var k = TVG.remKey(TVG.rem.id, TVG.rem.p.s);
    if (TVG.hasRem(k)) { openRem(TVG.rem); return; } // לא מוסיפים פעמיים
    if (!TVG.calMode && !TVG.pushOn) { askCal(); return; }
    TVG.REMS.push(recOf(TVG.rem));
    TVG.saveRems();
    if (TVG.srv()) { TVG.syncRems().then(function (ok) { TVG.pill(TVG.pushOn ? "⏰ נזכיר לך " + leadTxt(TVG.REMS[TVG.REMS.length - 1].lead, TVG.REMS[TVG.REMS.length - 1].ts) : ok ? "נוסף ליומן 'לוח שידורים'" : "נשמר. היומן יתעדכן כשיהיה חיבור", 1800); }); }
    else { calAdd(TVG.rem); TVG.pill(TVG.isAndroid ? "נפתח Google Calendar. לוחצים שם ״שמירה״" : "נוסף ליומן", TVG.isAndroid ? 3500 : 1600); }
    closeRem(); TVG.render();
  }
  function cancelRem(k) {
    var x = TVG.hasRem(k); if (!x) return;
    TVG.REMS = TVG.REMS.filter(function (y) { return y.k !== k; }); TVG.saveRems();
    if (TVG.srv()) { TVG.syncRems(); TVG.pill("התזכורת בוטלה", 3500, "החזר", function () { if (!TVG.hasRem(x.k)) { TVG.REMS.push(x); TVG.saveRems(); TVG.syncRems(); TVG.render(); TVG.pill("הוחזרה ✓", 1200); } }); }
    else if (TVG.isAndroid) TVG.pill("התזכורת בוטלה. אם נוספה ל-Google Calendar, מוחקים אותה שם", 4000);
    else { var p = { title: x.title, s: new Date(x.ts), e: new Date(x.end), desc: "" }; saveIcs(TVG.icsText({ id: x.id, p: p }, true), "cancel-reminder.ics"); TVG.pill("התזכורת בוטלה", 1800); }
    closeRem(); TVG.render();
  }
  function recOf(r) { var ts = r.p.s.getTime(), m = fitLead(ts, r.lead != null ? r.lead : TVG.lead); return { k: TVG.remKey(r.id, r.p.s), id: r.id, ts: ts, end: r.p.e.getTime(), title: r.p.title, ch: TVG.chName(r.id), desc: (r.p.desc || "").slice(0, 300), lead: m, at: Date.now() }; }
  // הוספה בלחיצה אחת כשיש יומן ייעודי, עם "ביטול" בהודעה למקרה של טעות
  function quickAdd(list) {
    var add = list.filter(function (r) { return r.p.s > new Date() && !TVG.hasRem(TVG.remKey(r.id, r.p.s)); }).map(recOf);
    if (!add.length) { TVG.pill(list.some(function (r) { return r.p.s > new Date(); }) ? "כבר יש תזכורת לכל אלה ✓" : "התוכנית כבר התחילה", 1500); return; }
    TVG.REMS = TVG.REMS.concat(add); TVG.saveRems(); TVG.syncRems(); TVG.render();
    var ks = add.map(function (x) { return x.k; });
    TVG.pill(add.length === 1 ? "⏰ נזכיר לך " + leadTxt(add[0].lead, add[0].ts) : "⏰ נוספו " + add.length + " תזכורות", 5000, "ביטול", function () {
      TVG.REMS = TVG.REMS.filter(function (x) { return ks.indexOf(x.k) < 0; }); TVG.saveRems(); TVG.syncRems(); TVG.render(); TVG.pill("בוטל", 1200);
    }, "🔔 שינוי", function () { openLead(ks); });
  }
  function askCal() {
    if (TVG.isAndroid) { // באנדרואיד אין יומן מנוי: התראות פוש קודם, Google Calendar כגיבוי
      $("#remBody").innerHTML = TVG.canPush && !TVG.pushOn ?
        '<h2>איך להזכיר לך?</h2><p class="remnote">הכי פשוט ומדויק: התראה שקופצת בטלפון בזמן שבחרת, גם כשהאפליקציה סגורה.</p>' +
        '<button type="button" class="btn" data-pushon>🔔 התראות לטלפון (מומלץ)</button><button type="button" class="ghost" data-calics>📅 הוספה ל-Google Calendar</button>' +
        '<p class="credit">ביומן ההתראה תהיה לפי ברירת המחדל שלו, לא בדיוק לזמן שבחרת.</p>' :
        '<h2>להוסיף ל-Google Calendar?</h2><p class="remnote">ייפתח היומן עם האירוע מוכן לשמירה. ההתראה שם לפי ברירת המחדל של היומן, לא בדיוק לזמן שבחרת.</p>' +
        '<button type="button" class="btn" data-calics>📅 הוספה ל-Google Calendar</button><button type="button" class="ghost" data-remclose>סגירה</button>';
      $("#rem").hidden = false; $("#scrim2").hidden = false; return;
    }
    if (TVG.canPush && !TVG.pushOn) {
      $("#remBody").innerHTML = '<h2>איך להזכיר לך?</h2><p class="remnote">הכי פשוט ומדויק: התראה שקופצת בטלפון בזמן שבחרת, גם כשהאפליקציה סגורה.</p>' +
        '<button type="button" class="btn" data-pushon>🔔 התראות לטלפון (מומלץ)</button><button type="button" class="ghost" data-calsetup>📅 דרך יומן "לוח שידורים"</button><button type="button" class="ghost" data-calics>להוסיף ליומן הרגיל שלי</button>';
      $("#rem").hidden = false; $("#scrim2").hidden = false; return;
    }
    $("#remBody").innerHTML = '<h2>להקים יומן ייעודי?</h2><p class="remnote">אפשר להקים ביומן של הטלפון יומן נפרד בשם "לוח שידורים". כל תזכורת שתוסיפו או תבטלו כאן תופיע או תימחק בו לבד, בלי קבצים ובלי כפילויות.</p>' +
      '<button type="button" class="btn" data-calsetup>כן, הקם יומן "לוח שידורים"</button><button type="button" class="ghost" data-calics>לא, להוסיף ליומן הרגיל שלי</button>' +
      '<p class="credit">אפשר לשנות את זה בכל רגע בלשונית "תזכורות".</p>';
    $("#rem").hidden = false; $("#scrim2").hidden = false;
  }
  function setupCal() {
    TVG.calMode = "sub"; TVG.store("tvg.calmode", "sub");
    if (!TVG.calTok) { TVG.calTok = TVG.newTok(); TVG.store("tvg.calTok", TVG.calTok); }
    $("#remBody").innerHTML = '<h2>מקימים את היומן…</h2>'; $("#rem").hidden = false; $("#scrim2").hidden = false;
    TVG.syncRems().then(function (ok) {
      $("#remBody").innerHTML = '<h2>יומן "לוח שידורים"</h2>' + (ok ? "" : '<p class="remnote">⚠️ לא הצלחתי להתחבר לשרת כרגע. אפשר להירשם בכל זאת, והתזכורות יופיעו כשהחיבור יחזור.</p>') +
        '<ol class="remnote"><li>לחצו "הרשמה ליומן" ואז "הירשם".</li><li>במסך ההגדרות שנפתח, <b>כבו את "הסר התראות"</b>, אחרת לא תקבלו התראה לפני השידור.</li><li>לחצו "סיום". היומן יופיע באפליקציית היומן בשם "לוח שידורים".</li></ol>' +
        '<a class="btn" data-calsub href="' + esc(TVG.calUrl()) + '">הרשמה ליומן</a><button type="button" class="ghost" data-remclose>סגירה</button>' +
        '<p class="credit">שינויים מגיעים ליומן בעדכון הבא שלו (בדרך כלל עד רבע שעה). את התדירות אפשר לקבוע בהגדרות ← יומן ← חשבונות ← יומנים מנויים.</p>';
      if (TVG.rem && !TVG.hasRem(TVG.remKey(TVG.rem.id, TVG.rem.p.s))) {
        TVG.REMS.push(recOf(TVG.rem));
        TVG.saveRems(); TVG.syncRems(); TVG.render();
      }
    });
  }
  function calWelcome() {
    $("#remBody").innerHTML = '<h2>🎉 היומן שלך מוכן!</h2><p class="remnote">מעכשיו "לוח שידורים" יושב לך ביומן. כל תזכורת שתוסיף כאן תקפוץ אליו לבד, ונזכיר לך רגע לפני שהשידור מתחיל. צפייה נעימה 📺</p>' +
      '<p class="credit">לא רואים התראות? בהגדרות ← יומן ← חשבונות ← יומנים מנויים ← "לוח שידורים", ודאו ש"הסר התראות" כבוי.</p>' +
      '<button type="button" class="btn" data-remclose>מעולה, תודה</button>';
    $("#rem").hidden = false; $("#scrim2").hidden = false;
  }
  function useIcs() {
    var r0 = TVG.rem; TVG.calMode = "ics"; TVG.store("tvg.calmode", "ics"); closeRem();
    if (r0 && !TVG.hasRem(TVG.remKey(r0.id, r0.p.s))) { TVG.rem = r0; downloadIcs(); } else TVG.render();
  }
})(window.TVG);
