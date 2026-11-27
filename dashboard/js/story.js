// Story mode: the guided default view. Pick a day, change something, see who is affected; search; test.
// Every number comes from live calls to the model server (js/api.js); impact numbers reuse js/impact.js and js/insights.js.
import { NCELL, NCH, lat, lon, flatten } from './util.js';
import { Api } from './api.js';
import { boxFromLatLon, buildPerturbation, ripple } from './shock.js';
import { kharif, windIndex } from './impact.js';
import { bboxOf } from './insights.js';
import { PARTS, REGIONS, SCENARIOS, compsFor, describe, amountText, outOfRange, sgn, num } from './scenarios.js';
import { createStage, VARS, still, smooth } from './stage.js';
import { MapPanel } from './render.js';
import { Map3D } from './map3d.js';
import { createExplorer } from './ui-explore.js';
import { slidingThumbs } from './theme.js';
import { mapPlaces } from './places.js';
import { createPlaces } from './ui-places.js';
import { createCauses } from './ui-causes.js';
import { createInfluence } from './ui-influence.js';
import { createJudge } from './ui-judge.js';
import { createTour } from './tour.js';
import { createFork } from './fork.js';

const $ = (id) => document.getElementById(id);

// ---------- start dates in plain words ----------
const DATE_WORDS = {
  'onset.json': 'monsoon onset', 'heavy_rain.json': 'heavy rain', 'heatwave.json': 'heatwave',
  'cyclone.json': 'Cyclone Amphan', 'western_disturbance.json': 'winter storm',
};

// ---------- state ----------
function defaultServer() {
  const q = new URLSearchParams(location.search).get('server');
  if (q === 'api') return `${location.origin}/api`;
  if (q) return q;
  try { const s = localStorage.getItem('mm_server'); if (s) return s; } catch (e) { /* storage unavailable */ }
  return 'http://127.0.0.1:8000';
}
const S = {
  api: new Api(defaultServer()), assets: null, samples: [], file: null, name: '', init: null, doy: null,
  prime: null, mv: null, msP: null, msM: null, mvInit: null, pert: null, sc: null, box: null, comps: [], rip: null, K: null, W: null, shock: null,
  v: 0, ik: 'rain', split: 0.4, layer: 'land', focus: '1', smooth: false, land: true, glow: false, motion: true, day: 1, mode: 'normal', tab: 'ask', group: 'everyday', strength: 1, drawn: null, playing: false, timer: null, healthy: false, busy: 0, runId: 0,
};
window.__story = S;
const app = { S };

/** What the chosen layer and view mean for the map: satellite weather, the stepped change, or one smooth field. */
function applyView() {
  if (S.layer === 'land' && app.map && !app.map.glCanvas) S.layer = S.focus; // the flat map has no satellite picture
  const v = S.layer === 'land' ? null : +S.layer;
  if (v !== null) S.v = v;
  const stepped = v !== null && v <= 2 && !!S.mv && S.mode === 'diff' && !S.smooth;
  if (v === null) { S.land = true; S.glow = false; if (S.mode === 'diff' || S.mode === 'split') S.mode = S.mv ? 'whatif' : 'normal'; }
  else { S.land = stepped && !!app.map?.glCanvas; S.glow = S.land; if (stepped) S.ik = ['temp', 'rain', 'wind'][v]; }
}

// ---------- impact: headline + cards (logic from impact.js) ----------
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const wsum = (W, k) => W.reduce((a, w) => a + w[k], 0) / (W.length || 1);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const SKIP = new Set(['ISL', 'UT']); // tiny island/UT groups: not farming regions, would dominate headlines
function filterK(K) { const rows = K.rows.filter((r) => !SKIP.has(r.id)); return { ...K, rows, worse: rows.filter((r) => r.dStress > 0).length, better: rows.filter((r) => r.dStress < 0).length }; }
function computeImpact() {
  const K = filterK(kharif(S.prime, S.mv, S.assets, S.doy)), W = windIndex(S.prime, S.mv, S.assets);
  const rain = K.rows.filter((r) => Math.abs(r.dRain) >= 10).sort((a, b) => Math.abs(b.dRain) - Math.abs(a.dRain));
  const heat = K.rows.map((r) => ({ r, d: r.m.heat - r.p.heat })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const wsumP = W.reduce((a, w) => a + w.pMean, 0), wsumM = W.reduce((a, w) => a + w.mMean, 0), wAll = wsumP > 0.01 ? ((wsumM - wsumP) / wsumP) * 100 : 0;
  const wTop = [...W].sort((a, b) => Math.abs(b.dPct) - Math.abs(a.dPct))[0];
  S.K = K; S.W = W; S.impact = { rain, heat, wAll, wTop };
}
const whatText = (sc) => (sc.pert ? 'the pasted change' : `${describe(sc.values, sc.strength)} over ${sc.area}`);
function renderImpact() {
  const has = !!S.mv;
  $('impactEmpty').hidden = has; $('impact').hidden = !has; $('story').classList.toggle('branched', has);
  document.querySelector('[data-pane=ask]').classList.toggle('branched', has);
  if (!has) return;
  computeImpact();
  const { rain, heat, wAll, wTop } = S.impact, K = S.K;
  $('hdIf').textContent = `With ${whatText(S.sc)}.`; $('hdMain').innerHTML = app.places.headline();
  // farmers: biggest rain change + how many states dry out / get wetter / move into higher stress
  const dry = rain.filter((r) => r.dRain < 0).length, wet = rain.length - dry;
  const stress = K.worse ? `Farm stress rises in ${plural(K.worse, 'state')}.` : 'No rise in farm stress.';
  if (rain.length) {
    const t = rain[0];
    $('farmBig').className = 's-big ' + (t.dRain < 0 ? 'up' : 'down');
    $('farmBig').innerHTML = `${sgn(t.dRain)} %<small>${t.name}, ${t.p.total.toFixed(0)} to ${t.m.total.toFixed(0)} mm in 10 days</small>`;
    const moved = [[dry, 'drier'], [wet, 'wetter']].filter(([n]) => n).map(([n, word]) => `${plural(n, 'state')} ${word}`).join(', ');
    $('farmTxt').textContent = `${moved} by 10 % or more. ${stress}`;
  } else {
    $('farmBig').className = 's-big flat'; $('farmBig').innerHTML = '0 %<small>rain</small>';
    $('farmTxt').textContent = `No state’s rain moves 10 %. ${stress}`;
  }
  // heat: days hotter than the usual hottest 5 % for the season
  const more = heat.filter((x) => x.d > 0), less = heat.filter((x) => x.d < 0), top = more[0] || less[0];
  $('heatBig').className = 's-big ' + (more.length ? 'up' : less.length ? 'down' : 'flat');
  $('heatBig').innerHTML = top ? `${sgn(top.d)}<small>hot days, ${top.r.name}</small>` : '0<small>hot days</small>';
  $('heatTxt').textContent = top ? `${plural((more.length ? more : less).length, 'state')} with ${more.length ? 'more' : 'fewer'} days in the season’s hottest 5 %.` : 'No state gains or loses days in the season’s hottest 5 %.';
  // wind
  $('windBig').className = 's-big ' + (wAll < -0.5 ? 'up' : wAll > 0.5 ? 'down' : 'flat');
  $('windBig').innerHTML = `${sgn(wAll, 1)} %<small>output</small>`;
  const cf = (x) => (x * 100).toFixed(0);
  $('windTxt').textContent = `Six windiest states, turbine capacity factor ${cf(wsum(S.W, 'pMean'))} % to ${cf(wsum(S.W, 'mMean'))} %. Largest swing: ${wTop.name}.`;
}

// ---------- model calls ----------
function banner(msg) { $('sBannerTxt').textContent = msg; $('sBanner').hidden = false; $('sServer').value = S.api.url; }
function hideBanner() { $('sBanner').hidden = true; }
function setSpeed(ms) { if (ms) { S.ms = ms; checkOffline(); } }
function busy(on, txt) {
  S.busy += on ? 1 : -1; $('sBusy').hidden = S.busy <= 0; if (txt) $('sBusyTxt').textContent = txt;
  document.querySelectorAll('.s-card, #cuRun, #jgRandom, #jgPaste').forEach((b) => (b.disabled = S.busy > 0)); // the strength slider stays focusable: a newer run simply replaces the older
}
function renderAll() { app.stage.render(); renderImpact(); app.judge.drawSpread(); app.explore.render(); }

/** Forget the what-if (keeps the chosen starting day). */
function clearWhatIf() {
  play(false); S.mv = S.mvInit = S.rip = S.shock = S.pert = null; S.sc = null; S.box = null; S.mode = 'normal'; S.layer = 'land'; applyView();
  app.stage.reset(); $('scSum').hidden = true; $('strength').hidden = true;
  document.querySelectorAll('.s-card').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
  app.places.update(); app.causes.reset(); app.judge.reset(); app.explore.render();
}

async function runBase() {
  if (!S.init) return;
  const id = ++S.runId; busy(true, 'Running the normal forecast');
  try {
    const r = await S.api.run(S.init, S.doy, null); if (id !== S.runId) return;
    S.prime = r.roll; S.msP = r.ms; clearWhatIf(); setSpeed(r.ms); hideBanner(); renderAll();
    return true;
  } catch (e) { banner(e.message + '. Start it with: python serve.py'); } finally { busy(false); }
}

/** Run the what-if `sc` at the current strength next to the normal forecast. Returns true on success. */
async function runWhatIf(sc) {
  if (!S.init) return false;
  if (!S.healthy) { banner(`No model server at ${S.api.url}. Start it with: python serve.py`); return false; }
  const last = S.init.subarray(2 * NCH * NCELL), strength = sc.pert ? 1 : S.strength;
  const comps = sc.pert ? [] : compsFor(sc.values, strength);
  const box = sc.pert ? bboxOf(sc.pert) : boxFromLatLon(...sc.box);
  const { pert, clamped } = sc.pert ? { pert: sc.pert, clamped: false } : buildPerturbation(last, box, comps);
  S.wanted = sc.pert ? null : { sc, strength };
  const id = ++S.runId; busy(true, 'Running both timelines');
  try {
    const [base, shk] = await Promise.all([S.api.run(S.init, S.doy, null), S.api.run(S.init, S.doy, pert)]);
    if (id !== S.runId) return false;
    if (shk.roll.some((x) => !Number.isFinite(x))) throw new Error('The model returned invalid numbers for this scenario');
    app.play(false); S.preview = null;
    const sameChange = S.sc?.id === sc.id && !sc.pert;
    S.sc = { ...sc, strength }; S.box = box; S.pert = pert; S.comps = comps;
    S.prime = base.roll; S.msP = base.ms; S.mv = shk.roll; S.msM = shk.ms; S.mvInit = Float32Array.from(last, (x, k) => x + pert[k]);
    S.shock = { box: box ? { ...box } : null, comps, desc: whatText(S.sc), short: sc.pert ? 'pasted change' : describe(sc.values, strength) };
    S.rip = box ? ripple(S.prime, S.mv, box) : null; app.stage.reset(); setSpeed(base.ms); hideBanner();
    app.places.update(); // first, so the map can open on the quantity the answer is about
    const kind = app.places.topKind() || (sc.focus === 't2m' ? 'temp' : sc.focus === 'wind' ? 'wind' : 'rain');
    S.focus = S.layer = String({ temp: 0, rain: 1, wind: 2 }[kind]); S.mode = 'diff'; applyView();
    const moving = !matchMedia('(prefers-reduced-motion: reduce)').matches; S.day = moving ? 1 : Math.max(2, app.stage.peakDay(S.v));
    app.causes.reset(); app.judge.reset(); if (!sameChange) app.explore.close(false); if (sc.group && sc.group !== S.group) showGroup(sc.group); renderAll();
    for (const el of [$('capTitle'), $('hdMain')]) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
    if (moving && S.tab === 'ask') play(true); // watch the effect spread from where it was made
    document.querySelectorAll('.s-card').forEach((b) => { b.classList.toggle('on', b.dataset.id === sc.id); b.setAttribute('aria-pressed', b.dataset.id === sc.id); });
    $('strength').hidden = false; $('strength').classList.toggle('pasted', !!sc.pert); showStrength();
    const notes = [sc.note, clamped && 'Rain and humidity were kept above zero.'].filter(Boolean).join(' ');
    $('scSum').hidden = !notes; $('scSum').textContent = notes;
    writeLink();
    return true;
  } catch (e) { banner(e.message); return false; } finally { busy(false); }
}

/** A newly chosen what-if starts at normal strength. */
async function runNew(sc, { stay } = {}) {
  S.strength = 1; $('stRange').value = 1;
  const from = S.tab, ok = await runWhatIf(sc);
  if (ok && !stay && S.tab === from) { // someone who moved on to another tab stays there
    if (from !== 'ask') { setTab('ask'); if (!still()) { S.day = 1; play(true); } }
    $('sSteps').scrollTo({ top: 0, behavior: smooth() });
    $('hdMain').focus({ preventScroll: true }); // so Space and the arrow keys drive the timeline straight away
  }
  return ok;
}

// ---------- the address bar holds the scenario, so a link reopens it exactly (computed again, live) ----------
function writeLink() {
  const q = new URLSearchParams(location.hash.slice(1));
  for (const k of ['from', 'sc', 'v', 'box', 'x']) q.delete(k);
  if (S.file) q.set('from', S.file.replace('.json', ''));
  const sc = S.sc || (S.wanted && { ...S.wanted.sc, strength: S.wanted.strength }); // a link waiting for the server stays in the address
  if (sc && !sc.pert) {
    q.set('sc', sc.id === 'mix' || sc.id === 'found' || sc.id === 'random' ? 'mix' : sc.id);
    if (q.get('sc') === 'mix') { q.set('v', Object.entries(sc.values).map(([k, v]) => `${k}:${v}`).join(',')); q.set('box', sc.box.join(',')); }
    if (sc.strength !== 1) q.set('x', sc.strength);
  }
  history.replaceState(null, '', q.toString() ? '#' + q : location.pathname + location.search);
}
function linkedScenario() {
  const q = new URLSearchParams(location.hash.slice(1)), id = q.get('sc');
  if (!id) return null;
  const strength = Math.max(0.25, Math.min(3, +q.get('x') || 1));
  if (id !== 'mix') { const sc = SCENARIOS.find((s) => s.id === id); return sc && { sc, strength }; }
  const values = Object.fromEntries((q.get('v') || '').split(',').map((p) => p.split(':')).map(([k, v]) => [PARTS.find((p) => p.id === k), +v])
    .filter(([p, v]) => p && Number.isFinite(v) && v).map(([p, v]) => [p.id, Math.max(p.min, Math.min(p.max, v))]));
  const box = (q.get('box') || '').split(',').map(Number), [a, b, c, d] = box;
  if (!Object.keys(values).length || box.length !== 4 || !(a >= 6 && b <= 38 && c >= 65 && d <= 101 && a <= b && c <= d)) return null;
  const cells = boxFromLatLon(...box); if (!cells || cells.i0 > cells.i1 || cells.j0 > cells.j1) return null;
  return { sc: { id: 'mix', title: 'Custom', area: 'the linked area', box, values, focus: Object.keys(values)[0] }, strength };
}

// ---------- strength ----------
function showStrength() {
  $('stOut').textContent = `${num(S.strength)}×`;
  $('stRange').style.setProperty('--p', `${((S.strength - 0.25) / 2.75) * 100}%`); // how far the track is filled
  const far = S.sc && !S.sc.pert ? outOfRange(S.sc.values, S.strength) : [];
  $('stWarn').hidden = !far.length;
  if (far.length) $('stWarn').textContent = `Beyond what the model has likely seen (${far.map((p) => `${p.word} ${amountText(p)}`).join(', ')}). Trust direction more than size.`;
}

// ---------- step 2: cards and the mixer ----------
function showGroup(group) {
  S.group = group;
  document.querySelectorAll('#segGroup button').forEach((b) => { b.classList.toggle('on', b.dataset.group === group); b.setAttribute('aria-pressed', b.dataset.group === group); });
  $('mix').hidden = group !== 'mix'; $('cards').hidden = group === 'mix'; $('sMapWrap').classList.toggle('draw', group === 'mix');
  document.querySelectorAll('.s-card').forEach((b) => (b.hidden = b.dataset.group !== group));
  if (group === 'mix') return previewRegion();
  if (!S.mv) S.box = null;
  app.stage.render();
}
function mixValues() { return Object.fromEntries(PARTS.map((p) => [p.id, +$('mx-' + p.id).value]).filter(([, v]) => v)); }
function syncMix() {
  for (const p of PARTS) {
    const el = $('mx-' + p.id), v = +el.value, at = ((v - p.min) / (p.max - p.min)) * 100; // every range is symmetric: 50 % is "no change"
    el.style.setProperty('--a', `${Math.min(50, at)}%`); el.style.setProperty('--b', `${Math.max(50, at)}%`);
    $('mo-' + p.id).textContent = `${sgn(v, v % 1 ? 1 : 0)} ${p.unit}`; el.closest('.s-mixrow').classList.toggle('set', !!v);
  }
  const n = Object.keys(mixValues()).length; $('cuRun').textContent = n > 1 ? `Apply ${n} changes` : 'Apply'; $('mixError').textContent = '';
}
function previewRegion() {
  const r = REGIONS.find((x) => x.id === $('cuWhere').value);
  if (!S.mv) { S.box = r.box ? boxFromLatLon(...r.box) : S.drawn; S.mode = 'normal'; }
  else app.stage.map.set({ dragBox: (S.preview = r.box ? boxFromLatLon(...r.box) : S.drawn) });
  if (!S.mv) app.stage.render();
}
function openMix(sc) {
  showGroup('mix');
  if (sc) {
    for (const p of PARTS) $('mx-' + p.id).value = sc.values?.[p.id] ? sc.values[p.id] * (sc.strength || 1) : 0;
    const r = REGIONS.find((x) => x.box && x.box.join() === sc.box.join());
    if (r) $('cuWhere').value = r.id; else { S.drawn = boxFromLatLon(...sc.box); $('cuWhere').value = 'drawn'; }
    syncMix(); S.preview = null; app.stage.map.set({ dragBox: null });
    const capped = outOfRange(sc.values || {}, sc.strength || 1).map((p) => p.word);
    if (capped.length) $('mixError').textContent = `The sliders stop short of this strength, so ${capped.length > 1 ? `${capped.slice(0, -1).join(', ')} and ${capped.at(-1)} are` : `${capped[0]} is`} set to the limit.`;
  }
  $('step2').scrollIntoView({ block: 'start', behavior: smooth() });
}
function runMix() {
  const values = mixValues();
  if (!Object.keys(values).length) return ($('mixError').textContent = 'Move at least one slider.');
  const r = REGIONS.find((x) => x.id === $('cuWhere').value);
  if (!r.box && !S.drawn) return ($('mixError').textContent = 'Drag a box on the map, or pick a named area.');
  const box = r.box || [lat(S.drawn.i0), lat(S.drawn.i1), lon(S.drawn.j0), lon(S.drawn.j1)];
  const first = PARTS.find((p) => values[p.id]).id;
  runNew({ id: 'mix', title: 'Custom', area: r.say, box, values, focus: first });
}
function setupStep2() {
  $('cards').innerHTML = SCENARIOS.map((s, i) => `<button type="button" class="s-card" data-id="${s.id}" data-group="${s.group}" title="${cap(describe(s.values))} over ${s.area}"><strong>${s.title}</strong><small>${cap(describe(s.values))}</small>${i ? '' : '<em>Start here</em>'}</button>`).join('');
  document.querySelectorAll('.s-card').forEach((b) => { // show where a change would be made before it is chosen
    const sc = SCENARIOS.find((s) => s.id === b.dataset.id), show = () => { if (!S.mv && !S.busy) { S.box = boxFromLatLon(...sc.box); app.stage.render(); } }, hide = () => { if (!S.mv && !S.busy && S.group !== 'mix') { S.box = null; app.stage.render(); } };
    b.addEventListener('pointerenter', show); b.addEventListener('focus', show); b.addEventListener('pointerleave', hide); b.addEventListener('blur', hide);
  });
  document.querySelectorAll('.s-card').forEach((b) => (b.onclick = () => runNew(SCENARIOS.find((s) => s.id === b.dataset.id))));
  $('mixRows').innerHTML = PARTS.map((p) => `<div class="s-mixrow"><label for="mx-${p.id}">${p.label}</label><input type="range" id="mx-${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="0"><output id="mo-${p.id}" for="mx-${p.id}"></output></div>`).join('');
  for (const p of PARTS) $('mx-' + p.id).oninput = syncMix;
  $('cuWhere').innerHTML = REGIONS.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
  $('cuWhere').onchange = previewRegion;
  $('cuClear').onclick = () => { for (const p of PARTS) $('mx-' + p.id).value = 0; syncMix(); };
  $('scClear').onclick = () => app.clear();
  $('cuRun').onclick = runMix;
  document.querySelectorAll('#segGroup button').forEach((b) => (b.onclick = () => (b.dataset.group === 'mix' && S.sc?.values ? openMix(S.sc) : showGroup(b.dataset.group))));
  $('stRange').oninput = () => { S.strength = +$('stRange').value; showStrength(); };
  $('stRange').onchange = () => { if (S.sc && !S.sc.pert) runWhatIf(S.sc); };
  syncMix(); showGroup('everyday');
}

// ---------- tabs ----------
function setTab(tab) {
  const was = S.tab; S.tab = tab; app.play(false);
  if (tab !== 'ask' && tab !== was) app.explore.close(false);
  document.querySelectorAll('.s-tabs [role=tab]').forEach((b, i) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on) $('tabInk').style.transform = `translateX(${i * 100}%)`; });
  document.querySelectorAll('.s-pane').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  $('sMapWrap').classList.toggle('draw', tab === 'ask' && S.group === 'mix');
  if (!S.mv) { S.box = null; if (tab === 'ask' && S.group === 'mix') { const r = REGIONS.find((x) => x.id === $('cuWhere').value); S.box = r.box ? boxFromLatLon(...r.box) : S.drawn; } }
  if (tab !== 'influence') app.stage.map.set({ tiles: null });
  app.stage.render(); app.explore.render(); if (tab === 'test') app.judge.drawSpread();
  if (tab !== was) { if (tab === 'influence') app.map.topView(); else if (was === 'influence' && !app.explore.isOpen()) app.map.home(); }
  document.body.classList.remove('panel-hidden'); syncPanelButton(); $('sSteps').scrollTop = 0;
  if (tab === 'test' && tab !== was && S.mv && !app.judge.ran()) app.judge.check();
  if (tab !== was && matchMedia('(max-width: 980px)').matches) document.querySelector('.s-side').scrollIntoView({ behavior: 'smooth' });
}

// ---------- starting day ----------
function showPastedStart() {
  const sel = $('selDate');
  if (!sel.querySelector('option[value=""]')) sel.add(new Option('Pasted request', ''));
  sel.value = ''; S.file = null; S.name = 'Pasted request';
}
function useInput(init, doy) {
  S.init = init; S.doy = doy.map(Number); S.prime = null; S.runId++; S.day = 1;
  clearWhatIf(); app.influence.reset(); renderAll();
}
let loads = 0;
async function loadSample(file) {
  const load = ++loads;
  try {
    const js = await (await fetch('samples/' + file)).json();
    if (load !== loads) return; // a later choice of day overtook this one
    S.file = file; S.name = js.name; useInput(flatten(js.init_states), js.doy_sincos); writeLink();
    if (S.healthy) await forecast();
  } catch (e) { banner('Could not load the starting day: ' + e.message); }
}
/** The normal forecast, then whatever change was asked for (from a link, or kept from the previous day). */
async function forecast() {
  if (!(await runBase()) || !S.wanted) return;
  const { sc, strength } = S.wanted;
  if (sc.group) showGroup(sc.group);
  S.strength = strength; $('stRange').value = strength; await runWhatIf(sc);
}

// ---------- health ----------
async function checkHealth() {
  const h = await S.api.health(), was = S.healthy; S.healthy = h.ok;
  if (h.ok && !was) { hideBanner(); if (S.init && !S.prime && !S.busy) forecast(); }
  if (!h.ok && (was || S.init) && $('sBanner').hidden) banner(h.status === 'loading' ? 'The model is loading. This page connects by itself.' : `The model isn’t running at ${S.api.url}. Start it with: python serve.py`); // the only place a server problem shows
}
function checkOffline() {
  let origin = ''; try { origin = new URL(S.api.url).origin; } catch (_) { /* ignore */ }
  const ext = performance.getEntriesByType('resource').filter((r) => { try { const o = new URL(r.name).origin; return o !== location.origin && o !== origin && !r.name.startsWith('data:'); } catch (_) { return false; } });
  // a live fact for the Proof tab, not a badge: how fast this machine runs a forecast, and that nothing went online
  $('runFacts').innerHTML = `${S.ms ? `<span><b>${(Math.max(S.ms, 50) / 1000).toFixed(1)} s</b> per 10-day forecast, on this computer</span>` : ''}<span class="${ext.length ? 'bad' : ''}"><b>${ext.length}</b> requests to the internet</span>`;
}

// ---------- views + playback ----------
let expertMod = null;
async function showExpert(tab) {
  document.body.dataset.view = 'expert'; $('expert').hidden = false; play(false);
  if (!expertMod) expertMod = await import('./main.js');
  await expertMod.ready;
  if (S.init) expertMod.adopt({ init: S.init, doy: S.doy, name: S.name, prime: S.prime, mv: S.mv, msP: S.msP, msM: S.msM, mvInit: S.mvInit, shock: S.shock, box: S.box, comps: S.sc ? S.comps : [], file: S.file, tab: tab || (S.mv ? 'ripple' : undefined) });
  window.dispatchEvent(new Event('resize'));
}
function showStory() { document.body.dataset.view = 'story'; $('expert').hidden = true; setTimeout(() => app.stage.render(), 30); }
function play(on) {
  const word = on ? 'Pause' : 'Play';
  S.playing = on; $('sPlay').setAttribute('aria-label', word); $('sPlay').title = `${word} (Space)`; clearInterval(S.timer); // the icon is drawn from the label (css)
  app.stage.impactRun(false);
  if (!on) return;
  if (app.stage.isSpreading()) app.stage.render();
  if (app.stage.isImpact()) return app.stage.impactRun(true);
  S.timer = setInterval(() => setDay(S.day >= 10 ? 1 : S.day + 1, true), 800);
}
function setDay(d, playing) { if (!playing && S.playing) play(false); S.day = Math.max(1, Math.min(10, d)); app.stage.render(); app.places.setDay(); app.explore.render(); if (S.tab === 'test') app.judge.drawSpread(); }

// ---------- the map ----------
/** How much of each map edge the panel and the deck cover, so the camera can centre on what is left. */
function insets() {
  const box = $('sMapWrap').getBoundingClientRect();
  if (!matchMedia('(min-width: 981px)').matches) return { left: 0, right: 0, top: 0, bottom: 0 };
  const side = document.querySelector('.s-side'), deck = $('sDock').getBoundingClientRect();
  const question = document.querySelector('.s-top').getBoundingClientRect(), solid = parseFloat(getComputedStyle($('sDock')).paddingTop); // the deck's upper padding is a see-through fade
  return {
    left: 0,
    right: document.body.classList.contains('panel-hidden') ? 0 : side.offsetWidth,
    top: Math.max(0, Math.min(question.bottom - box.top - 16, box.height * 0.2)),
    bottom: deck.height ? Math.max(0, box.bottom - deck.top - solid + 14) : 0,
  };
}
const picture = (src) => new Promise((done) => { const img = new Image(); img.onload = () => done(img); img.onerror = () => done(null); img.src = src; });
function createMap(outlines, terrain) {
  const hooks = { insets, canDraw: () => app.canDraw(), hover: (p, e) => app.explore?.hover(p, e), pick: (p) => app.explore.pick(p) };
  try {
    if (new URLSearchParams(location.search).has('flat')) throw new Error('?flat=1 was requested'); // for weak graphics hardware
    if (!terrain.elevation || !terrain.imagery) throw new Error('the map pictures did not load');
    return new Map3D($('sMap'), outlines, terrain, app.geo, hooks);
  }
  catch (e) {
    console.warn('3D map unavailable, using the flat map:', e.message);
    document.body.classList.add('flat-map'); $('sMap').setAttribute('aria-label', 'Map of India');
    return new MapPanel($('sMap'), outlines);
  }
}
function syncPanelButton() {
  const hidden = document.body.classList.contains('panel-hidden');
  $('mcPanel').setAttribute('aria-pressed', hidden); $('mcPanel').title = hidden ? 'Show the panel' : 'Hide the panel';
}
function bindMapControls() {
  $('mcIn').onclick = () => app.map.zoomBy(0.68); $('mcOut').onclick = () => app.map.zoomBy(1.47);
  $('mcTop').onclick = () => app.map.topView();
  $('mcHome').onclick = () => { app.explore.close(false); app.map.home(); };
  $('mcMotion').onclick = () => { S.motion = !S.motion; $('mcMotion').setAttribute('aria-pressed', S.motion); app.stage.render(); };
  $('mcPanel').onclick = () => { document.body.classList.toggle('panel-hidden'); syncPanelButton(); };
}

// ---------- init ----------
async function init() {
  const [outlines, grid, heat, rainClim, idx, gazetteer] = await Promise.all(['assets/outlines.json', 'assets/grid_states.json', 'assets/heat_p95.json', 'assets/rain_clim.json', 'samples/index.json', 'assets/places.json'].map((u) => fetch(u).then((r) => r.json())));
  const [elevation, imagery] = await Promise.all(['assets/elevation.png', 'assets/land.jpg'].map(picture));
  const terrain = { elevation, imagery };
  S.assets = { grid, heat, rainClim }; S.samples = idx;
  app.geo = mapPlaces(outlines, gazetteer);
  Object.assign(app, {
    play, banner, runNew, openMix, setTab, setDay,
    view: applyView,
    clear: () => { S.runId++; S.wanted = null; clearWhatIf(); renderAll(); writeLink(); }, // runId: a run still in flight must not come back
    beyond: () => !!(S.sc && !S.sc.pert && outOfRange(S.sc.values, S.sc.strength).length),
    useInput: (init, doy) => { showPastedStart(); useInput(init, doy); },
    canDraw: () => S.tab === 'ask' && S.group === 'mix',
    drew: (box) => { S.drawn = box; $('cuWhere').value = 'drawn'; previewRegion(); },
  });
  const began = performance.now(); app.map = createMap(outlines, terrain); console.info(`map built in ${Math.round(performance.now() - began)} ms`); S.land = !!app.map.glCanvas; // the landscape view needs the 3D map
  app.stage = createStage(app, app.map); app.explore = createExplorer(app, app.geo); app.places = createPlaces(app); app.causes = createCauses(app); app.influence = createInfluence(app); app.judge = createJudge(app); app.tour = createTour(app); app.fork = createFork(app);
  app.influence.setup();
  $('selDate').innerHTML = idx.map((s) => `<option value="${s.file}">${s.date_label}, ${DATE_WORDS[s.file] || s.name}</option>`).join('');
  $('chipVar').innerHTML = [['land', 'Satellite', 'Forecast weather over the land'], ...VARS.map((v, i) => [String(i), v.name, v.tip])]
    .map(([i, name, tip]) => `<button type="button" class="s-chip" data-i="${i}" title="${tip}">${name}</button>`).join('');
  document.querySelectorAll('#chipVar .s-chip').forEach((b) => (b.onclick = () => {
    play(false);
    const i = b.dataset.i;
    if (i === 'land') S.beforeLand = S.mode; else if (S.layer === 'land' && S.mv && S.beforeLand) S.mode = S.beforeLand; // the satellite layer has no difference view: come back to where you were
    S.layer = i; applyView(); app.stage.render();
  }));
  $('sSmooth').onchange = () => { play(false); S.smooth = $('sSmooth').checked; applyView(); app.stage.render(); };
  bindMapControls(); slidingThumbs($('story'));
  app.map.setTheme?.(getComputedStyle($('story')));
  setupStep2();
  document.querySelectorAll('#segMode button').forEach((b) => (b.onclick = () => {
    play(false); S.mode = b.dataset.mode;
    if (S.layer === 'land' && (S.mode === 'diff' || S.mode === 'split')) S.layer = S.focus;
    if (S.mode === 'split') { const i = insets(), w = $('sMapWrap').clientWidth; S.split = w ? (i.left + (w - i.left - i.right) / 2) / w : 0.5; }
    applyView(); app.stage.render();
  }));
  const tabs = [...document.querySelectorAll('.s-tabs [role=tab]')];
  tabs.forEach((b, i) => {
    b.onclick = () => setTab(b.dataset.tab);
    b.onkeydown = (e) => { const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!step) return; e.preventDefault(); e.stopPropagation(); const n = tabs[(i + step + tabs.length) % tabs.length]; n.focus(); setTab(n.dataset.tab); };
  });
  $('selDate').onchange = (e) => { if (e.target.value) loadSample(e.target.value); };
  $('sPlay').onclick = () => play(!S.playing); $('sDay').oninput = (e) => { play(false); setDay(+e.target.value); };
  $('sSpread').onclick = () => app.stage.spread();
  document.querySelectorAll('[data-expert]').forEach((b) => (b.onclick = () => showExpert(b.dataset.expert)));
  $('btnExpert').onclick = () => showExpert(); $('btnTour').onclick = () => app.tour.start(); $('btnStory').onclick = showStory;
  $('sRetry').onclick = () => { S.api.base = $('sServer').value.trim(); try { localStorage.setItem('mm_server', S.api.url); } catch (e) { /* ignore */ } checkHealth().then(() => S.init && S.healthy && !S.busy && forecast()); };
  window.addEventListener('keydown', (e) => {
    if (document.body.dataset.view === 'story' && e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); return $('sFind').focus(); }
    if (document.body.dataset.view !== 'story' || S.tab === 'influence' || /INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(document.activeElement.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); play(!S.playing); } else if (e.key === 'ArrowRight') setDay(S.day + 1); else if (e.key === 'ArrowLeft') setDay(S.day - 1);
  });
  window.addEventListener('resize', () => app.map.draw());
  document.querySelector('.s-skip').onclick = (e) => { e.preventDefault(); $('sSteps').focus(); };
  window.addEventListener('hashchange', () => location.reload()); // a link pasted into an open tab: start again from it (our own updates use replaceState, which does not fire this)
  if (new URLSearchParams(location.search).get('view') === 'expert') showExpert();
  setInterval(checkHealth, 4000); setInterval(checkOffline, 3000);
  document.fonts?.ready.then(() => { app.map.draw(); app.fork.render(); });
  app.stage.render(); renderImpact(); app.judge.reset(); await checkHealth(); checkOffline();
  const from = new URLSearchParams(location.hash.slice(1)).get('from'), linked = linkedScenario();
  S.wanted = linked;
  await loadSample(idx.some((s) => s.file === `${from}.json`) ? `${from}.json` : idx[0].file); checkOffline();
  $('selDate').value = S.file;

}
init().catch((e) => { console.error(e); banner('The dashboard failed to start: ' + e.message); });
