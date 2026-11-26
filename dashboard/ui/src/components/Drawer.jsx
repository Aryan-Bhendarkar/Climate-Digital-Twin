import { useMemo } from 'preact/hooks';
import * as S from '../store.js';
import { sgn, fmtRain, lowBase, rainVal, LOW_RAIN_MM, HEAT_DEF } from '../lib/narrative.js';
import { Chart, AX } from './Chart.jsx';
import { PlaceChart } from './SidePanel.jsx';
import { Icon } from './icons.jsx';

const TABS = [['states', 'State table'], ['wind', 'Wind power'], ['ripple', 'Ripple'], ['cell', 'One place']];
function Empty() { return <p class="side-empty">Run a what-if first. The tables compare the what-if with the normal forecast.</p>; }

function StateTable({ r }) {
  const rows = [...r.imp.K.rows].sort((a, b) => Math.abs(rainVal(b)) - Math.abs(rainVal(a)));
  return (
    <div>
    <table class="tbl"><caption>Rain and heat by state, 10 days, compared with the normal forecast. States with under {LOW_RAIN_MM} mm of normal rain show the change in mm.</caption>
      <thead><tr><th>State</th><th class="n">Rain, normal (mm)</th><th class="n">Rain, with change (mm)</th><th class="n">Change</th><th>Band (IMD)</th><th class="n">Very hot days (normal &rarr; with change)</th><th class="n">Farm stress* (normal &rarr; with change)</th></tr></thead>
      <tbody>{rows.map((x) => <tr key={x.id} class={!lowBase(x) && Math.abs(x.dRain) >= 10 ? 'notable' : ''}><td>{x.name}</td><td class="n">{x.p.total.toFixed(x.p.total < 10 ? 1 : 0)}</td><td class="n">{x.m.total.toFixed(x.m.total < 10 ? 1 : 0)}</td><td class="n">{fmtRain(x)}</td><td>{lowBase(x) ? <span class="muted">dry season</span> : <span class={'tick ' + x.band.key}>{x.band.label}</span>}</td><td class="n">{x.p.heat} &rarr; {x.m.heat}</td><td class="n"><i class={'sq s' + x.m.stress.toFixed(0)} />{x.p.stress.toFixed(1)} &rarr; {x.m.stress.toFixed(1)}</td></tr>)}</tbody>
    </table>
    <p class="side-foot muted">{HEAT_DEF} *Farm stress: 0 to 3, the mean of a rain tier (deficit vs. the 2005&ndash;2018 normal for the month, plus long dry spells) and a heat tier (number of very hot days).</p>
    </div>);
}
function WindTable({ r }) {
  return (
    <table class="tbl"><caption>Wind-farm output of a generic turbine in the 6 main wind-power states (share of rated power, 10-day mean).</caption>
      <thead><tr><th>State</th><th class="n">Normal</th><th class="n">With change</th><th class="n">Change</th></tr></thead>
      <tbody>{r.imp.W.map((w) => <tr key={w.id}><td>{w.name}</td><td class="n">{(w.pMean * 100).toFixed(1)} %</td><td class="n">{(w.mMean * 100).toFixed(1)} %</td><td class="n">{sgn(w.dPct, 1)} %</td></tr>)}</tbody>
    </table>);
}
function Ripple({ r }) {
  const c = useMemo(() => {
    const x = r.rip.inside.map((_, i) => i + 1), fl = (a) => a.map((q) => Math.max(q, 1e-9));
    return { data: [x, fl(r.rip.inside), fl(r.rip.outside)], opts: { padding: [8, 12, 0, 0], scales: { x: { time: false, range: [1, 10] }, y: { distr: 3 } },
      axes: [{ ...AX, values: (u, v) => v.map((t) => (Number.isInteger(t) ? t : '')), label: 'Forecast day', labelFont: AX.font, labelSize: 16, size: 38 }, { ...AX, size: 64, label: 'Size of change (standardised, log scale)', labelFont: AX.font, labelSize: 16, values: (u, v) => v.map((t) => (t >= 1 ? t.toLocaleString('en-US') : t >= 0.001 ? String(+t.toPrecision(1)) : '<0.001')) }],
      series: [{}, { stroke: '#0F2530', width: 2, points: { show: true, size: 4 } }, { stroke: '#C27C0E', width: 2, points: { show: true, size: 4 } }] } };
  }, [r.id]);
  return (
    <div>
      <p class="side-cap">Dark line: change inside your box and 3 cells around it. Orange line: change everywhere else. It starts tiny and grows a little each day: the change spreads outward, it never jumps across the country.</p>
      <Chart data={c.data} opts={c.opts} height={260} label="Line chart on a log scale: size of change inside your area and elsewhere, by forecast day" />
      <p class="side-foot"><span><i class="ln ink" />Inside your area</span><span><i class="ln tur" />Elsewhere</span></p>
    </div>);
}
export function Drawer() {
  const t = S.drawer.value, r = S.result.value; if (!t) return null;
  return (
    <div class="drawer-wrap">
      <div class="scrim" onClick={() => (S.drawer.value = null)} />
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="Expert view">
        <div class="d-head"><h2>Expert view</h2><button class="btn-icon" onClick={() => (S.drawer.value = null)} aria-label="Close expert view (Esc)"><Icon name="x" /></button></div>
        <div class="stabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={t === k} class={t === k ? 'on' : ''} onClick={() => (S.drawer.value = k)}>{l}</button>)}</div>
        <div class="d-body">{!r && t !== 'cell' ? <Empty /> : t === 'states' ? <StateTable r={r} /> : t === 'wind' ? <WindTable r={r} /> : t === 'ripple' ? <Ripple r={r} /> : <PlaceChart height={300} />}</div>
      </aside>
    </div>);
}
