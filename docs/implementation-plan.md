# First browser version

Authorized 2026-11-14. The accepted research is in [research-plan.md](research-plan.md), with the shared [data contract](data-contract.md).

## Acceptance

One integrated local browser application, using real prepared SPICE data for **2026-11-01T00:00:00Z through 2026-12-01T00:00:00Z**:

1. Textured 3D Moon with orbit and zoom.
2. Select ONE surface point; show planetocentric latitude and east-positive longitude.
3. Explicit UTC input and a range slider.
4. Lighting follows the prepared solar ephemeris for the selected instant.
5. Sun and Earth azimuth/elevation at the selected surface point.
6. Visible warning: smooth reference surface; terrain is not modeled.

No A/B comparison, terrain, backend/database, deployment or extra mission-planning features in this slice. Never present above-horizon geometry as electrical power, actual terrain illumination, or guaranteed radio communication.

## Work allocation

- **Architect t1n / main-repo / main:** preserve docs and shared contract, integrate file changes without branch/worktree replacement, install frontend dependencies, build, run local server, browser acceptance.
- **Scientific developer t1p / worktrees/codex / feat/astro-timeline:** isolated Python SPICE preparation, pinned kernels/provenance, real JSON, pure TypeScript science module and tests, reproducible independent checks. Own `scripts/`, `src/science/`, `public/data/`, `docs/science-validation.md`, Python requirements and science test files.
- **Claude t1c / worktrees/claude / feat/3d-moon-scene:** Vite/TypeScript/three.js frontend, style, orbit/zoom/picking/time controls and cards. Own frontend scaffolding, `src/main.ts`, `src/scene/`, CSS, HTML and texture assets. Consume the agreed science API; do not duplicate astronomy or ship simulated fallback data.
- **Reviewer t1q / main-repo / main:** independent scientific checks, then read-only review of integrated result and numerical/visual consistency. No implementation edits unless separately assigned.

Each developer stays in the assigned worktree. No commit, checkout, merge, reset, clean, push or new branches/worktrees are needed: the architect integrates explicit owned paths. Do not overwrite shared `src/contracts.ts` without agreement.

## Gates and order

1. Run SPICE for actual dates and record reference checks. The reviewer verifies the scientific slice before final integration.
2. In parallel, implement globe/UI against shared types. Loading/error states are allowed; fabricated scientific values are not.
3. Integrate real data plus science module into frontend; run focused science tests, typecheck and production build.
4. Start a persistent localhost server and exercise orbit/zoom, picking, UTC/slider, numerical cards and changing light in a real browser.
5. Fix integration failures, report passed checks and material limitations, leave local server running for the user.

## Numerical checks

- Geometric ICRF Sun/Earth vectors against explicit-time JPL Horizons vectors; record model differences (DE440 vs service ephemeris).
- Independent frame/ENU checks, including equator, south pole region, far side, longitude seam and azimuth singularities.
- Off-grid interpolated directions versus direct SPICE: proposed target <=0.001 degree angular separation, measured rather than assumed.
- Coverage endpoints, time roundtrip and UTC parsing independent of browser timezone.
- Visual: mapping of cardinal axes/texture landmarks, marker coordinate roundtrip, Sun direction and terminator agree with computed normals. Camera movement must not change computed angles.

## Operation

The browser fetches `/data/ephemeris-2026-11.json` once and uses local Float64 calculations. No NASA/JPL request per slider movement. Science data generation is offline and separate from running the app. See README for the exact runnable commands after integration.
