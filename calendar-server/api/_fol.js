// מעקב אחרי סדרות (📺): fol/<t>.json = {v:1, follows:[...], derived:[...], at, chk}. לוגיקה טהורה (בלי רשת), כדי שאפשר לבדוק עם node --test.
// follows: מה שהמשתמש עוקב אחריו (הלקוח הוא הבעלים, השרת ממזג לפי u). derived: תזכורות שהשרת גזר מהלוח (מפתח f|<סדרה>|<ערוץ>|<ts>).
// הרשימה הרגילה של התזכורות (rems/<t>) היא בבעלות הלקוח ונדרסת בכל שמירה, ולכן שום דבר כאן לא נכתב אליה: reschedule ממזג בזמן התזמון.
import { normT, seriesKey, seriesTitle, seriesAirings, ilToMs } from "./_series.js";

export const MAX_FOLLOWS = 30;
export const MAX_PER_FOLLOW = 10;          // כמה שידורים קרובים נגזרים לכל סדרה
export const TOMB_MS = 30 * 86400000;      // מחיקה נשמרת 30 יום (כדי שמכשיר שני לא יחיה סדרה שנמחקה)
export const DER_PREFIX = "f|";
export const isDerKey = (k) => typeof k === "string" && k.startsWith(DER_PREFIX);
export const folPath = (t) => `fol/${t}.json`;

const s = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
const ID = /^\d{1,6}$/;

// נקי: מחזיר מעקב תקין או null. k תמיד נגזר מהכותרת (לא סומכים על הלקוח)
export function cleanOne(x, now = Date.now()) {
  if (!x || typeof x !== "object") return null;
  const title = s(seriesTitle(s(x.title, 120)), 80), k = seriesKey(title);
  if (normT(title).length < 2 || !k) return null;
  const u = Number.isFinite(+x.u) && +x.u > 0 ? Math.min(Math.round(+x.u), now + 3600000) : now;
  const o = { k, title, u };
  if (x.x) { o.x = 1; return o; } // מחיקה (tombstone)
  const chs = (Array.isArray(x.chs) ? x.chs : []).map(String).filter((c) => ID.test(c)).slice(0, 16);
  const ch = ID.test(String(x.ch || "")) ? String(x.ch) : "";
  if (ch && !chs.includes(ch)) chs.unshift(ch);
  o.ch = ch; o.chn = ch ? s(x.chn, 40) : ""; o.chs = ch ? chs.slice(0, 16) : [];
  o.mode = x.mode === "all" ? "all" : "new";
  o.lead = Number.isFinite(+x.lead) ? Math.max(0, Math.min(180, Math.round(+x.lead))) : 10;
  if (x.dbl && o.lead > 0) o.dbl = 1;
  return o;
}

// ממזג רשימה נכנסת עם הקיימת בשרת: לכל מפתח מנצח הגבוה ב-u. עד MAX_FOLLOWS פעילים (חדשים מעבר לתקרה נדחים). מחזיר {follows, capped}
export function mergeFollows(incoming, existing, now = Date.now()) {
  const by = new Map();
  for (const x of Array.isArray(existing) ? existing : []) { const c = cleanOne(x, now); if (c) by.set(c.k, c); }
  let capped = 0;
  for (const x of Array.isArray(incoming) ? incoming.slice(0, 80) : []) {
    const c = cleanOne(x, now); if (!c) continue;
    const cur = by.get(c.k);
    if (cur && cur.u >= c.u) continue;
    if (!cur && !c.x) { // חדש: בודקים תקרה
      const active = [...by.values()].filter((y) => !y.x).length;
      if (active >= MAX_FOLLOWS) { capped++; continue; }
    }
    by.set(c.k, c);
  }
  const follows = [...by.values()].filter((y) => !y.x || now - y.u < TOMB_MS).sort((a, b) => a.u - b.u);
  return { follows, capped };
}

const activeOf = (follows) => (Array.isArray(follows) ? follows : []).filter((f) => f && !f.x);

// ---- הגזירה ----
const endsCache = new WeakMap();
function nextStart(guide, ch, tsMs) {
  let m = endsCache.get(guide);
  if (!m) {
    m = new Map();
    for (const p of guide.programs || []) { if (!p || typeof p.start !== "string") continue; const v = ilToMs(p.start); if (!Number.isFinite(v)) continue; const c = String(p.ch); (m.get(c) || m.set(c, []).get(c)).push(v); }
    for (const a of m.values()) a.sort((x, y) => x - y);
    endsCache.set(guide, m);
  }
  const a = m.get(String(ch)) || [];
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= tsMs) lo = mid + 1; else hi = mid; }
  return lo < a.length && a[lo] - tsMs <= 6 * 3600000 ? a[lo] : tsMs + 3600000;
}

// האם שידור נגזר כפול לתזכורת ידנית של המשתמש (אותו ערוץ+זמן, או אותה שעה ואותה סדרה, כולל תאומי SD/HD שמפתחם שונה)
export function dupOfManual(d, rems) {
  const stem = normT(seriesTitle(d.title));
  return (Array.isArray(rems) ? rems : []).some((r) => r && !isDerKey(r.k) && r.ts === d.ts && (r.k === `${d.c}|${d.ts}` || normT(seriesTitle(r.title)) === stem));
}

// guide: {channels, programs}. prev: derived הקודם (שומר על יציבות lead כדי שלא יישלחו התראות כפולות אחרי גזירה חוזרת). rems: התזכורות הידניות
export function deriveItems(follows, guide, now, prev = [], rems = []) {
  const names = {}; ((guide && guide.channels) || []).forEach((c) => { if (c && c.id != null) names[c.id] = s(String(c.name || ""), 60); });
  const prevBy = new Map((Array.isArray(prev) ? prev : []).map((d) => [d.k, d]));
  const out = [];
  for (const f of activeOf(follows)) {
    const rows = seriesAirings(guide, f.title, f.chs, now).filter((a) => f.mode === "all" || a.primary);
    const seen = new Set(), mine = [];
    // אותו רגע בכמה ערוצים (SD/HD, תאומים): אחד בלבד, עדיפות לערוץ שנקבע
    const sorted = rows.slice().sort((a, b) => a.ts - b.ts || (b.ch === f.ch) - (a.ch === f.ch) || +a.ch - +b.ch);
    for (const a of sorted) { if (seen.has(a.ts)) continue; seen.add(a.ts); mine.push(a); if (mine.length >= MAX_PER_FOLLOW) break; }
    for (const a of mine) {
      const key = `${DER_PREFIX}${f.k}|${a.ch}|${a.ts}`;
      const old = prevBy.get(key);
      if (old && old.fl === f.lead && !!old.dbl === !!f.dbl) { if (!dupOfManual(old, rems)) out.push(old); continue; }
      let lead = f.lead;
      if (a.ts - lead * 60000 <= now + 30000) lead = Math.max(0, Math.floor((a.ts - now - 60000) / 60000));
      if (a.ts <= now + 60000) continue;
      const d = { k: key, c: a.ch, title: s(a.title, 120), ch: names[a.ch] || "", desc: s(a.desc || "", 200), ts: a.ts, end: nextStart(guide, a.ch, a.ts), lead, fl: f.lead };
      if (f.dbl && lead > 0) d.dbl = 1;
      if (dupOfManual(d, rems)) continue;
      out.push(d);
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// רשימת התזכורות האפקטיבית לתזמון: הידניות (קודמות) + נגזרות שאין להן תזכורת ידנית באותו שידור
export function withDerived(rems, derived, now = Date.now()) {
  const base = Array.isArray(rems) ? rems : [], keys = new Set(base.map((r) => r.k));
  const extra = (Array.isArray(derived) ? derived : []).filter((d) => d && d.ts > now - 120000 && !keys.has(d.k) && !dupOfManual(d, base));
  return extra.length ? base.concat(extra) : base;
}
