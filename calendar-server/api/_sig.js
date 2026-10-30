// אימות הקריאה ל-/api/fire: סוד בכתובת (תאימות להודעות שכבר תוזמנו) או חתימת QStash (JWT HS256 ב-Upstash-Signature)
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { SELF } from "./_snz.js";

// השוואה בזמן קבוע בלי לחשוף אורך: משווים hash של שני הצדדים
export function safeEq(a, b) {
  const h = (x) => createHash("sha256").update(String(x)).digest();
  return timingSafeEqual(h(a), h(b));
}

// מחזיר {ok:true} או {ok:false, reason} (בלי סודות). body = הגוף הגולמי (מחרוזת)
export function checkQstashJwt(jwt, keys, body, now = Date.now(), url = SELF + "/api/fire") {
  if (typeof jwt !== "string") return { ok: false, reason: "missing" };
  const p = jwt.split(".");
  if (p.length !== 3) return { ok: false, reason: "malformed" };
  let hdr, claims;
  try { hdr = JSON.parse(Buffer.from(p[0], "base64url").toString()); claims = JSON.parse(Buffer.from(p[1], "base64url").toString()); } catch (e) { return { ok: false, reason: "malformed" }; }
  if (!hdr || hdr.alg !== "HS256" || !claims) return { ok: false, reason: "alg" };
  const got = Buffer.from(p[2], "base64url");
  let sigOk = false;
  for (const key of keys.filter(Boolean)) { // בודקים את כל המפתחות בלי עצירה מוקדמת
    const want = createHmac("sha256", key).update(p[0] + "." + p[1]).digest();
    if (want.length === got.length && timingSafeEqual(want, got)) sigOk = true;
  }
  if (!sigOk) return { ok: false, reason: "signature" };
  const sec = now / 1000, skew = 60;
  if (claims.iss !== "Upstash") return { ok: false, reason: "iss" };
  if (typeof claims.exp !== "number" || sec > claims.exp + skew) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && sec < claims.nbf - skew) return { ok: false, reason: "nbf" };
  if (typeof claims.sub !== "string" || claims.sub.split("?")[0] !== url) return { ok: false, reason: "url" };
  const bh = createHash("sha256").update(String(body || "")).digest("base64url");
  if (typeof claims.body !== "string" || !safeEq(claims.body.replace(/=+$/, ""), bh)) return { ok: false, reason: "body" };
  return { ok: true };
}
export const verifyQstashJwt = (...a) => checkQstashJwt(...a).ok;

// הרשאה: סוד בכתובת (ישן) או חתימה תקפה. jwt = מצב אימות החתימה ללוג: "ok" | סיבת כישלון | "none" (אין כותרת) | "nokeys"
export function fireAuth(req, rawBody, now = Date.now()) {
  const sec = process.env.FIRE_SECRET;
  const q = req.query && req.query.s;
  const keys = [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY].filter(Boolean);
  const sig = req.headers && req.headers["upstash-signature"];
  let jwt = !keys.length ? "nokeys" : !sig ? "none" : "ok";
  if (keys.length && sig) { const c = checkQstashJwt(String(sig), keys, rawBody, now); jwt = c.ok ? "ok" : c.reason; }
  const secretOk = !!(sec && typeof q === "string" && safeEq(q, sec));
  return { ok: secretOk || jwt === "ok", via: secretOk ? "secret" : jwt === "ok" ? "jwt" : "none", jwt };
}
export const fireAuthorized = (req, rawBody, now) => fireAuth(req, rawBody, now).ok;

// גוף גולמי: אם Vercel כבר פירק אותו משחזרים, אחרת קוראים מהזרם (config.api.bodyParser=false)
export async function rawBodyOf(req, max = 16384) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error("too big"), { status: 413 }); chunks.push(Buffer.from(c)); }
  return Buffer.concat(chunks).toString("utf8");
}
