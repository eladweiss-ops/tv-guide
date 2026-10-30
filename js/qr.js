/* js/qr.js - מחולל קוד QR מינימלי (מצב בתים, תיקון שגיאות L, גרסאות 1-6, עד 134 תווים ASCII), בלי ספרייה חיצונית.
   TVG.qr(text) -> {n, get(row, col)} (true = מודול כהה), או null אם הטקסט ארוך מדי. משמש את כרטיס השיתוף (share.js).
   חלק ממרחב השמות TVG (ראו index.html). נטען אחרי: core. */
(function (TVG) {
  TVG.files["qr"] = 1;
  TVG.qr = qr;

  // לכל גרסה (1..6): [סך מילות קוד, מילות תיקון לבלוק, מספר בלוקים], ומיקומי תבניות היישור
  var VER = [null, [26, 7, 1], [44, 10, 1], [70, 15, 1], [100, 20, 1], [134, 26, 1], [172, 18, 2]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

  var EXP = [], LOG = [];
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function rsGen(d) { var g = [1]; for (var i = 0; i < d; i++) { var n = []; for (var j = 0; j <= g.length; j++) n[j] = (j < g.length ? g[j] : 0) ^ (j > 0 ? gmul(g[j - 1], EXP[i]) : 0); g = n; } return g; }
  function rsEcc(data, d) {
    var g = rsGen(d), r = []; for (var i = 0; i < d; i++) r[i] = 0;
    data.forEach(function (b) { var f = b ^ r.shift(); r.push(0); for (var j = 0; j < d; j++) r[j] ^= gmul(g[j + 1], f); });
    return r;
  }
  function utf8(s) { var out = []; unescape(encodeURIComponent(s)).split("").forEach(function (c) { out.push(c.charCodeAt(0)); }); return out; }

  function qr(text) {
    var bytes = utf8(text), v, i, j;
    for (v = 1; v <= 6; v++) { var dc = VER[v][0] - VER[v][1] * VER[v][2]; if (bytes.length <= Math.floor((dc * 8 - 12) / 8)) break; }
    if (v > 6) return null;
    var tot = VER[v][0], ecN = VER[v][1], nb = VER[v][2], dcw = tot - ecN * nb;
    var bits = []; function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
    put(4, 4); put(bytes.length, 8); bytes.forEach(function (b) { put(b, 8); });
    for (i = 0; i < 4 && bits.length < dcw * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var cw = []; for (i = 0; i < bits.length; i += 8) { var b = 0; for (j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
    for (var pad = 0xEC; cw.length < dcw; pad ^= 0xEC ^ 0x11) cw.push(pad);
    var per = dcw / nb, blocks = [], ecs = [];
    for (i = 0; i < nb; i++) { var bl = cw.slice(i * per, (i + 1) * per); blocks.push(bl); ecs.push(rsEcc(bl, ecN)); }
    var fin = []; for (i = 0; i < per; i++) blocks.forEach(function (bl) { fin.push(bl[i]); });
    for (i = 0; i < ecN; i++) ecs.forEach(function (e) { fin.push(e[i]); });

    var n = 17 + 4 * v, M = [], F = []; // M מודולים, F מודולי פונקציה
    for (i = 0; i < n; i++) { M[i] = []; F[i] = []; for (j = 0; j < n; j++) { M[i][j] = false; F[i][j] = false; } }
    function setF(r, c, dark) { if (r < 0 || c < 0 || r >= n || c >= n) return; M[r][c] = dark; F[r][c] = true; }
    function finder(r0, c0) { for (var dr = -1; dr <= 7; dr++) for (var dc2 = -1; dc2 <= 7; dc2++) { var inb = dr >= 0 && dr <= 6 && dc2 >= 0 && dc2 <= 6; setF(r0 + dr, c0 + dc2, inb && (dr === 0 || dr === 6 || dc2 === 0 || dc2 === 6 || (dr >= 2 && dr <= 4 && dc2 >= 2 && dc2 <= 4))); } }
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (i = 8; i < n - 8; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    var al = ALIGN[v];
    al.forEach(function (r) { al.forEach(function (c) {
      if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (c === 6 && r === al[al.length - 1])) return;
      for (var dr = -2; dr <= 2; dr++) for (var dc3 = -2; dc3 <= 2; dc3++) setF(r + dr, c + dc3, Math.max(Math.abs(dr), Math.abs(dc3)) !== 1);
    }); });
    function fmt(mask) { // 5 ביטי נתונים (L=01 + מסכה) + BCH
      var d = (1 << 3) | mask, r = d; for (var k = 0; k < 10; k++) r = (r << 1) ^ ((r >>> 9) * 0x537); var bitsF = ((d << 10) | (r & 0x3FF)) ^ 0x5412;
      function bit(k2) { return ((bitsF >>> k2) & 1) === 1; }
      for (var k3 = 0; k3 <= 5; k3++) setF(k3, 8, bit(k3)); setF(7, 8, bit(6)); setF(8, 8, bit(7)); setF(8, 7, bit(8)); for (k3 = 9; k3 < 15; k3++) setF(8, 14 - k3, bit(k3));
      for (k3 = 0; k3 < 8; k3++) setF(8, n - 1 - k3, bit(k3)); for (k3 = 8; k3 < 15; k3++) setF(n - 15 + k3, 8, bit(k3));
      setF(n - 8, 8, true);
    }
    fmt(0); // שומר מקום לאזור הפורמט (מסומן כפונקציה)
    // מיקום הנתונים בזיגזג
    var idx = 0, up = true, col;
    for (col = n - 1; col >= 1; col -= 2) {
      if (col === 6) col = 5;
      for (i = 0; i < n; i++) { var r = up ? n - 1 - i : i; for (j = 0; j < 2; j++) { var c = col - j; if (!F[r][c]) { M[r][c] = idx < fin.length * 8 ? ((fin[idx >> 3] >>> (7 - (idx & 7))) & 1) === 1 : false; idx++; } } }
      up = !up;
    }
    var MASK = [function (r, c) { return (r + c) % 2 === 0; }, function (r) { return r % 2 === 0; }, function (r, c) { return c % 3 === 0; }, function (r, c) { return (r + c) % 3 === 0; },
      function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; }, function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; }, function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; }, function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }];
    function applyMask(k) { for (var r2 = 0; r2 < n; r2++) for (var c2 = 0; c2 < n; c2++) if (!F[r2][c2] && MASK[k](r2, c2)) M[r2][c2] = !M[r2][c2]; }
    function penalty() {
      var p = 0, r2, c2, k, dark = 0;
      for (var dir = 0; dir < 2; dir++) for (r2 = 0; r2 < n; r2++) { var run = 1; for (c2 = 1; c2 < n; c2++) { var a = dir ? M[c2][r2] : M[r2][c2], b = dir ? M[c2 - 1][r2] : M[r2][c2 - 1]; if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (r2 = 0; r2 < n - 1; r2++) for (c2 = 0; c2 < n - 1; c2++) { var x = M[r2][c2]; if (x === M[r2][c2 + 1] && x === M[r2 + 1][c2] && x === M[r2 + 1][c2 + 1]) p += 3; }
      for (r2 = 0; r2 < n; r2++) for (c2 = 0; c2 < n; c2++) if (M[r2][c2]) dark++;
      k = Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1; return p + Math.max(0, k) * 10;
    }
    var best = 0, bestP = 1e9;
    for (var mk = 0; mk < 8; mk++) { applyMask(mk); var pp = penalty(); if (pp < bestP) { bestP = pp; best = mk; } applyMask(mk); }
    applyMask(best); fmt(best);
    return { n: n, get: function (r2, c2) { return !!M[r2][c2]; } };
  }
})(window.TVG);
