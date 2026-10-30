// אחסון רשימת התזכורות לכל משתמש ב-Vercel Blob, לפי מפתח אקראי שנוצר באפליקציה
import { put, list } from "@vercel/blob";

export const okToken = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);
const path = (t) => `rems/${t}.json`;

export async function load(t) {
  const { blobs } = await list({ prefix: path(t), limit: 1 });
  if (!blobs.length) return [];
  const r = await fetch(blobs[0].url + "?v=" + Date.now(), { cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [];
}

export async function save(t, rems) {
  await put(path(t), JSON.stringify(rems), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
}

export { clean } from "./_rems.js";
