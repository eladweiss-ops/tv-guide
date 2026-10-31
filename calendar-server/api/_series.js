// מעקב אחרי סדרה: זיהוי "שידור ראשי" מול שידור חוזר, והתאמת כותרת סדרה לתוכניות הלוח. לוגיקה טהורה, בלי תלויות.
// הקטע בין <core> ל-</core> זהה במילה ל-js/series.js (נבדק ב-test/series-parity.test.mjs). שינוי כאן = שינוי שם.

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

// "YYYY-MM-DDTHH:MM" בשעון ישראל -> ms. מחשבים את ההיסט של אזור הזמן מ-Intl (כולל מעבר שעון קיץ)
const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function ilOff(ms) { const p = {}; dtf.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; }); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000; }
export function ilToMs(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp || "");
  if (!m) return NaN;
  const g = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), t = g - ilOff(g);
  return g - ilOff(t);
}

// ---- שם ערוץ כפי שהאפליקציה מציגה (js/data.js: unent, NAMEFIX, ALIAS, cleanName; js/core.js chNice) ----
const NAMEFIX = { "3185": "ערוץ פעוטות (HOT 3185)", "521": "ספורט 5 HD · HOT" };
const ALIAS = { "רשת SD": "רשת 13", "HD כאן": "כאן 11", "קשת": "קשת 12", "עכשיו 14": "ערוץ 14", "מוסיקה 24": "ערוץ 24", "מוזיקה 24": "ערוץ 24", "SPORT 3": "ספורט 3", "SPORT 3 HD": "ספורט 3", "SPORT 4": "ספורט 4", "SPORT 4 HD": "ספורט 4", "SPORT 1": "ספורט 1", "SPORT 2": "ספורט 2",
  "ערוץ הספורט": "ספורט 5", "5+ LIVE": "5 LIVE", "5LIVE HD": "5 LIVE", "5+ GOLD": "5 GOLD", "5GOLD": "5 GOLD", "Sport 5 Stars": "5 STARS", "5MAX": "5 MAX",
  "ערוץ ONE": "ONE", "ערוץ ONE HD": "ONE", "ONE 2 HD": "ONE 2" };
const unent = (t) => String(t == null ? "" : t).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const garbled = (n) => (n.match(/\?/g) || []).length >= 2 || /[¥¾µ°´²]/.test(n);
const cleanName = (n) => n.replace(/\s*[-–]?\s*(\(copy\)|משוכפל)/ig, "").replace(/\s+f?hd(?=\s|$)/ig, "").replace(/^hd\s+/i, "").replace(/\s+חדש$/, "").replace(/\s+/g, " ").trim() || n;
export function chDisplay(c) {
  let n = unent(c && c.name);
  if (NAMEFIX[c.id]) n = NAMEFIX[c.id]; else if (garbled(n)) n = "ערוץ " + (c.prov === "yes" ? "yes" : "HOT") + " " + c.id;
  if (ALIAS[n]) n = ALIAS[n];
  return cleanName(n).replace(/(^|\s)!([A-Za-z0-9]+)/g, "$1$2!").slice(0, 60);
}
// עדיפות בין ערוצים תאומים באותה שעה: נמוך = עדיף. העתק/"חדש" אחרון
export const dupRank = (name) => (/חדש|copy|משוכפל/i.test(String(name || "")) ? 1 : 0);
export const cmpId = (a, b) => { const x = /^\d+$/.test(a), y = /^\d+$/.test(b); return x && y ? +a - +b : x ? -1 : y ? 1 : a < b ? -1 : a > b ? 1 : 0; };

// אינדקס הלוח לפי גזע הכותרת: Map<מפתח, programs[]>; נבנה פעם אחת לכל לוח
const idxCache = new WeakMap();
export function indexGuide(guide) {
  let idx = idxCache.get(guide);
  if (idx) return idx;
  idx = new Map();
  for (const p of (guide && guide.programs) || []) {
    if (!p || typeof p.start !== "string" || typeof p.title !== "string") continue;
    const k = normT(parseTitle(p.title).stem);
    if (!k) continue;
    let a = idx.get(k); if (!a) idx.set(k, (a = []));
    a.push(p);
  }
  idxCache.set(guide, idx);
  return idx;
}
// כל שידורי הכותרת בלוח (לבדיקת "כותרת כללית")
export const rowsOfTitle = (guide, title) => indexGuide(guide).get(normT(seriesTitle(title))) || [];
export const genericTitle = (guide, title) => isGeneric(title, rowsOfTitle(guide, title));

// כל שידורי הסדרה בלוח (מכאן והלאה), מסוננים לקבוצת ערוצים אם נקבעה, ומסווגים. מחזיר [{ch,start,title,desc,rr,lv,primary,why,epk,ts}]
export function seriesAirings(guide, title, chs, nowMs) {
  const k = normT(seriesTitle(title));
  if (!k) return [];
  const set = Array.isArray(chs) && chs.length ? new Set(chs.map(String)) : null;
  const rows = ((indexGuide(guide).get(k)) || []).filter((p) => !set || set.has(String(p.ch)));
  const cl = classify(fillTwins(rows.map((p) => ({ ch: String(p.ch), start: p.start, title: p.title, desc: p.desc, rr: p.rr, lv: p.lv }))));
  const out = [];
  for (const a of cl) { const ts = ilToMs(a.start); if (Number.isFinite(ts) && ts > nowMs) out.push({ ...a, ts }); }
  return out.sort((x, y) => x.ts - y.ts || cmpId(x.ch, y.ch));
}

export { ID_RE, normT, stripMarks, parseTitle, seriesTitle, seriesKey, classify, dayCap, fillTwins, isGeneric, MAX_PER_DAY_ALL };
