# Training & evaluation runbook

All commands from the repo root. Data lives OUTSIDE the repo (`../data/`), never commit it.

## 0. Environment
```bash
pip install torch xarray netCDF4 numpy scipy pandas fastapi uvicorn
```

## 1. Validation run (train 2005–2018, hold out 2019–2021)
```bash
python training/train.py --data ../data/india_climate_train.nc --train-end 2018 --out weights/val.pt --device cuda
```
Script defaults: arch `local` (width 96, depth 8, reach exactly 8 cells/day), stages `1:40,2:10,4:10,8:12,10:4`.
**The submitted weights stop after the 4-day stage** (`--stages 1:40,2:10,4:10 --lrs 1e-3,3e-4,2e-4`), three seeds (0, 1, 2), packed with `training/make_ensemble.py`. See README → "Reproduce the submitted weights".
With the default (longer) stages this takes ~1–1.5 h on a laptop GPU; the submitted 3-stage recipe takes ~45 min per seed on a T4. `weights/val.pt` = EMA weights, `weights/val_raw.pt` = raw.

## 1b. Calibrate (per-lead output shrinkage toward climatology, fit on the SAME training years)
```bash
python training/calibrate.py --ckpt weights/val.pt --data ../data/india_climate_train.nc --train-end 2018
```
Rain is left unscaled by default (`--rain-gain none`): shrinking rain kills heavy-rain hits. On v1 this took named5
from 58.7 -> 67.7 (lenient) and 37.9 -> 48.2 (strict).

## 2. Grade it (the loop that decides everything)
```bash
# Windows PowerShell:  $env:MONSOON_WEIGHTS="weights/val.pt"
# our grader lives outside this repo (../devtools/local_grade.py: a local copy of monsoon_r1 scoring + window lists)
MONSOON_WEIGHTS=weights/val.pt python ../devtools/local_grade.py --model tools.model_adapter:simulate --suite both
```
Read BOTH the main and the "alt aggregation (per-lead best ref, pessimistic)" rows. We plan for the pessimistic one.
Log the numbers in your own notes (our decision log is not part of the repo).

## 3. A/B ideas (one change at a time, same seed)
- `--arch unet --width 48` (bigger reach) vs `local`
- `--width 128 --depth 10` (note: depth = reach in cells/day; keep <= 8 for guaranteed no-teleport)
- `--heavy-weight 0 / 2 / 5` (rain CSI vs RMSE)
- `--t2m-shift 0 / 0.7`
- `--stages 1:40,2:10,4:10,8:20,10:8` (more long-rollout training if day-8 skill < 0)

## 4. Final model (all years 2005–2021, same recipe as the best validation run)
```bash
for s in 0 1 2; do
  python training/train.py --data ../data/india_climate_train.nc --train-end 2021 --width 96 --depth 8 \
      --stages 1:40,2:10,4:10 --lrs 1e-3,3e-4,2e-4 --seed $s --out runs/seed$s.pt --device cuda
  python training/calibrate.py --ckpt runs/seed$s.pt --data ../data/india_climate_train.nc --train-end 2021 --stride 4
done
python training/make_ensemble.py --out weights/emulator.pt runs/seed0.pt runs/seed1.pt runs/seed2.pt
```
(Identical to README → "Reproduce the submitted weights".)

## 5. Serve + official checks
```bash
python serve.py --port 8000
python -m monsoon_r1.schema_validator http://localhost:8000          # pip install ../data/monsoon_r1_kit-1.0.0-py3-none-any.whl
python ../devtools/local_grade.py --url http://localhost:8000 --suite named5   # external grader, see §2
python -c "from monsoon_r1.repo_scan import scan; import json; print(json.dumps(scan('.'), indent=1))"
```

## Kaggle (backup GPU)
Upload `india_climate_train.nc` as a private dataset, push this repo (or zip `monsoon/` + `training/`), then in a GPU notebook:
```bash
!python training/train.py --data /kaggle/input/<dataset>/india_climate_train.nc --train-end 2018 --out /kaggle/working/val.pt --device cuda
```
