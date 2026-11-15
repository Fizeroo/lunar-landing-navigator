# Renderer-only LOLA visual-context assets

These assets are for surface mesh continuity and visual scale only. They are not loaded by science modules, `validateTerrainPatch`, ray tests, candidate ranking, slope analysis, or visibility calculations. The original 101 × 101 science DEM and its APIs remain unchanged. The renderer should reject a missing/malformed context asset and retain its documented fallback; it must not use this context as a horizon certificate.

## Regional PGDA90 context

`public/data/visual-context-pgda90-80km.json` is `kind: visual-context-only`, schema1.0, with row-major flattened Moon-fixed metre XYZ triples, `frame: MOON_ME_DE440_ME421`, source frame `MOON_ME_DE421`, radius1,737,400m, and 101 × 101 vertices at800m spacing. It is a plain every-10th-pixel sample from the same PGDA90 80m COG source and position conversion used for the detailed patch.

The native source window is row2920/column3300, size1001 × 1001. The detailed DEM occupies inclusive context indices45..55 on both axes, with `nativeStep:10`; corresponding context vertex `(45+i,45+j)` equals detailed source vertex `(10i,10j)`. All121 shared Moon-fixed positions agree exactly in the generated float64 values (maximum norm residual0.0m; contract threshold0.01m). The context has0 null samples across the full grid and0 nulls in the required stitch-ring window43..57 inclusive.

The 101 mesh sample centers span80,000m (100 intervals) on each source-projected axis; the 101-pixel footprint is80,800m. The existing PGDA90 source frame approximation to the application frame is at most5.8204420784597e-7rad, about1.01m at lunar radius. Source DEM elevations are not modified. The sample subset bytes and positions have separate hashes in the JSON; the original COG is not downloaded in full by the preparation script.

## SVS4720 global host

`public/data/visual-context-lola-global-4ppd.bin` is a headerless, row-major1440 × 720 signed Int16 little-endian array. Source float kilometres are multiplied by1000 and rounded to the nearest metre. Values remain heights relative to the 1,737,400m reference sphere. `visual-context-lola-global-4ppd.json` records the binary hash, source TIFF hash, frame, data layout and pixel-centre coordinates.

The downloaded SVS TIFF has no embedded geotransform, so the longitude origin was established from the actual file and official PDS files, not taken from a presumed convention. The PDS `LDEM_4.LBL` says its pixel-registered cylindrical source is east-positive0–360°, centered at180°, with first source-column center0.125° and 1440 columns. The SVS float TIFF matches the original PDS `LDEM_4.IMG` after a720-column roll, with no row flip. Thus SVS column0 corresponds to PDS column720 at180.125°, normalized to **−179.875° east-positive**. Row0 is **+89.875°**, rows decrease southward, and columns advance eastward. The original PDS label has `LINE_PROJECTION_OFFSET=359.5` and `SAMPLE_PROJECTION_OFFSET=719.5`; the latitude registration was also checked against the overlapping PGDA90 patch.

The roll comparison strongly confirms registration but is not pixel-for-pixel equality: SVS float height versus rolled PDS half-metre IMG has mean absolute residual**0.7965308787m** and maximum absolute residual**1423m** over the full grid. Without the 720-column roll, mean absolute residual is2793.7144326m. These source-version/product differences are not hidden or “corrected” in the asset.

## Global/local height comparison

Global values below are bilinearly sampled from the packaged Int16 metre grid at the given pixel-centre coordinates. At the detailed patch center, global minus detailed PGDA90 height is**+27.6780934m**. At the four outer sample-center corners of the80km context, global minus the local 80m PGDA90 context sample is:

| Context corner | Latitude | East longitude | Local PGDA90 height | Global map height | Global minus local |
| --- | ---: | ---: | ---: | ---: | ---: |
| NW | −87.3320574° | −29.5938167° | −391.6114502m | −346.1481720m | **+45.4632782m** |
| NE | −87.3307542° | +29.6430503° | −1144.5441895m | −1106.5912282m | **+37.9529613m** |
| SW | −88.6444630° | −103.5629589° | −726.6695557m | −710.5153039m | **+16.1542518m** |
| SE | −88.6418986° | +103.5368583° | −412.1774292m | −411.2128336m | **+0.9645956m** |

These differences are reported for renderer stitching review. The global4ppd layer is visual context; it does not replace local high-resolution scientific observations.

## Provenance, hashes and reproduction

- Regional source: [NASA GSFC PGDA Product90](https://pgda.gsfc.nasa.gov/products/90), `LDEM_80S_80MPP_ADJ.TIF`; product says the COG is in MOON_ME DE421 south-polar stereographic coordinates.
- Global source: [NASA SVS4720 CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), `ldem_4.tif`, float km relative to1737.4km. SVS credits NASA Scientific Visualization Studio.
- Registration source: [official PDS LDEM_4 label](https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_4.LBL) and matching `LDEM_4.IMG`; [NASA LOLA RDR SIS](https://science.nasa.gov/wp-content/uploads/2024/01/lola-rdrsis.pdf) documents the ME/polar-axis convention for LRO LOLA data.

Current SHA256 values:

| File | SHA256 |
| --- | --- |
| `public/data/visual-context-pgda90-80km.json` | `8b2b10906d6a5f8cffc21a95e4d467033b5eecefdf2b0fa73365258808baa4f8` |
| `public/data/visual-context-lola-global-4ppd.bin` | `c987e22061e94b72f2b43422d0b86e8b90f4cb9ccd24aa566acc539df4c0d34c` |
| `public/data/visual-context-lola-global-4ppd.json` | `ff0da6608ce9f48690aefa311525ed47d0e54f08c789307c1ed69689a5c7e427` |

Prepare from the worktree root with the existing rasterio environment:

```powershell
.venv\Scripts\python.exe scripts\ephemeris\prepare_visual_context.py
```

The script uses TLS-verified HTTPS reads, downloads the4MB SVS TIFF plus the official PDS label/2.07MB IMG for actual roll verification, and performs a ranged COG window read for the80km grid. It checks the exact121 shared positions, stitch-ring no-data, global dimensions/quantization and registration residual before writing assets. It never changes the science patch or validator.
