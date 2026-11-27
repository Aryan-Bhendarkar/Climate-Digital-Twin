"""Hosted entry point (Hugging Face Space; also runs locally: python app.py).

One port serves everything:
  /health, /simulate          judge-facing API contract (defined in serve.py)
  /api/health, /api/simulate  same handlers, used by the dashboard's same-origin calls
  /                           dashboard (dashboard/index.html)

On ZeroGPU the model runs on the GPU inside the @spaces.GPU call; anywhere else it runs on CPU.
"""
import os
from pathlib import Path

# Needed for deterministic cuBLAS when torch runs on CUDA; must be set before CUDA is initialised.
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import torch
import uvicorn
from fastapi.staticfiles import StaticFiles

import serve

try:
    import spaces                      # present on Hugging Face ZeroGPU Spaces
    gpu = spaces.GPU(duration=60)
except ImportError:                    # local / CPU runs: no-op decorator
    def gpu(fn):
        return fn

ROOT = Path(__file__).resolve().parent
api = serve.app


@gpu
def _simulate_on_device(model, init, doy, steps):
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(dev)
    return model.simulate(init.to(dev), doy.to(dev), steps).cpu()


class _DeviceModel:
    """Same interface as the loaded emulator; simulate() runs inside the GPU-decorated call."""

    def __init__(self, model):
        self._m = model

    def __getattr__(self, name):
        return getattr(self._m, name)

    def simulate(self, init, doy, steps):
        return _simulate_on_device(self._m, init, doy, steps)


def _wrap_model_after_startup() -> None:
    serve.STATE["model"] = _DeviceModel(serve.STATE["model"])


# Runs after serve.py's own startup hook, which loads the weights.
api.add_event_handler("startup", _wrap_model_after_startup)

# Same handlers under /api so the dashboard works on a single origin. Must be added before the static mount.
for route in list(api.routes):
    if getattr(route, "path", None) in ("/health", "/simulate"):
        api.add_api_route("/api" + route.path, route.endpoint, methods=sorted(route.methods))

api.mount("/", StaticFiles(directory=str(ROOT / "dashboard"), html=True), name="dashboard")

if __name__ == "__main__":
    uvicorn.run(api, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")), log_level="warning")
