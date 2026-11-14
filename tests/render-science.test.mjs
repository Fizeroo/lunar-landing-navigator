import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bodyToScene, sceneToBody, latLonToBodyUnit, bodyToLatLon } from '../src/scene/coords.ts';
import { observeAt, utcToEt, validateEphemeris } from '../src/science/index.ts';

const data = validateEphemeris(JSON.parse(await readFile(new URL('../public/data/ephemeris-2026-11.json', import.meta.url), 'utf8')));
const degrees = 180 / Math.PI;

test('real dataset covers the exact promised UTC interval', () => {
  assert.equal(data.coverage.startUtc, '2026-11-01T00:00:00Z');
  assert.equal(data.coverage.endUtc, '2026-12-01T00:00:00Z');
  assert.ok(data.samples.length >= 4321);
  assert.equal(data.provenance.terrainApplied, false);
});

test('body axes become a right-handed scene rotation', () => {
  const x = bodyToScene([1, 0, 0]);
  const y = bodyToScene([0, 1, 0]);
  const z = bodyToScene([0, 0, 1]);
  assert.ok(x.clone().cross(y).distanceTo(z) < 1e-14);
  assert.deepEqual(sceneToBody(z), [0, 0, 1]);
  assert.equal(z.y, 1);
  assert.equal(y.z, -1);
});

for (const [lat, lon] of [[0, 0], [0, 90], [-89, 45], [-89.99, -179.9], [45, 179.9], [-43.3, -11.4]]) {
  test(`scene/picking coordinate roundtrip ${lat}, ${lon}`, () => {
    const body = latLonToBodyUnit(lat, lon);
    const picked = bodyToLatLon(sceneToBody(bodyToScene(body)));
    assert.ok(Math.abs(picked.latDeg - lat) < 1e-10);
    assert.ok(Math.abs(picked.lonDeg - lon) < 1e-10);
  });
}

for (const utc of ['2026-11-01T00:00:00Z', '2026-11-14T00:00:00Z', '2026-12-01T00:00:00Z']) {
  test(`globe illumination direction agrees with site altitude at ${utc}`, () => {
    const et = utcToEt(data, utc);
    const site = { latDeg: -89, lonDeg: 0, heightAboveReferenceSphereM: 0 };
    const observation = observeAt(data, et, site);
    const renderedNormal = bodyToScene(latLonToBodyUnit(site.latDeg, site.lonDeg));
    const renderedLight = bodyToScene(observation.sunDirectionBody);
    const globeAltitude = Math.asin(Math.max(-1, Math.min(1, renderedNormal.dot(renderedLight)))) * degrees;
    // Globe lighting uses a distant Sun; numerical cards use the actual surface observer.
    // Their maximum lunar solar parallax is below 0.001 degree.
    assert.ok(Math.abs(globeAltitude - observation.sun.altDeg) < 0.001);
    const subsolar = bodyToLatLon(observation.sunDirectionBody);
    const subsolarNormal = bodyToScene(latLonToBodyUnit(subsolar.latDeg, subsolar.lonDeg));
    assert.ok(subsolarNormal.dot(renderedLight) > 0.999999999999);
    const tangent = renderedLight.clone().cross(bodyToScene([0, 0, 1])).normalize();
    assert.ok(Math.abs(tangent.dot(renderedLight)) < 1e-12);
  });
}
