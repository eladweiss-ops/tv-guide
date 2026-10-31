/*
 * עזרי מגע אמיתיים לבדיקות (CDP Input.dispatchTouchEvent): גרירה עם תזמון אמיתי (כדי שיהיו מהירות ותנופה), לוג מצב לכל פריים, והקלטת מסך (screencast).
 * משמשים את shoot.cjs (צעדי "fluid-*") ואת fluid.cjs. Playwright עצמו יודע רק להקיש (touchscreen.tap), לכן עוברים ל-CDP.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// גרירה: pts = [[x, y], ...] נקודות לאורך המסלול; ms = משך כולל; hold = המתנה לפני השחרור (0 = שחרור תוך כדי תנועה); release=false משאיר את האצבע על המסך
async function drag(cdp, pts, ms, o = {}) {
  const hold = o.hold || 0, step = o.step || 16, id = o.id || 1;
  const tp = (p) => [{ x: p[0], y: p[1], id, radiusX: 2, radiusY: 2, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(pts[0]) });
  const n = Math.max(1, Math.round(ms / step)), t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    const f = (i / n) * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f)), u = f - k;
    const a = pts[k], b = pts[k + 1], p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(p) });
    const wait = t0 + i * step - Date.now(); if (wait > 0) await sleep(wait);
  }
  if (hold) await sleep(hold);
  if (o.release === false) return;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

// לוג לכל פריים (rAF) של transform / opacity של חלון ושל הרקע שלו / ושל אלמנט אחר. window.__fl = [[t, y, sheetOpacity, scrimOpacity, x], ...]
async function startFrameLog(page, sel, wrapSel) {
  await page.evaluate(([sel, wsel]) => {
    window.__fl = []; window.__flOn = true;
    const num = (t, i) => { const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(t || ""); return m ? parseFloat(m[i]) : 0; };
    (function tick() {
      if (!window.__flOn) return;
      const el = document.querySelector(sel), w = wsel ? document.querySelector(wsel) : null, sc = document.querySelector(sel === "#sheet" ? "#scrim" : "#scrim2");
      const src = w || el;
      window.__fl.push([performance.now(), src ? num(src.style.transform, 2) : 0, src && src.style.opacity !== "" ? +src.style.opacity : 1, sc && sc.style.opacity !== "" ? +sc.style.opacity : (sc && !sc.hidden ? 1 : 0), src ? num(src.style.transform, 1) : 0, el ? (el.hidden ? 1 : 0) : 1]);
      requestAnimationFrame(tick);
    })();
  }, [sel, wrapSel || null]);
}
async function stopFrameLog(page) { return page.evaluate(() => { window.__flOn = false; return window.__fl; }); }

// screencast -> [{t, data(base64 jpeg)}]; stop() מחזיר את הפריימים
async function startCast(cdp, quality = 70) {
  const frames = [];
  cdp.on("Page.screencastFrame", (e) => { frames.push({ t: e.metadata.timestamp, data: e.data }); cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, everyNthFrame: 1 });
  return { async stop() { await cdp.send("Page.stopScreencast").catch(() => {}); return frames; } };
}

module.exports = { drag, sleep, startFrameLog, stopFrameLog, startCast };
