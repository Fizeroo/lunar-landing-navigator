# Immersive explorer — UI/scene handoff from Claude (t1c), 15 November 2026

**Integration status:** this is a chronological handoff record. The initial table and early 68/72-check results below are superseded where stated by the low-height fix and final main run. The current delivered snapshot and acceptance are in [immersive-browser-acceptance.md](immersive-browser-acceptance.md). The architect integrated the narrow fix, passed all 89 main tests, built `index-OFQvEFFO.js`, and obtained **90/90** browser checks against port 4173 after the final runtime edit. Earlier GPU-unknown and main-not-yet-tested statements describe earlier checkpoints.

Staging snapshot for selective copy into main and for read-only review. Base: the 20 files synced from main before this work. Nothing was committed, pushed or published. No science file was changed (`src/science/**`, `scripts/ephemeris/**`, `public/data/**` are untouched).

## Files to copy (worktree `worktrees/claude` → main), with SHA-256

| File | SHA-256 |
| --- | --- |
| `index.html` | `d58ef50b73a6bca6453f51efe1b9fc58ddec41dece902cd613dc43479e66cb23` |
| `src/main.ts` | `776b780ba45cea710a0453432d1c2d76b184175abfe88546ea005bda1e706a2e` |
| `src/style.css` | `d975eac42da7775e85a72c53e2d280a19756f5eff3ab8e616c444375cc899572` |
| `src/scene/MoonScene.ts` | `69d1cb0ccab497ab12b7caa3f009ede02b506708fa4a4061dd06d8db68523ba7` |
| `src/scene/SurfaceScene.ts` | `9d92babfb9f3a41545fa788f6c7aef9ab18d222beda2019b133749848431c9e1` |
| `src/scene/sky.ts` | `472be963eda15e484c124b45b3bc82f3934e00c29f654284f3fc6e67069a45e5` |
| `src/ui/PointCard.ts` | `d2564c978250b5d441e4123ae5e5f2ac8e6e3662606e0cf6d15393b830b1da02` |
| `src/ui/CandidatesPanel.ts` | `6870cf3cb3ab7bb4244e3e5401f051bd663448b881a4dfde5cfff4e9c7755202` |
| `src/ui/format.ts` | `62632c126a856ed07bbbd91f2788a608cf58e3c6cc0a75d7a5cf2deba1352fcb` |
| `tests/browser/immersive-flow.mjs` (new) | `2e612b00229e619376297c693c0f0ca90e6c383a675ce0f8c6127d1150500bda` (updated after integration: four mission-start assertions added; was `49f5fa57…a70d6`) |
| `tests/browser/ui-flow.mjs` (header comment only) | `eb67d633a5836d5b28d369d5c926f708c5a8780e9f7b3d709f1c0e7376d37583` |
| `tests/browser/ui-layout.mjs` (header comment only) | `7668a7fd38b73577893c4aaa372ff690f64892a37aec2520b094d21bb8ffe3e9` |
| `tests/browser/mission-flow.mjs` (header comment only) | `41859a5097d2c6a9a3de2b85845716735cc4a851990cd878b87f9fbf1157cac0` |
| `docs/immersive-ui-handoff.md` (this file) | — |

Screenshots (ignored by git): `artifacts/immersive/01…17-*.png`, 19 files, written by the browser check below.

**Architect's decision needed — one file that differed before the sync.** `src/ui/MissionPanel.ts` (`0bf1550b…d444f`) is *not* in the list above. It was not among the 20 synced files and I did not edit it in this session. My worktree copy is newer than main's (15 Nov 00:19 vs 14 Nov 23:38) and differs in two places: the mission start field keeps following the view time until the user types or searches (`!this.found && document.activeElement !== this.start` instead of `this.start.value === ''`), and one extra `startTouched = true`. All checks below ran with the worktree version. Main's 53 UI tests pass with either, as far as I can tell from the worktree run; copy it only if you want that behaviour.

Not part of the handoff: `tests/browser/_shot.tmp.mjs` (my scratch screenshot driver).

## What changed

**Search → choose → descend → return**
- Regional Orbit view is an oblique look at the whole measured patch with a neutral fill light, so the 80 m relief reads. Amber line: edge of terrain data. Blue line: the searched polygon, laid on the mesh. The candidate list names the same area with bounds (`lat 89.035° S to 88.965° S, lon 5° W to 5° E`) and says it is not the whole 8 km patch or the Moon.
- The picture shifts aside while the list is open, so no marker sits under it (this hid marker 1 before, at 1440 px and at 935 px). The chosen marker is enlarged.
- Each choice shows the reference-sphere result and, separately, the measured-terrain result (`Sun unknown · Earth unknown` / `blocked`). Eye height reads `1.7 m` (it was rounded to `2 m`).
- Back to orbit brings back the same list and region if nothing invalidated it; a time, eye-height or point change still removes it. After a walk the selected point is restored exactly, not re-sampled.

**First person**
- Arrival faces the most prominent measured relief seen from that point (tallest skyline or deepest basin, read from the drawn vertices). `Look at` has Sun, Earth, Terrain, North. The field of view no longer stays at the Earth close-up.
- Sun and Earth are always placed on their SPICE directions and hidden by the same mesh that is drawn, so a disc can show partly. The card and the label report the body-centre ray only (`blocked by terrain` / `terrain unknown`); no disc fraction is claimed.
- Look at Sun/Earth is no longer clamped to −70…+85°: it reaches the true direction up to ±90°, with a stable view and a `heading —` compass straight up.
- W A S D work after pressing any button (focus on a button used to swallow them). Walk 3 m/s, Shift 25 m/s, both ground-following.
- Shadow volume is fitted to the whole patch with a 4096 map and small offsets. A large normal offset lit ground that the science result said was in shadow; that contradiction is gone in the screenshots.
- Fine grain on nearby ground, colour only, so movement is perceptible. Disclosed in Data & accuracy.
- Milky Way redrawn per pixel with dithering; the hatched pattern across the sky is gone.

**No silent model change**
- Changing the point from Analysis, the catalogue or a scenario while standing on terrain, to a point without terrain: the surface is left for Orbit with a stated reason. The ground model is no longer flipped to a sphere. `prepareSurfaceGround` no longer mutates the model at all.
- An observer height outside the 0.5–3 m slider (set in Analysis or by a loaded scenario) is shown as it is — camera, science and read-out all use it — with `Reset eyes to 1.7 m`. Saved scenarios are not modified.

**Layout**
- App title stays visible down to 721 px wide (it was hidden below 1240 px or 700 px tall). The point card shows altitude and compass point beside each state.

## Verification (all run after the last runtime edit)

- `npx tsc --noEmit`: clean. `npm run build`: passes.
- `npm test`: 53/53. `node --test scripts/ephemeris/*.test.mjs`: 17/17. The worktree holds 70 tests; main's other 19 live in three ephemeris test files that are not in this worktree, so the 89 total needs your run in main after the copy.
- `node tests/browser/immersive-flow.mjs http://127.0.0.1:4175/ artifacts/immersive`: **68/68**, headless Edge, no console errors. It covers: start layout (controls cover 14.2% of the scene; 17.0% on the surface; 28.9% with the list open), 25 points at the displayed instant, stale and superseded searches, selection, descent, eye clearance measured by ray-cast on the rendered mesh (1.7000 m at arrival, after walking and at the coverage edge; 3.0 and 0.5 m from the slider), Look at Sun/Earth within 0.2° of the science values, pointer lock and Escape, drag look, walking, key reset on blur, Return to point, time and Play on the surface, list restored on return, coverage boundary, the Analysis-moves-the-point case, the 1000 m legacy height, the zenith look (Sun at 90.000°, camera 90.000°), Analysis/scenarios/Data & accuracy/Space/Now, and 1280×650 and 935×640.
- Centre-ray agreement: over 54 sampled hours the science status (`blocked` or not) equalled a ray-cast against the rendered mesh every time, including a blocked Sun at +2.22° (`08-surface-body-behind-terrain.png`).
- Measured in headless software rendering: search click-to-list about 1.4 s cold, 1.0 s warm; surface view about 10 frames/s. That is SwiftShader, not a GPU — real frame rate needs your visible-browser pass.

## Run against main after integration

`node tests/browser/immersive-flow.mjs http://127.0.0.1:4173/ artifacts/immersive-main` from this worktree, against main's final build (`index-CVUeuI3E.js`, `index-CmQzDKWt.css`): **72/72**, no console errors. The 68 earlier checks pass unchanged. Four were added for the integrated `MissionPanel.ts`: the mission start follows the view time before any input (`2027-01-17T03:56:38Z` → `2026-12-05T10:00:00Z`), and stays fixed after typing a start or after a search while the view time moves on. Report: `artifacts/immersive-main-report.txt`; 19 screenshots in `artifacts/immersive-main/`. Only the test file changed for this run; no runtime file was edited.

## Real limits

- Not checked on a real GPU or by a person with a mouse: pointer lock was granted in headless Edge and Escape released it, but mouse-look feel and frame rate are yours to confirm.
- Shadows are shadow-map shading of an 80 m mesh. In the blocked-Sun screenshot a faint dotted pattern remains on a distant slope. It is not disc photometry and not a horizon certificate.
- With the Sun slightly below the local horizontal and no mesh in that direction, the disc can show past the patch edge with the label `terrain unknown`. That matches the science status, but it is unknown terrain, not a clear view.
- The first look depends on the point: from candidate 1 the relief is gentle (about 3° of skyline), so the arrival view is real but not dramatic.
- The three older browser scripts target the previous side-panel layout. I marked them superseded rather than rewriting them; their mission and scenario assertions are not re-run against this layout.
- `window.__lln.probe()` is a read-only hook added for the browser check.

## Narrow fix after the final review — low observer height (t1q blocker)

**Problem confirmed.** For a scientific observer height below the 0.2 m camera minimum (0 or 0.1 m, valid in scenarios and the site form), the walking position report derived the height from the clamped camera and wrote 0.2 m back into the scientific state on the first walk report or Return to point.

**Fix, UI boundary only (`src/main.ts`, 20 changed lines; no science API touched).** The position report now updates the position only; the calculation height is never inferred from the camera. The card and the eye read-out state both values when they differ: `calculated at 0.0 m · camera drawn 0.2 m up (display minimum)`. At 0.2 m and above the label stays `eyes 1.7 m`.

Files to copy — only these three; every other runtime file is byte-identical to main:

| File | SHA-256 |
| --- | --- |
| `src/main.ts` | `934da1821116b8847c11c2eb9d86881b3b0aa20c3e7d521cc7845a4b64c68bcd` |
| `tests/browser/immersive-flow.mjs` | `b8823d7b25f94a61596a5d1e7a032b4979788e120358db8e7011a30cb6513ec0` |
| `tests/browser/gpu-smoke.mjs` (new, optional) | `1a4b16c76368cbdd736c163c0e036daeaabdaec414e9215cbe291329e3c85fa2` |

**Verification on the worktree build (4175, `index-OFQvEFFO.js`).** `tsc` clean, build passes, 53/53 and 17/17 unit tests. `immersive-flow.mjs`: **90/90** (72 earlier + 18 new). The new checks set heights 0, 0.1 and 1.7 m on terrain and, for each, assert on arrival, after Return to point without moving, after a walk, and after walking and returning: state height exactly as set, ray-cast camera clearance 0.2000 m (1.7000 m for 1.7), the explicit label, still the terrain model; plus that the walk really moved the point and the site form still holds the set height. This fixed build has not yet been run on main's 4173.

## Headful GPU smoke (no forced software rendering)

`node tests/browser/gpu-smoke.mjs http://127.0.0.1:4175/` — its own visible Edge window with a temporary profile, closed afterwards. One run on this machine, 1440×772, device pixel ratio 1:

- WebGL renderer: `ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
- Regional Orbit 3 s, Surface standing 5 s, Surface fast traverse 5 s: 60.0 frames/s each, median 16.7 ms, worst frame 17.0 ms (display-refresh capped).
- Search click-to-list: 1051 ms cold, 946 ms warm.

This replaces nothing in the limits above except the frame-rate unknown for this one machine; other GPUs were not measured.
