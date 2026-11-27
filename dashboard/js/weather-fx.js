// Living weather over the 3D map, driven by the forecast day on screen: wind streaks, rain, clouds.
// Positions and density come from the model fields; the motion is sped up so it can be seen.
import { project, toWorld } from './world.js';
import { sample } from './geo.js';

const WIND = 620, RAIN = 520, CLOUDS = 40, TRAIL = 9;
const rnd = (a, b) => a + Math.random() * (b - a);

function cloudSprite() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d');
  for (const [x, y, r, a] of [[78, 96, 54, 0.8], [128, 70, 62, 0.95], [176, 94, 52, 0.8], [118, 104, 58, 0.7], [200, 108, 34, 0.55], [52, 110, 32, 0.55]]) {
    const f = g.createRadialGradient(x, y, 0, x, y, r); f.addColorStop(0, `rgba(255,250,236,${a})`); f.addColorStop(0.55, `rgba(248,240,218,${a * 0.55})`); f.addColorStop(1, 'rgba(240,232,208,0)');
    g.fillStyle = f; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

export function createWeather(height, thin = false) {
  const sprite = cloudSprite();
  let frame = null, cloudCdf = null, rainCdf = null;
  const wind = [], rain = [], clouds = [];

  /** Cumulative weights so particles appear where the field says there is weather. */
  function cdf(weight) {
    const out = new Float32Array(1152); let s = 0;
    for (let k = 0; k < 1152; k++) { s += weight(k); out[k] = s; }
    return s > 0 ? out : null;
  }
  function pick(c) {
    const r = Math.random() * c[1151]; let lo = 0, hi = 1151;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < r) lo = m + 1; else hi = m; }
    return [65 + (lo % 36) + Math.random(), 6 + ((lo / 36) | 0) + Math.random()];
  }
  const newWind = (p = {}) => Object.assign(p, { lo: rnd(65, 101), la: rnd(6, 38), age: 0, life: rnd(1.6, 4.2), trail: [] });

  function set(next) {
    frame = next;
    cloudCdf = next && cdf((k) => Math.max(0, next.tp[k] - 1) + Math.max(0, next.tcwv[k] - 40) * 0.12);
    rainCdf = next && cdf((k) => Math.max(0, next.tp[k] - 2.5));
  }

  function drawWind(g, cam, dt, strength) {
    const target = Math.round(WIND * (thin ? 0.45 : 1));
    while (wind.length < target) { const p = newWind(); p.age = rnd(0, p.life); wind.push(p); }
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    for (const p of wind) {
      const u = sample(frame.u, p.lo, p.la), v = sample(frame.v, p.lo, p.la);
      p.lo += u * 0.2 * dt; p.la += v * 0.2 * dt; p.age += dt;
      if (p.age > p.life || p.lo < 65 || p.lo > 101 || p.la < 6 || p.la > 38) { newWind(p); continue; }
      const [x, z] = toWorld(p.lo, p.la); p.trail.push([x, height(x, z) + 0.28, z]); if (p.trail.length > TRAIL) p.trail.shift();
      if (p.trail.length < 2 || Math.hypot(u, v) < 0.5) continue;
      const fade = Math.min(1, p.age * 2, (p.life - p.age) * 2), path = paths[fade > 0.66 ? 2 : fade > 0.33 ? 1 : 0];
      let started = false;
      for (const q of p.trail) { const s = project(cam, ...q); if (!s) { started = false; continue; } started ? path.lineTo(s[0], s[1]) : path.moveTo(s[0], s[1]); started = true; }
    }
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 1.35;
    paths.forEach((p, i) => { g.strokeStyle = `rgba(236,242,236,${strength * (0.14 + i * 0.18)})`; g.stroke(p); });
  }

  function drawRain(g, cam, dt) {
    if (!rainCdf) { rain.length = 0; return; }
    const want = Math.min(Math.round(RAIN * (thin ? 0.5 : 1)), Math.round(rainCdf[1151] * 0.35));
    while (rain.length < want) { const [lo, la] = pick(rainCdf); rain.push({ lo, la, y: rnd(0, 1.9), speed: rnd(3.4, 5) }); }
    rain.length = want;
    const path = new Path2D();
    for (const d of rain) {
      d.y -= d.speed * dt;
      if (d.y <= 0) { [d.lo, d.la] = pick(rainCdf); d.y = rnd(1.4, 1.9); }
      const [x, z] = toWorld(d.lo, d.la), base = height(x, z), a = project(cam, x, base + d.y, z), b = project(cam, x - 0.03, base + d.y + 0.28, z);
      if (a && b) { path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]); }
    }
    g.strokeStyle = 'rgba(222,238,222,.85)'; g.lineWidth = 1.3; g.stroke(path);
  }

  function drawClouds(g, cam, dt) {
    if (!cloudCdf) { clouds.length = 0; return; }
    const want = Math.min(CLOUDS, Math.round(cloudCdf[1151] * 0.09));
    while (clouds.length < want) { const [lo, la] = pick(cloudCdf); clouds.push({ lo, la, age: rnd(0, 6), life: rnd(8, 16), size: rnd(2, 3.8), y: rnd(2, 2.7) }); }
    clouds.length = want;
    const seen = [];
    for (const c of clouds) {
      c.age += dt; c.lo += sample(frame.u, c.lo, c.la) * 0.035 * dt; c.la += sample(frame.v, c.lo, c.la) * 0.035 * dt;
      if (c.age > c.life || c.lo < 65 || c.lo > 101 || c.la < 6 || c.la > 38) { [c.lo, c.la] = pick(cloudCdf); c.age = 0; }
      const [x, z] = toWorld(c.lo, c.la), top = project(cam, x, c.y, z), shade = project(cam, x + 0.5, height(x + 0.5, z - 0.35) + 0.06, z - 0.35);
      if (top) seen.push({ c, top, shade, wet: Math.min(1, sample(frame.tp, c.lo, c.la) / 25) });
    }
    const px = (w) => (w * cam.h) / 0.611; // world size -> pixels at distance 1
    for (const { c, shade } of seen) { // soft shadows first
      if (!shade) continue;
      const w = px(c.size) / shade[2], fade = Math.min(1, c.age / 2, (c.life - c.age) / 2);
      g.fillStyle = `rgba(38,36,10,${0.1 * Math.max(0, fade)})`; g.beginPath(); g.ellipse(shade[0], shade[1], w * 0.32, w * 0.13, 0, 0, 7); g.fill();
    }
    for (const { c, top, wet } of seen.sort((a, b) => b.top[2] - a.top[2])) {
      const w = px(c.size) / top[2], close = Math.max(0, Math.min(1, (top[2] - 5) / 12)); // thin out when the camera flies through
      g.globalAlpha = Math.max(0, Math.min(1, c.age / 2, (c.life - c.age) / 2)) * (0.2 + wet * 0.28) * (0.25 + 0.75 * close);
      g.drawImage(sprite, top[0] - w / 2, top[1] - w * 0.31, w, w * 0.625);
    }
    g.globalAlpha = 1;
  }

  return {
    set,
    draw(g, cam, dt, show) {
      if (!frame) return;
      if (show.wind) drawWind(g, cam, dt, show.wind); else wind.length = 0;
      if (show.rain) drawRain(g, cam, dt);
      if (show.clouds) drawClouds(g, cam, dt);
    },
  };
}
