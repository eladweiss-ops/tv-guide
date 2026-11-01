// archive_past.mjs - ארכיון "שודר": שומר כל יום שעבר כקובץ past/YYYY-MM-DD.json (שבוע אחורה).
// העדכון הלילי בונה את guide.json מחדש ומאבד את הימים שעברו, ולכן זה רץ ראשון, על guide.json הקודם.
// past/index.json = רשימת הימים שיש להם קובץ (האפליקציה מציגה אותם בפס הימים ומורידה יום רק כשבוחרים בו).
//   node archive_past.mjs            מ-guide.json הנוכחי
//   node archive_past.mjs --from-git גם מגרסאות קודמות של guide.json בהיסטוריה (מילוי חד-פעמי)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const KEEP_DAYS = 7, MIN_PROGRAMS = 1500; // יום חלקי (פחות מזה) לא נשמר

export function ilToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDays(ds, n) { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// מקבץ תוכניות לפי יום, רק ימים שעברו בטווח השמירה
export function byPastDay(guide, today) {
  const from = addDays(today, -KEEP_DAYS), out = {};
  for (const p of (guide && guide.programs) || []) {
    const d = (p.start || "").slice(0, 10);
    if (d >= from && d < today) (out[d] = out[d] || []).push(p);
  }
  return out;
}

// מעדכן את התיקייה: יום נכתב רק אם הוא שלם יותר ממה שכבר שמור. מוחק ימים ישנים. מחזיר את רשימת הימים
export function archive(dir, guides, today) {
  fs.mkdirSync(dir, { recursive: true });
  const from = addDays(today, -KEEP_DAYS), wrote = [];
  for (const g of guides) {
    const days = byPastDay(g, today);
    for (const d of Object.keys(days)) {
      const list = days[d]; if (list.length < MIN_PROGRAMS) continue;
      const f = path.join(dir, d + ".json");
      let old = 0; try { old = JSON.parse(fs.readFileSync(f, "utf8")).programs.length; } catch (e) {}
      if (list.length > old) { fs.writeFileSync(f, JSON.stringify({ day: d, programs: list })); wrote.push(d + ":" + list.length); }
    }
  }
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && m[1] < from) fs.unlinkSync(path.join(dir, f));
  }
  const kept = fs.readdirSync(dir).map((f) => (f.match(/^(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort();
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ days: kept }));
  return { wrote, kept };
}

function gitGuides(since) {
  const shas = execFileSync("git", ["log", "--since=" + since, "--format=%h", "--", "guide.json"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const out = [];
  for (const s of shas) { try { out.push(JSON.parse(execFileSync("git", ["show", s + ":guide.json"], { encoding: "utf8", maxBuffer: 64 << 20 }))); } catch (e) {} }
  return out;
}

function main() {
  const today = ilToday(), guides = [];
  try { guides.push(JSON.parse(fs.readFileSync("guide.json", "utf8"))); } catch (e) { console.log("archive_past: אין guide.json"); }
  if (process.argv.includes("--from-git")) guides.push(...gitGuides((KEEP_DAYS + 2) + " days ago"));
  const r = archive("past", guides, today);
  console.log("archive_past: נכתבו " + (r.wrote.join(", ") || "0") + " · בארכיון: " + r.kept.join(" "));
}

if (process.argv[1] && process.argv[1].endsWith("archive_past.mjs")) { try { main(); } catch (e) { console.log("archive_past נכשל: " + e.message); } process.exitCode = 0; }
