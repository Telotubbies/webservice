"""dd-crawl — loop Datadog pages: nav -> wait -> eval dd-components.js +
dd-layout.js + dd-text.js -> screenshot -> save under ref/datadog/live/<run>/.
Usage: CDP_PORT=9223 python -X utf8 scripts/dd-crawl.py [run-name] [page ...]
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
OUT = ROOT / "ref" / "datadog" / "live" / (sys.argv[1] if len(sys.argv) > 1 else "r2")

# Datadog page -> our route
PAGES = {
    "monitors":   "https://ap2.datadoghq.com/monitors/manage",      # /alarms
    "dashboards": "https://ap2.datadoghq.com/dashboard/lists",      # overview list
    "dashboard":  "https://ap2.datadoghq.com/dashboard",            # / overview
    "infra":      "https://ap2.datadoghq.com/infrastructure",       # /line, /tags
    "metrics":    "https://ap2.datadoghq.com/metric/explorer",      # /trends
    "watchdog":   "https://ap2.datadoghq.com/watchdog",             # /insights
    "logs":       "https://ap2.datadoghq.com/logs",                 # /commands, audit
    "org":        "https://ap2.datadoghq.com/account/organization/settings",  # /admin
    "notebook":   "https://ap2.datadoghq.com/notebook/list",
    "events":     "https://ap2.datadoghq.com/event/explorer",
}


def cdp(*args):
    env = dict(os.environ)
    r = subprocess.run(
        [sys.executable, "-X", "utf8", str(SCRIPTS / "cdp.py"), *args],
        capture_output=True, text=True, env=env, cwd=ROOT)
    if r.returncode != 0:
        print("  ! cdp error:", (r.stderr or r.stdout).strip()[:300])
        return None
    return r.stdout


def run(names):
    OUT.mkdir(parents=True, exist_ok=True)
    for name in names:
        url = PAGES[name]
        d = OUT / name
        d.mkdir(exist_ok=True)
        print(f"== {name} {url}")
        cdp("nav", "datadoghq", url)
        time.sleep(6)  # settle SPA + lazy widgets
        for script in ("dd-sniper.js", "dd-components.js", "dd-layout.js", "dd-text.js"):
            out = cdp("eval", "datadoghq", str(SCRIPTS / script))
            if out:
                (d / script.replace(".js", ".json")).write_text(out, encoding="utf-8")
        cdp("shot", "datadoghq", str(d / "page.png"))
        try:
            info = json.loads(cdp("eval", "datadoghq",
                                  "JSON.stringify({url:location.href,title:document.title})"))
            (d / "meta.json").write_text(info, encoding="utf-8")
        except Exception:
            pass


if __name__ == "__main__":
    names = sys.argv[2:] or list(PAGES)
    run(names)
    print("done ->", OUT)
