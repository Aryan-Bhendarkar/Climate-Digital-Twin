// Camera maths for the 3D map. Pure functions, no DOM.
// World units are degrees: x = east, z = south, y = up. (lon 83, lat 22) is the origin.
export const FOV = (34 * Math.PI) / 180;
export const toWorld = (lo, la) => [lo - 83, 22 - la];
export const toGeo = (x, z) => [x + 83, 22 - z];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

/** cam: {x, z, dist, pitch (0 = straight down), bearing}. view: {w, h, cx, cy} where (cx, cy) is where the target appears. */
export function camera(cam, { w, h, cx = w / 2, cy = h / 2 }) {
  const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch), sb = Math.sin(cam.bearing), cb = Math.cos(cam.bearing);
  const eye = [cam.x + cam.dist * sp * sb, cam.dist * cp, cam.z + cam.dist * sp * cb];
  const f = unit(sub([cam.x, 0, cam.z], eye)), up = [-sb * cp, sp, -cb * cp], r = unit(cross(f, up)), u = cross(r, f);
  const k = 1 / Math.tan(FOV / 2), aspect = w / h, ox = (cx / w) * 2 - 1, oy = 1 - (cy / h) * 2, near = 0.2, far = 400;
  const a = (far + near) / (near - far), b = (2 * far * near) / (near - far);
  // view rows, then perspective with the principal point shifted to (cx, cy); column-major for WebGL
  const rows = [[...r, -dot(r, eye)], [...u, -dot(u, eye)], [-f[0], -f[1], -f[2], dot(f, eye)], [0, 0, 0, 1]];
  const proj = [[k / aspect, 0, -ox, 0], [0, k, -oy, 0], [0, 0, a, b], [0, 0, -1, 0]];
  const m = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) m[j * 4 + i] = proj[i][0] * rows[0][j] + proj[i][1] * rows[1][j] + proj[i][2] * rows[2][j] + proj[i][3] * rows[3][j];
  return { m, eye, f, r, u, ox, oy, aspect, w, h };
}

/** World point -> [screen x, screen y, distance along view]; null if behind the camera. */
export function project(c, x, y, z) {
  const m = c.m, W = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (W <= 0.01) return null;
  return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / W + 1) * 0.5 * c.w, (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / W) * 0.5 * c.h, W];
}

/** Screen point -> ray {o, d}. */
export function screenRay(c, sx, sy) {
  const t = Math.tan(FOV / 2), nx = (sx / c.w) * 2 - 1 - c.ox, ny = 1 - (sy / c.h) * 2 - c.oy;
  return { o: c.eye, d: unit([0, 1, 2].map((i) => c.f[i] + c.r[i] * nx * t * c.aspect + c.u[i] * ny * t)) };
}

/** First point where the ray meets the ground y = height(x, z), or null. */
export function pickGround(ray, height, maxT = 300) {
  const at = (t) => [0, 1, 2].map((i) => ray.o[i] + ray.d[i] * t);
  const above = (t) => { const p = at(t); return p[1] - height(p[0], p[2]); };
  let a = 0;
  for (let t = 0.25; t <= maxT; t += Math.max(0.12, Math.min(2, above(a) * 0.4))) {
    if (above(t) <= 0) {
      let lo = a, hi = t;
      for (let n = 0; n < 18; n++) { const mid = (lo + hi) / 2; if (above(mid) > 0) lo = mid; else hi = mid; }
      return at(hi);
    }
    a = t;
  }
  return null;
}

export const LIMITS = { dist: [2.3, 105], pitch: [0, 1.18], x: [-19, 19], z: [-17, 17] };
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
export const clampCam = (c) => ({ x: clamp(c.x, LIMITS.x), z: clamp(c.z, LIMITS.z), dist: clamp(c.dist, LIMITS.dist), pitch: clamp(c.pitch, LIMITS.pitch), bearing: c.bearing });

/** Where a flick would come to rest: velocity per second under exponential deceleration (per millisecond). */
export const projected = (velocity, rate = 0.995) => ((velocity / 1000) * rate) / (1 - rate);
/** Soft edge: the further past a limit, the less it follows. */
export function rubber(value, [lo, hi], size = 6, give = 0.55) {
  const soft = (over) => (over * size * give) / (size + give * over);
  return value < lo ? lo - soft(lo - value) : value > hi ? hi + soft(value - hi) : value;
}

/** Distance at which a (width x height degrees) area fills a visible window of vw x vh pixels inside a w x h canvas. */
export function fitDistance(width, height, { w, h, vw = w, vh = h }, pitch = 0.6) {
  const t = Math.tan(FOV / 2), across = (width * h) / (2 * t * Math.max(vw, 1)), down = (height * Math.cos(pitch * 0.7) * h) / (2 * t * Math.max(vh, 1));
  return clamp(Math.max(across, down) * 1.08, LIMITS.dist);
}

export const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10); // quintic: starts and lands without a jolt
/** Cinematic flight: eased, zooming out a little in the middle of long trips, turning the short way round. */
export function flight(a, b, t) {
  const e = ease(Math.max(0, Math.min(1, t))), mix = (p, q) => p + (q - p) * e;
  const turn = Math.atan2(Math.sin(b.bearing - a.bearing), Math.cos(b.bearing - a.bearing));
  const hop = Math.min(0.7, Math.hypot(b.x - a.x, b.z - a.z) / (a.dist + b.dist));
  return { x: mix(a.x, b.x), z: mix(a.z, b.z), dist: Math.exp(mix(Math.log(a.dist), Math.log(b.dist))) * (1 + hop * Math.sin(Math.PI * e)), pitch: mix(a.pitch, b.pitch), bearing: a.bearing + turn * e };
}
