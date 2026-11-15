import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateEphemeris, utcToEt } from '../../src/science/index.ts';
import { findMissionWindow, compareMissionStarts } from '../../src/science/mission.ts';

const R = 1_737_400;
const site = { latDeg: 0, lonDeg: 0, heightAboveReferenceSphereM: 0 };
function syntheticData(sun = null, earth = null) {
  const valueAt = (time, span) => {
    if (!span) return -1;
    const [start, end] = span;
    if (time < start) return -1;
    if (time === start) return start === 0 ? 1 : 0;
    if (time < end) return 1;
    if (time === end) return end === 100 ? 1 : 0;
    return -1;
  };
  return {
    coverage: { startEt: 0, endEt: 100 }, model: { referenceRadiusM: R },
    samples: Array.from({ length: 11 }, (_, i) => {
      const et = i * 10;
      return { et, sunM: [R + valueAt(et, sun), 0, 0], earthM: [R + valueAt(et, earth), 0, 0] };
    }),
  };
}
function request(data, overrides = {}) {
  return { site, observerHeightM: 0, model: 'reference-sphere', range: { ...data.coverage },
    requiredSeconds: 20, condition: 'sun', currentStartEt: 10, ...overrides };
}

test('inclusive exact-duration starts, too-short spans and no-condition spans', () => {
  const data = syntheticData([10, 50]);
  const exact = findMissionWindow(data, request(data, { requiredSeconds: 40 }));
  assert.equal(exact.windows.length, 1);
  assert.deepEqual(exact.windows[0].allowedStart, { startEt: 10, endEt: 10 });
  assert.equal(exact.current.conditionMetAtStart, true, 'the interval start is an admissible planning boundary');
  assert.equal(exact.current.requirementMet, true);
  const roundoffData = syntheticData([10, 30]);
  roundoffData.samples[3].sunM[0] = R - 5e-8;
  const roundoff = findMissionWindow(roundoffData, request(roundoffData, { requiredSeconds: 20 }));
  assert.equal(roundoff.windows.length, 1, 'sub-microsecond ET roundoff at exact duration is tolerated');
  assert.ok(roundoff.windows[0].spareSeconds < 0 && roundoff.windows[0].spareSeconds > -1e-6);
  const short = findMissionWindow(data, request(data, { requiredSeconds: 41 }));
  assert.equal(short.windows.length, 0);
  assert.equal(short.longest.availableSeconds, 40);
  assert.equal(short.longest.spareSeconds, -1);
  const none = findMissionWindow(syntheticData(), request(syntheticData(), { currentStartEt: 10 }));
  assert.equal(none.windows.length, 0); assert.equal(none.longest, null);
  assert.equal(none.current.endReason, 'conditions-not-met');
});

test('range and coverage clipping preserve physical end attribution and overlong search requirements', () => {
  const data = syntheticData([10, 50], [20, 70]);
  const selected = findMissionWindow(data, request(data, { range: { startEt: 30, endEt: 60 }, condition: 'both', requiredSeconds: 20 }));
  assert.equal(selected.windows.length, 1);
  assert.equal(selected.windows[0].startClipped, true);
  assert.equal(selected.windows[0].endClipped, false);
  assert.equal(selected.windows[0].endReason, 'sunset');
  const rangeCut = findMissionWindow(data, request(data, { range: { startEt: 0, endEt: 40 }, requiredSeconds: 20, currentStartEt: 15 }));
  assert.equal(rangeCut.windows[0].endClipped, true);
  assert.equal(rangeCut.windows[0].endReason, 'search-range-end');
  assert.equal(rangeCut.current.availableSeconds, 35, 'current availability is from full-data physical spans');
  assert.equal(rangeCut.current.requirementMet, true);
  const tooLong = findMissionWindow(data, request(data, { range: { startEt: 20, endEt: 30 }, requiredSeconds: 40 }));
  assert.equal(tooLong.windows.length, 0, 'duration may exceed search range without rejecting the request');
  assert.equal(tooLong.longest.availableSeconds, 10);
  assert.equal(tooLong.current.fitsSearchRange, false);
  const coverage = syntheticData([0, 100]);
  const dataCut = findMissionWindow(coverage, request(coverage, { requiredSeconds: 20, currentStartEt: 0 }));
  assert.equal(dataCut.windows[0].startClipped, true);
  assert.equal(dataCut.windows[0].endClipped, true);
  assert.equal(dataCut.windows[0].endReason, 'data-coverage-end');
  assert.equal(dataCut.current.endReason, 'data-coverage-end');
});

test('condition-specific ends, fixed-start current evaluation and exact search coverage', () => {
  const both = syntheticData([10, 50], [10, 50]);
  assert.equal(findMissionWindow(both, request(both, { condition: 'both' })).windows[0].endReason, 'both-set');
  const earth = syntheticData([0, 100], [10, 70]);
  assert.equal(findMissionWindow(earth, request(earth, { condition: 'earth' })).windows[0].endReason, 'earthset');
  const data = syntheticData([10, 50]);
  const outsideSearch = findMissionWindow(data, request(data, { range: { startEt: 20, endEt: 40 }, currentStartEt: 15, requiredSeconds: 20 }));
  assert.equal(outsideSearch.current.conditionMetAtStart, true);
  assert.equal(outsideSearch.current.availableSeconds, 35);
  assert.equal(outsideSearch.current.fitsSearchRange, false);
  assert.equal(outsideSearch.current.requirementMet, false);
  assert.equal(outsideSearch.nearest.startEt, 20);
  assert.equal(outsideSearch.recommendedStartEt, 20);
  const rangeOverrun = findMissionWindow(data, request(data, { range: { startEt: 10, endEt: 30 }, currentStartEt: 15, requiredSeconds: 20 }));
  assert.equal(rangeOverrun.current.fitsSearchRange, false);
  assert.equal(rangeOverrun.current.availableSeconds, 35);
  assert.equal(rangeOverrun.current.endEt, 50);
  assert.equal(rangeOverrun.current.endReason, 'sunset', 'search failure must not relabel the physical availability endpoint');
  const outsideData = findMissionWindow(data, request(data, { currentStartEt: -1 }));
  assert.equal(outsideData.current.endReason, 'outside-data');
  assert.equal(outsideData.current.availableSeconds, 0);
  const future = findMissionWindow(data, request(data, { currentStartEt: 30 }));
  assert.equal(future.current.availableSeconds, 20);
  assert.equal(future.current.requirementMet, true);
  assert.equal(future.recommendedStartEt, 30);
});

test('positive condition at the exact dataset endpoint is known-up with zero known duration', () => {
  const data = syntheticData([0, 100], [0, 100]);
  const atEnd = findMissionWindow(data, request(data, { condition: 'both', currentStartEt: data.coverage.endEt }));
  assert.equal(atEnd.current.conditionMetAtStart, true);
  assert.equal(atEnd.current.availableSeconds, 0);
  assert.equal(atEnd.current.requirementMet, false);
  assert.equal(atEnd.current.fitsSearchRange, false);
  assert.equal(atEnd.current.endEt, data.coverage.endEt);
  assert.equal(atEnd.current.endReason, 'data-coverage-end');
  const oneMicrosecondEarlier = findMissionWindow(data, request(data, { currentStartEt: data.coverage.endEt - 1e-6 }));
  assert.equal(oneMicrosecondEarlier.current.conditionMetAtStart, true);
  assert.ok(oneMicrosecondEarlier.current.availableSeconds > 0);
  const belowData = syntheticData([0, 90]);
  const belowAtEnd = findMissionWindow(belowData, request(belowData, { currentStartEt: 100 }));
  assert.equal(belowAtEnd.current.conditionMetAtStart, false);
  assert.equal(belowAtEnd.current.endReason, 'conditions-not-met');
});

test('height changes availability and compareMissionStarts preserves and evaluates both fixed starts', () => {
  const data = syntheticData([0, 100]);
  const baseline = request(data, { currentStartEt: 10, requiredSeconds: 20 });
  const alternative = { ...baseline, observerHeightM: 100 };
  const beforeA = structuredClone(baseline), beforeB = structuredClone(alternative);
  const comparison = compareMissionStarts(data, baseline, alternative);
  assert.deepEqual(baseline, beforeA); assert.deepEqual(alternative, beforeB);
  assert.equal(comparison.baseline.availableSeconds, 90);
  assert.equal(comparison.alternative.availableSeconds, 0);
  assert.equal(comparison.deltaAvailableSeconds, -90);
  assert.equal(comparison.alternative.endReason, 'conditions-not-met');
  const shifted = { ...baseline, currentStartEt: 30 };
  const timeChange = compareMissionStarts(data, baseline, shifted);
  assert.equal(timeChange.alternative.startEt, 30);
  assert.equal(timeChange.alternative.availableSeconds, 70);
  const siteChange = compareMissionStarts(data, baseline, { ...baseline, site: { latDeg: 90, lonDeg: 0, heightAboveReferenceSphereM: 0 } });
  assert.equal(siteChange.alternative.availableSeconds, 0);
  assert.throws(() => compareMissionStarts(data, baseline, { ...alternative, currentStartEt: 30 }), /exactly one/);
  assert.throws(() => compareMissionStarts(data, baseline, { ...baseline, requiredSeconds: 10 }), /preserve duration/);
});

test('validation rejects invalid requests and unsupported terrain explicitly', () => {
  const data = syntheticData([10, 50]);
  const base = request(data);
  assert.throws(() => findMissionWindow(data, { ...base, model: 'terrain' }), /Terrain mission-window search is unavailable: local DEM coverage cannot certify continuous visibility/);
  assert.throws(() => findMissionWindow(data, { ...base, observerHeightM: 10001 }), /Observer height/);
  assert.throws(() => findMissionWindow(data, { ...base, requiredSeconds: 0.5 }), /Required duration/);
  assert.throws(() => findMissionWindow(data, { ...base, requiredSeconds: 101 }), /full dataset duration/);
  assert.throws(() => findMissionWindow(data, { ...base, range: { startEt: -1, endEt: 20 } }), /within ephemeris coverage/);
  assert.throws(() => findMissionWindow(data, { ...base, currentStartEt: NaN }), /finite/);
  assert.throws(() => findMissionWindow(data, { ...base, site: { ...site, latDeg: 91 } }), /planetocentric/);
});

test('real Shackleton demo fails at the fixed start and succeeds only after explicit plus-one-day change', () => {
  const data = validateEphemeris(JSON.parse(readFileSync(new URL('../../public/data/ephemeris-2026-10_2027-02.json', import.meta.url), 'utf8')));
  const demo = JSON.parse(readFileSync(new URL('../../public/data/mission-demo.json', import.meta.url), 'utf8'));
  assert.equal(demo.version, 1); assert.equal(demo.datasetId, data.id);
  assert.equal(demo.baseline.siteName, 'Shackleton-area illustrative point');
  const range = { startEt: data.coverage.startEt, endEt: data.coverage.endEt };
  const baseline = { site: demo.baseline.site, observerHeightM: demo.baseline.observerHeightM, model: demo.baseline.model, range,
    requiredSeconds: demo.baseline.requiredSeconds, condition: demo.baseline.condition,
    currentStartEt: utcToEt(data, demo.baseline.startUtc) };
  const alternative = { ...baseline, currentStartEt: utcToEt(data, demo.change.startUtc) };
  assert.equal(demo.baseline.rangeStartUtc, data.coverage.startUtc);
  assert.equal(demo.baseline.rangeEndUtc, data.coverage.endUtc);
  assert.equal(demo.change.kind, 'start-plus-1-day');
  const comparison = compareMissionStarts(data, baseline, alternative);
  const baselineResult = findMissionWindow(data, baseline), alternativeResult = findMissionWindow(data, alternative);
  assert.equal(comparison.baseline.requirementMet, false);
  assert.equal(comparison.baseline.conditionMetAtStart, false);
  assert.equal(comparison.baseline.availableSeconds, 0);
  assert.equal(comparison.alternative.requirementMet, true);
  assert.equal(comparison.alternative.conditionMetAtStart, true);
  assert.equal(alternativeResult.current.availableSeconds, 1_036_066.5514421463);
  assert.deepEqual({ requirementMet: comparison.baseline.requirementMet, availableSeconds: comparison.baseline.availableSeconds, endReason: comparison.baseline.endReason }, demo.expected.baseline);
  assert.deepEqual({ requirementMet: comparison.alternative.requirementMet, availableSeconds: comparison.alternative.availableSeconds, endReason: comparison.alternative.endReason }, demo.expected.alternative);
  assert.ok(baselineResult.recommendedStartEt !== null);
  assert.equal(alternativeResult.recommendedStartEt, alternative.currentStartEt);
  assert.equal(comparison.deltaAvailableSeconds, 1_036_066.5514421463);
});
