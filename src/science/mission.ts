import type { Condition, EphemerisData, Site, SiteAnalysis, TimeInterval } from '../contracts.ts';
import { analyzeObserver } from './observer.ts';

export type MissionModel = 'reference-sphere' | 'terrain';
export interface MissionRequest {
  site: Site;
  observerHeightM: number;
  model: MissionModel;
  range: TimeInterval;
  requiredSeconds: number;
  condition: Condition;
  currentStartEt: number;
}
export type MissionEndReason = 'sunset' | 'earthset' | 'both-set' | 'search-range-end' | 'data-coverage-end';
export interface MissionWindow {
  startEt: number;
  endEt: number;
  allowedStart: { startEt: number; endEt: number };
  availableSeconds: number;
  spareSeconds: number;
  startClipped: boolean;
  endClipped: boolean;
  endReason: MissionEndReason;
}
export interface MissionCurrent {
  startEt: number;
  conditionMetAtStart: boolean;
  availableSeconds: number;
  requirementMet: boolean;
  fitsSearchRange: boolean;
  spareSeconds: number;
  endEt: number | null;
  endReason: MissionEndReason | 'conditions-not-met' | 'outside-data';
}
export interface MissionResult {
  request: MissionRequest;
  windows: MissionWindow[];
  nearest: MissionWindow | null;
  recommendedStartEt: number | null;
  longest: MissionWindow | null;
  current: MissionCurrent;
  computeMilliseconds: number;
}

const EPSILON_SECONDS = 1e-6;
const analysisCache = new WeakMap<EphemerisData, Map<string, SiteAnalysis>>();

function fail(message: string): never { throw new RangeError(`Mission: ${message}`); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function cloneRequest(request: MissionRequest): MissionRequest {
  return { ...request, site: { ...request.site }, range: { ...request.range } };
}
function validateRequest(data: EphemerisData, request: MissionRequest): void {
  if (!request || typeof request !== 'object') fail('A request is required');
  if (request.model === 'terrain') fail('Terrain mission-window search is unavailable: local DEM coverage cannot certify continuous visibility. Explicitly choose Reference sphere.');
  if (request.model !== 'reference-sphere') fail('Unsupported mission model');
  const { site, range, currentStartEt } = request;
  if (!site || !finite(site.latDeg) || site.latDeg < -90 || site.latDeg > 90 || !finite(site.lonDeg) ||
      site.lonDeg < -180 || site.lonDeg >= 180 || site.heightAboveReferenceSphereM !== 0) fail('Site must have valid planetocentric coordinates and h=0');
  if (!finite(request.observerHeightM) || request.observerHeightM < 0 || request.observerHeightM > 10000) fail('Observer height must be between 0 and 10000 m');
  if (!range || !finite(range.startEt) || !finite(range.endEt) || range.startEt >= range.endEt) fail('Search range must have finite ET bounds with startEt < endEt');
  if (!finite(data.coverage.startEt) || !finite(data.coverage.endEt) || data.coverage.startEt >= data.coverage.endEt ||
      range.startEt < data.coverage.startEt || range.endEt > data.coverage.endEt) fail('Search range must be within ephemeris coverage');
  if (!finite(request.requiredSeconds) || request.requiredSeconds < 1 || request.requiredSeconds > data.coverage.endEt - data.coverage.startEt) {
    fail('Required duration must be from 1 second through the full dataset duration');
  }
  if (request.condition !== 'sun' && request.condition !== 'earth' && request.condition !== 'both') fail('Condition must be sun, earth or both');
  if (!finite(currentStartEt)) fail('Current start ET must be finite');
}

function fullAnalysis(data: EphemerisData, site: Site, height: number): SiteAnalysis {
  let bySite = analysisCache.get(data);
  if (!bySite) { bySite = new Map(); analysisCache.set(data, bySite); }
  const key = `${site.latDeg}|${site.lonDeg}|${height}`;
  const cached = bySite.get(key);
  if (cached) return cached;
  const result = analyzeObserver(data, { ...site, heightAboveReferenceSphereM: 0 }, data.coverage, height);
  bySite.set(key, result);
  return result;
}

function spansFor(analysis: SiteAnalysis, condition: Condition): TimeInterval[] {
  return analysis[condition].intervals;
}
function positiveAtCoverageEnd(data: EphemerisData, request: MissionRequest): boolean {
  const last = data.samples.at(-1)!;
  const phi = request.site.latDeg * Math.PI / 180, lambda = request.site.lonDeg * Math.PI / 180;
  const radial = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  const threshold = data.model.referenceRadiusM + request.observerHeightM;
  const sun = last.sunM[0] * radial[0]! + last.sunM[1] * radial[1]! + last.sunM[2] * radial[2]! > threshold;
  const earth = last.earthM[0] * radial[0]! + last.earthM[1] * radial[1]! + last.earthM[2] * radial[2]! > threshold;
  return request.condition === 'sun' ? sun : request.condition === 'earth' ? earth : sun && earth;
}
function matchingEnd(intervals: TimeInterval[], endEt: number): boolean {
  return intervals.some(span => Math.abs(span.endEt - endEt) <= EPSILON_SECONDS);
}
function physicalEndReason(analysis: SiteAnalysis, condition: Condition, endEt: number, coverageEnd: number): MissionEndReason {
  if (Math.abs(endEt - coverageEnd) <= EPSILON_SECONDS) return 'data-coverage-end';
  if (condition === 'sun') return 'sunset';
  if (condition === 'earth') return 'earthset';
  const sunEnds = matchingEnd(analysis.sun.intervals, endEt), earthEnds = matchingEnd(analysis.earth.intervals, endEt);
  if (sunEnds && earthEnds) return 'both-set';
  if (sunEnds) return 'sunset';
  if (earthEnds) return 'earthset';
  // A joint interval can also be clipped by the beginning/end of available data.
  return 'data-coverage-end';
}
function endReasonForClipped(analysis: SiteAnalysis, condition: Condition, actualEnd: number, clippedEnd: number,
  range: TimeInterval, coverageEnd: number): MissionEndReason {
  if (Math.abs(clippedEnd - coverageEnd) <= EPSILON_SECONDS && Math.abs(actualEnd - coverageEnd) <= EPSILON_SECONDS) return 'data-coverage-end';
  if (range.endEt < actualEnd - EPSILON_SECONDS && Math.abs(clippedEnd - range.endEt) <= EPSILON_SECONDS) return 'search-range-end';
  return physicalEndReason(analysis, condition, actualEnd, coverageEnd);
}

function describeSpan(analysis: SiteAnalysis, condition: Condition, actual: TimeInterval, clipped: TimeInterval,
  range: TimeInterval, coverage: TimeInterval, requiredSeconds: number): MissionWindow {
  const availableSeconds = clipped.endEt - clipped.startEt;
  const latestStart = Math.max(clipped.startEt, clipped.endEt - requiredSeconds);
  return {
    startEt: clipped.startEt,
    endEt: clipped.endEt,
    allowedStart: { startEt: clipped.startEt, endEt: latestStart },
    availableSeconds,
    spareSeconds: availableSeconds - requiredSeconds,
    startClipped: actual.startEt < clipped.startEt - EPSILON_SECONDS || Math.abs(actual.startEt - coverage.startEt) <= EPSILON_SECONDS,
    endClipped: actual.endEt > clipped.endEt + EPSILON_SECONDS || Math.abs(actual.endEt - coverage.endEt) <= EPSILON_SECONDS,
    endReason: endReasonForClipped(analysis, condition, actual.endEt, clipped.endEt, range, coverage.endEt),
  };
}

function currentEvaluation(data: EphemerisData, request: MissionRequest, analysis: SiteAnalysis): MissionCurrent {
  const startEt = request.currentStartEt, required = request.requiredSeconds;
  const fitsSearchRange = startEt >= request.range.startEt && startEt + required <= request.range.endEt + EPSILON_SECONDS;
  const outside = startEt < data.coverage.startEt || startEt > data.coverage.endEt;
  if (outside) return { startEt, conditionMetAtStart: false, availableSeconds: 0, requirementMet: false,
    fitsSearchRange, spareSeconds: -required, endEt: null, endReason: 'outside-data' };
  if (startEt === data.coverage.endEt) {
    const conditionMetAtStart = positiveAtCoverageEnd(data, request);
    return { startEt, conditionMetAtStart, availableSeconds: 0, requirementMet: false, fitsSearchRange,
      spareSeconds: -required, endEt: conditionMetAtStart ? data.coverage.endEt : null,
      endReason: conditionMetAtStart ? 'data-coverage-end' : 'conditions-not-met' };
  }
  const actual = spansFor(analysis, request.condition).find(span => span.startEt <= startEt && startEt < span.endEt);
  if (!actual) return { startEt, conditionMetAtStart: false, availableSeconds: 0, requirementMet: false,
    fitsSearchRange, spareSeconds: -required, endEt: null, endReason: 'conditions-not-met' };
  const availableSeconds = actual.endEt - startEt;
  const requirementMet = availableSeconds + EPSILON_SECONDS >= required && fitsSearchRange;
  // Current availability/endEt describe the actual prepared physical span. Search
  // range fit is deliberately separate and cannot relabel that physical endpoint.
  const endReason = physicalEndReason(analysis, request.condition, actual.endEt, data.coverage.endEt);
  return { startEt, conditionMetAtStart: true, availableSeconds, requirementMet, fitsSearchRange,
    spareSeconds: availableSeconds - required, endEt: actual.endEt, endReason };
}

function evaluateCurrent(data: EphemerisData, request: MissionRequest): MissionCurrent {
  validateRequest(data, request);
  return currentEvaluation(data, request, fullAnalysis(data, request.site, request.observerHeightM));
}

/** Find qualifying starts from full-coverage intervals, clipped only for search-window display. */
export function findMissionWindow(data: EphemerisData, request: MissionRequest): MissionResult {
  const started = performance.now();
  validateRequest(data, request);
  const analysis = fullAnalysis(data, request.site, request.observerHeightM);
  const conditionSpans = spansFor(analysis, request.condition);
  const clipped: MissionWindow[] = [];
  const allClipped: MissionWindow[] = [];
  for (const actual of conditionSpans) {
    const startEt = Math.max(actual.startEt, request.range.startEt);
    const endEt = Math.min(actual.endEt, request.range.endEt);
    if (!(startEt < endEt)) continue;
    const window = describeSpan(analysis, request.condition, actual, { startEt, endEt }, request.range, data.coverage, request.requiredSeconds);
    allClipped.push(window);
    if (window.availableSeconds + EPSILON_SECONDS >= request.requiredSeconds) clipped.push(window);
  }
  const longest = allClipped.reduce<MissionWindow | null>((best, span) => !best || span.availableSeconds > best.availableSeconds ? span : best, null);
  const nearest = clipped.find(window => window.allowedStart.endEt + EPSILON_SECONDS >= request.currentStartEt) ?? null;
  const recommendedStartEt = nearest ? Math.max(nearest.allowedStart.startEt, request.currentStartEt) : null;
  return { request: cloneRequest(request), windows: clipped, nearest, recommendedStartEt, longest,
    current: currentEvaluation(data, request, analysis), computeMilliseconds: performance.now() - started };
}

/** Compare two explicit current starts/one-axis what-ifs; this function never searches or shifts either input. */
export function compareMissionStarts(data: EphemerisData, baseline: MissionRequest, alternative: MissionRequest): {
  baseline: MissionCurrent; alternative: MissionCurrent; deltaAvailableSeconds: number;
} {
  validateRequest(data, baseline);
  validateRequest(data, alternative);
  if (baseline.requiredSeconds !== alternative.requiredSeconds || baseline.condition !== alternative.condition || baseline.model !== alternative.model ||
      baseline.range.startEt !== alternative.range.startEt || baseline.range.endEt !== alternative.range.endEt) {
    fail('What-if must preserve duration, condition, model and search range');
  }
  const changed = Number(baseline.currentStartEt !== alternative.currentStartEt) +
    Number(baseline.site.latDeg !== alternative.site.latDeg || baseline.site.lonDeg !== alternative.site.lonDeg) +
    Number(baseline.observerHeightM !== alternative.observerHeightM);
  if (changed !== 1) fail('What-if must change exactly one of start time, site or observer height');
  const baselineCurrent = evaluateCurrent(data, baseline);
  const alternativeCurrent = evaluateCurrent(data, alternative);
  return { baseline: baselineCurrent, alternative: alternativeCurrent,
    deltaAvailableSeconds: alternativeCurrent.availableSeconds - baselineCurrent.availableSeconds };
}
