(() => {
  // Section-by-section sniper extraction — labeled regions, only used props.
  const PROPS = [
    "color", "backgroundColor", "backgroundImage", "fontFamily", "fontSize",
    "fontWeight", "lineHeight", "letterSpacing", "textTransform",
    "padding", "margin", "border", "borderRadius", "boxShadow",
    "gap", "height", "width", "alignItems", "justifyContent",
    "opacity", "textDecoration",
  ];
  const skip = new Set(["none", "normal", "auto", "rgba(0, 0, 0, 0)", "0s", "medium", "0px", "0px none rgb(0, 0, 0)"]);
  const snap = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const st = {};
    for (const p of PROPS) { const v = s[p]; if (v && !skip.has(v)) st[p] = v; }
    return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
             text: (el.innerText || el.value || el.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 70),
             style: st };
  };
  const q = (sel) => document.querySelector(sel);
  const qa = (sel, n = 4) => Array.from(document.querySelectorAll(sel)).slice(0, n).map(snap).filter(Boolean);
  const byText = (sel, txt) => Array.from(document.querySelectorAll(sel)).find(e => (e.innerText || "").trim().toLowerCase().includes(txt.toLowerCase()));

  const out = {
    url: location.href,
    viewport: { w: innerWidth, h: innerHeight },
    sections: {},
  };
  const S = out.sections;

  // -- dark chrome --
  S.sidebar    = snap(q("nav[aria-label], aside, [class*='sidenav' i], [class*='side_nav' i]")) || snap(q("nav"));
  S.sidebarItems = qa("aside a, nav a, [class*='sidenav' i] a", 8);
  S.topbar     = snap(q("header")) || snap(q("[class*='topbar' i], [class*='masthead' i]"));
  S.searchPill = snap(byText("button, [role='button'], div[tabindex]", "Search"));
  S.topbarBtns = qa("header button, [class*='topbar' i] button", 6);

  // -- page header / tabs --
  S.pageTitle  = snap(q("h1, [class*='page-title' i], [class*='pagetitle' i]"));
  S.tabs       = qa("[role='tab'], [class*='tab' i] a, nav + div a", 6);
  S.tabActive  = snap(q("[role='tab'][aria-selected='true'], [aria-current='page'], [class*='tab' i][class*='active' i]"));

  // -- filter / toolbar --
  S.filterInput = snap(q("input[type='search'], input[placeholder*='ilter'], input[placeholder*='earch'], [role='searchbox'], [role='combobox']"));
  S.toolbar    = snap(q("[class*='toolbar' i], [class*='action-bar' i]"));

  // -- table --
  S.table      = snap(q("table, [role='table'], [role='grid']"));
  S.theadCells = qa("th, [role='columnheader']", 8);
  S.rows       = qa("tbody tr, [role='row']", 4);
  S.cellPills  = qa("tbody [class*='pill' i], tbody [class*='badge' i], tbody [class*='status' i], tbody td span", 6);
  S.tagChips   = qa("[class*='tag' i][class*='pill' i], td [class*='chip' i], td a", 5);
  S.groupHeader= snap(byText("tr, [role='row'], div", "Monitors"));
  S.checkboxes = qa("input[type='checkbox'], [role='checkbox']", 3);

  // -- buttons --
  S.primaryBtn = snap(byText("button, a[role='button'], a", "New")) || snap(q("[class*='primary' i]"));
  S.buttons    = qa("main button, [role='main'] button", 8);
  S.links      = qa("main a[href]", 5);

  // -- cards / callouts / misc --
  S.cards      = qa("[class*='card' i], [class*='panel' i], [class*='banner' i], [class*='callout' i]", 5);
  S.badges     = qa("[class*='badge' i], [class*='pill' i], [class*='chip' i]", 8);
  S.pagination = snap(q("[class*='paginat' i], nav[aria-label*='aginat' i]"));
  S.footer     = snap(q("footer"));
  S.modalBits  = qa("[role='dialog'], [class*='modal' i], [class*='drawer' i]", 2);

  // -- fonts actually loaded --
  out.fonts = Array.from(document.fonts).map(f => `${f.family} ${f.weight} ${f.status}`).slice(0, 12);

  // -- css vars on :root (design tokens the app itself declares) --
  const rs = getComputedStyle(document.documentElement);
  out.cssVars = {};
  for (const v of ["--color-primary","--dd-purple","--text-color"]) { const x = rs.getPropertyValue(v); if (x) out.cssVars[v] = x.trim(); }

  return JSON.stringify(out, null, 1);
})()
