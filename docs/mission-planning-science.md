# Mission-window science

`src/science/mission.ts` provides deterministic planning from the existing full-coverage `SiteAnalysis` intervals. It has no DOM, renderer, network or terrain dependency.

## API and model

`findMissionWindow(data, request)` accepts a site, observer height, `reference-sphere` model, selected ET search range, required seconds, `sun | earth | both` condition, and a fixed current-start ET. It returns qualifying windows, the nearest start that is still usable from the current ET, the longest intersecting condition span, a fixed-start evaluation, and measured compute time.

`compareMissionStarts(data, baseline, alternative)` evaluates exactly the two provided starts. It does not search, shift or mutate either request. Duration, condition, model and search range must match; exactly one of start ET, site, or observer height may differ. The delta is alternative minus baseline actual available continuous time.

Only `reference-sphere` planning is supported. Terrain requests fail explicitly: `Terrain mission-window search is unavailable: local DEM coverage cannot certify continuous visibility. Explicitly choose Reference sphere.` The result uses strict center-altitude `> 0` intervals against the reference tangent plane; it does not promise electrical power, eclipse-free sunlight, radio contact, safety or mission success.

## Window and boundary rules

The request range must be finite, positive and inside the prepared dataset. Required duration must be at least one second and no longer than the full dataset coverage. It may exceed the selected range; that is a valid no-fit result and still returns the longest intersecting span. `currentStartEt` must be finite but may be outside the search range or dataset so a failed What-if remains explicit.

For each full-coverage condition interval, the search clips to `[a,b]` within the selected range. If `b-a` meets the requirement (within a 1 microsecond arithmetic tolerance), allowed starts are the inclusive interval `[a,b-D]`. Exact-duration spans therefore have one admissible start. The tolerance handles ET floating-point arithmetic; it is not timing accuracy. The interval start is an admissible planning boundary, even when an instantaneous altitude display reads 0° at the rise crossing. Current membership is half-open `[start,end)`. Isolated zero contacts remain split because the source interval analysis preserves them.

`windows` contains qualifying clipped spans. `longest` is the longest clipped span even when it is too short; its negative `spareSeconds` makes that failure explicit. `nearest` is the first qualifying span whose latest allowed start has not passed `currentStartEt`; `recommendedStartEt` is the current start if still allowed, otherwise the span's first allowed start. Earlier qualifying windows can exist even when no future window remains.

The fixed `current` evaluation uses the exact provided start and full-data condition interval, not the selected range-clipped duration. `availableSeconds` and `endEt` describe that physical/data span; `fitsSearchRange` separately reports whether the full requested mission fits in the chosen range. Thus a search-range failure does not relabel the physical end. Outside data yields zero availability and `outside-data`; inside data but outside condition yields zero and `conditions-not-met`.

At the exact final data ET, interval membership would normally be half-open and exclude the final sample. The API separately checks the actual last prepared vectors against the requested site/observer tangent plane. If the condition is still strictly positive at that sample, it reports `conditionMetAtStart: true`, `availableSeconds: 0`, `endEt` equal to the dataset edge, and `endReason: data-coverage-end`; it does not imply a physical set or claim a future duration. If the sampled condition is zero or negative, the condition is not met at that instant.

Window clipping flags indicate when selected-range or dataset boundaries truncate a condition interval. A window end reason is `search-range-end` when search clipping happens first, `data-coverage-end` when available data ends there (data cause takes priority), or the applicable physical `sunset`, `earthset`, or `both-set`. Current end reason always describes its actual physical/data endpoint; range fit remains separate. A dataset edge is never reported as a physical set event.

## Caching and measured latency

The module caches full-coverage `analyzeObserver` results by ephemeris object identity, latitude, longitude and observer height. Slider-frame changes do not recompute intervals; changing range or required duration reuses the same analysis. With Node 24, this machine measured a cold four-month `findMissionWindow` at the Shackleton-area demo site at **19.63 ms**. One hundred subsequent cached calls averaged **0.0233 ms/call**. These are local measurements, not a performance guarantee on other devices. Search windows are computed synchronously; no Worker was needed for this one-site single-data analysis.

## Reproducible demo

`public/data/mission-demo.json` follows the frontend contract `{version,datasetId,title,baseline,change,expected}`. Its coordinate is explicitly labeled an illustrative Shackleton-area point, not a surveyed landing site. The baseline holds site, observer height, model, condition, duration and October–February range fixed at 48 hours and both bodies visible. At `2026-11-16T21:00:00Z`, the condition is not met and actual available time is **0 s**. The explicit change is only start time, advanced one UTC day to `2026-11-17T21:00:00Z`; this start lies inside an actual joint interval with **1,036,066.5514421463 s** remaining, requirement met, ending at the physical `earthset` boundary. `mission.test.mjs` recomputes both cases through the API and verifies every saved expected field against the real ephemeris JSON.

Run focused and science regressions:

```powershell
node --test scripts/ephemeris/mission.test.mjs
node --test scripts/ephemeris/events-observer.test.mjs scripts/ephemeris/intervals.test.mjs scripts/ephemeris/science.test.mjs scripts/ephemeris/terrain.test.mjs scripts/ephemeris/mission.test.mjs
npm exec --yes --package typescript@5.9.3 -- tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions src/science/index.ts src/science/intervals.ts src/science/events.ts src/science/observer.ts src/science/terrain.ts src/science/mission.ts
```
