// אימות מנוי פוש (מניעת SSRF: השרת שולח בקשה לכתובת ה-endpoint, אז רק שירותי פוש מוכרים)
const HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/, // כולל wns2-*.notify.windows.com
];
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;

export function validEndpoint(ep) {
  if (typeof ep !== "string" || ep.length > 1000) return false;
  let u;
  try { u = new URL(ep); } catch (e) { return false; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h.includes(":") || h.startsWith("[") || /^[0-9.]+$/.test(h) || h.endsWith(".")) return false; // IPv6/IPv4 literal
  return HOSTS.some((re) => re.test(h));
}

// p256dh = 65 בתים (87 תווים), auth = 16 בתים (22 תווים); משאירים מרווח
export function validSub(sub) {
  if (!sub || typeof sub !== "object" || !validEndpoint(sub.endpoint)) return false;
  const k = sub.keys;
  if (!k || typeof k !== "object") return false;
  const ok = (v, lo, hi) => typeof v === "string" && v.length >= lo && v.length <= hi && B64U.test(v);
  return ok(k.p256dh, 80, 92) && ok(k.auth, 20, 28);
}
