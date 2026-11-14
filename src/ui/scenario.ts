/**
 * Saved comparison scenarios (UI-owned schema, version 1).
 * A scenario is public, secret-free data: a site, a start time, a duration and
 * an observer height, always analysed with the reference-sphere model.
 * Everything read from localStorage, a file or a URL fragment goes through
 * validateScenarioSet() before it is used.
 */
export interface ScenarioSite {
  latDeg: number;
  lonDeg: number;
  heightAboveReferenceSphereM: 0;
}

export interface Scenario {
  version: 1;
  id: string;
  name: string;
  site: ScenarioSite;
  startUtc: string;
  durationSeconds: number;
  observerHeightM: number;
  model: 'reference-sphere';
  datasetId: string;
}

export interface ScenarioSet {
  version: 1;
  scenarios: Scenario[];
}

export const SCENARIO_STORAGE_KEY = 'lunar-landing-navigator.scenarios.v1';
export const SCENARIO_HASH_KEY = 'scenarios';
export const MAX_SCENARIOS = 12;
export const MIN_DURATION_SECONDS = 600;
export const MAX_DURATION_SECONDS = 200 * 86400;
export const MAX_OBSERVER_HEIGHT_M = 10000;
export const DEFAULT_DURATION_SECONDS = 7 * 86400;

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Strict "YYYY-MM-DDTHH:MM:SSZ" that is also a real calendar instant. */
export function isStrictUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19);
}

/** Plain text only: control characters removed, whitespace collapsed, length limited. */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Returns a NEW object holding only the public schema fields, or throws an Error with an English reason. */
export function validateScenario(value: unknown): Scenario {
  if (!isRecord(value)) throw new Error('Scenario must be an object.');
  if (value['version'] !== 1) throw new Error('Unsupported scenario version (expected 1).');
  const id = value['id'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('Scenario id must be 1–40 letters, digits, "-" or "_".');
  const name = cleanName(value['name']);
  if (!name) throw new Error('Scenario name must be non-empty text.');
  const site = value['site'];
  if (!isRecord(site)) throw new Error('Scenario site is missing.');
  const { latDeg, lonDeg } = site;
  if (!finiteNumber(latDeg) || latDeg < -90 || latDeg > 90) throw new Error('Scenario latitude must be from −90 to 90.');
  if (!finiteNumber(lonDeg) || lonDeg < -180 || lonDeg >= 180) throw new Error('Scenario longitude must be from −180 (inclusive) to 180 (exclusive), east-positive.');
  if (site['heightAboveReferenceSphereM'] !== 0) throw new Error('Scenario site height must be 0; use observerHeightM for the observer.');
  const startUtc = value['startUtc'];
  if (!isStrictUtc(startUtc)) throw new Error('Scenario start must be UTC like 2026-11-15T12:00:00Z.');
  const durationSeconds = value['durationSeconds'];
  if (!finiteNumber(durationSeconds) || durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
    throw new Error('Scenario duration must be between 10 minutes and 200 days.');
  }
  const observerHeightM = value['observerHeightM'];
  if (!finiteNumber(observerHeightM) || observerHeightM < 0 || observerHeightM > MAX_OBSERVER_HEIGHT_M) {
    throw new Error('Scenario observer height must be from 0 to 10000 m.');
  }
  if (value['model'] !== 'reference-sphere') throw new Error('Scenario model must be "reference-sphere".');
  const datasetId = value['datasetId'];
  if (typeof datasetId !== 'string' || datasetId.length < 1 || datasetId.length > 120 || /[\u0000-\u001f<>]/.test(datasetId)) {
    throw new Error('Scenario dataset id is missing or invalid.');
  }
  return {
    version: 1,
    id,
    name,
    site: { latDeg, lonDeg, heightAboveReferenceSphereM: 0 },
    startUtc,
    durationSeconds,
    observerHeightM,
    model: 'reference-sphere',
    datasetId,
  };
}

export function validateScenarioSet(value: unknown): ScenarioSet {
  if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['scenarios'])) {
    throw new Error('Not a scenario file: expected {"version":1,"scenarios":[…]}.');
  }
  const list = value['scenarios'];
  if (list.length < 1 || list.length > MAX_SCENARIOS) throw new Error(`A scenario file must hold 1 to ${MAX_SCENARIOS} scenarios.`);
  const seen = new Set<string>();
  const scenarios = list.map((item, index) => {
    let scenario: Scenario;
    try {
      scenario = validateScenario(item);
    } catch (error) {
      throw new Error(`Scenario ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (seen.has(scenario.id)) throw new Error(`Scenario ${index + 1}: duplicate id "${scenario.id}".`);
    seen.add(scenario.id);
    return scenario;
  });
  return { version: 1, scenarios };
}

/** JSON text for export: only the public schema fields, in a fixed order. */
export function serializeScenarioSet(set: ScenarioSet): string {
  return JSON.stringify(validateScenarioSet(set), null, 2);
}

export function parseScenarioSet(text: string): ScenarioSet {
  if (text.length > 200_000) throw new Error('Scenario file is too large.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Scenario file is not valid JSON.');
  }
  return validateScenarioSet(raw);
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Shared link is not valid.');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Shared link is not valid.');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** "scenarios=<base64url JSON>" for a URL fragment. Nothing is sent to any server. */
export function encodeScenarioFragment(set: ScenarioSet): string {
  return `${SCENARIO_HASH_KEY}=${toBase64Url(JSON.stringify(validateScenarioSet(set)))}`;
}

/** Returns null when the fragment holds no scenarios; throws when it holds invalid ones. */
export function decodeScenarioFragment(hash: string): ScenarioSet | null {
  const body = hash.replace(/^#/, '');
  for (const part of body.split('&')) {
    const [key, value] = part.split('=');
    if (key === SCENARIO_HASH_KEY && value !== undefined) {
      if (value.length > 60_000) throw new Error('Shared link is too long.');
      let text: string;
      try {
        text = fromBase64Url(value);
      } catch {
        throw new Error('Shared link is not valid.');
      }
      return parseScenarioSet(text);
    }
  }
  return null;
}

export interface WindowFit {
  startEt: number;
  endEt: number;
  /** True when the requested window did not fit and was moved or shortened. */
  adjusted: boolean;
}

/**
 * Fit [startEt, startEt + duration] into the dataset coverage.
 * A window that starts too late is moved earlier; one longer than the dataset is shortened.
 */
export function fitWindow(startEt: number, durationSeconds: number, coverageStartEt: number, coverageEndEt: number): WindowFit {
  const available = coverageEndEt - coverageStartEt;
  const duration = Math.min(durationSeconds, available);
  const start = Math.min(Math.max(startEt, coverageStartEt), coverageEndEt - duration);
  return { startEt: start, endEt: start + duration, adjusted: start !== startEt || duration !== durationSeconds };
}

let counter = 0;
export function newScenarioId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

export interface ScenarioSeed {
  name: string;
  latDeg: number;
  lonDeg: number;
  observerHeightM: number;
}

/** "2026-11-15T12:00:00Z" + days -> strict UTC string. */
export function addDaysUtc(utc: string, days: number): string {
  return `${new Date(Date.parse(utc) + days * 86400_000).toISOString().slice(0, 19)}Z`;
}

/** The three default scenarios: A now, A +3 days, B now — all with the same duration. */
export function defaultScenarios(a: ScenarioSeed, b: ScenarioSeed, nowUtc: string, datasetId: string, durationSeconds = DEFAULT_DURATION_SECONDS): ScenarioSet {
  const make = (seed: ScenarioSeed, suffix: string, startUtc: string): Scenario => ({
    version: 1,
    id: newScenarioId(),
    name: cleanName(`${seed.name} — ${suffix}`),
    site: { latDeg: seed.latDeg, lonDeg: seed.lonDeg, heightAboveReferenceSphereM: 0 },
    startUtc,
    durationSeconds,
    observerHeightM: seed.observerHeightM,
    model: 'reference-sphere',
    datasetId,
  });
  return validateScenarioSet({
    version: 1,
    scenarios: [make(a, 'now', nowUtc), make(a, '+3 days', addDaysUtc(nowUtc, 3)), make(b, 'now', nowUtc)],
  });
}
