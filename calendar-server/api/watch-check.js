// GET /api/watch-check  → הבדיקה היומית של רשימות המעקב (Vercel Cron, ראו vercel.json "crons").
// אימות: Vercel שולחת Authorization: Bearer <CRON_SECRET> כש-CRON_SECRET מוגדר בפרויקט. בלי המשתנה, הנקודה סגורה (503).
import { safeEq } from "./_sig.js";
import { readJson, getSubs, sendTo } from "./_push.js";
import { listJson } from "./_db.js";
import { runCheck } from "./_wcheck.js";
import { fail } from "./_guard.js";

// כל המשתמשים עם רשימת מעקב: אוסף wl ב-Firestore (מזהה המסמך = הטוקן)
export async function listTokens(list = listJson) {
  const rows = await list("wl");
  return rows.map((r) => r.id).filter((id) => /^[a-z0-9]{24,48}$/.test(id)).slice(0, 5000);
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
    const r = await runCheck({ listTokens, readJson, getSubs, sendTo, deadline: Date.now() + 50000, ...d });
    console.log("watch-check", JSON.stringify(r));
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(r);
  } catch (e) {
    return fail(res, e, "watch-check");
  }
}
