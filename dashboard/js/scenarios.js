// What-if definitions: presets, the five things you can change, strength scaling. Pure functions, no DOM.
import { NLAT, NLON, lat, lon } from './util.js';

export const sgn = (x, d = 0) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
export const num = (x) => String(Math.round(x * 10) / 10);

/** The quantities a what-if can change. min/max also mark the range we treat as believable. */
export const PARTS = [
  { id: 't2m', label: 'Temperature', word: 'temperature', unit: '°C', min: -5, max: 5, step: 0.5, chs: [0], mode: 'abs' },
  { id: 'tcwv', label: 'Humidity', word: 'humidity', unit: '%', min: -50, max: 50, step: 5, chs: [5], mode: 'pct' },
  { id: 'wind', label: 'Wind strength', word: 'wind', unit: '%', min: -60, max: 60, step: 5, chs: [2, 3], mode: 'pct' },
  { id: 'msl', label: 'Air pressure', word: 'pressure', unit: 'hPa', min: -10, max: 10, step: 1, chs: [4], mode: 'abs' },
  { id: 'tp', label: 'Rain on the start day', word: 'rain', unit: '%', min: -50, max: 50, step: 5, chs: [1], mode: 'pct' },
];

export const REGIONS = [
  { id: 'bob', name: 'Bay of Bengal', say: 'the Bay of Bengal', box: [8, 20, 82, 94] }, { id: 'arab', name: 'Arabian Sea', say: 'the Arabian Sea', box: [8, 20, 65, 75] },
  { id: 'chn', name: 'Sea off Chennai', say: 'the sea off Chennai', box: [10, 16, 81, 87] }, { id: 'raj', name: 'Rajasthan', say: 'Rajasthan', box: [24, 30, 69, 76] },
  { id: 'cen', name: 'Central India', say: 'central India', box: [18, 26, 76, 84] }, { id: 'gan', name: 'Gangetic plains', say: 'the Gangetic plains', box: [24, 30, 78, 88] },
  { id: 'north', name: 'North India', say: 'north India', box: [23, 31, 72, 84] }, { id: 'south', name: 'Southern peninsula', say: 'the southern peninsula', box: [8, 16, 74, 80] },
  { id: 'west', name: 'West coast', say: 'the west coast', box: [9, 19, 71, 76] }, { id: 'drawn', name: 'Drawn on the map', say: 'the area you drew', box: null },
];

export const SCENARIOS = [
  { id: 'bob', group: 'everyday', icon: 'bob', title: 'Warmer Bay of Bengal', area: 'the Bay of Bengal', box: [8, 20, 82, 94], values: { t2m: 3, tcwv: 15 }, focus: 'tp' },
  { id: 'weak', group: 'everyday', icon: 'weak', title: 'Weak monsoon winds', area: 'the Arabian Sea', box: [8, 20, 65, 75], values: { wind: -40 }, focus: 'wind' },
  { id: 'arab', group: 'everyday', icon: 'arab', title: 'Warmer Arabian Sea', area: 'the Arabian Sea', box: [8, 20, 65, 75], values: { t2m: 2.5 }, focus: 't2m' },
  { id: 'dry', group: 'everyday', icon: 'dry', title: 'Dry Rajasthan', area: 'Rajasthan', box: [24, 30, 69, 76], values: { tcwv: -40 }, focus: 'tcwv' },
  { id: 'lowp', group: 'everyday', icon: 'lowp', title: 'Low over Bengal', area: 'Bengal', box: [20, 26, 85, 92], values: { msl: -5 }, focus: 'msl' },
  { id: 'heat', group: 'extreme', icon: 'heat', title: 'Northern heatwave', area: 'north India', box: [23, 31, 72, 84], values: { t2m: 4, tcwv: -20 }, focus: 't2m' },
  { id: 'drought', group: 'extreme', icon: 'dry', title: 'Central dry spell', area: 'central India', box: [17, 25, 74, 84], values: { tcwv: -35, tp: -50, msl: 3 }, focus: 'tp' },
  { id: 'burst', group: 'extreme', icon: 'rain', title: 'West coast downpour', area: 'the west coast', box: [9, 19, 71, 76], values: { tcwv: 30, tp: 50, wind: 30 }, focus: 'tp' },
  { id: 'storm', group: 'extreme', icon: 'lowp', title: 'Storm off Chennai', note: 'Only a starting push: the model tends to fade storms.', area: 'the sea off Chennai', box: [10, 16, 81, 87], values: { msl: -8, tcwv: 25, wind: 40, tp: 50 }, focus: 'tp' },
];

export const MIN_STRENGTH = 0.25, MAX_STRENGTH = 3;

/** values {partId: amount} -> the parts that change at this strength (percent changes cannot go below -100). */
export function activeParts(values, strength = 1) {
  return PARTS.filter((p) => values[p.id]).map((p) => ({ ...p, value: p.mode === 'pct' ? Math.max(-100, values[p.id] * strength) : values[p.id] * strength }));
}
/** Components in the format shock.js buildPerturbation expects. */
export const compsFor = (values, strength = 1) => activeParts(values, strength).flatMap((p) => p.chs.map((ch) => ({ ch, mode: p.mode, value: p.value })));
export const amountText = (p) => `${sgn(p.value, p.value % 1 ? 1 : 0)} ${p.unit}`;
export const outOfRange = (values, strength = 1) => activeParts(values, strength).filter((p) => p.value > p.max || p.value < p.min);
export function describe(values, strength = 1) {
  const t = activeParts(values, strength).map((p) => `${p.word} ${amountText(p)}`);
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}` : t[0] || 'nothing';
}

/** The scenario as the question the map answers. */
export function questionText(values, strength, area) {
  const air = [], other = [];
  for (const p of activeParts(values, strength)) {
    const n = num(Math.abs(p.value)), up = p.value > 0;
    if (p.id === 't2m') air.push(`${n} °C ${up ? 'warmer' : 'colder'}`);
    else if (p.id === 'tcwv') air.push(`${n} % ${up ? 'more humid' : 'drier'}`);
    else if (p.id === 'wind') other.push(['winds', `${n} % ${up ? 'stronger' : 'weaker'}`]);
    else if (p.id === 'msl') other.push(['pressure', `${n} hPa ${up ? 'higher' : 'lower'}`]);
    else other.push(['starting rain', `${n} % ${up ? 'heavier' : 'lighter'}`]);
  }
  const join = (a) => (a.length < 2 ? a[0] : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`), also = (a) => a.map(([w, t]) => `, with ${w} ${t}`).join('');
  if (air.length) return `What if the air over ${area} were ${join(air)}${also(other)}?`;
  if (!other.length) return null;
  const [[what, how], ...rest] = other;
  return `What if ${what} over ${area} were ${how}${also(rest)}?`;
}

/** A random but sensible what-if, for testing the model with something nobody prepared. */
export function randomScenario(rand = Math.random) {
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const h = int(4, 9), w = int(4, 9), i0 = int(0, NLAT - h), j0 = int(0, NLON - w);
  const pool = [...PARTS], values = {};
  for (let n = int(1, 2); n > 0; n--) {
    const p = pool.splice(int(0, pool.length - 1), 1)[0], steps = int(Math.ceil(p.max / p.step / 3), Math.round(p.max / p.step));
    values[p.id] = (rand() < 0.5 ? -1 : 1) * steps * p.step;
  }
  const box = [lat(i0), lat(i0 + h - 1), lon(j0), lon(j0 + w - 1)];
  return { id: 'random', title: 'Random scenario',area: `a random area (${box[0]}–${box[1]}°N, ${box[2]}–${box[3]}°E)`, box, values, focus: Object.keys(values)[0] };
}
