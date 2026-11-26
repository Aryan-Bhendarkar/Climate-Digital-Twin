// Thin client for the live model server. Every number in the dashboard originates here.
import { flatten, nest3, NCELL, NCH } from './util.js';

export class Api {
  constructor(url) { this.url = url; }
  set base(u) { this.url = u.replace(/\/+$/, ''); }
  async health(timeoutMs = 8000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${this.url}/health`, { method: 'POST', signal: ctl.signal });
      const j = await r.json();
      return { ok: r.ok && j.status === 'ready', status: j.status, name: j.model_name };
    } catch (e) { return { ok: false, status: 'unreachable' }; } finally { clearTimeout(t); }
  }
  /** init: Float32Array [3][6][cell]; pert: Float32Array [6][cell] | null. Returns {roll: Float32Array [steps][6][cell], ms}. */
  async run(init, doy, pert, steps = 10) {
    const body = {
      init_states: [0, 1, 2].map((d) => nest3(init, d * NCH * NCELL)),
      doy_sincos: doy, steps, perturbation: pert ? nest3(pert, 0) : null,
    };
    let r;
    try {
      r = await fetch(`${this.url}/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { throw new Error(`Cannot reach model server at ${this.url}`); }
    if (!r.ok) { let m = r.statusText; try { m = JSON.stringify((await r.json()).detail); } catch (_) {} throw new Error(`Server error ${r.status}: ${m}`); }
    const j = await r.json();
    return { roll: flatten(j.rollout), ms: j.inference_ms };
  }
}
