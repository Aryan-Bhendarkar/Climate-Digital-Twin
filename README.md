# Monsoon Multiverse: an India climate digital twin

**Yugaantar DevForge, Track 2 "Multiverse of Monsoon".**
This is a fast, deterministic, physically-causal emulator of India's daily weather. From the last 3 days of state it rolls the atmosphere forward day by day (**Timeline Prime**). It also branches into **Multiverses** when you inject a localised shock, such as a warmer Bay of Bengal or a stalled monsoon wind, so you can watch the ripple spread across India. An offline dashboard and an impact module turn the branches into consequences for Kharif agriculture and wind power.

```
repo/
├── serve.py              # offline inference server (FastAPI): POST /health, POST /simulate
├── monsoon/model.py      # the emulator (network + climatology + rollout); only module the server imports
├── training/train.py     # full training pipeline (curriculum 1 -> 10-step unrolled)
├── tools/model_adapter.py# in-process adapter used by our evaluation scripts
├── weights/emulator.pt   # trained weights (Git LFS); includes normalisation + climatology coefficients
├── dashboard/            # offline web dashboard + impact module (separate from the server)
└── TRAINING.md           # runbook: train, evaluate, serve
```

## Quick start (offline)
```bash
pip install torch numpy fastapi uvicorn        # runtime deps (torch CPU is enough)
python serve.py --port 8000                     # listens on 0.0.0.0; /health is ready in ~2 s
# dashboard (second terminal)
cd dashboard && python -m http.server 8080      # open http://localhost:8080
```
`/simulate` takes `{"init_states":[3,6,32,36], "doy_sincos":[sin,cos], "steps":10, "perturbation":null|[6,32,36]}` in physical units. It returns `{"rollout":[steps,6,32,36], "inference_ms":...}`. A 10-day rollout takes about 0.3 s on 2 CPU cores.

## How the model works
| Piece | Choice | Why |
|---|---|---|
| State | Anomaly from a smooth seasonal climatology (3 Fourier harmonics per grid cell and variable, fitted on training years, stored as model weights) | The net learns *weather*, not the calendar. At long leads it relaxes toward a sensible seasonal state instead of drifting. There is no per-day lookup table. |
| Rain | Modelled in `log1p` space | Heavy-tailed rain becomes learnable, and rain can never go negative. |
| Step | Predicts the 1-day **tendency** (residual) | The identity path keeps fine structure, which fights blur. A shock on day 0 is carried forward exactly where it was applied. |
| Network | 8 residual blocks, each with exactly **one 3×3 convolution** and per-cell normalisation | Receptive field = **8 grid cells (~900 km) per simulated day**. A perturbation physically *cannot* travel faster than that, so there is no teleporting signal. There is no global attention, FFT or batch-wide statistic. |
| Inputs | Anomalies of the last 3 days, target-day seasonal signal, land–sea mask, orography, day-of-year, lat/lon | Static geography lets the net learn the Western Ghats, the Himalaya and the coastlines. |
| Training | 1-step, then **unrolled 2 → 4 → 8 → 10-day** rollouts with full back-propagation, EMA weights | The model is trained on its own forecasts, so it learns to correct its errors instead of compounding them (anti-drift). |
| Loss | Latitude-weighted MSE per variable and lead, **divided by the error of the best reference** (persistence or climatology), ×2 at days 1/4/8, heavy-rain (>10 mm/day) cells up-weighted | Optimises exactly what matters: beating "repeat yesterday" and climatology, including heavy rain. |
| Robustness | Random ±0.7 K temperature offsets during training | 2023–24 is warmer than the 2005–2021 training period. |
| Determinism | No dropout or noise at inference, deterministic kernels | A zero shock returns a bit-identical forecast. |

## Evaluation (held-out 2019–2021)
We reproduce the official scoring functions locally on two suites: 5 event windows (monsoon onset, Maharashtra heavy rain, North-India heatwave, cyclone Amphan, western disturbance) and 217 windows every 5th day. See `TRAINING.md`. *Numbers are filled in from the final run.*

## Impact module (dashboard)
**Kharif Stress Monitor.** Per state, comparing Prime vs Multiverse:
- 10-day rainfall and its departure, banded IMD-style (Normal ±19 %, Deficient, Large deficient, Excess)
- longest dry spell
- heat-stress days above the state's own monthly 95th percentile (t2m here is a daily mean, so absolute IMD max-temperature thresholds don't apply)
- an overall stress tier

There is also a **wind-power index** for the six major wind states (10 m wind → hub height by a 1/7 power law, generic 3/12/25 m/s turbine curve). Every number is computed live from our own `/simulate` output.

## Limitations (honest)
- 1° daily grid, 6 surface variables: no SST, no upper air, no boundary inflow from outside the box. The edges are the least reliable.
- Day 8–10 skill is mostly "do not be worse than climatology". Weather predictability at this resolution is short.
- Rain is the hardest variable. Heavy-rain placement errors of 1–2 cells are common.
- Shock responses are learned statistical associations, not a physics solver. A shock larger than anything seen in 2005–2021 is extrapolation.
- State boundaries in the dashboard are Natural Earth (public domain), indicative only.

## Data & originality
Trained only on the organiser-provided `india_climate_train.nc` (2005–2021). Nothing is downloaded at run time. All code, training and weights were built during the hackathon.
