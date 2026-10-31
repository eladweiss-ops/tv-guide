// מוסיף לתוכניות של ערוצי ספורט 5 את שם המשחק והמסגרת, מהלוח באתר ערוץ הספורט.
// הרצה: node enrich_sport5.mjs   (אחרי scrape.mjs). כישלון לא נוגע ב-guide.json.
import { readFile, writeFile } from "node:fs/promises";
import { fits, agreement, betterTitle, kind, looksComplete } from "./sportfit.mjs";
import { fillGaps, nextDays } from "./fill.mjs";

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

// הסוג לפי השם. הסוג הסופי נקבע לפי הסכמה עם האתר (resolveTypes) – "ספורט 5 HD" של HOT, למשל, הוא בפועל לוח 5STARS
export function typeOf(name) {
  const n = String(name).trim();
  if (/^ערוץ הספורט$|^ספורט 5( hd)?$/i.test(n)) return "5";
  if (/^ספורט 5\s*(\+|פלוס)\s*(hd)?$/i.test(n)) return "5P";
  if (/(sport|ספורט) 5 live|^5\+?\s*live( hd)?$/i.test(n)) return "LIVE";
  if (/(sport|ספורט) 5 stars/i.test(n)) return "5STARS";
  if (/^5\s*max( hd)?$/i.test(n)) return "5MAX";
  if (/(sport|ספורט) 5 (gold|גולד)|^5\+?\s*gold( hd)?$/i.test(n)) return "GOLD";
  return "";
}
// ערוצים שיכולים להיות אחד מלוחות ספורט 5 (המועמדים לבדיקת הסכמה)
export const isSport5Like = (name) => /^(ערוץ הספורט|ספורט 5|sport 5|5\s*\+|5\s*(live|max|gold|stars))/i.test(String(name).trim());

const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
// ענף הספורט לפי הטקסט: "fb" כדורגל, "bb" כדורסל, "" לא ידוע
export function sportKind(t) {
  t = String(t || "");
  if (/כדורגל/.test(t)) return "fb";
  if (/כדורסל|ווינר סל|יורוליג|יורוקאפ|\bNBA\b/i.test(t)) return "bb";
  if (/פרמייר ליג|לה ליגה|סרייה א|בונדסליגה|ליגת האלופות|ליג 1/.test(t)) return "fb";
  return "";
}

const TYPE_LIST = ["5", "5P", "LIVE", "5STARS", "5MAX", "GOLD"];

// התאמה אחד-לאחד: כל משבצת באתר הולכת לתוכנית הכי קרובה אליה בזמן (עד 20 דקות)
function pickMap(progs, items) {
  const pick = new Map();
  for (const it of items) {
    let bp = null, bd = 21;
    for (const p of progs) { const d = Math.abs(mins(it.time) - mins(p.start.slice(11, 16))); if (d < bd) { bd = d; bp = p; } }
    if (bp && (!pick.has(bp) || pick.get(bp).d > bd)) pick.set(bp, { it, d: bd });
  }
  return pick;
}

// חפיפת זמנים: חלק התוכניות שיש להן באתר משבצת באותה דקה (עד 2 דקות), בלי סתירת ענף (כדורגל מול כדורסל וכד')
function timeScore(progs, items) {
  if (!progs.length) return { ts: 0, bad: 0, n: 0 };
  let ok = 0, bad = 0, n = 0;
  for (const [p, { it, d }] of pickMap(progs, items)) {
    n++; if (d > 2) continue;
    const kt = kind(p.title), kd = kind(it.rich || it.text);
    if (kt && kd && kt !== kd) bad++; else ok++;
  }
  return { ts: ok / progs.length, bad, n };
}

// איזה לוח באתר שייך לכל ערוץ. מתחילים מהשם; אם הלוח בוואלה/HOT לא מסכים עם הלוח הזה (פחות מ-60% הסכמה מחמירה),
// בודקים את שאר הלוחות לפי חפיפת זמנים: לוח שבו 60%+ מהתוכניות נופלות על משבצת באותה דקה (ובלי סתירת ענף) – עוברים אליו.
// כך "ספורט 5 HD" של HOT, שהוא בפועל אותו לוח כמו Sport 5 Stars, מקבל את הפירוט הנכון ולא של "ערוץ הספורט".
// אף פעם לא מאחדים ערוצים – רק בוחרים מאיזה לוח לקרוא, והבדיקה היא על כל הימים יחד.
export function resolveTypes(guide, sched, log = () => {}) {
  const byCh = new Map();
  for (const p of guide.programs) { const k = String(p.ch); if (!byCh.has(k)) byCh.set(k, new Map()); const m = byCh.get(k); const d = p.start.slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d).push(p); }
  const out = new Map();
  for (const c of guide.channels) {
    const named = typeOf(c.name);
    if (!named && !isSport5Like(c.name)) continue;
    const days = byCh.get(String(c.id)); if (!days) continue;
    const score = (ty) => {
      const pairs = []; let ok = 0, bad = 0, tot = 0;
      for (const [d, progs] of days) {
        const items = sched.get(ty + "|" + d) || [];
        for (const [p, { it }] of pickMap(progs, items)) pairs.push({ title: p.title, text: it.rich || it.text });
        const t = timeScore(progs, items); ok += t.ts * progs.length; bad += t.bad; tot += progs.length;
      }
      return { ag: agreement(pairs), n: pairs.length, ts: tot ? ok / tot : 0, bad };
    };
    const cur = named ? score(named) : { ag: 0, n: 0, ts: 0, bad: 0 };
    if (named && cur.n >= 8 && cur.ag >= 0.6) { out.set(String(c.id), named); continue; }
    let best = null, bs = { ts: 0 };
    for (const ty of TYPE_LIST) {
      const sc = score(ty);
      if (sc.n >= 8 && sc.ts >= 0.6 && sc.bad <= sc.n * 0.1 && sc.ts > bs.ts + (ty === named ? 0 : 0.05)) { best = ty; bs = sc; }
    }
    if (best) {
      out.set(String(c.id), best);
      if (best !== named) log(`${c.id} ${c.name}: לוח ${best} באתר (${Math.round(bs.ts * 100)}% מהשעות זהות${named ? `, ולא ${named}: ${Math.round(cur.ts * 100)}%` : ""})`);
    } else if (named) out.set(String(c.id), named);
  }
  return out;
}

// כותרת לשידור שמושלם מהאתר (ערוץ הספורט בימים שוואלה לא מכסה): "ליגת העל: א - ב" בלי "מחזור 9", ובלי מקף צמוד
function titleFromSite(it) {
  const t = String(it.rich || it.text).replace(/[,\s]*(מח\.|מחזור)\s*\d+.*$/, "").replace(/[-–]\s*$/, "").trim();
  const x = it.rich ? t : t.replace(/(\S)-(\S)/, "$1 - $2");
  return (it.rich ? "ישיר! " : "") + x;
}
export function enrich(guide, sched, opts = {}) { // sched: Map "<type>|YYYY-MM-DD" -> items [{time, ...}]
  const chOf = resolveTypes(guide, sched, (m) => console.log("ספורט 5:", m));
  const key = (x) => String(x).replace(/^ישיר!?\s*/, "").replace(/[^\p{L}\p{N}]/gu, "");
  const groups = new Map();
  for (const p of guide.programs) {
    const c = chOf.get(String(p.ch)); if (!c) continue;
    const g = p.ch + "|" + c + "|" + p.start.slice(0, 10); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p);
  }
  let n = 0, retitled = 0; const skipped = [], agr = new Map();
  for (const [g, progs] of groups) {
    const items = sched.get(g.slice(g.indexOf("|") + 1)); if (!items || !items.length) continue; // כל ערוץ (SD/HD) מותאם בנפרד
    const pick = pickMap(progs, items);
    // אם הלוח של הערוץ בוואלה לא מסכים עם האתר (למשל ערוץ אחר עם שם דומה) – לא נוגעים בו בכלל
    const ag = agreement([...pick].map(([p, { it }]) => ({ title: p.title, text: it.rich || it.text })));
    { const ch = g.split("|")[0]; if (!agr.has(ch)) agr.set(ch, []); agr.get(ch).push(ag); }
    // לוח שרוב השעות שלו זהות לשעות באתר (ולא סותר) מתקבל גם כשההסכמה על השמות נמוכה (כותרות כלליות בוואלה/HOT: "ליגת ווינר סל")
    if (ag < 0.4 && timeScore(progs, items).ts < 0.6) { skipped.push(g + " (" + Math.round(ag * 100) + "%)"); continue; }
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
  // ימים שוואלה לא מכסה: "ערוץ הספורט" (לוח 5) מפרסם באתר שבוע+ קדימה, ולוח מלא (שעות מ-00:40 עד 23:50). משלימים רק ערוץ שמסכים עם האתר (60%+) ורק יום שנראה מלא.
  let filled = 0;
  for (const [ch, ty] of chOf) {
    if (ty !== "5") continue;
    const a = agr.get(ch) || []; if (!a.length || a.reduce((x, y) => x + y, 0) / a.length < 0.6) continue;
    const list = [];
    for (const [k, items] of sched) {
      if (!k.startsWith("5|") || !looksComplete(items)) continue;
      const day = k.slice(2), seen = new Set();
      for (const it of items) {
        if (seen.has(it.time)) continue; seen.add(it.time); // האתר מציג חלק מהשידורים פעמיים
        const title = titleFromSite(it), raw = String(it.rich || it.text).trim();
        list.push({ start: day + "T" + it.time, title, desc: key(raw) === key(title) ? "" : raw, lv: it.rich ? 1 : 0 });
      }
    }
    filled += fillGaps(guide, [ch], list);
  }
  console.log("ספורט 5: כותרות שקיבלו שמות קבוצות:", retitled, "· הושלמו בימים חסרים:", filled);
  if (skipped.length) console.log("ספורט 5: דילגתי על לוחות שלא תואמים לאתר:", skipped.join(", "));
  return n + filled;
}

async function main() {
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  // כל הימים שבלוח + עד 9 ימים קדימה: האתר מפרסם ~9 ימים, ווואלה מסיימת מוקדם יותר
  const days = [...new Set([...guide.programs.map((p) => p.start.slice(0, 10)), ...nextDays(9)])].sort().filter((d) => d >= nextDays(1)[0]).slice(0, 10);
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
        // שידורים ישירים שמופיעים רק ברשימת הישירים (לוחות 5+ וכד' מתמלאים באתר רק ליומיים) – מצרפים אותם, עם הטקסט המלא שלהם
        for (const r of live) if (r.type === ty && !items.some((it) => it.time === r.time)) items.push({ type: ty, time: r.time, text: r.text, rich: r.text });
        items.sort((a, b) => (a.time < b.time ? -1 : 1));
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
