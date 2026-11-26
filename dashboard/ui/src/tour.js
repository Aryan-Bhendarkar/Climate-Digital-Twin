// Guided tour: declarative steps that drive the store. Esc exits; the tour never blocks the judge's input.
// Step copy that mentions a result is read from the LIVE result (headline, region), never hard-coded.
import * as S from './store.js';
import { SCENARIOS, CUSTOM_WHAT, REGIONS, DATE_WORDS, LANDING, nb } from './lib/narrative.js';

// ONE place for the tour's scenarios AND their copy. `scenario` is an id from lib/narrative.js SCENARIOS (its `lead` and
// `area` are used in the copy); `custom` presets the Draw-your-own form for the last step (what = CUSTOM_WHAT id, where = REGIONS id).
// Picked from the final-model sweep of every date x preset (research/final_scenarios.md): only physically plausible combos
// with a clear effect and an ordered size range. Avoid live: 'weak' (no clear effect on 4 of 5 dates), 'bob' on the onset and
// heatwave dates and 'lowp' on the heatwave and Amphan dates (wrong sign). Step 7 was re-run as a custom what-if too (WB/Jharkhand wetter, range in order).
export const TOUR_SCENARIOS = [
  LANDING,                                                                       // steps 1-4: Rajasthan drier -> Haryana/Punjab drier
  { file: 'heavy_rain.json', scenario: 'arab' },                                 // step 5: warmer Arabian Sea -> Kerala wetter
  { file: 'heavy_rain.json', custom: { what: 'tcwv', amt: 30, where: 'bob' } },  // step 7: your turn (form preset, nothing run)
];
const [T1, T2, T3] = TOUR_SCENARIOS;
const scOf = (t) => SCENARIOS.find((s) => s.id === t.scenario);
const same = (file, id) => S.sample.value && S.sample.value.file === file && S.result.value && S.result.value.sc.id === id;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const dateOf = (file) => { const m = S.samples.value.find((s) => s.file === file); return m ? m.date_label : ''; };
/** live: the headline currently on screen, if it belongs to scenario t */
const live = (t) => (same(t.file, t.scenario) ? S.result.value.hl.text : 'running…');
const customText = (c) => { const w = CUSTOM_WHAT.find((x) => x.id === c.what), r = REGIONS.find((x) => x.id === c.where); return `${w.label.toLowerCase()} ${w.fmtv(c.amt)} over the ${r.name}`; };
// After the tour: back to what the headline describes (rain, "Only the change", 10-day total).
function restore() { S.play(false); if (S.result.value) { S.varKey.value = 'tp'; S.setMode('diff'); S.setTotal(); S.sideTab.value = 'states'; } }

export const STEPS = [
  { id: 'welcome', target: 'map', title: 'An AI twin of India’s weather',
    body: () => `This replays ${dateOf(T1.file)}, ${DATE_WORDS[T1.file]}: the AI’s 10-day forecast, computed on this laptop. This is the normal forecast of rain, day by day.`,
    run: async () => { S.customOpen.value = false; if (!same(T1.file, T1.scenario)) await S.loadSample(T1.file, T1.scenario); S.setMode('normal'); S.varKey.value = 'tp'; S.setDay(1); S.play(true); } },
  { id: 'ask', target: 'whatif', title: 'Now ask a what-if',
    body: () => nb(`Each question changes the weather in one region at the start of the forecast, then the AI replays the 10 days. Here: ${scOf(T1).lead}.`),
    run: async () => { S.play(false); if (!same(T1.file, T1.scenario)) await S.loadSample(T1.file, T1.scenario); } },
  { id: 'diff', target: 'map', title: 'Where does the forecast change?',
    body: () => `This map shows only the change. Brown means drier than normal, teal wetter. Watch it spread out from the box over ${scOf(T1).area}, day by day, then add up to the 10-day total.`,
    run: async () => { S.setMode('diff'); S.varKey.value = 'tp'; S.sideTab.value = 'spread'; S.setDay(1); await nap(400); S.play(true); } },
  { id: 'who', target: 'result', title: 'Who is affected',
    body: () => `${live(T1)} Then three numbers: rain, heat risk and wind power. The size range re-runs your change at half and 1.5 times the strength.`,
    run: async () => { S.play(false); S.setMode('diff'); S.varKey.value = 'tp'; S.setTotal(); S.sideTab.value = 'states'; } },
  { id: 'date', target: 'date', title: 'Another day, another question',
    body: () => nb(`${dateOf(T2.file)}, ${DATE_WORDS[T2.file]}. What if ${scOf(T2).lead}? ${live(T2)}`),
    run: async () => { await S.loadSample(T2.file, T2.scenario); } },
  { id: 'trust', target: 'trust', title: 'Why trust it',
    body: () => 'Change nothing and you get exactly the same forecast out. That test runs live here, on this machine, just now.',
    run: async () => { S.nullTest.value = null; await S.runNull(); } },
  { id: 'turn', target: 'whatif', title: 'Your turn: draw your own',
    body: () => nb(`${dateOf(T3.file)}, ${DATE_WORDS[T3.file]}. The form is set to ${customText(T3.custom)}. Change what, how much and where (or drag a box on the map), then press Run.`),
    run: async () => {
      if (!S.sample.value || S.sample.value.file !== T3.file || S.result.value) await S.loadSample(T3.file, null);
      const what = CUSTOM_WHAT.findIndex((x) => x.id === T3.custom.what);
      S.custom.value = { what, amt: T3.custom.amt, where: T3.custom.where }; S.customOpen.value = true; S.customFresh.value = true;
      setTimeout(() => { const b = document.getElementById('builder'); b && b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60);
    } },
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
export function exitTour() { token++; const wasOn = S.tour.value != null; S.tour.value = null; if (wasOn) restore(); else S.play(false); }
