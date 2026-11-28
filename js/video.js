/* js/video.js - ▶ וידאו לתוכנית, מתחת ל"📤 שיתוף" (share.js קורא ל-TVG.vidBtn):
   1. כאן 11 עם דף תוכנית (guide.json: u, מ-enrich_kan) – "▶ לדף התוכנית בכאן".
   2. טריילר מ-TMDB, רק בהתאמה בטוחה (שרת: /api/nf-search?vid=, ראו calendar-server/api/_vid.js) – "▶ טריילר". נבדק רק כשהכפתור נראה על המסך.
   3. כל השאר – "🔎 ביוטיוב" (חיפוש, לא טריילר; לתוכנית של כאן – עם "כאן 11").
   חלק ממרחב השמות TVG (ראו index.html). */
(function (TVG) {
  TVG.files["video"] = 1;
  var esc = TVG.esc, KAN = "https://www.kan.org.il";
  var C = {}; // שם נקי -> {yt} | {} (נבדק). נשמר לסשן
  try { C = JSON.parse(sessionStorage.getItem("tvg.vid") || "{}") || {}; } catch (e) { C = {}; }
  function saveC() { try { sessionStorage.setItem("tvg.vid", JSON.stringify(C)); } catch (e) {} }

  // כמו cleanTitle בשרת: "הייתי שם - עונה חדשה: אסון הצונאמי" -> "הייתי שם"
  function clean(t) {
    var s = String(t || "").replace(/\([^)]*\)/g, " ").replace(/^\s*(ישיר|LIVE|שידור חוזר)\s*[!:-]*\s*/i, "");
    s = s.split(/\s+[-–:|]\s+|:\s/)[0];
    s = s.replace(/\s+(עונה|פרק|ע'|פ')\s*\d*.*$/, "").replace(/\s+עונה חדשה.*$/, "").replace(/\s+\d{1,2}$/, "");
    return s.replace(/\s+/g, " ").trim();
  }
  function chOf(cid) { return TVG.G && TVG.G.channels.filter(function (c) { return c.id === cid; })[0]; }
  function isKan(c) { return !!c && /^(HD )?כאן( 11)?( HD)?$/.test(String(c.name).trim()); }
  // טריילר רק לסרטים/סדרות/בידור – לא לחדשות, ספורט ושידור חי
  function wantTrailer(p, cid) {
    if (TVG.isLiveP && TVG.isLiveP(p)) return false;
    var k = TVG.kindOf ? TVG.kindOf(cid, p.title) : "";
    return k !== "sport" && k !== "news";
  }
  function yearOf(p, c) { // שנה רק בערוצי סרטים (בתקציר של תעודה השנה היא של האירוע, לא של הסרט)
    if (!c || c._n !== "movies") return "";
    var m = String(p.desc || "").match(/(?:^|\D)(19[3-9]\d|20[0-4]\d)(?:\D|$)/); return m ? m[1] : "";
  }
  function ytWatch(k) { return "https://www.youtube.com/watch?v=" + encodeURIComponent(k); }
  function ytSearch(q) { return "https://www.youtube.com/results?search_query=" + encodeURIComponent(q); }

  TVG.vidBtn = function (p, cid) {
    if (!p || !p.title) return "";
    if (p.u && /^\/content\/kan\/[\w-]+\/p-\d+\/$/.test(p.u)) return '<a class="ghost vid" href="' + esc(KAN + p.u) + '" target="_blank" rel="noopener">▶ לדף התוכנית בכאן</a>';
    var q = clean(p.title); if (q.length < 2) return "";
    var c = chOf(cid), kan = isKan(c), got = C[q];
    if (got && got.yt) return '<a class="ghost vid" href="' + esc(ytWatch(got.yt)) + '" target="_blank" rel="noopener">▶ טריילר</a>';
    var look = !kan && got === undefined && wantTrailer(p, cid), y = look ? yearOf(p, c) : "";
    return '<a class="ghost vid" href="' + esc(ytSearch((kan ? "כאן 11 " : "") + q)) + '" target="_blank" rel="noopener"' +
      (look ? ' data-vidq="' + esc(q) + '" data-vidy="' + esc(y) + '"' : "") + ">🔎 ביוטיוב</a>";
  };

  // בדיקה מול השרת רק לכפתור שנראה על המסך (לא לכל תוכנית בלוח)
  var pend = {};
  function look(el) {
    var q = el.getAttribute("data-vidq"), y = el.getAttribute("data-vidy") || "";
    if (!q || pend[q]) return; pend[q] = 1;
    fetch(TVG.CAL_API + "/api/nf-search?vid=" + encodeURIComponent(q) + (y ? "&y=" + y : "")).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      delete pend[q]; if (!j) return; // כשל: לא נועלים, ננסה בפתיחה הבאה
      C[q] = j.yt && /^[\w-]{6,20}$/.test(j.yt) ? { yt: j.yt } : {}; saveC();
      Array.prototype.forEach.call(document.querySelectorAll("[data-vidq]"), function (a) {
        if (a.getAttribute("data-vidq") !== q) return;
        a.removeAttribute("data-vidq");
        if (C[q].yt) { a.href = ytWatch(C[q].yt); a.textContent = "▶ טריילר"; }
      });
    }).catch(function () { delete pend[q]; });
  }
  if (!("IntersectionObserver" in window) || !("MutationObserver" in window)) return;
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); look(e.target); } }); });
  var scanT = 0;
  function scan() { scanT = 0; Array.prototype.forEach.call(document.querySelectorAll("[data-vidq]:not([data-vido])"), function (a) { a.setAttribute("data-vido", "1"); io.observe(a); }); }
  new MutationObserver(function () { if (!scanT) scanT = setTimeout(scan, 250); }).observe(document.body, { childList: true, subtree: true });
})(window.TVG);
