import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, decide, parseUx, uxProblems, formatText, sendMessage, pickMode, problemKey, HISTORY_DAYS } from "./notify.mjs";

const NOW = new Date("2026-10-30T06:05:00Z"); // שישי 08:05 בישראל
const HEALTH = { problems: [], info: { guide: { programs: 29737, synopsisPct: 40.8, days: 10, channelsReport: { "ערוץ 14": { found: true, missing: [], days: { a: 5, b: 6, c: 0 } } } }, netflix: { items: 72, rated: 71 }, caches: { x14At: "2026-10-30T05:00:00Z" } } };
const UXOK = parseUx("iphone_375 scrollWidth/clientWidth 375/375 errors: 0\nandroid_360 scrollWidth/clientWidth 360/360 errors: 0");
const NOUX = parseUx("");
const run = (prev, problems, mode = "check", now = NOW, ux = NOUX) => decide({ prev, problems, mode, health: { ...HEALTH, problems: problems.filter((p) => !p.startsWith("UX")) }, ux, now });
const at = (iso) => new Date(iso);

test("ok→ok שקט; הרצה ראשונה תקינה שקטה", () => { assert.equal(run({}, []).send, false); assert.equal(run(null, []).send, false); });

test("ok→bad שולח 🔴 עם הרשימה", () => {
  const d = run({}, ["א: x", "ב: y"]);
  assert.equal(d.send, true); assert.match(d.text, /🔴/); assert.match(d.text, /• א: x/); assert.match(d.text, /• ב: y/);
  assert.equal(d.state.status, "bad");
});

test("bad→bad באותן תקלות שקט, since נשמר, מספרים משתנים לא נחשבים חדשים", () => {
  const d1 = run({}, ["הלוח לא התעדכן 31 שעות"]);
  const d2 = run(d1.state, ["הלוח לא התעדכן 33 שעות"], "check", at("2026-10-30T08:05:00Z"));
  assert.equal(d2.send, false);
  assert.equal(Object.values(d2.state.open)[0].since, Object.values(d1.state.open)[0].since);
  assert.equal(problemKey("הלוח לא התעדכן 31 שעות"), problemKey("הלוח לא התעדכן 33 שעות"));
});

test("תקלה נוספת על גבי קיימת – שולח, עם החדשה בלבד כחדשה והקיימת כ'עדיין פתוחות'", () => {
  const d1 = run({}, ["א: x"]);
  const d2 = run(d1.state, ["א: x", "ב: y"]);
  assert.equal(d2.send, true);
  assert.match(d2.text, /• ב: y/); assert.match(d2.text, /עדיין פתוחות/);
});

test("bad→ok לא שולח בשום הודעה נפרדת, והתקלה נסגרת בהיסטוריה", () => {
  const d1 = run({}, ["א: x"]);
  const d2 = run(d1.state, [], "check", at("2026-10-30T08:05:00Z"));
  assert.equal(d2.send, false);
  assert.equal(d2.state.status, "ok");
  assert.ok(d2.state.incidents[0].closed);
});

test("תקלת UX נשארת פתוחה בריצת check (שלא בודקת UX)", () => {
  const d1 = run({}, ["UX גלילה אופקית ב-android_360"], "daily");
  const d2 = run(d1.state, [], "check", at("2026-10-30T08:05:00Z"));
  assert.equal(d2.state.status, "bad"); assert.equal(d2.send, false);
});

test("יומי: מציג מספרים, UX, ו'✔ תוקן מאז אתמול'", () => {
  const d1 = run({}, ["נטפליקס לא התעדכן 40 שעות"], "check", at("2026-10-30T00:05:00Z"));
  const d2 = run(d1.state, [], "daily", NOW, UXOK);
  assert.equal(d2.send, true);
  assert.match(d2.text, /^‏?☀️/); assert.match(d2.text, /29,737 תוכניות/); assert.match(d2.text, /UX תקין/);
  assert.match(d2.text, /✔ תוקן מאז אתמול: נטפליקס לא התעדכן/);
  assert.equal(d2.state.lastSummaryDate, "2026-10-30");
});

test("יומי עם תקלות פתוחות", () => {
  const d = run({}, ["ערוץ 14: אין תוכניות"], "daily");
  assert.match(d.text, /1 תקלות פתוחות/); assert.match(d.text, /ערוץ 14/);
});

test("שבועי: זמינות, תקלות עם משך, מגמות והמחשב בבית", () => {
  let st = {}; const t0 = Date.parse("2026-10-20T00:00:00Z");
  for (let i = 0; i < 12 * 14; i++) { // שבועיים, ריצה כל שעתיים; תקלה בת 6 שעות ביום 3 של השבוע האחרון
    const t = new Date(t0 + i * 2 * 36e5), bad = i >= 12 * 9 && i < 12 * 9 + 3;
    const h = { ...HEALTH, info: { ...HEALTH.info, guide: { ...HEALTH.info.guide, programs: i <= 12 * 7 ? 29000 : 30000 }, caches: { x14At: new Date(t.getTime() - 36e5).toISOString() } } };
    st = decide({ prev: st, problems: bad ? ["ערוץ 14: אין תוכניות"] : [], mode: "check", health: h, ux: NOUX, now: t }).state;
  }
  const now = new Date(t0 + 14 * DAYMS);
  const d = decide({ prev: st, problems: [], mode: "weekly", health: HEALTH, ux: UXOK, now });
  assert.match(d.text, /📅/); assert.match(d.text, /זמינות.*96\.\d%/); assert.match(d.text, /ערוץ 14 · 6 שעות/);
  assert.match(d.text, /תוכניות: 29,99\d 📈 \+99\d לעומת השבוע הקודם/);
  assert.match(d.text, /המחשב בבית.*עדכן ב-\d+ מתוך \d+ ימים/);
});
const DAYMS = 864e5;

test("חודשי", () => {
  const d = run({}, [], "monthly", at("2026-11-01T06:05:00Z"), UXOK);
  assert.match(d.text, /🗓/); assert.match(d.text, /סיכום חודשי/);
});

test("היסטוריה נגזמת ל-35 ימים", () => {
  let st = {};
  st = decide({ prev: st, problems: [], mode: "check", health: HEALTH, ux: NOUX, now: at("2026-09-01T00:00:00Z") }).state;
  st = decide({ prev: st, problems: [], mode: "check", health: HEALTH, ux: NOUX, now: at("2026-10-30T00:00:00Z") }).state;
  assert.equal(st.history.length, 1); assert.equal(HISTORY_DAYS, 35);
});

test("pickMode: חלון 08-12, פעם ביום, ראשון=שבועי, 1 לחודש=חודשי", () => {
  assert.equal(pickMode({ prev: null, now: at("2026-10-30T06:05:00Z") }), "daily"); // שישי 08:05
  assert.equal(pickMode({ prev: null, now: at("2026-07-01T05:10:00Z") }), "monthly"); // 1.7 08:10 קיץ
  assert.equal(pickMode({ prev: null, now: at("2026-11-01T06:05:00Z") }), "monthly"); // 1.11 (ראשון) – חודשי גובר
  assert.equal(pickMode({ prev: null, now: at("2026-11-08T06:05:00Z") }), "weekly"); // ראשון 8.11
  assert.equal(pickMode({ prev: null, now: at("2026-10-30T05:00:00Z") }), "check"); // 07:00
  assert.equal(pickMode({ prev: { lastSummaryDate: "2026-10-30" }, now: at("2026-10-30T06:05:00Z") }), "check");
  assert.equal(pickMode({ prev: null, now: at("2026-10-30T12:00:00Z") }), "check"); // 14:00
  assert.equal(pickMode({ prev: { lastSummaryDate: "2026-10-30" }, force: true, now: at("2026-10-30T12:00:00Z") }), "daily");
});

test("escapeHtml והודעות", () => {
  assert.equal(escapeHtml('a<b>&"c"'), "a&lt;b&gt;&amp;\"c\"");
  assert.equal(escapeHtml(null), "");
  const d = run({}, ["<script>&x</script>"]);
  assert.ok(!d.text.includes("<script>")); assert.match(d.text, /&lt;script&gt;&amp;x/);
  for (const l of formatText("🔴 א\nב").split("\n")) assert.ok(l.startsWith("‏"));
});

test("sendMessage: parse_mode HTML, בלי טוקן בגוף", async () => {
  let seen; const f = async (url, o) => { seen = { url, body: JSON.parse(o.body) }; return { ok: true }; };
  assert.equal(await sendMessage({ token: "T0K", chat: "123", text: "x", fetchFn: f }), true);
  assert.equal(seen.body.parse_mode, "HTML"); assert.equal(seen.body.chat_id, "123"); assert.ok(!JSON.stringify(seen.body).includes("T0K"));
});

const UX_OK = "iphone_375 scrollWidth/clientWidth 375/375 errors: 0\nandroid_360 scrollWidth/clientWidth 360/360 errors: 0\n\nscreenshots: 56";
const UX_BAD = "iphone_375 scrollWidth/clientWidth 375/375 errors: 0\nandroid_360 scrollWidth/clientWidth 400/360 errors: 2\n    step settings: waiting for selector\n    console: Failed to load x\n\nscreenshots: 54";
test("parseUx תקין", () => { assert.deepEqual(uxProblems(parseUx(UX_OK)), []); assert.equal(parseUx(UX_OK).devices.length, 2); });
test("parseUx כשלים", () => {
  const p = uxProblems(parseUx(UX_BAD));
  assert.ok(p.some((x) => x.includes("android_360: step settings")));
  assert.ok(p.some((x) => x.includes("שגיאת קונסולה") && x.includes("android_360")));
  assert.ok(p.some((x) => x.includes("גלילה אופקית") && x.includes("android_360")));
});
test("parseUx: קריסה בלי שורות מכשיר", () => { assert.equal(uxProblems(parseUx("Error: browser not found")).length, 1); assert.deepEqual(uxProblems(parseUx("")), []); });

const UX_AUDIT_OK = "iphone_375 scrollWidth/clientWidth 375/375 errors: 0\naudit iphone_375 issues: 0 {}\nandroid_360 scrollWidth/clientWidth 360/360 errors: 0\naudit android_360 issues: 0 {}\n\nlayout audit issues: 0 (report only)";
const UX_AUDIT_BAD = "iphone_375 scrollWidth/clientWidth 375/375 errors: 0\naudit iphone_375 issues: 3 {\"tight\":3}\n    audit: [tight] button.moreb[data-more] \"עוד…\" <> button.btn.rem \"⏰ תזכיר לי\" - stacked gap 0px (<8) @A_light_03\nandroid_360 scrollWidth/clientWidth 360/360 errors: 0\naudit android_360 issues: 0 {}";
test("ביקורת פריסה: 0 בעיות = תקין, ומופיע בסיכום היומי", () => {
  const ux = parseUx(UX_AUDIT_OK);
  assert.deepEqual(uxProblems(ux), []); assert.equal(ux.audit.total, 0); assert.equal(Object.keys(ux.audit.devices).length, 2);
  const d = run({}, [], "daily", NOW, ux); assert.match(d.text, /ביקורת פריסה: 0 בעיות/);
});
test("ביקורת פריסה: בעיות = 🔴 בסיכום היומי, עם דוגמה; לא נשלחת התראה ב-check", () => {
  const ux = parseUx(UX_AUDIT_BAD), p = uxProblems(ux);
  assert.equal(ux.audit.total, 3); assert.equal(p.length, 1);
  assert.match(p[0], /ביקורת פריסה ב-iphone_375: 3 בעיות/); assert.match(p[0], /moreb/);
  const d = run({}, p, "daily", NOW, ux); assert.equal(d.send, true); assert.match(d.text, /🔴/); assert.match(d.text, /ביקורת פריסה/);
  assert.equal(problemKey(p[0]), problemKey(p[0].replace("3 בעיות", "5 בעיות"))); // שינוי במספר לא נחשב תקלה חדשה
  const c = run(d.state, [], "check", at("2026-10-30T08:05:00Z")); assert.equal(c.send, false); assert.equal(c.state.status, "bad"); // נשארת פתוחה עד הבוקר הבא
});
