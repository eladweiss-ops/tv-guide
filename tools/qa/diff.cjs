#!/usr/bin/env node
/*
 * Pixel-compare two screenshot folders produced by shoot.cjs:
 *   node tools/qa/diff.cjs <dirA> <dirB> [diffOutDir]
 * Prints, per file, the number of differing pixels; writes red-overlay diffs for non-identical files.
 */
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");
const [A, B, OUT] = [process.argv[2], process.argv[3], process.argv[4]];
if (!A || !B) { console.error("usage: diff.cjs <dirA> <dirB> [diffOutDir]"); process.exit(2); }
if (OUT) fs.mkdirSync(OUT, { recursive: true });
let bad = 0, n = 0;
for (const f of fs.readdirSync(A).filter((x) => x.endsWith(".png")).sort()) {
  const pb = path.join(B, f); n++;
  if (!fs.existsSync(pb)) { console.log("MISSING in B:", f); bad++; continue; }
  const a = PNG.sync.read(fs.readFileSync(path.join(A, f))), b = PNG.sync.read(fs.readFileSync(pb));
  if (a.width !== b.width || a.height !== b.height) { console.log("SIZE", f, a.width + "x" + a.height, "vs", b.width + "x" + b.height); bad++; continue; }
  const d = new PNG({ width: a.width, height: a.height });
  const px = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 });
  if (px) { bad++; console.log("DIFF", f, px + " px"); if (OUT) fs.writeFileSync(path.join(OUT, f), PNG.sync.write(d)); }
}
console.log(n + " compared, " + bad + " different");
process.exit(bad ? 1 : 0);
