// Extract druids icon sprite symbols: id -> inner markup + viewBox.
(() => {
  const out = {};
  // sprite symbols live in a hidden <svg><defs> injected once per page
  for (const sym of document.querySelectorAll('symbol[id], svg[id] > symbol, defs symbol')) {
    const id = sym.getAttribute('id') || '';
    if (!id.includes('icon')) continue;
    out[id] = { vb: sym.getAttribute('viewBox') || '0 0 16 16', html: sym.innerHTML.trim() };
  }
  // some sprites use <g id> directly inside a defs svg
  for (const g of document.querySelectorAll('defs > g[id*="icon"], defs > path[id*="icon"]')) {
    const id = g.getAttribute('id');
    out[id] = out[id] ?? { vb: null, html: g.outerHTML };
  }
  // also map the <use> refs currently visible to their nav label context
  const uses = {};
  for (const u of document.querySelectorAll('use[xlink\\:href^="#druids"], use[href^="#druids"]')) {
    const ref = u.getAttribute('xlink:href') || u.getAttribute('href');
    const host = u.closest('[aria-label],[title],a,button,li');
    const label = host?.getAttribute('aria-label') || host?.getAttribute('title') || (host?.textContent || '').trim().slice(0, 40);
    if (ref) uses[ref.slice(1)] = label || '';
  }
  return { symbols: out, uses, count: Object.keys(out).length };
})()
