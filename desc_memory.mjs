// זיכרון תקצירים: משלים תקציר לתוכנית בלי תקציר (בעיקר ימים 4–9, ש-HOT לא מכסה) לפי מה שנראה באותו ערוץ בשבועות הקודמים.
// כללי בטיחות (CLAUDE.md §4: "העתקת תקציר לפי שם"):
//   - רק באותו ערוץ ולפי שם זהה בדיוק. אף פעם לא לפי קרבת זמן.
//   - רק כשהשם נראה עם אותו תקציר בדיוק ב-2 ימים שונים לפחות, ואף פעם לא עם תקציר אחר (שם עם תקצירים שונים, כמו "NBA" או פרקי סדרה, נפסל לתמיד).
//   - רשומה שלא נראתה 30 יום נמחקת.
// קלט/פלט: guide.json (משלים במקום) ו-desc-memory.json (נשמר במאגר, מתעדכן בכל הרצה לילית). יוצא תמיד 0.
import fs from "fs";

const MEM = "desc-memory.json", KEEP_DAYS = 30, MIN_DAYS = 2;
const ymd = (s) => String(s).slice(0, 10);

export function updateMemory(mem, programs, today) {
  for (const p of programs) {
    if (!p.desc || !p.title) continue;
    const k = p.ch + "|" + p.title, e = mem[k], d = ymd(p.start);
    if (!e) { mem[k] = { d: p.desc, days: [d], last: d }; continue; }
    if (e.x) { e.last = d > e.last ? d : e.last; continue; }            // כבר נפסל
    if (e.d !== p.desc) { mem[k] = { x: 1, last: d > e.last ? d : e.last }; continue; } // תקציר אחר: נפסל
    if (!e.days.includes(d)) { e.days.push(d); e.days.sort(); if (e.days.length > 5) e.days = e.days.slice(-5); }
    if (d > e.last) e.last = d;
  }
  const cut = new Date(Date.parse(today + "T12:00:00Z") - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const k of Object.keys(mem)) if (mem[k].last < cut) delete mem[k];
  return mem;
}

export function applyMemory(mem, programs) {
  let n = 0;
  for (const p of programs) {
    if (p.desc || !p.title) continue;
    const e = mem[p.ch + "|" + p.title];
    if (e && !e.x && e.days.length >= MIN_DAYS) { p.desc = e.d; n++; }
  }
  return n;
}

function main() {
  try {
    const g = JSON.parse(fs.readFileSync("guide.json", "utf8"));
    let mem = {};
    try { mem = JSON.parse(fs.readFileSync(MEM, "utf8")); } catch (e) {}
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem" }).format(new Date());
    updateMemory(mem, g.programs, today);                 // קודם לומדים מהלוח של היום (רק תקצירים אמיתיים)
    const before = g.programs.filter((p) => p.desc).length;
    const n = applyMemory(mem, g.programs);
    fs.writeFileSync("guide.json", JSON.stringify(g));
    fs.writeFileSync(MEM, JSON.stringify(mem));
    console.log(`desc memory: ${Object.keys(mem).length} entries, filled ${n} programs (${before} -> ${before + n} with desc of ${g.programs.length})`);
  } catch (e) { console.log("desc memory skipped:", e.message); }
}
if (process.argv[1] && process.argv[1].endsWith("desc_memory.mjs")) main();
