# Two-site comparison contract

Authorized 2026-11-14. This extends the first slice without replacing the validated SPICE pipeline, stack, frame or coordinate definitions. Canonical types remain in `src/contracts.ts`.

## Shared interface (frozen before parallel work)

`src/science/intervals.ts` exports `analyzeSite(data: EphemerisData, site: Site, period: TimeInterval): SiteAnalysis` and `intersectIntervals(a: TimeInterval[], b: TimeInterval[]): TimeInterval[]`.

`TimeInterval` has numeric `startEt`, `endEt`. `SiteAnalysis` contains `site`, `period`, and `sun`, `earth`, `both` summaries. Each summary has `intervals`, `totalSeconds`, `fraction` (0–1), `longestSeconds`. Require start < end, coverage bounds and h=0. Both sites always use exactly the same period. Empty conditions return [] and zeros; all-period conditions return the full clipped period. Endpoint inclusion has no effect on duration; exclude zero-duration contacts.

The tested condition is strictly **center altitude > 0** against the reference tangent plane. For each Cartesian-linear ephemeris segment, its sign equals `dot(targetPosition, radialUnit) - referenceRadiusM`; this scalar is linear. Solve its zero analytically, clipping to the requested period. This detects every crossing and arbitrarily short positive interval in the existing piecewise-linear model, including two crossings around a sample node. Do not interpolate booleans or wrapped angles. Intersect the resulting Sun/Earth lists with a two-pointer algorithm. This is exact for the interpolated model, not proof of exact real-world event time. Display event times rounded to minutes and durations as approximate; disclose 10-minute source sampling and the smooth-sphere assumption.

UI owns A/B colors, active-site selection, preset metadata, diagrams, bars and derived plain-English comparison text. It must consume the same returned intervals for bars and all numeric summaries, and the same `observeAt` outputs for sky diagrams/numbers. Cache analysis by dataset/site/period, not playback frame. Slider/playing changes only observation/current marker; it never fetches external API data or repeats monthly analysis per frame. Use one state for current ET and clamp it after changing period. Disable unavailable controls, clear stale results on errors.

Local sky: explicitly schematic azimuth/altitude diagram, N/E/S/W, horizon at altitude0, below-horizon bodies distinguished. Exact-pole azimuth null must be explained rather than drawn at invented azimuth. Global Sun/Earth direction markers are symbolic, never physical distance/size.

## Ownership and acceptance

- Claude t1c: primary implementer; frontend, 3D A/B markers and picking, selection/coordinate/preset controls, period/time controls, local sky diagrams, six timeline rows, numeric comparison, conclusion, responsive layout, all UI English. Own `src/main.ts`, `src/scene/`, `src/style.css`, `index.html`, UI-only modules, new UI docs. Existing worktree/branch preserved.
- Codex developer t1p: `src/science/intervals.ts`, focused interval tests, English scientific interval documentation. Preserve old science/data. No frontend edits.
- Reviewer t1q: independently verify interval algorithm, short/contact/bounds cases, summaries against bars, integration and English/source checks. Read-only project.
- Architect t1n: canonical types/docs, integration by explicit file copy, test scripts, deployment locally and final browser acceptance; delegate UI fixes to Claude.

No terrain, electrical power, radio-link guarantees, A/B mission-safety ranking, new stack or remote publication. Entire UI and new docs English; ISO dates with explicit UTC. Provide source links and clearly label illustrative preset coordinates. Existing historical acceptance reports describe only the old slice.
