# UI reconciliation: worktrees/claude against main `a135d52`

Recorded 2026-11-14 by the UI developer. The worktree held a later modular UI; main held an older UI plus scientific fixes. Files were compared one by one (`diff -rq`, then `diff -u` per file); nothing was copied as a whole checkout. No commits were made.

## Rule used

- Science, data and their tests: main wins.
- UI: the later modular UI in this worktree is the base; each fix that existed only in main was carried over by hunk or re-implemented, and is listed below.

## Per-file decisions

| File | Decision | Reason |
| --- | --- | --- |
| `src/science/terrain.ts` | **Main** | Fractional-height ray fix (self-hit threshold `1e-8` m instead of `0.5` m). After this, `src/science` was byte-identical to main. |
| `src/science/mission.ts`, `public/data/mission-demo.json`, `scripts/ephemeris/mission.test.mjs` | **Science developer's files, copied unchanged** | Frozen API and real fixture; hashes are in `docs/mission-ui-handoff.md`. |
| `tests/exploration.test.mjs`, `tests/language.test.mjs`, `tests/render-science.test.mjs` | **Main** | Main's regression tests; they did not exist here. They pass against this UI. |
| `.gitignore` | **Union** | Main's Python entries plus `artifacts/`. |
| `package.json` | **Main's wins on integration** | Here `test` is `node --test tests/*.test.mjs`; main's also runs `scripts/ephemeris/*.test.mjs`. |
| `src/ui/format.ts` | **Mine** | Superset of main's (adds `formatCountdown`, `formatHeight`). |
| `src/main.ts`, `index.html`, `src/style.css` | **Mine**, then extended | Main's versions are the older single-file UI wired to `exploration.ts`. |
| `src/ui/SiteCard.ts`, `src/ui/ScenarioPanel.ts`, `src/ui/TerrainProfileView.ts`, `src/ui/panels.ts` | **Mine** | Do not exist in main; they replace `exploration.ts`. |
| `src/scene/SurfaceScene.ts` | **Mine** | Later version: separate `draw` / `ghost` inputs, mesh that skips no-data cells, upward-facing normals without double-sided material, no walls at the patch edge. |
| `src/scene/MoonScene.ts` | **Hunk merge** | See "Space framing" below. |
| `tests/ui.test.mjs` | **Mine** | Imports the catalogue; main's imports `presets.ts`, which is retired. |
| `tests/exploration-ui.test.mjs`, `tests/browser/*` | **Mine** | Do not exist in main in this form. |
| `src/ui/exploration.ts`, `src/ui/presets.ts` | **Retired (absent here)** | Behaviour preserved as listed below. |
| `src/contracts.ts`, `src/scene/coords.ts`, `src/ui/{catalogue,scenario,comparison,dom,SkyDiagram,Timeline,skyProjection}.ts`, `public/data/*`, `public/assets/*` | **Identical** | No action. |
| Main-only documents and `scripts/`, `requirements-*.txt`, `README.md` | **Not touched** | Owned by the architect. |

## Main's semantic fixes and where they live now

| Fix named in the contract | Status here |
| --- | --- |
| Explicit reference-sphere versus terrain | Kept and extended. Surface status lines say "Terrain check: Blocked / Terrain coverage insufficient" only in terrain mode; cards, timeline, events, scenarios and mission results all say reference-sphere. The mission search refuses terrain with the science module's message and shows no sphere result in its place. |
| No secret export | Kept. Export, share link and localStorage contain only the validated public scenario fields (`serializeScenarioSet`); covered by unit and browser tests. |
| No silently shifted dates | **Changed here to match main.** `analyseScenario` used `fitWindow`, which moved or shortened a window and showed a "fitted to data" badge. It now analyses exactly the requested window or reports why not (outside the data, runs past the data, different dataset). The badge and the `adjusted` field are gone, and a row that cannot be analysed cannot be loaded into a site. Mission starts and What-if starts follow the same rule. |
| Real ground offset | Kept. The terrain note states the DEM ground height relative to the 1737.4 km sphere and the observer height above that ground. The mesh origin is `radial × (R + ground height)`, the same point the science module's eye position uses, so the drawn ground and the computed angles agree. Main used the nearest pixel-centre position; the two coincide at the vetted test point. |
| Space framing | **Merged.** From main: the camera orbits the Sun–Earth midpoint, the view direction is tilted so the Moon, Earth and Sun are all in frame, and the target follows the bodies while time plays. From this worktree: labels that stay above their bodies on screen and camera flights computed relative to the target. Camera distance 36. Checked in a real screenshot (`artifacts/02-space-view.png`). |
| Profile-body markers | Kept and completed. The terrain skyline strip had Sun and Earth dots; it now also names them ("Sun", "Earth") as main's did. |
| English custom import control | Kept. "Import JSON…" is an English button over a hidden file input, so no browser-localised "Choose file" text appears. |

Other behaviour of `exploration.ts` that is preserved: next-change events searched in all data with "Not found within available data"; the Sun + Earth window row with clipping wording; the terrain test-point button; the camera minimum clearance explained separately from the scientific height; a 2.5 s timeout so a stalled camera flight cannot leave the view switch blocked (main used 1.5 s).

One deliberate difference from main: main offered terrain only at the single vetted point. This worktree offers it wherever `sampleTerrain` returns ground inside the patch, and disables it elsewhere with "Terrain coverage insufficient". The science module is the judge in both cases.

## Stale imports and leftovers

- Nothing in this worktree imports `exploration.ts` or `presets.ts`.
- `fitWindow` remains exported from `src/ui/scenario.ts` (file identical to main) and is still unit-tested, but the application no longer calls it.
