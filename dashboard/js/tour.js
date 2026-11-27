// The product tour: every feature, shown on the real controls. Each stop first calms the screen, drives the app to the
// state it talks about, then lights that part up. So any stop can be reached from any other, and every number is live.
import { SCENARIOS } from './scenarios.js';
import { still } from './stage.js';

const $ = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);
const wait = (ms) => new Promise((r) => setTimeout(r, still() ? 0 : ms));

export function createTour(app) {
  const S = app.S, card = $('sTour'), spot = $('sSpot');
  let at = -1, token = 0, frame = 0;

  /** No playback, drawing, search or open place; the right tab; nothing folded open. */
  function calm(tab = 'ask') {
    app.play(false); app.setDraw(false); if (app.stage.isSpreading()) app.stage.spread();
    if (tab !== 'influence') app.influence.halt(); // between the two Influence stops the search keeps running
    if (app.explore.isOpen()) { app.explore.close(false); app.map.home(); }
    if (S.tab !== tab) app.setTab(tab);
    if (tab === 'ask' && S.group !== 'everyday') app.showGroup('everyday');
    for (const d of document.querySelectorAll('#story details')) d.open = false;
  }
  /** What the map shows: a layer ('land' or a variable), a forecast ('normal', 'diff', 'whatif', 'split') and a day. */
  function show(layer, mode, day) { S.layer = layer; S.mode = S.mv ? mode : 'normal'; app.view(); app.setDay(day); }
  const change = (day = 3) => show(S.focus, 'diff', day);
  /** The scenario most stops use. */
  async function branch() {
    calm();
    if (!S.mv || S.sc?.id !== 'bob' || S.sc.strength !== 1) { await app.runNew(SCENARIOS.find((s) => s.id === 'bob'), { stay: true }); app.play(false); app.map.home(); }
  }
  const city = (name) => app.geo.main.find((c) => c.name === name);
  /** Open a place and wait until it has taken focus, so the tour can take it back. */
  async function open(place) { app.explore.pick(place); await wait(80); }

  // [chapter, title, what to say, what to light up (a selector, 'map' or null), how to get there, 'wide' if not on phones]
  const ALL = [
    ['Forecast', 'A forecast of India you can question', 'Ten days of weather, computed on this computer by our own model. Change something in the air and see who feels it. This tour drives the real app through every feature. Use the chapters to jump.', null,
      () => { calm(); app.clear(); app.map.home(); show('land', 'normal', 1); }],
    ['Forecast', 'Pick the day to start from', 'Five starting days, from the monsoon onset to Cyclone Amphan. The model reads three days of weather and forecasts the next ten, live.', '#step1 .s-inline',
      () => { calm(); }],
    ['Forecast', 'The map is the forecast', 'Satellite shows the forecast’s wind, rain and cloud moving over real terrain. Drag to move, scroll to zoom, right-drag to tilt and turn, double-click to dive in.', 'map',
      () => { calm(); app.map.home(); show('land', 'normal', 2); }],
    ['Forecast', 'Colour it by one measure', 'Temperature, rainfall, wind, humidity or pressure. The key above the buttons gives the units.', '#sDock',
      () => { calm(); show('0', 'normal', 3); }],
    ['Forecast', 'Move through the ten days', 'The arrows step one day back or forward. Click any day number, drag the line, or press Play to run all ten. The date sits under the day.', '#sTransport',
      () => { calm(); show('land', 'normal', 1); app.play(true); }],
    ['Forecast', 'Every place answers', 'Click any city, town or state. The report says how the day would feel in two plain sentences, then gives the measured values.', '#placeCard',
      async () => { calm(); show('0', 'normal', 3); await open(city('Chennai')); }],
    ['Forecast', 'Read it day by day', 'Step to the day before or after without leaving the report. The words, values, charts and map all follow.', '.s-dayline',
      async () => { calm(); show('0', 'normal', 3); await open(city('Chennai')); await wait(900); app.setDay(4); }],
    ['Forecast', 'Find any place by name', 'About 7,100 places. Old names such as Bombay or Madras work. Press / to jump here from anywhere.', '.s-findbox',
      () => { calm(); app.map.home(); }],

    ['What if', 'Ask what if', 'Changes written in plain words. We pick the first: warmer, wetter air over the Bay of Bengal. The model runs again with that change.', '#step2',
      async () => { await branch(); change(2); q('#sSteps').scrollTop = 0; }],
    ['What if', 'The question on the map', 'The change is written as the question the map answers. The dashed box marks exactly where it was made.', '.s-cap',
      async () => { await branch(); change(2); }],
    ['What if', 'Only the difference is coloured', 'The forecast with your change minus the forecast without it, in three steps: Low, Medium, High. The pale line surrounds everywhere that has reached Low so far.', '#sLegend',
      async () => { await branch(); change(4); }],
    ['What if', 'The timeline forks', 'Prime, without the change, runs straight on. The Multiverse leaves it and rises with the number of cities outside the box that feel it. Solid days are firm, dashed rough, dotted direction only.', '.s-fork',
      async () => { await branch(); change(1); app.play(true); }],
    ['What if', 'Change, Prime or Multiverse', 'Change shows the difference. Prime and Multiverse show each forecast on its own, in the same colours.', '#segMode',
      async () => { await branch(); show(S.focus, 'whatif', 4); }],
    ['What if', 'Compare both on one map', 'Without your change on the left, with it on the right. Drag the divider across any part of the map.', 'map',
      async (id) => {
        await branch(); if (!app.map.glCanvas) return change(4);
        show('1', 'split', Math.max(2, app.stage.impactPeak()));
        for (let k = 0; k <= 36 && id === token; k++) { app.stage.setSplit(0.18 + 0.4 * (0.5 - 0.5 * Math.cos((k / 36) * Math.PI))); await wait(40); }
      }],
    ['What if', 'Watch it spread', 'The change grows outward from day 0. The dashed line is the furthest it can possibly reach, about 900 km a day. Nothing ever appears beyond it.', 'map',
      async () => { await branch(); change(1); app.map.home(); app.stage.spread(); }],
    ['What if', 'Stronger or weaker', 'Run the same change from a quarter to three times as strong. The app warns when it leaves the believable range. Remove change returns to Prime.', '#strength',
      async () => { await branch(); change(3); }],
    ['What if', 'Extreme events', 'A heatwave, a dry spell, a downpour and a storm off Chennai, each as a starting push the model carries forward.', '#step2',
      async () => { await branch(); app.showGroup('extreme'); q('#sSteps').scrollTop = 0; }],

    ['Who feels it', 'The answer in one sentence', 'It names only places outside the changed box that the forecast can still speak about, with size, day and certainty. Each name is a button.', '#hdMain',
      async () => { await branch(); change(Math.max(2, app.stage.impactPeak())); }],
    ['Who feels it', 'Every city, ranked', 'Ordered by watch level, each with a ten-day strip and how firm it is. Switch to States, open any row, or show them all.', '#whoList',
      async () => { await branch(); change(Math.max(2, app.stage.impactPeak())); }],
    ['Who feels it', 'What the change does to one place', 'Open a place under a change and the report adds how far it moves from the unchanged forecast, and asks why.', '#placeCard',
      async () => { await branch(); const top = app.places.topAway(); app.places.select(top.id); await wait(80); }],
    ['Who feels it', 'Farming, heat and wind power', 'Ten-day rain by state for the monsoon crop, unusually hot days, and the output of the six windiest states. Computed from the two forecasts.', '#sectors',
      async () => { await branch(); change(3); }],
    ['Who feels it', 'Why here?', 'Each part of the change is run alone, live: here the warming and the added moisture, so you can see which one drives a place.', '#causeBlock',
      async () => { await branch(); change(3); app.causes.explain(app.places.topAway()); await wait(1500); }],
    ['Who feels it', 'How to read it', 'The limits behind Low, Medium and High, what the three line styles mean, and why these are not weather warnings.', '.s-how',
      async () => { await branch(); change(3); q('.s-how').open = true; }],

    ['Build your own', 'Mix any change', 'Combine temperature, humidity, wind, pressure and start-day rain over a named area or one you draw. Apply runs it.', '#mix',
      async () => { await branch(); app.openMix(S.sc); }],
    ['Build your own', 'Draw the area', 'Press Draw, here or on the map toolbar, and drag a rectangle. One drag ends drawing. Esc or a click anywhere else stops it too.', 'map',
      async () => { await branch(); app.map.home(); app.setDraw(true); }],

    ['Influence', 'Ask it backwards', 'Which areas move a place’s rain when warmed? The model runs once for each of 72 areas and the map fills in as it goes.', '#pane-influence .s-step',
      () => { calm('influence'); app.influence.start(); }],
    ['Influence', 'Use what you find', 'The strongest areas come first. Choose one and turn it into a scenario with one button.', '#infResults',
      async () => { calm('influence'); app.influence.start(); for (let k = 0; k < 40 && $('infResults').hidden; k++) await new Promise((r) => setTimeout(r, 250)); }],

    ['Proof', 'Can you trust it?', 'Error on days 1, 4 and 8 compared with two simple guesses, how long a forecast takes on this computer, and how many requests went online.', '.s-skill',
      () => { calm('test'); }],
    ['Proof', 'Checked in front of you', 'These run now: a zero change gives an identical forecast, the output stays physical, and the change starts where it was made.', '#pane-test .s-step:nth-child(2)',
      async () => { await branch(); calm('test'); if (!app.judge.ran()) app.judge.check(); }],
    ['Proof', 'Bring your own test', 'Try a random scenario nobody prepared, or paste your own change as JSON and have it run and checked.', '#pane-test .s-step:last-child',
      () => { calm('test'); q('#pane-test details').open = true; }],

    ['Tools', 'The map toolbar', 'Zoom in and out, reset the view, switch between 2D and 3D, draw an area, stop the weather motion, and hide the panel to present. Hover a button for its name.', '.s-mapctl',
      () => { calm(); app.map.home(); }, 'wide'],
    ['Tools', 'Expert view', 'Three maps side by side, the size of the change by day, any square’s time series, farm-stress and wind tables, and a shock painter.', '#btnExpert',
      () => { calm(); }, 'wide'],
    ['Tools', 'That is the product', 'How the model is built, trained and tested, and where it fails, is on the How it works screen. It has its own walkthrough.', '#btnTech',
      () => { calm(); app.map.home(); }],
  ];
  const CHAPTERS = [...new Set(ALL.map((s) => s[0]))];
  let STEPS = ALL;
  $('tourChapters').innerHTML = CHAPTERS.map((c) => `<button type="button" data-chapter="${c}">${c}</button>`).join('');

  /** The part of the screen a stop talks about, or null. */
  function rectOf(target) {
    if (!target) return null;
    if (target === 'map') {
      const m = $('sMapWrap').getBoundingClientRect(), wide = matchMedia('(min-width: 981px)').matches;
      if (!wide) return m;
      const side = document.querySelector('.s-side').getBoundingClientRect(), dock = $('sDock').getBoundingClientRect();
      return new DOMRect(m.left + 10, m.top + 100, Math.min(m.right, side.left) - m.left - 70, dock.top - m.top - 60);
    }
    const el = q(target), r = el?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    // inside the scrolling panel only the part that shows is lit
    const box = el.closest('.s-steps')?.getBoundingClientRect(); if (!box || matchMedia('(max-width: 980px)').matches) return r;
    const top = Math.max(r.top, box.top), bottom = Math.min(r.bottom, box.bottom);
    return bottom > top ? new DOMRect(r.left, top, r.width, bottom - top) : null;
  }
  /** Bring a part of the panel (or, on a phone, of the page) into view. */
  function reveal(target) {
    if (!target) return;
    const el = target === 'map' ? $('sMapWrap') : q(target); if (!el) return;
    if (matchMedia('(max-width: 980px)').matches) return el.scrollIntoView({ block: 'start', behavior: 'instant' });
    const box = el.closest('.s-steps'); if (box) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - 14, behavior: 'instant' });
  }
  const set = (el, s) => { for (const k in s) if (el.style[k] !== s[k]) el.style[k] = s[k]; };
  /** Keep the light on its target and the card beside it, wherever they move. */
  function follow() {
    if (at < 0) return;
    const vw = innerWidth, vh = innerHeight, cw = card.offsetWidth, ch = card.offsetHeight, r = rectOf(STEPS[at][3]);
    let x = (vw - cw) / 2, y = (vh - ch) / 2;
    if (!r) set(spot, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px', borderColor: 'transparent' });
    else {
      const l = Math.max(2, r.left - 6), t = Math.max(2, r.top - 6), right = Math.min(vw - 2, r.right + 6), b = Math.min(vh - 2, r.bottom + 6);
      set(spot, { left: `${Math.round(l)}px`, top: `${Math.round(t)}px`, width: `${Math.round(Math.max(0, right - l))}px`, height: `${Math.round(Math.max(0, b - t))}px`, borderColor: '' });
      const gap = 14, fits = [[l - cw - gap, t], [right + gap, t], [l, b + gap], [l, t - ch - gap]].find(([a, c], i) => (i < 2 ? a >= 8 && a + cw <= vw - 8 : c >= 8 && c + ch <= vh - 8));
      [x, y] = fits || [l + 18, t + 18]; // a large target: the card sits inside its corner
    }
    if (!matchMedia('(max-width: 700px)').matches) set(card, { left: `${Math.round(Math.max(8, Math.min(vw - cw - 8, x)))}px`, top: `${Math.round(Math.max(8, Math.min(vh - ch - 8, y)))}px` });
    else set(card, { left: '', top: '' }); // phones: the card rests at the bottom (css)
    frame = requestAnimationFrame(follow);
  }

  async function step(n) {
    if (n >= STEPS.length) return end();
    at = Math.max(0, n); const id = ++token, [chapter, title, text, target, go] = STEPS[at];
    $('tourCount').textContent = `${at + 1} of ${STEPS.length}`; $('tourTitle').textContent = title; $('tourText').textContent = text;
    for (const b of $('tourChapters').children) { if (b.dataset.chapter === chapter) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); }
    const next = card.querySelector('[data-act=next]'), back = card.querySelector('[data-act=back]'), last = at === STEPS.length - 1;
    next.textContent = last ? 'Finish' : 'Next'; back.disabled = at === 0; card.querySelector('[data-act=tech]').hidden = !last;
    card.hidden = spot.hidden = false; card.classList.add('busy'); card.dataset.step = at + 1;
    cancelAnimationFrame(frame); follow(); card.focus({ preventScroll: true });
    try { await go(id); } catch (e) { console.warn('tour stop failed:', e.message); }
    if (id !== token) return;
    reveal(target); card.classList.remove('busy'); next.focus({ preventScroll: true });
  }
  function end() {
    if (at < 0) return;
    token++; at = -1; card.hidden = spot.hidden = true; $('story').classList.remove('touring'); cancelAnimationFrame(frame);
    app.play(false); app.setDraw(false); app.influence.halt();
  }

  card.addEventListener('click', (e) => {
    const chapter = e.target.closest('[data-chapter]')?.dataset.chapter; if (chapter) return step(STEPS.findIndex((s) => s[0] === chapter));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next') step(at + 1); else if (act === 'back') step(at - 1); else if (act === 'end') end(); else if (act === 'tech') { end(); app.openTech('walk'); }
  });
  window.addEventListener('keydown', (e) => {
    if (at < 0 || S.drawing) return; // Esc ends drawing first
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (card.contains(e.target) && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); step(at + (e.key === 'ArrowRight' ? 1 : -1)); }
  }, true);

  return {
    start() {
      if (!S.prime) return app.banner('The tour runs the model. Start it with: python serve.py');
      const phone = matchMedia('(max-width: 700px)').matches;
      STEPS = ALL.filter((s) => !(phone && s[5] === 'wide'));
      document.body.classList.remove('panel-hidden'); $('story').classList.add('touring'); step(0); // touring: room to scroll anything clear of the card
    },
    end,
  };
}
