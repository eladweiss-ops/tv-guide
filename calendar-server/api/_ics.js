// הכנת טקסט לשדות iCalendar (RFC 5545 §3.3.11) וקיפול שורות
export const esc = (s) => String(s == null ? "" : s)
  .replace(/\r\n?/g, "\n")
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, "") // כל תווי הבקרה חוץ מ-\n ו-\t
  .replace(/\t/g, " ")
  .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

// שורות ארוכות מקופלות לפי התקן (75 בתים)
export function fold(line) {
  const out = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 73) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur); return out.join("\r\n");
}
