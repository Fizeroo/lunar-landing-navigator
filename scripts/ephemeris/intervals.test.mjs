import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateEphemeris, observeAt } from '../../src/science/index.ts';
import { analyzeSite, intersectIntervals } from '../../src/science/intervals.ts';

const raw = JSON.parse(readFileSync(new URL('../../public/data/ephemeris-2026-11.json', import.meta.url), 'utf8'));
const data = validateEphemeris(raw);
const site = { latDeg: 0, lonDeg: 0, heightAboveReferenceSphereM: 0 };
const R = data.model.referenceRadiusM;
function synthetic(signs, earthSigns = signs.map(([et]) => [et, -1e9])) {
  const samples = signs.map(([et, g], i) => ({ et, utc: '2026-11-01T00:00:00Z', sunM: [R + g, 0, 0], earthM: [R + earthSigns[i][1], 0, 0] }));
  return { model: data.model, coverage: { startEt: samples[0].et, endEt: samples.at(-1).et }, samples };
}
function closeIntervals(actual, expected, epsilon = 1e-8) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i].startEt - expected[i][0]) <= epsilon, `start ${i}: ${actual[i].startEt}`);
    assert.ok(Math.abs(actual[i].endEt - expected[i][1]) <= epsilon, `end ${i}: ${actual[i].endEt}`);
  }
}

test('detects arbitrarily short positive intervals around a sample node', () => {
  const result = analyzeSite(synthetic([[0, -1e8], [600, 1e5], [1200, -1e8]]), site, { startEt: 0, endEt: 1200 });
  closeIntervals(result.sun.intervals, [[600 - (600 * 1e5 / (1e8 + 1e5)), 600 + (600 * 1e5 / (1e8 + 1e5))]], 1e-7);
  assert.ok(result.sun.totalSeconds < 2);
  assert.equal(result.both.totalSeconds, 0);
});

test('strict positive sign excludes isolated zero contacts and all-period boundaries', () => {
  const tangent = analyzeSite(synthetic([[0, -1], [300, 0], [600, -1]]), site, { startEt: 0, endEt: 600 });
  assert.deepEqual(tangent.sun.intervals, []);
  const positiveNode = analyzeSite(synthetic([[0, 1], [300, 0], [600, 1]]), site, { startEt: 0, endEt: 600 });
  closeIntervals(positiveNode.sun.intervals, [[0, 300], [300, 600]]);
  assert.equal(positiveNode.sun.totalSeconds, 600);
  assert.equal(positiveNode.sun.longestSeconds, 300);
  assert.equal(positiveNode.sun.fraction, 1);
});

test('strict-positive zero contact splits both and shared longest spans', () => {
  const result = analyzeSite(synthetic([[0, 1], [300, 0], [600, 1]], [[0, 1], [300, 1], [600, 1]]), site, { startEt: 0, endEt: 600 });
  closeIntervals(result.sun.intervals, [[0, 300], [300, 600]]);
  closeIntervals(result.both.intervals, [[0, 300], [300, 600]]);
  assert.equal(result.sun.totalSeconds, 600);
  assert.equal(result.both.totalSeconds, 600);
  assert.equal(result.sun.longestSeconds, 300);
  assert.equal(result.both.longestSeconds, 300);
});

test('preserves genuinely short negative gaps between positive spans', () => {
  const result = analyzeSite(synthetic([[0, 1e8], [300, -1], [600, 1e8]]), site, { startEt: 0, endEt: 600 });
  assert.equal(result.sun.intervals.length, 2);
  assert.ok(result.sun.intervals[0].endEt < result.sun.intervals[1].startEt);
  assert.ok(result.sun.intervals[1].startEt - result.sun.intervals[0].endEt < 0.001);
  assert.ok(result.sun.longestSeconds < result.sun.totalSeconds);
});

test('clips at arbitrary period bounds and handles empty/all-positive conditions', () => {
  const source = synthetic([[0, -100], [600, 100], [1200, 100]]);
  const result = analyzeSite(source, site, { startEt: 250, endEt: 900 });
  closeIntervals(result.sun.intervals, [[300, 900]]);
  assert.equal(result.sun.totalSeconds, 600);
  assert.equal(result.sun.fraction, 600 / 650);
  const none = analyzeSite(synthetic([[0, -1], [600, -1]]), site, { startEt: 100, endEt: 500 });
  assert.deepEqual(none.sun, { intervals: [], totalSeconds: 0, fraction: 0, longestSeconds: 0 });
  const all = analyzeSite(synthetic([[0, 1], [600, 1]]), site, { startEt: 100, endEt: 500 });
  assert.deepEqual(all.sun, { intervals: [{ startEt: 100, endEt: 500 }], totalSeconds: 400, fraction: 1, longestSeconds: 400 });
});

test('intersects sorted spans and excludes zero-duration contacts without merging adjacent spans', () => {
  closeIntervals(intersectIntervals([{ startEt: 0, endEt: 2 }, { startEt: 4, endEt: 8 }],
    [{ startEt: 2, endEt: 5 }, { startEt: 6, endEt: 9 }]), [[4, 5], [6, 8]]);
  closeIntervals(intersectIntervals([{ startEt: 0, endEt: 2 }, { startEt: 2, endEt: 4 }],
    [{ startEt: 1, endEt: 3 }]), [[1, 2], [2, 3]]);
  assert.deepEqual(intersectIntervals([], [{ startEt: 1, endEt: 2 }]), []);
});

test('period must be finite, positive and within actual data coverage; site must be h=0', () => {
  for (const period of [{ startEt: 5, endEt: 5 }, { startEt: NaN, endEt: 6 },
    { startEt: data.coverage.startEt - 1, endEt: data.coverage.startEt + 1 },
    { startEt: data.coverage.endEt - 1, endEt: data.coverage.endEt + 1 }]) assert.throws(() => analyzeSite(data, site, period));
  assert.throws(() => analyzeSite(data, { ...site, heightAboveReferenceSphereM: 1 }, { startEt: data.coverage.startEt, endEt: data.coverage.startEt + 1 }));
});

test('actual dataset interval summaries agree with a dense independent observation oracle', () => {
  const period = { startEt: data.coverage.startEt + 123.25, endEt: data.coverage.endEt - 234.75 };
  const analysis = analyzeSite(data, { ...site, latDeg: -89.5, lonDeg: 0 }, period);
  const duration = period.endEt - period.startEt, step = 30;
  let sunSeconds = 0, earthSeconds = 0, bothSeconds = 0;
  for (let start = period.startEt; start < period.endEt; start += step) {
    const end = Math.min(period.endEt, start + step), mid = (start + end) / 2;
    const obs = observeAt(data, mid, analysis.site), width = end - start;
    if (obs.sun.altDeg > 0) sunSeconds += width;
    if (obs.earth.altDeg > 0) earthSeconds += width;
    if (obs.sun.altDeg > 0 && obs.earth.altDeg > 0) bothSeconds += width;
  }
  for (const [summary, oracle] of [[analysis.sun, sunSeconds], [analysis.earth, earthSeconds], [analysis.both, bothSeconds]]) {
    assert.ok(Math.abs(summary.totalSeconds - oracle) <= 31, `${summary.totalSeconds} vs ${oracle}`);
    assert.ok(Math.abs(summary.fraction - oracle / duration) <= 31 / duration);
    assert.ok(summary.longestSeconds <= summary.totalSeconds);
  }
  assert.deepEqual(analysis.both.intervals, intersectIntervals(analysis.sun.intervals, analysis.earth.intervals));
});
