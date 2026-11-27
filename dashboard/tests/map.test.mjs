// Run from the repo root:  node --test dashboard/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as W from '../js/world.js';
import * as G from '../js/geo.js';
import { cellIndex } from '../js/insights.js';
import * as P from '../js/places.js';

const load = (f) => JSON.parse(readFileSync(new URL('../assets/' + f, import.meta.url)));
const view = { w: 1200, h: 800, cx: 400, cy: 420 };
const near = (a, b, e = 0.5) => assert.ok(Math.abs(a - b) <= e, `${a} is not within ${e} of ${b}`);

test('the camera target appears at the chosen screen point, from any angle', () => {
  for (const cam of [{ x: 0, z: 0, dist: 40, pitch: 0, bearing: 0 }, { x: 5, z: -3, dist: 12, pitch: 1, bearing: 2.4 }]) {
    const c = W.camera(cam, view), p = W.project(c, cam.x, 0, cam.z);
    near(p[0], view.cx); near(p[1], view.cy);
  }
});

test('north is up and east is right when looking straight down', () => {
  const c = W.camera({ x: 0, z: 0, dist: 40, pitch: 0, bearing: 0 }, view);
  const at = (lo, la) => W.project(c, W.toWorld(lo, la)[0], 0, W.toWorld(lo, la)[1]);
  assert.ok(at(83, 25)[1] < at(83, 19)[1]); assert.ok(at(86, 22)[0] > at(80, 22)[0]);
});

test('picking the ground undoes projection, also over raised terrain', () => {
  const c = W.camera({ x: 2, z: 1, dist: 20, pitch: 0.8, bearing: -0.5 }, view), hill = (x, z) => Math.max(0, 2 - Math.hypot(x - 4, z - 2) * 0.4);
  for (const [x, z] of [[2, 1], [4, 2], [-3, 4], [7, 6]]) {
    const s = W.project(c, x, hill(x, z), z), hit = W.pickGround(W.screenRay(c, s[0], s[1]), hill);
    near(hit[0], x, 0.15); near(hit[2], z, 0.15);
  }
});

test('a flick carries on, and the map resists gently past its edges', () => {
  assert.ok(W.projected(10) > 1.9 && W.projected(10) < 2.1 && W.projected(-10) < 0);
  assert.equal(W.rubber(3, [-5, 5]), 3);
  const a = W.rubber(7, [-5, 5]), b = W.rubber(15, [-5, 5]);
  assert.ok(a > 5 && a < 7 && b > a && b < 11); assert.ok(W.rubber(-9, [-5, 5]) < -5);
});

test('flights start and end exactly on their cameras and turn the short way', () => {
  const a = { x: -5, z: 0, dist: 60, pitch: 0.2, bearing: 3 }, b = { x: 8, z: 4, dist: 6, pitch: 0.9, bearing: -3 };
  near(W.flight(a, b, 0).dist, 60, 1e-6); near(W.flight(a, b, 1).dist, 6, 1e-6); near(W.flight(a, b, 1).x, 8, 1e-6);
  assert.ok(W.flight(a, b, 0.5).bearing > 3);
});

test('every state polygon becomes a place with grid cells, and points resolve to states', () => {
  const states = G.statePlaces(load('outlines.json'));
  assert.equal(states.length, 36);
  for (const s of states) assert.ok(s.cells.length >= 1 && s.cells.every(([k]) => k >= 0 && k < 1152), s.name);
  assert.equal(G.stateAt(states, 75.8, 26.9).name, 'Rajasthan');
  assert.equal(G.stateAt(states, 78.1, 11.0).name, 'Tamil Nadu');
  assert.equal(G.stateAt(states, 88, 13), null); // open sea
});

test('terrain is flat at sea and rises with real elevation', () => {
  // one byte per sample, square-root coded: 255 is 9000 m
  const code = (m) => Math.round(255 * Math.sqrt(m / 9000)), w = 36, h = 32, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba[(y * w + x) * 4] = code(y < 8 ? 5000 : 200); // north is high
  const elev = G.decodeElevation(rgba, w, h), height = G.heightField(elev, (lo, la) => (lo > 84 && la < 18 ? 0 : 1));
  near(elev.m[0], 5000, 60); near(elev.m[w * 20], 200, 12);
  assert.equal(height(...W.toWorld(88, 12)), 0);
  assert.ok(height(...W.toWorld(80, 35)) > 1.4); assert.ok(height(...W.toWorld(82, 22)) < 0.2);
  near(G.sample(Float32Array.from({ length: 1152 }, (_, k) => k % 36), 75.5, 20), 10, 1e-6);
  assert.equal(cellIndex(13.08, 80.27), 7 * 36 + 15);
});

test('every town in the data file is usable, and zooming in reveals more of them', () => {
  const places = P.mapPlaces(load('outlines.json'), load('places.json'));
  assert.ok(places.cities.length > 6000 && places.states.length === 36);
  for (const c of places.cities) assert.ok(c.name && c.sub && c.lat >= 6 && c.lat <= 38 && c.lon >= 65 && c.lon <= 101 && c.cells[0][0] >= 0 && c.cells[0][0] < 1152, c.name);
  assert.equal(new Set(places.cities.map((c) => c.id)).size, places.cities.length);
  assert.equal(places.cities.filter((c) => c.name === 'Chennai').length, 1); // no duplicate of an analysis city
  const far = P.visibleCities(places, 22, 80, 40).length, mid = P.visibleCities(places, 11, 78, 12).length, close = P.visibleCities(places, 11, 78, 4).length;
  assert.ok(far < 10 && mid > far && close > mid, [far, mid, close].join());
  assert.equal(P.search(places, 'chennai')[0].id, 'c:Chennai');
  assert.equal(P.search(places, 'Delhi')[0].kind, 'city');
  assert.ok(P.search(places, P.label(places.cities[500])).includes(places.cities[500]));
});
