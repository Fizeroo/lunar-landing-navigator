# Scientific exploration extensions

This document covers the extended ephemeris, event search, elevated observers and the first real terrain patch. The original November ephemeris and its first-slice interfaces remain available.

## Extended ephemeris and direct check

`public/data/ephemeris-2026-10_2027-02.json` contains genuine SPICE vectors in `MOON_ME_DE440_ME421`, origin Moon 301, geometric correction `NONE`, metres, and TDB ET. Its inclusive UTC coverage is **2026-10-01T00:00:00Z through 2027-02-01T00:00:00Z**. It has 17,714 samples: 600 ET seconds between regular samples plus the exact requested final endpoint. The original `public/data/ephemeris-2026-11.json` is unchanged.

Reproduce with the existing isolated Python environment and pinned official kernels:

```powershell
.\.venv\Scripts\python.exe -B scripts/ephemeris/generate.py
.\.venv\Scripts\python.exe -B scripts/ephemeris/validate_extended.py
node --test scripts/ephemeris/events-observer.test.mjs scripts/ephemeris/intervals.test.mjs scripts/ephemeris/science.test.mjs scripts/ephemeris/terrain.test.mjs
npm exec --yes --package typescript@5.9.3 -- tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions src/science/index.ts src/science/intervals.ts src/science/events.ts src/science/observer.ts src/science/terrain.ts
```

`validate_extended.py` uses seed `20261114`, samples 512 off-grid ETs from separate ephemeris segments, and compares interpolated vectors against fresh direct CSPICE `SPKPOS` calls for two bodies at six sites (6,144 direction and altitude comparisons). The actual results are in `scripts/ephemeris/validation-extended-results.json`. This checks the selected interpolation model; it does not prove a global error bound. UTC conversion remains through the pinned LSK, not a constant ET offset.

Recorded dataset SHA256: `02873a58203073d7633b584cb763ee1e7037230d69edfbccde34e9e2506de5cb`. The direct CSPICE check independently recomputes loaded kernel coverage and confirms it matches provenance. Its 6,144 comparison maxima were **3.59760e-6°** for topocentric direction and **3.59183e-6°** for altitude, below the 0.001° test target.

The source kernels and their SHA256 values are recorded in the dataset provenance and `scripts/ephemeris/kernels.lock.json`. The generator verifies hashes and actual loaded SPK/PCK coverage before writing data.

## Events and elevated observer

`src/science/events.ts` derives future rises/sets from `SiteAnalysis` intervals. Queries must lie within the inclusive analysis period. Only interval boundaries strictly inside the analysis period are physical events; a coverage edge is not called sunrise or sunset. `null` means no event was found in the available analysis. A joint interval reports whether it is ongoing and whether either end is clipped by analysis coverage. Event analysis should use full supported data when searching upcoming transitions, independently of a shorter visible comparison period.

`src/science/observer.ts` keeps the established `observeAt`/`analyzeSite` surface APIs unchanged. Its additional observer height is 0–10,000 m above the smooth reference sphere. `observeObserver` subtracts the elevated observer position in Moon-fixed Cartesian coordinates before calculating ENU. `analyzeObserver` shifts the scalar sign function by that radial height and retains the same piecewise-linear crossing solution. These analyses still use altitude `> 0` against the reference tangent plane. The visible smooth-sphere limb may dip below that plane by `acos(R/(R+h))`; the returned dip is a geometric horizon aid, not a terrain result.

## Real DEM patch and frame

The packaged `public/data/terrain-pgda90-southpolar.json` is a 101×101 window of **actual source pixel values** from [NASA GSFC PGDA Product 90](https://pgda.gsfc.nasa.gov/products/90), [LDEM_80S_80MPP_ADJ.TIF](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF). The COG is 189,158,392 bytes; preparation uses GDAL/rasterio `/vsicurl/` window reads with TLS verification and does not fetch the full file. The official page describes the large-area DEMs as cloud-optimized GeoTIFFs with south-polar stereographic X/Y in metres in Moon ME referenced to DE421, and identifies this product as surface height in metres. The TIFF independently reports a 7,600×7,600 Float32 raster, 80 m pixels, IAU CRS 30135, pixel-is-area registration, and NaN fill. This patch's source window is rows 3370–3470 and columns 3750–3850. Every one of its 10,201 cells is finite; no values were filled.

The observer pixel center is planetocentric latitude **−88.9988159813°**, east longitude **+0.0754884669°**, with source height **−388.6184 m** relative to the 1,737,400 m reference sphere. The negative value is retained. The product page lists companion count, effective-resolution and error rasters; this patch includes none of those quality layers. A finite source value does not establish direct measurement density or per-pixel uncertainty. The 80 m pixel size is not a terrain accuracy estimate.

The extracted float32 cell-value bytes hash to `665b4639b2b1479967634ac1bd2d69a21c16e861535cc83b97961eebe5f9a632`; the packaged JSON SHA256 is `dceac4465b00d8bc8a0cdd42662793540259b45aa0a76f53b322b559dd506db6`. The source window and all XYZ values were independently reproduced by reviewer t1q from the live COG with zero metre maximum difference.

The FK `moon_de440_250416.tf` documents a maximum angular orientation difference of `5.8204420784597e-7 rad` between `MOON_ME_DE421` and `MOON_ME_DE440_ME421` over 1900–2051, about **1.011 m** at the reference radius. The patch retains its source-frame coordinates and labels the target frame with this explicit bounded approximation. It applies no PA/ME rotation and does not claim exact frame identity. Source CRS WKT, affine transform, source row/column window, sampled-pixel SHA256, frame difference and retrieval time are embedded in JSON. Rasterio's PROJ transform converts cell centers to body-fixed XYZ at radius `R + sourceHeightM`.

Regenerate the patch (requires pinned `rasterio==1.5.2` in `.venv`):

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-terrain.txt
.\.venv\Scripts\python.exe -B scripts/ephemeris/prepare_terrain.py
node --test scripts/ephemeris/terrain.test.mjs
```

The generator refuses an unexpected CRS, pixel scale, band layout, or out-of-coverage window. The source data block hash is over the raw little-endian Float32 values for the exact extracted window, not a hash of the full remote TIFF. A fresh run records a new retrieval timestamp.

## Terrain APIs and limits

`src/science/terrain.ts` exports `TerrainPatch`, `TerrainVisibility`, `TerrainProfile`, `validateTerrainPatch`, `terrainVertices`, `sampleTerrain`, `terrainHorizonProfile`, `analyzeTerrainHorizon`, and `observeTerrain`. The renderer receives row-major Float64 body-fixed XYZ positions; no runtime map projection is needed. `NaN` triplets represent nodata. `sampleTerrain` accepts a site only within the nearest source pixel footprint. `observeTerrain` throws for an outside or nodata site and preserves the requested latitude/longitude. Its eye position uses the sampled DEM radius plus explicit observer height; topocentric body vectors and ENU are recomputed from that eye point.

Terrain rays intersect only the two triangles of each complete four-cell DEM quad. A quad with any nodata corner is skipped. The mesh uses curved radial XYZ vertices, so lunar curvature is included. At zero eye clearance, directions entering adjacent terrain facets are blocked at distance zero. The patch boundary has no wall. A mesh intersection reports `blocked`. A ray with no local intersection reports `insufficient`, because the 8 km patch cannot exclude a more distant ridge. This finite patch cannot certify `clear`; no absence of local terrain is treated as proof of clear sky. A/B event intervals remain separate smooth reference-tangent results. Terrain status applies to the body center ray and does not compute disk visibility fraction, shadows, power, eclipse, or radio links.

The horizon profile samples the greatest apparent elevation of valid pixel centers in azimuth bins measured from the actual terrain eye point (north 0°, east 90°); each sample exposes both `altDeg` and the same-valued `horizonAltDeg` for consumer compatibility. It is a sampled local skyline, not an exact continuous silhouette. The profile cache is keyed by the validated patch object, site, eye height and azimuth step. Ray intersection checks are uncached and traverse at most 10,000 grid quads (20,000 triangles) per body query. On the development machine, 25 repeated `observeTerrain` calls after warmup averaged **18.1 ms/call** for this 101×101 patch; this is a local measurement, not a cross-device performance guarantee. No terrain event interval analysis is performed.
