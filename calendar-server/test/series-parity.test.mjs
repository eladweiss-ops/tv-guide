// node --test calendar-server/test/*.mjs  - המסווג בלקוח (js/series.js) והמסווג בשרת (api/_series.js) חייבים לתת אותן תשובות. נבדק על לוח אמיתי (guide.json) ועל דוגמאות קצה.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, parseTitle, seriesKey, seriesTitle } from "../api/_series.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TVG = { files: {}, $: () => null, esc: (s) => String(s), hhmm: () => "", dstr: () => "", CAL_API: "", store: () => null };
const ctx = vm.createContext({ window: { TVG }, document: { addEventListener() {} }, setTimeout() {}, Date, Math, JSON, Object, Array, String, Number, RegExp });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "series.js"), "utf8"), ctx);

const strip = (r) => r.map((x) => [x.primary, x.why]);

test("parity: parseTitle/seriesKey זהים בלקוח ובשרת על כל הכותרות בלוח", () => {
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, "guide.json"), "utf8"));
  const titles = [...new Set(g.programs.map((p) => p.title))];
  assert.ok(titles.length > 1000);
  for (const t of titles) {
    assert.deepEqual(JSON.parse(JSON.stringify(TVG.folParse(t))), parseTitle(t), t); // JSON: אובייקטים מ-vm הם מ"עולם" אחר
    assert.equal(TVG.folKey(t), seriesKey(t), t);
    assert.equal(TVG.folTitle(t), seriesTitle(t), t);
  }
});

test("parity: classify זהה בלקוח ובשרת על 400 סדרות אמיתיות מהלוח + דוגמאות קצה", () => {
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, "guide.json"), "utf8"));
  const by = new Map();
  for (const p of g.programs) { const k = seriesKey(p.title); if (!k) continue; (by.get(k) || by.set(k, []).get(k)).push({ ch: String(p.ch), start: p.start, title: p.title, desc: p.desc, rr: p.rr ? 1 : 0, lv: p.lv === 1 ? 1 : 0 }); }
  const groups = [...by.values()].filter((a) => a.length >= 2).sort((a, b) => b.length - a.length).slice(0, 400);
  assert.ok(groups.length > 100);
  let n = 0;
  for (const rows of groups) { assert.deepEqual(strip(TVG.folClassify(rows)), strip(classify(rows)), rows[0].title); n += rows.length; }
  assert.ok(n > 1000);
  const edge = [
    [{ ch: "1", start: "2026-11-02T21:30", title: "ישיר: מבצע" }, { ch: "1", start: "2026-11-03T03:00", title: "מבצע" }],
    [{ ch: "1", start: "2026-11-02T21:30", title: "דרמה", desc: "פרק חדש בעונה חדשה של הדרמה" }, { ch: "2", start: "2026-11-02T21:30", title: "דרמה", desc: "פרק חדש בעונה חדשה של הדרמה" }],
    [{ ch: "1", start: "2026-11-02T10:00", title: "אחת" }],
  ];
  for (const rows of edge) assert.deepEqual(strip(TVG.folClassify(rows)), strip(classify(rows)));
});
