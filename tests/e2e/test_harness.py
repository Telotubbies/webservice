"""Regression test for the E2E harness itself: `start_vite` must never hand the
suite a server it did not start. A port that already answers means another
worktree's Vite is listening (the D1 review measured exactly that on 5331), and
the run would then gate the wrong tree and report a false pass.

Run: .venv/Scripts/python.exe -I tests/e2e/test_harness.py   (exit 0 = ok)
"""
import http.server
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e_common as c


class _Any(http.server.BaseHTTPRequestHandler):
    """Answers 200 on every path, like any Vite serving a page."""

    def do_GET(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


srv = http.server.HTTPServer(("127.0.0.1", 0), _Any)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    try:
        proc, url = c.start_vite(port)
    except SystemExit as e:
        print(f"ok   start_vite refuses port {port} another server already answers: {e}")
        sys.exit(0)
    c.stop(proc)
    print(f"FAIL start_vite returned {url} while another server held port {port}")
    sys.exit(1)
finally:
    srv.shutdown()
