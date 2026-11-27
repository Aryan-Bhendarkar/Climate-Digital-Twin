// Geography helpers for the map: states as places, point-in-polygon, ground height. Pure functions, no DOM.
import { NLAT, NLON, lat, lon } from './util.js';
import { toGeo } from './world.js';

/** ring: flat [lon, lat, lon, lat, ...]. Even-odd rule over all rings, so holes work. */
export function inRings(rings, lo, la) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (r[i + 1] > la !== r[j + 1] > la && lo < ((r[j] - r[i]) * (la - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
    }
  }
  return inside;
}
function bounds(rings) {
  const b = { lo0: 180, lo1: -180, la0: 90, la1: -90 };
  for (const r of rings) for (let k = 0; k < r.length; k += 2) { b.lo0 = Math.min(b.lo0, r[k]); b.lo1 = Math.max(b.lo1, r[k]); b.la0 = Math.min(b.la0, r[k + 1]); b.la1 = Math.max(b.la1, r[k + 1]); }
  return b;
}
const area = (r) => { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1]; return Math.abs(a / 2); };

/** One entry per state polygon in outlines.json: its grid cells, extent and a point to write its name at. */
export function statePlaces(outlines) {
  return outlines.states.map((s) => {
    const b = bounds(s.rings), main = s.rings.reduce((a, r) => (area(r) > area(a) ? r : a));
    const cells = [];
    for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) if (inRings(s.rings, lon(j), lat(i))) cells.push([i * NLON + j, 1]);
    const mb = bounds([main]);
    let at = [(mb.lo0 + mb.lo1) / 2, (mb.la0 + mb.la1) / 2];
    if (cells.length) {
      const mean = [cells.reduce((a, [k]) => a + lon(k % NLON), 0) / cells.length, cells.reduce((a, [k]) => a + lat((k / NLON) | 0), 0) / cells.length];
      if (inRings(s.rings, ...mean)) at = mean;
    } else { // smaller than a grid cell: use the nearest one
      cells.push([Math.max(0, Math.min(NLAT - 1, Math.floor(at[1] - 6))) * NLON + Math.max(0, Math.min(NLON - 1, Math.floor(at[0] - 65))), 1]);
    }
    return { id: 'm:' + s.name, kind: 'state', name: s.name, group: s.id, rings: s.rings, bounds: b, lon: at[0], lat: at[1], cells, size: area(main) };
  });
}
export const stateAt = (states, lo, la) => states.find((s) => lo >= s.bounds.lo0 && lo <= s.bounds.lo1 && la >= s.bounds.la0 && la <= s.bounds.la1 && inRings(s.rings, lo, la)) || null;

/** Extent of a set of grid cells, for framing the camera. */
export function cellBounds(cells) {
  const lats = cells.map(([k]) => lat((k / NLON) | 0)), lons = cells.map(([k]) => lon(k % NLON));
  return { lo0: Math.min(...lons) - 0.5, lo1: Math.max(...lons) + 0.5, la0: Math.min(...lats) - 0.5, la1: Math.max(...lats) + 0.5 };
}

// ---------- ground height ----------
export const PEAK = 2.3; // world height of 7000 m: relief is strongly exaggerated (1 world unit is about 111 km)

/** RGBA pixels of assets/elevation.png (square-root coded, north at the top) -> {w, h, m: metres}. */
export function decodeElevation(rgba, w, h) {
  const m = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) m[k] = (rgba[k * 4] / 255) ** 2 * 9000;
  return { w, h, m };
}
/** height(x, z) in world units from elevation over lon 65..101, lat 6..38 and a land mask landAt(lon, lat) in 0..1. */
export function heightField({ w, h, m }, landAt) {
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  return (x, z) => {
    const [lo, la] = toGeo(x, z), land = landAt(lo, la);
    if (land <= 0) return 0;
    const gx = clamp(((lo - 65) / 36) * w - 0.5, w - 1.001), gy = clamp(((38 - la) / 32) * h - 0.5, h - 1.001), j = gx | 0, i = gy | 0, fx = gx - j, fy = gy - i, a = i * w + j;
    const metres = (m[a] * (1 - fx) + m[a + 1] * fx) * (1 - fy) + (m[a + w] * (1 - fx) + m[a + w + 1] * fx) * fy;
    return land * (0.035 + PEAK * Math.pow(metres / 7000, 0.82));
  };
}

/** Bilinear value of a [32*36] grid field at (lon, lat). */
export function sample(field, lo, la) {
  const gx = Math.max(0, Math.min(NLON - 1.001, lo - 65.5)), gy = Math.max(0, Math.min(NLAT - 1.001, la - 6.5)), j = gx | 0, i = gy | 0, fx = gx - j, fy = gy - i, a = i * NLON + j;
  return (field[a] * (1 - fx) + field[a + 1] * fx) * (1 - fy) + (field[a + NLON] * (1 - fx) + field[a + NLON + 1] * fx) * fy;
}
