import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildMoonHost, parseRegionalContext, parseGlobalHeights, VISUAL_CONTEXT_KIND } from '../src/scene/context.ts';
import { buildTerrainMesh, validateTerrainPatch } from '../src/science/terrain.ts';

const R = 1737400;
const data = (name) => new URL(`../public/data/${name}`, import.meta.url);
const patch = validateTerrainPatch(JSON.parse(readFileSync(data('terrain-pgda90-southpolar.json'), 'utf8')));
const detail = buildTerrainMesh(patch);

/** Every edge of a closed, consistently oriented surface is used exactly once in each direction. */
function surfaceReport(host) {
  const directed = new Map();
  let degenerate = 0, inward = 0, triangles = 0;
  const p = host.positionsBodyM;
  for (const part of Object.values(host.parts)) {
    for (let t = 0; t < part.length; t += 3) {
      const [a, b, c] = [part[t], part[t + 1], part[t + 2]];
      triangles += 1;
      const A = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]], B = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], C = [p[c * 3], p[c * 3 + 1], p[c * 3 + 2]];
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (!(Math.hypot(...n) > 1e-6)) degenerate += 1;
      if (n[0] * A[0] + n[1] * A[1] + n[2] * A[2] < 0) inward += 1;
      for (const [x, y] of [[a, b], [b, c], [c, a]]) directed.set(`${x}>${y}`, (directed.get(`${x}>${y}`) ?? 0) + 1);
    }
  }
  let open = 0, doubled = 0;
  for (const [key, count] of directed) {
    if (count > 1) doubled += 1;
    const [x, y] = key.split('>');
    if (!directed.has(`${y}>${x}`)) open += 1;
  }
  return { triangles, degenerate, inward, open, doubled };
}

/** A synthetic context cut from an analytic bumpy sphere, with a detailed grid ten times finer inside it. */
function synthetic() {
  const centre = [0.2, -0.1, -0.97];
  const n = Math.hypot(...centre); const c = centre.map((v) => v / n);
  const e1 = [1, 0, 0].map((v, i) => v - c[0] * c[i]); const m = Math.hypot(...e1); const a = e1.map((v) => v / m);
  const b = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
  const point = (x, y) => {
    const d = [0, 1, 2].map((i) => c[i] + (a[i] * x + b[i] * y) / R);
    const len = Math.hypot(...d);
    const radius = R - 400 + 300 * Math.sin(x / 2100) * Math.cos(y / 1700);
    return d.map((v) => (v / len) * radius);
  };
  const step = 80, coarse = 15, lo = 6, hi = 8;
  const fine = (hi - lo) * 10 + 1;
  const fineMesh = { rows: fine, cols: fine, positionsBodyM: new Float64Array(fine * fine * 3), triangleIndices: null };
  const tri = [];
  for (let r = 0; r < fine; r += 1) for (let q = 0; q < fine; q += 1) {
    fineMesh.positionsBodyM.set(point((lo * 10 + q) * step, (lo * 10 + r) * step), (r * fine + q) * 3);
    if (r < fine - 1 && q < fine - 1) { const i = r * fine + q; tri.push(i, i + 1, i + fine + 1, i, i + fine + 1, i + fine); }
  }
  fineMesh.triangleIndices = Uint32Array.from(tri);
  const positions = [];
  for (let r = 0; r < coarse; r += 1) for (let q = 0; q < coarse; q += 1) positions.push(...point(q * 10 * step, r * 10 * step));
  const json = { kind: VISUAL_CONTEXT_KIND, id: 'synthetic', referenceRadiusM: R, rows: coarse, cols: coarse, positionsBodyM: positions,
    detail: { rowStart: lo, colStart: lo, rowEnd: hi, colEnd: hi, nativeStep: 10 } };
  return { fineMesh, json };
}

test('fallback host (no context, no global map) closes the real detailed mesh into one outward surface', () => {
  const host = buildMoonHost(detail, null, null);
  const report = surfaceReport(host);
  assert.deepEqual({ ...report, triangles: undefined }, { triangles: undefined, degenerate: 0, inward: 0, open: 0, doubled: 0 });
  assert.deepEqual(host.surroundings, { context: 'none', globe: 'reference-sphere' });
});

test('the detailed scientific vertices and triangles are passed through unchanged', () => {
  const host = buildMoonHost(detail, null, null);
  assert.equal(host.detailVertexCount, detail.rows * detail.cols);
  assert.deepEqual(host.positionsBodyM.slice(0, detail.positionsBodyM.length), detail.positionsBodyM);
  assert.equal(host.parts.detail.length, detail.triangleIndices.length);
  for (let t = 0; t < detail.triangleIndices.length; t += 3) {
    const original = [...detail.triangleIndices.slice(t, t + 3)].sort();
    assert.deepEqual([...host.parts.detail.slice(t, t + 3)].sort(), original); // same triangle, same diagonal; only winding may differ
  }
  assert.equal(host.detailEdge.length, 2 * (detail.rows - 1) + 2 * (detail.cols - 1));
});

test('context with a finer detailed footprint is stitched without gaps, doubled faces or inward triangles', () => {
  const { fineMesh, json } = synthetic();
  const context = parseRegionalContext(json, fineMesh);
  const host = buildMoonHost(fineMesh, context, null);
  const report = surfaceReport(host);
  assert.deepEqual({ ...report, triangles: undefined }, { triangles: undefined, degenerate: 0, inward: 0, open: 0, doubled: 0 });
  assert.ok(host.parts.seam.length > 0 && host.parts.context.length > 0);
  assert.equal(host.surroundings.context, 'real-800m');
});

test('missing data in the outer context is dropped cell by cell and the host still closes on the trimmed edge', () => {
  const { fineMesh, json } = synthetic();
  const holed = { ...json, positionsBodyM: [...json.positionsBodyM] };
  holed.positionsBodyM.splice(0, 3, null, null, null); // a corner without data
  const host = buildMoonHost(fineMesh, parseRegionalContext(holed, fineMesh), null);
  const report = surfaceReport(host);
  assert.equal(report.open, 0);
  assert.equal(report.doubled, 0);
});

test('a context that is not the same samples as the detailed mesh is refused, as is a wrong kind or missing data beside the footprint', () => {
  const { fineMesh, json } = synthetic();
  const moved = { ...json, positionsBodyM: [...json.positionsBodyM] };
  const corner = (json.detail.rowStart * json.cols + json.detail.colStart) * 3;
  moved.positionsBodyM[corner] += 5;
  assert.throws(() => parseRegionalContext(moved, fineMesh), /is not the detailed vertex/);
  assert.throws(() => parseRegionalContext({ ...json, kind: 'terrain' }, fineMesh), /not marked "visual-context-only"/);
  const gap = { ...json, positionsBodyM: [...json.positionsBodyM] };
  gap.positionsBodyM.splice(((json.detail.rowStart - 2) * json.cols + json.detail.colStart) * 3, 3, null, null, null);
  assert.throws(() => parseRegionalContext(gap, fineMesh), /no data at context vertex/);
});

test('global heights: pixel-centre bilinear sampling, east wrap, and refusal of an unmarked file', () => {
  const width = 8, height = 4;
  const values = new Int16Array(width * height);
  for (let r = 0; r < height; r += 1) for (let q = 0; q < width; q += 1) values[r * width + q] = r * 100 + q;
  const meta = { kind: VISUAL_CONTEXT_KIND, id: 't', referenceRadiusM: R, registration: 'pixel-centre', width, height, dataType: 'int16-le', scale: 1, offset: 0,
    firstRowLatDeg: 67.5, firstColLonDeg: -157.5, nodata: null };
  const g = parseGlobalHeights(meta, values.buffer);
  assert.equal(g.heightAt(67.5, -157.5), 0);
  assert.equal(g.heightAt(22.5, -112.5), 101);
  assert.equal(g.heightAt(67.5, -135), 0.5);              // halfway between columns 0 and 1
  assert.equal(g.heightAt(67.5, 180), 3.5);               // halfway between the last and the first column: wraps
  assert.equal(g.heightAt(89, -157.5), 0);                // clamped beyond the first row centre
  assert.throws(() => parseGlobalHeights({ ...meta, kind: 'dem' }, values.buffer), /not marked/);
  assert.throws(() => parseGlobalHeights(meta, new ArrayBuffer(10)), /wrong size/);
});

test('real visual-context assets, when present, stitch to the real detailed mesh as one closed surface', (t) => {
  const regional = data('visual-context-pgda90-80km.json');
  const globalMeta = data('visual-context-lola-global-4ppd.json');
  if (!existsSync(regional) || !existsSync(globalMeta)) return t.skip('visual-context assets are not present in this checkout');
  const context = parseRegionalContext(JSON.parse(readFileSync(regional, 'utf8')), detail);
  const meta = JSON.parse(readFileSync(globalMeta, 'utf8'));
  const bin = readFileSync(data(meta.dataFile));
  const global = parseGlobalHeights(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const host = buildMoonHost(detail, context, global);
  const report = surfaceReport(host);
  assert.deepEqual({ ...report, triangles: undefined }, { triangles: undefined, degenerate: 0, inward: 0, open: 0, doubled: 0 });
  assert.deepEqual(host.surroundings, { context: 'real-800m', globe: 'real-global' });
  assert.deepEqual(host.positionsBodyM.slice(0, detail.positionsBodyM.length), detail.positionsBodyM);
});
