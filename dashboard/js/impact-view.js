// The "impact" picture: where, and which way, a scenario changes one quantity, printed onto the natural land.
// Every pixel comes from the model: day 0 is the change you made, days 1..N are what-if minus normal.
import { NLAT, NLON, NCELL, NCH, rIdx, stepsOf } from './util.js';
import { LIMITS, score } from './insights.js';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Diverging palettes, minus their neutral middle (unchanged land stays plain terrain), each side from faint to strong.
 *  Temperature: Crameri "vik" (doi:10.5281/zenodo.1243862). Rain: ColorBrewer BrBG browns with a blue wet side. Wind: green to plum.
 *  The three stops are the Low, Medium and High watch levels, so the map, the place list and the legend share one scale. */
export const PALETTES = {
  temp: { less: ['#71A8C4', '#06548B', '#001261'].map(rgb), more: ['#D39774', '#A94512', '#590008'].map(rgb), words: ['cooler', 'hotter'], noun: 'Temperature', unit: '°C' },
  rain: { less: ['#D6B878', '#A9792F', '#6E4A16'].map(rgb), more: ['#7FA7CF', '#3B6AA8', '#1F3F73'].map(rgb), words: ['drier', 'wetter'], noun: 'Rain', unit: 'mm/day' }, // wetter is blue: teal vanished over the sea
  wind: { less: ['#8FB5A6', '#4A8571', '#1B5E4B'].map(rgb), more: ['#B994C0', '#8A5B97', '#5C2D6E'].map(rgb), words: ['calmer', 'windier'], noun: 'Wind', unit: 'km/h' },
};
/** One ink per kind of effect, for outlines, pins and towns. */
export const EFFECTS = {
  hotter: { label: 'Hotter', ramp: PALETTES.temp.more }, cooler: { label: 'Cooler', ramp: PALETTES.temp.less },
  wetter: { label: 'Wetter', ramp: PALETTES.rain.more }, drier: { label: 'Drier', ramp: PALETTES.rain.less },
  wind: { label: 'Wind', ramp: PALETTES.wind.more },
};
export const effectKey = (kind, delta) => (kind === 'temp' ? (delta >= 0 ? 'hotter' : 'cooler') : kind === 'rain' ? (delta >= 0 ? 'wetter' : 'drier') : 'wind');
const KINDS = ['temp', 'rain', 'wind'];
export const FAINT = 0.3; // a third of the "Low" threshold: below this nothing is drawn

/** Frames [day 0..N] of per-cell changes: {temp, rain, wind} Float32Array[cells]. */
export function impactFrames(init, shockedLast, prime, mv) {
  const last = init.subarray(2 * NCH * NCELL);
  const read = {
    temp: (r, d, k) => r[rIdx(d, 0) + k],
    rain: (r, d, k) => r[rIdx(d, 1) + k],
    wind: (r, d, k) => Math.hypot(r[rIdx(d, 2) + k], r[rIdx(d, 3) + k]) * 3.6,
  };
  const frame = (a, b, d) => Object.fromEntries(KINDS.map((kind) => [kind, Float32Array.from({ length: NCELL }, (_, k) => read[kind](b, d, k) - read[kind](a, d, k))]));
  return [frame(last, shockedLast, 0), ...Array.from({ length: stepsOf(prime) }, (_, d) => frame(prime, mv, d))];
}
export function blend(a, b, t) { return Object.fromEntries(KINDS.map((kind) => [kind, a[kind].map((v, k) => v + (b[kind][k] - v) * t)])); }

export const BAND_ALPHA = [0, 0.46, 0.62, 0.76];
/** Premultiplied RGBA per cell for one quantity, in three steps: Low, Medium and High watch level. Below Low nothing is drawn. */
export function impactGrid(frame, kind = 'temp', out = new Float32Array(NCELL * 4)) {
  const P = PALETTES[kind];
  for (let k = 0; k < NCELL; k++) {
    const x = frame[kind][k], level = Math.min(3, Math.floor(score(Math.abs(x), LIMITS[kind]))), o = k * 4, alpha = BAND_ALPHA[level];
    const ink = level ? (x < 0 ? P.less : P.more)[level - 1] : [0, 0, 0];
    for (let c = 0; c < 3; c++) out[o + c] = ink[c] * alpha;
    out[o + 3] = alpha;
  }
  return out;
}

/** Per-cell watch score (0..3+) of the largest change: 1 = Low, 2 = Medium, 3 = High. */
export function scores(frame, kinds = KINDS) {
  return Float32Array.from({ length: NCELL }, (_, k) => Math.max(...kinds.map((q) => score(Math.abs(frame[q][k]), LIMITS[q]))));
}
/** Per frame, the highest score each cell has reached so far: the front of a change can only grow. */
export function reached(frames, kind) {
  let prev = new Float32Array(NCELL);
  return frames.map((f) => (prev = scores(f, [kind]).map((s, k) => Math.max(s, prev[k]))));
}
/** Marching squares on cell centres: line segments [[x0, y0, x1, y1], ...] in cell units (x east, y north from row 0) where s crosses level. */
export function contour(s, level) {
  const out = [], at = (i, j) => s[i * NLON + j];
  for (let i = 0; i < NLAT - 1; i++) for (let j = 0; j < NLON - 1; j++) {
    const v = [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)], p = [[j, i], [j + 1, i], [j + 1, i + 1], [j, i + 1]], cut = [];
    for (let e = 0; e < 4; e++) {
      const a = v[e], b = v[(e + 1) % 4];
      if ((a >= level) !== (b >= level)) { const t = (level - a) / (b - a), P = p[e], Q = p[(e + 1) % 4]; cut.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
    for (let c = 0; c + 1 < cut.length; c += 2) out.push([...cut[c], ...cut[c + 1]]); // the rare saddle is split arbitrarily
  }
  return out;
}

const SCALE = 6;
let canvas = null, image = null;
const grid = new Float32Array(NCELL * 4);
/** Smoothly upscaled picture of one frame (north at the top). Returns a shared canvas. */
export function impactImage(frame, kind) {
  if (!canvas) { canvas = Object.assign(document.createElement('canvas'), { width: NLON * SCALE, height: NLAT * SCALE }); image = canvas.getContext('2d').createImageData(canvas.width, canvas.height); }
  impactGrid(frame, kind, grid);
  const d = image.data, w = canvas.width;
  for (let py = 0; py < canvas.height; py++) {
    const gy = Math.min(NLAT - 1, Math.max(0, (canvas.height - 1 - py + 0.5) / SCALE - 0.5)), i = Math.min(NLAT - 2, gy | 0), fy = gy - i;
    for (let px = 0; px < w; px++) {
      const gx = Math.min(NLON - 1, Math.max(0, (px + 0.5) / SCALE - 0.5)), j = Math.min(NLON - 2, gx | 0), fx = gx - j, a = (i * NLON + j) * 4, o = (py * w + px) * 4;
      const mix = (c) => (grid[a + c] * (1 - fx) + grid[a + 4 + c] * fx) * (1 - fy) + (grid[a + NLON * 4 + c] * (1 - fx) + grid[a + NLON * 4 + 4 + c] * fx) * fy;
      const alpha = mix(3);
      for (let c = 0; c < 3; c++) d[o + c] = alpha > 0.001 ? mix(c) / alpha : 0;
      d[o + 3] = alpha * 255;
    }
  }
  canvas.getContext('2d').putImageData(image, 0, 0);
  return canvas;
}

/** Cities and states on watch on `day` (1-based), with the direction of their biggest change. */
export function impacted(rows, day, stateNames) {
  const on = (list) => list.map((r) => ({ r, d: r.t.days[day - 1] })).filter((x) => x.d.level > 0).map(({ r, d }) => ({ r, level: d.level, effect: effectKey(d.kind, d.delta) }));
  return {
    cities: on(rows.cities).map(({ r, level, effect }) => ({ name: r.name, lat: r.lat, lon: r.lon, level, effect })),
    states: on(rows.states).flatMap(({ r, level, effect }) => stateNames(r.id).map((name) => ({ name, level, effect }))),
    stateCount: on(rows.states).length,
  };
}
