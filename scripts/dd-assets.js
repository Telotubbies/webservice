(() => {
  const urls = new Set();
  // <img src / srcset>
  document.querySelectorAll("img").forEach(i => {
    if (i.src) urls.add(i.src);
    (i.srcset || "").split(",").forEach(s => { const u = s.trim().split(" ")[0]; if (u) urls.add(u); });
  });
  // computed background-image
  document.querySelectorAll("*").forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none") {
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/g);
      (m || []).forEach(u => urls.add(u.replace(/^url\(["']?|["']?\)$/g, "")));
    }
  });
  // <link rel=icon>, video posters, svg <use> external refs, <source>
  document.querySelectorAll("link[rel*='icon']").forEach(l => urls.add(l.href));
  document.querySelectorAll("video[poster]").forEach(v => urls.add(v.poster));
  document.querySelectorAll("source[srcset], video source[src]").forEach(s => urls.add(s.srcset || s.src));
  const abs = [...urls].map(u => { try { return new URL(u, location.href).href; } catch { return null; } })
    .filter(u => u && u.startsWith("http"));
  return { url: location.href, count: abs.length, assets: [...new Set(abs)] };
})()
