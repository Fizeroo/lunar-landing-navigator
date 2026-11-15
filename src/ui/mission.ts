/**
 * Mission-window UI logic without DOM: request building, What-if changes, plain-English wording,
 * Experience playback stepping and the guided-demo fixture. All astronomy comes from src/science/mission.ts.
 */
import type { Condition, Site } from '../contracts.ts';
import type { MissionCurrent, MissionEndReason, MissionModel, MissionRequest, MissionResult, MissionWindow } from '../science/mission.ts';

export const DURATION_PRESETS_HOURS = [6, 12, 24, 48] as const;
export const DAY_SECONDS = 86400;

export const MISSION_CONDITION_LABEL: Record<Condition, string> = {
  sun: 'Sun above the horizon',
  earth: 'Earth above the horizon',
  both: 'Sun and Earth above the horizon together',
};
const CONDITION_SHORT: Record<Condition, string> = { sun: 'the Sun', earth: 'Earth', both: 'the Sun and Earth together' };

export const MISSION_MODEL_LABEL: Record<MissionModel, string> = {
  'reference-sphere': 'Reference sphere',
  terrain: 'Real terrain patch',
};

/** Display formatters supplied by the app (they need the dataset to turn ET into UTC). */
export interface MissionFormat {
  /** ET -> "2026-11-17 20:39 UTC", rounded to the minute. */
  when(et: number): string;
  /** Seconds -> "≈ 5 h 12 min". */
  duration(seconds: number): string;
}

/** Custom duration in hours -> seconds. Throws an English message for anything unusable. */
export function parseDurationHours(text: string): number {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '' || !/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Mission duration must be a number of hours, for example 36 or 1.5.');
  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('Mission duration must be more than 0 hours.');
  const seconds = Math.round(hours * 3600);
  if (seconds < 1) throw new Error('Mission duration must be at least 1 second.');
  return seconds;
}

/** "48 h", "1.5 h", "90 s" — the exact requirement, not an approximation. */
export function formatRequired(seconds: number): string {
  if (seconds < 3600 && seconds % 60 !== 0) return `${seconds} s`;
  const hours = seconds / 3600;
  return `${Number(hours.toFixed(2))} h`;
}

/** Deep, frozen copy: a baseline that later form edits cannot change. */
export function freezeRequest(request: MissionRequest): MissionRequest {
  return Object.freeze({ ...request, site: Object.freeze({ ...request.site }), range: Object.freeze({ ...request.range }) });
}

/** Identity of everything that affects a result; used to mark results stale. */
export function requestKey(request: MissionRequest): string {
  return [request.site.latDeg, request.site.lonDeg, request.observerHeightM, request.model, request.range.startEt, request.range.endEt,
    request.requiredSeconds, request.condition, request.currentStartEt].join('|');
}

export type WhatIfChange =
  | { kind: 'start-plus-1-day' }
  | { kind: 'site'; site: Site; siteName: string }
  | { kind: 'height'; observerHeightM: number };

/**
 * The alternative request for a What-if: the frozen baseline with exactly ONE explicit change.
 * Duration, condition, range and model are copied unchanged; nothing is searched or shifted.
 */
export function applyWhatIf(baseline: MissionRequest, change: WhatIfChange): MissionRequest {
  const copy: MissionRequest = { ...baseline, site: { ...baseline.site }, range: { ...baseline.range } };
  if (change.kind === 'start-plus-1-day') {
    copy.currentStartEt = baseline.currentStartEt + DAY_SECONDS;
  } else if (change.kind === 'site') {
    if (change.site.latDeg === baseline.site.latDeg && change.site.lonDeg === baseline.site.lonDeg) throw new Error('The other site has the same coordinates as the baseline site, so there is nothing to compare.');
    copy.site = { latDeg: change.site.latDeg, lonDeg: change.site.lonDeg, heightAboveReferenceSphereM: 0 };
  } else {
    if (!Number.isFinite(change.observerHeightM) || change.observerHeightM < 0 || change.observerHeightM > 10000) throw new Error('What-if height must be a number from 0 to 10000 m.');
    if (change.observerHeightM === baseline.observerHeightM) throw new Error('The What-if height equals the baseline height, so there is nothing to compare.');
    copy.observerHeightM = change.observerHeightM;
  }
  return freezeRequest(copy);
}

export function describeChange(change: WhatIfChange, baseline: MissionRequest, format: MissionFormat): string {
  if (change.kind === 'start-plus-1-day') return `start exactly 1 UTC day later (${format.when(baseline.currentStartEt + DAY_SECONDS)})`;
  if (change.kind === 'site') return `use ${change.siteName} instead`;
  return `observer height ${change.observerHeightM} m instead of ${baseline.observerHeightM} m`;
}

const END_REASON_TEXT: Record<MissionEndReason, string> = {
  sunset: 'the Sun sets (its centre goes below the reference horizon)',
  earthset: 'Earth sets (its centre goes below the reference horizon)',
  'both-set': 'the Sun and Earth set at the same moment',
  'search-range-end': 'the selected search range ends — not a physical end; the conditions may continue',
  'data-coverage-end': 'the prepared data ends — not a physical end; the real end is unknown',
};

export function endReasonText(reason: MissionEndReason): string {
  return END_REASON_TEXT[reason];
}

/** True for ends that are a real change in the sky rather than an edge of the search range or data. */
export function isPhysicalEnd(reason: MissionCurrent['endReason']): reason is 'sunset' | 'earthset' | 'both-set' {
  return reason === 'sunset' || reason === 'earthset' || reason === 'both-set';
}

export interface Verdict {
  tone: 'ok' | 'fail';
  /** One short sentence: the answer. */
  headline: string;
  /** One or two plain sentences: why. */
  detail: string;
  /** What limits the result, as a short phrase. */
  limit: string;
}

/** The answer for the exact requested start. Never describes a shifted start as a success. */
export function describeCurrent(current: MissionCurrent, request: MissionRequest, format: MissionFormat): Verdict {
  const need = formatRequired(request.requiredSeconds);
  const what = CONDITION_SHORT[request.condition];
  const start = format.when(current.startEt);
  if (current.endReason === 'outside-data') {
    return { tone: 'fail', headline: `No answer for a start at ${start}`, detail: 'This start is outside the prepared data, so nothing can be evaluated there. Nothing was shifted.', limit: 'start outside the prepared data' };
  }
  if (!current.conditionMetAtStart) {
    return {
      tone: 'fail',
      headline: `No — not from ${start}`,
      detail: `At this exact start ${what} ${request.condition === 'both' ? 'are' : 'is'} not above the reference horizon, so 0 of the ${need} needed is available.`,
      limit: 'the condition is not met at the start',
    };
  }
  if (current.availableSeconds <= 0) {
    // The start is exactly the last instant of the prepared data: met there, but no time after it is known.
    return {
      tone: 'fail',
      headline: `No — the prepared data ends at ${start}`,
      detail: `At this instant ${what} ${request.condition === 'both' ? 'are' : 'is'} above the reference horizon, but the prepared data ends here, so none of the ${need} needed can be confirmed. Nothing is extrapolated.`,
      limit: 'the edge of the prepared data',
    };
  }
  const available = format.duration(current.availableSeconds);
  const end = current.endEt === null ? '' : format.when(current.endEt);
  const physical = isPhysicalEnd(current.endReason);
  const endSentence = current.endEt === null ? '' : physical
    ? `It ends at ${end}, when ${END_REASON_TEXT[current.endReason as MissionEndReason]}.`
    : current.endReason === 'data-coverage-end'
      ? `The prepared data ends at ${end} while the condition still holds, so the real end is unknown.`
      : `The selected search range ends before the condition does (the condition continues until ${end}).`;
  if (current.requirementMet) {
    return {
      tone: 'ok',
      headline: `Yes — ${need} fits from ${start}`,
      detail: `From this start ${what} stay${request.condition === 'both' ? '' : 's'} up for ${available}: ${need} needed, ${format.duration(current.spareSeconds)} to spare. ${endSentence}`,
      limit: physical ? END_REASON_TEXT[current.endReason as MissionEndReason] : 'the edge of the prepared data',
    };
  }
  if (current.availableSeconds >= request.requiredSeconds && !current.fitsSearchRange) {
    return {
      tone: 'fail',
      headline: `No — ${need} does not fit inside the search range from ${start}`,
      detail: `The sky conditions last long enough (${available}), but the mission from this start would run outside the selected search range. The range, not the physical conditions, prevents it. ${endSentence}`,
      limit: 'the selected search range',
    };
  }
  const short = format.duration(request.requiredSeconds - current.availableSeconds);
  return {
    tone: 'fail',
    headline: `No — only ${available.replace('≈ ', '')} of ${need} from ${start}`,
    detail: `From this start ${what} stay${request.condition === 'both' ? '' : 's'} up for ${available}, which is ${short} too short. ${endSentence}`,
    limit: physical ? END_REASON_TEXT[current.endReason as MissionEndReason] : 'the edge of the prepared data',
  };
}

export function describeWindow(window: MissionWindow, format: MissionFormat): string {
  const edges: string[] = [];
  if (window.startClipped) edges.push('its beginning is cut by the search range or data edge');
  const ending = `ends when ${END_REASON_TEXT[window.endReason]}`;
  return `${format.when(window.startEt)} → ${format.when(window.endEt)} (${format.duration(window.availableSeconds)}); ${ending}${edges.length ? `; ${edges.join('; ')}` : ''}.`;
}

export interface SearchSummary {
  /** The earliest start at or after the requested start that satisfies the requirement, or the reason there is none. */
  nearest: string;
  /** Extra plain sentences: latest allowed start, number of windows, earlier windows, longest span. */
  notes: string[];
}

/** The separate search result: where a suitable start exists. Kept apart from the fixed-start verdict. */
export function describeSearch(result: MissionResult, format: MissionFormat): SearchSummary {
  const { request, nearest, windows, longest, recommendedStartEt } = result;
  const need = formatRequired(request.requiredSeconds);
  const notes: string[] = [];
  let text: string;
  if (nearest && recommendedStartEt !== null) {
    const same = Math.abs(recommendedStartEt - request.currentStartEt) < 1;
    text = same
      ? `Your start already lies in a suitable window: ${describeWindow(nearest, format)}`
      : `Earliest start that works: ${format.when(recommendedStartEt)}, ${format.duration(recommendedStartEt - request.currentStartEt)} after your start. Window: ${describeWindow(nearest, format)}`;
    notes.push(`Allowed mission starts: ${format.when(nearest.allowedStart.startEt)} to ${format.when(nearest.allowedStart.endEt)} (any start in between leaves ${need}).`);
  } else if (windows.length > 0) {
    const last = windows[windows.length - 1]!;
    text = `No suitable start at or after your start inside the search range. ${windows.length === 1 ? 'One earlier window' : `${windows.length} earlier windows`} in the range would fit ${need}; the last one: ${describeWindow(last, format)}`;
    notes.push(`Allowed mission starts in that earlier window: ${format.when(last.allowedStart.startEt)} to ${format.when(last.allowedStart.endEt)}.`);
    notes.push('Within this search range you could start earlier, shorten the mission, or try another site.');
  } else if (longest) {
    text = `No window of ${need} exists in the search range. The longest continuous span is ${format.duration(longest.availableSeconds)}: ${describeWindow(longest, format)}`;
    notes.push(`Within this search range, a mission of up to ${format.duration(longest.availableSeconds).replace('≈ ', 'about ')} would fit there; otherwise shorten the mission or try another site.`);
  } else {
    text = 'The condition is never met inside the search range.';
    notes.push('Within this search range no mission length fits at this site; try another site.');
  }
  if (windows.length > 0) notes.push(`${windows.length} window${windows.length === 1 ? '' : 's'} of at least ${need} in the search range.`);
  if (longest && (nearest || windows.length > 0)) notes.push(`Longest continuous span in the range: ${format.duration(longest.availableSeconds)}.`);
  return { nearest: text, notes };
}

export interface WhatIfSummary {
  headline: string;
  baseline: string;
  alternative: string;
  delta: string;
  limit: string;
}

/** Wording for compareMissionStarts: both sides are fixed starts; neither was searched or moved. */
export function describeWhatIf(
  comparison: { baseline: MissionCurrent; alternative: MissionCurrent; deltaAvailableSeconds: number },
  baseline: MissionRequest, alternative: MissionRequest, change: WhatIfChange, format: MissionFormat,
): WhatIfSummary {
  const base = describeCurrent(comparison.baseline, baseline, format);
  const alt = describeCurrent(comparison.alternative, alternative, format);
  const delta = comparison.deltaAvailableSeconds;
  const deltaText = delta === 0
    ? 'No difference in available continuous time.'
    : `${delta > 0 ? 'Gain' : 'Loss'}: ${Math.abs(delta) < 60 ? `${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)} s` : format.duration(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} continuous time from the fixed start.`;
  const outcome = comparison.baseline.requirementMet === comparison.alternative.requirementMet
    ? (comparison.alternative.requirementMet ? 'Both fit the mission.' : 'Neither fits the mission.')
    : comparison.alternative.requirementMet ? 'The change makes the mission fit.' : 'The change makes the mission fail.';
  return {
    headline: `What if: ${describeChange(change, baseline, format)}? ${outcome}`,
    baseline: `Baseline — ${base.headline}. ${base.detail}`,
    alternative: `With the change — ${alt.headline}. ${alt.detail}`,
    delta: deltaText,
    limit: `Limiting factor with the change: ${alt.limit}. This compares continuous above-horizon time only — not power, a radio link or landing safety.`,
  };
}

// ---------- Experience playback ----------

export interface PlaybackStep {
  et: number;
  /** Simulated seconds per real second actually used for this step. */
  speed: number;
  slowed: boolean;
  /** True when this step arrived at the stop time; the caller pauses there. */
  reachedStop: boolean;
}

/** Slow down inside this many simulated seconds before the stop, to this speed (simulated s per real s). */
export const SLOW_ZONE_SECONDS = 2 * 3600;
export const SLOW_SPEED = 600;

/**
 * Advance accelerated playback by `dtSeconds` of real time. It never passes `stopEt`:
 * it slows down near it and lands exactly on it. With `stopEt` null it just advances.
 */
export function playbackStep(et: number, dtSeconds: number, speed: number, stopEt: number | null): PlaybackStep {
  if (stopEt === null || stopEt <= et) return { et: et + dtSeconds * speed, speed, slowed: false, reachedStop: false };
  const remaining = stopEt - et;
  const slowed = remaining <= SLOW_ZONE_SECONDS && speed > SLOW_SPEED;
  const used = slowed ? SLOW_SPEED : speed;
  let next = et + dtSeconds * used;
  // Do not jump over the start of the slow zone at full speed.
  if (!slowed && speed > SLOW_SPEED && stopEt - next < SLOW_ZONE_SECONDS) next = Math.max(et, Math.min(next, stopEt - SLOW_ZONE_SECONDS));
  if (next >= stopEt) return { et: stopEt, speed: used, slowed, reachedStop: true };
  return { et: next, speed: used, slowed, reachedStop: false };
}

/** "6 h of mission time per second". */
export function formatSpeed(speed: number): string {
  if (speed >= 86400) return `${Number((speed / 86400).toFixed(1))} d per second`;
  if (speed >= 3600) return `${Number((speed / 3600).toFixed(1))} h per second`;
  return `${Math.round(speed / 60)} min per second`;
}

export interface ExperienceStop {
  et: number;
  /** Shown while playing: what the playback is heading to. */
  heading: string;
  /** Shown when playback pauses there: what ended. */
  reached: string;
  /** Body to look at so the ending is in view, when it is a physical event. */
  lookAt: 'sun' | 'earth' | null;
}

/**
 * Where an Experience started at `current.startEt` pauses: the end of the continuous condition
 * from that start. Null when the condition is not met at the start (nothing to wait for).
 */
export function experienceStop(current: MissionCurrent, request: MissionRequest, format: MissionFormat, upcomingStartEt: number | null = null): ExperienceStop | null {
  const what = CONDITION_SHORT[request.condition];
  if (!current.conditionMetAtStart || current.endEt === null) {
    // Nothing is up at this start. If the search found a later window, play toward its beginning.
    if (upcomingStartEt === null || upcomingStartEt <= current.startEt) return null;
    const begins = format.when(upcomingStartEt);
    return {
      et: upcomingStartEt,
      heading: `The condition is not met yet; playing toward the next window at ${begins}`,
      reached: `Paused at ${begins}: the next window found by the search begins here — ${what} ${request.condition === 'both' ? 'are' : 'is'} now above the reference horizon.`,
      lookAt: request.condition === 'earth' ? 'earth' : 'sun',
    };
  }
  // A selected search range that ends before the physical end is where the mission question stops.
  // It is labelled as the range edge, never as a set.
  if (request.range.endEt < current.endEt - 1e-6 && current.startEt < request.range.endEt) {
    const edge = format.when(request.range.endEt);
    return {
      et: request.range.endEt,
      heading: `Playing toward the end of the selected search range at ${edge}`,
      reached: `Paused at ${edge}: the selected search range ends here. Nothing set — ${what} ${request.condition === 'both' ? 'are' : 'is'} still up; this is a range edge, not a physical end.`,
      lookAt: null,
    };
  }
  const when = format.when(current.endEt);
  const lasted = format.duration(current.availableSeconds);
  if (current.endReason === 'sunset' || current.endReason === 'earthset' || current.endReason === 'both-set') {
    const body = current.endReason === 'earthset' ? 'Earth' : current.endReason === 'sunset' ? 'The Sun' : 'The Sun and Earth';
    return {
      et: current.endEt,
      heading: `Playing toward ${current.endReason === 'earthset' ? 'Earthset' : current.endReason === 'sunset' ? 'sunset' : 'the joint set'} at ${when}`,
      reached: `Paused at ${when}: ${body} just went below the reference horizon, so the window ended. From the start ${what} stayed up for ${lasted}.`,
      lookAt: current.endReason === 'earthset' ? 'earth' : 'sun',
    };
  }
  return {
    et: current.endEt,
    heading: `Playing toward the end of the prepared data at ${when}`,
    reached: `Paused at ${when}: the prepared data ends here. Nothing set — the real end of the window is unknown and nothing is extrapolated.`,
    lookAt: null,
  };
}

// ---------- guided demo fixture ----------

export interface MissionDemo {
  version: 1;
  datasetId: string;
  title: string;
  baseline: {
    site: Site; siteName: string; observerHeightM: number; model: 'reference-sphere'; condition: Condition;
    requiredSeconds: number; rangeStartUtc: string; rangeEndUtc: string; startUtc: string;
  };
  change:
    | { kind: 'start-plus-1-day' }
    | { kind: 'site'; site: Site; siteName: string }
    | { kind: 'height'; observerHeightM: number };
  expected: {
    baseline: { requirementMet: boolean; availableSeconds: number; endReason: string };
    alternative: { requirementMet: boolean; availableSeconds: number; endReason: string };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const STRICT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function demoSite(value: unknown, what: string): Site {
  if (!isRecord(value) || typeof value['latDeg'] !== 'number' || typeof value['lonDeg'] !== 'number' || !Number.isFinite(value['latDeg']) || !Number.isFinite(value['lonDeg']) ||
      value['latDeg'] < -90 || value['latDeg'] > 90 || value['lonDeg'] < -180 || value['lonDeg'] >= 180) throw new Error(`Guided demo: ${what} must have latDeg in [−90, 90] and lonDeg in [−180, 180).`);
  return { latDeg: value['latDeg'], lonDeg: value['lonDeg'], heightAboveReferenceSphereM: 0 };
}
function demoExpected(value: unknown, what: string): MissionDemo['expected']['baseline'] {
  if (!isRecord(value) || typeof value['requirementMet'] !== 'boolean' || typeof value['availableSeconds'] !== 'number' || !Number.isFinite(value['availableSeconds']) || typeof value['endReason'] !== 'string') {
    throw new Error(`Guided demo: expected.${what} must have requirementMet, availableSeconds and endReason.`);
  }
  return { requirementMet: value['requirementMet'], availableSeconds: value['availableSeconds'], endReason: value['endReason'] };
}
function demoName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 60) : fallback;
}

/** Validate the prepared guided-demo fixture. The numbers in it are only cross-checked, never displayed as results. */
export function validateMissionDemo(value: unknown): MissionDemo {
  if (!isRecord(value) || value['version'] !== 1) throw new Error('Guided demo: unsupported fixture version.');
  if (typeof value['datasetId'] !== 'string' || value['datasetId'] === '') throw new Error('Guided demo: datasetId is missing.');
  const b = value['baseline'];
  if (!isRecord(b)) throw new Error('Guided demo: baseline is missing.');
  if (b['model'] !== 'reference-sphere') throw new Error('Guided demo: only the reference-sphere model is supported.');
  if (b['condition'] !== 'sun' && b['condition'] !== 'earth' && b['condition'] !== 'both') throw new Error('Guided demo: condition must be sun, earth or both.');
  if (typeof b['requiredSeconds'] !== 'number' || !Number.isFinite(b['requiredSeconds']) || b['requiredSeconds'] < 1) throw new Error('Guided demo: requiredSeconds must be at least 1.');
  if (typeof b['observerHeightM'] !== 'number' || !Number.isFinite(b['observerHeightM']) || b['observerHeightM'] < 0 || b['observerHeightM'] > 10000) throw new Error('Guided demo: observerHeightM must be 0 to 10000.');
  for (const key of ['rangeStartUtc', 'rangeEndUtc', 'startUtc'] as const) {
    if (typeof b[key] !== 'string' || !STRICT_UTC.test(b[key])) throw new Error(`Guided demo: baseline.${key} must be UTC in ISO 8601 form ending in Z.`);
  }
  const c = value['change'];
  if (!isRecord(c)) throw new Error('Guided demo: change is missing.');
  let change: MissionDemo['change'];
  if (c['kind'] === 'start-plus-1-day') change = { kind: 'start-plus-1-day' };
  else if (c['kind'] === 'site') change = { kind: 'site', site: demoSite(c['site'], 'change.site'), siteName: demoName(c['siteName'], 'alternative site') };
  else if (c['kind'] === 'height' && typeof c['observerHeightM'] === 'number' && Number.isFinite(c['observerHeightM']) && c['observerHeightM'] >= 0 && c['observerHeightM'] <= 10000) change = { kind: 'height', observerHeightM: c['observerHeightM'] };
  else throw new Error('Guided demo: change.kind must be start-plus-1-day, site or height.');
  const e = value['expected'];
  if (!isRecord(e)) throw new Error('Guided demo: expected is missing.');
  return {
    version: 1,
    datasetId: value['datasetId'],
    title: demoName(value['title'], 'Guided demo'),
    baseline: {
      site: demoSite(b['site'], 'baseline.site'), siteName: demoName(b['siteName'], 'demo site'), observerHeightM: b['observerHeightM'], model: 'reference-sphere',
      condition: b['condition'], requiredSeconds: b['requiredSeconds'],
      rangeStartUtc: b['rangeStartUtc'] as string, rangeEndUtc: b['rangeEndUtc'] as string, startUtc: b['startUtc'] as string,
    },
    change,
    expected: { baseline: demoExpected(e['baseline'], 'baseline'), alternative: demoExpected(e['alternative'], 'alternative') },
  };
}

/** Compare a live evaluation with the fixture's recorded one. Returns an English mismatch, or null when they agree. */
export function demoMismatch(what: string, live: MissionCurrent, expected: MissionDemo['expected']['baseline']): string | null {
  if (live.requirementMet !== expected.requirementMet) return `${what}: the live result (${live.requirementMet ? 'fits' : 'does not fit'}) differs from the prepared demo.`;
  if (Math.abs(live.availableSeconds - expected.availableSeconds) > 1) return `${what}: the live available time differs from the prepared demo by more than 1 second.`;
  if (live.endReason !== expected.endReason) return `${what}: the live end reason (${live.endReason}) differs from the prepared demo (${expected.endReason}).`;
  return null;
}

export const DEMO_STEPS = ['select', 'failure', 'change', 'result', 'surface'] as const;
export type DemoStep = (typeof DEMO_STEPS)[number];
export const DEMO_STEP_TITLE: Record<DemoStep, string> = {
  select: 'Choose the site and the need',
  failure: 'This start does not work',
  change: 'Make one explicit change',
  result: 'Compare the two fixed starts',
  surface: 'See it from the surface',
};
