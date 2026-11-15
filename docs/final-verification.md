# Final local verification

Recorded 15 November 2026. Canonical source: the existing `main-repo`, branch `main`. Local preview: **http://127.0.0.1:4173/**. Final bundle: **`index-CheoBTg2.js`**. The final production rebuild reproduced the same bundle; no product source changed during finalization. Website deployment and competition submission are not included.

## Eight legacy browser discrepancies

The earlier complete browser run reported **83/91**. Its eight mismatches were investigated individually rather than disabling checks or claiming a fresh 91/91 run. Two expectations were obsolete and six were test-tool/parser/sequence problems. No blocking product defect remained in this set.

| Previous mismatch | Classification and evidence | Correction and focused result |
| --- | --- | --- |
| Candidate coordinates were not distinct | Test parser read the new repeated assessment heading at fixed newline index 1 | Extract the actual coordinate string; three distinct coordinates verified: PASS |
| Selected card did not follow the candidate | Same parser compared the assessment heading with the point card | Keep the `Option 1` name assertion and compare the real coordinates: PASS |
| Eye clearance was 1483 m | Test observed a still-active descent using the obsolete fade indicator | Wait for `view === surface` **and** `transit === null`; actual clearance 1.7000001 m: PASS |
| First look did not face measured relief | Obsolete UX expectation: agreed arrival now faces an unobstructed calculated Sun/Earth direction, otherwise terrain. Exact `65` FOV equality also rejected the interpolated value 64.9999988 | Validate actual body direction and use a 0.05-degree numerical tolerance for FOV: PASS |
| Coverage walking did not reach the guard | Test sequence pressed the point action after an in-coverage edit had already preserved Surface; that action was Back. Slow SwiftShader pacing compounded the timing problem | Preserve the current mode, start at a measured point near the 160 m guard, require the warning and stopped position; observed displacement after reaching the guard: 0 m: PASS |
| Zenith compass assertion failed | Test sampled the camera during transition rather than the settled look | Wait for the final pose; actual solar altitude/camera pitch 89.999961 degrees, honestly rounded to +90 degrees: PASS. This is near zenith, not an exact mathematical zenith, so a numeric heading is still possible |
| Accuracy disclosure failed old phrase matches | Obsolete copy expectations from the isolated-tile/procedural-sky version | Require explicit finite-DEM uncertainty, picture-only surroundings and centre-disc limitations in the current disclosure: PASS |
| Space view scale label failed | Test sampled a mode switch before its transition settled | Wait for the mode and completed transition; actual label is `Distances and sizes not to scale`: PASS |

The focused replay passed **9/9**, including these eight cases and clean browser/page errors. It used Microsoft Edge **headless D3D11**, without taking the user's mouse. The reusable runner is `tests/browser/finalization-checks.mjs`; `tests/browser/immersive-flow.mjs` retains the wider checks with corrected parsing, mode actions and settling conditions.

Optional browser check (Playwright is not a runtime dependency):

```powershell
npm install --no-save --package-lock=false playwright-core
node tests/browser/finalization-checks.mjs http://127.0.0.1:4173/
```

## Other still-current proof

- **107/107 unit and numerical checks passed** on the final runtime source: SPICE fixtures, time/coordinate bounds, intervals, mission clipping, candidate interpretation, exact fine/coarse registration, closed mesh topology, camera path and English UI checks.
- Final `npm run build` passed strict TypeScript and Vite. Its runtime bundle remained byte-identical to the independently checked final version.
- Independent review verified whole-Moon search/selection/repeat/close, saved Orbit return, genuinely late Escape reversal, second descent, 1.7 m grounding, actual Sun/Earth directions and Surface angular sizes, and no shader compilation/page errors.
- Injected Earth/star-map HTTP 404s produced explicit missing-imagery messages, black sky/plain phased Earth, and unchanged scientific body angles/states after both test contexts reached the same site/time.
- The measured ridge witness at **2026-11-24 04:00 UTC** retains finite-DEM `insufficient` states. No centre ray hits the detailed mesh or drawn surroundings; this is not certified distant-horizon clearance. See `visual-repair-surface-witness.json`.
- A separate Intel Arc D3D11 check without recording measured 98.1 animation callbacks/s over 6.003 s, median 8.3 ms and p95 16.7 ms. Recording and concurrent browser tests were much slower; this is a local measurement, not a hardware-independent guarantee.
- The integrated Claude checkpoint was compared with its preserved worktree; no later checkpoint edits were lost. Scientific helper/context files match the scientific developer's package. The ten protected science/input files match the pre-visual-repair baseline. Neither feature branch/worktree was reset or replaced.

## Local evidence, intentionally excluded from Git

All files below exist locally. Raw service/test logs, browser profiles, kernels, `node_modules`, `dist`, `.venv` and temporary artifacts are not part of the commit.

- `artifacts/visual-repair-before/02-after-search.png`: original floating-tile defect.
- `artifacts/visual-repair-final/02-after-search.png`: repaired whole-Moon search context.
- `artifacts/visual-repair-final/05-surface-sun-terrain.png`: final measured-ridge Surface frame.
- `artifacts/visual-repair-final/06-surface-earth.png`: real Earth crescent at a different UTC phase.
- `artifacts/visual-repair-final/07-enhanced-sky.png`: prepared NASA Milky Way map.
- `artifacts/visual-repair-final/orbit-to-surface.webm`: actual final-build recording, VP9, 1440 × 900, 25 fps, **28.8 s**, 11,111,423 bytes. Includes late cancellation and a completed second descent.
- `artifacts/visual-repair-final/focused-final-result.json`, `unit-tests.txt`, `independent-final-review.txt`: retained local evidence. The original failed legacy run is preserved in TEMP; it is not rewritten as an all-green full run.

## Known issues and boundaries

No blocking issue was found in opening → UTC → search → candidate → Surface → look → Orbit. Scientific terrain remains one 8 km, 80 m-grid region; coarser real surroundings are visual context. Far horizon clearance, rock-scale terrain, radio performance, power and landing safety remain unverified. Grazing-angle shadows and the 80 m mesh can show faceting/aliasing. Earth attitude, sky attitude/exposure and visual brightness are illustrative. The complete legacy SwiftShader suite is slow; the final reconciliation uses its prior 83 successful outcomes plus focused replay, not a new full-run 91/91 claim. Original-code license adoption and current competition form/Resources verification remain entrant actions.
