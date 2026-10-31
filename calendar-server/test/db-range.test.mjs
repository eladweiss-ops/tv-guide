import { test } from "node:test";
import assert from "node:assert/strict";
import { firestoreBackend } from "../api/_db.js";

// listRange עם FieldPath: שאילתת טווח על מזהה המסמך, לא קריאה של כל האוסף
test("firestoreBackend.listRange: where(documentId) >= lo, < hi, בלי collection().get() מלא", async () => {
  const docs = ["a__1", "a__2", "b__1"].map((id) => ({ id, data: () => ({ v: JSON.stringify({ id }) }) }));
  let fullScan = 0; const ops = [];
  const q = (conds) => ({
    where: (f, op, val) => { ops.push([f, op, val]); return q([...conds, [op, val]]); },
    limit: () => q(conds),
    get: async () => {
      if (!conds.length) fullScan++;
      return { docs: docs.filter((d) => conds.every(([op, v]) => (op === ">=" ? d.id >= v : d.id < v))) };
    },
  });
  const client = { collection: () => q([]) };
  const FieldPath = { documentId: () => "__id__" };
  const b = firestoreBackend(client, FieldPath);
  const rows = await b.listRange("prsvp", "a__", "a__");
  assert.deepEqual(rows.map((r) => r.id), ["a__1", "a__2"]);
  assert.equal(fullScan, 0);
  assert.deepEqual(ops.map((o) => o[0]), ["__id__", "__id__"]);
});
