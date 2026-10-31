// GET /api/watch-check  → הבדיקה היומית של רשימות המעקב (Vercel Cron, ראו vercel.json "crons").
// אימות: Vercel שולחת Authorization: Bearer <CRON_SECRET> כש-CRON_SECRET מוגדר בפרויקט. בלי המשתנה, הנקודה סגורה (503).
import { safeEq } from "./_sig.js";
import { readJson, writeJson, getSubs, sendTo } from "./_push.js";
import { listJson, delJson } from "./_db.js";
import { runCheck } from "./_wcheck.js";
import { SEARCH_TTL } from "./_nfs.js";
import { fail } from "./_guard.js";

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

// 200 מותר · 401 סוד שגוי/חסר · 503 CRON_SECRET לא מוגדר (הנקודה סגורה)
export function cronAuth(req, secret = process.env.CRON_SECRET) {
  if (!secret) return 503;
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  return safeEq(h, "Bearer " + secret) ? 200 : 401;
}

// d (לבדיקות): תלויות של runCheck
export default async function handler(req, res, d = {}) {
  if (req.method !== "GET") return res.status(405).end();
  const au = cronAuth(req);
  if (au !== 200) return res.status(au).json({ error: au === 503 ? "not configured" : "unauthorized" });
  try {
    const r = await runCheck({ listUsers, readJson, writeJson, getSubs, sendTo, cleanCache: (now) => cleanNfCache(now), deadline: Date.now() + 60000, ...d });
    console.log("watch-check", JSON.stringify(r));
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(r);
  } catch (e) {
    return fail(res, e, "watch-check");
  }
}
