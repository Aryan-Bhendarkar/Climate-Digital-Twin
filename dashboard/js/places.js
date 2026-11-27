// Everything that can be pointed at on the map: states, the analysis cities, and every town in assets/places.json
// (GeoNames, CC BY 4.0). Pure functions, no DOM.
import { CITIES, MAJOR } from './cities.js';
import { statePlaces } from './geo.js';
import { cellIndex } from './insights.js';

/** A town of tier t is named on the map when the camera is closer than SHOW_AT[t]. */
export const SHOW_AT = [0, Infinity, Infinity, 15, 9, 5.6];
export const tierOf = (population) => (population >= 200000 ? 3 : population >= 50000 ? 4 : 5);

const letters = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
const near = (a, lat, lon, d) => Math.abs(a.lat - lat) < d && Math.abs(a.lon - lon) < d;
const city = (id, name, sub, tier, pop, lat, lon) => ({ id, kind: 'city', name, sub, tier, pop, lat, lon, cells: [[cellIndex(lat, lon), 1]] });

export function mapPlaces(outlines, gazetteer) {
  const states = statePlaces(outlines).map((s) => ({ ...s, sub: 'State or territory' }));
  // the analysis cities keep their ids, so lists, pins and the map agree about them
  const main = CITIES.map((c) => city('c:' + c.name, c.name, c.state, MAJOR.has(c.name) ? 1 : 2, MAJOR.has(c.name) ? 2e7 : 1e7, c.lat, c.lon));
  const towns = gazetteer.places
    .filter(([name, , lat, lon]) => !main.some((c) => near(c, lat, lon, 0.07) || (near(c, lat, lon, 0.3) && letters(name).includes(letters(c.name)))))
    .map(([name, state, lat, lon, pop], i) => city('g:' + i, name, gazetteer.states[state], tierOf(pop), pop, lat, lon));
  const cities = [...main, ...towns]; // already in order of prominence: analysis cities, then by population
  const buckets = new Map();
  for (const c of towns) { const k = Math.floor(c.lat) * 1000 + Math.floor(c.lon); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(c); }
  return { states, cities, main, buckets };
}

/** Cities worth drawing for a camera looking at (lat, lon) from `dist`: the analysis cities plus nearby towns. */
export function visibleCities(places, lat, lon, dist) {
  const out = dist > 34 ? places.main.filter((c) => c.tier === 1) : [...places.main];
  if (dist >= SHOW_AT[3]) return out;
  const r = Math.ceil(dist * 0.75);
  for (let a = Math.floor(lat) - r; a <= Math.floor(lat) + r; a++) {
    for (let b = Math.floor(lon) - r - 1; b <= Math.floor(lon) + r + 1; b++) for (const c of places.buckets.get(a * 1000 + b) || []) if (dist < SHOW_AT[c.tier]) out.push(c);
  }
  return out;
}

export const label = (p) => (p.kind === 'city' ? `${p.name}, ${p.sub}` : p.name);
/** Older names people still type. */
const ALIASES = { bombay: 'mumbai', calcutta: 'kolkata', bangalore: 'bengaluru', madras: 'chennai', poona: 'pune', baroda: 'vadodara', trivandrum: 'thiruvananthapuram',
  pondicherry: 'puducherry', allahabad: 'prayagraj', calicut: 'kozhikode', cochin: 'kochi', banaras: 'varanasi', benares: 'varanasi', gauhati: 'guwahati', simla: 'shimla', mysore: 'mysuru' };
/** Places whose name starts with the query ("name" or "name, state"), most prominent first. */
export function search(places, query, limit = 12) {
  const [typed, state = ''] = query.toLowerCase().split(',').map((s) => s.trim());
  if (!typed) return [];
  const name = ALIASES[typed] && !places.cities.some((p) => p.name.toLowerCase() === typed) ? ALIASES[typed] : typed;
  const all = [...places.cities, ...places.states].filter((p) => p.name.toLowerCase().startsWith(name) && (!state || p.sub.toLowerCase().startsWith(state)));
  return [...all.filter((p) => p.name.toLowerCase() === name), ...all.filter((p) => p.name.toLowerCase() !== name)].slice(0, limit);
}
