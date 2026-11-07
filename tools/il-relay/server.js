// ממסר קטן ב-Google Cloud Run, אזור תל אביב (me-west1): HOT חוסם שרתים מחוץ לישראל.
// מעביר בקשה אחת בלבד – לוח השידורים של HOT – ורק עם המפתח הנכון. לא פרוקסי פתוח.
// פריסה: tools/il-relay/deploy.ps1 (הקוד נכנס כ-base64 לפקודת node על node:22-slim, בלי build).
const http = require("http"), zlib = require("zlib");
const KEY = process.env.RELAY_KEY || "";
const HOT = "https://www.hot.net.il/HotCmsApiFront/api/ProgramsSchedual/GetProgramsSchedual";
const H = { "user-agent": "Mozilla/5.0 (personal TV guide)", "accept-language": "he", "content-type": "application/json", referer: "https://www.hot.net.il/heb/TV/TVGuide/" };
const DAY = /^\d{4}-\d\d-\d\d$/;
http.createServer(async (req, res) => {
  const end = (c, t) => { res.writeHead(c, { "content-type": "text/plain" }); res.end(t); };
  try {
    const u = new URL(req.url, "http://x");
    if (u.pathname !== "/hot" || req.method !== "GET") return end(404, "not found");
    if (!KEY || req.headers["x-relay-key"] !== KEY) return end(403, "forbidden");
    const from = u.searchParams.get("from"), to = u.searchParams.get("to");
    if (!DAY.test(from || "") || !DAY.test(to || "")) return end(400, "from/to");
    const r = await fetch(HOT, { method: "POST", headers: H, body: JSON.stringify({ ProgramsStartDateTime: from + "T00:00:00", ProgramsEndDateTime: to + "T23:59:59" }), signal: AbortSignal.timeout(60000) });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { "content-type": "application/json", "content-encoding": "gzip" });
    res.end(zlib.gzipSync(body));
  } catch (e) { end(502, "upstream: " + e.message); }
}).listen(process.env.PORT || 8080);
