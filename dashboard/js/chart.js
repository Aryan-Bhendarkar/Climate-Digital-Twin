// Tiny dependency-free line chart on Canvas 2D (series, axes, hover read-out, current-day marker).
export class LineChart {
  constructor(canvas, opts = {}) {
    this.c = canvas; this.o = Object.assign({ xLabel: 'day', yLabel: '', log: false, marker: null, fmt: (v) => v.toPrecision(3) }, opts);
    this.series = []; this.hover = null;
    canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); this.hover = e.clientX - r.left; this.draw(); });
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  set(series, opts = {}) { this.series = series; Object.assign(this.o, opts); this.draw(); }
  draw() {
    const c = this.c, dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement), fg = css.getPropertyValue('--muted').trim() || '#9aa', grid = css.getPropertyValue('--line').trim() || '#334';
    const L = 46, R = 10, T = 14, B = 26, w = W - L - R, h = H - T - B;
    const all = this.series.flatMap((s) => s.y.filter(Number.isFinite));
    if (!all.length) { g.fillStyle = fg; g.font = '12px system-ui'; g.fillText('No data yet', L + 8, T + 20); return; }
    const tr = (v) => (this.o.log ? Math.log10(Math.max(v, 1e-9)) : v);
    let lo = Math.min(...all.map(tr)), hi = Math.max(...all.map(tr));
    if (this.o.zero && !this.o.log) lo = Math.min(lo, 0);
    if (this.o.log) { lo = Math.max(lo, hi - 8); lo = Math.floor(lo); hi = Math.ceil(hi); }
    else { if (hi - lo < 1e-9) { hi += 1; lo -= 1; } const p = (hi - lo) * 0.08; hi += p; if (!this.o.zero || lo < 0) lo -= p; }
    const xs = this.series[0].x, x0 = xs[0], x1 = xs[xs.length - 1];
    const X = (v) => L + ((v - x0) / (x1 - x0 || 1)) * w, Y = (v) => T + h - ((tr(v) - lo) / (hi - lo)) * h;
    g.font = '11px system-ui'; g.lineWidth = 1; g.textAlign = 'right'; g.fillStyle = fg; g.strokeStyle = grid;
    const ticks = [];
    if (this.o.log) { const st = Math.max(1, Math.ceil((hi - lo) / 5)); for (let e = lo; e <= hi; e += st) ticks.push(e); }
    else for (let k = 0; k <= 4; k++) ticks.push(lo + ((hi - lo) * k) / 4);
    for (const tv of ticks) {
      const y = T + h - ((tv - lo) / (hi - lo)) * h, val = this.o.log ? Math.pow(10, tv) : tv;
      g.beginPath(); g.moveTo(L, y); g.lineTo(L + w, y); g.stroke();
      g.fillText(this.o.log ? '1e' + tv : this.o.fmt(val), L - 5, y + 4);
    }
    g.textAlign = 'center';
    xs.forEach((v) => { if (xs.length <= 12 || v % 2 === 0) g.fillText(v, X(v), H - 10); });
    g.fillText(this.o.xLabel, L + w / 2, H - 0.5);
    if (this.o.marker != null) { g.strokeStyle = 'rgba(255,255,255,.28)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(this.o.marker), T); g.lineTo(X(this.o.marker), T + h); g.stroke(); g.setLineDash([]); }
    for (const s of this.series) {
      g.strokeStyle = s.color; g.lineWidth = s.width || 2; g.setLineDash(s.dash || []); g.beginPath();
      s.y.forEach((v, k) => { const px = X(s.x[k]), py = Y(v); k ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke(); g.setLineDash([]); g.fillStyle = s.color;
      s.y.forEach((v, k) => { g.beginPath(); g.arc(X(s.x[k]), Y(v), 2.5, 0, 7); g.fill(); });
    }
    if (this.hover != null && this.hover >= L && this.hover <= L + w) {
      let best = 0, bd = 1e9; xs.forEach((v, k) => { const d = Math.abs(X(v) - this.hover); if (d < bd) { bd = d; best = k; } });
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(X(xs[best]), T); g.lineTo(X(xs[best]), T + h); g.stroke();
      const lines = [`${this.o.xLabel} ${xs[best]}`, ...this.series.map((s) => `${s.name}: ${this.o.fmt(s.y[best])}`)];
      const bw = Math.max(...lines.map((t) => g.measureText(t).width)) + 14, bx = X(xs[best]) + 8 + bw > W ? X(xs[best]) - bw - 8 : X(xs[best]) + 8;
      g.fillStyle = 'rgba(12,16,26,.92)'; g.fillRect(bx, T + 2, bw, lines.length * 15 + 8);
      g.textAlign = 'left'; lines.forEach((t, k) => { g.fillStyle = k ? this.series[k - 1].color : '#dde'; g.fillText(t, bx + 7, T + 17 + k * 15); });
    }
  }
}
