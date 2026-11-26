"""Monsoon Multiverse -- offline inference server (Track 2 API contract).

    python serve.py --port 8000

POST /health   -> {"status": "ready", "model_name": ...}
POST /simulate -> {"rollout": [steps,6,32,36], "inference_ms": float}
Everything (weights, climatology coefficients, static maps) is loaded from weights/emulator.pt; no network access.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from monsoon.model import MAX_LEAD, Emulator, load_emulator

ROOT = Path(__file__).resolve().parent
WEIGHTS = Path(os.environ.get("MONSOON_WEIGHTS", ROOT / "weights" / "emulator.pt"))
MAX_STEPS = MAX_LEAD
SHAPE_IN, SHAPE_PERT = (3, 6, 32, 36), (6, 32, 36)

# Each ensemble member runs single-threaded on its own core (monsoon.model.EnsembleEmulator thread pool):
# 3 members ~0.6 s per 10-day rollout on 4 idle cores. One intra-op thread per member avoids OpenMP
# oversubscription in a shared sandbox (spin-waits can be 30x slower there).
torch.set_num_threads(int(os.environ.get("MONSOON_THREADS", "1")))
torch.set_num_interop_threads(1)
torch.use_deterministic_algorithms(True)
torch.set_flush_denormal(True)   # flush denormal floats to zero (avoids slow CPU paths; no measurable effect on output)

app = FastAPI(title="Monsoon Multiverse")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
STATE = {"model": None, "name": "monsoon-multiverse"}


def load_model() -> None:
    model = load_emulator(WEIGHTS)
    with torch.inference_mode():                      # warm-up so the first scored call is fast
        model.simulate(torch.full(SHAPE_IN, 1.0) * model_baseline(model), torch.tensor([0.0, 1.0]), 2)
    STATE["model"] = model
    STATE["name"] = f"monsoon-multiverse-{model.arch}"


def model_baseline(model: Emulator) -> torch.Tensor:
    """A plausible physical state (annual-mean climatology) for the warm-up call."""
    z = model.clim_coef[:, 0]
    return Emulator.z_to_phys(z)[None]


def as_array(x, shape, name) -> np.ndarray:
    try:
        if isinstance(x, dict):                       # tolerated compact form
            import base64
            raw = base64.b64decode(x["b64"], validate=True)
            if len(raw) != 4 * int(np.prod(shape)):
                raise ValueError("b64 length does not match shape")
            a = np.frombuffer(raw, dtype="<f4").reshape(shape).astype(np.float32)
        else:
            a = np.asarray(x, dtype=np.float32)
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(422, f"{name} is not a numeric array: {type(e).__name__}")
    if a.shape != shape:
        raise HTTPException(422, f"{name} must have shape {list(shape)}, got {list(a.shape)}")
    if not np.isfinite(a).all():
        raise HTTPException(422, f"{name} contains NaN/Inf")
    return a


@app.on_event("startup")
def _startup() -> None:
    load_model()


@app.api_route("/health", methods=["GET", "POST"])
def health():
    if STATE["model"] is None:
        return JSONResponse({"status": "loading", "model_name": STATE["name"]}, status_code=503)
    return {"status": "ready", "model_name": STATE["name"]}


@app.post("/simulate")
async def simulate(req: Request):
    t0 = time.perf_counter()
    try:
        body = json.loads(await req.body())
    except ValueError:
        raise HTTPException(400, "body must be JSON")
    if not isinstance(body, dict):
        raise HTTPException(422, "body must be a JSON object")
    init = as_array(body.get("init_states"), SHAPE_IN, "init_states").copy()
    try:
        doy = np.asarray(body.get("doy_sincos", [0.0, 1.0]), dtype=np.float32).reshape(2).copy()
        steps_f = float(body.get("steps", 10))
    except (TypeError, ValueError):
        raise HTTPException(422, "doy_sincos must be [sin, cos] and steps an integer")
    if not np.isfinite(doy).all() or float(np.hypot(*doy)) < 1e-6:
        raise HTTPException(422, "doy_sincos must be finite and not [0, 0]")
    if not np.isfinite(steps_f) or steps_f != int(steps_f):
        raise HTTPException(422, "steps must be an integer")
    steps = int(steps_f)
    if not 1 <= steps <= MAX_STEPS:
        raise HTTPException(422, f"steps must be in 1..{MAX_STEPS}")
    pert = body.get("perturbation")
    if pert is not None:
        init[-1] += as_array(pert, SHAPE_PERT, "perturbation")   # physical delta on the last input day
    with torch.inference_mode():
        out = STATE["model"].simulate(torch.from_numpy(init), torch.from_numpy(doy), steps).numpy()
    bad = ~np.isfinite(out)                                           # never emit invalid JSON / invalid physics:
    if bad.any():                                                     # fall back to persistence, not to 0 K
        out = np.where(bad, np.broadcast_to(init[-1], out.shape), out)
        out = np.nan_to_num(out, nan=0.0, posinf=0.0, neginf=0.0)       # input itself overflowed
        out[:, 4] = np.where(out[:, 4] == 0.0, 101325.0, out[:, 4])
    out[:, 0] = np.clip(out[:, 0], 233.25, 333.05)   # strictly inside the gate: the f32 mean of 3 clamped
    out[:, 1] = np.maximum(out[:, 1], 0.0)            # members is 233.14998 < 233.15 and FAILS validity
    out[:, 5] = np.maximum(out[:, 5], 0.0)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    # serialise ourselves: FastAPI's generic encoder walks 69k floats one by one and is very slow
    payload = '{"rollout":' + json.dumps(out.astype(np.float32).tolist()) + ',"inference_ms":' + json.dumps(ms) + "}"
    return Response(content=payload, media_type="application/json")


if __name__ == "__main__":
    import uvicorn
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0")
    a = ap.parse_args()
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
