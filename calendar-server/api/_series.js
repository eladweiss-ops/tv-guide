// מעקב אחרי סדרה: זיהוי "שידור ראשי" מול שידור חוזר, והתאמת כותרת סדרה לתוכניות הלוח. לוגיקה טהורה, בלי תלויות.
// עותק לקוח באותה לוגיקה: js/series.js (בדיקה שמשווה ביניהם: test/series.test.mjs). שינוי כאן = שינוי שם.

// נרמול כותרות: כמו norm ב-_nfs.js ו-normT בלקוח (אותיות לטיניות קטנות, ספרות ועברית בלבד)
export const normT = (s) => {
  let t = String(s || "").toLowerCase();
  try { t = t.normalize("NFD"); } catch (e) {}
  return t.replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9֐-׿]+/g, "");
};

// כותרת תוכנית -> {stem, ep}. ep = מזהה הפרק אם הוא מופיע בכותרת ("הנדר 4 - פרק 130" -> stem "הנדר 4", ep "e130"; "טילדה 2: 7" -> ep "e7").
// בכוונה לא חותכים לפי ":" או " - " בכלל (אחרת "NCIS: ההתחלה" ו-"NCIS" היו נבלעות באותה סדרה): רק סימון פרק מפורש בסוף הכותרת
export function parseTitle(title) {
  const t = String(title || "").replace(/\s+/g, " ").trim();
  let m = t.match(/^(.*?)\s*[-–]\s*פרק\s*(\d+)\s*$/) || t.match(/^(.*\S)\s+פרק\s*(\d+)\s*$/) || t.match(/^(.*?\S)\s*:\s*(\d{1,4})\s*$/);
  if (m && normT(m[1]).length >= 2) return { stem: m[1].trim(), ep: "e" + (+m[2]) };
  m = t.match(/^(.*?)\s*[-–]\s*(?:עונה חדשה|פרק חדש|ספיישל)\s*$/);
  if (m && normT(m[1]).length >= 2) return { stem: m[1].trim(), ep: "" };
  return { stem: t, ep: "" };
}
export const seriesTitle = (title) => parseTitle(title).stem;
// מפתח הסדרה (קצר, בלי "|"): נרמול הגזע. המפתח הוא זהות העוקב, ולכן נגזר רק מהכותרת
export const seriesKey = (title) => normT(seriesTitle(title)).slice(0, 32);

// "YYYY-MM-DDTHH:MM" בשעון ישראל -> ms. מחשבים את ההיסט של אזור הזמן מ-Intl (כולל מעבר שעון קיץ)
const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function ilOff(ms) { const p = {}; dtf.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; }); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000; }
export function ilToMs(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp || "");
  if (!m) return NaN;
  const g = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), t = g - ilOff(g);
  return g - ilOff(t);
}

const NEW_RX = /עונה חדשה|פרק חדש|בכורה|חדש!/;
const RERUN_RX = /ש\.ח|\(שח\)|שידור חוזר|מקוצר/;
const LIVE_RX = /ישיר|LIVE/i;
const dowOf = (stamp) => new Date(Date.UTC(+stamp.slice(0, 4), +stamp.slice(5, 7) - 1, +stamp.slice(8, 10))).getUTCDay();

// airings: [{ch, start, title, desc?, rr?, lv?}] של סדרה אחת (כבר מסוננים לקבוצת הערוצים). מחזיר מערך באותו אורך: [{...airing, primary:boolean, why}]
// סדר הכללים: ישיר -> ראשי · סימון שידור חוזר (rr/טקסט) -> חוזר · סימון "חדש" -> ראשי · פרק שכבר שודר -> חוזר (המוקדם ביותר ראשי) · בלי מזהה פרק -> משבצת קבועה
export function classify(airings) {
  const out = airings.map((a) => ({ ...a, primary: true, why: "" }));
  const order = out.map((_, i) => i).sort((i, j) => (out[i].start < out[j].start ? -1 : out[i].start > out[j].start ? 1 : 0));
  // תקצירים גנריים (אותו תקציר ב-4+ שידורים ב-4+ ימים שונים) הם לא מזהה פרק
  const descN = {}, descDays = {};
  out.forEach((a) => { const d = normT(a.desc).slice(0, 60); if (d.length >= 12) { descN[d] = (descN[d] || 0) + 1; (descDays[d] = descDays[d] || new Set()).add(a.start.slice(0, 10)); } });
  const generic = (d) => descN[d] >= 4 && descDays[d].size >= 4;
  const epOf = (a) => {
    const pe = parseTitle(a.title).ep;
    if (pe) return "t:" + pe;
    const d = normT(a.desc).slice(0, 60);
    return d.length >= 12 && !generic(d) ? "d:" + d : "";
  };
  const seen = {};
  const pending = []; // בלי מזהה פרק: מוכרעים לפי משבצת
  for (const i of order) {
    const a = out[i], txt = a.title + " " + (a.desc || "");
    const ep = epOf(a);
    if (a.lv === 1 || LIVE_RX.test(a.title)) { a.primary = true; a.why = "live"; if (ep && !seen[ep]) seen[ep] = a.start; continue; }
    if (a.rr || RERUN_RX.test(txt)) { a.primary = false; a.why = "rr"; continue; }
    if (NEW_RX.test(txt)) { a.primary = true; a.why = "new"; if (ep && !seen[ep]) seen[ep] = a.start; continue; }
    if (ep) {
      if (seen[ep] != null && seen[ep] < a.start) { a.primary = false; a.why = "seen"; } else { a.primary = true; a.why = "first"; seen[ep] = a.start; }
      continue;
    }
    pending.push(i);
  }
  if (pending.length) {
    // משבצת = (ערוץ, יום בשבוע, שעה)
    const slot = (a) => a.ch + "|" + dowOf(a.start) + "|" + a.start.slice(11, 16);
    // יש ראיות (שידור ראשי מוכח: ישיר/חדש/פרק ראשון)? שידור בלי מזהה פרק הוא ראשי רק אם הוא באותה משבצת של ראשי מוכח
    const proven = new Set(out.filter((a) => a.primary && (a.why === "live" || a.why === "new" || a.why === "first")).map(slot));
    const cnt = {};
    pending.forEach((i) => { const s = slot(out[i]); cnt[s] = (cnt[s] || 0) + 1; });
    const score = (s) => cnt[s] + (+s.split("|")[2].slice(0, 2) >= 19 ? 0.5 : 0); // חצי נקודה לשעות הערב
    const best = Math.max.apply(null, Object.keys(cnt).map(score)), maxCnt = Math.max.apply(null, Object.keys(cnt).map((s) => cnt[s]));
    // סדרה יומית: (ערוץ, שעה) בלי יום בשבוע
    const daily = (a) => a.ch + "|" + a.start.slice(11, 16), dn = {};
    pending.forEach((i) => { const s = daily(out[i]); dn[s] = (dn[s] || 0) + 1; });
    const dBest = Math.max.apply(null, Object.keys(dn).map((s) => dn[s]));
    for (const i of pending) {
      const a = out[i];
      if (proven.size) { a.primary = proven.has(slot(a)); a.why = a.primary ? "slot" : "slot-rr"; }
      else if (maxCnt >= 2) { a.primary = score(slot(a)) >= best - 1e-9; a.why = a.primary ? "slot" : "slot-rr"; }
      else if (dBest >= 2) { a.primary = dn[daily(a)] === dBest; a.why = a.primary ? "daily" : "daily-rr"; }
      else { a.primary = true; a.why = "single"; }
      if (a.primary && +a.start.slice(11, 13) < 6 && !proven.has(slot(a))) { a.primary = false; a.why = "night"; } // בין חצות לשש: כמעט תמיד חזרה (כמו בחיפוש), אלא אם זו משבצת ראשית מוכחת
    }
  }
  return out;
}

// אינדקס הלוח לפי גזע הכותרת: Map<מפתח, programs[]>; נבנה פעם אחת לכל לוח
const idxCache = new WeakMap();
export function indexGuide(guide) {
  let idx = idxCache.get(guide);
  if (idx) return idx;
  idx = new Map();
  for (const p of (guide && guide.programs) || []) {
    if (!p || typeof p.start !== "string" || typeof p.title !== "string") continue;
    const k = normT(parseTitle(p.title).stem);
    if (!k) continue;
    let a = idx.get(k); if (!a) idx.set(k, (a = []));
    a.push(p);
  }
  idxCache.set(guide, idx);
  return idx;
}

// כל שידורי הסדרה בלוח (מכאן והלאה), מסוננים לקבוצת ערוצים אם נקבעה, ומסווגים. מחזיר [{ch,start,title,desc,rr,lv,primary,why,ts}]
export function seriesAirings(guide, title, chs, nowMs) {
  const k = normT(seriesTitle(title));
  if (!k) return [];
  const set = Array.isArray(chs) && chs.length ? new Set(chs.map(String)) : null;
  const rows = ((indexGuide(guide).get(k)) || []).filter((p) => !set || set.has(String(p.ch)));
  const cl = classify(rows.map((p) => ({ ch: String(p.ch), start: p.start, title: p.title, desc: p.desc, rr: p.rr, lv: p.lv })));
  const out = [];
  for (const a of cl) { const ts = ilToMs(a.start); if (Number.isFinite(ts) && ts > nowMs) out.push({ ...a, ts }); }
  return out.sort((x, y) => x.ts - y.ts || (+x.ch - +y.ch));
}
