// "Influence": nudge one area at a time, live, and measure how much one chosen place responds.
import { NCELL, NCH, lat, lon } from './util.js';
import { lut } from './colormaps.js';
import { buildPerturbation } from './shock.js';
import { tiles, NUDGES, total, whereFrom } from './insights.js';
import { compsFor, sgn } from './scenarios.js';
import { allPlaces } from './ui-places.js';

const $ = (id) => document.getElementById(id);
const KIND = {
  rain: { label: '10-day rain', unit: 'mm', cmap: 'brblue', less: 'drier', more: 'wetter', floor: 5 },
  temp: { label: 'average temperature', unit: '°C', cmap: 'rdbuL', less: 'cooler', more: 'warmer', floor: 0.3 },
  wind: { label: 'average wind', unit: 'km/h', cmap: 'rdbuL', less: 'calmer', more: 'windier', floor: 1 },
};
const fmt = (x) => sgn(x, Math.abs(x) >= 10 ? 0 : Math.abs(x) >= 1 ? 1 : 2);

export function createInfluence(app) {
  const S = app.S, list = tiles();
  let places = [], res = null, token = 0, running = false, picked = null;

  const placeOf = (id) => places.find((p) => p.id === id);
  const centre = (p) => { if (p.lat) return p; let la = 0, lo = 0, w = 0; for (const [k, f] of p.cells) { la += f * lat((k / 36) | 0); lo += f * lon(k % 36); w += f; } return { ...p, lat: la / w, lon: lo / w }; };

  function setup() {
    const a = allPlaces(S); places = [...a.cities, ...a.states];
    $('infPlace').innerHTML = [['Cities', a.cities], ['States', a.states]].map(([g, l]) => `<optgroup label="${g}">${l.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</optgroup>`).join('');
    $('infPlace').value = 'c:Chennai';
    $('infNudge').innerHTML = NUDGES.map((n) => `<option value="${n.id}">${n.label}</option>`).join('');
  }

  const scale = () => Math.max(KIND[res.kind].floor, ...res.effects.filter((x) => x !== undefined).map(Math.abs));

  function draw() {
    if (S.tab !== 'influence') return;
    const target = centre(placeOf(res ? res.place : $('infPlace').value)), kind = res ? res.kind : $('infKind').value, K = KIND[kind];
    const A = res ? scale() : K.floor, L = lut(K.cmap);
    const cells = list.map((box, n) => {
      const x = res?.effects[n];
      if (x === undefined) return { box, fill: res && running && n === res.next ? 'rgba(200,116,27,.45)' : 'rgba(0,0,0,0)', stroke: 'rgba(16,32,43,.22)' };
      const k = Math.round((Math.max(-1, Math.min(1, x / A)) + 1) * 127.5) * 3;
      return { box, fill: `rgba(${L[k]},${L[k + 1]},${L[k + 2]},${(Math.abs(x / A) < 0.12 ? 0 : 0.1 + 0.78 * Math.min(1, Math.abs(x / A))).toFixed(2)})`, stroke: n === picked ? '#10202b' : 'rgba(16,32,43,.18)', width: n === picked ? 3 : 1 };
    });
    app.stage.map.set({ ...app.stage.common(), field: null, tiles: cells, box: null, boxText: null, pulse: true });
    app.stage.setPins([{ id: 'target', name: target.name, lat: target.lat, lon: target.lon, level: 0, target: true, label: target.name }]);
    app.stage.caption(`Influence on ${target.name}`, res ? `Change in ${K.label}, by area` : '');
    if (res) app.stage.legend(K.cmap, [`${fmt(-A)} ${K.unit} (${K.less})`, 'no effect', `${fmt(A)} ${K.unit} (${K.more})`], `Effect on ${target.name}’s ${K.label}`);
    else document.getElementById('sLegend').innerHTML = '';
  }

  function ranked() {
    return res.effects.map((x, n) => ({ n, x })).filter((o) => o.x !== undefined).sort((a, b) => Math.abs(b.x) - Math.abs(a.x)).slice(0, 5);
  }
  function results() {
    const held = document.activeElement?.closest?.('#infList [data-n]')?.dataset.n;
    const K = KIND[res.kind], target = centre(placeOf(res.place)), top = ranked(), weak = !top.length || Math.abs(top[0].x) < K.floor;
    $('infResults').hidden = !top.length;
    $('infVerdict').textContent = weak ? `No single area moves ${target.name}’s ${K.label} by ${K.floor} ${K.unit} or more: too small to read as a signal.`
      : `Strongest${running ? ' so far' : ''}: ${whereFrom(list[top[0].n], target)}, ${fmt(top[0].x)} ${K.unit}.`;
    $('infList').innerHTML = top.map((o) => `<li class="${o.n === picked ? 'on' : ''}"><button type="button" data-n="${o.n}"><span>${whereFrom(list[o.n], target)}</span><b>${fmt(o.x)} ${K.unit}</b></button>${o.n === picked ? `<button type="button" class="s-btn small primary" data-open="${o.n}">Use as scenario</button>` : ''}</li>`).join('');
    if (held !== undefined) $('infList').querySelector(`[data-n="${held}"]`)?.focus({ preventScroll: true });
  }

  async function run() {
    const id = ++token, init = S.init, doy = S.doy;
    if (!init || !S.healthy) return app.banner('No model server. Start it with: python serve.py');
    const place = $('infPlace').value, kind = $('infKind').value, nudge = NUDGES.find((n) => n.id === $('infNudge').value), cells = placeOf(place).cells, last = init.subarray(2 * NCH * NCELL);
    res = { place, kind, nudge, effects: new Array(list.length), next: 0 }; picked = null; running = true;
    $('infRun').disabled = true; $('infStop').hidden = false; $('infBar').hidden = false; $('infResults').hidden = true;
    const t0 = performance.now();
    try {
      const base = total((await S.api.run(init, doy, null)).roll, kind, cells);
      for (let n = 0; n < list.length && id === token; n++) {
        res.next = n; draw();
        const r = await S.api.run(init, doy, buildPerturbation(last, list[n], compsFor(nudge.values)).pert);
        if (id !== token) break;
        res.effects[n] = total(r.roll, kind, cells) - base;
        $('infBar').firstElementChild.style.width = ((n + 1) / list.length) * 100 + '%';
        $('infStatus').textContent = `${n + 1} of ${list.length}`;
        results(); draw();
      }
      if (id === token) $('infStatus').textContent = `${list.length} areas in ${((performance.now() - t0) / 1000).toFixed(0)} s`;
    } catch (e) { if (id === token) $('infStatus').textContent = `${e.message}. Check the model server and search again.`; }
    if (id === token) finish();
  }
  function finish() { running = false; $('infRun').disabled = false; $('infStop').hidden = true; if (res) results(); draw(); }
  function stop() { token++; const n = res ? res.effects.filter((x) => x !== undefined).length : 0; $('infStatus').textContent = `Stopped at ${n} of ${list.length}`; finish(); }

  function reset() { token++; res = null; picked = null; running = false; $('infRun').disabled = false; $('infStop').hidden = true; $('infBar').hidden = true; $('infBar').firstElementChild.style.width = '0'; $('infStatus').textContent = ''; $('infResults').hidden = true; draw(); }

  $('infRun').onclick = run; $('infStop').onclick = stop;
  for (const s of ['infPlace', 'infKind', 'infNudge']) $(s).onchange = reset;
  $('infList').onclick = (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const b = list[+open.dataset.open], target = centre(placeOf(res.place));
      return app.runNew({ id: 'found', title: 'Area from search',area: `the area ${whereFrom(b, target)}`, box: [lat(b.i0), lat(b.i1), lon(b.j0), lon(b.j1)], values: { ...res.nudge.values }, focus: res.kind === 'rain' ? 'tp' : res.kind === 'temp' ? 't2m' : 'wind' });
    }
    const b = e.target.closest('[data-n]'); if (b) { picked = +b.dataset.n; results(); draw(); }
  };

  /** Watch any place picked on the map, adding it to the list if needed. */
  function watch(p) {
    if (running) { $('infStatus').textContent = 'Stop the search first to measure another place.'; return; }
    if (!placeOf(p.id)) { places.push(p); $('infPlace').add(new Option(p.kind === 'city' ? `${p.name}, ${p.sub}` : p.name, p.id)); }
    $('infPlace').value = p.id; reset();
  }

  return { setup, draw, reset, watch };
}
