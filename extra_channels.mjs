// ערוצים שחסרים בלוח של וואלה, מהלוחות הרשמיים שלהם: ערוץ 14, i24NEWS, כאן חינוכית.
// הרצה: node extra_channels.mjs   (אחרי scrape.mjs). כל ערוץ נכשל לבד, בלי לפגוע באחרים.
import { readFile, writeFile } from "node:fs/promises";
import { nextDays } from "./fill.mjs";
import { parseKan } from "./enrich_kan.mjs";

const UA = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he" };
const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const local = (d) => fmt.format(d).replace(" ", "T");
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// ---- ערוץ 14: הלוח מוטמע בדף (Next.js) כ-{"data":[{"YYYY-MM-DD":[{program,subtitle,start,end}]}]} ----
export function parseC14(html) {
  let text = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try { text += JSON.parse('"' + m[1] + '"'); } catch (e) {}
  }
  const i = text.indexOf('{"data":[{"20');
  if (i < 0) return [];
  let depth = 0, str = false, end = 0;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (str) { if (c === "\\") k++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === "{") depth++; else if (c === "}") { if (!--depth) { end = k + 1; break; } }
  }
  const o = JSON.parse(text.slice(i, end)), out = [];
  for (const day of o.data || []) for (const [date, list] of Object.entries(day)) for (const x of list || []) {
    if (!/^\d\d:\d\d$/.test(x.start || "") || !x.program) continue;
    const title = clean(x.program), sub = clean(x.subtitle);
    out.push({ start: date + "T" + x.start, title, desc: sub && sub !== title ? sub : "" });
  }
  return out;
}

// ---- ערוץ הכנסת: טבלה לכל יום (broadcasts-table-element-N), מתחילה שבוע אחורה ----
const ent = (t) => String(t || "").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
export function parseKnesset(html, today) {
  const out = [], seen = new Set();
  const tables = html.split(/class="broadcasts-table-element-(\d+)"/);
  const base = new Date(today + "T00:00:00Z"); base.setUTCDate(base.getUTCDate() - 7);
  for (let i = 1; i < tables.length; i += 2) {
    const n = +tables[i], body = tables[i + 1];
    let date = new Date(base.getTime() + n * 864e5).toISOString().slice(0, 10);
    const pd = body.match(/data-programdate="(\d{2})\/(\d{2})\/(\d{4})/);
    if (pd) date = `${pd[3]}-${pd[2]}-${pd[1]}`; // כשיש תאריך מפורש בטבלה – הוא קובע
    for (const b of body.split('class="broadcast-list-container"').slice(1)) {
      const id = (b.match(/id="broadcasts-div-(\d+)"/) || [])[1];
      if (id && seen.has(id)) continue; if (id) seen.add(id);
      const time = (b.match(/broadcast-list-content-timing">\s*(\d{1,2}:\d{2})/) || [])[1];
      const title = clean(ent((b.match(/broadcast-list-content-title">([\s\S]*?)<\/h3>/) || [])[1]));
      const desc = clean(ent((b.match(/broadcast-desc-alt[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1]).replace(/<[^>]+>/g, " "));
      if (time && title) out.push({ start: date + "T" + time.padStart(5, "0"), title, desc: desc && desc !== title ? desc : "" });
    }
  }
  return out;
}

// ---- i24NEWS: לוח שבועי קבוע, שעות UTC, day: 0=שני ... 6=ראשון ----
export function expandI24(list, days) {
  const out = [];
  for (const d of days) {
    const base = new Date(d + "T00:00:00Z");
    // מכסים גם תוכניות שמתחילות ב-UTC של יום קודם ונופלות על התאריך הזה בשעון ישראל
    for (const off of [-1, 0]) {
      const u = new Date(base.getTime() + off * 864e5), wd = (u.getUTCDay() + 6) % 7, ud = u.toISOString().slice(0, 10);
      for (const x of list) {
        if (x.day !== wd || !/^\d\d:\d\d$/.test(x.startHour || "")) continue;
        const start = local(new Date(ud + "T" + x.startHour + ":00Z"));
        if (start.slice(0, 10) !== d) continue;
        const desc = clean((x.show && x.show.parsedBody || []).map((b) => b.text || "").join(" "));
        out.push({ start, title: clean(x.show && x.show.title), desc });
      }
    }
  }
  return out.filter((x) => x.title);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((x) => { const k = x.start + "|" + x.title; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

async function get(url, json) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(url + " → " + r.status);
  return json ? r.json() : r.text();
}

const SOURCES = [
  { id: "x14", name: "ערוץ 14", prov: "both", load: async () => parseC14(await get("https://www.c14.co.il/shidurim")) },
  { id: "xi24", name: "i24NEWS", prov: "both", load: async (days) => expandI24(await get("https://api.i24news.tv/v2/he/schedules", true), days) },
  { id: "xknesset", name: "ערוץ הכנסת", prov: "both", load: async (days) => parseKnesset(await get("https://www.knesset.tv/%D7%A2%D7%9B%D7%A9%D7%99%D7%95-%D7%9E%D7%A0%D7%92%D7%9F-%D7%91%D7%A2%D7%A8%D7%95%D7%A5/"), days[0]) },
  { id: "xkids", name: "כאן חינוכית", prov: "both", load: async (days) => {
    const all = [];
    for (const d of days) {
      const [y, m, dd] = d.split("-");
      try { all.push(...parseKan(await get(`https://www.kankids.org.il/umbraco/surface/LoadBroadcastSchedule/LoadSchedule?day=${dd}-${m}-${y}&currentPageId=415742`))); } catch (e) { console.log("כאן חינוכית", d, e.message); }
      await new Promise((r) => setTimeout(r, 400));
    }
    return all;
  } },
];

// מטמון: מה שהצליח פעם נשמר ב-extra-cache.json. ערוץ 14 חוסם שרתים מחוץ לישראל,
// אז המחשב בבית ממלא את המטמון והעדכון הלילי משתמש בו. ימים חדשים מחליפים ימים ישנים.
async function readCache() { try { return JSON.parse(await readFile("extra-cache.json", "utf8")); } catch (e) { return {}; } }
function mergeDays(old, fresh, first) {
  const freshDays = new Set(fresh.map((x) => x.start.slice(0, 10)));
  return dedupe([...(old || []).filter((x) => x.start.slice(0, 10) >= first && !freshDays.has(x.start.slice(0, 10))), ...fresh]);
}

async function main() {
  const guide = JSON.parse(await readFile("guide.json", "utf8"));
  const cache = await readCache();
  const days = nextDays(8), first = days[0];
  const norm = (s) => String(s).replace(/\s|HD/gi, "").toLowerCase();
  let changed = false;
  for (const src of SOURCES) {
    // אם וואלה כבר מביא את הערוץ, לא מוסיפים כפול
    if (guide.channels.some((c) => c.id !== src.id && norm(c.name) === norm(src.name))) { console.log(src.name, "כבר קיים בוואלה"); continue; }
    let fresh = [];
    try { fresh = dedupe((await src.load(days)).filter((x) => x.start.slice(0, 10) >= first)); }
    catch (e) { console.log(src.name, "נכשל:", e.message, "(משתמש במטמון)"); }
    const items = mergeDays(cache[src.id] && cache[src.id].items, fresh.length >= 10 ? fresh : [], first);
    if (fresh.length >= 10) cache[src.id] = { at: new Date().toISOString(), items };
    if (items.length < 10) { console.log(src.name, "מעט מדי שידורים:", items.length); continue; }
    guide.programs = guide.programs.filter((p) => p.ch !== src.id);
    if (!guide.channels.some((c) => c.id === src.id)) guide.channels.push({ id: src.id, name: src.name, prov: src.prov });
    for (const x of items) { const p = { ch: src.id, start: x.start, title: x.title }; if (x.desc) p.desc = x.desc; guide.programs.push(p); }
    console.log(`${src.name}: ${items.length} שידורים, ${items.filter((x) => x.desc).length} עם תקציר, ${new Set(items.map((x) => x.start.slice(0, 10))).size} ימים`);
    changed = true;
  }
  if (changed) await writeFile("guide.json", JSON.stringify(guide));
  await writeFile("extra-cache.json", JSON.stringify(cache));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log("extra_channels נכשל:", e.message); process.exit(0); });
