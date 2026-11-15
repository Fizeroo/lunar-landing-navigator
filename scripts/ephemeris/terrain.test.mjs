import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateEphemeris, observeAt } from '../../src/science/index.ts';
import { analyzeTerrainHorizon, buildTerrainMesh, observeTerrain, observeTerrainInstant, sampleTerrain, sampleTerrainContinuous, sampleTerrainWalk, terrainHorizonProfile, terrainVertices, validateTerrainPatch } from '../../src/science/terrain.ts';

const data = validateEphemeris(JSON.parse(readFileSync(new URL('../../public/data/ephemeris-2026-10_2027-02.json', import.meta.url), 'utf8')));
const patch = validateTerrainPatch(JSON.parse(readFileSync(new URL('../../public/data/terrain-pgda90-southpolar.json', import.meta.url), 'utf8')));
const site = patch.observer.site;

test('real PGDA90 patch validates, preserves actual elevations and renders in the science frame', () => {
  assert.equal(patch.grid.rows, 101); assert.equal(patch.grid.cols, 101);
  assert.equal(patch.grid.validCellCount, 10201); assert.equal(patch.grid.noDataCellCount, 0);
  assert.equal(patch.source.nativePixelSizeM, 80);
  assert.ok(patch.source.frameApproximationMaxRad > 0);
  assert.ok(Math.abs(patch.observer.groundHeightM + 388.6183776855469) < 1e-6);
  const sampled = sampleTerrain(patch, site);
  assert.ok(sampled); assert.ok(Math.abs(sampled.heightM - patch.observer.groundHeightM) < 1e-6);
  const vertices = terrainVertices(patch);
  assert.equal(vertices.positionsM.length, 101 * 101 * 3);
  assert.ok(vertices.positionsM.every(Number.isFinite));
  assert.throws(() => validateTerrainPatch({ ...patch, referenceRadiusM: 1 }), /radius/);
  assert.equal(sampleTerrain(patch, { latDeg: -80, lonDeg: 0, heightAboveReferenceSphereM: 0 }), null);
  const noDataAtObserver = structuredClone(patch);
  noDataAtObserver.grid.heightsM[50][50] = null;
  noDataAtObserver.grid.positionsM[50][50] = null;
  assert.equal(sampleTerrain(noDataAtObserver, site), null);
  assert.throws(() => observeTerrain(data, data.coverage.startEt, site, 0, noDataAtObserver), /outside patch coverage or on DEM nodata/);
});

test('terrain observation uses the actual below-sphere DEM ground point and true topocentric vectors', () => {
  const et = data.coverage.startEt + 12345.678;
  const output = observeTerrain(data, et, site, 250, patch);
  const continuous = sampleTerrainContinuous(patch, site.latDeg, site.lonDeg);
  const actualSite = continuous.site;
  const base = observeAt(data, et, { ...actualSite, heightAboveReferenceSphereM: 0 });
  const phi = actualSite.latDeg * Math.PI / 180, lambda = actualSite.lonDeg * Math.PI / 180;
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  const groundRadius = data.model.referenceRadiusM + patch.observer.groundHeightM + 250;
  const eye = up.map(v => v * groundRadius);
  assert.ok(Math.abs(output.groundHeightM - patch.observer.groundHeightM) < 1e-6);
  assert.equal(output.observation.site.latDeg, actualSite.latDeg);
  assert.equal(output.observation.site.lonDeg, actualSite.lonDeg);
  assert.ok(Math.abs(output.observation.site.heightAboveReferenceSphereM - (output.groundHeightM + 250)) < 1e-9);
  for (const key of ['sun', 'earth']) {
    const source = base[key], result = output.observation[key];
    const moon = source.direction.map((v, i) => v * source.distanceM + data.model.referenceRadiusM * up[i]);
    const delta = moon.map((v, i) => v - eye[i]);
    const expected = Math.hypot(...delta);
    assert.ok(Math.abs(result.distanceM - expected) < 1e-6);
    assert.ok(Math.hypot(...result.direction.map((v, i) => v - delta[i] / expected)) < 1e-14);
  }
  assert.equal(output.profile.samples.length, 180);
  assert.equal(output.profile.samples[0].azDeg, 0);
  assert.equal(output.profile.samples.at(-1).azDeg, 358);
  assert.ok(output.profile.samples.some(row => row.altDeg !== null && row.limitingDistanceM > 0));
  assert.equal(output.profile.samples[0].altDeg, output.profile.samples[0].horizonAltDeg);
  assert.ok(['blocked', 'insufficient'].includes(output.sun.status));
  assert.equal(output.sun.status, 'insufficient', 'finite local patch cannot certify unobstructed sky');
  assert.equal(analyzeTerrainHorizon(patch, site, 250, 0, 80).status, 'insufficient');
  assert.equal(analyzeTerrainHorizon(patch, site, 250, 0, -89).status, 'blocked');
  assert.equal(analyzeTerrainHorizon(patch, site, 0, 0, -90).status, 'blocked');
  assert.equal(analyzeTerrainHorizon(patch, site, 0, 0, -89).status, 'blocked');
  assert.equal(analyzeTerrainHorizon(patch, site, 0, 0, -45).status, 'blocked');
  assert.equal(analyzeTerrainHorizon(patch, site, 0, 0, 0).status, 'blocked', 'tangent ray intersects the local facet/ridge');
  assert.equal(analyzeTerrainHorizon(patch, site, 0, 0, 5).status, 'insufficient', 'no hit over finite terrain coverage cannot certify clear');
  assert.equal(analyzeTerrainHorizon(patch, site, 0, 55, -1).status, 'insufficient',
    'negative-altitude no-hit ray remains unknown; reference-radius sphere is not treated as terrain');
  assert.throws(() => observeTerrain(data, et, { latDeg: -80, lonDeg: 0, heightAboveReferenceSphereM: 0 }, 0, patch), /outside patch coverage/);
});

test('fractional observer clearance retains nearby physical ground intersections', () => {
  for (const height of [0.001, 0.1, 0.49, 0.5, 1]) {
    const result = analyzeTerrainHorizon(patch, site, height, 0, -90);
    assert.equal(result.status, 'blocked', `ground must block at clearance ${height} m`);
    assert.ok(result.limitingDistanceM > 0 && Math.abs(result.limitingDistanceM - height) < 1e-6);
  }
});

test('shared mesh uses the a-d diagonal and continuous walk sampling returns facet ground and clearance', () => {
  const mesh = buildTerrainMesh(patch);
  assert.equal(mesh.positionsBodyM.length, patch.grid.rows * patch.grid.cols * 3);
  assert.equal(mesh.triangleIndices.length, (patch.grid.rows - 1) * (patch.grid.cols - 1) * 6);
  const base = (50 * patch.grid.cols + 50) * 3;
  const cellIndex = (50 * (patch.grid.cols - 1) + 50) * 6;
  assert.deepEqual(Array.from(mesh.triangleIndices.slice(cellIndex, cellIndex + 6)),
    [50 * patch.grid.cols + 50, 50 * patch.grid.cols + 51, 51 * patch.grid.cols + 51,
      50 * patch.grid.cols + 50, 51 * patch.grid.cols + 51, 51 * patch.grid.cols + 50]);
  const vertex = [mesh.positionsBodyM[base] / (data.model.referenceRadiusM + patch.grid.heightsM[50][50]),
    mesh.positionsBodyM[base + 1] / (data.model.referenceRadiusM + patch.grid.heightsM[50][50]),
    mesh.positionsBodyM[base + 2] / (data.model.referenceRadiusM + patch.grid.heightsM[50][50])];
  const lat = Math.asin(vertex[2]) * 180 / Math.PI, lon = Math.atan2(vertex[1], vertex[0]) * 180 / Math.PI;
  const ground = sampleTerrainContinuous(patch, lat, lon);
  assert.ok(ground);
  assert.ok(Math.hypot(...ground.positionBodyM.map((v, i) => v - mesh.positionsBodyM[base + i])) < 1e-5);
  assert.ok(ground.coverageMarginM > 0);
  const walked = sampleTerrainWalk(patch, lat, lon, 1.7);
  assert.ok(walked);
  assert.ok(Math.abs(Math.hypot(...walked.eyePositionBodyM) - Math.hypot(...walked.positionBodyM) - 1.7) < 1e-8);
  assert.ok(walked.slopeDeg >= 0 && walked.slopeDeg <= 90);
  assert.equal(sampleTerrainContinuous(patch, -80, 0), null);
  assert.equal(sampleTerrainWalk(patch, -80, 0, 1.7), null);
  assert.throws(() => sampleTerrainWalk(patch, lat, lon, Number.NaN), /finite/);
});

test('instant terrain observation follows continuous ground without computing the full profile', () => {
  const result = observeTerrainInstant(data, data.coverage.startEt + 12345.678, site, 1.7, patch);
  assert.ok(result);
  assert.ok(Math.abs(result.sample.groundHeightM - patch.observer.groundHeightM) < 1e-6);
  assert.ok(Math.abs(result.observation.site.heightAboveReferenceSphereM - (result.sample.groundHeightM + 1.7)) < 1e-9);
  assert.ok(['blocked', 'insufficient'].includes(result.sun.status));
  assert.ok(['blocked', 'insufficient'].includes(result.earth.status));
  assert.equal(observeTerrainInstant(data, data.coverage.startEt, { latDeg: -80, lonDeg: 0, heightAboveReferenceSphereM: 0 }, 1.7, patch), null);
});

test('shared mesh omits every cell touching no-data and continuous sampling never bridges it', () => {
  const broken = structuredClone(patch);
  broken.grid.heightsM[50][51] = null;
  broken.grid.positionsM[50][51] = null;
  const intact = buildTerrainMesh(patch), withGap = buildTerrainMesh(broken);
  assert.equal(intact.triangleIndices.length - withGap.triangleIndices.length, 24,
    'one missing vertex invalidates its four adjacent cells, each with two triangles');
  const x = -304000 + (patch.grid.sourceWindow.colOff + 0.5 + 50.5) * 80;
  const y = 304000 - (patch.grid.sourceWindow.rowOff + 0.5 + 50.5) * 80;
  const rho = Math.hypot(x, y), lat = 2 * (Math.atan(rho / (2 * data.model.referenceRadiusM)) - Math.PI / 4) * 180 / Math.PI;
  const lon = Math.atan2(x, y) * 180 / Math.PI;
  assert.equal(sampleTerrainContinuous(broken, lat, lon), null,
    'a point inside a cell whose topology includes the no-data vertex is rejected');
});

test('profile geometry represents measured skyline and cache is stable by site and eye height', () => {
  const profile = terrainHorizonProfile(patch, site, 0, 1);
  assert.equal(profile.samples.length, 360);
  assert.deepEqual(terrainHorizonProfile(patch, site, 0, 1), profile);
  const ground = patch.observer.groundHeightM;
  const phi = site.latDeg * Math.PI / 180, lambda = site.lonDeg * Math.PI / 180;
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  const eye = up.map(v => v * (data.model.referenceRadiusM + ground));
  const ridge = patch.grid.positionsM[0][50];
  const delta = ridge.map((v, i) => v - eye[i]);
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const az = (Math.atan2(dot(delta, east), dot(delta, north)) * 180 / Math.PI + 360) % 360;
  const alt = Math.atan2(dot(delta, up), Math.hypot(dot(delta, east), dot(delta, north))) * 180 / Math.PI;
  const result = analyzeTerrainHorizon(patch, site, 0, az, alt);
  assert.equal(result.status, 'blocked');
  assert.match(result.reason, /intersects the measured PGDA90 terrain mesh/);
  assert.ok(result.limitingDistanceM > 0);
});
