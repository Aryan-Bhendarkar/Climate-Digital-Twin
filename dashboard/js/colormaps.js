// Perceptual-style colour maps as 256-entry RGB lookup tables (no external deps).
const STOPS = {
  inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]],
  viridis: [[68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142], [33, 144, 141], [39, 173, 129], [92, 200, 99], [170, 220, 50], [253, 231, 37]],
  ice: [[10, 18, 40], [16, 52, 104], [28, 98, 160], [44, 148, 190], [108, 200, 208], [200, 236, 218], [255, 255, 224]],
  cividis: [[0, 34, 78], [42, 63, 109], [85, 93, 110], [124, 124, 120], [166, 156, 116], [212, 190, 95], [253, 231, 55]],
  mako: [[11, 4, 5], [43, 20, 57], [62, 53, 115], [53, 92, 155], [50, 134, 168], [53, 177, 170], [105, 214, 160], [200, 240, 190]],
  // Diverging maps with a dark neutral centre so "no change" blends into the panel and real change pops.
  rdbu: [[150, 210, 255], [60, 140, 230], [30, 80, 160], [30, 36, 56], [150, 45, 60], [225, 80, 70], [255, 180, 140]],
  brbg: [[240, 200, 130], [200, 130, 50], [110, 70, 30], [30, 36, 56], [20, 90, 90], [40, 170, 150], [150, 230, 210]],
};
const cache = {};
export function lut(name) {
  if (cache[name]) return cache[name];
  const s = STOPS[name], out = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) {
    const t = (k / 255) * (s.length - 1), a = Math.min(Math.floor(t), s.length - 2), f = t - a;
    for (let c = 0; c < 3; c++) out[k * 3 + c] = s[a][c] + (s[a + 1][c] - s[a][c]) * f;
  }
  return (cache[name] = out);
}
export const rgbCss = (name, t) => { const L = lut(name), k = Math.max(0, Math.min(255, Math.round(t * 255))) * 3; return `rgb(${L[k]},${L[k + 1]},${L[k + 2]})`; };
