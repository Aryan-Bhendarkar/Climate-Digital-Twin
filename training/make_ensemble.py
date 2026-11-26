"""Pack several calibrated checkpoints (same recipe, different --seed) into one ensemble weights file.

    python training/make_ensemble.py --out weights/emulator.pt run_seed0.pt run_seed1.pt

monsoon.model.load_emulator detects the ensemble and averages the members' forecasts."""
import argparse

import torch

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("ckpts", nargs="+")
a = ap.parse_args()
members = []
for p in a.ckpts:
    ck = torch.load(p, map_location="cpu", weights_only=False)
    members.append({k: ck[k] for k in ("state_dict", "arch", "width", "depth") if k in ck})
torch.save({"ensemble": members}, a.out)
print("saved", a.out, "members", len(members))
