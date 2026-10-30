// אימות הקריאה ל-/api/fire: סוד בכתובת (תאימות להודעות שכבר תוזמנו) או חתימת QStash (JWT HS256 ב-Upstash-Signature)
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { SELF } from "./_snz.js";

// השוואה בזמן קבוע בלי לחשוף אורך: משווים hash של שני הצדדים
export function safeEq(a, b) {
  const h = (x) => createHash("sha256").update(String(x)).digest();
  return timingSafeEqual(h(a), h(b));
}

// body = הגוף הגולמי (מחרוזת). מחזיר true רק אם החתימה, התוקף, היעד ותקציר הגוף תקינים
export function verifyQstashJwt(jwt, keys, body, now = Date.now(), url = SELF + "/api/fire") {
  if (typeof jwt !== "string") return false;
  const p = jwt.split(".");
  if (p.length !== 3) return false;
  let hdr, claims;
  try { hdr = JSON.parse(Buffer.from(p[0], "base64url").toString()); claims = JSON.parse(Buffer.from(p[1], "base64url").toString()); } catch (e) { return false; }
  if (!hdr || hdr.alg !== "HS256" || !claims) return false;
  const got = Buffer.from(p[2], "base64url");
  let sigOk = false;
  for (const key of keys.filter(Boolean)) { // בודקים את כל המפתחות בלי עצירה מוקדמת
    const want = createHmac("sha256", key).update(p[0] + "." + p[1]).digest();
    if (want.length === got.length && timingSafeEqual(want, got)) sigOk = true;
  }
  if (!sigOk) return false;
  const sec = now / 1000, skew = 60;
  if (claims.iss !== "Upstash") return false;
  if (typeof claims.exp !== "number" || sec > claims.exp + skew) return false;
  if (typeof claims.nbf === "number" && sec < claims.nbf - skew) return false;
  if (typeof claims.sub !== "string" || claims.sub.split("?")[0] !== url) return false;
  const bh = createHash("sha256").update(String(body || "")).digest("base64url");
  return typeof claims.body === "string" && safeEq(claims.body.replace(/=+$/, ""), bh);
}

// הרשאה: סוד בכתובת (ישן) או חתימה תקפה. rawBody נדרש רק לחתימה
export function fireAuthorized(req, rawBody, now = Date.now()) {
  const sec = process.env.FIRE_SECRET;
  const q = req.query && req.query.s;
  if (sec && typeof q === "string" && safeEq(q, sec)) return true;
  const keys = [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY].filter(Boolean);
  const sig = req.headers && req.headers["upstash-signature"];
  if (keys.length && sig) return verifyQstashJwt(String(sig), keys, rawBody, now);
  return false;
}

// גוף גולמי: אם Vercel כבר פירק אותו משחזרים, אחרת קוראים מהזרם (config.api.bodyParser=false)
export async function rawBodyOf(req, max = 16384) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error("too big"), { status: 413 }); chunks.push(Buffer.from(c)); }
  return Buffer.concat(chunks).toString("utf8");
}
