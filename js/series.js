/* js/series.js - 📺 מעקב אחרי סדרה: מסווג "שידור ראשי" מול שידור חוזר, מצב המעקב (tvg.fol), סנכרון לשרת (/api/follow), החלון התחתון, שורה אחת בלשונית התזכורות.
   התזכורות עצמן נגזרות בשרת (calendar-server/api/_fol.js) ולא נכתבות לרשימת התזכורות הרגילה (TVG.REMS). המסווג כאן הוא עותק של calendar-server/api/_series.js - שינוי באחד = שינוי בשני (נבדק ב-calendar-server/test/series-parity.test.mjs).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, search. */
(function (TVG) {
  TVG.files["series"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr, API = TVG.CAL_API;
  TVG.folAirings = airingsOf;
  TVG.folClassify = classify;
  TVG.folInfo = info;
  TVG.folDayCap = dayCap;
  TVG.folFill = fillTwins;
  TVG.folGeneric = isGeneric;
  TVG.folIdOk = function (s) { return ID_RE.test(s); };
  TVG.folKey = seriesKey;
  TVG.folOpen = openFol;
  TVG.folOpt = folOpt;
  TVG.folPull = folPull;
  TVG.folRem = folRem;
  TVG.folRows = folRows;
  TVG.folSync = folSync;
  TVG.folTitle = seriesTitle;
  TVG.folFind = folFind;
  TVG.folParse = parseTitle;

  // <core>
  // ---- מסווג ועזרים (נוסח אחד לשרת ולקוח: calendar-server/api/_series.js ו-js/series.js; test/series-parity.test.mjs בודק שהקטע זהה) ----
  var ID_RE = /^(x[a-z0-9]{1,12}|\d{1,6})$/; // מזהה ערוץ: מספר, או x14 / xi24 / xknesset / xkids
  function normT(s) { var t = String(s || "").toLowerCase(); try { t = t.normalize("NFD"); } catch (e) {} return t.replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9֐-׿]+/g, ""); }
  // סימוני שיווק בכותרת ("בכורה:", "חדש !", "- בכורה!", "-חדש בערוץ!", "(חדש)") אינם חלק משם הסדרה
  function stripMarks(t) {
    var p = t, i;
    for (i = 0; i < 3; i++) {
      p = p.replace(/\s*\(\s*(?:חדש|בכורה|שידור חוזר)\s*!?\s*\)\s*$/, "").replace(/\s*[-–]\s*(?:בכורה|חדש(?: בערוץ)?)\s*!?\s*$/, "").replace(/^(?:בכורה|חדש)\s*[:!]\s*/, "").trim();
    }
    return normT(p).length >= 2 ? p : t;
  }
  // כותרת תוכנית -> {stem, ep}. ep = מזהה הפרק אם הוא מופיע בכותרת ("הנדר 4 - פרק 130" -> stem "הנדר 4", ep "e130"; "טילדה 2: 7" -> ep "e7").
  // בכוונה לא חותכים לפי ":" או " - " בכלל (אחרת "NCIS: ההתחלה" ו-"NCIS" היו נבלעות באותה סדרה): רק סימון פרק מפורש בסוף הכותרת
  function parseTitle(title) {
    var t = stripMarks(String(title || "").replace(/\s+/g, " ").trim());
    var m = t.match(/^(.*?)\s*[-–]\s*פרק\s*(\d+)\s*$/) || t.match(/^(.*\S)\s+פרק\s*(\d+)\s*$/) || t.match(/^(.*?\S)\s*:\s*(\d{1,4})\s*$/);
    if (m && normT(m[1]).length >= 2) return { stem: stripMarks(m[1].trim()), ep: "e" + (+m[2]) };
    m = t.match(/^(.*?)\s*[-–]\s*(?:עונה חדשה|פרק חדש|ספיישל)\s*$/);
    if (m && normT(m[1]).length >= 2) return { stem: stripMarks(m[1].trim()), ep: "" };
    return { stem: t, ep: "" };
  }
  function seriesTitle(title) { return parseTitle(title).stem; }
  // מפתח הסדרה (קצר, בלי "|"): נרמול הגזע. המפתח הוא זהות העוקב, ולכן נגזר רק מהכותרת
  function seriesKey(title) { return normT(seriesTitle(title)).slice(0, 32); }
  var NEW_RX = /עונה חדשה|פרק חדש|בכורה|חדש!|\(חדש\)|חדש בערוץ/, RERUN_RX = /ש\.ח|\(שח\)|שידור חוזר|מקוצר/, LIVE_RX = /ישיר|LIVE/i;
  var MAX_PER_DAY = 1, MAX_PER_DAY_ALL = 4, NEAR_MIN = 20;
  var GENERIC = ["nba", "חדשות", "סרט", "ספורט", "מבזקחדשות", "מבזק", "חדשותהבוקר", "חדשותהערב", "מהדורתחדשות", "סרטעלילתי", "סדרה", "תוכנית", "פרסומות", "תשדירי"];
  // כותרות כלליות (NBA, חדשות, סרט, ספורט, או יותר מ-15 שידורים ליום בין הערוצים) הן נושא ולא סדרה: אין "לעקוב אחרי הסדרה" (rows: כל שידורי הכותרת בלוח)
  function isGeneric(title, rows) {
    if (GENERIC.indexOf(normT(seriesTitle(title))) >= 0) return true;
    var days = {}, n = 0, seen = {};
    (rows || []).forEach(function (r) { var k = r.start + "|" + r.title; if (seen[k]) return; seen[k] = 1; days[String(r.start).slice(0, 10)] = 1; n++; }); // תאומי SD/HD נספרים פעם אחת
    var d = Object.keys(days).length;
    return d > 0 && n / d > 15;
  }
  function dowOf(stamp) { return new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(5, 7) - 1, +stamp.slice(8, 10))).getUTCDay(); }
  function minOf(stamp) { return Date.UTC(+stamp.slice(0, 4), +stamp.slice(5, 7) - 1, +stamp.slice(8, 10), +stamp.slice(11, 13), +stamp.slice(14, 16)) / 60000; }
  // אותו שידור בערוצים תאומים (אותה שעה ואותה כותרת): התקציר של אחד משלים את השני (למשל "הכוורת": תקציר רק בערוץ אחד)
  function fillTwins(rows) {
    var by = {};
    rows.forEach(function (r) { if (r.desc) by[r.start + "|" + r.title] = by[r.start + "|" + r.title] || r.desc; });
    return rows.map(function (r) { if (r.desc) return r; var d = by[r.start + "|" + r.title]; if (!d) return r; var o = {}; for (var k in r) o[k] = r[k]; o.desc = d; return o; });
  }
  // airings: [{ch, start, title, desc?, rr?, lv?}] של סדרה אחת. מחזיר [{...airing, primary, why, epk}].
  // כללים: ישיר -> ראשי · rr/"שידור חוזר" -> חוזר · "חדש"/"בכורה" -> ראשי · 00:00-06:00 -> חוזר (חוץ מישיר/חדש מפורש; לא נספר כ"פרק שכבר שודר") ·
  // אותו פרק (מספר בכותרת, אחרת תקציר מנורמל; תקציר שחוזר 4+ פעמים ב-4+ ימים הוא גנרי) -> המוקדם ראשי, השאר חוזרים ·
  // בלי מזהה פרק: ראשי רק במשבצת (ערוץ+שעה, ±20 דק׳) של ראשי מוכח; בלי ראיות: משבצת דומיננטית (שעה שכיחה, בלי יום בשבוע; ערב עדיף); 3+ שידורים בשעות שונות בלי שום תקציר = מרתון חוזרות
  function classify(airings) {
    var out = airings.map(function (a) { var o = {}; for (var k in a) o[k] = a[k]; o.primary = true; o.why = ""; o.epk = ""; return o; });
    var order = out.map(function (_, i) { return i; }).sort(function (i, j) { return out[i].start < out[j].start ? -1 : out[i].start > out[j].start ? 1 : 0; });
    var descN = {}, descDays = {};
    out.forEach(function (a) { var d = normT(a.desc).slice(0, 60); if (d.length >= 12) { descN[d] = (descN[d] || 0) + 1; (descDays[d] = descDays[d] || {})[a.start.slice(0, 10)] = 1; } });
    function generic(d) { return descN[d] >= 4 && Object.keys(descDays[d]).length >= 4; }
    function epOf(a) { var pe = parseTitle(a.title).ep; if (pe) return "t:" + pe; var d = normT(a.desc).slice(0, 60); return d.length >= 12 && !generic(d) ? "d:" + d : ""; }
    var seen = {}, pending = [];
    order.forEach(function (i) {
      var a = out[i], txt = a.title + " " + (a.desc || ""), ep = epOf(a);
      a.epk = ep;
      if (a.lv === 1 || LIVE_RX.test(a.title)) { a.primary = true; a.why = "live"; if (ep && !seen[ep]) seen[ep] = a.start; return; }
      if (a.rr || RERUN_RX.test(txt)) { a.primary = false; a.why = "rr"; return; }
      if (NEW_RX.test(txt)) { a.primary = true; a.why = "new"; if (ep && !seen[ep]) seen[ep] = a.start; return; }
      if (+a.start.slice(11, 13) < 6) { a.primary = false; a.why = "night"; return; }
      if (ep) { if (seen[ep] != null && seen[ep] < a.start) { a.primary = false; a.why = "seen"; } else { a.primary = true; a.why = "first"; seen[ep] = a.start; } return; }
      pending.push(i);
    });
    if (pending.length) {
      var proven = out.filter(function (a) { return a.primary && (a.why === "live" || a.why === "new" || a.why === "first"); });
      var near = function (a) { var m = minOf(a.start) % 1440; return proven.some(function (p) { if (p.ch !== a.ch) return false; var d = Math.abs(minOf(p.start) % 1440 - m); return Math.min(d, 1440 - d) <= NEAR_MIN; }); };
      var slot = function (a) { return a.ch + "|" + a.start.slice(11, 16); };
      var cnt = {}; pending.forEach(function (i) { var s = slot(out[i]); cnt[s] = (cnt[s] || 0) + 1; });
      var score = function (s) { return cnt[s] + (+s.split("|")[1].slice(0, 2) >= 19 ? 0.5 : 0); };
      var ks = Object.keys(cnt), best = Math.max.apply(null, ks.map(score)), maxCnt = Math.max.apply(null, ks.map(function (s) { return cnt[s]; }));
      pending.forEach(function (i) {
        var a = out[i];
        if (proven.length) { a.primary = near(a); a.why = a.primary ? "slot" : "slot-rr"; }
        else if (pending.length < 3) { a.primary = true; a.why = "single"; }
        else if (maxCnt >= 2) { a.primary = score(slot(a)) >= best - 1e-9; a.why = a.primary ? "slot" : "slot-rr"; }
        else { a.primary = false; a.why = "marathon"; }
      });
    }
    return out;
  }
  // תקרה ליום (שעון ישראל): ברירת מחדל שידור אחד ביום (הבולט: ישיר/חדש, אחר כך ערב, אחר כך המוקדם); שני רק אם שניהם ישיר/חדש מפורש, בהפרש 3 שעות ומפרקים שונים.
  // mode "all" (גם שידורים חוזרים): עד 4 ביום. rows: [{start, why, epk}] (אחרי סינון ראשי/חוזר); מחזיר את הנבחרים לפי סדר זמן
  function dayCap(rows, mode) {
    var by = {}, out = [];
    rows.forEach(function (r) { (by[r.start.slice(0, 10)] = by[r.start.slice(0, 10)] || []).push(r); });
    var rank = function (r) { var h = +r.start.slice(11, 13); return ((r.why === "live" || r.why === "new") ? 0 : (r.why === "first" || r.why === "slot" || r.why === "single") ? 2 : 4) + (h >= 19 ? 0 : 1); };
    Object.keys(by).forEach(function (d) {
      var arr = by[d].slice().sort(function (a, b) { return rank(a) - rank(b) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0); });
      var pick = [arr[0]];
      for (var i = 1; i < arr.length; i++) {
        var r = arr[i];
        if (mode === "all") { if (pick.length < MAX_PER_DAY_ALL && pick.every(function (p) { return Math.abs(minOf(p.start) - minOf(r.start)) >= 30; })) pick.push(r); continue; }
        var f = pick[0];
        if (pick.length < 2 && (r.why === "live" || r.why === "new") && (f.why === "live" || f.why === "new") && Math.abs(minOf(f.start) - minOf(r.start)) >= 180 && (!r.epk || r.epk !== f.epk)) pick.push(r);
      }
      pick.forEach(function (p) { out.push(p); });
    });
    return out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  }
  // </core>

  // ---------------- שידורי הסדרה בלוח (הלקוח: TVG.by, אחרי איחוד ערוצים) ----------------
  function stamp(d) { return dstr(d) + "T" + hhmm(d); }
  function group(ch) { // כל מזהי הערוצים הגולמיים של ערוץ מאוחד (השרת מסנן לפיהם)
    var ids = Object.keys(TVG.IDMAP || {}).filter(function (id) { return TVG.IDMAP[id] === ch; });
    if (ids.indexOf(ch) < 0) ids.push(ch);
    return ids;
  }
  function leadSet(f) { // chs גולמיים -> קבוצת ערוצים מאוחדים (או null = כל הערוצים)
    if (!f || !f.chs || !f.chs.length) return null;
    var s = {}; f.chs.forEach(function (id) { s[(TVG.IDMAP && TVG.IDMAP[id]) || id] = 1; });
    return s;
  }
  function allRows(title) { // כל שידורי הכותרת (גם בעבר), לכל הערוצים: לזיהוי כותרת כללית
    var k = normT(seriesTitle(title)), rows = [];
    if (!k || !TVG.by) return rows;
    TVG.G.channels.forEach(function (c) { (TVG.by.get(c.id) || []).forEach(function (p) { if (normT(parseTitle(p.title).stem) === k) rows.push({ ch: c.id, start: stamp(p.s), title: p.title, desc: p.desc, rr: p.rr ? 1 : 0, lv: p.lv === 1 ? 1 : 0, _c: c, _p: p }); }); });
    return rows;
  }
  // title: כותרת הסדרה (או תוכנית ממנה); set: קבוצת ערוצים מאוחדים או null. מחזיר שידורים עתידיים מסווגים: [{c, p, ts, primary, why, start, epk}]
  function airingsOf(title, set) {
    var rows = allRows(title).filter(function (r) { return !set || set[r.ch]; }), now = Date.now();
    return classify(fillTwins(rows)).map(function (a) { return { c: a._c, p: a._p, ts: TVG.ilTs(a._p.s), primary: a.primary, why: a.why, start: a.start, epk: a.epk }; })
      .filter(function (a) { return a.ts > now; }).sort(function (x, y) { return x.ts - y.ts; });
  }
  // {n: שידורים עתידיים בכל הערוצים, chans: ערוצים שונים, generic: כותרת כללית (נושא, לא סדרה)}
  function info(title, set) {
    var a = airingsOf(title, set || null), cs = {};
    a.forEach(function (x) { cs[x.c.id] = 1; });
    return { n: a.length, chans: Object.keys(cs).length, generic: isGeneric(title, allRows(title)) };
  }
  // ברירת המחדל לשידורים של מעקב: ראשיים בלבד (או הכול), שידור אחד לערוץ-זמן, תקרה ליום; skip = דילוגים (ts) שהמשתמש ביקש
  function nextOf(f, limit, withSkipped) {
    var seen = {}, rows = [], skip = f.skip || [];
    airingsOf(f.title, leadSet(f)).forEach(function (a) { if ((f.mode === "all" || a.primary) && !seen[a.ts]) { seen[a.ts] = 1; rows.push(a); } });
    var out = dayCap(rows, f.mode === "all" ? "all" : "new").map(function (a) { a.skipped = skip.indexOf(a.ts) >= 0; return a; });
    if (!withSkipped) out = out.filter(function (a) { return !a.skipped; });
    return limit ? out.slice(0, limit) : out;
  }
  var SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];
  function when(p) { // "היום 21:30" / "מחר 21:30" / "יום ב׳ 21:30" / "שבת 21:30"
    var il = TVG.ilNow(), ds = dstr(p.s), t = new Date(il.getTime()); t.setDate(t.getDate() + 1);
    var day = ds === dstr(il) ? "היום" : ds === dstr(t) ? "מחר" : p.s.getDay() === 6 ? "שבת" : "יום " + SHORT[p.s.getDay()];
    return day + " " + hhmm(p.s);
  }
  function bd(s) { return "<bdi>" + esc(TVG.bidi(s)) + "</bdi>"; }

  // ---------------- מצב ----------------
  var TOMB_MS = 30 * 86400000, MAX = 30, MAX_SKIP = 40, MAX_CHS = 64;
  TVG.FOL = [];
  (function () {
    try {
      (JSON.parse(TVG.store("tvg.fol") || "[]") || []).forEach(function (x) {
        if (!x || typeof x.title !== "string" || !x.title) return;
        x.k = seriesKey(x.title); if (!x.k) return;
        if (x.x && Date.now() - (+x.u || 0) > TOMB_MS) return;
        TVG.FOL.push(x);
      });
    } catch (e) { TVG.FOL = []; }
  })();
  function save() { TVG.store("tvg.fol", JSON.stringify(TVG.FOL)); }
  function folFind(k) { for (var i = 0; i < TVG.FOL.length; i++) if (TVG.FOL[i].k === k && !TVG.FOL[i].x) return TVG.FOL[i]; return null; }
  function active() { return TVG.FOL.filter(function (x) { return !x.x; }); }
  function put(f) { TVG.FOL = TVG.FOL.filter(function (x) { return x.k !== f.k; }); TVG.FOL.push(f); save(); }
  function scopeOf(f) { return f.ch ? "ch" : f.chs && f.chs.length ? "mine" : "all"; }
  function mineChs() { var out = []; TVG.chans().forEach(function (c) { group(c.id).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); }); return out.slice(0, MAX_CHS); }
  function hasSel() { return !!(TVG.sel && TVG.sel.size); }

  // ---------------- סנכרון ----------------
  function wire() { // מה שנשלח לשרת: בלי שדות מקומיים
    var now = Date.now();
    return TVG.FOL.map(function (f) {
      var o = { title: f.title, u: f.u };
      if (f.x) { o.x = 1; return o; }
      o.mode = f.mode; o.lead = f.lead; o.ch = f.ch || ""; o.chn = f.chn || ""; o.chs = (f.chs || []).slice(0, MAX_CHS);
      o.skip = (f.skip || []).filter(function (t) { return t > now - 86400000; }).slice(-MAX_SKIP);
      if (f.dbl) o.dbl = 1;
      return o;
    });
  }
  function mergeIn(list) { // מיזוג רשימה מהשרת: לכל מפתח המאוחר (u) מנצח. מחזיר true אם משהו השתנה מקומית
    var changed = false;
    (list || []).forEach(function (s) {
      if (!s || typeof s.title !== "string") return;
      var k = seriesKey(s.title); if (!k) return;
      var cur = null; TVG.FOL.forEach(function (x) { if (x.k === k) cur = x; });
      if (cur && (+cur.u || 0) >= (+s.u || 0)) return;
      var n = { k: k, title: String(s.title).slice(0, 80), u: +s.u || Date.now() };
      if (s.x) n.x = 1;
      else {
        n.mode = s.mode === "all" ? "all" : "new"; n.lead = Number.isFinite(+s.lead) ? +s.lead : 10; n.ch = s.ch || ""; n.chn = s.chn || ""; n.chs = Array.isArray(s.chs) ? s.chs.slice(0, MAX_CHS) : []; n.skip = Array.isArray(s.skip) ? s.skip : [];
        if (s.dbl) n.dbl = 1;
      }
      TVG.FOL = TVG.FOL.filter(function (x) { return x.k !== k; }); TVG.FOL.push(n); changed = true;
    });
    if (changed) save();
    return changed;
  }
  function newerLocal(list) { // יש אצלנו רשומה חדשה (u) ממה שבשרת?
    var by = {}; (list || []).forEach(function (s) { if (s && typeof s.title === "string") by[seriesKey(s.title)] = +s.u || 0; });
    return TVG.FOL.some(function (x) { return by[x.k] == null || by[x.k] < (+x.u || 0); });
  }
  // POST של כל הרשימה. מחזיר Promise<{ok, status}>. בלי פוש אין תזכורות אוטומטיות: נשמר מקומית ויעלה כשיופעלו התראות (folSync נקרא מ-push.js)
  function folSync() {
    if (!TVG.pushOn) { TVG.store("tvg.folDirty", "1"); return Promise.resolve({ ok: false, status: 0 }); }
    var t; try { t = TVG.myTok(); } catch (e) { return Promise.resolve({ ok: false, status: 0 }); }
    return fetch(API + "/api/follow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: t, follows: wire() }) })
      .then(function (r) {
        if (r.status === 403) { TVG.store("tvg.folDirty", "1"); return { ok: false, status: 403 }; }
        if (!r.ok) throw r.status;
        return r.json().catch(function () { return {}; }).then(function (j) {
          TVG.store("tvg.folDirty", "0");
          if (j && Array.isArray(j.follows) && mergeIn(j.follows) && TVG.G) TVG.render(); // מכשיר אחר עדכן בינתיים
          return { ok: true, status: 200, capped: j && j.capped };
        });
      })
      .catch(function (e) { TVG.store("tvg.folDirty", "1"); return { ok: false, status: +e || 0 }; });
  }
  function folPull() { // בעליית האפליקציה: מביאים את הרשימה מהשרת (השרת גם גוזר מחדש אם הלוח התעדכן) וממזגים דו-כיוונית לפי u
    if (!TVG.pushOn || !TVG.calTok) return;
    fetch(API + "/api/follow?t=" + encodeURIComponent(TVG.calTok), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !Array.isArray(j.follows)) return;
      var local = newerLocal(j.follows), ch = mergeIn(j.follows);
      if (ch && TVG.G) TVG.render();
      if (TVG.store("tvg.folDirty") === "1" || local || (TVG.FOL.length && !j.follows.length)) folSync();
    }).catch(function () {});
  }
  if (TVG.store("tvg.folDirty") === "1" && TVG.pushOn) setTimeout(folSync, 4500);
  else if (TVG.pushOn) setTimeout(folPull, 3500);

  // ---------------- החלון התחתון ----------------
  var FS = null; // {title, scope: mine|all|ch, ch, mode, lead, dbl, skip, existing, origin}
  function show(html) { $("#remBody").innerHTML = html; $("#rem").hidden = false; $("#scrim2").hidden = false; }
  function fakeF() { return { title: FS.title, mode: FS.mode, ch: FS.scope === "ch" ? FS.ch : "", chs: FS.scope === "ch" ? group(FS.ch) : FS.scope === "mine" ? mineChs() : [], skip: FS.skip || [] }; }
  function openFol(title, origin) {
    var k = seriesKey(title), ex = folFind(k);
    TVG.rem = null; TVG.LP = null;
    if (ex) FS = { title: ex.title, scope: scopeOf(ex), ch: ex.ch || origin || "", mode: ex.mode, lead: ex.lead, dbl: !!ex.dbl, skip: (ex.skip || []).slice(), existing: true, origin: ex.ch || origin || "" };
    else {
      FS = { title: seriesTitle(title), scope: "all", ch: origin || "", mode: "new", lead: TVG.lead != null ? TVG.lead : 10, dbl: false, skip: [], existing: false, origin: origin || "" };
      // ברירת מחדל: הערוצים שבחרתי (אם יש בחירה ולסדרה יש בהם שידורים), אחרת כל הערוצים
      if (hasSel()) { FS.scope = "mine"; if (!nextOf(fakeF(), 1, true).length) FS.scope = "all"; }
    }
    draw();
  }
  function leadChips() { // אותן אפשרויות ואותו ניסוח כמו בחלון התזכורת (reminder-sheet.js), כולל "בתחילת השידור" ו"וגם בתחילת השידור"
    var O = TVG.leadOpts, cur = FS.lead, inMore = O.more.indexOf(cur) >= 0, std = O.std(cur);
    var h = '<div class="lbl">מתי להזכיר?</div><div class="chips lp" role="group" aria-label="מתי להזכיר">' + O.main.map(function (m) {
      return '<button type="button" class="chip" data-folead="' + m + '" aria-pressed="' + (cur === m) + '">' + esc(O.name(m).replace(" לפני", "")) + "</button>";
    }).join("");
    if (!std) h += '<button type="button" class="chip" data-folead="' + cur + '" aria-pressed="true">' + cur + " דק׳</button>";
    h += '<label class="lpsel' + (inMore ? " on" : "") + '"><select data-folsel aria-label="עוד אפשרויות"><option value=""' + (inMore ? "" : " selected") + ">עוד</option>" +
      O.more.map(function (m) { return '<option value="' + m + '"' + (cur === m ? " selected" : "") + ">" + esc(O.short(m)) + "</option>"; }).join("") + "</select></label></div>";
    if (cur > 0) h += '<div class="chips lp"><button type="button" class="chip" data-foldbl aria-pressed="' + !!FS.dbl + '">🔔 וגם בתחילת השידור</button></div>';
    return h;
  }
  function pushNote() {
    if (TVG.pushOn) return "";
    if (TVG.isIOS && !TVG.isStandalone) return '<p class="credit">התראות ותזכורות אוטומטיות עובדות רק מהאפליקציה שבמסך הבית: בספארי לוחצים על כפתור השיתוף ואז על ״הוסף למסך הבית״.</p>';
    if (TVG.canPush) return '<p class="credit">כדי שנזכיר לך גם כשהאפליקציה סגורה צריך התראות.</p><button type="button" class="ghost sm" data-pushon>🔔 הפעלת התראות</button>';
    return '<p class="credit">המכשיר הזה לא תומך בהתראות, ולכן לא נוכל להזכיר אוטומטית.</p>';
  }
  function scopeChips() {
    var opts = [];
    if (hasSel()) opts.push(["mine", "הערוצים שלי"]);
    opts.push(["all", "כל הערוצים"]);
    if (FS.origin && TVG.chName(FS.origin)) opts.push(["ch", "רק ב־" + bd(TVG.chName(FS.origin))]);
    if (opts.length < 2) return "";
    return '<div class="lbl">באילו ערוצים?</div><div class="chips lp" role="group" aria-label="באילו ערוצים">' + opts.map(function (o) {
      return '<button type="button" class="chip" data-folscope="' + o[0] + '" aria-pressed="' + (FS.scope === o[0]) + '">' + (o[0] === "ch" ? o[1] : esc(o[1])) + "</button>"; }).join("") + "</div>";
  }
  function draw() {
    var f = fakeF(), nx = nextOf(f, 3, true), first = nextOf(f, 1)[0];
    var h = "<h2>📺 " + bd(FS.title) + "</h2>";
    h += '<div class="meta">' + (first ? "<span>הפרק הבא: " + esc(when(first.p)) + " · " + bd(TVG.chName(first.c.id)) + "</span>" : "<span>אין עכשיו שידורים בלוח</span>") + "</div>";
    h += '<div class="lbl">אילו שידורים?</div><div class="chips lp" role="group" aria-label="אילו שידורים">' +
      '<button type="button" class="chip" data-folmode="new" aria-pressed="' + (FS.mode !== "all") + '">רק פרקים חדשים</button>' +
      '<button type="button" class="chip" data-folmode="all" aria-pressed="' + (FS.mode === "all") + '">גם שידורים חוזרים</button></div>';
    h += scopeChips() + leadChips();
    if (nx.length) {
      h += '<div class="lbl">הפרקים הקרובים</div><ul class="folnext">' + nx.map(function (a) {
        return '<li><button type="button" class="fskip' + (a.skipped ? " off" : "") + '" data-folskip="' + a.ts + '" aria-label="' + (a.skipped ? "החזרת הפרק" : "דילוג על הפרק הזה") + ": " + esc(when(a.p)) + '"><span class="fw">' + esc(when(a.p)) + '</span><span class="fc">' + bd(TVG.chName(a.c.id)) + '</span><span class="ft">' + (a.skipped ? "דילגנו" : a.primary ? "✨ חדש" : "🔁 חוזר") + "</span></button></li>";
      }).join("") + '</ul><p class="credit">הקשה על פרק מדלגת עליו (ועוד הקשה מחזירה אותו).</p>';
    } else h += '<p class="remnote">אין כרגע ' + (FS.mode === "all" ? "שידורים" : "פרקים חדשים") + " בלוח. נזכיר לך ברגע שיעלו.</p>";
    h += pushNote();
    // הכפתורים נצמדים לתחתית החלון (הרשימה מעליהם גוללת): כפתור ראשי אחד תמיד בהישג אגודל
    h += '<div class="folbar">' + (FS.existing
      ? '<button type="button" class="btn" data-remclose>סיום</button><button type="button" class="ghost" data-folstop>הפסק לעקוב</button>'
      : '<button type="button" class="btn" data-folgo>📺 לעקוב אחרי הסדרה</button><button type="button" class="ghost" data-remclose>ביטול</button>') + "</div>";
    show(h);
  }
  function applyTo(f) { var x = fakeF(); f.mode = FS.mode; f.lead = FS.lead; f.dbl = FS.dbl && FS.lead > 0 ? 1 : 0; if (!f.dbl) delete f.dbl; f.ch = x.ch; f.chn = x.ch ? TVG.chName(x.ch) : ""; f.chs = x.chs; f.skip = FS.skip.slice(-MAX_SKIP); f.u = Date.now(); }
  function applyChange() { // שינוי הגדרה בסדרה שכבר במעקב: נשמר מיד
    if (!FS.existing) return;
    var f = folFind(seriesKey(FS.title)); if (!f) return;
    applyTo(f); save(); folSync(); TVG.render();
  }
  function go() {
    var k = seriesKey(FS.title), title = FS.title;
    if (active().length >= MAX && !folFind(k)) { TVG.pill("הגעת למקסימום " + MAX + " סדרות. אפשר להפסיק מעקב אחרי סדרה אחרת", 4000); return; }
    var f = { k: k, title: title }; applyTo(f); put(f);
    TVG.closeRem(); TVG.render();
    folSync().then(function (r) { toastAdded(title, r); });
  }
  function undoAdd(k) { var f = folFind(k); if (!f) return; TVG.FOL = TVG.FOL.filter(function (x) { return x.k !== k; }); TVG.FOL.push({ k: k, title: f.title, x: 1, u: Date.now() }); save(); folSync(); TVG.render(); }
  // הודעה אחרי "לעקוב": בלי פוש לא כותבים "נזכיר לך" (זה לא נכון) אלא הסבר ישר
  function toastAdded(title, r) {
    var k = seriesKey(title), undo = function () { undoAdd(k); TVG.pill("בוטל", 1200); };
    if (r && r.ok && r.capped) { undoAdd(k); TVG.pill("הגעת למקסימום " + MAX + " סדרות, אז הסדרה הזו לא נוספה", 5000); return; }
    if (r && r.ok) { TVG.pill("📺 נזכיר לך על כל פרק חדש", 4500, "ביטול", undo); return; }
    if (TVG.pushOn && r && r.status === 403) { TVG.pill("נשמר, אבל ההתראות לא פעילות במכשיר הזה, אז לא נוכל להזכיר", 6500, "ביטול", undo); return; }
    if (TVG.pushOn) { TVG.pill("נשמר. יסונכרן כשיהיה חיבור", 4500, "ביטול", undo); return; }
    if (TVG.isIOS && !TVG.isStandalone) { TVG.pill("נשמר, אבל התראות אוטומטיות עובדות רק מהאפליקציה שבמסך הבית", 6500, "ביטול", undo); return; }
    if (TVG.canPush) { TVG.pill("נשמר. ההתראות כבויות, אז לא נוכל להזכיר", 6500, "להפעלת התראות", function () { TVG.enablePush(); }, "ביטול", undo); return; }
    TVG.pill("נשמר, אבל המכשיר הזה לא תומך בהתראות", 5000, "ביטול", undo);
  }
  function stop() {
    var k = seriesKey(FS.title), f = folFind(k); if (!f) { TVG.closeRem(); return; }
    var back = JSON.parse(JSON.stringify(f));
    put({ k: k, title: f.title, x: 1, u: Date.now() });
    TVG.closeRem(); TVG.render(); folSync();
    TVG.pill("הפסקת לעקוב אחרי " + f.title, 5000, "החזר", function () {
      if (folFind(k)) return;
      back.u = Date.now(); delete back.x; put(back); folSync(); TVG.render(); TVG.pill("חזרנו לעקוב ✓", 1400);
    });
  }
  function toggleSkip(ts) { // דילוג על פרק אחד (או החזרתו), עם ביטול
    var i = FS.skip.indexOf(ts), adding = i < 0;
    if (adding) FS.skip.push(ts); else FS.skip.splice(i, 1);
    applyChange(); draw();
    TVG.pill(adding ? "דילגנו על הפרק הזה" : "הפרק חזר לרשימה", 4500, "ביטול", function () {
      var j = FS.skip.indexOf(ts); if (adding && j >= 0) FS.skip.splice(j, 1); else if (!adding && j < 0) FS.skip.push(ts);
      applyChange(); if (!$("#rem").hidden && FS) draw();
    });
  }

  // ---------------- נקודות כניסה ----------------
  function eligible(title) { if (!TVG.by || !seriesKey(title)) return false; var i = info(title, null); return i.n >= 2 && !i.generic; }
  TVG.folEligible = eligible;
  // בחלון התזכורת של תוכנית: אפשרות משנית כשהתוכנית שייכת לסדרה עם 2+ שידורים קרובים (לא כותרת כללית)
  function folOpt(p, cid) {
    if (!p || !eligible(p.title)) return "";
    var k = seriesKey(p.title);
    return folFind(k) ? '<button type="button" class="ghost" data-folopen="' + esc(k) + '">✓ במעקב · ניהול</button>'
      : '<button type="button" class="ghost" data-folnew="' + esc(seriesTitle(p.title)) + '" data-folch0="' + esc(cid || "") + '">📺 לעקוב אחרי כל הפרקים</button>';
  }
  // שורה אחת לכל סדרה בלשונית התזכורות
  function folRows() {
    var fs = active(); if (!fs.length || !TVG.by) return "";
    return '<h2 class="sech">📺 סדרות במעקב</h2>' + fs.map(function (f) {
      var n = nextOf(f, 1)[0];
      return '<div class="srow folrow"><button type="button" class="go" data-folopen="' + esc(f.k) + '" aria-label="ניהול המעקב אחרי ' + esc(f.title) + '"><span class="time" aria-hidden="true">📺</span><span class="ttl">' + bd(f.title) +
        '<br><span class="sub">' + (n ? "הפרק הבא: " + esc(when(n.p)) + " · " + bd(TVG.chName(n.c.id)) : "אין עכשיו שידורים בלוח") + "</span></span></button></div>";
    }).join("");
  }
  // תזכורת שנגזרה (f|סדרה|ערוץ|ts) לחלון הנודניק: מוצאים את התוכנית בלוח
  function folRem(k) {
    var m = /^f\|[^|]*\|([^|]+)\|(\d{10,14})$/.exec(String(k || "")); if (!m || !ID_RE.test(m[1]) || !TVG.by) return null;
    var id = (TVG.IDMAP && TVG.IDMAP[m[1]]) || m[1], ts = +m[2], p = (TVG.by.get(id) || []).filter(function (x) { return TVG.ilTs(x.s) === ts; })[0];
    return p ? { k: k, ts: ts, end: TVG.ilTs(p.e), title: p.title, ch: TVG.chName(id), id: id } : null;
  }

  document.addEventListener("change", function (e) {
    var t = e.target; if (!t || !t.matches || !t.matches("[data-folsel]") || !FS || $("#rem").hidden) return;
    var v = t.value; if (v === "") return;
    FS.lead = +v; if (!(FS.lead > 0)) FS.dbl = false; applyChange(); draw();
  });
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var nw = t.closest("[data-folnew]");
    if (nw) { openFol(nw.getAttribute("data-folnew"), nw.getAttribute("data-folch0") || ""); return; }
    var op = t.closest("[data-folopen]");
    if (op) { var f = folFind(op.getAttribute("data-folopen")); if (f) openFol(f.title, f.ch); return; }
    if (!FS || $("#rem").hidden) return;
    var md = t.closest("[data-folmode]"); if (md) { FS.mode = md.getAttribute("data-folmode") === "all" ? "all" : "new"; applyChange(); draw(); return; }
    var ld = t.closest("[data-folead]"); if (ld) { FS.lead = +ld.getAttribute("data-folead"); if (!(FS.lead > 0)) FS.dbl = false; applyChange(); draw(); return; }
    if (t.closest("[data-foldbl]")) { FS.dbl = !FS.dbl; applyChange(); draw(); return; }
    var sc = t.closest("[data-folscope]"); if (sc) { FS.scope = sc.getAttribute("data-folscope"); if (FS.scope === "ch" && !FS.ch) FS.ch = FS.origin; applyChange(); draw(); return; }
    var sk = t.closest("[data-folskip]"); if (sk) { toggleSkip(+sk.getAttribute("data-folskip")); return; }
    if (t.closest("[data-folgo]")) { go(); return; }
    if (t.closest("[data-folstop]")) { stop(); return; }
  });
})(window.TVG);
