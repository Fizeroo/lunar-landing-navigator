# Immersive view: appearance assets and scientific limits

## Earth appearance

- Local file: `public/assets/earth_bluemarble_clouds_2k.jpg`, 2048 by 1024 pixels, 519,577 bytes.
- SHA256: `80c08eb0ae0d2f5daba9fdbeb51fa1123009b9d2141d961ec43873cde1ff9646`.
- Download: [NASA SVS flat_earth03.jpg](https://svs.gsfc.nasa.gov/vis/a000000/a003600/a003615/flat_earth03.jpg).
- Source and credit: [NASA SVS item 3615, Equirectangular Projected Earth for LARGEST](https://svs.gsfc.nasa.gov/3615/). NASA/Goddard Space Flight Center Scientific Visualization Studio; Blue Marble Next Generation data courtesy of Reto Stockli (NASA/GSFC) and NASA's Earth Observatory. Visualization by Greg Shirah.
- Use: recognizable Earth colour/cloud texture wrapped onto the displayed Earth. The source is an art-directed production composite, not a weather map for the selected 2026 date. The source page explicitly describes its colours and clouds as production-directed.
- Conditions: use for this educational/informational simulation under the [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/), retain the requested source credit, and imply no NASA endorsement. This document does not assert that every image on NASA websites is unrestricted.
- Scientific boundary: SPICE supplies Earth's direction and apparent angular size. A recognizable texture does not establish accurate Earth attitude, visible geographic hemisphere, current clouds or photometric exposure unless separately implemented and tested.

## Lunar surface

The existing local LROC appearance texture remains an appearance map. The real local geometry comes from the retained PGDA90 LOLA subset, not from colour-image craters. Its 80 m grid cannot describe individual rocks or ground texture at the scale of a person. Actual elevation scale is retained. Terrain beyond the patch/no-data boundary remains unknown.

## Stars and Milky Way

The agreed initial implementation uses a deterministic artistic starfield and Milky Way drawn in application code, rather than an imported photograph or a stellar catalogue. It is not a navigation reference and does not claim scientifically correct inertial sky orientation. Enhanced sky changes only visual exposure. It does not alter Sun/Earth directions, obstruction tests, intervals or candidate ranking. Bright stars and the Milky Way under any selected lighting are a visualization aid, not a calibrated prediction of human vision.

Runtime source and final browser acceptance must confirm these boundaries and record any deviation from this asset plan before release.
