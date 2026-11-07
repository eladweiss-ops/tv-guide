/* js/render-dial.js - מסך 'היום' (החוגה), ובראשו הכרטיס '🌙 הערב שלך'.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix. */
(function (TVG) {
  TVG.files["render-dial"] = 1;
  var $ = TVG.$, esc = TVG.esc, p2 = TVG.p2, hhmm = TVG.hhmm, dstr = TVG.dstr, descHtml = TVG.descHtml, FAV = TVG.FAV;
  TVG.dialMin = dialMin;
  TVG.dialSet = dialSet;
  TVG.dialT = dialT;
  TVG.kindOf = kindOf;
  TVG.updateDial = updateDial;
  TVG.vDial = vDial;
  TVG.tonightList = tonightList;

  // ---- שעון היום ----
  var CX = 180,
      CY = 180,
      RO = 150,
      RI = 92,
      KIND = { news: "חדשות", sport: "ספורט", ent: "בידור", life: "אורח חיים", oth: "אחר" };
  TVG.CX = CX;
  TVG.RO = RO;
  function kindOf(cid, t) {
    var ch = TVG.G && TVG.G.channels.filter(function (c) { return c.id === cid; })[0];
    if ((ch && ch._n === "sport") || /ליגת|ליגה|(^|\s)ל\.\s|כדורגל|כדורסל|יורוליג|NBA|פרמייר|גביע|אולפן ספורט|מונדיאל/.test(t)) return "sport";
    return newsCh(ch) && !NOTNEWS.test(t) ? "news" : pgOf(t, true);
  }
  // ערוץ חדשות (i24, ערוץ הכנסת, ערוץ 14…): כל מה שאינו ספורט/סרט/סדרה נצבע כחדשות – שמות תוכניות האקטואליה ("הפטריוטים", "שבע") לא אומרים "חדשות"
  var NOTNEWS = /סרט|סדרה|קומדיה|דרמה|תעודה/;
  function newsCh(ch) { return !!ch && ((ch._n === "news" && !/france|fox|פוקס/i.test(ch.name || "")) || ch.id === "x14" || /^ערוץ 14$/.test(ch.name)); }
  function pgOf(t, noCh) {
    var ch = !noCh && TVG.G && TVG.G.channels.filter(function (c) { return c.id === TVG.chId; })[0];
    if ((ch && ch._n === "sport") || /ליגת|ליגה|(^|\s)ל\.\s|כדורגל|כדורסל|יורוליג|NBA|פרמייר|גביע|אולפן ספורט|מונדיאל/.test(t)) return "sport";
    if (/חדשות|מהדורה|מהדורת|מבזק|יומן(?! מסע)|פוליטי/.test(t) || (newsCh(ch) && !NOTNEWS.test(t))) return "news";
    if (/בוקר|מטבח|שף|אוכל|בישול|בריאות|טיול|(^|\s)עם(\s|\.|$)/.test(t)) return "life";
    if (/תשדיר|קליפ|שידור חוזר|פרסומות|מוזיקה/.test(t)) return "oth";
    return "ent";
  }
  function pt(r, m) { var a = m / 1440 * 2 * Math.PI - Math.PI / 2; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; }
  function f1(n) { return Math.round(n * 10) / 10; }
  function arcPath(a, b) {
    a += 1.6; b -= 1.6; if (b - a < 1) return "";
    var p1 = pt(RO, a), p2 = pt(RO, b), p3 = pt(RI, b), p4 = pt(RI, a), lg = (b - a) > 720 ? 1 : 0;
    return "M" + f1(p1[0]) + " " + f1(p1[1]) + "A" + RO + " " + RO + " 0 " + lg + " 1 " + f1(p2[0]) + " " + f1(p2[1]) + "L" + f1(p3[0]) + " " + f1(p3[1]) + "A" + RI + " " + RI + " 0 " + lg + " 0 " + f1(p4[0]) + " " + f1(p4[1]) + "Z";
  }
  function dialT() {
    if (TVG.scrub != null) return TVG.scrub;
    var now = new Date(), d0 = TVG.dObj(TVG.day).getTime();
    return TVG.day === dstr(now) ? Math.floor((now - d0) / 60000) : 20 * 60;
  }
  // ---- 🌙 הערב שלך: מה שמעניין אותך מעכשיו ועד סוף הערב (04:00), בערוצים שלך ----
  // מקורות: מועדפים (כותרת), נושאים, סדרות במעקב. שורה אחת לכל כותרת (השידור הקרוב), לפי שעה, עד 5
  var TN_MAX = 5;
  function tonightList(now) {
    var end = TVG.tonightEnd(), seen = {}, out = [], alts = (TVG.TOPICS || []).map(function (tp) { return { t: tp, a: TVG.topicAlts(tp) }; });
    var fols = (TVG.FOL || []).some(function (x) { return !x.x; });
    TVG.chans().forEach(function (c) {
      (TVG.by.get(c.id) || []).forEach(function (p) {
        if (p.e <= now || p.s >= end || seen[p.title]) return;
        var why = "", fol = fols && TVG.folFind && TVG.folFind(TVG.folKey(p.title));
        if (FAV.has(p.title)) why = "מועדף";
        else if (fol) why = "סדרה במעקב";
        else { for (var i = 0; i < alts.length; i++) if (TVG.topicHit(p, alts[i].a)) { why = alts[i].t; break; } }
        if (!why) return;
        seen[p.title] = 1;
        out.push({ c: c, p: p, why: why, fol: !!fol });
      });
    });
    return out.sort(function (x, y) { return x.p.s - y.p.s || x.p.title.localeCompare(y.p.title); });
  }
  function tnWindow(now) { var hr = now.getHours(); return hr >= 12 || hr < 4; } // מהצהריים ועד סוף הערב
  function bd(s) { return "<bdi>" + esc(TVG.bidi(s)) + "</bdi>"; }
  function tonightHtml(now) {
    TVG.TN = [];
    if (!TVG.by || !tnWindow(now)) return "";
    var empty = !FAV.size && !(TVG.TOPICS || []).length && !(TVG.FOL || []).some(function (x) { return !x.x; });
    if (empty) {
      if (TVG.store("tvg.tnHint") === dstr(now)) return "";
      return '<div class="remall tnhint"><button type="button" class="tnhgo" data-tnfav>⭐ סמנו תוכניות במועדפים ונציג כאן מה מעניין אותך הערב</button><button type="button" class="tnx" data-tnx aria-label="הסתרה עד מחר">✕</button></div>';
    }
    var all = tonightList(now), rows = all.slice(0, TN_MAX);
    if (!rows.length) return "";
    TVG.TN = rows;
    var n = rows.length, folOn = TVG.pushOn, open = 0, h = "", SHOW = 3; // 3 גלויות: שהטבעת לא תיפול מתחת לקפל
    rows.forEach(function (x, i) {
      if (i === SHOW) h += '<div class="tnrest"' + (TVG.tnOpen ? "" : " hidden") + ">";
      var v = TVG.remKey(x.c.id, x.p.s), live = x.p.s <= now, on = !!TVG.hasRem(v), byFol = x.fol && folOn;
      if (!live && !on && !byFol) open++;
      var sub = (live ? "משודר עכשיו · " : "") + bd(x.c.name) + ' · <span class="tnwhy">' + (x.why === "מועדף" ? "⭐ מועדף" : x.why === "סדרה במעקב" ? "📺 במעקב" : "⭐ " + bd(x.why)) + "</span>";
      var act = live ? "" : byFol ? '<button type="button" class="rbt on" data-folopen="' + esc(TVG.folKey(x.p.title)) + '" aria-label="סדרה במעקב, יש תזכורת: ' + esc(x.p.title) + '">📺</button>'
        : '<button type="button" class="rbt' + (on ? " on" : "") + '" data-rem="' + esc(v) + '" aria-label="' + (on ? "יש תזכורת: " : "תזכורת: ") + esc(x.p.title) + '">' + (on ? "✓" : "⏰") + "</button>";
      h += '<div class="srow tnrow' + (live ? " tnlive" : "") + '"><button type="button" class="go" data-jump="' + esc(v) + '"><span class="time">' + hhmm(x.p.s) + '</span><span class="ttl"><bdi>' + TVG.ttlHtml(x.p) + '</bdi><br><span class="sub">' + sub + "</span></span></button>" + act + "</div>";
    });
    if (n > SHOW) h += "</div>" + (TVG.tnOpen ? "" : '<button type="button" class="linkb tnmore" data-tnmore>עוד ' + (n - SHOW) + " ›</button>");
    var cnt = all.length > n ? n + " הקרובים מתוך " + all.length + " שמעניינים אותך הערב" : n === 1 ? "דבר אחד שמעניין אותך הערב" : n + " דברים שמעניינים אותך הערב";
    var anyFuture = rows.some(function (x) { return x.p.s > now; });
    var btn = open ? '<button type="button" class="ghost tnall" data-tnall>⏰ להזכיר על הכול</button>' : anyFuture ? '<p class="tndone">✓ יש תזכורת לכל אלה</p>' : "";
    return '<section class="tonight" aria-label="הערב שלך"><div class="tnhd"><h2 class="sech">🌙 הערב שלך</h2><p class="tncnt">' + cnt + '</p></div><div class="tnlist">' + h + "</div>" + btn + "</section>";
  }
  function vDial() {
    var now = new Date(), h = TVG.pickers(now), d0 = TVG.dObj(TVG.day).getTime(), d1 = d0 + 86400000;
    var segs = (TVG.by.get(TVG.chId) || []).filter(function (p) { return p.e > d0 && p.s < d1; }).map(function (p) {
      return { p: p, a: Math.max(0, (p.s - d0) / 60000), b: Math.min(1440, (p.e - d0) / 60000) };
    });
    TVG.D = { segs: segs, d0: d0 };
    TVG.TN = []; if (TVG.day === dstr(now)) h = tonightHtml(now) + (TVG.teamHtml ? TVG.teamHtml(now) : "") + h; // 🌙 הערב שלך: בראש המסך, רק כשמוצג היום
    if (!segs.length) return h + '<p class="none">אין נתונים ליום הזה.</p>' + TVG.soonHtml(now);
    var T = dialT(), svg = '<svg id="dial" viewBox="-20 -20 400 400" tabindex="0" role="slider" aria-label="שעה ביום" aria-valuemin="0" aria-valuemax="1439" aria-valuenow="' + T + '"><circle class="face" cx="180" cy="180" r="121"></circle>';
    segs.forEach(function (s, i) { var d = arcPath(s.a, s.b); if (d) svg += '<path data-i="' + i + '" class="k-' + pgOf(s.p.title) + '" d="' + d + '"></path>'; });
    segs.forEach(function (sg) { if (FAV.has(sg.p.title) && sg.b - sg.a >= 20) { var m = pt(121, (sg.a + sg.b) / 2); svg += '<text class="fs" x="' + f1(m[0]) + '" y="' + f1(m[1] + 5) + '" text-anchor="middle">★</text>'; } });
    for (var k = 0; k < 24; k += 3) { var a1 = pt(RO + 4, k * 60), a2 = pt(RO + 12, k * 60); svg += '<line x1="' + f1(a1[0]) + '" y1="' + f1(a1[1]) + '" x2="' + f1(a2[0]) + '" y2="' + f1(a2[1]) + '" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>'; }
    [[0, 180, 2], [6, 360, 185], [12, 180, 372], [18, 0, 185]].forEach(function (l) { svg += '<text x="' + l[1] + '" y="' + l[2] + '" font-size="15" font-weight="700">' + p2(l[0]) + "</text>"; });
    if (TVG.day === dstr(now)) { var nm = pt(RO + 14, (now - d0) / 60000); svg += '<circle class="nowdot" cx="' + f1(nm[0]) + '" cy="' + f1(nm[1]) + '" r="6"></circle>'; }
    svg += '<line class="hand" id="dHand"></line><circle class="knob" id="dKnob" r="9"></circle><text id="dTime" x="180" y="192" font-size="40" font-weight="900"></text><foreignObject x="85" y="203" width="190" height="30" style="pointer-events:none"><div xmlns="http://www.w3.org/1999/xhtml" id="dTitle" dir="auto"></div></foreignObject></svg>';
    h += '<div class="dialwrap">' + svg + '</div><p class="hint">גוררים את הטבעת כדי לטייל ביום. לחיצה על קטע עתידי מוסיפה תזכורת. החלקה הצידה מחליפה יום.</p>';
    h += '<button type="button" class="ghost" id="dNow" data-dnow hidden>חזרה לעכשיו</button>';
    h += '<article class="card dcard" id="dCard" aria-live="polite"></article>';
    h += '<div class="legend">' + Object.keys(KIND).map(function (k2) { return '<span><i style="background:var(--c-' + k2 + ')"></i>' + KIND[k2] + "</span>"; }).join("") + "</div>";
    TVG.lastIdx = -2;
    return h + TVG.soonHtml(now);
  }
  function updateDial(T) {
    if (!TVG.D || !$("#dial")) return;
    T = ((Math.round(T) % 1440) + 1440) % 1440;
    var now = new Date(), isToday = TVG.day === dstr(now), hd = $("#dHand"), kn = $("#dKnob"), a = pt(RI - 18, T), b = pt(RO + 14, T);
    hd.setAttribute("x1", f1(a[0])); hd.setAttribute("y1", f1(a[1])); hd.setAttribute("x2", f1(b[0])); hd.setAttribute("y2", f1(b[1]));
    kn.setAttribute("cx", f1(b[0])); kn.setAttribute("cy", f1(b[1]));
    $("#dial").setAttribute("aria-valuenow", T);
    var idx = -1; TVG.D.segs.forEach(function (s, i) { if (T >= s.a && T < s.b) idx = i; });
    if (idx !== TVG.lastIdx) { if (TVG.dragging && TVG.lastIdx !== -2 && navigator.vibrate) { try { navigator.vibrate(8); } catch (x) {} } TVG.lastIdx = idx; }
    document.querySelectorAll("#dial path").forEach(function (p) { p.classList.toggle("on", +p.getAttribute("data-i") === idx); });
    var s = idx >= 0 ? TVG.D.segs[idx] : null, nx = idx >= 0 ? TVG.D.segs[idx + 1] : null;
    $("#dTime").textContent = p2(Math.floor(T / 60)) + ":" + p2(T % 60);
    $("#dTitle").textContent = s ? (s.p.title.length > 15 ? s.p.title.slice(0, 14) + "…" : s.p.title) : "";
    var cn = (TVG.G.channels.filter(function (c) { return c.id === TVG.chId; })[0] || {}).name || "";
    var live = s && isToday && s.p.s <= now && now < s.p.e;
    $("#dCard").className = "card dcard pc k-" + (s ? kindOf(TVG.chId, s.p.title) : "oth");
    $("#dCard").innerHTML = s ? '<div class="chn">' + esc(cn) + (live ? " · משודר עכשיו" : "") + "</div><h2 class=\"cur\">" + TVG.ttlHtml(s.p) + '</h2><div class="meta"><span dir="ltr">' + hhmm(s.p.s) + "–" + hhmm(s.p.e) + "</span><span>" + KIND[pgOf(s.p.title)] + "</span></div>" + descHtml(s.p, TVG.chId, true) +
      (nx ? '<p class="next"><b>' + hhmm(nx.p.s) + "</b>" + TVG.ttlHtml(nx.p) + "</p>" : "") : '<p class="none">אין נתוני שידור לשעה הזו.</p>';
    $("#dNow").hidden = !(isToday && TVG.scrub != null);
  }
  function dialMin(e) {
    var r = $("#dial").getBoundingClientRect(), a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
    if (a < 0) a += 2 * Math.PI;
    return Math.round(a / (2 * Math.PI) * 288) * 5 % 1440;
  }
  function dialSet(m) { TVG.scrub = ((m % 1440) + 1440) % 1440; updateDial(TVG.scrub); }
})(window.TVG);
