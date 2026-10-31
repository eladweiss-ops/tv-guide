// שכבת האחסון היחידה: Google Cloud Firestore (פרויקט tv-guide-8f736, מסד (default), europe-west3) דרך Admin SDK.
// הממשק זהה למה שהיה על Vercel Blob: נתיבים כמו "rems/<t>.json" ו-JSON חופשי. כל מסמך: {v: מחרוזת JSON, at: זמן כתיבה}.
// רק השרת ניגש (חוקי Firestore: deny all ללקוחות). האישורים: FIREBASE_SERVICE_ACCOUNT (מחרוזת ה-JSON המלאה של חשבון השירות).

// נתיב -> {col, id}. rems/<t>.json -> rems/<t>; snz/<t>/<hash>.json -> snz/<t>__<hash> (מזהה Firestore לא יכול להכיל "/")
export function mapPath(p) {
  const parts = String(p).replace(/\.json$/, "").split("/");
  if (parts.length < 2 || parts.some((x) => !x)) throw new Error("bad storage path");
  const col = parts[0], id = parts.slice(1).join("__");
  if (!/^[a-z][a-z0-9_]*$/.test(col) || id === "." || id === ".." || /^__.*__$/.test(id) || Buffer.byteLength(id) > 1000) throw new Error("bad storage path");
  return { col, id };
}

// ---- backend: ארבע פעולות גולמיות על מסמך. get -> מחרוזת או null ----
// client = מופע Firestore (או דמה עם אותו ממשק: collection(c).doc(id).get()/set()/delete(), collection(c).get())
export function firestoreBackend(client) {
  return {
    async get(col, id) { const s = await client.collection(col).doc(id).get(); return s.exists ? (s.data() || {}).v ?? null : null; },
    async set(col, id, v) { await client.collection(col).doc(id).set({ v, at: new Date() }); },
    async del(col, id) { await client.collection(col).doc(id).delete(); },
    async list(col) { const s = await client.collection(col).get(); return s.docs.map((d) => ({ id: d.id, v: (d.data() || {}).v ?? null })); },
  };
}

let backend = null, pending = null;
// לבדיקות: מזריק backend (או null לאיפוס)
export function _setBackend(b) { backend = b; pending = null; }

async function initBackend() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.error("missing FIREBASE_SERVICE_ACCOUNT"); throw new Error("missing FIREBASE_SERVICE_ACCOUNT"); }
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { console.error("bad FIREBASE_SERVICE_ACCOUNT (not JSON)"); throw new Error("bad FIREBASE_SERVICE_ACCOUNT"); }
  if (typeof sa.private_key === "string") sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  const { initializeApp, getApps, cert } = await import("firebase-admin/app");
  const { initializeFirestore, getFirestore } = await import("firebase-admin/firestore");
  const app = getApps()[0] || initializeApp({ credential: cert(sa), projectId: sa.project_id || "tv-guide-8f736" });
  let fs;
  try { fs = initializeFirestore(app, { preferRest: true }); } catch (e) { fs = getFirestore(app); } // כבר אותחל ב-instance הזה
  return firestoreBackend(fs);
}

// מאתחל פעם אחת לכל instance; כישלון לא נשמר (ניסיון חוזר בבקשה הבאה)
async function be() {
  if (backend) return backend;
  if (!pending) pending = initBackend().then((b) => (backend = b), (e) => { pending = null; throw e; });
  return pending;
}

export async function readJson(p, dflt) {
  const { col, id } = mapPath(p);
  const v = await (await be()).get(col, id);
  if (v == null) return dflt;
  try { return JSON.parse(v); } catch (e) { return dflt; }
}

// לא כותב מסמך שלא השתנה (חוסך כתיבות מהמכסה היומית). מחזיר true אם נכתב
export async function writeJson(p, o) {
  const { col, id } = mapPath(p);
  const b = await be(), s = JSON.stringify(o);
  if (Buffer.byteLength(s) > 900000) throw new Error("doc too big");
  if ((await b.get(col, id)) === s) return false;
  await b.set(col, id, s);
  return true;
}

export async function delJson(p) {
  const { col, id } = mapPath(p);
  await (await be()).del(col, id);
}

// כל המסמכים באוסף (במקום list של blobs): [{id, value}]
export async function listJson(col) {
  if (!/^[a-z][a-z0-9_]*$/.test(col)) throw new Error("bad collection");
  const rows = await (await be()).list(col);
  return rows.map((r) => { let value = null; try { value = JSON.parse(r.v); } catch (e) {} return { id: r.id, value }; });
}
