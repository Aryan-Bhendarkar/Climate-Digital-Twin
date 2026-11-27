// "Checks": run live checks on any change (the current one, a random one, or pasted JSON).
import { NLAT, NLON, NCELL, NCH, flatten } from './util.js';
import { runChecks, CHECKS } from './insights.js';
import { LineChart } from './chart.js';
import { randomScenario, describe } from './scenarios.js';
import { still } from './stage.js';

const $ = (id) => document.getElementById(id);
const MARK = { pass: 'Passed', fail: 'Failed', warn: 'Look closer', na: 'Not tested', wait: 'Running' };

const shapeOk = (a, dims) => (dims.length ? Array.isArray(a) && a.length === dims[0] && a.every((x) => shapeOk(x, dims.slice(1))) : Number.isFinite(a));

/** Accepts a bare [6][32][36] perturbation, or a /simulate request body. */
export function parsePasted(text) {
  let j; try { j = JSON.parse(text); } catch (e) { throw new Error('That is not valid JSON. Paste a whole array or request.'); }
  const body = Array.isArray(j) ? { perturbation: j } : j;
  if (!shapeOk(body.perturbation, [NCH, NLAT, NLON])) throw new Error('"perturbation" must be numbers shaped [6][32][36].');
  const pert = Float32Array.from(body.perturbation.flat(2));
  if (!body.init_states) return { pert };
  if (!shapeOk(body.init_states, [3, NCH, NLAT, NLON])) throw new Error('"init_states" must be numbers shaped [3][6][32][36].');
  if (!shapeOk(body.doy_sincos, [2])) throw new Error('"doy_sincos" must be two numbers.');
  return { pert, init: flatten(body.init_states), doy: body.doy_sincos };
}

export function createJudge(app) {
  const S = app.S, chart = new LineChart($('cvTrust'), { log: true });
  let token = 0, ran = false;
  const item = (c) => `<li class="${c.status}"><i role="img" aria-label="${MARK[c.status]}"></i><div><b>${c.title}</b><p>${c.text || ''}</p></div><span>${c.value || ''}</span></li>`;

  function drawSpread() {
    const r = S.mv && S.rip;
    if (r) { const x = r.inside.map((_, i) => i + 1), fl = (a) => a.map((q) => Math.max(q, 1e-12)); chart.set([{ name: 'changed area', x, y: fl(r.inside), color: '#7FA7CF' }, { name: 'elsewhere', x, y: fl(r.outside), color: '#E0B07A' }], { marker: S.day, log: true }); } else chart.set([]);
    $('trustCap').textContent = r ? 'Size of the change, log scale. Blue: changed area. Sand: elsewhere.' : 'Appears once a scenario runs.';
  }

  function reset() {
    token++; ran = false; $('jgResults').hidden = true; $('jgCurrent').disabled = !S.mv;
    $('jgWhat').textContent = S.mv ? `Current: ${S.sc.pert ? 'the pasted change' : `${describe(S.sc.values, S.sc.strength)} over ${S.sc.area}`}.` : 'Make a change, or try a random scenario.';
    drawSpread();
  }

  async function check() {
    if (!S.mv) return;
    const id = ++token, init = S.init, doy = S.doy, pert = S.pert; ran = true;
    $('jgResults').hidden = false; $('jgScore').textContent = 'Running three forecasts';
    $('jgList').innerHTML = Object.values(CHECKS).map((title) => item({ title, status: 'wait' })).join('');
    for (const b of ['jgCurrent', 'jgRandom', 'jgPaste']) $(b).disabled = true;
    try {
      const base = await S.api.run(init, doy, null), zero = await S.api.run(init, doy, new Float32Array(NCH * NCELL));
      const t0 = performance.now(), shocked = await S.api.run(init, doy, pert), ms = performance.now() - t0;
      if (id !== token) return;
      const checks = runChecks({ base: base.roll, zero: zero.roll, shocked: shocked.roll, pert, ms });
      const list = $('jgList');
      for (const [i, c] of checks.entries()) {
        if (!still()) await new Promise((r) => setTimeout(r, 160));
        if (id !== token) return;
        list.children[i].outerHTML = item(c);
      }
      const n = (s) => checks.filter((c) => c.status === s).length, run = checks.length - n('na');
      $('jgScore').textContent = `${n('pass')} of ${run} passed${n('fail') ? `, ${n('fail')} failed` : ''}${n('warn') ? `, ${n('warn')} to review` : ''}`;
    } catch (e) { if (id === token) { $('jgScore').textContent = 'Checks could not run'; $('jgList').innerHTML = `<li class="fail"><i></i><div><b>${e.message}</b><p>Check the model server and try again.</p></div></li>`; } }
    finally { $('jgCurrent').disabled = !S.mv; $('jgRandom').disabled = $('jgPaste').disabled = false; }
  }

  $('jgCurrent').onclick = check;
  $('jgRandom').onclick = async () => { if (await app.runNew(randomScenario(), { stay: true })) check(); };
  $('jgPaste').onclick = async () => {
    $('jgError').textContent = '';
    try {
      const p = parsePasted($('jgJson').value);
      if (p.init) app.useInput(p.init, p.doy);
      if (await app.runNew({ id: 'pasted', title: 'Pasted change', area: 'the pasted area', pert: p.pert }, { stay: true })) check();
    } catch (e) { $('jgError').textContent = e.message; }
  };

  return { reset, drawSpread, check, ran: () => ran };
}
