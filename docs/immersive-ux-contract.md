# Immersive lunar explorer contract

New authorized task, 15 November 2026. Main is the agreed integrated basis; seven key runtime/science files were compared with Claude's worktree and are byte-identical. Preserve all uncommitted mission work, scientific fixes, scenarios, real SPICE/DEM assets and current branches. No commit, push, publication, duplicate agent, repository or worktree. All UI and new documents English.

## Ownership and delivery

Claude is primary implementer: composition, UI, Orbit/Surface cameras, transitions, real terrain rendering, first-person controls, sky/Earth appearance, candidates UI and visual polish. Codex developer owns terrain sampling/shared mesh, candidate calculations, data assessment and focused numerical tests. Reviewer is read-only. Architect owns this contract, integration, source documentation and final visible-browser acceptance. New scientific API must be frozen in the addendum before parallel scientific/UI integration; no guessed implementation may ship.

## Product boundary (frozen)

The scene occupies at least 80% of available application area on a normal laptop; prefer a full-bleed canvas with small floating controls. The default visible UI has only the title, Orbit/Surface, UTC/time slider/Play, Find a landing candidate, a compact selected-point card and Explore here/Back to orbit. The card shows coordinates, Sun/Earth state and model. Analysis contains the existing mission form, A/B, scenarios, timelines and details. Data & accuracy contains science/source details. Space view is a secondary action. Short model/coverage labels remain visible; no old search result or stale banner at startup. Selection/time changes automatically update current point observations. Search results never masquerade as current after their time or region changes.

Use one scientific time and selected site. Candidate search explicitly evaluates multiple reproducible points in a named bounded region. Show at most three choices and explain the criterion; call the recommendation Best candidate among evaluated points, never a safety score or the best site on the Moon. If only reference-sphere ranking is defensible, call them Lighting & Earth visibility candidates and distinguish local DEM diagnostics. Unknown terrain clearance is never a passed mandatory condition. Reference-sphere durations remain explicitly reference-sphere and are never relabelled terrain durations.

## First person and terrain (frozen)

Default eyes 1.7 m above the actual local mesh ground, not above the reference radius or absolute DEM height. Walking is local and bounded to valid triangles. The camera and current-site science must agree on the moved position; science may update at a measured throttled rate, but must not show results for the original location as current. Continuous ground sampling, render triangle indices, slope and ray checks must use the SAME diagonal. At the initial review, rendering and science differed: rendering split b-to-c0, science split a-to-d. The implementation must retain the scientific a-to-d split through the shared mesh provider; the integrated version fixes both rendering paths accordingly. Nearest-pixel height is insufficient between vertices.

WASD moves only on supported ground, never silently beyond DEM/nodata. Explicit Enter mouse look button, Escape releases pointer lock; drag-to-look remains useful where pointer lock is unavailable. Return to selected point and Orbit always available. Reset pressed keys on blur/unlock/view exit. No invisible flight through terrain; free flight is optional and may be omitted. Time/Play remain available in Surface. Rendering local origin avoids float precision loss. Do not rebuild the whole terrain mesh on each walking frame.

The existing 101 by 101 real 80 m LOLA patch spans about 8 km and has approximately 973 m relief. Assess whether it already gives a useful bounded first-person landscape before downloading more data. No random craters, geometry inferred from colour texture, vertical exaggeration by default, edge walls or false global detail. Outside supported terrain, offer travel to the prepared region; a labelled smooth-sphere fallback may remain explicit. Keep original data/provenance and scientific regressions; any new DEM must use a new asset and documented schema/version.

## Bodies, sky and interpretation (frozen)

Sun and Earth directions and ground illumination come from existing SPICE state. Bodies hide behind the actual same mesh; no raising them above the horizon. Body-centre checks and illustrative discs have distinct scope. Use recognizable textured Earth with credited source; its appearance is not a claim of accurate Earth attitude/geography unless implemented. Orbit distances/sizes are schematic and briefly labelled.

Sky can be a deterministic artistic starfield/Milky Way authored in code, not a navigation catalogue. Explain artistic orientation and enhanced exposure in Data & accuracy. Natural/Enhanced sky are appearance settings only; they never alter scientific body visibility, positions or intervals. Do not spend the main effort on stellar astrometry. Keep real vertical scale. No claims about guaranteed power, radio links or safe landing.

## Acceptance and stop condition

One coherent sequence: choose time, search the region, see three or fewer distinct candidate markers, select one, Explore here, walk/look on real ground, see the calculated sky, change time, return to Orbit. Measure candidate and frame latency before selecting chunking/Worker/LOD. Cancel or invalidate superseded searches, cache reusable geometry/intervals. Verify unknown and blocked states, coverage edges, camera clearance, WASD bounds, Escape, body directions and retained mission/scenario regressions. Final build and new browser check after last runtime edit. Leave main local preview on 4173. Save actual Orbit/Surface screenshots and a short frame sequence of search, selection, descent and inspection.

Scientific API addendum follows the developer's immediate data/geometry assessment. UI composition may proceed against the frozen product boundary; wait for the addendum before wiring candidate or walking mathematics.
