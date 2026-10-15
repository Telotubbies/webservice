(() => {
  const props = ["color", "backgroundColor", "fontFamily", "fontSize", "fontWeight",
    "lineHeight", "letterSpacing", "padding", "borderRadius", "boxShadow",
    "border", "height", "gap"];
  const skip = new Set(["none", "normal", "0px", "auto", "rgba(0, 0, 0, 0)", "0s"]);
  const tallies = {};
  props.forEach(p => (tallies[p] = {}));
  const els = document.querySelectorAll("*");
  const max = Math.min(els.length, 6000);
  let seen = 0;
  for (let i = 0; i < max; i++) {
    const el = els[i];
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    seen++;
    const s = getComputedStyle(el);
    for (const p of props) {
      const v = s[p];
      if (!v || skip.has(v)) continue;
      tallies[p][v] = (tallies[p][v] || 0) + 1;
    }
  }
  const out = {};
  for (const p of props) {
    out[p] = Object.entries(tallies[p])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([v, c]) => ({ v, c }));
  }
  return { url: location.href, title: document.title, elements: seen, vocab: out };
})()
