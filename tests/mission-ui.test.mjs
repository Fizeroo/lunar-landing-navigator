import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { etToUtc, utcToEt, validateEphemeris } from '../src/science/index.ts';
import { compareMissionStarts, findMissionWindow } from '../src/science/mission.ts';
import { formatDuration, formatUtcMinute } from '../src/ui/format.ts';
import {
  DAY_SECONDS, DEMO_STEPS, DURATION_PRESETS_HOURS, SLOW_SPEED, SLOW_ZONE_SECONDS, applyWhatIf, demoMismatch, describeCurrent, describeSearch,
  describeWhatIf, experienceStop, formatRequired, formatSpeed, freezeRequest, parseDurationHours, playbackStep, requestKey, validateMissionDemo,
} from '../src/ui/mission.ts';

const data = validateEphemeris(JSON.parse(readFileSync(new URL('../public/data/ephemeris-2026-10_2027-02.json', import.meta.url))));
const fixture = JSON.parse(readFileSync(new URL('../public/data/mission-demo.json', import.meta.url)));
const format = { when: (et) => formatUtcMinute(etToUtc(data, et)), duration: formatDuration };
const coverage = { startEt: data.coverage.startEt, endEt: data.coverage.endEt };
const SITE = { latDeg: -89.67, lonDeg: 129.78, heightAboveReferenceSphereM: 0 };
const request = (overrides = {}) => ({
  site: { ...SITE }, observerHeightM: 0, model: 'reference-sphere', range: { ...coverage }, requiredSeconds: 48 * 3600, condition: 'both',
  currentStartEt: utcToEt(data, '2026-11-16T21:00:00Z'), ...overrides,
});

test('duration presets are 6/12/24/48 h and custom hours are parsed strictly', () => {
  assert.deepEqual([...DURATION_PRESETS_HOURS], [6, 12, 24, 48]);
  assert.equal(parseDurationHours('36'), 36 * 3600);
  assert.equal(parseDurationHours(' 1.5 '), 5400);
  assert.equal(parseDurationHours('0,5'), 1800);
  for (const bad of ['', 'abc', '-3', '0', '1e3', '12h', '1.2.3']) assert.throws(() => parseDurationHours(bad), /Mission duration/);
  assert.equal(formatRequired(48 * 3600), '48 h');
  assert.equal(formatRequired(5400), '1.5 h');
  assert.equal(formatRequired(90), '90 s');
});

test('a frozen baseline cannot be changed, and requestKey tracks every field that affects a result', () => {
  const base = freezeRequest(request());
  assert.throws(() => { base.currentStartEt += 1; }, TypeError);
  assert.throws(() => { base.site.latDeg = 0; }, TypeError);
  assert.throws(() => { base.range.endEt = 0; }, TypeError);
  const key = requestKey(base);
  for (const changed of [{ observerHeightM: 2 }, { requiredSeconds: 3600 }, { condition: 'sun' }, { currentStartEt: base.currentStartEt + 1 },
    { site: { ...SITE, lonDeg: 0 } }, { range: { startEt: coverage.startEt, endEt: coverage.endEt - 1 } }, { model: 'terrain' }]) {
    assert.notEqual(requestKey(request(changed)), key);
  }
  assert.equal(requestKey(request()), key);
});

test('What-if makes exactly one explicit change and leaves the baseline untouched', () => {
  const base = freezeRequest(request());
  const snapshot = JSON.stringify(base);
  const later = applyWhatIf(base, { kind: 'start-plus-1-day' });
  assert.equal(later.currentStartEt, base.currentStartEt + DAY_SECONDS);
  const site = applyWhatIf(base, { kind: 'site', site: { latDeg: -84.6, lonDeg: 31, heightAboveReferenceSphereM: 0 }, siteName: 'Site B' });
  const height = applyWhatIf(base, { kind: 'height', observerHeightM: 2000 });
  for (const [alt, changedKeys] of [[later, ['currentStartEt']], [site, ['site']], [height, ['observerHeightM']]]) {
    for (const key of ['site', 'observerHeightM', 'model', 'range', 'requiredSeconds', 'condition', 'currentStartEt']) {
      const same = JSON.stringify(alt[key]) === JSON.stringify(base[key]);
      assert.equal(same, !changedKeys.includes(key), `${key} for ${changedKeys}`);
    }
    // The science module accepts it as a one-axis What-if.
    assert.doesNotThrow(() => compareMissionStarts(data, base, alt));
  }
  assert.equal(JSON.stringify(base), snapshot);
  assert.throws(() => applyWhatIf(base, { kind: 'height', observerHeightM: 0 }), /equals the baseline height/);
  assert.throws(() => applyWhatIf(base, { kind: 'height', observerHeightM: 20000 }), /0 to 10000/);
  assert.throws(() => applyWhatIf(base, { kind: 'site', site: { ...SITE }, siteName: 'same' }), /same coordinates/);
});

test('fixed start that fails is reported as a failure; the shifted start appears only as a separate search result', () => {
  const result = findMissionWindow(data, request());
  const verdict = describeCurrent(result.current, result.request, format);
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.headline, /^No — not from 2026-11-16 21:00 UTC$/);
  assert.match(verdict.detail, /0 of the 48 h needed/);
  assert.doesNotMatch(`${verdict.headline} ${verdict.detail}`, /2026-11-17/);
  const search = describeSearch(result, format);
  assert.match(search.nearest, /^Earliest start that works: 2026-11-17 20:39 UTC, ≈ 23 h 39 min after your start\./);
  assert.match(search.nearest, /ends when Earth sets/);
  assert.ok(search.notes.some((note) => /^Allowed mission starts: 2026-11-17 20:39 UTC to 2026-11-27 20:48 UTC/.test(note)), search.notes.join(' | '));
});

test('What-if +1 day evaluates the fixed start as written (21:00), not the searched start (20:39)', () => {
  const base = freezeRequest(request());
  const change = { kind: 'start-plus-1-day' };
  const alt = applyWhatIf(base, change);
  const comparison = compareMissionStarts(data, base, alt);
  const text = describeWhatIf(comparison, base, alt, change, format);
  assert.match(text.headline, /start exactly 1 UTC day later \(2026-11-17 21:00 UTC\)\? The change makes the mission fit\./);
  assert.match(text.baseline, /^Baseline — No — not from 2026-11-16 21:00 UTC/);
  assert.match(text.alternative, /^With the change — Yes — 48 h fits from 2026-11-17 21:00 UTC/);
  assert.match(text.alternative, /It ends at 2026-11-29 20:48 UTC, when Earth sets/);
  assert.match(text.delta, /^Gain: ≈ 12 d more continuous time/);
  assert.match(text.limit, /Limiting factor with the change: Earth sets/);
  assert.match(text.limit, /not power, a radio link or landing safety/);
  assert.doesNotMatch(JSON.stringify(text), /20:39/);
});

test('small and negative What-if deltas are reported as they are, never as "no difference"', () => {
  const base = freezeRequest(request({ currentStartEt: utcToEt(data, '2026-11-18T00:00:00Z') }));
  const change = { kind: 'height', observerHeightM: 2 };
  const alt = applyWhatIf(base, change);
  const live = compareMissionStarts(data, base, alt);
  const withDelta = (delta) => describeWhatIf({ ...live, deltaAvailableSeconds: delta }, base, alt, change, format).delta;
  assert.match(withDelta(20), /^Gain: 20 s more/);
  assert.match(withDelta(-4.25), /^Loss: 4\.3 s less|^Loss: 4\.2 s less/);
  assert.match(withDelta(-7200), /^Loss: ≈ 2 h less/);
  assert.equal(withDelta(0), 'No difference in available continuous time.');
  // Height really changes the fixed-start result for the tangent-plane model only slightly, but not by zero.
  assert.notEqual(live.deltaAvailableSeconds, 0);
});

test('a search range shorter than the mission is a valid no-fit blamed on the range, with the longest span and bounded advice', () => {
  const range = { startEt: utcToEt(data, '2026-11-18T00:00:00Z'), endEt: utcToEt(data, '2026-11-19T00:00:00Z') };
  const result = findMissionWindow(data, request({ range, currentStartEt: utcToEt(data, '2026-11-18T06:00:00Z') }));
  assert.equal(result.windows.length, 0);
  const verdict = describeCurrent(result.current, result.request, format);
  assert.equal(verdict.tone, 'fail');
  assert.match(verdict.headline, /does not fit inside the search range/);
  assert.match(verdict.detail, /The range, not the physical conditions, prevents it\./);
  assert.equal(verdict.limit, 'the selected search range');
  const search = describeSearch(result, format);
  assert.match(search.nearest, /^No window of 48 h exists in the search range\. The longest continuous span is ≈ 24 h/);
  assert.match(search.nearest, /the selected search range ends — not a physical end/);
  assert.doesNotMatch(search.nearest, /sets/);
  assert.ok(search.notes.some((note) => /shorten the mission or try another site/.test(note)));
  assert.doesNotMatch(search.notes.join(' '), /widen/);
});

test('a start inside a suitable window says yes with the spare time and the physical end', () => {
  const result = findMissionWindow(data, request({ currentStartEt: utcToEt(data, '2026-11-20T00:00:00Z') }));
  const verdict = describeCurrent(result.current, result.request, format);
  assert.equal(verdict.tone, 'ok');
  assert.match(verdict.headline, /^Yes — 48 h fits from 2026-11-20 00:00 UTC$/);
  assert.match(verdict.detail, /48 h needed, ≈ \d+ d( \d+ h)? to spare\. It ends at 2026-11-29 20:48 UTC, when Earth sets/);
  assert.match(describeSearch(result, format).nearest, /^Your start already lies in a suitable window/);
});

test('no later window: earlier windows are mentioned, and nothing claims a future start', () => {
  const result = findMissionWindow(data, request({ currentStartEt: utcToEt(data, '2027-01-31T12:00:00Z'), requiredSeconds: 10 * 86400 }));
  assert.equal(result.nearest, null);
  assert.ok(result.windows.length > 0);
  const search = describeSearch(result, format);
  assert.match(search.nearest, /^No suitable start at or after your start inside the search range\. \d+ earlier windows? in the range would fit 240 h/);
  assert.ok(search.notes.some((note) => /^Allowed mission starts in that earlier window:/.test(note)));
});

test('the last instant of the data and a start outside the data are explicit failures', () => {
  const edge = describeCurrent({ startEt: coverage.endEt, conditionMetAtStart: true, availableSeconds: 0, requirementMet: false, fitsSearchRange: false, spareSeconds: -3600, endEt: coverage.endEt, endReason: 'data-coverage-end' }, request({ requiredSeconds: 3600 }), format);
  assert.equal(edge.tone, 'fail');
  assert.match(edge.headline, /^No — the prepared data ends at 2027-02-01 00:00 UTC$/);
  assert.match(edge.detail, /Nothing is extrapolated/);
  const outside = describeCurrent({ startEt: coverage.startEt, conditionMetAtStart: false, availableSeconds: 0, requirementMet: false, fitsSearchRange: false, spareSeconds: -3600, endEt: null, endReason: 'outside-data' }, request(), format);
  assert.match(outside.detail, /outside the prepared data.*Nothing was shifted/);
});

test('terrain search is refused by the science module with the contract message; the UI has no fallback path', () => {
  assert.throws(() => findMissionWindow(data, request({ model: 'terrain' })),
    /Terrain mission-window search is unavailable: local DEM coverage cannot certify continuous visibility\. Explicitly choose Reference sphere\./);
  assert.throws(() => applyWhatIf(freezeRequest(request({ model: 'terrain' })), { kind: 'height', observerHeightM: -1 }));
});

test('Experience pause point: the physical end, or the search-range edge when that comes first', () => {
  const start = utcToEt(data, '2026-11-17T21:00:00Z');
  const full = findMissionWindow(data, request({ currentStartEt: start }));
  const stop = experienceStop(full.current, full.request, format);
  assert.equal(stop.et, full.current.endEt);
  assert.equal(stop.lookAt, 'earth');
  assert.match(stop.heading, /^Playing toward Earthset at 2026-11-29 20:48 UTC$/);
  assert.match(stop.reached, /Earth just went below the reference horizon, so the window ended/);

  const range = { startEt: utcToEt(data, '2026-11-17T00:00:00Z'), endEt: utcToEt(data, '2026-11-22T00:00:00Z') };
  const clipped = findMissionWindow(data, request({ currentStartEt: start, range }));
  assert.equal(clipped.current.endEt, full.current.endEt, 'science keeps the full-data physical end');
  const edge = experienceStop(clipped.current, clipped.request, format);
  assert.equal(edge.et, range.endEt);
  assert.equal(edge.lookAt, null);
  assert.match(edge.heading, /end of the selected search range at 2026-11-22 00:00 UTC/);
  assert.match(edge.reached, /Nothing set .* range edge, not a physical end/);
  assert.doesNotMatch(`${edge.heading} ${edge.reached}`, /Earthset|sunset/i);
});

test('Experience pause point when the condition is not met: the next window start, or none', () => {
  const result = findMissionWindow(data, request());
  assert.equal(result.current.conditionMetAtStart, false);
  assert.equal(experienceStop(result.current, result.request, format), null);
  const next = experienceStop(result.current, result.request, format, result.nearest.startEt);
  assert.equal(next.et, result.nearest.startEt);
  assert.match(next.reached, /the next window found by the search begins here/);
  assert.equal(experienceStop(result.current, result.request, format, result.current.startEt - 5), null);
});

test('accelerated playback never passes the pause point, slows down before it and lands exactly on it', () => {
  const stop = 1_000_000;
  let et = stop - 3 * 86400;
  let slowedSeen = false;
  let steps = 0;
  for (;;) {
    const step = playbackStep(et, 0.05, 86400, stop);
    assert.ok(step.et <= stop && step.et >= et);
    if (step.slowed) {
      slowedSeen = true;
      assert.equal(step.speed, SLOW_SPEED);
      assert.ok(stop - et <= SLOW_ZONE_SECONDS + 1e-6);
    } else {
      // Full speed never jumps into the middle of the slow zone.
      assert.ok(stop - step.et >= SLOW_ZONE_SECONDS - 1e-6 || step.reachedStop);
    }
    et = step.et;
    steps += 1;
    if (step.reachedStop) break;
    assert.ok(steps < 100000);
  }
  assert.equal(et, stop);
  assert.ok(slowedSeen);
  // A slow chosen speed is not slowed further; without a pause point time runs freely.
  assert.deepEqual(playbackStep(0, 1, 300, 1000), { et: 300, speed: 300, slowed: false, reachedStop: false });
  assert.deepEqual(playbackStep(0, 1, 3600, null), { et: 3600, speed: 3600, slowed: false, reachedStop: false });
  assert.deepEqual(playbackStep(2000, 1, 3600, 1000), { et: 5600, speed: 3600, slowed: false, reachedStop: false });
  assert.equal(formatSpeed(21600), '6 h per second');
  assert.equal(formatSpeed(86400), '1 d per second');
  assert.equal(formatSpeed(600), '10 min per second');
});

test('guided demo: the prepared fixture is valid and agrees with a live calculation', () => {
  const demo = validateMissionDemo(fixture);
  assert.deepEqual([...DEMO_STEPS], ['select', 'failure', 'change', 'result', 'surface']);
  assert.equal(demo.datasetId, data.id);
  assert.equal(demo.change.kind, 'start-plus-1-day');
  const base = freezeRequest({
    site: demo.baseline.site, observerHeightM: demo.baseline.observerHeightM, model: demo.baseline.model,
    range: { startEt: utcToEt(data, demo.baseline.rangeStartUtc), endEt: utcToEt(data, demo.baseline.rangeEndUtc) },
    requiredSeconds: demo.baseline.requiredSeconds, condition: demo.baseline.condition, currentStartEt: utcToEt(data, demo.baseline.startUtc),
  });
  const alt = applyWhatIf(base, demo.change);
  const live = compareMissionStarts(data, base, alt);
  assert.equal(demoMismatch('Baseline', live.baseline, demo.expected.baseline), null);
  assert.equal(demoMismatch('Changed case', live.alternative, demo.expected.alternative), null);
  assert.equal(live.baseline.requirementMet, false);
  assert.equal(live.alternative.requirementMet, true);
  // A fixture that disagrees with the live science is detected, not displayed.
  assert.match(demoMismatch('Baseline', live.baseline, { ...demo.expected.baseline, requirementMet: true }), /differs from the prepared demo/);
  assert.match(demoMismatch('Changed case', live.alternative, { ...demo.expected.alternative, availableSeconds: demo.expected.alternative.availableSeconds + 5 }), /more than 1 second/);
  assert.match(demoMismatch('Changed case', live.alternative, { ...demo.expected.alternative, endReason: 'sunset' }), /end reason/);
});

test('guided demo fixture validation rejects malformed input with English reasons', () => {
  const clone = () => JSON.parse(JSON.stringify(fixture));
  const cases = [
    [(f) => { f.version = 2; }, /unsupported fixture version/],
    [(f) => { delete f.datasetId; }, /datasetId/],
    [(f) => { f.baseline.model = 'terrain'; }, /only the reference-sphere model/],
    [(f) => { f.baseline.condition = 'moon'; }, /condition/],
    [(f) => { f.baseline.requiredSeconds = 0; }, /requiredSeconds/],
    [(f) => { f.baseline.startUtc = '2026-11-16 21:00'; }, /startUtc must be UTC/],
    [(f) => { f.baseline.site.latDeg = -95; }, /latDeg/],
    [(f) => { f.baseline.observerHeightM = -1; }, /observerHeightM/],
    [(f) => { f.change = { kind: 'teleport' }; }, /change\.kind/],
    [(f) => { delete f.expected.alternative; }, /expected\.alternative/],
  ];
  for (const [mutate, pattern] of cases) {
    const bad = clone();
    mutate(bad);
    assert.throws(() => validateMissionDemo(bad), pattern);
  }
  assert.throws(() => validateMissionDemo(null), /Guided demo/);
  const extra = clone();
  extra.baseline.siteName = '<b>x</b>'.repeat(40);
  assert.ok(validateMissionDemo(extra).baseline.siteName.length <= 60);
});
