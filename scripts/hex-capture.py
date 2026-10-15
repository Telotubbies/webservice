"""Capture matrix + extraction for hex.tech/product/notebooks via CDP :9222.

Usage: CDP_PORT=9222 python -X utf8 scripts/hex-capture.py
Writes ref/hex/*.png and ref/hex/extract.json
"""
import base64
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdp import CDP, pick  # noqa: E402

OUT = Path(__file__).parent.parent / "ref" / "hex"
OUT.mkdir(parents=True, exist_ok=True)

VIEWPORTS = [
    ("desktop-1440", 1440, 1400, False),
    ("desktop-1920", 1920, 1200, False),
    ("mobile-390", 390, 844, True),
]


def shot(cdp, name):
    data = cdp.cmd("Page.captureScreenshot", format="png")
    p = OUT / f"{name}.png"
    p.write_bytes(base64.b64decode(data["data"]))
    print("wrote", p)


def fullshot(cdp, name):
    m = cdp.cmd("Page.getLayoutMetrics")
    cs = m["cssContentSize"]
    data = cdp.cmd("Page.captureScreenshot", format="png",
                   captureBeyondViewport=True,
                   clip={"x": 0, "y": 0, "width": cs["width"], "height": cs["height"], "scale": 0.5})
    p = OUT / f"{name}.png"
    p.write_bytes(base64.b64decode(data["data"]))
    print("wrote", p)


def set_vp(cdp, w, h, mobile):
    cdp.cmd("Emulation.setDeviceMetricsOverride", width=w, height=h,
            deviceScaleFactor=1, mobile=mobile)


EXTRACT_JS = r"""
(() => {
  const S = (el, props) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = s[p];
    const r = el.getBoundingClientRect();
    o.__rect = { x: r.x, y: r.y, w: r.width, h: r.height };
    o.__tag = el.tagName;
    o.__cls = (el.className?.toString() || '').slice(0, 80);
    return o;
  };
  const TYPO = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','textTransform'];
  const BOX = TYPO.concat(['background','backgroundColor','backgroundImage','border','borderRadius','padding','margin','boxShadow','backdropFilter','display','position','overflow','gap']);

  const txt = (el) => el ? (el.innerText || el.textContent || '').trim().slice(0, 300) : null;
  const deepStyle = (sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const target = (root.textContent || '').trim();
    let el = root;
    while (true) {
      const child = Array.from(el.children).find(c => (c.textContent || '').trim() === target);
      if (!child) break;
      el = child;
    }
    return S(el, TYPO);
  };

  const out = {};
  out.url = location.href;
  out.title = document.title;
  out.bodyBg = S(document.body, ['background','backgroundColor','color','fontFamily']);

  // structure
  out.h1 = txt(document.querySelector('h1'));
  out.h1Style = deepStyle('h1');
  out.h2s = Array.from(document.querySelectorAll('h2')).map(h => ({ t: txt(h), s: S(h, TYPO) }));
  out.navLinks = Array.from(document.querySelectorAll('nav a, header a')).map(a => txt(a)).filter(Boolean).slice(0, 40);
  out.buttons = Array.from(document.querySelectorAll('a,button')).map(b => {
    const t = txt(b); if (!t || t.length > 60) return null;
    return { t, s: S(b, BOX) };
  }).filter(Boolean).slice(0, 20);
  out.sections = Array.from(document.querySelectorAll('section, main > div, [class*="section"]'))
    .map(el => ({ tag: el.tagName, cls: (el.className?.toString()||'').slice(0,80),
                  h: el.querySelector('h1,h2,h3') ? txt(el.querySelector('h1,h2,h3')) : null,
                  rect: (r => ({y:r.y,h:r.height,w:r.width}))(el.getBoundingClientRect()) }))
    .filter(s => s.rect.h > 100).slice(0, 40);

  // nav
  out.nav = S(document.querySelector('nav, header'), BOX);

  // hero container
  const hero = document.querySelector('h1')?.closest('section,div');
  out.hero = S(hero, BOX);

  // large background candidates (position fixed/absolute covering viewport)
  out.backgrounds = [];
  document.querySelectorAll('*').forEach(el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if ((s.position === 'fixed' || s.position === 'absolute') &&
        r.width >= innerWidth * 0.7 && r.height >= innerHeight * 0.4 &&
        el.tagName !== 'BODY' && el.tagName !== 'HTML' &&
        (s.backgroundImage !== 'none' || el.tagName === 'CANVAS' || el.tagName === 'VIDEO' || el.tagName === 'IMG' || s.filter !== 'none' || s.zIndex < 0)) {
      out.backgrounds.push({ tag: el.tagName, cls: (el.className?.toString()||'').slice(0,60),
        pos: s.position, z: s.zIndex, bg: s.backgroundImage.slice(0,200), filter: s.filter,
        opacity: s.opacity, blend: s.mixBlendMode, rect: {w: r.width, h: r.height},
        src: el.src || el.currentSrc || null });
    }
  });
  out.backgrounds = out.backgrounds.slice(0, 15);

  // animation detection
  const cssAnim = [];
  document.querySelectorAll('*').forEach(el => {
    const s = getComputedStyle(el);
    if (s.animationName && s.animationName !== 'none')
      cssAnim.push({ tag: el.tagName, cls: (el.className?.toString()||'').slice(0,50), anim: s.animationName, dur: s.animationDuration });
  });
  out.anim = {
    css: cssAnim.slice(0, 20),
    canvas: document.querySelectorAll('canvas').length,
    video: Array.from(document.querySelectorAll('video')).map(v => ({ src: (v.src || v.currentSrc || v.querySelector('source')?.src || '').slice(0,200), auto: v.autoplay, loop: v.loop })),
    svgAnim: document.querySelectorAll('svg animate, svg animateTransform, svg animateMotion').length,
    lottie: document.querySelectorAll('lottie-player, dotlottie-player, [class*="lottie"]').length,
    gsap: typeof window.gsap !== 'undefined',
    three: typeof window.THREE !== 'undefined',
    framer: typeof window.Motion !== 'undefined' || document.querySelectorAll('[data-framer-appear-id],[data-motion]').length,
    imgCount: document.images.length,
  };

  // fonts
  out.fonts = [];
  for (const sh of document.styleSheets) {
    try {
      for (const rule of sh.cssRules) {
        if (rule instanceof CSSFontFaceRule)
          out.fonts.push({ fam: rule.style.getPropertyValue('font-family'), src: rule.style.getPropertyValue('src').slice(0, 150) });
      }
    } catch (e) {}
  }
  out.fonts = out.fonts.slice(0, 20);

  // keyframes names
  out.keyframes = [];
  for (const sh of document.styleSheets) {
    try {
      for (const rule of sh.cssRules) {
        if (rule instanceof CSSKeyframesRule) out.keyframes.push(rule.name);
      }
    } catch (e) {}
  }
  out.keyframes = [...new Set(out.keyframes)].slice(0, 40);

  // images with natural size + src (asset inventory)
  out.images = Array.from(document.images).map(i => ({
    src: (i.currentSrc || i.src).slice(0, 220),
    w: i.naturalWidth, h: i.naturalHeight,
    alt: (i.alt || '').slice(0, 60),
  })).slice(0, 60);

  // CSS custom properties (design tokens) from :root
  const rs = getComputedStyle(document.documentElement);
  out.cssVars = {};
  for (const sh of document.styleSheets) {
    try {
      for (const rule of sh.cssRules) {
        if (rule.selectorText === ':root' || rule.selectorText === 'html') {
          for (const n of rule.style) if (n.startsWith('--')) out.cssVars[n] = rs.getPropertyValue(n).trim();
        }
      }
    } catch (e) {}
  }

  return JSON.stringify(out);
})()
"""

SCROLL_STATES_JS = r"""
(() => {
  // hover-relevant: grab sticky nav behavior + section reveals
  const obs = [];
  document.querySelectorAll('[class*="reveal"],[class*="animate"],[class*="fade"],[data-aos],[data-reveal]').forEach(el => {
    obs.push({ cls: (el.className?.toString()||'').slice(0, 80) });
  });
  return JSON.stringify({ revealCandidates: obs.slice(0, 30),
    scrollY: scrollY, docH: document.documentElement.scrollHeight });
})()
"""


def main():
    sel = sys.argv[1] if len(sys.argv) > 1 else "hex.tech"
    cdp = CDP(pick(sel))
    cdp.cmd("Page.enable")
    cdp.cmd("Runtime.enable")

    # viewport matrix — capture top + mid + bottom strips at desktop
    for name, w, h, mobile in VIEWPORTS:
        set_vp(cdp, w, h, mobile)
        time.sleep(2.5)
        cdp.eval("window.scrollTo(0,0);'ok'")
        time.sleep(1.5)
        shot(cdp, name)

    # back to desktop, full page
    set_vp(cdp, 1440, 1400, False)
    time.sleep(2)
    cdp.eval("window.scrollTo(0, document.body.scrollHeight); 'ok'")  # trigger lazy load
    time.sleep(2.5)
    cdp.eval("window.scrollTo(0,0); 'ok'")
    time.sleep(1)
    fullshot(cdp, "full-1440")

    # scroll through to trigger reveals, then re-shoot a few bands
    doc_h = cdp.eval("document.documentElement.scrollHeight") or 8000
    step = 1300
    for i, y in enumerate(range(0, int(doc_h), step)):
        cdp.eval(f"window.scrollTo(0,{y});'ok'")
        time.sleep(0.9)
        shot(cdp, f"band-{i:02d}-y{y}")

    cdp.eval("window.scrollTo(0,0);'ok'")
    time.sleep(1)

    # extraction
    data = cdp.eval(EXTRACT_JS)
    (OUT / "extract.json").write_text(data, encoding="utf-8")
    print("wrote", OUT / "extract.json")

    data2 = cdp.eval(SCROLL_STATES_JS)
    (OUT / "scroll.json").write_text(data2, encoding="utf-8")
    print("wrote", OUT / "scroll.json")


if __name__ == "__main__":
    main()
