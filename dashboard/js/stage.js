// The map stage: what is drawn, how it eases between days, which weather moves, the "watch it spread" animation.
// `map` is the 3D map (map3d.js) or, without WebGL2, the flat one (render.js); both take the same calls.
import { NLON, NCELL, NCH, rIdx, lat, lon, stepsOf } from './util.js';
import { lut } from './colormaps.js';
import { REACH, dilate, coversGrid, maxOutside } from './insights.js';
import { sgn, questionText } from './scenarios.js';
import { PALETTES, BAND_ALPHA, impactFrames, impactImage, impacted, blend, scores, contour, reached } from './impact-view.js';
import { LIMITS } from './insights.js';

const $ = (id) => document.getElementById(id);
export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const smooth = () => (still() ? 'auto' : 'smooth');

export const VARS = [
  { key: 't2m', name: 'Temperature', unit: '°C', cmap: 'heat', dcmap: 'rdbuL', floor: 0.2, f: (r, d, k) => r[rIdx(d, 0) + k] - 273.15,
    tip: 'Air temperature at 2 m, daily mean', ends: ['cooler', 'hotter'], dends: ['cooler', 'warmer'] },
  { key: 'tp', name: 'Rainfall', unit: 'mm/day', cmap: 'rain', dcmap: 'brblue', floor: 0.5, zero: true, f: (r, d, k) => r[rIdx(d, 1) + k],
    tip: 'Rain per day', ends: ['dry', 'heavy rain'], dends: ['drier', 'wetter'] },
  { key: 'wind', name: 'Wind', unit: 'km/h', cmap: 'windL', dcmap: 'rdbuL', floor: 1.5, zero: true, f: (r, d, k) => Math.hypot(r[rIdx(d, 2) + k], r[rIdx(d, 3) + k]) * 3.6,
    tip: 'Wind speed at 10 m', ends: ['calm', 'strong'], dends: ['weaker', 'stronger'] },
  { key: 'tcwv', name: 'Humidity', unit: 'kg/m²', cmap: 'water', dcmap: 'brblue', floor: 0.5, zero: true, f: (r, d, k) => r[rIdx(d, 5) + k],
    tip: 'Water vapour in the air column', ends: ['dry air', 'moist air'], dends: ['drier', 'moister'] },
  { key: 'msl', name: 'Pressure', unit: 'hPa', cmap: 'cividis', dcmap: 'rdbuL', floor: 0.5, f: (r, d, k) => r[rIdx(d, 4) + k] / 100,
    tip: 'Air pressure at sea level', ends: ['low', 'high'], dends: ['lower', 'higher'] },
];
const LABELS = [
  { lon: 77.2, lat: 28.6, text: 'Delhi', dot: 1 }, { lon: 72.9, lat: 19.1, text: 'Mumbai', dot: 1 }, { lon: 88.4, lat: 22.6, text: 'Kolkata', dot: 1 },
  { lon: 80.3, lat: 13.1, text: 'Chennai', dot: 1 }, { lon: 76.3, lat: 10.0, text: 'Kerala', dot: 1 },
  { lon: 68.5, lat: 14.5, text: 'Arabian Sea', sea: 1 }, { lon: 88.5, lat: 13.5, text: 'Bay of Bengal', sea: 1 },
];
const OUTLINE = { states: 'rgba(16,32,43,.28)', countries: 'rgba(16,32,43,.85)' };
export const nf = (x) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1));
const ease = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => { const o = new Float32Array(a.length); for (let k = 0; k < a.length; k++) o[k] = a[k] + (b[k] - a[k]) * t; return o; };

export function createStage(app, map) {
  const S = app.S, pinBox = $('sPins'), flat = !map.glCanvas;
  let cache = {}, shown = null, tween = 0, spreading = 0, frames = null, fronts = null, impactLoop = 0, shownT = null;

  function fields(vi) {
    if (!S.prime) return null;
    if (cache[vi]) return cache[vi];
    const v = VARS[vi], F = { P: [], M: [], D: [] };
    for (let d = 0; d < stepsOf(S.prime); d++) {
      const p = Float32Array.from({ length: NCELL }, (_, k) => v.f(S.prime, d, k)); F.P.push(p);
      if (S.mv) { const m = Float32Array.from({ length: NCELL }, (_, k) => v.f(S.mv, d, k)); F.M.push(m); F.D.push(m.map((x, k) => x - p[k])); }
    }
    const all = Float32Array.from([...F.P, ...F.M].flatMap((a) => Array.from(a))).sort(), q = (p) => all[Math.min(all.length - 1, Math.floor(p * (all.length - 1)))];
    F.lo = v.zero ? 0 : q(0.003); F.hi = v.key === 'tp' ? Math.max(q(0.995), 2) : q(0.997);
    if (F.hi - F.lo < 1e-6) F.hi = F.lo + 1;
    if (F.D.length) { const ab = Float32Array.from(F.D.flatMap((a) => Array.from(a, Math.abs))).sort(); F.dscale = ab[Math.floor(0.995 * (ab.length - 1))]; }
    return (cache[vi] = F);
  }

  /** Draw a field, easing from the one on screen when only the day changed. */
  function paint(opts, key) {
    cancelAnimationFrame(tween);
    const from = shown && shown.key === key ? shown.field : null, to = opts.field;
    if (!from || !to || from === to || still()) { shown = { key, field: to }; return map.set(opts); }
    const t0 = performance.now();
    const frame = (now) => { const t = Math.max(0, Math.min(1, (now - t0) / 320)), field = t < 1 ? mix(from, to, ease(t)) : to; shown = { key, field }; map.set({ ...opts, field }); if (t < 1) tween = requestAnimationFrame(frame); };
    tween = requestAnimationFrame(frame);
  }

  const setPins = (list) => map.setPins(pinBox, list);
  /** Moving wind, rain and cloud from the forecast on screen, matched to what the viewer is looking at. */
  function weather(mode) {
    const roll = mode === 'normal' ? S.prime : S.mv;
    if (!roll || !S.motion || (!S.land && (mode === 'diff' || mode === 'split'))) return map.setWeather(null, {});
    const day = (c) => roll.subarray(rIdx(S.day - 1, c), rIdx(S.day - 1, c) + NCELL), key = VARS[S.v].key;
    const show = isImpact() ? { wind: 0.4 } : S.land ? { wind: 0.85, rain: true, clouds: true } : { wind: key === 'wind' ? 1 : 0.35, rain: key === 'tp', clouds: key === 'tcwv' };
    map.setWeather({ tp: day(1), u: day(2), v: day(3), tcwv: day(5) }, show);
  }

  function controls(mode) {
    $('sDay').value = S.day; $('dayNow').textContent = S.day;
    $('segMode').hidden = !S.mv; document.querySelectorAll('#segMode button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    document.querySelectorAll('#chipVar .s-chip').forEach((b) => { const on = b.dataset.i === S.layer; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    $('smoothWrap').hidden = !(S.mv && mode === 'diff' && S.layer !== 'land' && +S.layer <= 2 && !flat);
    $('sSpread').hidden = !S.mv || !S.box; $('sSpread').textContent = spreading ? 'Stop' : 'Trace spread';
    app.fork?.render();
  }
  function legend(cmap, ends, title = '') {
    const L = lut(cmap), st = [];
    for (let i = 0; i <= 12; i++) { const k = Math.round((i / 12) * 255) * 3; st.push(`rgb(${L[k]},${L[k + 1]},${L[k + 2]}) ${(i / 12) * 100}%`); }
    $('sLegend').innerHTML = `${title ? `<b>${title}</b>` : ''}<div class="bar" style="background:linear-gradient(90deg,${st.join(',')})"></div><div class="ends">${ends.map((e) => `<span>${String(e).replace(/^-/, '−')}</span>`).join('')}</div>`;
  }
  /** The large line is the question the map is answering; the small one says what is on screen. */
  function caption(title, sub) {
    const inf = S.tab === 'influence';
    const start = S.samples.find((x) => x.file === S.file)?.date_label;
    const question = !S.sc ? (start ? `India, ten days from ${start}` : 'India, ten days from your start') : S.sc.pert ? 'What if your pasted change happened?' : questionText(S.sc.values, S.sc.strength, S.sc.area);
    const head = inf ? title : question, line = [inf ? '' : title, sub].filter(Boolean).join('. ');
    const whole = head && head.replace(/(\d) (°C|%|hPa)/g, '$1\u00a0$2'); // a number keeps its unit on the same line
    if ($('capTitle').textContent !== whole) $('capTitle').textContent = whole;
    $('capSub').textContent = line;
  }
  const common = () => ({ labels: LABELS, outline: OUTLINE, box: S.box, boxText: S.box ? (S.mv ? 'Changed area' : 'Selected area') : null, empty: null, rings: null, tiles: null, dragBox: S.mv && app.canDraw() ? S.preview || null : null, layer: null, contours: null, marks: null, field2: null, split: null, pulse: false });
  const diffEnds = (v, A) => [`${sgn(-A, A < 10 ? 1 : 0)} ${v.unit} (${v.dends[0]})`, 'no change', `${sgn(A, A < 10 ? 1 : 0)} ${v.unit} (${v.dends[1]})`];

  // ---------- impact view: the change glowing over the land, from where you made it outward ----------
  const isImpact = () => !!(S.land && S.glow && S.mv && S.mode !== 'normal' && S.mode !== 'split' && S.tab !== 'influence');
  const frameAt = (t) => { frames ||= impactFrames(S.init, S.mvInit, S.prime, S.mv); const x = Math.max(0, Math.min(frames.length - 1, t)), i = Math.min(frames.length - 2, Math.floor(x)); return blend(frames[i], frames[i + 1], ease(x - i)); };
  function paintImpact(t, rings = null) {
    shownT = t; const f = frameAt(t), s = scores(f, [S.ik]);
    if (!fronts || fronts.kind !== S.ik) fronts = { kind: S.ik, env: reached(frames, S.ik) };
    const upTo = fronts.env[Math.max(0, Math.min(frames.length - 1, Math.floor(t)))], front = contour(upTo.map((x, k) => Math.max(x, s[k])), 1); // everywhere that has reached Low by now
    const contours = [{ segs: contour(s, 3), width: 1.8, alpha: 0.7 }, { segs: front, width: 5, alpha: 0.55 }, { segs: front, width: 2, alpha: 0.95, color: '242,240,232' }], marks = [];
    if (!rings && S.box) for (const day of [2, 4]) {
      if (t < day + 1) continue; // once the front has moved on, show how far it had got
      const segs = contour(fronts.env[day], 1), mid = [(S.box.j0 + S.box.j1) / 2, (S.box.i0 + S.box.i1) / 2];
      if (!segs.length) continue;
      contours.unshift({ segs, width: 1.2, alpha: 0.5, color: '242,240,232' });
      const far = segs.reduce((a, g) => (Math.hypot(g[0] - mid[0], g[1] - mid[1]) > Math.hypot(a[0] - mid[0], a[1] - mid[1]) ? g : a)); // label the point furthest from the change
      if (!marks.some((m) => Math.hypot(m.lon - (65.5 + far[0]), m.lat - (6.5 + far[1])) < 3)) marks.push({ lon: 65.5 + far[0], lat: 6.5 + far[1], text: `day ${day}` });
    }
    map.set({ ...common(), field: null, layer: impactImage(f, S.ik), pulse: true, rings, contours, marks });
  }
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  /** The forecast day on which the shown quantity reaches a watch level over the most cells. */
  const peakDay = () => { frameAt(0); let best = 1, most = -1; for (let d = 1; d < frames.length; d++) { const n = scores(frames[d], [S.ik]).filter((x) => x >= 1).length; if (n > most) { most = n; best = d; } } return best; };
  const hitToday = () => impacted(app.places.rows(), S.day, (id) => app.geo.states.filter((s) => 's:' + s.group === id).map((s) => s.name));
  /** Who is affected on the day shown: map effects, pins, caption and key. */
  function describeImpact() {
    const hit = hitToday();
    map.setEffects(hit);
    setPins(S.tab === 'ask' ? app.places.pins() : []);
    const away = app.places.rows().cities.filter((r) => !r.inside && r.t.days[S.day - 1]?.level).length;
    caption(`Day ${S.day}`, away ? `${plural(away, 'city', 'cities')} beyond the change ${away === 1 ? 'feels' : 'feel'} it` : hit.cities.length || hit.stateCount ? 'Felt only inside the changed area' : 'No city or state reaches a watch level');
    impactKey();
  }
  /** Which quantity the impact map shows, a colour bar in its units, and what the two contour lines mean. */
  let keyShown = '';
  function impactKey() {
    if (keyShown === S.ik && $('sLegend').querySelector('.s-ikey')) return;
    const P = PALETTES[S.ik], lim = LIMITS[S.ik], n = (x) => (x % 1 ? x.toFixed(1) : x), word = ['Low', 'Medium', 'High'];
    const cell = (ink, i, sign) => `<li style="--sw:rgb(${ink});--a:${BAND_ALPHA[i + 1] + 0.2}" title="${word[i]}: ${sign}${n(lim[i])} ${P.unit} or more"><i></i>${sign}${n(lim[i])}</li>`;
    $('sLegend').innerHTML = `<div class="s-ikey" title="${P.noun}, Multiverse minus Prime. The steps are the Low, Medium and High watch levels; the pale line surrounds everywhere that has reached Low by this day."><b>${P.noun} change, ${P.unit}</b>
      <div class="s-steps3"><span>${P.words[0]}</span><ol>${[2, 1, 0].map((i) => cell(P.less[i], i, '−')).join('')}<li class="zero">0</li>${[0, 1, 2].map((i) => cell(P.more[i], i, '+')).join('')}</ol><span>${P.words[1]}</span></div><span class="s-front">Reached so far</span></div>`;
    keyShown = S.ik;
  }
  function showImpact() {
    cancelAnimationFrame(tween); shown = null;
    const from = shownT ?? S.day, to = S.day, t0 = performance.now();
    describeImpact();
    if (still() || from === to) return paintImpact(to);
    const step = (now) => { const k = Math.max(0, Math.min(1, (now - t0) / 420)); paintImpact(from + (to - from) * ease(k)); if (k < 1) tween = requestAnimationFrame(step); };
    tween = requestAnimationFrame(step);
  }
  /** Play the impact from day 0 (your change) to day 10 once, then rest on the day it is felt most widely. */
  function impactRun(on) {
    cancelAnimationFrame(impactLoop); impactLoop = 0;
    if (!on) return;
    cancelAnimationFrame(tween);
    const PER_DAY = 1100, n = 10; let t = S.day > 1 && shownT && shownT < n - 0.05 ? shownT : 0, last = performance.now(), day = 0;
    const step = (now) => {
      const dt = Math.max(0, Math.min(100, now - last)); last = now;
      if (t >= n) { impactLoop = 0; app.play(false); return app.setDay(peakDay()); }
      t = Math.min(n, t + dt / PER_DAY);
      const d = Math.max(1, Math.ceil(t - 0.001));
      paintImpact(t);
      if (d !== day) { day = S.day = d; controls(S.mode); weather(S.mode); describeImpact(); app.places.setDay(); app.explore.render(); }
      if (t === 0) caption('Day 0', 'Your change, before the forecast moves it');
      impactLoop = requestAnimationFrame(step);
    };
    impactLoop = requestAnimationFrame(step);
  }

  function render() {
    if (impactLoop) app.play(false);
    if (spreading) stopSpread(false);
    map.setEffects(null);
    const inf = S.tab === 'influence', mode0 = S.mv ? S.mode : 'normal';
    $('sToolbar').classList.toggle('off', inf); $('sTransport').classList.toggle('off', inf); $('sSplit').hidden = inf || mode0 !== 'split';
    if (inf) { cancelAnimationFrame(tween); shown = null; map.setWeather(null, {}); return app.influence.draw(); }
    const v = VARS[S.v], F = fields(S.v), d = S.day - 1, mode = S.mv ? S.mode : 'normal';
    controls(mode);
    if (!F) { shown = null; setPins([]); map.setWeather(null, {}); map.set({ ...common(), field: null, empty: S.healthy ? 'Running forecast' : 'Waiting for the model' }); caption(S.land ? 'India' : v.name, ''); $('sLegend').innerHTML = ''; return; }
    weather(mode);
    if (isImpact()) { controls(mode); return showImpact(); }
    shownT = null;
    if (S.land && mode !== 'split') {
      cancelAnimationFrame(tween); shown = null; map.set({ ...common(), field: null });
      setPins(S.tab === 'ask' && S.mv && mode !== 'normal' ? app.places.pins() : []);
      caption(`Day ${S.day}`, mode !== 'normal' ? 'Multiverse, with your change' : S.mv ? 'Timeline Prime' : 'Timeline Prime. Choose a change to branch a Multiverse.');
      $('sLegend').innerHTML = '';
      return;
    }
    let field = F.P[d], lo = F.lo, hi = F.hi, cmap = v.cmap, ends = [`${nf(lo)} ${v.unit} (${v.ends[0]})`, `${nf(hi)} ${v.unit} (${v.ends[1]})`];
    let sub = 'Timeline Prime';
    if (mode === 'whatif') { field = F.M[d]; sub = 'Multiverse, with your change'; }
    else if (mode === 'diff') {
      const A = Math.max(F.dscale, v.floor); field = F.D[d]; lo = -A; hi = A; cmap = v.dcmap; ends = diffEnds(v, A);
      sub = F.dscale < v.floor ? `Almost no change in ${v.name.toLowerCase()}` : 'Multiverse minus Prime';
    }
    if (mode === 'split') { // Prime and Multiverse on one map, on either side of a divider the viewer drags
      cancelAnimationFrame(tween); shown = null; sub = 'Prime on the left, Multiverse on the right';
      // the same outline on both sides marks where the two differ by at least the Low level
      const kind = ['temp', 'rain', 'wind'][S.v], edge = kind ? contour(scores(frameAt(S.day), [kind]), 1) : [];
      map.set({ ...common(), field: F.P[d], field2: F.M[d], split: S.split, lo, hi, cmap, contours: [{ segs: edge, width: 5, alpha: 0.55 }, { segs: edge, width: 2, alpha: 0.95, color: '255,255,255' }] });
    } else paint({ ...common(), field, lo, hi, cmap, pulse: mode === 'diff' }, `${S.v}|${mode}`); // pulse: grey the imagery under a difference
    setPins(S.tab === 'ask' && S.mv && (mode === 'diff' || mode === 'whatif') ? app.places.pins() : []);
    caption(`${v.name}, day ${S.day}`, sub); legend(cmap, ends, `${mode === 'diff' ? `${v.name} change` : v.name}, ${v.unit}`);
  }

  // ---------- the compare divider ----------
  (() => {
    const bar = $('sSplit'), wrap = $('sMapWrap'); let drag = false;
    const place = (x) => { const r = wrap.getBoundingClientRect(); S.split = Math.max(0.04, Math.min(0.96, (x - r.left) / r.width)); bar.style.left = `${S.split * 100}%`; bar.setAttribute('aria-valuenow', Math.round(S.split * 100)); map.set({ split: S.split }); };
    bar.addEventListener('pointerdown', (e) => { drag = true; bar.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
    bar.addEventListener('pointermove', (e) => { if (drag) place(e.clientX); });
    bar.addEventListener('pointerup', () => (drag = false));
    bar.addEventListener('keydown', (e) => { const k = { ArrowLeft: S.split - 0.03, ArrowRight: S.split + 0.03, Home: 0, End: 1 }[e.key]; if (k === undefined) return; e.preventDefault(); e.stopPropagation(); const r = wrap.getBoundingClientRect(); place(r.left + k * r.width); });
    new MutationObserver(() => { if (!bar.hidden) { bar.style.left = `${S.split * 100}%`; bar.setAttribute('aria-valuenow', Math.round(S.split * 100)); } }).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  })();

  // ---------- watch it spread: from the change itself (day 0) outward, inside the furthest-reach line ----------
  function stopSpread(redraw = true) { cancelAnimationFrame(spreading); spreading = 0; shown = null; map.setOrbit(0); if (redraw) render(); else controls(S.mv ? S.mode : 'normal'); }
  function spread() {
    if (spreading) return stopSpread();
    if (!S.mv || !S.box) return;
    app.play(false); cancelAnimationFrame(tween); setPins([]); $('sSplit').hidden = true; if (+S.layer > 2 || S.layer === 'land') S.layer = S.focus; S.mode = 'diff'; S.smooth = false; app.view(); S.land = S.glow = true; map.setEffects(null); app.explore.close(false);
    map.setWeather(null, {}); map.frameBox(S.box); map.setOrbit(0.045);
    const box = { ...S.box }, n = stepsOf(S.prime);
    const clean = Array.from({ length: n }, (_, d) => maxOutside(S.prime, S.mv, box, d + 1)).every((m) => !m);
    // slow while the reach line is still on the map (about 3 days), quicker afterwards
    const HOLD = 600, SLOW = 2200, FAST = 800, t0 = performance.now();
    S.mode = 'diff';
    let lit = 0;
    const frame = (now) => {
      const ms = Math.max(0, now - t0 - HOLD);
      let t = Math.min(n, ms < 3 * SLOW ? ms / SLOW : 3 + (ms - 3 * SLOW) / FAST); if (still()) t = Math.floor(t);
      const lim = dilate(box, REACH * t), covered = coversGrid(lim);
      S.day = Math.max(1, Math.ceil(t));
      if (t > 0 && S.day !== lit) { lit = S.day; map.setEffects(hitToday()); } // places light up as the change arrives
      const rings = [];
      for (let k = 1; k <= Math.floor(t); k++) { const r = dilate(box, REACH * k); if (!coversGrid(r)) rings.push({ box: r, alpha: 0.28 }); }
      if (!covered && t > 0) rings.push({ box: lim, text: `Reach limit, day ${t.toFixed(1)}` });
      paintImpact(t, rings);
      controls('diff');
      caption(t === 0 ? 'Day 0' : `Spread, day ${t.toFixed(1)}`,
        !clean ? 'Warning: change beyond the reach limit' : covered ? 'The reach limit now covers the map' : 'No change outside the dashed line');
      app.places.setDay(); impactKey();
      if (t < n) spreading = requestAnimationFrame(frame); else { spreading = 0; shown = null; map.setOrbit(0); setTimeout(() => { if (!spreading) render(); }, 1200); }
    };
    spreading = requestAnimationFrame(frame); controls('diff');
  }

  // ---------- pointer: drawing your own area (and the cell read-out on the flat map) ----------
  function bind() {
    const cv = $('sMap'), tip = $('sTip'); let down = null;
    cv.addEventListener('pointermove', (e) => {
      const cell = map.cellAt(e);
      if (down && cell && (down.moved || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4)) { down.moved = true; map.set({ dragBox: { i0: Math.min(down.cell.i, cell.i), i1: Math.max(down.cell.i, cell.i), j0: Math.min(down.cell.j, cell.j), j1: Math.max(down.cell.j, cell.j) } }); }
      if (!flat) return; // the 3D map reports places instead (ui-explore.js)
      if (!cell || S.tab === 'influence') { tip.hidden = true; return; }
      const v = VARS[S.v], F = fields(S.v), d = S.day - 1, k = cell.i * NLON + cell.j;
      let h = `<b>${lat(cell.i).toFixed(1)}°N, ${lon(cell.j).toFixed(1)}°E</b>`;
      if (F) { h += `<br>Prime: <b>${nf(F.P[d][k])}</b> ${v.unit}`; if (S.mv) h += `<br>Multiverse: <b>${nf(F.M[d][k])}</b> ${v.unit}<br>Difference: <b>${sgn(F.D[d][k], 2)}</b> ${v.unit}`; }
      tip.innerHTML = h; tip.hidden = false; tip.style.left = Math.min(e.clientX + 14, innerWidth - 200) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - 110) + 'px';
    });
    cv.addEventListener('mouseleave', () => { if (flat) tip.hidden = true; });
    cv.addEventListener('pointerdown', (e) => { if (!app.canDraw()) return; const cell = map.cellAt(e); if (cell) { down = { cell, x: e.clientX, y: e.clientY, moved: false }; e.preventDefault(); } });
    window.addEventListener('pointerup', (e) => {
      if (!down) return; const dn = down; down = null; map.set({ dragBox: null });
      const c2 = map.cellAt(e) || dn.cell;
      if (dn.moved) app.drew({ i0: Math.min(dn.cell.i, c2.i), i1: Math.max(dn.cell.i, c2.i), j0: Math.min(dn.cell.j, c2.j), j1: Math.max(dn.cell.j, c2.j) });
    });
  }
  bind();

  return {
    map, render, spread, setPins, caption, legend, common, isImpact, impactRun,
    refreshPins() { if (S.mv && S.tab === 'ask' && S.mode !== 'normal') setPins(app.places.pins()); },
    reset() { impactRun(false); cancelAnimationFrame(tween); cache = {}; frames = null; fronts = null; shown = null; shownT = null; map.setEffects(null); if (spreading) stopSpread(false); },
    isSpreading: () => !!spreading, impactPeak: peakDay,
    setSplit(f) { S.split = f; $('sSplit').style.left = `${f * 100}%`; $('sSplit').setAttribute('aria-valuenow', Math.round(f * 100)); map.set({ split: f }); },
    peakDay(vi) { const m = fields(vi).D.map((f) => f.reduce((a, x) => Math.max(a, Math.abs(x)), 0)); return m.indexOf(Math.max(...m)) + 1; },
  };
}
