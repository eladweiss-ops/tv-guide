// 🌙 הערב שלך ב-19:00: פוש יומי אחד עם מה שמעניין את המשתמש הערב (מועדפים ⭐, נושאים, סדרות במעקב), בערוצים שלו.
// אותה לוגיקה כמו הכרטיס בלשונית היום (js/render-dial.js tonightList), על הלוח החי ועל הגיבוי של המשתמש (backup/<t>).
// עותק נאמן של: js/data.js (classify/index/chans/live), js/search.js (canon/topicAlts/topicHit), js/channels.js (chNum),
// js/reminders.js (tonightEnd/remKey). נבדק מול הקוד של הלקוח עצמו ב-test/tonight-parity.test.mjs – שינוי שם דורש שינוי כאן.
// תזמון: ה-cron היומי (/api/watch-check, 06:00 UTC) מתזמן ב-QStash הודעה אחת ל-19:00 שעון ישראל של היום (כולל שעון קיץ),
// וההודעה מגיעה ל-/api/fire עם {tn:1, d}. בלי פונקציה חדשה ובלי cron נוסף.
import { ilToMs, seriesKey } from "./_series.js";
import { QBASE, fireDest } from "./_snz.js";

export const TN_KEY = "tvg.tn19";           // ההגדרה בלקוח (localStorage, עולה בגיבוי). "0" = כבוי; חסר/"1" = פעיל
export const TN_HOUR = 19;
export const TN_TAG = "tn19";
export const TN_URL = "./?tab=dial&tn=1";
export const TN_LINES = 3;                   // שורות בגוף ההתראה; השאר "ועוד N"
export const TN_LATE_MS = 5 * 60000;         // שידור שהתחיל לפני יותר מ-5 דקות לא נכנס להתראה (בכרטיס הוא "משודר עכשיו")
export const TN_STATS = "stats/tn19.json";   // {d, id, at}: ההודעה של היום כבר תוזמנה
export const tnMark = (t) => `tn/${t}.json`; // {d, at, n}: למשתמש הזה כבר נשלח היום (נכתב לפני השליחה: לעולם לא פעמיים)
const okTok = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);

// ---------- זמן בישראל ----------
const ILF = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function ilParts(ms) { const p = {}; ILF.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; }); return p; }
export const ilDate = (ms) => { const p = ilParts(ms); return `${p.year}-${p.month}-${p.day}`; };
export const ilHm = (ms) => { const p = ilParts(ms); return `${p.hour}:${p.minute}`; };
const ilMin = (ms) => { const p = ilParts(ms); return +p.hour * 60 + +p.minute; };
const addDay = (ds, n) => new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10) + n)).toISOString().slice(0, 10);
// סוף הערב (js/reminders.js tonightEnd): 04:00 הבא
export function tonightEnd(now) { const ds = ilDate(now); return ilToMs((ilMin(now) >= 240 ? addDay(ds, 1) : ds) + "T04:00"); }
// 19:00 של היום בישראל (16:00 UTC בשעון קיץ, 17:00 UTC בחורף)
export const tnAt = (now) => ilToMs(ilDate(now) + "T" + String(TN_HOUR).padStart(2, "0") + ":00");

// ---------- js/data.js: שמות, איחוד ערוצים, אינדקס ----------
const ALIAS = { "רשת SD": "רשת 13", "HD כאן": "כאן 11", "קשת": "קשת 12", "עכשיו 14": "ערוץ 14", "מוסיקה 24": "ערוץ 24", "מוזיקה 24": "ערוץ 24", "SPORT 3": "ספורט 3", "SPORT 3 HD": "ספורט 3", "SPORT 4": "ספורט 4", "SPORT 4 HD": "ספורט 4", "SPORT 1": "ספורט 1", "SPORT 2": "ספורט 2",
  "ערוץ הספורט": "ספורט 5", "5+ LIVE": "5 LIVE", "5LIVE HD": "5 LIVE", "5+ GOLD": "5 GOLD", "5GOLD": "5 GOLD", "Sport 5 Stars": "5 STARS", "5MAX": "5 MAX",
  "ערוץ ONE": "ONE", "ערוץ ONE HD": "ONE", "ONE 2 HD": "ONE 2" };
const NAMEFIX = { "3185": "ערוץ פעוטות (HOT 3185)", "521": "ספורט 5 HD · HOT" };
const MERGE = [["301", "3630", "3785", "3786"], ["3547", "3727"], ["205", "149"], ["353", "3179"], ["322", "3600"], ["66", "321"], ["3550", "3551"]];
const GROUPS = ["broad", "sport", "hot", "yes", "both", "other"];
const BROAD = /קשת|רשת|כאן|עכשיו|^(9|14|24)\b|ערוץ (9|14|24)\b|כנסת|i24|הלא|מכאן|הכלכלה/i;
const GEN_RX = [
  ["sport", /ספורט|sport|\bone\b|eurosport|5\s?(gold|max|stars|live)|ווינר|nba|nfl|ליגת|ליגה|ל\. |fight|golf|motor|mutv|פורמולה/i],
  ["news", /חדשות|news|cnn|bbc|i24|פוקס|fox|ג'זירה|jazeera|bloomberg|euronews|כנסת|הכלכלה|france|\bdw\b|rt\b/i],
  ["kids", /ילדים|ניקלודיאון|nick|נאנו|nano|דיסני|disney|cartoon|קרטון|baby|הופ|\bhop\b|ג'וניור|junior|boomerang|בומרנג|kids|טלג'ם|zoomoo|טיני|tiny|פו\b/i],
  ["music", /מוזיק|מוסיק|mtv|music|שירים|radio|רדיו|vh1|stingray|גלגל/i],
  ["docu", /דוקו|docu|nat ?geo|נשיונל|discovery|דיסקברי|history|היסטור|animal|אנימל|science|מדע|טבע|תרבות|travel|טיול|food|אוכל|תעודה|crime|investigation|life ?style|פנאי/i],
  ["movies", /סרטים|movies|cinema|סינמה|film|פילם|action|אקשן|drama|דרמה|comedy|קומדי|stars|thriller|טרילר|סדרות|series|סטארס|מוביז/i],
  ["ent", /בידור|\be!|!e\b|e!|ויוה|viva|fun\b|פאן|ריאליטי|reality|lifetime|סמולטוק|hot3|הוט 3/i],
];
const CHNUM = { "ONE": 50, "5 LIVE": 56, "ערוץ 14": 14, "כאן חינוכית": 23, "ערוץ 9": 9, "ערוץ 24": 24, "מכאן": 33, "ערוץ 33": 33, "כנסת": 99, "ערוץ הכנסת": 99 };
const unent = (t) => String(t == null ? "" : t).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const garbled = (n) => (n.match(/\?/g) || []).length >= 2 || /[¥¾µ°´²]/.test(n);
const normKey = (n) => n.toLowerCase().replace(/\(copy\)|משוכפל|חדש/g, "").replace(/(^|[^a-z])f?hd(?![a-z])|(^|[^a-z])sd(?![a-z])/g, "$1$2").replace(/^ערוץ\s+/, "").replace(/(\d)\+\s+/g, "$1").replace(/[^\p{L}\p{N}+]/gu, "");
const cleanName = (n) => n.replace(/\s*[-–]?\s*(\(copy\)|משוכפל)/ig, "").replace(/\s+f?hd(?=\s|$)/ig, "").replace(/^hd\s+/i, "").replace(/\s+חדש$/, "").replace(/\s+/g, " ").trim() || n;
const genOf = (c) => { for (const [g, rx] of GEN_RX) if (rx.test(c.name)) return g; return ""; };
function grpOf(c) {
  const n = c.name;
  if (BROAD.test(n)) return "broad";
  if (genOf(c) === "sport") return "sport";
  if (/(^|\s)hot(\s|$)|^הוט/i.test(n)) return "hot";
  if (/(^|\s)yes(\s|$)|^יס/i.test(n)) return "yes";
  if (c.prov === "hot") return "hot";
  if (c.prov === "yes") return "yes";
  if (c.prov === "both") return "both";
  return "other";
}
function chNum(c) { if (CHNUM[c.name] != null) return CHNUM[c.name]; if (c._g === "broad") { const m = c.name.match(/(\d{1,3})\s*$/); if (m) return +m[1]; } return null; }
function sk(c) {
  if (c._g !== "sport") return 0;
  const n = c.name; let m;
  if ((m = n.match(/^ספורט\s*([1-46-9])$/))) return +m[1] * 10;
  if (/^ספורט 5$/.test(n)) return 50;
  if (/^(ספורט )?5\s*(\+|פלוס)$/.test(n)) return 51;
  if (/^5 LIVE$/i.test(n)) return 52;
  if (/^5 GOLD$/i.test(n)) return 53;
  if (/^5 STARS$/i.test(n)) return 54;
  if (/^5 MAX$/i.test(n)) return 55;
  if (/^ONE$/i.test(n)) return 70;
  if (/^ONE 2$/i.test(n)) return 71;
  if (/eurosport/i.test(n)) return 80;
  return 100;
}
const bk = (c) => { if (c._g !== "broad") return 0; const n = chNum(c); return n == null ? 500 : n; };
const heb = (n) => (/[֐-׿]/.test(n) ? 0 : 1);

// הלוח כמו שהאפליקציה רואה אותו: ערוצים מאוחדים וממוינים, ותוכניות לכל ערוץ עם s/e (ms). נשמר על אובייקט הלוח (פעם אחת לכל ריצה)
const PREP = new WeakMap();
export function prepGuide(g) {
  if (PREP.has(g)) return PREP.get(g);
  const all = (g.channels || []).map((c0) => {
    const c = { id: c0.id, name: unent(c0.name), prov: c0.prov };
    if (NAMEFIX[c.id]) c.name = NAMEFIX[c.id];
    else if (garbled(c.name)) c.name = "ערוץ " + (c.prov === "yes" ? "yes" : "HOT") + " " + c.id;
    if (ALIAS[c.name]) c.name = ALIAS[c.name];
    return c;
  });
  const grp = {}, order = [], manual = {};
  MERGE.forEach((m, i) => m.forEach((id) => { manual[id] = "m" + i; }));
  for (const c of all) { const k = manual[c.id] || normKey(c.name) + "|" + (c.prov || ""); if (!grp[k]) { grp[k] = []; order.push(k); } grp[k].push(c); }
  const IDMAP = {}, channels = [];
  for (const k of order) {
    const m = grp[k].slice().sort((a, b) => +a.id - +b.id), lead = m[0];
    const hot = m.some((c) => c.prov === "hot" || c.prov === "both"), yes = m.some((c) => c.prov === "yes" || c.prov === "both");
    lead.prov = hot && yes ? "both" : hot ? "hot" : yes ? "yes" : "";
    lead.name = cleanName(lead.name);
    m.forEach((c) => { IDMAP[c.id] = lead.id; });
    channels.push(lead);
  }
  channels.forEach((c) => { c._g = grpOf(c); c._n = genOf(c); });
  const GR = {}; GROUPS.forEach((x, i) => { GR[x] = i; });
  channels.sort((a, b) => GR[a._g] - GR[b._g] || bk(a) - bk(b) || sk(a) - sk(b) || heb(a.name) - heb(b.name) || a.name.localeCompare(b.name, "he"));
  // index()
  const by = new Map(), seen = {};
  channels.forEach((c) => { by.set(c.id, []); seen[c.id] = {}; });
  for (const leadPass of [true, false]) {
    for (const p of g.programs || []) {
      const lid = IDMAP[p.ch] || p.ch;
      if ((lid === p.ch) !== leadPass || !by.has(lid)) continue;
      if (seen[lid][p.start]) { const ex = seen[lid][p.start]; if (ex !== 1 && !ex.desc && p.desc) ex.desc = p.desc; if (ex !== 1 && ex.lv < 0 && (p.lv === 0 || p.lv === 1)) ex.lv = p.lv; continue; }
      const o = { title: unent(p.title), desc: p.desc || "", s: ilToMs(p.start), rr: p.rr ? 1 : 0, lv: p.lv === 1 ? 1 : p.lv === 0 ? 0 : -1 };
      seen[lid][p.start] = o; by.get(lid).push(o);
    }
  }
  by.forEach((a) => {
    const dt = {};
    a.forEach((p) => { if (p.desc) { const e = dt[p.title]; if (!e) dt[p.title] = p.desc; else if (e !== p.desc) dt[p.title] = 1; } });
    a.forEach((p) => { const d = dt[p.title]; if (!p.desc && d && d !== 1) p.desc = d; });
  });
  by.forEach((a) => {
    a.sort((x, y) => x.s - y.s);
    a.forEach((p, i) => { p.e = a[i + 1] ? a[i + 1].s : p.s + 3600000; });
  });
  const out = { channels, by, IDMAP };
  PREP.set(g, out);
  return out;
}

// הערוצים שלי (js/data.js chans + boot.js: מזהים ישנים עוברים דרך IDMAP). ערוץ בלי שום תוכנית מהיום והלאה לא מוצג
export function userChans(G, selIds, now) {
  const sel = new Set();
  for (const id0 of Array.isArray(selIds) ? selIds : []) { const id = G.IDMAP[id0] || id0; if (G.by.has(id)) sel.add(id); }
  const l1 = G.channels.filter((c) => sel.has(c.id));
  const l0 = l1.length ? l1 : G.channels.length > 8 ? [] : G.channels;
  const t0 = ilToMs(ilDate(now) + "T00:00");
  const l = l0.filter((c) => { const a = G.by.get(c.id); return !!a && a.length > 0 && a[a.length - 1].e > t0; });
  return l.length ? l : l0;
}

// ---------- js/search.js: נושאים ----------
function canon(x) {
  return (" " + String(x || "").toLowerCase().replace(/[״”“]/g, '"').replace(/[׳’]/g, "'").replace(/תל[-־]אביב/g, "תל אביב") + " ")
    .replace(/([\s\-–(])ת"?א(?=[\s\-–),.:])/g, "$1תל אביב")
    .replace(/([\s\-–(])ב"?ש(?=[\s\-–),.:])/g, "$1באר שבע").replace(/([\s\-–(])פ"ת(?=[\s\-–),.:])/g, "$1פתח תקווה").replace(/([\s\-–(])ק"ש(?=[\s\-–),.:])/g, "$1קריית שמונה")
    .replace(/([\s\-–(])מ\.\s?(?=\S)/g, "$1מכבי ").replace(/([\s\-–(])ה\.\s?(?=\S)/g, "$1הפועל ").replace(/([\s\-–(])ב\.\s?(?=\S)/g, '$1בית"ר ')
    .replace(/\s+/g, " ");
}
const pc = (p) => { if (p._c == null) p._c = canon(p.title + " " + (p.desc || "")); return p._c; };
export function topicAlts(t) {
  t = String(t).trim().toLowerCase(); const a = [t]; let m;
  if ((m = t.match(/^מכבי\s+(.+)$/))) a.push("מ. " + m[1], "מ." + m[1]);
  if ((m = t.match(/^הפועל\s+(.+)$/))) a.push("ה. " + m[1], "ה." + m[1]);
  if ((m = t.match(/^בית"?ר\s+(.+)$/))) a.push("ב. " + m[1]);
  return a;
}
export function topicHit(p, alts) { const h = (p.title + " " + (p.desc || "")).toLowerCase(), hc = pc(p); return alts.some((a) => h.indexOf(a) >= 0 || hc.indexOf(canon(a).trim()) >= 0); }

// ---------- המשתמש מתוך הגיבוי ----------
const arr = (s) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
export function userOf(data) {
  if (!data || typeof data !== "object") return null;
  const fol = new Set();
  for (const x of arr(data["tvg.fol"])) { if (!x || typeof x.title !== "string" || !x.title || x.x) continue; const k = seriesKey(x.title); if (k) fol.add(k); }
  return {
    on: data[TN_KEY] !== "0",
    sel: arr(data["tvg.sel"]).map(String),
    fav: new Set(arr(data["tvg.fav"]).filter((x) => typeof x === "string")),
    topics: arr(data["tvg.topics"]).filter((x) => typeof x === "string" && x.trim()),
    fol,
  };
}
export const hasPicks = (u) => !!u && (u.fav.size > 0 || u.topics.length > 0 || u.fol.size > 0);

// ---------- js/render-dial.js tonightList ----------
// שורה אחת לכל כותרת (השידור הקרוב בערוצים שלי, לפי סדר הערוצים), מעכשיו ועד 04:00, ממוין לפי שעה
export function tonightList(G, u, now) {
  const end = tonightEnd(now), seen = {}, out = [], alts = u.topics.map((tp) => ({ t: tp, a: topicAlts(tp) }));
  for (const c of userChans(G, u.sel, now)) {
    for (const p of G.by.get(c.id) || []) {
      if (p.e <= now || p.s >= end || seen[p.title]) continue;
      let why = "";
      const fol = u.fol.size > 0 && u.fol.has(seriesKey(p.title));
      if (u.fav.has(p.title)) why = "מועדף";
      else if (fol) why = "סדרה במעקב";
      else { for (const x of alts) if (topicHit(p, x.a)) { why = x.t; break; } }
      if (!why) continue;
      seen[p.title] = 1;
      out.push({ c, p, why, fol });
    }
  }
  return out.sort((x, y) => x.p.s - y.p.s || x.p.title.localeCompare(y.p.title));
}

// ---------- ההתראה ----------
// טקסט פשוט (אין <bdi> בהתראה): כל רצף לטיני/ספרות עטוף ב-LRM, כמו TVG.bidiText בלקוח, כדי ש"ספורט 5+" ו-"E!" לא יתהפכו. ה-SW מוסיף RLM לכל שורה
const chNice = (s) => String(s == null ? "" : s).replace(/(^|\s)!([A-Za-z0-9]+)/g, "$1$2!");
export const bidiText = (s) => chNice(s).replace(/[A-Za-z0-9][A-Za-z0-9 ]*[!?+]*/g, (m) => "‎" + m.replace(/ +$/, "") + "‎" + (/ $/.test(m) ? " " : ""));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// list: tonightList. rems: rems/<t> (התזכורות של המשתמש). null = לא שולחים (אין מה, או שעל הכול כבר יש תזכורת)
export function buildTonight(list, rems, now) {
  const items = list.filter((x) => x.p.s >= now - TN_LATE_MS);
  if (!items.length) return null;
  const mine = new Set((Array.isArray(rems) ? rems : []).map((r) => r && r.k));
  // סדרה במעקב = יש לה תזכורת אוטומטית (למשתמש יש פוש, אחרת לא היינו כאן), כמו "✓" בכרטיס
  const open = items.filter((x) => !x.fol && !mine.has(x.c.id + "|" + x.p.s));
  if (!open.length) return null; // על כל מה שמעניין הערב כבר תגיע תזכורת: לא מוסיפים עוד התראה
  const lines = items.slice(0, TN_LINES).map((x) => ilHm(x.p.s) + " · " + bidiText(clip(x.p.title, 60)) + " · " + bidiText(x.c.name));
  const more = items.length - TN_LINES;
  if (more > 0) lines.push(more === 1 ? "ועוד אחד" : "ועוד " + more);
  return { title: "🌙 הערב שלך", body: lines.join("\n"), tag: TN_TAG, url: TN_URL };
}

// ---------- הריצה ב-19:00 (מ-/api/fire) ----------
// d: {list(col), readJson, writeJson, load(t), sendTo(t, payload), guide(), now?, clock?, deadline?, from?, day?}
// מחזיר {users, sent, ...} ו-more:<i> אם נגמר הזמן (fire מתזמן המשך מאותה נקודה)
export async function runTonight(d) {
  const now = d.now ? d.now() : Date.now(), clock = d.clock || Date.now;
  const day = ilDate(now);
  if (d.day && d.day !== day) return { skipped: "stale" };                       // הודעה של יום אחר (עיכוב/ניסיון חוזר)
  const m = ilMin(now);
  if (m < TN_HOUR * 60 - 30 || m >= TN_HOUR * 60 + 120) return { skipped: "window" }; // רק סביב 19:00 (עד 21:00), לא באמצע הלילה
  const guide = await d.guide();
  if (!guide || !Array.isArray(guide.programs) || !guide.programs.length) return { skipped: "no guide" };
  const G = prepGuide(guide);
  const users = (await d.list("push")).filter((r) => okTok(r.id) && Array.isArray(r.value) && r.value.length).map((r) => r.id).sort();
  const marks = {};
  for (const r of await d.list("tn")) if (r && r.value && typeof r.value.d === "string") marks[r.id] = r.value.d;
  const st = { day, users: users.length, sent: 0, dup: 0, off: 0, none: 0, covered: 0, fail: 0 };
  for (let i = Math.max(0, d.from | 0); i < users.length; i++) {
    if (d.deadline && clock() > d.deadline) { st.more = i; break; }
    const t = users[i];
    if (marks[t] === day) { st.dup++; continue; }
    try {
      const bkp = await d.readJson(`backup/${t}.json`, null);
      const u = userOf(bkp && bkp.data);
      if (!u || !u.on) { st.off++; continue; }
      if (!hasPicks(u)) { st.none++; continue; }
      const list = tonightList(G, u, now);
      if (!list.length) { st.none++; continue; }
      const pl = buildTonight(list, await d.load(t), now);
      if (!pl) { st.covered++; continue; }
      const m2 = await d.readJson(tnMark(t), null); if (m2 && m2.d === day) { st.dup++; continue; } // ריצה מקבילה כבר סימנה
      await d.writeJson(tnMark(t), { d: day, at: now, n: list.length }); // לפני השליחה: ניסיון חוזר של QStash או ריצה כפולה לא ישלחו שוב
      const r = await d.sendTo(t, pl);
      if (r && r.ok) st.sent++; else st.fail++;
    } catch (e) { st.fail++; console.error("tonight user", e && e.message); }
  }
  return st;
}

// ---------- תזמון (מה-cron היומי) ----------
async function publish(body, at, d) {
  const dedup = "tn19-" + body.d + (body.from ? "-" + body.from : "");
  const token = d.token !== undefined ? d.token : process.env.QSTASH_TOKEN;
  const fx = d.fetch || fetch;
  const r = await fx(`${QBASE()}/v2/publish/${fireDest()}`, {
    method: "POST", signal: !d.fetch && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    headers: { authorization: "Bearer " + token, "content-type": "application/json", "upstash-not-before": String(Math.floor(at / 1000)), "upstash-retries": "1", "upstash-deduplication-id": dedup },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok && j && j.messageId ? j.messageId : null;
}
// מתזמן הודעה אחת ל-19:00 של היום. פעם אחת ביום (stats/tn19). TN19_OFF=1 ב-Vercel = מתג חירום שמכבה את הפיצ'ר לכולם
// d: {readJson, writeJson, fetch?, now?, token?}
export async function scheduleTonight(d) {
  if (process.env.TN19_OFF === "1") return { skipped: "off" };
  const token = d.token !== undefined ? d.token : process.env.QSTASH_TOKEN;
  if (!token) return { skipped: "no QSTASH_TOKEN" };
  const now = d.now ? d.now() : Date.now(), day = ilDate(now), at = tnAt(now);
  if (at <= now + 60000) return { skipped: "late" };
  const cur = await d.readJson(TN_STATS, null);
  if (cur && cur.d === day && cur.id) return { dup: true, day };
  const id = await publish({ tn: 1, d: day }, at, { ...d, token });
  if (!id) return { error: "publish failed" };
  await d.writeJson(TN_STATS, { d: day, id, at });
  return { scheduled: day, at };
}

// הודעת QStash {tn:1, d, from?} ב-/api/fire. d: כמו runTonight + {fetch?, token?}
export async function fireTonight(b, d) {
  if (!b || typeof b.d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.d)) return { status: 400, json: { error: "bad request" } };
  const r = await runTonight({ ...d, day: b.d, from: Number.isInteger(b.from) && b.from > 0 ? b.from : 0 });
  if (r.more != null) { // נגמר הזמן: ממשיכים מיד בהודעה חדשה מאותה נקודה (הסימון tn/<t> מונע כפילות)
    try { r.next = await publish({ tn: 1, d: b.d, from: r.more }, d.now ? d.now() : Date.now(), d); } catch (e) { r.next = null; console.error("tonight continue", e && e.message); }
  }
  console.log("tonight", JSON.stringify(r));
  return { status: 200, json: r };
}
