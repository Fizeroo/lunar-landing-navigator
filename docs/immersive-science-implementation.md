# Immersive science implementation notes

## Surface mesh and walking

`buildTerrainMesh(patch)` is the common indexed mesh for the retained PGDA90 Product 90 patch. Each valid grid cell uses the `a-d` diagonal and emits `(a,b,d)` then `(a,d,c)`; a cell with any missing corner emits no triangles. `terrainVertices` is retained as a compatibility view of the same cached positions. Scene rendering should consume `buildTerrainMesh` positions and indices without changing topology.

`sampleTerrainContinuous(patch, latDeg, lonDeg)` maps IAU:30135 south-polar stereographic coordinates to the source pixel-center grid and barycentrically interpolates the selected triangle in Moon-fixed XYZ. The returned `site` is the actual radial latitude/longitude of that interpolated point, `groundHeightM` is its radius minus 1,737,400 m, and `faceNormalBody`/`slopeDeg` are calculated from the same facet. It returns `null` outside the outer sample-center mesh or where the selected cell is incomplete; it never clamps or fills no-data. `sampleTerrainWalk` adds the eye position along the interpolated radial by the requested clearance and rejects non-finite/out-of-range clearance or zero coverage margin.

`coverageMarginM` is a conservative lower bound: the minimum projected-grid distance from the interpolated point to the outer sample-center rectangle and to any no-data sample center after subtracting half a pixel diagonal. It can report less margin than physically available, never more. A 160 m minimum is used for the initial candidate region. Slope is a triangle-scale estimate at the 80 m grid spacing, not a landing safety or traversability result.

`observeTerrainInstant(data, et, site, observerHeightM, patch)` returns `null` when a continuous walk sample is unavailable; otherwise it returns the exact walk sample, body-fixed topocentric `Observation`, and separate terrain `sun` / `earth` statuses. It does not compute the full skyline profile. A local ray intersection can report `blocked`; absence of a hit remains `insufficient`, because this finite DEM cannot certify clear sky beyond its coverage. `observeTerrain` retains its full profile output and now uses the same continuous sample and eye point.

The data patch remains the original 101 × 101, 80 m grid with 10,201 finite samples. Its 101 pixel footprint spans 8.08 km, while the mesh hull between its 101 sample centers spans 8.00 km (100 intervals). Coverage margins and walk bounds are measured from that sample-center mesh hull. Measured relief is about 972.7 m. It is suitable for a bounded regional walk and mountain-scale views. It does not resolve rocks, establish route safety, or justify human-scale obstacle claims. The source frame is MOON_ME DE421; the patch's documented alignment to app `MOON_ME_DE440_ME421` is an approximation of at most 5.8204420784597e-7 rad (~1.01 m at lunar radius). No quality/count/error companion layer is packaged, so finite source cells do not guarantee high-resolution observation quality.

## Candidate search

`preparedCandidateRegion(patch)` returns the named central south-polar polygon that fits inside the existing patch. `generateCandidateSites` lays down deterministic cell-center points in the polygon's lat/lon bounds, retains only points inside the polygon with a continuous valid triangle and the requested coverage margin, and returns h=0 radial sites. Candidate IDs are stable row/column identifiers in the async result.

`searchCandidatesAsync` requires the displayed `currentEt`, a 5×5 or 7×7 grid, explicit region and minimum coverage margin. It rejects invalid time/height/region values in English, evaluates each candidate at that exact instant, reports progress, yields between batches, and aborts at batch boundaries. Results are sorted by the frozen public tuple: both reference-sphere centers up, Sun up, Earth up, remaining current joint duration, Sun altitude, then stable ID. The result lighting uses the existing reference-sphere `findMissionWindow` model over full data coverage with `condition:'both'` and `requiredSeconds:1`; it describes remaining duration from `currentEt`, not a future-start search. Local DEM body observations and blocked/insufficient diagnostics are separate and do not alter ranking. No terrain-certified clear result or terrain mission window is produced.

## Verification and observed performance

Run the focused suites with:

```powershell
node --test scripts/ephemeris/terrain.test.mjs scripts/ephemeris/candidates.test.mjs
```

The full ephemeris test suite passed **36/36** on 2026-11-15; the focused terrain/candidate suites passed **10/10**. They cover the a-d index order, continuous sample/eye consistency, finite-height validation, real patch coverage, no-data cell rejection, topocentric body directions, honest unknown terrain, deterministic candidate positions, current-instant mission agreement at1.7m, progress and abort behavior. The 25-point candidate test measured **541.0 ms cold / 227.1 ms warm** in the latest Node24 full-suite run on the current host (earlier runs measured339–554ms cold / 182–265ms warm). The instant-observer test body took11–72ms across the latest runs; the test includes initialization and null/outside-coverage checks, so this is a conservative rough bound, not a browser frame-time guarantee. UI should keep movement observations throttled (around4Hz as planned) and use the lightweight instant helper rather than recomputing full profiles.

Strict TypeScript validation passed for `terrain.ts` and `candidates.ts` with TypeScript from the integrated main-repo dependency tree, including project `--noUncheckedIndexedAccess`, `--exactOptionalPropertyTypes`, and `--noImplicitOverride` checks.

The test suite uses the prepared October 2026–February 2027 SPICE dataset and the retained original real PGDA90 terrain JSON. It makes no network calls and does not alter generated assets.

## Files owned by this implementation

- `src/science/terrain.ts`
- `src/science/candidates.ts`
- `scripts/ephemeris/terrain.test.mjs`
- `scripts/ephemeris/candidates.test.mjs`
- `docs/immersive-science-implementation.md`

No terrain asset, ephemeris asset, shared contract, renderer, UI, or Git metadata was changed.
