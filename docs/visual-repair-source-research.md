# Official appearance/context sources checked for the visual repair

Checked 15 November 2026. These are source facts and preparation constraints, not a claim that every listed file ships in the final application. The final asset manifest must identify the chosen files, hashes, dimensions and transformations.

## Deep Star Maps 2020

[NASA SVS4851](https://svs.gsfc.nasa.gov/4851/) provides combined catalogue maps in celestial ICRF/J2000 and galactic coordinates, in plate carrée projection. The celestial map is centred at right ascension 0h, with right ascension increasing to the left. Its EXR data are half-float, linear colour. Actual combined maps include 4096×2048 (34.3 MB) and 8192×4096 (124.5 MB); the 1024×512 print JPEG is a preview and is excluded from full-screen use.

Use the combined map alone, without a second generated point layer. This preserves the catalogue brightness structure and avoids duplicate stars. Record tone mapping and colour-space conversion. Correct spherical wrapping does not by itself establish correct orientation relative to the Moon at a selected UTC. This repair permits an explicitly illustrative overall orientation and exposure, with no navigation use.

Requested credit: NASA/Goddard Space Flight Center Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC. Visualization: Ernie Wright. Constellation figure credits apply only if those separate overlays are actually used; no such overlays are planned.

## Blue Marble Next Generation

[NASA Earth Observatory base maps](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/) offer monthly global JPEG/GeoTIFF maps, including 5400×2700 and 21600×10800 versions. The source is a prepared seasonal composite, not the current UTC's weather. Cloud provenance must be separate if a cloud layer is used. A static map is permitted with explicit illustrative geographic attitude; illumination/phase must still use the existing actual Sun/Earth geometry. Credit NASA Earth Observatory / Blue Marble Next Generation and retain the selected file's own credits.

## Real lunar context

[NASA SVS4720](https://svs.gsfc.nasa.gov/4720/) supplies actual LOLA displacement maps: `ldem_4.tif` is 1440×720 float kilometres relative to a radius of 1737.4 km. The unsigned alternative uses a different offset/scale and must not be mistaken for metre heights. Its colour maps are appearance assets, not elevation. `[NASA PGDA90](https://pgda.gsfc.nasa.gov/products/90)` is the retained scientific DEM source and may also supply a separately sampled, coarser visual context. The reference frame, registration, null values and source units must be retained. Visual context never silently expands the scientific horizon's coverage.

## Usage boundaries

The [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) generally allow educational/informational use, require source acknowledgement and distinguish NASA material from identified third-party copyright. This does not grant blanket rights to everything hosted by NASA. Keep the item-specific credits and data provenance; imply no NASA endorsement. The final local repair does not publish or distribute a contest entry.
