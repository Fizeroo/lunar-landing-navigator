# Lunar Landing Navigator

An English-language lunar explorer for comparing geometric Sun and Earth conditions at lunar sites and dates. The main scene stays a whole Moon during candidate search, then takes you down to measured south-polar terrain at eye level. Detailed planning is in **Analysis**; provenance and limitations are in **Data & accuracy**.

## Run locally

Use Node.js 24 and npm:

```powershell
npm ci
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open **http://127.0.0.1:4173/**. For development use `npm run dev`. The delivered preview is local; no website deployment or competition submission is included.

## Main workflow

1. Choose a UTC time within the prepared data, or use the checked startup example: **24 November 2026, 04:00 UTC** on the illustrative Prepared ridge.
2. **Find a landing candidate** evaluates 25 distinct points in the named south-polar search region. Select one of at most three numbered options. Repeating search preserves the selected point when it remains listed.
3. **Explore here** makes a continuous, reversible descent. Eyes default to **1.7 m above the measured ground**. Drag to look; optional mouse look uses Escape to release. WASD stays inside supported terrain.
4. **Look at Sun/Earth**, change UTC or play time, then **Back to orbit**. Escape can reverse a descent.

Analysis retains A/B comparison, shared-period timelines, rise/set and joint-window events, mission-window search and fixed-start What-if comparisons, a sourced site catalogue, and locally saved/exportable scenarios. These planning intervals use the explicitly identified reference model; terrain search is not silently substituted.

## Data and scientific limits

- **NASA/JPL SPICE:** pinned, prepared Sun/Earth vectors and lunar orientation, **1 October 2026 to 1 February 2027 UTC**, 17,714 samples at up to 600-second spacing. No external API call per slider movement; no extrapolation outside coverage. JPL Horizons is a related-model control comparison, not independent observations.
- **Scientific terrain:** one real NASA LRO LOLA PGDA90 subset, **101 ? 101 vertices, 80 m grid, 8 km sample-centre span**. Ground sampling and local centre-ray obstruction use the same triangles. Walking stops at a 160 m coverage margin. It resolves neither rocks nor surface bearing strength.
- **Visual surroundings:** the detailed mesh is stitched to an **80 km, 800 m** LOLA context and a global LOLA drawing layer. They prevent a floating tile or fake cliff. They may obscure bodies in the picture, but do **not** extend scientific horizon coverage or certify clear terrain.
- **Imagery:** NASA SVS Moon colour map; NASA SVS Deep Star Maps 2020 and NASA Blue Marble Next Generation, both packaged at **4096 ? 2048**. No generated star layer is added. Earth geographic attitude and the sky's overall orientation are illustrative. The Earth map is a January 2004 composite without live clouds; Enhanced sky is an exposure choice, not a simulation of human vision.
- Sun/Earth directions and Surface angular sizes follow the prepared ephemerides. Body-centre tests do not calculate visible disc fractions, eclipses, refraction, electrical output, radio-link performance or landing safety. Event times and durations are approximate.

A measured local blocker is a failure. A ray leaving the finite scientific DEM without a hit is **terrain unknown**, never confirmed success. Candidate options can therefore remain provisional even when their reference-sphere geometry is favourable. No point is advertised as the safest or unconditionally best landing site.

## Known issues

- The scientific terrain covers only the prepared region. Coarser surroundings are picture-only; distant obstacles remain unverified.
- The 80 m mesh and grazing-angle shadow map can show faceting/aliasing. Fine grain is colour only, not additional relief. Overview polar imagery is limited by its original resolution/fill.
- Natural/Enhanced sky and Earth brightness are illustrative. Earth's continental orientation is not computed for the selected UTC.
- Recording video and running multiple browser tests can markedly reduce cadence. A separate Intel Arc surface check without recording measured about 98 animation frames/s; this is not a guarantee on other hardware.
- Existing mission-window, A/B and saved-scenario analyses use the reference tangent horizon, separately from finite-terrain diagnostics.

See [final verification and the eight legacy-test discrepancies](docs/final-verification.md) for exact acceptance evidence and any unresolved checks.

## Sources and documentation

- [Data and sources](docs/data-and-sources.md), [appearance asset provenance and credits](docs/visual-repair-assets.md), [visual terrain preparation](docs/visual-context-data.md)
- [Candidate interpretation](docs/candidate-assessment.md), [terrain/science contract](docs/immersive-science-contract.md), [exact coverage and search bounds](docs/immersive-data-scope.md)
- [Mission-window contract](docs/mission-window-contract.md), [mission science](docs/mission-planning-science.md)
- [AI assistance](docs/ai-use.md), [licensing preparation](docs/licensing.md), [third-party materials](docs/third-party-materials.json)
- [Submission preparation and remaining entrant actions](docs/submission-readiness.md)

Screenshots and the real 29-second Orbit-to-Surface recording are in local `artifacts/visual-repair-final/`; they are intentionally excluded from Git along with browser profiles, caches, kernels and build outputs. See [final verification](docs/final-verification.md) for filenames. Rebuild from the committed source to reproduce the app.

The complete official 2026 challenge Resources and authenticated submission form could not be verified during preparation. Recheck them before entering. This project is not endorsed by NASA. Publishing the website and submitting an entry remain separate entrant actions.
