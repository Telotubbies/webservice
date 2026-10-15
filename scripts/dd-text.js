(() => {
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.nodeValue.trim().replace(/\s+/g, " ");
    if (t.length < 1 || t.length > 120) continue;
    const el = node.parentElement;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden") continue;
    const key = t;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      t,
      tag: el.tagName.toLowerCase() + (el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""),
      fs: s.fontSize, fw: s.fontWeight, c: s.color,
      aria: el.closest("[aria-label]")?.getAttribute("aria-label")?.slice(0, 40) || "",
    });
    if (out.length >= 400) break;
  }
  return { url: location.href, title: document.title, texts: out };
})()
