# Monsoon Multiverse: an India climate digital twin

**Yugaantar DevForge, Track 2 "Multiverse of Monsoon".**
This is a fast, deterministic emulator of India's daily weather whose shock responses are local and travel at a bounded speed. From the last 3 days of state it rolls the atmosphere forward day by day (**Timeline Prime**). It also branches into **Multiverses** when you inject a localised shock, such as a warmer Bay of Bengal or a stalled monsoon wind, so you can watch the ripple spread across India. An offline dashboard and an impact module turn the branches into consequences for Kharif agriculture and wind power.

```
repo/
├── serve.py              # offline inference server (FastAPI): POST /health, POST /simulate
├── monsoon/model.py      # the emulator (network + climatology + rollout); only module the server imports
├── training/train.py     # training pipeline (1-step, then unrolled multi-day curriculum)
├── training/calibrate.py # per-lead output calibration (fit on training years)
├── training/make_ensemble.py # packs calibrated seed runs into one weights file
├── tools/model_adapter.py# in-process adapter used by our evaluation scripts
├── weights/emulator.pt   # trained weights (plain ~18 MB file, 3 seed members); includes normalisation, climatology + calibration
├── dashboard/            # offline web dashboard + impact module (separate from the server)
├── TRAINING.md           # runbook: train, evaluate, serve
└── docs/Monsoon_Multiverse_Brief.pdf  # the 2-page project brief
```

## Quick start (offline)
```bash
pip install torch numpy fastapi uvicorn        # runtime deps (torch CPU is enough)
python serve.py --port 8000                     # listens on 0.0.0.0; /health is ready in ~4 s
# dashboard (second terminal): serves the page and forwards /api/* to the model server on one port
cd dashboard && python devserver.py             # open http://127.0.0.1:8080/?server=api
```
Self-check (no data needed): `python tests/test_contract.py` (determinism, null shock, 8-cell/day reach, output guards).
`/simulate` takes `{"init_states":[3,6,32,36], "doy_sincos":[sin,cos], "steps":10, "perturbation":null|[6,32,36]}` in physical units. It returns `{"rollout":[steps,6,32,36], "inference_ms":...}`. A 10-day rollout takes about 0.5–1 s on 4 CPU cores (three ensemble members run side by side, each on one core).

**Tested like the judging sandbox:** fresh clone, clean Python 3.12 with only torch (CPU), numpy, fastapi and uvicorn, network switched off, 4 cores: the kit's schema validator passes, `/health` is ready in ~4 s, `/simulate` takes ~0.6 s for 10 days (~1.5 s for 30), peak memory ~0.85 GB.

## How the model works
| Piece | Choice | Why |
|---|---|---|
| State | Anomaly from a smooth seasonal climatology (3 Fourier harmonics per grid cell and variable, fitted on training years, stored as model weights) | The net learns *weather*, not the calendar. At long leads it relaxes toward a sensible seasonal state instead of drifting. There is no per-day lookup table. |
| Rain | Modelled in `log1p` space | Heavy-tailed rain becomes learnable. Output guards keep rain ≥ 0, water vapour ≥ 0 and 2 m temperature inside 233–333 K (the contract's validity range; never reached in normal rollouts). |
| Step | Predicts the 1-day **tendency** (residual) | The identity path keeps fine structure, which fights blur, and a shock's day-1 response starts exactly where it was applied. |
| Network | 8 residual blocks (width 96), each with exactly **one 3×3 convolution** and per-cell normalisation (~1.5 M parameters per member) | Receptive field = **8 grid cells per simulated day in any direction** (~900 km north–south or east–west, up to ~1,250 km diagonally): a hard upper bound by construction, so a shock can never jump across the map (measured response beyond that radius: exactly 0). Real responses spread more slowly. There is no global attention, FFT or batch-wide statistic. |
| Inputs | Anomalies of the last 3 days, target-day seasonal signal, land–sea mask, orography, day-of-year, lat/lon | Static geography lets the net learn the Western Ghats, the Himalaya and the coastlines. |
| Training | 1-step, then **unrolled 2 → 4-day** rollouts with full back-propagation, EMA weights | The model is trained on its own forecasts, so it learns to correct its errors instead of compounding them (anti-drift). Going on to 8–10-day rollouts fit the training years better but scored worse on held-out years, so we stop at 4. |
| Calibration | One least-squares gain per lead and variable on the output anomaly (~50 numbers, fit on training years). Rain is not scaled. | Long leads shrink toward the seasonal climate exactly as much as the training data supports (like MOS post-processing). |
| Loss | Latitude-weighted MSE per variable and lead, **divided by the error of the best reference** (persistence or climatology), ×2 at days 1/4/8, heavy-rain (>10 mm/day) cells up-weighted | Optimises exactly what matters: beating "repeat yesterday" and climatology, including heavy rain. |
| Robustness | Random ±0.7 K temperature offsets during training | 2023–24 is warmer than the 2005–2021 training period. |
| Ensemble | Three copies of the same recipe trained with different random seeds; the server averages their forecasts | Averaging cancels part of each copy's own errors and steadies the size of shock responses: on held-out years 3 copies scored +4 (5 named windows) to ~+8 (217 windows) points (strict) over the best single copy. Every copy is local and deterministic, so the average is too. |
| Determinism | No dropout or noise at inference, deterministic kernels | A zero shock returns a bit-identical forecast. |

## Evaluation (held-out 2019–2021)
**Protocol.** The same recipe was trained on 2005–2018 only and tested on 2019–2021, which it never trained on (recipe choices such as rollout length and ensemble size were selected on these years, so the numbers are mildly optimistic), using a local copy of the organisers' published scoring functions. The submitted weights use that same recipe retrained on all of 2005–2021, so they cannot be scored on 2019–21 themselves. The hidden 2023–24 windows are the real test.

Skill = 1 − RMSE / RMSE of the better reference (persistence or day-of-year climatology), chosen **per lead day** (the strict reading), latitude-weighted, computed per window and averaged over 217 windows (every 5th day of 2019–21) and the 6 variables, as the organisers' scoring functions do:

| Lead | Skill vs better reference | Skill vs persistence ("tomorrow = today") |
|---|---|---|
| Day 1 | **+0.32** | +0.34 |
| Day 4 | **+0.07** | +0.26 |
| Day 8 | −0.01 (level with climatology) | +0.24 |

(Pooling the RMSE over all windows before taking the ratio gives +0.36 / +0.13 / +0.03.)

- Heavy-rain (>10 mm/day) CSI, mean over the scored leads: 0.29, against 0.19 for persistence and 0.16 for climatology.
- Day-8 spatial variance stays at 0.71–1.00 of the truth per variable over 217 windows (0.53–1.03 on the 5 named windows; single windows can dip to ~0.3 for rain), against an anti-blur gate of ≥ 0.40.
- Null shock: bit-identical forecast. Day-1 shock response: ≥ 99 % within 3 cells of the shocked box.
- Our grader totals, out of 70 (automated forecast + blur + causality parts): about 61–67 on the strict reading and 70 on the lenient one (single copies: 51–57 strict on the named windows). How the official grader combines lead days is not published, so we optimised for the stricter reading.

**Reproduce the submitted weights:**
```bash
for s in 0 1 2; do
  python training/train.py --data ../data/india_climate_train.nc --train-end 2021 --width 96 --depth 8 \
      --stages 1:40,2:10,4:10 --lrs 1e-3,3e-4,2e-4 --seed $s --out runs/seed$s.pt --device cuda
  python training/calibrate.py --ckpt runs/seed$s.pt --data ../data/india_climate_train.nc --train-end 2021 --stride 4
done
python training/make_ensemble.py --out weights/emulator.pt runs/seed0.pt runs/seed1.pt runs/seed2.pt
```
Each seed takes about 45 min on one T4 GPU (about 75 min on a 4 GB laptop GPU). Use `--train-end 2018` for the validation model.

## Impact module (dashboard)
**Kharif Stress Monitor.** Per state, comparing Prime vs Multiverse:
- 10-day rainfall change of the what-if vs our own normal forecast, banded with IMD-style thresholds (±19 % normal, −20 to −59 % deficient, ≤ −60 % large deficient, ≥ +20 % excess). Note that IMD's own bands are relative to the long-period average, not to a forecast.
- longest dry spell
- heat-stress days: the state-mean daily-mean temperature above that state's monthly 95th percentile (absolute IMD thresholds need daily maximum temperature, which the data lacks). Meaningful for days 1–3; later the forecast is too smooth to cross the threshold.
- an overall stress tier

There is also a **wind-power index** for the six major wind states (10 m wind → hub height by a 1/7 power law, generic 3/12/25 m/s turbine curve). Every number is computed live from our own `/simulate` output.

## Limitations (honest)
- 1° daily grid, 6 surface variables: no SST, no upper air, no boundary inflow from outside the box. The edges are the least reliable.
- Day 8–10 forecasts are about as good as climatology. The weather part of the forecast is deliberately damped there, so the map keeps its seasonal structure but little day-to-day detail.
- Rain is the hardest variable. Heavy-rain cores are often 1–2 cells off. A strong ocean-warming shock can trigger a large local rain response (> 5 σ in ~5 % of shocked runs on held-out years).
- Shock responses are learned statistical associations, not a physics solver: there is no water or energy conservation. Across 25 start-date × preset what-ifs in the dashboard, 7 responses read as physically plausible, 12 were weak or mixed and 6 had an unexpected sign; strong responses near the shocked box are the most trustworthy, and sizes are hypotheses (single seeds can differ ~3× in magnitude; the 3-seed average is steadier). Wind-only shocks fade within ~3 days. A shock far beyond the 2005–2021 range is extrapolation.
- The impact indicators are scenario-comparison tools on a 1° grid, not validated agricultural advisories.
- State boundaries in the dashboard are Natural Earth (public domain), indicative only.

## Data & originality
Trained only on the organiser-provided `india_climate_train.nc` (2005–2021). Nothing is downloaded at run time. All code, training and weights were built during the hackathon.

Code: MIT (see `LICENSE`). Fonts: SIL OFL (`dashboard/ui/FONTS-LICENSE.txt`). State boundaries: Natural Earth (public domain). Data: organiser-provided, not redistributed.
