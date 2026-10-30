/* js/core.js - ליבה: עזרי DOM/טקסט/זמן, אחסון (store), ומצב האפליקציה המשותף (G, sel, tab, day...).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: -. */
(function (TVG) {
  TVG.files["core"] = 1;
  TVG.parse = parse;
  TVG.store = store;

  var $ = function (s) { return document.querySelector(s); };
  TVG.$ = $;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  TVG.esc = esc;
  // שמות ערוצים בנתונים נשמרים לפעמים בסדר חזותי ("!E ערוץ הבידור"): מחזירים ל"E! ערוץ הבידור"
  TVG.chNice = function (s) { return String(s == null ? "" : s).replace(/(^|\s)!([A-Za-z0-9]+)/g, "$1$2!"); };
  // bidi (לתצוגת HTML בלבד, לא לטקסט שנשלח): רצפים לטיניים/מספרים (כולל סימן סוף כמו ! או +) בבידוד LTR, כדי ש"E!" ו-"5+" לא יתהפכו
  TVG.bidi = function (s) { return TVG.chNice(s).replace(/[A-Za-z0-9][A-Za-z0-9 ]*[!?+]*/g, function (m) { return "\u2066" + m.replace(/ +$/, "") + "\u2069" + (/ $/.test(m) ? " " : ""); }); };
  // אזור זמן: זמני הלוח הם שעון קיר ישראלי, ו-TVG.parse בונה Date שרכיביו (getHours...) הם שעון הקיר הזה גם במכשיר שאזורו שונה.
  // ilTs מחזיר את הרגע האמיתי (ms) של שעון קיר כזה ב-Asia/Jerusalem (כולל שעון קיץ); ilNow את "עכשיו" כשעון קיר ישראלי באותה מוסכמה.
  var ILF = null;
  function ilParts(ts) {
    if (!ILF) ILF = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    var o = {}; ILF.formatToParts(new Date(ts)).forEach(function (p) { o[p.type] = +p.value; }); return o;
  }
  function ilOff(ts) { var p = ilParts(ts); return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ts / 1000) * 1000; }
  TVG.ilOffMin = function (ts) { return Math.round(ilOff(ts) / 60000); };
  TVG.ilTs = function (w) { var g = Date.UTC(w.getFullYear(), w.getMonth(), w.getDate(), w.getHours(), w.getMinutes()), t = g - ilOff(g); return g - ilOff(t); };
  TVG.ilNow = function () { var p = ilParts(Date.now()); return new Date(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second); };
  var DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  TVG.DAYS = DAYS;
  var p2 = function (n) { return String(n).padStart(2, "0"); };
  TVG.p2 = p2;
  var hhmm = function (d) { return p2(d.getHours()) + ":" + p2(d.getMinutes()); };
  TVG.hhmm = hhmm;
  var dstr = function (d) { return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); };
  TVG.dstr = dstr;
  function parse(s) { var m = s.match(/(\d+)-(\d+)-(\d+)T(\d+):(\d+)/); return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); if (window.__tvgBk) window.__tvgBk(k); } catch (e) { return null; } }

  // זיהוי פלטפורמה במקום אחד (לפי User-Agent). אין לשכפל בדיקות כאלה בקבצים אחרים.
  var UA = navigator.userAgent || "";
  TVG.isIOS = /iPhone|iPad|iPod/.test(UA);
  TVG.isAndroid = !TVG.isIOS && /Android/i.test(UA);
  TVG.isStandalone = !!((window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone);
  if (TVG.isAndroid) document.documentElement.className += " android";

  TVG.G = null;
  TVG.by = new Map();
  var sel = new Set();
  TVG.tab = "dial";
  TVG.day = null;
  TVG.chId = null;
  TVG.q = "";
  TVG.find = "";
  TVG.isSample = false;
  TVG.scrollNext = false;
  TVG.gen = "all";
  TVG.cf = "all";
  TVG.NF = null;
  TVG.scrub = null;
  TVG.D = null;
  TVG.dragging = false;
  TVG.lastIdx = -2;
  var SCR = {};
  TVG.qExact = null;
  TVG.scope = "all";
  TVG.TI = null;
  TVG.TIt = 0;
  TVG.delArm = false;
  TVG.sel = sel;
  TVG.SCR = SCR;
})(window.TVG);
