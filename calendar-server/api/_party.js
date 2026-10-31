// 🍿 ערב צפייה: לוגיקה טהורה (בלי req/res), כדי שאפשר לבדוק עם node --test. נקודת הקצה: api/party.js
// מסמך party/<id>: {v, host:{tokHash, name, pt?}, title, kind:"nf"|"tv", ref, ch?, img?, link, at, place:"home"|"each", created, go?, goReq?, cancelled?, pushes?, rsvps:{<gid>:{name, ans, ts, pt?, pa?, pts?}}}
// פרטיות: tokHash/pt (טוקן לפוש בלבד, לא נחשף) ו-gid של אחרים לא יוצאים החוצה. publicView מחזיר רק שמות פרטיים ותשובות.
// אין חשבונות: המארח מזוהה בטוקן האישי הקיים (אותו okToken של /api/rems), האורח ב-gid אקראי שנשמר אצלו במכשיר.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readJson, writeJson, delJson, listJson } from "./_db.js";
import { getSubs, sendTo } from "./_push.js";
import { okToken } from "./_store.js";

export const MAX_BODY = 16384;
export const MAX_ACTIVE = 10;            // ערבים פעילים לכל מארח
export const MAX_RSVPS = 40;             // תשובות לכל ערב
export const NAME_MAX = 24;
export const EXPIRE_MS = 2 * 86400000;   // מסמך שעבר יומיים מ-at: נמחק / נחשב לא קיים
export const GO_BEFORE = 60 * 60000;     // "פליי" מותר החל משעה לפני
export const GO_AFTER = 180 * 60000;     // ...ועד 3 שעות אחרי
export const GO_COOLDOWN = 60000;        // פעם בדקה
export const GO_LEAD = 5000;             // הספירה לאחור מתחילה 5 שניות מהבקשה
export const MIN_PUSH_GAP = 30000;       // פוש למארח על אותו אורח: לא יותר מפעם ב-30 שניות
export const MAX_HOST_PUSHES = 80;       // תקרת פוש-אורחים למארח לכל ערב
export const ANS = ["yes", "maybe", "no"];
export const APP = "https://eladweiss-ops.github.io/tv-guide/";

const RE_ID = /^[A-Za-z0-9_-]{22}$/, RE_GID = /^[A-Za-z0-9_-]{16,32}$/;
const RE_IMG = /^https:\/\/image\.tmdb\.org\/t\/p\/[A-Za-z0-9_\/.-]{1,120}$/;
const RE_NFLINK = /^https:\/\/www\.netflix\.com\/[^\s<>"'\\]{0,300}$/;
export const okId = (s) => typeof s === "string" && RE_ID.test(s);
export const okGid = (s) => typeof s === "string" && RE_GID.test(s);

export function newId() {
  for (;;) {
    const id = randomBytes(16).toString("base64url");
    if (RE_ID.test(id) && !/^__.*__$/.test(id)) return id;
  }
}
export const hashTok = (t) => createHash("sha256").update("party|" + t).digest("hex");
const hostKey = (h) => h.slice(0, 40);
function eqHash(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// שם / כותרת: בלי תווי בקרה ותווי כיוון נסתרים, רווחים מאוחדים
const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
export function cleanText(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, max);
}
export function cleanName(s) {
  const n = cleanText(s, NAME_MAX);
  if (!n || /https?:|www\.|:\/\//i.test(n)) return "";
  return n;
}
export function cleanLink(s) {
  if (typeof s !== "string" || s.length > 400) return "";
  if (RE_NFLINK.test(s)) return s;
  if (s === APP || (s.indexOf(APP + "?") === 0 && /^[A-Za-z0-9?&=._|%~+-]{1,200}$/.test(s.slice(APP.length)))) return s;
  return "";
}

const path = (id) => `party/${id}.json`;
const ipath = (h) => `phost/${h}.json`;
const live = (p, now) => p && typeof p.at === "number" && now <= p.at + EXPIRE_MS;

const fmtHm = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];
export function whenHe(ms) {
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(ms)];
  return (wd === 6 ? "" : "יום ") + DAYS[wd] + " " + fmtHm.format(ms);
}

export function publicView(p, now, gid) {
  const rs = Object.entries(p.rsvps || {}).sort((a, b) => a[1].ts - b[1].ts);
  const counts = { yes: 0, maybe: 0, no: 0 };
  rs.forEach(([, r]) => { if (counts[r.ans] != null) counts[r.ans]++; });
  const v = {
    id: p.id, title: p.title, kind: p.kind, ref: p.ref, ch: p.ch || "", img: p.img || "", link: p.link || "", at: p.at, place: p.place,
    host: { name: p.host.name || "" }, rsvps: rs.map(([, r]) => ({ name: r.name, ans: r.ans })), counts, now,
  };
  if (p.cancelled) v.cancelled = true;
  if (p.go) v.go = p.go;
  const mine = gid && okGid(gid) && p.rsvps && p.rsvps[gid];
  if (mine) v.mine = { ans: mine.ans, name: mine.name };
  return v;
}

const err = (status, error) => ({ status, json: { error } });
const hasPush = async (t, gs) => { try { const s = await gs(t); return Array.isArray(s) && s.length > 0; } catch (e) { return false; } };

// d (לבדיקות): {now, readJson, writeJson, delJson, getSubs, sendTo}
export async function handleParty(action, input, d = {}) {
  const rj = d.readJson || readJson, wj = d.writeJson || writeJson, gs = d.getSubs || getSubs, snd = d.sendTo || sendTo;
  const now = d.now ? d.now() : Date.now();
  const load = async (id) => {
    if (!okId(id)) return null;
    const p = await rj(path(id), null);
    return p && typeof p === "object" && live(p, now) ? { ...p, id } : null;
  };
  const save = async (p) => { const o = { ...p }; delete o.id; await wj(path(p.id), o); };
  const hostOk = (p, t) => okToken(t) && eqHash(hashTok(t), p.host.tokHash);

  if (action === "get") {
    const p = await load(input.id);
    if (!p) return err(404, "gone");
    return { status: 200, json: publicView(p, now, input.g) };
  }

  if (action === "create") {
    if (!okToken(input.t)) return err(400, "bad token");
    const title = cleanText(input.title, 120), at = input.at;
    if (!title) return err(400, "bad title");
    if (input.kind !== "nf" && input.kind !== "tv") return err(400, "bad kind");
    const ref = cleanText(input.ref, 80);
    if (!ref || !/^[\w|.:+ -]+$/.test(ref)) return err(400, "bad ref");
    if (typeof at !== "number" || !Number.isFinite(at) || at < now - GO_BEFORE || at > now + 120 * 86400000) return err(400, "bad time");
    if (input.place !== "home" && input.place !== "each") return err(400, "bad place");
    const th = hashTok(input.t), ik = ipath(hostKey(th));
    // ערבים פעילים של המארח (מסננים מהאינדקס מה שנמחק / בוטל / פג)
    const idx = await rj(ik, { ids: [] });
    const act = [];
    for (const pid of Array.isArray(idx.ids) ? idx.ids.slice(0, 50) : []) {
      const q = await load(pid);
      if (q && !q.cancelled && q.host.tokHash === th) act.push(pid);
    }
    if (act.length >= MAX_ACTIVE) return err(409, "too many");
    const id = newId();
    const p = {
      v: 1, host: { tokHash: th, name: cleanName(input.name || ""), ...((await hasPush(input.t, gs)) ? { pt: input.t } : {}) },
      title, kind: input.kind, ref, ch: cleanText(input.ch || "", 40), img: RE_IMG.test(input.img || "") ? input.img : "",
      link: cleanLink(input.link || ""), at: Math.round(at), place: input.place, created: now, rsvps: {},
    };
    await wj(path(id), p);
    await wj(ik, { ids: [...act, id] });
    return { status: 200, json: publicView({ ...p, id }, now) };
  }

  // שאר הפעולות על ערב קיים
  const p = await load(input.id);
  if (!p) return err(404, "gone");

  if (action === "view") { // המארח: תצוגה + רענון מנוי הפוש שלו (כדי לקבל "דנה מגיעה" גם אם הפעיל התראות אחרי היצירה)
    if (!hostOk(p, input.t)) return err(403, "not host");
    const has = await hasPush(input.t, gs);
    if (has !== !!p.host.pt) { if (has) p.host.pt = input.t; else delete p.host.pt; await save(p); }
    return { status: 200, json: { ...publicView(p, now), host: { name: p.host.name || "", me: true, push: has } } };
  }

  if (action === "cancel") {
    if (!hostOk(p, input.t)) return err(403, "not host");
    if (input.undo) { delete p.cancelled; } else p.cancelled = now; // undo: "החזר" אחרי ביטול
    await save(p);
    return { status: 200, json: { ok: true, cancelled: !!p.cancelled } };
  }

  if (action === "go") {
    if (!hostOk(p, input.t)) return err(403, "not host");
    if (p.cancelled) return err(409, "cancelled");
    if (now < p.at - GO_BEFORE || now > p.at + GO_AFTER) return err(403, "window");
    if (p.go && p.goReq && now - p.goReq < GO_COOLDOWN) return { status: 200, json: { ok: true, go: p.go, now, repeat: true, pushed: 0 } };
    p.go = now + GO_LEAD; p.goReq = now;
    if (await hasPush(input.t, gs)) p.host.pt = input.t;
    await save(p);
    const toks = new Set();
    if (p.host.pt) toks.add(p.host.pt);
    Object.values(p.rsvps || {}).forEach((r) => { if (r.ans === "yes" || r.ans === "maybe") if (r.pt) toks.add(r.pt); });
    const payload = { title: "🍿 " + (p.host.name ? p.host.name + " מתחיל/ה את ערב הצפייה" : "מתחילים את ערב הצפייה"), body: p.title + " · 3, 2, 1… פליי!", tag: "w|" + p.id, url: "./?w=" + p.id + "&go=1" };
    let pushed = 0;
    for (const t of toks) { try { const r = await snd(t, payload); if (r && r.ok) pushed++; } catch (e) { console.error("party go push failed"); } }
    return { status: 200, json: { ok: true, go: p.go, now, pushed } };
  }

  if (action === "rsvp") {
    if (p.cancelled) return err(409, "cancelled");
    if (!okGid(input.gid)) return err(400, "bad gid");
    if (ANS.indexOf(input.ans) < 0) return err(400, "bad answer");
    const name = cleanName(input.name);
    if (!name) return err(400, "bad name");
    if (now > p.at + GO_AFTER) return err(409, "over");
    const rs = p.rsvps = p.rsvps || {}, prev = rs[input.gid];
    if (!prev && Object.keys(rs).length >= MAX_RSVPS) return err(409, "full");
    const r = { name, ans: input.ans, ts: prev ? prev.ts : now };
    if (prev && prev.pa) r.pa = prev.pa;
    if (prev && prev.pts) r.pts = prev.pts;
    // מנוי פוש של האורח (אם יש לו): רק כשיש לו מנוי אמיתי, והטוקן לא נחשף
    if (okToken(input.t) && (await hasPush(input.t, gs))) r.pt = input.t;
    // פוש למארח: רק על שינוי תשובה אמיתי, לא יותר מפעם ב-30 שניות לאורח, ותקרה לערב. אורח שהוא המארח עצמו לא מקבל
    const selfHost = okToken(input.t) && eqHash(hashTok(input.t), p.host.tokHash);
    if (p.host.pt && !selfHost && r.pa !== r.ans && (!r.pts || now - r.pts >= MIN_PUSH_GAP) && (p.pushes || 0) < MAX_HOST_PUSHES) {
      const txt = r.ans === "yes" ? "מגיעה" : r.ans === "maybe" ? "אולי מגיעה" : "לא תגיע";
      try {
        const res = await snd(p.host.pt, { title: "🍿 " + name + " " + txt + " לערב הצפייה", body: p.title + " · " + whenHe(p.at), tag: "w|" + p.id, url: "./?w=" + p.id });
        if (res && res.ok) { r.pa = r.ans; r.pts = now; p.pushes = (p.pushes || 0) + 1; }
      } catch (e) { console.error("party rsvp push failed"); }
    }
    rs[input.gid] = r;
    await save(p);
    return { status: 200, json: publicView(p, now, input.gid) };
  }

  return err(400, "bad action");
}

// ניקוי יומי (נקרא מ-/api/watch-check): מוחק עד max ערבים שעברו יומיים מהמועד, ומנקה אותם מאינדקס המארח. מכבד deadline
export async function cleanParties(now = Date.now(), o = {}) {
  const list = o.list || listJson, dj = o.del || delJson, rj = o.read || readJson, wj = o.write || writeJson, max = o.max || 100, deadline = o.deadline || Infinity;
  const rows = await list("party");
  let n = 0;
  const byHost = new Map();
  for (const r of rows) {
    if (n >= max || Date.now() > deadline) break;
    const v = r.value;
    if (!okId(r.id)) continue;
    if (v && typeof v.at === "number" && now <= v.at + EXPIRE_MS) continue;
    await dj(path(r.id)); n++;
    const th = v && v.host && v.host.tokHash;
    if (th) { const k = hostKey(th); (byHost.get(k) || byHost.set(k, new Set()).get(k)).add(r.id); }
  }
  for (const [k, ids] of byHost) {
    if (Date.now() > deadline) break;
    const idx = await rj(ipath(k), { ids: [] });
    const keep = (Array.isArray(idx.ids) ? idx.ids : []).filter((x) => !ids.has(x));
    if (keep.length) await wj(ipath(k), { ids: keep }); else await dj(ipath(k));
  }
  return n;
}
