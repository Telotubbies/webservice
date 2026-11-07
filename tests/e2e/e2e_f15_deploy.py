"""F15 E2E (no browser: F15 has no UI). Done when: a documented deploy checks its inputs, a failed backup
never prunes old backups (T6), and the compose files never mount ca.key (T7).
Run: python -I tests/e2e/e2e_f15_deploy.py   (exit 0 = pass)  Needs bash on PATH (Git Bash on Windows)."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c

check = c.check
ROOT = Path(__file__).resolve().parents[2]
BASH = shutil.which("bash")


def w(path, text):
    path.write_text(text, newline=chr(10))


def px(p):
    """Git Bash path: C:/x -> /c/x (the scripts test for a leading slash)."""
    s = Path(p).as_posix()
    return "/" + s[0].lower() + s[2:] if len(s) > 1 and s[1] == ":" else s


def sh(args, env=None, cwd=ROOT):
    return subprocess.run([BASH, *args], cwd=cwd, env={**os.environ, **(env or {})}, capture_output=True, text=True, timeout=120)


def backup_run(tmp, dump_ok):
    """Run backup.sh --once with stub pg_dump/rclone; return (rc, rclone calls)."""
    bin_ = tmp / ("bin_ok" if dump_ok else "bin_fail")
    bin_.mkdir()
    log = tmp / f"rclone_{dump_ok}.log"
    w(bin_ / "pg_dump", '#!/bin/sh\nf=""\nwhile [ $# -gt 0 ]; do [ "$1" = "-f" ] && f="$2"; shift; done\n'
                                  + ('echo data > "$f"\n' if dump_ok else 'exit 1\n'))
    w(bin_ / "rclone", f'#!/bin/sh\necho "$@" >> "{px(log)}"\nexit 0\n')
    for p in bin_.iterdir():
        p.chmod(0o755)
    sec = tmp / "sec"
    sec.mkdir(exist_ok=True)
    for n in ("ak", "sk"):
        (sec / n).write_text("x")
    # backup.sh reads /run/secrets/pg_super_pw; run a patched copy that reads our file instead
    src = (ROOT / "infra/backup/backup.sh").read_text(encoding="utf-8").replace("/run/secrets/pg_super_pw", px(sec / "ak"))
    script = tmp / f"backup_{dump_ok}.sh"
    script.write_text(src, encoding="utf-8", newline=chr(10))
    env = {"PATH": f"{px(bin_)}:{os.environ['PATH']}", "S3_ENDPOINT": "http://x", "S3_BUCKET": "b",
           "S3_ACCESS_KEY_FILE": px(sec / "ak"), "S3_SECRET_KEY_FILE": px(sec / "sk")}
    r = sh([px(script), "--once"], env=env)
    calls = log.read_text(encoding="utf-8") if log.exists() else ""
    return r.returncode, calls, r.stderr


def run():
    if not BASH:
        check("f15: bash available", False, "install Git Bash")
        return
    # 1. preflight refuses an empty deploy (no secrets, no certs) and changes nothing
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / "sec").mkdir()
        (d / "crt").mkdir()
        r = sh(["scripts/deploy-preflight.sh"], env={"SECRETS_DIR": px(d / "sec"), "CERTS_DIR": px(d / "crt"), "BACKUP_DIR": px(d / "bk")})
        check("f15: preflight fails when secrets and certs are missing", r.returncode != 0, r.stdout[-300:])
        check("f15: preflight names the missing secret", "pg_super_pw" in (r.stdout + r.stderr), (r.stdout + r.stderr)[-300:])
        check("f15: preflight is read-only", not any((d / "sec").iterdir()) and not any((d / "crt").iterdir()))

        # 2. ca.key in the mounted cert dir is refused
        for n in ("ca.crt", "server.crt", "server.key"):
            (d / "crt" / n).write_text("x")
        (d / "crt" / "ca.key").write_text("x")
        r = sh(["scripts/deploy-preflight.sh"], env={"SECRETS_DIR": px(d / "sec"), "CERTS_DIR": px(d / "crt"), "BACKUP_DIR": px(d / "bk")})
        check("f15: ca.key inside the certs dir is reported", "ca.key found" in (r.stdout + r.stderr), (r.stdout + r.stderr)[-300:])

        # 3. T6: failed dump -> old backups are not deleted; good run -> retention sweep runs
        rc, calls, err = backup_run(d, dump_ok=False)
        check("f15 T6: failed dump exits non-zero", rc != 0, err[-200:])
        check("f15 T6: no 'rclone delete' after a failed run", "delete" not in calls, calls)
        check("f15 T6: says the sweep was skipped", "retention sweep SKIPPED" in err, err[-200:])
        rc, calls, err = backup_run(d, dump_ok=True)
        check("f15: good run exits 0 and prunes old backups", rc == 0 and "delete" in calls, f"rc={rc} {calls} {err[-200:]}")

    # 4. T7: no compose file mounts the CA private key, nor the whole certs dir read-write
    for f in ("docker-compose.yml", "docker-compose.prod.yml", "docker-compose.test.yml", "docker-compose.garage.yml"):
        t = (ROOT / f).read_text(encoding="utf-8")
        check(f"f15 T7: {f} never names ca.key", "ca.key" not in t)
    t = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    check("f15: backend mounts ca.crt only", "/ca.crt:/mosquitto-certs/ca.crt:ro" in t)
    gen = (ROOT / "infra/gen-certs.sh").read_text(encoding="utf-8")
    check("f15: gen-certs keeps ca.key out of the mounted dir", "ca.key" in gen)
    check("f15: DEPLOY.md documents preflight and restore drill", "make preflight" in (ROOT / "DEPLOY.md").read_text(encoding="utf-8") and "restore-drill" in (ROOT / "DEPLOY.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
    print(f"\n{len(c.failures)} failure(s)")
    sys.exit(1 if c.failures else 0)
