#!/usr/bin/env node
/*
 * התראות טלגרם על תוצאות הניטור. Node 22, בלי תלויות. בטלגרם יש רק ארבעה סוגי הודעות:
 *   🔴 תקלה   – רק במעבר מתקין לתקלה, או כשמתווספת תקלה חדשה (אין הודעת "חזר לתקין"; ההתאוששות מופיעה בסיכום הבא)
 *   ☀️ יומי   – 08:00 ישראל: מצב טכני + UX + מספרים + תקלות שנפתחו/נסגרו ב-24 שעות
 *   📅 שבועי  – יום ראשון בבוקר, במקום היומי
 *   🗓 חודשי  – ב-1 לחודש בבוקר, במקום היומי
 *   node tools/monitor/notify.mjs --print-mode --state S [--force]     (check|daily|weekly|monthly)
 *   node tools/monitor/notify.mjs --health H --state S --mode M [--ux ux.txt] [--shots dir]
 * בלי TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID – לא שולח ולא נכשל.
 *
 * המצב (קובץ --state, ב-actions/cache): { open:{key:{text,since}}, incidents:[…], history:[…], lastSummaryDate }.
 * ההיסטוריה: רשומה לכל ריצה (סטטוס ומספרים מרכזיים), עד 35 ימים (~420 רשומות, כמה עשרות KB).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summaryLine, israelNow, dow, addDays } from "./health.mjs";

const RLM = "‏"; // ‏ – כל שורה מתחילה בו כדי שהודעה עברית תוצג מימין לשמאל גם עם מספרים/לטינית
export const HISTORY_DAYS = 35;
const H = 36e5, DAY = 864e5;

export const escapeHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const line = (s) => RLM + s;

// ───────── ניתוח פלט shoot.cjs ─────────
export function parseUx(text) {
  const out = { devices: [], overflow: [], errors: [], stepFailures: [], ran: !!text, audit: { devices: {}, total: 0, samples: {} } };
  if (!text) return out;
  let dev = null;
  for (const raw of String(text).split(/\r?\n/)) {
    // ביקורת פריסה (tools/qa/audit.cjs): "audit <device> issues: N {...}" ואחריה עד 5 שורות דוגמה "    audit: [type] el <> el - msg @step"
    const am = raw.match(/^audit\s+(\S+)\s+issues:\s*(\d+)/);
    if (am) { dev = am[1]; out.audit.devices[am[1]] = +am[2]; out.audit.total += +am[2]; continue; }
    const as = raw.match(/^\s{2,}audit:\s+(.+)$/);
    if (as) { const d = dev || "?"; (out.audit.samples[d] = out.audit.samples[d] || []).push(as[1].trim()); continue; }
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
  if (!ux.devices.length) p.push("UX: בדיקת ה-UX לא הצליחה לרוץ");
  ux.stepFailures.forEach((s) => p.push("UX כשל בשלב – " + s));
  ux.errors.slice(0, 6).forEach((s) => p.push("UX שגיאת קונסולה – " + s));
  if (ux.errors.length > 6) p.push("UX ועוד שגיאות קונסולה");
  ux.overflow.forEach((s) => p.push("UX גלילה אופקית ב-" + s));
  // ביקורת פריסה: כפתורים צמודים/חופפים, יעד מגע קטן מ-44px, טקסט חתוך. תקלה אדומה לכל מכשיר עם בעיות (רק בריצת הבוקר – שם רץ ה-UX).
  for (const [dev, n] of Object.entries((ux.audit && ux.audit.devices) || {})) if (n > 0) {
    const ex = ((ux.audit.samples || {})[dev] || [])[0];
    p.push("UX ביקורת פריסה ב-" + dev + ": " + n + " בעיות" + (ex ? " (למשל " + ex.replace(/\s*@\S+$/, "").slice(0, 110) + ")" : ""));
  }
  return p;
};

// ───────── זהות תקלה ─────────
// מפתח יציב: בלי מספרים (גיל בשעות, כמויות משתנים) כדי ש"אותה תקלה" לא תיחשב חדשה בכל ריצה.
export const problemKey = (t) => String(t).replace(/\d+([.,]\d+)*/g, "#").replace(/\s+/g, " ").trim();

// ───────── בחירת מצב ─────────
// בין 08:00 ל-11:59 בישראל, פעם ביום (עמיד לעיכובי cron): ב-1 לחודש חודשי, ביום ראשון שבועי, אחרת יומי.
export function pickMode({ prev, force = false, now = new Date() }) {
  const il = israelNow(now), hour = +il.slice(11, 13), today = il.slice(0, 10);
  if (!force && !(hour >= 8 && hour < 12 && (!prev || prev.lastSummaryDate !== today))) return "check";
  if (today.endsWith("-01")) return "monthly";
  if (dow(today) === 0) return "weekly";
  return "daily";
}

// ───────── היסטוריה ─────────
export function makeEntry(health, ux, now) {
  const g = (health.info && health.info.guide) || {}, rep = g.channelsReport || {}, n = (health.info && health.info.netflix) || {}, c = (health.info && health.info.caches) || {};
  const c14 = rep["ערוץ 14"];
  return {
    t: now.toISOString(), ok: health.problems.length === 0 && !uxProblems(ux).length,
    programs: g.programs || 0, syn: g.synopsisPct || 0,
    c14d: c14 && c14.days ? Object.values(c14.days).filter((x) => x > 0).length : 0,
    nf: n.items || 0, nfr: n.rated || 0, x14At: c.x14At || null,
  };
}

// ───────── החלטה ─────────
// problems: כל התקלות הנוכחיות (טכניות + UX). בריצת check ה-UX לא נבדק, ולכן תקלות UX פתוחות נשארות פתוחות.
export function decide({ prev, problems, mode, health, ux, now = new Date() }) {
  const st = { open: {}, incidents: [], history: [], ...(prev || {}) };
  st.open = { ...st.open }; st.incidents = st.incidents.map((i) => ({ ...i })); st.history = st.history.slice();
  const nowIso = now.toISOString();
  const cur = {};
  for (const p of problems) cur[problemKey(p)] = p;
  if (mode === "check") for (const k in st.open) if (/^UX/.test(st.open[k].text) && !(k in cur)) cur[k] = st.open[k].text;
  const fresh = [], closed = [];
  for (const k in cur) if (!(k in st.open)) { fresh.push(cur[k]); st.open[k] = { text: cur[k], since: nowIso }; st.incidents.push({ key: k, text: cur[k], opened: nowIso, closed: null }); }
  for (const k of Object.keys(st.open)) if (!(k in cur)) {
    closed.push(st.open[k].text); delete st.open[k];
    const inc = st.incidents.find((i) => i.key === k && !i.closed); if (inc) inc.closed = nowIso;
  }
  for (const k in cur) st.open[k].text = cur[k]; // נוסח עדכני (מספרים)
  st.history.push(makeEntry({ ...health, problems: Object.values(cur) }, ux, now));
  const cutoff = now.getTime() - HISTORY_DAYS * DAY;
  st.history = st.history.filter((h) => Date.parse(h.t) >= cutoff);
  st.incidents = st.incidents.filter((i) => !i.closed || Date.parse(i.closed) >= cutoff);
  st.status = Object.keys(cur).length ? "bad" : "ok";
  st.checkedAt = nowIso;

  let text = null;
  const all = Object.values(cur);
  if (mode === "check") { if (fresh.length) text = buildAlert(fresh, all.filter((p) => !fresh.includes(p))); }
  else if (mode === "daily") text = buildDaily(st, all, health, ux, now);
  else if (mode === "weekly") text = buildPeriod(st, all, health, ux, now, 7);
  else if (mode === "monthly") text = buildPeriod(st, all, health, ux, now, 30);
  if (mode !== "check") st.lastSummaryDate = israelNow(now).slice(0, 10);
  return { send: text != null, text, state: st };
}

// ───────── נוסחי הודעות ─────────
const bullets = (a) => a.map((p) => line("• " + escapeHtml(p)));
function buildAlert(fresh, still) {
  const out = [line("🔴 <b>תקלה בלוח שידורים</b>"), ...bullets(fresh)];
  if (still.length) out.push(line("עדיין פתוחות:"), ...bullets(still));
  return out.join("\n");
}
export function fmtDur(ms) { const h = ms / H; return h < 1 ? Math.max(1, Math.round(h * 60)) + " דקות" : h < 48 ? Math.round(h) + " שעות" : Math.round(h / 24) + " ימים"; }
function statusBlock(all, health, ux) {
  const out = [];
  if (!all.length) {
    out.push(line("✅ " + escapeHtml(summaryLine(health))));
    out.push(line(ux.ran && ux.devices.length ? "✅ UX תקין · " + ux.devices.length + " מכשירים, בלי שגיאות וגלילה אופקית" + (ux.audit && Object.keys(ux.audit.devices).length ? " · ביקורת פריסה: 0 בעיות" : "") : "UX: לא נבדק"));
  } else {
    out.push(line("🔴 <b>" + all.length + " תקלות פתוחות</b>"), ...bullets(all));
    if (!health.problems.length && !(ux.ran && uxProblems(ux).length)) out.push(line("UX: לא נבדק"));
  }
  return out;
}
function buildDaily(st, all, health, ux, now) {
  const since = now.getTime() - DAY;
  const out = [line("☀️ <b>סיכום יומי · לוח שידורים</b>"), ...statusBlock(all, health, ux)];
  const fixed = st.incidents.filter((i) => i.closed && Date.parse(i.closed) >= since);
  const opened = st.incidents.filter((i) => Date.parse(i.opened) >= since);
  if (fixed.length) out.push(line("✔ תוקן מאז אתמול: " + escapeHtml(fixed.map((i) => i.text.replace(/:.*$/, "")).join(", "))));
  if (opened.length) out.push(line("🆕 נפתחו ב-24 השעות האחרונות: " + opened.length + (fixed.length ? " (מהן " + opened.filter((i) => i.closed).length + " נסגרו)" : "")));
  if (!fixed.length && !opened.length) out.push(line("בלי תקלות חדשות ב-24 השעות האחרונות"));
  return out.join("\n");
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f1 = (x) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toLocaleString("en-US");
function trendLine(label, cur, base, unit = "", baseName = "לפני") {
  if (cur == null) return null;
  if (base == null) return line(label + ": " + f1(cur) + unit + " (אין נתוני השוואה)");
  const d = cur - base, arrow = Math.abs(d) < 0.05 ? "➡️" : d > 0 ? "📈" : "📉";
  if (arrow === "➡️") return line(label + ": " + f1(cur) + unit + " ➡️ ללא שינוי " + baseName);
  return line(label + ": " + f1(cur) + unit + " " + arrow + " " + (d > 0 ? "+" : "") + f1(d) + unit + " " + baseName);
}
export function buildPeriod(st, all, health, ux, now, days) {
  const weekly = days === 7, end = now.getTime(), start = end - days * DAY;
  const inW = st.history.filter((h) => Date.parse(h.t) > start);
  // השוואה: שבועי = השבוע הקודם. חודשי (ההיסטוריה 35 ימים בלבד) = 7 הימים הראשונים בחלון מול 7 האחרונים.
  const cmpCur = weekly ? inW : inW.filter((h) => Date.parse(h.t) >= end - 7 * DAY);
  const cmpBase = weekly ? st.history.filter((h) => Date.parse(h.t) <= start && Date.parse(h.t) > start - 7 * DAY) : inW.filter((h) => Date.parse(h.t) <= start + 7 * DAY);
  const baseName = weekly ? "לעומת השבוע הקודם" : "לעומת תחילת החודש";
  const num = (a, k) => avg(a.map((h) => h[k]));
  const out = [line(weekly ? "📅 <b>סיכום שבועי · לוח שידורים</b>" : "🗓 <b>סיכום חודשי · לוח שידורים</b>")];
  out.push(...statusBlock(all, health, ux));
  const okN = inW.filter((h) => h.ok).length;
  out.push(line("<b>זמינות</b>: " + (inW.length ? f1((okN / inW.length) * 100) + "% (" + okN + " מתוך " + inW.length + " בדיקות)" : "אין נתונים")));
  const incs = st.incidents.filter((i) => !i.closed || Date.parse(i.closed) >= start);
  out.push(line("<b>תקלות</b>: " + (incs.length || "אין")));
  for (const i of incs.slice(0, 8)) out.push(line("• " + escapeHtml(i.text.replace(/:.*$/, "")) + " · " + (i.closed ? fmtDur(Date.parse(i.closed) - Date.parse(i.opened)) : "פתוחה כבר " + fmtDur(end - Date.parse(i.opened)))));
  if (incs.length > 8) out.push(line("• ועוד " + (incs.length - 8)));
  out.push(line("<b>מגמות</b>"));
  const lines = [
    trendLine("תוכניות", num(cmpCur, "programs"), num(cmpBase, "programs"), "", baseName),
    trendLine("תקצירים", num(cmpCur, "syn"), num(cmpBase, "syn"), "%", baseName),
    trendLine("ימי ערוץ 14 בלוח", num(cmpCur, "c14d"), num(cmpBase, "c14d"), "", baseName),
    trendLine("נטפליקס: פריטים עם דירוג", num(cmpCur, "nfr"), num(cmpBase, "nfr"), "", baseName),
  ].filter(Boolean);
  out.push(...(lines.length ? lines : [line("אין נתונים")]));
  const dates = new Set(inW.map((h) => h.x14At && israelNow(new Date(h.x14At)).slice(0, 10)).filter(Boolean));
  const span = new Set(inW.map((h) => israelNow(new Date(h.t)).slice(0, 10))).size;
  out.push(line("<b>המחשב בבית</b>: עדכן ב-" + dates.size + " מתוך " + span + " ימים"));
  return out.join("\n");
}

export const formatText = (text) => (text ? text.split("\n").map((l) => (l.startsWith(RLM) ? l : line(l))).join("\n") : text);

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
  const statePath = arg("--state") || "monitor-state.json";
  const prev = readJson(statePath);
  if (process.argv.includes("--print-mode")) { console.log(pickMode({ prev, force: process.argv.includes("--force") })); return; }
  const mode = arg("--mode") || "check";
  const health = readJson(arg("--health") || "health.json") || { ok: false, problems: ["אין תוצאת בדיקת בריאות (health.json חסר)"], info: {} };
  const uxText = arg("--ux") && fs.existsSync(arg("--ux")) ? fs.readFileSync(arg("--ux"), "utf8") : "";
  const ux = parseUx(uxText);
  const problems = [...health.problems, ...uxProblems(ux)];
  const d = decide({ prev, problems, mode, health, ux });
  fs.writeFileSync(statePath, JSON.stringify(d.state));
  console.log("status:", d.state.status, "| mode:", mode, "| send:", d.send, "| problems:", problems.length, "| history:", d.state.history.length);
  if (!d.send) return;
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  const text = formatText(d.text);
  if (!token || !chat) { console.log("אין TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID – מדלג על שליחה. הטקסט היה:\n" + text); return; }
  try {
    const ok = await sendMessage({ token, chat, text });
    console.log("telegram message:", ok ? "sent" : "FAILED");
    const shots = arg("--shots"); // צילום מסך רק כשה-UX נכשל
    if (ok && shots && uxProblems(ux).length && fs.existsSync(shots)) {
      const bad = ux.devices.find((x) => x.errors > 0 || x.sw > x.cw) || ux.devices[0];
      const files = fs.readdirSync(shots).filter((f) => bad && f.startsWith(bad.name + "_") && f.endsWith(".png")).sort();
      for (const f of [files[0], files.find((x) => /05_settings_top|02_tab_grid/.test(x))].filter(Boolean).slice(0, 2)) {
        console.log("telegram photo", f, (await sendPhoto({ token, chat, file: path.join(shots, f), caption: escapeHtml(bad.name + " · " + f) })) ? "sent" : "FAILED");
      }
    }
  } catch (e) { console.log("שליחת טלגרם נכשלה:", String(e.message).split(token).join("***")); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { await main(); process.exit(0); }
