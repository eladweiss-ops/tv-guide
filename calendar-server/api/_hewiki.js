// תקציר בעברית מוויקיפדיה, לתוכן ש-TMDB אין לו תקציר בעברית (נפוץ בסרטים וסדרות ישראליים חדשים, למשל "עצמאות").
// החיבור לפי מזהה, לא לפי שם: ויקינתונים (P4947 סרט / P4983 סדרה = מזהה TMDB) → הערך בוויקיפדיה העברית. כך אין סכנה לתקציר של סרט אחר באותו שם.
// מהערך: תחילת פרק העלילה (2-3 משפטים, בלי להרוס את ההמשך), ואם אין – פסקת הפתיחה.
// heOverviews(list:[{k,type,id}], d) → {k: "תקציר"}; כשל/חריגת זמן = מה שהספקנו (בלי זריקה). משמש את השרת (nf-search) ואת netflix.mjs.
// d: {fetch, wikiBudget, max}. בלי תלויות, כדי ש-netflix.mjs (שורש המאגר) יוכל לייבא אותו.
export const HEW_SPARQL = "https://query.wikidata.org/sparql";
export const HEW_API = "https://he.wikipedia.org/w/api.php";
export const HEW_UA = "tv-guide-cal/1.0 (https://eladweiss-ops.github.io/tv-guide/; personal TV guide)"; // מדיניות ויקימדיה: UA עם דרך יצירת קשר
export const HEW_MAX = 8;          // ערכים לכל היותר בקריאה אחת (כל ערך = בקשה)
export const HEW_BUDGET = 3000;    // ms לכל התהליך
const HEB = /[֐-׿]/;
export const hasHeb = (s) => HEB.test(s || "");

async function get(url, d, end, accept) {
  const left = end - Date.now();
  if (left <= 0) throw new Error("hewiki budget");
  const r = await (d.fetch || fetch)(url, { headers: { "user-agent": HEW_UA, accept }, signal: AbortSignal.timeout ? AbortSignal.timeout(left) : undefined });
  if (!r.ok) throw new Error("hewiki " + r.status);
  return await r.json();
}

// מזהי TMDB → שם הערך בוויקיפדיה העברית. {k: title}
async function articles(list, d, end) {
  const mv = list.filter((x) => x.type === "movie").map((x) => '"' + x.id + '"').join(" ");
  const tv = list.filter((x) => x.type === "tv").map((x) => '"' + x.id + '"').join(" ");
  const parts = [];
  if (mv) parts.push("{ VALUES ?tm { " + mv + " } ?i wdt:P4947 ?tm . }");
  if (tv) parts.push("{ VALUES ?tv { " + tv + " } ?i wdt:P4983 ?tv . }");
  if (!parts.length) return {};
  const q = "SELECT ?tm ?tv ?a WHERE { " + parts.join(" UNION ") + " ?a schema:about ?i ; schema:isPartOf <https://he.wikipedia.org/> . }";
  const j = await get(HEW_SPARQL + "?format=json&query=" + encodeURIComponent(q), d, end, "application/sparql-results+json");
  const out = {};
  for (const b of (j && j.results && Array.isArray(j.results.bindings) ? j.results.bindings : [])) {
    const id = (b.tm && b.tm.value) || (b.tv && b.tv.value), a = b.a && b.a.value;
    if (!/^[0-9]{1,9}$/.test(id || "") || typeof a !== "string" || a.indexOf("https://he.wikipedia.org/wiki/") !== 0) continue;
    const k = (b.tm ? "m" : "t") + id;
    let t; try { t = decodeURIComponent(a.slice(30)).replace(/_/g, " "); } catch (e) { continue; }
    if (!out[k] && t && t.length <= 200) out[k] = t;
  }
  return out;
}

const PLOT = /^(תקציר העלילה|תקציר עלילה|עלילה|עלילת הסרט|עלילת הסדרה|תקציר|תקציר הסדרה|תקציר הסרט|רקע ועלילה)$/;
// טקסט ערך (explaintext) → 2-3 משפטים ראשונים מפרק העלילה, או מהפתיחה. "" כשאין עברית סבירה
export function pickDesc(text, max = 380) {
  const s = String(text || "").replace(/\r/g, "");
  const secs = s.split(/\n={2,}\s*([^=\n]+?)\s*={2,}\n/); // [פתיחה, כותרת1, גוף1, כותרת2, ...]
  let body = "";
  for (let i = 1; i + 1 < secs.length; i += 2) if (PLOT.test(secs[i].trim())) { body = secs[i + 1]; break; }
  if (!body.trim()) body = secs[0] || "";
  body = body.split(/\n={3,}[^=\n]+={3,}\n/)[0]                // תת-פרק ראשון בלבד
    .split("\n").filter((l) => !/^\s*(ערך מורחב|ערכים מורחבים|ערך מפורט|ערכים מפורטים|ראו גם|ראו ערך|לפירושים אחרים|המונח .{1,60} מפנה)/.test(l)).join("\n") // הפניות בראש הפרק
    .replace(/\s*\((?:באנגלית|בערבית|ברוסית|בצרפתית|בספרדית|בגרמנית|ביידיש|במקור)[^()]*\)/g, "") // "(באנגלית: Tell Me Everything)"
    .replace(/\[[0-9]+\]/g, "").replace(/\s+/g, " ").trim();
  if (!hasHeb(body) || body.length < 40) return "";
  const sent = body.match(/[^.!?]+[.!?]+(?:["״”’']+)?(?=\s|$)|[^.!?]+$/g) || [body];
  let out = "", n = 0;
  for (const x of sent) {
    const t = x.trim(); if (!t) continue;
    if (out && (n >= 3 || out.length + 1 + t.length > max || out.length >= 220)) break; // עד 3 משפטים: מספיק כדי להבין, בלי להרוס את ההמשך
    out = out ? out + " " + t : t; n++;
  }
  if (out.length > max) { const cut = out.slice(0, max), sp = cut.lastIndexOf(" "); out = (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, "") + "…"; }
  return out;
}

export async function heOverviews(list0, d = {}) {
  const list = (Array.isArray(list0) ? list0 : []).filter((x) => x && (x.type === "movie" || x.type === "tv") && Number.isInteger(x.id) && x.id > 0 && x.id < 1e9);
  if (!list.length) return {};
  const end = Date.now() + (d.wikiBudget || HEW_BUDGET), out = {};
  try {
    const arts = await articles(list, d, end);
    const ks = Object.keys(arts).slice(0, d.max || HEW_MAX);
    await Promise.all(ks.map(async (k) => {
      try {
        const j = await get(HEW_API + "?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=" + encodeURIComponent(arts[k]), d, end, "application/json");
        const pages = j && j.query && j.query.pages, p = pages && Object.values(pages)[0];
        const t = p && typeof p.extract === "string" ? pickDesc(p.extract) : "";
        if (t) out[k] = t;
      } catch (e) { /* ערך אחד שנכשל לא מפיל את השאר */ }
    }));
  } catch (e) { console.error("hewiki", e && e.message); }
  return out;
}
