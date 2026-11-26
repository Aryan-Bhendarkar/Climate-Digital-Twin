// Canvas 2D map plate: equirectangular, cached bilinear-upsampled field bitmaps, crisp vector outlines, survey-style frame.
import { NLAT, NLON, EXT, lat, lon } from '@lib/util.js';
import { lutNormal, lutDiff, NORMAL, tOf } from './scales.js';
import { CITIES, SEAS } from './narrative.js';

const S = 8; // upsample factor: 288 x 256 bitmap
const MARGIN = { l: 34, r: 8, t: 8, b: 22 };
const C = { ocean: '#DCE6EA', land: '#EEF0EC', ink: '#0F2530', frame: '#9AA5A3', text3: '#566870', turmeric: '#C27C0E', veil: 'rgba(220,230,234,0.5)' };
const AR = (EXT.lonMax - EXT.lonMin) / (EXT.latMax - EXT.latMin);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Bilinear-upsampled RGBA bitmap of a field. spec: {kind:'normal', scale, cmap?} or {kind:'diff', cmap, A, floor, sqrt} */
export function makeBitmap(field, spec) {
  const cv = document.createElement('canvas'); cv.width = NLON * S; cv.height = NLAT * S;
  const g = cv.getContext('2d'), img = g.createImageData(cv.width, cv.height), d = img.data, ow = cv.width;
  const diff = spec.kind === 'diff', L = diff ? lutDiff(spec.cmap) : lutNormal(spec.scale), sc = diff ? null : NORMAL[spec.scale], sq = !diff && sc.map === 'sqrt';
  const src = sq ? Float32Array.from(field, (x) => (x < 0.5 ? 0 : Math.sqrt(x))) : field; // sqrt keeps dry-to-wet edges from haloing
  for (let py = 0; py < NLAT * S; py++) {
    const gy = Math.min(NLAT - 1, Math.max(0, (NLAT * S - 1 - py + 0.5) / S - 0.5)), i0 = Math.min(NLAT - 2, Math.floor(gy)), fy = gy - i0;
    for (let px = 0; px < ow; px++) {
      const gx = Math.min(NLON - 1, Math.max(0, (px + 0.5) / S - 0.5)), j0 = Math.min(NLON - 2, Math.floor(gx)), fx = gx - j0, a = i0 * NLON + j0;
      const v = (src[a] * (1 - fx) + src[a + 1] * fx) * (1 - fy) + (src[a + NLON] * (1 - fx) + src[a + NLON + 1] * fx) * fy;
      let t, alpha = 255;
      if (diff) {
        const raw = v;
        t = (raw / spec.A + 1) / 2; alpha = 255 * smooth(spec.floor * 0.5, spec.floor * 1.5, Math.abs(raw));
        if (spec.sqrt) { const u = Math.min(1, Math.abs(raw) / spec.A); t = 0.5 + Math.sign(raw) * 0.5 * Math.sqrt(u); }
      } else t = sq ? v / Math.sqrt(sc.hi) : tOf(sc, v);
      t = t < 0 ? 0 : t > 1 ? 1 : t; const k = Math.round(t * 255) * 3, o = (py * ow + px) * 4;
      d[o] = L[k]; d[o + 1] = L[k + 1]; d[o + 2] = L[k + 2]; d[o + 3] = alpha;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

export class MapView {
  constructor(canvas, outlines) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.out = outlines;
    this.s = { bitmap: null, prev: null, mix: 1, diff: false, labels: true, box: null, dragBox: null, hover: null, place: null, highlight: [], hlLabels: [], isolines: null, arrows: null, empty: null, outlineAlpha: 0.22 };
    this.geo = { w: 0, h: 0, dpr: 0 };
    this.indiaRings = outlines.countries.find((c) => c.name === 'India').rings;
  }
  set(p) { Object.assign(this.s, p); this.draw(); }
  /** Fit inside the parent box; returns plot rect geometry. */
  fit() {
    const par = this.c.parentElement, dpr = window.devicePixelRatio || 1;
    const aw = Math.max(200, this.availW ? this.availW() : par.clientWidth), ah = Math.max(200, par.clientHeight);
    let pw = aw - MARGIN.l - MARGIN.r, ph = pw / AR;
    if (ph > ah - MARGIN.t - MARGIN.b) { ph = ah - MARGIN.t - MARGIN.b; pw = ph * AR; }
    const W = Math.round(pw + MARGIN.l + MARGIN.r), H = Math.round(ph + MARGIN.t + MARGIN.b);
    if (this.geo.w !== W || this.geo.h !== H || this.geo.dpr !== dpr) {
      this.c.width = Math.round(W * dpr); this.c.height = Math.round(H * dpr); this.c.style.width = W + 'px'; this.c.style.height = H + 'px';
      this.geo = { w: W, h: H, dpr, pw, ph }; this.paths = null; const pb = this.c.closest('.plate-body'); if (pb) pb.style.setProperty('--mapw', W + 'px');
    }
    return this.geo;
  }
  px(lo, la) { const { pw, ph } = this.geo; return [MARGIN.l + ((lo - EXT.lonMin) / (EXT.lonMax - EXT.lonMin)) * pw, MARGIN.t + ((EXT.latMax - la) / (EXT.latMax - EXT.latMin)) * ph]; }
  cellAt(ev) {
    const r = this.c.getBoundingClientRect(), { pw, ph } = this.geo, x = ev.clientX - r.left - MARGIN.l, y = ev.clientY - r.top - MARGIN.t;
    if (x < 0 || y < 0 || x > pw || y > ph) return null;
    const lo = EXT.lonMin + (x / pw) * (EXT.lonMax - EXT.lonMin), la = EXT.latMax - (y / ph) * (EXT.latMax - EXT.latMin);
    const i = Math.floor(la - 6), j = Math.floor(lo - 65);
    return i >= 0 && i < NLAT && j >= 0 && j < NLON ? { i, j, lat: la, lon: lo } : null;
  }
  cityAt(ev, rad = 12) {
    const r = this.c.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = null, bd = rad;
    for (const c of CITIES) { const [cx, cy] = this.px(c.lon, c.lat), dd = Math.hypot(cx - x, cy - y); if (dd < bd) { bd = dd; best = c; } }
    return best;
  }
  build() {
    const ring = (rings, closed) => { const p = new Path2D(); for (const r of rings) { for (let k = 0; k < r.length; k += 2) { const [x, y] = this.px(r[k], r[k + 1]); k ? p.lineTo(x, y) : p.moveTo(x, y); } if (closed) p.closePath(); } return p; };
    const byId = {}; for (const st of this.out.states) (byId[st.id] ||= []).push(...st.rings);
    const { pw, ph } = this.geo, veil = new Path2D(); veil.rect(MARGIN.l, MARGIN.t, pw, ph);
    veil.addPath(ring(this.indiaRings, true));
    this.paths = { countries: ring(this.out.countries.flatMap((c) => c.rings), true), india: ring(this.indiaRings, true), states: ring(this.out.states.flatMap((s) => s.rings), false), veil, byId: Object.fromEntries(Object.entries(byId).map(([k, v]) => [k, ring(v, true)])), centers: {} };
    for (const [id, rings] of Object.entries(byId)) { // label anchor: centre of the biggest ring's bbox
      let best = null, ba = -1;
      for (const r of rings) { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); y0 = Math.min(y0, r[k + 1]); y1 = Math.max(y1, r[k + 1]); } const a = (x1 - x0) * (y1 - y0); if (a > ba) { ba = a; best = [(x0 + x1) / 2, (y0 + y1) / 2]; } }
      this.paths.centers[id] = this.px(best[0], best[1]);
    }
  }
  draw() {
    const geo = this.fit(); if (!this.paths) this.build();
    const g = this.g, s = this.s, { dpr, pw, ph, w, h } = geo, P = this.paths;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.save(); g.beginPath(); g.rect(MARGIN.l, MARGIN.t, pw, ph); g.clip();
    g.fillStyle = C.ocean; g.fillRect(MARGIN.l, MARGIN.t, pw, ph);
    g.fillStyle = C.land; g.fill(P.countries);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (s.bitmap) {
      if (s.prev && s.mix < 1) { g.globalAlpha = 1; g.drawImage(s.prev, MARGIN.l, MARGIN.t, pw, ph); g.globalAlpha = s.mix; }
      g.drawImage(s.bitmap, MARGIN.l, MARGIN.t, pw, ph); g.globalAlpha = 1;
      if (!s.diff) { g.fillStyle = C.veil; g.fill(P.veil, 'evenodd'); } // dim sea and neighbouring countries outside India
    }
    if (s.isolines) this.drawIso(g, s.isolines);
    g.lineJoin = 'round'; g.setLineDash([]);
    g.strokeStyle = `rgba(15,37,48,${s.diff ? 0.12 : s.outlineAlpha})`; g.lineWidth = 0.6; g.stroke(P.states);
    g.strokeStyle = 'rgba(15,37,48,0.55)'; g.lineWidth = 0.9; g.stroke(P.countries);
    g.strokeStyle = C.ink; g.lineWidth = 1.3; g.stroke(P.india);
    if (s.arrows) this.drawArrows(g, s.arrows);
    if (s.highlight.length) {
      g.strokeStyle = C.turmeric; g.lineWidth = 1.9;
      for (const id of s.highlight) if (P.byId[id]) g.stroke(P.byId[id]);
    }
    g.restore();
    this.frame(g);
    if (s.labels) this.drawLabels(g);
    for (const hl of s.hlLabels) { const c = P.centers[hl.id]; if (c) this.tag(g, hl.text, c[0], c[1], C.turmeric, true); }
    if (s.box) this.rect(g, s.box, C.turmeric, [5, 3], 2, true, 'Your change');
    if (s.dragBox) this.rect(g, s.dragBox, C.ink, [3, 3], 1.4, false);
    if (s.hover) {
      const [x0, y0] = this.px(lon(s.hover.j) - 0.5, lat(s.hover.i) + 0.5), [x1, y1] = this.px(lon(s.hover.j) + 0.5, lat(s.hover.i) - 0.5), [cx, cy] = this.px(s.hover.lon, s.hover.lat);
      g.save(); g.beginPath(); g.rect(MARGIN.l, MARGIN.t, pw, ph); g.clip();
      g.strokeStyle = 'rgba(15,37,48,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(MARGIN.l, cy); g.lineTo(MARGIN.l + pw, cy); g.moveTo(cx, MARGIN.t); g.lineTo(cx, MARGIN.t + ph); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.strokeStyle = C.ink; g.lineWidth = 0.8; g.strokeRect(x0 - 0.8, y0 - 0.8, x1 - x0 + 1.6, y1 - y0 + 1.6); g.restore();
    }
    if (s.place) {
      const [x, y] = this.px(s.place.lon, s.place.lat); g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke();
      g.strokeStyle = C.ink; g.lineWidth = 1.8; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke();
    }
    if (s.empty) { g.fillStyle = 'rgba(241,243,242,.86)'; g.fillRect(MARGIN.l, MARGIN.t, pw, ph); g.fillStyle = C.ink; g.font = '500 14px "IBM Plex Sans", system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.empty, MARGIN.l + pw / 2, MARGIN.t + ph / 2); }
  }
  frame(g) {
    const { pw, ph } = this.geo; g.strokeStyle = C.frame; g.lineWidth = 1; g.setLineDash([]); g.strokeRect(MARGIN.l + 0.5, MARGIN.t + 0.5, pw, ph);
    g.fillStyle = C.text3; g.font = '400 11px "IBM Plex Sans", system-ui'; g.textBaseline = 'middle'; g.strokeStyle = C.frame;
    g.textAlign = 'right'; for (const la of [10, 20, 30]) { const [, y] = this.px(65, la); g.beginPath(); g.moveTo(MARGIN.l - 4, y); g.lineTo(MARGIN.l, y); g.stroke(); g.fillText(la + '°N', MARGIN.l - 6, y); }
    g.textAlign = 'center'; g.textBaseline = 'top'; for (const lo of [70, 80, 90, 100]) { const [x] = this.px(lo, 6), y = MARGIN.t + ph; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 4); g.stroke(); g.fillText(lo + '°E', x, y + 6); }
    // faint graticule lines
    g.save(); g.beginPath(); g.rect(MARGIN.l, MARGIN.t, pw, ph); g.clip(); g.strokeStyle = 'rgba(15,37,48,.07)'; g.lineWidth = 1; g.setLineDash([2, 4]); g.beginPath();
    for (const la of [10, 20, 30]) { const [, y] = this.px(65, la); g.moveTo(MARGIN.l, y); g.lineTo(MARGIN.l + pw, y); }
    for (const lo of [70, 80, 90, 100]) { const [x] = this.px(lo, 6); g.moveTo(x, MARGIN.t); g.lineTo(x, MARGIN.t + ph); }
    g.stroke(); g.restore();
    // north arrow
    const nx = MARGIN.l + pw - 16, ny = MARGIN.t + 14; g.setLineDash([]); g.strokeStyle = C.ink; g.fillStyle = C.ink; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(nx, ny + 12); g.lineTo(nx, ny - 2); g.stroke(); g.beginPath(); g.moveTo(nx, ny - 6); g.lineTo(nx - 3.5, ny); g.lineTo(nx + 3.5, ny); g.closePath(); g.fill();
    g.font = '600 10px "IBM Plex Sans", system-ui'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('N', nx, ny + 14);
  }
  tag(g, text, x, y, color, strong) {
    g.font = `${strong ? 600 : 500} 11.5px "IBM Plex Sans", system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 4; g.strokeStyle = 'rgba(250,251,250,.92)'; g.strokeText(text, x, y); g.fillStyle = strong ? '#8A5608' : color; g.fillText(text, x, y);
  }
  drawLabels(g) {
    const placed = []; g.lineJoin = 'round';
    const hit = (b) => placed.some((p) => !(b.x1 < p.x0 || b.x0 > p.x1 || b.y1 < p.y0 || b.y0 > p.y1));
    for (const c of CITIES) {
      const [x, y] = this.px(c.lon, c.lat); g.font = '500 11.5px "IBM Plex Sans", system-ui'; const tw = g.measureText(c.text).width, b = { x0: x - 4, x1: x + 10 + tw, y0: y - 8, y1: y + 8 };
      if (hit(b)) continue; placed.push(b);
      g.fillStyle = C.ink; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.1; g.stroke();
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(250,251,250,.9)'; g.strokeText(c.text, x + 6, y); g.fillStyle = C.ink; g.fillText(c.text, x + 6, y);
    }
    g.font = 'italic 400 12.5px Newsreader, Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of SEAS) { const [x, y] = this.px(l.lon, l.lat); g.lineWidth = 3.5; g.strokeStyle = 'rgba(220,230,234,.85)'; g.strokeText(l.text, x, y); g.fillStyle = '#2F5568'; g.fillText(l.text, x, y); }
  }
  rect(g, b, color, dash, lw, fill, tagText) {
    const [x0, y0] = this.px(lon(b.j0) - 0.5, lat(b.i1) + 0.5), [x1, y1] = this.px(lon(b.j1) + 0.5, lat(b.i0) - 0.5);
    if (fill) { g.fillStyle = 'rgba(194,124,14,.08)'; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
    g.strokeStyle = color; g.lineWidth = lw; g.setLineDash(dash); g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]);
    if (tagText) { g.font = '600 11px "IBM Plex Sans", system-ui'; const tw = g.measureText(tagText).width + 12, ty = y0 - 18 < MARGIN.t ? y1 : y0 - 18; g.fillStyle = color; g.fillRect(x0, ty, tw, 18); g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(tagText, x0 + 6, ty + 9.5); }
  }
  drawIso(g, iso) { // iso: [{path:[[lon,lat,lon,lat]...], label}] precomputed segments
    g.strokeStyle = 'rgba(15,37,48,.45)'; g.lineWidth = 0.8; g.beginPath();
    for (const seg of iso.segs) { const [x0, y0] = this.px(seg[0], seg[1]), [x1, y1] = this.px(seg[2], seg[3]); g.moveTo(x0, y0); g.lineTo(x1, y1); }
    g.stroke();
    g.font = '500 10px "IBM Plex Sans", system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of iso.labels) { const [x, y] = this.px(l.lon, l.lat); g.lineWidth = 3; g.strokeStyle = 'rgba(250,251,250,.85)'; g.strokeText(l.text, x, y); g.fillStyle = C.ink; g.fillText(l.text, x, y); }
  }
  drawArrows(g, { u, v }) {
    const { pw } = this.geo, cw = pw / (EXT.lonMax - EXT.lonMin); g.lineWidth = 1.1;
    for (let i = 1; i < NLAT; i += 2) for (let j = 1; j < NLON; j += 2) {
      const k = i * NLON + j, uu = u[k], vv = v[k], m = Math.hypot(uu, vv); if (m < 1.5) continue;
      const len = Math.min(m / 10, 1.4) * cw * 1.6, ang = Math.atan2(-vv, uu), [x, y] = this.px(lon(j), lat(i)), hx = x + Math.cos(ang) * len * 0.5, hy = y + Math.sin(ang) * len * 0.5, tx = x - Math.cos(ang) * len * 0.5, ty = y - Math.sin(ang) * len * 0.5;
      for (const [col, lw] of [['rgba(250,251,250,.85)', 3], ['rgba(15,37,48,.72)', 1.1]]) {
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke();
        if (lw < 2) { g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - 4 * Math.cos(ang - 0.5), hy - 4 * Math.sin(ang - 0.5)); g.lineTo(hx - 4 * Math.cos(ang + 0.5), hy - 4 * Math.sin(ang + 0.5)); g.closePath(); g.fill(); }
      }
    }
  }
}

/** Marching squares on the 1-degree grid for isobars every `step` hPa. */
export function isobars(field, step = 4) {
  const segs = [], labels = [], lo0 = Math.floor(Math.min(...field) / step) * step, hi0 = Math.max(...field);
  const cx = (j) => lon(j), cy = (i) => lat(i);
  for (let lv = lo0; lv <= hi0; lv += step) {
    let lab = false;
    for (let i = 0; i < NLAT - 1; i++) for (let j = 0; j < NLON - 1; j++) {
      const a = field[i * NLON + j], b = field[i * NLON + j + 1], c = field[(i + 1) * NLON + j + 1], d = field[(i + 1) * NLON + j]; // a(i,j) b(i,j+1) c(i+1,j+1) d(i+1,j)
      const pts = [], edge = (v0, v1, x0, y0, x1, y1) => { if ((v0 < lv) !== (v1 < lv)) { const t = (lv - v0) / (v1 - v0); pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); } };
      edge(a, b, cx(j), cy(i), cx(j + 1), cy(i)); edge(b, c, cx(j + 1), cy(i), cx(j + 1), cy(i + 1)); edge(d, c, cx(j), cy(i + 1), cx(j + 1), cy(i + 1)); edge(a, d, cx(j), cy(i), cx(j), cy(i + 1));
      if (pts.length >= 2) { segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]); if (pts.length === 4) segs.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]]); if (!lab && j > 4 && j < 30 && i > 4 && i < 28 && (i + j) % 7 === 0) { labels.push({ lon: pts[0][0], lat: pts[0][1], text: String(lv) }); lab = true; } }
    }
  }
  return { segs, labels };
}
