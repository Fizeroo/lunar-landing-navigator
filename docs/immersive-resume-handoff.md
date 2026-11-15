# Resume the immersive explorer — current state, 15 November 2026

This is the handoff to the **existing Claude t1c**, now that the user has enabled credits/upgraded the subscription. Inference has resumed. Do not use the stale worktree files as the base. The architect will explicitly copy the listed current files from main into your worktree before authorizing edits. No new agents, worktrees, repositories, branches, commits, push or publication.

Read `immersive-ux-contract.md`, `immersive-science-contract.md`, `immersive-science-implementation.md`, `immersive-science-results.md`, and `immersive-assets.md`. Those are the user's new immersive task, agreed API and verified source boundaries. This handoff is not a request for another large form.

## User outcome

Full-bleed scene (at least about80% unobscured on a normal laptop), compact Orbit/Surface, UTC/slider/Play/Now, Find a landing candidate, small point card and Explore here/Back to orbit. Detailed mission form, A/B, scenarios, timelines are retained inside Analysis; technical information in Data & accuracy; Space is secondary. Choose time -> evaluate distinct regional points -> select a marker -> descend to real first-person terrain -> walk/look -> change time -> return. All UI/docs English. Keep crucial partial-coverage limitations visible, briefly.

## What is already implemented in main

- Your full-bleed HTML/CSS and PointCard were preserved and extended. Old mission/A-B/scenario modules are still there inside Analysis. No previous task work was discarded. Ignored baseline copies are in `artifacts/immersive-baseline`.
- Scientist t1p implemented the shared a-d DEM mesh, continuous facet sampling, eye-ground position, facet slope, coverage margin and lightweight `observeTerrainInstant`. Both renderers consume the shared indices (winding reversal only). Original data assets are retained.
- New async regional search evaluates25 distinct points at the displayed ET, not just the existing marker. Reference-sphere ranking and remaining current joint duration are separate from local terrain blocked/insufficient diagnostics. UI shows3 candidates and true evaluated count. `CandidatesPanel.ts` is new. Abort/generation logic invalidates changed-date results; setPeriod/jumpTo were just fixed to invalidate when they change ET. Search uses the selected observer height, and selection retains that request height.
- Root built first-person locomotion into SurfaceScene: 1.7m default eye, continuous shared-facet grounding, fixed local render origin, WASD/Shift,160m boundary margin, explicit pointer-lock entry/Escape release, drag fallback, Return to point, moving compass in actual current local ENU. `coords.ts` now exports the inverse rotation. Two new numerical UI coordinate tests cover cardinals and a half-kilometre ground-following walk with1.7m clearance.
- A deterministic artistic starfield/Milky Way is in `scene/sky.ts`. Natural/Enhanced toggles live in View settings. Artistic exposure/orientation is disclosed in Data & accuracy. Earth is textured with your verified NASA SVS3615 asset, present in main and your worktree; no current-cloud/geographic-attitude claim. Body vectors/angles remain SPICE. Look at Earth zooms the FOV to38deg, not the body's angular scale.
- MoonScene supports local regional Orbit geometry, a-d topology, numbered candidate markers and picking; global Orbit/Space remain. Regional camera was tightened so the finite tile's edges are outside the default close view, with bounded zoom; Near side returns to globe.
- Default example uses actual UTC `2027-01-17T03:56:37.557Z`; centre and top3 candidate centre rays have no local DEM intersection, so their full-terrain visibility is honestly unknown. Scientist's independent witness is in immersive-science-results.md. Now is a separate actual-time action and refuses unsupported dates.
- Surface card/view/model is now refreshed on descent/return; candidate panel hides during Surface. The decorative reference-horizon line and giant 3D compass letters are hidden in Surface: the silhouette is the actual mesh, HUD compass remains.
- Recent unaccepted visual change: terrain gets shadow mapping from the same mesh and real Sun direction. This is finite-DEM visual shading, not a full horizon certificate. Check consistency/performance; remove or adjust it if it creates false contradictions. Do not claim exact solar-disc/shadow photometry.

## Current verified checkpoints (not final acceptance)

- Main broad tests:87/87 before the two new coordinate tests, which separately pass2/2. Final consolidated count is expected89, not yet accepted after final UI edits.
- Strict typecheck and builds pass; latest source has a few small fixes after the last build and needs rebuild.
- Native Edge prototype: clean full-screen layout,25 evaluated points,3 real distinct markers; selection and terrain descent work, true mountains/ground/Sun appear. This is **prototype evidence**, not acceptance of your final changes.
- Original scientific regression data and mission tests remain; never overwrite science with older worktree versions.

## Remaining tasks you own — complete them

1. Inspect current app in browser and finish visual composition. Primary scene must feel like exploration, not a dashboard. Check markers (just upgraded to circular numbered badges), real terrain, Earth texture, the artistic sky, text fit at1440x772 and a smaller laptop. Avoid excessive text and fixed panels.
2. Verify first-person controls and eye clearance in actual UI: pointer-lock Enter/Escape, WASD movement, Return to point, terrain boundary/nodata, no silent terrain-to-sphere fallback. Primary Explore on an unsupported point already offers an explicit dialog; **inspect Analysis changing a point while Surface is active**, where legacy `prepareSurfaceGround` still auto-selects sphere if the new point is unsupported. Fix that silently changing model path.
3. Check actual body occlusion. Currently main passes draw=false for a body whose **centre** ray is blocked, which hides its whole illustrative disc. Prefer GPU occlusion by the real shared mesh for partial discs if feasible, with clear centre-ray scientific wording; do not claim computed full-disc visibility. Sun/Earth must never be moved above the horizon. Light/shadow and CPU local blocker result must be checked, not presumed.
4. Check model/point/time agreement in Orbit and Surface, Eye settings (0.5..3m; default1.7m), global time/Play/Now, candidate stale invalidation/cancellation, actual current-start joint-duration numbers. Unknown terrain is not Yes. Retain usable Analysis, scenarios/save/import/share and old scientific APIs.
5. Finish compact search-to-surface flow. Consider restoring a still-valid candidate list on Back to orbit; do not retain it across changed time/height/region. Search region is the named prepared polygon (no polygon drawing needed). At most3 candidates on screen.
6. Update/adapt meaningful browser checks to this UX; old scripts still expect the old side panel/layout. Run appropriate unit/typecheck/build checks. Do not claim old screenshots as new evidence. Save exact readiness/file list and English review in docs. Root performs final visible browser acceptance after integration. Save real Orbit/first-person screenshots plus a short sequence search -> choice -> descent -> look.

## Scope and ownership from now

After the explicit sync, Claude again owns UI/scene/main/style/HTML and browser UI tests. Architect will stop editing those while you can work, own source/docs integration and final acceptance. Scientific developer t1p remains the owner of science/terrain.ts, science/candidates.ts and scientific tests; request narrowly scoped corrections from him. Reviewer t1q is read-only and checks main or declared staging snapshot. Tell t1n exactly which files change after sync, not a whole checkout.

Existing main preview remains **http://127.0.0.1:4173/**. You may use a separate local worktree preview (4175) for your development, but keep main preview running and do not start another Claude. Current runtime is Vite/TypeScript/three.js, no stack change.

Actual communication requires the command tool: PowerShell `& 'C:\Users\emir0\AppData\Local\Programs\herdr-core\hc.exe' send t1n 'your concise message'`, or the same installed hc from Bash. Merely writing "hc t1n" in prose does not send it. Save detailed manifests/reviews in docs because long hc messages collapse in the parent's input. Do not repeatedly send on started:false; inspect terminal/input before one Enter.
