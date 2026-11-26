// Story mode: the guided default view. Forecast -> what-if -> what changes for India.
// Every number comes from live calls to the model server (js/api.js); impact numbers reuse js/impact.js.
import { NLON, NCELL, NCH, lat, lon, rIdx, flatten, stepsOf } from './util.js';
import { lut } from './colormaps.js';
import { Api } from './api.js';
import { MapPanel } from './render.js';
import { LineChart } from './chart.js';
import { boxFromLatLon, buildPerturbation, ripple, maxAbsDiff } from './shock.js';
import { kharif, windIndex } from './impact.js';

const $ = (id) => document.getElementById(id);
const sgn = (x, d = 0) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

// ---------- icons (inline SVG, offline) ----------
const IC = {
  t2m: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/>',
  tp: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>',
  tcwv: '<path d="M7 16a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5 3.8 3.8 0 0 1 17 16z"/><path d="M9 19v1.5M13 19v1.5M17 19v1.5"/>',
  msl: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  bob: '<path d="M3 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M12 3v9M8.5 6.5L12 3l3.5 3.5"/>',
  weak: '<path d="M3 8h10a3 3 0 1 0-3-3M3 13h6"/><path d="M17 11v9M14 17l3 3 3-3"/>',
  arab: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  dry: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M4 4l16 16"/>',
  lowp: '<circle cx="12" cy="12" r="1.3"/><path d="M12 8a4 4 0 0 1 4 4M12 4a8 8 0 0 1 8 8M12 16a4 4 0 0 1-4-4M12 20a8 8 0 0 1-8-8"/>',
  custom: '<rect x="4" y="5" width="16" height="14" rx="2" stroke-dasharray="3 2.5"/><path d="M12 9v6M9 12h6"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;

// ---------- what you can look at ----------
const VARS = [
  { key: 't2m', name: 'Temperature', unit: '°C', cmap: 'heat', dcmap: 'rdbuL', floor: 0.2, f: (r, d, k) => r[rIdx(d, 0) + k] - 273.15,
    tip: 'Air temperature 2 m above the ground (daily average).', norm: 'Redder = hotter, bluer = cooler', diff: 'Blue = cooler than normal, red = warmer than normal', ends: ['cooler', 'hotter'], dends: ['cooler', 'warmer'] },
  { key: 'tp', name: 'Rainfall', unit: 'mm/day', cmap: 'rain', dcmap: 'brbgL', floor: 0.5, zero: true, f: (r, d, k) => r[rIdx(d, 1) + k],
    tip: 'Rain that falls during the day.', norm: 'Darker blue = heavier rain, white = dry', diff: 'Brown = drier than normal, green = wetter than normal', ends: ['dry', 'heavy rain'], dends: ['drier', 'wetter'] },
  { key: 'wind', name: 'Wind', unit: 'km/h', cmap: 'windL', dcmap: 'rdbuL', floor: 1.5, zero: true, f: (r, d, k) => Math.hypot(r[rIdx(d, 2) + k], r[rIdx(d, 3) + k]) * 3.6,
    tip: 'Wind speed 10 m above the ground.', norm: 'Darker = stronger wind', diff: 'Blue = weaker wind, red = stronger wind', ends: ['calm', 'strong'], dends: ['weaker', 'stronger'] },
  { key: 'tcwv', name: 'Humidity (water vapour)', short: 'Humidity', unit: 'kg/m²', cmap: 'water', dcmap: 'brbgL', floor: 0.5, zero: true, f: (r, d, k) => r[rIdx(d, 5) + k],
    tip: 'Total water vapour in the air above each spot, in kg per square metre. Moist air feeds monsoon rain.', norm: 'Greener = more water vapour in the air', diff: 'Brown = drier air than normal, green = moister air', ends: ['dry air', 'moist air'], dends: ['drier', 'moister'] },
  { key: 'msl', name: 'Pressure', unit: 'hPa', cmap: 'cividis', dcmap: 'rdbuL', floor: 0.5, f: (r, d, k) => r[rIdx(d, 4) + k] / 100,
    tip: 'Air pressure at sea level. Low-pressure areas bring storms and rain.', norm: 'Yellow = higher pressure, blue = lower pressure', diff: 'Blue = lower pressure than normal, red = higher', ends: ['low', 'high'], dends: ['lower', 'higher'] },
];

// ---------- start dates in plain words ----------
const DATE_WORDS = {
  'onset.json': 'monsoon arriving in Kerala', 'heavy_rain.json': 'heavy monsoon rain', 'heatwave.json': 'severe heatwave',
  'cyclone.json': 'Cyclone Amphan in the Bay of Bengal', 'western_disturbance.json': 'winter storm from the west',
};

// ---------- what-if cards ----------
const SCENARIOS = [
  { id: 'bob', icon: 'bob', title: 'Bay of Bengal heats up by 3 °C', line: 'Warmer sea, moister air above it.', lead: 'the Bay of Bengal heats up by 3 °C', area: 'the Bay of Bengal',
    box: [8, 20, 82, 94], comps: [{ ch: 0, mode: 'abs', value: 3 }, { ch: 5, mode: 'pct', value: 15 }], what: 'temperature +3 °C and humidity +15 %', focus: 'tp' },
  { id: 'weak', icon: 'weak', title: 'Monsoon winds weaken by 40 %', line: 'Less moist air blown in from the sea.', lead: 'the monsoon winds weaken by 40 %', area: 'the Arabian Sea',
    box: [8, 20, 65, 75], comps: [{ ch: 2, mode: 'pct', value: -40 }, { ch: 3, mode: 'pct', value: -40 }], what: 'wind strength −40 %', focus: 'wind' },
  { id: 'arab', icon: 'arab', title: 'Arabian Sea heatwave +2.5 °C', line: 'Warm sea off the west coast.', lead: 'the Arabian Sea gets a +2.5 °C heatwave', area: 'the Arabian Sea',
    box: [8, 20, 65, 75], comps: [{ ch: 0, mode: 'abs', value: 2.5 }], what: 'temperature +2.5 °C', focus: 't2m' },
  { id: 'dry', icon: 'dry', title: 'Dry air over Rajasthan', line: '40 % less water vapour in the air.', lead: 'the air over Rajasthan turns dry', area: 'Rajasthan',
    box: [24, 30, 69, 76], comps: [{ ch: 5, mode: 'pct', value: -40 }], what: 'humidity −40 %', focus: 'tcwv' },
  { id: 'lowp', icon: 'lowp', title: 'Low-pressure system over Bengal', line: 'Pressure dips 5 hPa: storm-prone.', lead: 'a low-pressure system forms over Bengal', area: 'Bengal',
    box: [20, 26, 85, 92], comps: [{ ch: 4, mode: 'abs', value: -5 }], what: 'pressure −5 hPa', focus: 'msl' },
];
const CUSTOM_WHAT = [
  { id: 't2m', label: 'Temperature', unit: '°C', min: -5, max: 5, step: 0.5, def: 2, fmtv: (v) => `${sgn(v, 1)} °C`, build: (v) => [{ ch: 0, mode: 'abs', value: v }], text: (v) => `temperature ${sgn(v, 1)} °C`, focus: 't2m' },
  { id: 'tcwv', label: 'Humidity (water vapour)', unit: '%', min: -50, max: 50, step: 5, def: -30, fmtv: (v) => `${sgn(v)} %`, build: (v) => [{ ch: 5, mode: 'pct', value: v }], text: (v) => `humidity ${sgn(v)} %`, focus: 'tcwv' },
  { id: 'wind', label: 'Wind strength', unit: '%', min: -60, max: 60, step: 5, def: -40, fmtv: (v) => `${sgn(v)} %`, build: (v) => [{ ch: 2, mode: 'pct', value: v }, { ch: 3, mode: 'pct', value: v }], text: (v) => `wind strength ${sgn(v)} %`, focus: 'wind' },
  { id: 'msl', label: 'Pressure', unit: 'hPa', min: -10, max: 10, step: 1, def: -5, fmtv: (v) => `${sgn(v)} hPa`, build: (v) => [{ ch: 4, mode: 'abs', value: v }], text: (v) => `pressure ${sgn(v)} hPa`, focus: 'msl' },
  { id: 'tp', label: 'Rainfall on the start day', unit: '%', min: -50, max: 50, step: 5, def: 30, fmtv: (v) => `${sgn(v)} %`, build: (v) => [{ ch: 1, mode: 'pct', value: v }], text: (v) => `rainfall ${sgn(v)} %`, focus: 'tp' },
];
const REGIONS = [
  { id: 'bob', name: 'Bay of Bengal', box: [8, 20, 82, 94] }, { id: 'arab', name: 'Arabian Sea', box: [8, 20, 65, 75] },
  { id: 'raj', name: 'Rajasthan', box: [24, 30, 69, 76] }, { id: 'cen', name: 'Central India', box: [18, 26, 76, 84] },
  { id: 'gan', name: 'Gangetic plains', box: [24, 30, 78, 88] }, { id: 'south', name: 'Southern peninsula', box: [8, 16, 74, 80] },
  { id: 'drawn', name: 'Area I draw on the map', box: null },
];
const LABELS = [
  { lon: 77.2, lat: 28.6, text: 'Delhi', dot: 1 }, { lon: 72.9, lat: 19.1, text: 'Mumbai', dot: 1 }, { lon: 88.4, lat: 22.6, text: 'Kolkata', dot: 1 },
  { lon: 80.3, lat: 13.1, text: 'Chennai', dot: 1 }, { lon: 76.3, lat: 10.0, text: 'Kerala', dot: 1 },
  { lon: 68.5, lat: 14.5, text: 'Arabian Sea', sea: 1 }, { lon: 88.5, lat: 13.5, text: 'Bay of Bengal', sea: 1 },
];
const OUTLINE = { states: 'rgba(16,32,43,.28)', countries: 'rgba(16,32,43,.85)' };

// ---------- state ----------
function defaultServer() {
  const q = new URLSearchParams(location.search).get('server');
  if (q === 'api') return `${location.origin}/api`;
  if (q) return q;
  try { const s = localStorage.getItem('mm_server'); if (s) return s; } catch (e) { /* storage unavailable */ }
  return 'http://127.0.0.1:8000';
}
const S = {
  api: new Api(defaultServer()), assets: null, outlines: null, samples: [], file: null, name: '', init: null, doy: null,
  prime: null, mv: null, msP: null, msM: null, mvInit: null, sc: null, box: null, comps: [], rip: null, K: null, W: null,
  v: 0, day: 1, mode: 'normal', playing: false, timer: null, cache: {}, healthy: false, busy: 0, runId: 0, customOpen: false, nullState: null,
};
window.__story = S;
let map = null, trustChart = null;

// ---------- fields ----------
function fieldOf(roll, d, v) { const o = new Float32Array(NCELL); for (let k = 0; k < NCELL; k++) o[k] = v.f(roll, d, k); return o; }
function fields(vi) {
  if (!S.prime) return null;
  if (S.cache[vi]) return S.cache[vi];
  const v = VARS[vi], n = stepsOf(S.prime), F = { P: [], M: [], D: [] };
  for (let d = 0; d < n; d++) {
    F.P.push(fieldOf(S.prime, d, v));
    if (S.mv) { const m = fieldOf(S.mv, d, v); F.M.push(m); F.D.push(m.map((x, k) => x - F.P[d][k])); }
  }
  const all = Float32Array.from([...F.P, ...F.M].flatMap((a) => Array.from(a))).sort(), q = (p) => all[Math.min(all.length - 1, Math.floor(p * (all.length - 1)))];
  F.lo = v.zero ? 0 : q(0.003); F.hi = v.key === 'tp' ? Math.max(q(0.995), 2) : q(0.997);
  if (F.hi - F.lo < 1e-6) F.hi = F.lo + 1;
  F.dmax = F.D.length ? Math.max(...F.D.map((a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0))) : 0;
  if (F.D.length) { const ab = Float32Array.from(F.D.flatMap((a) => Array.from(a, Math.abs))).sort(); F.dscale = ab[Math.floor(0.995 * (ab.length - 1))]; }
  return (S.cache[vi] = F);
}
const nf = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1));

// ---------- rendering ----------
function gradient(name, flip) {
  const L = lut(name), st = [];
  for (let i = 0; i <= 12; i++) { const k = Math.round((i / 12) * 255) * 3; st.push(`rgb(${L[k]},${L[k + 1]},${L[k + 2]}) ${(i / 12) * 100}%`); }
  return `linear-gradient(90deg,${st.join(',')})`;
}
function render() {
  if (!map) return;
  const v = VARS[S.v], F = fields(S.v), d = S.day - 1, mode = S.mv ? S.mode : 'normal';
  $('dayNow').textContent = 'Day ' + S.day; $('sDay').value = S.day;
  document.querySelectorAll('#segMode button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === mode); b.disabled = b.dataset.mode !== 'normal' && !S.mv; });
  document.querySelectorAll('#chipVar .s-chip').forEach((b, i) => b.classList.toggle('on', i === S.v));
  const common = { labels: LABELS, outline: OUTLINE, box: S.box, boxText: S.box ? 'What-if area' : null, empty: null, arrows: null };
  if (!F) { map.set({ ...common, field: null, empty: S.healthy ? 'Running the AI forecast…' : 'Waiting for the model…', box: S.box }); $('capTitle').textContent = `${v.name}`; $('capSub').textContent = ''; $('sLegend').innerHTML = ''; return; }
  let field = F.P[d], lo = F.lo, hi = F.hi, cmap = v.cmap, legendWords = v.norm, ends = [`${nf(lo)} ${v.unit} (${v.ends[0]})`, `${nf(hi)} ${v.unit} (${v.ends[1]})`], sub;
  if (mode === 'whatif') { field = F.M[d]; sub = `The AI's forecast after your what-if: ${S.sc.lead}. Dashed box = where you changed it.`; }
  else if (mode === 'diff') {
    const A = Math.max(F.dscale, v.floor); field = F.D[d]; lo = -A; hi = A; cmap = v.dcmap; legendWords = v.diff;
    ends = [`${sgn(-A, A < 10 ? 1 : 0)} ${v.unit} (${v.dends[0]})`, `no change in the middle`, `${sgn(A, A < 10 ? 1 : 0)} ${v.unit} (${v.dends[1]})`];
    sub = F.dscale < v.floor ? `Almost no change in ${v.name.toLowerCase()} from this what-if. Try another quantity above.` : `What-if minus normal: how much your what-if changes ${v.name.toLowerCase()}. White means no change.`;
  } else sub = S.mv ? 'What the AI expects if nothing unusual happens.' : "What the AI expects if nothing unusual happens. This is the forecast every what-if is compared against.";
  map.set({ ...common, field, lo, hi, cmap }); fitCaption();
  $('capTitle').textContent = `${v.name}, day ${S.day} of 10`;
  $('capSub').textContent = sub;
  $('sLegend').innerHTML = `<div class="w">${legendWords}</div><div class="bar" style="background:${gradient(cmap)}"></div><div class="ends">${ends.map((e) => `<span>${e}</span>`).join('')}</div>`;
}
function fitCaption() { const w = $('sMap').style.width; if (w) document.querySelector('.s-stage').style.setProperty('--mapw', w); }
function busy(on, txt) { S.busy += on ? 1 : -1; $('sBusy').hidden = S.busy <= 0; if (txt) $('sBusyTxt').textContent = txt; for (const id of ['cuRun', 'sNull']) $(id).disabled = S.busy > 0; document.querySelectorAll('.s-card').forEach((b) => (b.disabled = S.busy > 0)); }

// ---------- impact: headline + cards (logic from impact.js) ----------
function joinNames(a) { return a.length === 1 ? a[0] : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SKIP = new Set(['ISL', 'UT']); // tiny island/UT groups: not farming regions, would dominate headlines
function filterK(K) { const rows = K.rows.filter((r) => !SKIP.has(r.id)); return { ...K, rows, worse: rows.filter((r) => r.dStress > 0).length, better: rows.filter((r) => r.dStress < 0).length }; }
const isPl = (names) => names.length > 1 || /states/.test(names[0]);
function computeImpact() {
  const K = filterK(kharif(S.prime, S.mv, S.assets, S.doy)), W = windIndex(S.prime, S.mv, S.assets);
  const rain = K.rows.filter((r) => Math.abs(r.dRain) >= 10).sort((a, b) => Math.abs(b.dRain) - Math.abs(a.dRain));
  const heat = K.rows.map((r) => ({ r, d: r.m.heat - r.p.heat })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const wsumP = W.reduce((a, w) => a + w.pMean, 0), wsumM = W.reduce((a, w) => a + w.mMean, 0), wAll = wsumP > 0.01 ? ((wsumM - wsumP) / wsumP) * 100 : 0;
  const wTop = [...W].sort((a, b) => Math.abs(b.dPct) - Math.abs(a.dPct))[0];
  S.K = K; S.W = W; S.impact = { rain, heat, wAll, wTop };
}
function headlineText() {
  const { rain, heat, wAll, wTop } = S.impact, K = S.K;
  const stress = K.worse > 0 ? `; ${plural(K.worse, 'state')} move${K.worse === 1 ? 's' : ''} into higher farm-stress risk` : '';
  const nHeat = heat.filter((x) => x.d > 0).length;
  // most noticeable effect first: rain (10 % ~ 1), extra hot days (3 days ~ 1), wind-farm output (3 % ~ 1)
  const cands = [
    { score: rain.length ? Math.abs(rain[0].dRain) / 10 : 0, text: () => {
      const s = Math.sign(rain[0].dRain), same = rain.filter((r) => Math.sign(r.dRain) === s).slice(0, 2), avg = same.reduce((a, r) => a + Math.abs(r.dRain), 0) / same.length, names = same.map((r) => r.name);
      return `${joinNames(names)} ${isPl(names) ? 'get' : 'gets'} ~${Math.round(avg / 5) * 5 || Math.round(avg)} % ${s < 0 ? 'less' : 'more'} rain over the next 10 days${stress}.`; } },
    { score: nHeat && heat[0].d > 0 ? heat[0].d / 3 : 0, text: () => `${plural(nHeat, 'state')} ${nHeat === 1 ? 'gets' : 'get'} extra heat-stress days over the next 10 days, most in ${heat[0].r.name} (+${heat[0].d})${stress}.` },
    { score: Math.max(Math.abs(wAll) / 3, wTop ? Math.abs(wTop.dPct) / 12 : 0), text: () => `Wind-farm output ${wAll < 0 ? 'drops' : 'rises'} ~${Math.max(1, Math.round(Math.abs(wAll)))} % across India's 6 windiest states over the next 10 days${stress}.` },
  ].sort((a, b) => b.score - a.score);
  if (cands[0].score >= 0.3) return cands[0].text();
  return 'This what-if barely changes India\u2019s rain, heat or wind over the next 10 days. The change stays mostly near the area you changed.';
}
function renderImpact() {
  const has = !!S.mv;
  $('impactEmpty').hidden = has; $('impact').hidden = !has; $('step3').classList.toggle('dim', !has);
  if (!has) return;
  computeImpact();
  const { rain, heat, wAll, wTop } = S.impact, K = S.K;
  $('hdIf').textContent = `If ${S.sc.lead}…`; $('hdMain').textContent = headlineText();
  // farmers: biggest rain change + how many states dry out / get wetter / move into higher stress
  const dry = rain.filter((r) => r.dRain < 0).length, wet = rain.length - dry;
  if (rain.length) {
    const t = rain[0], parts = [];
    if (dry) parts.push(`${plural(dry, 'state')} get${dry === 1 ? 's' : ''} drier`); if (wet) parts.push(`${plural(wet, 'state')} get${wet === 1 ? 's' : ''} wetter`);
    $('farmBig').className = 's-big ' + (t.dRain < 0 ? 'up' : 'down');
    $('farmBig').innerHTML = `${sgn(t.dRain)} %<small>10-day rain in ${t.name}</small>`;
    $('farmTxt').textContent = `${parts.join(' and ')} by 10 % or more. ${K.worse ? plural(K.worse, 'state') + ' move' + (K.worse === 1 ? 's' : '') + ' into higher farm-stress risk.' : 'No state moves into higher farm-stress risk.'}`;
  } else {
    $('farmBig').className = 's-big flat'; $('farmBig').innerHTML = '0 %<small>rain change anywhere above 10 %</small>';
    $('farmTxt').textContent = K.worse ? `${plural(K.worse, 'state')} still move${K.worse === 1 ? 's' : ''} into higher farm-stress risk (heat).` : 'Sowing conditions stay about the same in every state.';
  }
  // heat
  const more = heat.filter((x) => x.d > 0), less = heat.filter((x) => x.d < 0);
  if (more.length) { $('heatBig').className = 's-big up'; $('heatBig').innerHTML = `+${more[0].d}<small>extra hot ${more[0].d === 1 ? 'day' : 'days'} in ${more[0].r.name}</small>`; $('heatTxt').textContent = `${plural(more.length, 'state')} ${more.length === 1 ? 'gets' : 'get'} more days hotter than the usual hottest 5 % for the season.`; }
  else if (less.length) { $('heatBig').className = 's-big down'; $('heatBig').innerHTML = `−${Math.abs(less[0].d)}<small>fewer hot ${Math.abs(less[0].d) === 1 ? 'day' : 'days'} in ${less[0].r.name}</small>`; $('heatTxt').textContent = `${plural(less.length, 'state')} ${less.length === 1 ? 'gets' : 'get'} fewer unusually hot days.`; }
  else { $('heatBig').className = 's-big flat'; $('heatBig').innerHTML = '0<small>extra hot days</small>'; $('heatTxt').textContent = 'No state gets more days hotter than the usual hottest 5 % for the season.'; }
  // wind
  $('windBig').className = 's-big ' + (wAll < -0.5 ? 'up' : wAll > 0.5 ? 'down' : 'flat');
  $('windBig').innerHTML = `${sgn(wAll, 1)} %<small>wind-farm output</small>`;
  $('windTxt').textContent = `Estimated across the 6 windiest states. Biggest swing: ${wTop.name} (${sgn(wTop.dPct, 1)} %).`;
  const sc = S.sc; $('scSum').hidden = false;
  $('scSum').textContent = `You changed ${sc.what} over ${sc.area}${sc.coord ? ' (' + sc.coord + ')' : ''}.`;
}
function boxCoord(b) { return `${lat(b.i0) - 0.5}–${lat(b.i1) + 0.5}°N, ${lon(b.j0) - 0.5}–${lon(b.j1) + 0.5}°E`; }

// ---------- trust strip ----------
function renderTrust() {
  const r = S.rip;
  $('tLocal').textContent = r && isFinite(r.fracInside[0]) ? (r.fracInside[0] * 100).toFixed(1) + ' %' : '– %';
  if (r) {
    const x = r.inside.map((_, i) => i + 1), fl = (a) => a.map((q) => Math.max(q, 1e-12));
    trustChart.set([{ name: 'in your area', x, y: fl(r.inside), color: '#22d3ee' }, { name: 'elsewhere', x, y: fl(r.outside), color: '#fb923c' }], { marker: S.day, log: true, fmt: (q) => q.toExponential(1) });
  } else trustChart.set([]);
  $('trustCap').textContent = r ? 'How much the forecast changed each day (log scale). Blue: inside your area. Orange: everywhere else. It starts small and grows slowly day by day: the change spreads outward, it never jumps across the country.' : 'Run a what-if in step 2 to see how the change spreads out from your area.';
  const n = S.nullState;
  $('tNull').textContent = !n ? '–' : n.run ? '…' : n.ok ? '✔ passed' : '✘ failed';
  $('tNullTxt').textContent = !n || n.run ? 'No change in → exactly the same forecast out. Testing live…' : n.ok ? 'No change in → exactly the same forecast out (tested live just now: the difference is exactly 0).' : `Forecasts differ by up to ${n.m.toExponential(1)}: investigate.`;
}
async function runNull() {
  if (!S.init || !S.healthy) return;
  S.nullState = { run: true }; renderTrust(); busy(true);
  try {
    const [a, b] = await Promise.all([S.api.run(S.init, S.doy, null), S.api.run(S.init, S.doy, new Float32Array(NCH * NCELL))]);
    const m = maxAbsDiff(a.roll, b.roll); S.nullState = { ok: m === 0, m };
  } catch (e) { S.nullState = null; toast(e.message); } finally { busy(false); renderTrust(); }
}

// ---------- model calls ----------
function toast(msg) { showBanner(msg); }
function showBanner(msg) { $('sBannerTxt').textContent = msg; $('sBanner').hidden = false; $('sServer').value = S.api.url; }
function hideBanner() { $('sBanner').hidden = true; }
function setSpeed(ms) { if (ms) $('bSpeed').textContent = `${(Math.max(ms, 50) / 1000).toFixed(1)} s per forecast`; }

async function runBase() {
  if (!S.init) return;
  const id = ++S.runId; busy(true, 'Running the AI forecast…');
  try {
    const r = await S.api.run(S.init, S.doy, null); if (id !== S.runId) return;
    S.prime = r.roll; S.msP = r.ms; S.mv = null; S.rip = null; S.cache = {}; setSpeed(r.ms); hideBanner(); renderAll();
  } catch (e) { showBanner(e.message + '. Start it with: python serve.py'); } finally { busy(false); }
}
async function runWhatIf(sc) {
  if (!S.init) return;
  if (!S.healthy) return showBanner(`Cannot reach the model server at ${S.api.url}. Start it with: python serve.py`);
  const last = S.init.subarray(2 * NCH * NCELL), box = boxFromLatLon(...sc.box0 || sc.box), { pert, clamped } = buildPerturbation(last, box, sc.comps);
  const id = ++S.runId; S.sc = { ...sc, coord: boxCoord(box) }; S.box = box; busy(true, 'Running the AI twice: normal and what-if…');
  try {
    const [base, shk] = await Promise.all([S.api.run(S.init, S.doy, null), S.api.run(S.init, S.doy, pert)]);
    if (id !== S.runId) return;
    if (shk.roll.some((x) => !Number.isFinite(x))) throw new Error('The model returned invalid numbers for this what-if.');
    S.prime = base.roll; S.msP = base.ms; S.mv = shk.roll; S.msM = shk.ms; S.mvInit = Float32Array.from(last, (x, k) => x + pert[k]);
    S.shock = { box: { ...box }, comps: sc.comps.map((c) => ({ ...c })), desc: sc.what, short: sc.what };
    S.rip = ripple(S.prime, S.mv, box); S.cache = {}; setSpeed(base.ms); hideBanner();
    S.v = Math.max(0, VARS.findIndex((v) => v.key === sc.focus)); S.mode = 'diff';
    const FD = fields(S.v).D.map((f) => f.reduce((m, x) => Math.max(m, Math.abs(x)), 0)); S.day = Math.max(2, FD.indexOf(Math.max(...FD)) + 1); // open on the day the change is largest (not day 1)
    renderAll();
    document.querySelectorAll('.s-card').forEach((b) => b.classList.toggle('on', b.dataset.id === sc.id));
    $('sSteps').scrollTo({ top: $('step3').offsetTop - 6 });
    if (clamped) showBanner('Note: rain and humidity changes were limited so the changed state stays above zero.');
  } catch (e) { showBanner(e.message); } finally { busy(false); }
}
function renderAll() { render(); renderImpact(); renderTrust(); }

// ---------- scenario / start date ----------
async function loadSample(file) {
  try {
    const js = await (await fetch('samples/' + file)).json(), st = js.init_states;
    S.file = file; S.init = flatten(st); S.doy = js.doy_sincos.map(Number); S.name = js.name; S.prime = S.mv = S.mvInit = S.rip = S.shock = null; S.cache = {}; S.nullState = null;
    const had = S.sc; S.day = 1; S.mode = 'normal'; S.box = S.customOpen ? S.box : null; $('scSum').hidden = true; document.querySelectorAll('.s-card').forEach((b) => b.classList.remove('on'));
    renderAll();
    if (S.healthy) { await runBase(); if (had && had.id !== 'custom' && S.prime) { /* keep the base view; the user re-clicks a card for the new date */ } }
  } catch (e) { showBanner('Could not load start date: ' + e.message); }
}

// ---------- map interaction: hover + drag box (custom mode) ----------
function bindMap() {
  const cv = $('sMap'), tip = $('sTip'); let down = null;
  const clear = () => (tip.hidden = true);
  cv.addEventListener('mousemove', (e) => {
    const cell = map.cellAt(e);
    if (down && cell && (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || down.moved)) { down.moved = true; map.set({ dragBox: { i0: Math.min(down.cell.i, cell.i), i1: Math.max(down.cell.i, cell.i), j0: Math.min(down.cell.j, cell.j), j1: Math.max(down.cell.j, cell.j) } }); }
    if (!cell) return clear();
    const v = VARS[S.v], F = fields(S.v), d = S.day - 1, k = cell.i * NLON + cell.j;
    let h = `<b>${lat(cell.i).toFixed(1)}°N, ${lon(cell.j).toFixed(1)}°E</b>`;
    if (F) {
      h += `<br>Normal: <b>${nf2(F.P[d][k])}</b> ${v.unit}`;
      if (S.mv) h += `<br>What-if: <b>${nf2(F.M[d][k])}</b> ${v.unit}<br>Change: <b>${sgn(F.D[d][k], 2)}</b> ${v.unit}`;
    }
    tip.innerHTML = h; tip.hidden = false; tip.style.left = Math.min(e.clientX + 14, innerWidth - 200) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - 110) + 'px';
  });
  cv.addEventListener('mouseleave', clear);
  cv.addEventListener('mousedown', (e) => { if (!S.customOpen) return; const cell = map.cellAt(e); if (cell) { down = { cell, x: e.clientX, y: e.clientY, moved: false }; e.preventDefault(); } });
  window.addEventListener('mouseup', (e) => {
    if (!down) return; const dn = down; down = null; map.set({ dragBox: null });
    const c2 = map.cellAt(e) || dn.cell;
    if (dn.moved) { S.mode = 'normal'; S.box = { i0: Math.min(dn.cell.i, c2.i), i1: Math.max(dn.cell.i, c2.i), j0: Math.min(dn.cell.j, c2.j), j1: Math.max(dn.cell.j, c2.j) }; $('cuWhere').value = 'drawn'; render(); }
  });
}
const nf2 = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));

// ---------- custom what-if ----------
function customSetup() {
  $('cuWhat').innerHTML = CUSTOM_WHAT.map((w, i) => `<option value="${i}">${w.label}</option>`).join('');
  $('cuWhere').innerHTML = REGIONS.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
  const sync = () => { const w = CUSTOM_WHAT[+$('cuWhat').value], a = $('cuAmt'); a.min = w.min; a.max = w.max; a.step = w.step; a.value = w.def; $('cuOut').textContent = w.fmtv(w.def); };
  $('cuWhat').onchange = sync; $('cuAmt').oninput = () => ($('cuOut').textContent = CUSTOM_WHAT[+$('cuWhat').value].fmtv(+$('cuAmt').value));
  $('cuWhere').onchange = () => { const r = REGIONS.find((x) => x.id === $('cuWhere').value); if (r.box) S.box = boxFromLatLon(...r.box); S.mode = 'normal'; render(); };
  sync();
  $('cuRun').onclick = () => {
    const w = CUSTOM_WHAT[+$('cuWhat').value], amt = +$('cuAmt').value, r = REGIONS.find((x) => x.id === $('cuWhere').value);
    if (amt === 0) return showBanner('Move the slider away from zero to change something.');
    let box0 = r.box;
    if (!box0) { if (!S.box) return showBanner('Drag a box on the map first.'); box0 = [lat(S.box.i0), lat(S.box.i1), lon(S.box.j0), lon(S.box.j1)]; }
    runWhatIf({ id: 'custom', box0, comps: w.build(amt), what: w.text(amt), area: r.box ? r.name : 'the area you drew', lead: `${w.text(amt)} over ${r.box ? r.name : 'the area you drew'}`, focus: w.focus });
  };
}
function openCustom(on) {
  S.customOpen = on; $('custom').hidden = !on; $('sMapWrap').classList.toggle('draw', on);
  document.querySelectorAll('.s-card').forEach((b) => b.classList.toggle('on', on ? b.dataset.id === 'custom' : b.dataset.id === (S.sc && S.sc.id)));
  if (on) { const r = REGIONS.find((x) => x.id === $('cuWhere').value); if (r.box) S.box = boxFromLatLon(...r.box); S.mode = 'normal'; render(); $('custom').scrollIntoView({ block: 'nearest' }); }
}

// ---------- health ----------
async function checkHealth() {
  const h = await S.api.health(), was = S.healthy; S.healthy = h.ok; const b = $('bHealth');
  b.className = 's-badge ' + (h.ok ? '' : h.status === 'loading' ? 'warm' : 'bad'); b.textContent = h.ok ? 'AI model ready' : h.status === 'loading' ? 'AI model loading…' : 'AI model not reachable';
  if (h.ok && !was) { hideBanner(); if (S.init && !S.prime && !S.busy) runBase(); }
  if (!h.ok && !was && S.init) showBanner(`Cannot reach the model server at ${S.api.url}. Start it with: python serve.py`);
}
function checkOffline() {
  let origin = ''; try { origin = new URL(S.api.url).origin; } catch (_) { /* ignore */ }
  const ext = performance.getEntriesByType('resource').filter((r) => { try { const o = new URL(r.name).origin; return o !== location.origin && o !== origin && !r.name.startsWith('data:'); } catch (_) { return false; } });
  const b = $('bOffline'); b.className = 's-badge' + (ext.length ? ' bad' : ''); b.title = ext.length ? `${ext.length} request(s) left this computer` : 'Verified live: 0 requests left this computer. The model runs here, with no internet.';
}

// ---------- views ----------
let expertMod = null;
async function showExpert(tab) {
  document.body.dataset.view = 'expert'; $('expert').hidden = false; play(false);
  if (!expertMod) expertMod = await import('./main.js');
  await expertMod.ready;
  if (S.init) expertMod.adopt({ init: S.init, doy: S.doy, name: S.name, prime: S.prime, mv: S.mv, msP: S.msP, msM: S.msM, mvInit: S.mvInit, shock: S.shock, box: S.box, comps: S.sc ? S.sc.comps : [], file: S.file, tab: tab || (S.mv ? 'ripple' : undefined) });
  window.dispatchEvent(new Event('resize'));
}
function showStory() { document.body.dataset.view = 'story'; $('expert').hidden = true; setTimeout(render, 30); }
function play(on) {
  S.playing = on; $('sPlay').innerHTML = on ? '&#10074;&#10074; Pause' : '&#9654; Play forecast'; clearInterval(S.timer);
  if (on) S.timer = setInterval(() => setDay(S.day >= 10 ? 1 : S.day + 1), 700);
}
function setDay(d) { S.day = Math.max(1, Math.min(10, d)); render(); if (S.rip) trustChart.set(trustChart.series, { marker: S.day }); }

// ---------- init ----------
async function init() {
  const [outlines, grid, heat, rainClim, idx] = await Promise.all(['assets/outlines.json', 'assets/grid_states.json', 'assets/heat_p95.json', 'assets/rain_clim.json', 'samples/index.json'].map((u) => fetch(u).then((r) => r.json())));
  S.outlines = outlines; S.assets = { grid, heat, rainClim }; S.samples = idx;
  map = new MapPanel($('sMap'), outlines); trustChart = new LineChart($('cvTrust'), { log: true, fmt: (v) => v.toExponential(1) });
  bindMap();
  $('selDate').innerHTML = idx.map((s) => `<option value="${s.file}">${s.date_label} — ${DATE_WORDS[s.file] || s.name}</option>`).join('');
  $('chipVar').innerHTML = VARS.map((v, i) => `<button class="s-chip" data-i="${i}" title="${v.tip}">${svg(v.key)}${v.short || v.name}</button>`).join('');
  document.querySelectorAll('#chipVar .s-chip').forEach((b) => (b.onclick = () => { S.v = +b.dataset.i; render(); }));
  $('cards').innerHTML = SCENARIOS.map((s) => `<button class="s-card" data-id="${s.id}" title="Runs the AI with: ${s.what} over ${s.area} (${s.box[0]}–${s.box[1]}°N, ${s.box[2]}–${s.box[3]}°E)">${svg(s.icon)}<strong>${s.title}</strong><span>${s.line}</span></button>`).join('')
    + `<button class="s-card" data-id="custom" title="Choose what to change, by how much, and where">${svg('custom')}<strong>Draw your own</strong><span>Pick what, how much, where.</span></button>`;
  document.querySelectorAll('.s-card').forEach((b) => (b.onclick = () => {
    if (b.dataset.id === 'custom') return openCustom(!S.customOpen);
    openCustom(false); runWhatIf(SCENARIOS.find((s) => s.id === b.dataset.id));
  }));
  customSetup();
  document.querySelectorAll('#segMode button').forEach((b) => (b.onclick = () => { if (!b.disabled) { S.mode = b.dataset.mode; render(); } }));
  $('selDate').onchange = (e) => loadSample(e.target.value);
  $('sPlay').onclick = () => play(!S.playing); $('sDay').oninput = (e) => setDay(+e.target.value);
  $('sNull').onclick = (e) => { e.preventDefault(); runNull(); };
  $('trust').addEventListener('toggle', () => { if ($('trust').open) { if (!S.nullState) runNull(); setTimeout(() => { trustChart.draw(); $('sSteps').scrollTo({ top: $('sSteps').scrollHeight }); }, 60); } });
  document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => showExpert(b.dataset.open)));
  $('btnExpert').onclick = () => showExpert(); $('btnStory').onclick = showStory;
  $('sRetry').onclick = () => { S.api.base = $('sServer').value.trim(); try { localStorage.setItem('mm_server', S.api.url); } catch (e) { /* ignore */ } checkHealth().then(() => S.init && S.healthy && runBase()); };
  window.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'story' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === ' ') { e.preventDefault(); play(!S.playing); } else if (e.key === 'ArrowRight') setDay(S.day + 1); else if (e.key === 'ArrowLeft') setDay(S.day - 1);
  });
  window.addEventListener('resize', () => { render(); setTimeout(fitCaption, 60); });
  new ResizeObserver(() => setTimeout(fitCaption, 30)).observe($('sMapWrap'));
  if (new URLSearchParams(location.search).get('view') === 'expert') showExpert();
  setInterval(checkHealth, 4000); setInterval(checkOffline, 3000);
  render(); renderImpact(); renderTrust(); await checkHealth(); checkOffline();
  await loadSample(idx[0].file); checkOffline();
}
init().catch((e) => { console.error(e); showBanner('The dashboard failed to start: ' + e.message); });
