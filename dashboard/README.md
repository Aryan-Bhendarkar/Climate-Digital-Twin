# Monsoon Multiverse — dashboard

An AI twin of India's weather: see the next 10 days, then ask "what if?". Pure static HTML + ES modules + Canvas 2D:
no build step, no npm, no CDN, no fonts or map tiles from the internet, **zero external requests**.
Every number on screen comes from live calls to the model server (`js/api.js`; Normal and What-if forecasts run in parallel);
only the 3-day *input* states in `samples/` and geography/climate statistics in `assets/` are shipped. The map pictures and town list add about 2 MB; the second UI (below) ships pre-built in `v2/`.

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

## The guided view (default)

"Forkline": one 3D relief map, one panel, and a timeline that forks. Upright type is **Timeline Prime**, italic is the
**Multiverse**. The large line over the map is the question being answered ("What if the air over the Bay of Bengal
were 3 °C warmer...?"). Dark ground, parchment type, colour only for weather. Fonts (Newsreader, IBM Plex Sans, SIL OFL)
are bundled in `fonts/`; the design lives in `css/app.css`.

**Take the tour** walks through six live steps: Prime, a Multiverse, Compare, the place felt most, the bounded spread
and the live checks. The address bar holds the start date and scenario (`#from=onset&sc=bob`, or
`sc=mix&v=t2m:2&box=...`), so a link reopens the same scenario, computed again live.

### The map and the timeline

| Action | How |
|---|---|
| Move, zoom | Drag (a flick carries on, and the edges resist gently); mouse wheel or pinch; `+` / `-`; double-click zooms in |
| Turn, tilt | Right-drag or Shift-drag; two-finger twist; `Q` / `E`; "look straight down" button |
| Open a place | Click a city or state, a list row or a pin, or press `/` and type. The camera flies in and the panel shows the size of its change, ten-day charts (grey Prime, coloured Multiverse) and what influences it. `Esc` returns. |
| The fork | Prime runs straight; the Multiverse leaves it at day 0 and rises with the number of cities beyond the changed area that feel the change that day (`js/fork.js`). Its texture is the certainty: solid (days 1 to 3), dashed (4 to 7), dotted (8 to 10, or beyond the model's range). Drag it or use the arrow keys; Space plays. With a place open it shows that place's own difference. |
| Views | **Change** (Multiverse minus Prime), **Prime**, **Multiverse**, **Compare** (both on one map, either side of a divider you drag) |
| Layers | **Satellite** (wind, rain and cloud from the forecast moving over the land) and five variables. In Change, temperature, rain and wind are printed in three steps (the Low, Medium and High watch levels) with a pale line around everywhere that has reached Low so far; **Smooth** shows the continuous difference instead. |

The change picture is drawn from the model: day 0 is the change you made, later days are Multiverse minus Prime
(`js/impact-view.js`). Palettes: temperature Crameri *vik* (doi:10.5281/zenodo.1243862), rain ColorBrewer BrBG browns with a
blue wet side, wind green to plum. Nothing below the Low level is drawn. The imagery greys a little under the data and the
data thins out when zoomed close. The relief rising on load, the lighting, the baked terrain shadows and the plinth are
presentation, not data.

What is data and what is decoration:
* Elevation is NOAA ETOPO 2022 at 12 samples per degree, **strongly exaggerated**. Ground and sea colours are NASA's
  Blue Marble imagery for **July**, whatever the date on screen, brightened and tinted. Water ripples, shoreline
  and soil layers are decoration. Neither picture is used by the model, which has its own 1-degree orography.
* The little towns that appear when zoomed in (`js/city-models.js`) are **illustrations**: size follows the town's
  population group and the layout is generated from its name. No building data is used.
* Coastlines and borders are Natural Earth. Towns are about 7,100 places from GeoNames (`assets/places.json`); the
  38 cities in the lists are in `js/cities.js`. More towns are named as you zoom in. A town shows the values of its
  1-degree square (about 110 km), so hills and coasts inside it are averaged out (a hill station reads as warm as
  the plains around it).
* Wind direction, where it rains and where cloud gathers follow the forecast; particle speed and count are scaled for
  visibility. "Cloud" is drawn from rain and water vapour: the model has no cloud variable.

It needs WebGL2 (no libraries, no downloads). Without it, or with `?flat=1`, the flat 2D map is used.
Reduced-motion settings stop the animation and camera flights.

### The panel

| Tab | What the viewer sees and does |
|---|---|
| **What if** | Pick the day to start from, then a **Common** or **Extreme** change, or **Build your own** (temperature, humidity, wind, pressure and start-day rain together, over a named or dragged area). **Strength** (0.25x to 3x) reruns it and warns when it leaves the believable range; **Remove change** goes back to Prime. The answer follows: a headline about what is felt beyond the changed area (it names only places that peak by day 7 and share kind, direction and certainty), **Who feels it** (38 cities or states with High / Medium / Low watch levels, beyond the change first, with when, how long, a 10-day strip and **Firm** (peak on days 1 to 3) / **Rough** (4 to 7) / **Direction only** (8 to 10, beyond the model's range, or at least twice the High level)), farming, heat and wind-power figures, **Why this happens** (each part of the change run alone) and how to read it. |
| **Influence** | Complete the sentence: which areas move a place's rain, temperature or wind when changed. The model runs once per 4x4-cell square (72 live runs) and the map fills in. Any result can be used as a scenario. |
| **Proof** | Held-out forecast skill (day 1, 4, 8), the time one 10-day forecast takes on this computer and a live count of requests that left it, then seven live checks on the current scenario (they start when the tab opens), a random scenario, the per-day spread chart and pasted JSON. |

**Trace spread** animates the change from day 0 inside a dashed line marking the furthest it can reach
(8 cells, about 900 km, per day). The line covers the whole map after about 3 days.

Watch levels (`js/insights.js`, biggest of the three per day, scenario minus normal):

| | Low | Medium | High |
|---|---|---|---|
| Rain (mm/day) | 1 | 5 | 15 |
| Temperature (deg C) | 0.5 | 1.5 | 3 |
| Wind (km/h) | 3 | 8 | 15 |

They are **not weather warnings**: thresholds are our own, for comparing scenarios. Cities take the value of their
1-degree grid square, so neighbouring towns get identical numbers. The extreme-event cards are idealised starting pushes;
in our tests the model fades an injected storm within a few days rather than moving it.

Notes on the plain-language numbers
* Headline and cards ignore the two tiny groups "Islands" and "Small UTs" (not farming regions); the Expert tables still list them.
* "Hot days" = days a state's mean temperature exceeds the usual hottest 5 % (P95) for that month (`assets/heat_p95.json`).
* Wind power = capacity-factor proxy of a generic turbine for the 6 windiest states; only the change is meaningful.
* The Proof tab's skill numbers (+32 %, +7 %, -1 % on days 1, 4, 8 against the better of persistence and climatology) are fixed text from the validation ensemble that held out 2019-21 (root README); the submitted model was then retrained on all years.
* The 900 km figure is the architecture limit (8 grid cells of 1 degree per day), not a measurement.
* Rainfall and humidity difference maps use brown (less) / green (more) because blue-for-drier is confusing next to rain maps; temperature, wind and pressure use blue (less) / red (more).

Logic tests (needs Node 22+): `node --test dashboard/tests/*.test.mjs`

## Expert view

The **Expert view** button (top right) opens the original scientist dashboard unchanged: three synced maps (Timeline Prime, Multiverse, Δ),
ripple chart, cell series, Kharif Stress Monitor, Wind-power index, shock painter, null-shock check. **Back to the map** (top right there) returns.
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
index.html  css/app.css (guided view)  css/style.css (Expert view; same dark palette)  fonts/ (bundled, OFL)
js/  story.js (guided view, default)  stage.js (map + animation)  ui-places.js  ui-causes.js  ui-influence.js  ui-judge.js
     insights.js  scenarios.js  cities.js (pure logic + data)  main.js (Expert view, loaded on demand)
     map3d.js  terrain-gl.js  weather-fx.js  city-models.js  impact-view.js  world.js (camera maths)  geo.js  places.js
     ui-explore.js  theme.js  tour.js  fork.js (the forking timeline)
     api.js  render.js (flat canvas maps)  chart.js (own line chart)  colormaps.js  shock.js  impact.js  util.js
tests/ logic.test.mjs  map.test.mjs  impact.test.mjs
assets/  outlines.json  grid_states.json  heat_p95.json  rain_clim.json  places.json  elevation.png  land.jpg
samples/ *.json (5 demo initial conditions + index.json)
build_assets.py   offline asset builder (not part of the server)
build_map.py      writes places.json, elevation.png and land.jpg from downloaded sources (not part of the server)
```

## Data sources

Map geography (bundled, no network at run time; rebuild with `build_map.py`, whose header lists the exact files):
* **Places:** [GeoNames](https://www.geonames.org) cities1000, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
  filtered to India, neighbourhoods and abandoned places removed.
* **Imagery:** NASA Earth Observatory, Blue Marble Next Generation with topography and bathymetry, July 2004, cropped.
* **Elevation:** NOAA National Centers for Environmental Information, ETOPO 2022 15 Arc-Second Global Relief Model,
  doi:10.25921/fd45-gt74 (60 arc-second subset, resampled). Not for navigation.

* State and country boundaries: **Natural Earth** (public domain; admin-1 states/provinces and the India-perspective admin-0 file),
  clipped to lon 65–101 / lat 6–38 and simplified. Boundaries are **indicative only** and carry no legal standing.
* Sample inputs, heat/rain climate statistics: the competition training set (2005–2021), via `build_assets.py`
  (`python build_assets.py --ne <natural-earth-geojson-dir> --nc <india_climate_train.nc>`; needs shapely + xarray; run once, outputs are committed).

## Second UI: "Survey Plate" (`?ui=v2`)

`index.html` shows the 3D map described above. `index.html?ui=v2` opens the "Survey Plate" UI built into `v2/`
(committed output; no npm needed to run it). Sources are in `ui/` (Vite + Preact + signals;
`cd ui && npm ci && npm run build` writes `v2/`).
URL options for it: `?server=api`, `?tour=1`, `?scenario=<id>`, `?auto=none`. Tour scenarios: one constant, `TOUR_SCENARIOS` in `ui/src/tour.js`.
It quotes "34 % lower error than tomorrow = today" on day 1 (`ui/src/lib/config.js`), a fixed number from the same validation ensemble.
Tests (live model through this server): `python3 tests/dashboard_ui/e2e.py` (needs Playwright; axe-core from `ui/node_modules`).
