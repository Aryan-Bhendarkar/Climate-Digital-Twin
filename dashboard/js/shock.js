// Shock painter maths + ripple (causality) diagnostics. Pure functions, no DOM.
import { NLAT, NLON, NCELL, NCH, STD, lat, lon, rIdx, stepsOf } from './util.js';

export const DISPLAY_UNITS = { 0: 'K', 1: 'mm/day', 2: 'm/s', 3: 'm/s', 4: 'hPa', 5: 'kg/m²' };
export const PRESETS = {
  bob: { label: 'Warm Bay of Bengal (+3 K, +15% tcwv)', box: [8, 20, 82, 94], comps: [{ ch: 0, mode: 'abs', value: 3 }, { ch: 5, mode: 'pct', value: 15 }] },
  stall: { label: 'Monsoon stall (−40% wind, Arabian Sea)', box: [8, 20, 65, 75], comps: [{ ch: 2, mode: 'pct', value: -40 }, { ch: 3, mode: 'pct', value: -40 }] },
  arab: { label: 'Arabian Sea +2.5 °C', box: [8, 20, 65, 75], comps: [{ ch: 0, mode: 'abs', value: 2.5 }] },
};

/** Cells whose centres lie in [latLo,latHi] x [lonLo,lonHi] -> inclusive index box. */
export function boxFromLatLon(latLo, latHi, lonLo, lonHi) {
  const i0 = Math.max(0, Math.ceil(latLo - lat(0))), i1 = Math.min(NLAT - 1, Math.floor(latHi - lat(0)));
  const j0 = Math.max(0, Math.ceil(lonLo - lon(0))), j1 = Math.min(NLON - 1, Math.floor(lonHi - lon(0)));
  return { i0, i1, j0, j1 };
}
export const boxLabel = (b) => `lat ${lat(b.i0) - 0.5}–${lat(b.i1) + 0.5}°N, lon ${lon(b.j0) - 0.5}–${lon(b.j1) + 0.5}°E (${(b.i1 - b.i0 + 1) * (b.j1 - b.j0 + 1)} cells)`;

/**
 * Physical delta [6][cell] added to the LAST input day. lastDay: Float32Array [6][cell] (physical units).
 * comps: [{ch, mode:'abs'|'pct', value}] in display units (msl in hPa, pct in %).
 * Returns {pert, clamped, maxAbsStd}; rain / water vapour deltas are clamped so the shocked state stays >= 0.
 */
export function buildPerturbation(lastDay, box, comps) {
  const pert = new Float32Array(NCH * NCELL); let clamped = false;
  for (const cp of comps) {
    for (let i = box.i0; i <= box.i1; i++) for (let j = box.j0; j <= box.j1; j++) {
      const k = cp.ch * NCELL + i * NLON + j, cur = lastDay[k] + pert[k];
      let d = cp.mode === 'pct' ? (cp.value / 100) * lastDay[k] : cp.ch === 4 ? cp.value * 100 : cp.value;
      if ((cp.ch === 1 || cp.ch === 5) && cur + d < 0) { d = -cur; clamped = true; }
      pert[k] += d;
    }
  }
  return { pert, clamped };
}

/** Per-day energy of delta (mv - prime) inside box dilated by `dil` cells vs outside. energy = sum_ch (d/std)^2. */
export function ripple(prime, mv, box, dil = 3) {
  const n = stepsOf(prime), inside = new Array(n).fill(0), outside = new Array(n).fill(0), maxStd = new Array(n).fill(0), maxAbs = new Array(n).fill(0);
  const a = { i0: box.i0 - dil, i1: box.i1 + dil, j0: box.j0 - dil, j1: box.j1 + dil };
  for (let d = 0; d < n; d++) {
    for (let c = 0; c < NCH; c++) {
      const o = rIdx(d, c), s2 = 1 / (STD[c] * STD[c]);
      for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) {
        const dv = mv[o + i * NLON + j] - prime[o + i * NLON + j], e = dv * dv * s2;
        if (i >= a.i0 && i <= a.i1 && j >= a.j0 && j <= a.j1) inside[d] += e; else outside[d] += e;
        const z = Math.abs(dv) / STD[c]; if (z > maxStd[d]) maxStd[d] = z;
        if (Math.abs(dv) > maxAbs[d]) maxAbs[d] = Math.abs(dv);
      }
    }
  }
  return { inside, outside, maxStd, maxAbs, fracInside: inside.map((v, d) => (v + outside[d] > 0 ? v / (v + outside[d]) : NaN)) };
}

export function maxAbsDiff(a, b) { let m = 0; for (let k = 0; k < a.length; k++) { const d = Math.abs(a[k] - b[k]); if (d > m) m = d; } return m; }
