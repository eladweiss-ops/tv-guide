/* js/events.js - כל מאזיני האירועים של המסמך (הקשה, גרירה, מקלדת, שינוי).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core, data, reminders, ui, reminder-sheet, push, render-rems, render-common, render-now, render-grid, netflix, render-dial, swipe, settings, search, favs, render, channels. */
(function (TVG) {
  TVG.files["events"] = 1;
  var $ = TVG.$, dstr = TVG.dstr, sel = TVG.sel, SCR = TVG.SCR, FAV = TVG.FAV, CAL_API = TVG.CAL_API, CX = TVG.CX, RO = TVG.RO;

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest("#dial")) return; // הקשה על השעון מטופלת ב-pointerup
    var st = t.closest("[data-step]"); if (st) { var sp = st.getAttribute("data-step").split("|"); TVG.stepCard(sp[1], +sp[0]); return; }
    if (t.closest("#sBtn")) { TVG.setSearch($("#qwrap").hidden); return; }
    var rm = t.closest("[data-rem]");
    if (rm) {
      var rr = TVG.findProg(rm.getAttribute("data-rem")); if (!rr) return;
      if (TVG.srv() && !TVG.hasRem(TVG.remKey(rr.id, rr.p.s)) && rm.classList.contains("rbt")) { TVG.quickAdd([rr]); return; } // מהרשימות: לחיצה אחת
      if (!TVG.calMode && !TVG.hasRem(TVG.remKey(rr.id, rr.p.s))) { TVG.rem = rr; TVG.askCal(); return; } // אין עדיין יומן: מציעים להקים
      TVG.openRem(rr); return;
    }
    if (t.closest("[data-pillact2]")) { var f2 = TVG.pillFn2; TVG.pillFn2 = null; $("#pill").hidden = true; if (f2) f2(); return; }
    if (t.closest("[data-pillact]")) { var f = TVG.pillFn; TVG.pillFn = null; $("#pill").hidden = true; if (f) f(); return; }
    var ra2 = t.closest("[data-remall]");
    if (ra2) {
      var tt = ra2.getAttribute("data-remall"), all = [];
      TVG.G.channels.forEach(function (c) { (TVG.by.get(c.id) || []).forEach(function (p) { if (p.title === tt && p.s > new Date()) all.push({ id: c.id, p: p }); }); });
      if (TVG.srv()) TVG.quickAdd(all); else { TVG.rem = all[0] || null; TVG.askCal(); }
      return;
    }
    var lp = t.closest("[data-lp]"); if (lp) { TVG.setLead(+lp.getAttribute("data-lp")); return; }
    var le = t.closest("[data-ledit]"); if (le) { TVG.askK = null; TVG.openLead([le.getAttribute("data-ledit")]); return; }
    if (t.closest("[data-lpset]")) {
      var inp = $("[data-lpdt]"), ts0 = TVG.LP ? (TVG.hasRem(TVG.LP.keys[0]) || {}).ts : TVG.rem && TVG.rem.p.s.getTime(), d0 = inp && inp.value ? new Date(inp.value) : null;
      if (!d0 || isNaN(d0) || !ts0) { TVG.pill("בחרו תאריך ושעה", 1500); return; }
      if (d0.getTime() >= ts0) { TVG.pill("ההתראה צריכה להיות לפני תחילת התוכנית", 2000); return; }
      if (d0.getTime() < Date.now()) { TVG.pill("השעה הזו כבר עברה", 1600); return; }
      TVG.setLead(Math.max(0, Math.round((ts0 - d0.getTime()) / 60000))); return;
    }
    if (t.closest("[data-ics]")) { TVG.downloadIcs(); return; }
    var rc = t.closest("[data-remcancel]"); if (rc) { TVG.askK = null; TVG.cancelRem(rc.getAttribute("data-remcancel")); return; }
    var ra = t.closest("[data-remask]"); if (ra) { TVG.askK = ra.getAttribute("data-remask"); TVG.render(); clearTimeout(TVG.askT); TVG.askT = setTimeout(function () { if (TVG.askK) { TVG.askK = null; if (TVG.tab === "rems") TVG.render(); } }, 6000); return; }
    if (t.closest("[data-remkeep]")) { TVG.askK = null; TVG.render(); return; }
    if (t.closest("[data-calsub]")) { TVG.store("tvg.calJust", "1"); }
    if (t.closest("[data-calsetup]")) { TVG.setupCal(); return; }
    if (t.closest("[data-pushon]")) { TVG.enablePush(); return; }
    if (t.closest("[data-personal]")) { TVG.openPersonal(); return; }
    if (t.closest("[data-psave]")) { TVG.savePersonal(); return; }
    var pl = t.closest("[data-plead]"); if (pl) { TVG.pLead = +pl.getAttribute("data-plead"); [].forEach.call(document.querySelectorAll("[data-plead]"), function (b) { b.setAttribute("aria-pressed", String(b === pl)); }); return; }
    if (t.closest("[data-pushtest]")) { fetch(CAL_API + "/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: TVG.calTok, test: 1 }) }).then(function (r) { return r.json(); }).then(function (j) { TVG.pill(j && j.ok ? "נשלחה התראת בדיקה" : "לא הצלחתי לשלוח, נסו להפעיל מחדש", 2000); if (!(j && j.ok)) { TVG.pushOn = false; TVG.store("tvg.push", "0"); TVG.render(); } }).catch(function () { TVG.pill("אין חיבור", 1500); }); return; }
    if (t.closest("[data-calics]")) { TVG.useIcs(); return; }
    if (t.closest("[data-calsync]")) { TVG.syncRems().then(function (ok) { TVG.pill(ok ? "היומן עודכן" : "עדיין אין חיבור", 1500); TVG.render(); }); return; }
    if (t.closest("[data-remclose]") || t.closest("#scrim2")) { TVG.closeRem(); TVG.closeFavs(); return; }
    var fv = t.closest("[data-fav]");
    if (fv) {
      var ft = fv.getAttribute("data-fav"); if (FAV.has(ft)) FAV.delete(ft); else FAV.add(ft); TVG.saveFav(); TVG.updFav();
      var on = FAV.has(ft);
      document.querySelectorAll("[data-fav]").forEach(function (el) {
        if (el.getAttribute("data-fav") !== ft) return;
        el.setAttribute("aria-pressed", String(on));
        if (el.classList.contains("star")) el.textContent = on ? "★" : "☆"; else if (el.classList.contains("fav")) el.textContent = on ? "★ במועדפים" : "☆ הוסף למועדפים";
      });
      if (TVG.tab === "dial" && !TVG.q.trim()) TVG.render();
      TVG.pill(on ? "נוסף למועדפים" : "הוסר מהמועדפים", 1100); return;
    }
    if (t.closest("#fvBtn")) { TVG.openFavs(); return; }
    if (t.closest("#setBtn")) { TVG.openSet(); return; }
    if (t.closest("[data-setclose]")) { TVG.closeFavs(); return; }
    var fd = t.closest("[data-favdel]"); if (fd) { FAV.delete(fd.getAttribute("data-favdel")); TVG.saveFav(); TVG.updFav(); TVG.delArm = false; $("#favBody").innerHTML = TVG.favHtml(); if (TVG.tab === "dial" && !TVG.q.trim()) TVG.render(); return; }
    var fs = t.closest("[data-favsearch]"); if (fs) { TVG.startSearch(fs.getAttribute("data-favsearch"), true); return; }
    var fw = t.closest("[data-follow]");
    if (fw) { var ftp = fw.getAttribute("data-follow"); if (TVG.isTopic(ftp)) { TVG.TOPICS = TVG.TOPICS.filter(function (x) { return x.toLowerCase() !== ftp.toLowerCase(); }); TVG.saveTopics(); TVG.pill("הפסקת לעקוב", 3000, "ביטול", function () { TVG.TOPICS.push(ftp); TVG.saveTopics(); TVG.render(); }); } else { TVG.TOPICS.push(ftp); TVG.saveTopics(); TVG.addRecent(ftp, false); TVG.pill("⭐ עוקב אחרי " + ftp, 1800); } TVG.render(); return; }
    var tpc = t.closest("[data-topic]"); if (tpc) { TVG.sWhen = "all"; TVG.startSearch(tpc.getAttribute("data-topic"), false); $("#q").blur(); return; }
    var tdl = t.closest("[data-topicdel]"); if (tdl) { var td = tdl.getAttribute("data-topicdel"); TVG.TOPICS = TVG.TOPICS.filter(function (x) { return x !== td; }); TVG.saveTopics(); $("#favBody").innerHTML = TVG.favHtml(); TVG.pill("הפסקת לעקוב אחרי " + td, 3000, "ביטול", function () { TVG.TOPICS.push(td); TVG.saveTopics(); $("#favBody").innerHTML = TVG.favHtml(); }); return; }
    if (t.closest("[data-topicadd]")) { TVG.topicAdd = true; TVG.startSearch("", false); return; }
    var wh = t.closest("[data-when]"); if (wh) { TVG.sWhen = wh.getAttribute("data-when"); TVG.render(); return; }
    var kd = t.closest("[data-kind]"); if (kd) { TVG.sKind = kd.getAttribute("data-kind"); TVG.render(); return; }
    if (t.closest("[data-remlist]")) { var lst = TVG.LASTHITS.map(function (x) { return { id: x.c.id, p: x.p }; }); if (TVG.srv()) TVG.quickAdd(lst); else { TVG.rem = lst[0] || null; TVG.askCal(); } return; }
    if (t.closest("[data-favadd]")) { TVG.favPick = true; TVG.startSearch("", false); return; }
    var fp = t.closest("[data-favpick]");
    if (fp) { var ft2 = fp.getAttribute("data-favpick"); FAV.add(ft2); TVG.saveFav(); TVG.updFav(); TVG.favPick = false; TVG.setSearch(false); TVG.openFavs(); TVG.pill("★ " + ft2 + " נוסף למועדפים", 1800); return; }
    if (t.closest("[data-favpickoff]")) { TVG.setSearch(false); TVG.openFavs(); return; } // ביטול: חוזרים למועדפים
    if (t.closest("[data-favclear]")) { if (!TVG.delArm) { TVG.delArm = true; } else { FAV.clear(); TVG.saveFav(); TVG.updFav(); TVG.delArm = false; if (TVG.tab === "dial" && !TVG.q.trim()) TVG.render(); } $("#favBody").innerHTML = TVG.favHtml(); return; }
    if (t.closest("[data-favclose]")) { TVG.closeFavs(); return; }
    var rcb = t.closest("[data-recent]");
    if (rcb) { var rr0 = TVG.RECENT[+rcb.getAttribute("data-recent")]; if (rr0) { TVG.addRecent(rr0.t, rr0.x); $("#q").value = rr0.t; TVG.q = rr0.t; TVG.qExact = rr0.x ? rr0.t : null; $("#qx").hidden = false; TVG.render(); window.scrollTo({ top: 0 }); } return; }
    var rdl = t.closest("[data-recdel]"); if (rdl) { TVG.RECENT.splice(+rdl.getAttribute("data-recdel"), 1); TVG.store("tvg.recent", JSON.stringify(TVG.RECENT)); TVG.render(); return; }
    if (t.closest("[data-recclear]")) { var old = TVG.RECENT.slice(); TVG.RECENT = []; TVG.store("tvg.recent", "[]"); TVG.render(); TVG.pill("החיפושים נוקו", 3000, "ביטול", function () { TVG.RECENT = old; TVG.store("tvg.recent", JSON.stringify(TVG.RECENT)); TVG.render(); }); return; }
    var sgb = t.closest("[data-sug]"); if (sgb) { TVG.addRecent(sgb.getAttribute("data-sug"), true); var st2 = sgb.getAttribute("data-sug"); $("#q").value = st2; TVG.q = st2; TVG.qExact = st2; $("#qx").hidden = false; TVG.render(); window.scrollTo({ top: 0 }); return; }
    var sc2 = t.closest("[data-scope]"); if (sc2) { TVG.scope = sc2.getAttribute("data-scope"); TVG.render(); return; }
    if (t.closest("[data-clearx]")) { TVG.qExact = null; TVG.render(); return; }
    var jp = t.closest("[data-jump]");
    if (jp && /^p\|/.test(jp.getAttribute("data-jump"))) { if (TVG.srv()) TVG.openLead([jp.getAttribute("data-jump")]); return; }
    if (jp) {
      if (TVG.q.trim()) TVG.addRecent(TVG.qExact || TVG.q, !!TVG.qExact);
      var jr = TVG.findProg(jp.getAttribute("data-jump"));
      if (jr) { if (!TVG.chans().some(function (c) { return c.id === jr.id; })) { sel.add(jr.id); TVG.saveSel(); TVG.pill("הערוץ נוסף לערוצים שלך", 1600); } TVG.setSearch(false); TVG.chId = jr.id; TVG.day = dstr(jr.p.s); TVG.scrub = Math.round((jr.p.s - TVG.dObj(TVG.day)) / 60000); TVG.tab = "dial"; TVG.store("tvg.tab", "dial"); TVG.render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
      return;
    }
    if (t.closest("[data-install]")) { TVG.install(); return; }
    var tb = t.closest("[data-tab]");
    if (tb) {
      var nt = tb.getAttribute("data-tab");
      if (!$("#qwrap").hidden) { TVG.setSearch(false); if (nt === TVG.tab) { window.scrollTo(0, SCR[TVG.tab] || 0); return; } } // לשונית סוגרת את החיפוש
      if (nt === TVG.tab) { if (TVG.prevTab && TVG.prevTab !== TVG.tab) nt = TVG.prevTab; else { window.scrollTo({ top: 0, behavior: "smooth" }); return; } } // לחיצה שנייה: חזרה למסך הקודם
      TVG.prevTab = TVG.tab; SCR[TVG.tab] = window.scrollY; TVG.tab = nt; TVG.store("tvg.tab", TVG.tab); TVG.scrollNext = TVG.tab === "grid" && SCR.grid == null; TVG.render();
      window.scrollTo(0, SCR[TVG.tab] || 0); return;
    }
    var pd = t.closest("[data-day]"); if (pd) { TVG.day = pd.getAttribute("data-day"); TVG.scrub = null; TVG.scrollNext = true; TVG.render(); return; }
    var th = t.closest("[data-theme-set]"); if (th) { TVG.setTheme(th.getAttribute("data-theme-set")); return; }
    var nv = t.closest("[data-nf]"); if (nv) { TVG.nfView = nv.getAttribute("data-nf"); TVG.render(); return; }
    var cc = t.closest("[data-chip]"); if (cc) { TVG.gen = cc.getAttribute("data-chip"); TVG.render(); return; }
    var pv = t.closest("[data-prov]"); if (pv) { TVG.PROV = pv.getAttribute("data-prov"); TVG.store("tvg.prov", TVG.PROV); TVG.buildSheet(); return; }
    var sc = t.closest("[data-cchip]"); if (sc) { TVG.cf = sc.getAttribute("data-cchip"); TVG.buildSheet(); return; }
    var gp = t.closest("[data-grp]");
    if (gp) {
      var key = gp.getAttribute("data-grp"), list = TVG.visible().filter(function (c) { return c._g === key; });
      var allOn = list.every(function (c) { return sel.has(c.id); });
      list.forEach(function (c) { if (allOn) sel.delete(c.id); else sel.add(c.id); });
      TVG.saveSel(); TVG.buildSheet(); return;
    }
    var ac = t.closest("[data-act]");
    if (ac) {
      TVG.visible().forEach(function (c) { if (ac.getAttribute("data-act") === "all") sel.add(c.id); else sel.delete(c.id); });
      TVG.saveSel(); TVG.buildSheet(); return;
    }
    if (t.closest("[data-dnow]")) { TVG.scrub = null; TVG.updateDial(TVG.dialT()); return; }
    var mb = t.closest("[data-more]"); if (mb) { var pp = mb.previousElementSibling; if (pp) { pp.classList.toggle("full"); mb.textContent = pp.classList.contains("full") ? (mb.getAttribute("data-l") ? "צמצם" : "פחות") : (mb.getAttribute("data-l") ? "הרחב…" : "עוד…"); } return; }
    var sy = t.closest("[data-syn]");
    if (sy) { var bx = document.querySelector('[data-synbox="' + sy.getAttribute("data-syn").replace(/"/g, '\\"') + '"]'); if (bx) { bx.hidden = !bx.hidden; sy.setAttribute("aria-expanded", String(!bx.hidden)); sy.textContent = bx.hidden ? "תקציר" : "סגור"; } return; }
    if (t.closest("a.gsearch")) return;
    var tg = t.closest("[data-toggle]"); if (tg) { tg.classList.toggle("open"); var ob = tg.querySelector("[data-opentog]"); if (ob) ob.textContent = tg.classList.contains("open") ? "סגירת התקציר" : "📖 תקציר"; return; }
    if (t.closest("#chBtn") || t.closest("[data-open]")) { TVG.openSheet(true); return; }
    if (t.closest("#done") || t.closest("#scrim")) { TVG.openSheet(false); TVG.render(); return; }
  });
  // רק נגיעה על הטבעת עצמה מסובבת את השעון. נגיעה מחוץ לה (השוליים, מספרי השעות) גוללת את המסך כרגיל.
  function inRing(pt) {
    var d = $("#dial"); if (!d) return false;
    var r = d.getBoundingClientRect(), dx = pt.clientX - (r.left + r.width / 2), dy = pt.clientY - (r.top + r.height / 2);
    return Math.sqrt(dx * dx + dy * dy) <= (r.width / 2) * (RO + 14) / CX;
  }
  document.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1 && e.target.closest && e.target.closest("#dial") && inRing(e.touches[0])) e.preventDefault();
  }, { passive: false });
  document.addEventListener("pointerdown", function (e) {
    var d = e.target.closest && e.target.closest("#dial"); if (!d || !inRing(e)) return;
    TVG.dragging = true; TVG.tapAt = { x: e.clientX, y: e.clientY }; TVG.tapPending = false; try { d.setPointerCapture(e.pointerId); } catch (x) {}
    TVG.dialSet(TVG.dialMin(e)); e.preventDefault();
  });
  document.addEventListener("pointermove", function (e) { if (TVG.dragging && $("#dial")) TVG.dialSet(TVG.dialMin(e)); });
  function endDrag() { TVG.dragging = false; TVG.tapAt = null; }
  document.addEventListener("pointerup", function (e) {
    var tap = TVG.dragging && TVG.tapAt && Math.abs(e.clientX - TVG.tapAt.x) < 8 && Math.abs(e.clientY - TVG.tapAt.y) < 8;
    endDrag(); TVG.tapPending = false;
    if (tap) TVG.tapDial();
  });
  document.addEventListener("pointercancel", endDrag);
  document.addEventListener("keydown", function (e) {
    if (e.target.id === "dial") {
      var st = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
      if (st) { e.preventDefault(); TVG.dialSet(TVG.dialT() + st); } else if (e.key === "Home") { e.preventDefault(); TVG.scrub = null; TVG.updateDial(TVG.dialT()); }
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-toggle]")) { e.preventDefault(); e.target.classList.toggle("open"); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "pWhen") { TVG.pChips(); return; }
    if (t.hasAttribute && t.hasAttribute("data-lpsel")) {
      if (t.value === "custom") { var bx = $("[data-lpbox]"); if (bx) { bx.hidden = false; var ip = $("[data-lpdt]"); if (ip) try { ip.focus(); if (ip.showPicker) ip.showPicker(); } catch (er) {} } return; }
      if (t.value !== "") TVG.setLead(+t.value); return;
    }
    if (t.id === "chSel") { TVG.chId = t.value; TVG.scrub = null; TVG.scrollNext = true; TVG.render(); return; }
    var id = t.getAttribute && t.getAttribute("data-opt");
    if (!id) return;
    if (t.checked) { sel.add(id); var c0 = TVG.G.channels.filter(function (c) { return c.id === id; })[0]; if (c0) TVG.G.channels.forEach(function (o) { if (o.id !== id && TVG.normKey(o.name) === TVG.normKey(c0.name)) sel.delete(o.id); }); } else sel.delete(id);
    TVG.saveSel(); if (t.checked) TVG.buildSheet();
    var sc = document.querySelector('[data-cchip="sel"]'); if (sc) sc.textContent = "נבחרו (" + sel.size + ")";
  });
  $("#q").addEventListener("input", function (e) { TVG.q = e.target.value; TVG.qExact = null; $("#qx").hidden = !TVG.q; TVG.render(); });
  $("#q").addEventListener("keydown", function (e) { if (e.key === "Enter") { TVG.addRecent(TVG.q, false); e.target.blur(); } });
  $("#qx").addEventListener("click", function () { $("#q").value = ""; TVG.q = ""; TVG.qExact = null; $("#qx").hidden = true; TVG.render(); $("#q").focus(); });
  $("#chFind").addEventListener("input", function (e) { TVG.find = e.target.value; TVG.buildSheet(); });
})(window.TVG);
