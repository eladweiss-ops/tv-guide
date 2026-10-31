// node --test calendar-server/test/*.mjs  - שכבת האחסון (_db.js): חוזה ה-backend (דמה בזיכרון מול firestoreBackend), מיפוי נתיבים, כתיבה בלי שינוי, וחוסר אישורים
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { memBackend, fakeFirestoreClient, failingBackend } from "./helpers/fakedb.mjs";

delete process.env.FIREBASE_SERVICE_ACCOUNT;
const db = await import("../api/_db.js");
const { mapPath, readJson, writeJson, delJson, listJson, firestoreBackend, _setBackend } = db;
const HASH = "0123456789abcdef01234567";

test("mapPath: אוסף לכל קידומת, נתיב מקונן הופך למזהה אחד בלי '/'", () => {
  assert.deepEqual(mapPath("rems/abc.json"), { col: "rems", id: "abc" });
  assert.deepEqual(mapPath("push/abc.json"), { col: "push", id: "abc" });
  assert.deepEqual(mapPath("backup/abc.json"), { col: "backup", id: "abc" });
  assert.deepEqual(mapPath("sched/abc.json"), { col: "sched", id: "abc" });
  assert.deepEqual(mapPath(`snz/abc/${HASH}.json`), { col: "snz", id: `abc__${HASH}` });
  for (const bad of ["x.json", "/a.json", "rems//a.json", "Rems/a.json", "rems/__a__.json", "rems/..", "rems/"]) assert.throws(() => mapPath(bad), /bad storage path/, bad);
});

// אותו סט בדיקות על שני ה-backends: אם הדמה והאמיתי חורגים זה מזה, זה ייכשל כאן
const impls = {
  "בזיכרון": () => memBackend(),
  "firestoreBackend על לקוח מדומה": () => firestoreBackend(fakeFirestoreClient()),
};
for (const [name, mk] of Object.entries(impls)) {
  test(`חוזה backend (${name}): get/set/del/list`, async () => {
    const b = mk();
    assert.equal(await b.get("rems", "a"), null);
    await b.set("rems", "a", '{"x":1}');
    await b.set("rems", "b", "[]");
    await b.set("snz", `a__${HASH}`, "{}");
    assert.equal(await b.get("rems", "a"), '{"x":1}');
    assert.deepEqual((await b.list("rems")).sort((x, y) => x.id.localeCompare(y.id)), [{ id: "a", v: '{"x":1}' }, { id: "b", v: "[]" }]);
    assert.deepEqual(await b.list("push"), []);
    await b.del("rems", "a");
    assert.equal(await b.get("rems", "a"), null);
    await b.del("rems", "never-existed"); // לא זורק
  });

  test(`readJson/writeJson/delJson/listJson (${name}): אותו ממשק כמו בלוב`, async () => {
    _setBackend(mk());
    assert.deepEqual(await readJson("rems/t1.json", []), []);
    assert.equal(await readJson("sched/t1.json", null), null);
    await writeJson("rems/t1.json", [{ k: "a" }]);
    await writeJson("sched/t1.json", { "k#s": { at: 1, id: "m" }, __q: { d: 1, n: 2 }, "5|123": { at: 2 } });
    await writeJson(`snz/t1/${HASH}.json`, { at: 5, id: "m", ts: 1, m: 5 });
    assert.deepEqual(await readJson("rems/t1.json", []), [{ k: "a" }]);
    assert.deepEqual((await readJson("sched/t1.json", {}))["5|123"], { at: 2 }); // מפתחות עם תווים מיוחדים נשמרים
    assert.deepEqual(await readJson(`snz/t1/${HASH}.json`, null), { at: 5, id: "m", ts: 1, m: 5 });
    assert.deepEqual((await listJson("rems")).map((r) => r.id), ["t1"]);
    assert.deepEqual((await listJson("snz"))[0].id, `t1__${HASH}`);
    await delJson("rems/t1.json");
    assert.deepEqual(await readJson("rems/t1.json", "dflt"), "dflt");
    // ערך שנכתב הוא עותק: שינוי האובייקט אחרי הכתיבה לא משנה את האחסון
    const o = { a: 1 }; await writeJson("rems/t2.json", o); o.a = 2;
    assert.deepEqual(await readJson("rems/t2.json", null), { a: 1 });
    _setBackend(null);
  });

  test(`writeJson (${name}): מסמך שלא השתנה לא נכתב שוב; ערך חדש נכתב`, async () => {
    const b = mk(); let sets = 0; const set = b.set;
    b.set = async (...a) => { sets++; return set.apply(b, a); };
    _setBackend(b);
    assert.equal(await writeJson("rems/t.json", [1]), true);
    assert.equal(await writeJson("rems/t.json", [1]), false);
    assert.equal(await writeJson("rems/t.json", [2]), true);
    assert.equal(sets, 2);
    await assert.rejects(writeJson("rems/big.json", "x".repeat(950000)), /too big/);
    _setBackend(null);
  });
}

test("firestoreBackend: המסמך הוא {v: מחרוזת, at: Date} ומזהה עם '/' נדחה", async () => {
  const c = fakeFirestoreClient(), b = firestoreBackend(c);
  await b.set("rems", "a", "[]");
  const d = c.data.get("rems/a");
  assert.equal(d.v, "[]"); assert.ok(d.at instanceof Date);
  await assert.rejects(b.set("snz", "a/b", "{}"), /invalid document id/);
});

test("חוסר אישורים: readJson/writeJson נכשלים עם 'missing FIREBASE_SERVICE_ACCOUNT' ולוג ברור, ו-handler מחזיר 500 גנרי", async () => {
  _setBackend(null);
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(" "));
  try {
    await assert.rejects(readJson("rems/t.json", []), /missing FIREBASE_SERVICE_ACCOUNT/);
    await assert.rejects(writeJson("rems/t.json", []), /missing FIREBASE_SERVICE_ACCOUNT/);
    assert.ok(logs.some((l) => l.includes("missing FIREBASE_SERVICE_ACCOUNT")));
    const remsH = (await import("../api/rems.js")).default;
    const r = { code: 0, headers: {}, setHeader() { return r; }, status(c) { r.code = c; return r; }, json(o) { r.body = o; return r; }, end() { return r; } };
    await remsH({ method: "GET", headers: {}, query: { t: "abcdefghij0123456789abcd" } }, r);
    assert.equal(r.code, 500); assert.deepEqual(r.body, { error: "server error" });
    process.env.FIREBASE_SERVICE_ACCOUNT = "not json";
    await assert.rejects(readJson("rems/t.json", []), /bad FIREBASE_SERVICE_ACCOUNT/);
    // כישלון אתחול לא נשמר: ניסיון הבא מנסה שוב ולא נתקע
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    await assert.rejects(readJson("rems/t.json", []), /missing FIREBASE_SERVICE_ACCOUNT/);
  } finally { console.error = orig; delete process.env.FIREBASE_SERVICE_ACCOUNT; }
});

test("שגיאת אחסון מתפשטת (backend נופל)", async () => {
  _setBackend(failingBackend("boom"));
  await assert.rejects(readJson("rems/t.json", []), /boom/);
  _setBackend(null);
});

test("אין יותר שימוש ב-@vercel/blob בקוד השרת, והתלות הוסרה מ-dependencies", () => {
  const dir = new URL("../api/", import.meta.url);
  for (const f of readdirSync(dir)) assert.ok(!/@vercel\/blob/.test(readFileSync(new URL(f, dir), "utf8")), f);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(!(pkg.dependencies || {})["@vercel/blob"]);
  assert.ok(pkg.dependencies["firebase-admin"]);
});

test("handlers מול הדמה: rems שמירה/קריאה, backup זהה לא נכתב שוב", async () => {
  const b = memBackend(); let sets = 0; const set = b.set; b.set = async (...a) => { sets++; return set.apply(b, a); };
  _setBackend(b);
  const { _resetLimits } = await import("../api/_guard.js");
  _resetLimits();
  const mk = (o) => ({ method: "POST", headers: { "x-real-ip": "7.7.7.7" }, query: {}, body: {}, ...o });
  const res = () => { const r = { code: 200, headers: {}, setHeader(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(o) { r.body = o; return r; }, end() { return r; } }; return r; };
  const T = "dbroundtrip0123456789abcd", now = Date.now();
  const rem = { k: "5|1", title: "x", ch: "c", ts: now + 3600000, end: now + 7200000, lead: 10 };
  const remsH = (await import("../api/rems.js")).default, bkH = (await import("../api/backup.js")).default;
  let r = res(); await remsH(mk({ body: { t: T, rems: [rem] } }), r); assert.equal(r.code, 200);
  r = res(); await remsH(mk({ method: "GET", query: { t: T } }), r); assert.deepEqual(r.body.rems.map((x) => x.k), ["5|1"]);
  const before = sets;
  r = res(); await remsH(mk({ body: { t: T, rems: [rem] } }), r);
  assert.equal(sets, before, "שמירה זהה לא כותבת שוב");
  r = res(); await bkH(mk({ body: { t: T, data: { "tvg.sel": "[1]" } } }), r); assert.equal(r.code, 200);
  const s1 = sets;
  r = res(); await bkH(mk({ body: { t: T, data: { "tvg.sel": "[1]" } } }), r); assert.equal(r.code, 200);
  assert.equal(sets, s1, "גיבוי זהה לא נכתב שוב");
  r = res(); await bkH(mk({ method: "GET", query: { t: T } }), r); assert.equal(r.body.data["tvg.sel"], "[1]");
  r = res(); await bkH(mk({ method: "GET", query: { t: "nobackup0123456789abcdefg" } }), r); assert.equal(r.code, 404);
  _setBackend(null);
});
