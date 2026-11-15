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
export interface TerrainMesh {
  rows: number;
  cols: number;
  positionsBodyM: Float64Array;
  triangleIndices: Uint32Array;
}
export interface TerrainSample {
  site: Site;
  positionBodyM: Vec3;
  groundHeightM: number;
  faceNormalBody: Vec3;
  slopeDeg: number;
  row: number;
  col: number;
  triangle: 0 | 1;
  barycentric: [number, number, number];
  coverageMarginM: number;
}
export interface TerrainWalkSample extends TerrainSample { eyePositionBodyM: Vec3 }
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

const profileCache = new WeakMap<TerrainPatch, Map<string, TerrainProfile>>();
const meshCache = new WeakMap<TerrainPatch, TerrainMesh>();
const continuousCache = new WeakMap<TerrainPatch, Map<string, TerrainSample | null>>();
/** Shared indexed ground surface. Each valid cell uses the a-d diagonal: (a,b,d), (a,d,c). */
export function buildTerrainMesh(patch: TerrainPatch): TerrainMesh {
  const cached = meshCache.get(patch);
  if (cached) return cached;
  const { rows, cols, positionsM: source } = patch.grid;
  const positionsBodyM = new Float64Array(rows * cols * 3);
  for (let i = 0; i < rows * cols; i++) {
    const p = source[Math.floor(i / cols)]![i % cols];
    if (p) positionsBodyM.set(p, i * 3);
    else positionsBodyM.fill(Number.NaN, i * 3, i * 3 + 3);
  }
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    if (!source[r]![c] || !source[r]![c + 1] || !source[r + 1]![c] || !source[r + 1]![c + 1]) continue;
    const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
    indices.push(a, b, d, a, d, cc);
  }
  const mesh = { rows, cols, positionsBodyM, triangleIndices: new Uint32Array(indices) };
  meshCache.set(patch, mesh);
  return mesh;
}
/** Renderer-ready row-major XYZ; nodata vertices are NaN triplets. */
export function terrainVertices(patch: TerrainPatch): { rows: number; cols: number; positionsM: Float64Array } {
  const mesh = buildTerrainMesh(patch);
  return { rows: mesh.rows, cols: mesh.cols, positionsM: mesh.positionsBodyM };
}

function projectedSite(latDeg: number, lonDeg: number): [number, number] {
  // IAU:30135 south-polar stereographic, lunar sphere radius, central meridian 0.
  const rho = 2 * R * Math.tan(Math.PI / 4 + latDeg * RAD / 2);
  return [rho * Math.sin(lonDeg * RAD), rho * Math.cos(lonDeg * RAD)];
}
function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = b.map((v, i) => v - a[i]!) as Vec3, ac = c.map((v, i) => v - a[i]!) as Vec3;
  let n = normalize(cross(ab, ac));
  const center = a.map((v, i) => (v + b[i]! + c[i]!) / 3) as Vec3;
  if (dot(n, center) < 0) n = n.map(v => -v) as Vec3;
  return n;
}
function pointInTriangle2D(x: number, y: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): [number, number, number] | null {
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denom) < 1e-12) return null;
  const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
  const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
  const w = 1 - u - v;
  return u >= -1e-10 && v >= -1e-10 && w >= -1e-10 ? [u, v, w] : null;
}
function distanceToNodata(patch: TerrainPatch, row: number, col: number): number {
  let best = Infinity;
  for (let r = 0; r < patch.grid.rows; r++) for (let c = 0; c < patch.grid.cols; c++) {
    if (patch.grid.positionsM[r]![c]) continue;
    // Subtract a half-cell diagonal so this remains a lower bound on distance to the
    // unknown boundary represented by a missing sample.
    best = Math.min(best, Math.hypot((r - row) * patch.grid.pixelSizeM, (c - col) * patch.grid.pixelSizeM) - patch.grid.pixelSizeM * Math.SQRT2 / 2);
  }
  return Math.max(0, best);
}
/** Continuous barycentric ground point on the shared indexed facet, or null outside valid mesh. */
export function sampleTerrainContinuous(patch: TerrainPatch, latDeg: number, lonDeg: number): TerrainSample | null {
  const site: Site = { latDeg, lonDeg, heightAboveReferenceSphereM: 0 };
  validSite(site);
  let cache = continuousCache.get(patch);
  if (!cache) { cache = new Map(); continuousCache.set(patch, cache); }
  const key = `${latDeg}|${lonDeg}`;
  if (cache.has(key)) return cache.get(key)!;
  const [x, y] = projectedSite(latDeg, lonDeg);
  const transform = patch.source.sourceGeoTransform;
  const window = patch.grid.sourceWindow;
  const col = (x - (transform[2]! + (window.colOff + 0.5) * transform[0]!)) / transform[0]!;
  const row = (y - (transform[5]! + (window.rowOff + 0.5) * transform[4]!)) / transform[4]!;
  if (row < 0 || col < 0 || row > patch.grid.rows - 1 || col > patch.grid.cols - 1) { cache.set(key, null); return null; }
  const r = Math.min(patch.grid.rows - 2, Math.floor(row)), c = Math.min(patch.grid.cols - 2, Math.floor(col));
  const fy = row - r, fx = col - c;
  const mesh = buildTerrainMesh(patch), ix = r * mesh.cols + c;
  const point = (index: number): Vec3 | null => {
    const at = index * 3, p: Vec3 = [mesh.positionsBodyM[at]!, mesh.positionsBodyM[at + 1]!, mesh.positionsBodyM[at + 2]!];
    return p.every(Number.isFinite) ? p : null;
  };
  const a = point(ix), b = point(ix + 1), cc = point(ix + mesh.cols), d = point(ix + mesh.cols + 1);
  if (!a || !b || !cc || !d) { cache.set(key, null); return null; }
  let triangle: 0 | 1, ids: [number, number, number], weights: [number, number, number];
  if (fy <= fx) {
    triangle = 0; ids = [ix, ix + 1, ix + mesh.cols + 1];
    weights = [1 - fx, fx - fy, fy];
  } else {
    triangle = 1; ids = [ix, ix + mesh.cols + 1, ix + mesh.cols];
    weights = [1 - fy, fx, fy - fx];
  }
  const vertices = ids.map(point) as [Vec3 | null, Vec3 | null, Vec3 | null];
  if (vertices.some(v => !v)) { cache.set(key, null); return null; }
  const [v0, v1, v2] = vertices as [Vec3, Vec3, Vec3];
  const positionBodyM = [0, 1, 2].map(k => v0[k]! * weights[0]! + v1[k]! * weights[1]! + v2[k]! * weights[2]!) as Vec3;
  const radius = norm(positionBodyM), radialSite = { latDeg: Math.asin(positionBodyM[2] / radius) * DEG,
    lonDeg: wrapAz(Math.atan2(positionBodyM[1], positionBodyM[0]) * DEG), heightAboveReferenceSphereM: 0 };
  if (radialSite.lonDeg >= 180) radialSite.lonDeg -= 360;
  const faceNormalBody = triangleNormal(v0, v1, v2), up = normalize(positionBodyM);
  const slopeDeg = Math.acos(Math.max(-1, Math.min(1, dot(faceNormalBody, up)))) * DEG;
  const edgeMargin = Math.min(row, col, patch.grid.rows - 1 - row, patch.grid.cols - 1 - col) * patch.grid.pixelSizeM;
  const coverageMarginM = Math.max(0, Math.min(edgeMargin, distanceToNodata(patch, row, col)));
  const result: TerrainSample = { site: radialSite, positionBodyM, groundHeightM: radius - R, faceNormalBody,
    slopeDeg, row: r, col: c, triangle, barycentric: weights, coverageMarginM };
  cache.set(key, result);
  return result;
}
export function sampleTerrainWalk(patch: TerrainPatch, latDeg: number, lonDeg: number, observerHeightM: number): TerrainWalkSample | null {
  if (!finite(observerHeightM) || observerHeightM < 0 || observerHeightM > 10000) fail('Observer height must be finite and between 0 and 10000 m');
  const ground = sampleTerrainContinuous(patch, latDeg, lonDeg);
  if (!ground || ground.coverageMarginM <= 0) return null;
  const up = normalize(ground.positionBodyM);
  return { ...ground, eyePositionBodyM: ground.positionBodyM.map((v, i) => v + up[i]! * observerHeightM) as Vec3 };
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
  const sample = sampleTerrainContinuous(patch, site.latDeg, site.lonDeg);
  if (!sample) fail('Site is outside patch coverage or on DEM nodata');
  if (!finite(observerHeightM) || observerHeightM < 0 || observerHeightM > 10000) fail('Observer height must be between 0 and 10000 m');
  const u = normalize(sample.positionBodyM);
  return sample.positionBodyM.map((v, i) => v + u[i]! * observerHeightM) as Vec3;
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
  const mesh = buildTerrainMesh(patch), indices = mesh.triangleIndices, xyz = mesh.positionsBodyM;
  for (let i = 0; i < indices.length; i += 3) {
    const p = (vertex: number): Vec3 => [xyz[vertex * 3]!, xyz[vertex * 3 + 1]!, xyz[vertex * 3 + 2]!];
    const distance = rayTriangle(origin, direction, p(indices[i]!), p(indices[i + 1]!), p(indices[i + 2]!));
    if (distance !== null && distance < nearest) nearest = distance;
  }
  return Number.isFinite(nearest) ? nearest : null;
}
function localSurfaceBlocks(ground: TerrainSample, direction: Vec3): boolean {
  // At zero clearance the ray starts on this exact shared facet. An inward direction
  // is a measured self-intersection at t=0; outward and tangent directions continue.
  return dot(direction, ground.faceNormalBody) < -1e-12;
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
  const ground = sampleTerrainContinuous(patch, site.latDeg, site.lonDeg);
  if (!ground) fail('Site is outside patch coverage or on DEM nodata');
  const eye = eyePosition(patch, site, observerHeightM), frame = basis(ground.site);
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
  const ground = sampleTerrainContinuous(patch, site.latDeg, site.lonDeg);
  if (!ground) fail('Site is outside patch coverage or on DEM nodata');
  if (!finite(observerHeightM) || observerHeightM < 0 || observerHeightM > 10000) fail('Observer height must be between 0 and 10000 m');
  const eye = eyePosition(patch, site, observerHeightM), frame = basis(ground.site);
  const az = wrapAz(azDeg) * RAD, alt = targetAltDeg * RAD;
  const direction = normalize(frame.up.map((v, i) => v * Math.sin(alt) +
    frame.north[i]! * Math.cos(alt) * Math.cos(az) + frame.east[i]! * Math.cos(alt) * Math.sin(az)) as Vec3);
  const atSurface = observerHeightM === 0 && localSurfaceBlocks(ground, direction);
  const intersection = atSurface ? 0 : firstTerrainIntersection(patch, eye, direction);
  if (intersection !== null) return { status: 'blocked', reason: 'The geometric ray intersects the measured PGDA90 terrain mesh.',
    obstructionAltDeg: targetAltDeg, limitingDistanceM: intersection };
  return { status: 'insufficient', reason: 'No local DEM intersection was found; the finite patch cannot exclude more distant lunar relief.',
    obstructionAltDeg: null, limitingDistanceM: null };
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

export interface TerrainInstantObservation {
  sample: TerrainWalkSample;
  observation: Observation;
  sun: TerrainVisibility;
  earth: TerrainVisibility;
}
function makeTerrainObservation(data: EphemerisData, et: number, sample: TerrainWalkSample, observerHeightM: number, patch: TerrainPatch): {
  observation: Observation; sun: TerrainVisibility; earth: TerrainVisibility;
} {
  const baseSite = { ...sample.site, heightAboveReferenceSphereM: 0 };
  const base = observeAt(data, et, baseSite), frame = basis(sample.site);
  const sphereOrigin = radial(sample.site).map(v => v * R) as Vec3;
  const sunMoon = base.sun.direction.map((v, i) => v * base.sun.distanceM + sphereOrigin[i]!) as Vec3;
  const earthMoon = base.earth.direction.map((v, i) => v * base.earth.distanceM + sphereOrigin[i]!) as Vec3;
  const observation: Observation = { ...base,
    site: { ...sample.site, heightAboveReferenceSphereM: sample.groundHeightM + observerHeightM },
    sun: observerBody(base.sun, sunMoon, sample.eyePositionBodyM, frame, data.model.sunRadiusM),
    earth: observerBody(base.earth, earthMoon, sample.eyePositionBodyM, frame, data.model.earthRadiusM) };
  const visibility = (body: Observation['sun']): TerrainVisibility => {
    const az = body.azDeg ?? 0, alt = body.altDeg, azRad = wrapAz(az) * RAD, altRad = alt * RAD;
    const direction = normalize(frame.up.map((v, i) => v * Math.sin(altRad) +
      frame.north[i]! * Math.cos(altRad) * Math.cos(azRad) + frame.east[i]! * Math.cos(altRad) * Math.sin(azRad)) as Vec3);
    const intersection = observerHeightM === 0 && localSurfaceBlocks(sample, direction) ? 0 : firstTerrainIntersection(patch, sample.eyePositionBodyM, direction);
    return intersection !== null
      ? { status: 'blocked', reason: 'The geometric ray intersects the measured PGDA90 terrain mesh.', obstructionAltDeg: alt, limitingDistanceM: intersection }
      : { status: 'insufficient', reason: 'No local DEM intersection was found; the finite patch cannot exclude more distant lunar relief.', obstructionAltDeg: null, limitingDistanceM: null };
  };
  return { observation, sun: visibility(observation.sun), earth: visibility(observation.earth) };
}
/** Lightweight per-frame observer; null means the requested site is outside the measured mesh. */
export function observeTerrainInstant(data: EphemerisData, et: number, site: Site, observerHeightM: number, patch: TerrainPatch): TerrainInstantObservation | null {
  if (!finite(observerHeightM) || observerHeightM < 0 || observerHeightM > 10000) fail('Observer height must be between 0 and 10000 m');
  const sample = sampleTerrainWalk(patch, site.latDeg, site.lonDeg, observerHeightM);
  if (!sample) return null;
  return { sample, ...makeTerrainObservation(data, et, sample, observerHeightM, patch) };
}
/** Full analysis form retains the cached terrain profile; movement should use observeTerrainInstant. */
export function observeTerrain(data: EphemerisData, et: number, site: Site, observerHeightM: number, patch: TerrainPatch): {
  observation: Observation; groundHeightM: number; profile: TerrainProfile; sun: TerrainVisibility; earth: TerrainVisibility;
} {
  const instant = observeTerrainInstant(data, et, site, observerHeightM, patch);
  if (!instant) fail('Site is outside patch coverage or on DEM nodata');
  return { observation: instant.observation, groundHeightM: instant.sample.groundHeightM,
    profile: terrainHorizonProfile(patch, site, observerHeightM), sun: instant.sun, earth: instant.earth };
}
