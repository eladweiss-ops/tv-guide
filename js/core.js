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
