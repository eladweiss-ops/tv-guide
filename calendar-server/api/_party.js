// 🍿 ערב צפייה: לוגיקה טהורה (בלי req/res), כדי שאפשר לבדוק עם node --test. נקודת הקצה: api/party.js
// אחסון (Firestore דרך _db.js), כל כתיבה במסמך נפרד כדי שבקשות מקבילות לא ידרסו אחת את השנייה:
//   party/<id>            מטא של הערב: {v, host:{tokHash, name, pe?}, title, kind, ref, ch, img, link, at, place, created, go?, goReq?, goN?, cancelled?}
//   prsvp/<id>__<gid>     תשובה אחת של אורח: {name, ans, ts, th?, pe?, pa?, pts?, rm?}   (אורח כותב רק את המסמך שלו; פעולות המארח לא כותבות תשובות, חוץ מ-remove)
//   ppush/<id>            מונים של פוש למארח: {n, dAt, pend}
//   phost/<hash40>__<id>  אינדקס ערבי מארח (לפי hash של הטוקן)         pexp/<yyyymmdd>__<id>  אינדקס פקיעה לניקוי היומי
// פרטיות: אף טוקן גולמי לא נשמר. הטוקן לפוש נשמר מוצפן (pe, AES-256-GCM, מפתח HKDF מ-FIRE_SECRET) ומפוענח רק בשליחת פוש.
// תשובה ציבורית: שמות פרטיים + תשובות. למארח בלבד: rid (מזהה לא הפיך להסרת אורח). אף פעם לא tokHash/th/pe/gid.
import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, hkdfSync } from "node:crypto";
import { readJson, writeJson, delJson, listPrefix, listRange } from "./_db.js";
import { getSubs, sendTo } from "./_push.js";
import { okToken } from "./_store.js";

export const MAX_BODY = 16384;
export const MAX_ACTIVE = 10;            // ערבים פעילים לכל מארח
export const MAX_RSVPS = 40;             // תשובות לערב
export const NAME_MAX = 24;
export const EXPIRE_MS = 2 * 86400000;   // ערב שעברו יומיים ממועדו: נחשב לא קיים, ונמחק בניקוי היומי
export const GO_BEFORE = 60 * 60000;     // "פליי" (ופיענוח תשובות) מותר החל משעה לפני
export const GO_AFTER = 180 * 60000;     // ...ועד 3 שעות אחרי
export const GO_COOLDOWN = 60000;        // פעם בדקה
export const GO_LEAD = 15000;            // הספירה לאחור מתחילה 15 שניות מהבקשה (זמן לפוש להגיע)
export const MAX_GO = 5;                 // כמה פעמים אפשר לשלוח פוש "פליי" לכל ערב
export const MIN_PUSH_GAP = 30000;       // פוש למארח על אותו אורח: לא יותר מפעם ב-30 שניות
export const MAX_INDIV = 5;              // פושים בודדים למארח לכל ערב; אחריהם רק סיכום
export const DIGEST_GAP = 10 * 60000;    // סיכום פוש למארח: לא יותר מפעם ב-10 דקות
export const ANS = ["yes", "maybe", "no"];
export const APP = "https://eladweiss-ops.github.io/tv-guide/";

const RE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{20}[A-Za-z0-9]$/, RE_GID = /^[A-Za-z0-9][A-Za-z0-9_-]{14,30}[A-Za-z0-9]$/;
const RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\/[A-Za-z0-9_\/.-]{1,120}$/;
const RE_NFLINK = /^https:\/\/www\.(netflix|disneyplus)\.com\/[^\s<>"'\\]{0,300}$/;
export const okId = (s) => typeof s === "string" && RE_ID.test(s);
export const okGid = (s) => typeof s === "string" && RE_GID.test(s);

export function newId() {
  for (;;) {
    const id = randomBytes(16).toString("base64url");
    if (RE_ID.test(id)) return id;
  }
}
export const hashTok = (t) => createHash("sha256").update("party|" + t).digest("hex");
const hostKey = (h) => h.slice(0, 40);
export const ridOf = (id, gid) => createHash("sha256").update("rid|" + id + "|" + gid).digest("hex").slice(0, 12);
function eqHash(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- הצפנת הטוקן לפוש (לא נשמר גולמי). מפתח נפרד מזה של הנודניק (תווית HKDF אחרת), בלי משתני סביבה חדשים ----
const secret = () => process.env.FIRE_SECRET || "";
const pkey = () => Buffer.from(hkdfSync("sha256", secret(), "tv-guide-cal/v2", "party-push-aes-gcm", 32));
export function sealTok(t) {
  if (!secret()) return "";
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", pkey(), iv);
  const ct = Buffer.concat([c.update(String(t), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
export function openTok(s) {
  if (!secret() || typeof s !== "string") return null;
  try {
    const b = Buffer.from(s, "base64url");
    if (b.length < 29) return null;
    const d = createDecipheriv("aes-256-gcm", pkey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const t = Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
    return okToken(t) ? t : null;
  } catch (e) { return null; }
}

// ---- ניקוי טקסט: בלי תווי בקרה/כיוון נסתרים; שם וכותרת בלי קישורים ובלי מספרי טלפון ----
const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
export function cleanText(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, max);
}
export function hasContact(s) { // קישור או מספר טלפון (7 ספרות ומעלה ברצף עם מפרידים)
  if (/https?:|www\.|:\/\/|\b[a-z0-9-]+\.(com|net|org|io|co|il|me|ly|app)\b/i.test(s)) return true;
  const m = s.match(/\+?\d[\d\s().-]{5,}\d/g) || [];
  return m.some((x) => x.replace(/\D/g, "").length >= 7);
}
export function cleanName(s) {
  const n = cleanText(s, NAME_MAX);
  return !n || hasContact(n) ? "" : n;
}
export function cleanLink(s) {
  if (typeof s !== "string" || s.length > 400) return "";
  if (RE_NFLINK.test(s)) return s;
  if (s === APP || (s.indexOf(APP + "?") === 0 && /^[A-Za-z0-9?&=._|%~+-]{1,200}$/.test(s.slice(APP.length)))) return s;
  return "";
}

const path = (id) => `party/${id}.json`;
const rpath = (id, gid) => `prsvp/${id}__${gid}.json`;
const hpath = (h, id) => `phost/${hostKey(h)}__${id}.json`;
const ppath = (id) => `ppush/${id}.json`;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
const xpath = (at, id) => `pexp/${dayOf(at + EXPIRE_MS)}__${id}.json`;
const live = (p, now) => p && typeof p.at === "number" && now <= p.at + EXPIRE_MS;

const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];
const fmtHm = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function whenHe(ms) {
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(ms)];
  return (wd === 6 ? "" : "יום ") + DAYS[wd] + " " + fmtHm.format(ms);
}

// p: מסמך הערב (עם id), rs: [{gid, ...תשובה}]. host=true מוסיף rid להסרה
export function publicView(p, rs, now, gid, host) {
  const vis = (rs || []).filter((r) => !r.rm).sort((a, b) => a.ts - b.ts);
  const counts = { yes: 0, maybe: 0, no: 0 };
  vis.forEach((r) => { if (counts[r.ans] != null) counts[r.ans]++; });
  const v = {
    id: p.id, title: p.title, kind: p.kind, ref: p.ref, ch: p.ch || "", img: p.img || "", link: p.link || "", at: p.at, place: p.place,
    host: { name: p.host.name || "" }, rsvps: vis.map((r) => (host ? { name: r.name, ans: r.ans, rid: ridOf(p.id, r.gid) } : { name: r.name, ans: r.ans })), counts, now,
  };
  if (p.cancelled) v.cancelled = true;
  if (p.go) v.go = p.go;
  const mine = gid && okGid(gid) && vis.find((r) => r.gid === gid);
  if (mine) v.mine = { ans: mine.ans, name: mine.name, push: !!mine.pe };
  return v;
}

const err = (status, error) => ({ status, json: { error } });
const hasPush = async (t, gs) => { try { const s = await gs(t); return Array.isArray(s) && s.length > 0; } catch (e) { return false; } };

// d (לבדיקות): {now, readJson, writeJson, delJson, listPrefix, getSubs, sendTo}
export async function handleParty(action, input, d = {}) {
  const rj = d.readJson || readJson, wj = d.writeJson || writeJson, dj = d.delJson || delJson, lp = d.listPrefix || listPrefix, gs = d.getSubs || getSubs, snd = d.sendTo || sendTo;
  const now = d.now ? d.now() : Date.now();
  const load = async (id) => {
    if (!okId(id)) return null;
    const p = await rj(path(id), null);
    return p && typeof p === "object" && live(p, now) ? { ...p, id } : null;
  };
  const save = async (p) => { const o = { ...p }; delete o.id; await wj(path(p.id), o); };
  const loadRs = async (id) => (await lp("prsvp", id + "__")).filter((r) => r.value && typeof r.value === "object").map((r) => ({ ...r.value, gid: r.id.slice(id.length + 2) }));
  const hostOk = (p, t) => okToken(t) && eqHash(hashTok(t), p.host.tokHash);
  const push = async (tok, payload) => { try { const r = await snd(tok, payload); return !!(r && r.ok); } catch (e) { console.error("party push failed"); return false; } };
  const sealIf = async (t) => (secret() && okToken(t) && (await hasPush(t, gs)) ? sealTok(t) : "");

  if (action === "get") {
    const p = await load(input.id);
    if (!p) return err(404, "gone");
    return { status: 200, json: publicView(p, await loadRs(p.id), now, input.g || input.gid) };
  }

  if (action === "create") {
    if (!okToken(input.t)) return err(400, "bad token");
    // רק מי שהאפליקציה שלו כבר פגשה את השרת (מנוי פוש, תזכורות או גיבוי): טוקן אקראי לא יכול ליצור ערבים
    const known = (await hasPush(input.t, gs)) || (await rj(`rems/${input.t}.json`, null)) != null || (await rj(`backup/${input.t}.json`, null)) != null;
    if (!known) return err(403, "unknown token");
    const title = cleanText(input.title, 120), at = input.at;
    if (!title || hasContact(title)) return err(400, "bad title");
    if (input.kind !== "nf" && input.kind !== "tv") return err(400, "bad kind");
    const ref = cleanText(input.ref, 80);
    if (!ref || !/^[\w|.:+ -]+$/.test(ref)) return err(400, "bad ref");
    if (typeof at !== "number" || !Number.isFinite(at) || at < now - GO_BEFORE || at > now + 120 * 86400000) return err(400, "bad time");
    if (input.place !== "home" && input.place !== "each") return err(400, "bad place");
    const hn = cleanText(input.name || "", NAME_MAX);
    if (hn && !cleanName(hn)) return err(400, "bad name");
    const th = hashTok(input.t);
    let act = 0;
    for (const r of (await lp("phost", hostKey(th) + "__")).slice(0, 40)) {
      const q = await load(r.id.slice(42));
      if (q && !q.cancelled && q.host.tokHash === th) act++;
    }
    if (act >= MAX_ACTIVE) return err(409, "too many");
    const id = newId(), pe = await sealIf(input.t);
    const p = {
      v: 2, host: { tokHash: th, name: hn, ...(pe ? { pe } : {}) },
      title, kind: input.kind, ref, ch: cleanText(input.ch || "", 40), img: RE_IMG.test(input.img || "") ? input.img : "",
      link: cleanLink(input.link || ""), at: Math.round(at), place: input.place, created: now,
    };
    await wj(path(id), p);
    await wj(hpath(th, id), { at: p.at });
    await wj(xpath(p.at, id), { at: p.at });
    return { status: 200, json: publicView({ ...p, id }, [], now) };
  }

  // המארח: רשימת הערבים שלו (למכשיר חדש). לפי hash הטוקן
  if (action === "list") {
    if (!okToken(input.t)) return err(400, "bad token");
    const th = hashTok(input.t), out = [];
    for (const r of (await lp("phost", hostKey(th) + "__")).slice(0, 40)) {
      const q = await load(r.id.slice(42));
      if (!q || q.cancelled || q.host.tokHash !== th) continue;
      const v = publicView(q, await loadRs(q.id), now);
      out.push({ id: q.id, title: q.title, kind: q.kind, ref: q.ref, ch: q.ch || "", img: q.img || "", link: q.link || "", at: q.at, place: q.place, name: q.host.name || "", counts: v.counts });
    }
    return { status: 200, json: { parties: out } };
  }

  // שאר הפעולות על ערב קיים
  const p = await load(input.id);
  if (!p) return err(404, "gone");

  if (action === "view") { // המארח: תצוגה (עם rid להסרה) + רענון מנוי הפוש שלו
    if (!hostOk(p, input.t)) return err(403, "not host");
    const pe = await sealIf(input.t);
    if (!!pe !== !!p.host.pe) { if (pe) p.host.pe = pe; else delete p.host.pe; await save(p); }
    return { status: 200, json: { ...publicView(p, await loadRs(p.id), now, "", true), host: { name: p.host.name || "", me: true, push: !!p.host.pe } } };
  }

  if (action === "cancel") {
    if (!hostOk(p, input.t)) return err(403, "not host");
    const was = !!p.cancelled;
    if (input.undo) delete p.cancelled; else if (!was) p.cancelled = now;
    await save(p);
    let pushed = 0;
    if (p.cancelled && !was) { // מי שענה "בפנים"/"אולי" ויש לו פוש: מקבל הודעה (פעם אחת)
      const toks = new Set();
      (await loadRs(p.id)).forEach((r) => { if (!r.rm && r.ans !== "no" && r.pe) { const t = openTok(r.pe); if (t) toks.add(t); } });
      for (const t of toks) if (await push(t, { title: "🍿 ערב הצפייה בוטל · " + p.title, body: whenHe(p.at), tag: "w|" + p.id, url: "./?w=" + p.id })) pushed++;
    }
    return { status: 200, json: { ok: true, cancelled: !!p.cancelled, pushed } };
  }

  if (action === "remove") { // המארח מסיר אורח (כפילות/ספאם); undo מחזיר. האורח המוסר לא יכול לענות שוב
    if (!hostOk(p, input.t)) return err(403, "not host");
    const r = (await loadRs(p.id)).find((x) => ridOf(p.id, x.gid) === input.rid);
    if (!r) return err(404, "no such answer");
    const o = { ...r }; delete o.gid;
    if (input.undo) delete o.rm; else o.rm = 1;
    await wj(rpath(p.id, r.gid), o);
    return { status: 200, json: { ok: true, removed: !!o.rm } };
  }

  if (action === "go") {
    if (!hostOk(p, input.t)) return err(403, "not host");
    if (p.cancelled) return err(409, "cancelled");
    if (now < p.at - GO_BEFORE || now > p.at + GO_AFTER) return err(403, "window");
    if (p.go && p.goReq && now - p.goReq < GO_COOLDOWN) return { status: 200, json: { ok: true, go: p.go, now, repeat: true, pushed: 0 } };
    const limited = (p.goN || 0) >= MAX_GO;
    p.go = now + GO_LEAD; p.goReq = now; if (!limited) p.goN = (p.goN || 0) + 1;
    await save(p);
    let pushed = 0;
    if (!limited) {
      const toks = new Set(); // המארח לא מקבל פוש על עצמו (הספירה מופיעה אצלו ישר)
      (await loadRs(p.id)).forEach((r) => { if (!r.rm && (r.ans === "yes" || r.ans === "maybe") && r.pe) { const t = openTok(r.pe); if (t && !eqHash(hashTok(t), p.host.tokHash)) toks.add(t); } });
      const payload = { title: "🍿 מתחילים! 3, 2, 1… פליי", body: (p.host.name ? "ערב הצפייה של " + p.host.name : "ערב הצפייה") + " · " + p.title, tag: "w|" + p.id, url: "./?w=" + p.id + "&go=1" };
      for (const t of toks) if (await push(t, payload)) pushed++;
    }
    return { status: 200, json: { ok: true, go: p.go, now, pushed, ...(limited ? { limited: true } : {}) } };
  }

  if (action === "rsvp") {
    if (p.cancelled) return err(409, "cancelled");
    if (!okGid(input.gid)) return err(400, "bad gid");
    if (ANS.indexOf(input.ans) < 0) return err(400, "bad answer");
    const name = cleanName(input.name);
    if (!name) return err(400, "bad name");
    if (now > p.at + GO_AFTER) return err(409, "over");
    const rs = await loadRs(p.id), tok = okToken(input.t) ? input.t : "", th = tok ? hashTok(tok) : "";
    let prev = rs.find((r) => r.gid === input.gid);
    if (prev && prev.rm) return err(403, "removed");
    // אותו מכשיר (אותו טוקן) עם gid אחר: ממזגים לתשובה אחת
    const dup = th ? rs.find((r) => r.th === th && r.gid !== input.gid && !r.rm) : null;
    if (!prev && dup) { prev = dup; }
    if (!prev && rs.length >= MAX_RSVPS) return err(409, "full");
    const r = { name, ans: input.ans, ts: prev ? prev.ts : now };
    if (th) r.th = th;
    if (prev && prev.pa) r.pa = prev.pa;
    if (prev && prev.pts) r.pts = prev.pts;
    const pe = tok ? await sealIf(tok) : "";
    if (pe) r.pe = pe;
    // פוש למארח: רק על שינוי תשובה אמיתי; עד 5 בודדים לערב ואז סיכום אחד לכל היותר כל 10 דקות; לא על המארח עצמו
    const selfHost = th && eqHash(th, p.host.tokHash), hostTok = p.host.pe ? openTok(p.host.pe) : null;
    if (hostTok && !selfHost && r.pa !== r.ans && (!r.pts || now - r.pts >= MIN_PUSH_GAP)) {
      const pp = await rj(ppath(p.id), { n: 0, dAt: 0, pend: 0 });
      if ((pp.n || 0) < MAX_INDIV) {
        const lbl = r.ans === "yes" ? "אני בפנים 👍" : r.ans === "maybe" ? "אולי 🤔" : "לא הפעם";
        if (await push(hostTok, { title: "🍿 תשובה חדשה מ" + name + ": " + lbl, body: p.title + " · " + whenHe(p.at), tag: "w|" + p.id, url: "./?w=" + p.id })) { r.pa = r.ans; r.pts = now; pp.n = (pp.n || 0) + 1; await wj(ppath(p.id), pp); }
      } else {
        pp.pend = (pp.pend || 0) + 1; r.pa = r.ans; r.pts = now;
        if (now - (pp.dAt || 0) >= DIGEST_GAP) {
          const txt = pp.pend === 1 ? "🍿 עוד תשובה אחת לערב הצפייה" : "🍿 עוד " + pp.pend + " תשובות לערב הצפייה";
          if (await push(hostTok, { title: txt, body: p.title + " · " + whenHe(p.at), tag: "w|" + p.id, url: "./?w=" + p.id })) { pp.dAt = now; pp.pend = 0; }
        }
        await wj(ppath(p.id), pp);
      }
    }
    await wj(rpath(p.id, input.gid), r);
    if (dup && dup.gid !== input.gid) await dj(rpath(p.id, dup.gid));
    const rs2 = rs.filter((x) => x.gid !== input.gid && !(dup && x.gid === dup.gid)).concat([{ ...r, gid: input.gid }]);
    return { status: 200, json: publicView(p, rs2, now, input.gid) };
  }

  return err(400, "bad action");
}

// ניקוי יומי (נקרא מ-/api/watch-check): מוחק ערבים שעברו יומיים מהמועד, לפי אינדקס פקיעה (שאילתת טווח, בלי לקרוא את כל האוסף). מכבד deadline משותף
export async function cleanParties(now = Date.now(), o = {}) {
  const lr = o.listRange || listRange, lp = o.listPrefix || listPrefix, dj = o.del || delJson, rj = o.read || readJson, max = o.max || 100, deadline = o.deadline || Infinity;
  const rows = await lr("pexp", "0", dayOf(now)); // ימי פקיעה שכבר עברו
  let n = 0;
  for (const r of rows) {
    if (n >= max || Date.now() > deadline) break;
    const m = /^(\d{8})__(.+)$/.exec(r.id);
    if (!m) continue;
    const id = m[2], p = await rj(path(id), null);
    if (p && typeof p.at === "number" && now <= p.at + EXPIRE_MS) continue; // לא פג בפועל (הגנה)
    for (const x of await lp("prsvp", id + "__")) await dj(`prsvp/${x.id}.json`);
    await dj(ppath(id));
    if (p && p.host && p.host.tokHash) await dj(hpath(p.host.tokHash, id));
    await dj(path(id));
    await dj(`pexp/${r.id}.json`);
    n++;
  }
  return n;
}
