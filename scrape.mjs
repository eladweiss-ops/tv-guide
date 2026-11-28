// שולף את לוח השידורים של וואלה לקובץ guide.json (שימוש אישי).
//
// הרצה:
//   node scrape.mjs 3819 3787        ← ערוצים לפי מספר של וואלה (3819 = קשת)
//   node scrape.mjs --all            ← כל הערוצים מהעמוד הראשי ומהתצוגות של yes ו-HOT
//   node scrape.mjs --all --range 3690 3850   ← וגם סריקת טווח מספרים (למציאת ערוצים שלא מופיעים ברשימות)
//
// דורש Node 18 ומעלה. הפרסור נבדק מול העמוד האמיתי של קשת (3819).
// אם הוא מדפיס "parse failed", הוא שומר את העמוד לקובץ debug-<id>.html.

import { writeFile, readFile } from "node:fs/promises";

const BASE = "https://tv-guide.walla.co.il";
const HEADERS = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// וואלה מחזיר לפעמים 503 או מנתק. בלי ניסיון חוזר ערוץ שלם נעלם מהלוח ל-24 שעות (ספורט 2/3/4/6 נעלמו כך ב-13.11, 18-19.11, 25-26.11
// ובגלל זה הוחמץ משחק של מכבי חיפה ב-28.11). 3 ניסיונות עם המתנה הולכת וגדלה, רק על שגיאות זמניות (רשת, 429, 5xx)
async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (res.ok) return res.text();
      const err = new Error(`${url} → ${res.status}`);
      err.temp = res.status === 429 || res.status >= 500;
      throw err;
    } catch (e) {
      const temp = e.temp !== false && (e.temp || e.name === "TimeoutError" || e.name === "AbortError" || e instanceof TypeError);
      if (!temp || i >= tries) throw e;
      await sleep(i * 2500);
    }
  }
}

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// מחזיר { name, items:[{d,m,time,title}] }
// מבנה העמוד (נבדק מול debug-3819.html): בניווט יש <span class="day">..</span><span class="date">20.10</span>
// לכל יום, ולפי אותו סדר יש בלוקים של <div class="broadcasts"> עם <h3>שם</h3><time>שעה</time>.
// React משבץ הערות <!-- --> בתוך השעה, ולכן מסירים אותן קודם.
export function parseChannel(html) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const pageTitle = (clean.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1] || "";
  const name = decode(pageTitle).replace(/\s*-\s*וואלה.*$/, "").replace(/^ערוץ\s+/, "").trim();

  const days = [...clean.matchAll(/<span class="day">([^<]*)<\/span><span class="date">(\d{1,2})\.(\d{1,2})<\/span>/g)]
    .map((m) => ({ wd: decode(m[1]).trim(), d: +m[2], m: +m[3] }));
  const blocks = clean.split('<div class="broadcasts">').slice(1);

  const items = [];
  blocks.forEach((block, i) => {
    const day = days[i];
    if (!day) return;
    for (const m of block.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<time[^>]*>\s*(\d{1,2}:\d{2})\s*<\/time>/g)) {
      const title = decode(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      if (!title) continue;
      items.push({ ...day, time: m[2].padStart(5, "0"), title });
    }
  });
  return { name, items };
}

const WD = { "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4, "שישי": 5, "שבת": 6 };
export function toStart(item, today) {
  let y = today.getFullYear();
  if (item.m < today.getMonth() + 1 - 6) y += 1; // מעבר דצמבר → ינואר
  const dt = new Date(Date.UTC(y, item.m - 1, item.d));
  // תאריך שלא תואם לשם היום = עמוד ישן בוואלה (ערוץ 24: "שישי 1.11 … שלישי 5.11" הוא לוח מ-2024, כשמ-1.11 היה שישי).
  // לא "מתקנים" אותו לשבוע הנוכחי – מחזירים null והתוכנית נזרקת
  const want = WD[item.wd];
  if (want != null && dt.getUTCDay() !== want) return null;
  const ms = dt.getTime(), t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (ms < t0 - 2 * 864e5 || ms > t0 + 14 * 864e5) return null; // בדיקת שפיות: מאתמול-שלשום עד שבועיים קדימה
  return dt.toISOString().slice(0, 10) + "T" + item.time;
}

// אוסף מספרי ערוצים מהעמוד הראשי ומהתצוגות לפי ספק, ושומר מאיזה ספק כל ערוץ מגיע.
async function discoverChannels() {
  const views = [["/", null], ["/?provider=yes", "yes"], ["/?provider=hot", "hot"]];
  const prov = new Map(); // id -> {yes, hot}
  for (const [p, who] of views) {
    try {
      const html = await get(BASE + p);
      const found = [...new Set([...html.matchAll(/\/channel\/(\d+)/g)].map((m) => m[1]))];
      console.log(`${p}: ${found.length} channels`);
      for (const id of found) {
        const e = prov.get(id) || { yes: false, hot: false };
        if (who) e[who] = true;
        prov.set(id, e);
      }
    } catch (e) {
      console.error(`${p}: ${e.message}`);
    }
    await sleep(400);
  }
  return prov;
}

// היום בשעון ישראל, YYYY-MM-DD (הלוח בשעון ישראל; GitHub רץ ב-UTC)
const ilToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem" }).format(new Date());
export async function carryOver(ids, channels, programs, prevPath = "guide.json") {
  let prev;
  try { prev = JSON.parse(await readFile(prevPath, "utf8")); } catch { return []; }
  if (!prev || !Array.isArray(prev.channels) || !Array.isArray(prev.programs)) return [];
  const tried = new Set(ids), have = new Set(channels.map((c) => c.id)), cut = ilToday() + "T00:00", out = [];
  for (const c of prev.channels) {
    if (!tried.has(c.id) || have.has(c.id)) continue;
    const ps = prev.programs.filter((p) => p.ch === c.id && p.start >= cut).map((p) => ({ ch: p.ch, start: p.start, title: p.title }));
    if (ps.length < 5) continue; // אין מה להציל (גם ערוץ ישן/מת שוואלה כבר לא מגיש)
    channels.push({ id: c.id, name: c.name, prov: c.prov || "" });
    programs.push(...ps);
    out.push(c.id);
    console.error(`channel ${c.id} ${c.name}: נכשל היום – נשארות ${ps.length} תוכניות מהלוח הקודם`);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--range");
  const rangeIds = [];
  if (ri >= 0) {
    const from = +args[ri + 1], to = +args[ri + 2];
    if (!(from > 0 && to >= from && to - from <= 2000)) {
      console.error("שימוש: --range 3690 3850");
      process.exit(1);
    }
    for (let i = from; i <= to; i++) rangeIds.push(String(i));
  }
  const explicit = args.filter((a, i) => /^\d+$/.test(a) && !(ri >= 0 && (i === ri + 1 || i === ri + 2)));
  const prov = args.includes("--all") ? await discoverChannels() : new Map();

  const ids = [...new Set([...prov.keys(), ...explicit, ...rangeIds])];
  const quiet = new Set(rangeIds.filter((id) => !prov.has(id) && !explicit.includes(id)));
  if (!ids.length) {
    console.error("שימוש: node scrape.mjs --all   או   node scrape.mjs 3819 3787   או   --range 3690 3850");
    process.exit(1);
  }

  const today = new Date();
  const channels = [];
  const programs = [];

  for (const id of ids) {
    try {
      const html = await get(`${BASE}/channel/${id}`);
      const { name, items } = parseChannel(html);
      if (items.length < 5) {
        if (!quiet.has(id)) {
          console.error(`parse failed: channel ${id} (${items.length} items). Saved debug-${id}.html`);
          await writeFile(`debug-${id}.html`, html);
        }
        await sleep(300);
        continue;
      }
      const starts = items.map((it) => toStart(it, today)), bad = starts.filter((x) => !x).length;
      if (bad > items.length / 2) { // רוב העמוד ישן/לא תואם: מדלגים על הערוץ כולו (עדיף "אין לוח" מלוח מזויף)
        console.error(`channel ${id} ${name}: ${bad}/${items.length} תאריכים לא תואמים לשם היום (לוח ישן) – מדלגים`);
        await sleep(300);
        continue;
      }
      const pv = prov.get(id);
      channels.push({ id, name: name || `ערוץ ${id}`, prov: pv ? (pv.yes && pv.hot ? "both" : pv.yes ? "yes" : pv.hot ? "hot" : "") : "" });
      const seen = new Set();
      for (const [i, it] of items.entries()) {
        const start = starts[i];
        if (!start) continue;
        const key = start + it.title;
        if (seen.has(key)) continue;
        seen.add(key);
        programs.push({ ch: id, start, title: it.title });
      }
      console.log(`${id} ${name}: ${items.length} programs`);
    } catch (e) {
      if (!quiet.has(id)) console.error(`channel ${id}: ${e.message}`);
    }
    await sleep(400);
  }

  if (channels.length === 0) {
    // לא דורסים guide.json תקין בקובץ ריק (למשל אם וואלה חסמה את הבקשות).
    console.error("לא נשלף אף ערוץ. guide.json לא עודכן.");
    process.exit(1);
  }
  // ערוץ שהיה בלוח הקודם ונכשל היום (גם אחרי ניסיונות חוזרים): משאירים את התוכניות שלו מהיום והלאה מהלוח הקודם,
  // במקום שייעלם. רק ערוצי וואלה שניסינו לשלוף עכשיו (לא ערוצים שמוסיפים שלבי ההעשרה אחר כך). הרשימה נשמרת ב-carried לניטור
  const carried = await carryOver(ids, channels, programs);
  const out = { updated: new Date().toISOString(), channels, programs };
  if (carried.length) out.carried = carried;
  await writeFile("guide.json", JSON.stringify(out));
  console.log(`guide.json: ${channels.length} channels, ${programs.length} programs`);
}

if ((process.argv[1] || "").replace(/\\/g, "/").endsWith("scrape.mjs")) main();
