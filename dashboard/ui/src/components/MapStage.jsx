import { useRef, useEffect, useMemo, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { MapView, makeBitmap, isobars } from '../lib/mapdraw.js';
import { VARS, bundleFields, varIndex } from '../lib/fields.js';
import { boxFromLatLon } from '@lib/shock.js';
import { REGIONS, DATE_WORDS, whereIs } from '../lib/narrative.js';
import { NORMAL, lutNormal, lutDiff, gradientCss, tOf } from '../lib/scales.js';
import { sgn } from '../lib/narrative.js';
import { rIdx, NCELL, NLON } from '@lib/util.js';
import * as S from '../store.js';
import { Icon } from './icons.jsx';

let dragged = false;
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function bitmapFor(bundle, vi, md, d) {
  const key = `${md}|${vi}|${d}`; bundle.bm ||= {};
  if (bundle.bm[key]) return bundle.bm[key];
  const F = bundleFields(bundle, vi), v = VARS[vi];
  const bm = md === 'diff' ? makeBitmap(F.D[d], { kind: 'diff', cmap: v.dcmap, A: F.A, floor: v.floor, sqrt: !!v.sqrt }) : makeBitmap(md === 'whatif' ? F.M[d] : F.P[d], { kind: 'normal', scale: v.key });
  return (bundle.bm[key] = bm);
}
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
    const b = S.bundle.value, r = S.result.value, md = b && b.mv ? S.mode.value : 'normal', vi = S.varIdx.value, d = S.day.value - 1, v = VARS[vi];
    const hv = S.hoverTip.value, pl = S.place.value, cu = S.customOpen.value, cw = S.custom.value.where, db = S.drawBox.value;
    let box = r ? r.box : null;
    if (cu) { const rg = REGIONS.find((x) => x.id === cw); box = rg && rg.box ? boxFromLatLon(...rg.box) : db; }
    const props = { empty: null, bitmap: null, diff: md === 'diff', isolines: null, arrows: null, highlight: [], hlLabels: [], box, hover: hv ? hv.cell : null, place: pl, prev: null, mix: 1 };
    if (!b) { props.empty = S.health.value === 'down' ? 'The forecast engine isn’t running.' : 'Running the forecast…'; view.set(props); return; }
    const F = bundleFields(b, vi), bm = bitmapFor(b, vi, md, d); props.bitmap = bm;
    if (v.key === 'msl' && md !== 'diff') { b.iso ||= {}; const f = md === 'whatif' ? F.M[d] : F.P[d]; props.isolines = b.iso[md + d] ||= isobars(f, 4); }
    if (v.key === 'wind') {
      const roll = (x) => ({ u: Float32Array.from({ length: NCELL }, (_, k) => x[rIdx(d, 2) + k]), v: Float32Array.from({ length: NCELL }, (_, k) => x[rIdx(d, 3) + k]) });
      if (md === 'diff') { const a = roll(b.prime), c = roll(b.mv); props.arrows = { u: c.u.map((x, k) => x - a.u[k]), v: c.v.map((x, k) => x - a.v[k]) }; } else props.arrows = roll(md === 'whatif' ? b.mv : b.prime);
    }
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
    const b = S.bundle.value; if (!b) return null; const F = S.fields.value, v = VARS[S.varIdx.value], d = S.day.value - 1, k = cell.i * NLON + cell.j; if (!F) return null;
    return { cell, v, P: F.P[d][k], M: F.M[d] ? F.M[d][k] : null };
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
  const { v, cell } = t, dec = v.dec, ch = t.M != null ? t.M - t.P : null;
  return (
    <div class="tip" style={{ left: Math.min(t.x + 14, innerWidth - 220) + 'px', top: Math.min(t.y + 14, innerHeight - 120) + 'px' }}>
      <b>{cell.lat.toFixed(1)}°N, {cell.lon.toFixed(1)}°E</b>
      <div>Normal <b>{fmtN(t.P, dec)}</b> {v.unit}</div>
      {t.M != null && <div>What-if <b>{fmtN(t.M, dec)}</b> {v.unit}</div>}
      {ch != null && <div>Change <b>{sgn(ch, Math.abs(ch) < 10 ? 2 : 1)}</b> {v.unit}</div>}
    </div>
  );
}

export const MODE_NAMES = { normal: 'Normal forecast', whatif: 'With your change', diff: 'Only the change' };
export function PlateHead() {
  const b = S.bundle.value, md = b && b.mv ? S.mode.value : 'normal', v = VARS[S.varIdx.value], sm = S.sample.value;
  const hasWi = !!(b && b.mv);
  const title = `${MODE_NAMES[md]}: ${(v.short || v.name).toLowerCase()}, day ${S.day.value}`;
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
  const b = S.bundle.value, md = b && b.mv ? S.mode.value : 'normal', vi = S.varIdx.value, v = VARS[vi], F = S.fields.value;
  if (!F) return <div class="legend" />;
  let words, lut, ticks, endNote;
  if (md === 'diff') {
    const A = F.A, dec = A < 2 ? 2 : A < 10 ? 1 : 0; lut = lutDiff(v.dcmap);
    ticks = [[0, sgn(-A, dec)], [0.25, sgn(-A / 2, dec + (A / 2 < 1 ? 1 : 0))], [0.5, 'no change'], [0.75, sgn(A / 2, dec + (A / 2 < 1 ? 1 : 0))], [1, sgn(A, dec)]];
    words = F.quiet ? `Almost no change in ${v.noun} from this what-if. Try another quantity above.` : v.dwords;
    const D = F.D[S.day.value - 1]; let kmax = 0; for (let k = 1; k < D.length; k++) if (Math.abs(D[k]) > Math.abs(D[kmax])) kmax = k;
    const dv = D[kmax], dd = Math.abs(dv) < 10 ? (Math.abs(dv) < 1 ? 2 : 1) : 0;
    endNote = <span class="strongest" data-strongest={whereIs(kmax, S.assets.value)}>Strongest change on this map: <b>{whereIs(kmax, S.assets.value)}</b> ({sgn(dv, dd)} {v.unit})</span>;
  } else {
    const sc = NORMAL[v.key]; lut = lutNormal(v.key); words = v.words;
    ticks = sc.ticks.map((t) => [tOf(sc, t), String(t)]);
    if (v.key === 'tp') endNote = 'Light 2.5 · moderate 15.6 mm (IMD). 1° averages; local showers can be heavier.';
  }
  return (
    <div class="legend" data-tour="legend">
      <div class="legend-words"><span>{words}</span><span class="unit">{md === 'diff' ? v.unit + ', change vs normal \u00B7 same scale all 10 days' : v.unit}</span></div>
      <div class="legend-bar" style={{ background: gradientCss(lut) }} />
      <div class="legend-ticks">{ticks.map(([t, l], i) => <span key={i} style={{ left: t * 100 + '%' }} class={i === 0 ? 'first' : i === ticks.length - 1 ? 'last' : ''}>{l}</span>)}</div>
      <div class="legend-foot"><span>{endNote || ''}</span><span>1° grid · ERA5-derived · model output</span></div>
    </div>
  );
}

export function Scrubber() {
  const d = S.day.value, p = S.playing.value;
  return (
    <div class="scrub" data-tour="scrub">
      <button class="btn-icon" onClick={() => S.play(!p)} aria-label={p ? 'Pause' : 'Play the 10 days'} title="Play or pause (Space)"><Icon name={p ? 'pause' : 'play'} size={18} /></button>
      <div class="scrub-mid">
        <input type="range" min="1" max="10" step="1" value={d} aria-label="Forecast day" aria-valuetext={`Day ${d} of 10`} onInput={(e) => { S.play(false); S.setDay(+e.target.value); }} />
        <div class="scrub-ticks" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <span key={i} class={i + 1 === d ? 'on' : ''}>{i + 1}</span>)}</div>
      </div>
      <div class="scrub-day" aria-live="polite"><b>Day {d}</b> of 10</div>
    </div>
  );
}
