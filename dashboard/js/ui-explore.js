// Exploring the map: hover read-out, click-to-fly place card with the 10-day picture, and "find a place".
import { NLON, rIdx, stepsOf } from './util.js';
import { cellBounds } from './geo.js';
import { search, label } from './places.js';
import { timeline, trust, huge, changeWord, KINDS, LEVELS } from './insights.js';
import { summary, badge } from './ui-places.js';
import { sgn } from './scenarios.js';
import { smooth } from './stage.js';
import { feels } from './felt.js';

const $ = (id) => document.getElementById(id);
export const MEASURES = [
  { id: 'temp', label: 'Temperature', unit: '°C', digits: 1, f: (r, d, k) => r[rIdx(d, 0) + k] - 273.15 },
  { id: 'rain', label: 'Rain', unit: 'mm/day', digits: 1, f: (r, d, k) => r[rIdx(d, 1) + k] },
  { id: 'wind', label: 'Wind', unit: 'km/h', digits: 1, f: (r, d, k) => Math.hypot(r[rIdx(d, 2) + k], r[rIdx(d, 3) + k]) * 3.6 },
  { id: 'vapour', label: 'Water vapour', unit: 'kg/m²', digits: 0, f: (r, d, k) => r[rIdx(d, 5) + k] },
  { id: 'pressure', label: 'Pressure', unit: 'hPa', digits: 0, f: (r, d, k) => r[rIdx(d, 4) + k] / 100 },
];
/** Area average over a place's grid cells on one day. */
export function value(roll, d, cells, m) { let s = 0, w = 0; for (const [k, f] of cells) { const q = f * Math.cos(((6.5 + ((k / NLON) | 0)) * Math.PI) / 180); s += q * m.f(roll, d, k); w += q; } return s / w; }

/** Two lines over ten days (normal solid, what-if dashed) as inline SVG; each day is clickable. */
function chart(normal, changed, day) {
  const all = [...normal, ...(changed || [])], lo = Math.min(...all), hi = Math.max(...all), span = Math.max(hi - lo, 0.5), n = normal.length;
  const x = (i) => 6 + (i * 268) / (n - 1), y = (v) => 44 - ((v - lo - (hi - lo - span) / 2) / span) * 38;
  const line = (a) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 280 62" role="img" aria-label="Day 1 to ${n}: ${normal.map((v) => v.toFixed(1)).join(', ')}"><path class="fill" d="${line(normal)}L${x(n - 1)} 50L${x(0)} 50Z"/><path class="normal" d="${line(normal)}"/>${changed ? `<path class="changed" d="${line(changed)}"/>` : ''}<line x1="${x(day)}" x2="${x(day)}" y1="2" y2="48"/><circle cx="${x(day)}" cy="${y((changed || normal)[day])}" r="3.6"/>${normal.map((_, i) => `<rect data-day="${i + 1}" x="${x(i) - 15}" y="0" width="30" height="50"><title>Day ${i + 1}</title></rect>`).join('')}${[1, 4, 7, 10].map((d) => `<text x="${x(d - 1)}" y="60" text-anchor="middle">day ${d}</text>`).join('')}</svg>`;
}

export function createExplorer(app, places) {
  const S = app.S, card = $('placeCard'), tip = $('sTip'), pane = card.parentElement;
  let open = null, hovered = null, drawn = null; // which place the card last drew, so its charts animate only once

  const watch = (p) => (S.mv ? timeline(S.prime, S.mv, p.cells) : null);
  const chip = (t) => (t ? `<span class="s-lvl l${t.level}">${t.level ? `${LEVELS[t.level]} watch` : 'Near normal'}</span>` : '');
  function readings(p, roll, ids) {
    const d = S.day - 1;
    return MEASURES.filter((m) => ids.includes(m.id)).map((m) => {
      const now = value(roll, d, p.cells, m), delta = S.mv ? now - value(S.prime, d, p.cells, m) : 0, show = S.mv && Math.abs(delta) >= (m.digits ? 0.05 : 0.5);
      return `<div class="m-${m.id}"><dt>${m.label}</dt><dd><b>${now.toFixed(m.digits)}</b> ${m.unit}${show ? `<em class="${delta > 0 ? 'up' : 'down'}">${sgn(delta, Math.abs(delta) >= 10 ? 0 : 1)}</em>` : ''}</dd></div>`;
    }).join('');
  }
  const shown = () => (S.mv && S.mode !== 'normal' ? S.mv : S.prime); // the forecast the map is showing
  /** The five values at a place on one day, as the feel-in-words rules read them. */
  const day = (roll, d, cells) => Object.fromEntries(MEASURES.map((m) => [m.id, value(roll, d, cells, m)]));
  /** A card about a place always reports the changed forecast when there is one, unless the map shows Prime. */
  function story(p) {
    const d = S.day - 1, roll = shown(), changed = !!S.mv && roll === S.mv;
    const [air, sky] = feels(day(roll, d, p.cells), changed ? day(S.prime, d, p.cells) : null);
    const date = app.dateOf(S.day);
    const arrow = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    return `<div class="s-dayline" role="group" aria-label="Report day">
        <button type="button" data-step="-1" data-tip="Previous day" aria-label="Previous day" aria-disabled="${S.day <= 1}">${arrow('M15 5l-7 7 7 7')}</button>
        <p aria-live="polite"><b>Day ${S.day}${date ? `, ${date}` : ''}</b><small>${S.mv ? (changed ? 'with your change' : 'without your change') : 'as forecast'}</small></p>
        <button type="button" data-step="1" data-tip="Next day" aria-label="Next day" aria-disabled="${S.day >= 10}">${arrow('M9 5l7 7-7 7')}</button></div>
      <div class="s-feels"><p>${air}</p><p>${sky}</p></div>
      <dl class="now">${readings(p, roll, ['temp', 'rain', 'wind', 'vapour', 'pressure'])}</dl>`;
  }

  function hover(p, ev) {
    hovered = p;
    if (!p || app.canDraw()) { tip.hidden = true; return; }
    const roll = shown(), t = watch(p);
    tip.innerHTML = `<h4>${p.name}</h4><p>${p.sub}</p>${roll ? `<dl>${readings(p, roll, ['temp', 'rain', 'wind', 'vapour'])}</dl>${chip(t)}` : '<p>Waiting for the forecast.</p>'}`;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = (ev.clientX + 18 + w > innerWidth ? ev.clientX - w - 18 : ev.clientX + 18) + 'px';
    tip.style.top = Math.max(8, Math.min(innerHeight - h - 8, ev.clientY - 20)) + 'px';
  }

  /** The headline figure for an open place: the size of its biggest change, in its own units. */
  function peak(t) {
    if (!t?.level) return '';
    const s = t.series[t.kind], d = t.peak - 1, up = t.delta >= 0, cls = t.kind === 'rain' ? (up ? 'wetter' : 'drier') : up ? 'up' : 'down';
    return `<div class="s-peak ${cls}"><b>${sgn(t.delta, Math.abs(t.delta) >= 10 ? 0 : 1)}<small>\u00a0${KINDS[t.kind].unit}</small></b><span>${changeWord(t.kind, t.delta)} on day ${t.peak}: ${s.m[d].toFixed(1)}, where Prime has ${s.p[d].toFixed(1)}</span></div>`;
  }
  function render() {
    card.hidden = !open || S.tab !== 'ask';
    pane.classList.toggle('placing', !card.hidden);
    if (card.hidden) return;
    const p = open, roll = S.prime, t = watch(p);
    card.classList.toggle('fresh', drawn !== p); drawn = p;
    const twins = p.kind === 'city' ? places.cities.filter((c) => c !== p && c.cells[0][0] === p.cells[0][0]).map((c) => c.name) : [];
    const shared = twins.length > 3 ? `${twins.slice(0, 2).join(', ')} and ${twins.length - 2} other places` : twins.join(' and ');
    const order = [...MEASURES.slice(0, 3)].sort((a, b) => (b.id === t?.kind) - (a.id === t?.kind)); // the quantity that changes most comes first
    const charts = roll ? order.map((m) => {
      const n = Array.from({ length: stepsOf(roll) }, (_, d) => value(roll, d, p.cells, m)), c = S.mv ? Array.from({ length: n.length }, (_, d) => value(S.mv, d, p.cells, m)) : null;
      return `<figure class="m-${m.id}"><figcaption>${m.label}<span>${(c || n)[S.day - 1].toFixed(1)} ${m.unit}</span></figcaption>${chart(n, c, S.day - 1)}</figure>`;
    }).join('') : '';
    const multi = S.mv && !$('causeBlock').hidden && !$('causeRun').hidden;
    const held = card.contains(document.activeElement) ? document.activeElement.dataset.step : undefined;
    $('pcBody').innerHTML = `<p class="where">${p.sub}</p><h3 tabindex="-1">${p.name}</h3>
      ${roll ? story(p) : '<p class="key">Waiting for the forecast.</p>'}
      ${t ? `<h4>What your change does here</h4>${peak(t)}<p class="watch">${chip(t)}${t.level ? ` <span>${summary(t)}</span>${badge(trust(t.peak, app.beyond() || huge(t)))}` : ''}</p>` : ''}
      <div class="s-runrow">${multi ? '<button type="button" class="s-btn small primary" data-act="why">Why here?</button>' : ''}<button type="button" class="s-btn small" data-act="search">What influences it?</button></div>
      ${roll ? `<h4>Ten days</h4><p class="key">${S.mv ? 'Grey line: without your change. Coloured line: with it. Click a day.' : 'Click a day.'}</p>${charts}` : ''}
      <p class="key">The words describe the day's average over a square about 110 km wide${twins.length ? `, shared with ${shared}` : ''}; afternoons run warmer.${p.kind === 'city' && !document.body.classList.contains('flat-map') ? ' Map buildings are illustrative.' : ''}</p>`;
    if (held !== undefined) card.querySelector(`[data-step="${held}"]`)?.focus({ preventScroll: true });
  }

  /** The same place as the analysis tabs know it (grouped small states share one entry there). */
  const analysed = (p) => (p.kind === 'city' || !p.group || ['UT', 'ISL'].includes(p.group) ? p : { ...p, id: 's:' + p.group });

  function watchInSearch(p) {
    app.influence.watch(analysed(p)); app.map.flyToPlace(p); setTimeout(() => app.map.topView(), 1800);
  }
  function pick(p) {
    tip.hidden = true;
    if (S.tab === 'influence') return app.influence.watch(analysed(p));
    if (S.tab !== 'ask') app.setTab('ask');
    open = p; app.map.setFocus(p); render(); app.map.flyToPlace(p); app.fork?.render();
    setTimeout(() => { card.scrollIntoView({ block: 'start', behavior: smooth() }); card.querySelector('h3')?.focus({ preventScroll: true }); });
  }
  function close(fly = true) {
    if (!open) return;
    const back = card.contains(document.activeElement) ? open.name : null; // keyboard users return to the row they came from
    open = drawn = null; app.map.setFocus(null); render(); app.places?.deselect(); app.stage.refreshPins(); app.fork?.render(); $('sSteps').scrollTo({ top: 0 }); if (fly) app.map.home();
    if (back) [...document.querySelectorAll('#whoList button[data-id] b')].find((b) => b.firstChild.textContent === back)?.closest('button').focus({ preventScroll: true });
  }

  card.onclick = (e) => {
    const picked = e.target.closest('[data-day]'); if (picked) return app.setDay(+picked.dataset.day);
    const step = e.target.closest('[data-step]'); if (step) return app.setDay(S.day + +step.dataset.step);
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    const p = open;
    if (act === 'close') close();
    else if (act === 'why') { close(false); app.setTab('ask'); app.causes.explain(analysed(p)); } // the explanation sits under the list the place sheet covers
    else { app.setTab('influence'); watchInSearch(p); }
  };
  $('pcClose').onclick = () => close();
  // suggestions are filled as you type: there are thousands of places
  const suggest = () => { $('findMsg').textContent = ''; $('sPlaces').innerHTML = search(places, $('sFind').value).map((p) => `<option value="${label(p)}">`).join(''); };
  let clearMsg = 0;
  const find = () => {
    const q = $('sFind').value.trim(); if (!q) return;
    const p = search(places, q, 1)[0];
    if (!p) { $('findMsg').textContent = `No place called “${q}”.`; clearTimeout(clearMsg); return (clearMsg = setTimeout(() => ($('findMsg').textContent = ''), 3200)); }
    $('sFind').value = ''; $('findMsg').textContent = ''; $('sFind').blur(); pick(p); if (S.tab === 'influence') app.map.setFocus(p);
  };
  $('sFind').oninput = suggest; $('sFind').onchange = find; $('sFind').onkeydown = (e) => { if (e.key === 'Enter') find(); };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('sTour').hidden) close(); }); // one layer per press: the tour goes first

  return {
    hover, pick, close, render,
    /** From a list row or pin ('c:Name' or 's:GROUP'): fly there and open its card. */
    focusId(id) {
      if (id.startsWith('c:')) return pick(places.cities.find((c) => c.id === id));
      const parts = places.states.filter((s) => s.group === id.slice(2)); if (!parts.length) return;
      if (parts.length === 1) return pick(parts[0]);
      const meta = S.assets.grid.meta[id.slice(2)], cells = S.assets.grid.cells[id.slice(2)], b = cellBounds(cells);
      pick({ id, kind: 'state', name: meta.name, group: id.slice(2), sub: 'Group of states', cells, bounds: b, lon: (b.lo0 + b.lo1) / 2, lat: (b.la0 + b.la1) / 2 });
    },
    isOpen: () => !!open, hovered: () => hovered,
    /** The open place with its watch timeline, for the forking timeline. */
    openPlace: () => (open && S.tab === 'ask' ? { name: open.name, t: watch(open) } : null),
  };
}
