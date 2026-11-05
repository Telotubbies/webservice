"""Extract hex.tech HOMEPAGE edge/frame anatomy: viewport-edge fixed
elements, pseudo-elements, ticker, hero, trusted-by strip.
Writes to ref/hex/home/ ."""
import base64
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import cdp as M

OUT = Path("ref/hex/home")
OUT.mkdir(parents=True, exist_ok=True)

pages = [t for t in M.targets() if t.get("type") == "page"]
c = M.CDP(pages[0])
c.cmd("Page.enable")
c.cmd("Page.navigate", url="https://hex.tech/")
M.wait_ready(c, 25)
time.sleep(4)

EV = r"""
(() => {
  const R = el => { const r = el.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const CS = (el,p) => { const s = getComputedStyle(el,p);
    return {pos:s.position, bg:s.backgroundColor, bgImg:s.backgroundImage.slice(0,300),
      bgSize:s.backgroundSize, border:s.border, op:s.opacity, zi:s.zIndex,
      content:s.content, w:s.width, h:s.height, inset:`${s.top} ${s.right} ${s.bottom} ${s.left}`}; };
  const vw = innerWidth, vh = innerHeight;
  // elements touching viewport edges (the frame)
  const edge = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const touch = r.left <= 24 || r.right >= vw-24 || r.top <= 24 || r.bottom >= vh-24;
    const fixed = getComputedStyle(el).position === 'fixed';
    if (fixed || (touch && r.width > 0)) {
      edge.push({tag:el.tagName, cls:(el.getAttribute('class')||'').slice(0,70),
        rect:R(el), ...CS(el,null), bef:CS(el,'::before'), aft:CS(el,'::after')});
    }
    if (edge.length > 60) break;
  }
  return JSON.stringify({vw, vh, edge});
})()
"""
d = json.loads(c.eval(EV))
(OUT/"edge.json").write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"edge elements: {len(d['edge'])}")

# --- ticker bar + nav + hero computed styles --------------------------------
EV2 = r"""
(() => {
  const R = el => { const r = el.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const css = el => { const s = getComputedStyle(el);
    return {ff:s.fontFamily.slice(0,60), fs:s.fontSize, fw:s.fontWeight, style:s.fontStyle,
      color:s.color, ls:s.letterSpacing, lh:s.lineHeight}; };
  const out = {};
  // top-most bar (ticker)
  const top = [...document.querySelectorAll('body *')].filter(e => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.top >= 0 && r.top < 44 && r.height >= 20 && r.width > innerWidth*0.5 && s.display !== 'none';
  }).slice(0,8).map(e => ({cls:(e.getAttribute('class')||'').slice(0,60), rect:R(e), ...css(e),
    text:(e.textContent||'').trim().slice(0,60), anim:getComputedStyle(e).animationName}));
  out.ticker = top;
  const h1 = document.querySelector('h1');
  out.h1 = h1 ? {...css(h1), rect:R(h1), html:h1.innerHTML.slice(0,400)} : null;
  const it = h1 ? h1.querySelector('em,i,[class*="serif"],[class*="italic"]') : document.querySelector('h1 em, h1 i');
  out.h1italic = it ? css(it) : null;
  // hero CTA buttons
  out.ctas = [...document.querySelectorAll('a,button')].filter(e => {
    const r = e.getBoundingClientRect(); return r.top > 300 && r.top < 700 && r.height > 30 && r.height < 80;
  }).slice(0,6).map(e => ({text:(e.textContent||'').trim().slice(0,30), rect:R(e),
    bg:getComputedStyle(e).backgroundColor, border:getComputedStyle(e).border,
    fs:getComputedStyle(e).fontSize, fw:getComputedStyle(e).fontWeight}));
  return JSON.stringify(out);
})()
"""
d2 = json.loads(c.eval(EV2))
(OUT/"hero.json").write_text(json.dumps(d2, indent=1, ensure_ascii=False), encoding="utf-8")

# --- trusted-by strip ---------------------------------------------------------
EV3 = r"""
(() => {
  const el = [...document.querySelectorAll('*')].find(e => /trusted by/i.test(e.textContent||'') && e.children.length < 8);
  if (!el) return 'none';
  const sec = el.closest('section') || el.parentElement;
  return JSON.stringify({cls:(sec.getAttribute('class')||'').slice(0,80),
    html: sec.innerHTML.slice(0,3000)});
})()
"""
t3 = c.eval(EV3)
(OUT/"trusted.json").write_text(str(t3), encoding="utf-8")

# --- screenshots: hero + right edge zoom --------------------------------------
d = c.cmd("Page.captureScreenshot", format="png")
(OUT/"home-hero.png").write_bytes(base64.b64decode(d["data"]))
# scroll a bit to see frame persistence
c.eval("scrollTo(0, 800)")
time.sleep(1.2)
d = c.cmd("Page.captureScreenshot", format="png")
(OUT/"home-scrolled.png").write_bytes(base64.b64decode(d["data"]))

print(json.dumps(d2.get("ticker", [])[:4], indent=1)[:1500])
print("H1:", json.dumps(d2.get("h1"), ensure_ascii=False)[:400])
print("done")
