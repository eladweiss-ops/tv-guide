// מוסיף תקצירים לתוכניות של כאן 11, מהלוח הרשמי באתר כאן.
// הרצה: node enrich_kan.mjs   (אחרי scrape.mjs). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";
import { fillGaps, nextDays } from "./fill.mjs";
import { sameShow } from "./enrich_hot.mjs";

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
  // האתר כותב "1.11.2026 00:47:00" (יום בלי אפס מוביל) – בלי {1,2} כל ימים 1-9 בחודש נפלו
  const m = String(utc).match(/(\d{1,2})\.(\d{1,2})\.(\d{4}) (\d{1,2}):(\d{2})/); if (!m) return null;
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
    // ▶ קישור לדף התוכנית באתר כאן (בערך 60% מהשידורים; "current" מפנה לשידור החי – לא דף תוכנית)
    const href = (b.match(/class="[^"]*program-link[^"]*" href="([^"]+)"/) || [])[1] || "";
    const u = /^\/content\/kan\/[\w-]+\/p-\d+\/$/.test(href) ? href : "";
    if (start && title) out.push({ start, title, desc: desc.replace(/[^\p{L}\p{N}]/gu, "") === title.replace(/[^\p{L}\p{N}]/gu, "") ? "" : desc, ...(u ? { u } : {}) }); // תקציר שהוא רק שם התוכנית – לא תקציר
  }
  return out;
}

const toMin = (s) => Date.parse(s + ":00Z") / 60000;
const key = (x) => String(x).replace(/[^\p{L}\p{N}]/gu, "");

export function enrich(guide, items) {
  const ids = new Set(guide.channels.filter((c) => /^(HD )?כאן( 11)?( HD)?$/.test(String(c.name).trim())).map((c) => String(c.id)));
  let n = 0, nu = 0;
  for (const p of guide.programs) {
    if (!ids.has(String(p.ch))) continue;
    const t = toMin(p.start);
    let best = null, bd = 16;
    for (const it of items) { const d = Math.abs(toMin(it.start) - t); if (d < bd) { bd = d; best = it; } }
    if (!best || !sameShow(p.title, best.title)) continue; // אף פעם לא לפי קרבת זמן בלבד (גם לא קישור)
    if (best.u && p.u !== best.u) { p.u = best.u; nu++; } // ▶ דף התוכנית בכאן (guide.json: שדה אופציונלי u, נתיב יחסי ל-kan.org.il)
    if (p.desc || !best.desc || key(best.desc) === key(p.title)) continue;
    p.desc = best.desc; n++;
  }
  return { ids: [...ids], n, nu };
}

async function main() {
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const days = [...new Set([...guide.programs.map((p) => p.start.slice(0, 10)), ...nextDays(10)])].sort().filter((d) => d >= nextDays(1)[0]).slice(0, 10);
  const items = []; let ok = 0, fail = 0;
  for (const day of days) {
    const [y, m, d] = day.split("-");
    try {
      const res = await fetch(`${API}?day=${d}-${m}-${y}&channelId=${KAN11}&currentPageId=${PAGE}`, { headers: HEADERS });
      if (!res.ok) throw new Error(String(res.status));
      const html = await res.text();
      if (/Just a moment|cf-challenge|challenge-platform/.test(html)) throw new Error("challenge"); // מוגן בבדיקת בוט – לא ממשיכים ללחוץ
      items.push(...parseKan(html)); ok++;
    } catch (e) { fail++; if (fail === 1) console.error("kan:", e.message); if (/^(403|429|challenge)$/.test(e.message)) break; }
    await sleep(800);
  }
  const kanIds = guide.channels.filter((c) => /^(HD )?כאן( 11)?( HD)?$/.test(String(c.name).trim())).map((c) => c.id);
  const filled = fillGaps(guide, kanIds, items);
  const r = enrich(guide, items);
  if (filled) console.log(`כאן 11: הושלמו ${filled} שידורים בימים שחסרו בוואלה`);
  console.log(`כאן 11: ${ok} ימים נקראו, ${fail} נכשלו, ${items.length} תוכניות באתר, ${r.n} עודכנו, ${r.nu} קישורים לדף התוכנית (ערוצים: ${r.ids.join(",") || "לא נמצא"})`);
  if (r.n || r.nu || filled) await writeFile("guide.json", JSON.stringify(guide));
}

if (process.argv[1] && process.argv[1].endsWith("enrich_kan.mjs")) {
  main().catch((e) => { console.error("enrich_kan:", e.message); process.exit(0); });
}
