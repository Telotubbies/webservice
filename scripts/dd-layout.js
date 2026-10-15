(() => {
  const MAX = 250;
  let n = 0;
  const KEEP = new Set(["NAV", "ASIDE", "HEADER", "MAIN", "SECTION", "FOOTER", "TABLE", "FORM", "UL", "OL"]);
  const ROLES = new Set(["navigation", "main", "banner", "contentinfo", "complementary", "dialog", "tablist", "toolbar", "region", "search", "table", "grid", "form", "menu", "listbox", "tree"]);
  function walk(el, depth) {
    if (n >= MAX || depth > 7) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    const tag = el.tagName;
    const role = el.getAttribute("role");
    const semantic = KEEP.has(tag) || ROLES.has(role) || depth < 3;
    const kids = [];
    for (const c of el.children) {
      const k = walk(c, depth + 1);
      if (k) kids.push(k);
    }
    if (!semantic && kids.length === 0) return null;
    if (!semantic && kids.length === 1) return kids[0];
    n++;
    const s = getComputedStyle(el);
    const out = {
      tag: tag.toLowerCase() + (role ? `[role=${role}]` : "") +
        (el.id ? `#${el.id}` : "") +
        (el.getAttribute("data-testid") ? `[data-testid=${el.getAttribute("data-testid")}]` : ""),
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    };
    if (s.display !== "block" && s.display !== "inline") out.d = s.display;
    if (s.position !== "static") out.pos = s.position;
    if (s.flexDirection === "column" || s.flexDirection === "row") out.dir = s.flexDirection;
    if (s.gap !== "normal" && s.gap !== "0px") out.gap = s.gap;
    if (s.padding !== "0px") out.pad = s.padding;
    if (s.backgroundColor !== "rgba(0, 0, 0, 0)") out.bg = s.backgroundColor;
    if (s.gridTemplateColumns !== "none") out.cols = s.gridTemplateColumns;
    if (kids.length) out.kids = kids;
    return out;
  }
  return { url: location.href, title: document.title, layout: walk(document.body, 0) };
})()
