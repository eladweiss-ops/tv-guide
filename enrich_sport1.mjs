// מוסיף לתוכניות של ערוצי ספורט 1-4 ו-6 (צ'רלטון) את שם המשחק והמסגרת, מהלוח באתר ספורט 1.
// וואלה כותבת למשל "ליגת ווינר 26/27", והאתר כותב "מכבי ת"א - הפועל חיפה · ליגת ווינר 2026/27".
// הרצה: node enrich_sport1.mjs   (אחרי scrape.mjs). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";
import { fits, agreement } from "./sportfit.mjs";

const BASE = "https://sport1.maariv.co.il/broadcast-schedule/";
const SITE = { 1: "2", 2: "3", 3: "4", 4: "5", 6: "1" }; // מספר הערוץ → channel_id באתר
const HEADERS = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(s) {
  return String(s || "").replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// [{time:"19:05", name, desc}]
export function parseDay(html) {
  const out = [];
  for (const b of html.split('class="col-12 show-container"').slice(1)) {
    const t = (b.match(/class="show-starting-time">\s*(\d{1,2}:\d{2})/) || [])[1];
    const name = clean((b.match(/class="show-name">([\s\S]*?)<\/p>/) || [])[1]);
    const desc = clean((b.match(/class="show-description">([\s\S]*?)<\/p>/) || [])[1]);
    const live = /class="show-second-status">\s*ישיר/.test(b);
    if (t && name) out.push({ time: t.padStart(5, "0"), name, desc, live });
  }
  return out;
}

const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// ערוץ בלוח של וואלה → מספר ספורט (1-4, 6), לפי השם
export function sportNo(name) {
  const m = String(name).trim().match(/^(?:ספורט|sport)\s*([1-46])(?:\s|$|hd)/i);
  return m ? +m[1] : 0;
}

// מצמיד לכל תוכנית את המשבצת באתר שמתחילה הכי קרוב אליה (עד 20 דקות הפרש)
export function enrich(guide, sched) { // sched: Map "<channel>|YYYY-MM-DD" -> items [{time, ...}]
  const chOf = new Map(guide.channels.map((c) => [String(c.id), sportNo(c.name)]).filter((x) => x[1]));
  const key = (x) => String(x).replace(/^ישיר!?\s*/, "").replace(/[^\p{L}\p{N}]/gu, "");
  // התאמה אחד-לאחד: כל משבצת באתר הולכת לתוכנית הכי קרובה אליה בזמן (עד 20 דקות)
  const groups = new Map();
  for (const p of guide.programs) {
    const c = chOf.get(String(p.ch)); if (!c) continue;
    const g = p.ch + "|" + c + "|" + p.start.slice(0, 10); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p);
  }
  let n = 0;
  for (const [g, progs] of groups) {
    const items = sched.get(g.slice(g.indexOf("|") + 1)); if (!items || !items.length) continue; // כל ערוץ (SD/HD) מותאם בנפרד
    const pick = new Map();
    for (const it of items) {
      let bp = null, bd = 21;
      for (const p of progs) { const d = Math.abs(mins(it.time) - mins(p.start.slice(11, 16))); if (d < bd) { bd = d; bp = p; } }
      if (bp && (!pick.has(bp) || pick.get(bp).d > bd)) pick.set(bp, { it, d: bd });
    }
    const ag = agreement([...pick].map(([p, { it }]) => ({ title: p.title, text: [it.name, it.desc].filter(Boolean).join(" · ") })));
    if (ag < 0.4) { console.log("ספורט 1: דילגתי על", g, Math.round(ag * 100) + "%"); continue; }
    for (const [p, { it: best }] of pick) {
      const text = [best.name, best.desc].filter(Boolean).join(" · ");
      if (!fits(p.title, text, ag >= 0.6)) continue;
      p.lv = best.live ? 1 : 0; // ישיר או מוקלט, לפי האתר
      if (p.desc) continue;
      if (!text || key(best.name).startsWith(key(p.title)) || key(p.title).startsWith(key(best.name))) continue;
      p.desc = text; n++;
    }
  }
  return n;
}

async function main() {
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const days = [...new Set(guide.programs.map((p) => p.start.slice(0, 10)))].sort().slice(0, 8);
  const sched = new Map();
  let ok = 0, fail = 0;
  for (const [no, id] of Object.entries(SITE)) {
    for (const day of days) {
      try {
        const res = await fetch(`${BASE}?day_selected=${day}&channel_id=${id}`, { headers: HEADERS });
        if (!res.ok) throw new Error(String(res.status));
        sched.set(no + "|" + day, parseDay(await res.text())); ok++;
      } catch (e) { fail++; if (fail === 1) console.error("sport1:", e.message); }
      await sleep(300);
    }
  }
  const n = enrich(guide, sched);
  console.log(`ספורט 1: ${ok} עמודים נקראו, ${fail} נכשלו, ${n} תוכניות קיבלו פירוט`);
  if (n) await writeFile("guide.json", JSON.stringify(guide));
}

if (process.argv[1] && process.argv[1].endsWith("enrich_sport1.mjs")) {
  main().catch((e) => { console.error("enrich_sport1:", e.message); process.exit(0); });
}
