// The living 3D map. Same interface as MapPanel (set, cellAt, draw) plus a camera, weather, places and pins.
// Terrain and weather colours are WebGL (terrain-gl.js); borders, names, boxes and weather motion are drawn on a 2D canvas on top.
import { camera, project, screenRay, pickGround, clampCam, fitDistance, flight, toWorld, toGeo, rubber, LIMITS } from './world.js';
import { heightField, decodeElevation, stateAt, cellBounds } from './geo.js';
import { visibleCities, SHOW_AT } from './places.js';
import { createTerrain, landMask } from './terrain-gl.js';
import { createWeather } from './weather-fx.js';
import { fieldImage, syncPins } from './render.js';
import { createCityModels, SHOW_FROM } from './city-models.js';
import { EFFECTS } from './impact-view.js';

const TEX = 12; // texture pixels per grid cell
const SEAS = [{ lon: 68.6, lat: 14.6, name: 'Arabian Sea' }, { lon: 89, lat: 13.6, name: 'Bay of Bengal' }, { lon: 80, lat: 6.9, name: 'Indian Ocean' }];
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function pixels(img) {
  const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight }), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0); return decodeElevation(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const GLOW = Object.fromEntries(Object.entries(EFFECTS).map(([k, e]) => [k, hex(e.ramp[1])]));

export class Map3D {
  /** canvas: the 2D layer that also receives input. terrain: {elevation, imagery} images. places: see places.js. hooks: {canDraw, insets, hover, pick}. */
  constructor(canvas, outlines, terrain, places, hooks) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.wrap = canvas.parentElement; this.places = places; this.hooks = hooks;
    const mask = landMask(outlines);
    this.height = heightField(pixels(terrain.elevation), mask.at);
    this.glCanvas = document.createElement('canvas'); this.glCanvas.className = 's-gl'; this.glCanvas.setAttribute('aria-hidden', 'true');
    this.terrain = createTerrain(this.glCanvas, this.height, mask.canvas, terrain.imagery); // throws without WebGL2: the caller falls back to the flat map
    this.wrap.insertBefore(this.glCanvas, canvas); this.wrap.classList.add('three');
    this.tex = Object.assign(document.createElement('canvas'), { width: 36 * TEX, height: 32 * TEX }); this.base = document.createElement('canvas');
    this.weather = createWeather(this.height, innerWidth < 800);
    this.models = createCityModels(this.height, mask.at); this.effects = null;
    this.state = { field: null, lo: 0, hi: 1, cmap: 'viridis', tiles: null, box: null, boxText: null, dragBox: null, rings: null, empty: null, layer: null, contours: null, field2: null, split: null, pulse: false };
    this.show = {}; this.pins = new Map(); this.pinList = []; this.pinBox = null; this.hovered = null; this.focused = null;
    this.fog = undefined; this.headFont = 'Georgia, serif'; this.coast = null;
    this.texDirty = true; this.baseKey = ''; this.time = 0; this.last = 0; this.dirty = true; this.lift = 0; this.orbit = 0; this.rise = still() ? 1 : 0; this.born = performance.now(); this.quiet = 0;
    this.borders = this.drape(outlines);
    this.pad = hooks.insets(); // how much of each edge the panels cover
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    this.resize(); this.bind();
    const home = this.homeCam();
    this.cam = still() ? home : { x: -4, z: 5, dist: 105, pitch: 0.12, bearing: -1.1 }; this.goal = { ...this.cam };
    if (!still()) this.flyTo(home, 3200, 500);
    requestAnimationFrame((t) => this.tick(t));
  }

  // ---------- public ----------
  set(p) { Object.assign(this.state, p); if (['field', 'lo', 'hi', 'cmap', 'tiles', 'layer', 'contours', 'field2'].some((k) => k in p)) this.texDirty = true; this.dirty = true; }
  draw() { this.dirty = true; }
  setWeather(frame, show = {}) { this.weather.set(frame); this.show = show; this.dirty = true; }
  setPins(box, list) { this.pinBox = box; this.pinList = list; syncPins(box, this.pins, list); this.dirty = true; }
  setFocus(place) { this.focused = place; this.dirty = true; }
  /** Sky colour for the distance haze and the lettering, read from the theme's CSS variables. */
  setTheme(css) {
    const hex = css.getPropertyValue('--fog').trim().replace('#', '');
    if (hex.length === 6) this.fog = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    this.headFont = css.getPropertyValue('--maphead').trim() || 'Georgia, serif'; this.dirty = true;
  }
  /** {cities: [{name, lat, lon, level, effect}], states: [{name, level, effect}]} or null. */
  setEffects(effects) { this.effects = effects; this.dirty = true; }
  cellAt(ev) {
    const p = this.ground(ev); if (!p) return null;
    const [lo, la] = toGeo(p[0], p[2]), i = Math.floor(la - 6), j = Math.floor(lo - 65);
    return i >= 0 && i < 32 && j >= 0 && j < 36 ? { i, j } : null;
  }

  flyTo(to, ms = 1500, delay = 0) { this.coast = null; const target = clampCam({ ...this.goal, ...to }); this.fly = { from: { ...this.cam }, to: target, t0: performance.now() + delay, ms: still() ? 1 : ms }; this.dirty = true; }
  view(i = this.pad) { const w = this.w, h = this.h, vw = Math.max(200, w - i.left - i.right), vh = Math.max(200, h - i.top - i.bottom); return { w, h, cx: i.left + vw / 2, cy: i.top + vh / 2, vw, vh }; }
  frame(b, pitch, margin = 1) {
    const [x, z] = toWorld((b.lo0 + b.lo1) / 2, (b.la0 + b.la1) / 2);
    return { x, z, pitch, dist: fitDistance((b.lo1 - b.lo0) * margin, (b.la1 - b.la0) * margin, this.view(this.hooks.insets()), pitch) };
  }
  /** Glide the picture when a panel opens or closes instead of jumping. */
  glide(dt) {
    const to = this.hooks.insets(), k = still() ? 1 : 1 - Math.exp(-dt * 7); let moved = false;
    for (const side of ['left', 'top', 'right', 'bottom']) { const d = to[side] - this.pad[side]; if (Math.abs(d) > 0.5) { this.pad[side] += d * k; moved = true; } }
    return moved;
  }
  homeCam() { return clampCam({ ...this.frame({ lo0: 67, lo1: 98, la0: 4.5, la1: 37 }, 0.66, 1.07), bearing: 0 }); }
  home() { this.flyTo(this.homeCam()); }
  topView() { this.flyTo({ ...this.frame({ lo0: 65, lo1: 101, la0: 6, la1: 38 }, 0, 1.04), bearing: 0 }, 1200); }
  flyToPlace(p) {
    const turn = (p.lon - 82) * -0.012;
    if (p.kind === 'city') { const [x, z] = toWorld(p.lon, p.lat); this.flyTo({ x, z, dist: Math.min(7.5, SHOW_AT[p.tier] * 0.62), pitch: 0.92, bearing: turn }, 1900); return; }
    const b = p.bounds || cellBounds(p.cells), f = this.frame(b, 0.78, 1.25);
    this.flyTo({ ...f, dist: Math.max(8, f.dist), bearing: turn }, 1700);
  }
  /** Frame a what-if area (cell box) with room around it for the spreading reach line. */
  frameBox(box) { // pulled back and half way between the area and the middle of India, so the first days of the line stay in view
    const h = this.homeCam(), [x, z] = toWorld(65.5 + (box.j0 + box.j1) / 2, 6.5 + (box.i0 + box.i1) / 2);
    this.flyTo({ x: (x + h.x) / 2, z: (z + h.z) / 2, dist: h.dist * 1.04, pitch: 0.72, bearing: -0.22 }, 1100);
  }
  setOrbit(speed) { this.orbit = still() ? 0 : speed; }
  zoomBy(factor, ms = 450) { this.flyTo({ dist: this.goal.dist * factor }, ms); }
  turnBy(bearing, pitch = 0) { this.flyTo({ bearing: this.goal.bearing + bearing, pitch: this.goal.pitch + pitch }, 500); }

  // ---------- geometry ----------
  drape(outlines) {
    const line = (r) => {
      const out = [];
      for (let k = 0; k < r.length - 2; k += 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(r[k + 2] - r[k], r[k + 3] - r[k + 1]) / 0.22));
        for (let s = 0; s < n; s++) { const [x, z] = toWorld(r[k] + ((r[k + 2] - r[k]) * s) / n, r[k + 1] + ((r[k + 3] - r[k + 1]) * s) / n); out.push(x, this.height(x, z) + 0.035, z); }
      }
      const [x, z] = toWorld(r[r.length - 2], r[r.length - 1]); out.push(x, this.height(x, z) + 0.035, z);
      return Float32Array.from(out);
    };
    return { states: new Map(this.places.states.map((s) => [s.name, s.rings.map(line)])), countries: outlines.countries.flatMap((c) => c.rings.map(line)) };
  }
  at(lo, la, up = 0) { const [x, z] = toWorld(lo, la); return project(this.view3, x, this.height(x, z) + up, z); }
  xy(ev) { const r = this.c.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  ground(ev) { return this.view3 ? pickGround(screenRay(this.view3, ...this.xy(ev)), this.height) : null; }
  flat(sx, sy) { const r = screenRay(camera(this.goal, this.view()), sx, sy); if (r.d[1] > -0.03) return null; const t = -r.o[1] / r.d[1]; return [r.o[0] + r.d[0] * t, r.o[2] + r.d[2] * t]; }
  visibleCities() { const [lo, la] = toGeo(this.cam.x, this.cam.z); return visibleCities(this.places, la, lo, this.cam.dist); }
  /** The city under the pointer, else the state, else null. */
  placeAt(ev) {
    const [sx, sy] = this.xy(ev); let best = null, bd = this.cam.dist < SHOW_FROM ? 28 : 15; // towns are bigger targets than dots
    for (const c of this.visibleCities()) { const p = this.at(c.lon, c.lat, 0.05); if (!p) continue; const d = Math.hypot(p[0] - sx, p[1] - sy); if (d < bd) { bd = d; best = c; } }
    if (best) return best;
    const q = this.ground(ev); if (!q) return null;
    return stateAt(this.places.states, ...toGeo(q[0], q[2]));
  }

  // ---------- input ----------
  bind() {
    const cv = this.c, pointers = new Map(); let down = null, pinch = null;
    const stop = () => { this.fly = null; this.orbit = 0; this.coast = null; };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, this.xy(e));
      const turning = e.button === 2 || e.shiftKey || e.ctrlKey;
      if (e.button === 0 && !turning && this.hooks.canDraw()) { down = null; return; } // the stage draws a box with this drag
      cv.setPointerCapture(e.pointerId); e.preventDefault(); cv.classList.add('by-pointer'); cv.focus({ preventScroll: true });
      stop(); this.goal = { ...this.cam }; // grab the map where it is, even mid-flight
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, turning, moved: false, at: { x: this.cam.x, z: this.cam.z }, trail: [] };
    });
    cv.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, this.xy(e));
      if (pointers.size === 2) { // pinch to zoom, twist to turn, two-finger drag to tilt
        const [a, b] = [...pointers.values()], now = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), r: Math.atan2(b[1] - a[1], b[0] - a[0]), y: (a[1] + b[1]) / 2 };
        if (pinch) { stop(); this.goal = clampCam({ ...this.goal, dist: (this.goal.dist * pinch.d) / Math.max(now.d, 1), bearing: this.goal.bearing + (now.r - pinch.r), pitch: this.goal.pitch - (now.y - pinch.y) * 0.004 }); }
        pinch = now; if (down) down.moved = true; return;
      }
      if (!down) { this.pointer = e; return; }
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
      down.moved = true; stop(); this.hooks.hover(null);
      if (down.turning) this.goal = clampCam({ ...this.goal, bearing: this.goal.bearing - (e.clientX - down.lx) * 0.006, pitch: this.goal.pitch - (e.clientY - down.ly) * 0.005 });
      else {
        const r = cv.getBoundingClientRect(), a = this.flat(down.lx - r.left, down.ly - r.top), b = this.flat(e.clientX - r.left, e.clientY - r.top);
        if (a && b) {
          down.at.x += a[0] - b[0]; down.at.z += a[1] - b[1];
          this.goal = { ...this.goal, x: rubber(down.at.x, LIMITS.x), z: rubber(down.at.z, LIMITS.z) }; // resists past the edge
        }
        this.cam = { ...this.goal }; // dragging follows the finger exactly
        down.trail.push({ t: e.timeStamp, x: this.cam.x, z: this.cam.z }); if (down.trail.length > 6) down.trail.shift();
      }
      down.lx = e.clientX; down.ly = e.clientY;
    });
    const up = (e) => {
      pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
      if (down && !down.moved && e.type === 'pointerup' && e.button === 0) { const p = this.placeAt(e); if (p) this.hooks.pick(p); }
      else if (down?.moved && !down.turning) {
        const t = down.trail, a = t[0], b = t[t.length - 1], secs = a && b ? (b.t - a.t) / 1000 : 0;
        // carry the finger's speed on, unless it had already come to rest
        if (secs > 0.01 && e.timeStamp - b.t < 80 && !still()) this.coast = { x: (b.x - a.x) / secs, z: (b.z - a.z) / secs };
        else this.goal = clampCam(this.goal);
      }
      down = null;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.pointer = null; this.hovered = null; this.hooks.hover(null); this.dirty = true; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); stop();
      const dist = clampCam({ ...this.goal, dist: this.goal.dist * Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0016) }).dist, k = dist / this.goal.dist, p = this.flat(...this.xy(e));
      this.goal = clampCam({ ...this.goal, dist, ...(p ? { x: p[0] + (this.goal.x - p[0]) * k, z: p[1] + (this.goal.z - p[1]) * k } : {}) });
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => { const p = this.flat(...this.xy(e)); if (p) this.flyTo({ x: p[0], z: p[1], dist: this.goal.dist * 0.55 }, 800); });
    cv.addEventListener('keydown', (e) => {
      cv.classList.remove('by-pointer'); // show the focus ring again for keyboard users
      const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (pan) { const s = this.goal.dist * 0.1, b = this.goal.bearing; this.flyTo({ x: this.goal.x + s * (pan[0] * Math.cos(b) + pan[1] * Math.sin(b)), z: this.goal.z + s * (pan[1] * Math.cos(b) - pan[0] * Math.sin(b)) }, 300); }
      else if (e.key === '+' || e.key === '=') this.zoomBy(0.75); else if (e.key === '-') this.zoomBy(1.33);
      else if (e.key === 'q') this.turnBy(0.3); else if (e.key === 'e') this.turnBy(-0.3); else if (e.key === '0') this.home(); else return;
      e.preventDefault(); e.stopPropagation();
    });
  }

  resize() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight; if (!w || !h) return;
    this.w = w; this.h = h; this.dpr = Math.min(devicePixelRatio || 1, 1.4);
    for (const c of [this.glCanvas, this.c, this.base]) { c.width = Math.round(w * this.dpr); c.height = Math.round(h * this.dpr); }
    for (const c of [this.glCanvas, this.c]) { c.style.width = w + 'px'; c.style.height = h + 'px'; }
    this.baseKey = ''; this.dirty = true;
  }

  // ---------- frame ----------
  tick(now) {
    requestAnimationFrame((t) => this.tick(t));
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000); this.last = now;
    if (!this.wrap.offsetParent || !this.w) return;
    let moving = this.glide(dt);
    if (this.fly) {
      const t = (performance.now() - this.fly.t0) / this.fly.ms;
      if (t >= 0) { this.cam = flight(this.fly.from, this.fly.to, t); this.goal = { ...this.cam }; if (t >= 1) { this.cam = { ...this.fly.to }; this.goal = { ...this.cam }; this.fly = null; } }
      moving = true;
    } else {
      if (this.coast) { // momentum: decays smoothly, and settles back inside the limits
        const decay = Math.pow(0.995, dt * 1000), inside = clampCam(this.goal);
        const past = inside.x !== this.goal.x || inside.z !== this.goal.z;
        this.goal.x += this.coast.x * dt; this.goal.z += this.coast.z * dt; this.cam.x = this.goal.x; this.cam.z = this.goal.z;
        this.coast.x *= decay; this.coast.z *= decay; moving = true;
        if (past || Math.hypot(this.coast.x, this.coast.z) < 0.05) { this.coast = null; this.goal = clampCam(this.goal); }
      }
      if (this.orbit) { this.goal.bearing += this.orbit * dt; moving = true; }
      const k = still() ? 1 : 1 - Math.exp(-dt * 14);
      for (const key of ['x', 'z', 'dist', 'pitch', 'bearing']) { const d = this.goal[key] - this.cam[key]; if (Math.abs(d) > 1e-4) { this.cam[key] += d * k; moving = true; } }
    }
    if (this.pointer) {
      const p = this.placeAt(this.pointer);
      if (p !== this.hovered) { this.hovered = p; this.lift = 0; }
      this.c.style.cursor = this.hooks.canDraw() ? 'crosshair' : p ? 'pointer' : 'grab';
      this.hooks.hover(p, this.pointer); this.pointer = null; this.dirty = true;
    }
    if (this.rise < 1) { this.rise = still() ? 1 : Math.max(0, Math.min(1, (now - this.born) / 1800)); moving = true; }
    const hush = this.state.pulse ? 1 : 0; if (Math.abs(hush - this.quiet) > 0.002) { this.quiet = still() ? hush : this.quiet + (hush - this.quiet) * (1 - Math.exp(-dt * 5)); moving = true; }
    if (still() && !moving && !this.dirty) return;
    this.dirty = false;
    if (!still()) { this.time += dt; this.lift = Math.min(1, this.lift + dt * 6); } else this.lift = 1;
    if (this.texDirty) { this.paintData(); this.terrain.setData(this.tex); if (this.state.field2) { this.paintData(this.state.field2); this.terrain.setData(this.tex, 3); } this.texDirty = false; }
    this.view3 = camera(this.cam, this.view());
    const split = this.state.field2 && this.state.split !== null ? this.state.split * this.glCanvas.width : null; // compare: Prime left, Multiverse right
    const rise = 1 - Math.pow(1 - this.rise, 4);
    this.terrain.draw(this.view3, { time: this.time, pulse: this.quiet, fog: this.fog, dist: this.cam.dist, split, rise });
    this.c.style.opacity = this.rise < 1 ? Math.max(0, (rise - 0.85) / 0.15) : 1; // names wait until the land has risen
    this.overlay(still() ? 0 : dt);
    this.placePins();
  }

  /** field: paint this field instead of state.field (the right-hand side when comparing). */
  paintData(field = this.state.field) {
    const g = this.tex.getContext('2d'), s = this.state;
    g.clearRect(0, 0, this.tex.width, this.tex.height);
    if (s.layer) { g.imageSmoothingEnabled = true; g.drawImage(s.layer, 0, 0, this.tex.width, this.tex.height); }
    if (field) { g.globalAlpha = 0.88; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(fieldImage(field, s.lo, s.hi, s.cmap), 0, 0, this.tex.width, this.tex.height); g.globalAlpha = 1; }
    // watch-level boundaries, like contour lines on a printed map: thin for Low, firmer for Medium
    for (const { segs, width, alpha, color = '14,18,22' } of s.contours || []) {
      g.beginPath();
      for (const [x0, y0, x1, y1] of segs) { g.moveTo((x0 + 0.5) * TEX, (31.5 - y0) * TEX); g.lineTo((x1 + 0.5) * TEX, (31.5 - y1) * TEX); }
      g.lineCap = 'round'; g.lineWidth = width; g.strokeStyle = `rgba(${color},${alpha})`; g.stroke();
    }
    for (const t of s.tiles || []) {
      const x = t.box.j0 * TEX, y = (31 - t.box.i1) * TEX, w = (t.box.j1 - t.box.j0 + 1) * TEX, h = (t.box.i1 - t.box.i0 + 1) * TEX;
      g.fillStyle = t.fill; g.fillRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
      if (t.width > 1) { g.strokeStyle = '#2e3319'; g.lineWidth = 4; g.strokeRect(x + 2, y + 2, w - 4, h - 4); }
    }
  }

  path(g, pts, up = 0) {
    let pen = false;
    for (let k = 0; k < pts.length; k += 3) {
      const s = project(this.view3, pts[k], pts[k + 1] + up, pts[k + 2]);
      if (!s) { pen = false; continue; }
      pen ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); pen = true;
    }
  }
  /** Borders only change when the camera or the data layer does, so keep them on their own canvas. */
  drawBorders() {
    const data = !!(this.state.field || this.state.tiles), soft = !!this.state.layer, key = [this.cam.x, this.cam.z, this.cam.dist, this.cam.pitch, this.cam.bearing, data, soft, this.w, this.h, JSON.stringify(this.view())].join();
    if (key === this.baseKey) return;
    this.baseKey = key;
    const g = this.base.getContext('2d'); g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, this.w, this.h); g.lineJoin = 'round';
    g.beginPath(); for (const rings of this.borders.states.values()) for (const r of rings) this.path(g, r);
    g.strokeStyle = data ? 'rgba(12,20,28,.34)' : soft ? 'rgba(236,240,244,.2)' : 'rgba(236,240,244,.34)'; g.lineWidth = this.cam.dist < 15 ? 1.2 : 0.7; g.stroke();
    g.beginPath(); for (const r of this.borders.countries) this.path(g, r);
    g.strokeStyle = data ? 'rgba(10,16,22,.75)' : soft ? 'rgba(240,232,214,.55)' : 'rgba(240,232,214,.75)'; g.lineWidth = this.cam.dist < 15 ? 1.8 : 1.1; g.stroke();
  }

  /** Points along a cell box edge by edge, in lon/lat; edges outside the map are left out. */
  edges(b) {
    const lo0 = 65 + b.j0, lo1 = 66 + b.j1, la0 = 6 + b.i0, la1 = 7 + b.i1, cl = (v, a, c) => Math.max(a, Math.min(c, v)), out = [];
    for (const [a, c] of [[[lo0, la1], [lo1, la1]], [[lo1, la1], [lo1, la0]], [[lo1, la0], [lo0, la0]], [[lo0, la0], [lo0, la1]]]) {
      const flatLine = a[1] === c[1];
      if (flatLine ? a[1] < 6 || a[1] > 38 : a[0] < 65 || a[0] > 101) continue;
      const p = [cl(a[0], 65, 101), cl(a[1], 6, 38)], q = [cl(c[0], 65, 101), cl(c[1], 6, 38)], n = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.3));
      out.push(Array.from({ length: n + 1 }, (_, k) => [p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]));
    }
    return out;
  }
  dashedBox(g, box, color, text) {
    const sides = this.edges(box).map((e) => e.map(([lo, la]) => this.at(lo, la, 0.09)).filter(Boolean));
    for (const [style, width, dash] of [['rgba(25,35,20,.55)', 5, []], [color, 2.6, [9, 5]]]) {
      g.strokeStyle = style; g.lineWidth = width; g.setLineDash(dash); g.lineDashOffset = -this.time * 14; g.beginPath();
      for (const s of sides) s.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.stroke();
    }
    g.setLineDash([]);
    const pts = sides.flat(); if (!text || !pts.length) return;
    const low = Math.max(...pts.map((p) => p[1])), mid = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    this.chip(g, text, mid, low + 16, color, '#10140f');
  }
  /** The furthest-reach line: a dashed boundary lying on the terrain. */
  curtain(g, { box, text, alpha = 1 }) {
    let best = null; const v = this.view();
    for (const e of this.edges(box)) {
      const low = e.map(([lo, la]) => this.at(lo, la, 0.05));
      if (low.some((p) => !p)) continue;
      g.beginPath(); low.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.strokeStyle = `rgba(8,12,18,${0.6 * alpha})`; g.lineWidth = 4; g.stroke();
      g.strokeStyle = `rgba(244,196,98,${alpha})`; g.lineWidth = 1.8; g.setLineDash([2, 7]); g.lineCap = 'round'; g.lineDashOffset = -this.time * 12; g.stroke(); g.setLineDash([]); g.lineCap = 'butt';
      // label the lowest point of the line that is still clear of the panels
      for (const p of low) if (p[0] > v.cx - v.vw / 2 + 110 && p[0] < v.cx + v.vw / 2 - 110 && p[1] < v.cy + v.vh / 2 - 8 && (!best || p[1] > best[1])) best = p;
    }
    if (text) this.chip(g, text, best ? best[0] : v.cx, best ? best[1] : v.cy + v.vh / 2 - 12, '#0d1620', '#f4c462');
  }
  chip(g, text, x, y, bg, fg) {
    g.font = `600 12px 'IBM Plex Sans', system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width + 18;
    g.fillStyle = bg; g.beginPath(); g.roundRect(x - w / 2, y - 11, w, 22, 2); g.fill(); g.fillStyle = fg; g.fillText(text, x, y + 0.5);
    this.reserved.push([x - w / 2, y - 12, w, 24]); // place names keep clear of it
  }

  highlight(g, state, strength) {
    const rings = this.borders.states.get(state.name); if (!rings) return;
    const up = 0.34 * strength;
    g.beginPath(); for (const r of rings) { this.path(g, r, up); g.closePath(); }
    g.fillStyle = `rgba(242,240,232,${0.1 * strength})`; g.fill('evenodd');
    g.strokeStyle = '#f2f0e8'; g.lineWidth = 1.6; g.stroke();
    g.beginPath(); for (const r of rings) this.path(g, r); g.strokeStyle = 'rgba(8,12,12,.55)'; g.lineWidth = 1.2; g.stroke();
  }
  beacon(g, place) {
    for (let k = 0; k < 3; k++) {
      const t = ((this.time * 0.55 + k / 3) % 1), r = 0.12 + t * 0.9, [x, z] = toWorld(place.lon, place.lat);
      g.beginPath();
      for (let a = 0; a <= 36; a++) { const px = x + Math.cos((a / 36) * 6.283) * r, pz = z + Math.sin((a / 36) * 6.283) * r, s = project(this.view3, px, this.height(px, pz) + 0.05, pz); if (s) a ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); }
      g.strokeStyle = `rgba(255,190,90,${1 - t})`; g.lineWidth = 2.2; g.stroke();
    }
  }

  /** States on watch get a quiet outline in the ink of their change; the data underneath carries the colour. */
  stateEffects(g) {
    for (const s of this.effects?.states || []) {
      const rings = this.borders.states.get(s.name); if (!rings) continue;
      g.beginPath(); for (const r of rings) { this.path(g, r, 0.03); g.closePath(); }
      g.strokeStyle = GLOW[s.effect]; g.globalAlpha = 0.45 + 0.15 * s.level; g.lineWidth = 0.8 + s.level * 0.5; g.stroke(); g.globalAlpha = 1;
    }
  }
  /** One slow ripple on cities at Medium or High watch: a mark of where to look, not decoration. */
  cityEffects(g) {
    for (const c of this.effects?.cities || []) {
      if (c.level < 2) continue;
      const [x, z] = toWorld(c.lon, c.lat), t = (this.time * 0.35 + (c.lon % 1)) % 1, r = 0.08 + t * (0.18 + 0.12 * c.level);
      g.beginPath();
      for (let a = 0; a <= 30; a++) { const px = x + Math.cos((a / 30) * 6.283) * r, pz = z + Math.sin((a / 30) * 6.283) * r, q = project(this.view3, px, this.height(px, pz) + 0.05, pz); if (q) a ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }
      g.strokeStyle = GLOW[c.effect]; g.globalAlpha = 0.8 * (1 - t); g.lineWidth = 1.6; g.stroke(); g.globalAlpha = 1;
    }
  }

  names(g) {
    const taken = [...this.reserved], dist = this.cam.dist;
    const free = (x, y, w, h) => !taken.some((r) => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
    const put = (text, p, { size, weight = 600, color, halo, italic, dot, force }) => {
      if (!p || p[0] < -40 || p[0] > this.w + 40 || p[1] < -20 || p[1] > this.h + 20) return;
      g.font = `${italic ? 'italic ' : ''}${weight >= 700 ? 500 : weight} ${weight >= 700 ? size + 1 : size}px ${weight >= 700 ? this.headFont : "'IBM Plex Sans', system-ui"}`;
      const w = g.measureText(text).width, x = dot ? p[0] + 8 : p[0] - w / 2, y = p[1];
      if (!force && !free(x - 3, y - size * 0.7, w + 6, size * 1.4)) return;
      taken.push([x - 3, y - size * 0.7, w + 6, size * 1.4]);
      if (dot) { g.beginPath(); g.arc(p[0], p[1], dot, 0, 7); g.fillStyle = '#f6f1e2'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#10140f'; g.stroke(); }
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineWidth = 3.6; g.strokeStyle = halo; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
    };
    const light = { color: '#f6f1e2', halo: 'rgba(6,10,8,.82)' }, dark = { color: '#11160f', halo: 'rgba(246,241,226,.92)' }, tone = this.state.field || this.state.tiles ? dark : light;
    const labelled = new Set(this.pinList.filter((p) => p.named).map((p) => p.id)); // pins already carry these names
    const cities = this.visibleCities().filter((c) => !labelled.has(c.id)).sort((a, b) => a.tier - b.tier || b.pop - a.pop);
    const hushed = labelled.size && this.cam.dist > 20;
    const clear = (c) => (dist < SHOW_FROM - 3 ? this.models.top(c.tier) : 0.1); // names sit above the little towns
    for (const c of [this.focused, this.hovered]) if (c) put(c.name, this.at(c.lon, c.lat, c.kind === 'city' ? clear(c) + 0.02 : 0.55), { ...dark, size: 15, weight: 700, dot: c.kind === 'city' ? 4.5 : 0, force: true });
    g.globalAlpha = hushed ? 0.5 : 1; // while places are being pointed out, the other names step back
    for (const c of cities.filter((x) => x.tier === 1)) if (c !== this.focused && c !== this.hovered) put(c.name, this.at(c.lon, c.lat, clear(c)), { ...tone, size: 13, weight: 650, dot: 3.4 });
    const states = [...this.places.states].sort((a, b) => b.size - a.size).filter((s) => (dist > 34 ? s.size > 9 : dist > 17 ? s.size > 2.5 : true));
    for (const s of states) if (s !== this.focused && s !== this.hovered && s.group !== 'ISL' && s.group !== 'UT') put(s.name, this.at(s.lon, s.lat, 0.25), { ...tone, size: dist < 15 ? 17 : 13, weight: 700 });
    for (const c of cities.filter((x) => x.tier > 1)) if (taken.length < 75 && c !== this.focused && c !== this.hovered) put(c.name, this.at(c.lon, c.lat, clear(c)), { ...tone, size: c.tier === 2 ? 12.5 : c.tier === 3 ? 12 : 11, dot: c.tier === 2 ? 3 : 2.3 });
    g.globalAlpha = 1;
    for (const s of SEAS) put(s.name, this.at(s.lon, s.lat, 0.05), { color: 'rgba(214,228,232,.82)', halo: 'rgba(4,14,20,.55)', size: dist < 20 ? 18 : 15, italic: true, weight: 700 });
  }

  overlay(dt) {
    const g = this.g, s = this.state;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.c.width, this.c.height);
    this.drawBorders(); g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.lineJoin = 'round'; g.lineCap = 'butt'; this.reserved = [];
    this.stateEffects(g);
    for (const p of [this.focused, this.hovered]) if (p && p.kind === 'state') this.highlight(g, p, p === this.hovered ? this.lift : 1);
    const towns = this.visibleCities(); if (this.focused?.kind === 'city' && !towns.includes(this.focused)) towns.push(this.focused);
    this.models.draw(g, this.view3, towns, this.cam, new Map((this.effects?.cities || []).map((c) => [c.name, GLOW[c.effect]])));
    this.cityEffects(g);
    if (this.focused?.kind === 'city') this.beacon(g, this.focused);
    if (s.box) this.dashedBox(g, s.box, '#f2ecda', s.boxText);
    if (s.dragBox) this.dashedBox(g, s.dragBox, '#ffffff', 'Selected area');
    this.weather.draw(g, this.view3, dt, this.show);
    g.lineCap = 'butt';
    for (const r of s.rings || []) this.curtain(g, r);
    for (const m of s.marks || []) { const p = this.at(m.lon, m.lat, 0.1); if (p) this.chip(g, m.text, p[0], p[1], 'rgba(16,20,15,.86)', '#f2ecda'); }
    this.names(g);
    if (s.empty) this.chip(g, s.empty, this.view().cx, this.view().cy, '#414828', '#fff');
  }

  placePins() {
    for (const p of this.pinList) {
      const el = this.pins.get(p.id), s = el && this.at(p.lon, p.lat, 0.05);
      if (!el) continue;
      el.style.visibility = s ? '' : 'hidden';
      if (s) { el.style.left = s[0] + 'px'; el.style.top = s[1] + 'px'; el.style.zIndex = p.selected ? 900 : Math.max(1, 800 - Math.round(s[2] * 5)); }
    }
  }
}
