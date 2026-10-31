import test from "node:test";
import assert from "node:assert/strict";
import { localStart, parseKan, enrich as enrichKan } from "../enrich_kan.mjs";
import { enrich as enrich13 } from "../enrich13.mjs";
import { looksComplete } from "../sportfit.mjs";
import { resolveTypes, typeOf } from "../enrich_sport5.mjs";

test("כאן: תאריך עם יום בלי אפס מוביל ('1.11.2026') נקרא (פעם נפלו כל הימים 1-9 בחודש)", () => {
  assert.equal(localStart("1.11.2026 00:47:00"), "2026-11-01T02:47");
  assert.equal(localStart("31.10.2026 00:10:00"), "2026-10-31T02:10");
  assert.equal(localStart("9.7.2026 21:30:00"), "2026-07-10T00:30");
  const html = '<div class="results-item cms-program" data-date-utc="1.11.2026 00:47:00"><h3 class="program-title">ליד המפית</h3><div class="program-description">מסעדה בצפון</div></div>';
  assert.deepEqual(parseKan(html), [{ start: "2026-11-01T02:47", title: "ליד המפית", desc: "מסעדה בצפון" }]);
});

test("כאן: תקציר לא נדבק לפי קרבת זמן בלבד – חייב שם תוכנית זהה", () => {
  const g = { channels: [{ id: "1", name: "HD כאן" }], programs: [{ ch: "1", start: "2026-11-01T20:00", title: "חדשות" }, { ch: "1", start: "2026-11-01T21:00", title: "מבזק ספורט" }] };
  const r = enrichKan(g, [{ start: "2026-11-01T20:00", title: "חדשות", desc: "מהדורה" }, { start: "2026-11-01T21:00", title: "סרט הערב", desc: "דרמה" }]);
  assert.equal(r.n, 1);
  assert.equal(g.programs[0].desc, "מהדורה");
  assert.equal(g.programs[1].desc, undefined);
});

test("רשת 13: תקציר גם כשהשם בוואלה מורחב ('היום שהיה - עם טל שורר'), אבל לא לתוכנית אחרת באותה שעה", () => {
  const g = { channels: [{ id: "1", name: "רשת SD" }], programs: [
    { ch: "1", start: "2026-11-02T23:20", title: "היום שהיה - עם טל שורר" },
    { ch: "1", start: "2026-11-04T21:15", title: "The Voice All Stars - פרק 10" }] };
  const items = [{ start: "2026-11-02T23:20", title: "היום שהיה", desc: "תוכנית לילית" }, { start: "2026-11-04T21:15", title: "הישרדות - עונה 8", desc: "ריאליטי" }];
  const r = enrich13(g, new Map(), items);
  assert.equal(r.n, 1);
  assert.equal(g.programs[0].desc, "תוכנית לילית");
  assert.equal(g.programs[1].desc, undefined);
});

test("ספורט: משלימים יום רק כשהאתר מפרסם לו לוח מלא", () => {
  const T = (...t) => t.map((time) => ({ time }));
  assert.equal(looksComplete(T("00:40", "02:00", "04:00", "06:40", "08:20", "10:05", "11:45", "13:00", "14:00", "17:00", "19:00", "23:50")), true);
  assert.equal(looksComplete(T("02:00", "04:00", "05:00")), false, "רק כמה שידורים ישירים");
  assert.equal(looksComplete(T("00:40", "02:00", "04:00", "06:40", "08:20", "10:05", "11:45", "13:00", "14:00", "15:00", "16:00", "17:00")), false, "נגמר באמצע היום");
  assert.equal(looksComplete(T("00:40", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "13:00", "23:00", "23:30", "23:50")), false, "פער של 6 שעות+");
});

test("ספורט 5: 'ספורט 5 HD' של HOT עובר ללוח שהשעות שלו זהות, ולא נשאר על 'ערוץ הספורט'", () => {
  const mk = (day, rows) => rows.map(([t, title]) => ({ ch: "521", start: day + "T" + t, title }));
  const progs = mk("2026-11-02", [["03:00", "NHL"], ["06:00", "NBA"], ["07:45", "ל. סקוטית"], ["11:15", "NBA"], ["13:00", "NFL"], ["15:20", "ליגת ווינר סל"], ["18:45", "ל. לאומית"], ["22:10", "NFL"]]);
  const g = { channels: [{ id: "521", name: "ספורט 5 HD" }], programs: progs };
  const stars = [["03:00", "NHL ליגת ההוקי האמריקאית: אנהיים - אוטווה"], ["06:00", "NBA: אוקלהומה - יוסטון"], ["07:45", "ליגה סקוטית: פלקירק - סלטיק"], ["11:15", "NBA: אורלנדו - בוסטון"], ["13:00", "NFL: דנבר - קנזס סיטי"], ["15:20", "ליגת העל בכדורסל: הפועל י-ם - הפועל אילת"], ["18:45", "ליגה לאומית בכדורגל: מודיעין - עכו"], ["22:10", "NFL: באפלו - בולטימור"]];
  const main = [["00:40", "חדשות הספורט"], ["04:00", "NBA לייקרס"], ["12:40", "מעקבדיה"], ["17:00", "בני סכנין - טבריה"], ["20:30", "הפועל ת״א - מכבי חיפה"]];
  const sched = new Map([["5STARS|2026-11-02", stars.map(([time, text]) => ({ type: "5STARS", time, text }))], ["5|2026-11-02", main.map(([time, text]) => ({ type: "5", time, text }))]]);
  assert.equal(typeOf("ספורט 5 HD"), "5");
  assert.equal(resolveTypes(g, sched).get("521"), "5STARS");
});
