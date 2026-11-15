# Changes prepared for a later commit

No commit, push, publication or competition submission was performed for this task. The existing branches and worktrees were retained. Main's initial baseline was `a135d52`.

## Science and reproducible data

- Add `src/science/mission.ts`: cached observer-height interval search, permissible starts, fixed-start evaluations, immutable one-change comparisons, physical/range/data boundary attribution, explicit terrain refusal and final-covered-sample handling.
- Add `scripts/ephemeris/mission.test.mjs`: seven focused tests, including the real-data demo and coverage endpoint.
- Add `public/data/mission-demo.json`: checked real SPICE example; no fabricated astronomy or additional runtime API.
- Retain existing ephemeris/DEM assets and scientific modules unchanged.

## Integrated application

- Update `src/main.ts`, `index.html`, `src/style.css`: larger scene, mission form/results, controllable Surface experience and guided flow; preserve A/B, timelines, catalogue and scenarios in accessible panels.
- Add `src/ui/mission.ts`, `src/ui/MissionPanel.ts`, `src/ui/GuidedDemo.ts`.
- Reconcile/add modular `src/ui/SiteCard.ts`, `src/ui/ScenarioPanel.ts`, `src/ui/TerrainProfileView.ts`, `src/ui/panels.ts`; extend `src/ui/format.ts`.
- Reconcile `src/scene/MoonScene.ts` and `src/scene/SurfaceScene.ts`, preserving actual directions, Space framing, ground offsets and coverage limitations.
- Remove retired `src/ui/exploration.ts` and `src/ui/presets.ts` after preserving their active behavior and updating consumers.
- Saved scenarios now reject unsupported dates/datasets explicitly instead of moving or shortening their windows. Rows that cannot be analysed cannot be loaded.

## Tests

- Add `tests/mission-ui.test.mjs` (16 tests), `tests/exploration-ui.test.mjs` and `tests/browser/mission-flow.mjs`.
- Update `tests/ui.test.mjs`, `tests/browser/ui-flow.mjs`, `tests/browser/ui-layout.mjs` for the catalogue and folded mission layout.
- Keep main's broader test command, including scientific regressions. Final main gate: 81/81 tests, strict typecheck and production build pass. See the acceptance documents for attributed browser results.

## Documents and evidence

- Update `README.md`, `docs/data-and-sources.md`, `docs/demo-walkthrough.md`, `docs/ui-browser-checks.md`.
- Add `docs/mission-window-contract.md`, `docs/mission-implementation-plan.md`, `docs/mission-planning-science.md`, `docs/mission-demo-walkthrough.md`, `docs/mission-ui-handoff.md`, `docs/ui-reconciliation.md`.
- Add `docs/mission-browser-acceptance.md`, `docs/mission-independent-science-review.txt` and this list.
- Fresh native-browser artifacts: `artifacts/screenshots/mission-result.png`, `artifacts/screenshots/surface-experience.png`. Artifacts remain ignored by Git and must be deliberately selected if desired for a later release.

## Remaining limits

Only reference-tangent-horizon mission planning is certified by the implemented interval model. Terrain search is refused explicitly; the finite local DEM remains available for inspection with incomplete-coverage warnings. Prepared dates are 1 October 2026 through 1 February 2027 UTC. Events are approximate; there is no eclipse, electrical-power, radio-link or landing-safety model. Touch, screen readers, other browsers and hardware-GPU performance have not been certified.
