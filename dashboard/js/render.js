// Canvas 2D map panel: bilinear-upsampled heatmap + outlines + wind arrows + shock box + hover cell.
import { NLAT, NLON, EXT, lat, lon } from './util.js';
import { lut } from './colormaps.js';

const S = 6; // offscreen upsampling factor
const off = document.createElement('canvas'); off.width = NLON * S; off.height = NLAT * S;
const offg = off.getContext('2d'); const img = offg.createImageData(off.width, off.height);

export class MapPanel {
  constructor(canvas, outlines) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.out = outlines;
    this.state = { field: null, lo: 0, hi: 1, cmap: 'viridis', box: null, hoverCell: null, arrows: null, empty: null, dragBox: null, labels: null, outline: null, boxText: null };
    new ResizeObserver(() => this.draw()).observe(canvas.parentElement);
  }
  set(p) { Object.assign(this.state, p); this.draw(); }
  size() {
    const par = this.c.parentElement, dpr = window.devicePixelRatio || 1;
    let W = par.clientWidth, H = Math.round((W * (EXT.latMax - EXT.latMin)) / (EXT.lonMax - EXT.lonMin));
    const maxH = par.clientHeight; if (maxH && H > maxH) { H = maxH; W = Math.round((H * (EXT.lonMax - EXT.lonMin)) / (EXT.latMax - EXT.latMin)); }
    if (this.c.width !== Math.round(W * dpr) || this.c.height !== Math.round(H * dpr)) { this.c.width = Math.round(W * dpr); this.c.height = Math.round(H * dpr); this.c.style.width = W + 'px'; this.c.style.height = H + 'px'; }
    return { W, H, dpr };
  }
  px(lo, la, W, H) { return [((lo - EXT.lonMin) / (EXT.lonMax - EXT.lonMin)) * W, ((EXT.latMax - la) / (EXT.latMax - EXT.latMin)) * H]; }
  /** pointer -> grid cell {i,j} or null */
  cellAt(ev) {
    const r = this.c.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    const lo = EXT.lonMin + x * (EXT.lonMax - EXT.lonMin), la = EXT.latMax - y * (EXT.latMax - EXT.latMin);
    const i = Math.floor(la - 6), j = Math.floor(lo - 65);
    return i >= 0 && i < NLAT && j >= 0 && j < NLON ? { i, j } : null;
  }
  draw() {
    const { W, H, dpr } = this.size(), g = this.g, s = this.state;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const light = !!s.outline; g.fillStyle = light ? '#e8eeea' : '#0b0f19'; g.fillRect(0, 0, W, H);
    if (s.field) {
      const L = lut(s.cmap), f = s.field, span = s.hi - s.lo || 1, d = img.data, ow = NLON * S;
      for (let py = 0; py < NLAT * S; py++) {
        const gy = Math.min(NLAT - 1, Math.max(0, (NLAT * S - 1 - py + 0.5) / S - 0.5)), i0 = Math.min(NLAT - 2, Math.floor(gy)), fy = gy - i0;
        for (let px = 0; px < ow; px++) {
          const gx = Math.min(NLON - 1, Math.max(0, (px + 0.5) / S - 0.5)), j0 = Math.min(NLON - 2, Math.floor(gx)), fx = gx - j0;
          const a = i0 * NLON + j0, v = (f[a] * (1 - fx) + f[a + 1] * fx) * (1 - fy) + (f[a + NLON] * (1 - fx) + f[a + NLON + 1] * fx) * fy;
          let t = (v - s.lo) / span; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const k = Math.round(t * 255) * 3, o = (py * ow + px) * 4;
          d[o] = L[k]; d[o + 1] = L[k + 1]; d[o + 2] = L[k + 2]; d[o + 3] = 255;
        }
      }
      offg.putImageData(img, 0, 0);
      // grid covers cell edges lon 65..101 / lat 6..38 == full extent
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(off, 0, 0, W, H);
    }
    this.outlines(g, W, H);
    if (s.labels) this.drawLabels(g, W, H, s.labels);
    if (s.arrows) this.drawArrows(g, W, H, s.arrows);
    if (s.box) {
      const bc = s.outline ? '#c8741b' : '#ffd166';
      this.rect(g, W, H, s.box, bc, [5, 3], s.outline ? 2.2 : 1.6, true);
      if (s.boxText) { const [bx, by] = this.px(lon(s.box.j0) - 0.5, lat(s.box.i1) + 0.5, W, H); g.font = '700 12px system-ui'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; const tw = g.measureText(s.boxText).width + 12; g.fillStyle = bc; g.fillRect(bx, by - 19, tw, 19); g.fillStyle = '#fff'; g.fillText(s.boxText, bx + 6, by - 5); }
    }
    if (s.dragBox) this.rect(g, W, H, s.dragBox, '#ffffff', [3, 3], 1.4, false);
    if (s.hoverCell) {
      const [x0, y0] = this.px(lon(s.hoverCell.j) - 0.5, lat(s.hoverCell.i) + 0.5, W, H), [x1, y1] = this.px(lon(s.hoverCell.j) + 0.5, lat(s.hoverCell.i) - 0.5, W, H);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.setLineDash([]); g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (s.pick) {
      const [x, y] = this.px(lon(s.pick.j), lat(s.pick.i), W, H);
      g.strokeStyle = '#f472b6'; g.lineWidth = 2; g.setLineDash([]); g.beginPath(); g.arc(x, y, 5, 0, 7); g.stroke();
    }
    if (s.empty) { g.fillStyle = light ? 'rgba(232,238,234,.88)' : 'rgba(11,15,25,.78)'; g.fillRect(0, 0, W, H); g.fillStyle = light ? '#4f606b' : '#9fb0c8'; g.font = '600 13px system-ui'; g.textAlign = 'center'; const ls = s.empty.split('\n'); ls.forEach((t, k) => g.fillText(t, W / 2, H / 2 + (k - (ls.length - 1) / 2) * 18)); }
  }
  outlines(g, W, H) {
    const draw = (rings, style, lw) => {
      g.strokeStyle = style; g.lineWidth = lw; g.lineJoin = 'round'; g.beginPath();
      for (const r of rings) { for (let k = 0; k < r.length; k += 2) { const [x, y] = this.px(r[k], r[k + 1], W, H); k ? g.lineTo(x, y) : g.moveTo(x, y); } }
      g.stroke();
    };
    g.setLineDash([]);
    const o = this.state.outline;
    draw(this.out.states.flatMap((s) => s.rings), o ? o.states : 'rgba(255,255,255,.34)', o ? 0.8 : 0.7);
    draw(this.out.countries.flatMap((s) => s.rings), o ? o.countries : 'rgba(255,255,255,.85)', o ? 1.5 : 1.1);
  }
  drawLabels(g, W, H, labels) { // [{lon,lat,text,dot,sea}] drawn with a light halo so they read on any colour
    g.textBaseline = 'middle'; g.lineJoin = 'round';
    for (const l of labels) {
      const [x, y] = this.px(l.lon, l.lat, W, H);
      g.font = l.sea ? 'italic 600 12px system-ui' : '600 12px system-ui'; g.textAlign = l.sea ? 'center' : 'left';
      const tx = l.sea ? x : x + 7;
      if (l.dot) { g.fillStyle = '#10202b'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke(); }
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(255,255,255,.85)'; g.strokeText(l.text, tx, y);
      g.fillStyle = l.sea ? '#2b4a66' : '#10202b'; g.fillText(l.text, tx, y);
    }
  }
  rect(g, W, H, b, color, dash, lw, fill) { // b: {i0,i1,j0,j1} inclusive cell ranges
    const [x0, y0] = this.px(lon(b.j0) - 0.5, lat(b.i1) + 0.5, W, H), [x1, y1] = this.px(lon(b.j1) + 0.5, lat(b.i0) - 0.5, W, H);
    if (fill) { g.fillStyle = 'rgba(255,209,102,.10)'; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
    g.strokeStyle = color; g.lineWidth = lw; g.setLineDash(dash); g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]);
  }
  drawArrows(g, W, H, { u, v, scale }) {
    const step = 2; g.strokeStyle = 'rgba(255,255,255,.85)'; g.fillStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1;
    const cw = W / (EXT.lonMax - EXT.lonMin);
    for (let i = 1; i < NLAT; i += step) for (let j = 1; j < NLON; j += step) {
      const k = i * NLON + j, uu = u[k], vv = v[k], m = Math.hypot(uu, vv);
      if (m < scale * 0.04) continue;
      const len = Math.min(m / scale, 1.6) * cw * 1.7, ang = Math.atan2(-vv, uu), [x, y] = this.px(lon(j), lat(i), W, H);
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      g.beginPath(); g.moveTo(x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5); g.lineTo(x2 - Math.cos(ang) * len * 0.5, y2 - Math.sin(ang) * len * 0.5); g.stroke();
      const hx = x2 - Math.cos(ang) * len * 0.5, hy = y2 - Math.sin(ang) * len * 0.5;
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx - 4 * Math.cos(ang - 0.45), hy - 4 * Math.sin(ang - 0.45)); g.lineTo(hx - 4 * Math.cos(ang + 0.45), hy - 4 * Math.sin(ang + 0.45)); g.closePath(); g.fill();
    }
  }
}

/** Colour bar drawn on a small canvas with unit label. */
export function drawColorbar(canvas, cmap, lo, hi, unit, fmtv, note) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight; if (!W) return;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = lut(cmap), barH = 9, x0 = 6, w = W - 12;
  for (let x = 0; x < w; x++) { const k = Math.round((x / (w - 1)) * 255) * 3; g.fillStyle = `rgb(${L[k]},${L[k + 1]},${L[k + 2]})`; g.fillRect(x0 + x, 2, 1, barH); }
  g.fillStyle = '#9fb0c8'; g.font = '11px system-ui'; g.textBaseline = 'alphabetic';
  g.textAlign = 'left'; g.fillText(fmtv(lo), x0, H - 3);
  g.textAlign = 'center'; g.fillText(fmtv((lo + hi) / 2) + '  ' + unit, W / 2, H - 3);
  g.textAlign = 'right'; g.fillText(fmtv(hi), W - 6, H - 3);
}
