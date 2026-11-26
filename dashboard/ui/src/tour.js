// Guided tour: declarative steps that drive the store. Safe scenarios only. Esc exits; the tour never blocks the judge's input.
import * as S from './store.js';
import { SCENARIOS } from './lib/narrative.js';

const sc = (id) => SCENARIOS.find((s) => s.id === id);
const same = (file, id) => S.sample.value && S.sample.value.file === file && S.result.value && S.result.value.sc.id === id;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

export const STEPS = [
  { id: 'welcome', target: 'map', title: 'An AI twin of India’s weather', body: 'This replays 28 May 2020, the week the monsoon reached Kerala: the AI’s 10-day forecast, computed on this laptop.',
    run: async () => { S.customOpen.value = false; if (!same('onset.json', 'dry')) await S.loadSample('onset.json', 'dry'); S.setMode('normal'); S.varKey.value = 'tp'; S.setDay(1); S.play(true); } },
  { id: 'ask', target: 'whatif', title: 'Now ask a what-if', body: 'Each question nudges the weather in one place on the last day. Here: the air over Rajasthan is 40 % drier. The AI replays the 10 days.',
    run: async () => { S.play(false); if (!same('onset.json', 'dry')) await S.loadSample('onset.json', 'dry'); } },
  { id: 'diff', target: 'map', title: 'Where does the forecast change?', body: 'Brown means drier than normal, teal wetter. Drag the day slider: the change spreads outward from the box, step by step.',
    run: async () => { S.setMode('diff'); S.varKey.value = 'tp'; S.sideTab.value = 'spread'; S.setDay(1); await nap(400); S.play(true); } },
  { id: 'who', target: 'result', title: 'Who is affected', body: 'One sentence, then three numbers: farmers (monsoon-crop rain), heat risk and wind power. The range shows how it changes at half and 1.5 times the strength.',
    run: async () => { S.play(false); S.setDay(5); S.sideTab.value = 'states'; } },
  { id: 'date', target: 'date', title: 'Another day, another question', body: 'On 9 January 2020 a winter storm sits over north India. We drop the pressure over Bengal by 5 hPa.',
    run: async () => { await S.loadSample('western_disturbance.json', 'lowp'); } },
  { id: 'trust', target: 'trust', title: 'Why trust it', body: 'Change nothing and you get exactly the same forecast out, bit for bit. That test runs live here, on this machine.',
    run: async () => { S.nullTest.value = null; await S.runNull(); } },
  { id: 'turn', target: 'whatif', title: 'Your turn: draw your own', body: 'Pick what to change, by how much and where, or drag a box on the map. Then press Run.',
    run: async () => { S.customOpen.value = true; setTimeout(() => { const b = document.getElementById('builder'); b && b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60); } },
];

let token = 0;
export async function goTo(i) {
  if (i < 0 || i >= STEPS.length) return exitTour();
  const t = ++token; S.tour.value = i;
  if (S.health.value !== 'ready') { exitTour(); S.setError('The forecast engine isn’t running. Ask the presenter to start it.'); return; }
  try { await STEPS[i].run(); } catch (e) { if (t === token) { exitTour(); } }
}
export function startTour() { S.introOpen.value = false; S.drawer.value = null; goTo(0); }
export const nextStep = () => (S.tour.value === STEPS.length - 1 ? exitTour() : goTo(S.tour.value + 1));
export const prevStep = () => goTo(S.tour.value - 1);
export function exitTour() { token++; S.tour.value = null; S.play(false); }
