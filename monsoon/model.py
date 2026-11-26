"""Monsoon Multiverse emulator: a small fully-convolutional network that steps India's weather one day at a time.

Design (see README / brief):
- State is the *anomaly* from a smooth seasonal climatology (3 Fourier harmonics per cell and channel, fitted on the
  training years and stored as model weights -- no per-day lookup table). Rain lives in log1p space, so it can never
  go negative once mapped back.
- Input  = anomalies of the last 3 days + climatology of the target day + land-sea mask + orography + doy sin/cos + lat/lon.
- Output = 1-day anomaly tendency (residual), scaled by the per-channel tendency std.
- arch="local": 8 residual blocks, each with exactly ONE 3x3 convolution and per-pixel normalisation. The receptive
  field radius is therefore exactly 8 grid cells (~900 km) per simulated day: a shock cannot travel faster than that,
  by construction. arch="unet": multi-scale U-Net (larger reach, more context) kept for comparison.
- No dropout, no noise at inference: identical input -> identical output.
"""
from __future__ import annotations

import math

from concurrent.futures import ThreadPoolExecutor

import torch
import torch.nn as nn
import torch.nn.functional as F

N_CH = 6          # t2m, tp, u10, v10, msl, tcwv
T_IN = 3          # days of history
TP = 1            # rain channel index
TCWV = 5          # total column water vapour channel index
N_HARM = 3        # Fourier harmonics of the seasonal climatology
T2M_MIN, T2M_MAX = 233.15, 333.15
MAX_LEAD = 30     # longest rollout the server accepts
H, W = 32, 36
torch.set_flush_denormal(True)   # flush denormal floats to zero (avoids slow CPU paths; no measurable effect on output)


class PixelNorm(nn.Module):
    """LayerNorm over channels at each grid cell (purely local; GroupNorm would mix the whole map)."""

    def __init__(self, c: int):
        super().__init__()
        self.ln = nn.LayerNorm(c)

    def forward(self, x):
        return self.ln(x.permute(0, 2, 3, 1)).permute(0, 3, 1, 2)


class LocalBlock(nn.Module):
    """norm -> 3x3 conv (the only spatial op) -> GELU -> 1x1 conv, residual. Adds exactly 1 cell of reach."""

    def __init__(self, c: int, expand: int = 2):
        super().__init__()
        self.norm = PixelNorm(c)
        self.conv = nn.Conv2d(c, c * expand, 3, padding=1, padding_mode="replicate")
        self.pw = nn.Conv2d(c * expand, c, 1)
        self.scale = nn.Parameter(torch.full((1, c, 1, 1), 0.1))

    def forward(self, x):
        return x + self.scale * self.pw(F.gelu(self.conv(self.norm(x))))


class LocalNet(nn.Module):
    def __init__(self, cin: int, cout: int, width: int = 96, depth: int = 8):
        super().__init__()
        self.stem = nn.Conv2d(cin, width, 1)                      # pointwise: no reach
        self.blocks = nn.Sequential(*[LocalBlock(width) for _ in range(depth)])
        self.norm = PixelNorm(width)
        self.head = nn.Conv2d(width, cout, 1)
        nn.init.zeros_(self.head.weight); nn.init.zeros_(self.head.bias)

    def forward(self, x):
        return self.head(self.norm(self.blocks(self.stem(x))))


def _ublock(cin, cout):
    return nn.Sequential(nn.Conv2d(cin, cout, 3, padding=1, padding_mode="replicate"), nn.GroupNorm(8, cout), nn.GELU(),
                         nn.Conv2d(cout, cout, 3, padding=1, padding_mode="replicate"), nn.GroupNorm(8, cout), nn.GELU())


class UNet(nn.Module):
    def __init__(self, cin: int, cout: int, width: int = 48):
        super().__init__()
        w1, w2, w3 = width, width * 2, width * 4
        self.e1, self.e2, self.e3 = _ublock(cin, w1), _ublock(w1, w2), _ublock(w2, w3)
        self.u2, self.d2 = nn.ConvTranspose2d(w3, w2, 2, stride=2), _ublock(w2 * 2, w2)
        self.u1, self.d1 = nn.ConvTranspose2d(w2, w1, 2, stride=2), _ublock(w1 * 2, w1)
        self.head = nn.Conv2d(w1, cout, 1)
        nn.init.zeros_(self.head.weight); nn.init.zeros_(self.head.bias)

    def forward(self, x):
        e1 = self.e1(x); e2 = self.e2(F.avg_pool2d(e1, 2)); e3 = self.e3(F.avg_pool2d(e2, 2))
        d2 = self.d2(torch.cat([self.u2(e3), e2], 1))
        return self.head(self.d1(torch.cat([self.u1(d2), e1], 1)))


class Emulator(nn.Module):
    """Normalisation + climatology + rain transform + autoregressive rollout. Physical units in and out."""

    def __init__(self, arch: str = "local", width: int = 96, depth: int = 8):
        super().__init__()
        cin = T_IN * N_CH + N_CH + 2 + 2 + 2      # anomalies(3d) + target-day clim + static + doy + lat/lon
        self.arch, self.width, self.depth = arch, width, depth
        self.net = LocalNet(cin, N_CH, width, depth) if arch == "local" else UNet(cin, N_CH, width)
        self.register_buffer("clim_coef", torch.zeros(N_CH, 1 + 2 * N_HARM, H, W))  # model space (tp in log1p)
        self.register_buffer("std", torch.ones(N_CH))         # anomaly std per channel
        self.register_buffer("dstd", torch.ones(N_CH))        # tendency std (normalised anomaly units)
        self.register_buffer("static", torch.zeros(2, H, W))  # standardised land-sea mask + orography
        self.register_buffer("gain", torch.ones(MAX_LEAD, N_CH))  # per-lead output calibration (fit on training years)
        lat = torch.linspace(-1, 1, H)[:, None].expand(H, W)
        lon = torch.linspace(-1, 1, W)[None, :].expand(H, W)
        self.register_buffer("latlon", torch.stack([lat, lon]).clone())

    # ---- seasonal climatology (smooth Fourier fit) ---------------------------------------------------------------
    def clim(self, ang: torch.Tensor) -> torch.Tensor:
        """ang [B] = 2*pi*doy/365 -> climatology in model space [B,6,H,W]."""
        basis = [torch.ones_like(ang)]
        for h in range(1, N_HARM + 1):
            basis += [torch.cos(h * ang), torch.sin(h * ang)]
        basis = torch.stack(basis, 1)                                    # [B, 1+2H]
        return torch.einsum("bk,ckhw->bchw", basis, self.clim_coef)

    # ---- unit conversion -----------------------------------------------------------------------------------------
    @staticmethod
    def phys_to_z(x: torch.Tensor) -> torch.Tensor:
        z = x.clone()
        z[..., TP, :, :] = torch.log1p(z[..., TP, :, :].clamp_min(0))
        return z

    @staticmethod
    def z_to_phys(z: torch.Tensor) -> torch.Tensor:
        x = z.clone()
        x[..., TP, :, :] = torch.expm1(x[..., TP, :, :]).clamp_min(0)
        x[..., 0, :, :] = x[..., 0, :, :].clamp(T2M_MIN, T2M_MAX)
        x[..., TCWV, :, :] = x[..., TCWV, :, :].clamp_min(0)       # water vapour cannot be negative
        return x

    def to_anom(self, z: torch.Tensor, ang: torch.Tensor) -> torch.Tensor:
        """z [B,T,6,H,W] model space for days ending at angle ang (last day) -> normalised anomalies."""
        T = z.shape[1]
        out = [(z[:, t] - self.clim(ang - 2 * math.pi * (T - 1 - t) / 365.0)) / self.std[:, None, None] for t in range(T)]
        return torch.stack(out, 1)

    def from_anom(self, a: torch.Tensor, ang: torch.Tensor) -> torch.Tensor:
        return a * self.std[:, None, None] + self.clim(ang)

    # ---- dynamics --------------------------------------------------------------------------------------------------
    def step(self, hist: torch.Tensor, ang_last: torch.Tensor) -> torch.Tensor:
        """hist [B,3,6,H,W] normalised anomalies, ang_last [B] angle of the last day -> next-day anomaly [B,6,H,W]."""
        B = hist.shape[0]
        ang_t = ang_last + 2 * math.pi / 365.0
        clim_t = (self.clim(ang_t) - self.clim_coef[:, 0]) / self.std[:, None, None]   # seasonal signal only
        feats = torch.cat([
            hist.reshape(B, T_IN * N_CH, H, W), clim_t,
            self.static.expand(B, -1, -1, -1),
            torch.stack([torch.sin(ang_t), torch.cos(ang_t)], 1)[:, :, None, None].expand(B, 2, H, W),
            self.latlon.expand(B, -1, -1, -1),
        ], 1)
        return hist[:, -1] + self.net(feats) * self.dstd[None, :, None, None]

    def rollout_anom(self, hist: torch.Tensor, ang_last: torch.Tensor, steps: int) -> torch.Tensor:
        out = []
        for k in range(steps):
            nxt = self.step(hist, ang_last + 2 * math.pi * k / 365.0)
            out.append(nxt)
            hist = torch.cat([hist[:, 1:], nxt[:, None]], 1)
        return torch.stack(out, 1)                                       # [B,steps,6,H,W]

    @torch.no_grad()
    def simulate(self, init_states: torch.Tensor, doy_sincos: torch.Tensor, steps: int) -> torch.Tensor:
        """init_states [3,6,H,W] physical (perturbation already added); doy_sincos [2] of the last input day."""
        ang = torch.atan2(doy_sincos[0], doy_sincos[1]).reshape(1).float()
        hist = self.to_anom(self.phys_to_z(init_states.float())[None], ang)
        a = self.rollout_anom(hist, ang, steps)[0]
        angs = ang + 2 * math.pi * torch.arange(1, steps + 1, dtype=torch.float32) / 365.0
        g = self.gain[torch.clamp(torch.arange(steps), max=MAX_LEAD - 1)][:, :, None, None]   # [steps,6,1,1]
        a = a * g          # output calibration only: the dynamics (fed-back state) are untouched
        z = torch.stack([self.from_anom(a[k:k + 1], angs[k:k + 1])[0] for k in range(steps)])
        return self.z_to_phys(z)


def _run_member(m, init_states, doy_sincos, steps):
    with torch.inference_mode():
        return m.simulate(init_states, doy_sincos, steps)


class EnsembleEmulator(nn.Module):
    """Average of several independently trained Emulators (different random seeds).

    Each member runs its own full rollout from the same input; the outputs are averaged in physical units.
    Every member is local (≤ 8 grid cells/day) and deterministic, so the average is too."""

    def __init__(self, members):
        super().__init__()
        self.members = nn.ModuleList(members)
        self.arch = f"{members[0].arch}-x{len(members)}"
        self._pool = None

    @property
    def clim_coef(self):
        return self.members[0].clim_coef

    @torch.no_grad()
    def simulate(self, init_states: torch.Tensor, doy_sincos: torch.Tensor, steps: int) -> torch.Tensor:
        # members are independent: run them on separate cores (each single-threaded), then average
        if self._pool is None:
            self._pool = ThreadPoolExecutor(max_workers=len(self.members))
        outs = list(self._pool.map(lambda m: _run_member(m, init_states, doy_sincos, steps), self.members))
        return torch.stack(outs).mean(0)


def _build(ck) -> "Emulator":
    m = Emulator(arch=ck.get("arch", "local"), width=ck.get("width", 96), depth=ck.get("depth", 8))
    sd = dict(ck["state_dict"])
    sd.setdefault("gain", torch.ones(MAX_LEAD, N_CH))
    m.load_state_dict(sd)
    return m.eval()


def load_emulator(path, map_location="cpu"):
    """Build the model from a checkpoint: a single Emulator saved by training/train.py, or an ensemble
    file made by training/make_ensemble.py ({"ensemble": [checkpoint, ...]}). Older checkpoints without
    'gain' get gain = 1."""
    ck = torch.load(path, map_location=map_location, weights_only=False)
    if "ensemble" in ck:
        return EnsembleEmulator([_build(c) for c in ck["ensemble"]]).eval()
    return _build(ck)
