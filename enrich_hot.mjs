// מוסיף תקצירים מלוח השידורים של HOT (כ-200 ערוצים, 4 ימים קדימה) לכל ערוץ בלוח שעדיין אין לו תקציר.
// אין צורך במיפוי שמות: לכל ערוץ של וואלה מוצאים את ערוץ HOT שהלוח שלו הכי דומה (אותן תוכניות באותן שעות).
// הרצה: node enrich_hot.mjs   (אחרון מבין שלבי התקצירים). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";

const API = "https://www.hot.net.il/HotCmsApiFront/api/ProgramsSchedual/GetProgramsSchedual";
const HEADERS = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he", "content-type": "application/json", referer: "https://www.hot.net.il/heb/TV/TVGuide/" };

const toMin = (s) => Date.parse(s.slice(0, 16) + ":00Z") / 60000;
const key = (x) => String(x).replace(/\(ש\.?ח\.?\)|^ישיר!?\s*/g, "").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 12);
export function cleanSyn(s) { return String(s || "").replace(/\((ש\.?ח\.?|כת'? ?סמויות|כ' ?עב')\)/g, "").replace(/\s+/g, " ").trim(); }

// "2026/10/27 02:00:00" → "2026-10-27T02:00"
export function parseHot(j) {
  return ((j && j.data && j.data.programsDetails) || []).map((x) => ({
    ch: String(x.channelID), title: String(x.programTitle || "").trim(), desc: cleanSyn(x.synopsis),
    start: String(x.programStartTime || "").replace(/\//g, "-").replace(" ", "T").slice(0, 16),
  })).filter((x) => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(x.start));
}

export function enrich(guide, hot) {
  // אינדקס: מפתח שם + דקה → ערוצי HOT
  const idx = new Map(), byCh = new Map();
  for (const h of hot) {
    const k = key(h.title) + "|" + toMin(h.start);
    if (!idx.has(k)) idx.set(k, new Set()); idx.get(k).add(h.ch);
    if (!byCh.has(h.ch)) byCh.set(h.ch, []); byCh.get(h.ch).push(h);
  }
  const progs = new Map();
  for (const p of guide.programs) { if (!progs.has(p.ch)) progs.set(p.ch, []); progs.get(p.ch).push(p); }
  let n = 0, matched = 0;
  for (const [ch, list] of progs) {
    const inRange = list.filter((p) => byCh.size && p.start >= hot[0].start.slice(0, 10));
    if (inRange.length < 6 || list.every((p) => p.desc)) continue;
    const score = new Map();
    for (const p of inRange) {
      const k = key(p.title), t = toMin(p.start), seen = new Set();
      for (let d = -5; d <= 5; d++) for (const c of idx.get(k + "|" + (t + d)) || []) if (!seen.has(c)) { seen.add(c); score.set(c, (score.get(c) || 0) + 1); }
    }
    let best = null, bs = 0;
    for (const [c, s] of score) if (s > bs) { bs = s; best = c; }
    if (!best || bs < 5 || bs < inRange.length * 0.3) continue;
    matched++;
    const hs = byCh.get(best);
    for (const p of list) {
      if (p.desc) continue;
      const t = toMin(p.start), k = key(p.title); let pick = null, pd = 16;
      for (const h of hs) { const d = Math.abs(toMin(h.start) - t) - (key(h.title) === k ? 10 : 0); if (d < pd) { pd = d; pick = h; } }
      if (!pick || !pick.desc || pick.desc.length < 12) continue;
      p.desc = pick.desc; n++;
    }
  }
  return { matched, n };
}

async function main() {
  const now = new Date(), end = new Date(now.getTime() + 7 * 864e5), iso = (d) => d.toISOString().slice(0, 10);
  const res = await fetch(API, { method: "POST", headers: HEADERS, body: JSON.stringify({ ProgramsStartDateTime: iso(now) + "T00:00:00", ProgramsEndDateTime: iso(end) + "T23:59:59" }) });
  if (!res.ok) throw new Error(`hot → ${res.status}`);
  const hot = parseHot(await res.json()).sort((a, b) => (a.start < b.start ? -1 : 1));
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const r = enrich(guide, hot);
  console.log(`HOT: ${hot.length} תוכניות באתר, ${r.matched} ערוצים הותאמו, ${r.n} תוכניות קיבלו תקציר`);
  if (r.n) await writeFile("guide.json", JSON.stringify(guide));
}

if (process.argv[1] && process.argv[1].endsWith("enrich_hot.mjs")) {
  main().catch((e) => { console.error("enrich_hot:", e.message); process.exit(0); });
}
