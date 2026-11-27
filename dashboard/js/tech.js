// "How it works": the one place for the technical story, with its own walkthrough. Every fact here comes from the
// repository (README.md, TRAINING.md, monsoon/model.py, training/); the live figures come from the running server.
const $ = (id) => document.getElementById(id);

const table = (head, rows, cls = '') => `<div class="tk-scroll"><table class="${cls}"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
const flow = (steps) => `<ol class="tk-flow">${steps.map(([a, b]) => `<li><b>${a}</b><span>${b}</span></li>`).join('')}</ol>`;
const metric = (value, name, meaning, how) => `<article class="tk-metric"><p class="v">${value}</p><h4>${name}</h4><p>${meaning}</p><p class="how">${how}</p></article>`;
// skill bars: [day, vs the better reference, vs "tomorrow = today"]
const SKILL = [[1, 0.32, 0.34], [4, 0.07, 0.26], [8, -0.01, 0.24]];
const bars = () => `<figure class="tk-bars" aria-label="Skill by forecast day">${SKILL.map(([d, best, pers]) => `<div><p>Day ${d}</p>
  ${[['vs the better reference', best, 'a'], ['vs “tomorrow = today”', pers, 'b']].map(([label, v, c]) => `<span class="bar ${c}${v < 0 ? ' neg' : ''}" title="${label}"><i style="width:${Math.max(0.6, (Math.abs(v) / 0.34) * 100)}%"></i><b>${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}</b></span>`).join('')}</div>`).join('')}
  <figcaption><span class="a">Against the better of the two references (the strict reading)</span><span class="b">Against persistence, “tomorrow = today”</span></figcaption></figure>`;

// [id, name in the side list, heading, what to say in the walkthrough, body]
const SECTIONS = [
  ['thinking', 'Our thinking', 'What the problem asks, and what we decided',
    'We started from the properties a judge can test, and let each one force a design decision.',
    `<p class="lead">The track asks for a digital twin of India’s weather that runs offline, forecasts the next days and responds to a change someone injects. Accuracy alone is not enough: the response has to behave like weather.</p>
    ${table(['What must be true', 'What we decided', 'Why'], [
      ['A change spreads; it does not jump across the country', 'Only local operations: one 3×3 convolution in each of 8 blocks', 'Reach is capped by construction, not by hope'],
      ['The same input gives the same output', 'No randomness at inference, deterministic kernels', 'A zero change returns a bit-identical forecast, so every difference is caused by the change'],
      ['No lookup tables, no stored weather', 'A smooth seasonal climatology inside the weights; the network learns departures from it', 'It learns weather, not the calendar'],
      ['It beats “tomorrow = today” and the seasonal average', 'The training loss is divided by the error of the better of those two', 'We optimise exactly what is scored'],
      ['It runs on a plain CPU with no network', 'Three small networks, one weights file of about 18 MB', 'About 0.6 s for ten days on 4 cores'],
      ['Users know how far to trust it', 'Per-day calibration, certainty labels, published limits', 'A confident wrong answer is worse than a modest one'],
    ], 'wide')}
    <h3>What we tried and changed our mind about</h3>
    ${table(['Idea', 'What happened', 'What we shipped'], [
      ['Training on 8 and 10 day rollouts', 'Fitted the training years better, scored worse on held-out years', 'Stop after the 4-day stage'],
      ['A multi-scale U-Net, which sees further', 'Its wider reach lets a change appear far away in one day', 'The local network; the U-Net stays in the code for comparison'],
      ['Shrinking rain toward average, like the other variables', 'Heavy rain disappeared from the forecast', 'Rain is left unscaled'],
      ['One network', 'Shock sizes varied about 3× between training runs', 'The average of 3 seeds: +4 to +8 of 70 points (strict) over the best single copy'],
    ], 'wide')}`],

  ['data', 'Data and inputs', 'What goes in',
    'Three days of six surface variables, turned into departures from a smooth seasonal climate.',
    `<p class="lead">A 32 × 36 grid of 1° squares (6–38°N, 65–101°E), one value per day. Trained only on the organiser-provided file for 2005–2021. Nothing is downloaded when it runs.</p>
    ${table(['Variable', 'Unit', 'Handling'], [
      ['2 m temperature', 'K', 'Kept between 233 and 333 K on output'], ['Rain', 'mm/day', 'Learned as log(1 + rain); never negative'],
      ['Wind, eastward', 'm/s at 10 m', 'As anomaly'], ['Wind, northward', 'm/s at 10 m', 'As anomaly'],
      ['Sea-level pressure', 'Pa', 'As anomaly'], ['Water vapour in the column', 'kg/m²', 'Never negative on output'],
    ])}
    <h3>From raw weather to network input</h3>
    ${flow([
      ['Seasonal climate', '3 Fourier harmonics per square and variable, fitted by least squares on the training years and stored in the weights'],
      ['Anomaly', 'Each of the last 3 days minus the climate for that day, divided by its usual spread'],
      ['Context', 'The season at the target day, land–sea mask, terrain height, day of year, latitude and longitude'],
      ['30 input channels', '18 from three days of six variables, 6 seasonal, 2 terrain, 2 calendar, 2 position'],
    ])}`],

  ['model', 'Architecture', 'The network',
    'Three small convolutional networks step the weather one day at a time; their outputs are averaged.',
    `<p class="lead">The model predicts how tomorrow differs from today, then feeds its own answer back to reach day 10.</p>
    <div class="tk-loop" role="img" aria-label="Three days go into three networks; their average is the next day, which is fed back in, ten times.">
      <div class="col"><span>day t−2</span><span>day t−1</span><span>day t</span></div><i aria-hidden="true"></i>
      <div class="col"><span class="net">network, seed 0</span><span class="net">network, seed 1</span><span class="net">network, seed 2</span></div><i aria-hidden="true"></i>
      <div class="col"><span class="out">average: day t+1</span></div>
      <p>The window slides forward one day and repeats, ten times for a ten-day forecast.</p></div>
    <h3>Inside one network, about 1.5 million parameters</h3>
    ${flow([
      ['Stem', '1×1 convolution, 30 channels to 96. Mixes variables, not places'],
      ['8 residual blocks', 'Normalise each square on its own, one 3×3 convolution (96 to 192), GELU, 1×1 back to 96'],
      ['Head', '1×1 convolution to 6 values: the one-day change in each variable. Starts at zero, so training begins from “no change”'],
      ['Add', 'That change is added to today’s anomaly. The identity path keeps fine detail and starts a shock’s response where it was applied'],
    ])}
    <p>There is no attention, no Fourier layer and no map-wide statistic, so nothing can carry a signal across the grid in one step.</p>`],

  ['reach', 'Reach limit', 'How far a change can travel',
    'Eight blocks with one 3 by 3 convolution each: a change moves at most 8 squares a day, by construction.',
    `<p class="lead">Each 3×3 convolution passes information one square further. Eight of them per day give a hard limit of 8 squares, about 900 km north–south or east–west and up to about 1,250 km diagonally.</p>
    <div class="tk-reach"><div class="tk-seg" role="group" aria-label="Days after the change">${[0, 1, 2, 3].map((d) => `<button type="button" data-reach="${d}">${d ? `Day ${d}` : 'The change'}</button>`).join('')}</div>
      <svg id="tkGrid" viewBox="0 0 360 320" role="img"></svg><p id="tkReachText" aria-live="polite"></p></div>
    <p>In tests the response outside this limit is exactly zero. On day 1 at least 99 % of it lies within 3 squares of the changed box. Real pressure signals can travel faster: that is a price of this design.</p>`],

  ['training', 'Training', 'How the weights were trained',
    'One-day training first, then the model learns on its own forecasts, then calibration, then three seeds.',
    `<p class="lead">The network first learns one step, then is trained on rollouts of its own forecasts, so it learns to correct its errors instead of piling them up.</p>
    ${table(['Stage', 'Forecast length trained on', 'Epochs', 'Peak learning rate'], [['1', '1 day', '40', '0.001'], ['2', '2 days, gradients through both', '10', '0.0003'], ['3', '4 days, gradients through all four', '10', '0.0002']])}
    <p>150 steps per epoch, batches of 32. AdamW (weight decay 0.05), one-cycle schedule, gradient clipping at 1. The shipped weights are an exponential moving average (0.999) of training.</p>
    <h3>The loss</h3>
    <p class="tk-formula">error² × latitude weight ÷ error² of the better simple reference, for each variable and day</p>
    <ul><li>Days 1 and 4, which are scored, count double.</li><li>Squares where the true rain exceeds 10 mm/day count three times, so heavy rain is not ignored.</li>
      <li>Temperatures are shifted by up to ±0.7 K at random, because 2023–24 is warmer than the training years. A little input noise is added in stage 1.</li></ul>
    <h3>After training</h3>
    ${flow([
      ['Calibrate', 'One gain per day and variable, least squares on the training years, between 0 and 1.2. Long leads lean toward climate only as far as the data supports. Rain is not scaled. The fed-back state is untouched'],
      ['Repeat', 'The same recipe with random seeds 0, 1 and 2. About 45 minutes each on a T4 GPU'],
      ['Pack', 'The three are stored in one file; the server runs them side by side and averages'],
    ])}
    <h3>Reproduce the submitted weights</h3>
    <pre>for s in 0 1 2; do
  python training/train.py --data ../data/india_climate_train.nc --train-end 2021 \\
      --width 96 --depth 8 --stages 1:40,2:10,4:10 --lrs 1e-3,3e-4,2e-4 \\
      --seed $s --out runs/seed$s.pt --device cuda
  python training/calibrate.py --ckpt runs/seed$s.pt \\
      --data ../data/india_climate_train.nc --train-end 2021 --stride 4
done
python training/make_ensemble.py --out weights/emulator.pt runs/seed*.pt</pre>`],

  ['metrics', 'Scores', 'What we measured, and what each number means',
    'Skill on years the test model never saw: clear on day 1, small on day 4, level with climatology on day 8.',
    `<p class="lead">The same recipe was trained on 2005–2018 and tested on 2019–2021. The submitted weights were then retrained on all years, so they cannot be scored on those; the hidden 2023–24 windows are the real test.</p>
    ${bars()}
    <div class="tk-metrics">
      ${metric('+0.32', 'Skill, day 1', '1 − (our error ÷ the error of the better reference). Zero means no better than a simple guess; 1 would be perfect.', '217 windows (every 5th day), 6 variables, latitude-weighted, using the organisers’ scoring functions. Day 4: +0.07. Day 8: −0.01. Pooling all windows first gives +0.36, +0.13, +0.03.')}
      ${metric('0.29', 'Heavy-rain CSI', 'Of all the times heavy rain (over 10 mm/day) was forecast or happened, the share we got right. Persistence scores 0.19, climatology 0.16.', 'Hits ÷ (hits + misses + false alarms), mean over the scored days.')}
      ${metric('0.71–1.00', 'Spatial variety kept on day 8', 'A model that hedges turns the map into a smooth blur and scores near 0. 1 means as varied as real weather. The pass mark is 0.40.', 'Per variable over 217 windows (0.53–1.03 on the 5 named windows; single windows can dip to about 0.3 for rain).')}
      ${metric('Identical', 'Zero-change test', 'Injecting a change of zero returns the same forecast, bit for bit, so differences come only from your change.', 'Checked live on the Proof tab.')}
      ${metric('≥ 99 %', 'Change stays local on day 1', 'Share of the day-1 response inside the changed box or within 3 squares of it.', 'Beyond 8 squares per day it is exactly zero.')}
      ${metric('~0.6 s', 'Ten-day forecast', 'On 4 CPU cores with the network off. Thirty days take about 1.5 s; the server is ready in about 4 s and uses about 0.85 GB.', 'Fresh clone, Python 3.12, only torch, numpy, fastapi and uvicorn.')}
      ${metric('61–67', 'Our local grading, out of 70', 'The automated forecast, blur and causality points on the strict reading; 70 on the lenient one. Single copies: 51–57.', 'Our own copy of the scoring, not an official result.')}
    </div>
    <p>Chosen on the same years they are reported on (rollout length, ensemble size), so these numbers are mildly optimistic.</p>`],

  ['serving', 'Running it', 'Offline, deterministic, on this computer',
    'Two endpoints, weights in the repository, and nothing that touches the internet.',
    `<dl class="tk-live" id="tkLive"></dl>
    ${table(['Endpoint', 'Takes', 'Returns'], [
      ['POST /health', 'nothing', 'status and model name'],
      ['POST /simulate', 'init_states [3, 6, 32, 36], doy_sincos [2], steps, perturbation [6, 32, 36] or null', 'rollout [steps, 6, 32, 36] and inference_ms'],
    ], 'wide')}
    <p>A change is added to the latest input day and the same weights run again. Output guards keep rain and water vapour at zero or above and temperature between 233 and 333 K. Each of the three members runs on one thread with deterministic algorithms.</p>`],

  ['answers', 'From numbers to answers', 'How the product reads a forecast',
    'The forecast comes from the model; the words and labels on top are simple, stated rules.',
    `<p class="lead">Everything below is computed in the browser from two live forecasts: with your change and without it.</p>
    ${table(['On screen', 'The rule'], [
      ['Low, Medium, High', 'Daily difference of at least 1 / 5 / 15 mm of rain, 0.5 / 1.5 / 3 °C, or 3 / 8 / 15 km/h of wind'],
      ['Firm, Rough, Direction only', 'Strongest on days 1–3, days 4–7, or days 8–10, an unusually large change, or one beyond what the model has seen'],
      ['How the day feels', 'Wording chosen from the day’s average temperature, water vapour, rain, wind and pressure. It is not a model output'],
      ['Farm stress', 'Ten-day state rain against the unchanged forecast in IMD-style bands, dry spells, and heat days above the state’s 95th percentile'],
      ['Wind power', '10 m wind scaled to hub height (1/7 power law) through a generic turbine curve, six states'],
      ['Influence', 'One live run for each of 72 areas of 4 × 4 squares'],
      ['Why here?', 'Each part of your change run on its own'],
    ], 'wide')}`],

  ['limits', 'Limits', 'Where it fails',
    'We would rather you hear the weaknesses from us.',
    `<ul class="tk-limits">
      <li><b>Days 8–10 are about as good as the seasonal average.</b> The forecast is deliberately damped there.</li>
      <li><b>Rain is hardest.</b> Heavy-rain cores are often 1–2 squares off. A strong ocean warming can trigger a very large local rain response in about 5 % of changed runs.</li>
      <li><b>Learned statistics, not physics.</b> No water or energy conservation. Across 25 start-day and preset combinations, 7 responses read as physically plausible, 12 were weak or mixed and 6 had an unexpected sign. Strong responses near the box are the most trustworthy; sizes are hypotheses.</li>
      <li><b>Missing drivers.</b> No sea-surface temperature, upper air or inflow at the edges, which are the least reliable. Wind-only changes fade within about 3 days.</li>
      <li><b>Coarse.</b> One value per 110 km square per day; hills and coasts inside it are averaged out.</li>
      <li><b>Extrapolation.</b> A change far beyond 2005–2021 is outside what the model has seen.</li>
      <li><b>Screening tools.</b> Farm, heat and wind figures compare scenarios. They are not advisories or warnings.</li>
    </ul>`],
];

let built = false, walking = -1, back = null;

function build() {
  const root = $('tech');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'tkTitle');
  root.innerHTML = `<header class="tk-head"><h2 id="tkTitle">How it works</h2>
      <button type="button" class="tk-btn primary" data-tk="walk">Start the walkthrough</button><button type="button" class="tk-btn" data-tk="close">Back to the app</button></header>
    <div class="tk-body"><nav class="tk-nav" aria-label="Sections">${SECTIONS.map(([id, name]) => `<button type="button" data-go="${id}">${name}</button>`).join('')}</nav>
      <main class="tk-main" id="tkMain" tabindex="-1">${SECTIONS.map(([id, , title, , body]) => `<section id="tk-${id}" aria-labelledby="tkh-${id}"><h3 id="tkh-${id}" class="tk-title">${title}</h3>${body}</section>`).join('')}</main></div>
    <footer class="tk-walk" id="tkWalk" hidden><p><span id="tkCount"></span><b id="tkSay" aria-live="polite"></b></p>
      <button type="button" class="tk-btn" data-tk="prev">Back</button><button type="button" class="tk-btn primary" data-tk="next">Next</button><button type="button" class="tk-btn" data-tk="stop">Read freely</button></footer>`;
  root.onclick = (e) => {
    const go = e.target.closest('[data-go]')?.dataset.go; if (go) return walking < 0 ? show(go) : walk(SECTIONS.findIndex((s) => s[0] === go));
    const r = e.target.closest('[data-reach]'); if (r) return reach(+r.dataset.reach);
    const act = e.target.closest('[data-tk]')?.dataset.tk;
    if (act === 'close') closeTech(); else if (act === 'walk') walk(0); else if (act === 'next') walk(walking + 1); else if (act === 'prev') walk(walking - 1); else if (act === 'stop') stopWalk();
  };
  $('tkMain').addEventListener('scroll', () => { if (walking >= 0) return; const top = $('tkMain').getBoundingClientRect().top + 120; const cur = [...SECTIONS].reverse().find(([id]) => $(`tk-${id}`).getBoundingClientRect().top <= top); mark((cur || SECTIONS[0])[0]); }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if ($('tech').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return walking >= 0 ? stopWalk() : closeTech(); }
    if (e.key === 'Tab') { // keep the focus on this screen
      const items = [...$('tech').querySelectorAll('button')].filter((b) => b.offsetParent), first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (walking >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); e.stopPropagation(); walk(walking + (e.key === 'ArrowRight' ? 1 : -1)); }
  }, true);
  reach(1); built = true;
}

/** The 32 x 36 grid with a changed box and everything it can have touched after `day` days (8 squares a day). */
function reach(day) {
  const box = { i0: 2, i1: 9, j0: 22, j1: 29 }, r = 8 * day; // the Bay of Bengal box, in squares
  let cells = '';
  for (let i = 0; i < 32; i++) for (let j = 0; j < 36; j++) {
    const inBox = i >= box.i0 && i <= box.i1 && j >= box.j0 && j <= box.j1, d = Math.max(box.i0 - i, i - box.i1, box.j0 - j, j - box.j1, 0);
    cells += `<rect x="${j * 10 + 0.5}" y="${(31 - i) * 10 + 0.5}" width="9" height="9" class="${inBox ? 'box' : d <= r ? `hit d${Math.ceil(d / 8)}` : ''}"/>`;
  }
  $('tkGrid').innerHTML = cells;
  const n = [...$('tkGrid').querySelectorAll('.box,.hit')].length, share = Math.round((n / (32 * 36)) * 100);
  const text = day ? `After day ${day} the change can have reached at most ${r} squares beyond the box: ${share} % of the map.` : 'The changed box: here, the air over the Bay of Bengal.';
  $('tkReachText').textContent = text; $('tkGrid').setAttribute('aria-label', text);
  document.querySelectorAll('[data-reach]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.reach === day));
}

async function live() {
  const S = window.__story; if (!S) return;
  const h = await S.api.health(3000);
  const origin = (() => { try { return new URL(S.api.url).origin; } catch (e) { return ''; } })();
  const away = performance.getEntriesByType('resource').filter((r) => { try { const o = new URL(r.name).origin; return o !== location.origin && o !== origin && !r.name.startsWith('data:'); } catch (e) { return false; } }).length;
  $('tkLive').innerHTML = [['Model running here', h.ok ? h.name : 'not reachable'], ['Last ten-day forecast', S.ms ? `${Math.round(S.ms)} ms` : 'none yet'], ['Requests to the internet', String(away)]]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function mark(id) { for (const b of document.querySelectorAll('.tk-nav button')) { if (b.dataset.go === id) { b.setAttribute('aria-current', 'true'); b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } else b.removeAttribute('aria-current'); } }
function show(id) {
  const main = $('tkMain'), el = $(`tk-${id}`); if (!el) return;
  main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top; mark(id);
}
/** One section at a time, with the sentence to say about it. */
function walk(n) {
  if (n >= SECTIONS.length) return stopWalk();
  walking = Math.max(0, n); const [id, , , say] = SECTIONS[walking];
  $('tech').classList.add('walking'); $('tkWalk').hidden = false;
  for (const [other] of SECTIONS) $(`tk-${other}`).classList.toggle('on', other === id);
  $('tkCount').textContent = `${walking + 1} of ${SECTIONS.length}`; $('tkSay').textContent = say;
  const next = $('tkWalk').querySelector('[data-tk=next]'); next.textContent = walking === SECTIONS.length - 1 ? 'Finish' : 'Next';
  $('tkWalk').querySelector('[data-tk=prev]').disabled = walking === 0;
  $('tkMain').scrollTop = 0; mark(id); next.focus({ preventScroll: true });
}
function stopWalk() {
  const id = SECTIONS[Math.max(0, walking)][0]; walking = -1;
  $('tech').classList.remove('walking'); $('tkWalk').hidden = true; show(id); $('tkMain').focus({ preventScroll: true });
}

/** section: an id to open at, or 'walk' to start the walkthrough. */
export function openTech(section) {
  if (!built) build();
  const root = $('tech'); if (root.hidden) back = document.activeElement;
  root.hidden = false; for (const id of ['story', 'expert']) $(id).inert = true;
  live();
  if (section === 'walk') return walk(0);
  if (walking >= 0) stopWalk();
  show(section || SECTIONS[0][0]); $('tkMain').focus({ preventScroll: true });
}
export function closeTech() {
  walking = -1; $('tech').classList.remove('walking'); $('tkWalk').hidden = true; $('tech').hidden = true;
  for (const id of ['story', 'expert']) $(id).inert = false;
  back?.focus?.({ preventScroll: true });
}
