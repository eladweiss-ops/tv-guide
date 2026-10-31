/*
 * Layout audit for the TV guide PWA (used by shoot.cjs after every snap).
 *
 * Catches the class of bug "two controls touch each other / text is clipped / hit area too small":
 *   overlap   - two interactive elements whose rects intersect
 *   tight     - two interactive elements (same row or stacked) closer than MIN_GAP px
 *   small     - interactive element under 44x44 CSS px (iOS HIG); inline text links inside paragraphs are exempt
 *   clip      - text clipped by overflow (scrollWidth > clientWidth without text-overflow:ellipsis / line-clamp)
 *   textover  - visible text that overlaps another element's text or an unrelated interactive element
 *   offscreen - something extends past the viewport horizontally (and is not inside a scroller)
 *
 * Only elements that are really hit-testable at their visible centre are considered, so whatever is hidden
 * behind an open sheet / scrim / fixed bar is ignored.
 * Exceptions go in ALLOW / GROUPS below, each with a justification.
 */
const MIN_GAP = 8, MIN_HIT = 44;

// Each entry: { type, sel (CSS selector the element or one of its ancestors matches), why }.
const ALLOW = [
  { type: "tight", sel: ".dock .tabs", why: "iOS tab bar: full-height adjacent cells inside one glass capsule; the selected cell is a pill that fills its cell, so a gap between cells has no visual meaning (and each cell is 60+px)" },
  { type: "tight", sel: ".days", why: "iOS segmented control (dial day picker): adjacent segments inside one soft track, selected segment is a raised pill; every segment is >=52px tall and >=70px wide" },
  { type: "tight", sel: ".row[data-toggle]", why: "full-width list rows separated by a 1px hairline (iOS grouped list); the whole row is the tap target, >=44px tall" },
  { type: "overlap", sel: "#qx", why: "clear (x) button lives inside the search field by design (iOS search field); the field has padding-inline-end for it" },
  { type: "textover", sel: "#qx", why: "same: clear button inside the search field" },
  { type: "textover", sel: ".lnd-em", why: "decorative watermark emoji (opacity .2, pointer-events none, rotated) behind the landing title" },
  { type: "small", sel: ".tmdbmark", why: "TMDB attribution badge (mandated logo, kept small); a ::after extends the real tap area to 44px, which getBoundingClientRect cannot see" },
];

// Intentional segmented groups: controls inside may be closer than 8px as long as the gap is >= 6px.
// Each entry: { sel, why }.
const GROUPS = [
  // none: all chip/segment rows use the 8px gap
];

function pageAudit(cfg) {
  const MIN_GAP = cfg.MIN_GAP, MIN_HIT = cfg.MIN_HIT, vw = innerWidth, vh = innerHeight;
  const issues = [], sig = (s) => String(s || "").replace(/ ".*$/, "");
  const R = (e) => e.getBoundingClientRect();
  const desc = (e) => {
    let s = e.tagName.toLowerCase();
    if (e.id) s += "#" + e.id;
    const c = (typeof e.className === "string" ? e.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (c.length) s += "." + c.join(".");
    for (const a of e.attributes) if (a.name.indexOf("data-") === 0) { s += "[" + a.name + "]"; break; }
    const t = (e.innerText || e.value || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 24);
    return s + (t ? ' "' + t + '"' : "");
  };
  const vis = (e) => { try { return e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); } catch (x) { return true; } };
  const allowed = (type, e) => cfg.allow.some((a) => (a.type === type || a.type === "*") && e.closest && e.closest(a.sel));
  const add = (type, e, msg, e2) => { if (allowed(type, e) || (e2 && allowed(type, e2))) return; issues.push({ type, el: desc(e), el2: e2 ? desc(e2) : undefined, msg }); };

  const TAGS = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, SUMMARY: 1 };
  const all = Array.from(document.body.querySelectorAll("*"));
  const cs = new Map();
  const st = (e) => { let s = cs.get(e); if (!s) { s = getComputedStyle(e); cs.set(e, s); } return s; };
  const isInter = (e) => {
    if (e.tagName === "A" && !e.hasAttribute("href")) return false;
    if (e.tagName === "INPUT" && e.type === "hidden") return false;
    if (TAGS[e.tagName] || /^(button|tab|checkbox|switch|link|menuitem)$/.test(e.getAttribute("role") || "") || e.classList.contains("chip")) return true;
    const p = e.parentElement;
    return st(e).cursor === "pointer" && !(p && st(p).cursor === "pointer"); // clickable rows (delegated [data-...] clicks)
  };
  // visible part of the rect (clipped by viewport and by overflow ancestors)
  const visRect = (e) => {
    const r = R(e); let l = Math.max(0, r.left), t = Math.max(0, r.top), rt = Math.min(vw, r.right), b = Math.min(vh, r.bottom);
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = st(p); if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const pr = R(p);
      if (s.overflowX !== "visible") { l = Math.max(l, pr.left); rt = Math.min(rt, pr.right); }
      if (s.overflowY !== "visible") { t = Math.max(t, pr.top); b = Math.min(b, pr.bottom); }
    }
    return rt - l > 1 && b - t > 1 ? { l, t, r: rt, b } : null;
  };
  const hit = (e) => {
    const v = visRect(e); if (!v) return false;
    const t = document.elementFromPoint((v.l + v.r) / 2, (v.t + v.b) / 2);
    return !!t && (e.contains(t) || t.contains(e));
  };
  const inter = all.filter((e) => isInter(e) && vis(e) && R(e).width > 0 && R(e).height > 0 && hit(e));

  // Content scrolling underneath a fixed/sticky bar (tab bar, sheet action bar, header) is by design: only compare
  // two things living in the same layer.
  const layerCache = new Map();
  const layer = (e) => {
    if (layerCache.has(e)) return layerCache.get(e);
    let r = null; for (let p = e; p && p !== document.body; p = p.parentElement) { const pos = st(p).position; if (pos === "fixed" || pos === "sticky") { r = p; break; } }
    layerCache.set(e, r); return r;
  };

  // ---- 1. overlap / tight ----
  const grp = (e) => { for (const g of cfg.groups) { const c = e.closest(g.sel); if (c) return c; } return null; };
  for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
    const a = inter[i], b = inter[j]; if (a.contains(b) || b.contains(a) || layer(a) !== layer(b)) continue;
    const ra = R(a), rb = R(b);
    const dx = Math.max(rb.left - ra.right, ra.left - rb.right), dy = Math.max(rb.top - ra.bottom, ra.top - rb.bottom); // negative = overlap on that axis
    if (dx < -0.5 && dy < -0.5) { add("overlap", a, "overlaps by " + Math.round(-dx) + "x" + Math.round(-dy) + "px", b); continue; }
    const sameRow = dy < -0.5 && dx < MIN_GAP, stacked = dx < -0.5 && dy < MIN_GAP;
    if (sameRow || stacked) {
      const gap = sameRow ? dx : dy, ga = grp(a);
      if (ga && ga === grp(b) && gap >= 6) continue;
      add("tight", a, (sameRow ? "same-row gap " : "stacked gap ") + Math.round(gap * 10) / 10 + "px (<" + MIN_GAP + ")", b);
    }
  }

  // ---- 2. hit area ----
  for (const e of inter) {
    const r = R(e); if (r.width >= MIN_HIT - 0.5 && r.height >= MIN_HIT - 0.5) continue;
    if (e.tagName === "A" && st(e).display === "inline") { // inline text link inside running text
      let p = e.parentElement; while (p && st(p).display === "inline") p = p.parentElement;
      if (p && Array.from(p.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)) continue;
    }
    if (e.tagName === "INPUT" && (e.type === "checkbox" || e.type === "radio")) { const l = e.closest("label"); if (l && R(l).height >= MIN_HIT - 0.5) continue; }
    add("small", e, Math.round(r.width) + "x" + Math.round(r.height) + " < " + MIN_HIT);
  }

  // ---- 3. clipped text ----
  for (const e of all) {
    if (!vis(e)) continue; const r = R(e); if (r.width === 0 || r.height === 0) continue;
    if (!Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!visRect(e)) continue;
    const s = st(e), clipX = s.overflowX !== "visible" && s.overflowX !== "auto" && s.overflowX !== "scroll", clipY = s.overflowY !== "visible" && s.overflowY !== "auto" && s.overflowY !== "scroll";
    const clamp = s.webkitLineClamp && s.webkitLineClamp !== "none";
    if (clipX && e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== "ellipsis" && s.display !== "inline") add("clip", e, "scrollWidth " + e.scrollWidth + " > clientWidth " + e.clientWidth);
    else if (clipY && !clamp && e.scrollHeight > e.clientHeight + 1 && s.display !== "inline") add("clip", e, "scrollHeight " + e.scrollHeight + " > clientHeight " + e.clientHeight);
  }

  // ---- 4. text overlapping other text / unrelated controls ----
  const texts = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) {
    if (!n.textContent.trim()) continue; const p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT|OPTION|TEXTAREA)$/.test(p.tagName) || !vis(p)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    const pv = visRect(p), pr = R(p), ps = st(p), clipP = ps.overflowX !== "visible" || ps.overflowY !== "visible"; // clamped / hidden lines are not visible text
    if (!pv) continue;
    for (const q0 of rg.getClientRects()) {
      const q = { left: Math.max(q0.left, pv.l), right: Math.min(q0.right, pv.r), top: Math.max(q0.top, pv.t), bottom: Math.min(q0.bottom, pv.b) };
      q.width = q.right - q.left; q.height = q.bottom - q.top;
      if (q.width < 2 || q.height < 4 || q.right <= 0 || q.left >= vw || q.bottom <= 0 || q.top >= vh) continue;
      const t = document.elementFromPoint(Math.min(vw - 1, Math.max(1, (q.left + q.right) / 2)), Math.min(vh - 1, Math.max(1, (q.top + q.bottom) / 2)));
      if (!t || !(p.contains(t) || t.contains(p))) continue; // covered (sheet, bar) or clipped away
      texts.push({ p, l: q.left + 1, t: q.top + 2, r: q.right - 1, b: q.bottom - 2 }); // inset: line boxes of adjacent lines
    }
  }
  const ov = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1.5;
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j]; if (a.p === b.p || !ov(a, b) || layer(a.p) !== layer(b.p)) continue;
    add("textover", a.p, "text overlaps text", b.p);
  }
  for (const a of texts) for (const e of inter) {
    if (e.contains(a.p) || a.p.contains(e) || layer(a.p) !== layer(e)) continue; const r = R(e);
    if (ov(a, { l: r.left, t: r.top, r: r.right, b: r.bottom })) add("textover", a.p, "text overlaps control", e);
  }

  // ---- 5. horizontal overflow ----
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 0.5) add("offscreen", de, "page scrollWidth " + de.scrollWidth + " > " + de.clientWidth);
  for (const e of inter.concat(texts.map((x) => x.p))) {
    const r = R(e); if (r.left >= -0.5 && r.right <= vw + 0.5) continue;
    let clipped = false; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (st(p).overflowX !== "visible") { clipped = true; break; }
    if (!clipped) add("offscreen", e, "rect " + Math.round(r.left) + ".." + Math.round(r.right) + " outside 0.." + vw);
  }
  const seen = new Set();
  return issues.filter((i) => { const k = i.type + "|" + sig(i.el) + "|" + sig(i.el2); if (seen.has(k)) return false; seen.add(k); return true; });
}

async function audit(page, stepName, store) {
  let issues = [];
  // The audit only sees what is on screen, so scroll through the page and through every scrollable layer
  // (sheets, landing, favourites...) in ~70% viewport steps and audit each stop; scroll positions are restored.
  try {
    issues = await page.evaluate(async ([src, cfg]) => {
      const sig = (s) => String(s || "").replace(/ ".*$/, ""), run = (0, eval)("(" + src + ")"), out = [], raf = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
      const scrollers = [document.scrollingElement].concat(Array.from(document.querySelectorAll("*")).filter((e) => {
        if (e === document.body || e === document.documentElement) return false;
        const s = getComputedStyle(e); return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 120 && e.checkVisibility && e.checkVisibility();
      }));
      for (const sc of scrollers) {
        sc.style.scrollBehavior = "auto"; const orig = sc.scrollTop, step = Math.max(200, sc.clientHeight * 0.7), max = sc.scrollHeight - sc.clientHeight;
        const stops = []; for (let y = 0; y <= max + 1 && stops.length < 14; y += step) stops.push(Math.min(y, max)); if (stops[stops.length - 1] < max) stops.push(max);
        for (const y of (sc === document.scrollingElement && max < 40 ? [orig] : stops)) { sc.scrollTop = y; await raf(); out.push.apply(out, run(cfg)); }
        sc.scrollTop = orig; await raf();
      }
      const seen = new Set(); return out.filter((i) => { const k = i.type + "|" + sig(i.el) + "|" + sig(i.el2); if (seen.has(k)) return false; seen.add(k); return true; });
    }, [pageAudit.toString(), { MIN_GAP, MIN_HIT, allow: ALLOW, groups: GROUPS }]);
  }
  catch (e) { issues = [{ type: "audit-error", el: "-", msg: String(e.message).split("\n")[0] }]; }
  for (const i of issues) { i.step = stepName; store.push(i); }
  return issues.length;
}

module.exports = { audit, ALLOW, GROUPS, MIN_GAP, MIN_HIT };
