import { NLAT, NLON, NCELL, NCH, CH, STD, lat, lon, rIdx, flatten, stepsOf, fmt } from './util.js';
import { rgbCss } from './colormaps.js';
import { Api } from './api.js';
import { MapPanel, drawColorbar } from './render.js';
import { LineChart } from './chart.js';
import { PRESETS, DISPLAY_UNITS, boxFromLatLon, boxLabel, buildPerturbation, ripple, maxAbsDiff } from './shock.js';
import { kharif, windIndex, WIND_STATES } from './impact.js';

const $ = (id) => document.getElementById(id);
const VARS = [
  { key: 't2m', short: 'Temp', label: '2 m temperature', unit: '°C', cmapV: 'inferno', cmapD: 'rdbu', dec: 1, f: (r, d, k) => r[rIdx(d, 0) + k] - 273.15 },
  { key: 'tp', short: 'Rain', label: 'Rain', unit: 'mm/day', cmapV: 'ice', cmapD: 'brbg', dec: 1, zero: true, f: (r, d, k) => r[rIdx(d, 1) + k] },
  { key: 'wind', short: 'Wind', label: '10 m wind speed', unit: 'm/s', cmapV: 'viridis', cmapD: 'rdbu', dec: 1, zero: true, f: (r, d, k) => Math.hypot(r[rIdx(d, 2) + k], r[rIdx(d, 3) + k]) },
  { key: 'msl', short: 'MSLP', label: 'Sea-level pressure', unit: 'hPa', cmapV: 'cividis', cmapD: 'rdbu', dec: 1, f: (r, d, k) => r[rIdx(d, 4) + k] / 100 },
  { key: 'tcwv', short: 'TCWV', label: 'Column water vapour', unit: 'kg/m²', cmapV: 'mako', cmapD: 'brbg', dec: 1, f: (r, d, k) => r[rIdx(d, 5) + k] },
];
// Server URL: ?server=api -> same-origin proxy (dashboard/devserver.py); else last used; else 127.0.0.1:8000
// (127.0.0.1, not "localhost": on Windows localhost may resolve to IPv6 while the server listens on IPv4).
function defaultServer() {
  const q = new URLSearchParams(location.search).get('server');
  if (q === 'api') return `${location.origin}/api`;
  if (q) return q;
  try { const s = localStorage.getItem('mm_server'); if (s) return s; } catch (e) { /* storage unavailable */ }
  return 'http://127.0.0.1:8000';
}
const S = {
  api: new Api(defaultServer()),
  assets: null, samples: [], sample: null, init: null, doy: null, name: '',
  prime: null, mv: null, mvInit: null, msP: null, msM: null, shock: null, rip: null,
  v: 0, day: 1, playing: false, timer: null, box: null, comps: [], pick: { i: 14, j: 18 }, healthy: false, baseP: null,
  fieldCache: null, deltaPerDay: false, arrows: false, sortKey: 'dStress', sortAsc: false, tab: 'ripple', busy: 0, runId: 0,
};
window.__S = S; // for debugging / tests

// ---------- helpers ----------
function toast(msg, kind = 'err', ms = 6500) {
  const t = document.createElement('div'); t.className = 'toast ' + (kind === 'err' ? '' : 'info'); t.textContent = msg; $('toasts').appendChild(t); setTimeout(() => t.remove(), ms);
}
function busy(on, txt) {
  S.busy += on ? 1 : -1; $('busyTxt').textContent = txt || 'Running the model'; $('busy').hidden = S.busy <= 0;
  for (const id of ['btnRun', 'btnNull']) $(id).disabled = S.busy > 0;
}
const lonS = (v) => `${v}°E`, latS = (v) => `${v}°N`;

// ---------- fields & scales ----------
function fieldOf(roll, d, v) { const out = new Float32Array(NCELL); for (let k = 0; k < NCELL; k++) out[k] = v.f(roll, d, k); return out; }
function buildCache() {
  const v = VARS[S.v], n = S.prime ? stepsOf(S.prime) : 0, c = { P: [], M: [], D: [] };
  if (!n) return (S.fieldCache = null);
  for (let d = 0; d < n; d++) {
    c.P.push(fieldOf(S.prime, d, v));
    if (S.mv) { const m = fieldOf(S.mv, d, v); c.M.push(m); c.D.push(m.map((x, k) => x - c.P[d][k])); }
  }
  const all = [...c.P, ...c.M].flatMap((a) => Array.from(a)).sort((x, y) => x - y), q = (p) => all[Math.min(all.length - 1, Math.floor(p * (all.length - 1)))];
  c.lo = v.zero ? 0 : q(0.002); c.hi = v.key === 'tp' ? Math.max(q(0.995), 1) : q(0.998);
  if (c.hi - c.lo < 1e-6) c.hi = c.lo + 1;
  c.dmax = c.D.length ? Math.max(...c.D.map((a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0))) : 0;
  c.dday = c.D.map((a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0));
  S.fieldCache = c;
}
const nicefmt = (dec) => (x) => (Math.abs(x) < 1e-12 ? '0' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(Math.min(dec, 1)) : x.toFixed(2));

// ---------- panels ----------
const outlinesPromise = fetch('assets/outlines.json').then((r) => r.json());
let panels = null, charts = null;
function setupPanels(outlines) {
  panels = { P: new MapPanel($('cvP'), outlines), M: new MapPanel($('cvM'), outlines), D: new MapPanel($('cvD'), outlines) };
  for (const key of ['P', 'M', 'D']) bindMap(key, $('cv' + key));
  charts = {
    ripple: new LineChart($('cvRipple'), { yLabel: 'energy', log: true, fmt: (v) => v.toExponential(1) }),
    cell: new LineChart($('cvCell'), {}), cellD: new LineChart($('cvCellD'), {}),
  };
}
function render() {
  if (!panels) return;
  const v = VARS[S.v], c = S.fieldCache, d = S.day - 1;
  if (!c) { for (const k of ['P', 'M', 'D']) panels[k].set({ field: null, empty: 'Waiting for the model…', box: null }); return; }
  const arrow = (roll, dd) => S.arrows && roll ? { u: roll.subarray(rIdx(dd, 2), rIdx(dd, 2) + NCELL), v: roll.subarray(rIdx(dd, 3), rIdx(dd, 3) + NCELL), scale: 8 } : null;
  const common = { box: S.box, pick: S.pick };
  panels.P.set({ ...common, field: c.P[d], lo: c.lo, hi: c.hi, cmap: v.cmapV, empty: null, arrows: arrow(S.prime, d) });
  if (S.mv) {
    const dm = S.deltaPerDay ? c.dday[d] : c.dmax, A = Math.max(dm, 1e-6);
    panels.M.set({ ...common, field: c.M[d], lo: c.lo, hi: c.hi, cmap: v.cmapV, empty: null, arrows: arrow(S.mv, d) });
    let darrow = null;
    if (S.arrows) { const du = new Float32Array(NCELL), dv = new Float32Array(NCELL); for (let k = 0; k < NCELL; k++) { du[k] = S.mv[rIdx(d, 2) + k] - S.prime[rIdx(d, 2) + k]; dv[k] = S.mv[rIdx(d, 3) + k] - S.prime[rIdx(d, 3) + k]; } darrow = { u: du, v: dv, scale: 1 }; }
    panels.D.set({ ...common, field: c.D[d], lo: -A, hi: A, cmap: v.cmapD, empty: null, arrows: darrow });
    drawColorbar($('cbM'), v.cmapV, c.lo, c.hi, v.unit, nicefmt(v.dec));
    drawColorbar($('cbD'), v.cmapD, -A, A, 'Δ ' + v.unit + (dm < 1e-9 ? ' (no change)' : ''), nicefmt(v.dec));
  } else {
    const msg = 'Draw a box (or pick a preset)\nthen press “Run shock”';
    panels.M.set({ ...common, field: null, empty: msg, arrows: null }); panels.D.set({ ...common, field: null, empty: msg, arrows: null });
    drawColorbar($('cbM'), v.cmapV, c.lo, c.hi, v.unit, nicefmt(v.dec)); drawColorbar($('cbD'), v.cmapD, -1, 1, 'Δ ' + v.unit, nicefmt(v.dec));
  }
  drawColorbar($('cbP'), v.cmapV, c.lo, c.hi, v.unit, nicefmt(v.dec));
    $('capP').textContent = `${v.short}, day ${S.day}`; $('capM').textContent = S.shock ? S.shock.short : ''; $('capD').textContent = S.mv ? `max |Δ| ${nicefmt(v.dec)(S.deltaPerDay ? c.dday[d] : c.dmax)} ${v.unit}` : '';
  $('dayLbl').textContent = S.day; $('rngDay').value = S.day;
  updateCharts();
}
function updateCharts() {
  if (!charts) return;
  if (S.rip) {
    const x = S.rip.inside.map((_, i) => i + 1), fl = (a) => a.map((q) => Math.max(q, 1e-12));
    charts.ripple.set([{ name: 'near the box', x, y: fl(S.rip.inside), color: '#3B6AA8' }, { name: 'elsewhere', x, y: fl(S.rip.outside), color: '#C0703E' }], { marker: S.day, log: $('chkLog').checked });
  } else charts.ripple.set([]);
  drawCellCharts();
}
function drawCellCharts() {
  const v = VARS[S.v], { i, j } = S.pick, k = i * NLON + j;
  if (!S.prime) return;
  $('cellTitle').textContent = `${v.label} at ${latS(lat(i))}, ${lonS(lon(j))} (${v.unit})`;
  const n = stepsOf(S.prime), x = Array.from({ length: n + 1 }, (_, d) => d);
  const p0 = v.f(S.init, 2, k), p = [p0, ...Array.from({ length: n }, (_, d) => v.f(S.prime, d, k))];
  const series = [{ name: 'Prime', x, y: p, color: '#8fb8c4' }];
  let dser = [];
  if (S.mv) {
    const m0 = S.mvInit ? v.f(S.mvInit, 0, k) : p0, m = [m0, ...Array.from({ length: n }, (_, d) => v.f(S.mv, d, k))];
    series.push({ name: 'Multiverse', x, y: m, color: '#f2a35e', dash: [5, 3] });
    dser = [{ name: 'Δ', x, y: m.map((q, q2) => q - p[q2]), color: '#c99a1e' }];
  }
  const f = (q) => (Math.abs(q) >= 100 ? q.toFixed(0) : q.toFixed(2));
  charts.cell.set(series, { marker: S.day, fmt: f }); charts.cellD.set(dser, { marker: S.day, fmt: (q) => q.toFixed(3), zero: true });
}

// ---------- map interaction: hover / click / drag-box ----------
function bindMap(key, cv) {
  let down = null;
  const tip = $('tip');
  cv.addEventListener('mousemove', (e) => {
    const cell = panels[key].cellAt(e);
    if (down) {
      const c2 = panels[key].cellAt(e);
      if (c2 && (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || down.moved)) { down.moved = true; setDrag(down.cell, c2); }
    }
    for (const k of ['P', 'M', 'D']) panels[k].set({ hoverCell: cell });
    if (!cell) { tip.hidden = true; return; }
    const v = VARS[S.v], c = S.fieldCache, d = S.day - 1, k = cell.i * NLON + cell.j, f = (x) => x.toFixed(v.dec === 1 ? 2 : 2);
    let h = `<b>${latS(lat(cell.i))}, ${lonS(lon(cell.j))}</b><br>`;
    if (c) {
      h += `Prime: <b>${f(c.P[d][k])}</b> ${v.unit}`;
      if (S.mv) h += `<br>Multiverse: <b>${f(c.M[d][k])}</b><br><span class="d">Δ: ${c.D[d][k] >= 0 ? '+' : ''}${f(c.D[d][k])}</span>`;
    }
    tip.innerHTML = h; tip.hidden = false; tip.style.left = Math.min(e.clientX + 14, innerWidth - 190) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - 90) + 'px';
  });
  cv.addEventListener('mouseleave', () => { tip.hidden = true; for (const k of ['P', 'M', 'D']) panels[k].set({ hoverCell: null }); });
  cv.addEventListener('mousedown', (e) => { const cell = panels[key].cellAt(e); if (cell) { down = { cell, x: e.clientX, y: e.clientY, moved: false }; e.preventDefault(); } });
  window.addEventListener('mouseup', (e) => {
    if (!down) return;
    const dn = down; down = null;
    for (const k of ['P', 'M', 'D']) panels[k].set({ dragBox: null });
    const c2 = panels[key].cellAt(e) || dn.cell;
    if (dn.moved) { S.box = { i0: Math.min(dn.cell.i, c2.i), i1: Math.max(dn.cell.i, c2.i), j0: Math.min(dn.cell.j, c2.j), j1: Math.max(dn.cell.j, c2.j) }; $('selPreset').value = 'custom'; updateBoxUI(); render(); }
    else if (c2 === dn.cell || (c2.i === dn.cell.i && c2.j === dn.cell.j)) { S.pick = { i: dn.cell.i, j: dn.cell.j }; selectTab('cell'); render(); }
  });
}
function setDrag(a, b) {
  const bx = { i0: Math.min(a.i, b.i), i1: Math.max(a.i, b.i), j0: Math.min(a.j, b.j), j1: Math.max(a.j, b.j) };
  for (const k of ['P', 'M', 'D']) panels[k].set({ dragBox: bx });
}
function updateBoxUI() { $('boxLbl').textContent = S.box ? boxLabel(S.box) : 'No box yet. Drag on a map.'; }

// ---------- shock UI ----------
function compText(cp) { const u = cp.mode === 'pct' ? '%' : ' ' + DISPLAY_UNITS[cp.ch]; return `${CH[cp.ch].key} ${cp.value >= 0 ? '+' : ''}${cp.value}${u}`; }
function renderComps() {
  const el = $('comps'); el.innerHTML = '';
  if (!S.comps.length) el.innerHTML = '<span class="hint">No components yet. Add one or pick a preset.</span>';
  S.comps.forEach((cp, idx) => { const s = document.createElement('span'); s.className = 'comp'; s.textContent = compText(cp); const b = document.createElement('button'); b.textContent = '✕'; b.title = 'remove'; b.onclick = () => { S.comps.splice(idx, 1); renderComps(); }; s.appendChild(b); el.appendChild(s); });
}
function applyPreset(id) {
  if (id === 'custom') return;
  const p = PRESETS[id]; S.box = boxFromLatLon(...p.box); S.comps = p.comps.map((c) => ({ ...c })); updateBoxUI(); renderComps(); render();
}
function describeShock() { return S.comps.map(compText).join(', ') + ' @ ' + (S.box ? `${lat(S.box.i0) - 0.5}–${lat(S.box.i1) + 0.5}°N ${lon(S.box.j0) - 0.5}–${lon(S.box.j1) + 0.5}°E` : ''); }

async function ensureBase() {
  if (S.prime) return;
  const t0 = performance.now(), r = await S.api.run(S.init, S.doy, null);
  S.prime = r.roll; S.msP = r.ms;
}
async function runBase() {
  const id = ++S.runId;
  busy(true, 'Running Timeline Prime…');
  try { const r = await S.api.run(S.init, S.doy, null); if (id !== S.runId) return; S.prime = r.roll; S.msP = r.ms; S.mv = null; S.shock = null; S.rip = null; S.mvInit = null; afterNewData(); setMs(); }
  catch (e) { toast(e.message); } finally { busy(false); }
}
async function runShock() {
  if (!S.init) return;
  if (!S.box) return toast('Draw a box on a map (or choose a preset) first.', 'info');
  if (!S.comps.length) return toast('Add at least one shock component.', 'info');
  const last = S.init.subarray(2 * NCH * NCELL), { pert, clamped } = buildPerturbation(last, S.box, S.comps);
  const id = ++S.runId; busy(true, 'Running Prime and Multiverse in parallel…');
  try {
    const t0 = performance.now();
    const [base, shocked] = await Promise.all([S.prime ? Promise.resolve({ roll: S.prime, ms: S.msP }) : S.api.run(S.init, S.doy, null), S.api.run(S.init, S.doy, pert)]);
    if (id !== S.runId) return;
    S.wall = performance.now() - t0; S.prime = base.roll; S.msP = base.ms; S.mv = shocked.roll; S.msM = shocked.ms;
    S.mvInit = Float32Array.from(last, (x, k) => x + pert[k]);
    S.shock = { box: { ...S.box }, comps: S.comps.map((c) => ({ ...c })), desc: describeShock(), short: S.comps.map(compText).join(', ') };
    $('clampNote').hidden = !clamped; $('clampNote').textContent = clamped ? 'Note: rain / water-vapour deltas were clamped so the shocked state stays ≥ 0.' : '';
    $('nullBadge').hidden = true;
    const bad = shocked.roll.some((x) => !Number.isFinite(x)); if (bad) toast('Model returned non-finite values for this shock.');
    afterNewData(); setMs();
  } catch (e) { toast(e.message); } finally { busy(false); }
}
async function nullCheck() {
  if (!S.init) return;
  busy(true, 'Null shock: sending an all-zero perturbation…');
  try {
    await ensureBase();
    const r = await S.api.run(S.init, S.doy, new Float32Array(NCH * NCELL));
    const m = maxAbsDiff(r.roll, S.prime);
    S.mv = r.roll; S.msM = r.ms; S.mvInit = Float32Array.from(S.init.subarray(2 * NCH * NCELL)); S.shock = { box: S.box ? { ...S.box } : null, comps: [], desc: 'null shock (all zeros)', short: 'null shock' };
    const b = $('nullBadge'); b.hidden = false; b.className = 'badge ' + (m === 0 ? 'ok' : 'bad');
    b.textContent = m === 0 ? 'Identical: a zero shock changes nothing, bit for bit (max |Δ| = 0).' : `Not identical: max |Δ| = ${m.toExponential(2)}.`;
    afterNewData(); setMs();
  } catch (e) { toast(e.message); } finally { busy(false); }
}
function setMs() {
  const c = $('chipMs'); c.hidden = !S.msP;
  c.textContent = `Prime ${fmt(S.msP, 0)} ms` + (S.msM != null && S.mv ? ` · Multiverse ${fmt(S.msM, 0)} ms` + (S.wall ? ` · both in parallel ${fmt(S.wall, 0)} ms wall` : '') : '');
}
function afterNewData() { buildCache(); computeDerived(); render(); renderImpact(); }
function computeDerived() {
  if (S.mv && S.shock) {
    const b = S.shock.box || { i0: 999, i1: -999, j0: 999, j1: -999 };
    S.rip = ripple(S.prime, S.mv, b); renderRippleStats();
  } else { S.rip = null; $('rippleStats').innerHTML = '<div class="empty">Run a shock to see how it ripples.</div>'; }
}
function renderRippleStats() {
  const r = S.rip, n = r.inside.length, fi = r.fracInside, tot = r.inside.map((a, i) => a + r.outside[i]);
  const mx = Math.max(...r.maxStd), d1 = fi[0], last = Math.min(7, n - 1);
  const grow = r.outside[0] > 0 ? r.outside[last] / r.outside[0] : NaN, any = tot.some((x) => x > 0);
  const card = (k, v, s, cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  if (!any) { $('rippleStats').innerHTML = card('Response', 'none', 'Δ is exactly zero on all 10 days', 'good') + card('Max |Δ|', '0 σ', 'identical timelines', 'good'); return; }
  $('rippleStats').innerHTML =
    card('Day-1 local share', isFinite(d1) ? (d1 * 100).toFixed(1) + '%' : '–', 'of Δ-energy inside box+3 cells (≥ 60% = localised)', d1 >= 0.6 ? 'good' : 'warnc') +
    card('Spread day 1 → 8', isFinite(grow) ? '×' + (grow >= 100 ? grow.toFixed(0) : grow.toFixed(1)) : '–', 'outside-box Δ-energy growth', grow > 1.5 ? 'good' : '') +
    card('Peak |Δ|', mx.toFixed(2) + ' σ', 'largest change against the usual spread; 5 σ or more is flagged', mx < 5 ? 'good' : 'warnc') +
    card('Day-10 share', isFinite(fi[n - 1]) ? (fi[n - 1] * 100).toFixed(1) + '%' : '–', 'still inside box+3 (the rest has rippled outward)');
}

// ---------- impact ----------
function stressColor(v) { return ['#6f8a4a', '#a39a3c', '#c99a1e', '#c0703e', '#8a3b22'][Math.min(4, Math.round(v * 4 / 3))]; }
function renderImpact() {
  if (!S.assets || !S.prime) return;
  const mv = S.mv || S.prime, K = kharif(S.prime, mv, S.assets, S.doy); S.K = K;
  const hasMv = !!S.mv;
  $('kHeadline').textContent = hasMv ? `${K.worse} state${K.worse === 1 ? '' : 's'} worsen and ${K.better} improve. All-India 10-day rain ${K.allIndiaRain.d >= 0 ? '+' : ''}${K.allIndiaRain.d.toFixed(1)} % against Prime.` : 'Timeline Prime. Run a shock to compare.';
  $('kSub').textContent = hasMv ? '' : 'Difference columns stay at zero until a shock runs.';
  const cols = [['name', 'State / group', ''], ['rP', 'Rain P', '10-day area-mean rain, Prime (mm)'], ['rM', 'Rain M', '10-day area-mean rain, Multiverse (mm)'], ['dRain', 'Δ rain %', '(M − P) / max(P, 5 mm)'], ['band', 'IMD band', 'IMD departure band applied to the Δ vs Prime: Normal ±19%, Deficient −20..−59%, Scanty ≤ −60%, Excess ≥ +20%'], ['dryP', 'Dry P', 'Longest dry spell in days (state-mean rain < 2.5 mm/day), Prime'], ['dryM', 'Dry M', 'Longest dry spell, Multiverse'], ['hP', 'Heat P', 'Heat-stress days: state-mean t2m above the state monthly P95 (training climate), Prime'], ['hM', 'Heat M', 'Heat-stress days, Multiverse'], ['sP', 'Stress P', 'Stress tier 0-3 = 0.5·rain tier + 0.5·heat tier, Prime'], ['sM', 'Stress M', 'Stress tier, Multiverse'], ['dStress', 'Δ stress', 'Multiverse − Prime']];
  const val = { name: (r) => r.name, rP: (r) => r.p.total, rM: (r) => r.m.total, dRain: (r) => r.dRain, band: (r) => r.dRain, dryP: (r) => r.p.dry, dryM: (r) => r.m.dry, hP: (r) => r.p.heat, hM: (r) => r.m.heat, sP: (r) => r.p.stress, sM: (r) => r.m.stress, dStress: (r) => r.dStress };
  const rows = [...K.rows].sort((a, b) => { const x = val[S.sortKey](a), y = val[S.sortKey](b); const c = typeof x === 'string' ? x.localeCompare(y) : x - y; return (S.sortAsc ? c : -c) || a.dRain - b.dRain; });
  const sgn = (x) => (Math.abs(x) < 0.05 ? '0.0' : (x > 0 ? '+' : '') + x.toFixed(1));
  const pill = (v) => `<span class="pill" style="background:${stressColor(v)}">${v.toFixed(1)}</span>`;
  const arrow = (d) => (d > 0 ? `<span class="up">▲ ${d.toFixed(1)}</span>` : d < 0 ? `<span class="down">▼ ${(-d).toFixed(1)}</span>` : '<span class="flat">–</span>');
  $('kTable').innerHTML = '<thead><tr>' + cols.map(([k, l, tt]) => `<th title="${tt}" data-k="${k}" class="${S.sortKey === k ? 'sorted' + (S.sortAsc ? ' asc' : '') : ''}">${l}</th>`).join('') + '</tr></thead><tbody>' +
    rows.map((r) => `<tr><td title="${r.id}">${r.name}</td><td>${r.p.total.toFixed(1)}</td><td>${r.m.total.toFixed(1)}</td><td>${sgn(r.dRain)}</td><td><span class="band ${r.band.key}">${r.band.label}</span></td><td>${r.p.dry}</td><td>${r.m.dry}</td><td>${r.p.heat}</td><td>${r.m.heat}</td><td>${pill(r.p.stress)}</td><td>${pill(r.m.stress)}</td><td>${arrow(r.dStress)}</td></tr>`).join('') + '</tbody>';
  $('kTable').querySelectorAll('th').forEach((th) => { th.tabIndex = 0; th.onclick = () => { const k = th.dataset.k; S.sortAsc = S.sortKey === k ? !S.sortAsc : k === 'name'; S.sortKey = k; renderImpact(); }; th.onkeydown = (e) => { if (e.key === 'Enter') th.onclick(); }; });
  drawStateMap(K);
  // wind
  const W = windIndex(S.prime, mv, S.assets);
  const best = [...W].sort((a, b) => Math.abs(b.dPct) - Math.abs(a.dPct))[0], sg = (x) => (Math.abs(x) < 0.05 ? '0.0' : (x > 0 ? '+' : '') + x.toFixed(1));
  $('wHeadline').textContent = hasMv ? `Largest change: ${best.name}, ${sg(best.dPct)} %, among the ${W.length} windiest states.` : 'Wind-power index for Timeline Prime.';
  $('wTable').innerHTML = '<thead><tr><th>State</th><th>CF Prime (10-day mean)</th><th>CF Multiverse</th><th>Δ CF %</th><th>10 days (Prime solid, Multiverse dashed)</th></tr></thead><tbody>' +
    W.map((w) => `<tr><td>${w.name}</td><td>${w.pMean.toFixed(3)}</td><td>${w.mMean.toFixed(3)}</td><td class="${w.dPct < -0.05 ? 'up' : w.dPct > 0.05 ? 'down' : 'flat'}">${sgn(w.dPct)}</td><td style="text-align:center"><canvas width="140" height="26" data-id="${w.id}"></canvas></td></tr>`).join('') + '</tbody>';
  $('wTable').querySelectorAll('canvas').forEach((cv) => { const w = W.find((x) => x.id === cv.dataset.id); spark(cv, w.p, '#8fb8c4'); if (hasMv) spark(cv, w.m, '#f2a35e', true, w.p); });
}
function spark(cv, y, color, keep, other) {
  const g = cv.getContext('2d'), all = [...y, ...(other || [])], lo = Math.min(...all), hi = Math.max(...all), sp = hi - lo || 1;
  if (!keep) g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = color; g.lineWidth = 1.6; g.setLineDash(keep ? [4, 2] : []); g.beginPath();
  y.forEach((v, i) => { const x = 3 + (i / (y.length - 1)) * (cv.width - 6), yy = cv.height - 3 - ((v - lo) / sp) * (cv.height - 6); i ? g.lineTo(x, yy) : g.moveTo(x, yy); }); g.stroke();
}
function drawStateMap(K) {
  const cv = $('cvStates'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const x0 = 67, x1 = 98, y0 = 7, y1 = 37.5, sc = Math.min(W / (x1 - x0), H / (y1 - y0)), ox = (W - sc * (x1 - x0)) / 2, oy = (H - sc * (y1 - y0)) / 2;
  const P = (lo, la) => [ox + (lo - x0) * sc, oy + (y1 - la) * sc], byId = Object.fromEntries(K.rows.map((r) => [r.id, r]));
  for (const st of S.outlines.states) {
    const r = byId[st.id]; if (!r) continue; g.beginPath();
    for (const ring of st.rings) for (let k = 0; k < ring.length; k += 2) { const [x, y] = P(ring[k], ring[k + 1]); k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.fillStyle = stressColor(r.m.stress); g.globalAlpha = 0.9; g.fill('evenodd'); g.globalAlpha = 1; g.strokeStyle = '#0a0e0b'; g.lineWidth = 0.8; g.stroke();
  }
  g.fillStyle = '#a2a997'; g.font = '11px system-ui'; g.fillText('Multiverse stress tier', 6, 13);
}

// ---------- scenario loading ----------
function setScenario(js, name) {
  const st = js.init_states;
  if (!Array.isArray(st) || st.length !== 3 || st[0].length !== NCH || st[0][0].length !== NLAT || st[0][0][0].length !== NLON) throw new Error('JSON must contain init_states of shape [3][6][32][36]');
  if (!Array.isArray(js.doy_sincos) || js.doy_sincos.length !== 2) throw new Error('JSON must contain doy_sincos [sin, cos]');
  S.init = flatten(st); S.doy = js.doy_sincos.map(Number); S.name = name; S.prime = S.mv = S.mvInit = S.rip = S.shock = null; S.msP = S.msM = null;
  $('nullBadge').hidden = true; $('clampNote').hidden = true; setMs(); afterNewData();
  return S.healthy ? runBase() : Promise.resolve();
}
async function loadSample(file) {
  try { const js = await (await fetch('samples/' + file)).json(); await setScenario(js, js.name + (js.date_label ? ', ' + js.date_label : '')); $('sampleInfo').textContent = ''; }
  catch (e) { toast('Could not load scenario: ' + e.message); }
}

// ---------- health ----------
async function checkHealth() {
  const h = await S.api.health(), chip = $('chipHealth');
  const was = S.healthy; S.healthy = h.ok;
  chip.className = 'chip ' + (h.ok ? 'ok' : 'bad'); $('healthTxt').textContent = h.ok ? `server ready${h.name ? ' · ' + h.name : ''}` : h.status === 'loading' ? 'server loading…' : 'server unreachable';
  if (h.ok && !was && S.init && !S.prime && !S.busy) runBase();
  if (!h.ok && was) toast(`Model server at ${S.api.url} is not responding.`);
}
function checkOffline() {
  let origin = ''; try { origin = new URL(S.api.url).origin; } catch (_) {}
  const ext = performance.getEntriesByType('resource').filter((r) => { try { const o = new URL(r.name).origin; return o !== location.origin && o !== origin && !r.name.startsWith('data:'); } catch (_) { return false; } });
  const c = $('chipOffline'); c.className = 'chip ' + (ext.length ? 'bad' : 'ok'); c.querySelector('span').textContent = `offline · ${ext.length} external request${ext.length === 1 ? '' : 's'}`;
}

// ---------- tabs / playback / events ----------
function selectTab(t) {
  S.tab = t; document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + t));
  requestAnimationFrame(() => { updateCharts(); if (S.K) drawStateMap(S.K); });
}
function setDay(d) { S.day = Math.max(1, Math.min(10, d)); render(); }
function play(on) {
  S.playing = on; $('btnPlay').textContent = on ? '❚❚ Pause' : '▶ Play'; clearInterval(S.timer);
  if (on) S.timer = setInterval(() => setDay(S.day >= 10 ? 1 : S.day + 1), 650);
}
function setVar(i) {
  S.v = i; document.querySelectorAll('#segVar button').forEach((b, k) => b.classList.toggle('on', k === i));
  if ($('selVar').options.length) $('selVar').value = ['0', '1', '2', '4', '5'][i]; buildCache(); render();
}

async function init() {
  S.outlines = await outlinesPromise; setupPanels(S.outlines);
  const [grid, heat, rainClim, idx] = await Promise.all(['assets/grid_states.json', 'assets/heat_p95.json', 'assets/rain_clim.json', 'samples/index.json'].map((u) => fetch(u).then((r) => r.json())));
  S.assets = { grid, heat, rainClim }; S.samples = idx;
  // controls
  $('selSample').innerHTML = idx.map((s, k) => `<option value="${s.file}">${s.date_label}, ${s.name}</option>`).join('');
  $('segVar').innerHTML = VARS.map((v, k) => `<button title="${v.label} (${k + 1})">${v.short}</button>`).join('');
  document.querySelectorAll('#segVar button').forEach((b, k) => (b.onclick = () => setVar(k)));
  $('selPreset').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('') + '<option value="custom">Custom (drag a box)</option>';
  $('selVar').innerHTML = CH.map((c, k) => `<option value="${k}" title="${DISPLAY_UNITS[k]}">${c.key}</option>`).join('');
  $('selPreset').onchange = (e) => applyPreset(e.target.value);
  $('btnAdd').onclick = () => { const mag = parseFloat($('inMag').value); if (!Number.isFinite(mag)) return toast('Enter a numeric magnitude.', 'info'); S.comps.push({ ch: +$('selVar').value, mode: $('selMode').value, value: mag }); $('selPreset').value = 'custom'; renderComps(); };
  $('btnClearBox').onclick = () => { S.box = null; updateBoxUI(); render(); };
  $('btnRun').onclick = runShock; $('btnNull').onclick = nullCheck;
  $('btnPlay').onclick = () => play(!S.playing); $('rngDay').oninput = (e) => setDay(+e.target.value);
  $('selSample').onchange = (e) => loadSample(e.target.value);
  $('btnLoad').onclick = () => $('fileJson').click();
  $('fileJson').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const js = JSON.parse(await f.text()); await setScenario(js, js.name || f.name); } catch (err) { toast('Could not load JSON: ' + err.message); } e.target.value = ''; };
  $('chkArrows').onchange = (e) => { S.arrows = e.target.checked; render(); };
  $('chkDeltaDay').onchange = (e) => { S.deltaPerDay = e.target.checked; render(); };
  $('chkLog').onchange = updateCharts;
  $('serverUrl').value = S.api.url;
  $('serverUrl').onchange = (e) => { S.api.base = e.target.value.trim(); localStorage.setItem('mm_server', S.api.url); S.prime = S.mv = null; checkHealth().then(() => S.init && S.healthy && runBase()); };
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => selectTab(b.dataset.tab)));
  $('btnStory').addEventListener('click', () => play(false));
  $('btnHow').onclick = openTech;
  window.addEventListener('keydown', (e) => {
    if (document.body.dataset.view !== 'expert' || !document.getElementById('tech').hidden) return;
    if (/INPUT|SELECT|TEXTAREA|BUTTON|TH/.test(document.activeElement.tagName) && e.key !== 'Escape') return;
    if (e.key === ' ') { e.preventDefault(); play(!S.playing); }
    else if (e.key === 'ArrowRight') setDay(S.day + 1); else if (e.key === 'ArrowLeft') setDay(S.day - 1);
    else if (e.key >= '1' && e.key <= '5') setVar(+e.key - 1);
    else if (e.key === 'r' || e.key === 'R') runShock(); else if (e.key === 'n' || e.key === 'N') nullCheck();
    else if (e.key === '?') openTech();
  });
  setVar(0); applyPreset('bob'); renderComps();
  window.addEventListener('resize', () => render());
  setInterval(checkHealth, 4000); setInterval(checkOffline, 3000);
  checkOffline(); await checkHealth();
  await loadSample(idx[0].file); checkOffline();
}
export const ready = init().catch((e) => { console.error(e); toast('Dashboard failed to start: ' + e.message); });

function openTech() { play(false); import('./tech.js').then((m) => m.openTech()); }

/** Story mode hands its live state to the expert view (same rollouts, no recomputation). */
export function adopt(o) {
  Object.assign(S, { init: o.init, doy: o.doy, name: o.name, prime: o.prime, mv: o.mv || null, msP: o.msP, msM: o.msM || null, mvInit: o.mvInit || null, shock: o.shock || null, rip: null });
  S.box = o.box || S.box; S.comps = o.comps && o.comps.length ? o.comps.map((c) => ({ ...c })) : S.comps;
  if (o.file) $('selSample').value = o.file;
  $('selPreset').value = o.mv ? 'custom' : $('selPreset').value;
  updateBoxUI(); renderComps(); afterNewData(); setMs();
  if (o.tab) selectTab(o.tab);
}
