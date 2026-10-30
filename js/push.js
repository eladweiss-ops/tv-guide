/* js/push.js - התראות פוש (Web Push), הגדרות אישיות (openPersonal), כרטיסי פוש/יומן.
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet. */
(function (TVG) {
  var $ = TVG.$, esc = TVG.esc, hhmm = TVG.hhmm, CAL_API = TVG.CAL_API;
  TVG.calCard = calCard;
  TVG.enablePush = enablePush;
  TVG.openPersonal = openPersonal;
  TVG.pChips = pChips;
  TVG.pushCard = pushCard;
  TVG.pushReg = pushReg;
  TVG.savePersonal = savePersonal;

  // ---- התראות פוש ישירות לטלפון ----
  var VAPID = "BCOXYdOEbd_FudtM1149DTOT_kQYsUtiATFGx2KyrmYie4lWrQwiNsmsjwVlKrkkZwv3-MHmhMrUGo9sJShrcjU";
  TVG.canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent),
      standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
  if (TVG.canPush) { try { navigator.serviceWorker.register("sw.js").catch(function () {}); } catch (e) {} }
  if (TVG.pushOn && TVG.canPush && Notification.permission !== "granted") { TVG.pushOn = false; TVG.store("tvg.push", "0"); }
  function b64u(s) { var p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function pushReg(silent) {
    return navigator.serviceWorker.register("sw.js").then(function () { return navigator.serviceWorker.ready; })
      .then(function (reg) { return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID) }); }); })
      .then(function (sub) { return fetch(CAL_API + "/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: TVG.myTok(), sub: sub.toJSON() }) }); })
      .then(function (r) { if (!r.ok) throw 0; return true; });
  }
  function enablePush() {
    if (!TVG.canPush) { TVG.pill(isIOS && !standalone ? "התראות עובדות רק מהאפליקציה שבמסך הבית" : "המכשיר הזה לא תומך בהתראות", 2600); return; }
    var pend = TVG.rem; TVG.myTok();
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") { TVG.pill("ההתראות לא אושרו. אפשר לאשר בהגדרות ← התראות ← לוח שידורים", 3500); return; }
      TVG.pill("מפעיל התראות…", 4000);
      return pushReg().then(function () {
        TVG.pushOn = true; TVG.store("tvg.push", "1");
        return TVG.syncRems().then(function () {
          TVG.closeRem();
          if (pendRec) { TVG.REMS.push(pendRec); TVG.saveRems(); TVG.syncRems(); TVG.pill("⏰ נזכיר לך " + TVG.leadTxt(pendRec.lead, pendRec.ts), 2200); pendRec = null; TVG.render(); }
          else if (pend && !TVG.hasRem(TVG.remKey(pend.id, pend.p.s))) TVG.quickAdd([pend]); else TVG.render();
          fetch(CAL_API + "/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: TVG.calTok, test: 1 }) });
          if (!pend && !TVG.REMS.length) TVG.pill("🔔 ההתראות הופעלו! שלחנו התראת בדיקה", 3000);
        });
      });
    }).catch(function () { TVG.pill("לא הצלחתי להפעיל התראות, נסו שוב", 2500); });
  }
  // ---- תזכורת אישית: כל דבר שראיתם בטלוויזיה (הופעה, אירוע, QR) ----
  TVG.pLead = 0;
  var pendRec = null;
  function openPersonal() {
    TVG.rem = null; TVG.LP = null;
    var d = new Date(Date.now() + 3600000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    $("#remBody").innerHTML = '<h2>➕ תזכורת אישית</h2><p class="remnote">לכל דבר שראיתם בטלוויזיה: הופעה, אירוע, מבצע, קוד QR על המסך.</p>' +
      '<label class="lbl" for="pTitle">מה להזכיר?</label><input id="pTitle" class="pin" type="text" maxlength="120" placeholder="למשל: כרטיסים להופעה" autocomplete="off">' +
      '<label class="lbl" for="pWhen">מתי?</label><input id="pWhen" class="pin" type="datetime-local" min="' + TVG.localVal(new Date(Date.now() + 60000)) + '" value="' + TVG.localVal(d) + '">' +
      '<div class="lbl">כמה זמן לפני להזכיר?</div><div class="chips lp" role="group">' + [[0, "בזמן"], [10, "10 דק׳"], [60, "שעה"], [1440, "יום"]].map(function (x) {
        return '<button type="button" class="chip" data-plead="' + x[0] + '" aria-pressed="' + (TVG.pLead === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>" +
      '<button type="button" class="btn" data-psave>שמירת התזכורת</button><button type="button" class="ghost" data-remclose>ביטול</button>';
    $("#rem").hidden = false; $("#scrim2").hidden = false;
    pChips();
    setTimeout(function () { var i = $("#pTitle"); if (i) i.focus(); }, 50);
  }
  // אפשרויות שכבר לא אפשריות לזמן שנבחר (למשל "יום לפני" לאירוע בעוד שעה) – כבויות
  function pChips() {
    var v = $("#pWhen") && $("#pWhen").value, ts = v ? new Date(v).getTime() : 0;
    [].forEach.call(document.querySelectorAll("[data-plead]"), function (b) {
      var m = +b.getAttribute("data-plead"), ok = !ts || ts - m * 60000 > Date.now() + 30000 || m === 0;
      b.disabled = !ok; if (!ok && TVG.pLead === m) { TVG.pLead = 0; }
      b.setAttribute("aria-pressed", String(TVG.pLead === m));
    });
  }
  function savePersonal() {
    var title = ($("#pTitle").value || "").trim(), v = $("#pWhen").value, d = v ? new Date(v) : null;
    if (!title) { TVG.pill("כתבו מה להזכיר", 1500); $("#pTitle").focus(); return; }
    if (!d || isNaN(d)) { TVG.pill("בחרו תאריך ושעה", 1500); return; }
    var ts = d.getTime();
    if (ts < Date.now() + 60000) { TVG.pill("בחרו זמן עתידי", 1500); return; }
    var rec = { k: "p|" + ts + "|" + Math.random().toString(36).slice(2, 7), id: "", ts: ts, end: ts + 3600000, title: title, ch: "תזכורת אישית", desc: "", lead: TVG.fitLead(ts, TVG.pLead), at: Date.now() };
    if (!TVG.srv() && TVG.canPush) { pendRec = rec; enablePush(); return; }
    TVG.REMS.push(rec); TVG.saveRems();
    if (TVG.srv()) TVG.syncRems(); else TVG.saveIcs(TVG.icsText({ id: "personal", p: { title: title, s: d, e: new Date(rec.end), desc: "" }, lead: rec.lead }), "reminder.ics");
    TVG.closeRem(); TVG.render(); TVG.pill("⏰ נזכיר לך " + (rec.lead ? TVG.leadTxt(rec.lead, ts) : "ב-" + hhmm(d)), 2200);
  }
  function pushCard() {
    if (TVG.pushOn) return '<details class="calopt"><summary>🔔 התראות לטלפון פעילות ✓</summary><p class="remnote">תזכורת קופצת כהתראה בטלפון בזמן שבחרתם, גם כשהאפליקציה סגורה.</p><div class="bar"><button type="button" class="ghost" data-pushtest>שליחת התראת בדיקה</button></div></details>';
    if (TVG.canPush) return '<div class="note pushnote">🔔 <b>קבלו התראה ישירות לטלפון</b>, בדיוק בזמן שבחרתם, גם כשהאפליקציה סגורה.<div class="bar"><button type="button" class="btn sm" data-pushon>הפעלת התראות</button></div></div>';
    if (isIOS && !standalone) return '<div class="note">🔔 כדי לקבל התראות ישירות לטלפון, פתחו את האפליקציה מהאייקון במסך הבית.</div>';
    return "";
  }
  function calCard() {
    if (TVG.calMode === "sub") return (TVG.syncBad ? '<div class="note">⚠️ השינוי האחרון עוד לא הגיע ליומן. <button type="button" class="ghost" data-calsync>לנסות שוב</button></div>' : "") +
      '<details class="calopt"><summary>📅 יומן "לוח שידורים" מחובר ✓</summary><p class="remnote">כל תזכורת שמוסיפים או מבטלים כאן מתעדכנת ביומן לבד (בדרך כלל תוך רבע שעה).</p>' +
      '<div class="bar"><a class="ghost" data-calsub href="' + esc(TVG.calUrl()) + '">חיבור היומן מחדש</a><button type="button" class="ghost" data-calics>להפסיק להשתמש ביומן הייעודי</button></div>' +
      '<p class="credit">"חיבור מחדש" – אם מחקת את היומן מהטלפון או החלפת מכשיר. "להפסיק" – תזכורות חדשות ייכנסו ליומן הרגיל של הטלפון, אחת-אחת.</p></details>';
    return '<div class="note">📅 אפשר להקים יומן נפרד בשם "לוח שידורים" שמתעדכן לבד, כולל ביטולים.<div class="bar"><button type="button" class="ghost" data-calsetup>הקמת יומן ייעודי</button></div></div>';
  }
})(window.TVG);
