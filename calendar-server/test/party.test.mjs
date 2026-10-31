// node --test calendar-server/test/*.mjs  - 🍿 ערב צפייה (/api/party): הרשאות, פרטיות, בעלות על תשובה, תקרות, קצב, חלון "פליי", פוש, פקיעה וניקוי
import test from "node:test";
import assert from "node:assert/strict";
import { fakeFirestoreClient } from "./helpers/fakedb.mjs";

console.error = () => {};
const { _setBackend, firestoreBackend, writeJson, readJson } = await import("../api/_db.js");
const { default: handler } = await import("../api/party.js");
const { cleanParties, cleanName, cleanLink, whenHe, publicView, MAX_RSVPS, EXPIRE_MS, GO_COOLDOWN } = await import("../api/_party.js");
const { default: cronH } = await import("../api/watch-check.js");
const { _resetLimits } = await import("../api/_guard.js");

const HOST = "hostaaaaaaaaaaaaaaaaaaaaaaaaaa", G1 = "g1111111111111111111111111", OTHER = "otherbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = Date.parse("2026-10-30T17:00:00Z"); // 19:00 בישראל, יום ו׳
const AT = NOW + 2 * 3600000;
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } };
const gid = (n) => "gid" + String(n).padStart(20, "0");

function mockRes() {
  const r = { code: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => r;
  return r;
}
let client, sent, clock, ip;
async function setup() {
  client = fakeFirestoreClient(); _setBackend(firestoreBackend(client)); _resetLimits();
  sent = []; clock = NOW; ip = 1;
}
const d = () => ({ now: () => clock, sendTo: async (t, payload) => { sent.push({ t, payload }); return { ok: 1, total: 1 }; } });
async function post(body, o = {}) { const r = mockRes(); await handler({ method: "POST", headers: { "x-real-ip": o.ip || "9.9.9." + ip }, body }, r, d()); return r; }
async function get(id, g, o = {}) { const r = mockRes(); await handler({ method: "GET", headers: { "x-real-ip": o.ip || "8.8.8." + ip }, query: { id, g } }, r, d()); return r; }
const mk = (o = {}) => ({ action: "create", t: HOST, title: "הסדרה הגדולה", kind: "nf", ref: "t1396", link: "https://www.netflix.com/search?q=Big", at: AT, place: "home", name: "אלעד", ...o });
async function create(o) { const r = await post(mk(o)); assert.equal(r.code, 200, JSON.stringify(r.body)); return r.body.id; }
const rsvp = (id, g, ans = "yes", name = "דנה", t) => post({ action: "rsvp", id, gid: g, name, ans, ...(t ? { t } : {}) });
const subsFor = (t) => writeJson(`push/${t}.json`, [SUB]);
test.beforeEach(setup);

test("create: טוקן חובה, שדות נבדקים, קישור מחוץ לרשימה הלבנה נזרק, והתשובה לא חושפת טוקנים", async () => {
  assert.equal((await post(mk({ t: "x" }))).code, 400);
  assert.equal((await post(mk({ title: "  " }))).code, 400);
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
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes(HOST) && !/tokHash|"pt"/.test(s), "בלי טוקן/האש בתשובה");
  assert.equal(cleanLink("https://www.netflix.com/search?q=a"), "https://www.netflix.com/search?q=a");
  assert.equal(cleanLink("https://www.netflix.com.evil.com/x"), "");
  assert.equal(cleanLink("javascript:alert(1)"), "");
  assert.equal(cleanLink("https://eladweiss-ops.github.io/tv-guide/?p=1.2"), "https://eladweiss-ops.github.io/tv-guide/?p=1.2");
  assert.equal(cleanLink("https://eladweiss-ops.github.io.evil.com/"), "");
});

test("המסמך נשמר עם האש בלבד: הטוקן האישי לא מופיע במסמך (פוש: רק אם יש מנוי)", async () => {
  const id = await create();
  const doc = JSON.parse(client.data.get("party/" + id).v);
  assert.ok(doc.host.tokHash && !JSON.stringify(doc).includes(HOST));
  assert.equal(doc.host.pt, undefined, "אין מנוי פוש = אין pt");
  await subsFor("pushhostccccccccccccccccccccc");
  const id2 = await post(mk({ t: "pushhostccccccccccccccccccccc" }));
  assert.equal(JSON.parse(client.data.get("party/" + id2.body.id).v).host.pt, "pushhostccccccccccccccccccccc");
});

test("GET ציבורי: שמות+תשובות בלבד. בלי tokHash/pt/gid של אחרים; mine רק לבעל ה-gid", async () => {
  await subsFor(OTHER);
  const id = await create();
  await rsvp(id, G1, "yes", "דנה", OTHER);
  await rsvp(id, gid(2), "maybe", "יוסי");
  const pub = await get(id);
  assert.equal(pub.code, 200);
  assert.deepEqual(pub.body.rsvps, [{ name: "דנה", ans: "yes" }, { name: "יוסי", ans: "maybe" }]);
  assert.deepEqual(pub.body.counts, { yes: 1, maybe: 1, no: 0 });
  assert.equal(pub.body.mine, undefined);
  const s = JSON.stringify(pub.body);
  for (const bad of [HOST, G1, gid(2), OTHER, "tokHash", "\"pt\"", "subId"]) assert.ok(!s.includes(bad), "דליפה: " + bad);
  assert.equal(pub.body.now, NOW);
  assert.deepEqual((await get(id, G1)).body.mine, { ans: "yes", name: "דנה" });
  assert.equal((await get(id, "g9999999999999999999999")).body.mine, undefined, "gid לא קיים");
  assert.equal((await get("nope")).code, 404);
  assert.equal((await get("A".repeat(22))).code, 404);
  const v = publicView({ id, title: "t", kind: "nf", ref: "r", at: AT, place: "home", host: { name: "x", tokHash: "H", pt: "T" }, rsvps: { zzz: { name: "n", ans: "yes", ts: 1, pt: "P" } } }, NOW);
  assert.ok(!JSON.stringify(v).match(/"H"|"T"|"P"|zzz/));
});

test("rsvp: בעלות לפי gid, שינוי תשובה מותר, שם/תשובה נבדקים, כל gid בנפרד", async () => {
  const id = await create();
  assert.equal((await rsvp(id, "short")).code, 400);
  assert.equal((await rsvp(id, G1, "yes", "")).code, 400);
  assert.equal((await rsvp(id, G1, "yes", "ראה http://evil.example")).code, 400);
  assert.equal((await rsvp(id, G1, "attending")).code, 400);
  assert.equal((await rsvp("A".repeat(22), G1)).code, 404);
  const r1 = await rsvp(id, G1, "yes", "  דנה\u0000   כהן  " + "ש".repeat(40));
  assert.equal(r1.code, 200);
  assert.ok(r1.body.rsvps[0].name.length <= 24 && !r1.body.rsvps[0].name.includes("\u0000"));
  const r2 = await rsvp(id, G1, "no", "דנה");
  assert.equal(r2.body.rsvps.length, 1, "אותו gid = עדכון, לא תשובה נוספת");
  assert.deepEqual(r2.body.mine, { ans: "no", name: "דנה" });
  await rsvp(id, gid(7), "yes", "רון");
  const st = (await get(id)).body;
  assert.deepEqual(st.counts, { yes: 1, maybe: 0, no: 1 });
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
  _resetLimits();
  assert.equal((await post(mk({ t: "otherhostddddddddddddddddddd" }))).code, 200, "מארח אחר לא מושפע");
});

test("קצב: יצירה (10 ל-IP, 6 לטוקן), rsvp (20 ל-IP, 40 לערב), GET", async () => {
  let codes = [];
  for (let i = 0; i < 7; i++) codes.push((await post(mk({ title: "ב" + i }))).code);
  assert.deepEqual(codes.slice(0, 6), [200, 200, 200, 200, 200, 200]); assert.equal(codes[6], 429, "טוקן");
  _resetLimits();
  const id = await create({ t: "otherhostddddddddddddddddddd" });
  codes = [];
  for (let i = 0; i < 22; i++) codes.push((await rsvp(id, gid(i), "yes", "א" + i)).code);
  assert.equal(codes.filter((c) => c === 429).length, 2, "מ-21 ומעלה מאותו IP חסום: " + codes.join());
  const r = mockRes(); await handler({ method: "POST", headers: { "x-real-ip": "9.9.9.9" }, body: { action: "rsvp", id } }, r, d()); // IP אחר, אבל אותו ערב: עוד לא 40
  assert.notEqual(r.code, 429);
  _resetLimits();
  for (let i = 0; i < 121; i++) codes[i] = (await get(id, undefined, { ip: "7.7.7.7" })).code;
  assert.equal(codes[120], 429);
  const big = mockRes(); await handler({ method: "POST", headers: { "x-real-ip": "5.5.5.5", "content-length": "99999" }, body: {} }, big, d());
  assert.equal(big.code, 413);
  const bad = mockRes(); await handler({ method: "POST", headers: { "x-real-ip": "5.5.5.6" }, body: { action: "boom" } }, bad, d());
  assert.equal(bad.code, 400);
});

test("cancel/view: רק המארח; אחרי ביטול אין rsvp ו-GET מראה בוטל; undo מחזיר", async () => {
  const id = await create();
  assert.equal((await post({ action: "cancel", id, t: OTHER })).code, 403);
  assert.equal((await post({ action: "cancel", id, t: "bad" })).code, 403);
  assert.equal((await post({ action: "view", id, t: OTHER })).code, 403);
  const v = await post({ action: "view", id, t: HOST });
  assert.equal(v.code, 200); assert.equal(v.body.host.me, true);
  assert.equal((await post({ action: "cancel", id, t: HOST })).body.cancelled, true);
  assert.equal((await get(id)).body.cancelled, true);
  assert.equal((await rsvp(id, G1)).code, 409);
  assert.equal((await post({ action: "go", id, t: HOST })).code, 409);
  assert.equal((await post({ action: "cancel", id, t: HOST, undo: true })).body.cancelled, false);
  assert.equal((await get(id)).body.cancelled, undefined);
  assert.equal((await rsvp(id, G1)).code, 200);
});

test("go: חלון -60/+180 דק׳, מארח בלבד, פעם בדקה, פוש למארח ולמי שענה מגיע/אולי עם מנוי", async () => {
  const H = "pushhostccccccccccccccccccccc", A = "guestaaaaaaaaaaaaaaaaaaaaaaaa", B = "guestbbbbbbbbbbbbbbbbbbbbbbbb", C = "guestcccccccccccccccccccccc";
  for (const t of [H, A, B, C]) await subsFor(t);
  const id = await create({ t: H, at: NOW + 3 * 3600000 });
  await rsvp(id, gid(1), "yes", "דנה", A); await rsvp(id, gid(2), "maybe", "רון", B); await rsvp(id, gid(3), "no", "גיל", C); await rsvp(id, gid(4), "yes", "בלי פוש");
  sent.length = 0;
  assert.equal((await post({ action: "go", id, t: H })).code, 403, "מוקדם מדי (3 שעות לפני)");
  assert.equal((await post({ action: "go", id, t: A })).code, 403, "לא מארח");
  clock = NOW + 3 * 3600000 - 59 * 60000; // 59 דק׳ לפני
  const r = await post({ action: "go", id, t: H });
  assert.equal(r.code, 200); assert.equal(r.body.go, clock + 5000); assert.equal(r.body.now, clock); assert.equal(r.body.pushed, 3);
  assert.deepEqual(sent.map((s) => s.t).sort(), [A, B, H].sort(), "מארח + מגיע + אולי. לא 'לא הפעם' ולא בלי מנוי");
  assert.equal(sent[0].payload.url, "./?w=" + id + "&go=1"); assert.match(sent[0].payload.title, /^🍿/);
  assert.equal((await get(id)).body.go, clock + 5000);
  clock += 30000; sent.length = 0;
  const again = await post({ action: "go", id, t: H });
  assert.equal(again.body.repeat, true); assert.equal(sent.length, 0, "בתוך דקה לא שולחים שוב");
  assert.equal(again.body.go, NOW + 3 * 3600000 - 59 * 60000 + 5000);
  clock += GO_COOLDOWN; _resetLimits();
  assert.equal((await post({ action: "go", id, t: H })).body.pushed, 3, "אחרי דקה אפשר שוב");
  clock = NOW + 3 * 3600000 + 181 * 60000;
  assert.equal((await post({ action: "go", id, t: H })).code, 403, "אחרי +180");
});

test("פוש למארח על תשובה: רק על שינוי, עד פעם ב-30 שניות לאורח, בלי פוש כשאין מנוי, מארח לא מקבל על עצמו", async () => {
  await subsFor(HOST);
  const id = await create();
  assert.equal(JSON.parse(client.data.get("party/" + id).v).host.pt, HOST);
  await rsvp(id, G1, "yes", "דנה");
  assert.equal(sent.length, 1); assert.equal(sent[0].t, HOST);
  assert.equal(sent[0].payload.title, "🍿 דנה מגיעה לערב הצפייה"); assert.equal(sent[0].payload.url, "./?w=" + id);
  await rsvp(id, G1, "yes", "דנה"); assert.equal(sent.length, 1, "אותה תשובה = בלי פוש");
  clock += 5000; await rsvp(id, G1, "no", "דנה"); assert.equal(sent.length, 1, "שינוי בתוך 30 שניות לא שולח");
  clock += 31000; await rsvp(id, G1, "no", "דנה"); assert.equal(sent.length, 2, "אחרי 30 שניות, ההבדל מול מה שנשלח אחרון");
  assert.match(sent[1].payload.title, /לא תגיע/);
  await rsvp(id, gid(5), "maybe", "רון"); assert.match(sent[2].payload.title, /אולי מגיעה/);
  const n = sent.length; await rsvp(id, gid(6), "yes", "אלעד", HOST); assert.equal(sent.length, n, "המארח עצמו כאורח");
  const id2 = await create({ t: "nopushhostfffffffffffffffff" }); await rsvp(id2, G1); assert.equal(sent.length, n, "מארח בלי פוש");
  const v = await post({ action: "view", id: id2, t: "nopushhostfffffffffffffffff" });
  assert.equal(v.body.host.push, false);
  await subsFor("nopushhostfffffffffffffffff");
  assert.equal((await post({ action: "view", id: id2, t: "nopushhostfffffffffffffffff" })).body.host.push, true, "view מרענן מנוי");
  clock += 60000; await rsvp(id2, gid(8), "yes", "נוי"); assert.equal(sent.length, n + 1);
});

test("פקיעה: GET אחרי יומיים מהמועד = 404; cleanParties מוחק פגי תוקף בלבד, בתקרה, ומנקה אינדקס מארח", async () => {
  const keep = await create({ title: "קרוב" });
  const old = [];
  for (let i = 0; i < 3; i++) { _resetLimits(); old.push(await create({ title: "ישן" + i, t: "oldhostgggggggggggggggggggg" })); }
  clock = AT + EXPIRE_MS - 1000;
  assert.equal((await get(keep)).code, 200);
  clock = AT + EXPIRE_MS + 1000;
  assert.equal((await get(keep)).code, 404, "פג");
  assert.equal((await rsvp(keep, G1)).code, 404);
  // ערב חדש "חי" ביחס ל-clock הנוכחי
  _resetLimits(); const fresh = await create({ at: clock + 3600000, t: "freshhosthhhhhhhhhhhhhhhhhh" });
  const del1 = await cleanParties(clock, { max: 2 });
  assert.equal(del1, 2, "תקרה");
  const del2 = await cleanParties(clock);
  assert.equal(del2, 2, "שאר הפגי תוקף (4 סה״כ: 1 + 3)");
  assert.equal(await readJson(`party/${fresh}.json`, null) !== null, true, "חי נשאר");
  assert.equal(await readJson(`party/${keep}.json`, null), null);
  assert.equal([...client.data.keys()].filter((k) => k.startsWith("phost/")).length, 1, "אינדקסים ריקים נמחקו, נשאר של freshhost");
  assert.equal(await cleanParties(clock, { deadline: 0 }), 0, "deadline עבר = לא עושה כלום");
  // /api/watch-check קורא לניקוי ולא נכשל בגללו
  process.env.CRON_SECRET = "s3cret-value";
  const r = mockRes();
  await cronH({ method: "GET", headers: { authorization: "Bearer s3cret-value" } }, r, { listUsers: async () => [], cleanParties: async () => 7, readJson: async (p, x) => x, writeJson: async () => {}, getSubs: async () => [], sendTo: async () => ({}), cleanCache: async () => 0 });
  assert.equal(r.code, 200); assert.equal(r.body.parties, 7);
  const r2 = mockRes();
  await cronH({ method: "GET", headers: { authorization: "Bearer s3cret-value" } }, r2, { listUsers: async () => [], cleanParties: async () => { throw new Error("x"); }, readJson: async (p, x) => x, writeJson: async () => {}, getSubs: async () => [], sendTo: async () => ({}), cleanCache: async () => 0 });
  assert.equal(r2.code, 200); assert.equal(r2.body.parties, -1);
  delete process.env.CRON_SECRET;
});

test("whenHe: יום ושעה בשעון ישראל", () => {
  assert.equal(whenHe(Date.parse("2026-10-29T18:30:00Z")), "יום ה׳ 20:30");
  assert.equal(whenHe(Date.parse("2026-10-31T10:05:00Z")), "שבת 12:05");
});
