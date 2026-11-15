# Mission-window planning contract

Authorized extension,2026-11-14. Preserve SPICE, actual terrain data, A/B, scenarios, times and three views. No commit/push/publication, duplicate agents or new worktrees. All UI/new documents English. Never read origin/config/secrets.

## Reconcile first

Main baseline is existing commit a135d52. Main science/data/tests include the fractional-height ray fix (numerical intersection threshold1e-8m), validated extended dataset, explicit unknown terrain coverage and scientific regressions. Claude's worktree has a later modular UI (`SiteCard`, `ScenarioPanel`, `TerrainProfileView`, `panels`) and updated main/HTML/CSS/format/surface cameras. Claude owns a deliberate per-file/per-hunk reconciliation in his worktree; retain main scientific files, data/provenance and tests. Preserve useful main UI fixes: explicit reference-vs-terrain, no secret export, no silently shifted dates, real ground offset, Space framing, profile-body markers and English custom import control. Do not copy a whole checkout over another. Document selected files and stale imports; architect integrates only the declared final UI files after review. Retire obsolete active `exploration.ts` only after its useful behavior is preserved.

## Frozen scientific API

New module `src/science/mission.ts` imports existing types and `analyzeObserver`; no DOM/three.js. Define/export:

```ts
type MissionModel = 'reference-sphere' | 'terrain';
interface MissionRequest {
  site: Site; observerHeightM:number; model:MissionModel;
  range:TimeInterval; requiredSeconds:number; condition:Condition;
  currentStartEt:number;
}
type MissionEndReason = 'sunset'|'earthset'|'both-set'|'search-range-end'|'data-coverage-end';
interface MissionWindow {
  startEt:number; endEt:number;
  allowedStart:{startEt:number;endEt:number};
  availableSeconds:number; spareSeconds:number;
  startClipped:boolean; endClipped:boolean;
  endReason:MissionEndReason;
}
interface MissionCurrent {
  startEt:number; conditionMetAtStart:boolean; availableSeconds:number;
  requirementMet:boolean; fitsSearchRange:boolean;
  spareSeconds:number; endEt:number|null;
  endReason:MissionEndReason|'conditions-not-met'|'outside-data';
}
interface MissionResult {
  request:MissionRequest;
  windows:MissionWindow[];
  nearest:MissionWindow|null;
  recommendedStartEt:number|null;
  longest:MissionWindow|null;
  current:MissionCurrent;
  computeMilliseconds:number;
}
function findMissionWindow(data:EphemerisData,request:MissionRequest):MissionResult;
function compareMissionStarts(data:EphemerisData,baseline:MissionRequest,alternative:MissionRequest):{
  baseline:MissionCurrent; alternative:MissionCurrent; deltaAvailableSeconds:number;
};
```

Reject unsupported terrain search explicitly (`Terrain mission-window search is unavailable: local DEM coverage cannot certify continuous visibility. Explicitly choose Reference sphere.`), never substitute sphere. Validate finite site/height, positive duration (1second up to the full dataset duration), ordered covered range, finite start. A duration longer than the selected search range but still within dataset duration is a valid no-fit result, so show the longest range-limited interval rather than rejecting it as an input error. `currentStartEt` may lie outside search range or data for explicit What-if failure reporting; do not shift it. UI presets6/12/24/48hours and custom hours.

Use existing full-coverage intervals as the sole basis. For each condition span intersecting the requested search range, define clipped [a,b]. Qualifies when b-a>=D, allowed starts[a,b-D] including equality. An arithmetic tolerance <=1microsecond may address epoch floating-point roundoff; it is not event accuracy. `windows` holds qualifying clipped spans; `longest` is the longest intersecting span even when it failsD, or null. `nearest` is first qualifying span whose latest allowed start>=currentStartEt; `recommendedStartEt=max(span.startEt,currentStartEt)` (bounded to valid starts). Earlier valid spans may exist even if no future suitable span exists; UI explains this distinction.

For current start, `availableSeconds` is the continuous remaining condition time from that exact start using full prepared data, not an invented shifted success. Planning spans use half-open [start,end) membership: the opening event is an admissible start and exact-duration equality is accepted, without treating an isolated zero contact as an interval. Instant altitude cards retain their geometric horizon definition. `fitsSearchRange` means the entire requested mission [start,start+D] lies within the selected range. `requirementMet` requires both enough actual available duration and search fit. `spareSeconds=available-D` may be negative. Outside data => available0/requirement false/outside-data. At the exact final covered sample, preserve the actual sampled condition state; if it is up, available duration is still zero, requirement false and the endpoint/cause is the data edge, not a physical set. Clearly show when range rather than physical conditions prevents fitting. For current-start evaluation, endEt and endReason describe the same full-data physical/data boundary as availableSeconds; use fitsSearchRange to report the independent search-range constraint, without relabelling a later physical endpoint as the range edge.

Preserve clipping provenance: coverage endpoints are not sunrise/set; a selected range ending early is `search-range-end`. A physical condition end is sunset/earthset/both-set derived from the same full Sun/Earth interval endpoints. Do not call a clipped span a fully known physical window. `startClipped/endClipped` are true if any search/data edge truncates the physical span. Data-boundary cause takes priority when the end coincides with data end. Event displays round approximately to minutes, not false sub-sample precision.

`compareMissionStarts` never mutates inputs and never searches/shifts the alternative. Only current-start evaluations are compared. UI freezes baseline by value and makes one explicit change: +1 UTC day, alternate site, or observer height. Required duration, condition, range, model remain identical. A separate Find action can search again. Report delta in actual available continuous time and limiting factor, not guaranteed power/link/safety.

## UI and experience boundary

Claude primary: compact mission form and plain result beside prominent3D, Experience/What-if/Guided demo; previous details remain accessible in folds/panels. Use one time/observation state. Experience sets requested site/height/model/time and enters Surface smoothly, but controls remain usable. Offer accelerated playback with speed shown; clamp/pause at relevant next event/window end, optionally slow before it, and explain what ended. Never extrapolate or lift hidden bodies. A model mismatch/terrain result cannot be presented as reference-sphere search success without explicit choice.

Measure search latency first. Cache existing interval analysis by data/site/height; if work blocks, use a Worker or yielding chunks. Use request generation IDs so an outdated result cannot replace a newer form request. Render loading/error/no-data/unsupported model/no-result states in English. Any relevant form/site/height edits mark prior results as stale until a new search.

## Guided demo and tests

Codex developer computes and saves `public/data/mission-demo.json` from real prepared data: a failing fixed start, an explicitly changed successful start/site, same D/condition/model/height/range. Suggested seed to verify, not assumed true: Shackleton(-89.67,129.78), joint48h, baseline2026-11-16T21:00Z vs+1day. Find another example if this fails. Save actual checks in English docs, no invented numbers. Claude consumes fixture and provides cancellable steps: select, failure, explicit change, result, surface. No terrain drama without real confirmed geometry.

Required tests: exactD equality, too-short/no spans, clipped coverage/search edges, start inside/current span vs future search, invalid inputs, unchanged baseline after What-if, fixed-start failure versus separate shifted search, end-reason attribution, height influence, unsupported terrain and measured latency. Reviewer independently checks numerical demo and final integration. Final build/native browser after last change plus real screenshots of mission result and Surface experience.
