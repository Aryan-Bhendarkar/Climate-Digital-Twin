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

/** Same derivation as v1 (story.js computeImpact), built on js/impact.js. */
export function computeImpact(prime, mv, assets, doySC) {
  const K = filterK(kharif(prime, mv, assets, doySC)), W = windIndex(prime, mv, assets);
  const rain = K.rows.filter((r) => Math.abs(r.dRain) >= 10).sort((a, b) => Math.abs(b.dRain) - Math.abs(a.dRain));
  const heat = K.rows.map((r) => ({ r, d: r.m.heat - r.p.heat })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const wsumP = W.reduce((a, w) => a + w.pMean, 0), wsumM = W.reduce((a, w) => a + w.mMean, 0), wAll = wsumP > 0.01 ? ((wsumM - wsumP) / wsumP) * 100 : 0;
  const wTop = [...W].sort((a, b) => Math.abs(b.dPct) - Math.abs(a.dPct))[0];
  return { K, W, rain, heat, wAll, wTop };
}

const r5 = (x) => Math.round(x / 5) * 5 || Math.round(x);
/** Headline that names the strongest positive AND negative state effects when both exist. Returns {kind, text, ids, parts}. */
export function headline(imp) {
  const { rain, heat, wAll, wTop } = imp, nHeat = heat.filter((x) => x.d > 0).length;
  const neg = rain.filter((r) => r.dRain < 0).slice(0, 2), pos = rain.filter((r) => r.dRain > 0).slice(0, 2);
  const part = (rows) => ({ names: rows.map((r) => r.name), pct: r5(rows.reduce((a, r) => a + Math.abs(r.dRain), 0) / rows.length), ids: rows.map((r) => r.id) });
  const cands = [
    { kind: 'rain', score: rain.length ? Math.abs(rain[0].dRain) / 10 : 0, build: () => {
      const n = neg.length ? part(neg) : null, p = pos.length ? part(pos) : null, bits = [];
      if (n) bits.push(`${joinNames(n.names)} ~${n.pct} % drier`); if (p) bits.push(`${joinNames(p.names)} ~${p.pct} % wetter`);
      return { text: bits.join('; ') + '.', ids: [...(n ? n.ids : []), ...(p ? p.ids : [])], sub: 'Change in 10-day rain, compared with the normal forecast.' }; } },
    { kind: 'heat', score: nHeat && heat[0].d > 0 ? heat[0].d / 3 : 0, build: () => ({ text: `${plural(nHeat, 'state')} ${nHeat === 1 ? 'gets' : 'get'} extra very hot days, most in ${heat[0].r.name} (+${heat[0].d}).`, ids: [heat[0].r.id], sub: 'Days hotter than the usual hottest 5 % for the season, over 10 days.' }) },
    { kind: 'wind', score: Math.max(Math.abs(wAll) / 3, wTop ? Math.abs(wTop.dPct) / 12 : 0), build: () => ({ text: `Wind-farm output ${wAll < 0 ? 'falls' : 'rises'} ~${Math.max(1, Math.round(Math.abs(wAll)))} % across the 6 windiest states.`, ids: wTop ? [wTop.id] : [], sub: 'Estimated from 10-day wind speeds, compared with the normal forecast.' }) },
  ].sort((a, b) => b.score - a.score);
  if (cands[0].score >= 0.3) { const o = cands[0].build(); return { kind: cands[0].kind, ...o, text: nb(o.text) }; }
  return { kind: 'small', text: 'This change stays local. India’s rain, heat and wind barely move.', ids: [], sub: 'Over the next 10 days, compared with the normal forecast.' };
}

/** The three figures (identical logic to v1's cards). */
export function figures(imp) {
  const { rain, heat, wAll, wTop, K } = imp, f = {};
  const dry = rain.filter((r) => r.dRain < 0).length, wet = rain.length - dry;
  if (rain.length) {
    const t = rain[0], parts = [];
    if (dry) parts.push(`${plural(dry, 'state')} drier`); if (wet) parts.push(`${plural(wet, 'state')} wetter`);
    f.farm = { value: t.dRain, text: nb(sgn(t.dRain) + ' %'), where: t.name, id: t.id, line: `10-day rain in ${t.name}`, meaning: `${parts.join(', ')} by 10 % or more. ${K.worse ? plural(K.worse, 'state') + ' move into higher farm-stress risk.' : 'No state moves into higher farm-stress risk.'}` };
  } else f.farm = { value: 0, text: '0\u00A0%', where: null, line: 'rain change anywhere above 10 %', meaning: K.worse ? `${plural(K.worse, 'state')} still move into higher farm-stress risk (heat).` : 'Sowing conditions stay about the same in every state.' };
  const more = heat.filter((x) => x.d > 0), less = heat.filter((x) => x.d < 0);
  if (more.length) f.heat = { value: more[0].d, text: '+' + more[0].d, line: `extra very hot ${more[0].d === 1 ? 'day' : 'days'} in ${more[0].r.name}`, meaning: `${plural(more.length, 'state')} get more days hotter than the usual hottest 5 % for the season.` };
  else if (less.length) f.heat = { value: -Math.abs(less[0].d), text: '−' + Math.abs(less[0].d), line: `fewer very hot ${Math.abs(less[0].d) === 1 ? 'day' : 'days'} in ${less[0].r.name}`, meaning: `${plural(less.length, 'state')} get fewer unusually hot days.` };
  else f.heat = { value: 0, text: '0', line: 'No extra very hot days in any state', meaning: 'No extra very hot days in any state.' };
  f.wind = { value: wAll, text: nb(sgn(wAll, 1) + ' %'), line: 'wind-farm output', meaning: `Across the 6 windiest states. Biggest swing: ${wTop.name} (${sgn(wTop.dPct, 1)} %).` };
  return f;
}
