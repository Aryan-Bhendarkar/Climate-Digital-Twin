// Impact module: Kharif Stress Monitor (state scorecard) + wind-power index. Pure functions, computed from the two live rollouts.
import { NLAT, NLON, NCELL, COSW, rIdx, stepsOf, doyFromSC, monthOfDoy } from './util.js';

export const DRY_MM = 2.5;            // rainy-day cut-off for dry-spell counting (mm/day, state mean)
export const WIND_STATES = ['GJ', 'RJ', 'TN', 'KA', 'MH', 'AP'];
export const WIND_ALPHA = 1 / 7;       // power-law shear exponent 10 m -> 100 m
export const CUT_IN = 3, RATED = 12, CUT_OUT = 25;

/** IMD-style departure band for a percentage departure. */
export function band(pct) {
  if (pct >= 20) return { key: 'excess', label: 'Excess' };
  if (pct > -20) return { key: 'normal', label: 'Normal' };
  if (pct > -60) return { key: 'deficient', label: 'Deficient' };
  return { key: 'scanty', label: 'Scanty' };
}
export const heatTier = (days) => (days >= 6 ? 3 : days >= 3 ? 2 : days >= 1 ? 1 : 0);
export function rainTier(depPct, dry) {
  if (depPct == null) return 0;
  let t = depPct <= -60 ? 3 : depPct <= -20 ? 2 : 0;
  if (dry >= 7 && t < 3) t += 1;
  return t;
}
export function longestRun(flags) { let best = 0, run = 0; for (const f of flags) { run = f ? run + 1 : 0; if (run > best) best = run; } return best; }

/** Weighted (land-fraction x cos lat) mean of one channel over a state's cells, for each day. */
function stateSeries(roll, ch, cells, n) {
  const out = new Array(n); let wsum = 0;
  for (const [k, f] of cells) wsum += f * COSW[(k / NLON) | 0];
  for (let d = 0; d < n; d++) {
    const o = rIdx(d, ch); let s = 0;
    for (const [k, f] of cells) s += f * COSW[(k / NLON) | 0] * roll[o + k];
    out[d] = s / wsum;
  }
  return out;
}

function branch(roll, cells, heatP95, rainClim, doy0, n) {
  const rain = stateSeries(roll, 1, cells, n), t2 = stateSeries(roll, 0, cells, n);
  const total = rain.reduce((a, b) => a + b, 0), dry = longestRun(rain.map((v) => v < DRY_MM));
  let heat = 0, clim10 = 0;
  for (let d = 0; d < n; d++) { const m = monthOfDoy(doy0 + d + 1); if (t2[d] > heatP95[m]) heat++; clim10 += rainClim[m]; }
  const dep = clim10 >= 5 ? ((total - clim10) / clim10) * 100 : null;
  const rt = rainTier(dep, dry), ht = heatTier(heat);
  return { rain, t2, total, dry, heat, dep, rt, ht, stress: 0.5 * rt + 0.5 * ht };
}

/** assets: {grid:{order,meta,cells}, heat:{p95}, rainClim:{mean_daily}} */
export function kharif(prime, mv, assets, doySC) {
  const n = Math.min(stepsOf(prime), stepsOf(mv)), doy0 = doyFromSC(doySC), rows = [];
  for (const id of assets.grid.order) {
    const cells = assets.grid.cells[id], p = branch(prime, cells, assets.heat.p95[id], assets.rainClim.mean_daily[id], doy0, n), m = branch(mv, cells, assets.heat.p95[id], assets.rainClim.mean_daily[id], doy0, n);
    const dRain = ((m.total - p.total) / Math.max(p.total, 5)) * 100;
    rows.push({ id, name: assets.grid.meta[id].name, p, m, dRain, band: band(dRain), dStress: m.stress - p.stress });
  }
  const worse = rows.filter((r) => r.dStress > 0).length, better = rows.filter((r) => r.dStress < 0).length;
  const wsum = rows.reduce((a, r) => a + assets.grid.meta[r.id].ncells, 0);
  const allP = rows.reduce((a, r) => a + r.p.total * assets.grid.meta[r.id].ncells, 0) / wsum, allM = rows.reduce((a, r) => a + r.m.total * assets.grid.meta[r.id].ncells, 0) / wsum;
  return { rows, worse, better, allIndiaRain: { p: allP, m: allM, d: ((allM - allP) / Math.max(allP, 5)) * 100 } };
}

export function cf(v10) { // capacity-factor proxy of a generic turbine from 10 m wind speed
  const v = v10 * Math.pow(10, WIND_ALPHA);
  if (v < CUT_IN || v >= CUT_OUT) return 0;
  if (v >= RATED) return 1;
  return (v * v * v - CUT_IN ** 3) / (RATED ** 3 - CUT_IN ** 3);
}
export function windIndex(prime, mv, assets) {
  const n = Math.min(stepsOf(prime), stepsOf(mv));
  const series = (roll, cells) => {
    let ws = 0; for (const [k, f] of cells) ws += f * COSW[(k / NLON) | 0];
    return Array.from({ length: n }, (_, d) => {
      const ou = rIdx(d, 2), ov = rIdx(d, 3); let s = 0;
      for (const [k, f] of cells) s += f * COSW[(k / NLON) | 0] * cf(Math.hypot(roll[ou + k], roll[ov + k]));
      return s / ws;
    });
  };
  return WIND_STATES.filter((id) => assets.grid.cells[id]).map((id) => {
    const cells = assets.grid.cells[id], p = series(prime, cells), m = series(mv, cells), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const pm = mean(p), mm = mean(m);
    return { id, name: assets.grid.meta[id].name, p, m, pMean: pm, mMean: mm, dPct: ((mm - pm) / Math.max(pm, 0.01)) * 100, dAbs: mm - pm };
  });
}
