// One store: signals for UI state, plain async actions for model calls. Rollouts stay Float32Arrays (never proxied).
import { signal, computed, batch } from '@preact/signals';
import { Api } from '@lib/api.js';
import { flatten, NCH, NCELL, NLAT, NLON, lat, lon, STD, rIdx, stepsOf } from '@lib/util.js';
import { boxFromLatLon, buildPerturbation, ripple, maxAbsDiff } from '@lib/shock.js';
import { SCENARIOS, CUSTOM_WHAT, REGIONS, LANDING, computeImpact, headline, figures, shownPct } from './lib/narrative.js';
import { VARS, varIndex, bundleFields } from './lib/fields.js';
import { kharif } from '@lib/impact.js';

export const params = new URLSearchParams(location.search);
function defaultServer() {
  const q = params.get('server');
  if (q === 'api') return `${location.origin}/api`;
  if (q) return q;
  try { const s = localStorage.getItem('mm_server'); if (s) return s; } catch (e) { /* storage unavailable */ }
  return `${location.origin}/api`;
}
export const api = new Api(defaultServer());
const BASE = '../'; // assets and samples live next to v2/

export const health = signal('connecting');          // connecting | ready | loading | down
export const assets = signal(null);
export const outlines = signal(null);
export const samples = signal([]);
export const sample = signal(null);                  // {file, name, date_label, init, doy}
export const bundle = signal(null);                  // {id, prime, mv, cache}
export const result = signal(null);                  // what-if outcome (see runWhatIf)
export const mode = signal('normal');                // normal | whatif | diff
export const varKey = signal('tp');
export const day = signal(1);
export const total = signal(false);                 // true: the map shows the 10-day total (rain) / 10-day mean (others), not one day
export const playing = signal(false);
export const busy = signal(0);
export const busyText = signal('');
export const error = signal(null);                   // {msg, details}
export const speedMs = signal(null);
export const nullTest = signal(null);                // {state: running|ok|fail, at, m}
export const place = signal(null);                   // {lat, lon, i, j, name}
export const sideTab = signal('states');
export const introOpen = signal(true);
export const tour = signal(null);                    // null | step index
export const drawer = signal(null);                  // null | tab id
export const customOpen = signal(false);
export const customFresh = signal(false);           // builder opened since the last custom run: old result is hidden
export const custom = signal({ what: 1, amt: CUSTOM_WHAT[1].def, where: 'raj' });
export const drawBox = signal(null);
export const hoverTip = signal(null);
export const pickState = signal(null);
export const mapReady = signal(0);
export const pending = signal(null);                 // scenario id being run (progress rule)
export const varIdx = computed(() => varIndex(varKey.value));
export const fields = computed(() => bundleFields(bundle.value, varIdx.value));

let runId = 0, nextBundle = 1, timer = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function busyOn(txt) { busy.value++; if (txt) busyText.value = txt; }
function busyOff() { busy.value = Math.max(0, busy.value - 1); }
export function setError(msg, details) { error.value = msg ? { msg, details: details || '' } : null; }
const ENGINE_DOWN = "The forecast engine isn't running. Ask the presenter to start it.";

let healthFails = 0;
export async function checkHealth() {
  const h = await api.health();
  // a busy server can miss one poll; only call it down after two misses in a row
  if (!h.ok && health.value === 'ready' && ++healthFails < 2) return true;
  if (h.ok) healthFails = 0;
  health.value = h.ok ? 'ready' : h.status === 'loading' ? 'loading' : 'down';
  if (!h.ok) nullTest.value = null; // a stopped model has not been tested
  if (h.ok) { if (error.value && error.value.engine) setError(null); }
  else if (!error.value || !error.value.engine) error.value = { msg: ENGINE_DOWN, details: `Tried ${api.url}. Start it with: python serve.py, then press Retry.`, engine: true };
  return h.ok;
}
export function retry(url) {
  if (url) { api.base = url; try { localStorage.setItem('mm_server', api.url); } catch (e) { /* ignore */ } }
  return checkHealth().then(async (ok) => { if (ok && sample.value) await (result.value ? runWhatIf(result.value.sc) : runBase()); });
}

// ---------- samples ----------
export async function loadSample(file, auto) {
  const js = await (await fetch(BASE + 'samples/' + file)).json();
  const meta = samples.value.find((s) => s.file === file) || {};
  playing.value = false; clearTimeout(timer);
  batch(() => { sample.value = { file, name: js.name, date_label: meta.date_label || js.date_label, init: flatten(js.init_states), doy: js.doy_sincos.map(Number) }; bundle.value = null; result.value = null; day.value = 1; total.value = false; mode.value = 'normal'; nullTest.value = null; place.value = null; drawBox.value = null; });
  if (health.value !== 'ready') return;
  if (auto) return runWhatIf(typeof auto === 'string' ? SCENARIOS.find((s) => s.id === auto) : auto);
  return runBase();
}
export async function runBase() {
  const sm = sample.value; if (!sm) return;
  const id = ++runId; busyOn('Running the forecast…');
  try {
    const r = await api.run(sm.init, sm.doy, null); if (id !== runId) return;
    batch(() => { bundle.value = { id: nextBundle++, prime: r.roll, mv: null, cache: {} }; result.value = null; speedMs.value = r.ms; mode.value = 'normal'; setError(null); });
    ensureNull();
  } catch (e) { setError(ENGINE_DOWN, e.message); } finally { busyOff(); }
}

// ---------- what-if ----------
const scaled = (p, f) => Float32Array.from(p, (x) => x * f);
export async function runWhatIf(sc, opts = {}) {
  const sm = sample.value; if (!sm || !sc) return;
  if (health.value !== 'ready') return setError(ENGINE_DOWN, `Tried ${api.url}.`);
  const last = sm.init.subarray(2 * NCH * NCELL), box = boxFromLatLon(...(sc.box0 || sc.box)), { pert, clamped } = buildPerturbation(last, box, sc.comps);
  const id = ++runId; pending.value = sc.id; busyOn('Running the forecast twice: normal and what-if…');
  try {
    const [base, shk] = await Promise.all([api.run(sm.init, sm.doy, null), api.run(sm.init, sm.doy, pert)]);
    if (id !== runId) return;
    if (shk.roll.some((x) => !Number.isFinite(x))) throw new Error('The model returned invalid numbers for this what-if.');
    const imp = computeImpact(base.roll, shk.roll, assets.value, sm.doy), hl = headline(imp), figs = figures(imp), rip = ripple(base.roll, shk.roll, box);
    const b = { id: nextBundle++, prime: base.roll, mv: shk.roll, cache: {} };
    // The headline and bars are 10-day rain totals, so the plate shows rain, "Only the change", 10-day total (the tour may change this in its own steps).
    play(false);
    batch(() => {
      bundle.value = b; speedMs.value = base.ms; varKey.value = 'tp'; mode.value = 'diff'; if (!opts.keepDay) { day.value = stepsOf(b.prime); total.value = true; }
      if (sc.id === 'custom') { customOpen.value = false; customFresh.value = false; }
      result.value = { id: b.id, sc, box, pert, imp, hl, figs, rip, ms: shk.ms, clamped, range: null };
      if (!opts.keepPlace) place.value = null; setError(null);
    });
    computeRange(id, b.id, sm, sc, pert, imp, figs);
    ensureNull();
    if (sc.id === 'custom' && !opts.quiet) setTimeout(() => { const el = document.querySelector('[data-tour="result"]'); el && el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60);
  } catch (e) { setError(e.message.includes('invalid') ? e.message : ENGINE_DOWN, e.message); } finally { busyOff(); pending.value = null; }
}
/** Size range: the same change at 0.5x, 1x and 1.5x strength. Reports min/max over all three (so lo <= main <= hi) of the
 *  rain card's state, in the card's own rounding; flags "very uncertain" when the three runs are not in order. Cheap (2 calls). */
async function computeRange(id, bid, sm, sc, pert, imp, figs) {
  if (!figs.farm.id) return;
  try {
    const rs = await Promise.all([0.5, 1.5].map((f) => api.run(sm.init, sm.doy, scaled(pert, f))));
    if (!result.value || result.value.id !== bid) return;
    const pick = (roll) => { const K = kharif(bundle.value.prime, roll, assets.value, sm.doy), row = K.rows.find((r) => r.id === figs.farm.id); return row ? shownPct(row.dRain) : null; };
    const [a, c] = rs.map((r) => pick(r.roll)), m = shownPct(figs.farm.value);
    if (a == null || c == null) return;
    const all = [a, m, c], ordered = (a <= m && m <= c) || (a >= m && m >= c);
    result.value = { ...result.value, range: { lo: Math.min(...all), hi: Math.max(...all), main: m, half: a, onehalf: c, ordered } };
  } catch (e) { /* the range is a bonus; ignore */ }
}

export function customScenario() {
  const c = custom.value, w = CUSTOM_WHAT[c.what], r = REGIONS.find((x) => x.id === c.where);
  if (!c.amt) return { err: 'Move the slider away from zero to change something.' };
  let box0 = r.box;
  if (!box0) { const b = drawBox.value; if (!b) return { err: 'Draw a box on the map or pick a region.' }; box0 = [lat(b.i0), lat(b.i1), lon(b.j0), lon(b.j1)]; }
  const area = r.box ? r.name : 'the area you drew';
  return { sc: { id: 'custom', box0, comps: w.build(c.amt), what: w.text(c.amt), area, lead: `${w.text(c.amt)} over ${area}`, focus: w.focus } };
}

// ---------- null test (live) ----------
let nullBusy = false;
export async function runNull() {
  const sm = sample.value; if (!sm || health.value !== 'ready' || nullBusy) return;
  nullBusy = true; nullTest.value = { state: 'running' };
  try {
    const [a, b] = await Promise.all([api.run(sm.init, sm.doy, null), api.run(sm.init, sm.doy, new Float32Array(NCH * NCELL))]);
    const m = maxAbsDiff(a.roll, b.roll); nullTest.value = { state: m === 0 ? 'ok' : 'fail', m, at: new Date() };
  } catch (e) { nullTest.value = null; } finally { nullBusy = false; }
}
function ensureNull() { if (!nullTest.value) runNull(); }

// ---------- playback ----------
const nDays = () => stepsOf(bundle.value ? bundle.value.prime : new Float32Array(10 * NCH * NCELL));
/** Play days 1..10 (from day 1 if on the total or the last day), then come back to the 10-day total and stop. */
export function play(on) {
  if (on && !bundle.value) return;
  playing.value = on; clearTimeout(timer);
  if (!on) return;
  if (total.value || day.value >= nDays()) setDay(1);
  const tick = () => {
    if (!playing.value) return;
    if (day.value >= nDays()) { batch(() => { playing.value = false; total.value = true; }); return; }
    setDay(day.value + 1); timer = setTimeout(tick, day.value >= nDays() ? 1500 : 800);
  };
  timer = setTimeout(tick, 800);
}
/** Show one day (1..10). A value past the last day selects the 10-day total. */
export function setDay(d) { const n = nDays(); batch(() => { total.value = d > n; day.value = Math.max(1, Math.min(n, d)); }); }
export function setTotal() { batch(() => { day.value = nDays(); total.value = true; }); }
/** Arrow keys: ... day 9, day 10, 10-day total. */
export function stepDay(delta) { if (total.value) { if (delta < 0) setDay(nDays()); } else setDay(day.value + delta); }
export function setMode(m) { if (m === 'normal' || (result.value && bundle.value && bundle.value.mv)) mode.value = m; }

// ---------- boot ----------
export async function boot() {
  const [o, grid, heat, rainClim, idx] = await Promise.all(['assets/outlines.json', 'assets/grid_states.json', 'assets/heat_p95.json', 'assets/rain_clim.json', 'samples/index.json'].map((u) => fetch(BASE + u).then((r) => r.json())));
  batch(() => { outlines.value = o; assets.value = { grid, heat, rainClim }; samples.value = idx; });
  const pdate = params.get('date'), has = (f) => idx.some((s) => s.file === f), file = pdate && has(pdate + '.json') ? pdate + '.json' : has(LANDING.file) ? LANDING.file : idx[0].file;
  let ok = false;
  for (let k = 0; k < 6 && !ok; k++) { ok = await checkHealth(); if (!ok) await wait(500); }
  setInterval(checkHealth, 5000);
  const auto = params.get('auto') === 'none' ? null : params.get('scenario') || LANDING.scenario;
  await loadSample(file, auto);
}
