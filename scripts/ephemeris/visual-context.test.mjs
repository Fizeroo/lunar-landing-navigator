import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const context = JSON.parse(readFileSync(new URL('../../public/data/visual-context-pgda90-80km.json', import.meta.url), 'utf8'));
const detail = JSON.parse(readFileSync(new URL('../../public/data/terrain-pgda90-southpolar.json', import.meta.url), 'utf8'));
const globalMeta = JSON.parse(readFileSync(new URL('../../public/data/visual-context-lola-global-4ppd.json', import.meta.url), 'utf8'));
const globalBin = readFileSync(new URL('../../public/data/visual-context-lola-global-4ppd.bin', import.meta.url));

test('regional visual-context asset is renderer-only and exactly stitches the 121 detailed source vertices', () => {
  assert.equal(context.schemaVersion, '1.0');
  assert.equal(context.kind, 'visual-context-only');
  assert.equal(context.frame, 'MOON_ME_DE440_ME421');
  assert.equal(context.sourceFrame, 'MOON_ME_DE421');
  assert.equal(context.referenceRadiusM, 1737400);
  assert.deepEqual([context.rows, context.cols, context.spacingM], [101, 101, 800]);
  assert.equal(context.positionsBodyM.length, 101 * 101 * 3);
  assert.deepEqual(context.detail, {
    patchId: detail.id, rowStart: 45, colStart: 45, rowEnd: 55, colEnd: 55, nativeStep: 10,
    sharedVertexCount: 121, maxSharedPositionDifferenceM: 0,
    stitchRingRowsCols: [43, 57], noDataInStitchRing: 0,
  });
  for (let r = 0; r < 101; r++) for (let c = 0; c < 101; c++) {
    const p = context.positionsBodyM.slice((r * 101 + c) * 3, (r * 101 + c) * 3 + 3);
    assert.ok(p.every(Number.isFinite), `visual context nodata at ${r},${c}`);
    if (r >= 43 && r <= 57 && c >= 43 && c <= 57) assert.ok(p.every(Number.isFinite), `stitch-ring nodata at ${r},${c}`);
  }
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const ci = ((45 + i) * 101 + 45 + j) * 3;
    const dp = detail.grid.positionsM[10 * i][10 * j];
    const cp = context.positionsBodyM.slice(ci, ci + 3);
    assert.ok(Math.hypot(...cp.map((v, k) => v - dp[k])) <= 0.01);
  }
});

test('global visual-context binary hashes, source registration evidence and layout match the asset contract', () => {
  assert.equal(globalMeta.schemaVersion, '1.0');
  assert.equal(globalMeta.kind, 'visual-context-only');
  assert.equal(globalMeta.frame, 'MOON_ME_DE440_ME421');
  assert.equal(globalMeta.sourceFrame, 'MOON_ME_DE421');
  assert.equal(globalMeta.dataType, 'int16-le');
  assert.deepEqual([globalMeta.width, globalMeta.height, globalMeta.firstRowLatDeg, globalMeta.firstColLonDeg], [1440, 720, 89.875, -179.875]);
  assert.equal(globalMeta.registration, 'pixel-centre');
  assert.equal(globalMeta.lonWraps, true);
  assert.equal(globalMeta.nodata, null);
  assert.equal(globalBin.length, 1440 * 720 * 2);
  assert.equal(createHash('sha256').update(globalBin).digest('hex'), globalMeta.sha256);
  assert.equal(globalMeta.source.pdsLabel.svsRollColumns, 720);
  assert.equal(globalMeta.source.pdsLabel.rowFlip, false);
  assert.ok(globalMeta.source.pdsLabel.meanAbsoluteDifferenceM < globalMeta.source.pdsLabel.unrolledMeanAbsoluteDifferenceM);
  assert.ok(globalMeta.source.pdsLabel.maxAbsoluteDifferenceM > 1000,
    'registration evidence records real source differences; the grids are not falsely claimed pixel-identical');
});
