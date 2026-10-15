"""Merge all ref/datadog/live/*-vocab.json into one frequency table."""
import json
import sys
from collections import Counter
from pathlib import Path

live = Path(sys.argv[1] if len(sys.argv) > 1 else "ref/datadog/live")
merged = {}
for f in sorted(live.glob("*-vocab.json")):
    d = json.loads(f.read_text(encoding="utf-8"))
    for prop, entries in d["vocab"].items():
        c = merged.setdefault(prop, Counter())
        for e in entries:
            c[e["v"]] += e["c"]

for prop, c in merged.items():
    print(f"\n## {prop}")
    for v, n in c.most_common(25):
        print(f"  {n:6}  {v}")
