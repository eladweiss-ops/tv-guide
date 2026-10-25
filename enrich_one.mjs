// מוסיף לתוכניות של ערוץ ONE ו-ONE2 את שם המשחק, מלוח השידורים באתר ONE.
// וואלה כותבת למשל "ל. ספרדית 2026/27", ובאתר: "ליגה ספרדית: ברצלונה - ריאל מדריד".
// הרצה: node enrich_one.mjs   (אחרי scrape.mjs). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";

const API = "https://www.one.co.il/api/tv-schedule/";
const HEADERS = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he", referer: "https://www.one.co.il/broadcasts" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "ערוץ ONE" → "1", "ערוץ ONE2" / "ONE 2 HD" → "2"
export function oneNo(name) {
  const n = String(name).trim();
  if (/^(ערוץ\s+)?one\s*2(\s|$|hd)/i.test(n)) return "2";
  if (/^(ערוץ\s+)?one(\s+hd)?$/i.test(n)) return "1";
  return "";
}

const mins = (s) => Date.parse(s.slice(0, 16) + ":00Z") / 60000;
const key = (x) => String(x).replace(/^ישיר!?\s*/, "").replace(/[^\p{L}\p{N}]/gu, "");

// items: [{ch:"1"|"2", start:"YYYY-MM-DDTHH:MM", name}] — כל משבצת באתר הולכת לתוכנית הכי קרובה (עד 20 דקות)
export function enrich(guide, items) {
  const chOf = new Map(guide.channels.map((c) => [String(c.id), oneNo(c.name)]).filter((x) => x[1]));
  const byCh = new Map();
  for (const p of guide.programs) { const c = chOf.get(String(p.ch)); if (!c) continue; if (!byCh.has(p.ch)) byCh.set(p.ch, { c, progs: [] }); byCh.get(p.ch).progs.push(p); }
  let n = 0;
  for (const { c, progs } of byCh.values()) {
    const pick = new Map();
    for (const it of items) {
      if (it.ch !== c) continue;
      let bp = null, bd = 21;
      for (const p of progs) { const d = Math.abs(mins(it.start) - mins(p.start)); if (d < bd) { bd = d; bp = p; } }
      if (bp && (!pick.has(bp) || pick.get(bp).d > bd)) pick.set(bp, { it, d: bd });
    }
    for (const [p, { it }] of pick) {
      if (p.desc || key(it.name).startsWith(key(p.title)) || key(p.title).startsWith(key(it.name))) continue;
      p.desc = it.name; n++;
    }
  }
  return n;
}

async function main() {
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const days = [...new Set(guide.programs.map((p) => p.start.slice(0, 10)))].sort().slice(0, 8);
  const items = []; let ok = 0, fail = 0;
  for (const day of days) {
    const [y, m, d] = day.split("-");
    try {
      const res = await fetch(API + `${d}-${m}-${y}`, { headers: HEADERS });
      if (!res.ok) throw new Error(String(res.status));
      for (const x of await res.json()) { const c = oneNo(x.channel); if (c && x.time && x.name) items.push({ ch: c, start: String(x.time).slice(0, 16), name: String(x.name).trim() }); }
      ok++;
    } catch (e) { fail++; if (fail === 1) console.error("one:", e.message); }
    await sleep(300);
  }
  const n = enrich(guide, items);
  console.log(`ONE: ${ok} ימים נקראו, ${fail} נכשלו, ${items.length} משבצות באתר, ${n} תוכניות קיבלו פירוט`);
  if (n) await writeFile("guide.json", JSON.stringify(guide));
}

if (process.argv[1] && process.argv[1].endsWith("enrich_one.mjs")) {
  main().catch((e) => { console.error("enrich_one:", e.message); process.exit(0); });
}
