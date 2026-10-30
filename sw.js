// Service worker (v2): רק התראות פוש (בלי מטמון, כדי לא להפריע לעדכונים האוטומטיים)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "לוח שידורים", body: e.data && e.data.text() }; }
  // סימן כיוון מימין-לשמאל בתחילת כל שורה, כדי שהאייפון ייישר את ההתראה לימין גם כשהיא מתחילה באימוג'י או במספר
  const RLM = "\u200F", rtl = (t) => String(t || "").split("\n").map((l) => RLM + l).join("\n");
  e.waitUntil(self.registration.showNotification(rtl(d.title || "לוח שידורים"), {
    body: rtl(d.body), dir: "rtl", lang: "he", tag: d.tag || undefined, icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "./" }, renotify: true,
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate && c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
