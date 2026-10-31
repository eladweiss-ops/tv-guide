// מעקב אחרי סדרות (📺): fol/<t>.json = {v:1, follows:[...], derived:[...], at, chk, gu}. לוגיקה טהורה (בלי רשת), כדי שאפשר לבדוק עם node --test.
// follows: מה שהמשתמש עוקב אחריו (הלקוח הוא הבעלים, השרת ממזג לפי u). derived: תזכורות שהשרת גזר מהלוח (מפתח f|<סדרה>|<ערוץ>|<ts>).
// הרשימה הרגילה של התזכורות (rems/<t>) היא בבעלות הלקוח ונדרסת בכל שמירה, ולכן שום דבר כאן לא נכתב אליה: reschedule ממזג בזמן התזמון.
import { normT, seriesKey, seriesTitle, seriesAirings, genericTitle, dayCap, chDisplay, dupRank, cmpId, ID_RE, ilToMs } from "./_series.js";

export const MAX_FOLLOWS = 30;
export const MAX_PER_FOLLOW = 10;          // כמה שידורים קרובים נגזרים לכל סדרה
export const MAX_PER_USER_DAY = 8;         // תקרת התראות מעקב ליום (שעון ישראל) לכל המשתמש; התזכורות של המשתמש עצמו לא נספרות
export const MAX_CHS = 64, MAX_SKIP = 40;
export const TOMB_MS = 30 * 86400000;      // מחיקה נשמרת 30 יום (כדי שמכשיר שני לא יחיה סדרה שנמחקה)
export const DER_PREFIX = "f|";
export const isDerKey = (k) => typeof k === "string" && k.startsWith(DER_PREFIX);
export const folPath = (t) => `fol/${t}.json`;
export const derSeries = (k) => String(k).split("|")[1] || ""; // מפתח הסדרה מתוך מפתח נגזרת

const s = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
const ilDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(ms));

// נקי: מחזיר מעקב תקין או null. k תמיד נגזר מהכותרת (לא סומכים על הלקוח)
export function cleanOne(x, now = Date.now()) {
  if (!x || typeof x !== "object") return null;
  const title = s(seriesTitle(s(x.title, 120)), 80), k = seriesKey(title);
  if (normT(title).length < 2 || !k) return null;
  const u = Number.isFinite(+x.u) && +x.u > 0 ? Math.min(Math.round(+x.u), now + 3600000) : now;
  const o = { k, title, u };
  if (x.x) { o.x = 1; return o; } // מחיקה (tombstone)
  const chs = (Array.isArray(x.chs) ? x.chs : []).map(String).filter((c) => ID_RE.test(c)).slice(0, MAX_CHS);
  const ch = ID_RE.test(String(x.ch || "")) ? String(x.ch) : "";
  if (ch && !chs.includes(ch)) chs.unshift(ch);
  o.ch = ch; o.chn = ch ? s(x.chn, 40) : ""; o.chs = chs.slice(0, MAX_CHS); // chs ריק = כל הערוצים; ch = ערוץ מסוים; chs בלי ch = "הערוצים שלי"
  o.mode = x.mode === "all" ? "all" : "new";
  o.lead = Number.isFinite(+x.lead) ? Math.max(0, Math.min(10080, Math.round(+x.lead))) : 10; // אותה תקרה כמו ברשימת התזכורות הרגילה (_rems.js clean)
  if (x.dbl && o.lead > 0) o.dbl = 1;
  const skip = (Array.isArray(x.skip) ? x.skip : []).map(Math.round).filter((t) => Number.isFinite(t) && t > 0).slice(-MAX_SKIP);
  if (skip.length) o.skip = skip;
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

export const activeOf = (follows) => (Array.isArray(follows) ? follows : []).filter((f) => f && !f.x);

// משאיר רק נגזרות של מעקבים פעילים (מעקב שנעצר/נמחק לעולם לא יורה, גם אם הלוח לא נטען ולא גזרנו מחדש)
export function pruneDerived(derived, follows) {
  const live = new Set(activeOf(follows).map((f) => f.k));
  return (Array.isArray(derived) ? derived : []).filter((d) => d && live.has(derSeries(d.k)));
}

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

// האם שידור נגזר כפול לתזכורת ידנית של המשתמש (אותו ערוץ+זמן, או אותה שעה ואותה סדרה, כולל תאומי SD/HD שמפתחם שונה).
// נבדק רק בזמן התזמון (withDerived), לא בגזירה: ביטול התזכורת הידנית מחזיר את התזכורת של המעקב מיד
export function dupOfManual(d, rems) {
  const stem = normT(seriesTitle(d.title));
  return (Array.isArray(rems) ? rems : []).some((r) => r && !isDerKey(r.k) && r.ts === d.ts && (r.k === `${d.c}|${d.ts}` || normT(seriesTitle(r.title)) === stem));
}

// guide: {channels, programs}. prev: derived הקודם (שומר על יציבות lead כדי שלא יישלחו התראות כפולות אחרי גזירה חוזרת). ilToMs: מ-_series.js
export function deriveItems(follows, guide, now, prev = []) {
  const chObj = {}; ((guide && guide.channels) || []).forEach((c) => { if (c && c.id != null) chObj[String(c.id)] = c; });
  const prevBy = new Map((Array.isArray(prev) ? prev : []).map((d) => [d.k, d]));
  const out = [];
  for (const f of activeOf(follows)) {
    if (genericTitle(guide, f.title)) continue; // כותרת כללית (NBA, חדשות...): נושא, לא סדרה
    const mode = f.mode === "all" ? "all" : "new", chs = f.chs || [];
    const rows = seriesAirings(guide, f.title, chs, now).filter((a) => mode === "all" || a.primary);
    // אותו רגע בכמה ערוצים (תאומי SD/HD): אחד בלבד. עדיפות: הערוץ שנקבע, אחר כך ערוץ שבחר המשתמש, אחר כך השם הקנוני (בלי "חדש"/העתק), ואז מספר נמוך
    const pri = (a) => [a.ch === f.ch ? 0 : 1, chs.includes(a.ch) ? 0 : 1, dupRank(chObj[a.ch] && chObj[a.ch].name)];
    const cmp = (a, b) => { const x = pri(a), y = pri(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return cmpId(a.ch, b.ch); };
    const byTs = new Map();
    for (const a of rows) { const c = byTs.get(a.ts); if (!c || cmp(a, c) < 0) byTs.set(a.ts, a); }
    const skip = new Set(f.skip || []);
    const mine = dayCap([...byTs.values()], mode).filter((a) => !skip.has(a.ts)).slice(0, MAX_PER_FOLLOW);
    for (const a of mine) {
      const key = `${DER_PREFIX}${f.k}|${a.ch}|${a.ts}`;
      const old = prevBy.get(key);
      if (old && old.fl === f.lead && !!old.dbl === !!f.dbl) { out.push(old); continue; }
      let lead = f.lead;
      if (a.ts - lead * 60000 <= now + 30000) lead = Math.max(0, Math.floor((a.ts - now - 60000) / 60000));
      if (a.ts <= now + 60000) continue;
      const d = { k: key, c: a.ch, title: s(a.title, 120), ch: chObj[a.ch] ? chDisplay(chObj[a.ch]) : "", desc: s(a.desc || "", 200), ts: a.ts, end: nextStart(guide, a.ch, a.ts), lead, fl: f.lead };
      if (f.dbl && lead > 0) d.dbl = 1;
      out.push(d);
    }
  }
  // תקרה יומית לכל המשתמש (שעון ישראל): מי שעוקב אחרי הרבה סדרות לא יקבל עשרות התראות ביום
  const perDay = {}, kept = [];
  for (const d of out.sort((a, b) => a.ts - b.ts)) { const day = ilDay(d.ts); perDay[day] = (perDay[day] || 0) + 1; if (perDay[day] <= MAX_PER_USER_DAY) kept.push(d); }
  return kept;
}

// רשימת התזכורות האפקטיבית לתזמון: הידניות (קודמות) + נגזרות שאין להן תזכורת ידנית באותו שידור
export function withDerived(rems, derived, now = Date.now()) {
  const base = Array.isArray(rems) ? rems : [], keys = new Set(base.map((r) => r.k));
  const extra = (Array.isArray(derived) ? derived : []).filter((d) => d && d.ts > now - 120000 && !keys.has(d.k) && !dupOfManual(d, base));
  return extra.length ? base.concat(extra) : base;
}
