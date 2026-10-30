// מוסיף לתוכניות של ערוצי ספורט 5 את שם המשחק והמסגרת, מהלוח באתר ערוץ הספורט.
// הרצה: node enrich_sport5.mjs   (אחרי scrape.mjs). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";
import { fits, agreement, betterTitle } from "./sportfit.mjs";

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
// ענף הספורט לפי הטקסט: "fb" כדורגל, "bb" כדורסל, "" לא ידוע
export function sportKind(t) {
  t = String(t || "");
  if (/כדורגל/.test(t)) return "fb";
  if (/כדורסל|ווינר סל|יורוליג|יורוקאפ|\bNBA\b/i.test(t)) return "bb";
  if (/פרמייר ליג|לה ליגה|סרייה א|בונדסליגה|ליגת האלופות|ליג 1/.test(t)) return "fb";
  return "";
}

export function enrich(guide, sched) { // sched: Map "<channel>|YYYY-MM-DD" -> items [{time, ...}]
  const chOf = new Map(guide.channels.map((c) => [String(c.id), typeOf(c.name)]).filter((x) => x[1]));
  const key = (x) => String(x).replace(/^ישיר!?\s*/, "").replace(/[^\p{L}\p{N}]/gu, "");
  // התאמה אחד-לאחד: כל משבצת באתר הולכת לתוכנית הכי קרובה אליה בזמן (עד 20 דקות)
  const groups = new Map();
  for (const p of guide.programs) {
    const c = chOf.get(String(p.ch)); if (!c) continue;
    const g = p.ch + "|" + c + "|" + p.start.slice(0, 10); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p);
  }
  let n = 0, retitled = 0; const skipped = [];
  for (const [g, progs] of groups) {
    const items = sched.get(g.slice(g.indexOf("|") + 1)); if (!items || !items.length) continue; // כל ערוץ (SD/HD) מותאם בנפרד
    const pick = new Map();
    for (const it of items) {
      let bp = null, bd = 21;
      for (const p of progs) { const d = Math.abs(mins(it.time) - mins(p.start.slice(11, 16))); if (d < bd) { bd = d; bp = p; } }
      if (bp && (!pick.has(bp) || pick.get(bp).d > bd)) pick.set(bp, { it, d: bd });
    }
    // אם הלוח של הערוץ בוואלה לא מסכים עם האתר (למשל ערוץ אחר עם שם דומה) – לא נוגעים בו בכלל
    const ag = agreement([...pick].map(([p, { it }]) => ({ title: p.title, text: it.rich || it.text })));
    if (ag < 0.4) { skipped.push(g + " (" + Math.round(ag * 100) + "%)"); continue; }
    for (const [p, { it: best }] of pick) {
      const text = best.rich || best.text;
      if (!fits(p.title, text, ag >= 0.6 || pick.get(p).d <= 2)) continue; // התיאור לא שייך לתוכנית הזו
      p.lv = best.rich ? 1 : 0; // מופיע ברשימת השידורים הישירים של האתר = ישיר
      const bt = betterTitle(p.title, best.text); if (bt) { p.title = bt; retitled++; }
      if (p.desc) continue;
      if (!text || key(best.rich || best.text).startsWith(key(p.title)) || key(p.title).startsWith(key(best.rich || best.text))) continue;
      p.desc = text; n++;
    }
  }
  console.log("ספורט 5: כותרות שקיבלו שמות קבוצות:", retitled);
  if (skipped.length) console.log("ספורט 5: דילגתי על לוחות שלא תואמים לאתר:", skipped.join(", "));
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
