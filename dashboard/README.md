# Monsoon Multiverse — dashboard

An AI twin of India's weather: see the next 10 days, then ask "what if?". Static files only (the default v3 UI is
pre-built into `v2/` from the sources in `ui/`; the older v1 at `?ui=v1` is plain ES modules): no npm needed to run,
no CDN, fonts vendored, **zero external requests**.
Every number on screen comes from live calls to the model server (`js/api.js`; Normal and What-if forecasts run in parallel);
only the 3-day *input* states in `samples/` and geography/climate statistics in `assets/` are shipped. Shipped size ~1.4 MB (plus ~0.4 MB of UI sources in `ui/`).

## Run

```bash
# terminal 1 – model server (repo root)
python serve.py --port 8000
# terminal 2 – dashboard + API forwarding on one port
python dashboard/devserver.py --port 8080      # add --model http://127.0.0.1:8010 if the model server uses another port
# open http://127.0.0.1:8080/?server=api
```

`?server=api` uses the same-origin forwarder in `devserver.py`; `?server=http://host:port` or the retry box in the red banner
set another address (remembered in localStorage). `?view=expert` opens the Expert view directly.

## Story mode (default): what each step shows

One big India map on the left, three numbered steps on the right.

| Step | What the viewer sees and does |
|---|---|
| **1 The forecast** | Pick a start date in plain words ("28 May 2020 — monsoon arriving in Kerala"), pick what to show (Temperature °C, Rainfall mm/day, Wind km/h, Humidity (water vapour), Pressure hPa), press **Play forecast** or drag the Day 1 … Day 10 slider. The legend is in words ("Redder = hotter"). Hover the map for values. |
| **2 Ask what-if** | Five scenario cards (Bay of Bengal +3 °C, monsoon winds −40 %, Arabian Sea +2.5 °C, dry air over Rajasthan, low pressure over Bengal) and **Draw your own** (what, how much with units and sensible ranges, where: a named region or a box dragged on the map). A click runs the model twice in parallel (normal and what-if); the shocked region is outlined on the map. |
| **3 What changes for India** | The same map switches between **Normal forecast / What-if / Difference** (diverging colours, white = no change). An auto-written headline (from `js/impact.js` logic on the two live rollouts) and three cards: Farmers (Kharif sowing), Heat risk, Wind power. Each has a **details** link that opens the full table in the Expert view. |
| **Why trust it?** | Collapsed strip. Live day-1 local share, the 8-cell/day (~900 km) reach limit, a live null-change test (identical forecast), the validation accuracy gain, and the per-day spread chart with a plain caption. |

Notes on the plain-language numbers
* Headline and cards ignore the two tiny groups "Islands" and "Small UTs" (not farming regions); the Expert tables still list them.
* "Extra hot days" = days a state's mean temperature exceeds the usual hottest 5 % (P95) for that month (`assets/heat_p95.json`).
* Wind power = capacity-factor proxy of a generic turbine for the 6 windiest states; only the change is meaningful.
* "34 % lower error than tomorrow = today" (`ui/src/lib/config.js`) is the day-1 skill of the 3-seed validation ensemble that held out 2019-21 (a fixed number, not computed live); the submitted model was then retrained on all years.
* The 900 km figure is the architecture limit (8 grid cells of 1 degree per day), not a measurement.
* Rainfall and humidity difference maps use brown (less) / green (more) because blue-for-drier is confusing next to rain maps; temperature, wind and pressure use blue (less) / red (more).

## Expert view

The **Expert view** button (top right) opens the original scientist dashboard unchanged: three synced maps (Timeline Prime, Multiverse, Δ),
ripple chart, cell series, Kharif Stress Monitor, Wind-power index, shock painter, null-shock check. **Story mode** (top right there) returns.
Opening it passes the current live rollouts across, so nothing is recomputed. The previous documentation follows.

---

## Expert view: using it

| Action | How |
|---|---|
| Pick scenario | Left panel: 5 demo initial conditions (monsoon onset, heavy rain, heatwave, Cyclone Amphan, western disturbance) or **Load JSON…** (`{"init_states":[3][6][32][36], "doy_sincos":[sin,cos]}`, physical units) |
| Variable / day | Temp (°C), Rain (mm/day), Wind speed (+ arrows), MSLP (hPa), TCWV. Slider or Space (play), ←/→ |
| Shock | Preset (Warm Bay of Bengal, Monsoon stall, Arabian Sea +2.5 °C) or drag a box on any map; add components (variable, magnitude, absolute or %); **Run shock** (Prime and Multiverse run in parallel) |
| Compare | Three synced panels: Timeline Prime · Multiverse · Δ (Multiverse − Prime, diverging scale). Hover = value tooltip, click = cell time series |
| Causality | **Ripple** tab: per-day Δ-energy (Σ_ch (Δ/std)²) inside box+3 cells vs outside, day-1 local share, spread, peak |Δ| in σ |
| Null check | **Null shock check** sends an all-zero perturbation and shows a green badge if it is bit-identical to Prime |
| Impact | **Kharif Stress Monitor** (state table, sortable) and **Wind-power index** tabs, recomputed from the two rollouts on every run |
| Keys | Space play · ←/→ day · 1–5 variable · R run · N null · ? help |

## Impact module definitions (computed in `js/impact.js`)

* State/UT masks: Natural Earth admin-1 polygons rasterised once (5×5 sub-samples per cell) into `assets/grid_states.json`
  (`build_assets.py`). States with < 3 cells of coverage are grouped (NE small states, small UTs, islands).
* **Rain**: 10-day area-weighted (land fraction × cos lat) state-mean total, Prime vs Multiverse; Δ% = (M−P)/max(P, 5 mm), labelled with
  IMD-style departure bands (Normal within ±19%, Deficient −20..−59%, Scanty ≤ −60%, Excess ≥ +20%). This is departure **from Prime**, not from LPA.
* **Dry spell**: longest run of days with state-mean rain < 2.5 mm.
* **Heat-stress days**: days when state-mean daily t2m exceeds the state's monthly P95 of daily-mean t2m over training years 2005–2018
  (`assets/heat_p95.json`, a geography/climate statistic, not forecast data).
* **Stress tier 0–3** = 0.5·rain tier + 0.5·heat tier. Rain tier: departure of the branch's 10-day total from the training-period monthly mean
  (`assets/rain_clim.json`) — Deficient → 2, Scanty → 3 — +1 if the dry spell is ≥ 7 days; heat tier: 0 days → 0, 1–2 → 1, 3–5 → 2, ≥ 6 → 3.
  "N states worsen" counts groups whose Multiverse stress is higher than Prime.
* **Wind index** (GJ, RJ, TN, KA, MH, AP): v100 = |V10|·10^(1/7); generic turbine cut-in 3 / rated 12 / cut-out 25 m/s; capacity-factor proxy
  from daily-mean wind, so only Prime-vs-Multiverse *changes* are meaningful.

Indicative, not forecasts: 1° daily grid, daily-mean temperature (not Tmax), rain is the least skilful variable.

## Layout

```
index.html  css/style.css (expert)  css/story.css (story)
js/  story.js (Story mode, default)  main.js (Expert view, loaded on demand)  api.js  render.js (canvas maps)  chart.js (own line chart)  colormaps.js  shock.js  impact.js  util.js
assets/  outlines.json  grid_states.json  heat_p95.json  rain_clim.json
samples/ *.json (5 demo initial conditions + index.json)
build_assets.py   offline asset builder (not part of the server)
```

## Data sources

* State and country boundaries: **Natural Earth** (public domain; admin-1 states/provinces and the India-perspective admin-0 file),
  clipped to lon 65–101 / lat 6–38 and simplified. Boundaries are **indicative only** and carry no legal standing.
* Sample inputs, heat/rain climate statistics: the competition training set (2005–2021), via `build_assets.py`
  (`python build_assets.py --ne <natural-earth-geojson-dir> --nc <india_climate_train.nc>`; needs shapely + xarray; run once, outputs are committed).

## UI v3 "Survey Plate" (default) and v1

`index.html` now routes to the v3 build in `v2/` (committed output; judges only need Python). The original Story/Expert UI stays at
`index.html?ui=v1` (and `?view=expert`). Sources are in `ui/` (Vite + Preact + signals; `cd ui && npm ci && npm run build` writes `v2/`).
The pure logic modules in `js/` (api, util, impact, shock) are shared by both UIs, so the numbers are identical.
URL options for v3: `?server=api`, `?tour=1`, `?scenario=<id>`, `?auto=none`. Tour scenarios: one constant, `TOUR_SCENARIOS` in `ui/src/tour.js`.
Tests (live model through this server): `python3 tests/dashboard_ui/e2e.py` (needs Playwright; axe-core from `ui/node_modules`).
