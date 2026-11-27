// Run from the repo root:  node --test dashboard/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { NCELL, NCH, rIdx } from '../js/util.js';
import { impactFrames, impactGrid, effectKey, impacted, blend, contour, reached } from '../js/impact-view.js';

const STEPS = 10;
const roll = () => { const r = new Float32Array(STEPS * NCH * NCELL); for (let d = 0; d < STEPS; d++) r.fill(300, rIdx(d, 0), rIdx(d, 0) + NCELL); return r; };

test('frames start with the change itself and follow with what-if minus normal', () => {
  const init = new Float32Array(3 * NCH * NCELL), last = new Float32Array(NCH * NCELL), prime = roll(), mv = roll();
  last[5] = 3; mv[rIdx(1, 1) + 7] = 12;
  const f = impactFrames(init, last, prime, mv);
  assert.equal(f.length, STEPS + 1); assert.equal(f[0].temp[5], 3); assert.equal(f[2].rain[7], 12); assert.equal(f[1].rain[7], 0);
  assert.equal(blend(f[1], f[2], 0.5).rain[7], 6);
});

test('only real changes are inked, hot is red, cold is blue, wetter is teal, stronger is more opaque', () => {
  const frame = { temp: new Float32Array(NCELL), rain: new Float32Array(NCELL), wind: new Float32Array(NCELL) };
  frame.temp[0] = 0.05; frame.temp[1] = 0.6; frame.temp[2] = 4; frame.temp[3] = -4; frame.rain[4] = 20;
  const g = impactGrid(frame, 'temp'), px = (k) => Array.from(g.slice(k * 4, k * 4 + 4)), rain = impactGrid(frame, 'rain');
  assert.deepEqual(px(0), [0, 0, 0, 0]);
  assert.ok(px(1)[3] > 0 && px(2)[3] > px(1)[3]);
  assert.ok(px(2)[0] > px(2)[2] && px(3)[2] > px(3)[0]); // red-heavy when hotter, blue-heavy when cooler
  assert.ok(rain[4 * 4 + 1] > rain[4 * 4] && px(4)[3] === 0); // teal when wetter, and only on the rain map
  assert.equal(effectKey('rain', -3), 'drier'); assert.equal(effectKey('wind', -3), 'wind');
});

test('only places on watch that day are lit, and grouped states expand to their members', () => {
  const day = (level, kind, delta) => ({ level, kind, delta });
  const row = (id, name, a, b) => ({ id, name, lat: 1, lon: 2, t: { days: [a, b] } });
  const rows = { cities: [row('c:A', 'A', day(0, 'temp', 0), day(2, 'temp', 2))], states: [row('s:NE', 'NE small states', day(1, 'rain', -2), day(0, 'rain', 0))] };
  const members = () => ['Manipur', 'Tripura'];
  assert.deepEqual(impacted(rows, 1, members).cities, []);
  assert.deepEqual(impacted(rows, 1, members).states.map((s) => [s.name, s.effect]), [['Manipur', 'drier'], ['Tripura', 'drier']]);
  assert.equal(impacted(rows, 1, members).stateCount, 1);
  assert.deepEqual(impacted(rows, 2, members).cities.map((c) => [c.name, c.effect, c.level]), [['A', 'hotter', 2]]);
});

test('watch-level lines close around an affected patch and nowhere else', () => {
  const s = new Float32Array(NCELL); for (let i = 10; i < 15; i++) for (let j = 10; j < 15; j++) s[i * 36 + j] = 2.5;
  assert.equal(contour(s, 1).length, 20); // one ring round a 5x5 block
  assert.equal(contour(s, 3).length, 0); // nothing reaches High
});

test('the front of a change never shrinks', () => {
  const frame = (v) => { const f = { temp: new Float32Array(NCELL), rain: new Float32Array(NCELL), wind: new Float32Array(NCELL) }; f.temp[7] = v; return f; };
  const env = reached([frame(2), frame(0), frame(4)], 'temp');
  assert.ok(env[1][7] === env[0][7] && env[2][7] > env[1][7] && env[2][8] === 0);
});
