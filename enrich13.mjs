// מוסיף תקצירים לתוכניות של רשת 13 ב-guide.json, מהלוח הרשמי באתר הערוץ.
// הרצה: node enrich13.mjs   (אחרי scrape.mjs). אם האתר לא נגיש, guide.json נשאר כמו שהוא.
import { readFile, writeFile } from "node:fs/promises";
import { fillGaps } from "./fill.mjs";

const URL13 = "https://13tv.co.il/tv-guide/";

// שם בלי "- ש.ח", סימני פיסוק ורווחים, כדי להתאים בין וואלה לאתר של רשת 13
export function norm(t) {
  return String(t || "")
    .replace(/[-–]\s*ש\.?\s*ח\.?\s*$/u, "")
    .replace(/\(ש\.?ח\.?\)/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// שולף את הלוח מה-HTML של העמוד (Next.js שומר את הנתונים בתג __NEXT_DATA__)
export function parseWeek(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("__NEXT_DATA__ not found");
  const data = JSON.parse(m[1]);
  const grid = data?.props?.pageProps?.page?.Content?.PageGrid;
  const week = (Array.isArray(grid) ? grid : []).map((g) => g?.broadcastWeek).find(Array.isArray);
  if (!week) throw new Error("broadcastWeek not found");
  return week;
}

// תיאורים כלליים של האתר (לא של התוכנית) לא נכנסים
const GENERIC = /LIVE|VOD|אתר תוכניות הטלוויזיה/;

export function descByTitle(week) {
  const map = new Map();
  for (const day of week) {
    for (const s of day.shows || []) {
      const desc = String(s.desc || "").replace(/\s+/g, " ").trim();
      const k = norm(s.title);
      if (k && desc && !GENERIC.test(desc) && !map.has(k)) map.set(k, desc);
    }
  }
  return map;
}

export function enrich(guide, map) {
  const ids = new Set(guide.channels.filter((c) => /^רשת(\s|$)/.test(String(c.name).trim())).map((c) => String(c.id)));
  let n = 0;
  for (const p of guide.programs) {
    if (!ids.has(String(p.ch)) || p.desc) continue;
    const d = map.get(norm(p.title));
    if (d) { p.desc = d; n++; }
  }
  return { ids: [...ids], n };
}

async function main() {
  const res = await fetch(URL13, { headers: { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he" } });
  if (!res.ok) throw new Error(`${URL13} → ${res.status}`);
  const week = parseWeek(await res.text());
  const map = descByTitle(week);
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const items = [];
  for (const day of week) for (const s of day.shows || []) {
    if (!s.show_date || !s.start_time) continue;
    const raw = String(s.title || "").trim(), desc = String(s.desc || "").replace(/\s+/g, " ").trim();
    items.push({ start: s.show_date + "T" + String(s.start_time).padStart(5, "0"), title: raw.replace(/\s*[-–]\s*ש\.?\s*ח\.?\s*$/, ""), desc: GENERIC.test(desc) ? "" : desc, rr: /ש\.?\s*ח\.?\s*$/.test(raw) });
  }
  const ids = guide.channels.filter((c) => /^רשת(\s|$)/.test(String(c.name).trim())).map((c) => c.id);
  const filled = fillGaps(guide, ids, items);
  const r = enrich(guide, map);
  if (filled) console.log(`רשת 13: הושלמו ${filled} שידורים בימים שחסרו בוואלה`);
  console.log(`רשת 13: ${map.size} תקצירים באתר, ${r.n} תוכניות עודכנו (ערוצים: ${r.ids.join(",") || "לא נמצא"})`);
  if (r.n || filled) await writeFile("guide.json", JSON.stringify(guide));
}

if (process.argv[1] && process.argv[1].endsWith("enrich13.mjs")) {
  main().catch((e) => { console.error("enrich13:", e.message); process.exit(0); }); // כישלון לא עוצר את העדכון הלילי
}
