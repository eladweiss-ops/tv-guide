// GET /api/watch-check  → הבדיקה היומית של רשימות המעקב (Vercel Cron, ראו vercel.json "crons").
// POST /api/team-sync?u=<updated> (rewrite ל-/api/watch-check?job=team) → ⚽ תזכורות קבוצה בצד השרת, מיד אחרי עדכון הלוח (GitHub Action update.yml).
// אימות: Vercel שולחת Authorization: Bearer <CRON_SECRET> כש-CRON_SECRET מוגדר בפרויקט. בלי המשתנה, הנקודה סגורה (503).
import { safeEq } from "./_sig.js";
import { readJson, writeJson, getSubs, sendTo } from "./_push.js";
import { listJson, delJson } from "./_db.js";
import { runCheck } from "./_wcheck.js";
import { runFollowCheck, getGuide, FOLLOW_BUDGET_MS } from "./_fcheck.js";
import { load } from "./_store.js";
import { reschedule } from "./_push.js";
import { SEARCH_TTL } from "./_nfs.js";
import { fail } from "./_guard.js";
import { cleanParties } from "./_party.js"; // 🍿 ערב צפייה
import { scheduleTonight } from "./_tonight.js"; // 🌙 הערב שלך ב-19:00
import { runTeamSync } from "./_team.js"; // ⚽ הקבוצה שלי: תזכורות אוטומטיות בשרת
import { loadOwn } from "./_store.js";
import { GUIDE_URL } from "./_wcheck.js";
import { logEv, cleanLog } from "./_rlog.js"; // יומן התזכורות (30 יום)
import { scheduleCanary } from "./_canary.js"; // 🐤 בדיקה יומית של QStash → /api/fire
import { listJson as listJ } from "./_db.js";

export const TEAM_STATS = "stats/teamsync.json"; // {u: updated של הלוח, at, done, added, users}
// הלוח הטרי מ-GitHub Pages (עוקף את המטמון של 10 דקות ואת המטמון של ה-CDN): רגע אחרי commit של העדכון הלילי
export async function freshGuide(fx = fetch, now = Date.now()) {
  try {
    const r = await fx(GUIDE_URL + "?ts=" + now, { cache: "no-store", signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
    const g = r.ok ? await r.json() : null;
    return g && Array.isArray(g.programs) && g.programs.length ? g : null;
  } catch (e) { console.error("team guide", e && e.message); return null; }
}
// d (לבדיקות): {readJson, writeJson, list, loadOwn, reschedule, log, guide, fetch, now}
export async function teamJob(u, d = {}) {
  if (process.env.TEAMSYNC_OFF === "1") return { skipped: "off" };
  const now = d.now ? d.now() : Date.now(), rj = d.readJson || readJson, wj = d.writeJson || writeJson;
  const guide = d.guide ? await d.guide() : await freshGuide(d.fetch || fetch, now);
  if (!guide) return { skipped: "no guide" };
  const have = String(guide.updated || "");
  if (u && have < u) return { stale: true, have, want: u }; // Pages עוד מגיש את הלוח הקודם: ה-Action ינסה שוב
  const last = await rj(TEAM_STATS, null);
  if (u && last && last.u === have && last.done) return { dup: true, u: have }; // כבר רץ על הלוח הזה
  const r = await runTeamSync({ list: d.list || listJ, readJson: rj, writeJson: wj, loadOwn: d.loadOwn || loadOwn,
    reschedule: d.reschedule || ((t, rems) => reschedule(t, rems)), log: d.log || logEv, guide: async () => guide, now: () => now, deadline: d.deadline || Date.now() + 45000 });
  if (!r.skipped) await wj(TEAM_STATS, { u: have, at: now, done: !r.more, added: r.added, users: r.auto });
  console.log("team-sync", JSON.stringify(r));
  return r;
}

// כל המשתמשים עם רשימת מעקב: אוסף wl ב-Firestore (מזהה המסמך = הטוקן). הערכים כבר נקראו: אין קריאה שנייה לכל משתמש
export async function listUsers(list = listJson) {
  const rows = await list("wl");
  return rows.filter((r) => /^[a-z0-9]{24,48}$/.test(r.id)).slice(0, 5000).map((r) => ({ t: r.id, wl: r.value }));
}
export async function listTokens(list = listJson) { return (await listUsers(list)).map((u) => u.t); }

// ניקוי מטמון חיפוש ישן (ל-Firestore אין כאן TTL אוטומטי): מוחק עד max רשומות cache/nf שגילן מעל 12 שעות
export async function cleanNfCache(now = Date.now(), list = listJson, del = delJson, max = 200) {
  const rows = await list("cache");
  let n = 0;
  for (const r of rows) {
    if (n >= max) break;
    if (!/^nf__[0-9a-f]{8,64}$/.test(r.id)) continue;
    const t = r.value && typeof r.value.t === "number" ? r.value.t : 0;
    if (now - t < SEARCH_TTL) continue;
    await del(`cache/nf/${r.id.slice(4)}.json`); n++;
  }
  return n;
}

// כל המשתמשים עם מעקב אחרי סדרות: אוסף fol (מזהה המסמך = הטוקן)
export async function listFol(list = listJson) {
  const rows = await list("fol");
  return rows.filter((r) => /^[a-z0-9]{24,48}$/.test(r.id) && r.value && typeof r.value === "object").slice(0, 5000).map((r) => ({ t: r.id, doc: r.value }));
}

// 200 מותר · 401 סוד שגוי/חסר · 503 CRON_SECRET לא מוגדר (הנקודה סגורה)
export function cronAuth(req, secret = process.env.CRON_SECRET) {
  if (!secret) return 503;
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  return safeEq(h, "Bearer " + secret) ? 200 : 401;
}

// d (לבדיקות): תלויות של runCheck
export default async function handler(req, res, d = {}) {
  if (req.query && req.query.job === "team") { // ⚽ POST /api/team-sync (או GET), אותו סוד כמו ה-cron
    if (req.method !== "POST" && req.method !== "GET") return res.status(405).end();
    const au = cronAuth(req);
    if (au !== 200) return res.status(au).json({ error: au === 503 ? "not configured" : "unauthorized" });
    try {
      const u = String(req.query.u || "").slice(0, 40);
      res.setHeader("cache-control", "no-store");
      return res.status(200).json(await (d.teamJob || teamJob)(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(u) ? u : "", d.team || {}));
    } catch (e) { return fail(res, e, "team-sync"); }
  }
  if (req.method !== "GET") return res.status(405).end();
  const t0 = Date.now(); // 🍿 ערב צפייה: deadline משותף לניקוי, מתחילת הריצה
  const au = cronAuth(req);
  if (au !== 200) return res.status(au).json({ error: au === 503 ? "not configured" : "unauthorized" });
  try {
    // אותו cron, שני שלבים: קודם רענון מעקב הסדרות (תזכורות, חשוב יותר וקל יותר) עם חצי מהזמן, אחר כך בדיקת רשימות המעקב של נטפליקס
    // הלוח נטען פעם אחת בהרצה ומשותף לשני השלבים. שלב המעקב מוגבל ל-20 שניות (לא מתחיל עבודה חדשה אחריהן), ולבדיקת נטפליקס נשארים 25+
    // 🌙 הערב שלך: מתזמן ב-QStash הודעה אחת ל-19:00 שעון ישראל של היום. ראשון (קל, לא תלוי בזמן שנשאר); כישלון לא פוגע בבדיקה היומית
    let tn;
    try { tn = await (d.scheduleTonight || scheduleTonight)({ readJson: d.readJson || readJson, writeJson: d.writeJson || writeJson, fetch: d.fetch, now: d.now }); } catch (e) { tn = { error: true }; console.error("tonight schedule", e && e.message); }
    const t0 = Date.now(); // אחרי התזמון: QStash איטי לא אוכל מהזמן של בדיקת המעקב
    let gm = null; const guideOnce = () => (gm = gm || getGuide(d));
    let fo;
    try {
      fo = await runFollowCheck({ listFol, readJson, writeJson, getSubs, load, reschedule: (t, rems, o) => reschedule(t, rems, o), deadline: t0 + FOLLOW_BUDGET_MS + 10000, ...d, ...(d.follow || {}), guide: guideOnce });
    } catch (e) { console.error("follow-check", e && e.message); fo = { error: true }; }
    // ⚽ גיבוי ליומי: תזכורות קבוצה (העיקר רץ מה-Action אחרי עדכון הלוח). עד ~8 שניות, לא מתחיל משתמש חדש אחריהן
    let tm;
    try { tm = await (d.teamJob || teamJob)("", { guide: guideOnce, deadline: Date.now() + 8000, ...(d.team || {}) }); } catch (e) { tm = { error: true }; console.error("team-sync cron", e && e.message); }
    // 🐤 בדיקה יומית: הודעה ל-/api/fire בעוד 5 דקות; ויומן התזכורות: מחיקת ימים מעל 30
    let cn;
    try { cn = await (d.scheduleCanary || scheduleCanary)({ readJson: d.readJson || readJson, writeJson: d.writeJson || writeJson, fetch: d.fetch, now: d.now }); } catch (e) { cn = { error: true }; console.error("canary schedule", e && e.message); }
    const r = await runCheck({ listUsers, readJson, writeJson, getSubs, sendTo, cleanCache: (now) => cleanNfCache(now), deadline: t0 + 52000, ...d, guide: guideOnce }); // משאיר זמן לניקוי ערבי הצפייה לפני maxDuration 60
    r.follow = fo; r.tn = tn; r.team = tm; r.canary = cn;
    try { r.rlog = await (d.cleanLog || ((dl) => Promise.all([listJ("push"), listJ("rems")]).then(([a, b]) => cleanLog([...new Set(a.concat(b).map((x) => x.id))], Date.now(), { deadline: dl }))))(t0 + 55000); } catch (e) { r.rlog = -1; console.error("rlog cleanup", e && e.message); }
    // 🍿 ערב צפייה: ניקוי קטן (עד 100 ערבים שעברו יומיים), מכבד את הזמן שנשאר. כישלון כאן לא פוגע בבדיקה היומית
    try { r.parties = await (d.cleanParties || cleanParties)(Date.now(), { deadline: t0 + 55000 }); } catch (e) { r.parties = -1; console.error("party cleanup failed"); }
    console.log("watch-check", JSON.stringify(r));
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(r);
  } catch (e) {
    return fail(res, e, "watch-check");
  }
}
