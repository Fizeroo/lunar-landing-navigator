# Visual repair asset manifest

Prepared for the local visual repair on 15 November 2026. These appearance assets do not change ephemerides, visibility intervals or candidate assessments.

| Packaged asset | Source and actual dimensions | Preparation | Packaged SHA-256 |
| --- | --- | --- | --- |
| `public/assets/starmap_2020_4k.jpg` | [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/), combined celestial `starmap_2020_4k.exr`, 4096 × 2048, 35,997,085 bytes | ZIP half-float RGB OpenEXR decoded offline; linear values encoded as sRGB, JPEG quality 88, no generated star layer. `scripts/assets/convert_starmap.py`. The 1024 × 512 print preview is not used. | `9bf63ab9a3512813e2ce36af63938fd9a35c71ab42935cb7c5eb0523b6f47684` |
| `public/assets/earth_bmng_200401_4k.jpg` | [NASA Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/), `world.topo.bathy.200401.3x5400x2700.jpg`, 5400 × 2700, 2,571,926 bytes | Lanczos resize to 4096 × 2048; JPEG quality 90. `scripts/assets/convert_earth.py`. January 2004 composite, no added clouds. | `f4d593802e3f547adbdd74718401b86c93ae220e2a49722d7dec9e94939cba5f` |

Original source hashes: star EXR `69b841cd048c2ef35543eb1c5819b322530e78aa4b0cab97ec1de3ef56a4ddcd`; Blue Marble JPEG `1684c4f8f51970dcb4a7451302bf3be17bed657aed9fece6f80d7b191e8afa3d`.

The star map is celestial plate carrée, RA 0h at the image centre, RA increasing to the left. It wraps around a camera-centred sphere with a fixed world rotation: turning the camera changes the view; translating it produces no sky parallax. Only the combined map is drawn, avoiding duplicate stars. Natural hides the stars beside bright ground; Enhanced raises their exposure. This is an illustrative exposure choice, not a simulation of human vision. The sky's overall Moon-fixed attitude is illustrative and is not a navigation reference at the selected UTC.

Blue Marble is north-up, left edge 180° W. Conversion checks Sahara, Pacific, Greenland and Amazon pixels. Earth direction, phase and angular size use the prepared SPICE vectors; geographic attitude is illustrative. Continents are not an Earth-rotation solution and the composite is not current weather. Brightness and the thin atmosphere are visual approximations. No solar observatory image is used: the Sun is a generated white-warm limb-darkened disc, with its size and direction supplied by the scientific calculation.

Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio, Ernie Wright; Gaia DR2: ESA/Gaia/DPAC. Blue Marble: NASA Earth Observatory, Reto Stöckli, NASA Goddard Space Flight Center. See [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/); retain item-specific third-party attribution. No NASA endorsement is implied.

The real terrain surroundings have a separate [data provenance record](visual-context-data.md). The 80 m scientific DEM remains unchanged. The 800 m regional and global LOLA drawing layers do not certify distant horizon clearance.
