"""Adapter so tools/local_grade.py can grade a checkpoint in-process (no server):

    MONSOON_WEIGHTS=weights/val.pt python tools/local_grade.py --model tools.model_adapter:simulate --suite both
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from monsoon.model import Emulator, load_emulator  # noqa: E402

_MODEL = None


def _model() -> Emulator:
    global _MODEL
    if _MODEL is None:
        _MODEL = load_emulator(os.environ.get("MONSOON_WEIGHTS", "weights/emulator.pt"))
    return _MODEL


def simulate(init_states, doy_sincos, steps, perturbation=None):
    init = np.array(init_states, dtype=np.float32, copy=True)
    if perturbation is not None:
        init[-1] += np.asarray(perturbation, dtype=np.float32)
    with torch.inference_mode():
        out = _model().simulate(torch.from_numpy(init), torch.tensor(np.asarray(doy_sincos, np.float32)), int(steps))
    return out.numpy()
