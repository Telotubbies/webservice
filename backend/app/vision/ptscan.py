"""Refuse a .pt checkpoint whose pickle can run code.

A PyTorch checkpoint is a zip whose `data.pkl` is a pickle: loading it can
execute anything the pickle names (`os.system`, `eval`, ...). The converter
sandbox (no network, read-only, non-root, caps dropped) limits the blast
radius; this scan is the first gate, before the file is ever queued.

Method: walk the pickle opcodes (never execute them), resolve every
GLOBAL / STACK_GLOBAL to (module, name), and allow only the modules a
YOLO/ultralytics checkpoint legitimately needs. Anything else, a legacy
non-zip pickle, or an unreadable archive is refused.
"""

from __future__ import annotations

import pickletools
import zipfile
from pathlib import Path

ALLOWED_ROOTS = {"torch", "ultralytics", "collections", "numpy", "_codecs", "copyreg", "math", "functools"}
# `builtins` is where eval/exec/open/__import__ live: only inert constructors pass
ALLOWED_BUILTINS = {"set", "frozenset", "dict", "list", "tuple", "int", "float", "str", "bool", "bytes",
                    "bytearray", "complex", "slice", "range", "object"}
# re-entry points that unpickle or execute again
FORBIDDEN_NAMES = {"load", "loads", "_load_from_bytes", "eval", "exec", "compile", "system", "popen",
                   "run", "call", "check_output", "__import__", "getattr", "setattr", "open"}
MAX_PICKLE_BYTES = 256 * 1024 * 1024
MAX_MEMBERS = 5000


class UnsafeCheckpoint(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def _globals(data: bytes):
    """Yield (module, name) for each import the pickle performs, without running it."""
    strings: list[str] = []          # recent string pushes, newest last (STACK_GLOBAL reads the top two)
    memo: dict[int, str] = {}
    for op, arg, _pos in pickletools.genops(data):
        n = op.name
        if n in ("SHORT_BINUNICODE", "BINUNICODE", "UNICODE", "BINUNICODE8"):
            strings.append(arg)
            strings[:] = strings[-4:]
        elif n in ("MEMOIZE",):
            if strings:
                memo[len(memo)] = strings[-1]
        elif n in ("BINPUT", "LONG_BINPUT"):
            if strings:
                memo[arg] = strings[-1]
        elif n in ("BINGET", "LONG_BINGET"):
            if arg in memo:
                strings.append(memo[arg])
                strings[:] = strings[-4:]
        elif n == "GLOBAL":
            mod, _, name = str(arg).partition(" ")
            yield mod, name
        elif n == "STACK_GLOBAL":
            if len(strings) < 2:
                raise UnsafeCheckpoint("unresolvable_import", "STACK_GLOBAL without two string operands")
            yield strings[-2], strings[-1]


def scan_bytes(data: bytes) -> None:
    for mod, name in _globals(data):
        root = mod.split(".")[0]
        if root in ("builtins", "__builtin__"):
            if name not in ALLOWED_BUILTINS:
                raise UnsafeCheckpoint("forbidden_import", f"{mod}.{name}")
        elif root not in ALLOWED_ROOTS:
            raise UnsafeCheckpoint("forbidden_import", f"{mod}.{name}")
        elif name in FORBIDDEN_NAMES:
            raise UnsafeCheckpoint("forbidden_import", f"{mod}.{name}")


def scan_pt(path: str | Path) -> None:
    """Raise UnsafeCheckpoint unless `path` is a zip checkpoint with only allowed imports."""
    p = Path(path)
    if not zipfile.is_zipfile(p):
        raise UnsafeCheckpoint("not_a_zip_checkpoint", "legacy raw-pickle checkpoints are not accepted")
    try:
        with zipfile.ZipFile(p) as z:
            infos = z.infolist()
            if len(infos) > MAX_MEMBERS:
                raise UnsafeCheckpoint("too_many_members")
            pkls = [i for i in infos if i.filename.endswith(".pkl")]
            if not pkls:
                raise UnsafeCheckpoint("no_pickle_found")
            for i in pkls:
                if i.file_size > MAX_PICKLE_BYTES:
                    raise UnsafeCheckpoint("pickle_too_large")
                scan_bytes(z.read(i))
    except zipfile.BadZipFile as e:
        raise UnsafeCheckpoint("bad_archive", str(e)) from None
    except (ValueError, IndexError, KeyError) as e:
        raise UnsafeCheckpoint("unreadable_pickle", type(e).__name__) from None
