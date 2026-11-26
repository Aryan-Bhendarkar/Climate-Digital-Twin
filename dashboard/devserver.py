"""One-port dashboard server: serves this folder and forwards /api/<endpoint> to the model server.

    python devserver.py                      # dashboard on http://127.0.0.1:8080, model at http://127.0.0.1:8000
    python devserver.py --port 8080 --model http://127.0.0.1:8000

Then set the dashboard's server URL to  http://127.0.0.1:8080/api  (it is pre-filled when opened through this server).
Useful when a browser blocks calls to a second local port. Standard library only; the model code is not imported.
"""
from __future__ import annotations

import argparse
import http.server
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path

PREFIX = "/api/"


class Handler(http.server.SimpleHTTPRequestHandler):
    model = "http://127.0.0.1:8000"

    def address_string(self):          # skip reverse-DNS lookups (slow on some Windows setups)
        return self.client_address[0]

    def _forward(self, method: str):
        endpoint = self.path[len(PREFIX):].split("?")[0].strip("/")
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        req = urllib.request.Request(f"{self.model}/{endpoint}", data=body, method=method,
                                     headers={"Content-Type": self.headers.get("Content-Type", "application/json")})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                status, data, ctype = r.status, r.read(), r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            status, data, ctype = e.code, e.read(), "application/json"
        except OSError as e:
            status, data, ctype = 502, f'{{"error": "model server unreachable: {e}"}}'.encode(), "application/json"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path.startswith(PREFIX):
            return self._forward("POST")
        self.send_error(404)

    def do_GET(self):
        if self.path.startswith(PREFIX):
            return self._forward("GET")
        return super().do_GET()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--model", default="http://127.0.0.1:8000")
    a = ap.parse_args()
    Handler.model = a.model.rstrip("/")
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), partial(Handler, directory=str(Path(__file__).parent)))
    print(f"dashboard: http://127.0.0.1:{a.port}/?server=api   (model: {Handler.model})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
