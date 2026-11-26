"""Checks the guarantees the README makes, on the shipped weights (no data needed, ~10 s on CPU):
shape, finiteness, determinism, null-shock identity, the 8-cell-per-day reach limit and the output guards.

    python tests/test_contract.py
"""
import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from monsoon.model import Emulator, load_emulator  # noqa: E402

torch.set_num_threads(1)
m = load_emulator(ROOT / "weights" / "emulator.pt")
x = Emulator.z_to_phys(m.clim_coef[:, 0])[None].repeat(3, 1, 1, 1)   # annual-mean climatological state
doy = torch.tensor([0.5, -0.866])

a = m.simulate(x, doy, 3)
b = m.simulate(x, doy, 3)
assert a.shape == (3, 6, 32, 36) and torch.isfinite(a).all(), "bad shape or non-finite output"
assert torch.equal(a, b), "not deterministic"
assert torch.equal(m.simulate(x + 0.0, doy, 3), a), "zero shock is not bit-identical"

y = x.clone()
y[-1, 0, 16, 18] += 1.0                                               # +1 K in one grid cell
d = (m.simulate(y, doy, 2) - a[:2]).abs().amax(1).numpy()            # [day, lat, lon]
ii, jj = np.meshgrid(np.arange(32), np.arange(36), indexing="ij")
cells = np.maximum(abs(ii - 16), abs(jj - 18))                       # grid-cell distance (any direction)
for k in range(2):
    assert d[k][cells > 8 * (k + 1)].max() == 0, f"response beyond {8 * (k + 1)} cells on day {k + 1}"
    assert d[k][cells <= 8 * (k + 1)].max() > 0, "shock had no effect"

assert (a[:, 1] >= 0).all() and (a[:, 5] >= 0).all(), "negative rain or water vapour"
assert (a[:, 0] >= 233.0).all() and (a[:, 0] <= 333.2).all(), "temperature outside the guard range"
print("contract OK: shape, determinism, null shock, 8-cell/day reach, guards")
