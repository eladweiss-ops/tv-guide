/* js/team.js - ⚽ הקבוצה שלי: בוחרים קבוצות, ובלשונית "היום" (מתחת ל"🌙 הערב שלך") מופיעים כל המשחקים שלהן בשבוע הקרוב, בכל הערוצים.
   אפשר להפעיל "⏰ להזכיר אוטומטית על כל משחק": תזכורת לכל משחק (לא לשידור חוזר), וגם למשחקים חדשים שמופיעים בלוח, בכל פתיחה.
   התאמה מדויקת: רק שם קבוצה שלם באחד משני צדי המשחק ("א - ב"), אחרי נרמול קיצורים ("מ. תא" = "מכבי ת״א" = "מכבי תל אביב").
   ענף: כדורגל/כדורסל לפי מילים בכותרת ובתקציר (התקציר קובע: תוויות הליגה בכותרת לפעמים שגויות), ולפי משחקים אחרים של אותו צמד.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, ..., search. */
(function (TVG) {
  TVG.files["team"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;

  // ---------- נרמול שמות ----------
  var CITY = { "תא": "תל אביב", "בש": "באר שבע", "פת": "פתח תקווה", "רג": "רמת גן", "קש": "קריית שמונה", "ראשלצ": "ראשון לציון", "כפס": "כפר סבא", "נצ": "נס ציונה", "ים": "ירושלים" };
  var CLUBW = ["מכבי", "הפועל", "ביתר", "עירוני", "בני", "הכח", "אליצור", "מס", "ריאל", "אתלטיקו", "מנצסטר", "אינטר", "דינמו", "ספורטינג", "סיטי", "יונייטד", "fc", "real", "manchester"];
  // שמות באנגלית ושמות חלופיים -> שם אחד (אחרי נרמול)
  var ALIAS = {
    "real madrid": "ריאל מדריד", "barcelona": "ברצלונה", "fc barcelona": "ברצלונה", "barca": "ברצלונה", "liverpool": "ליברפול", "arsenal": "ארסנל", "chelsea": "צלסי",
    "manchester united": "מנצסטר יונייטד", "man united": "מנצסטר יונייטד", "man utd": "מנצסטר יונייטד", "manchester city": "מנצסטר סיטי", "man city": "מנצסטר סיטי",
    "tottenham": "טוטנהאם", "juventus": "יובנטוס", "bayern": "באיירן מינכן", "bayern munich": "באיירן מינכן", "psg": "פסז", "paris saint-germain": "פסז", "פריז סן זרמן": "פסז",
    "atletico madrid": "אתלטיקו מדריד", "ac milan": "מילאן", "milan": "מילאן", "inter": "אינטר", "napoli": "נאפולי", "maccabi tel aviv": "מכבי תל אביב", "maccabi haifa": "מכבי חיפה",
    "hapoel tel aviv": "הפועל תל אביב", "hapoel beer sheva": "הפועל באר שבע", "beitar jerusalem": "ביתר ירושלים", "lakers": "לא לייקרס", "la lakers": "לא לייקרס", "ל.א. לייקרס": "לא לייקרס",
    "golden state": "גולדן סטייט", "boston": "בוסטון", "boston celtics": "בוסטון סלטיקס", "panathinaikos": "פנאתינייקוס", "olympiacos": "אולימפיאקוס", "fenerbahce": "פנרבחצה"
  };
  function canon(s) {
    s = (" " + String(s == null ? "" : s).toLowerCase() + " ")
      .replace(/[״”“]/g, '"').replace(/[׳’`]/g, "'").replace(/־/g, "-")
      .replace(/([\s.(\-])י\s?-\s?ם(?=[\s\-),.:;'"]|$)/g, "$1ירושלים").replace(/([\s.(\-])י["']ם(?=[\s\-),.:;]|$)/g, "$1ירושלים")
      .replace(/([\s\-(:;])מ\.(?!ס\.)\s?(?=[א-ת])/g, "$1מכבי ").replace(/([\s\-(:;])ה\.\s?(?=[א-ת])/g, "$1הפועל ")
      .replace(/([\s\-(:;])ב\.\s?(?=[א-ת])/g, "$1ביתר ").replace(/([\s\-(:;])ע\.\s?(?=[א-ת])/g, "$1עירוני ")
      .replace(/([\s\-(:;])ר\.\s?(?=מדריד)/g, "$1ריאל ").replace(/([\s\-(:;])את\.\s?(?=מדריד)/g, "$1אתלטיקו ")
      .replace(/([\s\-(:;])מנ[.']\s?(?=(סיטי|יונייטד|יוניטד))/g, "$1מנצסטר ")
      .replace(/["']/g, "").replace(/בית"?ר/g, "ביתר")
      .replace(/(^|[\s\-(:])(מכבי|הפועל|ביתר|עירוני|בני|הכח|אליצור)\s+(תא|בש|פת|רג|קש|ראשלצ|כפס|נצ|ים)(?=[\s\-),.:;]|$)/g, function (m, a, c, x) { return a + c + " " + CITY[x]; })
      .replace(/תל[\-\s]אביב(?:[\-\s]יפו)?/g, "תל אביב").replace(/קרית/g, "קריית").replace(/תקוה/g, "תקווה").replace(/יוניטד/g, "יונייטד").replace(/(^|\s)מ\.ס\.\s?/g, "$1מס ")
      .replace(/\s+/g, " ");
    return s;
  }
  // מטמון נרמול (אותן כותרות חוזרות בכל יום ובכל ערוץ). מתאפס בכל סריקה
  var CC = {};
  function cc(x) { x = x || ""; var v = CC[x]; if (v == null) v = CC[x] = canon(x); return v; }
  function key(n) { var k = canon(n).replace(/^[\s.,!;:]+|[\s.,!;:]+$/g, ""); k = k.replace(/\./g, ""); return ALIAS[k] || k; }
  // שם כללי מדי ("מכבי" לבד) – לא קבוצה
  function generic(k) { return !k || k.length < 2 || CLUBW.indexOf(k) >= 0 || /^(מכבי|הפועל|ביתר|עירוני|בני)( (כדורגל|כדורסל))?$/.test(k); }
  // צדי המשחק מתוך כותרת: "ליגת ווינר: מכבי חיפה - הפועל ב״ש (מקוצר)" -> ["מכבי חיפה", "הפועל באר שבע"]
  function sidesOf(title) {
    var t = cc(title).replace(/\([^)]*\)/g, " ").replace(/\s·.*$/, " ").replace(/(^|\s)(ישיר|live)!?(\s|:|$)/g, " ");
    var i = t.lastIndexOf(":"); if (i >= 0) t = t.slice(i + 1);
    var parts = t.split(/\s+(?:-|–|נגד|vs\.?)\s+/);
    if (parts.length !== 2) parts = t.split(/\s*-\s*/);
    if (parts.length !== 2) return null;
    var a = clean(parts[0]), b = clean(parts[1]);
    return a && b && a !== b ? [a, b] : null;
  }
  function clean(x) { x = String(x).replace(/\./g, "").replace(/^[\s,!;:"]+|[\s,!;:"]+$/g, "").replace(/\s+/g, " "); return ALIAS[x] || x; }

  // ---------- ענף, תוכן שאינו משחק, שידור חוזר ----------
  var RE_BB = /כדורסל|יורוליג|יורוקאפ|(^|\s)nba(\s|:|$)|g-league|ווינר סל|אלופות סל|(^|\s)סל(\s|$)|euroleague|eurocup|ליגת העל לנוער בכדורסל/;
  var RE_FB = /כדורגל|ליגה לאומית|פרמייר|(ליגה|הליגה|ל\.) ?ה?(אנגלית|ספרדית|איטלקית|גרמנית|צרפתית|הולנדית|טורקית \(כדורגל\)|ארגנטינאית|פורטוגלית|אירופית|סקוטית|בלגית|סעודית)|ליגת הכנס|גביע הטוטו|ליגת ווינר(?! סל)|ליגת העל ווינר|מוקדמות (יורו|המונדיאל|מונדיאל)|ליגת האומות|אופא|גביע אנגלי|גביע המדינה בכדורגל|ליגת האלופות(?! בכדורסל)|ל\. אלופות/;
  var RE_BB_T = /כדורסל|יורוליג|יורוקאפ|(^|\s)nba(\s|:|$)|ווינר סל/, RE_FB_T = /ל\. (אנגלית|ספרדית|איטלקית|גרמנית|צרפתית|הולנדית|טורקית|ארגנטינאית|פורטוגלית|אירופית)|כדורגל|ליגת ווינר(?! סל)|פרמייר/;
  function sportOf(p) {
    var t = cc(p.title), d = cc(p.desc), bb = 0, fb = 0;
    if (RE_BB.test(d)) bb += 2; if (RE_FB.test(d)) fb += 2;
    if (RE_BB_T.test(t)) bb += 1; if (RE_FB_T.test(t)) fb += 1;
    return bb > fb ? "bb" : fb > bb ? "fb" : "";
  }
  // לא משחק: תקציר, מגזין, סיכום, שערים, אולפן, פודקאסט; נוער/נשים (אלא אם שם הקבוצה כולל אותם)
  var RE_NOGAME = /תקציר|מגזין|סיכום|שערים|לקראת|אולפן|פודקאסט|podcast|highlights|תכנית|תוכנית|חדשות הספורט|מהדורת|מבזק|(^|\s)פרק(\s|$)|תיקתקנו/;
  var RE_YOUTH = /נוער|נערים|נשים|ילדים|קדטים|(^|\s)u-?\d\d|עד גיל/;
  // שידור חוזר לפי הטקסט: ש.ח, שידור חוזר, מוקלט, מקוצר, משחק מהארכיון (עונה ישנה, "המיטב", "יש לי יום הולדת")
  var RE_RR = /(^|\s)שח(\s|$)|ש\.ח|שידור חוזר|מוקלט|מקוצר|(^|\s)הכנה$/;
  // משחק מהארכיון (5GOLD: "המיטב", "יש לי יום הולדת", עונה ישנה "95/96") – לא משחק של השבוע, לא מוצג בכלל
  var RE_OLD = /המיטב|יש לי יום הולדת|נוסטלגיה|קלאסיקות|(^|\s)אwow|(^|\s)wow(\s|$)/;
  // תקציר בתבנית "א-ב מח.10" (בלי רווחים סביב המקף) מופיע בלוח רק בשידורים חוזרים (נבדק: 87 שידורים, אף אחד לא חי)
  var RE_RRD = /\S-\S[^:·]*\sמח\.\s?\d+|\S-\S[^:·]*\sגמר$/;
  function season(now) { var y = now.getFullYear() % 100, m = now.getMonth(); return m >= 6 ? [y, (y + 1) % 100] : [(y + 99) % 100, y]; }
  function oldSeason(txt, now) {
    var cur = season(now), re = /(?:^|[^\d])(?:19|20)?(\d\d)\/(\d\d)(?!\d)/g, m, any = false;
    while ((m = re.exec(txt))) { if ((+m[1] + 1) % 100 !== +m[2]) continue; any = true; if (+m[1] === cur[0]) return false; }
    return any;
  }

  // ---------- כל המשחקים בלוח (מטמון לפי הלוח הטעון) ----------
  var ALL = null, ALLG = null, ALLAt = 0, DISP = {};
  function sportCh(c) { return c._n === "sport" || c._g === "sport" || /ספורט|sport|5gold|5max|5 live|5stars|one|eurosport/i.test(c.name || ""); }
  function scan() {
    if (ALL && ALLG === TVG.G && Date.now() - ALLAt < 600000) return ALL;
    var now = new Date(), list = [], SD = {}; DISP = {}; CC = {};
    TVG.G.channels.forEach(function (c) {
      var spc = sportCh(c);
      (TVG.by.get(c.id) || []).forEach(function (p) {
        if (!/[-–]|נגד|vs/i.test(p.title)) return; // סינון זול לפני הנרמול
        if (!spc && !/כדורגל|כדורסל|יורוליג|nba|ווינר|ליג|ל\.|פרמייר/i.test(p.title)) return;
        var sd = SD[p.title]; if (sd === undefined) sd = SD[p.title] = sidesOf(p.title);
        if (!sd) return;
        if (!spc) { var tc = cc(p.title); if (!RE_BB_T.test(tc) && !RE_FB_T.test(tc)) return; } // מחוץ לערוצי הספורט: רק כשיש מילת ענף בכותרת ("כדורגל: א - ב")
        var sp = sportOf(p);
        var txt = cc(p.title) + " " + cc(p.desc), arch = /5\s?gold/i.test(c.name || "") && p.lv !== 1 && !TVG.isLiveP(p); // 5GOLD: ערוץ ארכיון; רק "ישיר" בו הוא משחק של השבוע
        [0, 1].forEach(function (i) { var k = sd[i], raw = rawSide(p.title, i), d = DISP[k] || (DISP[k] = {});
          if (raw && key(raw) === k && !/(^|\s)[א-ת]{1,3}\.\s?/.test(raw) && !/[א-ת]\.[א-ת]/.test(raw)) d[raw] = (d[raw] || 0) + 1;
          else if (p.desc && !Object.keys(d).length) { var ds = descSide(p.desc, k); if (ds) d[ds] = 0.5; } });
        list.push({ c: c, p: p, a: sd[0], b: sd[1], sp: sp, sp0: sp, pair: [sd[0], sd[1]].sort().join("~"),
          ng: arch || RE_NOGAME.test(cc(p.title)) || RE_OLD.test(txt) || oldSeason(txt, now), yo: RE_YOUTH.test(txt), rr: !!p.rr || RE_RR.test(txt) || (p.lv !== 1 && RE_RRD.test(p.desc || "")) });
      });
    });
    // ענף חסר: לפי שידורים אחרים של אותו צמד (רק כשכולם מסכימים)
    var bySp = {};
    list.forEach(function (x) { if (x.sp) { var o = bySp[x.pair] || (bySp[x.pair] = {}); o[x.sp] = 1; } });
    list.forEach(function (x) { if (!x.sp && bySp[x.pair]) { var k = Object.keys(bySp[x.pair]); if (k.length === 1) x.sp = k[0]; } });
    // ועדיין חסר: לפי שתי הקבוצות, כשיש להן ענף משותף אחד בלוח ("ברצלונה - אסטון וילה": אסטון וילה רק בכדורגל)
    var sideSp = {};
    list.forEach(function (x) { if (x.sp0) [x.a, x.b].forEach(function (k) { (sideSp[k] || (sideSp[k] = {}))[x.sp0] = 1; }); });
    list.forEach(function (x) {
      if (x.sp) return;
      var sa = Object.keys(sideSp[x.a] || {}), sb = Object.keys(sideSp[x.b] || {});
      var both = sa.filter(function (v) { return sb.indexOf(v) >= 0; }); // רק כששתי הקבוצות מוכרות, והענף המשותף אחד
      if (sa.length && sb.length && both.length === 1) x.sp = both[0];
    });
    // שידור חוזר לפי סדר: לכל צמד+ענף, השידור הראשון (או זה שמסומן חי) הוא המשחק; מה שמתחיל אחרי שהסתיים - חוזר.
    // שידור חי חדש (lv=1) יותר מ-12 שעות אחרי - משחק חדש
    var grp = {};
    list.forEach(function (x) { (grp[x.pair + "|" + x.sp] || (grp[x.pair + "|" + x.sp] = [])).push(x); });
    Object.keys(grp).forEach(function (k) {
      var g = grp[k].sort(function (x, y) { return x.p.s - y.p.s; }), orig = null;
      g.forEach(function (x) {
        if (x.ng) return;
        var live = x.p.lv === 1 || TVG.isLiveP(x.p);
        if (orig && live && x.p.s - orig.p.e > 12 * 3600000) orig = null;
        if (!orig) { if (x.rr && !live) return; orig = x; x.gid = k + "|" + x.p.s.getTime(); return; }
        var olive = orig.p.lv === 1 || TVG.isLiveP(orig.p);
        if (live && olive && x.p.s - orig.p.s < 3 * 3600000) { x.rr = false; x.gid = orig.gid; return; } // שניהם "ישיר": אותו משחק בשני ערוצים (אחד מתחיל באולפן)
        if (x.p.s >= orig.p.s.getTime() + 45 * 60000) x.rr = true; // אחרי תחילת המשחק = הקלטה
        else if (!x.rr) x.gid = orig.gid; // באותו זמן בערוץ אחר (שידור מקביל)
      });
      g.forEach(function (x) { if (!x.gid) x.gid = k + "|r|" + (orig ? orig.p.s.getTime() : x.p.s.getTime()); });
    });
    ALL = list; ALLG = TVG.G; ALLAt = Date.now(); CC = {};
    return list;
  }
  function hit(x, t) {
    var k = t.k || (t.k = key(t.n)), side = x.a === k ? 1 : x.b === k ? 2 : 0;
    if (!side) return false;
    if (t.sport && x.sp !== t.sport) return false; // ענף נבחר: רק משחקים שהענף שלהם ידוע ותואם
    if (x.yo && !RE_YOUTH.test(k)) return false;
    return !x.ng;
  }
  // המשחקים הקרובים (7 ימים): שורה אחת לכל משחק (ערוץ מהערוצים שלי קודם), ושידורים חוזרים בנפרד
  function games(teams, now, days) {
    now = now || new Date(); var end = now.getTime() + (days || 7) * 86400000, mine = {};
    try { TVG.chans().forEach(function (c) { mine[c.id] = 1; }); } catch (e) {}
    var by = {}, out = [], reps = [], rseen = {};
    scan().forEach(function (x) {
      if (x.p.e <= now || x.p.s.getTime() >= end) return;
      var tm = null; for (var i = 0; i < teams.length; i++) if (hit(x, teams[i])) { tm = teams[i]; break; }
      if (!tm) return;
      if (x.rr) { if (rseen[x.gid]) return; rseen[x.gid] = 1; reps.push({ c: x.c, p: x.p, t: tm, rr: true, sp: x.sp, a: x.a, b: x.b }); return; }
      var g = by[x.gid];
      if (!g) { g = by[x.gid] = { c: x.c, p: x.p, t: tm, sp: x.sp, a: x.a, b: x.b, alts: [] }; out.push(g); }
      else if (!mine[g.c.id] && mine[x.c.id]) { g.alts.push({ c: g.c, p: g.p }); g.c = x.c; g.p = x.p; }
      else g.alts.push({ c: x.c, p: x.p });
    });
    var bt = function (x, y) { return x.p.s - y.p.s || x.c.name.localeCompare(y.c.name, "he"); };
    return { games: out.sort(bt), reps: reps.sort(bt) };
  }
  // קבוצות שמופיעות בלוח השבוע (להצעות בבורר): לפי מספר משחקים, ישראליות קודם
  function detect(now) {
    now = now || new Date(); var end = now.getTime() + 7 * 86400000, cnt = {}, sps = {}, gids = {};
    scan().forEach(function (x) {
      if (x.ng || x.yo) return;
      [[x.a, 0], [x.b, 1]].forEach(function (s) {
        var k = s[0]; if (generic(k) || k.length > 26 || /\d/.test(k)) return;
        if (x.sp) (sps[k] || (sps[k] = {}))[x.sp] = 1;
        if (x.p.e <= now || x.p.s.getTime() >= end || x.rr) return;
        if ((gids[k] || (gids[k] = {}))[x.gid]) return; gids[k][x.gid] = 1;
        cnt[k] = (cnt[k] || 0) + 1;
      });
    });
    return Object.keys(sps).concat(Object.keys(cnt)).filter(function (k, i, a) { return a.indexOf(k) === i; }).map(function (k) {
      return { k: k, n: niceName(k), pop: POP.indexOf(k) < 0 ? 99 : POP.indexOf(k), c: cnt[k] || 0, sp: Object.keys(sps[k] || {}), il: /^(מכבי|הפועל|ביתר|עירוני|בני|הכח|אליצור|מס) /.test(k) };
    }).sort(function (a, b) { return (b.c > 0) - (a.c > 0) || a.pop - b.pop || b.il - a.il || b.c - a.c || a.n.localeCompare(b.n, "he"); });
  }
  function rawSide(title, i) {
    var t = String(title).replace(/(^|[\s.])י\s?-\s?ם(?=[\s\-]|$)/g, "$1י-ם").replace(/\([^)]*\)/g, " ").replace(/\s·.*$/, "").replace(/^\s*(ישיר|LIVE)!?\s*/i, ""), j = t.lastIndexOf(":"); if (j >= 0) t = t.slice(j + 1);
    var parts = t.split(/\s+[-–]\s+/); if (parts.length !== 2) return "";
    return parts[i].trim();
  }
  function descSide(desc, k) { var m = String(desc).split(/[·;:,]/); for (var i = 0; i < m.length; i++) { var sd = m[i].split(/\s*-\s*/); for (var j = 0; j < sd.length; j++) if (key(sd[j]) === k && !/[א-ת]\.\s/.test(sd[j])) return sd[j].trim(); } return ""; }
  // הקבוצות הפופולריות קודם בהצעות (אחרי "משחקות השבוע")
  var POP = ["מכבי תל אביב", "מכבי חיפה", "הפועל באר שבע", "הפועל תל אביב", "ביתר ירושלים", "הפועל ירושלים", "מכבי נתניה", "הפועל חיפה", "בני סכנין", "מכבי פתח תקווה", "ריאל מדריד", "ברצלונה", "ליברפול", "מנצסטר סיטי", "מנצסטר יונייטד", "ארסנל"];
  function niceName(k) { var d = DISP[k] || {}, best = Object.keys(d).sort(function (a, b) { return d[b] - d[a] || b.length - a.length; })[0]; return nice(best || k); }
  function nice(s) { return String(s).replace(/"/g, "״").replace(/'/g, "׳"); }

  TVG.teamLib = { canon: canon, key: key, sidesOf: sidesOf, sportOf: sportOf, generic: generic, scan: scan, games: games, detect: detect, hit: hit, reset: function () { ALL = null; } };

  // ---------- מצב ----------
  function load(k, d) { try { var v = JSON.parse(TVG.store(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  TVG.TEAMS = (load("tvg.teams", []) || []).filter(function (t) { return t && t.n; });
  var AUTO = TVG.store("tvg.teamAuto") === "1";
  var TX = load("tvg.teamX", []) || []; // מפתחות תזכורת שכבר טופלו (נוספו או היו קיימות). לא מוסיפים שוב – גם אם נמחקו
  function saveTeams() { TVG.store("tvg.teams", JSON.stringify(TVG.TEAMS.map(function (t) { return { n: t.n, sport: t.sport || "" }; }))); }
  function saveTX() { var cut = Date.now() - 86400000; TX = TX.filter(function (k) { return +k.slice(k.lastIndexOf("|") + 1) > cut; }); TVG.store("tvg.teamX", JSON.stringify(TX)); }
  function tKey(t) { return t.k || (t.k = key(t.n)); }
  function hasTeam(k) { return TVG.TEAMS.some(function (t) { return tKey(t) === k; }); }
  function icon(t) { return t && t.sport === "bb" ? "🏀" : "⚽"; }

  // ---------- תזכורות אוטומטיות ----------
  // מוסיף תזכורת לכל משחק עתידי שעוד לא טופל. משחק עם תזכורת (גם בערוץ מקביל) מסומן כמטופל. שידור חוזר – אף פעם
  function autoList(now) {
    var G = games(TVG.TEAMS, now).games, add = [], dirty = false, soon = now.getTime() + 60000;
    G.forEach(function (g) {
      var ks = [g].concat(g.alts).map(function (a) { return TVG.remKey(a.c.id, a.p.s); }), k = ks[0];
      if (g.p.s.getTime() <= soon) return;
      if (ks.some(function (x) { return TVG.hasRem(x); }) || ks.some(function (x) { return TX.indexOf(x) >= 0; })) { ks.forEach(function (x) { if (TX.indexOf(x) < 0) { TX.push(x); dirty = true; } }); return; }
      add.push({ g: g, k: k });
    });
    if (dirty) saveTX();
    return add;
  }
  var syncing = false;
  function teamSync(quiet) {
    if (!AUTO || !TVG.TEAMS.length || !TVG.G || TVG.isSample || !TVG.srv() || syncing) return 0;
    syncing = true;
    try {
      var add = autoList(new Date()); if (!add.length) return 0;
      var recs = add.map(function (a) { TX.push(a.k); return TVG.remRec({ id: a.g.c.id, p: a.g.p }); });
      saveTX(); TVG.REMS = TVG.REMS.concat(recs); TVG.saveRems(); TVG.syncRems();
      var ks = recs.map(function (r) { return r.k; });
      var msg = recs.length === 1 ? "⏰ נזכיר לך על המשחק " + TVG.leadTxt(recs[0].lead, recs[0].ts) : "⏰ " + recs.length + " משחקים בתזכורת";
      var show = function () {
        TVG.pill(msg, 5000, "ביטול", function () { TVG.REMS = TVG.REMS.filter(function (x) { return ks.indexOf(x.k) < 0; }); TVG.saveRems(); TVG.syncRems(); TVG.render(); TVG.pill("בוטל", 1200); }, "🔔 שינוי", function () { TVG.openLead(ks); });
      };
      TVG.render();
      if (quiet) setTimeout(show, 3900); else show(); // בעלייה: אחרי ההודעה "עודכנת לגרסה"
      return recs.length;
    } finally { syncing = false; }
  }
  TVG.teamSync = teamSync;

  // ---------- כרטיס בלשונית "היום" ----------
  var OPEN = false, REPOPEN = false, SHOW = 2, pendSync = false;
  function dayWord(d, now) {
    var a = dstr(d), t = new Date(now); if (a === dstr(t)) return "היום";
    t.setDate(t.getDate() + 1); if (a === dstr(t)) return "מחר";
    return TVG.DAYS[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1);
  }
  function bd(s) { return "<bdi>" + esc(TVG.bidi(s)) + "</bdi>"; }
  function row(x, now) {
    var v = TVG.remKey(x.c.id, x.p.s), live = x.p.s <= now, on = !!TVG.hasRem(v);
    // כותרת נקייה: שמות מלאים ("ה. בש - ה. תא" -> "הפועל ב״ש - הפועל ת״א"); תג חי/חוזר וענף בשורה המשנית
    var ttl = x.a ? '<span class="tmside">' + bd(niceName(x.a)) + '</span> - <span class="tmside">' + bd(niceName(x.b)) + "</span>" : esc(x.p.title);
    // המשחקים ברשימה הראשית הם השידור הראשון (בדרך כלל חי); שידור חוזר מסומן 📼. סמל הענף לפני היום
    var tag = live ? '<span class="tagk now">משודר עכשיו</span> ' : x.rr ? '<span class="tagk rr">📼 שידור חוזר</span> ' : "";
    var spw = x.sp === "bb" ? '<span aria-label="כדורסל">🏀</span> ' : x.sp === "fb" ? '<span aria-label="כדורגל">⚽</span> ' : "";
    var fin = /(^|\s)גמר(\s|:|$)/.test(canon(x.p.title)) ? " · גמר" : "";
    var sub = tag + spw + esc(dayWord(x.p.s, now)) + " · " + bd(x.c.name) + fin + (x.alts && x.alts.length ? " · " + (x.alts.length === 1 ? "גם ב" + bd(x.alts[0].c.name) : "ועוד " + x.alts.length + " ערוצים") : "");
    var act = live ? "" : '<button type="button" class="rbt' + (on ? " on" : "") + '" data-rem="' + esc(v) + '" aria-label="' + (on ? "יש תזכורת: " : "תזכורת: ") + esc(x.p.title) + '">' + (on ? "✓" : "⏰") + "</button>";
    return '<div class="srow tnrow tmrow' + (x.rr ? " tmrr" : "") + '"><button type="button" class="go" data-jump="' + esc(v) + '"><span class="time">' + hhmm(x.p.s) + '</span><span class="ttl">' + ttl + '<br><span class="sub">' + sub + "</span></span></button>" + act + "</div>";
  }
  function teamHtml(now) {
    if (!TVG.TEAMS.length || !TVG.G || TVG.isSample) return "";
    var R = games(TVG.TEAMS, now), G = R.games, one = TVG.TEAMS.length === 1 ? TVG.TEAMS[0] : null;
    var ttl = one ? icon(one) + " " + bd(one.n) : "⚽ הקבוצות שלי";
    var fut = G.filter(function (g) { return g.p.s > now; }).length;
    var cnt = G.length ? (G.length === 1 ? "משחק אחד" : G.length + " משחקים") + " בשבוע הקרוב" : "אין משחקים בשבוע הקרוב" + (R.reps.length ? ", רק שידורים חוזרים" : "");
    var h = '<section class="tonight team" aria-label="הקבוצה שלי"><div class="tnhd tmhd"><div><h2 class="sech">' + ttl + '</h2><p class="tncnt">' + cnt + '</p></div><button type="button" class="linkb tmedit" data-teamedit>עריכה</button></div><div class="tnlist">';
    G.forEach(function (g, i) { if (i === SHOW) h += '<div class="tnrest"' + (OPEN ? "" : " hidden") + ">"; h += row(g, now); });
    if (G.length > SHOW) h += "</div>";
    if (R.reps.length && (OPEN || G.length <= SHOW)) {
      h += '<div class="tmreps"' + (REPOPEN ? "" : " hidden") + ">" + R.reps.map(function (x) { return row(x, now); }).join("") + "</div>";
    }
    h += "</div>";
    var more = G.length > SHOW && !OPEN ? '<button type="button" class="linkb tnmore" data-teammore>עוד ' + (G.length - SHOW) + " ›</button>"
      : R.reps.length && !REPOPEN ? '<button type="button" class="linkb tnmore" data-teamreps>📼 ' + (R.reps.length === 1 ? "שידור חוזר אחד" : R.reps.length + " שידורים חוזרים") + " ›</button>" : "";
    h += more;
    var srv = TVG.srv();
    h += '<button type="button" class="tmauto" role="switch" aria-checked="' + AUTO + '" data-teamauto><span class="tmal"><b>⏰ להזכיר על כל משחק</b><span>' +
      (AUTO && !srv ? "צריך להפעיל התראות לטלפון. הקשה כאן להפעלה" : "אוטומטית, גם על משחקים חדשים שיופיעו. בלי שידורים חוזרים") + '</span></span><i class="tmsw" aria-hidden="true"></i></button>';
    h += "</section>";
    // התראות הופעלו בינתיים (למשל מהחלון "איך להזכיר לך?"): משלימים את התזכורות האוטומטיות
    if (AUTO && srv && fut && !pendSync) { pendSync = true; setTimeout(function () { pendSync = false; if (autoList(new Date()).length) teamSync(false); }, 60); }
    return h;
  }
  TVG.teamHtml = teamHtml;

  // ---------- המועדפים: שורת כניסה לבורר ----------
  function teamFavHtml() {
    var h = '<h2 class="sech">⚽ הקבוצה שלי</h2>';
    if (TVG.TEAMS.length) {
      var G = TVG.G ? games(TVG.TEAMS, new Date()).games : [];
      h += '<div class="srow"><button type="button" class="go sg" data-teamedit><span class="ttl">' + TVG.TEAMS.map(function (t) { return icon(t) + " " + bd(t.n); }).join(" · ") +
        '<br><span class="sub">' + (G.length ? (G.length === 1 ? "משחק אחד" : G.length + " משחקים") + " בשבוע הקרוב" : "אין משחקים בשבוע הקרוב") + (AUTO ? " · ⏰ תזכורת אוטומטית" : "") + '</span></span></button></div>';
    } else h += '<p class="none">בוחרים קבוצה, ונציג בלשונית "היום" את כל המשחקים שלה בשבוע הקרוב.</p><button type="button" class="ghost" data-teamedit>⚽ בחירת קבוצה</button>';
    return h;
  }
  TVG.teamFavHtml = teamFavHtml;

  // ---------- הבורר (בתוך חלון המועדפים) ----------
  var FROM = "", DET = null, Q = "", ADD_SP = null;
  var SPN = { fb: "⚽ כדורגל", bb: "🏀 כדורסל", "": "שניהם" };
  function det() { if (!DET || DET.G !== TVG.G) { DET = detect(new Date()); DET.G = TVG.G; } return DET; }
  function detOf(k) { return det().filter(function (d) { return d.k === k; })[0] || null; }
  function multi(t) { var d = detOf(tKey(t)); return !!(d && d.sp.length > 1) || !!t.sport; }
  function selHtml() {
    if (!TVG.TEAMS.length) return "";
    return '<div class="tmsel">' + TVG.TEAMS.map(function (t, i) {
      var h = '<div class="tmone"><div class="tmn"><b>' + icon(t) + " " + bd(t.n) + '</b><button type="button" class="tnx" data-teamdel="' + i + '" aria-label="הסרה: ' + esc(t.n) + '">✕</button></div>';
      if (multi(t)) h += '<p class="tmq">באיזה ענף?</p><div class="chips tmsp" role="group" aria-label="ענף">' + ["fb", "bb", ""].map(function (s) { return '<button type="button" class="chip" data-teamsp="' + i + "|" + s + '" aria-pressed="' + ((t.sport || "") === s) + '">' + SPN[s] + "</button>"; }).join("") + "</div>";
      return h + "</div>";
    }).join("") + "</div>";
  }
  function sugHtml() {
    var q = key(Q), all = det(), list;
    if (q) list = all.filter(function (d) { return d.k.indexOf(q) >= 0 || canon(d.n).indexOf(canon(Q).trim()) >= 0; }).slice(0, 14);
    else list = all.filter(function (d) { return d.c > 0; }).slice(0, 12);
    var h = list.map(function (d) { var on = hasTeam(d.k); return '<button type="button" class="chip" data-teampick="' + esc(d.k) + '" aria-pressed="' + on + '">' + (on ? "✓ " : "") + bd(d.n) + "</button>"; }).join("");
    if (q && !list.some(function (d) { return d.k === q; }) && !hasTeam(q)) h += generic(q) ? "" : '<button type="button" class="chip tmfree" data-teamfree>+ להוסיף ״' + bd(Q.trim()) + "״</button>";
    var hint = q && generic(q) ? '<p class="tmhint">איזו ' + bd(Q.trim()) + "? כתבו את השם המלא, למשל " + bd(Q.trim() + (/מכבי/.test(q) ? " חיפה" : /הפועל/.test(q) ? " באר שבע" : " ירושלים")) + "</p>" : q && !list.length ? '<p class="tmhint">לא מצאנו משחקים של ' + bd(Q.trim()) + " השבוע. אפשר להוסיף בכל זאת, ונציג כשיופיעו.</p>" : "";
    return hint + (h ? '<div class="chips" role="group" aria-label="קבוצות">' + h + "</div>" : "");
  }
  function pickHtml() {
    return '<h2>⚽ הקבוצה שלי</h2><p class="remnote">נציג את כל המשחקים של הקבוצה בשבוע הקרוב, בכל הערוצים, ונוכל להזכיר לך על כל משחק.</p>' +
      '<div id="tmSel">' + selHtml() + "</div>" +
      '<input type="search" id="tmFind" placeholder="חיפוש קבוצה, למשל מכבי חיפה" aria-label="חיפוש קבוצה" autocomplete="off" value="' + esc(Q) + '">' +
      '<p class="tmlbl" id="tmLbl">' + (Q ? "תוצאות" : "משחקות השבוע") + '</p><div id="tmSug">' + sugHtml() + "</div>" +
      '<button type="button" class="btn" data-teamdone>סיום</button>';
  }
  function refresh() { var a = $("#tmSel"), b = $("#tmSug"), l = $("#tmLbl"); if (a) a.innerHTML = selHtml(); if (b) b.innerHTML = sugHtml(); if (l) l.textContent = Q.trim() ? "תוצאות" : "משחקות השבוע"; }
  function openTeams(from) {
    FROM = from || ($("#favs").hidden ? "dial" : "favs"); Q = ""; DET = null;
    $("#favBody").innerHTML = pickHtml(); $("#favs").hidden = false; $("#scrim2").hidden = false;
    var sh = $("#favs"); if (sh) sh.scrollTop = 0;
  }
  TVG.openTeams = openTeams;
  function addTeam(n, k, sport) {
    if (hasTeam(k)) return;
    TVG.TEAMS.push({ n: n, k: k, sport: sport || "" }); saveTeams(); TVG.teamLib.reset();
  }
  function done() {
    if (FROM === "favs") { $("#favBody").innerHTML = TVG.favHtml(); } else TVG.closeFavs();
    TVG.render();
    if (AUTO) teamSync(false);
  }
  document.addEventListener("input", function (e) { if (e.target && e.target.id === "tmFind") { Q = e.target.value; refresh(); } });
  document.addEventListener("keydown", function (e) { if (e.target && e.target.id === "tmFind" && e.key === "Enter") { e.preventDefault(); var f = $("[data-teamfree]"), c = $("#tmSug [data-teampick]"); if (f) f.click(); else if (c) c.click(); } });
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    if (t.closest("[data-teamedit]")) { openTeams(); return; }
    if (t.closest("[data-teamdone]")) { done(); return; }
    if (t.closest("[data-teammore]")) { OPEN = true; TVG.render(); return; }
    if (t.closest("[data-teamreps]")) { OPEN = true; REPOPEN = true; TVG.render(); return; }
    var pk = t.closest("[data-teampick]");
    if (pk) {
      var k = pk.getAttribute("data-teampick"), d = detOf(k);
      if (hasTeam(k)) { var i0 = -1; TVG.TEAMS.forEach(function (x, i) { if (tKey(x) === k) i0 = i; }); delTeam(i0); return; }
      addTeam(d ? d.n : k, k, d && d.sp.length === 1 ? "" : "");
      Q = ""; var inp = $("#tmFind"); if (inp) inp.value = ""; refresh();
      return;
    }
    if (t.closest("[data-teamfree]")) { var q = Q.trim(), k2 = key(q); if (!generic(k2)) { addTeam(nice(q), k2, ""); Q = ""; var inp2 = $("#tmFind"); if (inp2) inp2.value = ""; refresh(); } return; }
    var dl = t.closest("[data-teamdel]"); if (dl) { delTeam(+dl.getAttribute("data-teamdel")); return; }
    var sp = t.closest("[data-teamsp]");
    if (sp) { var a = sp.getAttribute("data-teamsp").split("|"), tm = TVG.TEAMS[+a[0]]; if (tm) { tm.sport = a[1]; saveTeams(); refresh(); } return; }
    if (t.closest("[data-teamauto]")) { toggleAuto(); return; }
  });
  function delTeam(i) {
    var x = TVG.TEAMS[i]; if (!x) return;
    TVG.TEAMS.splice(i, 1); saveTeams(); refresh(); if ($("#favs").hidden) TVG.render();
    TVG.pill("הוסרה " + x.n, 3500, "החזר", function () { if (!hasTeam(tKey(x))) { TVG.TEAMS.splice(Math.min(i, TVG.TEAMS.length), 0, x); saveTeams(); refresh(); TVG.render(); } });
  }
  function toggleAuto() {
    if (AUTO && !TVG.srv()) { needSetup(); return; } // מופעל אבל אין התראות: ההקשה מפעילה אותן
    AUTO = !AUTO; TVG.store("tvg.teamAuto", AUTO ? "1" : "0");
    if (!AUTO) { TVG.render(); TVG.pill("לא נזכיר אוטומטית. התזכורות שכבר נוספו נשארות", 3000); return; }
    if (!TVG.srv()) { TVG.render(); needSetup(); return; }
    var n = teamSync(false);
    if (!n) { TVG.render(); TVG.pill("⏰ מעכשיו נזכיר לך על כל משחק חדש", 2600); }
  }
  function needSetup() {
    var g = games(TVG.TEAMS, new Date()).games.filter(function (x) { return x.p.s > new Date(); })[0];
    TVG.rem = g ? { id: g.c.id, p: g.p } : null; TVG.askCal();
  }
  // בעלייה: אחרי שהלוח נטען (boot.js קורא ל-render ראשון) – משחקים חדשים מקבלים תזכורת
  var bootT = setInterval(function () { if (!TVG.G) return; clearInterval(bootT); setTimeout(function () { teamSync(true); }, 400); }, 300);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && TVG.G) { TVG.teamLib.reset(); teamSync(false); } });
})(window.TVG);
