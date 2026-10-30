// התראות פוש: מנויים לכל משתמש, שליחה, ותזמון מדויק דרך Upstash QStash (אם הוגדר QSTASH_TOKEN)
import webpush from "web-push";
import { put, list } from "@vercel/blob";
import { QBASE, remPayload, fireDest } from "./_snz.js";
import { validSub } from "./_val.js";
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

// d (לבדיקות): {getSubs, setSubs, send}
export async function sendTo(t, payload, d = {}) {
  const send = d.send || ((s, body, o) => webpush.sendNotification(s, body, o));
  if (!d.send) webpush.setVapidDetails("mailto:tv-guide@users.noreply.github.com", process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  const subs = await (d.getSubs || getSubs)(t);
  let ok = 0; const keep = [];
  for (const s of subs) {
    if (!validSub(s)) { keep.push(s); continue; } // מנוי שלא עומד באימות לא מקבל בקשת רשת (SSRF), אבל גם לא נמחק
    try { await send(s, JSON.stringify(payload), { TTL: 900, urgency: "high" }); ok++; keep.push(s); }
    catch (e) { if (e.statusCode !== 404 && e.statusCode !== 410) keep.push(s); else console.log("subscription gone", e.statusCode); }
  }
  if (keep.length !== subs.length) await (d.setSubs || setSubs)(t, keep);
  return { ok, total: subs.length };
}

// תקרות תזמון לכל משתמש
export const MAX_SCHED = 60;        // כמה תזכורות עתידיות מתוזמנות במקביל; הקרובות ביותר מתוזמנות, השאר נשמרות (ביומן) אך בלי פוש מדויק
export const MAX_PUBLISH_DAY = 300; // תקציב פרסומים ל-QStash לכל טוקן ליום (נשמר ב-sched/<t>.json תחת __q)

// מסנכרן את התזמונים מול רשימת התזכורות: מוסיף חדשות, מבטל שבוטלו או ששונו. תזכורות שלא השתנו (אותו זמן ±דקה) לא נוגעים בהן.
// d (לבדיקות): {getSubs, readJson, writeJson, fetch, now}
export async function reschedule(t, rems, d = {}) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return { skipped: "no QSTASH_TOKEN" };
  const gs = d.getSubs || getSubs, rj = d.readJson || readJson, wj = d.writeJson || writeJson, fx = d.fetch || fetch;
  const now = d.now ? d.now() : Date.now();
  const subs = await gs(t);
  const sched = await rj(`sched/${t}.json`, {});
  const day = Math.floor(now / 86400000);
  let q = sched.__q; delete sched.__q;
  if (!q || q.d !== day) q = { d: day, n: 0 };
  let want = subs.length ? wantedSchedule(rems, now) : {}; // כולל הודעות k#s (תחילת שידור)
  // תקרה: רק ה-MAX_SCHED הקרובות ביותר (כל הודעה מתוזמנת נספרת, כולל k#s)
  let capped = 0;
  const ks = Object.keys(want);
  if (ks.length > MAX_SCHED) {
    ks.sort((x, y) => want[x] - want[y]);
    const keep = {}; for (const k of ks.slice(0, MAX_SCHED)) keep[k] = want[k];
    capped = ks.length - MAX_SCHED; want = keep;
  }
  let added = 0, removed = 0, limited = false;
  for (const k of Object.keys(sched)) {
    if (want[k] && Math.abs(sched[k].at - want[k]) < 60000) { delete want[k]; continue; }
    try { await fx(`${QBASE()}/v2/messages/${sched[k].id}`, { method: "DELETE", headers: { authorization: "Bearer " + token } }); } catch (e) {}
    delete sched[k]; removed++;
  }
  for (const [k, at] of Object.entries(want)) {
    if (q.n >= MAX_PUBLISH_DAY) { limited = true; break; }
    q.n++;
    const r = await fx(`${QBASE()}/v2/publish/${fireDest()}`, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json", "upstash-not-before": String(Math.floor(at / 1000)), "upstash-retries": "2" },
      body: JSON.stringify(k.endsWith(START_SUFFIX) ? { t, k: k.slice(0, -START_SUFFIX.length), at, st: 1 } : { t, k, at }), // st: התראת תחילת שידור
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.messageId) { sched[k] = { at, id: j.messageId }; added++; } else console.log("qstash publish failed", r.status, JSON.stringify(j).slice(0, 200));
  }
  sched.__q = q;
  await wj(`sched/${t}.json`, sched);
  const out = { added, removed, total: Object.keys(sched).length - 1 };
  if (capped) out.capped = capped;
  if (limited) out.limited = "daily";
  return out;
}
export async function dropSched(t, k) {
  const sched = await readJson(`sched/${t}.json`, {});
  if (sched[k]) { delete sched[k]; await writeJson(`sched/${t}.json`, sched); }
}
