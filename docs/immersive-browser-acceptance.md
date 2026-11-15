# Immersive explorer — historical acceptance

This is the pre-visual-repair baseline, not acceptance of the current application. The camera, drawing host, sky, Earth shader and candidate labels changed afterwards. See [the current visual repair acceptance](visual-repair-acceptance.md) and its exact build manifest. The older results below are retained as history.

Recorded 15 November 2026 on the existing main worktree. Local preview remains **http://127.0.0.1:4173/**. The final runtime build is `index-OFQvEFFO.js` with `index-CmQzDKWt.css`. No runtime edits followed the final build or the checks below. Documentation and evidence files were then completed. No commit, push, publication or submission was performed; HEAD remains `a135d52`, branch `main`.

## Final checks

| Check | Evidence and outcome |
| --- | --- |
| Main numerical/UI regression suite | `npm test`: **89/89 pass** after the last runtime change. Includes SPICE regression fixtures, UTC bounds, intervals, mission clipping, scenarios, coordinate conversions, shared triangles, continuous grounding, candidate ranking/cancellation and English-source checks |
| Production build | `npm run build`: strict TypeScript clean, Vite production build passes |
| Final integrated browser suite | Claude ran `node tests/browser/immersive-flow.mjs http://127.0.0.1:4173/ artifacts/immersive-main-final` against the exact final main bundle: **90/90**, no console/page errors. Full output: [browser report](immersive-main-browser-report.txt) |
| Geometry and body consistency | Browser ray casts measured 1.7000 m eye clearance on arrival, after walking and near the coverage boundary. Camera look directions agree with numerical azimuth/altitude. Across 54 sampled hours, centre-ray obstruction agreed with the rendered mesh in every case |
| Low-height regression | Scientific heights 0, 0.1 and 1.7 m remain exact on arrival, return without moving, walking and walking then returning. The display-only 0.2 m camera floor is explicitly labelled and no longer overwrites scientific state |
| State and retained tools | Same-time 25-point search, three distinct alternatives, cancellation/stale-result removal, candidate height preservation, time/playback, explicit unsupported-terrain handling, Analysis/scenarios/Space. Mission start follows time until input/search, then stays fixed |
| Layout | 1440×772: controls cover 14.2% at startup and 17.0% on Surface; opening the optional candidate list increases coverage to 28.9%. No overflow/control overlap in checked 1280×650 and 935×640 layouts |
| Read-only review | Reviewer checked scientific/scene state boundaries and found a low-height drift blocker. The narrow fix is accepted in [superseding correction](immersive-final-review-correction.txt); no source blocker remains. The reviewer did not claim to rerun the browser suite |
| Architect's visible-browser pass | Native Edge on the final port-4173 build: clean startup; actual 25-point result at displayed time; marker selection; terrain descent; Earth/Sun look actions and compass; the real blocked-Sun example; secondary Space scene; clean startup restored. Actual new screenshots saved after the final runtime fix |

Earlier 68/72-check runs and mission-layout screenshots are historical checkpoints. They are not substituted for this final run. The automated browser uses its own temporary profile and does not clear the user's existing saved scenarios.

## Measured performance

Claude's separate headful Edge smoke used the same fixed runtime, a temporary profile and no forced software rendering. On this machine, **Intel Arc Graphics / ANGLE Direct3D11**, at 1440×772 and DPR 1: regional Orbit, Surface standing and fast traversal each measured about **60 frames/s**, median 16.7 ms, worst 17 ms. Search click-to-list was **1051 ms cold / 946 ms warm**. The test-owned browser was closed; the user's browser and preview server were preserved.

The final full browser suite deliberately used SwiftShader and measured about 9 frames/s, with search 1145/999 ms. That is software rendering, a separate condition. No performance result for other GPUs or mobile devices is claimed. Reproduction: optional `tests/browser/gpu-smoke.mjs` (requires the documented optional browser test dependency).

## Actual screenshots and recorded frames

These captures were taken by the architect from the final visible browser build. They include browser chrome; no mockups or generated terrain are substituted.

- [Orbit](../artifacts/immersive-final/01-orbit.png)
- [Search results](../artifacts/immersive-final/02-candidates.png) and [selected marker](../artifacts/immersive-final/03-selected.png)
- [First-person arrival](../artifacts/immersive-final/04-surface.png), [Earth](../artifacts/immersive-final/05-earth.png), [Sun](../artifacts/immersive-final/06-sun.png)
- [Terrain-blocked Sun](../artifacts/immersive-final/07-terrain-blockage.png)
- [Secondary Space view](../artifacts/immersive-final/08-space.png)
- [Playable frame sequence](../artifacts/immersive-final/index.html): search → choice → descent → look; this is a frame presentation, not a continuous video.

## Reproducible example and limits

The default instant is `2027-01-17T03:56:37.557Z` (UTC input rounded to seconds). Find candidates and select number 1 near **88.9720° S, 4.0000° E**. Explore here starts 1.7 m above the real facet. Sun/Earth centres are approximately +1.2°/+7.5° relative to the radial tangent plane; no local mesh hit still means unknown distant terrain. Set `2026-12-22T06:00:00Z`, then Look at Sun: its centre is approximately **+2.2°** but locally **blocked by terrain**. This is verified data, not a staged decorative event. See the [one-minute walkthrough](immersive-demo-walkthrough.md).

One real 101×101 LOLA grid at **80 m spacing** forms an **8000×8000 m** sample-centre mesh; its raster footprint is 8080×8080 m. Search evaluates 25 cell-centre points in the smaller named polygon, latitude **−89.035° to −88.965°**, east longitude **−5° to +5°**, not the entire Moon. Walking has a 160 m nominal grid-margin guard. See [exact coverage](immersive-data-scope.md) for projected bounds and the nonrectangular latitude/longitude footprint.

The 80 m grid does not resolve individual rocks or human-scale ground obstacles. Colour grain adds no geometry. Heights are not exaggerated. Distant relief beyond the patch and unbundled quality layers remain unknown; the finite tile edge does not establish a clear horizon. Candidate ranking and continuous durations use the labelled reference sphere, separately from local terrain diagnostics. A found local blocker is meaningful; absence of a hit is not certified visibility. Visual shadow maps may show a faint dotted pattern and are not exact solar-disc photometry.

Prepared ephemeris covers **2026-10-01 through 2027-02-01 UTC**, sampled at 600 ET-second steps plus the endpoint. No external request is made for each slider movement. Event times remain approximate; coverage boundaries are not physical rise/set events. Enhanced sky is artistic; Earth's image is an illustrative NASA composite rather than date-specific weather/attitude. Geometry does not guarantee power, radio service, traversability or landing safety.

## Exact current snapshot

| File | SHA-256 |
| --- | --- |
| `src/main.ts` | `934da1821116b8847c11c2eb9d86881b3b0aa20c3e7d521cc7845a4b64c68bcd` |
| `src/scene/SurfaceScene.ts` | `9d92babfb9f3a41545fa788f6c7aef9ab18d222beda2019b133749848431c9e1` |
| `src/science/terrain.ts` | `6765f7ea1348bf009f7dda03bb1ae0a71dc57741bf00779a899939a162a53642` |
| `src/science/candidates.ts` | `1313357c1e314a9d0a6472477aceb407bc1ebf2f1d0ab495d39f7fb7cdd78d93` |
| `tests/browser/immersive-flow.mjs` | `b8823d7b25f94a61596a5d1e7a032b4979788e120358db8e7011a30cb6513ec0` |
| Prepared ephemeris JSON | `02873a58203073d7633b584cb763ee1e7037230d69edfbccde34e9e2506de5cb` |
| Original DEM JSON | `dceac4465b00d8bc8a0cdd42662793540259b45aa0a76f53b322b559dd506db6` |

Other UI/scene hashes and the integration history are in the [handoff](immersive-ui-handoff.md). Original science/data were preserved during selective integration. Sources, usage conditions and the unavailable official 2026 challenge-page recheck are recorded in [data and sources](data-and-sources.md). The [change list](immersive-change-list.md) distinguishes this extension from retained uncommitted work.
