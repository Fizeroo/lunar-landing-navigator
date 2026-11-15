# One-minute immersive demo

1. **Time and region (0–10 s).** Open the app. The large scene is the starting point; Analysis is closed and there is no previous search result. The prepared example is **17 January 2027, 03:56:38 UTC**, within the actual ephemeris range. Choose another covered time or use **Now** explicitly; unsupported dates are refused.
2. **Find and select (10–20 s).** Press **Find a landing candidate**. The app evaluates 25 distinct grid points in the named PGDA90 central south-polar region at that displayed instant. Select **candidate 1** at approximately **88.9720° S, 4.0000° E**. It is the best **among these evaluated points under the stated reference-sphere lighting criteria**, not the best landing site on the Moon. Its local terrain visibility can still be unknown.
3. **Descend (20–30 s).** Press **Explore here**. The camera enters the real prepared terrain at about 1.7 m above the local facet, with its actual elevation and curvature. The model label says 80 m LOLA grid and incomplete distant horizon. Mountains and depressions come from the DEM, not procedural craters or a colour map.
4. **Look and walk (30–45 s).** Use **Look at Earth** and **Look at Sun**. Their directions use the same selected time and observer position as the numerical details. Enter mouse look, move with WASD, then press Escape. Return to point remains available. Walking stops before a coverage boundary; unknown terrain is never treated as safe ground.
5. **Time and terrain (45–60 s).** In the UTC field enter **2026-12-22T06:00:00Z**, press Enter, then **Look at Sun**. At this same candidate, the Sun centre is about **+2.2°** above the radial reference plane but **blocked by terrain**. Its label stays at the calculated direction behind the measured skyline. This example was checked against the real data and in the integrated browser. Play remains available; pause before returning with **Back to orbit**. Enhanced sky changes appearance only. Analysis contains mission windows, A/B comparisons and saved scenarios.

## Meaning of the result

Candidate ordering first favours both reference-horizon centres up, then Sun/Earth conditions, remaining current joint time and solar altitude, with stable ties. Terrain ray checks and80m triangle-scale slope are reported separately. No local ray hit means insufficient distant coverage, not certified clear sky. The app does not model rocks, soil bearing, vehicle geometry, trajectory, power or radio-link budgets and does not establish landing safety.

## Extent and sources

Prepared ephemeris: **1 October 2026 through1 February 2027 UTC**. Real DEM: retained101×101 source samples at80m spacing, approximately8km across, about973m elevation relief; continuous rendering is an approximation between measured samples. See [science and provenance](immersive-science-implementation.md) and [appearance credits](immersive-assets.md). More detailed terrain outside that patch is not promised.
