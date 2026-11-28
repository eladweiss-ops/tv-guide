// ▶ טריילר: רק התאמה בטוחה (פריט אחד בשם זהה, שנה תואמת), YouTube בלבד, מטמון
import test from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, pickMatch, pickVideo, handleVid, _clearVid } from "../api/_vid.js";

test("cleanTitle: מוריד פרק/עונה/כותרת משנה", () => {
  assert.equal(cleanTitle("הייתי שם - עונה חדשה: אסון הצונאמי"), "הייתי שם");
  assert.equal(cleanTitle("קארפול קריוקי 4 - דני סנדרסון"), "קארפול קריוקי");
  assert.equal(cleanTitle("האוס - פרק 12"), "האוס");
  assert.equal(cleanTitle("ישיר! הסמויה"), "הסמויה");
  assert.equal(cleanTitle("פאודה עונה 4"), "פאודה");
});

const R = (o) => ({ media_type: "movie", ...o });
test("pickMatch: אחד בדיוק, שם זהה, שנה ±1", () => {
  assert.equal(pickMatch([R({ id: 1, title: "ההתחלה", original_title: "Inception", release_date: "2010-07-16" })], "ההתחלה", 0).id, 1);
  assert.equal(pickMatch([R({ id: 1, title: "Inception X" })], "ההתחלה", 0), null); // לא זהה
  assert.equal(pickMatch([R({ id: 1, title: "האי" }), R({ id: 2, title: "האי", media_type: "tv" })], "האי", 0), null); // שניים = לא בטוח
  assert.equal(pickMatch([R({ id: 1, title: "האי", release_date: "2005-01-01" }), R({ id: 2, title: "האי", release_date: "1980-01-01" })], "האי", 2005).id, 1); // השנה מכריעה
  assert.equal(pickMatch([R({ id: 1, title: "האי", release_date: "2005-01-01" })], "האי", 1990), null); // שנה שגויה
  assert.equal(pickMatch([{ media_type: "person", name: "האי" }], "האי", 0), null);
});

test("pickVideo: YouTube, טריילר לפני טיזר, רשמי קודם", () => {
  const v = pickVideo([{ site: "Vimeo", key: "abcdefg", type: "Trailer" }, { site: "YouTube", key: "teaser01", type: "Teaser", official: true },
    { site: "YouTube", key: "trail001", type: "Trailer", official: false }, { site: "YouTube", key: "trail002", type: "Trailer", official: true }, { site: "YouTube", key: "clip0001", type: "Clip" }]);
  assert.equal(v.key, "trail002");
  assert.equal(pickVideo([{ site: "YouTube", key: "x", type: "Trailer" }]), null); // מפתח לא תקין
});

test("handleVid: מוצא, נופל לאנגלית, ושומר במטמון", async () => {
  _clearVid();
  const calls = [], store = {};
  const fetch = async (u) => {
    calls.push(u);
    const j = /search\/multi/.test(u) ? { results: [{ media_type: "tv", id: 7, name: "פאודה", original_name: "Fauda", first_air_date: "2015-02-15" }] }
      : /language=he-IL/.test(u) ? { results: [] } : { results: [{ site: "YouTube", key: "FaUdA_trl1", type: "Trailer", official: true }] };
    return { ok: true, json: async () => j };
  };
  const d = { fetch, key: "k", readJson: async (p) => store[p] || null, writeJson: async (p, v) => { store[p] = v; }, now: () => 1e12 };
  const r = await handleVid("פאודה - פרק 3", "", d);
  assert.deepEqual(r.json, { yt: "FaUdA_trl1", k: "t7", name: "פאודה" });
  const n = calls.length;
  assert.deepEqual((await handleVid("פאודה", "", d)).json.yt, "FaUdA_trl1");
  assert.equal(calls.length, n); // מהמטמון
});

test("handleVid: אין התאמה בטוחה → {}; כשל TMDB → {} בלי לשמור", async () => {
  _clearVid();
  const store = {};
  const d = { key: "k", readJson: async (p) => store[p] || null, writeJson: async (p, v) => { store[p] = v; }, now: () => 1e12,
    fetch: async () => ({ ok: true, json: async () => ({ results: [{ media_type: "movie", id: 1, title: "משהו אחר" }] }) }) };
  assert.deepEqual((await handleVid("מבזק חדשות", "", d)).json, {});
  _clearVid();
  const d2 = { ...d, readJson: async () => null, writeJson: async () => { throw new Error("no write expected"); }, fetch: async () => ({ ok: false, status: 500 }) };
  const r = await handleVid("פאודה", "", d2);
  assert.deepEqual(r.json, {}); assert.equal(r.failed, true);
  assert.equal((await handleVid("x", "", d)).status, 400);
});
