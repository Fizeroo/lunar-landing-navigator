# Integrated mission browser acceptance

Architect's native Microsoft Edge check of **http://127.0.0.1:4173/**, after integrating the mission implementation and building it in `main-repo`. Window: 1440 by 852 pixels, approximately 1440 by 772 content pixels. The existing preview terminal remains running. Previous exploration screenshots were not used to accept this feature.

## Observed user path

| Action | Observed result |
| --- | --- |
| Load the integrated production build | English loading state, then real prepared data ready: 1 October 2026 through 1 February 2027 UTC. Prominent 3D scene, mission form and Find a window button. |
| Start Guided demo | Site A becomes the explicitly illustrative Shackleton-area point, observer 0 m, reference sphere, both centres above the reference horizon, 48 h, fixed start 16 November 2026 at 21:00 UTC. |
| Evaluate baseline | No fit at that exact start; 0 continuous time available. The search is separate and finds the first future suitable start at approximately 17 November, 20:39 UTC. |
| Inspect permissible starts | Explicit range approximately 17 November, 20:39 UTC through 27 November, 20:48 UTC, leaving 48 h in the selected window. Five qualifying windows in the full search range. |
| Compare the explicit one-day change | The baseline remains 16 November, 21:00 UTC. The alternative is 17 November, 21:00 UTC, with all other parameters retained. It succeeds with approximately 12 days remaining, Earth setting as the limiting event. No new start is silently searched for. |
| Enter Surface experience | Same selected point and successful What-if start. Sun altitude +1.76 degrees, azimuth 309.6 degrees; Earth altitude +0.02 degrees, azimuth 224.1 degrees. The compass, geometry and UTC display agree. |
| Finish guided steps | The overlay closes; surface controls and the experience remain usable. |
| Select 1 day per second and Play | Shared UTC and Sun/Earth numbers change with playback. The actual rate switches to 10 minutes per second near the end. |
| Reach the limiting event | Playback pauses automatically at the computed Earthset boundary, displayed approximately 29 November, 20:48 UTC (shared timestamp 20:47:47 UTC). Explanation identifies Earth's centre crossing the reference horizon. Sun remains about +1.16 degrees; Earth's centre is approximately 0 degrees and the text distinguishes the still-visible portion of its illustrative disc. |
| Look at Sun | Camera heading about 164 degrees and pitch about +1 degree, consistent with the displayed Sun azimuth 164.1 degrees and altitude +1.16 degrees. No body is raised above its computed direction. |

## Fresh artifacts

- `artifacts/screenshots/mission-result.png`: integrated Guided demo comparison of the failed fixed start and explicit successful change, with the searched window and allowed starts visible.
- `artifacts/screenshots/surface-experience.png`: integrated surface at the automatically stopped Earthset event, looking toward the real Sun direction; limiting-event explanation and controls visible.

All 13 integrated runtime UI/scene files were compared with Claude's current delivered files after this check; no differences or later runtime edits were present. The scientific terrain module retains SHA256 `79974A8B603EA3498B512DA72AC5C3617C8674E18FCC787748D80AADC31CFD39`. The final mission module uses the coverage-end correction described in the independent review.

## Final consolidated gate

After synchronizing the delivered tests and documents, `npm test` passed **81/81**, and `npm run build` passed strict TypeScript checking and produced the application successfully. The runtime bundles remained identical to the walkthrough build: `index-d7m7LwOp.js` and `index-CnRHln--.css`. The rebuilt app was reloaded in native Edge at port 4173; data became ready, and a fresh Find a window action returned the expected 48 h fit for the default 1 October start, including an explicit permissible-start range. This last reload/search is additional to the complete same-bundle Guided/Surface walkthrough above.

Claude's final matching-runtime worktree browser checks passed **56/56 mission checks**, **78/78 regression checks**, and layout checks at five viewport sizes, with no reported console errors. Those are separately attributed in `ui-browser-checks.md`. The reviewer independently confirmed source/data equality, retired-import removal and the raw-vector numerical example; the architect operated the visible integrated browser.

## Limits of this check

This native pass checks the central mission user path. Automated browser checks maintained by Claude cover additional error, stale-state, unsupported-model, comparison, scenario and terrain interactions; their exact results are recorded separately. This is not a hardware performance benchmark, screen-reader audit or cross-browser certification. The right column scrolls when expanded result/details exceed its height; the primary form and global time controls remain visible in the default laptop layout.

Mission search remains a reference-tangent-horizon estimate, not terrain-certified visibility, electrical power, radio-link performance or landing safety. The finite DEM does not support continuous terrain-window certification. No extrapolation beyond prepared data is claimed.
