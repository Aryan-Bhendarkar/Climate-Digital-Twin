// What can be shown on the map, how each field is derived from a rollout, and per-bundle cached fields.
import { NCELL, rIdx, stepsOf } from '@lib/util.js';
import { nice125 } from './scales.js';

export const VARS = [
  { key: 't2m', name: 'Temperature', unit: '°C', dec: 1, dcmap: 'rdbu', floor: 0.1, ch: 0,
    f: (r, d, k) => r[rIdx(d, 0) + k] - 273.15,
    tip: 'Air temperature 2 m above ground, in °C.', words: 'Redder = hotter', dwords: 'Red = warmer than normal, blue = cooler', dends: ['cooler', 'warmer'], noun: 'temperature' },
  { key: 'tp', name: 'Rain', unit: 'mm/day', dec: 1, dcmap: 'brbg', floor: 0.15, ch: 1, sqrt: true,
    f: (r, d, k) => r[rIdx(d, 1) + k],
    tip: 'Rain that falls in a day, in mm. 10 mm is a good shower.', words: 'Darker blue = heavier rain', dwords: 'Brown = drier than normal, teal = wetter', dends: ['drier', 'wetter'], noun: 'rain' },
  { key: 'wind', name: 'Wind', unit: 'km/h', dec: 0, dcmap: 'puor', floor: 0.5, ch: 2,
    f: (r, d, k) => Math.hypot(r[rIdx(d, 2) + k], r[rIdx(d, 3) + k]) * 3.6,
    tip: 'Wind speed 10 m up, in km/h.', words: 'Darker violet = stronger wind', dwords: 'Orange = calmer than normal, violet = windier', dends: ['calmer', 'windier'], noun: 'wind speed' },
  { key: 'tcwv', name: 'Moisture in the air', short: 'Moisture', unit: 'mm of water', dec: 0, dcmap: 'brbg', floor: 0.3, ch: 5,
    f: (r, d, k) => r[rIdx(d, 5) + k],
    tip: 'How much water is in the air above each spot, in mm if it all fell as rain.', words: 'Darker teal = moister air', dwords: 'Brown = drier air than normal, teal = moister', dends: ['drier', 'moister'], noun: 'moisture in the air' },
  { key: 'msl', name: 'Pressure', unit: 'hPa', dec: 0, dcmap: 'puor', floor: 0.15, ch: 4,
    f: (r, d, k) => r[rIdx(d, 4) + k] / 100,
    tip: 'Air pressure at sea level. Low pressure brings storms.', words: 'Yellow = higher pressure, dark blue = lower (storm-prone)', dwords: 'Orange = lower pressure than normal, violet = higher', dends: ['lower', 'higher'], noun: 'pressure' },
];
export const varIndex = (key) => Math.max(0, VARS.findIndex((v) => v.key === key));

function fieldOf(roll, d, v) { const o = new Float32Array(NCELL); for (let k = 0; k < NCELL; k++) o[k] = v.f(roll, d, k); return o; }

/** bundle: {id, prime, mv, cache:{}}. Returns {P,M,D,A,quiet} for variable index vi. A = locked symmetric Difference limit (1-2-5). */
export function bundleFields(bundle, vi) {
  if (!bundle) return null;
  if (bundle.cache[vi]) return bundle.cache[vi];
  const v = VARS[vi], n = stepsOf(bundle.prime), F = { P: [], M: [], D: [], A: 0, quiet: false };
  for (let d = 0; d < n; d++) {
    F.P.push(fieldOf(bundle.prime, d, v));
    if (bundle.mv) { const m = fieldOf(bundle.mv, d, v); F.M.push(m); F.D.push(m.map((x, k) => x - F.P[d][k])); }
  }
  if (F.D.length) {
    const ab = Float32Array.from({ length: n * NCELL }, (_, i) => Math.abs(F.D[(i / NCELL) | 0][i % NCELL])).sort();
    const p = ab[Math.floor(0.985 * (ab.length - 1))];
    F.quiet = p < v.floor;
    F.A = Math.max(nice125(p), nice125(v.floor * 3));
  }
  return (bundle.cache[vi] = F);
}
