// רץ ב-GitHub Actions: מושך את לוח HOT (7 ימים) דרך הממסר בתל אביב ושומר ב-hot-raw.json (לא נכנס למאגר).
// בלי HOT_RELAY_URL/HOT_RELAY_KEY, או בכישלון: לא כותב כלום ויוצא 0 – השלבים הבאים נופלים למטמון של המחשב בבית.
import { writeFile } from "node:fs/promises";

const URL0 = process.env.HOT_RELAY_URL, KEY = process.env.HOT_RELAY_KEY;
async function main() {
  if (!URL0 || !KEY) { console.log("il-relay: אין HOT_RELAY_URL/HOT_RELAY_KEY, מדלגים"); return; }
  const iso = (d) => d.toISOString().slice(0, 10), now = new Date();
  const u = URL0.replace(/\/$/, "") + "/hot?from=" + iso(now) + "&to=" + iso(new Date(now.getTime() + 7 * 864e5));
  const r = await fetch(u, { headers: { "x-relay-key": KEY }, signal: AbortSignal.timeout(110000) });
  if (!r.ok) throw new Error("relay → " + r.status);
  const j = await r.json(), n = (j && j.data && j.data.programsDetails || []).length;
  if (n < 1000) throw new Error("relay: רק " + n + " תוכניות");
  await writeFile("hot-raw.json", JSON.stringify(j));
  console.log("il-relay: " + n + " תוכניות מ-HOT (תל אביב)");
}
main().catch((e) => { console.log("il-relay נכשל:", e.message); process.exit(0); });
