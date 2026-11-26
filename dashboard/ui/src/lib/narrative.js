// Plain-language layer: scenarios (as questions), headline and impact figures. Impact numbers come from js/impact.js (shared with v1).
import { kharif, windIndex } from '@lib/impact.js';

export const sgn = (x, d = 0) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
export const nb = (s) => s.replace(/ %/g, '\u00A0%');
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const joinNames = (a) => (a.length === 1 ? a[0] : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

export const DATE_WORDS = {
  'onset.json': 'monsoon arriving in Kerala', 'heavy_rain.json': 'heavy monsoon rain', 'heatwave.json': 'severe heatwave',
  'cyclone.json': 'Cyclone Amphan', 'western_disturbance.json': 'winter storm from the west',
};

// icon names map to lucide components in components/icons.jsx
export const SCENARIOS = [
  { id: 'bob', icon: 'thermo', title: 'What if the air over the Bay of Bengal is 3 °C warmer and moister?', lead: 'the air over the Bay of Bengal is 3 °C warmer and moister', area: 'the Bay of Bengal',
    box: [8, 20, 82, 94], comps: [{ ch: 0, mode: 'abs', value: 3 }, { ch: 5, mode: 'pct', value: 15 }], what: 'temperature +3 °C and moisture +15 %', focus: 'tp' },
  { id: 'weak', icon: 'wind', title: 'What if monsoon winds over the Arabian Sea weaken by 40 %?', lead: 'monsoon winds over the Arabian Sea weaken by 40 %', area: 'the Arabian Sea',
    box: [8, 20, 65, 75], comps: [{ ch: 2, mode: 'pct', value: -40 }, { ch: 3, mode: 'pct', value: -40 }], what: 'wind strength −40 %', focus: 'wind' },
  { id: 'arab', icon: 'thermo', title: 'What if the Arabian Sea air is 2.5 °C warmer?', lead: 'the Arabian Sea air is 2.5 °C warmer', area: 'the Arabian Sea',
    box: [8, 20, 65, 75], comps: [{ ch: 0, mode: 'abs', value: 2.5 }], what: 'temperature +2.5 °C', focus: 't2m' },
  { id: 'dry', icon: 'droplet', title: 'What if the air over Rajasthan is 40 % drier?', lead: 'the air over Rajasthan is 40 % drier', area: 'Rajasthan',
    box: [24, 30, 69, 76], comps: [{ ch: 5, mode: 'pct', value: -40 }], what: 'moisture −40 %', focus: 'tp' },
  { id: 'lowp', icon: 'gauge', title: 'What if pressure over Bengal drops 5 hPa?', lead: 'pressure over Bengal drops 5 hPa', area: 'Bengal',
    box: [20, 26, 85, 92], comps: [{ ch: 4, mode: 'abs', value: -5 }], what: 'pressure −5 hPa', focus: 'msl' },
];
export const CUSTOM_WHAT = [
  { id: 't2m', label: 'Temperature', min: -5, max: 5, step: 0.5, def: 2, fmtv: (v) => `${sgn(v, 1)} °C`, build: (v) => [{ ch: 0, mode: 'abs', value: v }], text: (v) => `temperature ${sgn(v, 1)} °C`, focus: 't2m' },
  { id: 'tcwv', label: 'Moisture in the air', min: -50, max: 50, step: 5, def: -30, fmtv: (v) => `${sgn(v)} %`, build: (v) => [{ ch: 5, mode: 'pct', value: v }], text: (v) => `moisture ${sgn(v)} %`, focus: 'tp' },
  { id: 'wind', label: 'Wind strength', min: -60, max: 60, step: 5, def: -40, fmtv: (v) => `${sgn(v)} %`, build: (v) => [{ ch: 2, mode: 'pct', value: v }, { ch: 3, mode: 'pct', value: v }], text: (v) => `wind strength ${sgn(v)} %`, focus: 'wind' },
  { id: 'msl', label: 'Pressure', min: -10, max: 10, step: 1, def: -5, fmtv: (v) => `${sgn(v)} hPa`, build: (v) => [{ ch: 4, mode: 'abs', value: v }], text: (v) => `pressure ${sgn(v)} hPa`, focus: 'msl' },
  { id: 'tp', label: 'Rain on the start day', min: -50, max: 50, step: 5, def: 30, fmtv: (v) => `${sgn(v)} %`, build: (v) => [{ ch: 1, mode: 'pct', value: v }], text: (v) => `rain ${sgn(v)} %`, focus: 'tp' },
];
export const REGIONS = [
  { id: 'bob', name: 'Bay of Bengal', box: [8, 20, 82, 94] }, { id: 'arab', name: 'Arabian Sea', box: [8, 20, 65, 75] },
  { id: 'raj', name: 'Rajasthan', box: [24, 30, 69, 76] }, { id: 'cen', name: 'Central India', box: [18, 26, 76, 84] },
  { id: 'gan', name: 'Gangetic plains', box: [24, 30, 78, 88] }, { id: 'south', name: 'Southern peninsula', box: [8, 16, 74, 80] },
  { id: 'drawn', name: 'Area I draw on the map', box: null },
];
export const CITIES = [
  { lon: 77.2, lat: 28.6, text: 'Delhi' }, { lon: 72.9, lat: 19.1, text: 'Mumbai' }, { lon: 88.4, lat: 22.6, text: 'Kolkata' },
  { lon: 80.3, lat: 13.1, text: 'Chennai' }, { lon: 77.6, lat: 12.97, text: 'Bengaluru' }, { lon: 78.5, lat: 17.4, text: 'Hyderabad' },
  { lon: 72.6, lat: 23.0, text: 'Ahmedabad' }, { lon: 75.8, lat: 26.9, text: 'Jaipur' }, { lon: 80.9, lat: 26.8, text: 'Lucknow' }, { lon: 91.7, lat: 26.1, text: 'Guwahati' },
];
export const SEAS = [{ lon: 68.5, lat: 14.5, text: 'Arabian Sea' }, { lon: 88.5, lat: 13.5, text: 'Bay of Bengal' }];

const SKIP = new Set(['ISL', 'UT']); // tiny island/UT groups: not farming regions, would dominate headlines
function filterK(K) { const rows = K.rows.filter((r) => !SKIP.has(r.id)); return { ...K, rows, worse: rows.filter((r) => r.dStress > 0).length, better: rows.filter((r) => r.dStress < 0).length }; }

// ---------- ONE place for every rain number on screen (headline, card, bars, range, expert table) ----------
export const LOW_RAIN_MM = 5;      // normal 10-day rain below this: show the change in mm, never in %, never headline it
export const HEADLINE_PCT = 10;    // a state's rain must move at least this much (%) to be named in the headline
export const HEAT_MIN_DAYS = 2;    // smaller changes in very hot days are noise: show "no notable change"
export const HEAT_DEF = 'Very hot day: the state’s average temperature that day is above its hottest 5 % of days for that month (2005–2018).';
export const lowBase = (row) => row.p.total < LOW_RAIN_MM;
export const dMm = (row) => row.m.total - row.p.total;
/** The value a state's rain change is ranked and shown by: % normally, mm when the normal 10-day rain is tiny. */
export const rainVal = (row) => (lowBase(row) ? dMm(row) : row.dRain);
/** Rounding used everywhere for a state's rain change (so headline == card == bar). */
export function fmtRain(row) {
  if (lowBase(row)) { const d = dMm(row); return nb(`${sgn(d, 1)} mm`); }
  const x = row.dRain; return nb(`${sgn(x, Math.abs(x) < 10 ? 1 : 0)} %`);
}
/** Same rounding for a bare % / mm number (used by the size range). */
export const fmtPct = (x) => nb(`${sgn(x, Math.abs(x) < 10 ? 1 : 0)} %`);
export const fmtMm = (x) => nb(`${sgn(x, 1)} mm`);
/** Rounded numeric value as displayed (so range checks compare like with like). */
export const shownPct = (x) => +x.toFixed(Math.abs(x) < 10 ? 1 : 0);

/** Same derivation as v1 (story.js computeImpact), built on js/impact.js. */
export function computeImpact(prime, mv, assets, doySC) {
  const K = filterK(kharif(prime, mv, assets, doySC)), W = windIndex(prime, mv, assets);
  // states eligible to be named: real normal rain and a change of at least HEADLINE_PCT
  const rain = K.rows.filter((r) => !lowBase(r) && Math.abs(r.dRain) >= HEADLINE_PCT).sort((a, b) => Math.abs(b.dRain) - Math.abs(a.dRain));
  const heat = K.rows.map((r) => ({ r, d: r.m.heat - r.p.heat })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const wsumP = W.reduce((a, w) => a + w.pMean, 0), wsumM = W.reduce((a, w) => a + w.mMean, 0), wAll = wsumP > 0.01 ? ((wsumM - wsumP) / wsumP) * 100 : 0;
  const wTop = [...W].sort((a, b) => Math.abs(b.dPct) - Math.abs(a.dPct))[0];
  return { K, W, rain, heat, wAll, wTop };
}

/** Bars: strongest |effect| first, small ones summarised at the end. Shared by the side panel and the e2e test. */
export function stateBars(K, n = 8) {
  // % rows (real normal rain) first, strongest |change| first; then near-dry states (mm), which are never comparable to %
  const rows = [...K.rows].sort((a, b) => (lowBase(a) - lowBase(b)) || (Math.abs(rainVal(b)) - Math.abs(rainVal(a))));
  const big = rows.filter((x) => (lowBase(x) ? Math.abs(dMm(x)) >= 0.5 : Math.abs(x.dRain) >= 2));
  const shown = big.slice(0, n);
  return { rows, shown, hidden: rows.length - shown.length };
}

const word = (x) => (x < 0 ? 'drier' : 'wetter');
/** Rain headline: leads with the state with the largest change on the bars, adds a second same-direction state and the
 *  strongest opposite one. Each state carries its own bar value (fmtRain), no extra rounding. Returns {kind, text, ids, sub}. */
export function headline(imp) {
  const { rain } = imp;
  if (!rain.length) return { kind: 'small', text: `No state’s 10-day rain changes by ${HEADLINE_PCT} % or more.`, ids: [], sub: 'Change in 10-day rain, compared with the normal forecast (states with almost no normal rain are left out).' };
  const top = rain[0], same = rain.filter((r) => Math.sign(r.dRain) === Math.sign(top.dRain)).slice(0, 2), opp = rain.find((r) => Math.sign(r.dRain) !== Math.sign(top.dRain));
  const grp = (rows) => joinNames(rows.map((r) => `${r.name} ${fmtRain(r)}`)) + ` (${word(rows[0].dRain)})`;
  const text = `10-day rain: ${grp(same)}${opp ? '; ' + grp([opp]) : ''}.`;
  return { kind: 'rain', text: nb(text), ids: [...same, ...(opp ? [opp] : [])].map((r) => r.id), sub: 'Change in 10-day rain, compared with the normal forecast.' };
}

/** The three figures. Rain card = the headline's lead state, same number. */
export function figures(imp) {
  const { rain, heat, wAll, wTop, K } = imp, f = {};
  const dry = rain.filter((r) => r.dRain < 0).length, wet = rain.length - dry;
  if (rain.length) {
    const t = rain[0], parts = [];
    if (dry) parts.push(`${plural(dry, 'state')} drier`); if (wet) parts.push(`${plural(wet, 'state')} wetter`);
    f.farm = { value: t.dRain, text: fmtRain(t), where: t.name, id: t.id, line: `10-day rain in ${t.name}`, meaning: `${parts.join(', ')} by ${HEADLINE_PCT} % or more.` };
  } else f.farm = { value: 0, text: '0 %', where: null, id: null, muted: true, line: `No state changes by ${HEADLINE_PCT} % or more`, meaning: 'States with almost no normal rain are left out.' };
  const top = heat[0];
  if (top && Math.abs(top.d) >= HEAT_MIN_DAYS) {
    const n = Math.abs(top.d), up = top.d > 0;
    f.heat = { value: top.d, text: String(n), line: `${up ? 'more' : 'fewer'} very hot ${n === 1 ? 'day' : 'days'} in ${top.r.name}`, meaning: HEAT_DEF };
  } else f.heat = { value: 0, text: '', muted: true, line: 'No notable change in very hot days', meaning: HEAT_DEF + ` Changes of less than ${HEAT_MIN_DAYS} days are not shown.` };
  f.wind = { value: wAll, text: nb(sgn(wAll, 1) + ' %'), line: 'wind-farm output, 6 main wind-power states', meaning: `Average of Gujarat, Rajasthan, Tamil Nadu, Karnataka, Maharashtra and Andhra Pradesh. Biggest swing: ${wTop.name} (${sgn(wTop.dPct, 1)} %).` };
  return f;
}

// ---------- where is a grid cell (for "Strongest change on this map") ----------
let CELL_STATE = null;
export function whereIs(k, assets) {
  if (!assets) return '';
  if (!CELL_STATE) { CELL_STATE = new Map(); const best = new Map(); for (const [id, cells] of Object.entries(assets.grid.cells)) for (const [c, f] of cells) if (f > (best.get(c) || 0)) { best.set(c, f); CELL_STATE.set(c, id); } }
  const id = CELL_STATE.get(k);
  if (id && !SKIP.has(id)) return assets.grid.meta[id].name;
  const la = 6 + Math.floor(k / 36) + 0.5, lo = 65 + (k % 36) + 0.5, at = `${la.toFixed(0)}\u00B0N ${lo.toFixed(0)}\u00B0E`;
  if (la < 8) return `Indian Ocean (${at})`;
  if (lo < 77.5 && la < 25) return `Arabian Sea (${at})`;
  if (lo > 79.5 && lo < 99 && la < 22.5) return `Bay of Bengal (${at})`;
  return `outside India (${at})`;
}
