import type { SiteAnalysis, TimeInterval } from '../contracts.ts';

export interface HorizonEvent { et: number; kind: 'sunrise'|'sunset'|'earthrise'|'earthset' }
export interface UpcomingEvents {
  sunrise: HorizonEvent|null; sunset: HorizonEvent|null;
  earthrise: HorizonEvent|null; earthset: HorizonEvent|null;
  joint: { startEt:number; endEt:number; ongoing:boolean; startClipped:boolean; endClipped:boolean }|null;
}

function nextTransition(intervals: TimeInterval[], et: number, startKind: HorizonEvent['kind'], endKind: HorizonEvent['kind'], coverage: TimeInterval): [HorizonEvent|null, HorizonEvent|null] {
  let start: HorizonEvent|null = null, end: HorizonEvent|null = null;
  for (const span of intervals) {
    if (!start && span.startEt > et && span.startEt > coverage.startEt) start = { et: span.startEt, kind: startKind };
    if (!end && span.endEt > et && span.endEt < coverage.endEt) end = { et: span.endEt, kind: endKind };
    if (start && end) break;
  }
  return [start, end];
}

/** Find upcoming physical boundaries; analysis-coverage edges are never called events. */
export function getUpcomingEvents(analysis: SiteAnalysis, et: number): UpcomingEvents {
  if (!Number.isFinite(et) || !Number.isFinite(analysis.period.startEt) || !Number.isFinite(analysis.period.endEt) ||
      analysis.period.startEt >= analysis.period.endEt || et < analysis.period.startEt || et > analysis.period.endEt) {
    throw new RangeError('Event time must be finite ET within the analysis period');
  }
  const coverage = analysis.period;
  const [sunrise, sunset] = nextTransition(analysis.sun.intervals, et, 'sunrise', 'sunset', coverage);
  const [earthrise, earthset] = nextTransition(analysis.earth.intervals, et, 'earthrise', 'earthset', coverage);
  const span = analysis.both.intervals.find(interval => interval.endEt > et) ?? null;
  return {
    sunrise, sunset, earthrise, earthset,
    joint: span ? { startEt: span.startEt, endEt: span.endEt, ongoing: span.startEt <= et && et < span.endEt,
      startClipped: span.startEt === coverage.startEt, endClipped: span.endEt === coverage.endEt } : null,
  };
}
