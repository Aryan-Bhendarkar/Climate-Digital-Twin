"""Fit the per-lead, per-variable output gain (anomaly shrinkage toward the seasonal climate) on TRAINING years.

For each lead k and variable c, the least-squares optimal scaling of the predicted anomaly:
    g[k,c] = sum(w * a_pred * a_true) / sum(w * a_pred^2)      (latitude-weighted, clipped to [0, 1.2])
Rain is left unscaled by default (see --rain-gain). Long leads get g < 1 because day-to-day weather is only weakly predictable there: the forecast relaxes toward
climatology exactly as much as the data justifies. Only the OUTPUT is scaled; the simulated state is untouched.

  python training/calibrate.py --ckpt weights/val.pt --data ../data/india_climate_train.nc --train-end 2018
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from monsoon.model import MAX_LEAD, T_IN, load_emulator  # noqa: E402
from training.train import prepare  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--train-end", type=int, required=True, help="must match the checkpoint's training years")
    ap.add_argument("--leads", type=int, default=10)
    ap.add_argument("--stride", type=int, default=3)
    ap.add_argument("--out", help="default: overwrite --ckpt")
    ap.add_argument("--rain-gain", choices=["none", "sqrt", "fit"], default="none",
                    help="none: keep rain gain = 1 (best: shrinking rain kills heavy-rain hits and rain variance)")
    args = ap.parse_args()

    P = prepare(args.data, args.train_end)
    m = load_emulator(args.ckpt)
    A, ANG, tr = torch.tensor(P["a"]), torch.tensor(P["ang"]), P["tr"]
    T, K = A.shape[0], args.leads
    idx = np.arange(T_IN - 1, T - K, args.stride)
    idx = idx[tr[idx - (T_IN - 1)] & tr[idx + K]]
    w = np.cos(np.deg2rad(P["lat"])); w = torch.tensor(w / w.mean(), dtype=torch.float32)[None, None, None, :, None]
    num = torch.zeros(K, 6); den = torch.zeros(K, 6)
    with torch.inference_mode():
        for b in range(0, len(idx), 64):
            tb = torch.tensor(idx[b:b + 64])
            hist = torch.stack([A[tb - 2], A[tb - 1], A[tb]], 1)
            pred = m.rollout_anom(hist, ANG[tb], K)
            true = torch.stack([A[tb + k + 1] for k in range(K)], 1)
            num += (w * pred * true).sum(dim=(0, 3, 4)); den += (w * pred * pred).sum(dim=(0, 3, 4))
    g = (num / den.clamp_min(1e-9)).clamp(0.0, 1.2)
    if args.rain_gain == "none":
        g[:, 1] = 1.0
    elif args.rain_gain == "sqrt":
        g[:, 1] = g[:, 1].sqrt()
    gain = torch.ones(MAX_LEAD, 6)
    gain[:K] = g
    gain[K:] = g[-1]                                   # beyond the fitted range keep the last lead's shrinkage
    m.gain.copy_(gain)
    ck = torch.load(args.ckpt, map_location="cpu", weights_only=False)
    ck["state_dict"] = m.state_dict()
    ck["calibration"] = {"windows": int(len(idx)), "train_end": args.train_end}
    torch.save(ck, args.out or args.ckpt)
    np.set_printoptions(precision=3, suppress=True)
    print("gain[lead, channel] (t2m, tp, u10, v10, msl, tcwv):\n", g.numpy())
    print("saved", args.out or args.ckpt)


if __name__ == "__main__":
    main()
