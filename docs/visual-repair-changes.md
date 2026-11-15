# Focused visual repair: changes for a later commit

No commit, push or publication was performed. The repository already contained substantial uncommitted explorer work before this repair. This list identifies this repair's scope; it is not an instruction to stage all existing changes.

- `src/main.ts`: search retains a whole-Moon camera, selection and markers share one shortlist, Back restores the saved Orbit frame, continuous reversible descent, Escape regardless of button focus, measured-ridge startup example, visible asset failures and updated accuracy explanations.
- `src/scene/MoonScene.ts`: continuous Moon host, geographic colour sampling, controlled flights, saved/external camera poses, small decluttered candidate badges and thin coverage boundary.
- `src/scene/SurfaceScene.ts`: the same host in local coordinates, eye-level ground, real Sun/Earth sizes and directions, camera-heading selection without moving bodies, picture-only context occlusion, viewport-contained direction labels, restrained terrain lighting.
- `src/scene/context.ts`, `hostGeometry.ts`, `transition.ts`: strict visual-context validation, exact fine/coarse registration, closed stitched geometry with no overlapping faces or walls, bounded overview tessellation, geographic texture lookup and shared camera interpolation.
- `src/scene/sky.ts`, `bodies.ts`: NASA star map, Blue Marble phase shader, corrected reserved GLSL identifier, small atmosphere, natural solar disc and restrained glare.
- `src/ui/CandidatesPanel.ts`, `src/style.css`: compact markers and explicit blocked/unknown/provisional assessments. No unqualified best-site claim.
- `src/science/candidate-assessment.ts`: interpretation helper and display shortlist; existing scientific search and ranking remain intact.
- `public/assets/earth_bmng_200401_4k.jpg`, `starmap_2020_4k.jpg`; `scripts/assets/convert_earth.py`, `convert_starmap.py`: real sourced appearance assets and reproducible conversion.
- `public/data/visual-context-*`; `scripts/ephemeris/prepare_visual_context.py`: real 80 km PGDA90 context and global LOLA drawing data, separate from scientific coverage.
- Focused tests for interpretation, registration, closed topology and camera interpolation; browser regression updates; provenance, witness and acceptance documents in `docs/`.

Protected scientific modules and prepared ephemeris/80 m DEM bytes were compared to the pre-repair baseline and remain unchanged. `docs/visual-repair-baseline.json` records that baseline. The WIP manifest preserves the exact Claude snapshot before architect completion. Screenshots, recordings and command logs live in ignored `artifacts/`; retain them separately if the later commit should include evidence.
