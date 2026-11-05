"""Download all asset URLs collected by dd-assets.js into ref/datadog/assets/.
Also dump every inline SVG from *-icons.json into assets/icons/ as .svg files.

Usage: py -3.12 scripts/dd-download.py
"""
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIVE = ROOT / "ref/datadog/live"
OUT = ROOT / "ref/datadog/assets"
IMG_OUT = OUT / "img"
ICON_OUT = OUT / "icons"


def slug(url: str) -> str:
    name = url.split("?")[0].rstrip("/").rsplit("/", 1)[-1] or "asset"
    name = re.sub(r"[^\w.\-]", "_", name)[:80]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "bin"
    if ext not in {"png", "jpg", "jpeg", "webp", "svg", "gif", "ico", "avif", "mp4", "webm", "woff2", "woff"}:
        name += ".bin"
    h = hashlib.md5(url.encode()).hexdigest()[:8]
    return f"{name.rsplit('.', 1)[0]}-{h}.{name.rsplit('.', 1)[-1]}"


def download_imgs():
    IMG_OUT.mkdir(parents=True, exist_ok=True)
    urls = set()
    for f in LIVE.glob("*-assets.json"):
        urls.update(json.loads(f.read_text(encoding="utf-8")).get("assets", []))
    ok = fail = skip = 0
    for u in sorted(urls):
        dest = IMG_OUT / slug(u)
        if dest.exists():
            skip += 1
            continue
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
            dest.write_bytes(urllib.request.urlopen(req, timeout=20).read())
            ok += 1
        except Exception as e:
            print(f"FAIL {u[:80]} {e}")
            fail += 1
    print(f"images: {ok} downloaded, {skip} existed, {fail} failed")


def dump_icons():
    ICON_OUT.mkdir(parents=True, exist_ok=True)
    written = 0
    seen = {}
    for f in LIVE.glob("*-icons.json"):
        page = f.stem.replace("-icons", "")
        for i, ic in enumerate(json.loads(f.read_text(encoding="utf-8")).get("icons", [])):
            svg = ic["svg"]
            h = hashlib.md5(svg.encode()).hexdigest()[:8]
            if h in seen:
                seen[h]["pages"].append(page)
                continue
            ctx = re.sub(r"[^\w\-]+", "-", ic.get("ctx") or "icon").strip("-")[:40] or "icon"
            name = f"{ctx}-{h}.svg"
            (ICON_OUT / name).write_text(svg, encoding="utf-8")
            seen[h] = {"file": name, "size": [ic["w"], ic["h"]], "pages": [page]}
            written += 1
    (ICON_OUT / "_index.json").write_text(
        json.dumps(list(seen.values()), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"icons: {written} unique svg written")


if __name__ == "__main__":
    dump_icons()
    download_imgs()
