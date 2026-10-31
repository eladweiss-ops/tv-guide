// העברה חד-פעמית של הנתונים מ-Vercel Blob ל-Firestore (להריץ ידנית, רק כשה-Blob קריא שוב).
//   BLOB_READ_WRITE_TOKEN=... FIREBASE_SERVICE_ACCOUNT='{...}' node tools/migrate-blob-to-firestore.mjs [--dry-run] [--overwrite] [--prefix=rems]
// אידמפוטנטי: מסמך שכבר קיים ב-Firestore לא נדרס (ייתכן שנכתב חי אחרי המעבר) אלא עם --overwrite; מסמך זהה לא נכתב.
// --dry-run: לא כותב כלום, רק מדווח מה היה קורה (קורא מ-Firestore רק אם FIREBASE_SERVICE_ACCOUNT מוגדר).
// ממפה כל blob לפי אותה פונקציית mapPath של השרת (rems/<t>.json -> rems/<t>, snz/<t>/<h>.json -> snz/<t>__<h>).
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run"), overwrite = args.includes("--overwrite");
const only = (args.find((a) => a.startsWith("--prefix=")) || "").slice(9);
const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "calendar-server");

if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("missing BLOB_READ_WRITE_TOKEN (נדרש רק למיגרציה)"); process.exit(2); }
if (!dry && !process.env.FIREBASE_SERVICE_ACCOUNT) { console.error("missing FIREBASE_SERVICE_ACCOUNT"); process.exit(2); }

const { list } = createRequire(path.join(server, "package.json"))("@vercel/blob"); // devDependency של calendar-server
const dbm = await import(pathToFileURL(path.join(server, "api", "_db.js")).href);
const useDb = !!process.env.FIREBASE_SERVICE_ACCOUNT;

const stats = { seen: 0, copied: 0, same: 0, skippedExisting: 0, skippedBad: 0, failed: 0 };
const byPrefix = {};
let cursor;
do {
  const page = await list({ cursor, limit: 1000, ...(only ? { prefix: only + "/" } : {}) });
  for (const b of page.blobs) {
    stats.seen++;
    const pre = b.pathname.split("/")[0];
    byPrefix[pre] = (byPrefix[pre] || 0) + 1;
    try {
      dbm.mapPath(b.pathname); // מאמת שהנתיב ניתן למיפוי
      const r = await fetch(b.url + "?v=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("fetch " + r.status);
      const txt = await r.text();
      let val; try { val = JSON.parse(txt); } catch (e) { stats.skippedBad++; console.log("skip (not JSON)", b.pathname); continue; }
      const cur = useDb ? await dbm.readJson(b.pathname, undefined) : undefined;
      if (cur !== undefined && JSON.stringify(cur) === JSON.stringify(val)) { stats.same++; continue; }
      if (cur !== undefined && !overwrite) { stats.skippedExisting++; console.log("skip (exists in Firestore; use --overwrite)", b.pathname); continue; }
      if (!dry) await dbm.writeJson(b.pathname, val);
      stats.copied++;
      if (dry) console.log("would copy", b.pathname, "->", JSON.stringify(dbm.mapPath(b.pathname)), txt.length + "B");
    } catch (e) { stats.failed++; console.error("FAILED", b.pathname, e.message); }
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

console.log(dry ? "DRY RUN" : "DONE", JSON.stringify(stats), "byPrefix", JSON.stringify(byPrefix));
if (stats.failed) process.exit(1);
