/* js/welcome.js - חלון קבלת פנים והתקנה למוזמנים (קישור ההזמנה join/ -> ../?from=join): מציג רק את ההתקנה שמתאימה למכשיר הזה.
   מופיע פעם אחת: רק כשהאפליקציה לא מותקנת, הכניסה היא מההזמנה, ולא נסגר בעבר (tvg.welcome="1"). כל סגירה (כפתור, רקע, גרירה, Escape, חזור) מסמנת "נסגר".
   מחשב: אין מה להתקין, לכן בלי חלון בכלל. כשיש בורר ערוצים למבקר ראשון הוא נפתח אחרי החלון (באייפון ההתקנה קודם: האפליקציה שבמסך הבית לא חולקת אחסון עם ספארי).
   קורא בלבד: tvg.src (backup.js). חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: settings, nav, sheetdrag, landing. נרשם כשכבה ב-nav.js (#welcome). */
(function (TVG) {
  TVG.files["welcome"] = 1;
  var $ = TVG.$, UA = navigator.userAgent;
  TVG.closeWelcome = closeWelcome;

  // נקבע בטעינה, לפני שהכתובת מנוקה: הגיעו מההזמנה? (הפרמטר, או tvg.src שנכתב ברגעים האלה ע"י backup.js)
  var P = null; try { P = new URLSearchParams(location.search); } catch (e) { P = new URLSearchParams(""); }
  var fromJoin = P.get("from") === "join" || (function () { try { var o = JSON.parse(TVG.store("tvg.src") || "null"); return !!(o && o.s === "join" && Date.now() - (+o.at || 0) < 30000); } catch (e) { return false; } })();
  var otherIntent = P.get("rem") || P.get("nf") || P.get("w") || P.get("p") != null || P.get("r") || P.has("q") || P.get("tab"); // להם יש ממשק משלהם

  // ---- סמלי iOS קטנים, בתוך השורה ----
  var SVG = '<svg class="wl-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC_SHARE = SVG + '<path d="M12 3v12M8 7l4-4 4 4M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg>';
  var IC_PLUS = SVG + '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

  function mode() { // ios-safari | ios-other | ios-app | and-dip | and-steps | and-app ; "" = מחשב
    var inApp = TVG.inApp ? TVG.inApp() : false;
    if (TVG.isIOS) return /CriOS|FxiOS|EdgiOS/.test(UA) ? "ios-other" : inApp ? "ios-app" : "ios-safari";
    if (TVG.isAndroid) return inApp ? "and-app" : TVG.dip ? "and-dip" : "and-steps";
    return "";
  }
  function step(n, html) { return '<li class="wl-step"><b class="wl-n" aria-hidden="true">' + n + "</b><span>" + html + "</span></li>"; }
  function html() {
    var m = mode(), s = [], primary = '<button type="button" class="btn" data-wlok>הבנתי, להתחיל</button>';
    var first = function (txt, sub) { s.push(step(s.length + 1, txt + (sub ? '<small class="wl-sub">' + sub + "</small>" : ""))); };
    if (m === "ios-app") first("פותחים את הקישור בספארי", "בוואטסאפ: ⋯ ← פתיחה בספארי");
    else if (m === "ios-other") first("פותחים את הקישור בספארי", "מעתיקים את הכתובת ומדביקים בספארי");
    if (m.indexOf("ios") === 0) {
      s.push(step(s.length + 1, "לוחצים על <span class=\"wl-nw\">שיתוף " + IC_SHARE + "</span> בתחתית"));
      s.push(step(s.length + 1, "גוללים ובוחרים ״הוסף <span class=\"wl-nw\">למסך הבית״ " + IC_PLUS + "</span>"));
      s.push(step(s.length + 1, "״הוסף״ – וזהו, זפזופ במסך הבית"));
    } else if (m === "and-app") {
      first("פותחים את הקישור בכרום", "בוואטסאפ: ⋮ ← פתיחה בדפדפן");
      s.push(step(s.length + 1, "לוחצים על ⋮ בפינת הדפדפן"));
      s.push(step(s.length + 1, "בוחרים ״התקנת אפליקציה״ או ״הוספה למסך הבית״"));
    } else if (m === "and-steps") {
      s.push(step(1, "לוחצים על ⋮ בפינת הדפדפן"));
      s.push(step(2, "בוחרים ״התקנת אפליקציה״ או ״הוספה למסך הבית״"));
    } else if (m === "and-dip") {
      primary = '<button type="button" class="btn" data-wlinst>📲 התקנת האפליקציה</button>';
    }
    return '<div class="wl-hd"><h2 id="wlT">👋 ברוכים הבאים לזפזופ</h2>' +
      '<p class="wl-lead">תזפזפו פחות. תראו יותר. כל הערוצים, תזכורות ומה חדש בנטפליקס – חינם ובלי הרשמה.</p></div>' +
      (s.length ? '<ol class="wl-steps" aria-label="התקנה במסך הבית">' + s.join("") + "</ol>" : m === "and-dip" ? '<p class="wl-note">מתקינים בלחיצה אחת, והלוח נפתח מהמסך הבית במסך מלא.</p>' : "") +
      '<div class="wl-bar">' + primary + '<button type="button" class="ghost" data-wlclose>אחר כך</button></div>';
  }
  function paint() { var b = $("#wlBody"); if (b) b.innerHTML = html(); }

  function open() {
    paint(); $("#welcome").hidden = false; $("#scrim2").hidden = false;
  }
  function closeWelcome() {
    var w = $("#welcome"); if (!w || w.hidden) return;
    TVG.store("tvg.welcome", "1");
    w.hidden = true; $("#scrim2").hidden = true;
    // בורר הערוצים למבקר ראשון (boot.js דילג עליו בזמן שהחלון היה פתוח)
    setTimeout(function () { if (TVG.G && TVG.needsPick() && TVG.store("tvg.tab") !== "nf" && $("#sheet").hidden && $("#rem").hidden && $("#land").hidden) TVG.openSheet(true); }, 260);
  }
  TVG.navLayer("#welcome", closeWelcome);

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#welcome [data-wlok], #welcome [data-wlclose], #welcome [data-wlinst]"); if (!t) return;
    if (t.hasAttribute("data-wlinst")) TVG.install();
    closeWelcome();
  });
  var sc = $("#scrim2"); if (sc) sc.addEventListener("click", function () { if (!$("#welcome").hidden) closeWelcome(); });
  window.addEventListener("beforeinstallprompt", function () { var w = $("#welcome"); if (w && !w.hidden) paint(); }); // settings.js שמר את TVG.dip קודם (נרשם לפנינו)
  window.addEventListener("appinstalled", function () { closeWelcome(); });

  // אחרי הציור הראשון של הלוח (nav.js afterBoot נקרא מ-boot.js), לפני שבורר הערוצים נפתח
  var ab = TVG.afterBoot;
  TVG.afterBoot = function () {
    if (ab) ab.apply(this, arguments);
    try {
      if (!fromJoin || otherIntent || TVG.isStandalone || TVG.installed || TVG.store("tvg.welcome") === "1" || !mode()) return;
      if (!$("#rem").hidden || !$("#land").hidden || !$("#ptyL").hidden || !$("#party").hidden || !$("#nfsheet").hidden) return;
      open();
    } catch (e) {}
  };
})(window.TVG);
