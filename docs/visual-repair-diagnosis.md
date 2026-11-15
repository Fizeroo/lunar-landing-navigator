# Visual repair — diagnosis before any product edit (t1c, 15 November 2026)

Scope: visual repair only. No product code was changed for this document. Build examined: the accepted build `index-OFQvEFFO.js` / `index-CmQzDKWt.css` (worktree preview 4175; runtime files byte-identical to main).

## How it was reproduced

`node tests/browser/_visual-before.tmp.mjs http://127.0.0.1:4175/ artifacts/visual-repair/before headful` — a scratch capture script (not a check), real GPU (Intel Arc via ANGLE), 1440×772. Sequence: startup → Find → select 1 → Find again → close list → Explore here → look up / Earth / Sun → Back to orbit → Near side → Space. 40 BEFORE frames are in `artifacts/visual-repair/before/`; the state log is `artifacts/visual-repair-before-log.json`. No page errors.

## Findings

### 1. The "floating square" — confirmed, and it is structural

Frames `03-find-result`, `06-closed-list`, `13-back-in-orbit`.

- `MoonScene.showRegion()` sets `this.moon.visible = false` and shows only the finite 8 km DEM mesh, with the camera about 9 km away. Nothing else of the Moon is drawn, so the patch hangs over a star field with an amber rim. This was my choice in the previous round (I made the patch edge visible on purpose); it reads as a tile, not as a place on the Moon.
- The globe cannot simply be left on at that distance. Its only texture is `lroc_color_2k.jpg` (2048 px around the equator, about 5.3 km per pixel), so the whole regional view would be two or three texels. And the DEM ground lies about 460 m below the reference sphere at the centre, so a radius-1 sphere would cut through the mesh.
- **Find is a hard cut.** `showRegion()` assigns the camera position directly. Frame `02-find-transition-00` still shows the globe with the progress box; the next captured frame is the square. There is no flight between them.

### 2. State left behind — a real bug, not only appearance

State log, steps `close list` and `back`.

- Closing the list clears the candidates but leaves the regional view: `regionShown: true, candidates: 0`. The square stays, now with no markers.
- The selected point has **no marker at all** in the regional view: site markers A/B are hidden there, and the candidate markers are gone once the list is closed (frame `06-closed-list`).
- After Explore → Back with no list, the view returns to the same empty square while the hint says "Click the Moon to choose a point" (frame `13-back-in-orbit`).
- Repeating Find gives the same three points in the same order (correct), but it is again a cut and resets the camera.

### 3. The transition is a fade to black, twice a cut, and cannot be interrupted

Mean brightness of the scene area per frame (150 ms apart): descent `57.9, 75.5, 71.2, 0.0, 26.3, 27.3 …`; ascent `26.4, 57.8, 57.8 …`.

- Descent: `approachSite()` flies the Orbit camera for 1.1 s, then `crossFade()` turns the screen fully black (frame `07-descent-03`, brightness 0.0) and swaps to a different renderer and scene. The surface view then appears already standing, looking at the relief. There is no continuous descent; two unrelated pictures are joined by a black frame.
- Ascent: one black frame, then the regional view at its final position. No motion.
- `state.switching` blocks every view control during the change, and the only escape is a 2.5 s timeout. Nothing can be interrupted or reversed mid-way.
- Cause: Orbit and Surface are two WebGL renderers with different units (Moon radii vs kilometres), different origins and different meshes of the same terrain. A true continuous transition needs one camera path through one scene, or two cameras driven by the same Moon-fixed path with a cross-dissolve of rendered frames rather than a black cover.

### 4. Sky — uniform points, confirmed

Frames `08-surface`, `09-surface-sky-up`; `src/scene/sky.ts`.

- 6,500 points placed uniformly at random on the sphere, every one drawn at 1.25 px, brightness 0.38–1.0 from a uniform draw. Real skies have a steep brightness distribution (few bright, very many faint) and clustering toward the galactic plane; uniform size and near-uniform brightness is exactly why it looks like noise.
- The Milky Way band is authored noise on an arbitrary great circle. None of it is a real sky and none of it is oriented.
- The same generator is used behind the Orbit globe (radius 60).

### 5. Markers too large

Candidate markers are 42 px across (56 px selected) and the A/B site badges about 44 px. The three candidates are about 1.1 km apart, so at regional scale the badges cover roughly a kilometre of terrain each and nearly touch (frame `03-find-result`).

### 6. Earth and Sun

- Earth: 2048×1024 composite on a sphere, plus 28% self-illumination that flattens the phase. At its true 1.9° it is about 26 px tall at the default field of view, so it reads as a small blur; the texture is adequate only for that size.
- Sun: a flat disc sprite at true size (about 6 px) with a fixed 9× glow sprite. Directions and angular sizes are correct and must stay; only the appearance is weak.
- In Orbit the Sun and Earth are a ball on a stick (not to scale, labelled); in the regional view they are hidden entirely, so the light has no visible source.

## Sources the user named — what the pages actually offer

**NASA SVS 4851, Deep Star Maps 2020** (Ernie Wright; credit NASA/Goddard Space Flight Center Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC). Real catalogue sky: 1.7 billion stars from Hipparcos-2, Tycho-2 and Gaia DR2. Plate carrée in celestial ICRF/J2000 coordinates, centred on 0h right ascension, right ascension increasing to the left; galactic versions also exist.

- Full maps exist only as OpenEXR half-float: `starmap_2020_4k.exr` 4096×2048 (34.3 MB), `starmap_2020_8k.exr` 8192×4096 (124.5 MB), up to 64k.
- The only JPEG is `starmap_2020_4k_print.jpg` at 1024×512 — a preview. Per the instruction, it is not to be used.
- Separate layers: `milkyway_2020_*` (background without bright stars) and `hiptyc_2020_*` (bright stars only). Using the combined map alone avoids drawing any star twice; no generated points go on top.
- No explicit licence text on the page; credit line plus NASA reproduction guidelines.

**NASA Blue Marble Next Generation** (Reto Stöckli, NASA Earth Observatory; "please credit NASA Earth Observatory"). Monthly 2004 base maps, with topography, and with topography and bathymetry. JPEG at 5400×2700 (8 km/px) and 21600×10800 (2 km/px), for example `world.topo.bathy.200401.3x5400x2700.jpg`. No cloud layer is in that collection. The pages do not state the projection or the longitude of the left edge; that has to be verified on the file before any geographic claim.

## What I cannot do alone (needs the contract / t1p)

1. **Sky orientation.** The ephemeris holds only Moon-fixed Sun and Earth vectors (`sunM`, `earthM` in `MOON_ME_DE440_ME421`). To place a real J2000 star map correctly I need the J2000 → Moon-fixed rotation at the displayed instant from the science side. Without it a real map could only be shown with an explicitly arbitrary orientation, which would be worse than today.
2. **Earth orientation.** A real Earth map with the correct face toward the Moon needs the Earth body-fixed rotation (sub-lunar longitude/latitude) from science. Otherwise the texture stays "appearance only", as now.
3. **Moon context around the patch.** Continuous context needs something real between the 5 km/px globe and the 80 m patch: a coarser real LOLA polar DEM or a real polar image mosaic as a new, separately documented asset. I will not invent terrain or stretch the 2k globe texture to stand in for it.
4. **Asset preparation.** Converting the EXR star map to a web texture needs an EXR reader; none is installed here (`OpenEXR`, `imageio`, `cv2` all absent). Installing one, and adding assets of tens of megabytes, is a decision for the contract. `ffmpeg` is also absent; the finish recording can be WebM straight from the browser (Playwright `recordVideo`), which needs nothing new.

## Proposed repair (for the addendum; nothing here is implemented)

- **One continuous Moon.** Never hide the globe. The regional view becomes a low-altitude view of the same globe with the DEM patch seated in it; the patch edge is still marked, but as a boundary line on the Moon, not the edge of the world. Depends on item 3 for real context at that scale.
- **Flights, not cuts.** Find, Prepared region, select, close, and Back all fly the one camera; closing the list or losing the candidates returns to a sensible framing with the selected point marked.
- **A real descent.** One Moon-fixed camera path from orbit altitude down to the 1.7 m eye point, ending in the first-person pose, interruptible at any moment (Back, Esc, or a tab click reverses from where it is), with no black frame. I will confirm on a prototype whether this is one scene or a cross-dissolve of two synchronized renders before proposing which.
- **Real sky.** The SVS 4851 map at 4k or 8k as the only star source, tone-mapped once offline, oriented by the science rotation; Natural/Enhanced stays an exposure setting.
- **Smaller markers.** Roughly 18–22 px with a thin leader to the exact ground point; selected one emphasised by a ring, not by size alone.
- **Earth and Sun.** Keep SPICE directions and true angular sizes exactly. Blue Marble at 5400×2700 with correct phase lighting (no self-illumination); Sun as a limb-darkened disc with a restrained glow.
- **Finish evidence.** AFTER frames matching the BEFORE set one for one, plus a short WebM of search → select → descent → look → ascent.

## Not affected

Science modules, candidate semantics, the 90 browser checks' assertions on state, labels and model boundaries. Any change to candidate meaning is being coordinated by the architect with t1p and is outside this diagnosis.

## Isolated source check (scratch only, nothing added to the project)

Downloaded to separate scratch folders and inspected; no file was copied into `public/` and no package was installed.

| File | Bytes | SHA-256 | Verified |
| --- | --- | --- | --- |
| `starmap_2020_4k.exr` | 35,997,085 | `69b841cd048c2ef35543eb1c5819b322530e78aa4b0cab97ec1de3ef56a4ddcd` | OpenEXR v2, 4096×2048, channels B G R half-float, ZIP compression |
| `world.topo.bathy.200401.3x5400x2700.jpg` | 2,571,926 | `1684c4f8f51970dcb4a7451302bf3be17bed657aed9fece6f80d7b191e8afa3d` | JPEG, 5400×2700 RGB |

- **The EXR needs no new tool.** It is plain ZIP scanline compression, which I decoded with the Python standard library plus the already-installed numpy and Pillow (about 40 lines). The decoded picture is recognisably the real sky: the Milky Way arc with its dust lanes, both Magellanic Clouds, Orion. This removes "permission to install an EXR reader" from the list above.
- **The map is already display-referred.** Values run 0 to exactly 1.0 (no pixel above 1), median 0.0076, 99th percentile 0.118. So Natural/Enhanced is a simple exposure curve on an 8-bit texture; no HDR pipeline is needed. A 4096×2048 JPEG at quality 90 is 2.5 MB at unit gain. An exposure gain of 6 turns the background grey, so the Enhanced setting must be much gentler than that.
- **Not yet verified:** which image column is right ascension 0h and the direction of increase on this exact file (the page says centred on 0h, increasing to the left). I will check it against known bright stars before any orientation claim, and it still needs the J2000 → Moon-fixed rotation from science.
- **Blue Marble:** the file is 2:1 as expected; its longitude origin is likewise unverified until checked against coastlines.
