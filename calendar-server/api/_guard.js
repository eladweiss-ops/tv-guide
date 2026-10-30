// הגנות משותפות: הגבלת קצב בזיכרון (לכל instance), קריאת גוף עם מגבלת גודל, ותשובת 500 גנרית
const hits = new Map(); // key -> {w: תחילת חלון, n: ספירה}

// חלון קבוע. מחזיר true אם מותר, false אם עברנו את המגבלה
export function allow(key, max, windowMs = 60000, now = Date.now()) {
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.w >= 120000) hits.delete(k);
  const h = hits.get(key);
  if (!h || now - h.w >= windowMs) { hits.set(key, { w: now, n: 1 }); return true; }
  return ++h.n <= max;
}
export const _resetLimits = () => hits.clear();

export function clientIp(req) {
  const h = (req && req.headers) || {};
  const v = h["x-vercel-forwarded-for"] || h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0];
  return String(v || (req && req.socket && req.socket.remoteAddress) || "unknown").trim().slice(0, 64);
}

export function tooMany(res) {
  res.setHeader("retry-after", "60");
  return res.status(429).json({ error: "rate" });
}

// בודק גודל ומפרק JSON. מחזיר {ok:true, body} או {ok:false, status, error}
export function readBody(req, max) {
  const raw = req.body;
  const len = +(req.headers && req.headers["content-length"]);
  if (Number.isFinite(len) && len > max) return { ok: false, status: 413, error: "too big" };
  try {
    if (typeof raw === "string") {
      if (raw.length > max) return { ok: false, status: 413, error: "too big" };
      const b = JSON.parse(raw || "{}");
      return b && typeof b === "object" ? { ok: true, body: b } : { ok: false, status: 400, error: "bad request" };
    }
    const b = raw || {};
    if (typeof b !== "object") return { ok: false, status: 400, error: "bad request" };
    if (JSON.stringify(b).length > max) return { ok: false, status: 413, error: "too big" };
    return { ok: true, body: b };
  } catch (e) { return { ok: false, status: 400, error: "bad request" }; }
}

// שגיאת שרת: הפרטים רק בלוג, ללקוח הודעה גנרית
export function fail(res, e, where = "") {
  console.error("api error", where, (e && (e.stack || e.message)) || e);
  return res.status(500).json({ error: "server error" });
}
