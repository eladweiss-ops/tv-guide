// הבדיקה היומית של רשימות המעקב: זיהוי אירועים (הגיע לנטפליקס / עונה חדשה / משודר בערוץ) ושליחת פוש אחד לכל אירוע חדש.
// לוגיקה בלי תלות ב-Vercel: הכול מוזרק דרך d. ראו api/watch-check.js (נקודת הקצה) ו-README.
import { providersIL, tget, okKey } from "./_tmdb.js";
import { norm } from "./_nfs.js";

export const GUIDE_URL = "https://eladweiss-ops.github.io/tv-guide/guide.json";
export const MAX_PUSH_USER = 8;       // פוש לכל משתמש בריצה אחת; השאר לא נרשמים כשוגרו ויישלחו בריצה הבאה
export const TV_COOLDOWN_MS = 7 * 86400000; // "משודר בערוץ": לכל היותר פוש אחד לפריט בשבוע
export const DEADLINE_MARGIN_MS = 10000;    // מרווח ביטחון לפני סוף זמן הפונקציה
export const DAYS_HE = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];

// "YYYY-MM-DDTHH:MM" בשעון ישראל (כמו guide.json)
export function ilStamp(ms) {
  const p = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const addDays = (stamp, n) => {
  const [y, m, d] = stamp.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10) + stamp.slice(10);
};
// "ביום ה׳ ב־21:00" (מקף עברי לפני השעה, כדי שהספרות לא יתהפכו)
export function whenHe(start, nowStamp) {
  const [y, m, d] = start.slice(0, 10).split("-").map(Number), dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const hh = start.slice(11, 16), same = start.slice(0, 10) === nowStamp.slice(0, 10);
  const day = dow === 6 ? "בשבת" : "ביום " + DAYS_HE[dow];
  return (same ? "היום" : day) + " ב־" + hh;
}

const stemOf = (t) => String(t || "").split(/\s+[-–:]\s+|\s*[(:]/)[0];
// התאמת כותרת תוכנית בלוח לפריט. סדרה: שוויון מלא או של "גזע" (לפני ' - ' / ':' / '('). סרט: שוויון מלא בלבד
// ("מועדון קרב" לא תואם "מועדון קרב: לחברים בלבד"), ואם יש שנה בשני הצדדים (p.year, item.y) היא חייבת להתאים (±1). מינימום 3 אותיות.
// (אותו עיקרון בלקוח: js/nfsearch.js)
export function titleMatch(progTitle, item, prog) {
  const wants = [norm(item.title), norm(item.orig)].filter((x) => x.length >= 3);
  if (!wants.length) return false;
  const full = norm(progTitle);
  let ok = wants.some((w) => w === full);
  if (!ok && item.type === "tv") { const stem = norm(stemOf(progTitle)); ok = wants.some((w) => w === stem); }
  if (ok && item.type !== "tv" && prog && +prog.year > 0 && +item.y > 0 && Math.abs(+prog.year - +item.y) > 1) return false;
  return ok;
}

// כל השידורים הקרובים (7 ימים) של הפריט: [{start, ch}] ממוינים; כפילויות באותה שעה מאוחדות
export function broadcastsOf(guide, item, nowStamp) {
  const end = addDays(nowStamp, 7), names = {};
  ((guide && guide.channels) || []).forEach((c) => { if (c && c.id != null) names[c.id] = String(c.name || "").slice(0, 60); });
  const out = [], seen = new Set();
  for (const p of (guide && guide.programs) || []) {
    if (!p || typeof p.start !== "string" || p.start < nowStamp || p.start > end) continue;
    if (!titleMatch(p.title, item, p) || seen.has(p.start)) continue;
    seen.add(p.start); out.push({ start: p.start, ch: names[p.ch] || "" });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

const dateHe = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? iso.slice(8, 10) + "." + iso.slice(5, 7) : "");

// בודק פריט אחד. ctx: {nowStamp, now, guide(): Promise, prov(item), detail(item), budget:{n}}.
// מחזיר {events, st}. כל אירוע נושא undo(st): מחזיר את מצב הפריט לפני האירוע (כשהפוש נכשל, כדי לא לסמן אותו כשוגר)
export async function checkItem(item, ctx) {
  const st = { ...(item.st || {}), fired: { ...((item.st && item.st.fired) || {}) } };
  const fired = st.fired, events = [], now = ctx.now || Date.now();
  const room = () => ctx.budget.n > 0;
  const fire = (key, title, body, undo) => { if (!room()) return false; ctx.budget.n--; fired[key] = now; events.push({ key, title, body, undo }); return true; };
  const on = item.on || [];

  if (on.indexOf("nf") >= 0) {
    try {
      const av = await ctx.prov(item);
      if (typeof st.nf !== "boolean") st.nf = av.nf; // ראשונה: בסיס שנקבע כאן (תשובה מלאה מהשרת), בלי התראה
      else if (!st.nf && av.nf && !fired.nf) {
        const prev = st.nf;
        if (fire("nf", "🔔 " + item.title + " הגיע לנטפליקס", "▶ אפשר לצפות עכשיו", (s) => { s.nf = prev; delete s.fired.nf; })) st.nf = true;
      } else if (st.nf !== av.nf) st.nf = av.nf;
    } catch (e) { console.error("wcheck nf", item.k, e && e.message); }
  }
  if (on.indexOf("season") >= 0 && item.type === "tv") {
    try {
      const j = await ctx.detail(item), today = ctx.nowStamp.slice(0, 10), soon = addDays(ctx.nowStamp, 7).slice(0, 10);
      const seasons = (Array.isArray(j.seasons) ? j.seasons : []).filter((s) => s && s.season_number >= 1 && typeof s.air_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.air_date));
      const aired = seasons.filter((s) => s.air_date <= today).reduce((m, s) => Math.max(m, s.season_number), 0);
      if (typeof st.s !== "number") st.s = aired; // בסיס: העונה האחרונה ששודרה כבר
      else {
        // עונה חדשה = עונה (2+) שתאריך הפרמיירה שלה עד היום+7 ועוד לא שוגרה. כך לא מתריעים על "עונה" שרק נוספה ל-TMDB בלי תאריך קרוב
        const cand = seasons.filter((s) => s.season_number >= 2 && s.season_number > st.s && s.air_date <= soon && !fired["s" + s.season_number]).sort((a, b) => a.season_number - b.season_number)[0];
        if (cand) {
          const n = cand.season_number, prevS = st.s;
          if (fire("s" + n, "🆕 עונה " + n + " של " + item.title, cand.air_date > today ? "מתחילה ב־" + dateHe(cand.air_date) : "עונה חדשה זמינה", (s) => { s.s = prevS; delete s.fired["s" + n]; })) { if (cand.air_date <= today) st.s = n; }
        } else if (aired > st.s) st.s = aired;
      }
    } catch (e) { console.error("wcheck season", item.k, e && e.message); }
  }
  if (on.indexOf("tv") >= 0) {
    try {
      const g = await ctx.guide();
      if (g) {
        const prevAt = fired.tvAt, bs = broadcastsOf(g, item, ctx.nowStamp);
        // פוש אחד לפריט בשבוע, על השידור הקרוב ביותר
        if (bs.length && !(prevAt && now - prevAt < TV_COOLDOWN_MS)) {
          const b = bs[0];
          fire("tvAt", "📺 " + item.title, "משודר " + whenHe(b.start, ctx.nowStamp) + (b.ch ? " ב־" + b.ch : ""), (s) => { if (prevAt) s.fired.tvAt = prevAt; else delete s.fired.tvAt; });
        }
        for (const k of Object.keys(fired)) if (k.startsWith("b:")) delete fired[k]; // מפתחות ישנים משיטה קודמת
      }
    } catch (e) { console.error("wcheck tv", item.k, e && e.message); }
  }
  return { events, st };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// d: {now, fetch, key, listUsers():Promise<[{t, wl}]>, readJson, writeJson, getSubs, sendTo, deadline, cleanCache?}
// עיקרון: כל פוש מתועד מיד (st.fired) לפני המשך; פוש שנכשל (ok:0 או חריגה) לא נרשם כשוגר; הזמן נבדק גם בתוך לולאת הפריטים;
// נקודת ההתחלה מסתובבת יום-יום כדי שסוף הרשימה לא יורעב
export async function runCheck(d) {
  const now = d.now ? d.now() : Date.now(), nowStamp = ilStamp(now), out = { users: 0, items: 0, sent: 0, failed: 0, skipped: 0, partial: false };
  const tm = d.fetch ? { fetch: d.fetch, key: d.key } : { key: d.key };
  const provC = new Map(), detC = new Map();
  let guideP = null;
  const shared = {
    nowStamp, now,
    prov: (it) => { if (!provC.has(it.k)) provC.set(it.k, providersIL(it.type, it.k.slice(1), tm)); return provC.get(it.k); },
    detail: (it) => { if (!detC.has(it.k)) detC.set(it.k, tget("/tv/" + it.k.slice(1), { language: "he-IL" }, tm)); return detC.get(it.k); },
    guide: () => {
      if (!guideP) guideP = (async () => { try { const r = await (d.fetch || fetch)(GUIDE_URL, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined }); return r.ok ? await r.json() : null; } catch (e) { return null; } })();
      return guideP;
    },
  };
  const late = () => !!d.deadline && Date.now() > d.deadline - DEADLINE_MARGIN_MS;
  if (d.cleanCache) { try { out.cleaned = await d.cleanCache(now); } catch (e) { console.error("wcheck clean", e && e.message); } }
  let users = (await d.listUsers()).slice().sort((a, b) => (a.t < b.t ? -1 : 1));
  if (users.length) { const off = Math.floor(now / 86400000) % users.length; users = users.slice(off).concat(users.slice(0, off)); }

  // כותב רק את מצב הפריט שהשתנה: קורא שוב, ממזג לפי מפתח (שינוי של המשתמש בינתיים נשמר)
  const persist = async (t, it, st) => {
    const cur = await d.readJson(`wl/${t}.json`, { items: [] }), ci = cur && Array.isArray(cur.items) ? cur.items : [];
    const kept = ci.map((o) => (o.k === it.k ? { ...o, st } : o));
    if (!same(kept, ci)) await d.writeJson(`wl/${t}.json`, { items: kept });
  };

  for (const u of users) {
    if (late()) { out.partial = true; break; }
    const t = u.t, wl = u.wl;
    const items = (wl && Array.isArray(wl.items) ? wl.items : []).filter((x) => x && okKey(x.k) && Array.isArray(x.on) && x.on.length);
    if (!items.length) continue;
    const subs = await d.getSubs(t);
    if (!subs.length) { out.skipped++; continue; } // אין לאן לשלוח: לא מתקדמים במצב, כדי לא לאבד אירועים
    out.users++;
    const ctx = { ...shared, budget: { n: MAX_PUSH_USER } };
    for (const it of items) {
      if (late()) { out.partial = true; break; }
      out.items++;
      const r = await checkItem(it, ctx);
      for (const ev of r.events) {
        let ok = false;
        try {
          const res = await d.sendTo(t, { title: ev.title, body: ev.body, tag: "wl-" + it.k + "-" + ev.key, url: "./?nf=" + it.k + "&e=" + (ev.key === "nf" ? "nf" : ev.key === "tvAt" ? "tv" : "season") });
          ok = !!res && res.ok > 0;
        } catch (e) { console.error("wcheck send", e && e.message); }
        if (ok) out.sent++; else { out.failed++; ev.undo(r.st); }
      }
      if (!same(r.st, it.st || { fired: {} })) { try { await persist(t, it, r.st); } catch (e) { console.error("wcheck write", e && e.message); } }
    }
  }
  return out;
}
