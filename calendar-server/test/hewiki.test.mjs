// node --test calendar-server/test/  - תקציר בעברית מוויקיפדיה (_hewiki.js), בלי רשת
import test from "node:test";
import assert from "node:assert/strict";

process.env.TMDB_API_KEY = "k".repeat(32);
console.error = () => {};
const { pickDesc, heOverviews, HEW_MAX } = await import("../api/_hewiki.js");
const { handleHe, handleOg, handleSearch, _clearCache, HE_NONE_TTL } = await import("../api/nf-search.js");

const jr = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
const PLOT_TXT = "עצמאות (באנגלית: Tell Me Everything) הוא סרט קולנוע ישראלי משנת 2026 שכתב וביים משה רוזנטל.[1]\nהסרט זכה בעשרה פרסי אופיר.\n\n\n== תקציר העלילה ==\nהסרט מתרחש ב-1987. משפחת שבת, משפחה ישראלית מחולון, מתכוננת לבר המצווה של בועז. בועז מגלה על אביו סוד שישנה את חיי המשפחה. בשנת 1996 בועז כבר מתכונן ללימודים באוניברסיטה העברית ומנסה לחדש את הקשר עם אביו, ומגלה שהכול השתנה.\n\n== שחקנים ==\nאסי כהן";

// ויקינתונים + ויקיפדיה מדומים. calls = הכתובות
function wiki({ bindings = [], pages = {}, failSparql = false } = {}) {
  const calls = [];
  const fx = async (url) => {
    calls.push(url); const u = new URL(url);
    if (u.host === "query.wikidata.org") return failSparql ? jr({}, 500) : jr({ results: { bindings } });
    if (u.host === "he.wikipedia.org") { const t = u.searchParams.get("titles"); return pages[t] == null ? jr({ query: { pages: { "-1": { missing: "" } } } }) : jr({ query: { pages: { 1: { title: t, extract: pages[t] } } } }); }
    if (/\/movie\/1404400$/.test(u.pathname)) return jr(u.searchParams.get("language") === "he-IL"
      ? { id: 1404400, title: "עצמאות", original_title: "עצמאות", overview: "", poster_path: "/abcde12345.jpg" }
      : { id: 1404400, title: "Tell Me Everything", original_title: "עצמאות", overview: "Amid the late '80s pop craze" });
    return jr({ results: [] });
  };
  fx.calls = calls; return fx;
}
const art = (prop, id, title) => ({ [prop]: { value: String(id) }, a: { value: "https://he.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")) } });

test("pickDesc: תחילת פרק העלילה, 2-3 משפטים, בלי הערות שוליים", () => {
  const t = pickDesc(PLOT_TXT);
  assert.ok(t.startsWith("הסרט מתרחש ב-1987. משפחת שבת"), t);
  assert.ok(t.length <= 380 && !/1996/.test(t), "לא כל העלילה: " + t);
  assert.ok(!/\[1\]|שחקנים|אסי כהן/.test(t));
});

test("pickDesc: בלי פרק עלילה → הפתיחה, בלי '(באנגלית: …)'; הפניות 'ערכים מורחבים' בראש הפרק מושמטות", () => {
  assert.equal(pickDesc("עצמאות (באנגלית: Tell Me Everything) הוא סרט קולנוע ישראלי משנת 2026 שכתב וביים משה רוזנטל.\n\n== הפקה ==\nצולם בחולון."),
    "עצמאות הוא סרט קולנוע ישראלי משנת 2026 שכתב וביים משה רוזנטל.");
  assert.ok(pickDesc("פתיחה קצרה מאוד שלא נבחרת כי יש עלילה בהמשך הערך.\n\n== עלילה ==\nערכים מורחבים – עונה 1, עונה 2\nהסדרה עוקבת אחר משפחות אצולה הנאבקות על כס המלוכה ביבשת דמיונית.").startsWith("הסדרה עוקבת"));
});

test("pickDesc: אין עברית / קצר מדי / ריק → ''", () => {
  assert.equal(pickDesc(""), "");
  assert.equal(pickDesc("An English article about a film that has no Hebrew text at all here."), "");
  assert.equal(pickDesc("קצר."), "");
});

test("pickDesc: משפט ארוך מאוד נחתך בגבול מילה עם …", () => {
  const t = pickDesc("== עלילה ==\n" + "מילה ".repeat(200));
  assert.ok(t.length <= 381 && t.endsWith("…"), t.length);
});

test("heOverviews: מזהה TMDB → ויקינתונים (סרט P4947 / סדרה P4983) → ויקיפדיה העברית; ערך חסר נשאר בלי", async () => {
  const fx = wiki({
    bindings: [art("tm", 1404400, "עצמאות (סרט)"), art("tv", 1399, "משחקי הכס")],
    pages: { "עצמאות (סרט)": PLOT_TXT, "משחקי הכס": "== עלילה ==\nהסדרה עוקבת אחר משפחות אצולה הנאבקות על כס המלוכה ביבשת דמיונית בשם וסטרוז." },
  });
  const r = await heOverviews([{ k: "m1404400", type: "movie", id: 1404400 }, { k: "t1399", type: "tv", id: 1399 }, { k: "m5", type: "movie", id: 5 }], { fetch: fx });
  assert.deepEqual(Object.keys(r).sort(), ["m1404400", "t1399"]);
  assert.ok(r.m1404400.startsWith("הסרט מתרחש"));
  const q = decodeURIComponent(new URL(fx.calls[0]).searchParams.get("query"));
  assert.match(q, /wdt:P4947/); assert.match(q, /wdt:P4983/); assert.match(q, /"1404400"/); assert.match(q, /"5"/);
  assert.equal(fx.calls.length, 3, "שאילתה אחת לוויקינתונים + ערך לכל פריט שנמצא");
});

test("heOverviews: ויקינתונים נופל → {} בלי זריקה; קלט לא תקין → בלי רשת; תקרה של ערכים", async () => {
  assert.deepEqual(await heOverviews([{ k: "m1", type: "movie", id: 1 }], { fetch: wiki({ failSparql: true }) }), {});
  const fx = wiki();
  assert.deepEqual(await heOverviews([{ k: "x", type: "person", id: 1 }, { k: "m", type: "movie", id: -1 }, null], { fetch: fx }), {});
  assert.equal(fx.calls.length, 0);
  const many = Array.from({ length: 20 }, (_, i) => i + 1);
  const fx2 = wiki({ bindings: many.map((i) => art("tm", i, "סרט " + i)) });
  await heOverviews(many.map((i) => ({ k: "m" + i, type: "movie", id: i })), { fetch: fx2 });
  assert.equal(fx2.calls.length, 1 + HEW_MAX);
});

test("heOverviews: כתובת ערך שאינה ויקיפדיה העברית נדחית", async () => {
  const fx = wiki({ bindings: [{ tm: { value: "7" }, a: { value: "https://evil.example/wiki/x" } }] });
  assert.deepEqual(await heOverviews([{ k: "m7", type: "movie", id: 7 }], { fetch: fx }), {});
  assert.equal(fx.calls.length, 1);
});

test("handleHe: תקציר מוויקיפדיה, מטמון זיכרון + Firestore; 'אין ערך' נשמר יום; כשל רשת לא נשמר", async () => {
  _clearCache();
  const store = {}, rw = { readJson: async (p, dflt) => store[p] ?? dflt, writeJson: async (p, o) => { store[p] = JSON.parse(JSON.stringify(o)); }, now: () => 5_000_000 };
  const fx = wiki({ bindings: [art("tm", 1404400, "עצמאות (סרט)")], pages: { "עצמאות (סרט)": PLOT_TXT } });
  const r = await handleHe("m1404400", { ...rw, fetch: fx });
  assert.equal(r.status, 200); assert.ok(r.json.he.startsWith("הסרט מתרחש")); assert.equal(r.cache, "miss");
  assert.ok(store["cache/he/m1404400.json"].v.startsWith("הסרט מתרחש"));
  assert.equal((await handleHe("m1404400", { ...rw, fetch: fx })).cache, "mem");
  _clearCache(); const n = fx.calls.length;
  assert.equal((await handleHe("m1404400", { ...rw, fetch: fx })).cache, "db"); assert.equal(fx.calls.length, n);
  // אין ערך: "" נשמר, ואחרי יום שואלים שוב
  const r2 = await handleHe("m5", { ...rw, fetch: wiki() });
  assert.equal(r2.json.he, ""); assert.equal(store["cache/he/m5.json"].v, "");
  _clearCache(); assert.equal((await handleHe("m5", { ...rw, fetch: wiki() })).cache, "db");
  _clearCache(); assert.equal((await handleHe("m5", { ...rw, fetch: wiki(), now: () => 5_000_000 + HE_NONE_TTL + 1 })).cache, "miss");
  // כשל: לא נשמר ל-Firestore
  const r3 = await handleHe("m6", { ...rw, fetch: wiki({ failSparql: true }) });
  assert.equal(r3.json.he, ""); assert.equal(r3.failed, true); assert.equal(store["cache/he/m6.json"], undefined);
  assert.equal((await handleHe("x1", rw)).status, 400);
});

test("חיפוש לא מחכה לוויקיפדיה: אין פנייה לוויקינתונים בחיפוש", async () => {
  _clearCache();
  const fx = wiki();
  await handleSearch("tell me everything", { fetch: fx, readJson: async () => null, writeJson: async () => {} });
  assert.ok(!fx.calls.some((u) => /wikidata\.org\/sparql|he\.wikipedia/.test(u)), "בלי ויקיפדיה בחיפוש");
});

test("og: סרט בלי תקציר עברי ב-TMDB → og:description מוויקיפדיה העברית", async () => {
  _clearCache();
  const fx = wiki({ bindings: [art("tm", 1404400, "עצמאות (סרט)")], pages: { "עצמאות (סרט)": PLOT_TXT } });
  const r = await handleOg("m1404400", "", { fetch: fx, readJson: async () => null, writeJson: async () => {} });
  const m = r.html.match(/<meta property="og:description" content="([^"]*)">/);
  assert.ok(m && m[1].startsWith("הסרט מתרחש ב-1987"), m && m[1]);
  assert.match(r.html, /<meta property="og:title" content="עצמאות · סרט בנטפליקס">/);
});
