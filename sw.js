// Service worker (v3): התראות פוש בלבד (בלי מטמון, כדי לא להפריע לעדכונים האוטומטיים)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
// סימן כיוון מימין-לשמאל בתחילת כל שורה, כדי שהאייפון ייישר את ההתראה לימין גם כשהיא מתחילה באימוג'י או במספר
const RLM = "‏", rtl = (t) => String(t || "").split("\n").map((l) => RLM + l).join("\n");
const hhmm = (ts) => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(ts);

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "לוח שידורים", body: e.data && e.data.text() }; }
  const tag = d.tag || "tvg";
  const o = {
    body: rtl(d.body), dir: "rtl", lang: "he", tag, renotify: !!d.tag, icon: "icon-192.png", badge: "badge-96.png",
    data: { url: d.url || "./", snz: d.snz || null },
  };
  // כפתורים: אנדרואיד/כרום בלבד. באייפון מתעלמים מהם (והנודניק שם דרך פתיחת האפליקציה)
  if (d.snz) o.actions = [{ action: "snz", title: "💤 עוד 5 דק׳" }, { action: "open", title: "פתיחה בלוח" }];
  e.waitUntil(self.registration.showNotification(rtl(d.title || "לוח שידורים"), o));
});

async function snooze(n) {
  const z = n.data && n.data.snz, tag = n.tag || "tvg";
  const show = (t, b) => self.registration.showNotification(rtl(t), { body: b ? rtl(b) : undefined, dir: "rtl", lang: "he", tag, renotify: true, icon: "icon-192.png", badge: "badge-96.png", data: { url: (n.data && n.data.url) || "./" } });
  if (!z || !z.u) return show("לא ניתן לנדנד", "פתחו את האפליקציה כדי לנדנד.");
  try {
    const r = await fetch(z.u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k: z.k, o: z.o, a: z.a, s: z.s, m: z.m || 5 }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.at) throw new Error("snooze " + r.status);
    return show("💤 נזכיר שוב ב-" + hhmm(j.at));
  } catch (x) {
    return show("הנודניק לא הצליח", "בדקו חיבור ונסו שוב מתוך האפליקציה.");
  }
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  if (e.action === "snz") return e.waitUntil(snooze(e.notification));
  const scope = self.registration.scope;
  const url = new URL((e.notification.data && e.notification.data.url) || "./", scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
    // רק חלונות של האפליקציה הזו (אותו scope), לא פרויקטים אחרים על אותו github.io. מועדפים חלון פעיל/גלוי (בדרך כלל חלון האפליקציה)
    const mine = list.filter((c) => c.url && c.url.startsWith(scope));
    const c = mine.find((x) => x.focused) || mine.find((x) => x.visibilityState === "visible") || mine[0];
    if (c) {
      try { const nc = await c.navigate(url); return (nc || c).focus(); } catch (x) { try { return await c.focus(); } catch (y) {} }
    }
    return self.clients.openWindow(url);
  }));
});
