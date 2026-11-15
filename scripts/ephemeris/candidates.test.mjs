import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateEphemeris } from '../../src/science/index.ts';
import { searchCandidatesAsync, generateCandidateSites, preparedCandidateRegion } from '../../src/science/candidates.ts';
import { findMissionWindow } from '../../src/science/mission.ts';
import { observeObserver } from '../../src/science/observer.ts';
import { validateTerrainPatch } from '../../src/science/terrain.ts';

const data = validateEphemeris(JSON.parse(readFileSync(new URL('../../public/data/ephemeris-2026-10_2027-02.json', import.meta.url), 'utf8')));
const patch = validateTerrainPatch(JSON.parse(readFileSync(new URL('../../public/data/terrain-pgda90-southpolar.json', import.meta.url), 'utf8')));
const region = preparedCandidateRegion(patch);
const currentSample = data.samples.reduce((best, row) => Math.abs(Date.parse(row.utc) - Date.parse('2026-11-16T21:00:00Z')) <
  Math.abs(Date.parse(best.utc) - Date.parse('2026-11-16T21:00:00Z')) ? row : best, data.samples[0]);

test('prepared region produces deterministic 25 distinct interior sites with coverage margin', () => {
  const first = generateCandidateSites(region, 5, patch, 160);
  const second = generateCandidateSites(region, 5, patch, 160);
  assert.equal(first.length, 25);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(site => `${site.latDeg}|${site.lonDeg}`)).size, 25);
  assert.ok(first.every(site => site.heightAboveReferenceSphereM === 0));
});

test('25-point search reports current reference lighting separately from honest terrain diagnostics', async () => {
  const sample = currentSample;
  const request = { region, gridSide: 5, minimumCoverageMarginM: 160, observerHeightM: 1.7, currentEt: sample.et };
  const progress = [];
  const start = performance.now();
  const first = await searchCandidatesAsync(data, patch, request, { requestId: 10, batchSize: 5, onProgress: update => progress.push(update) });
  const coldMs = performance.now() - start;
  assert.equal(first.length, 25);
  assert.equal(progress.length, 25);
  assert.equal(progress.at(-1).completed, 25);
  assert.ok(first.every(result => result.terrain.sun.status !== 'clear' && result.terrain.earth.status !== 'clear'));
  for (const result of first) {
    assert.equal(result.slopeScaleM, 80);
    assert.equal(result.reference.site.heightAboveReferenceSphereM, 1.7,
      'reference observation must use the selected observer height, not h=0');
    assert.deepEqual(result.reference, observeObserver(data, sample.et, result.site, 1.7));
    assert.ok(Math.abs(result.terrain.observation.site.heightAboveReferenceSphereM - (result.groundHeightM + 1.7)) < 1e-8,
      'terrain observation uses that same selected clearance above actual DEM ground');
    assert.equal(result.lighting.request.condition, 'both');
    assert.equal(result.lighting.request.requiredSeconds, 1);
    assert.equal(result.lighting.request.currentStartEt, sample.et);
    const direct = findMissionWindow(data, { site: result.site, observerHeightM: 1.7, model: 'reference-sphere',
      range: { ...data.coverage, startEt: data.coverage.startEt, endEt: data.coverage.endEt },
      requiredSeconds: 1, condition: 'both', currentStartEt: sample.et });
    assert.equal(result.lighting.current.availableSeconds, direct.current.availableSeconds);
  }
  const warmStart = performance.now();
  const second = await searchCandidatesAsync(data, patch, request, { requestId: 11, batchSize: 5 });
  const warmMs = performance.now() - warmStart;
  assert.deepEqual(first.map(r => r.id), second.map(r => r.id));
  console.log(`candidate-search-ms cold=${coldMs.toFixed(1)} warm=${warmMs.toFixed(1)} count=${first.length}`);
});

test('async search reports actual evaluated count and rejects cancellation between batches', async () => {
  const sample = currentSample;
  const controller = new AbortController(), progress = [];
  await assert.rejects(searchCandidatesAsync(data, patch, { region, gridSide: 5, minimumCoverageMarginM: 160,
    observerHeightM: 1.7, currentEt: sample.et }, { requestId: 77, batchSize: 1, signal: controller.signal,
    onProgress: update => { progress.push(update); if (update.completed === 1) controller.abort(); } }), { name: 'AbortError' });
  assert.equal(progress.length, 1);
  assert.equal(progress[0].total, 25);
  assert.throws(() => generateCandidateSites(region, 5, patch, Number.NaN), /finite/);
  await assert.rejects(searchCandidatesAsync(data, patch, { region, gridSide: 5, minimumCoverageMarginM: 160,
    observerHeightM: 1.7, currentEt: data.coverage.endEt + 1 }, { requestId: 78 }), /within prepared ephemeris coverage/);
});
