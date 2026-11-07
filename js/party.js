/* js/party.js - 🍿 ערב צפייה (בלי חשבונות). קישור ?w=<id>, שרת: calendar-server/api/party.js (+ _party.js).
   מארח: "🍿 קביעת ערב צפייה" מדף תוכן נטפליקס או מחלון תוכנית בלוח -> חלון תחתון (#party) -> שליחה בוואטסאפ. שורה בלשונית התזכורות -> חלון מארח (תשובות, שליחה שוב, ביטול, "3, 2, 1… פליי").
   אורח: דף נחיתה (#ptyL, אותו מראה של landing.js): מגיע/אולי/לא, הוספה ליומן, תזכורת. ספירה לאחור 3-2-1 במסך מלא (#ptyGo) מסונכרנת לשעון השרת.
   אחסון מקומי: tvg.name (שם פרטי של המארח/האורח) · tvg.gid (מזהה אורח אקראי, בלי קשר לטוקן האישי) · tvg.parties (הערבים שאני מארח: [{id,title,at,place,kind,ref,ch,img,link}]).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, netflix, nav, share, landing. כל הקישורים לקובצי אחרים מסומנים בהערה "// 🍿 ערב צפייה". */
(function (TVG) {
  TVG.files["party"] = 1;
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, dstr = TVG.dstr;
  TVG.openParty = openParty;
  TVG.partyNfBtn = nfBtn;
  TVG.partyBtn = tvBtn;

  var API = TVG.CAL_API + "/api/party", APP = "https://eladweiss-ops.github.io/tv-guide/";
  var RLM = "‏", CTA = "👇 לאישור הגעה לחצו כאן:";
  var DS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];
  var GO_BEFORE = 60 * 60000, GO_AFTER = 180 * 60000, HOUR = 3600000;
  var RE_NF = /^https:\/\/www\.(netflix|disneyplus)\.com\//, RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\//, RE_ID = /^[A-Za-z0-9_-]{22}$/;

  // ---- עזרים ----
  function bdi(s) { return "<bdi>" + esc(s) + "</bdi>"; }
  function ilWall(ms) { // רגע אמיתי -> Date שרכיביו (getHours...) הם שעון קיר ישראלי באותו רגע (הקיזוז של מועד האירוע, כולל מעבר שעון קיץ)
    var u = new Date(ms + TVG.ilOffMin(ms) * 60000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
  }
  TVG.partyWall = ilWall;
  function dayShort(w) { return w.getDay() === 6 ? "שבת" : "יום " + DS[w.getDay()]; }
  function dateTxt(ms) { var w = ilWall(ms); return dayShort(w) + " " + w.getDate() + "." + (w.getMonth() + 1); }
  function whenTxt(ms) { var w = ilWall(ms); return dayShort(w) + " " + hhmm(w); }
  function at21(add) { var w = TVG.ilNow(); w.setDate(w.getDate() + add); w.setHours(21, 0, 0, 0); return TVG.ilTs(w); }
  function tzDiff(ms) { return TVG.ilOffMin(ms) !== -new Date(ms).getTimezoneOffset(); }
  var RE_GID = /^[A-Za-z0-9][A-Za-z0-9_-]{14,30}[A-Za-z0-9]$/;
  function rndId() {
    var a = new Uint8Array(16), i, s = "";
    try { crypto.getRandomValues(a); } catch (e) { for (i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
    for (i = 0; i < 16; i++) s += String.fromCharCode(a[i]);
    var r = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return RE_GID.test(r) ? r : rndId();
  }
  function myGid() { var g = TVG.store("tvg.gid"); if (!g || !RE_GID.test(g)) { g = rndId(); TVG.store("tvg.gid", g); } return g; }
  function myName() { return String(TVG.store("tvg.name") || "").slice(0, 24); }
  function cleanName(s) { return String(s || "").replace(/[\u0000-\u001f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, 24); }
  function link(id) { return APP + "?w=" + id; }
  function inApp() { var UA = navigator.userAgent; // דפדפן פנימי של אפליקציה (כמו ב-landing.js): הורדת קובץ יומן לא עובדת בו
    if (TVG.isIOS) return !TVG.isStandalone && !/CriOS|FxiOS|EdgiOS/.test(UA) && (!/Safari\//.test(UA) || /WhatsApp|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter|GSA\//.test(UA));
    return /; wv\)|FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|TikTok|Twitter/.test(UA);
  }
  function canRem() { return !!TVG.canPush && (!TVG.isIOS || !!TVG.isStandalone) && !inApp(); }
  function anyOpen() {
    return ["#rem", "#favs", "#setsheet", "#land", "#nfsheet", "#party", "#ptyL"].some(function (s) { var e = $(s); return e && !e.hidden; });
  }
  function scrimOff() { if (!anyOpen()) $("#scrim2").hidden = true; }
  function show(sel) { $(sel).hidden = false; $("#scrim2").hidden = false; }
  function errMsg(e) {
    var c = e && e.code, st = e && e.status;
    if (st === 429) return "יותר מדי ניסיונות, נסו שוב בעוד דקה";
    if (c === "unknown token") return "עוד רגע מכינים את החשבון. נסו שוב בעוד כמה שניות";
    if (c === "removed") return "המארח הסיר את התשובה הזו";
    if (c === "bad title") return "בכותרת אי אפשר לשים קישור או מספר טלפון";
    if (c === "too many") return "יש כבר 10 ערבי צפייה פעילים. אפשר לבטל אחד בלשונית התזכורות";
    if (c === "full") return "הערב מלא, אי אפשר להוסיף עוד תשובות";
    if (c === "cancelled") return "הערב בוטל";
    if (c === "over") return "הערב כבר עבר";
    if (c === "window") return "אפשר להתחיל רק קרוב לשעת הערב";
    if (c === "bad name") return "כתבו שם פרטי (בלי קישורים)";
    if (st && st < 500) return "משהו לא תקין בבקשה, נסו שוב";
    return "אין חיבור לשרת, נסו שוב";
  }
  function same(r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || "http " + r.status); e.status = r.status; e.code = j.error; throw e; }
      return j;
    });
  }
  function apiPost(body) { return fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(same); }
  function apiGet(id) { return apiPost({ action: "get", id: id, gid: myGid() }); } // POST: ה-gid לא בכתובת
  function copyText(l, ok) {
    function old() { var t = document.createElement("textarea"); t.value = l; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;opacity:0"; document.body.appendChild(t); t.select(); var g = false; try { g = document.execCommand("copy"); } catch (e) {} t.remove(); if (g) ok(); else TVG.pill("לא הצלחנו להעתיק", 1800); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(l).then(ok, old); else old();
  }
  function openWa(text) {
    TVG.openWa(text);
  }

  // ---- הערבים שאני מארח (מקומי) ----
  var PL = [];
  try { PL = (JSON.parse(TVG.store("tvg.parties") || "[]") || []).filter(function (p) { return p && RE_ID.test(p.id || "") && typeof p.at === "number"; }); } catch (e) { PL = []; }
  var PC = {}; // id -> התצוגה הציבורית האחרונה מהשרת
  function savePL() { TVG.store("tvg.parties", JSON.stringify(PL)); }
  function mine(id) { for (var i = 0; i < PL.length; i++) if (PL[i].id === id) return PL[i]; return null; }
  function dropMine(id) { PL = PL.filter(function (p) { return p.id !== id; }); savePL(); }
  function addMine(p) { if (!mine(p.id)) { PL.push(p); savePL(); } }
  function cutOld() { var n = Date.now(), k = PL.length; PL = PL.filter(function (p) { return p.at + 2 * 86400000 > n; }); if (PL.length !== k) savePL(); }
  cutOld();

  // ---- כפתורי כניסה ----
  function nfBtn() { return '<button type="button" class="ghost" data-ptynf>🍿 ערב צפייה</button>'; } // 🍿 ערב צפייה (netflix.js barHtml)
  function tvBtn(p, cid) { // 🍿 ערב צפייה (reminder-sheet.js openRem). תוכנית שנגמרה: לא מציעים
    if (!cid || TVG.ilTs(p.e) <= Date.now() || TVG.ilTs(p.s) < Date.now() - GO_BEFORE) return "";
    return '<button type="button" class="ghost shbtn" data-ptytv="' + esc(cid) + "|" + p.s.getTime() + '">🍿 קביעת ערב צפייה</button>';
  }
  function srcNf(x, key) {
    var d = TVG.nfSvc(x) === "disney", lk = TVG.nfLinkOf(x), l = RE_NF.test(lk || "") && (d ? TVG.nfIsDs(x) : TVG.nfIsNf(x)) ? lk : "";
    return { kind: "nf", title: String(x.title || "").slice(0, 120), ref: key || x.k, link: l, img: RE_IMG.test(x.poster || "") ? x.poster : RE_IMG.test(x.backdrop || "") ? x.backdrop : "", ch: l ? (d ? "דיסני+" : "נטפליקס") : "", at: 0 };
  }
  function srcTv(r) {
    var pt = TVG.shareParts ? TVG.shareParts(r) : null;
    return { kind: "tv", title: String(r.p.title || "").slice(0, 120), ref: r.id + "|" + dstr(r.p.s) + "T" + hhmm(r.p.s), ch: TVG.chName(r.id), img: "", link: pt ? pt.link : "", at: TVG.ilTs(r.p.s) };
  }

  // ---- חלון יצירה (#party) ----
  var CR = null; // {src, when: "fixed"|"tonight"|"tomorrow"|"pick", pickMs, place, name, id, sig, busy}
  function atOf() { return CR.src.at || (CR.when === "tonight" ? at21(0) : CR.when === "tomorrow" ? at21(1) : CR.pickMs || 0); }
  function hostLine() { return CR.name ? "אצל " + TVG.bidiText(CR.name) : "אצלי"; }
  function textOf(P, id) {
    var w = ilWall(P.at), where = P.place === "home" ? (P.name ? "אצל " + TVG.bidiText(P.name) : "אצלי") : "כל אחד מהבית";
    var det = "ערב צפייה · " + dayShort(w) + " " + w.getDate() + "." + (w.getMonth() + 1) + " · " + hhmm(w) + " · " + where;
    return [RLM + "🍿 *" + TVG.bidiText(P.title).replace(/\*/g, "") + "*", det, "", RLM + CTA, link(id)].join("\n");
  }
  function bubble() {
    var P = CR.src, w = ilWall(atOf() || Date.now()), where = CR.place === "home" ? hostLine() : "כל אחד מהבית";
    return '<div class="shbub" dir="rtl">' +
      '<div class="shl1">🍿 <b>' + bdi(P.title) + "</b></div>" +
      '<div class="shl2">ערב צפייה · ' + esc(atOf() ? dayShort(w) + " " + w.getDate() + "." + (w.getMonth() + 1) + " · " + hhmm(w) : "בחרו שעה") + " · " + bdi(where) + "</div>" +
      '<div class="shgap"></div><div class="shl2">' + CTA + '</div><div class="shl3" dir="ltr">' + esc((CR.id ? link(CR.id) : APP + "?w=…").replace(/^https?:\/\//, "")) + "</div></div>";
  }
  function whenChips() {
    var tonight = at21(0) > Date.now() + 5 * 60000, w = CR.when;
    var h = '<div class="chips lp" role="group" aria-label="מתי">' +
      (tonight ? '<button type="button" class="chip" data-ptywhen="tonight" aria-pressed="' + (w === "tonight") + '">הערב 21:00</button>' : "") +
      '<button type="button" class="chip" data-ptywhen="tomorrow" aria-pressed="' + (w === "tomorrow") + '">מחר 21:00</button>' +
      '<button type="button" class="chip" data-ptywhen="pick" aria-pressed="' + (w === "pick") + '">בחירת שעה</button></div>';
    if (w === "pick") {
      var min = ilWall(Date.now() + 120000), val = ilWall(CR.pickMs || at21(1));
      h += '<div class="lpcustom"><input type="datetime-local" data-ptydt min="' + TVG.localVal(min) + '" value="' + TVG.localVal(val) + '" aria-label="מועד הערב"></div>';
    }
    return h;
  }
  function paintCreate() {
    var s = CR.src, h = '<h2>🍿 קביעת ערב צפייה</h2><p class="shsub">' + bdi(s.title) + "</p>";
    h += '<div class="lbl">מתי?</div>';
    if (s.at) h += '<p class="pty-fix"><span>🗓</span><span><b>' + esc(whenTxt(s.at)) + "</b> · " + bdi(TVG.bidi(s.ch)) + ' <small>(שעת השידור)</small></span></p>';
    else h += whenChips();
    h += '<div class="lbl">איפה?</div><div class="chips lp" role="group" aria-label="איפה">' +
      '<button type="button" class="chip" data-ptyplace="home" aria-pressed="' + (CR.place === "home") + '">🏠 אצלי</button>' +
      '<button type="button" class="chip" data-ptyplace="each" aria-pressed="' + (CR.place === "each") + '">🛋 כל אחד מהבית</button></div>';
    h += '<label class="lbl" for="ptyName">השם הפרטי שלך (יופיע בהזמנה)</label><input id="ptyName" class="pin" type="text" maxlength="24" autocomplete="given-name" placeholder="למשל: אלעד" value="' + esc(CR.name) + '">';
    h += '<p class="shsub">בערך ככה זה ייראה</p><div id="ptyPrev">' + bubble() + "</div>";
    h += '<button type="button" class="btn wa" data-ptysend>🟢 שליחה בוואטסאפ</button><button type="button" class="ghost shcopy" data-ptycopy>העתקת קישור</button>';
    $("#ptyBody").innerHTML = h;
  }
  function openCreate(src) {
    var first = src.at ? "fixed" : at21(0) > Date.now() + 5 * 60000 ? "tonight" : "tomorrow";
    CR = { src: src, when: first, pickMs: 0, place: "home", name: myName(), id: null, sig: "", busy: false };
    paintCreate(); show("#party");
  }
  function closePty() { var e = $("#party"); if (!e || e.hidden) return; e.hidden = true; CR = null; HS = null; scrimOff(); }
  function sigOf() { return [atOf(), CR.place, CR.name].join("|"); }
  function cancelQuiet(id) { dropMine(id); return apiPost({ action: "cancel", t: TVG.myTok(), id: id }).catch(function () {}); }
  function ensureCreated() {
    var at = atOf(), s = CR.src;
    if (!at || at < Date.now() - GO_BEFORE + 60000 || (!s.at && at < Date.now() + 60000)) return Promise.reject({ code: "time", msg: "בחרו זמן עתידי" });
    var sig = sigOf();
    if (CR.id && CR.sig === sig) return Promise.resolve(CR.id);
    var old = CR.id, cr = CR;
    return (old ? cancelQuiet(old) : Promise.resolve()).then(function () {
      return apiPost({ action: "create", t: TVG.myTok(), title: s.title, kind: s.kind, ref: s.ref, ch: s.ch, img: s.img, link: s.link, at: at, place: cr.place, name: cr.name });
    }).then(function (v) {
      cr.id = v.id; cr.sig = sig;
      addMine({ id: v.id, title: s.title, at: at, place: cr.place, kind: s.kind, ref: s.ref, ch: s.ch, img: s.img, link: s.link, name: cr.name });
      PC[v.id] = v;
      return v.id;
    });
  }
  function afterCreate(id, msg) {
    TVG.store("tvg.name", CR.name || "");
    closePty(); TVG.render(); TVG.celebrate && TVG.celebrate("party");
    TVG.pill(msg, 6000, "ביטול", function () { cancelQuiet(id).then(function () { TVG.render(); TVG.pill("הערב בוטל", 1500); }); });
  }
  function createFail(e) {
    if (CR) CR.busy = false;
    if (e && e.code === "unknown token") { try { TVG.store("tvg.sel", TVG.store("tvg.sel") || "[]"); } catch (x) {} } // מעורר גיבוי, והשרת יכיר את הטוקן
    TVG.pill(e && e.msg ? e.msg : errMsg(e), 2800);
  }
  function sendWa() {
    if (!CR || CR.busy) return; CR.busy = true;
    var cr = CR, P = { title: cr.src.title, at: atOf(), place: cr.place, name: cr.name };
    ensureCreated().then(function (id) {
      cr.busy = false; openWa(textOf(P, id)); afterCreate(id, "🍿 ההזמנה נשלחה. הערב נקבע ל" + whenTxt(P.at));
    }).catch(createFail);
  }
  function copyInvite() {
    if (!CR || CR.busy) return; CR.busy = true;
    var cr = CR;
    ensureCreated().then(function (id) { cr.busy = false; copyText(link(id), function () { afterCreate(id, "🔗 הקישור הועתק. הערב נקבע ל" + whenTxt(atOf())); }); }).catch(createFail);
  }

  // ---- חלון מארח (#party) ----
  var HS = null; // {id, v}
  function names(rs, ans) { return rs.filter(function (r) { return r.ans === ans; }).map(function (r) { return '<span class="pty-nm">' + bdi(r.name) + "</span>"; }).join(""); }
  function whoHtml(v) { // אורח: מי בפנים
    var rs = v.rsvps || [], y = names(rs, "yes"), m = names(rs, "maybe"), n = v.counts ? v.counts.no : 0, h = "";
    if (y) h += '<div class="pty-grp"><b>👍 בפנים (' + v.counts.yes + ')</b><div class="pty-nms">' + y + "</div></div>";
    if (m) h += '<div class="pty-grp"><b>🤔 אולי (' + v.counts.maybe + ')</b><div class="pty-nms">' + m + "</div></div>";
    if (n) h += '<p class="credit">' + n + " לא הפעם</p>";
    return h || '<p class="none">עדיין אף אחד לא ענה. אפשר להיות הראשונים 🙂</p>';
  }
  function hostWho(v) { // מארח: כל התשובות עם הסרה
    var rs = v.rsvps || [];
    if (!rs.length) return '<p class="none">עדיין אין תשובות. שלחו את ההזמנה בוואטסאפ ונעדכן כאן.</p>';
    var c = v.counts, h = '<div class="pty-cnt">👍 ' + c.yes + " · 🤔 " + c.maybe + (c.no ? " · לא הפעם " + c.no : "") + "</div>";
    return h + rs.map(function (r) {
      return '<div class="pty-rr"><span class="pty-rn">' + (r.ans === "yes" ? "👍" : r.ans === "maybe" ? "🤔" : "✖️") + " " + bdi(r.name) + '</span><button type="button" class="ghost sm" data-ptyrm="' + esc(r.rid || "") + '" data-n="' + esc(r.name) + '" aria-label="הסרת ' + esc(r.name) + ' מהרשימה">הסרה</button></div>';
    }).join("");
  }
  function inWindow(at) { var n = Date.now(); return n >= at - GO_BEFORE && n <= at + GO_AFTER; }
  function paintHost() {
    var p = mine(HS.id), v = HS.v || PC[HS.id]; if (!p) return;
    var at = p.at, where = p.place === "home" ? "אצלי" : "כל אחד מהבית";
    var h = "<h2>🍿 ערב צפייה</h2><p class=\"shsub\">" + bdi(p.title) + '</p><div class="meta"><span>' + esc(whenTxt(at)) + "</span><span>" + esc(where) + "</span></div>";
    h += v ? hostWho(v) : '<p class="none">טוענים את התשובות…</p>';
    if (HS.askCancel) h += '<div class="confirm"><span>לבטל את הערב?</span><button type="button" class="btn sm danger" data-ptycancelyes>כן, לבטל</button><button type="button" class="ghost sm" data-ptycancelno>להשאיר</button></div>';
    else {
      if (inWindow(at) && !(v && v.cancelled)) h += '<button type="button" class="btn" data-ptygo>🍿 פליי: <bdi dir="ltr">3, 2, 1</bdi></button>';
      h += '<button type="button" class="ghost wag" data-ptyresend>🟢 שליחה שוב בוואטסאפ</button><button type="button" class="ghost" data-ptycancel>ביטול הערב</button><button type="button" class="ghost" data-ptyclosehost>סגירה</button>';
    }
    h += '<p class="credit">ה-<bdi dir="ltr">3, 2, 1</bdi> מגיע בהתראה רק למי שהתקין את האפליקציה במסך הבית והפעיל התראות; מי שפתח את הקישור בדפדפן רואה אותו כשהדף פתוח אצלו.' + (v && v.host && v.host.push === false ? " כדי לקבל התראה כשמישהו עונה, הפעילו התראות בהגדרות." : "") + "</p>";
    $("#ptyBody").innerHTML = h;
  }
  function openHost(id) {
    HS = { id: id, v: PC[id] || null, askCancel: false };
    CR = null; paintHost(); show("#party");
    apiPost({ action: "view", t: TVG.myTok(), id: id }).then(function (v) {
      if (!HS || HS.id !== id) return; HS.v = v; PC[id] = v; paintHost();
    }).catch(function (e) {
      if (!HS || HS.id !== id) return;
      if (e.status === 404) { dropMine(id); closePty(); TVG.render(); TVG.pill("הערב הזה כבר לא קיים", 2200); }
    });
  }
  function resend() {
    var p = mine(HS.id); if (!p) return;
    openWa(textOf({ title: p.title, at: p.at, place: p.place, name: p.name || "" }, p.id));
    closePty(); TVG.celebrate && TVG.celebrate("share"); TVG.pill("📤 נשלח לוואטסאפ", 1800);
  }
  function doCancel() {
    var id = HS.id, p = mine(id); if (!p) return;
    apiPost({ action: "cancel", t: TVG.myTok(), id: id }).then(function () {
      dropMine(id); delete PC[id]; closePty(); TVG.render();
      TVG.pill("הערב בוטל", 6000, "החזר", function () {
        apiPost({ action: "cancel", t: TVG.myTok(), id: id, undo: true }).then(function () { addMine(p); TVG.render(); TVG.pill("הערב הוחזר ✓", 1500); }).catch(function (e) { TVG.pill(errMsg(e), 2500); });
      });
    }).catch(function (e) { HS.askCancel = false; paintHost(); TVG.pill(errMsg(e), 2500); });
  }
  function doRemove(rid, name) {
    var id = HS.id;
    apiPost({ action: "remove", t: TVG.myTok(), id: id, rid: rid }).then(function () {
      return apiPost({ action: "view", t: TVG.myTok(), id: id });
    }).then(function (v) {
      if (HS && HS.id === id) { HS.v = v; PC[id] = v; paintHost(); }
      TVG.pill("הוסרה התשובה של " + name, 6000, "החזר", function () {
        apiPost({ action: "remove", t: TVG.myTok(), id: id, rid: rid, undo: true }).then(function () { return apiPost({ action: "view", t: TVG.myTok(), id: id }); }).then(function (v2) {
          PC[id] = v2; if (HS && HS.id === id) { HS.v = v2; paintHost(); } TVG.pill("הוחזרה ✓", 1500);
        }).catch(function (e) { TVG.pill(errMsg(e), 2500); });
      });
    }).catch(function (e) { TVG.pill(errMsg(e), 2500); });
  }
  function doGo() {
    var id = HS.id, p = mine(id); if (!p) return;
    apiPost({ action: "go", t: TVG.myTok(), id: id }).then(function (r) {
      closePty();
      startCountdown({ id: id, title: p.title, kind: p.kind, ch: p.ch, link: p.link, go: r.go, now: r.now });
    }).catch(function (e) { TVG.pill(errMsg(e), 2800); });
  }

  // ---- שורות בלשונית התזכורות (עוטף את TVG.vRems, בלי לגעת ב-render-rems.js) ----
  var lastRefresh = 0, listed = 0;
  function listMine() { // מכשיר חדש/אחרי שחזור: הערבים שלי מהשרת (לפי hash הטוקן)
    listed = Date.now();
    return apiPost({ action: "list", t: TVG.myTok() }).then(function (j) {
      var add = 0;
      (j.parties || []).forEach(function (q) { if (RE_ID.test(q.id) && !mine(q.id)) { addMine({ id: q.id, title: q.title, at: q.at, place: q.place, kind: q.kind, ref: q.ref, ch: q.ch, img: q.img, link: q.link, name: q.name }); add++; } });
      if (add && TVG.tab === "rems") TVG.render();
    }).catch(function () {});
  }
  function refresh() {
    var n = Date.now(); if (n - lastRefresh < 25000) return; lastRefresh = n;
    if (!listed || n - listed > 6 * HOUR) listMine();
    PL.slice().forEach(function (p) {
      apiGet(p.id).then(function (v) {
        var old = PC[p.id]; PC[p.id] = v;
        if ((!old || JSON.stringify(old.counts) !== JSON.stringify(v.counts) || old.cancelled !== v.cancelled) && TVG.tab === "rems") TVG.render();
        if (v.cancelled) { dropMine(p.id); if (TVG.tab === "rems") TVG.render(); }
      }).catch(function (e) { if (e.status === 404) { dropMine(p.id); if (TVG.tab === "rems") TVG.render(); } });
    });
  }
  function countTxt(v) {
    if (!v) return "";
    var y = v.counts.yes, m = v.counts.maybe;
    if (!y && !m) return "עדיין אין תשובות";
    return "👍 " + y + " · 🤔 " + m;
  }
  function rows() {
    var n = Date.now(), L = PL.filter(function (p) { return p.at + GO_AFTER > n; }).sort(function (a, b) { return a.at - b.at; });
    refresh();
    if (!L.length) return "";
    return '<h2 class="sech">🍿 ערבי צפייה</h2>' + L.map(function (p) {
      var w = ilWall(p.at), c = countTxt(PC[p.id]);
      return '<div class="srow k-ent"><button type="button" class="go" data-party="' + esc(p.id) + '"><span class="time">' + hhmm(w) + '</span><span class="ttl">🍿 ' + bdi(p.title) + '<br><span class="sub">ערב צפייה · ' + esc(dayShort(w)) + (c ? " · " + esc(c) : "") + "</span></span></button></div>";
    }).join("");
  }
  var vRems0 = TVG.vRems;
  TVG.vRems = function () { // 🍿 ערב צפייה: הערבים שלי מתחת ל"תזכורת אישית"
    var h = vRems0.apply(this, arguments), r = rows();
    if (!r) return h;
    var m = /data-personal>[^<]*<\/button>/.exec(h);
    return m ? h.slice(0, m.index + m[0].length) + r + h.slice(m.index + m[0].length) : r + h;
  };

  // ---- דף נחיתה לאורח (#ptyL) ----
  var GV = null; // {id, v, ans, busy, safari, tick, name}
  var poll = 0;
  function whereTxt(v) { return v.place === "home" ? (v.host.name ? "אצל " + v.host.name : "אצל המארח") : "כל אחד מהבית"; }
  function topBar() { return '<div class="lnd-top"><span class="lnd-brand">📺 זפזופ</span><button type="button" class="glass round lnd-x" data-ptyclose aria-label="סגירה">✕</button></div>'; }
  function hasWatch(v) { return v.kind === "nf" && RE_NF.test(v.link || ""); }
  function landBody() {
    var v = GV.v, h = topBar();
    if (!v) {
      if (GV.err === 404) return h + '<div class="lnd-empty"><div class="lnd-big">🔎</div><h1>לא מצאנו את הערב</h1><p>ייתכן שהקישור לא נכון, או שהערב כבר עבר.</p></div>';
      return h + '<div class="lnd-empty"><div class="lnd-big">⏳</div><h1>' + (GV.err ? "אין חיבור" : "רגע, טוענים…") + "</h1>" + (GV.err ? "<p>בדקו את החיבור ופתחו שוב את הקישור.</p>" : "") + "</div>";
    }
    var over = Date.now() > v.at + GO_AFTER, mn = v.mine || null, a = mn ? mn.ans : "";
    if (v.cancelled) h += '<div class="lnd-note">❌ הערב בוטל.</div>';
    else if (over) h += '<div class="lnd-note">⏱ הערב הזה כבר עבר.</div>';
    var inv = v.host.name ? "🍿 הזמנה מ" + bdi(v.host.name) + " לערב צפייה" : "🍿 הזמנה לערב צפייה";
    h += '<div class="lnd-hero k-ent pty-hero">' + (v.img ? '<img class="pty-pos" alt="" src="' + esc(v.img) + '">' : '<div class="lnd-em" aria-hidden="true">🍿</div>') +
      '<div class="pty-ht"><div class="pty-inv">' + inv + '</div><h1 class="lnd-ttl"><bdi dir="auto">' + esc(v.title) + "</bdi></h1></div></div>";
    // התשובה קודם: זו הפעולה הראשית של הדף, וצריכה להיות על המסך בלי לגלול. שם קודם, ואז הבחירה
    if (!v.cancelled && !over) {
      var pend = GV.pending || "";
      h += '<div class="lnd-meta glass pty-ask"><label class="pty-h" for="ptyGName">איך קוראים לכם?</label>' +
        '<input id="ptyGName" class="pin" type="text" maxlength="24" autocomplete="given-name" enterkeyhint="done" placeholder="שם פרטי (יופיע ברשימה)" value="' + esc(GV.name) + '">' +
        '<p class="pty-hint" id="ptyHint"' + (pend && !GV.name ? "" : " hidden") + ">רק השם ונשלח</p>" +
        '<div class="pty-h">אתם בפנים?</div><div class="chips pty-chips" role="group" aria-label="התשובה שלכם">' +
        [["yes", "אני בפנים 👍"], ["maybe", "אולי 🤔"], ["no", "לא הפעם"]].map(function (x) { return '<button type="button" class="chip pty-ans" data-ptyans="' + x[0] + '" aria-pressed="' + (a === x[0] || pend === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>" +
        (a ? '<p class="credit">✓ התשובה נשמרה. אפשר לשנות אותה בכל רגע.</p>' : "") + "</div>";
    }
    var tz = tzDiff(v.at) ? ' <small class="lnd-tz">(שעון ישראל)</small>' : "", w = ilWall(v.at);
    h += '<div class="lnd-meta glass"><div class="lnd-row"><span class="lnd-ic">🗓</span><span>' + esc(dayShort(w) + " " + w.getDate() + "." + (w.getMonth() + 1)) + "</span></div>" +
      '<div class="lnd-row"><span class="lnd-ic">🕐</span><span><bdi dir="ltr">' + hhmm(w) + "</bdi>" + tz + "</span></div>" +
      '<div class="lnd-row"><span class="lnd-ic">📍</span><span>' + bdi(whereTxt(v)) + "</span></div>";
    if (hasWatch(v)) h += '<div class="lnd-row"><span class="lnd-ic">🎬</span><span>' + (/disneyplus/.test(v.link) ? "בדיסני+" : "בנטפליקס") + '</span><a class="pty-open" href="' + esc(v.link) + '" target="_blank" rel="noopener">פתיחה</a></div>';
    else if (v.kind === "tv" && v.ch) h += '<div class="lnd-row"><span class="lnd-ic">📺</span><span>בערוץ ' + bdi(TVG.bidi(v.ch)) + "</span></div>";
    else h += '<div class="lnd-row"><span class="lnd-ic">🎬</span><span>צפייה</span></div>';
    h += "</div>";
    h += '<div class="lnd-meta glass pty-who"><div class="pty-h">מי בפנים</div>' + whoHtml(v) + "</div>";
    if (!v.cancelled && !over && (a === "yes" || a === "maybe")) {
      h += '<p class="pty-note">' + (mn && mn.push ? "🔔 תקבלו התראה כשמתחילים" : "💡 כדי לקבל את ה-<bdi dir=\"ltr\">3, 2, 1</bdi> בטלפון צריך את האפליקציה במסך הבית עם התראות. בלי זה, משאירים את הדף הזה פתוח כשמתקרבים לשעה והוא יציג את הספירה.") + "</p>";
    }
    return h;
  }
  function landBar() {
    var v = GV.v, guide = '<button type="button" class="lnd-link" data-ptyguide>לכל לוח השידורים</button>';
    if (!v || v.cancelled || Date.now() > v.at + GO_AFTER) return '<button type="button" class="btn" data-ptyguide>📺 לכל לוח השידורים</button>';
    var a = v.mine ? v.mine.ans : "";
    if (!a) return guide;
    if (a === "no") return '<button type="button" class="btn" data-ptyguide>📺 לכל לוח השידורים</button><button type="button" class="lnd-link" data-ptyclose>סגירה</button>';
    if (GV.safari) return '<div class="lnd-safari"><b>🧭 פתחו ב-Safari</b><span>הדפדפן הפנימי לא מוסיף ליומן. בתפריט ⋯ בוחרים פתיחה ב-Safari.</span></div><button type="button" class="btn" data-ptycopyl>📋 העתקת הקישור</button>' + guide;
    var rk = remKey(v), has = TVG.hasRem(rk);
    return '<button type="button" class="btn" data-ptycal>📅 הוספה ליומן</button>' +
      (canRem() ? '<button type="button" class="ghost" data-ptyrem>' + (has ? "✓ יש תזכורת · ביטול" : "⏰ תזכורת עם התראה") + "</button>" : "") + guide;
  }
  // מציירים מחדש רק כשמשהו השתנה: הסקירה כל 2 שניות לא מחליפה כפתורים מתחת לאצבע (ולא מאבדת פוקוס/גלילה)
  var landLast = "";
  function paintLand(keep) {
    var sc = $("#ptyLBody"), top = keep ? sc.scrollTop : 0, body = landBody(), bar = landBar();
    if (keep && body + " " + bar === landLast) return;
    landLast = body + " " + bar;
    sc.innerHTML = body; $("#ptyLBar").innerHTML = bar; sc.scrollTop = top;
  }
  function openLandFor(id) {
    GV = { id: id, v: null, err: 0, safari: false, name: myName() };
    TVG.setSearch(false); if (!$("#rem").hidden) TVG.closeRem();
    paintLand(); show("#ptyL");
    return load();
  }
  function load() {
    var gv = GV, id = gv.id;
    return apiGet(id).then(function (v) {
      if (GV !== gv) return null;
      gv.v = v; gv.err = 0; gv.off = v.now - Date.now(); if (v.mine && !gv.name) gv.name = v.mine.name;
      paintLand(true); schedulePoll(); syncPush(); return v;
    }).catch(function (e) { if (GV === gv) { gv.err = e.status || 1; paintLand(true); } return null; });
  }
  // חלון הערב בשעון השרת: אותו חלון של השרת ל"פליי" (-60/+180 דקות). בתוכו סוקרים כל 2 שניות, מחוצה לו כל 30 שניות
  function srvNow(gv) { return Date.now() + (gv.off || 0); }
  function inSrvWindow(gv) { var n = srvNow(gv); return n >= gv.v.at - GO_BEFORE && n <= gv.v.at + GO_AFTER; }
  function schedulePoll() {
    clearInterval(poll); poll = 0;
    if (!GV || !GV.v) return;
    var ticks = 0;
    poll = setInterval(function () {
      if (!GV || !GV.v || $("#ptyL").hidden || document.hidden) return;
      syncPush();
      ticks++;
      if (!inSrvWindow(GV) && ticks % 15) return;
      var gv = GV, was = gv.v && gv.v.go || 0;
      apiGet(gv.id).then(function (v) {
        if (GV !== gv) return;
        gv.v = v; gv.off = v.now - Date.now();
        if (v.go && v.go !== was && v.go > v.now - 15000) { startCountdown(v); return; }
        var ae = document.activeElement; if (ae && ae.id === "ptyGName") return; // לא מפריעים באמצע הקלדה
        paintLand(true);
      }).catch(function () {});
    }, 2000);
  }
  // אורח שהפעיל התראות אחרי שענה: שולחים שוב את אותה תשובה עם הטוקן, בשקט, כדי שהשרת יוכל לשלוח לו פוש. "🔔 תקבלו התראה" מוצג רק כשהשרת אישר
  function syncPush() {
    var gv = GV; if (!gv || !gv.v || !gv.v.mine || gv.v.mine.push || !TVG.pushOn || gv.syncing || (gv.syncTry || 0) >= 3) return;
    gv.syncing = true; gv.syncTry = (gv.syncTry || 0) + 1;
    apiPost({ action: "rsvp", id: gv.id, gid: myGid(), name: gv.v.mine.name, ans: gv.v.mine.ans, t: TVG.myTok() }).then(function (v) {
      gv.syncing = false; if (GV !== gv) return; gv.v = v; gv.off = v.now - Date.now(); paintLand(true);
    }).catch(function () { gv.syncing = false; });
  }
  function closeGuest() {
    var e = $("#ptyL"); if (!e || e.hidden) return;
    e.hidden = true; clearInterval(poll); poll = 0; GV = null; scrimOff();
  }
  function answer(ans) {
    if (!GV || !GV.v || GV.busy) return;
    var inp = $("#ptyGName"), name = cleanName(inp ? inp.value : GV.name);
    GV.name = name;
    if (!name) { // זוכרים את הבחירה, ושולחים ברגע שהשם נכתב ואושר
      GV.pending = ans; paintLand(true); inp = $("#ptyGName"); if (inp) inp.focus(); return;
    }
    var gv = GV; gv.busy = true; gv.pending = "";
    apiPost({ action: "rsvp", id: gv.id, gid: myGid(), name: name, ans: ans, t: TVG.myTok() }).then(function (v) {
      gv.busy = false; if (GV !== gv) return;
      TVG.store("tvg.name", name); gv.v = v; gv.off = v.now - Date.now(); paintLand(true);
      if (ans === "yes") TVG.celebrate && TVG.celebrate("party"); TVG.pill(ans === "yes" ? "👍 נשמר: אני בפנים" : ans === "maybe" ? "🤔 נשמר: אולי" : "נשמר: לא הפעם", 2200);
      syncPush();
    }).catch(function (e) { gv.busy = false; TVG.pill(errMsg(e), 2800); });
  }
  function remKey(v) { return "w|" + v.id + "|" + v.at; }
  function eventOf(v) {
    var s = ilWall(v.at);
    return { id: "w" + v.id, p: { title: "🍿 " + v.title, s: s, e: new Date(s.getTime() + 2.5 * HOUR), desc: "ערב צפייה" + (v.host.name ? " אצל " + v.host.name : "") + "\n" + link(v.id) } };
  }
  function addCal() {
    var v = GV && GV.v; if (!v) return;
    if (TVG.isIOS && inApp()) { GV.safari = true; paintLand(true); return; }
    var r = eventOf(v);
    if (TVG.isAndroid) {
      if (inApp()) { location.href = TVG.gcalUrl(r); return; }
      TVG.calAdd(r); TVG.pill("נפתח יומן Google. לוחצים שם ״שמירה״", 3500); return;
    }
    var nm = ("ערב צפייה " + v.title).replace(/[\\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) + ".ics";
    TVG.saveIcs(TVG.icsText({ id: r.id, p: r.p, lead: 15 }), nm);
    TVG.pill("📅 לחצו על הקובץ שהורד כדי להוסיף ליומן", 3500);
  }
  function remind() {
    var v = GV && GV.v; if (!v) return;
    var k = remKey(v), ex = TVG.hasRem(k);
    if (ex) { TVG.cancelRem(k); paintLand(true); return; }
    var lead = TVG.fitLead(v.at, 15);
    var rec = { k: k, id: "", ts: v.at, end: v.at + 3 * HOUR, title: "🍿 " + v.title, ch: "ערב צפייה", desc: "", lead: lead, at: Date.now() };
    if (TVG.addRec(rec, ilWall(v.at)) === "pending") return; // הפעלת התראות בדרך; ההודעה מגיעה מ-push.js
    paintLand(true);
    TVG.celebrate && TVG.celebrate("rem"); TVG.pill("⏰ נזכיר לך " + TVG.leadTxt(lead, v.at), 5000, "ביטול", function () { TVG.cancelRem(k); if (GV) paintLand(true); });
  }
  function openParty(id, go) { // נקרא מ-nav.js: ?w=<id>[&go=1], ומתזכורת/הודעה
    if (!RE_ID.test(String(id || ""))) { TVG.pill("לא מצאנו את הערב הזה", 2200); return; }
    if (mine(id) && !go) { openHost(id); return; }
    var gv = openLandFor(id);
    if (!mine(id)) listMine().then(function () { if (mine(id) && GV && GV.id === id && !go) { closeGuest(); openHost(id); } }); // מארח במכשיר חדש: פותח את תצוגת המארח
    if (go) gv.then(function (v) {
      if (v && v.go && v.go > v.now - 10 * 60000) startCountdown(v);
    });
  }

  // ---- ספירה לאחור 3-2-1 (מסך מלא), מסונכרנת לשעון השרת ----
  var CD = null, cdBox = document.createElement("section");
  cdBox.id = "ptyGo"; cdBox.hidden = true; cdBox.setAttribute("role", "dialog"); cdBox.setAttribute("aria-modal", "true"); cdBox.setAttribute("aria-label", "ערב צפייה: מתחילים");
  document.body.appendChild(cdBox);
  function startCountdown(v) {
    if (CD && CD.id === v.id && CD.go === v.go) return;
    stopCountdown(true);
    CD = { id: v.id, go: v.go, off: v.now - Date.now(), v: v, end: false };
    cdBox.hidden = false; $("#scrim2").hidden = false;
    cdPaint(); CD.timer = setInterval(cdTick, 100); cdTick();
  }
  function cdFinal() {
    var v = CD.v, nf = v.kind === "nf" && RE_NF.test(v.link || "");
    return '<div class="pty-go-in"><div class="pty-big pty-play" aria-live="assertive">▶ פליי!</div><p class="pty-go-t"><bdi dir="auto">' + esc(v.title) + "</bdi></p>" +
      (nf ? '<a class="btn nfgo" href="' + esc(v.link) + '" target="_blank" rel="noopener">▶ פתיחה ב' + (/disneyplus/.test(v.link) ? "דיסני+" : "נטפליקס") + '</a>' : v.ch ? '<p class="pty-go-ch">📺 עברו לערוץ <bdi>' + esc(TVG.bidi(v.ch)) + "</bdi></p>" : "") +
      '<button type="button" class="ghost" data-ptygoclose>סגירה</button></div>';
  }
  function cdPaint() {
    cdBox.innerHTML = '<div class="pty-go-in"><div class="pty-pop" aria-hidden="true">🍿</div><div class="pty-big" id="ptyN" aria-hidden="true"></div><p class="pty-go-t" id="ptyT" role="status">מתכוננים…</p><button type="button" class="ghost" data-ptygoclose>סגירה</button></div>';
  }
  function cdTick() {
    if (!CD) return;
    var rem = CD.go - (Date.now() + CD.off);
    if (rem <= 0) {
      if (!CD.end) { CD.end = true; clearInterval(CD.timer); cdBox.innerHTML = cdFinal(); try { if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate([120, 60, 220]); } catch (e) {} }
      return;
    }
    var n = $("#ptyN"), t = $("#ptyT"); if (!n) return;
    var sec = Math.ceil(rem / 1000);
    if (rem > 3000) { n.textContent = "…"; if (t) t.textContent = "מתכוננים… מתחילים ביחד בעוד " + sec + " שניות"; }
    else { var s = String(sec); if (n.textContent !== s) { n.textContent = s; n.classList.remove("tick"); void n.offsetWidth; n.classList.add("tick"); } if (t) t.textContent = "בעוד " + sec + "…"; }
  }
  function stopCountdown(keepBox) {
    if (CD) clearInterval(CD.timer);
    CD = null; if (!keepBox) { cdBox.hidden = true; cdBox.innerHTML = ""; scrimOff(); }
  }
  TVG.navLayer("#party", closePty);
  TVG.navLayer("#ptyL", closeGuest);
  TVG.navLayer("#ptyGo", function () { stopCountdown(); });

  // סגירה דרך קוד קיים (לחיצה על הרקע): סוגר קודם את חלון הערב העליון, בלי לסגור את מה שמתחתיו
  var closeLand0 = TVG.closeLand;
  TVG.closeLand = function (a) { if (CD) { stopCountdown(); return; } if (GV && !$("#ptyL").hidden) { closeGuest(); return; } if (closeLand0) closeLand0(a); }; // 🍿 ערב צפייה
  $("#scrim2").addEventListener("click", function (e) {
    if (CD) { e.stopImmediatePropagation(); e.stopPropagation(); stopCountdown(); return; }
    if (!$("#party").hidden) { e.stopImmediatePropagation(); e.stopPropagation(); closePty(); return; }
    if (!$("#ptyL").hidden) { e.stopImmediatePropagation(); e.stopPropagation(); closeGuest(); }
  }, true);

  // ---- הקשות (שלב הלכידה, כמו share.js: כפתור בתוך שורה/כרטיס לא פותח אותם) ----
  function stop(e) { e.stopPropagation(); }
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return; var b;
    if (t.closest("#ptyGo")) {
      if (t.closest("[data-ptygoclose]")) { stop(e); stopCountdown(); }
      return;
    }
    if (t.closest("[data-ptynf]")) { stop(e); var x = TVG.nfGet && TVG.nfGet(TVG.nfOpen); if (x) openCreate(srcNf(x, TVG.nfOpen)); return; }
    if ((b = t.closest("[data-ptytv]"))) { stop(e); var r = TVG.findProg(b.getAttribute("data-ptytv")); if (r) openCreate(srcTv(r)); else TVG.pill("התוכנית כבר לא בלוח", 1800); return; }
    if ((b = t.closest("[data-party]"))) { stop(e); openHost(b.getAttribute("data-party")); return; }
    if ((b = t.closest("[data-jump]")) && /^w\|[A-Za-z0-9_-]{22}\|/.test(b.getAttribute("data-jump"))) { stop(e); openParty(b.getAttribute("data-jump").split("|")[1]); return; }
    if (t.closest("#party")) {
      if (CR) {
        if ((b = t.closest("[data-ptywhen]"))) { stop(e); var w = b.getAttribute("data-ptywhen"); CR.when = w; if (w === "pick" && !CR.pickMs) CR.pickMs = at21(1); paintCreate(); return; }
        if ((b = t.closest("[data-ptyplace]"))) { stop(e); CR.place = b.getAttribute("data-ptyplace"); paintCreate(); return; }
        if (t.closest("[data-ptysend]")) { stop(e); sendWa(); return; }
        if (t.closest("[data-ptycopy]")) { stop(e); copyInvite(); return; }
      }
      if (HS) {
        if (t.closest("[data-ptygo]")) { stop(e); doGo(); return; }
        if (t.closest("[data-ptyresend]")) { stop(e); resend(); return; }
        if (t.closest("[data-ptycancel]")) { stop(e); HS.askCancel = true; paintHost(); return; }
        if (t.closest("[data-ptycancelno]")) { stop(e); HS.askCancel = false; paintHost(); return; }
        if (t.closest("[data-ptycancelyes]")) { stop(e); doCancel(); return; }
        if (t.closest("[data-ptyclosehost]")) { stop(e); closePty(); return; }
        if ((b = t.closest("[data-ptyrm]"))) { stop(e); doRemove(b.getAttribute("data-ptyrm"), b.getAttribute("data-n") || ""); return; }
      }
      return;
    }
    if (t.closest("#ptyL")) {
      if (t.closest("[data-ptyclose]")) { stop(e); closeGuest(); return; }
      if (t.closest("[data-ptyguide]")) { stop(e); closeGuest(); if (TVG.needsPick && TVG.needsPick() && TVG.store("tvg.tab") !== "nf") TVG.openSheet(true); return; }
      if ((b = t.closest("[data-ptyans]"))) { stop(e); answer(b.getAttribute("data-ptyans")); return; }
      if (t.closest("[data-ptycal]")) { stop(e); addCal(); return; }
      if (t.closest("[data-ptyrem]")) { stop(e); remind(); return; }
      if (t.closest("[data-ptycopyl]")) { stop(e); copyText(link(GV.id), function () { TVG.pill("🔗 הקישור הועתק. הדביקו אותו ב-Safari", 3000); }); return; }
    }
  }, true);
  document.addEventListener("input", function (e) {
    var t = e.target; if (!t || !t.matches) return;
    if (CR && t.id === "ptyName") { CR.name = cleanName(t.value); var pv = $("#ptyPrev"); if (pv) pv.innerHTML = bubble(); }
    else if (CR && t.hasAttribute("data-ptydt")) {
      var m = String(t.value).match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/);
      if (m) { CR.pickMs = TVG.ilTs(new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5])); var pv2 = $("#ptyPrev"); if (pv2) pv2.innerHTML = bubble(); }
    } else if (GV && t.id === "ptyGName") { GV.name = cleanName(t.value); var hn = $("#ptyHint"); if (hn) hn.hidden = !(GV.pending && !GV.name); }
  });
  // אישור השם (Enter / סיום / עזיבת השדה): אם כבר בחרו תשובה, היא נשלחת עכשיו
  document.addEventListener("change", function (e) { var t = e.target; if (GV && t && t.id === "ptyGName") { GV.name = cleanName(t.value); if (GV.pending && GV.name) answer(GV.pending); } });
  document.addEventListener("keydown", function (e) { var t = e.target; if (e.key === "Enter" && t && t.id === "ptyGName") { e.preventDefault(); t.blur(); } });
})(window.TVG);
