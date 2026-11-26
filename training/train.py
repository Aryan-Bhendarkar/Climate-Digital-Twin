"""Train the Monsoon Multiverse emulator.

Curriculum: one-step training, then multi-step unrolled fine-tuning with full backprop (the model learns to correct
its own rollout errors -> no drift). Loss is per channel and per lead, divided by the error of the best reference
(persistence or climatology) at that lead -- the same normalisation the skill score uses.

Examples:
  # validation run (hold out 2019-2021), then grade with tools/local_grade.py
  python training/train.py --data ../data/india_climate_train.nc --train-end 2018 --out weights/val.pt
  # final model on all years
  python training/train.py --data ../data/india_climate_train.nc --train-end 2021 --out weights/emulator.pt
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch
import xarray as xr

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from monsoon.model import Emulator, N_CH, N_HARM, TP, T_IN  # noqa: E402


def fourier_basis(ang: np.ndarray) -> np.ndarray:
    cols = [np.ones_like(ang)]
    for h in range(1, N_HARM + 1):
        cols += [np.cos(h * ang), np.sin(h * ang)]
    return np.stack(cols, 1)                                              # [T, 1+2H]


def prepare(path: str, train_end: int):
    ds = xr.open_dataset(path)
    x = ds["data"].values.astype("f8")                                     # [T,6,32,36]
    static = ds["static"].values.astype("f4")
    doy = ds["time"].dt.dayofyear.values.astype("f8")
    years = ds["time"].dt.year.values
    lat = ds["lat"].values
    z = x.copy(); z[:, TP] = np.log1p(np.clip(z[:, TP], 0, None))
    ang = 2 * np.pi * doy / 365.0
    tr = years <= train_end
    B = fourier_basis(ang)                                                 # least-squares harmonic climatology
    coef, *_ = np.linalg.lstsq(B[tr], z[tr].reshape(tr.sum(), -1), rcond=None)
    clim = (B @ coef).reshape(z.shape)
    anom = z - clim
    std = anom[tr].std(axis=(0, 2, 3))
    a = anom / std[None, :, None, None]
    dstd = np.diff(a[tr], axis=0).std(axis=(0, 2, 3))
    st = (static - static.mean(axis=(1, 2), keepdims=True)) / (static.std(axis=(1, 2), keepdims=True) + 1e-6)
    return dict(a=a.astype("f4"), ang=ang.astype("f4"), tr=tr, lat=lat, std=std, dstd=dstd, static=st,
                coef=coef.reshape(B.shape[1], N_CH, 32, 36).transpose(1, 0, 2, 3).astype("f4"))


def ref_mse(a: np.ndarray, tr: np.ndarray, kmax: int, w_lat: np.ndarray) -> np.ndarray:
    """Best-reference MSE per lead and channel, in normalised anomaly units (climatology = zero anomaly)."""
    at = a[tr]
    out = np.zeros((kmax, N_CH))
    clim_mse = ((at ** 2) * w_lat[None, None, :, None]).mean(axis=(0, 2, 3))
    for k in range(1, kmax + 1):
        pers = (((at[k:] - at[:-k]) ** 2) * w_lat[None, None, :, None]).mean(axis=(0, 2, 3))
        out[k - 1] = np.minimum(pers, clim_mse)
    return out


def save(model, args, log, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "arch": args.arch, "width": args.width, "depth": args.depth,
                "args": vars(args), "log": log}, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="weights/emulator.pt")
    ap.add_argument("--train-end", type=int, default=2021, help="last training year (inclusive)")
    ap.add_argument("--arch", default="local", choices=["local", "unet"])
    ap.add_argument("--width", type=int, default=96)
    ap.add_argument("--depth", type=int, default=8)
    ap.add_argument("--stages", default="1:40,2:10,4:10,8:12,10:4", help="unroll_steps:epochs,...")
    ap.add_argument("--lrs", default="1e-3,3e-4,2e-4,1e-4,5e-5", help="peak lr per stage")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--steps-per-epoch", type=int, default=150)
    ap.add_argument("--heavy-weight", type=float, default=2.0, help="extra loss weight where true rain > 10 mm/day")
    ap.add_argument("--noise", type=float, default=0.02, help="input noise (normalised std) in the 1-step stage")
    ap.add_argument("--t2m-shift", type=float, default=0.7, help="random +-K offset on t2m (warm-year robustness)")
    ap.add_argument("--ema", type=float, default=0.999)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed); np.random.seed(args.seed)
    dev = torch.device(args.device)
    P = prepare(args.data, args.train_end)
    w_lat_np = np.cos(np.deg2rad(P["lat"])); w_lat_np = w_lat_np / w_lat_np.mean()
    stages = [tuple(int(v) for v in s.split(":")) for s in args.stages.split(",")]
    lrs = [float(v) for v in args.lrs.split(",")]
    assert len(lrs) == len(stages), "one lr per stage"
    kmax = max(k for k, _ in stages)
    REF = torch.tensor(ref_mse(P["a"], P["tr"], kmax, w_lat_np), device=dev, dtype=torch.float32)   # [kmax,6]

    model = Emulator(arch=args.arch, width=args.width, depth=args.depth).to(dev)
    model.clim_coef.copy_(torch.tensor(P["coef"])); model.std.copy_(torch.tensor(P["std"], dtype=torch.float32))
    model.dstd.copy_(torch.tensor(P["dstd"], dtype=torch.float32)); model.static.copy_(torch.tensor(P["static"]))
    ema = copy.deepcopy(model).eval()
    for p in ema.parameters():
        p.requires_grad_(False)
    print(f"arch {args.arch} params {sum(p.numel() for p in model.parameters())/1e6:.2f}M device {dev}", flush=True)

    A = torch.tensor(P["a"], device=dev)
    ANG = torch.tensor(P["ang"], device=dev)
    tr = P["tr"]
    w_lat = torch.tensor(w_lat_np, device=dev, dtype=torch.float32)[None, None, None, :, None]
    t2m_unit = float(1.0 / P["std"][0])          # 1 K expressed in normalised t2m-anomaly units
    log, ep_global = [], 0

    for (K, epochs), lr in zip(stages, lrs):
        opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.05)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=epochs * args.steps_per_epoch, pct_start=0.1)
        T = A.shape[0]
        idx = np.arange(T_IN - 1, T - K)
        idx = idx[tr[idx - (T_IN - 1)] & tr[idx + K]]
        lam = torch.ones(K, device=dev)
        for k in (1, 4, 8):
            if k <= K:
                lam[k - 1] = 2.0
        wk = (lam[:, None] / REF[:K])[None, :, :, None, None]                     # [1,K,6,1,1]
        kk = torch.arange(1, K + 1, device=dev)
        for _ in range(epochs):
            model.train(); t0 = time.time(); losses = []
            for _s in range(args.steps_per_epoch):
                tb = torch.tensor(np.random.choice(idx, args.batch), device=dev)
                hist = torch.stack([A[tb - 2], A[tb - 1], A[tb]], 1)
                target = torch.stack([A[tb + k + 1] for k in range(K)], 1)
                if args.t2m_shift > 0:
                    sh = (torch.rand(len(tb), device=dev) * 2 - 1) * args.t2m_shift * t2m_unit
                    hist = hist.clone(); target = target.clone()
                    hist[:, :, 0] += sh[:, None, None, None]; target[:, :, 0] += sh[:, None, None, None]
                if K == 1 and args.noise > 0:
                    hist = hist + args.noise * torch.randn_like(hist)
                pred = model.rollout_anom(hist, ANG[tb], K)
                w = (w_lat * wk).expand_as(target).clone()
                if args.heavy_weight > 0:                     # up-weight cells whose TRUE rain exceeds 10 mm/day
                    angs = ANG[tb][:, None] + 2 * math.pi * kk[None] / 365.0
                    clim_tp = model.clim(angs.reshape(-1))[:, TP].reshape(len(tb), K, 32, 36)
                    tp_true = torch.expm1(target[:, :, TP] * model.std[TP] + clim_tp)
                    w[:, :, TP] *= 1 + args.heavy_weight * (tp_true > 10.0).float()
                loss = (w * (pred - target) ** 2).mean()
                opt.zero_grad(set_to_none=True)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step(); sched.step()
                with torch.no_grad():
                    for pe, pm in zip(ema.parameters(), model.parameters()):
                        pe.mul_(args.ema).add_(pm.detach(), alpha=1 - args.ema)
                losses.append(loss.item())
            ep_global += 1
            msg = {"K": K, "epoch": ep_global, "loss": round(float(np.mean(losses)), 5), "sec": round(time.time() - t0, 1)}
            log.append(msg); print(json.dumps(msg), flush=True)
        save(ema, args, log, args.out)                                   # EMA weights = the model we ship
        save(model, args, log, str(args.out).replace(".pt", "_raw.pt"))
        ema.load_state_dict(model.state_dict())                          # objective changes between stages
    print("saved", args.out)


if __name__ == "__main__":
    main()
