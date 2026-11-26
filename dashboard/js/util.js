// Shared constants and helpers (pure, no DOM).
export const NLAT = 32, NLON = 36, NCELL = NLAT * NLON, NCH = 6;
export const LAT0 = 6.5, LON0 = 65.5;
export const EXT = { lonMin: 65, lonMax: 101, latMin: 6, latMax: 38 };
export const STD = [13.46, 7.55, 2.90, 2.43, 619.0, 20.49];
export const CH = [
  { key: 't2m', label: '2 m temperature', unit: 'K' },
  { key: 'tp', label: 'Rain', unit: 'mm/day' },
  { key: 'u10', label: '10 m u-wind', unit: 'm/s' },
  { key: 'v10', label: '10 m v-wind', unit: 'm/s' },
  { key: 'msl', label: 'Sea-level pressure', unit: 'Pa' },
  { key: 'tcwv', label: 'Column water vapour', unit: 'kg/m²' },
];
export const lat = (i) => LAT0 + i;
export const lon = (j) => LON0 + j;
export const COSW = Float32Array.from({ length: NLAT }, (_, i) => Math.cos((lat(i) * Math.PI) / 180));

/** Rollout/state stored flat: Float32Array [day][ch][cell]. */
export const rIdx = (d, c) => (d * NCH + c) * NCELL;

export function flatten(nested) { // [steps][6][32][36] -> Float32Array
  const steps = nested.length, out = new Float32Array(steps * NCH * NCELL);
  let k = 0;
  for (let d = 0; d < steps; d++) for (let c = 0; c < NCH; c++) for (let i = 0; i < NLAT; i++) {
    const row = nested[d][c][i];
    for (let j = 0; j < NLON; j++) out[k++] = row[j];
  }
  return out;
}
export function nest3(flat, off) { // Float32Array -> [6][32][36] nested (for JSON body)
  const o = [];
  let k = off;
  for (let c = 0; c < NCH; c++) { const a = []; for (let i = 0; i < NLAT; i++) { const r = new Array(NLON); for (let j = 0; j < NLON; j++) r[j] = flat[k++]; a.push(r); } o.push(a); }
  return o;
}
export function stepsOf(flat) { return flat.length / (NCH * NCELL); }

/** Day-of-year from the (sin,cos) of 2*pi*doy/365. */
export function doyFromSC(sc) { let a = Math.atan2(sc[0], sc[1]); if (a < 0) a += 2 * Math.PI; return (a * 365) / (2 * Math.PI); }
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function monthOfDoy(doy) {
  let d = ((Math.round(doy) - 1) % 365 + 365) % 365, m = 0;
  while (d >= MDAYS[m]) { d -= MDAYS[m]; m++; }
  return m; // 0..11
}
export const fmt = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : '–');
