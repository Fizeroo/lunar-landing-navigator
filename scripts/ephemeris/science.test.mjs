import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateEphemeris, observeAt, utcToEt, etToUtc } from '../../src/science/index.ts';

const raw = JSON.parse(readFileSync(new URL('../../public/data/ephemeris-2026-11.json', import.meta.url), 'utf8'));
const data = validateEphemeris(raw);
const reference = JSON.parse(readFileSync(new URL('./validation-fixtures.json', import.meta.url), 'utf8'));
const site = { latDeg: -89.5, lonDeg: 0, heightAboveReferenceSphereM: 0 };
const radians = Math.PI / 180;
function angular(a, b) {
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(...cross), a.reduce((sum, n, i) => sum + n * b[i], 0)) / radians;
}
function synthetic(sunM, earthM = [-4e8, 0, 0]) {
  const result = structuredClone(raw);
  result.samples = result.samples.slice(0, 2).map(row => ({ ...row, sunM, earthM }));
  const last = result.samples.at(-1);
  result.coverage.endEt = last.et;
  result.coverage.endUtc = last.utc;
  return validateEphemeris(result);
}

test('actual dataset: exact inclusive endpoints, real source/frame, all ET steps <=600 plus final endpoint', () => {
  assert.equal(data.coverage.startUtc, '2026-11-01T00:00:00Z');
  assert.equal(data.coverage.endUtc, '2026-12-01T00:00:00Z');
  assert.equal(data.samples.length, 4322);
  assert.equal(data.provenance.kernels.length, 5);
  assert.equal(data.provenance.cspiceVersion, 'CSPICE_N0067');
  for (let i = 1; i < data.samples.length - 1; i++) assert.equal(data.samples[i].et - data.samples[i - 1].et, 600);
  assert.ok(data.samples.at(-1).et > data.samples.at(-2).et);
  for (const et of [data.coverage.startEt, data.coverage.endEt]) assert.ok(Number.isFinite(observeAt(data, et, site).earth.altDeg));
});

test('TypeScript interpolation and ENU agree with independent direct CSPICE AZLCPO fixtures', () => {
  let maxAltitude = 0, maxDirection = 0, maxAzimuth = 0;
  for (const fixture of reference.observations) {
    const actual = observeAt(data, fixture.et, fixture.site);
    for (const name of ['sun', 'earth']) {
      const expected = fixture.bodies[name];
      maxDirection = Math.max(maxDirection, angular(actual[name].direction, expected.direction));
      maxAltitude = Math.max(maxAltitude, Math.abs(actual[name].altDeg - expected.altDeg));
      assert.ok(angular(actual[name].direction, expected.direction) <= 0.001);
      assert.ok(Math.abs(actual[name].altDeg - expected.altDeg) <= 0.001);
      if (expected.azDeg === null) assert.equal(actual[name].azDeg, null);
      else {
        const difference = Math.abs(((actual[name].azDeg - expected.azDeg + 540) % 360) - 180);
        maxAzimuth = Math.max(maxAzimuth, difference);
        assert.ok(difference < 0.01);
      }
    }
  }
  console.log(JSON.stringify({ fixtureCount: reference.observations.length, maxAltitudeDeg: maxAltitude, maxDirectionDeg: maxDirection, maxAzimuthDeg: maxAzimuth }));
});

test('UTC lookup has explicit timezone, bounded roundtrip and exact endpoints', () => {
  for (const row of data.samples) assert.ok(Math.abs(utcToEt(data, row.utc) - row.et) < 1e-6);
  for (let i = 0; i < data.samples.length - 1; i += 47) {
    const et = (data.samples[i].et + data.samples[i + 1].et) / 2;
    assert.ok(Math.abs(utcToEt(data, etToUtc(data, et)) - et) <= 0.001);
  }
  assert.equal(utcToEt(data, data.coverage.startUtc), data.coverage.startEt);
  assert.equal(utcToEt(data, data.coverage.endUtc), data.coverage.endEt);
  assert.equal(etToUtc(data, data.coverage.endEt), data.coverage.endUtc);
  for (const utc of ['2026-11-14T00:00:00', '2026-11-14T00:00:00+00:00', '2026-11-31T00:00:00Z', '2026-11-14T00:00:60Z', 'invalid', '2026-10-31T23:59:59Z']) assert.throws(() => utcToEt(data, utc));
});

test('no extrapolation or invalid/nonfinite/site-height inputs', () => {
  for (const et of [NaN, Infinity, data.coverage.startEt - 1, data.coverage.endEt + 1]) assert.throws(() => observeAt(data, et, site));
  for (const patch of [{ heightAboveReferenceSphereM: 1 }, { latDeg: 91 }, { latDeg: NaN }, { lonDeg: 180 }, { lonDeg: -180.1 }]) assert.throws(() => observeAt(data, data.coverage.startEt, { ...site, ...patch }));
  for (const change of [x => x.model.units = 'km', x => x.model.frame = 'IAU_MOON', x => x.model.abcorr = 'LT+S', x => x.samples[2].et = x.samples[1].et, x => x.samples[0].sunM[0] = NaN, x => x.samples[0].earthM = [1, 2], x => x.coverage.endEt -= 1]) {
    const bad = structuredClone(raw); change(bad); assert.throws(() => validateEphemeris(bad));
  }
});

test('analytic ENU cardinals, topocentric subtraction, pole/zenith/nadir and disk classifications', () => {
  const equator = { latDeg: 0, lonDeg: 0, heightAboveReferenceSphereM: 0 };
  const east = synthetic([1737400, 1.5e11, 0]);
  const eastObservation = observeAt(east, east.coverage.startEt, equator);
  assert.equal(eastObservation.sun.azDeg, 90);
  assert.equal(eastObservation.sun.altDeg, 0);
  assert.equal(eastObservation.sun.centerAboveReferenceHorizon, false);
  assert.equal(eastObservation.sun.diskState, 'partial');
  assert.ok(Math.abs(eastObservation.sun.angularRadiusDeg - Math.asin(695700000 / 1.5e11) / radians) < 1e-12);
  const north = synthetic([1737400, 0, 1.5e11]);
  assert.equal(observeAt(north, north.coverage.startEt, equator).sun.azDeg, 0);
  const vertical = synthetic([1.5e11, 0, 0]);
  const observation = observeAt(vertical, vertical.coverage.startEt, equator);
  assert.equal(observation.sun.azDeg, null); assert.equal(observation.sun.altDeg, 90);
  assert.equal(observation.earth.azDeg, null); assert.equal(observation.earth.altDeg, -90);
  assert.equal(observation.sun.diskState, 'full'); assert.equal(observation.earth.diskState, 'none');
  assert.equal(observeAt(data, data.coverage.startEt, { ...equator, latDeg: -90 }).earth.azDeg, null);
  assert.ok(Math.abs(observation.earth.distanceM - (4e8 + 1737400)) < 1e-6);
});

test('longitude seam agrees and body-centered lighting differs correctly from topocentric direction', () => {
  const a = observeAt(data, data.coverage.startEt, { ...site, latDeg: 0, lonDeg: -180 });
  const b = observeAt(data, data.coverage.startEt, { ...site, latDeg: 0, lonDeg: 179.999999 });
  assert.ok(Math.abs(a.earth.altDeg - b.earth.altDeg) < 0.00001);
  const near = observeAt(data, data.coverage.startEt, { ...site, latDeg: 0, lonDeg: 90 });
  assert.ok(angular(near.earth.direction, near.earthDirectionBody) > 0.1);
  assert.ok(Math.abs(Math.hypot(...near.sunDirectionBody) - 1) < 1e-15);
});

test('reject time interpolation across leap-second segments and second60', () => {
  const leap = structuredClone(raw);
  const start = leap.samples[0].et;
  leap.samples = leap.samples.slice(0, 2);
  leap.samples[0].utc = '2016-12-31T23:59:59Z';
  leap.samples[1].utc = '2017-01-01T00:00:01Z';
  leap.samples[1].et = start + 3;
  leap.coverage = { startUtc: leap.samples[0].utc, endUtc: leap.samples[1].utc, startEt: start, endEt: start + 3 };
  const checked = validateEphemeris(leap);
  assert.throws(() => utcToEt(checked, '2017-01-01T00:00:00Z'), /leap/);
  assert.throws(() => etToUtc(checked, start + 1), /leap/);
});

test('incomplete or inconsistent scientific provenance is rejected', () => {
  for (const change of [x => x.provenance = {}, x => x.provenance.targetNaifIds.earth = 3,
    x => x.provenance.kernels.pop(), x => x.provenance.kernels[0].sha256 = 'unverified',
    x => x.provenance.kernels[0].url = 'https://example.org/unreviewed.bsp',
    x => x.provenance.loadedCoverage.intersectionEt = [[0, 1]], x => x.provenance.terrainApplied = true]) {
    const bad = structuredClone(raw); change(bad); assert.throws(() => validateEphemeris(bad));
  }
});
