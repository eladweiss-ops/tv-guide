// POST /api/push {t, sub}          → הרשמה להתראות (אפשר כמה מכשירים)
// POST /api/push {t, test:1}       → התראת בדיקה מיידית
// POST /api/push {t, off:endpoint} → ביטול מכשיר
import { okToken, load } from "./_store.js";
import { getSubs, setSubs, sendTo, reschedule } from "./_push.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ key: process.env.VAPID_PUBLIC, scheduler: !!process.env.QSTASH_TOKEN });
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!okToken(b.t)) return res.status(400).json({ error: "bad token" });
    if (b.test) {
      const r = await sendTo(b.t, { title: "🔔 ההתראות עובדות!", body: "ככה תיראה תזכורת לפני שהתוכנית מתחילה.", tag: "test", url: "./" });
      return res.status(200).json(r);
    }
    let subs = await getSubs(b.t);
    if (b.off) subs = subs.filter((s) => s.endpoint !== b.off);
    if (b.sub && b.sub.endpoint && b.sub.keys) { subs = subs.filter((s) => s.endpoint !== b.sub.endpoint); subs.push({ endpoint: b.sub.endpoint, keys: b.sub.keys }); subs = subs.slice(-5); }
    await setSubs(b.t, subs);
    const sch = await reschedule(b.t, await load(b.t)).catch((e) => ({ error: e.message }));
    return res.status(200).json({ ok: true, devices: subs.length, sch });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
