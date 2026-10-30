// לוגיקה טהורה של רשימת התזכורות (בלי תלויות, כדי שאפשר לבדוק עם node --test)

// מנקה ומגביל את מה שנשמר. dbl=1: "וגם בתחילת השידור" (התראה שנייה ברגע ההתחלה), רק כשיש התראה מוקדמת (lead>0)
export function clean(arr) {
  if (!Array.isArray(arr)) return [];
  const now = Date.now();
  return arr.slice(0, 300).map((x) => {
    const lead = Number.isFinite(+x.lead) ? Math.max(0, Math.min(10080, Math.round(+x.lead))) : 10;
    const o = { k: String(x.k || "").slice(0, 80), title: String(x.title || "").slice(0, 200), ch: String(x.ch || "").slice(0, 80),
      desc: String(x.desc || "").slice(0, 400), ts: +x.ts, end: +x.end, lead };
    if (x.dbl && lead > 0) o.dbl = 1;
    return o;
  }).filter((x) => x.k && !x.k.startsWith("__") && x.title && x.ts > 0 && x.end > x.ts && x.end > now - 86400000);
}

export const START_SUFFIX = "#s";

// stOnly (פנימי, אחרי ירי של ההתראה המוקדמת): רק הודעת ההתחלה נשארת מתוזמנת, ההתראה הרגילה לא תתוזמן שוב
// אילו הודעות מתוזמנות צריכות להיות: { מפתח: זמן }. ההתראה הרגילה לפי k, התראת ההתחלה לפי k+"#s"
export function wantedSchedule(rems, now) {
  const want = {};
  for (const r of rems) {
    const at = r.ts - (r.lead || 0) * 60000;
    if (!r.stOnly && at > now - 30000 && r.ts > now) want[r.k] = Math.max(at, now + 5000);
    if (r.dbl && r.lead > 0 && r.ts > now + 5000) want[r.k + START_SUFFIX] = r.ts;
  }
  return want;
}
