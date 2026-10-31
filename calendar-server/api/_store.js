// אחסון רשימת התזכורות לכל משתמש ב-Firestore (דרך _db.js), לפי מפתח אקראי שנוצר באפליקציה
import { readJson, writeJson } from "./_db.js";
import { folPath } from "./_fol.js";

export const okToken = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);
const path = (t) => `rems/${t}.json`;

export async function load(t) {
  const j = await readJson(path(t), []);
  return Array.isArray(j) ? j : [];
}

// התזכורות של המשתמש + התזכורות שנגזרו ממעקב אחרי סדרות (f|...), לחיפוש לפי מפתח בירי ובנודניק. הרשימה של המשתמש קודמת
export async function loadAll(t) {
  const rems = await load(t);
  let fol = null; try { fol = await readJson(folPath(t), null); } catch (e) { console.error("loadAll fol", e && e.message); }
  const der = fol && Array.isArray(fol.derived) ? fol.derived : [];
  if (!der.length) return rems;
  const keys = new Set(rems.map((r) => r.k));
  return rems.concat(der.filter((d) => d && typeof d.k === "string" && !keys.has(d.k)));
}

export async function save(t, rems) {
  await writeJson(path(t), rems);
}

export { clean } from "./_rems.js";
