/* js/share.js - שיתוף תוכנית: חלון תחתון עם תצוגה מקדימה של מה שיישלח (טקסט קצר, או כרטיס 1200x630 עם קישור קצר), וקישור קצר ?p=<ערוץ>.<YYMMDDHHMM>. דף הנחיתה של הקישור: landing.js.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, render-common, render-dial, events. */
(function (TVG) {
  TVG.files["share"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.shareBtn = shareBtn;
  TVG.openShare = openShare;
  TVG.shareCard = shareCard;
  TVG.shareParts = parts;
  TVG.shareText = function (r, cardOnly) { return textOf(parts(r), cardOnly); };
  TVG.openShareNf = openShareNf; // 💌 המלצה מדף תוכן בנטפליקס/דיסני+ (netflix.js)

  var APP = "https://eladweiss-ops.github.io/tv-guide/";
  var S = null; // {id, p, mode: "text" | "card", blob, url}

  // ---- תוכן ההודעה ----
  function startStr(d) { return dstr(d) + "T" + hhmm(d); }
  // קישור קצר ונקי: ?p=<ערוץ>.<YYMMDDHHMM> (הישן ?p=<ערוץ>|<YYYY-MM-DDTHH:MM> עדיין נקרא)
  function linkOf(id, p) { var t = startStr(p.s).replace(/\D/g, "").slice(2); return APP + "?p=" + encodeURIComponent(id) + "." + t; }
  // מילה אישית: נכנסת לראש ההודעה בוואטסאפ (לא לקישור)
  var MSG_MAX = 140;
  function cleanMsg(m) { return String(m || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MSG_MAX); }
  function synOf(p) { // תקציר קצר לשיתוף: עד ~140 תווים, חיתוך במילה שלמה
    var d = String(p.desc || "").replace(/\s+/g, " ").trim();
    if (!d || d === p.title) return "";
    if (d.length <= 140) return d;
    d = d.slice(0, 140); return d.slice(0, Math.max(d.lastIndexOf(" "), 100)) + "…";
  }
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
      chRaw: TVG.bidiText(TVG.chName(r.id)), // LRM סביב רצפים לטיניים, לטקסט שנשלח
      ch: TVG.bidi(TVG.chName(r.id)), // עם בידוד LTR: לתצוגה בלבד (HTML/קנבס), לא לטקסט שנשלח
      live: p.lv === 1,
      link: linkOf(r.id, p),
      syn: synOf(p),
      kind: TVG.kindOf(r.id, p.title)
    };
  }
  var RLM = "\u200F", CTA = "👇 לשמירה ביומן לחצו כאן:", CTA_NF = "👇 לפרטים ולצפייה:";
  function textOf(x, cardOnly) { // במצב כרטיס: רק הקריאה לפעולה והקישור (הפרטים כבר בתמונה)
    // RLM רק בתחילת שורה שמתחילה באימוג'י (לא צמוד ל-_ או *, שוואטסאפ לא מזהה כעיצוב אחרת); שורות שמתחילות בעברית כבר RTL
    var head = x.msg ? [RLM + "💬 " + x.msg, ""] : [], cta = x.nf ? CTA_NF : CTA;
    if (cardOnly) return head.concat([RLM + cta, x.link]).join("\n");
    var l = head.concat([RLM + x.emoji + " *" + x.title + "*", x.nf ? x.day : x.day + " · " + x.time + " · " + x.chRaw + (x.live ? " · ישיר" : "")]);
    if (x.syn) l.push("_" + x.syn.replace(/_/g, " ") + "_");
    l.push("", RLM + cta, x.link);
    return l.join("\n");
  }
  function bubbleHtml(x, mode, imgUrl) {
    // וואטסאפ לא תומך במילה עם קישור: הוא מציג את הכתובת, ומעליה (במצב טקסט) כרטיס תצוגה מקדימה מתגיות og של האתר
    var strip = '<div class="shlnk"><img src="icon-192.png" alt=""><div><b>זפזופ 📺</b><span>לחצו לשמירה ביומן ולתזכורת</span><i dir="ltr">eladweiss-ops.github.io</i></div></div>';
    var note = x.msg ? '<div class="shmsg">💬 <bdi dir="auto">' + esc(x.msg) + "</bdi></div>" : "";
    var cta = '<div class="shl2">' + (x.nf ? CTA_NF : CTA) + '</div><div class="shl3" dir="ltr">' + esc(x.link) + "</div>";
    if (mode === "card") return '<div class="shbub" dir="rtl">' + note + '<div class="shpic' + (imgUrl ? "" : " ld") + '">' + (imgUrl ? '<img alt="תצוגה מקדימה של הכרטיס" src="' + imgUrl + '">' : "<span>מכינים את הכרטיס…</span>") + "</div>" + cta + "</div>";
    if (x.nf) { // כמו התצוגה המקדימה שוואטסאפ יבנה מהקישור: תמונת התוכן (רחבה מעל, או פוסטר קטן), שם, תיאור ודומיין הקישור
      var host = (String(x.link).match(/^https?:\/\/([^\/?#]+)/) || [])[1] || "", txt = '<div><b><bdi dir="auto">' + esc(x.title) + "</bdi></b><span>פרטים, ציונים ו־▶ פתיחה ב" + esc(x.svc) + '</span><i dir="ltr">' + esc(host) + "</i></div>";
      strip = x.wide ? '<div class="shlnk big"><img class="shlimg" src="' + esc(x.wide) + '" alt="">' + txt + "</div>"
        : '<div class="shlnk' + (x.poster ? " pst" : "") + '"><img src="' + esc(x.poster || "icon-192.png") + '" alt="">' + txt + "</div>";
    }
    return '<div class="shbub" dir="rtl">' + note + strip + '<div class="shl1">' + x.emoji + " <b><bdi dir=\"auto\">" + esc(x.title) + "</bdi></b></div>" +
      '<div class="shl2">' + (x.nf ? esc(x.day) : esc(x.day) + " · " + x.time + " · <bdi dir=\"rtl\">" + esc(x.ch) + "</bdi>" + (x.live ? " · ישיר" : "")) + "</div>" +
      (x.syn ? '<div class="shsyn">' + esc(x.syn) + "</div>" : "") + '<div class="shgap"></div>' + cta + "</div>";
  }
  function shareBtn(p, cid) {
    if (!cid) return "";
    return '<button type="button" class="ghost shbtn" data-share="' + esc(cid) + "|" + p.s.getTime() + '">📤 שיתוף</button>';
  }

  // ---- כרטיס "כרטיס כניסה" 1200x630 (גם היחס של תצוגת קישור) ----
  var GRAD = { sport: ["#5E5CE6", "#BF5AF2"], ent: ["#FF4F9A", "#C0268C"], news: ["#0A84FF", "#5AC8FA"], life: ["#30D158", "#00B8A9"], oth: ["#8E8E93", "#48484A"] };
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
      var W = 1200, H = 630, PAD = 64, R = W - PAD, MW = W - 2 * PAD, c = document.createElement("canvas"); c.width = W; c.height = H;
      var ctx = c.getContext("2d"), g = GRAD[x.kind] || GRAD.ent, F = 'Heebo, "Segoe UI", system-ui, sans-serif';
      var bg = ctx.createLinearGradient(W, 0, 0, H); bg.addColorStop(0, g[0]); bg.addColorStop(1, g[1]); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      var rg = ctx.createRadialGradient(W, 0, 0, W, 0, 620); rg.addColorStop(0, "rgba(255,255,255,.30)"); rg.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      var rg2 = ctx.createRadialGradient(0, H, 0, 0, H, 560); rg2.addColorStop(0, "rgba(0,0,0,.30)"); rg2.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = rg2; ctx.fillRect(0, 0, W, H);
      // אימוג'י ענק עדין ברקע (עומק)
      ctx.direction = "ltr"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 0.22; ctx.font = "400 330px " + F; ctx.fillStyle = "#fff"; ctx.fillText(x.emoji, 18, 330); ctx.globalAlpha = 1;
      ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.fillStyle = "#fff";
      // שורה עליונה: סימן האפליקציה (ימין) ושידור ישיר (שמאל)
      ctx.font = "700 36px " + F; ctx.globalAlpha = 0.92; ctx.fillText("📺 זפזופ", R, 100); ctx.globalAlpha = 1;
      if (x.live) {
        ctx.font = "800 32px " + F; var lw = Math.ceil(ctx.measureText("● שידור ישיר").width) + 48;
        ctx.fillStyle = "#fff"; rr(ctx, PAD, 56, lw, 60, 30); ctx.fill(); ctx.fillStyle = "#D70015"; ctx.textAlign = "center"; ctx.fillText("● שידור ישיר", PAD + lw / 2, 98); ctx.textAlign = "right"; ctx.fillStyle = "#fff";
      }
      // כותרת: עד 2 שורות, הגודל יורד לפי הצורך
      var sizes = [92, 80, 70, 62], size = 62, lay = null, i;
      for (i = 0; i < sizes.length; i++) { ctx.font = "800 " + sizes[i] + "px " + F; var w = wrap(ctx, x.title, MW, 2); if (!w.cut) { size = sizes[i]; lay = w; break; } }
      if (!lay) { ctx.font = "800 62px " + F; lay = wrap(ctx, x.title, MW, 2); }
      ctx.font = "800 " + size + "px " + F;
      var lh = Math.round(size * 1.18), y = 190 + size * 0.5;
      ctx.shadowColor = "rgba(0,0,0,.28)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 5;
      lay.lines.forEach(function (ln, k) { ctx.fillText("\u2067" + ln + "\u2069", R, y + k * lh); });
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      // לוח זכוכית תחתון: ערוץ + יום (ימין), שעה גדולה (שמאל). מתחת: הקישור הקצר
      var py = 392, ph = 168, qs = ph, q = null, px = PAD, pw = MW; // בלי QR: אי אפשר לסרוק אותו מאותו טלפון (החלטת אלעד 31.10). הקישור הקצר מודפס בתחתית
      if (q) { px = PAD + qs + 20; pw = MW - qs - 20; }
      ctx.fillStyle = "rgba(255,255,255,.22)"; rr(ctx, px, py, pw, ph, 44); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = 2; rr(ctx, px + 1, py + 1, pw - 2, ph - 2, 43); ctx.stroke();
      if (q) {
        ctx.fillStyle = "#fff"; rr(ctx, PAD, py, qs, ph, 38); ctx.fill();
        var m = Math.max(2, Math.floor((qs - 24) / q.n)), sz = m * q.n, ox = PAD + Math.round((qs - sz) / 2), oy = py + Math.round((ph - sz) / 2);
        ctx.fillStyle = "#111"; for (var rr0 = 0; rr0 < q.n; rr0++) for (var cc0 = 0; cc0 < q.n; cc0++) if (q.get(rr0, cc0)) ctx.fillRect(ox + cc0 * m, oy + rr0 * m, m, m);
      }
      ctx.fillStyle = "#fff"; ctx.textAlign = "right"; ctx.direction = "rtl";
      var tw0 = 0; ctx.font = "800 100px " + F; tw0 = ctx.measureText(x.time).width;
      var maxW = pw - 36 - 36 - tw0 - 30, chs = 48; ctx.font = "800 " + chs + "px " + F; while (ctx.measureText(TVG.bidi(x.ch)).width > maxW && chs > 30) { chs -= 2; ctx.font = "800 " + chs + "px " + F; }
      ctx.fillText(TVG.bidi(x.ch), px + pw - 36, py + 78);
      ctx.font = "700 40px " + F; ctx.globalAlpha = 0.95; ctx.fillText(x.day, px + pw - 36, py + 134); ctx.globalAlpha = 1;
      ctx.textAlign = "left"; ctx.direction = "ltr"; ctx.font = "800 100px " + F; ctx.fillText(x.time, px + 36, py + 118);
      ctx.font = "600 28px " + F; ctx.globalAlpha = 0.92; ctx.textAlign = "right"; ctx.fillText(x.link.replace(/^https?:\/\//, ""), R, py + ph + 44); ctx.globalAlpha = 1;
      return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error("toBlob")); }, "image/png"); });
    });
  }

  // ---- החלון התחתון ----
  // מילה אישית: צ׳יפים של משפטים מוכנים (הקשה ממלאת את התיבה, ואפשר לערוך), ומתחתם התיבה. dir=rtl: גם ההנחיה מיושרת לימין
  function msgField(sugs) {
    S.sug = sugs;
    return '<div class="shmsgf"><label for="shMsg">מילה אישית <i>(לא חובה)</i></label>' +
      '<div class="chips shsug" role="group" aria-label="משפטים מוכנים">' + sugs.map(function (s, i) { return '<button type="button" class="chip" data-shsug="' + i + '" aria-pressed="false">' + esc(s) + "</button>"; }).join("") + "</div>" +
      '<textarea id="shMsg" rows="2" maxlength="' + MSG_MAX + '" placeholder="או לכתוב משהו משלך" dir="rtl"></textarea></div>';
  }
  function sugTv(p) { // לשון ניטרלית; "הערב"/"מחר"/היום בשבוע לפי מועד השידור
    var d = p.s, now = new Date(), tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), when;
    if (dstr(d) === dstr(now)) when = d.getHours() >= 17 ? " הערב" : " היום";
    else if (dstr(d) === dstr(tm)) when = " מחר";
    else when = " ביום " + TVG.DAYS[d.getDay()];
    return ["רואים ביחד? 🍿", "שלא יעבור לך" + when, "זה בדיוק בשבילך"];
  }
  function sugNf(x) {
    return ["חובה לראות 🔥", "רואים ביחד? 🍿", x.type === "tv" ? "זו הסדרה שסיפרתי לך עליה" : "זה הסרט שסיפרתי לך עליו", "חשבתי עליך כשראיתי את זה"]; // שני הקצרים ראשונים: נכנסים בשורה אחת ב-375
  }
  function syncSug() { // הצ׳יפ מסומן כל עוד התיבה מכילה בדיוק את המשפט שלו
    [].forEach.call(document.querySelectorAll("[data-shsug]"), function (b) { b.setAttribute("aria-pressed", String(!!S.msg && S.sug[+b.getAttribute("data-shsug")] === S.msg)); });
  }
  function pickSug(i) {
    var s = S.sug && S.sug[i], ta = $("#shMsg"); if (!s || !ta) return;
    ta.value = s; S.msg = cleanMsg(s); syncSug(); paintPrev();
    try { ta.focus(); ta.setSelectionRange(s.length, s.length); } catch (e) {}
  }
  function openShare(r) {
    if (S && S.url) { try { URL.revokeObjectURL(S.url); } catch (e) {} }
    S = { id: r.id, p: r.p, mode: "text", blob: null, url: null, msg: "" };
    TVG.rem = null; TVG.LP = null;
    $("#rem").classList.remove("over");
    $("#remBody").innerHTML = '<h2>שיתוף</h2>' + msgField(sugTv(r.p)) + '<p class="shsub">בערך ככה זה ייראה</p><div id="shPrev"></div>' +
      '<div class="chips" role="group" aria-label="סוג ההודעה"><button type="button" class="chip" data-shmode="text" aria-pressed="true">טקסט</button><button type="button" class="chip" data-shmode="card" aria-pressed="false">🖼 ככרטיס צבעוני</button></div><p class="shnote" id="shNote" hidden>הקישור מופיע גם בתמונה</p>' +
      '<div class="folbar shbar"><button type="button" class="btn wa" data-shwa>🟢 שליחה בוואטסאפ</button><button type="button" class="ghost shcopy" data-shcopy>העתקת ההודעה</button></div>'; // מוצמד לתחתית החלון: תמיד מתחת לאגודל
    paintPrev();
    $("#rem").hidden = false; $("#scrim2").hidden = false;
    // היסטוריה: #rem רשום ב-nav.js כשכבה. אם החלון כבר פתוח (שיתוף מתוך חלון תזכורת) לא משתנה hidden, ולכן אין רשומה כפולה
  }
  // 💌 המלצה על תוכן בנטפליקס/דיסני+: אותו חלון, בלי כרטיס צבעוני; הקישור ?nf=<k> פותח את דף התוכן
  function openShareNf(x, k) {
    if (!x || !/^[mt][0-9]{1,9}$/.test(k || "")) return;
    if (S && S.url) { try { URL.revokeObjectURL(S.url); } catch (e) {} }
    S = { nf: { x: x, k: k }, mode: "text", blob: null, url: null, msg: "" };
    TVG.rem = null; TVG.LP = null;
    $("#rem").classList.add("over"); // מעל דף התוכן (#nfsheet, אותה שכבה)
    $("#remBody").innerHTML = '<h2>💌 המלצה</h2>' + msgField(sugNf(x)) + '<p class="shsub">בערך ככה זה ייראה</p><div id="shPrev"></div>' +
      '<div class="folbar shbar"><button type="button" class="btn wa" data-shwa>🟢 שליחה בוואטסאפ</button><button type="button" class="ghost shcopy" data-shcopy>העתקת ההודעה</button></div>'; // מוצמד לתחתית החלון: תמיד מתחת לאגודל
    paintPrev();
    $("#rem").hidden = false; $("#scrim2").hidden = false;
  }
  function inList(k, svc) { var L = svc === "דיסני+" ? TVG.DS : TVG.NF; return !!(L && L.items && L.items[k]); }
  function tmdbImg(u) { return /^https:\/\/image\.tmdb\.org\/t\/p\/[a-z0-9]+\/[\w-]+\.(jpg|jpeg|png|webp)$/i.test(u || "") ? u : ""; }
  function nfParts(x, k) {
    var svc = TVG.nfSvc && TVG.nfSvc(x) === "disney" ? "דיסני+" : "נטפליקס", d = String(x.overview || "").replace(/\s+/g, " ").trim();
    if (d.length > 140) { d = d.slice(0, 140); d = d.slice(0, Math.max(d.lastIndexOf(" "), 100)) + "…"; }
    return {
      nf: true, svc: svc, emoji: x.type === "tv" ? "📺" : "🎬",
      wide: tmdbImg(x.backdrop), poster: tmdbImg(x.poster), // לתצוגה המקדימה בלבד (כמו שהשרת יציג בוואטסאפ)
      title: String(x.title || "").replace(/\*/g, "").replace(/\s+/g, " ").trim(),
      day: [x.type === "tv" ? "סדרה" : "סרט", x.year ? String(x.year) : "", svc].filter(Boolean).join(" · "),
      // ברשימות: קישור דרך השרת (/n/<k>) – בוואטסאפ מופיעה תמונת הסדרה, והדף עובר מיד לאפליקציה. מחוץ לרשימות: ישר לאפליקציה עם השם (t=), כדי שייפתח
      syn: d, link: inList(k, svc) ? "https://tv-guide-cal.vercel.app/n/" + k + (svc === "דיסני+" ? "?s=d" : "") : APP + "?nf=" + k + (svc === "דיסני+" ? "&s=d" : "") + "&t=" + encodeURIComponent(String(x.title || "").slice(0, 60)) // s=d: דיסני+ (טוען את disney.json לפני הפתיחה); t= רק לתוכן מחוץ לרשימות (נפתח מהשם)
    };
  }
  function curParts() { // החלקים להודעה הנוכחית, עם המילה האישית
    var x = S.nf ? nfParts(S.nf.x, S.nf.k) : parts({ id: S.id, p: S.p });
    x.msg = S.msg; // המילה האישית רק בטקסט ההודעה: עברית בכתובת הופכת ל-%D7%… ארוך ומכוער בוואטסאפ
    return x;
  }
  function paintPrev() {
    var el = $("#shPrev"); if (!el || !S) return;
    var r = { id: S.id, p: S.p };
    el.innerHTML = bubbleHtml(curParts(), S.mode, S.url);
    if (S.mode === "text") return;
    if (S.blob) return;
    var cur = S; // הגנה מפני החלפת תוכנית באמצע
    shareCard(r).then(function (b) {
      if (S !== cur) return;
      S.blob = b; S.url = URL.createObjectURL(b); if (S.mode === "card") paintPrev();
    }).catch(function () { if (S === cur && S.mode === "card") { S.mode = "text"; syncChips(); paintPrev(); TVG.pill("לא הצלחנו להכין את הכרטיס", 2200); } });
  }
  function syncChips() {
    [].forEach.call(document.querySelectorAll("[data-shmode]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-shmode") === S.mode)); });
    var n = $("#shNote"); if (n) n.hidden = S.mode !== "card";
  }
  function openWa(text) {
    TVG.openWa(text);
  }
  function download(blob) {
    var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = "tv-guide.png"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
  }
  function done(msg) { // אחרי שליחה/העתקה: סוגרים את חלון השיתוף ומאשרים בהודעה קטנה
    if (!$("#rem").hidden) TVG.closeRem();
    if (msg.indexOf("📤") === 0) TVG.celebrate && TVG.celebrate("share");
    TVG.pill(msg, 1800);
  }
  function send() {
    var x = curParts(), text = textOf(x, S.mode === "card");
    if (S.mode === "text") { openWa(text); done("📤 נשלח לוואטסאפ"); return; }
    if (!S.blob) { TVG.pill("הכרטיס עוד בהכנה, עוד רגע", 1500); return; }
    var file = null; try { file = new File([S.blob], "tv-guide.png", { type: "image/png" }); } catch (e) {}
    var fallback = function () { download(S.blob); openWa(text); if (!$("#rem").hidden) TVG.closeRem(); TVG.pill("התמונה נשמרה במכשיר. צרפו אותה להודעה בוואטסאפ", 5000); };
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text: text }).then(function () { done("📤 נשלח"); }).catch(function (e) { if (!e || e.name !== "AbortError") fallback(); });
    } else fallback();
  }
  function copyLink() {
    // ההודעה המלאה (פרטים, מילה אישית וקישור) – כמו בוואטסאפ. קישור לבד מוצג בוואטסאפ רק עם התמונה הכללית של האתר, בלי פרטי התוכנית
    var l = textOf(curParts(), false), ok = function () { done("📋 ההודעה הועתקה"); };
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
    if ((b = t.closest("[data-shsug]"))) { e.stopPropagation(); pickSug(+b.getAttribute("data-shsug")); return; }
    if ((b = t.closest("[data-shmode]"))) { e.stopPropagation(); S.mode = b.getAttribute("data-shmode"); syncChips(); paintPrev(); return; }
    if (t.closest("[data-shwa]")) { e.stopPropagation(); send(); return; }
    if (t.closest("[data-shcopy]")) { e.stopPropagation(); copyLink(); return; }
  }, true);

  // תמונת תצוגה מקדימה שלא נטענה: מסתירים אותה (בלי סמל תמונה שבורה)
  document.addEventListener("error", function (e) { var t = e.target; if (t && t.classList && t.classList.contains("shlimg")) t.remove(); }, true);

  document.addEventListener("input", function (e) {
    if (!S || !e.target || e.target.id !== "shMsg") return;
    S.msg = cleanMsg(e.target.value); syncSug(); paintPrev();
  });

  // קישור עמוק ?p=: דף הנחיתה ב-landing.js (TVG.openShared)
})(window.TVG);
