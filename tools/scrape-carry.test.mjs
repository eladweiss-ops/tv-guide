// node --test tools/scrape-carry.test.mjs – ערוץ שנכשל היום נשאר עם התוכניות מהלוח הקודם (מהיום והלאה)
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { carryOver } from "../scrape.mjs";

const day = (n) => { const d = new Date(Date.now() + n * 864e5); return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem" }).format(d); };

test("ערוץ שנכשל נשאר מהלוח הקודם, רק מהיום והלאה, רק ערוצים שניסינו", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "carry-"));
  const f = path.join(dir, "guide.json");
  const ps = (ch) => [-1, 0, 1, 2, 3, 4, 5].map((n, i) => ({ ch, start: day(n) + "T14:40", title: "t" + i, desc: "x" }));
  await writeFile(f, JSON.stringify({ channels: [{ id: "3761", name: "SPORT 3", prov: "hot" }, { id: "3819", name: "קשת" }, { id: "x14", name: "ערוץ 14" }],
    programs: [...ps("3761"), ...ps("3819"), ...ps("x14")] }));
  const channels = [{ id: "3819", name: "קשת", prov: "" }], programs = [{ ch: "3819", start: day(0) + "T20:00", title: "חדש" }];
  const got = await carryOver(["3761", "3819"], channels, programs, f);
  assert.deepEqual(got, ["3761"]);
  assert.ok(channels.some((c) => c.id === "3761" && c.prov === "hot"));
  const c3 = programs.filter((p) => p.ch === "3761");
  assert.equal(c3.length, 6); // בלי אתמול
  assert.ok(c3.every((p) => p.start >= day(0) && !("desc" in p)));
  assert.equal(programs.filter((p) => p.ch === "3819").length, 1); // ערוץ שהצליח – לא נוגעים
  assert.ok(!channels.some((c) => c.id === "x14")); // ערוץ שלא ניסינו (שלב העשרה) – לא
});

test("אין לוח קודם – כלום", async () => {
  assert.deepEqual(await carryOver(["1"], [], [], path.join(tmpdir(), "nope-" + Date.now() + ".json")), []);
});
