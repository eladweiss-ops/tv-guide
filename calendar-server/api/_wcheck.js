// הבדיקה היומית של רשימות המעקב: זיהוי אירועים (הגיע לנטפליקס / עונה חדשה / משודר בערוץ) ושליחת פוש אחד לכל אירוע חדש.
// לוגיקה בלי תלות ב-Vercel: הכול מוזרק דרך d. ראו api/watch-check.js (נקודת הקצה) ו-README.
import { providersIL, tget, okKey } from "./_tmdb.js";
import { norm } from "./_nfs.js";

export const GUIDE_URL = "https://eladweiss-ops.github.io/tv-guide/guide.json";
export const WEEK_MS = 7 * 86400000;
export const MAX_PUSH_USER = 8;   // פוש לכל משתמש בריצה אחת; השאר לא נרשמים כשוגרו ויישלחו בריצה הבאה
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
export function whenHe(start, nowStamp) {
  const [y, m, d] = start.slice(0, 10).split("-").map(Number), dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const hh = start.slice(11, 16), same = start.slice(0, 10) === nowStamp.slice(0, 10);
  const day = dow === 6 ? "בשבת" : "ביום " + DAYS_HE[dow];
  return (same ? "היום" : day) + " ב-" + hh;
}

// התאמת כותרת תוכנית בלוח לפריט: שוויון מלא או של "גזע" (לפני ' - ' / ':' / '('), מול שם בעברית או המקורי. מינימום 3 אותיות.
// (אותו עיקרון בלקוח: js/netflix.js nfMatch)
export function titleMatch(progTitle, item) {
  const wants = [norm(item.title), norm(item.orig)].filter((x) => x.length >= 3);
  if (!wants.length) return false;
  const full = norm(progTitle), stem = norm(String(progTitle || "").split(/\s+[-–:]\s+|\s*[(:]/)[0]);
  return wants.some((w) => w === full || w === stem);
}

// כל השידורים הקרובים (7 ימים) של הפריט: [{start, ch}] ממוינים; כפילויות באותה שעה מאוחדות
export function broadcastsOf(guide, item, nowStamp) {
  const end = addDays(nowStamp, 7), names = {};
  ((guide && guide.channels) || []).forEach((c) => { if (c && c.id != null) names[c.id] = String(c.name || "").slice(0, 60); });
  const out = [], seen = new Set();
  for (const p of (guide && guide.programs) || []) {
    if (!p || typeof p.start !== "string" || p.start < nowStamp || p.start > end) continue;
    if (!titleMatch(p.title, item) || seen.has(p.start)) continue;
    seen.add(p.start); out.push({ start: p.start, ch: names[p.ch] || "" });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

const dateHe = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? iso.slice(8, 10) + "." + iso.slice(5, 7) : "");

// בודק פריט אחד. ctx: {nowStamp, guide(): Promise, prov(item), detail(item), budget:{n}}. מחזיר {events, st, changed}
export async function checkItem(item, ctx) {
  const st = { ...(item.st || {}), fired: { ...((item.st && item.st.fired) || {}) } };
  const fired = st.fired, events = [];
  const room = () => ctx.budget.n > 0;
  const fire = (key, title, body) => { if (!room()) return false; ctx.budget.n--; fired[key] = Date.now(); events.push({ key, title, body }); return true; };
  const on = item.on || [];

  if (on.indexOf("nf") >= 0) {
    try {
      const av = await ctx.prov(item);
      if (typeof st.nf !== "boolean") st.nf = av.nf; // ראשונה: בסיס בלי התראה
      else if (!st.nf && av.nf && !fired.nf) { if (fire("nf", "🔔 " + item.title + " הגיע לנטפליקס", "▶ אפשר לצפות עכשיו")) st.nf = true; }
      else if (st.nf !== av.nf) st.nf = av.nf;
    } catch (e) { console.error("wcheck nf", item.k, e && e.message); }
  }
  if (on.indexOf("season") >= 0 && item.type === "tv") {
    try {
      const j = await ctx.detail(item), n = +j.number_of_seasons || 0, ne = j.next_episode_to_air;
      if (typeof st.s !== "number") st.s = n; // בסיס
      else if (n > st.s && !fired["s" + n]) { if (fire("s" + n, "🆕 עונה " + n + " של " + item.title, ne && ne.air_date ? "מתחילה ב-" + dateHe(ne.air_date) : "נוספה עונה חדשה")) st.s = n; }
      else if (n > st.s) st.s = n;
      // פרק ראשון של עונה (2+) מתחיל בשבוע הקרוב, והעונה עוד לא הוכרזה בפוש
      if (ne && ne.episode_number === 1 && ne.season_number >= 2 && !fired["s" + ne.season_number] && typeof ne.air_date === "string" && ne.air_date >= ctx.nowStamp.slice(0, 10) && ne.air_date <= addDays(ctx.nowStamp, 7).slice(0, 10)) {
        fire("s" + ne.season_number, "🆕 עונה " + ne.season_number + " של " + item.title, "מתחילה ב-" + dateHe(ne.air_date));
      }
    } catch (e) { console.error("wcheck season", item.k, e && e.message); }
  }
  if (on.indexOf("tv") >= 0) {
    try {
      const g = await ctx.guide();
      if (g) {
        const bs = broadcastsOf(g, item, ctx.nowStamp).filter((b) => !fired["b:" + b.start]);
        if (bs.length && room()) {
          const b = bs[0];
          fire("b:" + b.start, "📺 " + item.title, "משודר " + whenHe(b.start, ctx.nowStamp) + (b.ch ? " ב" + b.ch : ""));
          bs.slice(1).forEach((x) => { fired["b:" + x.start] = Date.now(); }); // שאר השידורים באותה תקופה: לא שולחים עוד פוש
        }
        for (const k of Object.keys(fired)) if (k.startsWith("b:") && k.slice(2, 12) < ctx.nowStamp.slice(0, 10)) delete fired[k]; // שידורים שעברו
      }
    } catch (e) { console.error("wcheck tv", item.k, e && e.message); }
  }
  return { events, st };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// d: {now, fetch, key, listTokens():Promise<string[]>, readJson, writeJson, getSubs, sendTo, deadline}
export async function runCheck(d) {
  const now = d.now ? d.now() : Date.now(), nowStamp = ilStamp(now), out = { users: 0, items: 0, sent: 0, skipped: 0, partial: false };
  const tm = d.fetch ? { fetch: d.fetch, key: d.key } : { key: d.key };
  const provC = new Map(), detC = new Map();
  let guideP = null;
  const shared = {
    nowStamp,
    prov: (it) => { if (!provC.has(it.k)) provC.set(it.k, providersIL(it.type, it.k.slice(1), tm)); return provC.get(it.k); },
    detail: (it) => { if (!detC.has(it.k)) detC.set(it.k, tget("/tv/" + it.k.slice(1), { language: "he-IL" }, tm)); return detC.get(it.k); },
    guide: () => {
      if (!guideP) guideP = (async () => { try { const r = await (d.fetch || fetch)(GUIDE_URL, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined }); return r.ok ? await r.json() : null; } catch (e) { return null; } })();
      return guideP;
    },
  };
  const tokens = await d.listTokens();
  for (const t of tokens) {
    if (d.deadline && Date.now() > d.deadline) { out.partial = true; break; }
    const wl = await d.readJson(`wl/${t}.json`, { items: [] });
    const items = (wl && Array.isArray(wl.items) ? wl.items : []).filter((x) => x && okKey(x.k) && Array.isArray(x.on) && x.on.length);
    if (!items.length) continue;
    const subs = await d.getSubs(t);
    if (!subs.length) { out.skipped++; continue; } // אין לאן לשלוח: לא מתקדמים במצב, כדי לא לאבד אירועים
    out.users++;
    const ctx = { ...shared, budget: { n: MAX_PUSH_USER } };
    const next = [];
    for (const it of items) {
      out.items++;
      const r = await checkItem(it, ctx);
      for (const ev of r.events) {
        try {
          await d.sendTo(t, { title: ev.title, body: ev.body, tag: "wl-" + it.k + "-" + ev.key, url: "./?nf=" + it.k });
          out.sent++;
        } catch (e) { console.error("wcheck send", e && e.message); }
      }
      next.push({ ...it, st: r.st });
    }
    // קוראים שוב לפני הכתיבה: אם המשתמש שינה את הרשימה בינתיים, שומרים את השינוי ומעדכנים רק את מצב הבדיקה לפי מפתח
    try {
      const cur = await d.readJson(`wl/${t}.json`, { items: [] }), ci = cur && Array.isArray(cur.items) ? cur.items : [];
      const kept = ci.map((o) => { const n = next.find((x) => x.k === o.k); return n ? { ...o, st: n.st } : o; });
      if (!same(kept, ci)) await d.writeJson(`wl/${t}.json`, { items: kept });
    } catch (e) { console.error("wcheck write", e && e.message); }
  }
  return out;
}
