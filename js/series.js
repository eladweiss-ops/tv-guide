/* js/series.js - 📺 מעקב אחרי סדרה: מסווג "שידור ראשי" מול שידור חוזר, מצב המעקב (tvg.fol), סנכרון לשרת (/api/follow), החלון התחתון, שורה אחת בלשונית התזכורות.
   התזכורות עצמן נגזרות בשרת (calendar-server/api/_fol.js) ולא נכתבות לרשימת התזכורות הרגילה (TVG.REMS). המסווג כאן הוא עותק של calendar-server/api/_series.js - שינוי באחד = שינוי בשני (נבדק ב-calendar-server/test/series-parity.test.mjs).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, search. */
(function (TVG) {
  TVG.files["series"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr, API = TVG.CAL_API;
  TVG.folAirings = airingsOf;
  TVG.folClassify = classify;
  TVG.folInfo = info;
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

  // ---------------- מסווג (זהה ל-calendar-server/api/_series.js) ----------------
  function normT(s) { var t = String(s || "").toLowerCase(); try { t = t.normalize("NFD"); } catch (e) {} return t.replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9֐-׿]+/g, ""); }
  function parseTitle(title) {
    var t = String(title || "").replace(/\s+/g, " ").trim();
    var m = t.match(/^(.*?)\s*[-–]\s*פרק\s*(\d+)\s*$/) || t.match(/^(.*\S)\s+פרק\s*(\d+)\s*$/) || t.match(/^(.*?\S)\s*:\s*(\d{1,4})\s*$/);
    if (m && normT(m[1]).length >= 2) return { stem: m[1].trim(), ep: "e" + (+m[2]) };
    m = t.match(/^(.*?)\s*[-–]\s*(?:עונה חדשה|פרק חדש|ספיישל)\s*$/);
    if (m && normT(m[1]).length >= 2) return { stem: m[1].trim(), ep: "" };
    return { stem: t, ep: "" };
  }
  function seriesTitle(title) { return parseTitle(title).stem; }
  function seriesKey(title) { return normT(seriesTitle(title)).slice(0, 32); }
  var NEW_RX = /עונה חדשה|פרק חדש|בכורה|חדש!/, RERUN_RX = /ש\.ח|\(שח\)|שידור חוזר|מקוצר/, LIVE_RX = /ישיר|LIVE/i;
  function dowOf(stamp) { return new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(5, 7) - 1, +stamp.slice(8, 10))).getUTCDay(); }
  function classify(airings) {
    var out = airings.map(function (a) { var o = {}; for (var k in a) o[k] = a[k]; o.primary = true; o.why = ""; return o; });
    var order = out.map(function (_, i) { return i; }).sort(function (i, j) { return out[i].start < out[j].start ? -1 : out[i].start > out[j].start ? 1 : 0; });
    var descN = {}, descDays = {};
    out.forEach(function (a) { var d = normT(a.desc).slice(0, 60); if (d.length >= 12) { descN[d] = (descN[d] || 0) + 1; (descDays[d] = descDays[d] || {})[a.start.slice(0, 10)] = 1; } });
    function generic(d) { return descN[d] >= 4 && Object.keys(descDays[d]).length >= 4; }
    function epOf(a) { var pe = parseTitle(a.title).ep; if (pe) return "t:" + pe; var d = normT(a.desc).slice(0, 60); return d.length >= 12 && !generic(d) ? "d:" + d : ""; }
    var seen = {}, pending = [];
    order.forEach(function (i) {
      var a = out[i], txt = a.title + " " + (a.desc || ""), ep = epOf(a);
      if (a.lv === 1 || LIVE_RX.test(a.title)) { a.primary = true; a.why = "live"; if (ep && !seen[ep]) seen[ep] = a.start; return; }
      if (a.rr || RERUN_RX.test(txt)) { a.primary = false; a.why = "rr"; return; }
      if (NEW_RX.test(txt)) { a.primary = true; a.why = "new"; if (ep && !seen[ep]) seen[ep] = a.start; return; }
      if (ep) { if (seen[ep] != null && seen[ep] < a.start) { a.primary = false; a.why = "seen"; } else { a.primary = true; a.why = "first"; seen[ep] = a.start; } return; }
      pending.push(i);
    });
    if (pending.length) {
      var slot = function (a) { return a.ch + "|" + dowOf(a.start) + "|" + a.start.slice(11, 16); };
      var proven = {}, nProven = 0;
      out.forEach(function (a) { if (a.primary && (a.why === "live" || a.why === "new" || a.why === "first")) { var s = slot(a); if (!proven[s]) { proven[s] = 1; nProven++; } } });
      var cnt = {}; pending.forEach(function (i) { var s = slot(out[i]); cnt[s] = (cnt[s] || 0) + 1; });
      var score = function (s) { return cnt[s] + (+s.split("|")[2].slice(0, 2) >= 19 ? 0.5 : 0); };
      var keys = Object.keys(cnt), best = Math.max.apply(null, keys.map(score)), maxCnt = Math.max.apply(null, keys.map(function (s) { return cnt[s]; }));
      var daily = function (a) { return a.ch + "|" + a.start.slice(11, 16); }, dn = {};
      pending.forEach(function (i) { var s = daily(out[i]); dn[s] = (dn[s] || 0) + 1; });
      var dBest = Math.max.apply(null, Object.keys(dn).map(function (s) { return dn[s]; }));
      pending.forEach(function (i) {
        var a = out[i];
        if (nProven) { a.primary = !!proven[slot(a)]; a.why = a.primary ? "slot" : "slot-rr"; }
        else if (maxCnt >= 2) { a.primary = score(slot(a)) >= best - 1e-9; a.why = a.primary ? "slot" : "slot-rr"; }
        else if (dBest >= 2) { a.primary = dn[daily(a)] === dBest; a.why = a.primary ? "daily" : "daily-rr"; }
        else { a.primary = true; a.why = "single"; }
        if (a.primary && +a.start.slice(11, 13) < 6 && !proven[slot(a)]) { a.primary = false; a.why = "night"; }
      });
    }
    return out;
  }

  // ---------------- שידורי הסדרה בלוח (הלקוח: TVG.by, אחרי איחוד ערוצים) ----------------
  function stamp(d) { return dstr(d) + "T" + hhmm(d); }
  // title: כותרת הסדרה (או תוכנית ממנה); ch: מזהה ערוץ (מאוחד) או "" לכל הערוצים. מחזיר שידורים עתידיים מסווגים: [{c, p, ts, primary, why}]
  function airingsOf(title, ch) {
    var k = normT(seriesTitle(title)), rows = [];
    if (!k || !TVG.by) return [];
    TVG.G.channels.forEach(function (c) {
      if (ch && c.id !== ch) return;
      (TVG.by.get(c.id) || []).forEach(function (p) { if (normT(parseTitle(p.title).stem) === k) rows.push({ ch: c.id, start: stamp(p.s), title: p.title, desc: p.desc, rr: p.rr ? 1 : 0, lv: p.lv === 1 ? 1 : 0, _c: c, _p: p }); });
    });
    var now = Date.now();
    return classify(rows).map(function (a) { return { c: a._c, p: a._p, ts: TVG.ilTs(a._p.s), primary: a.primary, why: a.why }; })
      .filter(function (a) { return a.ts > now; }).sort(function (x, y) { return x.ts - y.ts; });
  }
  // {n: שידורים עתידיים, prim: מתוכם ראשיים, chans: ערוצים שונים}
  function info(title, ch) {
    var a = airingsOf(title, ch || ""), cs = {};
    a.forEach(function (x) { cs[x.c.id] = 1; });
    return { n: a.length, prim: a.filter(function (x) { return x.primary; }).length, chans: Object.keys(cs).length };
  }
  function nextOf(f, limit) {
    var seen = {}, out = [];
    airingsOf(f.title, f.ch || "").forEach(function (a) {
      if (f.mode !== "all" && !a.primary) return;
      if (seen[a.ts]) return; seen[a.ts] = 1; out.push(a);
    });
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
  var TOMB_MS = 30 * 86400000;
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
  function put(f) { // upsert לפי מפתח
    TVG.FOL = TVG.FOL.filter(function (x) { return x.k !== f.k; }); TVG.FOL.push(f); save();
  }
  var MAX = 30;

  // ---------------- סנכרון ----------------
  function chGroup(ch) { // כל מזהי הערוצים הגולמיים של הערוץ המאוחד (השרת מסנן לפיהם)
    if (!ch) return [];
    var ids = Object.keys(TVG.IDMAP || {}).filter(function (id) { return TVG.IDMAP[id] === ch; });
    if (ids.indexOf(ch) < 0) ids.push(ch);
    return ids.slice(0, 16);
  }
  function wire() { // מה שנשלח לשרת: בלי שדות מקומיים
    return TVG.FOL.map(function (f) {
      var o = { title: f.title, u: f.u };
      if (f.x) { o.x = 1; return o; }
      o.mode = f.mode; o.lead = f.lead; o.ch = f.ch || ""; o.chn = f.chn || ""; o.chs = f.ch ? chGroup(f.ch) : [];
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
        n.mode = s.mode === "all" ? "all" : "new"; n.lead = Number.isFinite(+s.lead) ? +s.lead : 10; n.ch = s.ch || ""; n.chn = s.chn || "";
        if (s.dbl) n.dbl = 1;
        if (n.ch && TVG.by && !TVG.by.has(n.ch)) n.ch = TVG.IDMAP && TVG.IDMAP[n.ch] || ""; // ערוץ שלא קיים אצלנו: לכל הערוצים
      }
      TVG.FOL = TVG.FOL.filter(function (x) { return x.k !== k; }); TVG.FOL.push(n); changed = true;
    });
    if (changed) save();
    return changed;
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
  function folPull() { // בעליית האפליקציה: מביאים את הרשימה מהשרת וממזגים (דו-כיווני לפי u)
    if (!TVG.pushOn || !TVG.calTok) return;
    fetch(API + "/api/follow?t=" + encodeURIComponent(TVG.calTok), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !Array.isArray(j.follows)) return;
      var ch = mergeIn(j.follows);
      if (ch && TVG.G) TVG.render();
      if (TVG.store("tvg.folDirty") === "1" || (TVG.FOL.length && !j.follows.length)) folSync();
    }).catch(function () {});
  }
  if (TVG.store("tvg.folDirty") === "1" && TVG.pushOn) setTimeout(folSync, 4500);
  else if (TVG.pushOn) setTimeout(folPull, 3500);

  // ---------------- החלון התחתון ----------------
  var FS = null; // {title, ch, chn, mode, lead, dbl, existing, origin: מזהה ערוץ שממנו הגענו}
  function show(html) { $("#remBody").innerHTML = html; $("#rem").hidden = false; $("#scrim2").hidden = false; }
  function openFol(title, origin) {
    var k = seriesKey(title), ex = folFind(k);
    TVG.rem = null; TVG.LP = null;
    FS = ex ? { title: ex.title, ch: ex.ch || "", chn: ex.chn || "", mode: ex.mode, lead: ex.lead, dbl: !!ex.dbl, existing: true, origin: ex.ch || origin || "" }
            : { title: seriesTitle(title), ch: "", chn: "", mode: "new", lead: TVG.lead != null ? TVG.lead : 10, dbl: false, existing: false, origin: origin || "" };
    draw();
  }
  function leadChips() {
    var L = [[0, "בהתחלה"], [10, "10 דק׳"], [30, "30 דק׳"], [60, "שעה"]];
    return '<div class="lbl">מתי להזכיר?</div><div class="chips lp" role="group" aria-label="מתי להזכיר">' + L.map(function (l) {
      return '<button type="button" class="chip" data-folead="' + l[0] + '" aria-pressed="' + (FS.lead === l[0]) + '">' + l[1] + "</button>"; }).join("") + "</div>";
  }
  function pushNote() {
    if (TVG.pushOn) return "";
    if (TVG.isIOS && !TVG.isStandalone) return '<p class="credit">התראות ותזכורות אוטומטיות עובדות רק מהאפליקציה שבמסך הבית: בספארי לוחצים על כפתור השיתוף ואז על ״הוסף למסך הבית״.</p>';
    if (TVG.canPush) return '<p class="credit">כדי שנזכיר לך גם כשהאפליקציה סגורה צריך התראות.</p><button type="button" class="ghost sm" data-pushon>🔔 הפעלת התראות</button>';
    return '<p class="credit">המכשיר הזה לא תומך בהתראות, ולכן לא נוכל להזכיר אוטומטית.</p>';
  }
  function draw() {
    var f = FS, nx = nextOf(f, 3), inf = info(f.title, f.ch), first = nx[0];
    var h = "<h2>📺 " + bd(f.title) + "</h2>";
    h += '<div class="meta">' + (first ? "<span>הפרק הבא: " + esc(when(first.p)) + "</span><span>" + bd(TVG.chName(first.c.id)) + "</span>" : "<span>אין עכשיו שידורים בלוח</span>") + "</div>";
    h += '<div class="lbl">אילו שידורים?</div><div class="chips lp" role="group" aria-label="אילו שידורים">' +
      '<button type="button" class="chip" data-folmode="new" aria-pressed="' + (f.mode !== "all") + '">רק פרקים חדשים</button>' +
      '<button type="button" class="chip" data-folmode="all" aria-pressed="' + (f.mode === "all") + '">גם שידורים חוזרים</button></div>';
    var oc = f.origin || f.ch;
    if (oc && (info(f.title, "").chans >= 2 || f.ch)) {
      var cn = TVG.chName(oc);
      h += '<div class="chips lp" role="group" aria-label="באיזה ערוץ">' +
        '<button type="button" class="chip" data-folch="" aria-pressed="' + (!f.ch) + '">בכל הערוצים</button>' +
        '<button type="button" class="chip" data-folch="' + esc(oc) + '" aria-pressed="' + (f.ch === oc) + '">רק ב־' + bd(cn) + "</button></div>";
    }
    h += leadChips();
    if (nx.length) {
      h += '<div class="lbl">הפרקים הקרובים</div><ul class="folnext">' + nx.map(function (a) {
        return "<li><span class=\"fw\">" + esc(when(a.p)) + '</span><span class="fc">' + bd(TVG.chName(a.c.id)) + '</span><span class="ft">' + (a.primary ? "✨ חדש" : "🔁 חוזר") + "</span></li>";
      }).join("") + "</ul>";
    } else if (inf.n === 0) h += '<p class="remnote">אין כרגע שידורים קרובים. נזכיר לך ברגע שיעלו ללוח.</p>';
    else h += '<p class="remnote">אין כרגע ' + (f.mode === "all" ? "שידורים" : "פרקים חדשים") + " בלוח. נזכיר לך ברגע שיעלו.</p>";
    h += pushNote();
    h += f.existing
      ? '<button type="button" class="btn" data-remclose>סיום</button><button type="button" class="ghost" data-folstop>הפסק לעקוב</button>'
      : '<button type="button" class="btn" data-folgo>📺 לעקוב אחרי הסדרה</button><button type="button" class="ghost" data-remclose>ביטול</button>';
    show(h);
  }
  function applyChange() { // שינוי הגדרה בסדרה שכבר במעקב: נשמר מיד
    if (!FS.existing) return;
    var f = folFind(seriesKey(FS.title)); if (!f) return;
    f.mode = FS.mode; f.lead = FS.lead; f.ch = FS.ch; f.chn = FS.ch ? TVG.chName(FS.ch) : ""; f.u = Date.now(); save(); folSync(); TVG.render();
  }
  function go() {
    var f = FS, k = seriesKey(f.title);
    if (active().length >= MAX && !folFind(k)) { TVG.pill("אפשר לעקוב אחרי עד " + MAX + " סדרות", 2400); return; }
    put({ k: k, title: f.title, mode: f.mode, lead: f.lead, ch: f.ch, chn: f.ch ? TVG.chName(f.ch) : "", u: Date.now() });
    var title = f.title;
    TVG.closeRem(); TVG.render();
    folSync().then(function (r) { toastAdded(title, r); });
  }
  function undoAdd(k) { var f = folFind(k); if (!f) return; TVG.FOL = TVG.FOL.filter(function (x) { return x.k !== k; }); TVG.FOL.push({ k: k, title: f.title, x: 1, u: Date.now() }); save(); folSync(); TVG.render(); }
  // הודעה אחרי "לעקוב": בלי פוש לא כותבים "נזכיר לך" (זה לא נכון) אלא הסבר ישר
  function toastAdded(title, r) {
    var k = seriesKey(title), undo = function () { undoAdd(k); TVG.pill("בוטל", 1200); };
    if (r && r.ok) { TVG.pill("📺 נזכיר לך על כל פרק חדש" + (r.capped ? "" : ""), 4500, "ביטול", undo); return; }
    if (TVG.pushOn && r && r.status === 403) { TVG.pill("נשמר, אבל ההתראות לא פעילות במכשיר הזה, אז לא נוכל להזכיר", 6500, "ביטול", undo); return; }
    if (TVG.pushOn) { TVG.pill("נשמר. יסונכרן כשיהיה חיבור", 4500, "ביטול", undo); return; }
    if (TVG.isIOS && !TVG.isStandalone) { TVG.pill("נשמר, אבל התראות אוטומטיות עובדות רק מהאפליקציה שבמסך הבית", 6500, "ביטול", undo); return; }
    if (TVG.canPush) { TVG.pill("נשמר. ההתראות כבויות, אז לא נוכל להזכיר", 6500, "להפעלת התראות", function () { TVG.enablePush(); }, "ביטול", undo); return; }
    TVG.pill("נשמר, אבל המכשיר הזה לא תומך בהתראות", 5000, "ביטול", undo);
  }
  function stop() {
    var k = seriesKey(FS.title), f = folFind(k); if (!f) { TVG.closeRem(); return; }
    var back = { k: f.k, title: f.title, mode: f.mode, lead: f.lead, ch: f.ch, chn: f.chn, dbl: f.dbl };
    put({ k: k, title: f.title, x: 1, u: Date.now() });
    TVG.closeRem(); TVG.render(); folSync();
    TVG.pill("הפסקת לעקוב אחרי " + f.title, 5000, "החזר", function () {
      if (folFind(k)) return;
      back.u = Date.now(); put(back); folSync(); TVG.render(); TVG.pill("חזרנו לעקוב ✓", 1400);
    });
  }

  // ---------------- נקודות כניסה ----------------
  // בחלון התזכורת של תוכנית: אפשרות משנית כשהתוכנית שייכת לסדרה עם 2+ שידורים קרובים
  function folOpt(p, cid) {
    if (!p || !TVG.by || info(p.title, "").n < 2) return "";
    var k = seriesKey(p.title); if (!k) return "";
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
    var m = /^f\|[^|]*\|(\d{1,6})\|(\d{10,14})$/.exec(String(k || "")); if (!m || !TVG.by) return null;
    var id = (TVG.IDMAP && TVG.IDMAP[m[1]]) || m[1], ts = +m[2], p = (TVG.by.get(id) || []).filter(function (x) { return TVG.ilTs(x.s) === ts; })[0];
    return p ? { k: k, ts: ts, end: TVG.ilTs(p.e), title: p.title, ch: TVG.chName(id), id: id } : null;
  }

  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var nw = t.closest("[data-folnew]");
    if (nw) { openFol(nw.getAttribute("data-folnew"), nw.getAttribute("data-folch0") || ""); return; }
    var op = t.closest("[data-folopen]");
    if (op) { var f = folFind(op.getAttribute("data-folopen")); if (f) openFol(f.title, f.ch); return; }
    if (!FS || $("#rem").hidden) return;
    var md = t.closest("[data-folmode]"); if (md) { FS.mode = md.getAttribute("data-folmode") === "all" ? "all" : "new"; applyChange(); draw(); return; }
    var ld = t.closest("[data-folead]"); if (ld) { FS.lead = +ld.getAttribute("data-folead"); applyChange(); draw(); return; }
    var ch = t.closest("[data-folch]"); if (ch) { FS.ch = ch.getAttribute("data-folch") || ""; FS.chn = FS.ch ? TVG.chName(FS.ch) : ""; applyChange(); draw(); return; }
    if (t.closest("[data-folgo]")) { go(); return; }
    if (t.closest("[data-folstop]")) { stop(); return; }
  });
})(window.TVG);
