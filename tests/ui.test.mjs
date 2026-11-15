import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compassPoint, formatDuration, formatLatLon, formatPercent, formatSignedDeg, formatUtcMinute, formatUtcSecond } from '../src/ui/format.ts';
import { ALTITUDE_GRID_DEG, altitudeToUnit, azimuthToUnit } from '../src/ui/skyProjection.ts';
import { SAME_THRESHOLD_POINTS, buildConclusion, compareCondition } from '../src/ui/comparison.ts';
import { CATALOGUE as PRESETS, findCatalogueEntry as findPreset } from '../src/ui/catalogue.ts';
import { validateEphemeris } from '../src/science/index.ts';
import { analyzeSite } from '../src/science/intervals.ts';

test('UTC labels are rounded, explicit and timezone independent', () => {
  assert.equal(formatUtcMinute('2026-11-05T14:31:40.250Z'), '2026-11-05 14:32 UTC');
  assert.equal(formatUtcMinute('2026-11-30T23:59:45Z'), '2026-12-01 00:00 UTC');
  assert.equal(formatUtcSecond('2026-11-05T14:31:40.250Z'), '2026-11-05T14:31:40Z');
  assert.equal(formatUtcSecond('2026-11-05T14:31:40.750Z'), '2026-11-05T14:31:41Z');
  assert.equal(formatUtcMinute('not a date'), 'invalid UTC');
});

test('durations are approximate and never negative', () => {
  assert.equal(formatDuration(0), 'none');
  assert.equal(formatDuration(-5), 'none');
  assert.equal(formatDuration(20), '< 1 min');
  assert.equal(formatDuration(12 * 60), '≈ 12 min');
  assert.equal(formatDuration(5 * 3600 + 12 * 60), '≈ 5 h 12 min');
  assert.equal(formatDuration(3 * 3600), '≈ 3 h');
  assert.equal(formatDuration(6 * 86400 + 13 * 3600), '≈ 6 d 13 h');
  assert.equal(formatDuration(30 * 86400), '≈ 30 d');
});

test('percent, degrees, compass and coordinates', () => {
  assert.equal(formatPercent(0.6214), '62.1%');
  assert.equal(formatPercent(1.2), '100.0%');
  assert.equal(formatPercent(Number.NaN), '—');
  assert.equal(formatSignedDeg(1.234), '+1.23°');
  assert.equal(formatSignedDeg(-0.5), '−0.50°');
  assert.equal(formatSignedDeg(-0.001), '0.00°');
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(359.9), 'N');
  assert.equal(compassPoint(90), 'E');
  assert.equal(compassPoint(126.64), 'SE');
  assert.equal(compassPoint(270), 'W');
  assert.equal(formatLatLon(-89.67, 129.78), '89.6700° S, 129.7800° E');
  assert.equal(formatLatLon(0.67, -11.22), '0.6700° N, 11.2200° W');
});

test('sky projection: horizon at 0, monotonic altitude, wrapped azimuth', () => {
  assert.equal(altitudeToUnit(0), 0);
  assert.equal(altitudeToUnit(90), 1);
  assert.equal(altitudeToUnit(-90), -1);
  assert.equal(altitudeToUnit(120), 1);
  assert.equal(altitudeToUnit(-5), -altitudeToUnit(5));
  let previous = -Infinity;
  for (let alt = -90; alt <= 90; alt += 0.5) {
    const y = altitudeToUnit(alt);
    assert.ok(y > previous, `monotonic at ${alt}`);
    assert.equal(Math.sign(y), Math.sign(alt), 'below-horizon altitudes stay below the horizon line');
    previous = y;
  }
  assert.ok(altitudeToUnit(5) > 5 / 90, 'near-horizon region is enlarged');
  assert.ok(ALTITUDE_GRID_DEG.includes(0));
  assert.equal(azimuthToUnit(0), 0);
  assert.equal(azimuthToUnit(90), 0.25);
  assert.equal(azimuthToUnit(180), 0.5);
  assert.equal(azimuthToUnit(270), 0.75);
  assert.equal(azimuthToUnit(360), 0);
  assert.equal(azimuthToUnit(-90), 0.75);
});

function analysis(fractions, periodSeconds = 100000) {
  const summary = (fraction) => ({
    intervals: fraction > 0 ? [{ startEt: 0, endEt: fraction * periodSeconds }] : [],
    totalSeconds: fraction * periodSeconds,
    fraction,
    longestSeconds: fraction * periodSeconds,
  });
  return {
    site: { latDeg: -89, lonDeg: 0, heightAboveReferenceSphereM: 0 },
    period: { startEt: 0, endEt: periodSeconds },
    sun: summary(fractions[0]),
    earth: summary(fractions[1]),
    both: summary(fractions[2]),
  };
}

test('conclusion is derived from the summaries and names the larger share', () => {
  const a = analysis([0.8, 0.2, 0.1]);
  const b = analysis([0.5, 0.6, 0.1]);
  const [sun, earth, both] = buildConclusion(a, b);
  assert.equal(sun.leader, 'A');
  assert.ok(Math.abs(sun.differencePoints - 30) < 1e-9);
  assert.match(sun.sentence, /^Sun above horizon: Site A 80\.0% of the period, Site B 50\.0% — Site A is 30\.0 points higher \(≈ .* more\)\.$/);
  assert.equal(earth.leader, 'B');
  assert.match(earth.sentence, /^Earth above horizon: Site B 60\.0% of the period, Site A 20\.0% — Site B is 40\.0 points higher/);
  assert.equal(both.leader, 'same');
  assert.match(both.sentence, /about the same share/);
});

test('conclusion handles zero and near-equal cases without declaring a leader', () => {
  const none = compareCondition('both', analysis([0, 0, 0]), analysis([0, 0, 0]));
  assert.equal(none.leader, 'same');
  assert.match(none.sentence, /never during this period at either site/);
  const close = compareCondition('sun', analysis([0.5, 0, 0]), analysis([0.5 + (SAME_THRESHOLD_POINTS - 0.1) / 100, 0, 0]));
  assert.equal(close.leader, 'same');
  const apart = compareCondition('sun', analysis([0.5, 0, 0]), analysis([0.5 + (SAME_THRESHOLD_POINTS + 0.1) / 100, 0, 0]));
  assert.equal(apart.leader, 'B');
});

test('conclusion wording never ranks safety, power or communications', () => {
  for (const verdict of buildConclusion(analysis([0.9, 0.9, 0.9]), analysis([0.1, 0.1, 0.1]))) {
    assert.doesNotMatch(verdict.sentence, /better|best|safer|recommend|power|communicat|link/i);
  }
});

test('presets are valid, sourced and unique', () => {
  const ids = new Set();
  for (const preset of PRESETS) {
    assert.ok(!ids.has(preset.id));
    ids.add(preset.id);
    assert.ok(preset.latDeg >= -90 && preset.latDeg <= 90);
    assert.ok(preset.lonDeg >= -180 && preset.lonDeg < 180);
    assert.match(preset.sourceUrl, /^https:\/\/planetarynames\.wr\.usgs\.gov\/Feature\/\d+$/);
  }
  assert.equal(findPreset('shackleton')?.latDeg, -89.67);
  assert.equal(findPreset('missing'), undefined);
});

test('real data: conclusion numbers equal analyzeSite summaries for the default presets', async () => {
  const data = validateEphemeris(JSON.parse(await readFile(new URL('../public/data/ephemeris-2026-11.json', import.meta.url), 'utf8')));
  const period = { startEt: data.coverage.startEt, endEt: data.coverage.endEt };
  const site = (id) => {
    const preset = findPreset(id);
    return { latDeg: preset.latDeg, lonDeg: preset.lonDeg, heightAboveReferenceSphereM: 0 };
  };
  const a = analyzeSite(data, site('shackleton'), period);
  const b = analyzeSite(data, site('mons-mouton'), period);
  for (const verdict of buildConclusion(a, b)) {
    const fa = a[verdict.condition].fraction;
    const fb = b[verdict.condition].fraction;
    assert.ok(Math.abs(verdict.differencePoints - (fa - fb) * 100) < 1e-9);
    assert.ok(Math.abs(verdict.differenceSeconds - (a[verdict.condition].totalSeconds - b[verdict.condition].totalSeconds)) < 1e-6);
    if (verdict.leader !== 'same') {
      assert.ok(verdict.sentence.includes(formatPercent(fa)) && verdict.sentence.includes(formatPercent(fb)));
      assert.equal(verdict.leader, fa > fb ? 'A' : 'B');
    }
  }
  for (const result of [a, b]) {
    for (const condition of ['sun', 'earth', 'both']) {
      const summary = result[condition];
      const sum = summary.intervals.reduce((total, interval) => total + (interval.endEt - interval.startEt), 0);
      assert.ok(Math.abs(sum - summary.totalSeconds) < 1e-6, 'bars and totals use the same intervals');
      assert.ok(summary.fraction >= 0 && summary.fraction <= 1);
    }
  }
});
