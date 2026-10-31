// לוגיקת חיפוש נטפליקס (בלי תלות ב-Vercel/Firestore, כדי לבדוק עם node --test). d: {fetch, key}
import { tget, providersIL, shapeTitle, applyAvail, img } from "./_tmdb.js";

export const MAX_ITEMS = 26;     // תקרת פריטים בתשובה (וכך גם בקשות watch/providers לחיפוש)
export const MAX_PARTS = 12;     // חלקי אוסף
export const MAX_PERSONS = 3;
export const CREDITS = 8;        // פריטים מובילים מהקרדיטים של האדם הראשון
export const SEARCH_TTL = 12 * 3600 * 1000;

// כינויים בעברית לחברות/מותגים (TMDB מחזיר שמות חברות באנגלית בלבד)
export const BRANDS = {
  "מארוול": "Marvel Studios", "מרוול": "Marvel Studios", "דיסני": "Walt Disney Pictures", "פיקסאר": "Pixar", "פיקסר": "Pixar",
  "דיסי": "DC Entertainment", "וורנר": "Warner Bros.", "וורנר ברדרס": "Warner Bros.", "יוניברסל": "Universal Pictures", "פרמאונט": "Paramount Pictures",
  "סוני": "Columbia Pictures", "לוקאספילם": "Lucasfilm", "דרימוורקס": "DreamWorks Animation", "הבי או בי": "HBO", "אמזון": "Amazon Studios",
  "נטפליקס": "Netflix", "אפל": "Apple Studios", "אי24": "A24", "בלומהאוס": "Blumhouse Productions", "גיבלי": "Studio Ghibli",
};

export const norm = (s) => {
  let t = String(s || "").toLowerCase();
  try { t = t.normalize("NFD"); } catch (e) {}
  return t.replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9֐-׿]+/g, "");
};

export function cleanQuery(q) {
  if (typeof q !== "string") return "";
  const s = q.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 2 && s.length <= 60 ? s : "";
}

const safe = (p) => p.catch(() => null);
const byRel = (a, b) => (a.rel || "9999").localeCompare(b.rel || "9999");

// משלים זמינות (watch/providers) לפריטים; כשל בודד לא מפיל את החיפוש (הפריט נשאר "לא זמין")
async function availAll(items, d, cache, onFail) {
  const todo = items.slice();
  const run = async () => {
    while (todo.length) {
      const o = todo.shift();
      const ck = o.k;
      let av = cache && cache.get(ck);
      if (!av || Date.now() - av.t > SEARCH_TTL) {
        try { av = { t: Date.now(), v: await providersIL(o.type, o.id, d) }; if (cache) cache.set(ck, av); } catch (e) { av = null; if (onFail) onFail(); }
      }
      if (av) applyAvail(o, av.v);
    }
  };
  await Promise.all([run(), run(), run(), run(), run(), run()]);
}

// התוצאה: {v, q, collection:{id,name,poster,keys}|null, brand:{name,keys}|null, titles:[k], persons:[{id,name,photo,dept,keys}], items:{k:item}}
export async function searchNf(q0, d = {}) {
  const q = cleanQuery(q0);
  if (!q) return null;
  const items = {}, order = [];
  let partial = false; // כשל בכל תת-קריאה (חיפוש, אוסף, מותג, קרדיטים, זמינות): התוצאה חלקית ולא נשמרת לטווח ארוך
  const sf = (p) => p.catch(() => { partial = true; return null; });
  const add = (he, en, type, extra) => {
    const o = shapeTitle(he, en, type); if (!o) return null;
    if (items[o.k]) return items[o.k];
    if (order.length >= MAX_ITEMS) return null;
    if (extra) Object.assign(o, extra);
    items[o.k] = o; order.push(o.k); return o;
  };
  const alias = BRANDS[q.toLowerCase()] || BRANDS[q] || "";
  const [heM, enM, cols, comps] = await Promise.all([
    sf(tget("/search/multi", { query: q, language: "he-IL", include_adult: "false" }, d)),
    sf(tget("/search/multi", { query: q, language: "en-US", include_adult: "false" }, d)),
    sf(tget("/search/collection", { query: alias || q, language: "he-IL" }, d)),
    sf(tget("/search/company", { query: alias || q }, d)),
  ]);
  if (!heM && !enM) { const e = new Error("tmdb down"); e.status = 502; throw e; }
  const enById = {};
  ((enM && enM.results) || []).forEach((r) => { if (r && r.id) enById[r.media_type + ":" + r.id] = r; });

  // אוסף (סדרת סרטים), לפי סדר יציאה
  let collection = null;
  const topCol = cols && Array.isArray(cols.results) && cols.results[0];
  if (topCol && Number.isInteger(topCol.id) && (norm(topCol.name).includes(norm(q)) || norm(q).includes(norm(topCol.name)) || (alias && norm(topCol.name).includes(norm(alias))) || cols.results.length === 1)) {
    const full = await sf(tget("/collection/" + topCol.id, { language: "he-IL" }, d));
    if (full && Array.isArray(full.parts) && full.parts.length) {
      const parts = full.parts.filter((p) => p && p.id).map((p) => ({ ...p, rel: p.release_date || "" })).sort(byRel).slice(0, MAX_PARTS);
      const keys = [];
      parts.forEach((p) => { const o = add(p, null, "movie"); if (o) keys.push(o.k); });
      if (keys.length) collection = { id: topCol.id, name: String(full.name || topCol.name || "").slice(0, 120), poster: img(full.poster_path || topCol.poster_path, "w342"), keys };
    }
  }

  // מותג/חברה: discover לפי with_companies
  let brand = null;
  const topCo = comps && Array.isArray(comps.results) && comps.results[0];
  const want = norm(alias || q);
  if (topCo && Number.isInteger(topCo.id) && want.length >= 3 && norm(topCo.name).includes(want)) {
    const [dm, dt] = await Promise.all([
      sf(tget("/discover/movie", { with_companies: topCo.id, sort_by: "popularity.desc", language: "he-IL", include_adult: "false" }, d)),
      sf(tget("/discover/tv", { with_companies: topCo.id, sort_by: "popularity.desc", language: "he-IL" }, d)),
    ]);
    const mix = [];
    ((dm && dm.results) || []).slice(0, 8).forEach((r) => mix.push([r, "movie"]));
    ((dt && dt.results) || []).slice(0, 4).forEach((r) => mix.push([r, "tv"]));
    mix.sort((a, b) => (b[0].popularity || 0) - (a[0].popularity || 0));
    const keys = [];
    mix.forEach(([r, t]) => { const o = add(r, null, t); if (o) keys.push(o.k); });
    if (keys.length) brand = { name: String(topCo.name || "").slice(0, 80), keys };
  }

  // תוצאות רגילות + אנשים
  const titles = [], persons = [];
  const rs = (heM && heM.results) || (enM && enM.results) || [];
  for (const r of rs) {
    if (!r) continue;
    if (r.media_type === "person") {
      if (persons.length < MAX_PERSONS && Number.isInteger(r.id)) persons.push({ id: r.id, raw: r });
      continue;
    }
    if (r.media_type !== "movie" && r.media_type !== "tv") continue;
    const o = add(r, enById[r.media_type + ":" + r.id], r.media_type);
    if (o && titles.indexOf(o.k) < 0) titles.push(o.k);
    if (titles.length >= 10) break;
  }
  // כל מה שבאוסף/מותג שלא ברשימה הרגילה לא מוכפל; titles הם הרגילים בלבד

  // אנשים: known_for + קרדיטים מובילים לאדם הראשון
  const outPersons = [];
  for (let i = 0; i < persons.length; i++) {
    const r = persons[i].raw, keys = [];
    (Array.isArray(r.known_for) ? r.known_for : []).forEach((kf) => {
      if (kf && (kf.media_type === "movie" || kf.media_type === "tv")) { const o = add(kf, null, kf.media_type); if (o && keys.indexOf(o.k) < 0) keys.push(o.k); }
    });
    if (i === 0) {
      const cc = await sf(tget("/person/" + r.id + "/combined_credits", { language: "he-IL" }, d));
      if (cc) {
        const dir = r.known_for_department === "Directing";
        const pool = (dir ? (cc.crew || []).filter((c) => c.job === "Director") : (cc.cast || []))
          .filter((c) => c && (c.media_type === "movie" || c.media_type === "tv") && c.vote_count > 100)
          .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
        const seen = {};
        for (const c of pool) {
          if (keys.length >= CREDITS) break;
          if (seen[c.media_type + c.id]) continue; seen[c.media_type + c.id] = 1;
          const o = add(c, null, c.media_type); if (o && keys.indexOf(o.k) < 0) keys.push(o.k);
        }
      }
    }
    outPersons.push({ id: r.id, name: String(r.name || "").slice(0, 80), photo: img(r.profile_path, "w185"), dept: r.known_for_department === "Directing" ? "בימוי" : r.known_for_department === "Acting" ? "משחק" : "", keys: keys.slice(0, CREDITS) });
  }

  await availAll(order.map((k) => items[k]), d, d.provCache, () => { partial = true; });
  const out = { v: 1, q, collection, brand, titles, persons: outPersons.filter((p) => p.name), items: {} };
  // רק פריטים שמופיעים באחת הקבוצות
  const used = new Set([...(collection ? collection.keys : []), ...(brand ? brand.keys : []), ...titles, ...outPersons.flatMap((p) => p.keys)]);
  order.forEach((k) => { if (used.has(k)) out.items[k] = items[k]; });
  if (partial) out.partial = true;
  return out;
}
