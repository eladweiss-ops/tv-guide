// עזרי TMDB לשרת (חיפוש נטפליקס והתראות מעקב). המפתח נשאר בשרת: TMDB_API_KEY (v3 קצר, או Read Access Token ארוך = Bearer).
// כל הפונקציות מקבלות d.fetch להזרקה בבדיקות.

export const NETFLIX_ID = 8;
const API = "https://api.themoviedb.org/3";
const RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\//;
const RE_LINK = /^https:\/\/www\.netflix\.com\//;
export const okKey = (k) => typeof k === "string" && /^[mt][0-9]{1,9}$/.test(k);

export function tmdbAuth(key = process.env.TMDB_API_KEY) {
  if (!key) return null;
  return key.length > 60 ? { headers: { authorization: "Bearer " + key, accept: "application/json" }, qs: {} } : { headers: { accept: "application/json" }, qs: { api_key: key } };
}

// GET מול TMDB. מחזיר JSON, או זורק {status} בכשל
export async function tget(path, params = {}, d = {}) {
  const au = tmdbAuth(d.key);
  if (!au) { const e = new Error("no key"); e.status = 503; throw e; }
  const u = new URL(API + path);
  for (const [k, v] of Object.entries({ ...au.qs, ...params })) if (v != null && v !== "") u.searchParams.set(k, String(v));
  const r = await (d.fetch || fetch)(u.toString(), { headers: au.headers, signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
  if (!r.ok) { const e = new Error("tmdb " + r.status); e.status = r.status; throw e; }
  return await r.json();
}

// ---- נטפליקס ישראל ----
// מחזיר {nf:boolean, others:[שמות]} מ-watch/providers (flatrate בלבד)
export async function providersIL(type, id, d = {}) {
  const j = await tget(`/${type === "tv" ? "tv" : "movie"}/${id}/watch/providers`, {}, d);
  const il = (j && j.results && j.results.IL) || {};
  const fl = Array.isArray(il.flatrate) ? il.flatrate : [];
  return {
    nf: fl.some((p) => p && p.provider_id === NETFLIX_ID),
    others: fl.filter((p) => p && p.provider_id !== NETFLIX_ID && typeof p.provider_name === "string").map((p) => p.provider_name.slice(0, 30)).slice(0, 4),
  };
}

// ---- פלט מנוקה (רשימה לבנה בלבד) ----
const str = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export function img(path, size) {
  if (typeof path !== "string" || !/^\/[A-Za-z0-9_.-]{5,80}$/.test(path)) return "";
  const u = "https://image.tmdb.org/t/p/" + size + path;
  return RE_IMG.test(u) ? u : "";
}
export function nfLink(orig, title) {
  const q = str(orig, 100) || str(title, 100);
  return q ? "https://www.netflix.com/search?q=" + encodeURIComponent(q) : "";
}
// מפרק רשומת TMDB (multi/discover/collection part) לפריט בטוח. he = רשומה בעברית, en = אנגלית (נפילה)
export function shapeTitle(he, en, type) {
  const id = he && he.id;
  if (!Number.isInteger(id) || id <= 0 || id > 999999999) return null;
  const t = type === "tv" ? "tv" : "movie";
  const e = en || {};
  const orig = str(he.original_title || he.original_name || e.original_title || e.original_name, 120);
  const title = str(he.title || he.name, 120) || str(e.title || e.name, 120) || orig;
  if (!title) return null;
  const date = str(he.release_date || he.first_air_date || e.release_date || e.first_air_date, 10);
  const o = {
    k: (t === "tv" ? "t" : "m") + id, id, type: t, title, orig: orig && orig !== title ? orig : "",
    year: /^\d{4}/.test(date) ? +date.slice(0, 4) : 0,
    overview: str(he.overview, 400) || str(e.overview, 400),
    poster: img(he.poster_path || e.poster_path, "w342"), backdrop: img(he.backdrop_path || e.backdrop_path, "w780"),
    vote: Math.round(num(he.vote_average) * 10) / 10,
    nf: false, others: [], link: "",
  };
  return o;
}
export function applyAvail(o, av) {
  if (!av) return o;
  o.nf = !!av.nf; o.others = (av.others || []).map((s) => str(s, 30)).filter(Boolean).slice(0, 4);
  o.link = o.nf ? nfLink(o.orig, o.title) : "";
  if (o.link && !RE_LINK.test(o.link)) o.link = "";
  return o;
}
