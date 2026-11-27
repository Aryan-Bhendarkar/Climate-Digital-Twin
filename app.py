"""Hosted entry point (Hugging Face Space; also runs locally: python app.py).

One port serves everything:
  /health, /simulate          judge-facing API contract (defined in serve.py)
  /api/health, /api/simulate  same handlers, used by the dashboard's same-origin calls
  /                           dashboard (dashboard/index.html)
"""
import os
from pathlib import Path

import uvicorn
from fastapi.staticfiles import StaticFiles

import serve

ROOT = Path(__file__).resolve().parent
api = serve.app

# Same handlers under /api so the dashboard works on a single origin. Must be added before the static mount.
for route in list(api.routes):
    if getattr(route, "path", None) in ("/health", "/simulate"):
        api.add_api_route("/api" + route.path, route.endpoint, methods=sorted(route.methods))

api.mount("/", StaticFiles(directory=str(ROOT / "dashboard"), html=True), name="dashboard")

if __name__ == "__main__":
    uvicorn.run(api, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")), log_level="warning")
