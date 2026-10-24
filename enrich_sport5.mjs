// מוסיף לתוכניות של ערוצי ספורט 5 את שם המשחק והמסגרת, מהלוח באתר ערוץ הספורט.
// הרצה: node enrich_sport5.mjs   (אחרי scrape.mjs). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";

const API = "https://www.sport5.co.il/Ajax/GetBroadcastSheetData.aspx";
const TYPES = ["5", "5P", "LIVE", "5STARS", "5MAX", "GOLD"];
const HEADERS = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he", referer: "https://www.sport5.co.il/html/pages/broadcastsheet.html" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(s) {
  return String(s || "").replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/''/g, '"').replace(/[‎‏]/g, "")
    .replace(/\s+/g, " ").trim();
}

// מחזיר [{type, time, text}]. type נלקח מכותרת הערוץ בטבלה, ואם אין כותרת מוכרת - מ-defType
const HEAD = [[/^ערוץ הספורט$/, "5"], [/5\+|5 פלוס/, "5P"], [/live/i, "LIVE"], [/stars/i, "5STARS"], [/5\s*max/i, "5MAX"], [/gold|גולד/i, "GOLD"]];
export function parseSheet(html, defType) {
  const out = []; let type = defType;
  for (const tr of html.split(/<tr\b/).slice(1)) {
    if (/class="tr-header"/.test(tr)) {
      const alt = (tr.match(/alt="([^"]*)"/) || [])[1];
      if (alt != null) { const h = HEAD.find((x) => x[0].test(alt.trim())); type = h ? h[1] : null; }
      continue;
    }
    const time = (tr.match(/class="date">\s*<div>\s*(\d{1,2}:\d{2})/) || [])[1];
    const text = clean((tr.match(/class="text">([\s\S]*?)<\/td>/) || [])[1]);
    if (type && time && text) out.push({ type, time: time.padStart(5, "0"), text });
  }
  return out;
}

export function typeOf(name) {
  const n = String(name).trim();
  if (/^ערוץ הספורט$|^ספורט 5( hd)?$/i.test(n)) return "5";
  if (/^ספורט 5\s*(\+|פלוס)/.test(n)) return "5P";
  if (/(sport|ספורט) 5 live/i.test(n)) return "LIVE";
  if (/(sport|ספורט) 5 stars/i.test(n)) return "5STARS";
  if (/5\s*max/i.test(n)) return "5MAX";
  if (/(sport|ספורט) 5 (gold|גולד)/i.test(n)) return "GOLD";
  return "";
}

const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const key = (x) => String(x).replace(/[^\p{L}\p{N}]/gu, "");

export function enrich(guide, sched) { // sched: Map "type|day" -> [{time,text,rich}]
  const chT = new Map(guide.channels.map((c) => [String(c.id), typeOf(c.name)]).filter((x) => x[1]));
  let n = 0;
  for (const p of guide.programs) {
    const ty = chT.get(String(p.ch)); if (!ty || p.desc) continue;
    const items = sched.get(ty + "|" + p.start.slice(0, 10)); if (!items) continue;
    const t = mins(p.start.slice(11, 16));
    let best = null, bd = 21;
    for (const it of items) { const d = Math.abs(mins(it.time) - t); if (d < bd) { bd = d; best = it; } }
    if (!best) continue;
    const text = best.rich || best.text;
    if (key(text).startsWith(key(p.title))) continue;
    p.desc = text; n++;
  }
  return n;
}

async function main() {
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const days = [...new Set(guide.programs.map((p) => p.start.slice(0, 10)))].sort().slice(0, 8);
  const sched = new Map(); let ok = 0, fail = 0;
  const get = async (type, day) => {
    const res = await fetch(`${API}?Type=${type}&Date=${day}`, { headers: HEADERS });
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  };
  for (const day of days) {
    let live = [];
    try { live = parseSheet(await get("", day), null); ok++; } catch (e) { fail++; }
    await sleep(300);
    for (const ty of TYPES) {
      try {
        const items = parseSheet(await get(ty, day), ty);
        // לשידורים ישירים יש באתר תיאור מלא יותר ("ליגת העל בכדורסל: ... , מחזור 3")
        for (const it of items) { const r = live.find((l) => l.type === ty && l.time === it.time); if (r) it.rich = r.text; }
        sched.set(ty + "|" + day, items); ok++;
      } catch (e) { fail++; if (fail === 1) console.error("sport5:", e.message); }
      await sleep(300);
    }
  }
  const n = enrich(guide, sched);
  console.log(`ספורט 5: ${ok} בקשות הצליחו, ${fail} נכשלו, ${n} תוכניות קיבלו פירוט`);
  if (n) await writeFile("guide.json", JSON.stringify(guide));
}

if (process.argv[1] && process.argv[1].endsWith("enrich_sport5.mjs")) {
  main().catch((e) => { console.error("enrich_sport5:", e.message); process.exit(0); });
}
