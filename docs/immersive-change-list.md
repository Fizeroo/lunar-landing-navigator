# Immersive explorer change list

Prepared locally for a later owner-reviewed commit. No commit, push, deployment or contest submission was performed. Existing uncommitted mission/scenario work was preserved; this list describes the immersive extension rather than claiming all current Git changes belong to this task.

| Area | Files and change |
| --- | --- |
| Main experience | `index.html`, `src/style.css`, `src/main.ts`: full-bleed scene, compact UTC and point controls, regional search, explicit model transitions; detailed tools retained in Analysis |
| Views | `src/scene/MoonScene.ts`, `SurfaceScene.ts`, `coords.ts`, new `sky.ts`: regional measured mesh, numbered markers, shared-coordinate grounding, bounded first-person movement, mouse look, actual Sun/Earth directions, procedural artistic sky |
| Compact results | New `src/ui/PointCard.ts`, `CandidatesPanel.ts`; `src/ui/format.ts`: three candidates, explicit unknown terrain, plain English states and eye clearance |
| Scientific extension | `src/science/terrain.ts`, new `candidates.ts`: shared a-d triangles, continuous facet sampling, local rays, deterministic bounded async 25-point search; existing ephemeris and mission APIs retained |
| Retained planner correction | `src/ui/MissionPanel.ts`: mission start follows view time until explicit input/search, then stays fixed |
| Assets | `public/assets/earth_bluemarble_clouds_2k.jpg`, NASA SVS3615 appearance composite; provenance in `immersive-assets.md`; original SPICE and DEM files retained |
| Checks | Terrain/candidate suites, `tests/immersive-coordinates.test.mjs`, new `tests/browser/immersive-flow.mjs`; three old browser scripts marked as historical-layout checks |
| Documentation | Immersive contracts, data scope, science witness, appearance credits, handoff, review and final acceptance records; README and data/source mapping reconciled |

Ignored `artifacts/` contains pre-integration backups, actual browser screenshots and the recorded-frame presentation. Decide separately which evidence files to include in a future commit. Scientific source hashes and the exact final build are recorded in the acceptance document; temporary developer files are not part of the source handoff.
