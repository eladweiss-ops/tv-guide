// אחסון רשימת התזכורות לכל משתמש ב-Firestore (דרך _db.js), לפי מפתח אקראי שנוצר באפליקציה
import { readJson, writeJson } from "./_db.js";

export const okToken = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);
const path = (t) => `rems/${t}.json`;

export async function load(t) {
  const j = await readJson(path(t), []);
  return Array.isArray(j) ? j : [];
}

export async function save(t, rems) {
  await writeJson(path(t), rems);
}

export { clean } from "./_rems.js";
