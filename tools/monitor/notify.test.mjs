import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, decide, parseUx, uxProblems, formatText, sendMessage } from "./notify.mjs";

const S = "הכול תקין · 29,737 תוכניות";
const run = (prev, problems, mode = "check") => decide({ prev, problems, mode, summary: S });

test("ok→ok שקט", () => { assert.equal(run({ status: "ok" }, []).send, false); assert.equal(run(null, []).send, false); });
test("ok→bad שולח 🔴 עם הרשימה", () => {
  const d = run({ status: "ok" }, ["א", "ב"]);
  assert.equal(d.send, true); assert.match(d.text, /🔴/); assert.match(d.text, /• א/); assert.match(d.text, /• ב/);
  assert.equal(d.state.status, "bad");
});
test("בהרצה ראשונה (אין מצב) ובעיה → שולח", () => { assert.equal(run(null, ["x"]).send, true); });
test("bad→bad שקט ושומר since", () => {
  const prev = { status: "bad", since: "2026-10-30T00:00:00.000Z", problems: ["א"] };
  const d = run(prev, ["א", "ג"]); assert.equal(d.send, false); assert.equal(d.state.since, prev.since);
});
test("bad→ok שולח התאוששות 🟢", () => {
  const d = run({ status: "bad" }, []); assert.equal(d.send, true); assert.match(d.text, /^🟢/); assert.match(d.text, /29,737/);
});
test("סיכום בוקר: תמיד שולח – תקין ✅ או בעיות", () => {
  assert.match(run({ status: "ok" }, [], "summary").text, /^✅ הכול תקין/);
  assert.match(run({ status: "bad" }, ["א"], "summary").text, /🔴/);
});
test("escapeHtml", () => {
  assert.equal(escapeHtml('a<b>&"c"'), "a&lt;b&gt;&amp;\"c\"");
  assert.equal(escapeHtml(null), "");
  const d = run({ status: "ok" }, ["<script>&x</script>"]);
  assert.ok(!d.text.includes("<script>")); assert.match(d.text, /&lt;script&gt;&amp;x/);
});
test("formatText מתחיל כל שורה ב-RLM", () => {
  for (const l of formatText("🟢 א\nב").split("\n")) assert.ok(l.startsWith("‏"));
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
test("pickMode: סיכום בוקר פעם ביום, בחלון 08-12 שעון ישראל", async () => {
  const { pickMode } = await import("./notify.mjs");
  const at = (iso) => new Date(iso);
  assert.equal(pickMode({ prev: null, now: at("2026-10-30T06:05:00Z") }), "summary"); // 08:05 חורף
  assert.equal(pickMode({ prev: null, now: at("2026-07-01T05:10:00Z") }), "summary"); // 08:10 קיץ
  assert.equal(pickMode({ prev: null, now: at("2026-10-30T05:00:00Z") }), "check"); // 07:00 חורף
  assert.equal(pickMode({ prev: { lastSummaryDate: "2026-10-30" }, now: at("2026-10-30T06:05:00Z") }), "check"); // כבר נשלח
  assert.equal(pickMode({ prev: null, now: at("2026-10-30T12:00:00Z") }), "check"); // 14:00
  assert.equal(pickMode({ prev: { lastSummaryDate: "2026-10-30" }, force: true, now: at("2026-10-30T12:00:00Z") }), "summary");
});
test("parseUx: קריסה בלי שורות מכשיר", () => { assert.equal(uxProblems(parseUx("Error: browser not found")).length, 1); assert.deepEqual(uxProblems(parseUx("")), []); });
