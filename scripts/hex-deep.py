"""Deep runtime extraction of hex.tech/product/notebooks.

Captures: network requests during load, nav dropdown panels (hover),
every gradient/backgroundImage in the page, all keyframes, interactive
element inventory, and scroll-band screenshots.

Writes to ref/hex/deep/ .
"""
import base64
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import cdp as M

OUT = Path("ref/hex/deep")
OUT.mkdir(parents=True, exist_ok=True)

pages = [t for t in M.targets() if t.get("type") == "page"]
c = M.CDP(pages[0])
c.cmd("Page.enable")
c.cmd("Network.enable")
c.cmd("DOM.enable")

# --- navigate while sniffing network --------------------------------------
c.cmd("Page.navigate", url="https://hex.tech/product/notebooks/")
requests = {}
deadline = time.time() + 25
while time.time() < deadline:
    try:
        c.ws.settimeout(2)
        msg = json.loads(c.ws.recv())
    except Exception:
        if c.eval("document.readyState") == "complete":
            break
        continue
    m = msg.get("method", "")
    if m == "Network.requestWillBeSent":
        r = msg["params"]["request"]
        requests[msg["params"]["requestId"]] = {
            "url": r["url"], "type": msg["params"].get("type"),
            "method": r.get("method"),
        }
c.ws.settimeout(60)
M.wait_ready(c, 20)
time.sleep(2)

net = sorted(requests.values(), key=lambda r: r["url"])
(OUT / "network.json").write_text(json.dumps(net, indent=1), encoding="utf-8")
print(f"network: {len(net)} requests")

# --- interactives ---------------------------------------------------------
js = r"""
(() => {
  const pick = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName, text: (el.textContent || '').trim().slice(0, 50),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cls: (el.getAttribute('class') || '').slice(0, 60),
      color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
    };
  };
  const nav = [...document.querySelectorAll('header button, header a')].map(pick);
  return JSON.stringify({ nav });
})()
"""
nav = json.loads(c.eval(js))["nav"]
(OUT / "nav-elements.json").write_text(json.dumps(nav, indent=1, ensure_ascii=False), encoding="utf-8")

# --- hover each top-level nav control, capture dropdown --------------------
top_nav = [e for e in nav if 60 < e["y"] < 130 and e["w"] > 20]
seen_y = set()
drops = []
for e in top_nav:
    key = round(e["y"] / 10)
    if key in seen_y and "chevron" not in e["text"]:
        continue
    seen_y.add(key)
    cx, cy = e["x"] + e["w"] / 2, e["y"] + e["h"] / 2
    for etype in ("mouseMoved",):
        c.cmd("Input.dispatchMouseEvent", type=etype, x=cx, y=cy)
    time.sleep(1.2)
    # find visible dropdown/popover content
    js2 = r"""
    (() => {
      const els = [...document.querySelectorAll('[class*="ropdown"],[class*="opover"],[class*="enu"],[role="menu"],[role="dialog"],[data-radix-popper-content-wrapper]')];
      const vis = els.filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 100 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05; });
      return JSON.stringify(vis.slice(0, 4).map(e => {
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        return {
          cls: (e.getAttribute('class')||'').slice(0,80), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
          bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0,200), border: cs.border, radius: cs.borderRadius,
          shadow: cs.boxShadow.slice(0,160), backdrop: cs.backdropFilter,
          html: e.innerHTML.slice(0, 4000),
        };
      }));
    })()
    """
    panels = json.loads(c.eval(js2))
    drops.append({"hovered": e, "panels": panels})
    if panels:
        d = c.cmd("Page.captureScreenshot", format="png")
        (OUT / f"drop-{e['text'][:16].strip() or e['x']}.png").write_bytes(base64.b64decode(d["data"]))
(OUT / "dropdowns.json").write_text(json.dumps(drops, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"dropdowns captured: {sum(1 for d in drops if d['panels'])}/{len(drops)}")

# --- gradients everywhere ---------------------------------------------------
js3 = r"""
(() => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('*')) {
    for (const pseudo of [null, '::before', '::after']) {
      const cs = pseudo ? getComputedStyle(el, pseudo) : getComputedStyle(el);
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none' && bi.includes('gradient') && !seen.has(bi)) {
        seen.add(bi);
        const r = el.getBoundingClientRect();
        out.push({ el: el.tagName + '.' + (el.getAttribute('class')||'').toString().slice(0,40), pseudo, y: Math.round(r.y + scrollY), grad: bi.slice(0, 500) });
      }
    }
    if (out.length > 80) break;
  }
  return JSON.stringify(out);
})()
"""
grads = json.loads(c.eval(js3))
(OUT / "gradients.json").write_text(json.dumps(grads, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"gradients: {len(grads)}")

# --- all keyframes -----------------------------------------------------------
js4 = r"""
(() => {
  const kf = {};
  for (const ss of document.styleSheets) {
    try { for (const r of ss.cssRules) {
      if (r instanceof CSSKeyframesRule) kf[r.name] = r.cssText.slice(0, 1200);
      if (r.cssRules) for (const r2 of r.cssRules) if (r2 instanceof CSSKeyframesRule) kf[r2.name] = r2.cssText.slice(0,1200);
    }} catch (e) {}
  }
  return JSON.stringify(kf);
})()
"""
kf = json.loads(c.eval(js4))
(OUT / "keyframes.json").write_text(json.dumps(kf, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"keyframes: {len(kf)}")

# --- scroll bands -------------------------------------------------------------
H = json.loads(c.eval("JSON.stringify(document.body.scrollHeight)"))
for i, y in enumerate(range(0, H, 1100)):
    c.eval(f"scrollTo(0,{y})")
    time.sleep(0.9)
    d = c.cmd("Page.captureScreenshot", format="png")
    (OUT / f"band-{i:02d}-y{y}.png").write_bytes(base64.b64decode(d["data"]))
print(f"bands: {H//1100 + 1}, page height {H}")

# back to local
c.cmd("Page.navigate", url="http://localhost:5173/")
print("done")
