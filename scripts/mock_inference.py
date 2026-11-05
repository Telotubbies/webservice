"""Stand-in model server for the INFERENCE_URL contract (backend/app/alarming/inference.py).
    python scripts/mock_inference.py [port]     # then INFERENCE_URL=http://host.docker.internal:9100/predict
Replace with your real model; only the request/response shapes matter."""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        feats = {t["name"].split(".", 1)[-1]: t["v"] for t in json.loads(self.rfile.read(int(self.headers["Content-Length"]))).get("tags", [])
                 if isinstance(t.get("v"), (int, float))}
        g = feats.get("sort.vision.cam1.gravel_ratio")
        res = []
        if g is not None:
            res.append({"tag": "plant1.sort.vision.cam1.gravel_ratio", "label": "screen_clogging" if g < 0.4 else "normal",
                        "score": round(1 - g if g < 0.4 else g, 3), "severity": "warning" if g < 0.4 else "info",
                        "detail": f"gravel ratio {g:.2f}"})
        body = json.dumps({"model": "mock-gravel-v0", "results": res}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


HTTPServer(("0.0.0.0", int(sys.argv[1]) if len(sys.argv) > 1 else 9100), H).serve_forever()
