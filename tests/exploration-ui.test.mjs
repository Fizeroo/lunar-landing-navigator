import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { bodyToLocalScene, headingPitchToLocal, localToHeadingPitch } from '../src/scene/coords.ts';
import { CATALOGUE, CATALOGUE_GROUPS, entriesInGroup, findCatalogueEntry } from '../src/ui/catalogue.ts';
import { formatCountdown, formatHeight } from '../src/ui/format.ts';
import {
  MAX_SCENARIOS,
  addDaysUtc,
  decodeScenarioFragment,
  defaultScenarios,
  encodeScenarioFragment,
  fitWindow,
  isStrictUtc,
  parseScenarioSet,
  serializeScenarioSet,
  validateScenario,
  validateScenarioSet,
} from '../src/ui/scenario.ts';
import { utcToEt, validateEphemeris } from '../src/science/index.ts';
import { getUpcomingEvents } from '../src/science/events.ts';
import { analyzeObserver, observeObserver } from '../src/science/observer.ts';

const data = validateEphemeris(JSON.parse(await readFile(new URL('../public/data/ephemeris-2026-10_2027-02.json', import.meta.url), 'utf8')));

const scenario = (overrides = {}) => ({
  version: 1,
  id: 'abc-1',
  name: 'A — now',
  site: { latDeg: -89.67, lonDeg: 129.78, heightAboveReferenceSphereM: 0 },
  startUtc: '2026-11-15T12:00:00Z',
  durationSeconds: 7 * 86400,
  observerHeightM: 0,
  model: 'reference-sphere',
  datasetId: data.id,
  ...overrides,
});

test('catalogue: valid coordinates, unique ids, gazetteer source for every entry, three labelled groups', () => {
  const ids = new Set();
  for (const entry of CATALOGUE) {
    assert.ok(!ids.has(entry.id), `duplicate ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.latDeg >= -90 && entry.latDeg <= 90);
    assert.ok(entry.lonDeg >= -180 && entry.lonDeg < 180);
    assert.match(entry.sourceUrl, /^https:\/\/planetarynames\.wr\.usgs\.gov\/Feature\/\d+$/);
    assert.ok(entry.kind && entry.note);
    assert.ok(CATALOGUE_GROUPS.some((group) => group.id === entry.group));
  }
  assert.deepEqual(CATALOGUE_GROUPS.map((group) => group.id), ['south-pole', 'historical', 'clps']);
  for (const group of CATALOGUE_GROUPS) {
    assert.ok(entriesInGroup(group.id).length > 0);
    assert.match(group.contextUrl, /^https:\/\//);
  }
  assert.equal(findCatalogueEntry('shackleton')?.latDeg, -89.67);
  assert.equal(findCatalogueEntry('haworth'), undefined);
});

test('scenario validation keeps only public fields and rejects bad input', () => {
  const clean = validateScenario({ ...scenario(), secret: 'x', __proto__: { polluted: true } });
  assert.deepEqual(Object.keys(clean).sort(), ['datasetId', 'durationSeconds', 'id', 'model', 'name', 'observerHeightM', 'site', 'startUtc', 'version']);
  assert.deepEqual(Object.keys(clean.site).sort(), ['heightAboveReferenceSphereM', 'latDeg', 'lonDeg']);
  assert.equal(validateScenario(scenario({ name: '  <b>Rim</b>\u0007  site ' })).name, 'b Rim /b site');
  for (const bad of [
    { version: 2 }, { id: 'has space' }, { name: '   ' }, { model: 'terrain' }, { observerHeightM: -1 }, { observerHeightM: 10001 },
    { durationSeconds: 10 }, { durationSeconds: Infinity }, { startUtc: '2026-11-15 12:00' }, { startUtc: '2026-02-30T00:00:00Z' },
    { site: { latDeg: -91, lonDeg: 0, heightAboveReferenceSphereM: 0 } }, { site: { latDeg: 0, lonDeg: 180, heightAboveReferenceSphereM: 0 } },
    { site: { latDeg: 0, lonDeg: 0, heightAboveReferenceSphereM: 5 } }, { datasetId: '' },
  ]) {
    assert.throws(() => validateScenario(scenario(bad)), Error, JSON.stringify(bad));
  }
  assert.throws(() => validateScenario(null));
  assert.throws(() => validateScenario('text'));
});

test('scenario sets: limits, duplicate ids, JSON round trip', () => {
  assert.throws(() => validateScenarioSet({ version: 1, scenarios: [] }));
  assert.throws(() => validateScenarioSet({ version: 1, scenarios: [scenario(), scenario()] }), /duplicate id/);
  assert.throws(() => validateScenarioSet({ version: 1, scenarios: Array.from({ length: MAX_SCENARIOS + 1 }, (_, i) => scenario({ id: `s${i}` })) }));
  assert.throws(() => parseScenarioSet('{not json'), /not valid JSON/);
  assert.throws(() => parseScenarioSet('[]'), /Not a scenario file/);
  const set = validateScenarioSet({ version: 1, scenarios: [scenario(), scenario({ id: 'b', observerHeightM: 250, name: 'B' })] });
  const text = serializeScenarioSet(set);
  assert.deepEqual(parseScenarioSet(text), set);
  assert.equal(JSON.parse(text).scenarios[1].observerHeightM, 250);
  assert.equal(JSON.parse(text).scenarios[1].model, 'reference-sphere');
});

test('share fragment round trip and rejection of tampered links', () => {
  const set = validateScenarioSet({ version: 1, scenarios: [scenario({ name: 'Ridge — test é' })] });
  const fragment = encodeScenarioFragment(set);
  assert.match(fragment, /^scenarios=[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeScenarioFragment(`#${fragment}`), set);
  assert.deepEqual(decodeScenarioFragment(`#other=1&${fragment}`), set);
  assert.equal(decodeScenarioFragment('#nothing'), null);
  assert.equal(decodeScenarioFragment(''), null);
  assert.throws(() => decodeScenarioFragment('#scenarios=%3Cscript%3E'));
  assert.throws(() => decodeScenarioFragment('#scenarios=bm90IGpzb24'));
});

test('default scenarios: A now, A +3 days, B now with equal duration, height and model preserved', () => {
  const set = defaultScenarios(
    { name: 'A · Shackleton', latDeg: -89.67, lonDeg: 129.78, observerHeightM: 100 },
    { name: 'B · Mons Mouton', latDeg: -84.6, lonDeg: 31, observerHeightM: 0 },
    '2026-11-15T12:00:00Z', data.id);
  assert.equal(set.scenarios.length, 3);
  const [aNow, aLater, bNow] = set.scenarios;
  assert.equal(aNow.startUtc, '2026-11-15T12:00:00Z');
  assert.equal(aLater.startUtc, '2026-11-18T12:00:00Z');
  assert.equal(bNow.startUtc, '2026-11-15T12:00:00Z');
  assert.deepEqual(aNow.site, aLater.site);
  assert.notDeepEqual(aNow.site, bNow.site);
  assert.equal(new Set(set.scenarios.map((s) => s.durationSeconds)).size, 1);
  assert.equal(aNow.observerHeightM, 100);
  assert.ok(set.scenarios.every((s) => s.model === 'reference-sphere' && s.datasetId === data.id));
  assert.equal(addDaysUtc('2026-12-30T00:00:00Z', 3), '2027-01-02T00:00:00Z');
  assert.ok(isStrictUtc('2027-01-02T00:00:00Z') && !isStrictUtc('2027-01-02T00:00:00.000Z'));
});

test('window fitting stays inside the dataset', () => {
  const { startEt, endEt } = data.coverage;
  assert.deepEqual(fitWindow(startEt + 1000, 86400, startEt, endEt), { startEt: startEt + 1000, endEt: startEt + 1000 + 86400, adjusted: false });
  const late = fitWindow(endEt - 100, 86400, startEt, endEt);
  assert.equal(late.endEt, endEt);
  assert.equal(late.endEt - late.startEt, 86400);
  assert.equal(late.adjusted, true);
  const long = fitWindow(startEt, (endEt - startEt) * 2, startEt, endEt);
  assert.deepEqual([long.startEt, long.endEt, long.adjusted], [startEt, endEt, true]);
});

test('countdown and height formatting', () => {
  assert.equal(formatCountdown(0), 'now');
  assert.equal(formatCountdown(-500), 'now');
  assert.equal(formatCountdown(3 * 86400 + 4 * 3600), 'in ≈ 3 d 4 h');
  assert.equal(formatCountdown(Number.NaN), '');
  assert.equal(formatHeight(0), '0 m');
  assert.equal(formatHeight(250), '250 m');
  assert.equal(formatHeight(2500), '2.5 km');
  assert.equal(formatHeight(10000), '10 km');
});

test('surface scene directions agree with the science module azimuth and altitude', () => {
  const degrees = 180 / Math.PI;
  for (const [latDeg, lonDeg, heightM, utc] of [[-89.67, 129.78, 0, '2026-11-14T00:00:00Z'], [-84.6, 31, 1000, '2026-12-20T06:30:00Z'], [0.67, 23.47, 0, '2026-10-05T10:00:00Z'], [-45.45, 177.6, 250, '2027-01-15T18:00:00Z']]) {
    const observation = observeObserver(data, utcToEt(data, utc), { latDeg, lonDeg, heightAboveReferenceSphereM: 0 }, heightM);
    for (const body of [observation.sun, observation.earth]) {
      const local = bodyToLocalScene(body.direction, latDeg, lonDeg);
      const { headingDeg, pitchDeg } = localToHeadingPitch(local);
      assert.ok(Math.abs(pitchDeg - body.altDeg) < 1e-9, `altitude ${pitchDeg} vs ${body.altDeg}`);
      const difference = Math.abs((((headingDeg - body.azDeg) % 360) + 540) % 360 - 180);
      assert.ok(difference < 1e-9, `azimuth ${headingDeg} vs ${body.azDeg}`);
      assert.ok(Math.abs(local.length() - 1) < 1e-12);
      assert.equal(local.y > 0, body.altDeg > 0, 'a body below the reference horizon stays below it in the scene');
      assert.ok(Math.abs(Math.asin(local.y) * degrees - body.altDeg) < 1e-9);
    }
  }
  const north = headingPitchToLocal(0, 0);
  const east = headingPitchToLocal(90, 0);
  assert.ok(north.distanceTo(new Vector3(0, 0, -1)) < 1e-12);
  assert.ok(east.distanceTo(new Vector3(1, 0, 0)) < 1e-12);
  assert.equal(localToHeadingPitch(new Vector3(0, 1, 0)).headingDeg, null);
});

test('upcoming events on real data: strictly in the future, inside the data, never at its edges', () => {
  const site = { latDeg: -84.6, lonDeg: 31, heightAboveReferenceSphereM: 0 };
  const full = analyzeObserver(data, site, { startEt: data.coverage.startEt, endEt: data.coverage.endEt }, 0);
  const et = utcToEt(data, '2026-11-01T00:00:00Z');
  const events = getUpcomingEvents(full, et);
  for (const kind of ['sunrise', 'sunset', 'earthrise', 'earthset']) {
    const event = events[kind];
    assert.ok(event, `${kind} expected within four months at 84.6° S`);
    assert.equal(event.kind, kind);
    assert.ok(event.et > et && event.et > data.coverage.startEt && event.et < data.coverage.endEt);
  }
  const atEnd = getUpcomingEvents(full, data.coverage.endEt);
  assert.deepEqual([atEnd.sunrise, atEnd.sunset, atEnd.earthrise, atEnd.earthset], [null, null, null, null]);
});
