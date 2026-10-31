// דמיות לבדיקות של api/_db.js: backend בזיכרון, לקוח Firestore מדומה (אותו ממשק ש-firestoreBackend משתמש בו), ו-backend שנכשל
export function memBackend() {
  const m = new Map(); // "col/id" -> v
  return {
    m,
    async get(col, id) { return m.has(col + "/" + id) ? m.get(col + "/" + id) : null; },
    async set(col, id, v) { m.set(col + "/" + id, v); },
    async del(col, id) { m.delete(col + "/" + id); },
    async list(col) { return [...m].filter(([k]) => k.startsWith(col + "/")).map(([k, v]) => ({ id: k.slice(col.length + 1), v })); },
  };
}

// מחקה את הצורה של Firestore Admin: collection(c).doc(id).get()/set()/delete(), collection(c).get().docs
export function fakeFirestoreClient() {
  const data = new Map(); // "col/id" -> {v, at}
  const ids = [];
  const client = {
    data, writes: 0,
    collection(col) {
      return {
        doc(id) {
          if (typeof id !== "string" || !id || id.includes("/")) throw new Error("invalid document id " + id); // כמו Firestore האמיתי
          return {
            async get() { const d = data.get(col + "/" + id); return { exists: !!d, id, data: () => d && { ...d } }; },
            async set(o) { client.writes++; if (typeof o.v !== "string" || !(o.at instanceof Date)) throw new Error("bad doc shape"); data.set(col + "/" + id, { v: o.v, at: o.at }); },
            async delete() { client.writes++; data.delete(col + "/" + id); },
          };
        },
        async get() { return { docs: [...data].filter(([k]) => k.startsWith(col + "/")).map(([k, d]) => ({ id: k.slice(col.length + 1), data: () => ({ ...d }) })) }; },
      };
    },
  };
  void ids;
  return client;
}

export function failingBackend(msg = "storage down") {
  const f = async () => { throw new Error(msg); };
  return { get: f, set: f, del: f, list: f };
}
