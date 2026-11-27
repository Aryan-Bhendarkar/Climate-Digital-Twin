// "Places": cities and states ranked by change level, felt elsewhere first (places inside the changed area apart),
// with when, how long and how firm each change is, a 10-day timeline each, mirrored as pins on the map.
import { CITIES } from './cities.js';
import { cellIndex, timeline, rankPlaces, changeWord, insideShare, span, trust, huge, TRUST, KINDS, LEVELS } from './insights.js';
import { nf } from './stage.js';
import { sgn } from './scenarios.js';

const $ = (id) => document.getElementById(id);
const SKIP = new Set(['ISL', 'UT']);
const VAR_OF = { temp: 0, rain: 1, wind: 2 };
const SHOW = 6;

export function allPlaces(S) {
  return {
    cities: CITIES.map((c) => ({ id: 'c:' + c.name, name: c.name, sub: c.state, lat: c.lat, lon: c.lon, cells: [[cellIndex(c.lat, c.lon), 1]] })),
    states: S.assets.grid.order.filter((id) => !SKIP.has(id)).map((id) => ({ id: 's:' + id, name: S.assets.grid.meta[id].name, sub: 'state average', cells: S.assets.grid.cells[id] })),
  };
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const signed = (x) => sgn(x, Math.abs(x) >= 10 ? 0 : 1);
/** When and how long, in words: "Wetter on days 2 to 5, most on day 3 (+6.2 mm/day)". */
export function summary(t) {
  if (!t.level) return 'Near normal';
  const [a, b] = span(t), when = a === b ? `on day ${a}` : `on days ${a} to ${b}`;
  return `${cap(changeWord(t.kind, t.delta))} ${when}${a === b ? '' : `, most on day ${t.peak}`} (${signed(t.delta)} ${KINDS[t.kind].unit})`;
}
export const joinNames = (a) => (a.length === 1 ? a[0] : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
export const badge = (k) => `<em class="s-trust ${k}" title="${TRUST_TIP[k]}">${TRUST[k]}</em>`;
const TRUST_TIP = { firm: 'Strongest on days 1 to 3, where the model beats simple references most clearly', rough: 'Strongest on days 4 to 7: skill is smaller', dir: 'Days 8 to 10, an unusually large change, or one beyond what the model has seen: trust the direction, not the size' };

export function createPlaces(app) {
  const S = app.S;
  let rows = { cities: [], states: [] }, who = 'cities', all = false, selected = null, fresh = false, insideOpen = false;

  function update() {
    selected = null; all = false; fresh = true; insideOpen = false;
    if (!S.mv) { rows = { cities: [], states: [] }; return render(); }
    const p = allPlaces(S);
    for (const key of ['cities', 'states']) rows[key] = rankPlaces(p[key].map((x) => ({ ...x, t: timeline(S.prime, S.mv, x.cells), inside: insideShare(x.cells, S.box) >= 0.5 })));
    render();
  }

  function row(r) {
    const t = r.t, k = t.level ? trust(t.peak, app.beyond() || huge(t)) : '';
    return `<li class="s-place${r.id === selected ? ' on' : ''}${k === 'dir' ? ' faint' : ''}"><button type="button" class="l${t.level}" data-id="${r.id}">
      <span class="s-pname"><b>${r.name}${k ? badge(k) : ''}</b><small>${t.level ? `${LEVELS[t.level]}. ` : ''}${summary(t)}</small></span>
      <span class="s-strip" role="img" aria-label="${t.days.map((x, d) => `day ${d + 1} ${LEVELS[x.level]}`).join(', ')}">${t.days.map((x, d) => `<i class="l${x.level}${d >= 7 ? ' late' : ''}" data-d="${d + 1}" style="--k:${d}"></i>`).join('')}</span></button></li>`;
  }
  function render() {
    const list = rows[who], away = list.filter((r) => !r.inside), inside = list.filter((r) => r.inside && r.t.level);
    const hit = away.filter((r) => r.t.level), shown = all ? away : away.slice(0, Math.min(SHOW, hit.length));
    const count = [3, 2, 1].map((l) => [l, hit.filter((r) => r.t.level === l).length]).filter(([, n]) => n);
    const what = who === 'cities' ? ['city', 'cities'] : ['state', 'states'];
    $('whoSum').innerHTML = !list.length ? '' : (count.length ? count.map(([l, n]) => `<span class="s-lvl l${l}">${n} ${LEVELS[l].toLowerCase()}</span>`).join('') + `<span class="s-rest">${away.length - hit.length} near normal</span>` : `<span class="s-rest">No ${what[0]} beyond the change reaches a level.</span>`);
    $('whoList').classList.toggle('fresh', fresh); fresh = false;
    const head = (text) => `<li class="s-group">${text}</li>`;
    $('whoList').innerHTML = (shown.length ? head('Felt beyond the change') : '') + shown.map(row).join('')
      + (inside.length ? `<li class="s-group s-inside"><button type="button" data-inside aria-expanded="${insideOpen}">Inside the change: ${inside.length === 1 ? inside[0].name : `${joinNames(inside.slice(0, 2).map((r) => r.name).concat(inside.length > 2 ? [`${inside.length - 2} more`] : []))}`}</button></li>` + (insideOpen ? inside.map(row).join('') : '') : '');
    $('whoMore').hidden = away.length <= SHOW && !all; $('whoMore').textContent = all ? 'Show fewer' : `Show all ${away.length}`;
    setDay();
  }
  /** The headline: what is felt beyond the change, by name, size and day. */
  /** Places beyond the change whose strongest day the forecast can still speak about (days 8 to 10 are level with the seasonal average). */
  const told = () => rows.cities.filter((r) => !r.inside && r.t.level && r.t.peak <= 7);
  /** The places the headline names: same kind, direction and confidence, so one badge is true of all of them. */
  function named() {
    const away = told(); if (!away.length) return [];
    const top = away[0], same = (r) => r.t.kind === top.t.kind && Math.sign(r.t.delta) === Math.sign(top.t.delta) && trust(r.t.peak, huge(r.t)) === trust(top.t.peak, huge(top.t));
    return away.filter(same).slice(0, 3);
  }
  function headline() {
    const away = rows.cities.filter((r) => !r.inside && r.t.level), group = named();
    if (!away.length) return rows.cities.some((r) => r.inside && r.t.level) || rows.states.some((r) => r.inside && r.t.level)
      ? 'The change stays where it was made: no place beyond it reaches a change level.' : 'Rain, heat and wind barely change anywhere.';
    if (!group.length) return 'Beyond the change, effects peak only after day\u00a07, where the forecast is no better than the seasonal average.';
    const top = group[0], most = group.reduce((a, r) => (Math.abs(r.t.delta) > Math.abs(a.t.delta) ? r : a)), k = trust(most.t.peak, app.beyond() || huge(most.t));
    const lead = app.beyond() ? 'Outside the model’s experience, so read the direction only. ' : '';
    const last = Math.max(...away.flatMap((r) => r.t.days.map((x, d) => (x.level ? d + 1 : 0))));
    return `${lead}Beyond the change, ${joinNames(group.map((r) => r.name))} ${group.length > 1 ? 'get' : 'gets'} ${changeWord(top.t.kind, top.t.delta)}, up to ${signed(most.t.delta)}\u00a0${KINDS[top.t.kind].unit} on day\u00a0${most.t.peak}.${last < 10 ? ` It fades after day\u00a0${last}.` : ''} ${badge(k)}`;
  }

  function setDay() { document.querySelectorAll('#whoList [data-d]').forEach((el) => el.classList.toggle('now', +el.dataset.d === S.day)); }

  /** Open a place from the list or a pin: the map flies there and the panel shows its ten days. */
  function select(id) {
    const r = [...rows.cities, ...rows.states].find((x) => x.id === id);
    if (!r) return;
    selected = id; who = id[0] === 'c' ? 'cities' : 'states'; if (r.inside) insideOpen = true; else if (rows[who].filter((x) => !x.inside).indexOf(r) >= SHOW) all = true;
    app.play(false); S.mode = 'diff'; S.layer = String(VAR_OF[r.t.kind]); S.day = r.t.peak; app.view();
    syncSeg(); render(); app.stage.render(); app.explore.focusId(id);
  }
  const syncSeg = () => document.querySelectorAll('#whoSeg button').forEach((b) => { b.classList.toggle('on', b.dataset.who === who); b.setAttribute('aria-pressed', b.dataset.who === who); });

  /** Pins light up on the days a city is on watch; the selected city stays visible. */
  const pins = () => {
    const order = named().map((r) => r.id), lead = new Set(order); // the places the headline names are labelled on the map
    return rows.cities.filter((r) => r.t.days[S.day - 1].level || r.id === selected || lead.has(r.id)).map((r) => ({
      id: r.id, name: r.name, lat: r.lat, lon: r.lon, level: r.t.days[S.day - 1].level, selected: r.id === selected, onClick: () => select(r.id),
      named: lead.has(r.id) && !selected, slot: order.indexOf(r.id), text: lead.has(r.id) && !selected ? `${r.name} ${signed(r.t.delta)}\u00a0${KINDS[r.t.kind].unit}, day ${r.t.peak}` : r.name,
    }));
  };

  document.querySelectorAll('#whoSeg button').forEach((b) => (b.onclick = () => { who = b.dataset.who; all = false; selected = null; fresh = true; syncSeg(); render(); app.stage.render(); }));
  $('whoMore').onclick = () => { all = !all; render(); };
  $('whoList').onclick = (e) => {
    if (e.target.closest('[data-inside]')) { insideOpen = !insideOpen; return render(); }
    const b = e.target.closest('button[data-id]'); if (b) select(b.dataset.id);
  };

  return { update, render, setDay, pins, select, headline, rows: () => rows,
    deselect() { if (selected) { selected = null; render(); } },
    /** The quantity the headline is about, or null. */
    topKind: () => (told()[0] || rows.cities.find((r) => r.t.level))?.t.kind ?? null,
    /** The city felt most beyond the change (the tour opens it). */
    topAway: () => told()[0] || rows.cities.find((r) => r.t.level) || rows.cities[0] };
}
