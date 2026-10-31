// התראות פוש: מנויים לכל משתמש, שליחה, ותזמון מדויק דרך Upstash QStash (אם הוגדר QSTASH_TOKEN)
import webpush from "web-push";
import { readJson, writeJson } from "./_db.js";
import { QBASE, remPayload, fireDest } from "./_snz.js";
import { validSub } from "./_val.js";
import { wantedSchedule, START_SUFFIX } from "./_rems.js";
import { withDerived, isDerKey, folPath, pruneDerived } from "./_fol.js";
export { remPayload };

export { readJson, writeJson }; // נשארים מיוצאים מכאן (snooze.js, בדיקות); המימוש ב-_db.js
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
  if (keep.length !== subs.length) { try { await (d.setSubs || setSubs)(t, keep); } catch (e) { console.error("setSubs failed (push already sent)", e && e.message); } }
  return { ok, total: subs.length };
}

// תקרות תזמון לכל משתמש
export const MAX_SCHED = 60;        // כמה תזכורות עתידיות מתוזמנות במקביל; הקרובות ביותר מתוזמנות, השאר נשמרות (ביומן) אך בלי פוש מדויק
export const MAX_PUBLISH_DAY = 300; // תקציב פרסומים ל-QStash לכל טוקן ליום (נשמר ב-sched/<t>.json תחת __q)
export const DER_RESERVE = 40;      // מתוך התקציב היומי: תזכורות שנגזרו ממעקב סדרות לא נוגעות ב-40 האחרונות (שמורות לתזכורות של המשתמש)

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
  // __f: מה נורה לאחרונה (מפתח -> {at, w}); מונע תזמון מחדש של התראה שנורתה זה עתה (שמירה חוזרת של הרשימה תוך שניות מהירי)
  const fired = sched.__f || {}; delete sched.__f;
  for (const k of Object.keys(fired)) if (now - fired[k].w > FIRED_MS) delete fired[k];
  if (!q || q.d !== day) q = { d: day, n: 0 };
  // תזכורות שנגזרו ממעקב אחרי סדרות (fol/<t>) מצטרפות לאותו תקציב (60 מתוזמנות, 300 פרסומים ביום); של המשתמש קודמות
  let fol = null; if (subs.length) { try { fol = await rj(folPath(t), null); } catch (e) { console.error("reschedule fol", e && e.message); } }
  if (fol && Array.isArray(fol.derived) && fol.derived.length) rems = withDerived(rems, pruneDerived(fol.derived, fol.follows), now); // רק של מעקבים פעילים
  let want = subs.length ? wantedSchedule(rems, now) : {}; // כולל הודעות k#s (תחילת שידור)
  const noNew = new Set(rems.filter((r) => r.stOnly).map((r) => r.k + START_SUFFIX)); // stOnly: רק משאירים k#s קיימת, לא מפרסמים
  for (const k of Object.keys(want)) if (fired[k] && Math.abs(fired[k].at - want[k]) < 60000) delete want[k];
  // תקרה: רק ה-MAX_SCHED הקרובות ביותר (כל הודעה מתוזמנת נספרת, כולל k#s)
  let capped = 0;
  const ks = Object.keys(want).filter((k) => !isDerKey(k)).concat(Object.keys(want).filter(isDerKey)); // של המשתמש קודם, אחר כך הנגזרות
  if (ks.length > MAX_SCHED) {
    const mine = ks.filter((k) => !isDerKey(k)).sort((x, y) => want[x] - want[y]), der = ks.filter(isDerKey).sort((x, y) => want[x] - want[y]);
    const keep = {}; for (const k of mine.concat(der).slice(0, MAX_SCHED)) keep[k] = want[k];
    capped = ks.length - MAX_SCHED; want = keep;
  } else { const o = {}; for (const k of ks) o[k] = want[k]; want = o; }
  let added = 0, removed = 0, limited = false;
  for (const k of Object.keys(sched)) {
    if (want[k] && Math.abs(sched[k].at - want[k]) < 60000) { delete want[k]; continue; }
    try { await fx(`${QBASE()}/v2/messages/${sched[k].id}`, { method: "DELETE", headers: { authorization: "Bearer " + token } }); } catch (e) {}
    delete sched[k]; removed++;
  }
  for (const [k, at] of Object.entries(want)) {
    if (noNew.has(k)) continue;
    if (q.n >= MAX_PUBLISH_DAY) { limited = true; break; }
    if (isDerKey(k) && q.n >= MAX_PUBLISH_DAY - DER_RESERVE) { limited = true; continue; }
    if (d.deadline && Date.now() > d.deadline) { limited = "time"; break; } // ההמשך יתוזמן בהרצה/שמירה הבאה
    q.n++;
    const r = await fx(`${QBASE()}/v2/publish/${fireDest()}`, {
      method: "POST", signal: !d.fetch && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      headers: { authorization: "Bearer " + token, "content-type": "application/json", "upstash-not-before": String(Math.floor(at / 1000)), "upstash-retries": "2" },
      body: JSON.stringify(k.endsWith(START_SUFFIX) ? { t, k: k.slice(0, -START_SUFFIX.length), at, st: 1 } : { t, k, at }), // st: התראת תחילת שידור
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.messageId) { sched[k] = { at, id: j.messageId }; added++; } else console.log("qstash publish failed", r.status, JSON.stringify(j).slice(0, 200));
  }
  sched.__q = q;
  if (Object.keys(fired).length) sched.__f = fired;
  await wj(`sched/${t}.json`, sched);
  const out = { added, removed, total: Object.keys(sched).filter((k) => !k.startsWith("__")).length };
  if (capped) out.capped = capped;
  if (limited) out.limited = limited === "time" ? "time" : "daily";
  return out;
}
const FIRED_MS = 120000;
// d (לבדיקות): {readJson, writeJson, now}. רושם ב-__f שההודעה נורתה, כדי ש-reschedule לא יתזמן אותה שוב
export async function dropSched(t, k, d = {}) {
  const rj = d.readJson || readJson, wj = d.writeJson || writeJson, now = d.now ? d.now() : Date.now();
  const sched = await rj(`sched/${t}.json`, {});
  if (sched[k]) { const f = sched.__f || {}; f[k] = { at: sched[k].at, w: now }; sched.__f = f; delete sched[k]; await wj(`sched/${t}.json`, sched); }
}
