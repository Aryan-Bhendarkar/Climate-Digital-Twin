// "How far has the change spread": farthest distance (km) from the changed box to a cell whose forecast differs noticeably.
import { NLAT, NLON, NCH, STD, rIdx, stepsOf } from '@lib/util.js';
const Z = 0.03; // a cell counts as changed when any variable moves by more than 3 % of its typical day-to-day spread
export function spreadKm(prime, mv, box) {
  const n = stepsOf(prime), out = [];
  for (let d = 0; d < n; d++) {
    let far = 0;
    for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) {
      let z = 0; for (let c = 0; c < NCH; c++) { const k = rIdx(d, c) + i * NLON + j, q = Math.abs(mv[k] - prime[k]) / STD[c]; if (q > z) z = q; }
      if (z <= Z) continue;
      const ci = Math.min(box.i1, Math.max(box.i0, i)), cj = Math.min(box.j1, Math.max(box.j0, j)); // nearest box cell
      const dist = Math.max(Math.abs(i - ci), Math.abs(j - cj)) * 111; if (dist > far) far = dist; // model reach is 8 cells per day in max-norm (about 890 km)
    }
    out.push(Math.round(far));
  }
  return out;
}
