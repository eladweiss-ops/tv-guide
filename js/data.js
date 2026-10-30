/* js/data.js - נתונים: טעינת guide.json, סיווג ערוצים/ז'אנרים, איחוד כפילויות, אינדקס, בחירת ערוצים וימים.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core. */
(function (TVG) {
  TVG.files["data"] = 1;
  var esc = TVG.esc, DAYS = TVG.DAYS, dstr = TVG.dstr, sel = TVG.sel;
  TVG.allDays = allDays;
  TVG.chans = chans;
  TVG.chipsHtml = chipsHtml;
  TVG.classify = classify;
  TVG.dObj = dObj;
  TVG.dayLabel = dayLabel;
  TVG.index = index;
  TVG.load = load;
  TVG.needsPick = needsPick;
  TVG.normKey = normKey;
  TVG.synText = synText;

  // קבוצות לפי ספק, וז'אנרים לפי מילות מפתח בשם הערוץ. שתיהן משוערות, ואפשר לתקן ברשימות כאן.
  var GROUPS = [["broad", "ברודקאסט (ערוצי חינם)"], ["sport", "ערוצי ספורט"], ["hot", "HOT"], ["yes", "yes"], ["both", "ערוצים משותפים ל-yes ול-HOT"], ["other", "ערוצים נוספים"]];
  TVG.GROUPS = GROUPS;
  var GENRES = [["news", "חדשות"], ["sport", "ספורט"], ["kids", "ילדים"], ["movies", "סרטים וסדרות"], ["ent", "בידור"], ["docu", "דוקו וידע"], ["music", "מוזיקה"]];
  TVG.GENRES = GENRES;
  var GNAME = {};
  TVG.GNAME = GNAME; GENRES.forEach(function (g) { GNAME[g[0]] = g[1]; });
  var BROAD = /קשת|רשת|כאן|עכשיו|^(9|14|24)\b|ערוץ (9|14|24)\b|כנסת|i24|הלא|מכאן|הכלכלה/i;
  var GEN_RX = [
    ["sport", /ספורט|sport|\bone\b|eurosport|5\s?(gold|max|stars|live)|ווינר|nba|nfl|ליגת|ליגה|ל\. |fight|golf|motor|mutv|פורמולה/i],
    ["news", /חדשות|news|cnn|bbc|i24|פוקס|fox|ג'זירה|jazeera|bloomberg|euronews|כנסת|הכלכלה|france|\bdw\b|rt\b/i],
    ["kids", /ילדים|ניקלודיאון|nick|נאנו|nano|דיסני|disney|cartoon|קרטון|baby|הופ|\bhop\b|ג'וניור|junior|boomerang|בומרנג|kids|טלג'ם|zoomoo|טיני|tiny|פו\b/i],
    ["music", /מוזיק|מוסיק|mtv|music|שירים|radio|רדיו|vh1|stingray|גלגל/i],
    ["docu", /דוקו|docu|nat ?geo|נשיונל|discovery|דיסקברי|history|היסטור|animal|אנימל|science|מדע|טבע|תרבות|travel|טיול|food|אוכל|תעודה|crime|investigation|life ?style|פנאי/i],
    ["movies", /סרטים|movies|cinema|סינמה|film|פילם|action|אקשן|drama|דרמה|comedy|קומדי|stars|thriller|טרילר|סדרות|series|סטארס|מוביז/i],
    ["ent", /בידור|\be!|!e\b|e!|ויוה|viva|fun\b|פאן|ריאליטי|reality|lifetime|סמולטוק|hot3|הוט 3/i]
  ];
  function grpOf(c) {
    var n = c.name;
    if (BROAD.test(n)) return "broad";
    if (genOf(c) === "sport") return "sport";
    if (/(^|\s)hot(\s|$)|^הוט/i.test(n)) return "hot";
    if (/(^|\s)yes(\s|$)|^יס/i.test(n)) return "yes";
    if (c.prov === "hot") return "hot";
    if (c.prov === "yes") return "yes";
    if (c.prov === "both") return "both";
    return "other";
  }
  function genOf(c) { for (var i = 0; i < GEN_RX.length; i++) if (GEN_RX[i][1].test(c.name)) return GEN_RX[i][0]; return ""; }
  var GRANK = {}; GROUPS.forEach(function (g, i) { GRANK[g[0]] = i; });
  // שמות שוואלה נותנת לערוצים, והשם שמוצג במקומם. אפשר להוסיף שורות.
  var ALIAS = { "רשת SD": "רשת 13", "HD כאן": "כאן 11", "קשת": "קשת 12", "עכשיו 14": "ערוץ 14", "מוסיקה 24": "ערוץ 24", "מוזיקה 24": "ערוץ 24", "SPORT 3": "ספורט 3", "SPORT 3 HD": "ספורט 3", "SPORT 4": "ספורט 4", "SPORT 4 HD": "ספורט 4", "SPORT 1": "ספורט 1", "SPORT 2": "ספורט 2",
    "ערוץ הספורט": "ספורט 5", "5+ LIVE": "5 LIVE", "5LIVE HD": "5 LIVE", "5+ GOLD": "5 GOLD", "5GOLD": "5 GOLD", "Sport 5 Stars": "5 STARS", "5MAX": "5 MAX",
    "ערוץ ONE": "ONE", "ערוץ ONE HD": "ONE", "ONE 2 HD": "ONE 2" };
  // פענוח ישויות HTML בשמות (וואלה שולחת למשל &#x27; במקום גרש)
  function unent(t) {
    return String(t == null ? "" : t).replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  }
  // שמות שוואלה מחזירה מקולקלים ("?¥?¾??!"). אי אפשר לשחזר אותם, אז כאן שם ידני לפי מספר ערוץ. 3185 הוא ערוץ פעוטות לפי התוכניות שלו (ניחוש), ואפשר לתקן.
  var NAMEFIX = { "3185": "ערוץ פעוטות (HOT 3185)", "521": "ספורט 5 HD · HOT" }; // 521: בוואלה זה לוח אחר לגמרי מערוץ הספורט
  function garbled(n) { return (n.match(/\?/g) || []).length >= 2 || /[¥¾µ°´²]/.test(n); }
  // איחוד אוטומטי: רק אותו ספק ואותו מפתח (בלי HD/SD/העתק). בין ספקים הלוחות שונים, ולכן לא מאחדים.
  function normKey(n) {
    return n.toLowerCase().replace(/\(copy\)|משוכפל|חדש/g, "").replace(/(^|[^a-z])f?hd(?![a-z])|(^|[^a-z])sd(?![a-z])/g, "$1$2").replace(/^ערוץ\s+/, "").replace(/(\d)\+\s+/g, "$1").replace(/[^\p{L}\p{N}+]/gu, "");
  }
  // קבוצות שבדקתי ידנית שהן אותו ערוץ בעל לוח זהה אבל השם שונה (אפשר להוסיף שורות)
  var MERGE = [["301", "3630", "3785", "3786"], ["3547", "3727"], ["205", "149"], ["353", "3179"],
    ["322", "3600"], ["66", "321"], ["3550", "3551"]]; // 5 LIVE; 5 GOLD; ONE (נבדק: לוחות זהים)
  function cleanName(n) { return n.replace(/\s*[-–]?\s*(\(copy\)|משוכפל)/ig, "").replace(/\s+f?hd(?=\s|$)/ig, "").replace(/^hd\s+/i, "").replace(/\s+חדש$/, "").replace(/\s+/g, " ").trim() || n; }
  TVG.IDMAP = {};
  function classify() {
    TVG.G.channels.forEach(function (c) {
      c.name = unent(c.name);
      if (NAMEFIX[c.id]) c.name = NAMEFIX[c.id];
      else if (garbled(c.name)) c.name = "ערוץ " + (c.prov === "yes" ? "yes" : "HOT") + " " + c.id;
      if (ALIAS[c.name]) c.name = ALIAS[c.name];
    });
    var grp = {}, order = [];
    function add(k, c) { if (!grp[k]) { grp[k] = []; order.push(k); } grp[k].push(c); }
    var manual = {}; MERGE.forEach(function (m, i) { m.forEach(function (id) { manual[id] = "m" + i; }); });
    TVG.G.channels.forEach(function (c) { add(manual[c.id] || (normKey(c.name) + "|" + (c.prov || "")), c); });
    TVG.IDMAP = {};
    var out = [];
    order.forEach(function (k) {
      var m = grp[k].slice().sort(function (a, b) { return +a.id - +b.id; }), lead = m[0];
      var hot = m.some(function (c) { return c.prov === "hot" || c.prov === "both"; }), yes = m.some(function (c) { return c.prov === "yes" || c.prov === "both"; });
      lead.prov = hot && yes ? "both" : hot ? "hot" : yes ? "yes" : "";
      lead.name = cleanName(lead.name);
      m.forEach(function (c) { TVG.IDMAP[c.id] = lead.id; });
      out.push(lead);
    });
    TVG.G.channels = out;
    TVG.G.channels.forEach(function (c) { c._g = grpOf(c); c._n = genOf(c); });
    var heb = function (n) { return /[\u0590-\u05FF]/.test(n) ? 0 : 1; };
    // ערוצי ספורט לפי המספר: ספורט 1, 2, 3, 4, 5, 5+, ... ואחריהם השאר
    var sk = function (c) {
      if (c._g !== "sport") return 0;
      var n = c.name, m;
      if ((m = n.match(/^ספורט\s*([1-46-9])$/))) return +m[1] * 10;           // ספורט 1-4, 6
      if (/^ספורט 5$/.test(n)) return 50;
      if (/^(ספורט )?5\s*(\+|פלוס)$/.test(n)) return 51;
      if (/^5 LIVE$/i.test(n)) return 52;
      if (/^5 GOLD$/i.test(n)) return 53;
      if (/^5 STARS$/i.test(n)) return 54;
      if (/^5 MAX$/i.test(n)) return 55;
      if (/^ONE$/i.test(n)) return 70;
      if (/^ONE 2$/i.test(n)) return 71;
      if (/eurosport/i.test(n)) return 80;
      return 100;
    };
    // ערוצי החינם לפי מספר הערוץ: כאן 11, קשת 12, רשת 13, ערוץ 14 ... ערוץ 24, ואחריהם ערוצים בלי מספר
    var bk = function (c) { if (c._g !== "broad") return 0; var n = TVG.chNum(c); return n == null ? 500 : n; };
    TVG.G.channels.sort(function (a, b) { return GRANK[a._g] - GRANK[b._g] || bk(a) - bk(b) || sk(a) - sk(b) || heb(a.name) - heb(b.name) || a.name.localeCompare(b.name, "he"); });
  }

  // נתוני דוגמה (קשת בלבד): מוצגים רק כשהדף לא מצליח לקרוא את guide.json.
  function sample() {
    var R = {
      "2026-10-20": [["00:30","אולפן שישי - הכתבות"],["01:30","המטבח המנצח VIP"],["02:35","קליפ טיים"],["03:10","מאסטר שף"],["04:15","המרכיב העיקרי: במטבח של אבי ביטון"],["06:00","מבזק חדשות"],["07:10","חדשות הבוקר"],["09:35","חדשות הבוקר"],["11:00","חדשות האוכל"],["14:00","12 בצוהריים"],["15:00","מהדורת היום"],["16:55","חמש עם"],["17:55","שש עם..."],["19:00","שבע עם"],["19:50","המהדורה המרכזית"],["21:30","ארץ נהדרת"],["22:45","אברי ושרקי"],["23:30","תשדירי תעמולה לבחירות לכנסת ה-26"]]
    };
    var programs = [];
    Object.keys(R).forEach(function (d) { R[d].forEach(function (r) { programs.push({ ch: "3819", start: d + "T" + r[0], title: r[1] }); }); });
    return { updated: null, channels: [{ id: "3819", name: "קשת" }], programs: programs };
  }

  function load() {
    return fetch("guide.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { if (!j.programs || !j.programs.length) throw 0; return { g: j, s: false }; })
      .catch(function () { return { g: sample(), s: true }; });
  }

  function index() {
    TVG.by = new Map();
    var seen = {};
    TVG.G.channels.forEach(function (c) { TVG.by.set(c.id, []); seen[c.id] = {}; });
    [true, false].forEach(function (leadPass) {
      TVG.G.programs.forEach(function (p) {
        var lid = TVG.IDMAP[p.ch] || p.ch;
        if ((lid === p.ch) !== leadPass || !TVG.by.has(lid)) return;
        if (seen[lid][p.start]) { var ex = seen[lid][p.start]; if (ex !== 1 && !ex.desc && p.desc) ex.desc = p.desc; if (ex !== 1 && ex.lv < 0 && (p.lv === 0 || p.lv === 1)) ex.lv = p.lv; return; }
        var o = { title: unent(p.title), desc: p.desc || "", s: TVG.parse(p.start), rr: p.rr ? 1 : 0, lv: p.lv === 1 ? 1 : p.lv === 0 ? 0 : -1 };
        seen[lid][p.start] = o; TVG.by.get(lid).push(o);
      });
    });
    // אותה תוכנית בשעה אחרת באותו ערוץ - אותו תקציר. רק כשלכותרת יש תקציר אחד בלבד
    // (כותרות כלליות כמו "NBA" או "ליגת ווינר" מופיעות עם תקצירים שונים, ולא מעתיקים אותן)
    TVG.by.forEach(function (a) {
      var dt = {};
      a.forEach(function (p) { if (p.desc) { var e = dt[p.title]; if (!e) dt[p.title] = p.desc; else if (e !== p.desc) dt[p.title] = 1; } });
      a.forEach(function (p) { var d = dt[p.title]; if (!p.desc && d && d !== 1) p.desc = d; });
    });
    TVG.by.forEach(function (a) {
      a.sort(function (x, y) { return x.s - y.s; });
      a.forEach(function (p, i) { p.e = a[i + 1] ? a[i + 1].s : new Date(p.s.getTime() + 3600000); });
    });
  }

  var MANY = 8;
  window.__tvgAudit = function () { var o = {}; TVG.by.forEach(function (a, id) { o[id] = a.map(function (p) { return [p.s.getTime(), p.title, p.desc]; }); }); return { ch: TVG.G.channels.map(function (c) { return [c.id, c.name, c._g]; }), map: TVG.IDMAP, by: o }; };
  function needsPick() { return TVG.G.channels.length > MANY && !sel.size; }
  function baseChans() {
    var l = TVG.G.channels.filter(function (c) { return sel.has(c.id); });
    return l.length ? l : (TVG.G.channels.length > MANY ? [] : TVG.G.channels);
  }
  function chans() {
    var l = baseChans();
    if (TVG.gen !== "all") {
      var f = l.filter(function (c) { return c._n === TVG.gen; });
      if (f.length) l = f; else TVG.gen = "all";
    }
    return l;
  }
  function chipsHtml() {
    var cnt = {}, kinds = 0;
    baseChans().forEach(function (c) { if (c._n) { if (!cnt[c._n]) kinds++; cnt[c._n] = (cnt[c._n] || 0) + 1; } });
    if (kinds < 2) return "";
    return '<div class="chips" role="group" aria-label="סינון לפי סוג"><button type="button" class="chip" data-chip="all" aria-pressed="' + (TVG.gen === "all") + '">הכל</button>' +
      GENRES.filter(function (g) { return cnt[g[0]]; }).map(function (g) {
        return '<button type="button" class="chip" data-chip="' + g[0] + '" aria-pressed="' + (TVG.gen === g[0]) + '">' + g[1] + " (" + cnt[g[0]] + ")</button>";
      }).join("") + "</div>";
  }
  function allDays() {
    var s = new Set(); TVG.by.forEach(function (a) { a.forEach(function (p) { s.add(dstr(p.s)); }); });
    var all = Array.from(s).sort(), td = dstr(new Date()), fut = all.filter(function (d) { return d >= td; });
    return (fut.length ? fut : all).slice(0, 8); // כל מה שיש בלוח (בדרך כלל שבוע)
  }
  function dObj(ds) { var p = ds.split("-"); return new Date(+p[0], p[1] - 1, +p[2]); }
  function dayLabel(ds) { var d = dObj(ds); return (ds === dstr(new Date()) ? "היום" : DAYS[d.getDay()]) + " " + d.getDate() + "." + (d.getMonth() + 1); }
  function synText(p, cid) {
    if (p.desc) return p.desc.length > 150 ? '<p class="clamp">' + esc(p.desc) + '</p><button type="button" class="moreb" data-more>עוד…</button>' : "<p>" + esc(p.desc) + "</p>";
    var qq = encodeURIComponent(p.title + " " + (cid ? TVG.chName(cid) : "") + " תקציר");
    return '<p class="none">אין לנו תקציר לתוכנית הזו. <a class="gsearch" href="https://www.google.com/search?q=' + qq + '" target="_blank" rel="noopener">🔎 חיפוש בגוגל</a></p>';
  }
  var descHtml = function (p, cid, small) { return synText(p, cid) + TVG.remBtn(p, cid, small) + (cid ? TVG.favBtn(p) : ""); };
  TVG.descHtml = descHtml;
})(window.TVG);
