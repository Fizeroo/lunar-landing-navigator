import type { BodyObservation, EphemerisData, Observation, Site, Vec3 } from '../contracts.ts';

const DEG = 180 / Math.PI;
const timelines = new WeakMap<EphemerisData, number[]>();

function fail(message: string): never { throw new Error(`Science: ${message}`); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function vector(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(finite);
}

/** Strict UTC only; Date.parse alone silently accepts invalid calendar dates. */
function utcSeconds(value: unknown): number {
  if (typeof value !== 'string') return fail('UTC must be an ISO string ending in Z');
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!match || Number(match[1]!.slice(-2)) >= 60) return fail('Invalid UTC or unsupported leap second');
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== match[1]) {
    return fail('Invalid UTC calendar date');
  }
  return milliseconds / 1000 + Number(`0.${match[2] ?? '0'}`);
}

function safeSegment(data: EphemerisData, seconds: number[], i: number): void {
  const a = data.samples[i]!;
  const b = data.samples[i + 1]!;
  if (Math.abs((b.et - a.et) - (seconds[i + 1]! - seconds[i]!)) > 0.5) {
    fail('UTC interpolation across a leap-second boundary is unsupported');
  }
  const boundaries = data.provenance['leapSecondBoundariesUtc'];
  if (Array.isArray(boundaries) && boundaries.some(value => {
    const t = utcSeconds(value);
    return seconds[i]! < t && t <= seconds[i + 1]!;
  })) fail('UTC interpolation across a leap-second boundary is unsupported');
}

/** Validate once after fetching JSON; all physics keeps JS Float64 numbers. */
export function validateEphemeris(value: unknown): EphemerisData {
  if (!record(value) || value['schemaVersion'] !== '1.0' || typeof value['id'] !== 'string' || !value['id']) fail('Invalid dataset identity');
  const model = value['model'];
  if (!record(model) || model['frame'] !== 'MOON_ME_DE440_ME421' || model['originNaifId'] !== 301 ||
      model['abcorr'] !== 'NONE' || model['units'] !== 'm' || model['referenceRadiusM'] !== 1737400 ||
      model['horizon'] !== 'reference-tangent-h0' || model['sunRadiusM'] !== 695700000 || model['earthRadiusM'] !== 6378136.6) {
    fail('Unsupported frame, units, correction, radii or horizon model');
  }
  const coverage = value['coverage'];
  if (!record(coverage) || !finite(coverage['startEt']) || !finite(coverage['endEt']) || coverage['endEt'] <= coverage['startEt']) fail('Invalid coverage');
  if (!record(value['provenance'])) fail('Missing provenance');
  const rows = value['samples'];
  if (!Array.isArray(rows) || rows.length < 2) fail('At least two samples required');
  const seconds: number[] = [];
  for (const [i, row] of rows.entries()) {
    if (!record(row) || !finite(row['et']) || !vector(row['sunM']) || !vector(row['earthM'])) fail(`Invalid sample ${i}`);
    if (Math.hypot(...row['sunM']) <= 695700000 + 1737400 || Math.hypot(...row['earthM']) <= 6378136.6 + 1737400) fail(`Invalid target distance at sample ${i}`);
    seconds.push(utcSeconds(row['utc']));
    if (i && (row['et'] <= rows[i - 1]['et'] || seconds[i]! <= seconds[i - 1]!)) fail('Sample epochs must strictly increase');
    if (i && row['et'] - rows[i - 1]['et'] > 600.001) fail('Unsupported sample gap: maximum 600 ET seconds');
  }
  const start = utcSeconds(coverage['startUtc']);
  const end = utcSeconds(coverage['endUtc']);
  if (start !== seconds[0] || end !== seconds.at(-1) || coverage['startEt'] !== rows[0]['et'] || coverage['endEt'] !== rows.at(-1)['et']) fail('Coverage does not match endpoint samples');
  validateProvenance(value['provenance'], coverage['startEt'], coverage['endEt']);
  const data = value as unknown as EphemerisData;
  timelines.set(data, seconds);
  return data;
}

function validateProvenance(provenance: Record<string, unknown>, start: number, end: number): void {
  const targets = provenance['targetNaifIds'];
  if (!record(targets) || targets['sun'] !== 10 || targets['earth'] !== 399) fail('Missing Sun10/Earth399 provenance');
  for (const name of ['generator', 'generatorVersion', 'pythonVersion', 'spiceypyVersion', 'cspiceVersion', 'utcAssumption']) {
    if (typeof provenance[name] !== 'string' || !(provenance[name] as string).trim()) fail(`Missing provenance ${name}`);
  }
  utcSeconds(provenance['generatedUtc']);
  if (provenance['timeScale'] !== 'TDB' || provenance['etEpoch'] !== 'J2000' || provenance['stepSeconds'] !== 600 ||
      provenance['bodyShapeModel'] !== 'spherical-envelope: max PCK semiaxis' || provenance['terrainApplied'] !== false ||
      provenance['occultationsApplied'] !== false || provenance['refractionApplied'] !== false) fail('Missing or incompatible model/time provenance');
  const leaps = provenance['leapSecondBoundariesUtc'];
  if (!Array.isArray(leaps) || leaps.length === 0) fail('Missing leap-second assumptions');
  leaps.forEach(utcSeconds);
  const expectedFiles: Record<string, string> = {
    'de440s.bsp': 'spk/planets/', 'moon_pa_de440_200625.bpc': 'pck/',
    'moon_de440_250416.tf': 'fk/satellites/', 'naif0012.tls': 'lsk/', 'pck00011.tpc': 'pck/',
  };
  const kernels = provenance['kernels'];
  if (!Array.isArray(kernels) || kernels.length !== 5) fail('Five pinned kernel records required');
  const names = new Set<string>();
  for (const kernel of kernels) {
    if (!record(kernel) || typeof kernel['filename'] !== 'string' || !Object.hasOwn(expectedFiles, kernel['filename']) ||
        names.has(kernel['filename']) || kernel['url'] !== `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/${expectedFiles[kernel['filename']]}${kernel['filename']}` ||
        !finite(kernel['bytes']) || !Number.isInteger(kernel['bytes']) || kernel['bytes'] <= 0 ||
        typeof kernel['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(kernel['sha256'])) fail('Invalid pinned kernel provenance');
    utcSeconds(kernel['retrievedUtc']);
    names.add(kernel['filename']);
  }
  const loaded = provenance['loadedCoverage'];
  if (!record(loaded) || !record(loaded['byObjectEt']) || !Array.isArray(loaded['intersectionEt']) ||
      !loaded['intersectionEt'].some((range: unknown) => Array.isArray(range) && range.length === 2 && range.every(finite) && range[0]! <= start && end <= range[1]!)) fail('Requested coverage is not within recorded kernel intersection');
}

function timeline(data: EphemerisData): number[] {
  if (!timelines.has(data)) validateEphemeris(data);
  return timelines.get(data)!;
}

/** Bracket without extrapolation. Last endpoint belongs to the final segment. */
function bracket(values: readonly number[], target: number): number {
  if (!finite(target) || target < values[0]! || target > values.at(-1)!) fail('Time outside supported coverage');
  let lo = 0;
  let hi = values.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function utcToEt(data: EphemerisData, utc: string): number {
  const seconds = timeline(data);
  const t = utcSeconds(utc);
  const i = bracket(seconds, t);
  safeSegment(data, seconds, i);
  const a = data.samples[i]!;
  const b = data.samples[i + 1]!;
  return a.et + (b.et - a.et) * ((t - seconds[i]!) / (seconds[i + 1]! - seconds[i]!));
}

export function etToUtc(data: EphemerisData, et: number): string {
  const seconds = timeline(data);
  const i = etBracket(data, et);
  safeSegment(data, seconds, i);
  const a = data.samples[i]!;
  const b = data.samples[i + 1]!;
  if (et === a.et) return a.utc;
  if (et === b.et) return b.utc;
  const t = seconds[i]! + (seconds[i + 1]! - seconds[i]!) * ((et - a.et) / (b.et - a.et));
  // Millisecond UI output; round rather than truncate the UTC label.
  return new Date(Math.round(t * 1000)).toISOString();
}

function etBracket(data: EphemerisData, et: number): number {
  if (!finite(et) || et < data.coverage.startEt || et > data.coverage.endEt) fail('Time outside supported coverage');
  let lo = 0, hi = data.samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (data.samples[mid]!.et <= et) lo = mid;
    else hi = mid;
  }
  return lo;
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  if (!finite(length) || length <= 0) return fail('Invalid direction');
  return v.map(n => n / length) as Vec3;
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

export function observeAt(data: EphemerisData, et: number, site: Site): Observation {
  timeline(data);
  if (!site || !finite(site.latDeg) || site.latDeg < -90 || site.latDeg > 90 || !finite(site.lonDeg) ||
      site.lonDeg < -180 || site.lonDeg >= 180 || site.heightAboveReferenceSphereM !== 0) fail('Invalid site: planetocentric latitude, east longitude [-180,180), h=0 required');
  const i = etBracket(data, et);
  const a = data.samples[i]!, b = data.samples[i + 1]!;
  const f = (et - a.et) / (b.et - a.et);
  const interpolate = (x: Vec3, y: Vec3): Vec3 => x.map((n, j) => n + f * (y[j]! - n)) as Vec3;
  const sun = interpolate(a.sunM, b.sunM), earth = interpolate(a.earthM, b.earthM);
  const phi = site.latDeg / DEG, lambda = site.lonDeg / DEG;
  const up: Vec3 = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  const east: Vec3 = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north: Vec3 = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const body = (position: Vec3, radius: number): BodyObservation => {
    const d = position.map((n, j) => n - data.model.referenceRadiusM * up[j]!) as Vec3;
    const distanceM = Math.hypot(...d);
    if (distanceM <= radius) return fail('Observer inside target disk');
    const direction = unit(d);
    const e = dot(direction, east), n = dot(direction, north), u = dot(direction, up);
    const horizontal = Math.hypot(e, n);
    const altDeg = Math.atan2(u, horizontal) * DEG;
    const azDeg = Math.abs(site.latDeg) === 90 || horizontal < 1e-12 ? null : ((Math.atan2(e, n) * DEG) % 360 + 360) % 360;
    const angularRadiusDeg = Math.asin(radius / distanceM) * DEG;
    return { azDeg, altDeg, direction, distanceM, angularRadiusDeg,
      centerAboveReferenceHorizon: altDeg > 0,
      diskState: altDeg + angularRadiusDeg <= 0 ? 'none' : altDeg - angularRadiusDeg >= 0 ? 'full' : 'partial' };
  };
  return { et, utc: etToUtc(data, et), site: { ...site }, sun: body(sun, data.model.sunRadiusM), earth: body(earth, data.model.earthRadiusM), sunDirectionBody: unit(sun), earthDirectionBody: unit(earth) };
}
