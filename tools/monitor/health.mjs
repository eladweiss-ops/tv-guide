#!/usr/bin/env node
/*
 * בדיקת בריאות טכנית של "לוח שידורים" (אתר חי + שרת + נתונים). Node 22, בלי תלויות.
 *   node tools/monitor/health.mjs [--out health.json] [--base URL] [--server URL]
 * מדפיס JSON (stdout) + סיכום בעברית (stderr). יוצא תמיד עם 0 – הדיווח הוא דרך טלגרם (notify.mjs), לא דרך קוד יציאה.
 * קריאות לשרת הן GET בלבד. אף פעם לא כותבים.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ───────── ספים (לשנות כאן בלבד) ─────────
export const T = {
  GUIDE_MAX_AGE_H: 30,        // guide.json.updated – הפעולה הלילית רצה כל 24 ש', 30 נותן מרווח לשעות איחור
  NETFLIX_MAX_AGE_H: 36,
  NETFLIX_MIN_ITEMS: 40,
  MIN_PROGRAMS: 20000,        // סה״כ תוכניות (בפועל ~29.7K)
  MIN_CHANNELS: 120,          // בפועל 169
  MIN_SYNOPSIS_PCT: 35,       // % תוכניות עם תקציר (ראו פלט אמיתי בדוח)
  EXTRA_CACHE_MAX_AGE_H: 48,  // extra-cache.json: x14 .at (המחשב בבית)
  HOT_SAMPLE: 8,              // כמה ערוצי HOT לדגום
  HOT_SAMPLE_MIN_OK: 0.5,     // חלק מהדגימה שחייב להיות עם תוכניות היום
};
// HOT cache: הערך האחרון חייב להיות מהיום (שעון ישראל) ומעלה.
// ערוצים מרכזיים: התאמה לפי שם (כמו באפליקציה, אחרי ניקוי HD/SD). minDays = כמה ימים קדימה (כולל היום) חייבים להיות עם תוכניות.
// shabbat: ערוץ ששובת – שבת (ורק שבת) בלי תוכניות היא תקינה. ערוץ 14: שישי ~16:00 עד מוצ״ש.
export const KEY_CHANNELS = [
  { label: "כאן 11", test: (n) => /^כאן(\s|$)/.test(n) && !/חינוכית/.test(n), minDays: 4 },
  { label: "קשת 12", test: (n) => /^קשת/.test(n), minDays: 4 },
  { label: "רשת 13", test: (n) => /^רשת/.test(n), minDays: 4 },
  { label: "ערוץ 14", test: (n) => /^ערוץ 14$/.test(n), minDays: 5, shabbat: true },
  { label: "i24NEWS", test: (n) => /^i24news$/i.test(n), minDays: 4 },
  { label: "ערוץ הכנסת", test: (n) => /^ערוץ הכנסת$/.test(n), minDays: 4 },
  { label: "כאן חינוכית", test: (n) => /^כאן חינוכית$/.test(n), minDays: 2 },
  { label: "ספורט 1", test: (n) => /^ספורט 1(\s|$)/.test(n), minDays: 4 },
  { label: "ספורט 5", test: (n) => /^ספורט 5/.test(n), minDays: 4 },
];
const SITE = "https://eladweiss-ops.github.io/tv-guide/";
const SERVER = "https://tv-guide-cal.vercel.app";

// ───────── עזרים ─────────
export function israelNow(d = new Date()) { // "YYYY-MM-DD HH:MM"
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
export const addDays = (ymd, n) => new Date(Date.parse(ymd + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const dow = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay(); // 0=א׳ … 6=שבת
const hoursSince = (iso, now) => (now.getTime() - Date.parse(iso)) / 36e5;
const cleanName = (n) => String(n || "").replace(/\s*[-–]?\s*(\(copy\)|משוכפל)/ig, "").replace(/\s+f?hd(?=\s|$)/ig, "").replace(/^hd\s+/i, "").replace(/\s+חדש$/, "").replace(/\s+/g, " ").trim();
const fmtAge = (h) => (h >= 48 ? Math.round(h / 24) + " ימים" : Math.round(h) + " שעות");
const dm = (ymd) => ymd.slice(5).split("-").reverse().join(".");

// ───────── לוגיקה טהורה (נבדקת ב-health.test.mjs) ─────────
export function evaluateGuide(guide, now = new Date()) {
  const problems = [], info = {};
  const today = israelNow(now).slice(0, 10);
  const progs = (guide && guide.programs) || [], chans = (guide && guide.channels) || [];
  info.programs = progs.length; info.channels = chans.length;
  if (!guide || !guide.updated) problems.push("guide.json: אין שדה updated");
  else {
    const age = hoursSince(guide.updated, now); info.guideAgeH = Math.round(age * 10) / 10;
    if (!(age < T.GUIDE_MAX_AGE_H)) problems.push("הלוח לא התעדכן " + fmtAge(age) + " (מותר עד " + T.GUIDE_MAX_AGE_H + " שעות)");
  }
  if (progs.length < T.MIN_PROGRAMS) problems.push("מעט מדי תוכניות בלוח: " + progs.length + " (מינימום " + T.MIN_PROGRAMS + ")");
  if (chans.length < T.MIN_CHANNELS) problems.push("מעט מדי ערוצים: " + chans.length + " (מינימום " + T.MIN_CHANNELS + ")");
  const withDesc = progs.filter((p) => p.desc).length;
  info.synopsisPct = progs.length ? Math.round((withDesc / progs.length) * 1000) / 10 : 0;
  if (info.synopsisPct < T.MIN_SYNOPSIS_PCT) problems.push("רק " + info.synopsisPct + "% מהתוכניות עם תקציר (מינימום " + T.MIN_SYNOPSIS_PCT + "%)");

  const byCh = new Map();
  for (const p of progs) { let m = byCh.get(p.ch); if (!m) byCh.set(p.ch, m = {}); const d = p.start.slice(0, 10); m[d] = (m[d] || 0) + 1; }
  info.days = new Set(progs.map((p) => p.start.slice(0, 10)).filter((d) => d >= today)).size;
  info.channelsReport = {};
  for (const k of KEY_CHANNELS) {
    const ids = chans.filter((c) => k.test(cleanName(c.name))).map((c) => c.id);
    if (!ids.length) { problems.push(k.label + ": הערוץ לא נמצא בלוח"); info.channelsReport[k.label] = { found: false }; continue; }
    // כמה מזהים יכולים להתאים (SD/HD): יום נחשב "עם נתונים" אם לפחות אחד מהם עם תוכניות
    const dayCount = (d) => Math.max(...ids.map((id) => (byCh.get(id) || {})[d] || 0));
    const missing = [], counts = {};
    for (let i = 0; i < k.minDays; i++) {
      const d = addDays(today, i); counts[d] = dayCount(d);
      if (counts[d] === 0 && !(k.shabbat && dow(d) === 6)) missing.push(d);
    }
    info.channelsReport[k.label] = { found: true, today: counts[today] || 0, days: counts, missing };
    if (missing.length) problems.push(k.label + ": אין תוכניות ב-" + missing.length + " מתוך " + k.minDays + " הימים הקרובים (" + missing.map(dm).join(", ") + ")");
  }
  const hot = chans.filter((c) => /^HOT\s/i.test(c.name)).slice(0, T.HOT_SAMPLE);
  if (hot.length) {
    const ok = hot.filter((c) => ((byCh.get(c.id) || {})[today] || 0) > 0).length;
    info.hotSample = { ok, of: hot.length };
    if (ok / hot.length < T.HOT_SAMPLE_MIN_OK) problems.push("ערוצי HOT: רק " + ok + " מתוך " + hot.length + " בדגימה עם תוכניות היום");
  }
  return { problems, info };
}

export function evaluateNetflix(nf, now = new Date()) {
  const problems = [], info = {};
  if (!nf) return { problems: ["netflix.json לא נטען"], info };
  if (nf.v !== 2) problems.push("netflix.json: גרסה " + nf.v + " במקום 2");
  const list = nf.items ? (Array.isArray(nf.items) ? nf.items : Object.values(nf.items)) : [];
  info.items = list.length;
  if (list.length < T.NETFLIX_MIN_ITEMS) problems.push("נטפליקס: " + list.length + " פריטים (מינימום " + T.NETFLIX_MIN_ITEMS + ")");
  if (nf.updated) { const age = hoursSince(nf.updated, now); info.ageH = Math.round(age * 10) / 10; if (!(age < T.NETFLIX_MAX_AGE_H)) problems.push("נטפליקס לא התעדכן " + fmtAge(age)); }
  else problems.push("netflix.json: אין שדה updated");
  info.rated = list.filter((i) => i && (i.rating != null || i.vote > 0)).length; // מידע בלבד
  return { problems, info };
}

export function evaluateCaches(hot, extra, now = new Date()) {
  const problems = [], info = {};
  const today = israelNow(now).slice(0, 10);
  let newest = "";
  for (const k in hot || {}) { const s = k.slice(k.indexOf("|") + 1); if (s > newest) newest = s; }
  info.hotNewest = newest;
  if (!newest) problems.push("hot-cache.json ריק");
  else if (newest.slice(0, 10) < today) problems.push("המחשב בבית לא עדכן את HOT מאז " + dm(newest.slice(0, 10)));
  const x14 = extra && extra.x14 && extra.x14.at;
  info.x14At = x14 || null;
  if (!x14) problems.push("המחשב בבית לא עדכן את ערוץ 14 (אין חותמת זמן)");
  else {
    const age = hoursSince(x14, now); info.x14AgeH = Math.round(age * 10) / 10;
    if (!(age < T.EXTRA_CACHE_MAX_AGE_H)) problems.push("המחשב בבית לא עדכן את ערוץ 14/HOT מאז " + new Date(x14).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }));
  }
  return { problems, info };
}

export function parseSiteFiles(indexHtml) {
  const build = (indexHtml.match(/BUILD\s*=\s*"([^"]+)"/) || [])[1] || null;
  const m = indexHtml.match(/TVG\.list\s*=\s*\[([^\]]*)\]/);
  const files = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  return { build, files };
}

// ───────── רשת ─────────
async function get(fetchFn, url) {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20000);
  try { return await fetchFn(url, { signal: ac.signal, redirect: "follow" }); } finally { clearTimeout(to); }
}
const rnd = (n) => { const c = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };

export async function runHealth({ base = SITE, server = SERVER, fetchFn = fetch, now = new Date() } = {}) {
  const problems = [], info = {}, nb = "nocache=" + now.getTime();
  const check = async (label, url, okFn) => {
    try {
      const r = await get(fetchFn, url);
      if (r.status !== 200) { problems.push(label + ": HTTP " + r.status); return null; }
      if (okFn && !(await okFn(r))) return null;
      return r;
    } catch (e) { problems.push(label + ": " + (e.name === "AbortError" ? "תם הזמן" : e.message)); return null; }
  };
  const json = async (label, url) => { const r = await check(label, url); if (!r) return null; try { return await r.json(); } catch { problems.push(label + ": JSON לא תקין"); return null; } };

  let site = { build: null, files: [] };
  try {
    const r = await get(fetchFn, base + "index.html?" + nb);
    if (r.status !== 200) problems.push("index.html: HTTP " + r.status);
    else {
      site = parseSiteFiles(await r.text());
      if (!site.build) problems.push("index.html: לא נמצא BUILD");
      if (!site.files.length) problems.push("index.html: לא נמצאה רשימת קבצי js");
    }
  } catch (e) { problems.push("index.html: " + e.message); }
  info.build = site.build;
  if (site.build) {
    const v = "?v=" + site.build;
    const urls = ["css/app.css" + v, ...site.files.map((f) => "js/" + f + ".js" + v), "sw.js", "manifest.webmanifest", "badge-96.png"];
    await Promise.all(urls.map((u) => check(u.split("?")[0], base + u)));
    info.assets = urls.length;
  }
  const guide = await json("guide.json", base + "guide.json?" + nb);
  if (guide) { const g = evaluateGuide(guide, now); problems.push(...g.problems); info.guide = g.info; }
  const nf = await json("netflix.json", base + "netflix.json?" + nb);
  if (nf) { const n = evaluateNetflix(nf, now); problems.push(...n.problems); info.netflix = n.info; }
  const hot = await json("hot-cache.json", base + "hot-cache.json?" + nb);
  const extra = await json("extra-cache.json", base + "extra-cache.json?" + nb);
  if (hot && extra) { const c = evaluateCaches(hot, extra, now); problems.push(...c.problems); info.caches = c.info; }
  // שרת – GET בלבד
  await check("/api/push", server + "/api/push", async (r) => { const j = await r.json().catch(() => null); if (!j || j.scheduler !== true) { problems.push("/api/push: ה-scheduler אינו פעיל"); return false; } return true; });
  await check("/api/rems", server + "/api/rems?t=" + rnd(30), async (r) => { const j = await r.json().catch(() => null); if (!j || !Array.isArray(j.rems) || j.rems.length) { problems.push("/api/rems: תשובה לא צפויה"); return false; } return true; });
  await check("/cal/*.ics", server + "/cal/" + rnd(30) + ".ics", async (r) => { if (!/text\/calendar/i.test(r.headers.get("content-type") || "")) { problems.push("/cal/*.ics: סוג התוכן אינו text/calendar"); return false; } return true; });

  return { ok: problems.length === 0, at: now.toISOString(), problems, info };
}

export function summaryLine(res) {
  const g = (res.info && res.info.guide) || {}, rep = g.channelsReport || {}, n = (res.info && res.info.netflix) || {};
  const c14 = rep["ערוץ 14"];
  return "הכול תקין · " + (g.programs || 0).toLocaleString("en-US") + " תוכניות · " + (g.days || 0) + " ימים · " +
    (c14 && c14.found && !(c14.missing || []).length ? "ערוץ 14 תקין" : "ערוץ 14: בעיה") + " · נטפליקס " + (n.items || 0);
}

// ───────── CLI ─────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  let res;
  try { res = await runHealth({ base: arg("--base") || SITE, server: arg("--server") || SERVER }); }
  catch (e) { res = { ok: false, at: new Date().toISOString(), problems: ["בדיקת הבריאות עצמה קרסה: " + e.message], info: {} }; }
  const out = JSON.stringify(res, null, 2);
  if (arg("--out")) fs.writeFileSync(arg("--out"), out);
  console.log(out);
  console.error(res.ok ? "🟢 " + summaryLine(res) : "🔴 " + res.problems.length + " בעיות:\n- " + res.problems.join("\n- "));
  process.exit(0);
}
