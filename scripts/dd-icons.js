(() => {
  const seen = new Map();
  document.querySelectorAll("svg").forEach(svg => {
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const html = svg.outerHTML;
    const key = html.length + "|" + html.slice(0, 300);
    const host = svg.closest("button,a,[role='button'],[aria-label]");
    const ctx = (host?.getAttribute("aria-label") || host?.innerText || svg.getAttribute("aria-label") || svg.closest("[class]")?.className?.toString() || "").toString().trim().replace(/\s+/g, " ").slice(0, 60);
    if (!seen.has(key)) seen.set(key, { w: Math.round(r.width), h: Math.round(r.height), ctx, svg: html.length > 4000 ? html.slice(0, 4000) + "…" : html });
  });
  return { url: location.href, count: seen.size, icons: [...seen.values()] };
})()
