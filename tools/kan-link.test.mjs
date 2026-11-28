// node --test tools/kan-link.test.mjs – ▶ קישור לדף התוכנית בכאן 11: רק דף תוכנית אמיתי, ורק כשהשם תואם (לא לפי זמן בלבד)
import test from "node:test";
import assert from "node:assert/strict";
import { parseKan, enrich } from "../enrich_kan.mjs";

const item = (utc, title, href, cls = "cms-program") => `<div class="results-item ${cls}"><a class="mobile-holder program-link" href="${href}"><p class="program-hour date-local" data-date-utc="${utc}"></p><h3 class="program-title">${title}</h3></a><div class="program-description">תקציר של ${title} עם עוד מילים</div></div>`;
const html = item("28.11.2026 18:30:00", "פגישה עם רוני קובן-אמיר שורוש", "/content/kan/kan-11/p-11486/") +
  item("28.11.2026 15:00:00", "שרון ואורי", "/live/?stationId=4444", "current") +
  `<div class="results-item"><p data-date-utc="28.11.2026 20:10:00"></p><h3 class="program-title">הייתי שם</h3></div>`;

test("parseKan: קישור רק לדף תוכנית, לא לשידור החי", () => {
  const it = parseKan(html);
  assert.equal(it.find((x) => /רוני קובן/.test(x.title)).u, "/content/kan/kan-11/p-11486/");
  assert.equal(it.find((x) => x.title === "שרון ואורי").u, undefined);
  assert.equal(it.find((x) => x.title === "הייתי שם").u, undefined);
});

test("enrich: קישור רק כשהשם תואם, גם לתוכנית שכבר יש לה תקציר", () => {
  const g = { channels: [{ id: "3787", name: "כאן 11" }], programs: [
    { ch: "3787", start: "2026-11-28T20:30", title: "פגישה עם רוני קובן - פרק 36", desc: "יש כבר" },
    { ch: "3787", start: "2026-11-28T20:35", title: "חדשות" }] };
  const r = enrich(g, parseKan(html));
  assert.equal(g.programs[0].u, "/content/kan/kan-11/p-11486/");
  assert.equal(g.programs[0].desc, "יש כבר");
  assert.equal(g.programs[1].u, undefined); // אותה שעה, שם אחר – לא
  assert.equal(r.nu, 1);
});
