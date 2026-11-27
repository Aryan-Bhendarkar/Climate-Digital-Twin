// Little 3D towns that appear when you zoom in. Illustrations only: size follows the town's population group, the
// layout is generated from its name, and none of it comes from real building data.
import { project, toWorld } from './world.js';

const SIZE = { 1: { n: 42, r: 0.3, h: 0.24 }, 2: { n: 24, r: 0.2, h: 0.15 }, 3: { n: 15, r: 0.13, h: 0.1 }, 4: { n: 9, r: 0.08, h: 0.065 }, 5: { n: 5, r: 0.045, h: 0.042 } };
const ROOFS = ['#c4611a', '#87300a', '#d1b879', '#a8480d'];
export const SHOW_FROM = 17; // camera distance below which towns appear

function seeded(text) {
  let s = 2166136261; for (const ch of text) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
}
/** Deterministic blocks and trees for one city, only on land. */
export function layout(city, landAt) {
  const rand = seeded(city.name + city.lat), z0 = SIZE[city.tier], [cx, cz] = toWorld(city.lon, city.lat), items = [];
  for (let i = 0; i < Math.round(z0.n * 1.35); i++) {
    const tree = i >= z0.n, r = z0.r * Math.pow(rand(), tree ? 0.4 : 0.75) * (tree ? 1.3 : 1), a = rand() * 6.283, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const w = 0.014 + rand() * 0.018, d = 0.014 + rand() * 0.018, h = z0.h * (0.22 + 0.78 * rand() * rand()) * Math.max(0.35, 1 - r / z0.r * 0.65), roof = ROOFS[(rand() * ROOFS.length) | 0];
    if (landAt(x + 83, 22 - z) > 0.6) items.push({ x, z, w, d, h: i === 0 ? z0.h * 1.25 : h, roof, tree });
  }
  return items;
}

export function createCityModels(height, landAt) {
  const cache = new Map();
  const face = (g, pts, colour) => { g.fillStyle = colour; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); };
  function block(g, cam, b, roof) {
    const y = height(b.x, b.z);
    if (b.tree) {
      const top = project(cam, b.x, y + 0.055, b.z), l = project(cam, b.x - 0.018, y + 0.008, b.z), r = project(cam, b.x + 0.018, y + 0.008, b.z);
      if (top && l && r) face(g, [top, r, l], b.w > 0.023 ? '#414828' : '#70886a');
      return;
    }
    const x0 = b.x - b.w, x1 = b.x + b.w, z0 = b.z - b.d, z1 = b.z + b.d;
    const at = (x, z, up) => project(cam, x, y + up, z), low = [at(x0, z0, 0), at(x1, z0, 0), at(x1, z1, 0), at(x0, z1, 0)], high = [at(x0, z0, b.h), at(x1, z0, b.h), at(x1, z1, b.h), at(x0, z1, b.h)];
    if (low.some((p) => !p) || high.some((p) => !p)) return;
    const wall = (i, j, colour) => face(g, [low[i], low[j], high[j], high[i]], colour);
    if (cam.eye[2] < z0) wall(0, 1, '#a8894f'); if (cam.eye[0] > x1) wall(1, 2, '#c9a96a');
    if (cam.eye[2] > z1) wall(2, 3, '#f1dfb2'); if (cam.eye[0] < x0) wall(3, 0, '#fbeec9');
    face(g, high, roof || b.roof);
  }
  return {
    /** Height above ground that a city's name should clear. */
    top: (tier) => SIZE[tier].h * 1.35,
    /** glow: Map of city name -> colour for cities the what-if affects. */
    draw(g, cam, cities, view, glow) {
      const fade = Math.max(0, Math.min(1, (SHOW_FROM - view.dist) / 5)); if (!fade) return;
      const near = [];
      for (const c of cities) {
        const [x, z] = toWorld(c.lon, c.lat); if (Math.hypot(x - view.x, z - view.z) > view.dist * 1.3) continue;
        const p = project(cam, x, height(x, z), z);
        if (p && p[0] > -150 && p[0] < cam.w + 150 && p[1] > -150 && p[1] < cam.h + 150) near.push({ c, x, z, depth: p[2] });
      }
      g.globalAlpha = fade;
      // the nearest sixty, painted back to front
      for (const { c, x, z } of near.sort((a, b) => a.depth - b.depth).slice(0, 60).reverse()) {
        if (!cache.has(c.id)) cache.set(c.id, layout(c, landAt));
        const tint = glow.get(c.name), radius = SIZE[c.tier].r * 1.25;
        // a pale patch of streets under the town, or the impact colour when it is affected
        g.beginPath();
        for (let a = 0; a < 28; a++) { const px = x + Math.cos(a / 28 * 6.283) * radius, pz = z + Math.sin(a / 28 * 6.283) * radius, q = project(cam, px, height(px, pz) + 0.004, pz); if (q) a ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }
        g.fillStyle = tint ? tint + '4d' : 'rgba(232,214,160,.32)'; g.fill();
        const far = (b) => (b.x - cam.eye[0]) ** 2 + (b.z - cam.eye[2]) ** 2;
        for (const b of [...cache.get(c.id)].sort((p, q) => far(q) - far(p))) block(g, cam, b, tint);
      }
      g.globalAlpha = 1;
    },
  };
}
