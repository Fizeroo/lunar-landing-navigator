import type { EphemerisData, Observation, Site, Vec3 } from '../contracts.ts';
import { observeAt } from './index.ts';

const R = 1_737_400;
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export interface TerrainPatch {
  schemaVersion: 1;
  id: string;
  frame: 'MOON_ME_DE440_ME421';
  source: {
    product: string; url: string; productPage: string; citation: string; license: string;
    sourceFrame: 'MOON_ME_DE421'; frameAlignment: string; frameApproximationMaxRad: number;
    crsWkt: string; nativePixelSizeM: number; heightUnits: string; areaOrPoint: string;
    bandDescription: string; sourceNodata: string; sourceBytes: number;
    sourceRasterWidth: number; sourceRasterHeight: number; sourceGeoTransform: number[]; windowHeightRangeM: [number, number];
    sourceWindow: { rowOff: number; colOff: number; height: number; width: number };
    sampledPixelBytesSha256: string; retrievedUtc: string;
  };
  referenceRadiusM: number;
  observer: { site: Site; groundHeightM: number };
  grid: {
    rows: number; cols: number; registration: 'pixel-center'; projection: string;
    sourceWindow: { rowOff: number; colOff: number; height: number; width: number };
    pixelSizeM: number; heightsM: (number | null)[][]; positionsM: (Vec3 | null)[][];
    validCellCount: number; noDataCellCount: number;
  };
}

export interface TerrainVisibility {
  status: 'blocked' | 'clear' | 'insufficient';
  reason: string;
  obstructionAltDeg: number | null;
  limitingDistanceM: number | null;
}
export interface TerrainProfile {
  azStepDeg: number;
  samples: Array<{ azDeg: number; altDeg: number | null; horizonAltDeg: number | null; status: TerrainVisibility['status']; limitingDistanceM: number | null }>;
}

function fail(message: string): never { throw new RangeError(`Terrain: ${message}`); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function validSite(site: Site): void {
  if (!site || !finite(site.latDeg) || site.latDeg < -90 || site.latDeg > 90 || !finite(site.lonDeg) ||
      site.lonDeg < -180 || site.lonDeg >= 180 || site.heightAboveReferenceSphereM !== 0) fail('Site must use valid planetocentric coordinates and h=0');
}
function radial(site: Site): Vec3 {
  const p = site.latDeg * RAD, l = site.lonDeg * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(v: Vec3): number { return Math.hypot(...v); }
function normalize(v: Vec3): Vec3 { const n = norm(v); return v.map(x => x / n) as Vec3; }

/** Validate source provenance, full raster shape, nodata agreement and radial geometry once at load. */
export function validateTerrainPatch(value: unknown): TerrainPatch {
  if (!record(value) || value['schemaVersion'] !== 1 || typeof value['id'] !== 'string' || !value['id'] ||
      value['frame'] !== 'MOON_ME_DE440_ME421' || value['referenceRadiusM'] !== R) fail('Unsupported identity, frame or radius');
  const source = value['source'], observer = value['observer'], grid = value['grid'];
  if (!record(source) || source['product'] !== 'NASA GSFC PGDA90 LDEM_80S_80MPP_ADJ.TIF' ||
      source['url'] !== 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF' ||
      source['sourceFrame'] !== 'MOON_ME_DE421' || !finite(source['frameApproximationMaxRad']) || source['frameApproximationMaxRad'] < 0 ||
      source['frameApproximationMaxRad'] > 5.8204420784597e-7 || typeof source['crsWkt'] !== 'string' ||
      !source['crsWkt'].includes('IAU","30135') || source['nativePixelSizeM'] !== 80 ||
      source['heightUnits'] !== 'm relative to the 1737400 m lunar reference sphere' ||
      source['sourceRasterWidth'] !== 7600 || source['sourceRasterHeight'] !== 7600 ||
      !Array.isArray(source['sourceGeoTransform']) || source['sourceGeoTransform'].length !== 6 ||
      source['sourceGeoTransform'].some((v: unknown, i: number) => !finite(v) || v !== [80, 0, -304000, 0, -80, 304000][i]) ||
      source['sourceNodata'] !== 'NaN / _FillValue=nan' || source['areaOrPoint'] !== 'Area' ||
      source['sourceBytes'] !== 189158392 || !record(source['sourceWindow']) ||
      source['sourceWindow']['height'] !== 101 || source['sourceWindow']['width'] !== 101 ||
      source['sourceWindow']['rowOff'] !== 3370 || source['sourceWindow']['colOff'] !== 3750 ||
      !Array.isArray(source['windowHeightRangeM']) || source['windowHeightRangeM'].length !== 2 ||
      !finite(source['windowHeightRangeM'][0]) || !finite(source['windowHeightRangeM'][1]) ||
      source['windowHeightRangeM'][0] > source['windowHeightRangeM'][1] ||
      !/^[0-9a-f]{64}$/.test(String(source['sampledPixelBytesSha256']))) fail('Missing or incompatible PGDA90 source metadata');
  if (!record(observer) || !record(observer['site']) || !finite(observer['groundHeightM'])) fail('Missing vetted observer');
  const site = observer['site'] as unknown as Site;
  validSite(site);
  if (!record(grid) || grid['registration'] !== 'pixel-center' || grid['pixelSizeM'] !== 80 ||
      !Number.isInteger(grid['rows']) || !Number.isInteger(grid['cols']) || (grid['rows'] as number) < 3 || (grid['cols'] as number) < 3 ||
      (grid['rows'] as number) > 260 || (grid['cols'] as number) > 260 ||
      !record(grid['sourceWindow']) || grid['sourceWindow']['height'] !== grid['rows'] || grid['sourceWindow']['width'] !== grid['cols']) fail('Invalid grid metadata');
  const rows = grid['rows'] as number, cols = grid['cols'] as number;
  const heights = grid['heightsM'], positions = grid['positionsM'];
  if (!Array.isArray(heights) || heights.length !== rows || !Array.isArray(positions) || positions.length !== rows) fail('Grid row count mismatch');
  let validCount = 0;
  for (let r = 0; r < rows; r++) {
    const hs = heights[r], ps = positions[r];
    if (!Array.isArray(hs) || hs.length !== cols || !Array.isArray(ps) || ps.length !== cols) fail(`Grid column count mismatch at row ${r}`);
    for (let c = 0; c < cols; c++) {
      const h = hs[c], p = ps[c];
      if (h === null || p === null) {
        if (h !== null || p !== null) fail(`Nodata mismatch at cell ${r},${c}`);
        continue;
      }
      if (!finite(h) || !Array.isArray(p) || p.length !== 3 || !p.every(finite) || Math.abs(norm(p as Vec3) - (R + h)) > 0.02) fail(`Invalid cell geometry at ${r},${c}`);
      validCount++;
    }
  }
  if (grid['validCellCount'] !== validCount || grid['noDataCellCount'] !== rows * cols - validCount) fail('Cell counts do not match grid');
  const patch = value as unknown as TerrainPatch;
  const sampled = sampleTerrain(patch, site);
  if (!sampled || Math.abs(sampled.heightM - observer['groundHeightM']) > 0.001) fail('Vetted observer does not match its DEM cell');
  return patch;
}

const vertexCache = new WeakMap<TerrainPatch, { rows: number; cols: number; positionsM: Float64Array }>();
const profileCache = new WeakMap<TerrainPatch, Map<string, TerrainProfile>>();
/** Renderer-ready row-major XYZ; nodata vertices are NaN triplets. */
export function terrainVertices(patch: TerrainPatch): { rows: number; cols: number; positionsM: Float64Array } {
  const cached = vertexCache.get(patch);
  if (cached) return cached;
  const { rows, cols, positionsM: source } = patch.grid;
  const positionsM = new Float64Array(rows * cols * 3);
  for (let i = 0; i < rows * cols; i++) {
    const p = source[Math.floor(i / cols)]![i % cols];
    if (p) positionsM.set(p, i * 3);
    else positionsM.fill(Number.NaN, i * 3, i * 3 + 3);
  }
  const result = { rows, cols, positionsM };
  vertexCache.set(patch, result);
  return result;
}

/** Nearest pixel-center sample; reject sites outside a source pixel footprint or on nodata. */
export function sampleTerrain(patch: TerrainPatch, site: Site): { heightM: number; positionM: Vec3 } | null {
  validSite(site);
  const wanted = radial(site);
  let best = -1, bestDot = -Infinity;
  for (let r = 0; r < patch.grid.rows; r++) for (let c = 0; c < patch.grid.cols; c++) {
    const p = patch.grid.positionsM[r]![c];
    if (!p) continue;
    const score = dot(normalize(p), wanted);
    if (score > bestDot) { bestDot = score; best = r * patch.grid.cols + c; }
  }
  if (best < 0) return null;
  const r = Math.floor(best / patch.grid.cols), c = best % patch.grid.cols;
  const p = patch.grid.positionsM[r]![c];
  const distance = Math.acos(Math.min(1, bestDot)) * R;
  if (distance > patch.grid.pixelSizeM * Math.SQRT2 / 2 + 0.02) return null;
  return { heightM: patch.grid.heightsM[r]![c]!, positionM: p! };
}

function basis(site: Site): { up: Vec3; east: Vec3; north: Vec3 } {
  const p = site.latDeg * RAD, l = site.lonDeg * RAD;
  return { up: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
    east: [-Math.sin(l), Math.cos(l), 0], north: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)] };
}
function wrapAz(az: number): number { return (az % 360 + 360) % 360; }
function eyePosition(patch: TerrainPatch, site: Site, observerHeightM: number): Vec3 {
  const sample = sampleTerrain(patch, site);
  if (!sample) fail('Site is outside patch coverage or on DEM nodata');
  if (!finite(observerHeightM) || observerHeightM < 0 || observerHeightM > 10000) fail('Observer height must be between 0 and 10000 m');
  const u = radial(site), radius = R + sample.heightM + observerHeightM;
  return u.map(v => v * radius) as Vec3;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function rayTriangle(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const edge1 = b.map((v, i) => v - a[i]!) as Vec3;
  const edge2 = c.map((v, i) => v - a[i]!) as Vec3;
  const p = cross(direction, edge2), determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-10) return null;
  const inverse = 1 / determinant, tvec = origin.map((v, i) => v - a[i]!) as Vec3;
  const u = dot(tvec, p) * inverse;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(tvec, edge1), v = dot(direction, q) * inverse;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const distance = dot(edge2, q) * inverse;
  // Numerical self-hit tolerance only; a 0.5 m exclusion loses valid fractional-height ground hits.
  return distance > 1e-8 ? distance : null;
}
function firstTerrainIntersection(patch: TerrainPatch, origin: Vec3, direction: Vec3): number | null {
  let nearest = Infinity;
  const { rows, cols, positionsM } = patch.grid;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = positionsM[r]![c], b = positionsM[r]![c + 1], c0 = positionsM[r + 1]![c], d = positionsM[r + 1]![c + 1];
    // Skip any cell with a nodata corner; no walls or filled terrain are introduced.
    if (!a || !b || !c0 || !d) continue;
    for (const distance of [rayTriangle(origin, direction, a, b, d), rayTriangle(origin, direction, a, d, c0)]) {
      if (distance !== null && distance < nearest) nearest = distance;
    }
  }
  return Number.isFinite(nearest) ? nearest : null;
}
function localSurfaceBlocks(patch: TerrainPatch, groundPosition: Vec3, direction: Vec3): boolean {
  let row = -1, col = -1;
  outer: for (let r = 0; r < patch.grid.rows; r++) for (let c = 0; c < patch.grid.cols; c++) {
    if (patch.grid.positionsM[r]![c] === groundPosition) { row = r; col = c; break outer; }
  }
  if (row < 0) return false;
  for (let r = Math.max(0, row - 1); r <= Math.min(patch.grid.rows - 2, row); r++) {
    for (let c = Math.max(0, col - 1); c <= Math.min(patch.grid.cols - 2, col); c++) {
      const a = patch.grid.positionsM[r]![c], b = patch.grid.positionsM[r]![c + 1];
      const c0 = patch.grid.positionsM[r + 1]![c], d = patch.grid.positionsM[r + 1]![c + 1];
      if (!a || !b || !c0 || !d) continue;
      for (const triangle of [[a, b, d], [a, d, c0]] as const) {
        if (!triangle.includes(groundPosition)) continue;
        const edge1 = triangle[1].map((v, i) => v - triangle[0][i]!) as Vec3;
        const edge2 = triangle[2].map((v, i) => v - triangle[0][i]!) as Vec3;
        let normal = cross(edge1, edge2);
        const center = triangle[0].map((v, i) => (v + triangle[1][i]! + triangle[2][i]!) / 3) as Vec3;
        if (dot(normal, center) < 0) normal = normal.map(v => -v) as Vec3;
        // At zero clearance, the eye is on the measured surface vertex. Rays entering
        // any adjacent facet are blocked at distance zero; outward rays keep tracing.
        if (dot(direction, normal) < -1e-12) return true;
      }
    }
  }
  return false;
}

/** Angular terrain skyline sampled from real pixel centers, with spherical curvature in each XYZ vector. */
export function terrainHorizonProfile(patch: TerrainPatch, site: Site, observerHeightM: number, azStepDeg = 2): TerrainProfile {
  validSite(site);
  if (!finite(azStepDeg) || azStepDeg <= 0 || azStepDeg > 30 || Math.abs(360 / azStepDeg - Math.round(360 / azStepDeg)) > 1e-9) fail('Azimuth step must divide 360 degrees and be in (0,30]');
  if (!finite(observerHeightM) || observerHeightM < 0 || observerHeightM > 10000) fail('Observer height must be between 0 and 10000 m');
  let cache = profileCache.get(patch);
  if (!cache) { cache = new Map(); profileCache.set(patch, cache); }
  const cacheKey = `${site.latDeg}|${site.lonDeg}|${observerHeightM}|${azStepDeg}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const eye = eyePosition(patch, site, observerHeightM), frame = basis(site);
  const count = Math.round(360 / azStepDeg);
  const bins = Array.from({ length: count }, () => ({ altitude: -Infinity, distance: Infinity }));
  for (let r = 0; r < patch.grid.rows; r++) for (let c = 0; c < patch.grid.cols; c++) {
    const target = patch.grid.positionsM[r]![c];
    if (!target) continue;
    const d = target.map((v, i) => v - eye[i]!) as Vec3;
    const distance = norm(d);
    if (distance <= patch.grid.pixelSizeM / 2) continue;
    const e = dot(d, frame.east), n = dot(d, frame.north), u = dot(d, frame.up);
    const az = wrapAz(Math.atan2(e, n) * DEG);
    const index = Math.floor((az + azStepDeg / 2) / azStepDeg) % count;
    const altitude = Math.atan2(u, Math.hypot(e, n)) * DEG;
    if (altitude > bins[index]!.altitude) bins[index] = { altitude, distance };
  }
  const result: TerrainProfile = { azStepDeg, samples: bins.map((bin, index) => ({ azDeg: index * azStepDeg,
    altDeg: Number.isFinite(bin.altitude) ? bin.altitude : null,
    horizonAltDeg: Number.isFinite(bin.altitude) ? bin.altitude : null,
    status: Number.isFinite(bin.altitude) ? 'insufficient' : 'insufficient',
    limitingDistanceM: Number.isFinite(bin.distance) ? bin.distance : null })) };
  cache.set(cacheKey, result);
  return result;
}

/** Only positive DEM evidence can certify a local obstruction. A finite patch cannot certify clear sky beyond its edge. */
export function analyzeTerrainHorizon(patch: TerrainPatch, site: Site, observerHeightM: number, azDeg: number, targetAltDeg: number): TerrainVisibility {
  if (!finite(azDeg) || !finite(targetAltDeg) || targetAltDeg < -90 || targetAltDeg > 90) fail('Azimuth and target altitude must be finite angles');
  const eye = eyePosition(patch, site, observerHeightM), frame = basis(site);
  const ground = sampleTerrain(patch, site)!;
  const profile = terrainHorizonProfile(patch, site, observerHeightM, 0.5);
  const bin = profile.samples[Math.round(wrapAz(azDeg) / profile.azStepDeg) % profile.samples.length]!;
  const az = wrapAz(azDeg) * RAD, alt = targetAltDeg * RAD;
  const direction = normalize(frame.up.map((v, i) => v * Math.sin(alt) +
    frame.north[i]! * Math.cos(alt) * Math.cos(az) + frame.east[i]! * Math.cos(alt) * Math.sin(az)) as Vec3);
  const atSurface = observerHeightM === 0 && localSurfaceBlocks(patch, ground.positionM, direction);
  const intersection = atSurface ? 0 : firstTerrainIntersection(patch, eye, direction);
  if (intersection !== null) return { status: 'blocked', reason: 'The geometric ray intersects the measured PGDA90 terrain mesh.',
    obstructionAltDeg: targetAltDeg, limitingDistanceM: intersection };
  return { status: 'insufficient', reason: 'No local DEM intersection was found; the finite patch cannot exclude more distant lunar relief.',
    obstructionAltDeg: bin.altDeg, limitingDistanceM: bin.limitingDistanceM };
}

function observerBody(source: Observation['sun'], positionMoon: Vec3, eye: Vec3, frame: ReturnType<typeof basis>, radiusM: number): Observation['sun'] {
  const d = positionMoon.map((v, i) => v - eye[i]!) as Vec3;
  const distanceM = norm(d), direction = normalize(d);
  const e = dot(direction, frame.east), n = dot(direction, frame.north), u = dot(direction, frame.up);
  const horizontal = Math.hypot(e, n), altDeg = Math.atan2(u, horizontal) * DEG;
  const azDeg = horizontal < 1e-12 ? null : wrapAz(Math.atan2(e, n) * DEG);
  const angularRadiusDeg = Math.asin(radiusM / distanceM) * DEG;
  return { ...source, azDeg, altDeg, direction, distanceM, angularRadiusDeg,
    centerAboveReferenceHorizon: altDeg > 0,
    diskState: altDeg + angularRadiusDeg <= 0 ? 'none' : altDeg - angularRadiusDeg >= 0 ? 'full' : 'partial' };
}

/** Observe from the actual DEM point plus eye clearance; site height remains a separate terrain-ground value. */
export function observeTerrain(data: EphemerisData, et: number, site: Site, observerHeightM: number, patch: TerrainPatch): {
  observation: Observation; groundHeightM: number; profile: TerrainProfile; sun: TerrainVisibility; earth: TerrainVisibility;
} {
  const ground = sampleTerrain(patch, site);
  if (!ground) fail('Site is outside patch coverage or on DEM nodata');
  const baseSite = { ...site, heightAboveReferenceSphereM: 0 };
  const base = observeAt(data, et, baseSite), eye = eyePosition(patch, site, observerHeightM), frame = basis(site);
  const sunMoon = base.sun.direction.map((v, i) => v * base.sun.distanceM + R * frame.up[i]!) as Vec3;
  const earthMoon = base.earth.direction.map((v, i) => v * base.earth.distanceM + R * frame.up[i]!) as Vec3;
  const observation: Observation = { ...base,
    site: { ...site, heightAboveReferenceSphereM: ground.heightM + observerHeightM },
    sun: observerBody(base.sun, sunMoon, eye, frame, data.model.sunRadiusM),
    earth: observerBody(base.earth, earthMoon, eye, frame, data.model.earthRadiusM) };
  const profile = terrainHorizonProfile(patch, site, observerHeightM);
  const sun = analyzeTerrainHorizon(patch, site, observerHeightM, observation.sun.azDeg ?? 0, observation.sun.altDeg);
  const earth = analyzeTerrainHorizon(patch, site, observerHeightM, observation.earth.azDeg ?? 0, observation.earth.altDeg);
  return { observation, groundHeightM: ground.heightM, profile, sun, earth };
}
