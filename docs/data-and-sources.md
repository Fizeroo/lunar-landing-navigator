# Data and sources

This mapping distinguishes astronomical inputs, reference comparisons, appearance and actual elevation data. Dataset files carry exact versions/hashes and generation details; new DEM provenance supplements this table after preparation.

| Source | Input and preparation | Application use | Limits / credit |
|---|---|---|---|
| [NASA/JPL NAIF kernels](https://naif.jpl.nasa.gov/naif/data.html), locked `de440s.bsp`, lunar DE440 binary PCK, matching frame kernel, constants PCK and leap-second kernel | Offline SpiceyPy/CSPICE, Moon-centred body-fixed Sun10/Earth399 vectors in metres, explicit UTC/ET samples and provenance | Current local directions, globe light, all interval/event/scenario calculations | Instantaneous geometry, no light-time correction/refraction/eclipse/power/link engineering; lunar orientation and libration effects are already included by the frame/ephemeris, no decorative extra wobble |
| [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Explicit-time geometric vector queries compared with SPICE and documented ephemeris/frame differences | Numerical control comparison, not runtime dependency | Related model families; not validation against independent observations |
| [NASA SVS CGI Moon Kit4720](https://svs.gsfc.nasa.gov/4720/) | Existing local LROC/LOLA colour texture | Globe appearance | Aesthetic map, polar fill; not topography, calculated crater shadows or a source of local lighting truth |
| [NASA PGDA LOLA90](https://pgda.gsfc.nasa.gov/products/90) | Cloud-optimized GeoTIFF, south-polar stereographic metres, DE421 Moon ME; actual subset metadata/provenance must be retained | One lightweight local terrain mesh and curvature-aware horizon profile | Native grid spacing differs from effective resolution; bounded/no-data coverage must not create a false clear horizon |
| [NASA PGDA LOLA81](https://pgda.gsfc.nasa.gov/products/81) and [78](https://pgda.gsfc.nasa.gov/products/78) | Alternative detailed south-pole products investigated;81 is a5m mosaic,78 fetch timed out | Source selection evidence, not a claim all products are used | Avoid multiGB downloads for one small patch; cite Barker et al.2021 where applicable |
| [IAU/USGS Gazetteer](https://planetarynames.wr.usgs.gov/) and linked mission pages | Published coordinates and classifications, linked per catalogue record | Preset sites and contextual descriptions | Feature centres are illustrative points, not approved landing targets. An area does not establish an exact landing coordinate |

LOLA reference height is relative to the1737400m sphere; the exact selected product metadata, pixel-centre convention, no-data handling, frame alignment, extraction/downsampling, real vertical scale and profile coverage must be documented with the terrain asset. Outside that coverage the app uses a clearly labeled smooth sphere. A local found blocker and a certified unobstructed horizon are different claims.

## Interpretation

Altitude measures the body centre's angle from the local reference plane. Azimuth is measured clockwise from north toward east; it is undefined at exact poles/zenith/nadir. A zero-height reference horizon differs from the visible smooth-sphere horizon at elevated height. A terrain horizon additionally depends on actual surrounding heights. Any retained reference-sphere A/B comparisons must say so when a terrain view is active. Above-horizon geometry is not electrical power, a guaranteed Earth link or a safe landing determination.
