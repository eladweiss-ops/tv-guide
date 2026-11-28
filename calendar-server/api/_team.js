// ⚽ הקבוצה שלי – תזכורות אוטומטיות בצד השרת (תקלת 28.11.2026: משחק של מכבי חיפה הופיע בלוח ~25 שעות לפני, והאפליקציה לא נפתחה בחלון הזה,
// ולכן לא נוצרה תזכורת). עותק נאמן של ההתאמה בלקוח (js/team.js: canon/key/sidesOf/sportOf/scan/hit/games/autoList, js/data.js isLiveP,
// js/reminder-sheet.js recOf/fitLead), על הלוח כפי שהאפליקציה רואה אותו (_tonight.js prepGuide: איחוד ערוצים, IDMAP, s/e ב-ms).
// נבדק מול הקוד של הלקוח עצמו ב-test/team-parity.test.mjs – שינוי ב-js/team.js דורש שינוי כאן.
//
// אחסון: tm/<t>.json = {v:1, pend:[rec+{srv:1, ks}], done:[keys], at}. rems/<t> נשאר בבעלות הלקוח ולא נכתב מכאן (נדרס בכל שמירה).
// pend מצטרף לרשימה בזמן קריאה (load/loadAll, reschedule), ויורד כשהלקוח מאשר שראה אותו (המפתח ברשימה שלו או ב-tx = tvg.teamX שלו).
// done = מפתחות שהשרת כבר טיפל בהם: לא מוסיפים שוב, גם אם המשתמש מחק (בלקוח זה tvg.teamX).
import { prepGuide, userChans } from "./_tonight.js";
import { ilToMs } from "./_series.js";
import { logEv } from "./_rlog.js";

export const tmPath = (t) => `tm/${t}.json`;
export const TEAM_DAYS = 7;
export const MAX_PEND = 40; // תקרת תזכורות ממתינות למשתמש (המשחקים של שבוע; הגנה מפני לוח משובש)
const okTok = (t) => typeof t === "string" && /^[a-z0-9]{24,48}$/.test(t);

// ---------- js/data.js ----------
// העתק מילולי (כולל "s*" שאיבד את ה-\ במקור): חייב להתנהג בדיוק כמו בלקוח
const RE_LIVE_PRE = /^s*(ישיר|LIVE)s*[!:-–]*s*/i;
export const isLiveP = (p) => !!p && (p.lv === 1 || RE_LIVE_PRE.test(p.title || "") || /LIVE/.test(p.title || ""));

// ---------- js/team.js: נרמול שמות ----------
const CITY = { "תא": "תל אביב", "בש": "באר שבע", "פת": "פתח תקווה", "רג": "רמת גן", "קש": "קריית שמונה", "ראשלצ": "ראשון לציון", "כפס": "כפר סבא", "נצ": "נס ציונה", "ים": "ירושלים" };
const CLUBW = ["מכבי", "הפועל", "ביתר", "עירוני", "בני", "הכח", "אליצור", "מס", "ריאל", "אתלטיקו", "מנצסטר", "אינטר", "דינמו", "ספורטינג", "סיטי", "יונייטד", "fc", "real", "manchester"];
const ALIAS = {
  "real madrid": "ריאל מדריד", "barcelona": "ברצלונה", "fc barcelona": "ברצלונה", "barca": "ברצלונה", "liverpool": "ליברפול", "arsenal": "ארסנל", "chelsea": "צלסי",
  "manchester united": "מנצסטר יונייטד", "man united": "מנצסטר יונייטד", "man utd": "מנצסטר יונייטד", "manchester city": "מנצסטר סיטי", "man city": "מנצסטר סיטי",
  "tottenham": "טוטנהאם", "juventus": "יובנטוס", "bayern": "באיירן מינכן", "bayern munich": "באיירן מינכן", "psg": "פסז", "paris saint-germain": "פסז", "פריז סן זרמן": "פסז",
  "atletico madrid": "אתלטיקו מדריד", "ac milan": "מילאן", "milan": "מילאן", "inter": "אינטר", "napoli": "נאפולי", "maccabi tel aviv": "מכבי תל אביב", "maccabi haifa": "מכבי חיפה",
  "hapoel tel aviv": "הפועל תל אביב", "hapoel beer sheva": "הפועל באר שבע", "beitar jerusalem": "ביתר ירושלים", "lakers": "לא לייקרס", "la lakers": "לא לייקרס", "ל.א. לייקרס": "לא לייקרס",
  "golden state": "גולדן סטייט", "boston": "בוסטון", "boston celtics": "בוסטון סלטיקס", "panathinaikos": "פנאתינייקוס", "olympiacos": "אולימפיאקוס", "fenerbahce": "פנרבחצה",
};
export function canon(s) {
  s = (" " + String(s == null ? "" : s).toLowerCase() + " ")
    .replace(/[״”“]/g, '"').replace(/[׳’`]/g, "'").replace(/־/g, "-")
    .replace(/([\s.(\-])י\s?-\s?ם(?=[\s\-),.:;'"]|$)/g, "$1ירושלים").replace(/([\s.(\-])י["']ם(?=[\s\-),.:;]|$)/g, "$1ירושלים")
    .replace(/([\s\-(:;])מ\.(?!ס\.)\s?(?=[א-ת])/g, "$1מכבי ").replace(/([\s\-(:;])ה\.\s?(?=[א-ת])/g, "$1הפועל ")
    .replace(/([\s\-(:;])ב\.\s?(?=[א-ת])/g, "$1ביתר ").replace(/([\s\-(:;])ע\.\s?(?=[א-ת])/g, "$1עירוני ")
    .replace(/([\s\-(:;])ר\.\s?(?=מדריד)/g, "$1ריאל ").replace(/([\s\-(:;])את\.\s?(?=מדריד)/g, "$1אתלטיקו ")
    .replace(/([\s\-(:;])מנ[.']\s?(?=(סיטי|יונייטד|יוניטד))/g, "$1מנצסטר ")
    .replace(/["']/g, "").replace(/בית"?ר/g, "ביתר")
    .replace(/(^|[\s\-(:])(מכבי|הפועל|ביתר|עירוני|בני|הכח|אליצור)\s+(תא|בש|פת|רג|קש|ראשלצ|כפס|נצ|ים)(?=[\s\-),.:;]|$)/g, (m, a, c, x) => a + c + " " + CITY[x])
    .replace(/תל[\-\s]אביב(?:[\-\s]יפו)?/g, "תל אביב").replace(/קרית/g, "קריית").replace(/תקוה/g, "תקווה").replace(/יוניטד/g, "יונייטד").replace(/(^|\s)מ\.ס\.\s?/g, "$1מס ")
    .replace(/\s+/g, " ");
  return s;
}
let CC = {};
const cc = (x) => { x = x || ""; let v = CC[x]; if (v == null) v = CC[x] = canon(x); return v; };
export function key(n) { let k = canon(n).replace(/^[\s.,!;:]+|[\s.,!;:]+$/g, ""); k = k.replace(/\./g, ""); return ALIAS[k] || k; }
export function generic(k) { return !k || k.length < 2 || CLUBW.indexOf(k) >= 0 || /^(מכבי|הפועל|ביתר|עירוני|בני)( (כדורגל|כדורסל))?$/.test(k); }
function clean(x) { x = String(x).replace(/\./g, "").replace(/^[\s,!;:"]+|[\s,!;:"]+$/g, "").replace(/\s+/g, " "); return ALIAS[x] || x; }
export function sidesOf(title) {
  let t = cc(title).replace(/\([^)]*\)/g, " ").replace(/\s·.*$/, " ").replace(/(^|\s)(ישיר|live)!?(\s|:|$)/g, " ");
  const i = t.lastIndexOf(":"); if (i >= 0) t = t.slice(i + 1);
  let parts = t.split(/\s+(?:-|–|נגד|vs\.?)\s+/);
  if (parts.length !== 2) parts = t.split(/\s*-\s*/);
  if (parts.length !== 2) return null;
  const a = clean(parts[0]), b = clean(parts[1]);
  return a && b && a !== b ? [a, b] : null;
}

// ---------- ענף, תוכן שאינו משחק, שידור חוזר ----------
const RE_BB = /כדורסל|יורוליג|יורוקאפ|(^|\s)nba(\s|:|$)|g-league|ווינר סל|אלופות סל|(^|\s)סל(\s|$)|euroleague|eurocup|ליגת העל לנוער בכדורסל/;
const RE_FB = /כדורגל|ליגה לאומית|פרמייר|(ליגה|הליגה|ל\.) ?ה?(אנגלית|ספרדית|איטלקית|גרמנית|צרפתית|הולנדית|טורקית \(כדורגל\)|ארגנטינאית|פורטוגלית|אירופית|סקוטית|בלגית|סעודית)|ליגת הכנס|גביע הטוטו|ליגת ווינר(?! סל)|ליגת העל ווינר|מוקדמות (יורו|המונדיאל|מונדיאל)|ליגת האומות|אופא|גביע אנגלי|גביע המדינה בכדורגל|ליגת האלופות(?! בכדורסל)|ל\. אלופות/;
const RE_BB_T = /כדורסל|יורוליג|יורוקאפ|(^|\s)nba(\s|:|$)|ווינר סל/, RE_FB_T = /ל\. (אנגלית|ספרדית|איטלקית|גרמנית|צרפתית|הולנדית|טורקית|ארגנטינאית|פורטוגלית|אירופית)|כדורגל|ליגת ווינר(?! סל)|פרמייר/;
export function sportOf(p) {
  const t = cc(p.title), d = cc(p.desc); let bb = 0, fb = 0;
  if (RE_BB.test(d)) bb += 2; if (RE_FB.test(d)) fb += 2;
  if (RE_BB_T.test(t)) bb += 1; if (RE_FB_T.test(t)) fb += 1;
  return bb > fb ? "bb" : fb > bb ? "fb" : "";
}
const RE_NOGAME = /תקציר|מגזין|סיכום|שערים|לקראת|אולפן|פודקאסט|podcast|highlights|תכנית|תוכנית|חדשות הספורט|מהדורת|מבזק|(^|\s)פרק(\s|$)|תיקתקנו/;
const RE_YOUTH = /נוער|נערים|נשים|ילדים|קדטים|(^|\s)u-?\d\d|עד גיל/;
const RE_RR = /(^|\s)שח(\s|$)|ש\.ח|שידור חוזר|מוקלט|מקוצר|(^|\s)הכנה$/;
const RE_OLD = /המיטב|מיטב העונה|יש לי יום הולדת|נוסטלגיה|קלאסיקות|(^|\s)אwow|(^|\s)wow(\s|$)/;
const RE_RRD = /\S-\S[^:·]*\sמח\.\s?\d+|\S-\S[^:·]*\sגמר$/;
// העונה לפי שעון ישראל (בלקוח: getFullYear/getMonth של המכשיר, שנמצא בישראל)
const ILYM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" });
function season(nowMs) {
  const p = {}; ILYM.formatToParts(new Date(nowMs)).forEach((x) => { p[x.type] = x.value; });
  const y = +p.year % 100, m = +p.month - 1;
  return m >= 6 ? [y, (y + 1) % 100] : [(y + 99) % 100, y];
}
function oldSeason(txt, nowMs) {
  const cur = season(nowMs), re = /(?:^|[^\d])(?:19|20)?(\d\d)\/(\d\d)(?!\d)/g; let m, any = false;
  while ((m = re.exec(txt))) { if ((+m[1] + 1) % 100 !== +m[2]) continue; any = true; if (+m[1] === cur[0]) return false; }
  return any;
}

// ---------- scan: כל המשחקים בלוח (פעם אחת לכל לוח ועונה) ----------
const sportCh = (c) => c._n === "sport" || c._g === "sport" || /ספורט|sport|5gold|5max|5 live|5stars|one|eurosport/i.test(c.name || "");
const SCAN = new WeakMap();
export function scan(G, nowMs) {
  const sk = season(nowMs).join("/"), hit0 = SCAN.get(G);
  if (hit0 && hit0.sk === sk) return hit0.list;
  const list = [], SD = {}; CC = {};
  for (const c of G.channels) {
    const spc = sportCh(c);
    for (const p of G.by.get(c.id) || []) {
      if (!/[-–]|נגד|vs/i.test(p.title)) continue;
      if (!spc && !/כדורגל|כדורסל|יורוליג|nba|ווינר|ליג|ל\.|פרמייר/i.test(p.title)) continue;
      let sd = SD[p.title]; if (sd === undefined) sd = SD[p.title] = sidesOf(p.title);
      if (!sd) continue;
      if (!spc) { const tc = cc(p.title); if (!RE_BB_T.test(tc) && !RE_FB_T.test(tc)) continue; }
      const sp = sportOf(p);
      const txt = cc(p.title) + " " + cc(p.desc), arch = /5\s?gold/i.test(c.name || "") && p.lv !== 1 && !isLiveP(p);
      list.push({ c, p, a: sd[0], b: sd[1], sp, sp0: sp, pair: [sd[0], sd[1]].sort().join("~"),
        ng: arch || RE_NOGAME.test(cc(p.title)) || RE_OLD.test(txt) || oldSeason(txt, nowMs), yo: RE_YOUTH.test(txt), rr: !!p.rr || RE_RR.test(txt) || (p.lv !== 1 && RE_RRD.test(p.desc || "")) });
    }
  }
  const bySp = {};
  list.forEach((x) => { if (x.sp) { const o = bySp[x.pair] || (bySp[x.pair] = {}); o[x.sp] = 1; } });
  list.forEach((x) => { if (!x.sp && bySp[x.pair]) { const k = Object.keys(bySp[x.pair]); if (k.length === 1) x.sp = k[0]; } });
  const sideSp = {};
  list.forEach((x) => { if (x.sp0) [x.a, x.b].forEach((k) => { (sideSp[k] || (sideSp[k] = {}))[x.sp0] = 1; }); });
  list.forEach((x) => {
    if (x.sp) return;
    const sa = Object.keys(sideSp[x.a] || {}), sb = Object.keys(sideSp[x.b] || {});
    const both = sa.filter((v) => sb.indexOf(v) >= 0);
    if (sa.length && sb.length && both.length === 1) x.sp = both[0];
  });
  const grp = {};
  list.forEach((x) => { (grp[x.pair + "|" + x.sp] || (grp[x.pair + "|" + x.sp] = [])).push(x); });
  Object.keys(grp).forEach((k) => {
    const g = grp[k].sort((x, y) => x.p.s - y.p.s); let orig = null;
    g.forEach((x) => {
      if (x.ng) return;
      const live = x.p.lv === 1 || isLiveP(x.p);
      if (orig && live && x.p.s - orig.p.e > 12 * 3600000) orig = null;
      if (!orig) { if (x.rr && !live) return; orig = x; x.gid = k + "|" + x.p.s; return; }
      const olive = orig.p.lv === 1 || isLiveP(orig.p);
      if (live && olive && x.p.s - orig.p.s < 3 * 3600000) { x.rr = false; x.gid = orig.gid; return; }
      if (x.p.s >= orig.p.s + 45 * 60000) x.rr = true;
      else if (!x.rr) x.gid = orig.gid;
    });
    g.forEach((x) => { if (!x.gid) x.gid = k + "|r|" + (orig ? orig.p.s : x.p.s); });
  });
  CC = {};
  SCAN.set(G, { sk, list });
  return list;
}
export function hit(x, t) {
  const k = t.k || (t.k = key(t.n)), side = x.a === k ? 1 : x.b === k ? 2 : 0;
  if (!side) return false;
  if (t.sport && x.sp !== t.sport) return false;
  if (x.yo && !RE_YOUTH.test(k)) return false;
  return !x.ng;
}
// המשחקים הקרובים: שורה אחת לכל משחק (ערוץ מהערוצים שלי קודם), ושידורים חוזרים בנפרד. mineIds: הערוצים שלי (userChans)
export function games(G, teams, nowMs, mineIds, days) {
  const end = nowMs + (days || TEAM_DAYS) * 86400000, mine = {};
  (mineIds || []).forEach((id) => { mine[id] = 1; });
  const by = {}, out = [], reps = [], rseen = {};
  for (const x of scan(G, nowMs)) {
    if (x.p.e <= nowMs || x.p.s >= end) continue;
    let tm = null; for (let i = 0; i < teams.length; i++) if (hit(x, teams[i])) { tm = teams[i]; break; }
    if (!tm) continue;
    if (x.rr) { if (rseen[x.gid]) continue; rseen[x.gid] = 1; reps.push({ c: x.c, p: x.p, t: tm, rr: true, sp: x.sp, a: x.a, b: x.b }); continue; }
    let g = by[x.gid];
    if (!g) { g = by[x.gid] = { c: x.c, p: x.p, t: tm, sp: x.sp, a: x.a, b: x.b, alts: [] }; out.push(g); }
    else if (!mine[g.c.id] && mine[x.c.id]) { g.alts.push({ c: g.c, p: g.p }); g.c = x.c; g.p = x.p; }
    else g.alts.push({ c: x.c, p: x.p });
  }
  const bt = (x, y) => x.p.s - y.p.s || x.c.name.localeCompare(y.c.name, "he");
  return { games: out.sort(bt), reps: reps.sort(bt) };
}

// ---------- המשתמש מתוך הגיבוי ----------
const arr = (s) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
export function teamUserOf(data) {
  if (!data || typeof data !== "object") return null;
  const teams = arr(data["tvg.teams"]).filter((t) => t && typeof t.n === "string" && t.n).slice(0, 50)
    .map((t) => ({ n: t.n, sport: typeof t.sport === "string" ? t.sport : "" }));
  const lead = +(data["tvg.lead"] || 10); // js/reminders.js: TVG.lead = +(store("tvg.lead") || 10)
  return { auto: data["tvg.teamAuto"] === "1", teams, lead: Number.isFinite(lead) ? lead : 10,
    sel: arr(data["tvg.sel"]).map(String), tx: arr(data["tvg.teamX"]).filter((k) => typeof k === "string") };
}

// js/reminder-sheet.js fitLead: אם ההתראה כבר עברה – "בעוד דקה"
export function fitLead(ts, m, nowMs) { return ts - m * 60000 > nowMs + 30000 ? m : Math.max(0, Math.floor((ts - nowMs - 60000) / 60000)); }
// js/reminders.js remKey + js/reminder-sheet.js recOf (בלי dbl)
export const remKey = (id, ts) => id + "|" + ts;
export function remRec(G, id, p, lead, nowMs) {
  const ch = (G.channels.find((c) => c.id === id) || {}).name || "";
  return { k: remKey(id, p.s), id, ts: p.s, end: p.e, title: p.title, ch, desc: (p.desc || "").slice(0, 300), lead: fitLead(p.s, lead, nowMs), at: nowMs };
}

// js/team.js autoList: מה צריך להוסיף. has(k): יש תזכורת למפתח; done(k): כבר טופל (tvg.teamX של הלקוח או done של השרת).
// מחזיר [{rec, ks}] – ks = המפתח הראשי ומפתחות הערוצים המקבילים
export function autoAdds(G, u, nowMs, has, done) {
  const mine = userChans(G, u.sel, nowMs).map((c) => c.id);
  const G2 = games(G, u.teams.map((t) => ({ n: t.n, sport: t.sport })), nowMs, mine).games, soon = nowMs + 60000, out = [];
  for (const g of G2) {
    const ks = [g].concat(g.alts).map((a) => remKey(a.c.id, a.p.s));
    if (g.p.s <= soon) continue;
    if (ks.some(has) || ks.some(done)) continue;
    out.push({ rec: remRec(G, g.c.id, g.p, u.lead, nowMs), ks });
  }
  return out;
}

// ---------- מצב השרת לכל משתמש ----------
export function normTm(doc) {
  const d = doc && typeof doc === "object" ? doc : {};
  return { v: 1, pend: Array.isArray(d.pend) ? d.pend.filter((x) => x && typeof x.k === "string") : [], done: Array.isArray(d.done) ? d.done.filter((k) => typeof k === "string") : [], at: d.at || 0 };
}
const keyTs = (k) => +String(k).slice(String(k).lastIndexOf("|") + 1);
// done: כמו saveTX בלקוח – מפתח של שידור שעבר לפני יותר מיום יורד
export const pruneDone = (done, nowMs) => [...new Set(done)].filter((k) => keyTs(k) > nowMs - 86400000);
// ממתינות שעוד רלוונטיות (השידור לא הסתיים לפני יותר משעתיים, כמו saveRems בלקוח)
export const livePend = (pend, nowMs) => pend.filter((p) => p.end > nowMs - 2 * 3600000);

// התזכורות של המשתמש + הממתינות מהשרת (שעוד לא אושרו). המפתח של המשתמש קודם
export function mergePend(rems, pend, nowMs = Date.now()) {
  const base = Array.isArray(rems) ? rems : [];
  if (!pend || !pend.length) return base;
  const keys = new Set(base.map((r) => r && r.k));
  const extra = livePend(pend, nowMs).filter((p) => !(p.ks || [p.k]).some((k) => keys.has(k)));
  return extra.length ? base.concat(extra) : base;
}

// POST /api/rems: מה נשאר ממתין אחרי שמירה של הלקוח. מאושר = אחד המפתחות ברשימה שלו, או ב-tx (tvg.teamX: ראה/טיפל/מחק).
// בלי tx (גרסה ישנה של האפליקציה) – לא יורד: אחרת שמירה של לקוח שלא יודע על התזכורת הייתה מוחקת אותה בשקט
export function reconcile(pend, clientRems, tx, nowMs = Date.now()) {
  const mine = new Set((Array.isArray(clientRems) ? clientRems : []).map((r) => r && r.k));
  const seen = Array.isArray(tx) ? new Set(tx.filter((k) => typeof k === "string")) : null;
  const keep = [], dropped = [];
  for (const p of livePend(pend, nowMs)) {
    const ks = p.ks || [p.k];
    if (ks.some((k) => mine.has(k))) dropped.push({ k: p.k, why: "adopted" });
    else if (seen && ks.some((k) => seen.has(k))) dropped.push({ k: p.k, why: "tx" });
    else keep.push(p);
  }
  return { keep, dropped };
}

// ---------- ריצה למשתמש אחד ----------
// d: {readJson, writeJson, loadOwn(t), reschedule(t, rems), log?(t, events)}. G = prepGuide(guide). מחזיר {added, pruned}
export async function syncUser(t, data, G, nowMs, d) {
  const u = teamUserOf(data);
  if (!u || !u.auto || !u.teams.length) return { skipped: "off" };
  const tm = normTm(await d.readJson(tmPath(t), null));
  const own = await d.loadOwn(t);
  const ownKeys = new Set(own.map((r) => r && r.k));
  // ממתינה שהמשחק שלה כבר לא בלוח (זז/בוטל): יורדת, והמפתחות שלה משתחררים כדי שאם יחזור – יתווסף שוב
  const cur = new Set(games(G, u.teams.map((x) => ({ n: x.n, sport: x.sport })), nowMs, userChans(G, u.sel, nowMs).map((c) => c.id)).games
    .flatMap((g) => [g].concat(g.alts).map((a) => remKey(a.c.id, a.p.s))));
  const pruned = [], free = new Set();
  let pend = livePend(tm.pend, nowMs).filter((p) => {
    if (p.ts <= nowMs || (p.ks || [p.k]).some((k) => cur.has(k))) return true;
    pruned.push(p.k); (p.ks || [p.k]).forEach((k) => free.add(k)); return false;
  });
  let done = pruneDone(tm.done.filter((k) => !free.has(k)), nowMs);
  const doneSet = new Set(done.concat(u.tx)), pendKeys = new Set(pend.flatMap((p) => p.ks || [p.k]));
  const adds = autoAdds(G, u, nowMs, (k) => ownKeys.has(k) || pendKeys.has(k), (k) => doneSet.has(k)).slice(0, Math.max(0, MAX_PEND - pend.length));
  for (const a of adds) { pend.push({ ...a.rec, srv: 1, ks: a.ks }); done.push(...a.ks); }
  done = [...new Set(done)];
  const changed = adds.length > 0 || pruned.length > 0 || pend.length !== tm.pend.length || done.length !== tm.done.length;
  if (!changed) return { added: 0, pruned: 0 };
  await d.writeJson(tmPath(t), { v: 1, pend, done, at: nowMs });
  await (d.log || logEv)(t, adds.map((a) => ({ k: a.rec.k, e: "created", by: "server", ts: a.rec.ts, lead: a.rec.lead })).concat(pruned.map((k) => ({ k, e: "pruned", by: "server", why: "not in guide" }))));
  let sch = null;
  if (adds.length || pruned.length) sch = await d.reschedule(t, own);
  return { added: adds.length, pruned: pruned.length, sch };
}

// ---------- הריצה על כל המשתמשים ----------
// d: {list(col), readJson, writeJson, loadOwn, reschedule, guide(), log?, now?, clock?, deadline?}
export async function runTeamSync(d) {
  if (process.env.TEAMSYNC_OFF === "1") return { skipped: "off" };
  const now = d.now ? d.now() : Date.now(), clock = d.clock || Date.now;
  const guide = await d.guide();
  if (!guide || !Array.isArray(guide.programs) || !guide.programs.length) return { skipped: "no guide" };
  const G = prepGuide(guide);
  // רק מי שיש לו פוש (בלי פוש אין תזמון, והלקוח עצמו לא מוסיף בלי srv())
  const users = (await d.list("push")).filter((r) => okTok(r.id) && Array.isArray(r.value) && r.value.length).map((r) => r.id).sort();
  const st = { users: users.length, auto: 0, added: 0, pruned: 0, fail: 0, updated: String(guide.updated || "") };
  for (const t of users) {
    if (d.deadline && clock() > d.deadline) { st.more = true; break; }
    try {
      const bkp = await d.readJson(`backup/${t}.json`, null);
      const data = bkp && bkp.data;
      if (!data || data["tvg.teamAuto"] !== "1") continue;
      st.auto++;
      const r = await syncUser(t, data, G, now, d);
      st.added += r.added || 0; st.pruned += r.pruned || 0;
    } catch (e) { st.fail++; console.error("team user", e && e.message); }
  }
  return st;
}
export { ilToMs };
