"""Mirror authenticated Datadog pages via CDP.

Per page: enable Network capture, navigate, wait for network idle, then dump
every observed response body (JS/CSS/fonts/images/XHR) + rendered DOM +
screenshot. Resources are deduped globally by URL into shared resources/;
each page gets a manifest.json + index.html (rendered DOM) + shot.png.

Usage:
  CDP_PORT=9223 py -3.12 dd-mirror.py <sel> <out_dir> <url> [<url>...]

<sel> = substring matching the Datadog tab (e.g. "datadoghq").
"""
import base64
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from websocket import create_connection

import os
DEBUG = "http://localhost:" + os.environ.get("CDP_PORT", "9223")
IDLE_SECS = 1.5
NAV_TIMEOUT = 45


def targets():
    return json.load(urllib.request.urlopen(DEBUG + "/json", timeout=5))


def pick(sel):
    pages = [t for t in targets() if t.get("type") == "page"]
    for t in pages:
        if sel in t.get("url", "") or sel in t.get("title", ""):
            return t
    sys.exit(f"no target matching {sel!r}")


class CDP:
    def __init__(self, target):
        self.ws = create_connection(target["webSocketDebuggerUrl"], timeout=60,
                                    suppress_origin=True)
        self._id = 0
        self.events = []          # buffered CDP events
        self.requests = {}        # requestId -> {url, type}
        self.finished = set()

    def _recv(self):
        msg = json.loads(self.ws.recv())
        if "method" in msg:
            self.events.append(msg)
            p = msg.get("params", {})
            if msg["method"] == "Network.requestWillBeSent":
                self.requests[p["requestId"]] = {"url": p["request"]["url"],
                                                 "type": p.get("type", "")}
            elif msg["method"] in ("Network.loadingFinished",
                                   "Network.loadingFailed"):
                self.finished.add(p["requestId"])
        return msg

    def cmd(self, method, **params):
        self._id += 1
        self.ws.send(json.dumps({"id": self._id, "method": method,
                                 "params": params}))
        while True:
            msg = self._recv()
            if msg.get("id") == self._id:
                if "error" in msg:
                    return {"_error": msg["error"]}
                return msg.get("result", {})

    def eval(self, expr):
        r = self.cmd("Runtime.evaluate", expression=expr, returnByValue=True,
                     awaitPromise=True)
        return r.get("result", {}).get("value")

    def idle(self, quiet=IDLE_SECS, timeout=NAV_TIMEOUT):
        """Wait until no new network requests for `quiet` seconds."""
        deadline = time.time() + timeout
        self.ws.settimeout(1.0)
        last_seen = time.time()
        n = len(self.requests)
        while time.time() < deadline:
            try:
                self._recv()
                if len(self.requests) != n:
                    n = len(self.requests)
                    last_seen = time.time()
            except Exception:
                if time.time() - last_seen >= quiet:
                    break
        self.ws.settimeout(60)


def url_to_file(url):
    """Stable filename from a URL: host + path + short hash, keep extension."""
    h = hashlib.sha1(url.encode()).hexdigest()[:8]
    u = re.sub(r"^https?://", "", url)
    u = re.sub(r"[?#].*$", "", u)
    u = re.sub(r"[^A-Za-z0-9._/-]", "_", u)
    parts = u.split("/")
    name = parts[-1] or "index"
    stem, dot, ext = name.rpartition(".")
    if dot and len(ext) <= 5:
        name = f"{stem[:60]}-{h}.{ext}"
    else:
        name = f"{name[:60]}-{h}.bin"
    return name


def mirror(cdp, url, page_dir, res_dir, manifest_all):
    cdp.requests.clear()
    cdp.finished.clear()
    cdp.events.clear()
    cdp.cmd("Page.navigate", url=url)
    cdp.idle()
    cdp.eval("new Promise(r=>setTimeout(r,1500))")

    slug = re.sub(r"[^a-z0-9]+", "-",
                  re.sub(r"^https?://[^/]+", "", url).strip("/").lower()) or "root"
    page_dir = page_dir / slug[:60]
    page_dir.mkdir(parents=True, exist_ok=True)

    manifest = {}
    for rid, info in list(cdp.requests.items()):
        if rid not in cdp.finished:
            continue
        r = cdp.cmd("Network.getResponseBody", requestId=rid)
        if "_error" in r:
            manifest[info["url"]] = {"error": r["_error"].get("message", "?")}
            continue
        raw = base64.b64decode(r["body"]) if r.get("base64Encoded") \
            else r["body"].encode("utf-8", "replace")
        fname = url_to_file(info["url"])
        fpath = res_dir / fname
        if not fpath.exists():
            fpath.write_bytes(raw)
        manifest[info["url"]] = {"file": f"../resources/{fname}",
                                 "type": info["type"], "bytes": len(raw)}

    html = cdp.eval("document.documentElement.outerHTML") or ""
    (page_dir / "index.html").write_text(html, encoding="utf-8")
    shot = cdp.cmd("Page.captureScreenshot", format="png")
    if "data" in shot:
        (page_dir / "shot.png").write_bytes(base64.b64decode(shot["data"]))
    final = cdp.eval("location.href")
    (page_dir / "manifest.json").write_text(json.dumps(
        {"url": url, "final_url": final, "resources": manifest},
        indent=2), encoding="utf-8")
    manifest_all[url] = {"slug": slug[:60], "final_url": final,
                         "resources": len(manifest),
                         "errors": sum(1 for v in manifest.values() if "error" in v)}
    print(f"{slug[:50]:50s} res={len(manifest):4d} "
          f"err={manifest_all[url]['errors']} -> {final}")


def main():
    sel, out_dir, urls = sys.argv[1], Path(sys.argv[2]), sys.argv[3:]
    res_dir = out_dir / "resources"
    res_dir.mkdir(parents=True, exist_ok=True)
    cdp = CDP(pick(sel))
    cdp.cmd("Page.enable")
    cdp.cmd("Network.enable")
    manifest_all = {}
    for u in urls:
        try:
            mirror(cdp, u, out_dir, res_dir, manifest_all)
        except Exception as e:
            manifest_all[u] = {"error": str(e)[:200]}
            print(f"{u}: FAILED {e}")
    (out_dir / "manifest.json").write_text(json.dumps(
        manifest_all, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
