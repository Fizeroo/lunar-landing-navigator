import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateEphemeris, observeAt } from '../../src/science/index.ts';
import { analyzeSite } from '../../src/science/intervals.ts';
import { getUpcomingEvents } from '../../src/science/events.ts';
import { analyzeObserver, observeObserver, sphereHorizonDipDeg } from '../../src/science/observer.ts';

const data = validateEphemeris(JSON.parse(readFileSync(new URL('../../public/data/ephemeris-2026-11.json', import.meta.url), 'utf8')));
const extended = validateEphemeris(JSON.parse(readFileSync(new URL('../../public/data/ephemeris-2026-10_2027-02.json', import.meta.url), 'utf8')));
const site = { latDeg: -89.5, lonDeg: 0, heightAboveReferenceSphereM: 0 };

test('event search excludes coverage edges and distinguishes ongoing joint window', () => {
  const analysis = { period: { startEt: 0, endEt: 100 }, sun: { intervals: [{ startEt: 0, endEt: 20 }, { startEt: 40, endEt: 70 }] },
    earth: { intervals: [{ startEt: 0, endEt: 50 }, { startEt: 80, endEt: 100 }] }, both: { intervals: [{ startEt: 0, endEt: 20 }, { startEt: 40, endEt: 50 }] } };
  assert.deepEqual(getUpcomingEvents(analysis, 10), { sunrise: { et: 40, kind: 'sunrise' }, sunset: { et: 20, kind: 'sunset' },
    earthrise: { et: 80, kind: 'earthrise' }, earthset: { et: 50, kind: 'earthset' },
    joint: { startEt: 0, endEt: 20, ongoing: true, startClipped: true, endClipped: false } });
  assert.equal(getUpcomingEvents(analysis, 20).sunrise.et, 40);
  assert.equal(getUpcomingEvents(analysis, 0).joint.startClipped, true);
  assert.equal(getUpcomingEvents(analysis, 100).joint, null);
  assert.throws(() => getUpcomingEvents(analysis, NaN), /finite ET/);
  assert.throws(() => getUpcomingEvents(analysis, -1), /within the analysis period/);
  assert.throws(() => getUpcomingEvents(analysis, 101), /within the analysis period/);
});

test('observer displacement changes local direction and analysis while zero height matches surface API', () => {
  const period = { startEt: data.coverage.startEt, endEt: data.coverage.startEt + 86400 };
  assert.deepEqual(observeObserver(data, period.startEt, site, 0), observeAt(data, period.startEt, site));
  const surface = observeAt(data, period.startEt, site), elevated = observeObserver(data, period.startEt, site, 1000);
  assert.ok(elevated.earth.distanceM < surface.earth.distanceM);
  assert.notEqual(elevated.earth.altDeg, surface.earth.altDeg);
  assert.ok(sphereHorizonDipDeg(1000) > 0);
  assert.ok(sphereHorizonDipDeg(10000) > sphereHorizonDipDeg(1000));
  assert.throws(() => sphereHorizonDipDeg(-1), /height/);
  assert.throws(() => sphereHorizonDipDeg(10001), /height/);
  const a = analyzeObserver(data, site, period, 0);
  const b = analyzeSite(data, site, period);
  assert.deepEqual(a.sun, b.sun); assert.deepEqual(a.earth, b.earth); assert.deepEqual(a.both, b.both);
  assert.throws(() => analyzeObserver(data, { ...site, heightAboveReferenceSphereM: 1 }, period, 100));
  assert.throws(() => observeObserver(data, period.startEt, { ...site, heightAboveReferenceSphereM: 300 }, 100), /h=0/);
});

test('extended SPICE dataset has exact inclusive four-month endpoints and no extrapolated tail', () => {
  assert.equal(extended.coverage.startUtc, '2026-10-01T00:00:00Z');
  assert.equal(extended.coverage.endUtc, '2027-02-01T00:00:00Z');
  assert.equal(extended.samples.length, 17714);
  assert.equal(extended.samples[0].utc, extended.coverage.startUtc);
  assert.equal(extended.samples.at(-1).utc, extended.coverage.endUtc);
  assert.equal(extended.samples.at(-1).et, extended.coverage.endEt);
  assert.ok(extended.samples.slice(1).every((row, i) => row.et - extended.samples[i].et <= 600.001));
  assert.throws(() => observeAt(extended, extended.coverage.endEt + 1, site), /outside supported coverage/);
});
