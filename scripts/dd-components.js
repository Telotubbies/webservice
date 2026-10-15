(() => {
  const STYLE_PROPS = [
    "display", "position", "color", "backgroundColor", "fontFamily", "fontSize",
    "fontWeight", "lineHeight", "letterSpacing", "textTransform", "textDecoration",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "border", "borderTop", "borderBottom", "borderLeft", "borderRight",
    "borderRadius", "boxShadow", "gap", "alignItems", "justifyContent",
    "cursor", "zIndex", "overflow", "whiteSpace", "transition",
  ];
  const skip = new Set(["none", "normal", "auto", "rgba(0, 0, 0, 0)", "0s", "visible", "static"]);
  const styleOf = el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const style = {};
    for (const p of STYLE_PROPS) {
      const v = s[p];
      if (v && !skip.has(v)) style[p] = v;
    }
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      style,
      text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 80),
      attr: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.getAttribute("role") || "",
    };
  };
  const groups = {
    nav: ["nav", "aside", "[role='navigation']", "[class*='sidebar' i]", "[class*='sidenav' i]"],
    navItem: ["nav a", "nav button", "[role='navigation'] a", "aside a"],
    header: ["header", "[class*='topbar' i]", "[class*='app-bar' i]", "[class*='masthead' i]"],
    main: ["main", "[role='main']"],
    tables: ["table", "[role='table']", "[role='grid']"],
    colHeaders: ["th", "[role='columnheader']"],
    rows: ["tbody tr", "[role='row']"],
    buttons: ["button", "[role='button']", "a[class*='btn' i]", "[class*='button' i]"],
    links: ["main a[href]", "[role='main'] a[href]"],
    inputs: ["input", "select", "textarea", "[role='searchbox']", "[role='combobox']"],
    badges: ["[class*='badge' i]", "[class*='pill' i]", "[class*='chip' i]", "[class*='status' i]", "[class*='tag' i]"],
    cards: ["[class*='card' i]", "[class*='panel' i]", "[class*='widget' i]", "[class*='tile' i]"],
    tabs: ["[role='tablist']", "[role='tab']", "[class*='tab' i]"],
    menus: ["[role='menu']", "[role='menuitem']", "[role='listbox']", "[role='option']"],
    icons: ["svg", "[class*='icon' i]"],
    modal: ["[role='dialog']", "[class*='modal' i]", "[class*='drawer' i]"],
  };
  const out = { url: location.href, title: document.title, groups: {} };
  for (const [name, sels] of Object.entries(groups)) {
    const seen = new Set();
    const items = [];
    for (const sel of sels) {
      let els;
      try { els = document.querySelectorAll(sel); } catch { continue; }
      for (const el of els) {
        if (seen.has(el) || items.length >= 10) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        seen.add(el);
        items.push({ sel, ...styleOf(el) });
      }
    }
    if (items.length) out.groups[name] = items;
  }
  return out;
})()
