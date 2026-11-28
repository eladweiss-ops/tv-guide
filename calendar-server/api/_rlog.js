// יומן תזכורות קבוע (Firestore): מה קרה לכל תזכורת של כל משתמש – נוצרה (בידי הלקוח/השרת), תוזמנה (מזהה QStash, זמן ירי),
// נורתה (זמן, תשובת שירות הפוש לכל מכשיר, שגיאות), ולמה דולגה. נוסף אחרי תקלת 28.11.2026: הלוגים של Vercel (Hobby) נשמרים שעה בלבד.
// מסמך אחד למשתמש ליום (שעון ישראל): rlog/<t>__<YYYY-MM-DD> = {ev:[{k, e, at, ...}]}. נשמר 30 יום (ניקוי ב-cron היומי).
// כתיבה = קריאה+כתיבה אחת לכל קריאה ל-logEv (כמה אירועים יחד). אף פעם לא זורק: יומן שנכשל לא מפיל ירי (QStash היה מנסה שוב = פוש כפול).
// בלי פרטים אישיים מעבר למה שכבר בתזכורת: מכשיר = שם המארח של שירות הפוש בלבד (לא ה-endpoint).
import { readJson, writeJson, delJson, listPrefix, listRange } from "./_db.js";

export const RLOG_DAYS = 30;
export const RLOG_MAX = 600; // אירועים ליום למשתמש (מעבר לזה נשמרים האחרונים)
const ILD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" });
export const ilDay = (ms) => ILD.format(new Date(ms));
export const rlogPath = (t, day) => `rlog/${t}/${day}.json`;
const okTok = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);
const s = (v, n) => String(v == null ? "" : v).slice(0, n);

// events: [{k, e, ...שדות קטנים}]. d (לבדיקות): {readJson, writeJson, now}
export async function logEv(t, events, d = {}) {
  try {
    if (process.env.RLOG_OFF === "1" || !okTok(t) || !Array.isArray(events) || !events.length) return false;
    const now = d.now ? d.now() : Date.now(), rj = d.readJson || readJson, wj = d.writeJson || writeJson, p = rlogPath(t, ilDay(now));
    const cur = await rj(p, null), ev = cur && Array.isArray(cur.ev) ? cur.ev : [];
    for (const x of events) { if (!x || !x.e) continue; const o = { ...x, k: s(x.k, 100), e: s(x.e, 20) }; if (o.at == null) o.at = now; ev.push(o); }
    await wj(p, { ev: ev.slice(-RLOG_MAX) });
    return true;
  } catch (e) { console.error("rlog", e && e.message); return false; }
}

// 30 הימים האחרונים של משתמש, מקובץ לפי מפתח תזכורת: {days, keys:{k:[events]}, n}
export async function readLog(t, nowMs = Date.now(), d = {}) {
  const lp = d.listPrefix || listPrefix, cut = ilDay(nowMs - RLOG_DAYS * 86400000);
  const rows = (await lp("rlog", t + "__")).filter((r) => r.id.slice(t.length + 2) >= cut).sort((a, b) => (a.id < b.id ? -1 : 1));
  const keys = {}; let n = 0;
  for (const r of rows) for (const x of (r.value && Array.isArray(r.value.ev) ? r.value.ev : [])) { (keys[x.k] || (keys[x.k] = [])).push(x); n++; }
  return { days: rows.map((r) => r.id.slice(t.length + 2)), keys, n };
}

// ניקוי: לכל טוקן, מסמכי יומן ישנים מ-30 יום. d: {listRange, delJson, deadline, clock}
export async function cleanLog(tokens, nowMs = Date.now(), d = {}) {
  const lr = d.listRange || listRange, del = d.delJson || delJson, clock = d.clock || Date.now, cut = ilDay(nowMs - RLOG_DAYS * 86400000);
  let n = 0;
  for (const t of tokens) {
    if (d.deadline && clock() > d.deadline) break;
    if (!okTok(t)) continue;
    try { for (const r of await lr("rlog", t + "__", t + "__" + cut)) { await del(`rlog/${t}/${r.id.slice(t.length + 2)}.json`); n++; } }
    catch (e) { console.error("rlog clean", e && e.message); }
  }
  return n;
}

export const hostOf = (endpoint) => { try { return new URL(endpoint).hostname.slice(0, 60); } catch (e) { return "?"; } };
