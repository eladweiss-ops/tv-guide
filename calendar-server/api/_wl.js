// רשימת המעקב (🔔 תודיע לי) לכל משתמש: wl/<t>.json = {items:[{k,title,orig,type,poster,on:[...],at,st?}]}. לוגיקה טהורה.
import { okKey } from "./_tmdb.js";

export const MAX_WL = 50;
export const ON = ["nf", "season", "tv"]; // nf: כשמגיע לנטפליקס · season: עונה חדשה (סדרות) · tv: כשמשודר בערוץ

const RE_NF = /^https:\/\/www\.netflix\.com\//;
const RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\/[A-Za-z0-9_]+\/[A-Za-z0-9_.-]+$/;
const s = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) : "");

// prev: הפריטים הקיימים בשרת (כדי לשמר את מצב הבדיקה st). מחזיר {items, capped}
export function cleanWl(arr, prev = [], now = Date.now()) {
  if (!Array.isArray(arr)) return { items: [], capped: 0 };
  const old = {}; (Array.isArray(prev) ? prev : []).forEach((x) => { if (x && x.k) old[x.k] = x; });
  const out = [], seen = new Set();
  for (const x of arr) {
    if (!x || typeof x !== "object" || !okKey(x.k) || seen.has(x.k)) continue;
    const type = x.k[0] === "t" ? "tv" : "movie"; // הסוג נגזר מהמפתח (אי אפשר לשלוח סוג סותר)
    const on = ON.filter((o) => Array.isArray(x.on) && x.on.indexOf(o) >= 0 && (o !== "season" || type === "tv"));
    const title = s(x.title, 120);
    if (!on.length || !title) continue;
    seen.add(x.k);
    const o = { k: x.k, title, orig: s(x.orig, 120), type, poster: RE_IMG.test(x.poster || "") ? x.poster : "", link: RE_NF.test(x.link || "") && String(x.link).length <= 300 ? x.link : "", y: Number.isInteger(+x.y) && +x.y >= 1900 && +x.y <= 2100 ? +x.y : 0, on, at: Number.isFinite(+x.at) && +x.at > 0 ? Math.min(+x.at, now) : now };
    const p = old[x.k];
    if (p && p.st) o.st = p.st;
    else if (x.bn === false && x.bc === 1) o.st = { nf: false, fired: {} }; // בסיס "לא בנטפליקס" רק מתשובת חיפוש שלמה (bc=1). אחרת הבסיס נקבע בבדיקה היומית הראשונה
    out.push(o);
  }
  const capped = Math.max(0, out.length - MAX_WL);
  return { items: out.slice(0, MAX_WL), capped };
}

// מה שמחזירים ללקוח: בלי מצב הבדיקה הפנימי
export const publicWl = (items) => (Array.isArray(items) ? items : []).map(({ st, ...rest }) => rest);
