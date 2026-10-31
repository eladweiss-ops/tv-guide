// התראת טלגרם לבעלים על משתמש חדש (מופעלת מ-backup.js כשנוצר גיבוי לטוקן בפעם הראשונה).
// משתני סביבה ב-Vercel: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. חסרים = לא שולחים, בלי שגיאה.
// ההודעה לא כוללת טוקן, כתובת IP או User-Agent: רק מקור ההגעה ומחלקת מכשיר (ערכים מרשימה סגורה).
import { readJson, writeJson } from "./_db.js";

const RLM = "‏";
export const MAX_PER_HOUR = 10;
const HOUR = 3600000;
const TIMEOUT_MS = 3000;

export const SRC_HE = {
  join: "קישור ההזמנה", party: "ערב צפייה", share: "שיתוף תוכנית", direct: "ישיר",
  whatsapp: "וואטסאפ", instagram: "אינסטגרם", facebook: "פייסבוק", telegram: "טלגרם", google: "גוגל", twitter: "X (טוויטר)",
};
export const DEV_HE = {
  "iphone-app": "אייפון (אפליקציה)", "iphone-safari": "אייפון (ספארי)", ipad: "אייפד",
  "android-app": "אנדרואיד (אפליקציה)", "android-browser": "אנדרואיד (דפדפן)", desktop: "מחשב",
};

export const escapeHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// מנקה את השדה מהלקוח. מחזיר {s, d} (d ריק אם לא מוכר) או null אם אין/לא תקין
export function cleanSrc(src) {
  if (!src || typeof src !== "object") return null;
  const s = typeof src.s === "string" && /^[a-z0-9_-]{1,20}$/.test(src.s) ? src.s : "direct";
  const d = typeof src.d === "string" && Object.hasOwn(DEV_HE, src.d) ? src.d : "";
  return { s, d };
}

export function buildMessage(src, total, skipped = 0) {
  const c = src ? cleanSrc(src) : null;
  const from = !c ? "לא ידוע" : Object.hasOwn(SRC_HE, c.s) ? SRC_HE[c.s] : "קמפיין: " + c.s;
  const dev = c && c.d ? DEV_HE[c.d] : "לא ידוע";
  const lines = ["👤 <b>משתמש חדש בזפזופ</b>", "הגיע מ: " + escapeHtml(from), "מכשיר: " + escapeHtml(dev), "סה״כ משתמשים: " + (Number(total) || 0)];
  if (skipped > 0) lines.push("ועוד " + (Number(skipped) || 0) + " משתמשים חדשים בשעה האחרונה");
  return lines.map((l) => RLM + l).join("\n");
}

async function sendTelegram(text, token, chat) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return !!(r && r.ok);
  } finally { clearTimeout(tm); }
}

// נקרא פעם אחת לכל משתמש חדש. לעולם לא זורק (כשל כאן לא מפיל את הגיבוי)
export async function notifyNewUser(src, now = Date.now()) {
  try {
    const c = src ? cleanSrc(src) : null;
    if (c && c.s === "restore") return false; // שחזור מקישור אישי אינו משתמש חדש
    // מונה תצוגה בלבד (קריאה-ושמירה, לא אטומי: טעות של אחד בהתנגשות היא לא בעיה)
    let total = 0;
    try { const u = await readJson("stats/users.json", { n: 0 }); total = (+u.n || 0) + 1; await writeJson("stats/users.json", { n: total }); } catch (e) { console.error("notify counter", e && e.message); }
    const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) return false;
    // תקרה גלובלית: MAX_PER_HOUR התראות בשעה. מעבר לכך רק סופרים, והמספר מצטרף להתראה הראשונה בשעה הבאה
    const bucket = Math.floor(now / HOUR);
    let a = await readJson("stats/alerts.json", { h: bucket, n: 0, skip: 0 });
    let carry = 0;
    if (a.h !== bucket) { carry = +a.skip || 0; a = { h: bucket, n: 0, skip: 0 }; }
    if (a.n >= MAX_PER_HOUR) { a.skip = (+a.skip || 0) + 1; await writeJson("stats/alerts.json", a); return false; }
    a.n++;
    await writeJson("stats/alerts.json", a);
    return await sendTelegram(buildMessage(c, total, carry), token, chat);
  } catch (e) {
    console.error("notify failed", e && e.name === "AbortError" ? "timeout" : e && e.message);
    return false;
  }
}
