import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCandidateResult, selectCandidateShortlist } from '../../src/science/candidate-assessment.ts';

function candidate(id, options = {}) {
  const { sun = 'insufficient', earth = 'insufficient', requirementMet = true, conditionMetAtStart = true,
    availableSeconds = 3600, endReason = 'sunset' } = options;
  return {
    id,
    terrain: { sun: { status: sun }, earth: { status: earth } },
    lighting: { current: { requirementMet, conditionMetAtStart, availableSeconds, endReason } },
  };
}

test('terrain is the default model; any known blocker fails even when the other body is unknown', () => {
  const result = assessCandidateResult(candidate('a', { sun: 'blocked', earth: 'insufficient' }));
  assert.equal(result.selectedModel, 'terrain');
  assert.equal(result.state, 'confirmed-failure');
  assert.match(result.reason, /Terrain blocked: Sun; Earth unknown/);
  assert.deepEqual(result.terrain, { sun: 'blocked', earth: 'unknown' });
});

test('any insufficient terrain result is unknown and never a terrain pass', () => {
  const result = assessCandidateResult(candidate('b', { sun: 'clear', earth: 'insufficient' }));
  assert.equal(result.state, 'terrain-unknown');
  assert.equal(result.terrain.earth, 'unknown');
  assert.match(result.reason, /terrain unknown: Earth/);
});

test('only an explicit reference-sphere selection can confirm its own current criterion', () => {
  const blocked = candidate('c', { sun: 'clear', earth: 'blocked' });
  const defaultAssessment = assessCandidateResult(blocked);
  assert.equal(defaultAssessment.state, 'confirmed-failure');
  const referenceAssessment = assessCandidateResult(blocked, 'reference-sphere');
  assert.equal(referenceAssessment.state, 'confirmed-within-model');
  assert.match(referenceAssessment.reason, /Reference-sphere criterion met/);
  assert.match(referenceAssessment.reason, /Terrain blocks Earth/);
  assert.equal(referenceAssessment.terrain.earth, 'blocked', 'reference success retains the terrain warning');
});

test('reference-sphere failure remains failure; data-endpoint up geometry stays conditional', () => {
  const failed = assessCandidateResult(candidate('d', { requirementMet: false, conditionMetAtStart: false } ), 'reference-sphere');
  assert.equal(failed.state, 'confirmed-failure');
  const endpoint = assessCandidateResult(candidate('e', { requirementMet: false, conditionMetAtStart: true,
    availableSeconds: 0, endReason: 'data-coverage-end' }), 'reference-sphere');
  assert.equal(endpoint.state, 'conditional-reference');
  assert.equal(endpoint.referenceSphere, 'data-limited');
  assert.match(endpoint.reason, /coverage edge; duration unknown/);
});

test('terrain clear can confirm only instantaneous selected-model visibility, not a duration', () => {
  const result = assessCandidateResult(candidate('f', { sun: 'clear', earth: 'clear' }));
  assert.equal(result.state, 'confirmed-within-model');
  assert.match(result.reason, /at this instant/);
});

test('shortlist moves known blockers after non-blocked points, keeps reference order and original IDs', () => {
  const a = candidate('a', { sun: 'insufficient', earth: 'clear' });
  const b = candidate('b', { sun: 'blocked', earth: 'clear' });
  const c = candidate('c', { sun: 'clear', earth: 'insufficient' });
  const d = candidate('d', { sun: 'clear', earth: 'blocked' });
  const e = candidate('e', { sun: 'clear', earth: 'clear' });
  const input = [a, b, c, d, e];
  const firstThree = selectCandidateShortlist(input);
  assert.deepEqual(firstThree.map(result => result.id), ['a', 'c', 'e']);
  assert.deepEqual(selectCandidateShortlist(input, 4).map(result => result.id), ['a', 'c', 'e', 'b']);
  assert.deepEqual(selectCandidateShortlist([b, d], 3).map(result => result.id), ['b', 'd'], 'failure fill retains original order');
  assert.deepEqual(selectCandidateShortlist(input, 0), []);
  assert.equal(input.length, 5, 'shortlist reports presentation only and does not change evaluated count');
  assert.throws(() => selectCandidateShortlist(input, -1), /non-negative safe integer/);
});
