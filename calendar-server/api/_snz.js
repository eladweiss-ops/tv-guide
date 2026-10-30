// נודניק להתראות: חתימה, הצפנת הטוקן ותזמון חד-פעמי. בלי תלויות חיצוניות כדי שאפשר לבדוק עם node --test
// ה-SW לא מחזיק את הטוקן האישי: הוא מקבל בתוך הפוש {o: טוקן מוצפן, a: זמן שליחה, s: חתימה, k: מפתח תזכורת, u: כתובת}
import { createHmac, createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, hkdfSync } from "node:crypto";

export const SELF = "https://tv-guide-cal.vercel.app";
export const QBASE = () => (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");
export const SNZ_TTL = 6 * 3600 * 1000; // כמה זמן אחרי שליחת הפוש אפשר עדיין לנדנד ממנו
export const SNZ_DEDUP = 60000;         // הקשות חוזרות בתוך דקה לא יוצרות הודעה נוספת

const secret = () => process.env.FIRE_SECRET || "";
const b64u = (b) => Buffer.from(b).toString("base64url");

// מפתחות נפרדים לחתימה ולהצפנה, נגזרים מ-FIRE_SECRET ב-HKDF עם תוויות שונות (בלי משתני סביבה חדשים)
const kdf = (info) => Buffer.from(hkdfSync("sha256", secret(), "tv-guide-cal/v2", info, 32));
const sigKey = () => kdf("snooze-hmac"), encKey = () => kdf("snooze-aes-gcm");
// מפתחות ישנים (לפני ההפרדה): נשארים תקפים לאימות/פענוח כדי שפוש שכבר נשלח (חלון 6 שעות) ימשיך לעבוד
const legacyEncKey = () => createHash("sha256").update("snz-enc|" + secret()).digest();

// הצפנה הפיכה של הטוקן האישי (AES-256-GCM)
export function encToken(t) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(String(t), "utf8"), c.final()]);
  return b64u(Buffer.concat([iv, c.getAuthTag(), ct]));
}
export function decToken(o) {
  let b;
  try { b = Buffer.from(String(o), "base64url"); } catch (e) { return null; }
  if (b.length < 29) return null;
  for (const key of [encKey(), legacyEncKey()]) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
    } catch (e) { /* מפתח לא מתאים, מנסים את הבא */ }
  }
  return null;
}

// חתימה על (בעלים, מפתח תזכורת, זמן שליחה)
export const signSnz = (o, k, a) => createHmac("sha256", sigKey()).update(`snz1|${o}|${k}|${a}`).digest("hex");
export const signSnzLegacy = (o, k, a) => createHmac("sha256", secret()).update(`snz1|${o}|${k}|${a}`).digest("hex");
export function verifySnz(o, k, a, s, now = Date.now()) {
  if (!secret() || typeof s !== "string" || !/^[0-9a-f]{64}$/.test(s) || !Number.isFinite(+a)) return false;
  const got = Buffer.from(s, "hex");
  // מחשבים את שתיהן (בלי קיצור דרך) ומשווים בזמן קבוע
  const okNew = timingSafeEqual(Buffer.from(signSnz(o, k, +a), "hex"), got);
  const okOld = timingSafeEqual(Buffer.from(signSnzLegacy(o, k, +a), "hex"), got);
  if (!okNew && !okOld) return false;
  return now - +a <= SNZ_TTL && +a <= now + 60000;
}

// כתובת היעד של QStash. מעבר מדורג: ?s= נשאר ביעד גם כשיש מפתחות חתימה, ויוסר רק עם QSTASH_STRICT=1 (ואחרי שה-JWT אומת בלוגים)
export const hasQstashKeys = () => !!process.env.QSTASH_CURRENT_SIGNING_KEY;
export const strictMode = () => process.env.QSTASH_STRICT === "1" && hasQstashKeys();
export const fireDest = () => SELF + "/api/fire" + (strictMode() || !secret() ? "" : "?s=" + encodeURIComponent(secret()));

// השדה snz שנכנס לפוש
export function snzField(t, k, a) {
  if (!secret() || !t) return undefined;
  const o = encToken(t);
  return { u: SELF + "/api/snooze", k, o, a, s: signSnz(o, k, a), m: 5 };
}

const fmt = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const hhmm = (ts) => fmt.format(ts);

// o = { t: טוקן (כדי לצרף snz), at: זמן השליחה, snooze: האם זו תזכורת חוזרת }
export function remPayload(r, o = {}) {
  const now = o.now || Date.now(), mins = Math.round((r.ts - now) / 60000);
  const when = mins <= 0 ? (r.ts < now - 90000 ? `התחיל ב-${hhmm(r.ts)}` : "מתחיל עכשיו") : mins < 60 ? `מתחיל בעוד ${mins} דק׳ (${hhmm(r.ts)})` : `מתחיל ב-${hhmm(r.ts)}`;
  const p = { title: "⏰ " + r.title, body: (o.snooze ? "💤 " : "") + (r.ch ? r.ch + " · " : "") + when, tag: r.k, url: "./?rem=" + encodeURIComponent(r.k) };
  const snz = snzField(o.t, r.k, o.at || now);
  if (snz) p.snz = snz;
  return p;
}

// מתזמן הודעה חד-פעמית. deps: {fetch, readJson, writeJson, now}
export async function scheduleSnooze(t, k, m, deps) {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return { status: 503, json: { error: "no scheduler" } };
  const now = deps.now ? deps.now() : Date.now();
  const path = `snz/${t}/${createHash("sha256").update(k).digest("hex").slice(0, 24)}.json`; // בלוב נפרד לכל תזכורת
  const cur = await deps.readJson(path, null);
  if (cur && cur.m === m && now - cur.ts < SNZ_DEDUP && cur.at > now) return { status: 200, json: { ok: true, at: cur.at, m: cur.m, dup: true } };
  const at = now + m * 60000;
  const r = await deps.fetch(`${QBASE()}/v2/publish/${fireDest()}`, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json", "upstash-not-before": String(Math.floor(at / 1000)), "upstash-retries": "2" },
    body: JSON.stringify({ t, k, at, snooze: 1 }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.messageId) return { status: 502, json: { error: "schedule failed" } }; // הקודם נשאר במקומו
  await deps.writeJson(path, { at, id: j.messageId, ts: now, m });
  // רק אחרי שהחדש תוזמן: מוחקים את הקודם
  if (cur && cur.id && cur.at > now) { try { await deps.fetch(`${QBASE()}/v2/messages/${cur.id}`, { method: "DELETE", headers: { authorization: "Bearer " + token } }); } catch (e) {} }
  return { status: 200, json: { ok: true, at, m } };
}

// לוגיקת POST /api/snooze. deps: {okToken, load, readJson, writeJson, fetch, now}
export async function handleSnooze(b, deps) {
  b = b || {};
  const k = String(b.k || "");
  if (!k || k.length > 80) return { status: 400, json: { error: "bad key" } };
  const m = b.m == null || b.m === "" ? 5 : +b.m;
  if (!Number.isInteger(m) || m < 1 || m > 60) return { status: 400, json: { error: "bad minutes" } };
  const now = deps.now ? deps.now() : Date.now();
  let t;
  if (b.s) { // מ-SW: חתימה
    if (typeof b.o !== "string" || !verifySnz(b.o, k, b.a, b.s, now)) return { status: 403, json: { error: "bad signature" } };
    t = decToken(b.o);
    if (!t || !deps.okToken(t)) return { status: 403, json: { error: "bad signature" } };
  } else if (b.t) { // מהאפליקציה: הטוקן האישי
    if (!deps.okToken(b.t)) return { status: 400, json: { error: "bad token" } };
    t = b.t;
  } else return { status: 403, json: { error: "unauthorized" } };
  if (deps.rate && !deps.rate(t)) return { status: 429, json: { error: "rate" } };
  const rems = await deps.load(t);
  if (!rems.some((x) => x.k === k)) return { status: 404, json: { error: "no such reminder" } };
  return scheduleSnooze(t, k, m, deps);
}
