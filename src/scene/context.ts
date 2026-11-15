/**
 * One continuous Moon for drawing: the unchanged detailed DEM mesh seated in real coarser context.
 *
 * RENDERING ONLY. Nothing here is read by the science modules, and nothing here changes a scientific
 * result: visibility, slopes, candidates and the walked ground keep using only the detailed patch.
 * The visual-context assets are validated by this file, never by the scientific DEM validator.
 *
 * Parts, innermost first, sharing one vertex array in Moon-fixed metres:
 *   detail   the science mesh, vertices and triangles exactly as buildTerrainMesh returns them
 *   seam     triangles joining the detailed edge to the context (no coincident faces, no walls)
 *   context  real 800 m context with the detailed footprint and one ring of cells around it removed
 *   host     rings around the outermost real edge out to the far side of the Moon; heights from the
 *            real global map where it is loaded, otherwise the reference sphere (stated as such)
 */
export const VISUAL_CONTEXT_KIND = 'visual-context-only';
const REFERENCE_RADIUS_M = 1737400;
const DEG = Math.PI / 180;

export interface DetailMesh {
  rows: number;
  cols: number;
  positionsBodyM: Float64Array;
  triangleIndices: Uint32Array;
}

export interface RegionalContext {
  id: string;
  rows: number;
  cols: number;
  /** Row-major Moon-fixed metres, NaN where the source has no data. */
  positionsBodyM: Float64Array;
  detail: { rowStart: number; colStart: number; rowEnd: number; colEnd: number; nativeStep: number };
}

export interface GlobalHeights {
  id: string;
  /** Height above the reference sphere in metres at a planetocentric latitude / east longitude (bilinear). */
  heightAt(latDeg: number, lonDeg: number): number;
}

export interface MoonHost {
  /** All vertices, Moon-fixed metres. The first rows*cols are the detailed mesh, untouched. */
  positionsBodyM: Float64Array;
  /** Texture coordinates of the global equirectangular map (u east from 180 W, v north from the south pole). */
  uvs: Float32Array;
  parts: { detail: Uint32Array; seam: Uint32Array; context: Uint32Array; host: Uint32Array };
  /** Vertex indices around the edge of the detailed (scientific) mesh, for the thin boundary line. */
  detailEdge: Uint32Array;
  /** What the surroundings are made of, for the labels. */
  surroundings: { context: 'real-800m' | 'none'; globe: 'real-global' | 'reference-sphere' };
  detailVertexCount: number;
}

function fail(message: string): never {
  throw new Error(`Visual context: ${message}`);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/** Read the 80 km context and prove it shares its inner vertices with the detailed mesh before any stitching. */
export function parseRegionalContext(value: unknown, detail: DetailMesh): RegionalContext {
  if (!isObject(value)) fail('the regional file is not an object');
  if (value['kind'] !== VISUAL_CONTEXT_KIND) fail(`the regional file is not marked "${VISUAL_CONTEXT_KIND}"`);
  if (value['referenceRadiusM'] !== REFERENCE_RADIUS_M) fail('the regional file uses a different reference radius');
  const { rows, cols, positionsBodyM, detail: footprint } = value;
  if (!isCount(rows) || !isCount(cols)) fail('rows and cols must be positive integers');
  if (!Array.isArray(positionsBodyM) || positionsBodyM.length !== rows * cols * 3) fail('positionsBodyM has the wrong length');
  if (!isObject(footprint)) fail('the detail footprint is missing');
  const { rowStart, colStart, rowEnd, colEnd, nativeStep } = footprint;
  for (const n of [rowStart, colStart, rowEnd, colEnd, nativeStep]) if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) fail('the detail footprint must hold non-negative integers');
  const f = { rowStart: rowStart as number, colStart: colStart as number, rowEnd: rowEnd as number, colEnd: colEnd as number, nativeStep: nativeStep as number };
  if (f.rowStart < 2 || f.colStart < 2 || f.rowEnd > rows - 3 || f.colEnd > cols - 3) fail('the detail footprint is too close to the context edge to stitch');
  if ((f.rowEnd - f.rowStart) * f.nativeStep !== detail.rows - 1 || (f.colEnd - f.colStart) * f.nativeStep !== detail.cols - 1) fail('the detail footprint does not match the detailed mesh size');
  const positions = new Float64Array(rows * cols * 3);
  for (let i = 0; i < positions.length; i += 1) {
    const n = positionsBodyM[i] as unknown;
    positions[i] = typeof n === 'number' && Number.isFinite(n) ? n : Number.NaN;
  }
  let worst = 0;
  for (let i = 0; i <= f.rowEnd - f.rowStart; i += 1) {
    for (let j = 0; j <= f.colEnd - f.colStart; j += 1) {
      const c = ((f.rowStart + i) * cols + f.colStart + j) * 3;
      const d = (i * f.nativeStep * detail.cols + j * f.nativeStep) * 3;
      const distance = Math.hypot(positions[c]! - detail.positionsBodyM[d]!, positions[c + 1]! - detail.positionsBodyM[d + 1]!, positions[c + 2]! - detail.positionsBodyM[d + 2]!);
      if (!(distance <= 0.01)) fail(`context vertex (${f.rowStart + i}, ${f.colStart + j}) is not the detailed vertex (${i * f.nativeStep}, ${j * f.nativeStep}): ${Number.isNaN(distance) ? 'missing' : `${distance.toFixed(3)} m apart`}`);
      worst = Math.max(worst, distance);
    }
  }
  for (let r = f.rowStart - 2; r <= f.rowEnd + 2; r += 1) {
    for (let c = f.colStart - 2; c <= f.colEnd + 2; c += 1) if (Number.isNaN(positions[(r * cols + c) * 3]!)) fail(`no data at context vertex (${r}, ${c}) next to the detailed footprint`);
  }
  return { id: typeof value['id'] === 'string' ? value['id'] : 'regional-context', rows, cols, positionsBodyM: positions, detail: f };
}

/** Read the global height map (metadata plus its binary file). */
export function parseGlobalHeights(meta: unknown, buffer: ArrayBuffer): GlobalHeights {
  if (!isObject(meta)) fail('the global metadata is not an object');
  if (meta['kind'] !== VISUAL_CONTEXT_KIND) fail(`the global file is not marked "${VISUAL_CONTEXT_KIND}"`);
  if (meta['referenceRadiusM'] !== REFERENCE_RADIUS_M) fail('the global file uses a different reference radius');
  if (meta['registration'] !== 'pixel-centre') fail('the global file must be pixel-centre registered');
  const { width, height, dataType, firstRowLatDeg, firstColLonDeg } = meta;
  if (!isCount(width) || !isCount(height)) fail('global width and height must be positive integers');
  if (typeof firstRowLatDeg !== 'number' || typeof firstColLonDeg !== 'number') fail('global first row latitude / first column longitude are missing');
  const scale = typeof meta['scale'] === 'number' ? meta['scale'] : 1;
  const offset = typeof meta['offset'] === 'number' ? meta['offset'] : 0;
  const nodata = typeof meta['nodata'] === 'number' ? meta['nodata'] : null;
  const view = new DataView(buffer);
  let read: (index: number) => number;
  if (dataType === 'int16-le') {
    if (buffer.byteLength !== width * height * 2) fail('the global binary has the wrong size');
    read = (index) => view.getInt16(index * 2, true);
  } else if (dataType === 'float32-le') {
    if (buffer.byteLength !== width * height * 4) fail('the global binary has the wrong size');
    read = (index) => view.getFloat32(index * 4, true);
  } else fail('the global dataType must be int16-le or float32-le');
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 1) {
    const stored = read(i);
    data[i] = stored === nodata || !Number.isFinite(stored) ? 0 : stored * scale + offset; // a gap falls back to the reference sphere
  }
  const degPerPixel = 180 / height;
  if (Math.abs(360 / width - degPerPixel) > 1e-9) fail('the global map is not 2:1');
  return {
    id: typeof meta['id'] === 'string' ? meta['id'] : 'global-heights',
    heightAt(latDeg, lonDeg) {
      const y = Math.min(height - 1, Math.max(0, (firstRowLatDeg - latDeg) / degPerPixel)); // rows run north to south
      const x = ((((lonDeg - firstColLonDeg) / degPerPixel) % width) + width) % width; // columns run east and wrap
      const y0 = Math.floor(y), x0 = Math.floor(x);
      const y1 = Math.min(height - 1, y0 + 1), x1 = (x0 + 1) % width;
      const ty = y - y0, tx = x - x0;
      const top = data[y0 * width + x0]! * (1 - tx) + data[y0 * width + x1]! * tx;
      const bottom = data[y1 * width + x0]! * (1 - tx) + data[y1 * width + x1]! * tx;
      return top * (1 - ty) + bottom * ty;
    },
  };
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };

/** Vertex indices around a grid rectangle (inclusive bounds), starting at its first corner, rows then columns. */
function perimeter(cols: number, base: number, r0: number, c0: number, r1: number, c1: number, step = 1): number[] {
  const loop: number[] = [];
  for (let c = c0; c < c1; c += step) loop.push(base + r0 * cols + c);
  for (let r = r0; r < r1; r += step) loop.push(base + r * cols + c1);
  for (let c = c1; c > c0; c -= step) loop.push(base + r1 * cols + c);
  for (let r = r1; r > r0; r -= step) loop.push(base + r * cols + c0);
  return loop;
}

/**
 * Build the continuous drawing mesh. `context` and `global` may each be null (not loaded or refused):
 * the detailed mesh is then joined to what remains, down to the plain reference sphere, and
 * `surroundings` says exactly which of them are real.
 */
export function buildMoonHost(detail: DetailMesh, context: RegionalContext | null, global: GlobalHeights | null): MoonHost {
  const detailCount = detail.rows * detail.cols;
  const vertices: number[] = Array.from(detail.positionsBodyM);
  const base = detailCount; // first context vertex
  if (context) for (const n of context.positionsBodyM) vertices.push(n);
  const finite = (index: number): boolean => Number.isFinite(vertices[index * 3]!);
  const at = (index: number): V3 => [vertices[index * 3]!, vertices[index * 3 + 1]!, vertices[index * 3 + 2]!];

  const seam: number[] = [];
  const contextTriangles: number[] = [];
  const detailLoop = perimeter(detail.cols, 0, 0, 0, detail.rows - 1, detail.cols - 1);
  let outerLoop = detailLoop;

  if (context) {
    const { rows, cols } = context;
    const f = context.detail;
    // Context cells: same a-d diagonal as the detailed mesh, minus the footprint and one ring of cells around it.
    const hole = { r0: f.rowStart - 1, c0: f.colStart - 1, r1: f.rowEnd + 1, c1: f.colEnd + 1 };
    // Trim the outer rectangle until its whole perimeter has data, so the host can attach to it.
    const outer = { r0: 0, c0: 0, r1: rows - 1, c1: cols - 1 };
    while (outer.r0 < hole.r0 - 1 && !perimeter(cols, base, outer.r0, outer.c0, outer.r1, outer.c1).every(finite)) {
      outer.r0 += 1; outer.c0 += 1; outer.r1 -= 1; outer.c1 -= 1;
    }
    for (let r = outer.r0; r < outer.r1; r += 1) {
      for (let c = outer.c0; c < outer.c1; c += 1) {
        if (r >= hole.r0 && r < hole.r1 && c >= hole.c0 && c < hole.c1) continue;
        const a = base + r * cols + c, b = a + 1, cIndex = a + cols, d = cIndex + 1;
        if (finite(a) && finite(b) && finite(cIndex) && finite(d)) contextTriangles.push(a, b, d, a, d, cIndex);
      }
    }
    // Zip the detailed edge (many vertices) to the context ring around the hole (few vertices).
    const ring = perimeter(cols, base, hole.r0, hole.c0, hole.r1, hole.c1);
    let i = 0, j = 0;
    while (i < detailLoop.length || j < ring.length) {
      const nextInner = (i + 1) / detailLoop.length;
      const nextOuter = (j + 1) / ring.length;
      const inner = detailLoop[i % detailLoop.length]!, outerVertex = ring[j % ring.length]!;
      if (j >= ring.length || (i < detailLoop.length && nextInner <= nextOuter)) {
        seam.push(inner, detailLoop[(i + 1) % detailLoop.length]!, outerVertex);
        i += 1;
      } else {
        seam.push(inner, ring[(j + 1) % ring.length]!, outerVertex);
        j += 1;
      }
    }
    outerLoop = perimeter(cols, base, outer.r0, outer.c0, outer.r1, outer.c1);
  }

  // Host rings: each ring repeats the outer loop's bearings, so ring 0 IS the real edge, vertex for vertex.
  const usable = outerLoop.filter(finite);
  const centre = unit(usable.reduce<V3>((sum, index) => { const p = at(index); return [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]]; }, [0, 0, 0]));
  const e1 = unit(cross(Math.abs(centre[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], centre));
  const e2 = cross(centre, e1);
  const loopInfo = outerLoop.map((index) => {
    if (!finite(index)) return null;
    const p = at(index);
    const radius = Math.hypot(p[0], p[1], p[2]);
    const d = unit(p);
    return { theta: Math.acos(Math.min(1, dot(d, centre))), bearing: Math.atan2(dot(d, e2), dot(d, e1)), height: radius - REFERENCE_RADIUS_M };
  });
  const maxTheta = Math.max(...loopInfo.map((info) => info?.theta ?? 0));
  const host: number[] = [];
  const latLon = (d: V3): { latDeg: number; lonDeg: number } => ({ latDeg: Math.asin(Math.max(-1, Math.min(1, d[2]))) / DEG, lonDeg: Math.atan2(d[1], d[0]) / DEG });
  const BLEND_RINGS = global && context ? 6 : 12; // rings over which the real edge height eases into the surroundings
  const SQUARE_TO_CIRCLE_RINGS = 6;
  const GROWTH = 1.07;
  let previous = outerLoop;
  let circle = maxTheta;
  for (let k = 1; ; k += 1) {
    // Keep the far hemisphere reasonably sampled too: exponential growth alone leaves
    // very long triangles and a conspicuous fan at the opposite pole.
    circle = Math.min(circle * GROWTH, circle + DEG);
    const last = circle >= Math.PI - 0.5 * DEG;
    if (last) circle = Math.PI - 0.5 * DEG;
    const w = Math.min(1, k / SQUARE_TO_CIRCLE_RINGS);
    const blend = Math.min(1, k / BLEND_RINGS);
    const eased = blend * blend * (3 - 2 * blend);
    const ring: number[] = [];
    for (let j = 0; j < outerLoop.length; j += 1) {
      const info = loopInfo[j];
      if (!info) { ring.push(-1); continue; }
      const theta = (1 - w) * info.theta * (circle / maxTheta) + w * circle;
      const s = Math.sin(theta);
      const d: V3 = [
        centre[0] * Math.cos(theta) + s * (e1[0] * Math.cos(info.bearing) + e2[0] * Math.sin(info.bearing)),
        centre[1] * Math.cos(theta) + s * (e1[1] * Math.cos(info.bearing) + e2[1] * Math.sin(info.bearing)),
        centre[2] * Math.cos(theta) + s * (e1[2] * Math.cos(info.bearing) + e2[2] * Math.sin(info.bearing)),
      ];
      const { latDeg, lonDeg } = latLon(d);
      const surroundings = global ? global.heightAt(latDeg, lonDeg) : 0;
      const radius = REFERENCE_RADIUS_M + info.height * (1 - eased) + surroundings * eased;
      ring.push(vertices.length / 3);
      vertices.push(d[0] * radius, d[1] * radius, d[2] * radius);
    }
    for (let j = 0; j < outerLoop.length; j += 1) {
      const n = (j + 1) % outerLoop.length;
      const a = previous[j]!, b = previous[n]!, c = ring[j]!, d = ring[n]!;
      if (a < 0 || b < 0 || c < 0 || d < 0 || !finite(a) || !finite(b)) continue;
      host.push(a, b, d, a, d, c);
    }
    previous = ring;
    if (last) break;
  }
  // Close the far side with one vertex opposite the region.
  const far = vertices.length / 3;
  const antipode: V3 = [-centre[0], -centre[1], -centre[2]];
  const farLatLon = latLon(antipode);
  const farRadius = REFERENCE_RADIUS_M + (global ? global.heightAt(farLatLon.latDeg, farLatLon.lonDeg) : 0);
  vertices.push(antipode[0] * farRadius, antipode[1] * farRadius, antipode[2] * farRadius);
  for (let j = 0; j < previous.length; j += 1) {
    const a = previous[j]!, b = previous[(j + 1) % previous.length]!;
    if (a >= 0 && b >= 0) host.push(a, b, far);
  }

  // Every triangle faces outward, whatever the grid orientation.
  const outward = (triangles: number[]): Uint32Array => {
    const out = new Uint32Array(triangles.length);
    for (let t = 0; t < triangles.length; t += 3) {
      const a = at(triangles[t]!), b = at(triangles[t + 1]!), c = at(triangles[t + 2]!);
      const normal = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
      const flip = dot(normal, a) < 0;
      out[t] = triangles[t]!;
      out[t + 1] = triangles[flip ? t + 2 : t + 1]!;
      out[t + 2] = triangles[flip ? t + 1 : t + 2]!;
    }
    return out;
  };

  const positions = Float64Array.from(vertices);
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0; i < positions.length / 3; i += 1) {
    if (!Number.isFinite(positions[i * 3]!)) continue;
    const { latDeg, lonDeg } = latLon(unit([positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!]));
    uvs[i * 2] = (lonDeg + 180) / 360;
    uvs[i * 2 + 1] = (latDeg + 90) / 180;
  }
  return {
    positionsBodyM: positions,
    uvs,
    parts: { detail: outward(Array.from(detail.triangleIndices)), seam: outward(seam), context: outward(contextTriangles), host: outward(host) },
    detailEdge: Uint32Array.from(detailLoop.filter(finite)),
    surroundings: { context: context ? 'real-800m' : 'none', globe: global ? 'real-global' : 'reference-sphere' },
    detailVertexCount: detailCount,
  };
}
