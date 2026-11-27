// Turns two live rollouts (normal, what-if) into answers: who feels it, what caused it, does the model behave. Pure, no DOM.
import { NLAT, NLON, NCELL, NCH, COSW, lat, lon, rIdx, stepsOf } from './util.js';
import { ripple, maxAbsDiff } from './shock.js';

// ---------- places ----------
export const cellIndex = (la, lo) => Math.max(0, Math.min(NLAT - 1, Math.floor(la - 6))) * NLON + Math.max(0, Math.min(NLON - 1, Math.floor(lo - 65)));

export const KINDS = {
  rain: { noun: 'rain', unit: 'mm/day', up: 'wetter', down: 'drier' },
  temp: { noun: 'temperature', unit: '°C', up: 'hotter', down: 'cooler' },
  wind: { noun: 'wind', unit: 'km/h', up: 'windier', down: 'calmer' },
};
/** Size of a daily change (what-if minus normal) that counts as Low / Medium / High. */
export const LIMITS = { rain: [1, 5, 15], temp: [0.5, 1.5, 3], wind: [3, 8, 15] };
export const LEVELS = ['No change', 'Low', 'Medium', 'High'];

const valueAt = (roll, d, k, kind) => (kind === 'rain' ? roll[rIdx(d, 1) + k] : kind === 'temp' ? roll[rIdx(d, 0) + k] - 273.15 : Math.hypot(roll[rIdx(d, 2) + k], roll[rIdx(d, 3) + k]) * 3.6);

/** Area-weighted daily values over cells [[cell, coverage], ...]. */
export function daily(roll, kind, cells) {
  let wsum = 0; for (const [k, f] of cells) wsum += f * COSW[(k / NLON) | 0];
  return Array.from({ length: stepsOf(roll) }, (_, d) => { let s = 0; for (const [k, f] of cells) s += f * COSW[(k / NLON) | 0] * valueAt(roll, d, k, kind); return s / wsum; });
}

/** 0..1 below Low, 1..2 Low, 2..3 Medium, 3+ High. */
export function score(size, [a, b, c]) {
  if (size < a) return size / a;
  if (size < b) return 1 + (size - a) / (b - a);
  if (size < c) return 2 + (size - b) / (c - b);
  return 3 + (size - c) / c;
}

/** Day-by-day watch level for one place, from whichever of rain, heat or wind changes most that day. */
export function timeline(prime, mv, cells) {
  const series = Object.fromEntries(Object.keys(KINDS).map((k) => [k, { p: daily(prime, k, cells), m: daily(mv, k, cells) }]));
  const days = Array.from({ length: Math.min(stepsOf(prime), stepsOf(mv)) }, (_, d) => {
    let best = null;
    for (const kind of Object.keys(KINDS)) {
      const delta = series[kind].m[d] - series[kind].p[d], s = score(Math.abs(delta), LIMITS[kind]);
      if (!best || s > best.score) best = { kind, delta, score: s };
    }
    return { ...best, level: Math.min(3, Math.floor(best.score)) };
  });
  const peak = days.reduce((a, d, i) => (d.score > days[a].score ? i : a), 0);
  const on = days.map((d, i) => (d.level ? i + 1 : 0)).filter(Boolean);
  return { days, series, level: days[peak].level, kind: days[peak].kind, delta: days[peak].delta, score: days[peak].score, peak: peak + 1, start: on[0] || null, count: on.length };
}
export const rankPlaces = (rows) => [...rows].sort((a, b) => b.t.level - a.t.level || b.t.score - a.t.score);
/** Share (0..1) of a place's area that lies inside the changed cell box. */
export function insideShare(cells, box) {
  if (!box) return 0;
  let w = 0, inside = 0;
  for (const [k, f] of cells) { const i = (k / NLON) | 0, j = k % NLON; w += f; if (i >= box.i0 && i <= box.i1 && j >= box.j0 && j <= box.j1) inside += f; }
  return w ? inside / w : 0;
}
/** First and last day a place reaches a level, or null. */
export function span(t) { const on = t.days.map((d, i) => (d.level ? i + 1 : 0)).filter(Boolean); return on.length ? [on[0], on[on.length - 1]] : null; }
/** How much to lean on a place's change: firm on days 1-3, rough on 4-7, direction only on 8-10 or beyond the model's range. */
export const trust = (peak, beyond = false) => (beyond || peak >= 8 ? 'dir' : peak >= 4 ? 'rough' : 'firm');
/** A change twice the High threshold is unusual enough that only its direction should be read. */
export const huge = (t) => Math.abs(t.delta) >= 2 * LIMITS[t.kind][2];
export const TRUST = { firm: 'Firm', rough: 'Rough', dir: 'Direction only' };
export const changeWord = (kind, delta) => KINDS[kind][delta >= 0 ? 'up' : 'down'];

// ---------- what caused it ----------
export function total(roll, kind, cells) { const s = daily(roll, kind, cells).reduce((a, b) => a + b, 0); return kind === 'rain' ? s : s / stepsOf(roll); }
/** Effect of the whole what-if on one place, split into each change applied alone plus what is left over. */
export function breakdown(base, full, singles, cells, kind) {
  const b = total(base, kind, cells), all = total(full, kind, cells) - b;
  const parts = singles.map((s) => ({ id: s.id, label: s.label, value: total(s.roll, kind, cells) - b }));
  return { total: all, parts, together: all - parts.reduce((a, p) => a + p.value, 0) };
}

// ---------- how far can a change travel ----------
export const REACH = 8; // grid cells per day: fixed by the network (8 blocks with one 3x3 convolution each)
export const dilate = (b, r) => ({ i0: b.i0 - r, i1: b.i1 + r, j0: b.j0 - r, j1: b.j1 + r });
export const coversGrid = (b) => b.i0 <= 0 && b.j0 <= 0 && b.i1 >= NLAT - 1 && b.j1 >= NLON - 1;

/** Largest change in any variable outside the reach limit on `day` (1-based); null if the limit covers the whole map. */
export function maxOutside(a, b, box, day) {
  const lim = dilate(box, REACH * day); if (coversGrid(lim)) return null;
  let m = 0;
  for (let c = 0; c < NCH; c++) for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) {
    if (i >= lim.i0 && i <= lim.i1 && j >= lim.j0 && j <= lim.j1) continue;
    const k = rIdx(day - 1, c) + i * NLON + j; m = Math.max(m, Math.abs(a[k] - b[k]));
  }
  return m;
}
/** Smallest cell box holding every non-zero value of a [6][cell] perturbation, or null if it is all zero. */
export function bboxOf(pert) {
  let box = null;
  for (let k = 0; k < pert.length; k++) {
    if (!pert[k]) continue;
    const cell = k % NCELL, i = (cell / NLON) | 0, j = cell % NLON;
    box = box ? { i0: Math.min(box.i0, i), i1: Math.max(box.i1, i), j0: Math.min(box.j0, j), j1: Math.max(box.j1, j) } : { i0: i, i1: i, j0: j, j1: j };
  }
  return box;
}

// ---------- model checks ----------
function invalidReason(roll) {
  if (roll.some((x) => !Number.isFinite(x))) return 'Found a value that is not a number.';
  for (let d = 0; d < stepsOf(roll); d++) for (let k = 0; k < NCELL; k++) {
    if (roll[rIdx(d, 1) + k] < 0) return 'Found negative rain.';
    if (roll[rIdx(d, 5) + k] < 0) return 'Found negative water vapour.';
    const t = roll[rIdx(d, 0) + k]; if (t < 233 || t > 334) return 'Found a temperature outside physical bounds.';
  }
  return null;
}
export const CHECKS = { null: 'Zero change, same forecast', valid: 'Physical output', fast: 'Under 5 seconds', local: 'Starts in the changed area', reach: 'Respects the reach limit', spread: 'Spreads outward', stable: 'Stable size' };
/** Live checks of one scenario. status: pass | warn | fail | na. value is always shown; text explains anything but a pass. */
export function runChecks({ base, zero, shocked, pert, ms }) {
  const out = [], add = (id, status, value, text = '') => out.push({ id, title: CHECKS[id], status, value, text });
  const pct = (x) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)} %`;
  const gap = maxAbsDiff(base, zero);
  add('null', gap === 0 ? 'pass' : 'fail', gap === 0 ? 'identical' : gap.toExponential(1), 'An all-zero change altered the forecast.');
  const bad = invalidReason(base) || invalidReason(shocked);
  add('valid', bad ? 'fail' : 'pass', bad ? 'invalid' : `${stepsOf(shocked)} days`, bad || '');
  add('fast', ms < 5000 ? 'pass' : 'fail', `${(ms / 1000).toFixed(2)} s`, 'Includes transfer.');
  const box = bboxOf(pert), r = box && ripple(base, shocked, box);
  if (!box || !r.maxStd.some((x) => x > 0)) {
    for (const id of ['local', 'reach', 'spread', 'stable']) add(id, 'na', 'n/a', 'Nothing changed.');
    return out;
  }
  const wide = coversGrid(dilate(box, 3)), share = r.fracInside[0], tooWide = 'The area is too large to test this.';
  add('local', wide ? 'na' : share >= 0.6 ? 'pass' : 'fail', wide ? 'n/a' : pct(share), wide ? tooWide : 'Needs 60 % of the day-1 change in or next to the area.');
  const seen = [];
  for (let d = 1; d <= stepsOf(base); d++) { const m = maxOutside(base, shocked, box, d); if (m === null) break; seen.push(m); }
  const leak = Math.max(0, ...seen);
  add('reach', !seen.length ? 'na' : leak === 0 ? 'pass' : 'fail', !seen.length ? 'n/a' : leak === 0 ? '0 beyond' : leak.toExponential(1), !seen.length ? 'The limit covers the map on day 1.' : 'Change found beyond the limit.');
  const outShare = r.fracInside.map((f) => (Number.isFinite(f) ? 1 - f : 0)), far = Math.max(...outShare.slice(1));
  add('spread', wide ? 'na' : far > outShare[0] ? 'pass' : 'warn', wide ? 'n/a' : `${pct(outShare[0])} to ${pct(far)}`, wide ? tooWide : 'The share outside the area did not grow.');
  const peak = Math.max(...r.maxStd);
  add('stable', peak < 5 ? 'pass' : 'warn', `${peak.toFixed(1)}×`, `The largest change is ${peak.toFixed(1)} times the usual day-to-day spread; 5 or more is flagged.`);
  return out;
}

// ---------- where it matters ----------
export const TILE = 4;
export const NUDGES = [
  { id: 'warm', label: 'warmer by 2 °C', values: { t2m: 2 } }, { id: 'moist', label: '20 % more humid', values: { tcwv: 20 } },
  { id: 'windy', label: 'windier by 30 %', values: { wind: 30 } }, { id: 'low', label: 'lower in pressure by 5 hPa', values: { msl: -5 } },
];
export function tiles(size = TILE) {
  const out = [];
  for (let i0 = 0; i0 < NLAT; i0 += size) for (let j0 = 0; j0 < NLON; j0 += size) out.push({ i0, i1: Math.min(NLAT, i0 + size) - 1, j0, j1: Math.min(NLON, j0 + size) - 1 });
  return out;
}
/** Plain-words position of a tile relative to a city. */
export function whereFrom(box, city) {
  const cla = (lat(box.i0) + lat(box.i1)) / 2, clo = (lon(box.j0) + lon(box.j1)) / 2;
  const dy = (cla - city.lat) * 111, dx = (clo - city.lon) * 111 * Math.cos((city.lat * Math.PI) / 180), km = Math.hypot(dx, dy);
  if (km < 250) return `over and around ${city.name}`;
  const names = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
  return `about ${Math.round(km / 50) * 50} km ${names[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]} of ${city.name}`;
}
