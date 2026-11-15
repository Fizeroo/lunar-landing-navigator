# Exact scope of the immersive explorer

## Prepared terrain

The retained [NASA PGDA Product90 LOLA-derived DEM](https://pgda.gsfc.nasa.gov/products/90) subset comes from `LDEM_80S_80MPP_ADJ.TIF`. No new elevation data were fabricated or inferred from the colour texture.

| Item | Scope |
| --- | --- |
| Source window | row offset3370, column offset3750,101 rows by101 columns |
| Grid spacing |80m in the source south-polar stereographic projection, IAU:30135 |
| Raster pixel footprint |8080m by8080m |
| Rendered sample-centre mesh hull |8000m by8000m in projected coordinates; no half-pixel extrapolation |
| Mesh projected X bounds |−3960m to+4040m |
| Mesh projected Y bounds |+26360m to+34360m |
| Valid source samples |10,201; the retained original patch contains no missing vertices |
| Heights |approximately−1204.41m to−231.69m relative to the1,737,400m reference sphere |
| Nominal relief |approximately972.72m |
| Walking bound |at least160 nominal projected-grid metres from the mesh/no-data boundary; this is a coverage guard, not a route-safety criterion |

The latitude/longitude envelope of the source vertices is approximately **89.13072°S to88.85911°S**, **8.54352°W to8.71349°E**. This is an enclosing envelope, **not** a claim of rectangular latitude/longitude coverage: the actual footprint is the projected mesh and its valid triangles. The true boundary and no-data checks use that mesh.

The source frame is DE421 Moon Mean Earth. Its documented approximate alignment to the application's `MOON_ME_DE440_ME421` is limited by the existing frame-rotation approximation, about1.01m at lunar radius. Pixel spacing is not a guarantee of effective terrain resolution or vertical accuracy. No source count/error/quality companion layers are packaged. The mesh does not resolve individual rocks, soil bearing or a person's safe route.

## Candidate search region

The default search is the named **PGDA90 central south-polar region**, a bounded polygon with latitude **−89.035° through−88.965°** and east longitude **−5° through+5°**. The app evaluates a reproducible5×5 grid of cell-centre points in those bounds, subject to actual DEM coverage and the margin. It does not search the entire8km tile or the whole Moon. Up to3 sorted candidates are presented; the actual evaluated count is reported.

Ranking is reference-sphere geometry at the selected time and observer height: both body centres above the reference tangent horizon, then the separate Sun/Earth conditions, remaining continuous current joint time, solar altitude and stable tie-breaking. Local DEM slope and per-body blockage/unknown coverage remain separate diagnostics. No local obstruction found is **insufficient** coverage, not certified clear sky. No terrain-aware continuous duration is implied.

## Time, views and appearance

Prepared SPICE data cover **2026-10-01T00:00:00Z through2027-02-01T00:00:00Z**, with600 ET-second sampling and a final exact endpoint. The visible current time, observations and candidate request share one state. Unsupported UTC dates are refused rather than extrapolated. The prepared default example is17 January2027; **Now** explicitly requests the real current UTC instant.

Global Orbit is a lightweight sphere and appearance map. The prepared-region view uses the real local triangle mesh; it does not provide detailed global terrain. First-person grounding uses the same full local mesh as the scientific ray calculations. Visual shadow mapping is bounded to that DEM and is not a full terrain-horizon or photometric certification. The artificial starfield/Milky Way and illustrative Earth map are documented in [appearance credits](immersive-assets.md); neither alters the scientific calculation.
