// מעקב אחרי סדרות: רענון הנגזרות מול הלוח החי (בבקשת POST /api/follow ובבדיקה היומית /api/watch-check), בלי תלות ב-Vercel: הכול מוזרק דרך d.
import { GUIDE_URL, DEADLINE_MARGIN_MS } from "./_wcheck.js";
import { deriveItems, folPath } from "./_fol.js";

let gCache = { t: 0, g: null };
export const GUIDE_TTL = 10 * 60000;
export const _resetGuide = () => { gCache = { t: 0, g: null }; };

// הלוח החי (guide.json מ-GitHub Pages), עם מטמון של 10 דקות בזיכרון. כשל = null (המצב הנגזר הקודם נשאר)
export async function getGuide(d = {}) {
  if (d.guide) return d.guide();
  const now = d.now ? d.now() : Date.now();
  if (gCache.g && now - gCache.t < GUIDE_TTL) return gCache.g;
  try {
    const r = await (d.fetch || fetch)(GUIDE_URL, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
    const g = r.ok ? await r.json() : null;
    if (g && Array.isArray(g.programs) && g.programs.length) { gCache = { t: now, g }; return g; }
  } catch (e) { console.error("follow guide", e && e.message); }
  return gCache.g; // ישן עדיף על כלום
}

// גוזר מחדש את התזכורות של משתמש אחד, שומר ומסנכרן תזמון. d: {readJson, writeJson, load(t), reschedule(t, rems), guide?, fetch?, now?}
// מחזיר {n, changed, sch?, stale?}
export async function refreshUser(t, doc, d) {
  const now = d.now ? d.now() : Date.now();
  const guide = await getGuide(d);
  const rems = await d.load(t);
  let derived = Array.isArray(doc.derived) ? doc.derived : [], stale = false;
  if (guide) derived = deriveItems(doc.follows, guide, now, doc.derived, rems);
  else stale = true;
  const next = { ...doc, derived, chk: now };
  if (!guide) next.chk = doc.chk || 0; // לא נחשב כבדיקה שהצליחה
  const changed = JSON.stringify(derived) !== JSON.stringify(doc.derived || []);
  await d.writeJson(folPath(t), next);
  const out = { n: derived.length, changed };
  if (stale) out.stale = true;
  try { out.sch = await d.reschedule(t, rems); } catch (e) { console.error("follow reschedule", e && e.message); out.sch = { error: "schedule failed" }; }
  return out;
}

export const FOLLOW_RECHECK_MS = 6 * 3600000; // לא מרעננים משתמש שנבדק בשש השעות האחרונות

// d: {now, listFol():Promise<[{t, doc}]>, getSubs, readJson, writeJson, load, reschedule, guide?, fetch?, deadline}
// עיקרון (כמו runCheck): הזמן נבדק גם בתוך הלולאה; המצב נשמר לכל משתמש מיד (doc.chk); נקודת ההתחלה מסתובבת יום-יום כדי שסוף הרשימה לא יורעב
export async function runFollowCheck(d) {
  const now = d.now ? d.now() : Date.now(), out = { users: 0, refreshed: 0, skipped: 0, failed: 0, partial: false };
  const late = () => !!d.deadline && Date.now() > d.deadline - DEADLINE_MARGIN_MS;
  let users = (await d.listFol()).filter((u) => u && u.doc && Array.isArray(u.doc.follows) && u.doc.follows.some((f) => f && !f.x)).sort((a, b) => (a.t < b.t ? -1 : 1));
  if (users.length) { const off = Math.floor(now / 86400000) % users.length; users = users.slice(off).concat(users.slice(0, off)); }
  for (const u of users) {
    if (late()) { out.partial = true; break; }
    out.users++;
    try {
      const subs = await d.getSubs(u.t);
      if (!Array.isArray(subs) || !subs.length) { out.skipped++; continue; } // אין לאן לשלוח
      if (u.doc.chk && now - u.doc.chk < FOLLOW_RECHECK_MS) { out.skipped++; continue; }
      const r = await refreshUser(u.t, u.doc, d);
      if (r.stale) out.failed++; else out.refreshed++;
    } catch (e) { out.failed++; console.error("follow-check", e && e.message); }
  }
  return out;
}
