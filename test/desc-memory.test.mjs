import test from "node:test";
import assert from "node:assert/strict";
import { updateMemory, applyMemory } from "../desc_memory.mjs";

const P = (ch, start, title, desc) => (desc ? { ch, start, title, desc } : { ch, start, title });

test("זיכרון תקצירים: משלים רק אחרי 2 ימים שונים עם אותו תקציר, באותו ערוץ ובאותו שם", () => {
  const mem = {};
  updateMemory(mem, [P("1", "2026-10-20T08:00", "קאיו", "קאיו בגן")], "2026-10-31");
  const g1 = [P("1", "2026-11-06T08:00", "קאיו")];
  assert.equal(applyMemory(mem, g1), 0, "יום אחד לא מספיק");
  updateMemory(mem, [P("1", "2026-10-21T08:00", "קאיו", "קאיו בגן")], "2026-10-31");
  const g2 = [P("1", "2026-11-06T08:00", "קאיו"), P("2", "2026-11-06T08:00", "קאיו"), P("1", "2026-11-06T09:00", "קאיו 2")];
  assert.equal(applyMemory(mem, g2), 1);
  assert.equal(g2[0].desc, "קאיו בגן");
  assert.equal(g2[1].desc, undefined, "ערוץ אחר לא מקבל");
  assert.equal(g2[2].desc, undefined, "שם אחר לא מקבל");
});

test("זיכרון תקצירים: שם שנראה עם תקציר אחר נפסל לתמיד (NBA)", () => {
  const mem = {};
  updateMemory(mem, [P("5", "2026-10-20T03:00", "NBA", "לייקרס - סלטיקס"), P("5", "2026-10-21T03:00", "NBA", "לייקרס - סלטיקס")], "2026-10-31");
  updateMemory(mem, [P("5", "2026-10-22T03:00", "NBA", "ניקס - היט")], "2026-10-31");
  updateMemory(mem, [P("5", "2026-10-23T03:00", "NBA", "לייקרס - סלטיקס")], "2026-10-31");
  const g = [P("5", "2026-11-06T03:00", "NBA")];
  assert.equal(applyMemory(mem, g), 0);
  assert.equal(g[0].desc, undefined);
});

test("זיכרון תקצירים: לא דורס תקציר קיים, ומוחק רשומות שלא נראו 30 יום", () => {
  const mem = {};
  updateMemory(mem, [P("1", "2026-09-01T08:00", "ישן", "א"), P("1", "2026-09-02T08:00", "ישן", "א")], "2026-09-02");
  updateMemory(mem, [P("1", "2026-10-30T08:00", "חדש", "ב"), P("1", "2026-10-31T08:00", "חדש", "ב")], "2026-10-31");
  assert.equal(mem["1|ישן"], undefined);
  const g = [P("1", "2026-11-06T08:00", "חדש", "תקציר אמיתי")];
  assert.equal(applyMemory(mem, g), 0);
  assert.equal(g[0].desc, "תקציר אמיתי");
});
