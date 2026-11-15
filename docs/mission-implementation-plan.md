# Mission planning implementation

This extends the existing application; it does not replace its SPICE pipeline or its site-comparison features. See [the frozen data contract](mission-window-contract.md).

| Stage | Visible result | Owner | Dependencies and acceptance |
| --- | --- | --- | --- |
| Reconcile | One maintained application with the newer modular interface and the main scientific fixes | Claude; architect integrates | Compare individual files and hunks. Retain strict date validation, English import controls, Space framing, terrain coverage warnings and fractional-height ray regression. Remove obsolete active imports only after preserving their behavior. |
| Search mathematics | Continuous visibility windows and permissible mission starts | Codex developer | Use the existing observer-height interval solver. Accept exact-duration equality, distinguish range and data clipping from physical events, and reject unsupported terrain searches explicitly. Measure cold and cached search latency. |
| Planning interface | Site, date range, duration and condition form with a plain-English result | Claude | Consume the agreed API. Show actual current-start availability separately from a newly searched start. Handle loading, invalid input, no result and stale results. |
| Alternatives | Fixed-start What-if comparisons against an unchanged baseline | Claude with Codex developer | Change only the chosen start, site or height. Preserve condition, duration, range and model. Never silently search for a successful alternative. |
| Surface experience | The searched site, model and time in Surface view with controllable playback | Claude | Keep numbers, time, timeline and directions synchronized. Stop at the limiting boundary, label coverage boundaries correctly, and leave manual controls available. |
| Guided demonstration | A reproducible failure and explicit improvement from real prepared data | Codex developer prepares fixture; Claude presents | Independently verify the fixture and its limiting event. The user can exit the guided steps at any point. |
| Acceptance | Integrated production build, browser walkthrough and fresh screenshots | Reviewer and architect | Run focused boundary/regression tests, then inspect the new build after the last change. Leave the existing local preview running. No commit, push or publication. |

## Scientific scope

Mission planning uses the centre of each body above the reference tangent horizon of the smooth sphere, at the selected observer height. This is distinct from the depressed visible sphere limb and from a terrain horizon. The finite local DEM cannot certify uninterrupted terrain visibility throughout a mission, so terrain mission-window search is unavailable. Local terrain inspection remains available with its existing coverage warnings.

The search reports only the prepared data range. A clipped span is a known available segment, not a fully known physical window. Event times are approximate, with display precision appropriate to the validated interpolation. This application estimates geometric conditions, not landing safety, electrical power or radio-link performance.

## Delivery evidence

Record the selected reconciliation files, exact automated check results, measured search timings, reproducible demo inputs and fresh browser observations in the mission review documents. Screenshots from previous features are historical evidence and do not accept this release.
