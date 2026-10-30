#!/usr/bin/env node
/*
 * שליחת התראות טלגרם על תוצאות הניטור. Node 22, בלי תלויות.
 *   node tools/monitor/notify.mjs --health health.json --state state.json [--ux ux.txt] [--shots dir] --mode check|summary
 * מצב check (כל שעתיים): שולח רק במעבר ל-🔴 או חזרה ל-🟢. מצב summary (08:00 ישראל / force_summary): תמיד שולח סיכום.
 * בלי TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID – לא שולח, לא נכשל (רק מדפיס מה היה נשלח).
 * המצב נשמר בקובץ --state (ה-workflow שומר אותו ב-actions/cache, בלי commit).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summaryLine, israelNow } from "./health.mjs";

const RLM = "‏"; // ‏ – כל שורה מתחילה בו כדי שהודעה עברית תוצג מימין לשמאל גם כשיש מספרים/לטינית

export const escapeHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const line = (s) => RLM + s;

// ───────── ניתוח פלט shoot.cjs ─────────
export function parseUx(text) {
  const out = { devices: [], overflow: [], errors: [], stepFailures: [], ran: !!text };
  if (!text) return out;
  let dev = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(/^(\S+)\s+scrollWidth\/clientWidth\s+(\d+)\/(\d+)\s+errors:\s*(\d+)/);
    if (m) { dev = m[1]; out.devices.push({ name: m[1], sw: +m[2], cw: +m[3], errors: +m[4] }); if (+m[2] > +m[3]) out.overflow.push(m[1] + " (" + m[2] + ">" + m[3] + ")"); continue; }
    const e = raw.match(/^\s{2,}(step .+|console: .+|pageerror: .+)$/);
    if (e) { const msg = e[1].trim(); (msg.startsWith("step ") ? out.stepFailures : out.errors).push((dev || "?") + ": " + msg); } // שגיאות של מכשיר מודפסות אחרי שורת המכשיר
  }
  return out;
}
export const uxProblems = (ux) => {
  const p = [];
  if (!ux || !ux.ran) return p;
  if (!ux.devices.length) p.push("בדיקת ה-UX לא הצליחה לרוץ");
  ux.stepFailures.forEach((s) => p.push("UX כשל בשלב – " + s));
  ux.errors.slice(0, 6).forEach((s) => p.push("UX שגיאת קונסולה – " + s));
  if (ux.errors.length > 6) p.push("UX ועוד " + (ux.errors.length - 6) + " שגיאות קונסולה");
  ux.overflow.forEach((s) => p.push("UX גלילה אופקית ב-" + s));
  return p;
};

// ───────── בחירת מצב אוטומטית ─────────
// סיכום בוקר: כשהשעה בישראל 08:00-11:59 ועוד לא נשלח סיכום היום (עמיד לעיכובי cron של GitHub; ה-workflow רץ ב-05:00 וגם ב-06:00 UTC).
export function pickMode({ prev, force = false, now = new Date() }) {
  if (force) return "summary";
  const il = israelNow(now), hour = +il.slice(11, 13), today = il.slice(0, 10);
  return hour >= 8 && hour < 12 && (!prev || prev.lastSummaryDate !== today) ? "summary" : "check";
}

// ───────── החלטה: האם לשלוח ─────────
// prev: {status:"ok"|"bad", problems:[], since} או null. מחזיר {send, text, state}
export function decide({ prev, problems, mode, summary, now = new Date() }) {
  const status = problems.length ? "bad" : "ok";
  const was = prev && prev.status === "bad" ? "bad" : "ok";
  const state = { status, problems, since: prev && prev.status === status ? prev.since : now.toISOString(), checkedAt: now.toISOString() };
  let text = null;
  if (mode === "summary") {
    text = status === "ok" ? "✅ " + summary : buildBad(problems, "🔴 בוקר טוב, יש בעיות בלוח שידורים");
  } else if (status === "bad" && was === "ok") {
    text = buildBad(problems, "🔴 נמצאו בעיות בלוח שידורים");
  } else if (status === "ok" && was === "bad") {
    text = "🟢 התקלה נפתרה · " + summary;
  }
  return { send: text != null, text, state };
}
function buildBad(problems, head) {
  return [line("<b>" + escapeHtml(head) + "</b>"), ...problems.map((p) => line("• " + escapeHtml(p)))].join("\n");
}
// טקסט HTML לשליחה: סיכום תקין מקבל גם שורת UX
export function formatText(text) {
  if (!text) return text;
  return text.split("\n").map((l) => (l.startsWith(RLM) ? l : line(l))).join("\n").replace(/^(‏)(✅|🟢)/, "$1$2");
}

// ───────── טלגרם ─────────
export async function sendMessage({ token, chat, text, fetchFn = fetch }) {
  const r = await fetchFn("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return r.ok;
}
export async function sendPhoto({ token, chat, file, caption, fetchFn = fetch }) {
  const fd = new FormData();
  fd.append("chat_id", chat); fd.append("caption", caption.slice(0, 900)); fd.append("parse_mode", "HTML");
  fd.append("photo", new Blob([fs.readFileSync(file)], { type: "image/png" }), path.basename(file));
  const r = await fetchFn("https://api.telegram.org/bot" + token + "/sendPhoto", { method: "POST", body: fd });
  return r.ok;
}

// ───────── CLI ─────────
async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
  if (process.argv.includes("--print-mode")) { console.log(pickMode({ prev: readJson(arg("--state") || "monitor-state.json"), force: process.argv.includes("--force") })); return; }
  const mode = arg("--mode") || "check";
  const health = readJson(arg("--health") || "health.json") || { ok: false, problems: ["אין תוצאת בדיקת בריאות (health.json חסר)"], info: {} };
  const statePath = arg("--state") || "monitor-state.json";
  const prev = readJson(statePath);
  const uxText = arg("--ux") && fs.existsSync(arg("--ux")) ? fs.readFileSync(arg("--ux"), "utf8") : "";
  const ux = parseUx(uxText);
  const problems = [...health.problems, ...uxProblems(ux)];
  let summary = health.ok ? summaryLine(health) : "";
  if (ux.ran && ux.devices.length && !uxProblems(ux).length) summary += " · UX תקין (" + ux.devices.length + " מכשירים)";
  const d = decide({ prev, problems, mode, summary });
  d.state.lastSummaryDate = mode === "summary" ? israelNow().slice(0, 10) : prev && prev.lastSummaryDate;
  fs.writeFileSync(statePath, JSON.stringify(d.state, null, 1));
  console.log("status:", d.state.status, "| prev:", prev ? prev.status : "none", "| mode:", mode, "| send:", d.send, "| problems:", problems.length);
  if (!d.send) return;
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  const text = formatText(d.text);
  if (!token || !chat) { console.log("אין TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID – מדלג על שליחה. הטקסט היה:\n" + text); return; }
  try {
    const ok = await sendMessage({ token, chat, text });
    console.log("telegram message:", ok ? "sent" : "FAILED");
    // צילום מסך רק כשה-UX נכשל
    const shots = arg("--shots");
    if (ok && shots && uxProblems(ux).length && fs.existsSync(shots)) {
      const bad = ux.devices.find((x) => x.errors > 0 || x.sw > x.cw) || ux.devices[0];
      const files = fs.readdirSync(shots).filter((f) => bad && f.startsWith(bad.name + "_") && f.endsWith(".png")).sort();
      for (const f of [files[0], files.find((x) => /05_settings_top|02_tab_grid/.test(x))].filter(Boolean).slice(0, 2)) {
        console.log("telegram photo", f, (await sendPhoto({ token, chat, file: path.join(shots, f), caption: escapeHtml(bad.name + " · " + f) })) ? "sent" : "FAILED");
      }
    }
  } catch (e) { console.log("שליחת טלגרם נכשלה:", String(e.message).replace(token, "***")); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { await main(); process.exit(0); }
