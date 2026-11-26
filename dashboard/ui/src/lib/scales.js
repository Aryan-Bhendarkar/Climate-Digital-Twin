// Colour scales for the v3 map (see design_panel/03_dataviz.md section 2). Lookup tables of 256 RGB entries.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const even = (list, lo, hi) => list.map((c, i) => [lo + ((hi - lo) * i) / (list.length - 1), c]);

export const NORMAL = {
  t2m: { lo: 5, hi: 46, map: 'lin', ticks: [10, 20, 30, 40],
    stops: [[5, '#2C62AA'], [15, '#6EAAD4'], [22, '#C4E2E8'], [28, '#FFFAC4'], [34, '#FDBE64'], [40, '#E2532D'], [46, '#A01226']] },
  tp: { lo: 0, hi: 60, map: 'sqrt', ticks: [0, 2.5, 15.6, 35, 60],
    stops: [[0, '#F7F9F6'], [1, '#CDE8F0'], [5, '#78BADE'], [15, '#307CBE'], [35, '#1C4894'], [60, '#14286B']] },
  // 10-day rain total (mm over 10 days): the same colours, stops at roughly 6x the daily ones (10 days are rarely all heavy).
  tp10: { lo: 0, hi: 400, map: 'sqrt', ticks: [0, 25, 100, 200, 400],
    stops: [[0, '#F7F9F6'], [5, '#CDE8F0'], [30, '#78BADE'], [90, '#307CBE'], [210, '#1C4894'], [400, '#14286B']] },
  wind: { lo: 0, hi: 60, map: 'lin', ticks: [0, 15, 30, 45, 60], stops: even(['#F6F4FA', '#DAD3E8', '#B4A7D6', '#8A74BC', '#5E3FA0', '#3A1F78'], 0, 60) },
  tcwv: { lo: 0, hi: 70, map: 'lin', ticks: [0, 20, 40, 55, 70], stops: even(['#FAF4E2', '#DEE8BE', '#8CC8AA', '#30968C', '#0A6064', '#043442'], 0, 70) },
  msl: { lo: 990, hi: 1020, map: 'lin', ticks: [990, 998, 1005, 1012, 1020], stops: even(['#00224E', '#35456C', '#666970', '#948E77', '#C8B866', '#FEE838'], 990, 1020) },
};
const NEUTRAL = '#F8F8F6';
export const DIFFS = {
  rdbu: ['#2166AC', '#67A9CF', '#D1E5F0', NEUTRAL, '#FDDBC7', '#EF8A62', '#B2182B'],
  brbg: ['#8C510A', '#D8B365', '#F6E8C3', NEUTRAL, '#C7EAE5', '#5AB4AC', '#01665E'],
  puor: ['#B35806', '#F1A340', '#FEE0B6', NEUTRAL, '#D8DAEB', '#998EC3', '#542788'],
};

const cache = {};
/** t in [0,1] -> value for a normal scale. */
export const valueAt = (sc, t) => (sc.map === 'sqrt' ? sc.lo + (sc.hi - sc.lo) * t * t : sc.lo + (sc.hi - sc.lo) * t);
/** value -> t in [0,1]. */
export const tOf = (sc, v) => { const u = Math.max(0, Math.min(1, (v - sc.lo) / (sc.hi - sc.lo))); return sc.map === 'sqrt' ? Math.sqrt(u) : u; };

export function lutNormal(name) {
  const key = 'n:' + name; if (cache[key]) return cache[key];
  const sc = NORMAL[name], st = sc.stops.map(([v, c]) => [v, hex(c)]), out = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) {
    const v = valueAt(sc, k / 255); let a = 0;
    while (a < st.length - 2 && v > st[a + 1][0]) a++;
    const [v0, c0] = st[a], [v1, c1] = st[a + 1], f = Math.max(0, Math.min(1, (v - v0) / (v1 - v0)));
    for (let c = 0; c < 3; c++) out[k * 3 + c] = c0[c] + (c1[c] - c0[c]) * f;
  }
  return (cache[key] = out);
}
export function lutDiff(name) {
  const key = 'd:' + name; if (cache[key]) return cache[key];
  const st = DIFFS[name].map(hex), out = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) {
    const t = (k / 255) * (st.length - 1), a = Math.min(Math.floor(t), st.length - 2), f = t - a;
    for (let c = 0; c < 3; c++) out[k * 3 + c] = st[a][c] + (st[a + 1][c] - st[a][c]) * f;
  }
  return (cache[key] = out);
}
export function gradientCss(lut, n = 16) {
  const s = [];
  for (let i = 0; i <= n; i++) { const k = Math.round((i / n) * 255) * 3; s.push(`rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]}) ${((i / n) * 100).toFixed(1)}%`); }
  return `linear-gradient(90deg,${s.join(',')})`;
}
export const nice125 = (x) => { if (!(x > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e; return e * (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10); };
