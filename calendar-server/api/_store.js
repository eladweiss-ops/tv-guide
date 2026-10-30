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

// מנקה ומגביל את מה שנשמר
export function clean(arr) {
  if (!Array.isArray(arr)) return [];
  const now = Date.now();
  return arr.slice(0, 300).map((x) => ({
    k: String(x.k || "").slice(0, 80), title: String(x.title || "").slice(0, 200), ch: String(x.ch || "").slice(0, 80),
    desc: String(x.desc || "").slice(0, 400), ts: +x.ts, end: +x.end, lead: Math.max(0, Math.min(240, +x.lead || 10)),
  })).filter((x) => x.k && x.title && x.ts > 0 && x.end > x.ts && x.end > now - 86400000);
}
