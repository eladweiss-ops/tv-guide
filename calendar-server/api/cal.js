// /cal/TOKEN.ics → יומן "לוח שידורים" שהטלפון נרשם אליו. כל תזכורת היא אירוע עם התראה.
import { okToken, load } from "./_store.js";
import { getSubs } from "./_push.js";

const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;");
const t = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// שורות ארוכות מקופלות לפי התקן (75 בתים)
function fold(line) {
  const out = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 73) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur); return out.join("\r\n");
}

export default async function handler(req, res) {
  const tok = String(req.query.t || "");
  if (!okToken(tok)) return res.status(404).end();
  let rems = [];
  try { rems = await load(tok); } catch (e) { return res.status(503).end(); }
  // כשיש התראות פוש, היומן מציג רק את האירועים, בלי התראה כפולה
  let push = false; try { push = (await getSubs(tok)).length > 0; } catch (e) {}
  const now = t(Date.now());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tv-guide//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:לוח שידורים", "X-WR-TIMEZONE:Asia/Jerusalem", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  for (const r of rems) {
    const name = r.title + (r.ch ? " (" + r.ch + ")" : "");
    lines.push("BEGIN:VEVENT", "UID:" + r.k.replace(/[^\w|.-]/g, "") + "@tv-guide", "DTSTAMP:" + now, "DTSTART:" + t(r.ts), "DTEND:" + t(r.end),
      "SUMMARY:" + esc(name), "DESCRIPTION:" + esc(r.desc || ""),
      ...(push ? [] : ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(name), "TRIGGER:-PT" + (r.lead != null ? r.lead : 10) + "M", "END:VALARM"]), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(lines.map(fold).join("\r\n") + "\r\n");
}
