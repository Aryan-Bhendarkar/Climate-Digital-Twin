// A one-minute guided tour for first-time viewers. Every step drives the real controls, so every number is computed live.
import { SCENARIOS } from './scenarios.js';
import { still } from './stage.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, still() ? 0 : ms));

export function createTour(app) {
  const S = app.S, card = $('sTour');
  let at = -1, token = 0;
  const STEPS = [
    { title: 'Timeline Prime', text: 'Ten days from a past start (2019–21), run by the model on this computer in a fraction of a second. Nothing goes online.',
      go: async () => { app.setTab('ask'); app.explore.close(false); app.clear(); app.map.home(); if (S.prime) app.play(true); } },
    { title: 'Branch a Multiverse', text: 'Make the air over the Bay of Bengal 3 °C warmer. The model runs again with that change, and the map shows how the forecast differs, day by day.',
      go: async () => { await app.runNew(SCENARIOS.find((s) => s.id === 'bob'), { stay: true }); } },
    { title: 'Compare side by side', text: 'Timeline Prime on the left, the Multiverse on the right. Drag the divider to compare any part of the map.',
      go: async (id) => {
        app.play(false); S.layer = '1'; S.mode = app.map.glCanvas ? 'split' : 'whatif'; app.view(); S.day = Math.max(2, app.stage.impactPeak()); app.stage.render();
        for (let k = 0; k <= 40 && id === token; k++) { app.stage.setSplit(0.18 + 0.42 * (0.5 - 0.5 * Math.cos((k / 40) * Math.PI))); await wait(45); }
      } },
    { title: 'Who feels it', text: 'Places beyond the change are ranked by how much they feel it, with when, for how long and how firm. This opens the one felt most.',
      go: async () => { const top = app.places.topAway(); if (top) app.places.select(top.id); await new Promise((r) => setTimeout(r)); } }, // after the place sheet has taken focus
    { title: 'Bounded spread', text: 'By design a change moves at most 8 grid squares a day, about 900 km, so nothing appears beyond the dashed line. Real pressure changes can travel faster.',
      go: async () => { app.explore.close(false); app.stage.spread(); } },
    { title: 'Proof', text: 'Live checks on this Multiverse: a zero change gives an identical forecast, the output stays physical, the change starts where it was made.',
      go: async () => { if (app.stage.isSpreading()) app.stage.spread(); app.setTab('test'); $('jgCurrent').click(); } },
  ];

  function show() {
    const s = STEPS[at];
    card.querySelector('[data-n]').textContent = `${at + 1} of ${STEPS.length}`;
    card.querySelector('.s-tourbar b').style.width = `${((at + 1) / STEPS.length) * 100}%`;
    card.querySelector('h3').textContent = s.title; card.querySelector('p').textContent = s.text;
    card.querySelector('[data-act=next]').textContent = at === STEPS.length - 1 ? 'Finish' : 'Next';
    card.hidden = false;
  }
  async function step(n) {
    if (n >= STEPS.length) return end();
    at = n; const id = ++token; show();
    const next = card.querySelector('[data-act=next]');
    card.classList.add('busy'); next.disabled = true; card.focus({ preventScroll: true });
    try { await STEPS[n].go(id); }
    finally {
      if (id === token) {
        card.classList.remove('busy'); next.disabled = false; next.focus({ preventScroll: true });
        if (n === 1 && !S.mv) { app.play(false); end(); } // no forecast (server down): the later steps would have nothing to show
        else if (matchMedia('(max-width: 980px)').matches) document.querySelector(n === 3 || n === 5 ? '.s-side' : '.s-mapwrap').scrollIntoView({ block: 'start' });
      }
    }
  }
  function end() { token++; at = -1; card.hidden = true; }

  card.addEventListener('click', (e) => { const act = e.target.closest('[data-act]')?.dataset.act; if (act === 'next') step(at + 1); else if (act === 'end') end(); });
  window.addEventListener('keydown', (e) => { if (at >= 0 && e.key === 'Escape') end(); });
  return { start: () => step(0), end };
}
