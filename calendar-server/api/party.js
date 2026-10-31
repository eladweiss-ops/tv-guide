// 🍿 ערב צפייה. הלוגיקה ב-_party.js.
// GET  /api/party?id=<id>[&g=<gid>]          → תצוגה ציבורית (שמות פרטיים + תשובות; בלי טוקנים/gid של אחרים). g = ה-gid של האורח עצמו, להחזרת התשובה שלו
// POST /api/party {action:"create", t, title, kind, ref, ch?, img?, link?, at, place, name?}
// POST /api/party {action:"get", id, gid?}                  (כמו GET, אבל ה-gid לא בכתובת; מחזיר גם mine)
// POST /api/party {action:"view"|"cancel"|"go"|"remove", t, id}  (מארח בלבד; cancel/remove עם undo:true מחזירים; remove גם rid) · {action:"list", t}: הערבים שלי
// POST /api/party {action:"rsvp", id, gid, name, ans, t?}    (אורח; t = הטוקן האישי שלו אם יש לו פוש, כדי לקבל את ה-3,2,1)
import { allow, clientIp, tooMany, readBody, fail } from "./_guard.js";
import { handleParty, MAX_BODY } from "./_party.js";
import { okToken } from "./_store.js";

export { MAX_BODY };

// d (לבדיקות): תלויות של handleParty
export default async function handler(req, res, d = {}) {
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const ip = clientIp(req);
    res.setHeader("cache-control", "no-store");
    if (req.method === "GET") {
      if (!allow("pty:get:" + ip, 300)) return tooMany(res);
      const q = req.query || {};
      const r = await handleParty("get", { id: String(q.id || ""), g: String(q.g || "") }, d);
      return res.status(r.status).json(r.json);
    }
    if (req.method !== "POST") return res.status(405).end();
    const a0 = String((req.body && typeof req.body === "object" && req.body.action) || "");
    if (a0 !== "get" && !allow("pty:ip:" + ip, 60)) return tooMany(res);
    if (a0 === "get" && !allow("pty:getp:" + ip, 300)) return tooMany(res);
    const rb = readBody(req, MAX_BODY);
    if (!rb.ok) return res.status(rb.status).json({ error: rb.error });
    const b = rb.body, a = String(b.action || "");
    if (["create", "get", "list", "view", "cancel", "go", "remove", "rsvp"].indexOf(a) < 0) return res.status(400).json({ error: "bad action" });
    if (a === "create" && !allow("pty:create:ip:" + ip, 10)) return tooMany(res);
    if (a === "create" && okToken(b.t) && !allow("pty:create:t:" + b.t, 6)) return tooMany(res);
    if (a === "rsvp") {
      if (!allow("pty:rsvp:ip:" + ip, 20)) return tooMany(res);
      if (!allow("pty:rsvp:id:" + String(b.id || "").slice(0, 40), 40)) return tooMany(res);
    }
    if (a !== "create" && a !== "rsvp" && a !== "get" && okToken(b.t) && !allow("pty:host:" + b.t, 30)) return tooMany(res);
    const r = await handleParty(a, b, d);
    return res.status(r.status).json(r.json);
  } catch (e) {
    return fail(res, e, "party");
  }
}
