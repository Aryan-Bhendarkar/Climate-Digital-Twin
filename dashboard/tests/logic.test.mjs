// Run from the repo root:  node --test dashboard/tests/logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { NCELL, NCH, rIdx } from '../js/util.js';
import { compsFor, describe, outOfRange, randomScenario, questionText, PARTS } from '../js/scenarios.js';
import { buildPerturbation, boxFromLatLon } from '../js/shock.js';
import * as I from '../js/insights.js';

const STEPS = 10;
const roll = () => { const r = new Float32Array(STEPS * NCH * NCELL); for (let d = 0; d < STEPS; d++) r.fill(300, rIdx(d, 0), rIdx(d, 0) + NCELL); return r; };
const chennai = I.cellIndex(13.08, 80.27), cells = [[chennai, 1]];

test('strength scales every part and percent changes stop at -100', () => {
  assert.deepEqual(compsFor({ wind: -60 }, 3), [{ ch: 2, mode: 'pct', value: -100 }, { ch: 3, mode: 'pct', value: -100 }]);
  assert.equal(describe({ t2m: 3, tcwv: 15 }), 'temperature +3 °C and humidity +15 %');
  assert.equal(outOfRange({ t2m: 3 }, 1).length, 0);
  assert.equal(outOfRange({ t2m: 3 }, 2).length, 1);
});

test('random scenarios stay on the grid and within believable ranges', () => {
  for (let n = 0; n < 200; n++) {
    const s = randomScenario(), b = boxFromLatLon(...s.box);
    assert.ok(b.i0 >= 0 && b.i1 < 32 && b.j0 >= 0 && b.j1 < 36 && b.i0 <= b.i1);
    assert.ok(Object.keys(s.values).length >= 1);
    for (const [id, v] of Object.entries(s.values)) { const p = PARTS.find((x) => x.id === id); assert.ok(v !== 0 && v >= p.min && v <= p.max, `${id} ${v}`); }
  }
});

test('watch level, start, peak and duration come from the daily change', () => {
  const p = roll(), m = roll();
  m[rIdx(1, 1) + chennai] = 2;  // day 2: +2 mm  -> Low
  m[rIdx(2, 1) + chennai] = 20; // day 3: +20 mm -> High
  m[rIdx(3, 0) + chennai] = 302; // day 4: +2 °C  -> Medium
  const t = I.timeline(p, m, cells);
  assert.deepEqual(t.days.slice(0, 5).map((d) => d.level), [0, 1, 3, 2, 0]);
  assert.equal(t.level, 3); assert.equal(t.start, 2); assert.equal(t.peak, 3); assert.equal(t.count, 3); assert.equal(t.kind, 'rain');
  assert.equal(I.timeline(p, p, cells).level, 0);
});

test('breakdown parts plus the leftover add up to the whole effect', () => {
  const base = roll(), full = roll(), a = roll(), b = roll();
  full[rIdx(0, 1) + chennai] = 10; a[rIdx(0, 1) + chennai] = 6; b[rIdx(0, 1) + chennai] = 1;
  const r = I.breakdown(base, full, [{ id: 'a', roll: a }, { id: 'b', roll: b }], cells, 'rain');
  assert.deepEqual([r.total, r.parts[0].value, r.parts[1].value, r.together], [10, 6, 1, 3]);
});

test('checks pass for a local change and catch a jump beyond the reach limit', () => {
  const init = new Float32Array(NCH * NCELL), box = boxFromLatLon(10, 14, 82, 86);
  const { pert } = buildPerturbation(init, box, compsFor({ t2m: 2 }));
  assert.deepEqual(I.bboxOf(pert), box);
  const base = roll(), shocked = roll();
  for (let d = 0; d < STEPS; d++) shocked[rIdx(d, 0) + box.i0 * 36 + box.j0] += 1;
  shocked[rIdx(1, 0) + (box.i0 - 3 - 1) * 36 + box.j0] += 0.5; // day 2: just outside the "local" margin, inside reach
  const ok = I.runChecks({ base, zero: roll(), shocked, pert, ms: 200 });
  assert.deepEqual(ok.map((c) => c.status), Array(7).fill('pass'));
  shocked[rIdx(0, 0) + 31 * 36 + 0] += 1; // far corner on day 1
  assert.equal(I.runChecks({ base, zero: roll(), shocked, pert, ms: 200 }).find((c) => c.id === 'reach').status, 'fail');
  const none = I.runChecks({ base, zero: roll(), shocked: roll(), pert: new Float32Array(NCH * NCELL), ms: 200 });
  assert.equal(none.filter((c) => c.status === 'na').length, 4);
});

test('influence tiles cover the grid once', () => {
  const seen = new Set();
  for (const b of I.tiles()) for (let i = b.i0; i <= b.i1; i++) for (let j = b.j0; j <= b.j1; j++) seen.add(i * 36 + j);
  assert.equal(I.tiles().length, 72); assert.equal(seen.size, NCELL);
});

test('places inside the changed box are told apart, with how long and how firm', () => {
  const box = { i0: 2, i1: 4, j0: 5, j1: 8 };
  assert.equal(I.insideShare([[3 * 36 + 6, 1]], box), 1);
  assert.equal(I.insideShare([[3 * 36 + 6, 1], [20 * 36 + 20, 3]], box), 0.25);
  assert.equal(I.insideShare([[3 * 36 + 6, 1]], null), 0);
  const t = { days: [0, 1, 2, 0, 1, 0, 0, 0, 0, 0].map((level) => ({ level })) };
  assert.deepEqual(I.span(t), [2, 5]);
  assert.equal(I.span({ days: [{ level: 0 }] }), null);
  assert.ok(I.huge({ kind: 'rain', delta: -40 }) && !I.huge({ kind: 'temp', delta: 2 }));
  assert.equal(I.trust(2), 'firm'); assert.equal(I.trust(5), 'rough'); assert.equal(I.trust(9), 'dir'); assert.equal(I.trust(1, true), 'dir');
});

test('a scenario reads as a question', () => {
  assert.equal(questionText({ t2m: 3, tcwv: 15 }, 1, 'the Bay of Bengal'), 'What if the air over the Bay of Bengal were 3 °C warmer and 15 % more humid?');
  assert.equal(questionText({ wind: -40 }, 0.5, 'the Arabian Sea'), 'What if winds over the Arabian Sea were 20 % weaker?');
  assert.equal(questionText({}, 1, 'x'), null);
});
