import type { CandidateResult } from './candidates.ts';

export type CandidateAssessmentModel = 'terrain' | 'reference-sphere';
export type CandidateAssessmentState =
  | 'confirmed-failure'
  | 'conditional-reference'
  | 'terrain-unknown'
  | 'confirmed-within-model';
export type CandidateTerrainAssessment = 'blocked' | 'unknown' | 'clear';

export interface CandidateAssessment {
  selectedModel: CandidateAssessmentModel;
  state: CandidateAssessmentState;
  reason: string;
  referenceSphere: 'pass' | 'fail' | 'data-limited';
  terrain: { sun: CandidateTerrainAssessment; earth: CandidateTerrainAssessment };
}

function fail(message: string): never { throw new RangeError(`Candidate assessment: ${message}`); }
function terrainState(status: CandidateResult['terrain']['sun']['status']): CandidateTerrainAssessment {
  return status === 'insufficient' ? 'unknown' : status;
}
function terrainSummary(result: CandidateResult): CandidateAssessment['terrain'] {
  return { sun: terrainState(result.terrain.sun.status), earth: terrainState(result.terrain.earth.status) };
}
function bodyName(terrain: CandidateAssessment['terrain'], state: CandidateTerrainAssessment): string | null {
  const bodies = (['sun', 'earth'] as const).filter(body => terrain[body] === state);
  if (bodies.length === 2) return 'Sun and Earth';
  if (bodies.length === 1) return bodies[0] === 'sun' ? 'Sun' : 'Earth';
  return null;
}

/** Interpret only the already-computed candidate result; no geometry or ranking is recalculated. */
export function assessCandidateResult(result: CandidateResult, selectedModel: CandidateAssessmentModel = 'terrain'): CandidateAssessment {
  if (!result || !result.lighting || !result.lighting.current || !result.terrain || !result.terrain.sun || !result.terrain.earth) {
    fail('A complete candidate result is required');
  }
  if (selectedModel !== 'terrain' && selectedModel !== 'reference-sphere') fail('Model must be terrain or reference-sphere');
  const terrain = terrainSummary(result);
  const current = result.lighting.current;
  const referenceSphere: CandidateAssessment['referenceSphere'] =
    current.conditionMetAtStart && current.endReason === 'data-coverage-end' && current.availableSeconds === 0
      ? 'data-limited' : current.requirementMet ? 'pass' : 'fail';

  if (selectedModel === 'terrain') {
    const blocked = terrain.sun === 'blocked' || terrain.earth === 'blocked';
    if (blocked) {
      const blockedBodies = bodyName(terrain, 'blocked');
      const unknownBodies = bodyName(terrain, 'unknown');
      const reason = unknownBodies
        ? `Terrain blocked: ${blockedBodies}; ${unknownBodies} unknown.`
        : `Terrain blocked: ${blockedBodies ?? 'required body'}.`;
      return { selectedModel, state: 'confirmed-failure', reason, referenceSphere, terrain };
    }
    if (terrain.sun === 'unknown' || terrain.earth === 'unknown') {
      const unknownBodies = bodyName(terrain, 'unknown');
      return { selectedModel, state: 'terrain-unknown',
        reason: referenceSphere === 'pass'
          ? `Reference result only; terrain unknown: ${unknownBodies ?? 'required body'}.`
          : `Terrain unknown: ${unknownBodies ?? 'required body'}.`, referenceSphere, terrain };
    }
    return { selectedModel, state: 'confirmed-within-model',
      reason: 'Terrain criterion met at this instant.',
      referenceSphere, terrain };
  }

  if (referenceSphere === 'data-limited') {
    return { selectedModel, state: 'conditional-reference',
      reason: 'Reference geometry is up at the coverage edge; duration unknown.', referenceSphere, terrain };
  }
  if (referenceSphere === 'fail') {
    return { selectedModel, state: 'confirmed-failure',
      reason: 'Reference-sphere condition not met.', referenceSphere, terrain };
  }
  const blockedBodies = bodyName(terrain, 'blocked');
  const unknownBodies = bodyName(terrain, 'unknown');
  const terrainNote = blockedBodies ? ` Terrain blocks ${blockedBodies}.` :
    unknownBodies ? ` Terrain unknown: ${unknownBodies}.` : '';
  return { selectedModel, state: 'confirmed-within-model',
    reason: terrainNote ? `Reference-sphere criterion met;${terrainNote}` : 'Reference-sphere criterion met.', referenceSphere, terrain };
}

/** Presentation shortlist: non-blocked diagnostics first, preserving reference ranking within each group. */
export function selectCandidateShortlist(results: ReadonlyArray<CandidateResult>, limit = 3): ReadonlyArray<CandidateResult> {
  if (!Array.isArray(results)) fail('Candidate results must be an array');
  if (!Number.isSafeInteger(limit) || limit < 0) fail('Shortlist limit must be a non-negative safe integer');
  const nonBlocked = results.filter(result => result.terrain.sun.status !== 'blocked' && result.terrain.earth.status !== 'blocked');
  const blocked = results.filter(result => result.terrain.sun.status === 'blocked' || result.terrain.earth.status === 'blocked');
  return [...nonBlocked, ...blocked].slice(0, limit);
}
