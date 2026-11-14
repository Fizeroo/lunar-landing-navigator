# Lunar Landing Navigator

A local, English-language tool to compare lunar sites and dates. Explore a 3D Moon, inspect Sun/Earth directions from the surface, jump to upcoming reference-horizon events, and compare locally saved scenarios over equal durations.

## Run

Verified with Node.js 24:

```powershell
npm ci
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open **http://127.0.0.1:4173/**. No public deployment is needed. For development use `npm run dev`.

## Prepared data and models

- Real pinned NASA/JPL SPICE ephemeris: **2026-10-01 00:00 UTC through 2027-02-01 00:00 UTC**, 17,714 Cartesian samples. The original November-only data are retained for regressions.
- All A/B, scenario intervals and upcoming events use the smooth **reference tangent plane**, with a scientific observer height from 0 to 10,000 m. The visible limb of an elevated smooth sphere lies below that plane; the UI distinguishes them.
- One genuine LOLA PGDA90 terrain subset: 101x101 source pixels at 80 m spacing, about 8 km across. Use **Explore real LOLA terrain** in Surface view to reach the vetted point. Its negative reference-sphere ground elevation is retained. Curved geometry and center-ray intersection use the same mesh vertices and triangles. No fake edge walls or decorative terrain shadows.
- A hit in the local mesh means locally blocked. No hit means **Terrain coverage insufficient**: distant relief is unknown. This small DEM does not certify a completely clear horizon. A/B remains explicitly separate from terrain diagnostics.

Dates are UTC. Event times/durations are approximate, based on 600-second sampling; no API is called per slider movement. No eclipse/refraction/power/radio-link or landing-safety prediction. Body discs are illustrative and terrain visibility tests the centre ray, not an accurately computed visible fraction. The surface camera has a separate 2 m minimum clearance; scientific height may be zero. Terrain grid spacing is not a precision claim or a model of individual rocks.

## Quick tour

Choose A/B or use the catalogue. Set a period and compare timeline bars and totals. Try **Next Earthrise**, **Space view**, **Explore surface**, **Look at Sun**, then the real LOLA terrain point and its height slider. In **Scenarios**, compare A now / A +3 days / B now; edit dates/durations, save locally, export JSON or create a fragment link. Exported links work on a host serving this same app/data; localhost links require that local server.

## Documentation

- [One-minute demo and submission pitch](docs/exploration-demo.md)
- [Data and sources](docs/data-and-sources.md)
- [Scientific extension validation](docs/science-exploration.md)
- [Shared extension contract](docs/exploration-contract.md)
- [AI assistance](docs/ai-use.md), [licensing preparation](docs/licensing.md), [third-party inventory](docs/third-party-materials.json)
- [Submission evidence and remaining actions](docs/submission-readiness.md)
- Earlier A/B acceptance is historical: [comparison-browser-acceptance.md](docs/comparison-browser-acceptance.md).

The complete 2026 challenge page/Resources was unavailable during preparation. Verified official sources and remaining competition questions are recorded separately. This project is not endorsed by NASA. No publication, push or competition submission was performed.
