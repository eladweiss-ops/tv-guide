import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archive, ilToday, addDays, MIN_PROGRAMS } from "../archive_past.mjs";

const day = (d, n) => Array.from({ length: n }, (_, i) => ({ ch: "1", start: d + "T" + String(Math.floor(i / 60) % 24).padStart(2, "0") + ":" + String(i % 60).padStart(2, "0"), title: "t" + i }));
const tmp = () => fs.mkdtempSync(join(tmpdir(), "past-"));

test("archive: שומר ימים שעברו, מדלג על יום חלקי, על היום ועל העתיד", () => {
  const dir = tmp(), g = { programs: [...day("2026-10-31", MIN_PROGRAMS), ...day("2026-10-30", 10), ...day("2026-11-01", MIN_PROGRAMS), ...day("2026-11-02", MIN_PROGRAMS)] };
  const r = archive(dir, [g], "2026-11-01");
  assert.deepEqual(r.kept, ["2026-10-31"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, "index.json"), "utf8")), { days: ["2026-10-31"] });
  assert.equal(JSON.parse(fs.readFileSync(join(dir, "2026-10-31.json"), "utf8")).programs.length, MIN_PROGRAMS);
});

test("archive: גרסה שלמה יותר מחליפה, חלקית יותר לא דורסת; ימים ישנים משבוע נמחקים", () => {
  const dir = tmp();
  archive(dir, [{ programs: day("2026-10-31", MIN_PROGRAMS + 50) }], "2026-11-01");
  archive(dir, [{ programs: day("2026-10-31", MIN_PROGRAMS) }], "2026-11-01");
  assert.equal(JSON.parse(fs.readFileSync(join(dir, "2026-10-31.json"), "utf8")).programs.length, MIN_PROGRAMS + 50);
  fs.writeFileSync(join(dir, "2026-10-20.json"), "{}");
  const r = archive(dir, [], "2026-11-01");
  assert.deepEqual(r.kept, ["2026-10-31"]);
});

test("ilToday/addDays: שעון ישראל ומעבר חודש", () => {
  assert.equal(ilToday(new Date("2026-10-31T22:30:00Z")), "2026-11-01"); // 00:30 בישראל
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
});
