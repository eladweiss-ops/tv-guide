// אחסון רשימת התזכורות לכל משתמש ב-Firestore (דרך _db.js), לפי מפתח אקראי שנוצר באפליקציה
import { readJson, writeJson } from "./_db.js";
import { folPath, pruneDerived } from "./_fol.js";
import { tmPath, normTm, mergePend } from "./_team.js";

export const okToken = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);
const path = (t) => `rems/${t}.json`;

// הרשימה של הלקוח בלבד (rems/<t>): רק POST /api/rems כותב אותה
export async function loadOwn(t) {
  const j = await readJson(path(t), []);
  return Array.isArray(j) ? j : [];
}
// ⚽ תזכורות קבוצה שהשרת הוסיף ועוד לא אושרו בלקוח (tm/<t>.json pend, עם srv:1)
export async function loadPend(t) {
  try { return normTm(await readJson(tmPath(t), null)).pend; } catch (e) { console.error("loadPend", e && e.message); return []; }
}
// הרשימה האפקטיבית: של הלקוח + הממתינות מהשרת (ליומן המנוי, לשחזור, לירי, לנודניק, ל"הערב שלך")
export async function load(t) {
  const own = await loadOwn(t);
  return mergePend(own, await loadPend(t));
}

// התזכורות של המשתמש + התזכורות שנגזרו ממעקב אחרי סדרות (f|...), לחיפוש לפי מפתח בירי ובנודניק. הרשימה של המשתמש קודמת
export async function loadAll(t) {
  const rems = await load(t);
  let fol = null; try { fol = await readJson(folPath(t), null); } catch (e) { console.error("loadAll fol", e && e.message); }
  const der = fol && Array.isArray(fol.derived) ? pruneDerived(fol.derived, fol.follows) : []; // רק של מעקבים פעילים
  if (!der.length) return rems;
  const keys = new Set(rems.map((r) => r.k));
  return rems.concat(der.filter((d) => d && typeof d.k === "string" && !keys.has(d.k)));
}

export async function save(t, rems) {
  await writeJson(path(t), rems);
}

export { clean } from "./_rems.js";
