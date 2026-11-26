import { useRef, useEffect, useMemo, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { MapView, makeBitmap, isobars } from '../lib/mapdraw.js';
import { VARS, bundleFields, varIndex, totalUnit, totalWord } from '../lib/fields.js';
import { boxFromLatLon } from '@lib/shock.js';
import { REGIONS, DATE_WORDS, whereIs } from '../lib/narrative.js';
import { NORMAL, lutNormal, lutDiff, gradientCss, tOf } from '../lib/scales.js';
import { sgn } from '../lib/narrative.js';
import { rIdx, NCELL, NLON, stepsOf } from '@lib/util.js';
import * as S from '../store.js';
import { Icon } from './icons.jsx';

let dragged = false;
let shown = null; // what the map draws now; read by the e2e test through window.__mapProbe
/** Test hook: the drawn field ('D' change, 'M' what-if, 'P' normal) and its bitmap colour at each grid cell k. */
window.__mapProbe = () => {
  if (!shown) return null; const { w, md, d, v, bm } = shown, f = md === 'diff' ? w.D : md === 'whatif' ? w.M : w.P, px = bm.getContext('2d').getImageData(0, 0, bm.width, bm.height).data, S8 = bm.width / NLON;
  const rgb = (k) => { const i = (k / NLON) | 0, j = k % NLON, y = Math.round(bm.height - 0.5 - (i + 0.5) * S8), x = Math.round((j + 0.5) * S8 - 0.5), o = (y * bm.width + x) * 4; return [px[o], px[o + 1], px[o + 2], px[o + 3]]; };
  return { view: d === 'T' ? 'total' : 'day', day: d === 'T' ? null : d + 1, mode: md, varKey: v.key, values: Array.from(f), rgb: Array.from({ length: f.length }, (_, k) => rgb(k)) };
};
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The fields on the map for day index d (0..9), or for the 10-day view when d === 'T' (rain summed, others averaged). */
export function viewOf(F, v, d) {
  if (d === 'T') return { P: F.T.P, M: F.T.M, D: F.T.D, A: F.T.A, quiet: F.T.quiet, floor: F.T.floor, scale: v.tscale || v.key };
  return { P: F.P[d], M: F.M[d] || null, D: F.D[d] || null, A: F.A, quiet: F.quiet, floor: v.floor, scale: v.key };
}
export function bitmapFor(bundle, vi, md, d) {
  const key = `${md}|${vi}|${d}`; bundle.bm ||= {};
  if (bundle.bm[key]) return bundle.bm[key];
  const v = VARS[vi], w = viewOf(bundleFields(bundle, vi), v, d);
  const bm = md === 'diff' ? makeBitmap(w.D, { kind: 'diff', cmap: v.dcmap, A: w.A, floor: w.floor, sqrt: !!v.sqrt }) : makeBitmap(md === 'whatif' ? w.M : w.P, { kind: 'normal', scale: w.scale });
  return (bundle.bm[key] = bm);
}
/** Wind components on the map: one day, or the 10-day mean. */
function windUV(x, d) {
  const ds = d === 'T' ? Array.from({ length: stepsOf(x) }, (_, i) => i) : [d];
  const u = new Float32Array(NCELL), w = new Float32Array(NCELL);
  for (const e of ds) for (let k = 0; k < NCELL; k++) { u[k] += x[rIdx(e, 2) + k] / ds.length; w[k] += x[rIdx(e, 3) + k] / ds.length; }
  return { u, v: w };
}
/** The day control's current position: day index 0..9, or 'T' for the 10-day view. */
export const dayKey = () => (S.total.value ? 'T' : S.day.value - 1);
const fmtN = (x, dec = 1) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(dec));

export function MapCanvas() {
  const cvRef = useRef(), viewRef = useRef(), anim = useRef({ raf: 0, last: null, lastKey: '' });
  const down = useRef(null);
  const out = S.outlines.value;
  useEffect(() => {
    if (!out) return;
    const view = (viewRef.current = new MapView(cvRef.current, out));
    view.availW = () => { const pb = cvRef.current.closest('.plate-body'); return pb ? pb.clientWidth - 252 - 20 : 0; };
    const ro = new ResizeObserver(() => view.draw()); ro.observe(cvRef.current.parentElement); ro.observe(cvRef.current.closest('.plate-body'));
    document.fonts && document.fonts.ready.then(() => view.draw());
    window.__map = view; S.mapReady.value++;
    return () => ro.disconnect();
  }, [out]);

  useSignalEffect(() => {
    S.mapReady.value; const view = viewRef.current; if (!view) return;
    const b = S.bundle.value, r = S.result.value, md = b && b.mv ? S.mode.value : 'normal', vi = S.varIdx.value, d = dayKey(), v = VARS[vi];
    const hv = S.hoverTip.value, pl = S.place.value, cu = S.customOpen.value, cw = S.custom.value.where, db = S.drawBox.value;
    let box = r ? r.box : null;
    if (cu) { const rg = REGIONS.find((x) => x.id === cw); box = rg && rg.box ? boxFromLatLon(...rg.box) : db; }
    const props = { empty: null, bitmap: null, diff: md === 'diff', isolines: null, arrows: null, highlight: [], hlLabels: [], box, hover: hv ? hv.cell : null, place: pl, prev: null, mix: 1 };
    if (!b) { props.empty = S.health.value === 'down' ? 'The forecast engine isn’t running.' : 'Running the forecast…'; view.set(props); return; }
    const w = viewOf(bundleFields(b, vi), v, d), bm = bitmapFor(b, vi, md, d); props.bitmap = bm;
    if (v.key === 'msl' && md !== 'diff') { b.iso ||= {}; const f = md === 'whatif' ? w.M : w.P; props.isolines = b.iso[md + d] ||= isobars(f, 4); }
    if (v.key === 'wind') {
      const roll = (x) => windUV(x, d);
      if (md === 'diff') { const a = roll(b.prime), c = roll(b.mv); props.arrows = { u: c.u.map((x, k) => x - a.u[k]), v: c.v.map((x, k) => x - a.v[k]) }; } else props.arrows = roll(md === 'whatif' ? b.mv : b.prime);
    }
    shown = { w, md, d, v, bm };
    const ps = S.pickState.value; if (r && !cu) { props.highlight = ps ? [...new Set([...r.hl.ids, ps])] : r.hl.ids; props.hlLabels = props.highlight.slice(0, 2).map((id) => ({ id, text: S.assets.value.grid.meta[id].name })); }
    const key = `${b.id}|${vi}|${md}`, A = anim.current;
    if (A.last && A.lastKey === key && A.last !== bm && !reduced()) { // day change: crossfade
      cancelAnimationFrame(A.raf); const prev = A.last, t0 = performance.now();
      const step = (t) => { const m = Math.min(1, (t - t0) / 220); view.set({ ...props, prev, mix: m }); if (m < 1) A.raf = requestAnimationFrame(step); };
      A.raf = requestAnimationFrame(step);
    } else { cancelAnimationFrame(A.raf); view.set(props); }
    A.last = bm; A.lastKey = key;
  });

  const tipFor = (cell) => {
    const b = S.bundle.value; if (!b) return null; const F = S.fields.value, v = VARS[S.varIdx.value], k = cell.i * NLON + cell.j; if (!F) return null;
    const w = viewOf(F, v, dayKey());
    return { cell, v, P: w.P[k], M: w.M ? w.M[k] : null };
  };
  const onMove = (e) => {
    const view = viewRef.current; if (!view) return; const cell = view.cellAt(e);
    if (down.current && cell) { down.current.moved = true; const a = down.current.cell; view.set({ dragBox: { i0: Math.min(a.i, cell.i), i1: Math.max(a.i, cell.i), j0: Math.min(a.j, cell.j), j1: Math.max(a.j, cell.j) } }); }
    S.hoverTip.value = cell ? { ...tipFor(cell), x: e.clientX, y: e.clientY } : null;
  };
  const onDown = (e) => { if (!S.customOpen.value) return; const cell = viewRef.current.cellAt(e); if (cell) { down.current = { cell, moved: false }; e.preventDefault(); } };
  useEffect(() => {
    const up = (e) => {
      const dn = down.current; if (!dn) return; down.current = null; const view = viewRef.current; view.set({ dragBox: null }); if (!dn.moved) return;
      const c2 = view.cellAt(e) || dn.cell;
      S.drawBox.value = { i0: Math.min(dn.cell.i, c2.i), i1: Math.max(dn.cell.i, c2.i), j0: Math.min(dn.cell.j, c2.j), j1: Math.max(dn.cell.j, c2.j) };
      S.custom.value = { ...S.custom.value, where: 'drawn' }; dragged = true;
    };
    window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up);
  }, []);
  const onClick = (e) => {
    if (dragged) { dragged = false; return; }
    const view = viewRef.current, city = view.cityAt(e), cell = view.cellAt(e); if (!cell) return;
    const c = city ? { lat: city.lat, lon: city.lon, name: city.text } : { lat: cell.lat, lon: cell.lon, name: null };
    const i = Math.floor(c.lat - 6), j = Math.floor(c.lon - 65);
    S.place.value = { ...c, i, j }; S.sideTab.value = 'place';
  };
  const desc = useMemo(() => '', []);
  return (
    <div class="map-box">
      <canvas data-tour="map" ref={cvRef} role="img" aria-label="Map of India showing the forecast. Click a city or any spot to see its 10-day series." onMouseMove={onMove} onMouseLeave={() => (S.hoverTip.value = null)} onMouseDown={onDown} onClick={onClick} class={S.customOpen.value ? 'draw' : ''} />
      {S.busy.value > 0 && S.bundle.value && <div class="busy-veil" role="status"><span class="spin" />{S.busyText.value}</div>}
    </div>
  );
}

export function HoverTip() {
  const t = S.hoverTip.value; if (!t || !t.v) return null;
  const { v, cell } = t, T = S.total.value, dec = v.dec, ch = t.M != null ? t.M - t.P : null, unit = T && v.sum ? 'mm' : v.unit;
  return (
    <div class="tip" style={{ left: Math.min(t.x + 14, innerWidth - 220) + 'px', top: Math.min(t.y + 14, innerHeight - 120) + 'px' }}>
      <b>{cell.lat.toFixed(1)}°N, {cell.lon.toFixed(1)}°E, {T ? totalWord(v) : `day ${S.day.value}`}</b>
      <div>Normal <b>{fmtN(t.P, dec)}</b> {unit}</div>
      {t.M != null && <div>What-if <b>{fmtN(t.M, dec)}</b> {unit}</div>}
      {ch != null && <div>Change <b>{sgn(ch, Math.abs(ch) < 10 ? 2 : 1)}</b> {unit}</div>}
    </div>
  );
}

export const MODE_NAMES = { normal: 'Normal forecast', whatif: 'With your change', diff: 'Only the change' };
export function PlateHead() {
  const b = S.bundle.value, md = b && b.mv ? S.mode.value : 'normal', v = VARS[S.varIdx.value], sm = S.sample.value;
  const hasWi = !!(b && b.mv);
  const when = S.total.value ? totalWord(v) : `day ${S.day.value}`, nm = v.short || v.name;
  const title = md === 'diff' ? `${nm} change, ${when}` : `${MODE_NAMES[md]}: ${nm.toLowerCase()}, ${when}`;
  const words = sm ? (DATE_WORDS[sm.file] || sm.name) : '';
  return (
    <div class="plate-head">
      <div class="plate-row">
        <h2 class="plate-title" title={title}>{title}</h2>
        <div class="vtabs" role="tablist" aria-label="What to show on the map" data-tour="vars">
          {VARS.map((x) => <button key={x.key} role="tab" aria-selected={S.varKey.value === x.key} title={x.tip} class={S.varKey.value === x.key ? 'on' : ''} onClick={() => (S.varKey.value = x.key)}>{x.short || x.name}</button>)}
        </div>
      </div>
      <div class="plate-row sub">
        <div class="seg" role="tablist" aria-label="Which forecast to show" data-tour="modes">
          {[['normal', MODE_NAMES.normal], ['whatif', MODE_NAMES.whatif], ['diff', MODE_NAMES.diff]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={md === k} class={md === k ? 'on' : ''} disabled={k !== 'normal' && !hasWi} onClick={() => S.setMode(k)}
              title={{ normal: 'The AI\u2019s forecast if nothing unusual happens', whatif: 'The forecast after your what-if', diff: 'With your change minus normal: where and how much the weather changes' }[k]}>{l}</button>
          ))}
        </div>
        {sm && <p class="datenote" title={`Replay of ${sm.date_label}, ${words}. Not a live forecast.`}>Replay of {sm.date_label} &middot; not a live forecast</p>}
      </div>
    </div>
  );
}

export function Legend() {
  const b = S.bundle.value, md = b && b.mv ? S.mode.value : 'normal', vi = S.varIdx.value, v = VARS[vi], F = S.fields.value, T = S.total.value;
  if (!F) return <div class="legend" />;
  const w = viewOf(F, v, dayKey());
  let words, lut, ticks, endNote, unit;
  if (md === 'diff') {
    const A = w.A, dec = A < 2 ? 2 : A < 10 ? 1 : 0; lut = lutDiff(v.dcmap);
    ticks = [[0, sgn(-A, dec)], [0.25, sgn(-A / 2, dec + (A / 2 < 1 ? 1 : 0))], [0.5, 'no change'], [0.75, sgn(A / 2, dec + (A / 2 < 1 ? 1 : 0))], [1, sgn(A, dec)]];
    words = w.quiet ? `Almost no change in ${v.noun} from this what-if. Try another quantity above.` : v.dwords;
    const D = w.D; let kmax = 0; for (let k = 1; k < D.length; k++) if (Math.abs(D[k]) > Math.abs(D[kmax])) kmax = k;
    const dv = D[kmax], dd = Math.abs(dv) < 10 ? (Math.abs(dv) < 1 ? 2 : 1) : 0, du = T && v.sum ? 'mm over 10 days' : v.unit;
    endNote = <span class="strongest" data-strongest={whereIs(kmax, S.assets.value)}>Strongest change on this map: <b>{whereIs(kmax, S.assets.value)}</b> ({sgn(dv, dd)} {du})</span>;
    unit = T ? `${totalUnit(v)}, what-if minus normal` : v.unit + ', change vs normal \u00B7 same scale all 10 days';
  } else {
    const sc = NORMAL[w.scale]; lut = lutNormal(w.scale); words = v.words;
    ticks = sc.ticks.map((t) => [tOf(sc, t), String(t)]);
    if (v.key === 'tp') endNote = T ? 'All 10 days of rain added up. 1° averages; local showers can be heavier.' : 'Light 2.5 · moderate 15.6 mm (IMD). 1° averages; local showers can be heavier.';
    unit = T ? totalUnit(v) : v.unit;
  }
  return (
    <div class="legend" data-tour="legend">
      <div class="legend-words"><span>{words}</span><span class="unit">{unit}</span></div>
      <div class="legend-bar" style={{ background: gradientCss(lut) }} />
      <div class="legend-ticks">{ticks.map(([t, l], i) => <span key={i} style={{ left: t * 100 + '%' }} class={i === 0 ? 'first' : i === ticks.length - 1 ? 'last' : ''}>{l}</span>)}</div>
      <div class="legend-foot"><span>{endNote || ''}</span><span>1° grid · ERA5-derived · model output</span></div>
    </div>
  );
}

export function Scrubber() {
  const d = S.day.value, p = S.playing.value, T = S.total.value, v = VARS[S.varIdx.value], pos = T ? 11 : d;
  return (
    <div class="scrub" data-tour="scrub" data-view={T ? 'total' : 'day'}>
      <button class="btn-icon" onClick={() => S.play(!p)} aria-label={p ? 'Pause' : 'Play the 10 days'} title="Play days 1 to 10, then the 10-day total (Space)"><Icon name={p ? 'pause' : 'play'} size={18} /></button>
      <div class="scrub-mid">
        <input type="range" min="1" max="11" step="1" value={pos} aria-label="Forecast day, or all 10 days" aria-valuetext={T ? `All 10 days: ${totalWord(v)}` : `Day ${d} of 10`} onInput={(e) => { S.play(false); S.setDay(+e.target.value); }} />
        <div class="scrub-ticks" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => <span key={i} class={!T && i + 1 === d ? 'on' : ''}>{i + 1}</span>)}
          <span class={'all' + (T ? ' on' : '')} onClick={() => { S.play(false); S.setTotal(); }}>All</span>
        </div>
      </div>
      <div class="scrub-day" aria-live="polite">{T ? <><b>10-day</b> {v.sum ? 'total' : 'average'}</> : <><b>Day {d}</b> of 10</>}</div>
    </div>
  );
}
