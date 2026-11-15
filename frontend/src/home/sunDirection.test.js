import test from 'node:test';
import assert from 'node:assert/strict';
import landingSites from '../data/landingSites.json' with { type: 'json' };
import { getMoonLighting, latLonOf, localToMoonFixed } from './sunDirection.js';

const at = (iso) => getMoonLighting(new Date(iso));

test('a body straight overhead is above the site itself', () => {
  const point = latLonOf(localToMoonFixed(0, 90, -85.99, 2.93));
  assert.ok(Math.abs(point.latitude + 85.99) < 1e-9);
  assert.ok(Math.abs(point.longitude - 2.93) < 1e-9);
});

test('a body on the northern horizon of a south-polar site is 90° further north', () => {
  const point = latLonOf(localToMoonFixed(0, 0, -80, 30));
  assert.ok(Math.abs(point.latitude - 10) < 1e-9);
  assert.ok(Math.abs(point.longitude - 30) < 1e-9);
});

test('the real new Moon of 9 Dec 2026 lights the far side', () => {
  const lighting = at('2026-12-09T00:52:00Z');
  assert.ok(Math.abs(Math.abs(lighting.subSolar.longitude) - 180) < 5, `sub-solar longitude ${lighting.subSolar.longitude}`);
  assert.ok(lighting.litFraction < 0.01, `lit fraction ${lighting.litFraction}`);
});

test('the real full Moon of 24 Dec 2026 lights the near side', () => {
  const lighting = at('2026-12-24T01:28:00Z');
  assert.ok(Math.abs(lighting.subSolar.longitude) < 5, `sub-solar longitude ${lighting.subSolar.longitude}`);
  assert.ok(lighting.litFraction > 0.99, `lit fraction ${lighting.litFraction}`);
});

test('the Sun stays near the equator and Earth near the middle of the near side', () => {
  for (let day = 0; day < 118; day += 1) {
    const lighting = getMoonLighting(new Date(Date.UTC(2026, 11, 1 + day)));
    assert.ok(Math.abs(lighting.subSolar.latitude) < 1.7, `sub-solar latitude ${lighting.subSolar.latitude}`);
    assert.ok(Math.abs(lighting.subEarth.latitude) < 8 && Math.abs(lighting.subEarth.longitude) < 9, 'sub-Earth point outside libration range');
  }
});

test('every landing site gives the same sub-solar point', () => {
  const time = new Date('2027-01-15T06:00:00Z');
  const [first, ...others] = landingSites.map((site) => getMoonLighting(time, site).subSolar);
  for (const other of others) {
    assert.ok(Math.abs(other.latitude - first.latitude) < 0.05);
    assert.ok(Math.abs(other.longitude - first.longitude) < 0.05);
  }
});

test('the Moon waxes after new and wanes after full', () => {
  assert.equal(at('2026-12-15T00:00:00Z').waxing, true);
  assert.equal(at('2026-12-28T00:00:00Z').waxing, false);
});
