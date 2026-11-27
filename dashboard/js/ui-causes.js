// "Causes": run each part of the scenario on its own and compare with all of them together.
import { NCELL, NCH } from './util.js';
import { buildPerturbation } from './shock.js';
import { breakdown, timeline, KINDS } from './insights.js';
import { activeParts, amountText, sgn } from './scenarios.js';
import { nf } from './stage.js';

const $ = (id) => document.getElementById(id);
const MEASURE = { rain: { label: '10-day rain', unit: 'mm' }, temp: { label: 'average temperature', unit: '°C' }, wind: { label: 'average wind', unit: 'km/h' } };

export function createCauses(app) {
  const S = app.S;
  let singles = null, parts = [], token = 0;

  let extra = []; // towns picked on the map that are not in the standard lists
  const places = () => { const r = app.places.rows(); return [...r.cities, ...r.states, ...extra]; };

  function reset() {
    token++; singles = null; extra = [];
    parts = S.mv && S.sc.values ? activeParts(S.sc.values, S.sc.strength) : [];
    $('causeBlock').hidden = !S.mv || !S.sc.values;
    if ($('causeBlock').hidden) return;
    const r = app.places.rows();
    $('causePlace').innerHTML = ['cities', 'states'].map((key) => `<optgroup label="${key === 'cities' ? 'Cities' : 'States'}">${r[key].map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</optgroup>`).join('');
    $('causeKind').value = r.cities[0]?.t.kind || 'rain';
    const single = parts.length < 2;
    $('causeRun').hidden = single; $('causeForm').hidden = single;
    $('causeOut').innerHTML = single ? `<p class="s-note">Only ${parts[0]?.word || 'nothing'} changes here. Add a second change to compare causes.</p><button type="button" class="s-btn small" id="causeAdd">Add a change</button>` : '';
    if (single) $('causeAdd').onclick = () => app.openMix(S.sc);
  }

  function draw() {
    const p = places().find((x) => x.id === $('causePlace').value), kind = $('causeKind').value, m = MEASURE[kind];
    if (!p || !singles) return;
    const r = breakdown(S.prime, S.mv, singles, p.cells, kind);
    const items = [...r.parts, { id: 'together', label: 'Combined effect', value: r.together }];
    const max = Math.max(1e-6, Math.abs(r.total), ...items.map((x) => Math.abs(x.value)));
    const val = (x) => `${sgn(x, Math.abs(x) >= 10 ? 0 : Math.abs(x) >= 1 ? 1 : 2)} ${m.unit}`;
    const top = [...r.parts].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
    const small = Math.abs(r.total) < (kind === 'rain' ? 1 : kind === 'temp' ? 0.1 : 0.5);
    const lead = small ? `${p.name}: ${m.label} barely changes (${val(r.total)}).` : `${p.name}: ${m.label} ${r.total > 0 ? 'rises' : 'falls'} ${nf(Math.abs(r.total))} ${m.unit}, mostly from ${top.label[0].toLowerCase()}${top.label.slice(1)}.`;
    $('causeOut').innerHTML = `<p class="s-verdict">${lead}</p><ol class="s-causes">${[{ id: 'all', label: 'Total', value: r.total }, ...items].map((x) =>
      `<li class="${x.id}"><span>${x.label}</span><i><u class="${x.value >= 0 ? 'up' : 'down'}" data-w="${((Math.abs(x.value) / max) * 50).toFixed(1)}"></u></i><b>${val(x.value)}</b></li>`).join('')}</ol>
      <p class="s-note">Right: ${KINDS[kind].up}. Left: ${KINDS[kind].down}. Each change was run on its own.</p>`;
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.s-causes u').forEach((u) => (u.style.width = u.dataset.w + '%'))));
  }

  async function run() {
    const id = ++token, last = S.init.subarray(2 * NCH * NCELL), box = S.box, init = S.init, doy = S.doy;
    $('causeRun').disabled = true; const out = [];
    try {
      for (const [n, p] of parts.entries()) {
        $('causeOut').innerHTML = `<p class="s-note" role="status">Running ${p.word} alone (${n + 1} of ${parts.length})</p>`;
        const comps = p.chs.map((ch) => ({ ch, mode: p.mode, value: p.value }));
        const r = await S.api.run(init, doy, buildPerturbation(last, box, comps).pert);
        if (id !== token) return;
        out.push({ id: p.id, label: `${p.word[0].toUpperCase()}${p.word.slice(1)} ${amountText(p)}`, roll: r.roll });
      }
      singles = out; draw();
    } catch (e) { $('causeOut').innerHTML = `<p class="s-note">${e.message}. Check the model server and try again.</p>`; }
    finally { $('causeRun').disabled = false; }
  }

  $('causeRun').onclick = run;
  $('causePlace').onchange = draw; $('causeKind').onchange = draw;

  return {
    reset,
    /** id from a list, or any place picked on the map. */
    explain(which) {
      if ($('causeBlock').hidden) return;
      const id = typeof which === 'string' ? which : which.id;
      let p = places().find((x) => x.id === id);
      if (!p) {
        if (typeof which === 'string') return;
        p = { ...which, t: timeline(S.prime, S.mv, which.cells) }; extra.push(p);
        $('causePlace').add(new Option(`${p.name}, ${p.sub}`, p.id));
      }
      $('causePlace').value = id; $('causeKind').value = p.t.kind;
      $('causeBlock').open = true; $('causeBlock').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (parts.length > 1) { if (singles) draw(); else run().then(() => $('causeBlock').scrollIntoView({ block: 'start' })); } // again once the bars exist
    },
  };
}
