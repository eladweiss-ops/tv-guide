// השלמת ימים חסרים: כשבלוח של וואלה אין (כמעט) שידורים לערוץ ביום מסוים, לוקחים את הלוח מאתר הערוץ עצמו.
// items: [{start:"YYYY-MM-DDTHH:MM" (שעון ישראל), title, desc?, rr?, lv?}]
export function fillGaps(guide, chIds, items, minPerDay = 6) {
  const ids = [...new Set(chIds.map(String))];
  if (!ids.length || !items.length) return 0;
  const byDay = new Map();
  for (const it of items) {
    if (!it || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(it.start) || !it.title) continue;
    const d = it.start.slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(it);
  }
  const toMin = (s) => Date.parse(s + ":00Z") / 60000;
  let added = 0;
  for (const ch of ids) {
    const mine = guide.programs.filter((p) => String(p.ch) === ch);
    for (const [day, list] of byDay) {
      const have = mine.filter((p) => p.start.slice(0, 10) === day);
      if (have.length >= minPerDay || list.length < 3) continue; // היום הזה מכוסה, או שהאתר עצמו כמעט ריק
      const times = have.map((p) => toMin(p.start));
      for (const it of list) {
        const t = toMin(it.start);
        if (times.some((x) => Math.abs(x - t) < 10)) continue;
        const p = { ch, start: it.start, title: it.title };
        if (it.desc) p.desc = it.desc; if (it.rr) p.rr = 1; if (it.lv === 0 || it.lv === 1) p.lv = it.lv;
        guide.programs.push(p); times.push(t); added++;
      }
    }
  }
  if (added) guide.programs.sort((a, b) => (a.ch === b.ch ? (a.start < b.start ? -1 : 1) : 0));
  return added;
}

// היום ועוד 7 ימים, בשעון ישראל
export function nextDays(n = 8) {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });
  const out = []; const now = Date.now();
  for (let i = 0; i < n; i++) out.push(f.format(new Date(now + i * 864e5)));
  return out;
}
