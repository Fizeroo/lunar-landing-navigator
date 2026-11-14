import type { ConditionSummary, EphemerisData, Site, SiteAnalysis, TimeInterval, Vec3 } from '../contracts.ts';

function assertPeriod(period: TimeInterval): void {
  if (!Number.isFinite(period.startEt) || !Number.isFinite(period.endEt) || period.startEt >= period.endEt) {
    throw new RangeError('Period must have finite ET bounds with startEt < endEt');
  }
}

function assertIntervals(intervals: TimeInterval[]): void {
  let previousEnd = -Infinity;
  for (const interval of intervals) {
    if (!Number.isFinite(interval.startEt) || !Number.isFinite(interval.endEt) || interval.startEt >= interval.endEt || interval.startEt < previousEnd) {
      throw new RangeError('Intervals must be finite, positive-duration, sorted and disjoint');
    }
    previousEnd = interval.endEt;
  }
}

/** Intersect two sorted, disjoint interval lists in linear time. */
export function intersectIntervals(a: TimeInterval[], b: TimeInterval[]): TimeInterval[] {
  assertIntervals(a);
  assertIntervals(b);
  const result: TimeInterval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const startEt = Math.max(a[i]!.startEt, b[j]!.startEt);
    const endEt = Math.min(a[i]!.endEt, b[j]!.endEt);
    if (startEt < endEt) result.push({ startEt, endEt });
    if (a[i]!.endEt < b[j]!.endEt) i++;
    else if (b[j]!.endEt < a[i]!.endEt) j++;
    else { i++; j++; }
  }
  return result;
}

function unitRadial(site: Site): Vec3 {
  if (!Number.isFinite(site.latDeg) || site.latDeg < -90 || site.latDeg > 90 ||
      !Number.isFinite(site.lonDeg) || site.lonDeg < -180 || site.lonDeg >= 180 ||
      site.heightAboveReferenceSphereM !== 0) throw new RangeError('Site must use valid planetocentric coordinates and h=0');
  const phi = site.latDeg * Math.PI / 180, lambda = site.lonDeg * Math.PI / 180;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

function dot(position: Vec3, radial: Vec3, radius: number): number {
  return position[0] * radial[0] + position[1] * radial[1] + position[2] * radial[2] - radius;
}

function positiveIntervals(data: EphemerisData, radial: Vec3, key: 'sunM' | 'earthM', period: TimeInterval): TimeInterval[] {
  const samples = data.samples, radius = data.model.referenceRadiusM;
  const result: TimeInterval[] = [];
  const append = (startEt: number, endEt: number, mergeWithPrevious: boolean): void => {
    if (!(startEt < endEt)) return; // Strictly positive; zero-duration contacts are excluded.
    const previous = result.at(-1);
    if (previous?.endEt === startEt && mergeWithPrevious) previous.endEt = endEt;
    else result.push({ startEt, endEt });
  };

  for (let i = 0; i < samples.length - 1; i++) {
    const left = samples[i]!, right = samples[i + 1]!;
    const from = Math.max(left.et, period.startEt), to = Math.min(right.et, period.endEt);
    if (!(from < to)) continue;
    const g0 = dot(left[key], radial, radius), g1 = dot(right[key], radial, radius);
    const slope = (g1 - g0) / (right.et - left.et);
    const atFrom = g0 + slope * (from - left.et), atTo = g0 + slope * (to - left.et);
    const positiveAtNode = from === left.et && g0 > 0;
    if (atFrom > 0 && atTo > 0) append(from, to, positiveAtNode);
    else if (atFrom > 0 && atTo <= 0) {
      const crossing = from + (to - from) * (atFrom / (atFrom - atTo));
      append(from, crossing, positiveAtNode);
    } else if (atFrom <= 0 && atTo > 0) {
      const crossing = from + (to - from) * (-atFrom / (atTo - atFrom));
      append(crossing, to, crossing === from && positiveAtNode);
    }
  }
  return result;
}

function summarize(intervals: TimeInterval[], periodSeconds: number): ConditionSummary {
  let totalSeconds = 0, longestSeconds = 0;
  for (const interval of intervals) {
    const duration = interval.endEt - interval.startEt;
    totalSeconds += duration;
    longestSeconds = Math.max(longestSeconds, duration);
  }
  return { intervals, totalSeconds, fraction: totalSeconds / periodSeconds, longestSeconds };
}

/** Analyze strict center-altitude > 0 over the exact clipped ET period. */
export function analyzeSite(data: EphemerisData, site: Site, period: TimeInterval): SiteAnalysis {
  assertPeriod(period);
  if (period.startEt < data.coverage.startEt || period.endEt > data.coverage.endEt) {
    throw new RangeError('Analysis period is outside ephemeris coverage');
  }
  const radial = unitRadial(site);
  const sunIntervals = positiveIntervals(data, radial, 'sunM', period);
  const earthIntervals = positiveIntervals(data, radial, 'earthM', period);
  const bothIntervals = intersectIntervals(sunIntervals, earthIntervals);
  const duration = period.endEt - period.startEt;
  return {
    site: { ...site }, period: { ...period },
    sun: summarize(sunIntervals, duration),
    earth: summarize(earthIntervals, duration),
    both: summarize(bothIntervals, duration),
  };
}
