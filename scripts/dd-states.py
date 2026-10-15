"""dd-states — extract :hover computed-style deltas from the live Datadog tab.

Uses real mouse moves (Input.dispatchMouseEvent) so :hover/:focus states
trigger genuinely, then diffs a sniper property list rest-vs-hover.

Usage:
  CDP_PORT=9223 python -X utf8 scripts/dd-states.py <url-substr-or-index>
Output: ref/datadog/live/r3/states.json (+ printed summary)
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdp import CDP, pick  # noqa: E402

PROPS = [
    "color", "backgroundColor", "borderColor", "boxShadow",
    "textDecoration", "fontWeight", "opacity", "outline",
]

# (label, js selector — first match wins)
TARGETS = [
    ("nav-item",     "a[href*='/monitors'], nav a, aside a"),
    ("nav-section",  "nav button, aside button"),
    ("primary-btn",  "button[class*='primary'], a[class*='primary'], button"),
    ("tab",          "[role='tab'], .druids_tabs_tab, a[class*='tab']"),
    ("table-row",    "tbody tr, [role='row']"),
    ("search-input", "input[type='search'], input[placeholder*='ilter'], input"),
    ("ghost-btn",    "button[class*='secondary'], button[class*='ghost']"),
    ("link",         "main a[href], td a"),
]

FIND = """
(() => {
  const el = document.querySelector(%s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const s = getComputedStyle(el);
  const props = %s;
  return { x: r.x + r.width/2, y: r.y + r.height/2,
           tag: el.tagName, cls: (el.className||'').toString().slice(0,80),
           text: (el.textContent||'').trim().slice(0,40),
           rest: Object.fromEntries(props.map(p => [p, s[p]])) };
})()
"""

READ = """
(() => {
  const el = document.querySelector(%s);
  if (!el) return null;
  const s = getComputedStyle(el);
  return Object.fromEntries(%s.map(p => [p, s[p]]));
})()
"""


def main():
    sel = sys.argv[1] if len(sys.argv) > 1 else None
    cdp = CDP(pick(sel))
    cdp.cmd("Page.enable")
    cdp.cmd("Input.dispatchMouseEvent", type="mouseMoved", x=5, y=5)
    out = {}
    for label, css in TARGETS:
        found = cdp.eval(FIND % (json.dumps(css), json.dumps(PROPS)))
        if not found:
            out[label] = {"skip": "not found"}
            continue
        cdp.cmd("Input.dispatchMouseEvent", type="mouseMoved",
                x=found["x"], y=found["y"])
        time.sleep(0.35)
        hover = cdp.eval(READ % (json.dumps(css), json.dumps(PROPS)))
        cdp.cmd("Input.dispatchMouseEvent", type="mouseMoved", x=5, y=5)
        delta = {p: [found["rest"][p], (hover or {}).get(p)]
                 for p in PROPS if found["rest"][p] != (hover or {}).get(p)}
        out[label] = {"sel": css, "at": [round(found["x"]), round(found["y"])],
                      "text": found["text"], "cls": found["cls"],
                      "rest": found["rest"], "hover_delta": delta}
        print(f"{label}: {list(delta) or 'no delta'}")
    dst = Path(__file__).parent.parent / "ref/datadog/live/r3"
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "states.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(dst / "states.json")


if __name__ == "__main__":
    main()
