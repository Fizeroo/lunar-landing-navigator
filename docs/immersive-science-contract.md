# Frozen immersive science API

Agreed by the architect after reading `worktrees/codex/docs/immersive-science-proposal.md`. This addendum supersedes that proposal where they differ. No UI/scene implementation belongs to the scientific developer. Existing scientific APIs and regression data remain supported.

## Terrain (`src/science/terrain.ts`)

```ts
export interface TerrainMesh {
  rows:number; cols:number;
  positionsBodyM:Float64Array; // row-major Moon-fixed metres, NaN for missing vertices
  triangleIndices:Uint32Array;
}
export interface TerrainSample {
  site:Site; // actual radial coordinates of positionBodyM, h=0
  positionBodyM:Vec3;
  groundHeightM:number; // |positionBodyM| - reference radius
  faceNormalBody:Vec3; // outward, normalized
  slopeDeg:number;
  row:number; col:number; triangle:0|1;
  barycentric:[number,number,number];
  coverageMarginM:number;
}
export interface TerrainWalkSample extends TerrainSample { eyePositionBodyM:Vec3 }
export function buildTerrainMesh(patch:TerrainPatch):TerrainMesh;
export function sampleTerrainContinuous(patch:TerrainPatch,latDeg:number,lonDeg:number):TerrainSample|null;
export function sampleTerrainWalk(patch:TerrainPatch,latDeg:number,lonDeg:number,observerHeightM:number):TerrainWalkSample|null;
```

Use the original real patch unchanged. One cell is a,b,c,d (TL,TR,BL,BR); triangles are `(a,b,d)` and `(a,d,c)`. Skip a cell if any of its four corners is missing. Renderer may reverse winding for outward normals, but not change the diagonal. Shared indices must drive local rendering, ray tests, grounding and local slope. The grid lookup stays internal; no consumer requires a new CRS type. Locate the containing cell using the validated stereographic transform, then intersect/interpolate its actual planar triangles. Do not place a camera using nearest-pixel height. Return null outside mesh coverage/nodata, never extrapolate a half pixel beyond the mesh. Cache mesh and lookup once per patch.

The returned site, ground and eye must be consistent with the exact rendered facet; the eye is ground plus selected height along the radial (default1.7m). Slope is the angle of this real triangle normal from the radial; label its scale **80 m grid / triangle-scale estimate**, not safe landing slope. Coverage margin is conservative distance to patch/nodata boundary; state its method in science docs. Walking requires a positive margin (default160m) and stops at the boundary, without silently changing model. Use a fixed local rendering origin during a walk. Scientific observation may be throttled as measured, but it must follow the walked point. Preserve zero/fractional-height regression behavior.

Update `observeTerrain` and its internal eye/ground calculations to use this same continuous facet ground for arbitrary sites; retain its return shape, per-body blocked/insufficient semantics, and no false-clear horizon. Full profiles are for analysis, not necessary every movement frame. If needed export a lightweight instantaneous terrain observer with a typed signature agreed with Claude; no duplicate astronomy in UI.

## Candidate search (`src/science/candidates.ts`)

```ts
export interface CandidateRegion {
  id:string; label:string;
  polygon:ReadonlyArray<readonly [latDeg:number,lonDeg:number]>;
}
export interface CandidateSearchRequest {
  region:CandidateRegion;
  gridSide:5|7;
  minimumCoverageMarginM:number;
  observerHeightM:number;
  currentEt:number; // REQUIRED: the displayed instant, never an invented implicit date
}
export interface CandidateResult {
  id:string; site:Site;
  groundHeightM:number; slopeDeg:number; slopeScaleM:number; coverageMarginM:number;
  reference:Observation;
  lighting:MissionResult;
  terrain:{ observation:Observation; sun:TerrainVisibility; earth:TerrainVisibility };
  rankingReason:string;
}
export interface CandidateSearchProgress {
  requestId:number; completed:number; total:number; result:CandidateResult|null;
}
export function preparedCandidateRegion(patch:TerrainPatch):CandidateRegion;
export function generateCandidateSites(region:CandidateRegion,gridSide:5|7,patch:TerrainPatch,minimumCoverageMarginM:number):ReadonlyArray<Site>;
export function searchCandidatesAsync(data:EphemerisData,patch:TerrainPatch,request:CandidateSearchRequest,options:{
  requestId:number; signal?:AbortSignal; batchSize?:number;
  onProgress?:(progress:CandidateSearchProgress)=>void;
}):Promise<ReadonlyArray<CandidateResult>>;
```

The initial UI uses the named prepared-region polygon and 25 deterministic grid points, filtered to actual mesh/positive coverage margin. It may offer a smaller named subregion, but needs no polygon drawing or extra form. Return all evaluated results sorted; UI shows at most three. Show actual evaluated count and chosen region/time. Repeated equal input must give equal point IDs/order. No hidden region expansion. No arbitrary dates outside prepared ephemeris. Invalid inputs reject in English. Abort between batches; use request generation IDs and clear stale candidate markers on time/site/region changes.

Each candidate's `reference` is the existing reference-sphere observation at the request time and selected height. `lighting` comes from existing `findMissionWindow`: same point/time/height, model reference-sphere, range full prepared data, condition both, requiredSeconds1. Remaining joint time is `lighting.current.availableSeconds`; it is never a terrain duration. Do not rank by the availability of a different future start.

Ranking is lexicographic and public: both reference centres up first; then Sun up, Earth up; then longer **remaining current** joint duration, then higher Sun altitude; deterministic id breaks ties. Local slope and terrain Sun/Earth blocked/insufficient results are separate diagnostics, not secretly mixed into a common safety score. Label the list **Lighting & Earth visibility candidates — reference-sphere ranking**; recommendation is **Best candidate among evaluated points** under those explicit criteria. Unknown terrain is not fulfilled terrain visibility. There is no terrain-certified landing recommendation. In the short selected-point card, show actual local terrain blocked/unknown when terrain is active, not an unqualified reference-sphere Yes.

## Data and performance decision

Keep the real existing 101x101 /80m patch. Its approximately8km extent and973m relief support a useful limited regional walk; no detailed rocks or global first-person terrain is claimed. Body directions remain SPICE; sky/Earth appearance are UI-owned. Measure full25-point cold/warm timings; cache interval analysis and yield between points/batches so controls remain usable. No Worker unless measured blocking warrants it.

## Required evidence

Test common diagonal, vertices/edges/interiors, continuous ground/eye clearance, slopes on known planes, no-data/outside/margin rejection, finite inputs, deterministic distinct candidate points, current-time observations and direct mission duration agreement, honest unknown terrain, cancellation/progress, no stale replacement. Re-run existing terrain, mission and SPICE regressions. Save English implementation/latency/coverage notes and exact changed files; send readiness to t1n and t1c through hc. Do not stop at a proposal.
