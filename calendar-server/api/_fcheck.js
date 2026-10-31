// מעקב אחרי סדרות: רענון הנגזרות מול הלוח החי (בבקשת POST /api/follow, בפתיחת האפליקציה, בירי כשהלוח השתנה, ובבדיקה היומית /api/watch-check), בלי תלות ב-Vercel: הכול מוזרק דרך d.
import { GUIDE_URL, DEADLINE_MARGIN_MS } from "./_wcheck.js";
import { deriveItems, mergeFollows, pruneDerived, activeOf, folPath } from "./_fol.js";
import { ilToMs } from "./_series.js";

let gCache = { t: 0, g: null };
export const GUIDE_TTL = 10 * 60000;
export const FOLLOW_BUDGET_MS = 20000;       // שלב המעקב בבדיקה היומית: לא מתחילים עבודה חדשה אחרי 20 שניות (לנטפליקס נשארים 25+)
export const PUBLISH_TIMEOUT_MS = 8000;
export const _resetGuide = () => { gCache = { t: 0, g: null }; };

// הלוח החי (guide.json מ-GitHub Pages), עם מטמון של 10 דקות בזיכרון. כשל = הישן אם יש, אחרת null (המצב הנגזר הקודם נשאר)
export async function getGuide(d = {}) {
  if (d.guide) return d.guide();
  const now = d.now ? d.now() : Date.now();
  if (gCache.g && now - gCache.t < GUIDE_TTL) return gCache.g;
  try {
    const r = await (d.fetch || fetch)(GUIDE_URL, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
    const g = r.ok ? await r.json() : null;
    if (g && Array.isArray(g.programs) && g.programs.length) { gCache = { t: now, g }; return g; }
  } catch (e) { console.error("follow guide", e && e.message); }
  return gCache.g;
}
export const guideStamp = (g) => String((g && g.updated) || "");

// גוזר מחדש את התזכורות של משתמש אחד, שומר ומסנכרן תזמון. d: {readJson, writeJson, load(t), reschedule(t, rems, o), guide?, fetch?, now?, create?, deadline?}
// הכתיבה: קוראים שוב את המסמך רגע לפני, ממזגים את המעקבים לפי u וכותבים רק derived/chk/gu (מעקבים שהמשתמש שינה בינתיים לא נדרסים)
export async function refreshUser(t, doc, d) {
  const now = d.now ? d.now() : Date.now();
  const guide = await getGuide(d);
  const rems = await d.load(t);
  const fresh = await d.readJson(folPath(t), null);
  if (!fresh && !d.create) return { n: 0, changed: false, gone: true }; // המסמך נמחק בינתיים (המשתמש הפסיק לעקוב אחרי הכול)
  const base = fresh || doc;
  const follows = fresh ? mergeFollows(doc.follows, fresh.follows, now).follows : doc.follows;
  let derived = Array.isArray(base.derived) ? base.derived : [];
  const stale = !guide;
  if (guide) derived = deriveItems(follows, guide, now, base.derived);
  derived = pruneDerived(derived, follows); // גם כשהלוח לא נטען: מעקב שנעצר לא יורה
  const next = { ...base, v: 1, follows, derived, at: base.at || doc.at || now, chk: guide ? now : base.chk || 0, gu: guide ? guideStamp(guide) : base.gu || "" };
  const changed = JSON.stringify(derived) !== JSON.stringify(base.derived || []);
  await d.writeJson(folPath(t), next);
  const out = { n: derived.length, changed };
  if (stale) out.stale = true;
  try { out.sch = await d.reschedule(t, rems, { deadline: d.deadline ? d.deadline - DEADLINE_MARGIN_MS : 0 }); } catch (e) { console.error("follow reschedule", e && e.message); out.sch = { error: "schedule failed" }; }
  return out;
}

// גזירה מחדש לפי מה ששמור (בירי כשפריט נגזר כבר לא בלוח, ובפתיחת אפליקציה כשהלוח חדש מהגזירה האחרונה)
export async function rederive(t, d) {
  const doc = await d.readJson(folPath(t), null);
  if (!doc || !activeOf(doc.follows).length) return null;
  return refreshUser(t, doc, d);
}
// האם הלוח הנוכחי חדש ממה שנגזר ממנו
export async function guideNewer(doc, d) { const g = await getGuide(d); return !!g && !!doc && guideStamp(g) !== String(doc.gu || ""); }

// האם נגזרת עדיין קיימת בלוח הנוכחי (אותו ערוץ, אותו זמן). בלי לוח זמין: כן (לא חוסמים)
export async function derivedStillAired(item, d) {
  const g = await getGuide(d); if (!g) return true;
  return (g.programs || []).some((p) => p && String(p.ch) === String(item.c) && ilToMs(p.start) === item.ts);
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
