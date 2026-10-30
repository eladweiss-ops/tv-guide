/* js/share.js - שיתוף תוכנית: חלון תחתון עם תצוגת הודעת הוואטסאפ, בחירה "טקסט / כרטיס צבעוני", וקישור עמוק ?p=<ערוץ>|<התחלה>.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, render-common, render-dial, events. */
(function (TVG) {
  TVG.files["share"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.shareBtn = shareBtn;
  TVG.openShare = openShare;
  TVG.openShared = openShared;
  TVG.shareCard = shareCard;
  TVG.shareParts = parts;

  var APP = "https://eladweiss-ops.github.io/tv-guide/";
  var S = null; // {id, p, mode: "text" | "card", blob, url}

  // ---- תוכן ההודעה ----
  function startStr(d) { return dstr(d) + "T" + hhmm(d); }
  function linkOf(id, p) { return APP + "?p=" + encodeURIComponent(id) + "%7C" + startStr(p.s); }
  function emojiOf(id, p) {
    var k = TVG.kindOf(id, p.title), t = p.title;
    if (k === "sport") {
      if (/כדורסל|NBA|יורוליג|ווינר סל/i.test(t)) return "🏀";
      if (/כדורגל|פרמייר|מונדיאל|ליגת האלופים|ליגת העל|ליגה האנגלית|לה ליגה|סרייה|בונדסליגה/.test(t)) return "⚽";
      if (/טניס/.test(t)) return "🎾";
      if (/פורמולה|F1|מרוץ|מירוץ/i.test(t)) return "🏎";
      return "🏆";
    }
    if (k === "news") return "📰";
    if (k === "life") return /מטבח|שף|אוכל|בישול|אפייה/.test(t) ? "🍽" : "🌿";
    if (/סרט|קולנוע/.test(t)) return "🎬";
    return "📺";
  }
  function parts(r) { // כל מה שצריך לטקסט, לתצוגה ולכרטיס, ממקור אחד
    var p = r.p, d = p.s;
    return {
      emoji: emojiOf(r.id, p),
      title: String(p.title || "").replace(/\*/g, "").replace(/\s+/g, " ").trim(),
      day: "יום " + TVG.DAYS[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1),
      time: hhmm(d),
      ch: TVG.chName(r.id),
      live: p.lv === 1,
      link: linkOf(r.id, p),
      kind: TVG.kindOf(r.id, p.title)
    };
  }
  function textOf(x) {
    return ["\u200F" + x.emoji + " *" + x.title + "*", "\u200F" + x.day + " · " + x.time + " · " + x.ch + (x.live ? " (ישיר)" : ""), x.link].join("\n");
  }
  function bubbleHtml(x) {
    return '<div class="shbub" dir="rtl"><div class="shl1">' + x.emoji + " <b><bdi>" + esc(x.title) + "</bdi></b></div>" +
      '<div class="shl2">' + esc(x.day) + " · " + x.time + " · <bdi>" + esc(x.ch) + "</bdi>" + (x.live ? " (ישיר)" : "") + "</div>" +
      '<div class="shl3" dir="ltr">' + esc(x.link) + "</div></div>";
  }
  function shareBtn(p, cid) {
    if (!cid) return "";
    return '<button type="button" class="ghost shbtn" data-share="' + esc(cid) + "|" + p.s.getTime() + '">📤 שיתוף</button>';
  }

  // ---- כרטיס תמונה 1080x1350 ----
  var GRAD = { sport: ["#5E5CE6", "#BF5AF2"], ent: ["#FF9F0A", "#FF375F"], news: ["#0A84FF", "#5AC8FA"], life: ["#30D158", "#00B8A9"], oth: ["#8E8E93", "#48484A"] };
  function fontsReady(sample) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var s = "אבגדה" + sample, loads = ["400 40px Heebo", "600 56px Heebo", "700 56px Heebo", "800 110px Heebo"].map(function (f) { return document.fonts.load(f, s).catch(function () {}); });
    return Promise.race([Promise.all(loads), new Promise(function (res) { setTimeout(res, 3000); })]);
  }
  function wrap(ctx, text, maxW, maxLines) { // מחזיר {lines, cut}
    var words = text.split(" "), lines = [], cur = "", i;
    function brk(w) { // מילה ארוכה מהרוחב: שוברים לפי תווים
      while (ctx.measureText(w).width > maxW) {
        var n = w.length; while (n > 1 && ctx.measureText(w.slice(0, n)).width > maxW) n--;
        lines.push(w.slice(0, n)); w = w.slice(n);
      }
      cur = w;
    }
    for (i = 0; i < words.length; i++) {
      var t = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(t).width <= maxW) cur = t;
      else { if (cur) lines.push(cur); cur = ""; brk(words[i]); }
    }
    if (cur) lines.push(cur);
    var cut = lines.length > maxLines;
    if (cut) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1).replace(/\s+$/, "");
      lines[maxLines - 1] = last + "…";
    }
    return { lines: lines, cut: cut };
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function shareCard(r) { // -> Promise<Blob>
    var x = parts(r);
    return fontsReady(x.title + x.ch).then(function () {
      var W = 1080, H = 1350, PAD = 90, R = W - PAD, MW = W - 2 * PAD, c = document.createElement("canvas"); c.width = W; c.height = H;
      var ctx = c.getContext("2d"), g = GRAD[x.kind] || GRAD.ent, F = 'Heebo, "Segoe UI", system-ui, sans-serif';
      var bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, g[0]); bg.addColorStop(1, g[1]); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      var rg = ctx.createRadialGradient(W, 0, 0, W, 0, 760); rg.addColorStop(0, "rgba(255,255,255,.28)"); rg.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      var rg2 = ctx.createRadialGradient(0, H, 0, 0, H, 700); rg2.addColorStop(0, "rgba(0,0,0,.28)"); rg2.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = rg2; ctx.fillRect(0, 0, W, H);
      ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#fff";
      // כותרת האפליקציה
      ctx.font = "700 54px " + F; ctx.fillText("📺 לוח שידורים", R, 160);
      // תאריך ושעה
      ctx.font = "600 60px " + F; ctx.globalAlpha = 0.95; ctx.fillText(x.day + " · " + x.time, R, 300); ctx.globalAlpha = 1;
      // כותרת: עד 3 שורות, הגודל יורד לפי הצורך
      var sizes = [124, 108, 94, 82], size = 82, lay = null, i;
      for (i = 0; i < sizes.length; i++) { ctx.font = "800 " + sizes[i] + "px " + F; var w = wrap(ctx, x.emoji + " " + x.title, MW, 3); if (!w.cut) { size = sizes[i]; lay = w; break; } }
      if (!lay) { size = 82; ctx.font = "800 82px " + F; lay = wrap(ctx, x.emoji + " " + x.title, MW, 3); }
      ctx.font = "800 " + size + "px " + F;
      var lh = Math.round(size * 1.2), y = 470 + size;
      ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
      lay.lines.forEach(function (ln, k) { ctx.fillText(ln, R, y + k * lh); });
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      // ערוץ (+ ישיר)
      ctx.font = "700 64px " + F;
      var cw = Math.min(MW, Math.ceil(ctx.measureText(x.ch).width) + 80), cy = 1010;
      ctx.fillStyle = "rgba(255,255,255,.22)"; rr(ctx, R - cw, cy, cw, 110, 55); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(x.ch, R - cw / 2, cy + 77);
      if (x.live) {
        ctx.font = "800 48px " + F;
        var lw = Math.ceil(ctx.measureText("● שידור ישיר").width) + 64, lx = R - cw - 24 - lw;
        if (lx > PAD) { ctx.fillStyle = "#fff"; rr(ctx, lx, cy + 8, lw, 94, 47); ctx.fill(); ctx.fillStyle = "#D70015"; ctx.fillText("● שידור ישיר", lx + lw / 2, cy + 72); }
      }
      // כתובת האפליקציה
      ctx.direction = "ltr"; ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.globalAlpha = 0.85; ctx.font = "500 38px " + F; ctx.fillText("eladweiss-ops.github.io/tv-guide", W / 2, 1262); ctx.globalAlpha = 1;
      return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error("toBlob")); }, "image/png"); });
    });
  }

  // ---- החלון התחתון ----
  function openShare(r) {
    if (S && S.url) { try { URL.revokeObjectURL(S.url); } catch (e) {} }
    S = { id: r.id, p: r.p, mode: "text", blob: null, url: null };
    TVG.rem = null; TVG.LP = null;
    $("#remBody").innerHTML = '<h2>שיתוף</h2><p class="shsub">ככה זה ייראה בוואטסאפ</p><div id="shPrev"></div>' +
      '<div class="chips" role="group" aria-label="סוג ההודעה"><button type="button" class="chip" data-shmode="text" aria-pressed="true">טקסט</button><button type="button" class="chip" data-shmode="card" aria-pressed="false">🖼 ככרטיס צבעוני</button></div>' +
      '<button type="button" class="btn wa" data-shwa>🟢 שליחה בוואטסאפ</button><button type="button" class="ghost shcopy" data-shcopy>העתקת קישור</button>';
    paintPrev();
    $("#rem").hidden = false; $("#scrim2").hidden = false;
    // nav: כאן נרשמת שכבה לכפתור "חזור" (סגירה = TVG.closeRem) כשיהיה TVG.openLayer
  }
  function paintPrev() {
    var el = $("#shPrev"); if (!el || !S) return;
    var r = { id: S.id, p: S.p };
    if (S.mode === "text") { el.innerHTML = bubbleHtml(parts(r)); return; }
    el.innerHTML = '<div class="shcard' + (S.url ? "" : " ld") + '">' + (S.url ? '<img alt="תצוגה מקדימה של הכרטיס" src="' + S.url + '">' : "<span>מכינים את הכרטיס…</span>") + "</div>";
    if (S.blob) return;
    var cur = S; // הגנה מפני החלפת תוכנית באמצע
    shareCard(r).then(function (b) {
      if (S !== cur) return;
      S.blob = b; S.url = URL.createObjectURL(b); if (S.mode === "card") paintPrev();
    }).catch(function () { if (S === cur && S.mode === "card") { S.mode = "text"; syncChips(); paintPrev(); TVG.pill("לא הצלחנו להכין את הכרטיס", 2200); } });
  }
  function syncChips() {
    [].forEach.call(document.querySelectorAll("[data-shmode]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-shmode") === S.mode)); });
  }
  function openWa(text) {
    var u = "https://wa.me/?text=" + encodeURIComponent(text);
    var w = null; try { w = window.open(u, "_blank"); } catch (e) {}
    if (!w) location.href = u;
  }
  function download(blob) {
    var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = "tv-guide.png"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
  }
  function send() {
    var x = parts({ id: S.id, p: S.p }), text = textOf(x);
    if (S.mode === "text") { openWa(text); return; }
    if (!S.blob) { TVG.pill("הכרטיס עוד בהכנה, עוד רגע", 1500); return; }
    var file = null; try { file = new File([S.blob], "tv-guide.png", { type: "image/png" }); } catch (e) {}
    var fallback = function () { download(S.blob); openWa(text); TVG.pill("התמונה נשמרה במכשיר. צרפו אותה להודעה בוואטסאפ", 5000); };
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text: text }).catch(function (e) { if (!e || e.name !== "AbortError") fallback(); });
    } else fallback();
  }
  function copyLink() {
    var l = parts({ id: S.id, p: S.p }).link, ok = function () { TVG.pill("הקישור הועתק", 1600); };
    function old() {
      var t = document.createElement("textarea"); t.value = l; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;opacity:0"; document.body.appendChild(t); t.select();
      var good = false; try { good = document.execCommand("copy"); } catch (e) {} t.remove(); if (good) ok(); else TVG.pill("לא הצלחנו להעתיק", 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(l).then(ok, old); else old();
  }
  // הקשות בשלב הלכידה: כך הכפתור בתוך כרטיס/שורה לא פותח אותם (events.js לא רואה את האירוע)
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return; var b;
    if ((b = t.closest("[data-share]"))) { e.stopPropagation(); var r = TVG.findProg(b.getAttribute("data-share")); if (r) openShare(r); return; }
    if (!S || !t.closest("#rem")) return;
    if ((b = t.closest("[data-shmode]"))) { e.stopPropagation(); S.mode = b.getAttribute("data-shmode"); syncChips(); paintPrev(); return; }
    if (t.closest("[data-shwa]")) { e.stopPropagation(); send(); return; }
    if (t.closest("[data-shcopy]")) { e.stopPropagation(); copyLink(); return; }
  }, true);

  // ---- קישור עמוק ?p=<ערוץ>|<התחלה> ----
  function openShared() {
    var m = /[?&]p=([^&#]*)/.exec(location.search); if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])p=[^&#]*&?/, "$1").replace(/[?&]$/, "") + location.hash); } catch (e) {}
    var v = ""; try { v = decodeURIComponent(m[1]); } catch (e2) {}
    var k = v.lastIndexOf("|"), id = v.slice(0, k), st = v.slice(k + 1), r = null;
    if (k > 0 && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(st)) r = TVG.findProg((TVG.IDMAP[id] || id) + "|" + TVG.parse(st).getTime());
    if (!r) { TVG.pill("התוכנית כבר לא בלוח", 2800); return; }
    if (!TVG.chans().some(function (c) { return c.id === r.id; })) { TVG.sel.add(r.id); TVG.saveSel(); }
    TVG.setSearch(false); TVG.chId = r.id; TVG.day = dstr(r.p.s); TVG.scrub = Math.round((r.p.s - TVG.dObj(TVG.day)) / 60000);
    TVG.tab = "dial"; TVG.store("tvg.tab", "dial"); TVG.render();
    TVG.pill("📺 התוכנית ששיתפו איתך", 2200);
  }
})(window.TVG);
