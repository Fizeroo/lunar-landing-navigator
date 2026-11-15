import type { Condition, EphemerisData, Observation, Site } from '../contracts.ts';
import { observeObserver } from './observer.ts';
import { findMissionWindow, type MissionResult } from './mission.ts';
import { observeTerrainInstant, sampleTerrainContinuous, type TerrainPatch, type TerrainVisibility } from './terrain.ts';

export interface CandidateRegion {
  id: string;
  label: string;
  polygon: ReadonlyArray<readonly [latDeg: number, lonDeg: number]>;
}
export interface CandidateSearchRequest {
  region: CandidateRegion;
  gridSide: 5 | 7;
  minimumCoverageMarginM: number;
  observerHeightM: number;
  currentEt: number;
}
export interface CandidateResult {
  id: string;
  site: Site;
  groundHeightM: number;
  slopeDeg: number;
  slopeScaleM: number;
  coverageMarginM: number;
  reference: Observation;
  lighting: MissionResult;
  terrain: { observation: Observation; sun: TerrainVisibility; earth: TerrainVisibility };
  rankingReason: string;
}
export interface CandidateSearchProgress {
  requestId: number;
  completed: number;
  total: number;
  result: CandidateResult | null;
}

const SLOPE_SCALE_M = 80;
const BOTH: Condition = 'both';

function fail(message: string): never { throw new RangeError(`Candidates: ${message}`); }
function finite(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n); }
function validateRegion(region: CandidateRegion): void {
  if (!region || typeof region.id !== 'string' || !region.id.trim() || typeof region.label !== 'string' || !region.label.trim()) fail('Region id and label are required');
  if (!Array.isArray(region.polygon) || region.polygon.length < 3) fail('Region polygon needs at least three coordinates');
  const points = region.polygon;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || p[0] < -90 || p[0] > 90 || !finite(p[1]) || p[1] < -180 || p[1] >= 180) {
      fail(`Region coordinate ${i} must contain valid planetocentric latitude and east longitude`);
    }
    if (i && Math.abs(p[1]! - points[0]![1]!) > 180) fail('Antimeridian-crossing polygons are unsupported');
  }
}
function insidePolygon(lat: number, lon: number, polygon: CandidateRegion['polygon']): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i]!, [yj, xj] = polygon[j]!;
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function candidateCoordinates(region: CandidateRegion, gridSide: 5 | 7): Array<{ id: string; latDeg: number; lonDeg: number }> {
  validateRegion(region);
  if (gridSide !== 5 && gridSide !== 7) fail('Grid side must be 5 or 7');
  const lats = region.polygon.map(p => p[0]), lons = region.polygon.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const result: Array<{ id: string; latDeg: number; lonDeg: number }> = [];
  for (let row = 0; row < gridSide; row++) for (let col = 0; col < gridSide; col++) {
    const latDeg = minLat + (row + 0.5) * (maxLat - minLat) / gridSide;
    const lonDeg = minLon + (col + 0.5) * (maxLon - minLon) / gridSide;
    if (insidePolygon(latDeg, lonDeg, region.polygon)) result.push({ id: `${region.id}-r${String(row + 1).padStart(2, '0')}-c${String(col + 1).padStart(2, '0')}`, latDeg, lonDeg });
  }
  return result;
}

/** Named initial region deliberately sits inside the existing real PGDA90 patch. */
export function preparedCandidateRegion(_patch: TerrainPatch): CandidateRegion {
  return { id: 'pgda90-central-south-polar', label: 'PGDA90 central south-polar region',
    polygon: [[-89.035, -5], [-89.035, 5], [-88.965, 5], [-88.965, -5]] };
}

/** Deterministic interior grid; sites on/outside the mesh or below the requested margin are omitted. */
export function generateCandidateSites(region: CandidateRegion, gridSide: 5 | 7, patch: TerrainPatch,
  minimumCoverageMarginM: number): ReadonlyArray<Site> {
  if (!finite(minimumCoverageMarginM) || minimumCoverageMarginM < 0) fail('Minimum coverage margin must be finite and non-negative');
  const sites: Site[] = [];
  for (const point of candidateCoordinates(region, gridSide)) {
    const sample = sampleTerrainContinuous(patch, point.latDeg, point.lonDeg);
    if (!sample || sample.coverageMarginM <= 0 || sample.coverageMarginM < minimumCoverageMarginM) continue;
    sites.push(sample.site);
  }
  return sites;
}

function compareResults(a: CandidateResult, b: CandidateResult): number {
  const av = [Number(a.reference.sun.centerAboveReferenceHorizon && a.reference.earth.centerAboveReferenceHorizon),
    Number(a.reference.sun.centerAboveReferenceHorizon), Number(a.reference.earth.centerAboveReferenceHorizon)];
  const bv = [Number(b.reference.sun.centerAboveReferenceHorizon && b.reference.earth.centerAboveReferenceHorizon),
    Number(b.reference.sun.centerAboveReferenceHorizon), Number(b.reference.earth.centerAboveReferenceHorizon)];
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return bv[i]! - av[i]!;
  const timeDelta = b.lighting.current.availableSeconds - a.lighting.current.availableSeconds;
  if (timeDelta !== 0) return timeDelta;
  const altitudeDelta = b.reference.sun.altDeg - a.reference.sun.altDeg;
  if (altitudeDelta !== 0) return altitudeDelta;
  return a.id.localeCompare(b.id);
}

function abortError(): Error { const error = new Error('Candidate search was aborted'); error.name = 'AbortError'; return error; }
function validateRequest(data: EphemerisData, patch: TerrainPatch, request: CandidateSearchRequest, requestId: number, batchSize: number): void {
  validateRegion(request?.region);
  if (request.gridSide !== 5 && request.gridSide !== 7) fail('Grid side must be 5 or 7');
  if (!finite(request.minimumCoverageMarginM) || request.minimumCoverageMarginM < 0) fail('Minimum coverage margin must be finite and non-negative');
  if (!finite(request.observerHeightM) || request.observerHeightM < 0 || request.observerHeightM > 10000) fail('Observer height must be between 0 and 10000 m');
  if (!finite(request.currentEt) || request.currentEt < data.coverage.startEt || request.currentEt > data.coverage.endEt) fail('Current ET must be within prepared ephemeris coverage');
  if (!Number.isSafeInteger(requestId) || requestId < 0) fail('Request id must be a non-negative safe integer');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 25) fail('Batch size must be an integer from 1 through 25');
  if (!patch || !data || !Array.isArray(data.samples) || !data.samples.length) fail('Prepared ephemeris and terrain patch are required');
}

/** Evaluate at the displayed instant. Lighting is reference-sphere only; terrain is a separate local diagnostic. */
export async function searchCandidatesAsync(data: EphemerisData, patch: TerrainPatch, request: CandidateSearchRequest,
  options: { requestId: number; signal?: AbortSignal; batchSize?: number; onProgress?: (progress: CandidateSearchProgress) => void }): Promise<ReadonlyArray<CandidateResult>> {
  const batchSize = options.batchSize ?? 5;
  validateRequest(data, patch, request, options.requestId, batchSize);
  const coordinates = candidateCoordinates(request.region, request.gridSide);
  const sites = generateCandidateSites(request.region, request.gridSide, patch, request.minimumCoverageMarginM);
  const eligible = new Set(sites.map(site => `${site.latDeg}|${site.lonDeg}`));
  const selected = coordinates.filter(p => {
    const sample = sampleTerrainContinuous(patch, p.latDeg, p.lonDeg);
    return !!sample && sample.coverageMarginM > 0 && sample.coverageMarginM >= request.minimumCoverageMarginM &&
      eligible.has(`${sample.site.latDeg}|${sample.site.lonDeg}`);
  });
  const results: CandidateResult[] = [];
  const range = { startEt: data.coverage.startEt, endEt: data.coverage.endEt };
  for (let i = 0; i < selected.length; i++) {
    if (options.signal?.aborted) throw abortError();
    const point = selected[i]!, ground = sampleTerrainContinuous(patch, point.latDeg, point.lonDeg)!;
    const site = ground.site;
    const reference = observeObserver(data, request.currentEt, site, request.observerHeightM);
    const lighting = findMissionWindow(data, { site, observerHeightM: request.observerHeightM, model: 'reference-sphere', range,
      requiredSeconds: 1, condition: BOTH, currentStartEt: request.currentEt });
    // Preserve the original projected grid query for the terrain observation. `site`
    // is the returned radial facet coordinate and reprojecting it can move by a tiny
    // amount because the mesh itself is barycentrically interpolated.
    const terrain = observeTerrainInstant(data, request.currentEt,
      { latDeg: point.latDeg, lonDeg: point.lonDeg, heightAboveReferenceSphereM: 0 }, request.observerHeightM, patch);
    if (!terrain) continue;
    const bothUp = reference.sun.centerAboveReferenceHorizon && reference.earth.centerAboveReferenceHorizon;
    const rankingReason = bothUp ? 'Sun and Earth centres are above the reference horizon; ranked by remaining joint time, then Sun altitude.' :
      reference.sun.centerAboveReferenceHorizon ? 'Sun centre is above the reference horizon; ranked by Earth visibility, remaining joint time and Sun altitude.' :
        reference.earth.centerAboveReferenceHorizon ? 'Earth centre is above the reference horizon; ranked by Sun visibility, remaining joint time and Sun altitude.' :
          'Sun and Earth centres are below the reference horizon; ranked by remaining joint time, then Sun altitude.';
    results.push({ id: point.id, site, groundHeightM: ground.groundHeightM, slopeDeg: ground.slopeDeg, slopeScaleM: SLOPE_SCALE_M,
      coverageMarginM: ground.coverageMarginM, reference, lighting,
      terrain: { observation: terrain.observation, sun: terrain.sun, earth: terrain.earth }, rankingReason });
    options.onProgress?.({ requestId: options.requestId, completed: i + 1, total: selected.length, result: results.at(-1)! });
    if ((i + 1) % batchSize === 0 && i + 1 < selected.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  results.sort(compareResults);
  return results;
}
