"""Scratch helper: exact-string edits that survive CRLF working trees."""
import sys


def rw(path, pairs):
    s = open(path, encoding="utf-8", newline="").read()
    crlf = "\r\n" in s
    for a, b in pairs:
        if crlf:
            a, b = a.replace("\n", "\r\n"), b.replace("\n", "\r\n")
        if a not in s:
            sys.exit(f"NOT FOUND in {path}: {a[:70]!r}")
        s = s.replace(a, b, 1)
    open(path, "w", encoding="utf-8", newline="").write(s)
