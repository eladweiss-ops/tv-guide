// מוסיף תקצירים לתוכניות של קשת 12, מלוח השידורים של mako (שבוע קדימה, תקציר לכל תוכנית).
// הרצה: node enrich_keshet.mjs   (אחרי scrape.mjs). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";

const API = "https://www.mako.co.il/AjaxPage?jspName=EPGResponse.jsp";
const HEADERS = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he", referer: "https://www.mako.co.il/tv-tv-schedule" };

const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const local = (ms) => fmt.format(new Date(ms)).replace(" ", "T");
const toMin = (s) => Date.parse(s + ":00Z") / 60000;
const key = (x) => String(x).replace(/[^\p{L}\p{N}]/gu, "");

export function parseEpg(j) {
  return (j && j.programs || []).map((x) => ({ start: local(x.StartTimeUTC), title: String(x.ProgramName || "").trim(), desc: String(x.EventDescription || "").replace(/\s+/g, " ").trim() }))
    .filter((x) => x.start && x.desc);
}

export function enrich(guide, items) {
  const ids = new Set(guide.channels.filter((c) => /^(ערוץ\s+)?קשת( 12)?( hd)?$/i.test(String(c.name).trim())).map((c) => String(c.id)));
  let n = 0;
  for (const p of guide.programs) {
    if (!ids.has(String(p.ch)) || p.desc) continue;
    const t = toMin(p.start); let best = null, bd = 11;
    for (const it of items) { const d = Math.abs(toMin(it.start) - t); if (d < bd) { bd = d; best = it; } }
    if (!best || key(best.desc) === key(p.title)) continue;
    p.desc = best.desc; n++;
  }
  return { ids: [...ids], n };
}

async function main() {
  const res = await fetch(API, { headers: HEADERS });
  if (!res.ok) throw new Error(`mako → ${res.status}`);
  const items = parseEpg(await res.json());
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const r = enrich(guide, items);
  console.log(`קשת 12: ${items.length} תוכניות באתר, ${r.n} עודכנו (ערוצים: ${r.ids.join(",") || "לא נמצא"})`);
  if (r.n) await writeFile("guide.json", JSON.stringify(guide));
}

if (process.argv[1] && process.argv[1].endsWith("enrich_keshet.mjs")) {
  main().catch((e) => { console.error("enrich_keshet:", e.message); process.exit(0); });
}
