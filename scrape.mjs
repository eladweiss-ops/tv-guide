// שולף את לוח השידורים של וואלה לקובץ guide.json (שימוש אישי).
//
// הרצה:
//   node scrape.mjs 3819 3787        ← ערוצים לפי מספר של וואלה (3819 = קשת)
//   node scrape.mjs --all            ← כל הערוצים מהעמוד הראשי ומהתצוגות של yes ו-HOT
//   node scrape.mjs --all --range 3690 3850   ← וגם סריקת טווח מספרים (למציאת ערוצים שלא מופיעים ברשימות)
//
// דורש Node 18 ומעלה. הפרסור נבדק מול העמוד האמיתי של קשת (3819).
// אם הוא מדפיס "parse failed", הוא שומר את העמוד לקובץ debug-<id>.html.

import { writeFile } from "node:fs/promises";

const BASE = "https://tv-guide.walla.co.il";
const HEADERS = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

function decode(s) {
  return s
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

  const days = [...clean.matchAll(/<span class="day">[^<]*<\/span><span class="date">(\d{1,2})\.(\d{1,2})<\/span>/g)]
    .map((m) => ({ d: +m[1], m: +m[2] }));
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

function toStart(item, today) {
  let y = today.getFullYear();
  if (item.m < today.getMonth() + 1 - 6) y += 1; // מעבר דצמבר → ינואר
  const p = (n) => String(n).padStart(2, "0");
  return `${y}-${p(item.m)}-${p(item.d)}T${item.time}`;
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
      const pv = prov.get(id);
      channels.push({ id, name: name || `ערוץ ${id}`, prov: pv ? (pv.yes && pv.hot ? "both" : pv.yes ? "yes" : pv.hot ? "hot" : "") : "" });
      const seen = new Set();
      for (const it of items) {
        const start = toStart(it, today);
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
  const out = { updated: new Date().toISOString(), channels, programs };
  await writeFile("guide.json", JSON.stringify(out));
  console.log(`guide.json: ${channels.length} channels, ${programs.length} programs`);
}

main();
