// התראות פוש: מנויים לכל משתמש, שליחה, ותזמון מדויק דרך Upstash QStash (אם הוגדר QSTASH_TOKEN)
import webpush from "web-push";
import { put, list } from "@vercel/blob";
import { SELF, QBASE, remPayload } from "./_snz.js";
import { wantedSchedule, START_SUFFIX } from "./_rems.js";
export { remPayload };

export async function readJson(p, dflt) {
  const { blobs } = await list({ prefix: p, limit: 1 });
  if (!blobs.length) return dflt;
  const r = await fetch(blobs[0].url + "?v=" + Date.now(), { cache: "no-store" });
  return r.ok ? await r.json().catch(() => dflt) : dflt;
}
export async function writeJson(p, o) {
  await put(p, JSON.stringify(o), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
}
export const getSubs = (t) => readJson(`push/${t}.json`, []);
export const setSubs = (t, s) => writeJson(`push/${t}.json`, s);

export async function sendTo(t, payload) {
  webpush.setVapidDetails("mailto:tv-guide@users.noreply.github.com", process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  const subs = await getSubs(t);
  let ok = 0; const keep = [];
  for (const s of subs) {
    try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 900, urgency: "high" }); ok++; keep.push(s); }
    catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) keep.push(s); else console.log("subscription gone", e.statusCode); }
  }
  if (keep.length !== subs.length) await setSubs(t, keep);
  return { ok, total: subs.length };
}

// מסנכרן את התזמונים מול רשימת התזכורות: מוסיף חדשות, מבטל שבוטלו או ששונו
export async function reschedule(t, rems) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return { skipped: "no QSTASH_TOKEN" };
  const subs = await getSubs(t);
  const sched = await readJson(`sched/${t}.json`, {});
  const now = Date.now(), want = subs.length ? wantedSchedule(rems, now) : {};
  let added = 0, removed = 0;
  for (const k of Object.keys(sched)) {
    if (want[k] && Math.abs(sched[k].at - want[k]) < 60000) { delete want[k]; continue; }
    try { await fetch(`${QBASE()}/v2/messages/${sched[k].id}`, { method: "DELETE", headers: { authorization: "Bearer " + token } }); } catch (e) {}
    delete sched[k]; removed++;
  }
  for (const [k, at] of Object.entries(want)) {
    const dest = `${SELF}/api/fire?s=${process.env.FIRE_SECRET}`;
    const r = await fetch(`${QBASE()}/v2/publish/${dest}`, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json", "upstash-not-before": String(Math.floor(at / 1000)), "upstash-retries": "2" },
      body: JSON.stringify(k.endsWith(START_SUFFIX) ? { t, k: k.slice(0, -START_SUFFIX.length), at, st: 1 } : { t, k, at }), // st: התראת תחילת שידור
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.messageId) { sched[k] = { at, id: j.messageId }; added++; } else console.log("qstash publish failed", r.status, JSON.stringify(j).slice(0, 200));
  }
  await writeJson(`sched/${t}.json`, sched);
  return { added, removed, total: Object.keys(sched).length };
}
export async function dropSched(t, k) {
  const sched = await readJson(`sched/${t}.json`, {});
  if (sched[k]) { delete sched[k]; await writeJson(`sched/${t}.json`, sched); }
}
