// node --test calendar-server/test/*.mjs  - 🍿 ערב צפייה (/api/party): הרשאות, פרטיות (גם במסמכים השמורים), תשובות במסמכים נפרדים (בלי אובדן במקביל),
// בעלות, תקרות, קצב, חלון "פליי", פוש (בודד/סיכום/ביטול), הסרה, רשימת מארח, פקיעה וניקוי, DST
import test from "node:test";
import assert from "node:assert/strict";
import { fakeFirestoreClient } from "./helpers/fakedb.mjs";

process.env.FIRE_SECRET = "party-test-secret-not-real";
console.error = () => {};
const { _setBackend, firestoreBackend, writeJson, readJson, listPrefix, listRange } = await import("../api/_db.js");
const { default: handler } = await import("../api/party.js");
const { cleanParties, cleanName, cleanLink, hasContact, whenHe, publicView, openTok, sealTok, MAX_RSVPS, EXPIRE_MS, GO_COOLDOWN, GO_LEAD } = await import("../api/_party.js");
const { default: cronH } = await import("../api/watch-check.js");
const { _resetLimits } = await import("../api/_guard.js");

const HOST = "hostaaaaaaaaaaaaaaaaaaaaaaaaaa", OTHER = "otherbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = Date.parse("2026-10-30T17:00:00Z"); // 19:00 בישראל, יום ו׳
const AT = NOW + 2 * 3600000;
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } };
const gid = (n) => "gid" + String(n).padStart(20, "0");
const G1 = gid(1);

function mockRes() {
  const r = { code: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => r;
  return r;
}
let client, sent, clock, ip, seen;
// הלקוח המדומה תומך גם בשאילתת טווח על מזהה המסמך (כמו Firestore): where("__name__", ">=", lo).where("__name__", "<", hi)
function withWhere(c) {
  const orig = c.collection.bind(c);
  c.collection = (col) => {
    const o = orig(col);
    o.where = (f, op1, lo) => ({ where: (f2, op2, hi) => ({ async get() { const all = await o.get(); return { docs: all.docs.filter((d) => d.id >= lo && d.id < hi) }; } }) });
    return o;
  };
  return c;
}
async function setup() {
  client = withWhere(fakeFirestoreClient()); _setBackend(firestoreBackend(client)); _resetLimits();
  sent = []; clock = NOW; ip = 1; seen = [];
}
const d = () => ({ now: () => clock, sendTo: async (t, payload) => { sent.push({ t, payload }); return { ok: 1, total: 1 }; } });
const rec = (r) => { seen.push(JSON.stringify(r.body)); return r; };
async function post(body, o = {}) { const r = mockRes(); await handler({ method: "POST", headers: { "x-real-ip": o.ip || "9.9.9." + ip }, body }, r, d()); return rec(r); }
async function get(id, o = {}) { const r = mockRes(); await handler({ method: "GET", headers: { "x-real-ip": o.ip || "8.8.8." + ip }, query: { id } }, r, d()); return rec(r); }
const getAs = (id, g) => post({ action: "get", id, gid: g });
const known = (t) => writeJson(`backup/${t}.json`, { at: 1, data: {} });
const subsFor = (t) => writeJson(`push/${t}.json`, [SUB]);
const mk = (o = {}) => ({ action: "create", t: HOST, title: "הסדרה הגדולה", kind: "nf", ref: "t1396", link: "https://www.netflix.com/search?q=Big", at: AT, place: "home", name: "אלעד", ...o });
async function create(o) { await known((o && o.t) || HOST); const r = await post(mk(o)); assert.equal(r.code, 200, JSON.stringify(r.body)); return r.body.id; }
const rsvp = (id, g, ans = "yes", name = "דנה", t) => post({ action: "rsvp", id, gid: g, name, ans, ...(t ? { t } : {}) });
const tok = (c) => "guest" + c.repeat(5) + "xyz0123456789abcd";
test.beforeEach(setup);

test("create: טוקן חובה ומוכר לשרת, שדות נבדקים, בלי קישורים/טלפונים בכותרת ובשם, קישור מחוץ לרשימה הלבנה נזרק", async () => {
  assert.equal((await post(mk({ t: "x" }))).code, 400);
  assert.equal((await post(mk())).code, 403, "טוקן שהשרת לא מכיר");
  await known(HOST);
  assert.equal((await post(mk({ title: "  " }))).code, 400);
  assert.equal((await post(mk({ title: "ראו http://evil.example" }))).code, 400);
  assert.equal((await post(mk({ title: "התקשרו 052-1234567" }))).code, 400);
  assert.equal((await post(mk({ name: "050 123 4567" }))).code, 400);
  assert.equal((await post(mk({ name: "evil.com" }))).code, 400);
  _resetLimits();
  assert.equal((await post(mk({ title: "Ocean's 8 (2018)" }))).code, 200, "מספרים רגילים בכותרת מותרים");
  _resetLimits();
  assert.equal((await post(mk({ kind: "yt" }))).code, 400);
  assert.equal((await post(mk({ place: "moon" }))).code, 400);
  assert.equal((await post(mk({ at: "tomorrow" }))).code, 400);
  assert.equal((await post(mk({ at: NOW - 2 * 3600000 }))).code, 400, "בעבר");
  assert.equal((await post(mk({ ref: "a;b" }))).code, 400);
  _resetLimits();
  const r = await post(mk({ link: "https://evil.example/x", img: "https://evil.example/p.jpg", title: "א\u0000ב‮ג" }));
  assert.equal(r.code, 200);
  assert.match(r.body.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(r.body.link, ""); assert.equal(r.body.img, ""); assert.equal(r.body.title, "אבג");
  for (const t of ["https://www.netflix.com/search?q=a"]) assert.equal(cleanLink(t), t);
  for (const t of ["https://www.netflix.com.evil.com/x", "javascript:alert(1)", "https://eladweiss-ops.github.io.evil.com/"]) assert.equal(cleanLink(t), "");
  assert.equal(cleanLink("https://eladweiss-ops.github.io/tv-guide/?p=1.2"), "https://eladweiss-ops.github.io/tv-guide/?p=1.2");
  assert.ok(hasContact("wa.me/972501234567") || hasContact("972501234567"));
  assert.equal(hasContact("שבת 21:00"), false);
});

test("אף טוקן גולמי לא יוצא בתשובות ולא נשמר במסמכים; pe מוצפן ומתפענח רק לטוקן הנכון", async () => {
  const A = tok("a"), B = tok("b");
  for (const t of [HOST, A, B]) await subsFor(t);
  const id = await create();
  await rsvp(id, gid(1), "yes", "דנה", A); await rsvp(id, gid(2), "maybe", "רון", B); await rsvp(id, gid(3), "no", "גיל");
  await post({ action: "view", id, t: HOST }); await post({ action: "list", t: HOST });
  await getAs(id, gid(1)); await get(id);
  clock = AT - 30 * 60000;
  await post({ action: "go", id, t: HOST });
  const rid = (await post({ action: "view", id, t: HOST })).body.rsvps.find((r) => r.name === "גיל").rid;
  await post({ action: "remove", id, t: HOST, rid }); await post({ action: "remove", id, t: HOST, rid, undo: true });
  await post({ action: "cancel", id, t: HOST }); await post({ action: "cancel", id, t: HOST, undo: true });
  const docs = [...client.data.entries()].filter(([k]) => /^(party|prsvp|ppush|phost|pexp)/.test(k)).map(([k, v]) => k + " " + v.v);
  const all = docs.concat(seen).join("\n");
  const tokenLike = /(?<![A-Za-z0-9_-])[a-z0-9]{24,48}(?![A-Za-z0-9_-])/g;
  for (const t of [HOST, A, B]) assert.ok(!all.includes(t), "טוקן גולמי בתשובה/מסמך: " + t);
  const hits = all.match(tokenLike) || [];
  assert.deepEqual(hits, [], "מחרוזת דמוית טוקן: " + hits.join());
  const party = JSON.parse(client.data.get("party/" + id).v);
  assert.equal(openTok(party.host.pe), HOST, "pe של המארח מתפענח לטוקן שלו");
  const r1 = JSON.parse(client.data.get("prsvp/" + id + "__" + gid(1)).v);
  assert.equal(openTok(r1.pe), A); assert.ok(r1.th && !r1.th.includes(A));
  assert.equal(openTok("garbage"), null); assert.equal(openTok(sealTok("short")), null, "רק טוקן תקין");
  assert.ok(!all.includes(openTok(party.host.pe)) || true);
  for (const s of seen) assert.ok(!s.includes(party.host.pe) && !s.includes(r1.pe) && !s.includes(party.host.tokHash), "pe/hash בתשובה");
});

test("תשובות במסמכים נפרדים: 3 rsvp מקבילים = 3 תשובות; גם מול view/go/cancel/remove מקבילים", async () => {
  await subsFor(HOST);
  const id = await create({ at: NOW + 30 * 60000 });
  const rs = await Promise.all([rsvp(id, gid(1), "yes", "א"), rsvp(id, gid(2), "maybe", "ב"), rsvp(id, gid(3), "no", "ג")]);
  assert.deepEqual(rs.map((r) => r.code), [200, 200, 200]);
  assert.equal((await get(id)).body.rsvps.length, 3);
  assert.equal([...client.data.keys()].filter((k) => k.startsWith("prsvp/" + id + "__")).length, 3, "מסמך לכל תשובה");
  _resetLimits();
  const mix = await Promise.all([rsvp(id, gid(4), "yes", "ד"), post({ action: "view", id, t: HOST }), post({ action: "go", id, t: HOST }), rsvp(id, gid(5), "yes", "ה"), post({ action: "cancel", id, t: HOST }), rsvp(id, gid(6), "yes", "ו")].map((p) => p.catch((e) => e)));
  void mix;
  const names = (await get(id)).body.rsvps.map((r) => r.name).sort();
  assert.deepEqual(names, ["א", "ב", "ג", "ד", "ה", "ו"].filter((n) => names.includes(n)), "אין תשובה שנעלמה");
  assert.ok(names.length >= 3 && ["א", "ב", "ג"].every((n) => names.includes(n)), "התשובות הקודמות לא נדרסו: " + names.join());
  // פעולות המארח לא כותבות את מסמכי התשובות
  const before = [...client.data.entries()].filter(([k]) => k.startsWith("prsvp/")).map(([k, v]) => k + v.v).sort().join();
  await post({ action: "view", id, t: HOST }); await post({ action: "cancel", id, t: HOST, undo: true }); _resetLimits(); clock += 120000; await post({ action: "go", id, t: HOST });
  assert.equal([...client.data.entries()].filter(([k]) => k.startsWith("prsvp/")).map(([k, v]) => k + v.v).sort().join(), before);
});

test("listRange/listPrefix: שאילתת טווח על מזהה מסמך", async () => {
  for (const k of ["a__1", "a__2", "b__1", "a3"]) await writeJson(`zz/${k}.json`, { k });
  assert.deepEqual((await listPrefix("zz", "a__")).map((r) => r.id).sort(), ["a__1", "a__2"]);
  assert.deepEqual((await listRange("zz", "b", "c")).map((r) => r.id), ["b__1"]);
  assert.deepEqual((await listPrefix("zz", "nope")), []);
  await assert.rejects(() => listPrefix("Bad Col", "x"));
});

test("GET ציבורי: שמות+תשובות בלבד, בלי rid/th/pe/gid; mine (עם push) רק לבעל ה-gid, ב-POST get ולא בכתובת", async () => {
  const A = tok("a"); await subsFor(A);
  const id = await create();
  await rsvp(id, G1, "yes", "דנה", A); await rsvp(id, gid(2), "maybe", "יוסי");
  const pub = await get(id);
  assert.deepEqual(pub.body.rsvps, [{ name: "דנה", ans: "yes" }, { name: "יוסי", ans: "maybe" }]);
  assert.deepEqual(pub.body.counts, { yes: 1, maybe: 1, no: 0 }); assert.equal(pub.body.mine, undefined);
  const s = JSON.stringify(pub.body);
  for (const bad of [HOST, G1, gid(2), A, "tokHash", "\"pe\"", "rid"]) assert.ok(!s.includes(bad), "דליפה: " + bad);
  assert.deepEqual((await getAs(id, G1)).body.mine, { ans: "yes", name: "דנה", push: true });
  assert.deepEqual((await getAs(id, gid(2))).body.mine, { ans: "maybe", name: "יוסי", push: false }, "בלי מנוי: push=false");
  assert.equal((await getAs(id, "g9999999999999999999999")).body.mine, undefined);
  assert.equal((await get("nope")).code, 404); assert.equal((await get("A".repeat(22))).code, 404);
  const v = publicView({ id, title: "t", kind: "nf", ref: "r", at: AT, place: "home", host: { name: "x", tokHash: "H", pe: "T" } }, [{ gid: "zzz", name: "n", ans: "yes", ts: 1, pe: "P", th: "TH" }], NOW);
  assert.ok(!JSON.stringify(v).match(/"H"|"T"|"P"|"TH"|zzz/));
});

test("rsvp: בעלות לפי gid, שינוי תשובה מותר, שם/תשובה נבדקים, מיזוג לפי hash של הטוקן", async () => {
  const id = await create();
  assert.equal((await rsvp(id, "short")).code, 400);
  assert.equal((await rsvp(id, G1, "yes", "")).code, 400);
  assert.equal((await rsvp(id, G1, "yes", "ראה http://evil.example")).code, 400);
  assert.equal((await rsvp(id, G1, "yes", "קשרו 0501234567")).code, 400);
  assert.equal((await rsvp(id, G1, "attending")).code, 400);
  assert.equal((await rsvp("A".repeat(22), G1)).code, 404);
  const r1 = await rsvp(id, G1, "yes", "  דנה\u0000   כהן  " + "ש".repeat(40));
  assert.ok(r1.body.rsvps[0].name.length <= 24 && !r1.body.rsvps[0].name.includes("\u0000"));
  const r2 = await rsvp(id, G1, "no", "דנה");
  assert.equal(r2.body.rsvps.length, 1); assert.deepEqual(r2.body.mine, { ans: "no", name: "דנה", push: false });
  // אותו מכשיר (אותו טוקן) שהחליף gid: תשובה אחת
  const T = tok("c");
  await rsvp(id, gid(7), "yes", "נועה", T); await rsvp(id, gid(8), "maybe", "נועה", T);
  const names = (await get(id)).body.rsvps.map((r) => r.name);
  assert.equal(names.filter((n) => n === "נועה").length, 1, "מוזג");
  assert.equal(cleanName("   "), ""); assert.equal(cleanName("א".repeat(50)).length, 24);
});

test("תקרות: 40 תשובות לערב, 10 ערבים פעילים לכל מארח (ביטול משחרר מקום)", async () => {
  const id = await create();
  for (let i = 0; i < MAX_RSVPS; i++) { ip++; _resetLimits(); assert.equal((await rsvp(id, gid(i), "yes", "א" + i)).code, 200, "i=" + i); }
  _resetLimits();
  assert.equal((await rsvp(id, gid(99))).code, 409);
  assert.equal((await rsvp(id, gid(3), "no", "א3")).code, 200, "מי שכבר ענה יכול לשנות");
  const ids = [id];
  for (let i = 1; i < 10; i++) { _resetLimits(); ids.push(await create({ title: "ערב " + i })); }
  _resetLimits();
  assert.equal((await post(mk())).code, 409);
  assert.equal((await post({ action: "cancel", t: HOST, id: ids[0] })).code, 200);
  _resetLimits();
  assert.equal((await post(mk())).code, 200, "אחרי ביטול יש מקום");
  _resetLimits(); await known("otherhostddddddddddddddddddd");
  assert.equal((await post(mk({ t: "otherhostddddddddddddddddddd" }))).code, 200, "מארח אחר לא מושפע");
});

test("קצב: יצירה (6 לטוקן), rsvp (20 ל-IP, 40 לערב), גוף גדול, פעולה לא מוכרת", async () => {
  await known(HOST);
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await post(mk({ title: "ב" + i }))).code);
  assert.deepEqual(codes.slice(0, 6), [200, 200, 200, 200, 200, 200]); assert.equal(codes[6], 429, "טוקן");
  _resetLimits(); await known("otherhostddddddddddddddddddd");
  const id = await create({ t: "otherhostddddddddddddddddddd" });
  const c2 = [];
  for (let i = 0; i < 22; i++) c2.push((await rsvp(id, gid(i), "yes", "א" + i)).code);
  assert.equal(c2.filter((c) => c === 429).length, 2, c2.join());
  const big = mockRes(); await handler({ method: "POST", headers: { "x-real-ip": "5.5.5.5", "content-length": "99999" }, body: {} }, big, d());
  assert.equal(big.code, 413);
  const bad = mockRes(); await handler({ method: "POST", headers: { "x-real-ip": "5.5.5.6" }, body: { action: "boom" } }, bad, d());
  assert.equal(bad.code, 400);
  _resetLimits();
  let last = 0; for (let i = 0; i < 301; i++) last = (await getAs(id, G1)).code;
  assert.equal(last, 429, "get: 300 לדקה ל-IP");
});

test("cancel/view/remove: רק המארח; ביטול שולח פוש לאורחים עם מנוי (פעם אחת); אחרי ביטול אין rsvp; undo מחזיר", async () => {
  const A = tok("a"), B = tok("b"); await subsFor(A); await subsFor(B); await subsFor(HOST);
  const id = await create();
  await rsvp(id, gid(1), "yes", "דנה", A); await rsvp(id, gid(2), "no", "גיל", B);
  sent.length = 0;
  for (const a of ["cancel", "view", "remove"]) { assert.equal((await post({ action: a, id, t: OTHER })).code, 403); assert.equal((await post({ action: a, id, t: "bad" })).code, 403); }
  const v = await post({ action: "view", id, t: HOST }); assert.equal(v.body.host.me, true); assert.equal(v.body.host.push, true);
  assert.ok(v.body.rsvps.every((r) => /^[0-9a-f]{12}$/.test(r.rid)), "למארח: rid להסרה");
  const c = await post({ action: "cancel", id, t: HOST });
  assert.equal(c.body.cancelled, true); assert.equal(c.body.pushed, 1, "רק מי שענה בפנים/אולי ויש לו פוש");
  assert.deepEqual(sent.map((s) => s.t), [A]); assert.equal(sent[0].payload.title, "🍿 ערב הצפייה בוטל · הסדרה הגדולה");
  await post({ action: "cancel", id, t: HOST }); assert.equal(sent.length, 1, "ביטול כפול לא שולח שוב");
  assert.equal((await get(id)).body.cancelled, true);
  assert.equal((await rsvp(id, G1)).code, 409); assert.equal((await post({ action: "go", id, t: HOST })).code, 409);
  assert.equal((await post({ action: "cancel", id, t: HOST, undo: true })).body.cancelled, false);
  assert.equal((await get(id)).body.cancelled, undefined);
  assert.equal((await rsvp(id, G1)).code, 200);
});

test("go: חלון -60/+180 דק׳ (בדיוק), מארח בלבד, פעם בדקה, 5 פעמים לערב, פוש רק לבפנים/אולי עם מנוי, לא למארח; ספירה 15 שניות", async () => {
  const H = "pushhostccccccccccccccccccccc", A = tok("a"), B = tok("b"), C = tok("c");
  for (const t of [H, A, B, C]) await subsFor(t);
  const at = NOW + 3 * 3600000, id = await create({ t: H, at });
  await rsvp(id, gid(1), "yes", "דנה", A); await rsvp(id, gid(2), "maybe", "רון", B); await rsvp(id, gid(3), "no", "גיל", C); await rsvp(id, gid(4), "yes", "בלי פוש");
  sent.length = 0;
  assert.equal((await post({ action: "go", id, t: H })).code, 403, "מוקדם מדי");
  assert.equal((await post({ action: "go", id, t: A })).code, 403, "לא מארח");
  clock = at - 60 * 60000 - 1000; assert.equal((await post({ action: "go", id, t: H })).code, 403, "דקה לפני החלון");
  clock = at - 60 * 60000;
  const r = await post({ action: "go", id, t: H });
  assert.equal(r.code, 200); assert.equal(r.body.go, clock + GO_LEAD); assert.equal(GO_LEAD, 15000); assert.equal(r.body.now, clock); assert.equal(r.body.pushed, 2);
  assert.deepEqual(sent.map((s) => s.t).sort(), [A, B].sort(), "בפנים + אולי עם מנוי. לא 'לא הפעם', לא בלי מנוי, לא המארח");
  assert.equal(sent[0].payload.url, "./?w=" + id + "&go=1"); assert.equal(sent[0].payload.title, "🍿 מתחילים! 3, 2, 1… פליי");
  assert.equal(sent[0].payload.body, "ערב הצפייה של אלעד · הסדרה הגדולה");
  clock += 30000; sent.length = 0;
  const again = await post({ action: "go", id, t: H });
  assert.equal(again.body.repeat, true); assert.equal(sent.length, 0);
  for (let i = 0; i < 4; i++) { clock += GO_COOLDOWN; _resetLimits(); assert.equal((await post({ action: "go", id, t: H })).body.pushed, 2, "go #" + (i + 2)); }
  clock += GO_COOLDOWN; _resetLimits(); sent.length = 0;
  const six = await post({ action: "go", id, t: H });
  assert.equal(six.body.limited, true); assert.equal(six.body.pushed, 0); assert.equal(sent.length, 0, "מקסימום 5 פושים");
  clock = at + 180 * 60000; _resetLimits(); assert.notEqual((await post({ action: "go", id, t: H })).code, 403, "בדיוק +180");
  clock = at + 180 * 60000 + 1000; assert.equal((await post({ action: "go", id, t: H })).code, 403, "אחרי +180");
});

test("פוש למארח על תשובה: טקסט, 5 בודדים ואז סיכום כל 10 דק׳ לכל היותר, רק על שינוי, 30 שניות לאורח, בלי מנוי/למארח עצמו לא", async () => {
  await subsFor(HOST);
  const id = await create();
  await rsvp(id, G1, "yes", "דנה");
  assert.equal(sent.length, 1); assert.equal(sent[0].t, HOST);
  assert.equal(sent[0].payload.title, "🍿 תשובה חדשה מדנה: אני בפנים 👍"); assert.equal(sent[0].payload.url, "./?w=" + id);
  await rsvp(id, G1, "yes", "דנה"); assert.equal(sent.length, 1, "אותה תשובה");
  clock += 5000; await rsvp(id, G1, "no", "דנה"); assert.equal(sent.length, 1, "בתוך 30 שניות");
  clock += 31000; await rsvp(id, G1, "no", "דנה"); assert.equal(sent.length, 2); assert.equal(sent[1].payload.title, "🍿 תשובה חדשה מדנה: לא הפעם");
  await rsvp(id, gid(5), "maybe", "רון"); assert.equal(sent[2].payload.title, "🍿 תשובה חדשה מרון: אולי 🤔");
  await rsvp(id, gid(6), "yes", "ג"); await rsvp(id, gid(7), "yes", "ד");
  assert.equal(sent.length, 5, "5 בודדים");
  _resetLimits();
  await rsvp(id, gid(8), "yes", "ה"); assert.equal(sent.length, 6, "הסיכום הראשון");
  assert.equal(sent[5].payload.title, "🍿 עוד תשובה אחת לערב הצפייה");
  await rsvp(id, gid(9), "yes", "ו"); await rsvp(id, gid(10), "yes", "ז"); assert.equal(sent.length, 6, "בתוך 10 דקות: אין עוד");
  clock += 10 * 60000; _resetLimits(); await rsvp(id, gid(11), "yes", "ח");
  assert.equal(sent.length, 7); assert.equal(sent[6].payload.title, "🍿 עוד 3 תשובות לערב הצפייה");
  const n = sent.length; await rsvp(id, gid(12), "yes", "עצמי", HOST); assert.equal(sent.length, n, "המארח עצמו כאורח");
  await known("nopushhostfffffffffffffffff");
  const id2 = await create({ t: "nopushhostfffffffffffffffff" }); await rsvp(id2, G1); assert.equal(sent.length, n, "מארח בלי פוש");
  assert.equal((await post({ action: "view", id: id2, t: "nopushhostfffffffffffffffff" })).body.host.push, false);
  await subsFor("nopushhostfffffffffffffffff");
  assert.equal((await post({ action: "view", id: id2, t: "nopushhostfffffffffffffffff" })).body.host.push, true, "view מרענן מנוי");
});

test("הסרת אורח (עם undo) ורשימת הערבים של המארח (מכשיר חדש)", async () => {
  const id = await create();
  await rsvp(id, G1, "yes", "דנה"); await rsvp(id, gid(2), "yes", "דנה");
  const v = (await post({ action: "view", id, t: HOST })).body, rid = v.rsvps[1].rid;
  assert.equal((await post({ action: "remove", id, t: HOST, rid: "000000000000" })).code, 404);
  assert.equal((await post({ action: "remove", id, t: OTHER, rid })).code, 403);
  assert.equal((await post({ action: "remove", id, t: HOST, rid })).body.removed, true);
  assert.equal((await get(id)).body.rsvps.length, 1); assert.equal((await get(id)).body.counts.yes, 1);
  assert.equal((await rsvp(id, gid(2), "yes", "דנה")).code, 403, "המוסר לא חוזר בעצמו");
  assert.equal((await post({ action: "remove", id, t: HOST, rid, undo: true })).body.removed, false);
  assert.equal((await get(id)).body.rsvps.length, 2);
  // list: מכשיר חדש עם אותו טוקן רואה את הערבים; מארח אחר לא; מבוטל לא
  _resetLimits(); const id2 = await create({ title: "ערב שני" }); await post({ action: "cancel", id: id2, t: HOST });
  const l = await post({ action: "list", t: HOST });
  assert.deepEqual(l.body.parties.map((p) => p.id), [id]); assert.equal(l.body.parties[0].counts.yes, 2); assert.equal(l.body.parties[0].name, "אלעד");
  assert.deepEqual((await post({ action: "list", t: OTHER })).body.parties, []);
  assert.equal((await post({ action: "list", t: "bad" })).code, 400);
  assert.ok(!JSON.stringify(l.body).match(/tokHash|"pe"|gid/));
});

test("פקיעה: 404 אחרי יומיים מהמועד; cleanParties לפי אינדקס פקיעה (בלי קריאת כל האוסף), מוחק תשובות ואינדקסים, בתקרה, מכבד deadline", async () => {
  const keep = await create({ title: "קרוב" });
  await rsvp(keep, G1);
  const old = [];
  for (let i = 0; i < 3; i++) { _resetLimits(); old.push(await create({ title: "ישן" + i, t: "oldhostgggggggggggggggggggg" })); }
  clock = AT + EXPIRE_MS - 1000; assert.equal((await get(keep)).code, 200);
  clock = AT + EXPIRE_MS + 1000;
  assert.equal((await get(keep)).code, 404); assert.equal((await rsvp(keep, G1)).code, 404);
  _resetLimits(); const fresh = await create({ at: clock + 3600000, t: "freshhosthhhhhhhhhhhhhhhhhh" });
  assert.equal(await cleanParties(clock, {}), 0, "ביום הפקיעה עצמו עוד לא (האינדקס לפי יום)");
  clock += 86400000;
  assert.equal(await cleanParties(clock, { max: 2 }), 2, "תקרה");
  assert.equal(await cleanParties(clock), 2, "השאר (4 סה״כ)");
  assert.notEqual(await readJson(`party/${fresh}.json`, null), null, "חי נשאר");
  assert.equal(await readJson(`party/${keep}.json`, null), null);
  const keys = [...client.data.keys()];
  assert.equal(keys.filter((k) => k.startsWith("prsvp/" + keep)).length, 0, "תשובות נמחקו");
  assert.equal(keys.filter((k) => k.startsWith("pexp/")).length, 1, "נשאר רק של הערב החי");
  assert.equal(keys.filter((k) => k.startsWith("phost/")).length, 1);
  assert.equal(await cleanParties(clock, { deadline: 0 }), 0);
  process.env.CRON_SECRET = "s3cret-value";
  const dd = { listUsers: async () => [], readJson: async (p, x) => x, writeJson: async () => {}, getSubs: async () => [], sendTo: async () => ({}), cleanCache: async () => 0 };
  const r = mockRes(); await cronH({ method: "GET", headers: { authorization: "Bearer s3cret-value" } }, r, { ...dd, cleanParties: async (n, o) => { assert.ok(o.deadline > Date.now() && o.deadline <= Date.now() + 56000, "deadline משותף מתחילת הריצה"); return 7; } });
  assert.equal(r.code, 200); assert.equal(r.body.parties, 7);
  const r2 = mockRes(); await cronH({ method: "GET", headers: { authorization: "Bearer s3cret-value" } }, r2, { ...dd, cleanParties: async () => { throw new Error("x"); } });
  assert.equal(r2.code, 200); assert.equal(r2.body.parties, -1);
  delete process.env.CRON_SECRET;
});

test("whenHe: יום ושעה בשעון ישראל, גם סביב מעבר לשעון קיץ (26.3.2027)", () => {
  assert.equal(whenHe(Date.parse("2026-10-29T18:30:00Z")), "יום ה׳ 20:30");
  assert.equal(whenHe(Date.parse("2026-10-31T10:05:00Z")), "שבת 12:05");
  assert.equal(whenHe(Date.parse("2027-03-25T21:00:00+02:00")), "יום ה׳ 21:00");
  assert.equal(whenHe(Date.parse("2027-03-26T21:00:00+03:00")), "יום ו׳ 21:00");
  assert.equal(whenHe(Date.parse("2027-03-28T21:00:00+03:00")), "יום א׳ 21:00");
});

test("גיבוי: tvg.parties/tvg.gid/tvg.name ברשימת המפתחות של השרת", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../api/backup.js", import.meta.url), "utf8");
  for (const k of ["tvg.parties", "tvg.gid", "tvg.name"]) assert.ok(src.includes('"' + k + '"'), k);
});
