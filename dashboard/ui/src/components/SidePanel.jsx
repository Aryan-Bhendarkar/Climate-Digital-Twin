import { useRef, useEffect, useMemo, useState } from 'preact/hooks';
import * as S from '../store.js';
import { VARS, bundleFields } from '../lib/fields.js';
import { bitmapFor } from './MapStage.jsx';
import { sgn } from '../lib/narrative.js';
import { spreadKm } from '../lib/spread.js';
import { SPEED_KM_PER_DAY } from '../lib/config.js';
import { Chart, AX } from './Chart.jsx';
import { NLON, lat, lon } from '@lib/util.js';

const BROWN = '#9A6212', TEAL = '#1F8A80';

function States() {
  const r = S.result.value, [all, setAll] = useState(false);
  if (!r) return <p class="side-empty">Pick a what-if and the states that get drier or wetter appear here.</p>;
  const rows = [...r.imp.K.rows].sort((a, b) => b.dRain - a.dRain), max = Math.max(10, ...rows.map((x) => Math.abs(x.dRain)));
  const big = rows.filter((x) => Math.abs(x.dRain) >= 2), wet = big.filter((x) => x.dRain > 0).slice(0, 5), dry = big.filter((x) => x.dRain < 0).slice(-5), hidden = rows.length - wet.length - dry.length;
  const show = all ? rows : [...wet, ...(hidden > 0 && (wet.length || dry.length) ? [null] : []), ...dry];
  if (!all && !show.length) return <p class="side-empty">No state&rsquo;s rain moves by more than 2 %.</p>;
  const hl = new Set(r.hl.ids);
  return (
    <div class="states">
      <p class="side-cap">10-day rain change, state by state</p>
      <ul role="list">
        {show.map((x, n) => x === null ? <li key="gap" class="gap">{hidden} more states change less</li> : (
          <li key={x.id} class={(hl.has(x.id) ? 'hl ' : '') + (Math.abs(x.dRain) < 5 ? 'noise' : '')} onMouseEnter={() => (S.pickState.value = x.id)} onMouseLeave={() => (S.pickState.value = null)} onFocus={() => (S.pickState.value = x.id)} onBlur={() => (S.pickState.value = null)} tabIndex={0}>
            <div class="st-top"><span>{x.name}</span><b>{sgn(x.dRain, Math.abs(x.dRain) < 10 ? 1 : 0)} %</b></div>
            <div class="track" aria-hidden="true"><i class="zero" /><i class={'bar ' + (x.dRain < 0 ? 'neg' : 'pos')} style={{ width: Math.min(50, (Math.abs(x.dRain) / max) * 50) + '%', [x.dRain < 0 ? 'right' : 'left']: '50%' }} /></div>
          </li>))}
      </ul>
      <div class="side-foot"><span><i class="sw neg" />drier</span><span><i class="sw pos" />wetter</span><span class="muted">faint = within noise</span>
        {rows.length > show.length && <button class="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}</div>
    </div>
  );
}

function Mini({ d, vi }) {
  const ref = useRef(), b = S.bundle.value, out = S.outlines.value;
  useEffect(() => {
    const cv = ref.current; if (!cv || !b || !out) return; const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = Math.round(W / 1.125);
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#DCE6EA'; g.fillRect(0, 0, W, H); g.imageSmoothingQuality = 'high'; g.drawImage(bitmapFor(b, vi, 'diff', d), 0, 0, W, H);
    const px = (lo, la) => [((lo - 65) / 36) * W, ((38 - la) / 32) * H];
    g.strokeStyle = 'rgba(15,37,48,.7)'; g.lineWidth = 0.8; g.beginPath();
    for (const c of out.countries) if (c.name === 'India') for (const r of c.rings) { for (let k = 0; k < r.length; k += 2) { const [x, y] = px(r[k], r[k + 1]); k ? g.lineTo(x, y) : g.moveTo(x, y); } }
    g.stroke();
    const box = S.result.value && S.result.value.box; if (box) { const [x0, y0] = px(lon(box.j0) - 0.5, lat(box.i1) + 0.5), [x1, y1] = px(lon(box.j1) + 0.5, lat(box.i0) - 0.5); g.strokeStyle = '#C27C0E'; g.lineWidth = 1.3; g.setLineDash([3, 2]); g.strokeRect(x0, y0, x1 - x0, y1 - y0); }
  }, [b, out, d, vi, S.result.value]);
  return <button class={'mini' + (S.day.value === d + 1 ? ' on' : '')} onClick={() => { S.play(false); S.setDay(d + 1); }} aria-label={`Show day ${d + 1}`}><canvas ref={ref} /><span>Day {d + 1}</span></button>;
}

function Spread() {
  const r = S.result.value, b = S.bundle.value;
  const km = useMemo(() => (r && b && b.mv ? spreadKm(b.prime, b.mv, r.box) : null), [r && r.id]);
  const chart = useMemo(() => {
    if (!km) return null; const x = km.map((_, i) => i + 1), ref = x.map((d) => d * SPEED_KM_PER_DAY);
    return { data: [x, km, ref], opts: { padding: [8, 8, 0, 0], scales: { x: { time: false, range: [1, 10] }, y: { range: [0, Math.max(1500, ...km) * 1.15] } },
      axes: [{ ...AX, values: (u, v) => v.map((t) => (Number.isInteger(t) ? t : '')), label: 'Forecast day', labelFont: AX.font, labelSize: 16, size: 38 }, { ...AX, size: 46, values: (u, v) => v.map((t) => t.toLocaleString('en-US')), label: 'km from your box', labelFont: AX.font, labelSize: 14 }],
      series: [{}, { stroke: '#0F2530', width: 2, points: { show: true, size: 5, fill: '#0F2530' } }, { stroke: '#9AA5A3', width: 1, dash: [4, 4], points: { show: false } }] } };
  }, [km]);
  if (!r || !b || !b.mv) return <p class="side-empty">Run a what-if to watch the change spread out from your box.</p>;
  const vi = S.varIdx.value;
  return (
    <div class="spread">
      <p class="side-cap">Where the {VARS[vi].noun} change has reached (days 1, 3, 5, 8, same scale)</p>
      <div class="minis">{[0, 2, 4, 7].map((d) => <Mini key={d} d={d} vi={vi} />)}</div>
      <p class="side-cap">How far the change has spread</p>
      {chart && <Chart data={chart.data} opts={chart.opts} height={150} label="Line chart: distance in kilometres the change has spread from your box, by forecast day" />}
      <p class="side-foot muted">Solid: farthest place that changed noticeably. Dotted: the model&rsquo;s speed limit, {SPEED_KM_PER_DAY} km a day.</p>
    </div>
  );
}

export function placeSeries(b, vi, p) {
  const F = bundleFields(b, vi), k = p.i * NLON + p.j, x = F.P.map((_, i) => i + 1), P = F.P.map((f) => f[k]), M = F.M.length ? F.M.map((f) => f[k]) : null;
  return { x, P, M };
}
export function PlaceChart({ height = 170 }) {
  const p = S.place.value, b = S.bundle.value, vi = S.varIdx.value, v = VARS[vi];
  const c = useMemo(() => {
    if (!p || !b) return null; const { x, P, M } = placeSeries(b, vi, p), all = [...P, ...(M || [])], lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.15 || 1, zero = v.key === 'tp' || v.key === 'wind' || v.key === 'tcwv';
    return { data: M ? [x, P, M] : [x, P], opts: { padding: [8, 8, 0, 0], scales: { x: { time: false, range: [1, 10] }, y: { range: [zero ? 0 : lo - pad, hi + pad] } },
      bands: M ? [{ series: [2, 1], fill: 'rgba(194,124,14,.16)' }] : [],
      axes: [{ ...AX, values: (u, vs) => vs.map((t) => (Number.isInteger(t) ? t : '')), label: 'Forecast day', labelFont: AX.font, labelSize: 16, size: 38 }, { ...AX, size: 40, label: v.unit, labelFont: AX.font, labelSize: 14 }],
      hooks: { draw: [(u) => { const cx = u.valToPos(S.day.value, 'x', true), g = u.ctx; g.save(); g.strokeStyle = 'rgba(15,37,48,.5)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx, u.bbox.top); g.lineTo(cx, u.bbox.top + u.bbox.height); g.stroke(); g.restore(); }] },
      series: [{}, { stroke: '#0F2530', width: 2, points: { show: false } }, ...(M ? [{ stroke: '#C27C0E', width: 2, points: { show: false } }] : [])] } };
  }, [p, b, vi, S.day.value]);
  if (!p) return <p class="side-empty">Click a city or any spot on the map to see its 10 days.</p>;
  const name = p.name || `${p.lat.toFixed(1)}°N, ${p.lon.toFixed(1)}°E`;
  return (
    <div class="place">
      <p class="side-cap"><b>{name}</b>, {v.name.toLowerCase()} ({v.unit})</p>
      {c && <Chart data={c.data} opts={c.opts} height={height} label={`Line chart of ${v.name} at ${name}, Normal against What-if, by forecast day`} />}
      <div class="side-foot"><span><i class="ln ink" />Normal</span>{b && b.mv && <span><i class="ln tur" />What-if</span>}{b && !b.mv && <span class="muted">Run a what-if to compare.</span>}<button class="link" onClick={() => { S.place.value = null; }}>Clear</button></div>
    </div>
  );
}

export function SidePanel() {
  const t = S.sideTab.value;
  return (
    <div class="side" data-tour="side">
      <div class="stabs" role="tablist" aria-label="More about this map">
        {[['states', 'States'], ['spread', 'Spread'], ['place', 'Place']].map(([k, l]) => <button key={k} role="tab" aria-selected={t === k} class={t === k ? 'on' : ''} onClick={() => (S.sideTab.value = k)}>{l}</button>)}
      </div>
      <div class="side-body" role="tabpanel">{t === 'states' ? <States /> : t === 'spread' ? <Spread /> : <PlaceChart />}</div>
    </div>
  );
}
