// בדיקה שתיאור מאתר הערוץ באמת שייך לתוכנית בוואלה (ולא לתוכנית אחרת שקרובה בזמן).
const ABBR = [
  [/(^|[\s\-–(])מ\.\s?/g, "$1מכבי "], [/(^|[\s\-–(])ה\.\s?/g, "$1הפועל "], [/(^|[\s\-–(])ב\.\s?/g, '$1בית"ר '], [/(^|[\s\-–(])ע\.\s?/g, "$1עירוני "],
  [/(^|[\s\-–(])ל\.\s?/g, "$1ליגה "], [/(^|[\s\-–(])ת"?א(?=$|[\s\-–),.])/g, "$1תל אביב"], [/(^|[\s\-–(])ב"?ש(?=$|[\s\-–),.])/g, "$1באר שבע"],
  [/(^|[\s\-–(])רג(?=$|[\s\-–),.])/g, "$1רמת גן"], [/(^|[\s\-–(])פ"?ת(?=$|[\s\-–),.])/g, "$1פתח תקווה"],
];
const STOP = new Set("ישיר של עם את על נגד מחזור עונת עונה ליגת ליגה גביע תוכנית פרק משחק משחקי בין חלק ספורט הספורט חדשות מגזין אולפן מהדורה המהדורה שידור תקצירי המיטב".split(" "));
export function words(t) {
  t = " " + String(t || "").replace(/[״”“]/g, '"') + " ";
  for (const [a, b] of ABBR) t = t.replace(a, b);
  const out = new Set();
  for (let w of t.toLowerCase().match(/[\p{L}\p{N}"']+/gu) || []) {
    w = w.replace(/^["']+|["']+$/g, "");
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w.slice(0, 4));
    if (w.length > 4 && /^[הובלמש]/.test(w)) out.add(w.slice(1, 5)); // תחילית: "הפנטזי" ~ "פנטזי"
  }
  return out;
}
export function kind(t) {
  t = String(t || "");
  if (/כדורגל/.test(t)) return "fb";
  if (/כדורסל|ווינר סל|יורוליג|יורוקאפ|\bW?NBA\b/i.test(t)) return "bb";
  if (/\bNFL\b|פוטבול/i.test(t)) return "af";
  if (/\bNHL\b|הוקי/i.test(t)) return "ih";
  if (/טניס|\bATP\b|\bWTA\b|טורניר (באזל|וינה|פריז)/i.test(t)) return "tn";
  if (/פורמולה|\bF1\b|מוטו ?GP|נאסקר|\bGT\b|מירוץ/i.test(t)) return "mt";
  if (/פרמייר ליג|לה ליגה|סרייה|בונדסליגה|ליגת האלופות|ליגה (צרפתית|ספרדית|איטלקית|אנגלית|גרמנית)|ל\. (צרפתית|ספרדית|איטלקית|אנגלית|גרמנית|ברזילאית)|גביע הטוטו|ליגת ווינר(?! סל)|גביע הליגה/.test(t)) return "fb";
  return "";
}
// כותרות כלליות בוואלה ("ל. צרפתית", "יורוליג", "NBA") – מתאימות לתיאור משחק מאותו ענף
const GENERIC = /^(ישיר!?\s*)?(ל\.\s|ליגת|ליגה|גביע|יורוליג|יורוקאפ|NBA|NFL|NHL|ATP|WTA|טניס|כדורגל|כדורסל|המיטב|תקצירי|פרמייר|לה ליגה|סרייה|בונדסליגה|ליגת האלופות)/i;
const MATCHLIKE = /[\p{L}"'.]\s?[-–]\s?[\p{L}]/u;
export function fits(title, desc, lenient) {
  const kt = kind(title), kd = kind(desc);
  if (kt && kd && kt !== kd) return false;
  const tw = words(title), dw = words(desc);
  for (const w of tw) if (dw.has(w)) return true;
  // כותרת כללית ("ל. צרפתית", "NBA") מתאימה רק לתיאור שמראה במפורש את אותו ענף
  // בערוץ שהלוח שלו מסכים עם האתר (lenient) מקבלים גם תיאור משחק בלי ענף מפורש
  if (GENERIC.test(String(title).trim())) return kt && !lenient ? kd === kt : (kd ? kd === (kt || kd) : MATCHLIKE.test(desc) && !/תוכנית|מגזין|פרק|חדשות/.test(desc));
  return false;
}
// באיזו מידה לוח הערוץ בוואלה מסכים עם האתר: חלק המשבצות שמתאימות
export function agreement(pairs) { // [{title, text}] – לפי ההתאמה המחמירה
  if (!pairs.length) return 1;
  return pairs.filter((x) => fits(x.title, x.text, false)).length / pairs.length;
}
