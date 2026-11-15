import test from 'node:test';
import assert from 'node:assert/strict';
import landingSites from '../data/landingSites.json' with { type: 'json' };
import { findJointVisibilityWindows, getEphemerisRange, getLunarSiteConditions } from '../utils/ephemerisRuntime.js';

test('all three candidate sites have supported ephemeris ranges and discovered joint windows', () => {
  assert.equal(landingSites.length, 3);
  for (const site of landingSites) {
    const range = getEphemerisRange(site.latitude, site.longitude);
    const windows = findJointVisibilityWindows(site.latitude, site.longitude);
    assert.equal(range.sampleCount, 2837);
    assert.equal(range.sampleIntervalMs, 60 * 60 * 1000);
    assert.ok(range.start < range.end);
    assert.ok(windows.length > 0, `${site.name} should have at least one joint-visibility interval in supported data`);
    for (const window of windows) {
      assert.ok(window.start >= range.start && window.end <= range.end);
      assert.ok(window.durationMs > 0);
      assert.equal(getLunarSiteConditions(new Date(window.start.getTime() + 2 * 60 * 1000), site.latitude, site.longitude).operatingWindow, true);
      const midpoint = new Date((window.start.getTime() + window.end.getTime()) / 2);
      assert.equal(getLunarSiteConditions(midpoint, site.latitude, site.longitude).operatingWindow, true);
      assert.equal(getLunarSiteConditions(new Date(window.start.getTime() - 2 * 60 * 1000), site.latitude, site.longitude).operatingWindow, false);
      assert.equal(getLunarSiteConditions(new Date(window.end.getTime() + 2 * 60 * 1000), site.latitude, site.longitude).operatingWindow, false);
    }
  }
});
