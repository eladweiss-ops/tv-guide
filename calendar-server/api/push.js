// POST /api/push {t, sub}          → הרשמה להתראות (אפשר כמה מכשירים)
// POST /api/push {t, test:1}       → התראת בדיקה מיידית
// POST /api/push {t, off:endpoint} → ביטול מכשיר
// ה-endpoint חייב להיות שירות פוש מוכר (ראו _val.js), אחרת 400
import { okToken, load } from "./_store.js";
import { getSubs, setSubs, sendTo, reschedule } from "./_push.js";
import { validSub } from "./_val.js";
import { allow, clientIp, tooMany, readBody, fail } from "./_guard.js";

export const MAX_BODY = 4096;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ key: process.env.VAPID_PUBLIC, scheduler: !!process.env.QSTASH_TOKEN });
  if (req.method !== "POST") return res.status(405).end();
  try {
    if (!allow("push:ip:" + clientIp(req), 30)) return tooMany(res);
    const rb = readBody(req, MAX_BODY);
    if (!rb.ok) return res.status(rb.status).json({ error: rb.error });
    const b = rb.body;
    if (!okToken(b.t)) return res.status(400).json({ error: "bad token" });
    if (!allow("push:t:" + b.t, 10)) return tooMany(res);
    if (b.test) {
      if (!allow("push:test:" + b.t, 3)) return tooMany(res);
      const r = await sendTo(b.t, { title: "🔔 ההתראות עובדות!", body: "ככה תיראה תזכורת לפני שהתוכנית מתחילה.", tag: "test", url: "./" });
      return res.status(200).json(r);
    }
    if (b.sub !== undefined && !validSub(b.sub)) return res.status(400).json({ error: "bad subscription" });
    if (b.off !== undefined && (typeof b.off !== "string" || b.off.length > 1000)) return res.status(400).json({ error: "bad request" });
    let subs = await getSubs(b.t);
    if (b.off) subs = subs.filter((s) => s.endpoint !== b.off);
    if (b.sub) { subs = subs.filter((s) => s.endpoint !== b.sub.endpoint); subs.push({ endpoint: b.sub.endpoint, keys: { p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth } }); subs = subs.slice(-5); }
    await setSubs(b.t, subs);
    const sch = await reschedule(b.t, await load(b.t)).catch((e) => { console.error("reschedule", e && e.message); return { error: "schedule failed" }; });
    return res.status(200).json({ ok: true, devices: subs.length, sch });
  } catch (e) {
    return fail(res, e, "push");
  }
}
