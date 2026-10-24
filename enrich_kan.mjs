// מוסיף תקצירים לתוכניות של כאן 11, מהלוח הרשמי באתר כאן.
// הרצה: node enrich_kan.mjs   (אחרי scrape.mjs). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";

const API = "https://www.kan.org.il/umbraco/surface/LoadBroadcastSchedule/LoadSchedule";
const KAN11 = "4444", PAGE = "1517";
const HEADERS = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he", referer: "https://www.kan.org.il/tv-guide/" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(s) {
  return String(s || "").replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

// שעה מקומית בישראל "YYYY-MM-DDTHH:MM" משעת UTC "DD.MM.YYYY HH:MM:SS"
const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export function localStart(utc) {
  const m = String(utc).match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/); if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]));
  return fmt.format(d).replace(" ", "T");
}

// [{start, title, desc}]
export function parseKan(html) {
  const out = [];
  for (const b of html.split('class="results-item').slice(1)) {
    const utc = (b.match(/data-date-utc="([^"]+)"/) || [])[1];
    const title = clean((b.match(/class="program-title">([\s\S]*?)<\/h3>/) || [])[1]);
    const desc = clean((b.match(/class="program-description">([\s\S]*?)<\/(?:div|p)>/) || [])[1]);
    const start = localStart(utc);
    if (start && title) out.push({ start, title, desc });
  }
  return out;
}

const toMin = (s) => Date.parse(s + ":00Z") / 60000;
const key = (x) => String(x).replace(/[^\p{L}\p{N}]/gu, "");

export function enrich(guide, items) {
  const ids = new Set(guide.channels.filter((c) => /^(HD )?כאן( 11)?( HD)?$/.test(String(c.name).trim())).map((c) => String(c.id)));
  let n = 0;
  for (const p of guide.programs) {
    if (!ids.has(String(p.ch)) || p.desc) continue;
    const t = toMin(p.start);
    let best = null, bd = 16;
    for (const it of items) { const d = Math.abs(toMin(it.start) - t); if (d < bd) { bd = d; best = it; } }
    if (!best || !best.desc || key(best.desc) === key(p.title)) continue;
    p.desc = best.desc; n++;
  }
  return { ids: [...ids], n };
}

async function main() {
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const days = [...new Set(guide.programs.map((p) => p.start.slice(0, 10)))].sort().slice(0, 8);
  const items = []; let ok = 0, fail = 0;
  for (const day of days) {
    const [y, m, d] = day.split("-");
    try {
      const res = await fetch(`${API}?day=${d}-${m}-${y}&channelId=${KAN11}&currentPageId=${PAGE}`, { headers: HEADERS });
      if (!res.ok) throw new Error(String(res.status));
      items.push(...parseKan(await res.text())); ok++;
    } catch (e) { fail++; if (fail === 1) console.error("kan:", e.message); }
    await sleep(400);
  }
  const r = enrich(guide, items);
  console.log(`כאן 11: ${ok} ימים נקראו, ${fail} נכשלו, ${items.length} תוכניות באתר, ${r.n} עודכנו (ערוצים: ${r.ids.join(",") || "לא נמצא"})`);
  if (r.n) await writeFile("guide.json", JSON.stringify(guide));
}

if (process.argv[1] && process.argv[1].endsWith("enrich_kan.mjs")) {
  main().catch((e) => { console.error("enrich_kan:", e.message); process.exit(0); });
}
