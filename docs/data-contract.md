# Data contract 1.0 — first single-site slice

Extension: the authorized two-site comparison uses the same dataset/schema and scientific conventions. See [comparison-contract.md](comparison-contract.md) for the new interval API and `src/contracts.ts` for `SiteAnalysis`. The single-site scope statements below are historical and are superseded by that extension; terrain remains deferred.

Canonical TypeScript definitions: `src/contracts.ts`. These names are shared by UI, generator and scientific module.

## Frame, units and model

- Moon-centered, body-fixed `MOON_ME_DE440_ME421`; +X latitude0/longitude0, +Y longitude90E, +Z north. NAIF origin301, Sun10, Earth399.
- Planetocentric latitude degrees; east-positive longitude normalized to [-180,180). Radius1737400m; site heightAboveReferenceSphereM MUST be0 in this version.
- `abcorr=NONE`: instantaneous geometric positions, not apparent observations. SPICE km convert to metres exactly once.
- Float64/JS numbers for all science. GPU receives normalized rendering coordinates only.
- Local ENU is east/north/radial-up. Altitude=atan2(up,hypot(east,north)); azimuth=atan2(east,north), wrapped to[0,360).
- Azimuth null at exact geographic poles or horizontal-direction ratio<1e-12 (zenith/nadir).
- Horizon is the tangent plane at a point on the reference sphere. Terrain, heights, Earth/Sun occultations, refraction, power and radio-link performance are not calculated.
- Scene mapping is the proper rotation `(X,Y,Z)->(X,Z,-Y)`; reverse `(x,y,z)->(x,-z,y)`.

## Dataset

`/data/ephemeris-2026-11.json` contains coverage UTC/ET, exact model/provenance and samples. Each sample has `utc`, `et`, `sunM`, `earthM`. ET means TDB seconds past J2000, not Unix time. Samples initially600s apart in ET with explicit final endpoint. Sample endpoints must cover exact requested UTC endpoints.

Use official DE440s SPK, DE440 lunar binary PCK and matching FK, leap-second kernel and constants PCK. Provenance records file URL/name/SHA256/coverage and generator/CSPICE versions. Record actual checks and limitations; never silently replace missing data with a synthetic orbit.

## Shared science API (`src/science/index.ts`)

- `validateEphemeris(value: unknown): EphemerisData`
- `observeAt(data: EphemerisData, et: number, site: Site): Observation`
- `utcToEt(data: EphemerisData, utc: string): number`
- `etToUtc(data: EphemerisData, et: number): string`

`observeAt` linearly interpolates Cartesian positions, subtracts the site position, then normalizes and computes ENU. It returns moon-centered unit Sun/Earth directions for globe lighting/markers as well as topocentric Sun/Earth results. No wrapped-angle or boolean interpolation; no extrapolation. Reject invalid inputs/out-of-range instead of showing stale plausible values.

UTC strings explicitly end in Z. UI controls are UTC, not browser-local. Generated UTC/ET pairs define lookup and bounded interpolation; reject second60 and leap-crossing segments unless explicitly supported. State future leap-second assumptions. Validate interpolation error against direct SPICE; do not claim a proven error from the selected sample step alone.

Disk approximation: spherical-envelope radius is max(PCK radii), Sun695700000m and Earth6378136.6m. Angular radius=asin(radius/distance); centerAbove=(alt>0). Disk none if alt+radiusAngle<=0, full if alt-radiusAngle>=0, else partial. This is geometry against the reference plane, not visible-area fraction. The primary cards may show center altitude and the limitation without adding disk UI.

## Boundaries and deferred work

The scientific module must not import DOM/three.js. UI must not implement a second ENU/time/ephemeris calculation. Camera orbit only changes view, not lunar scientific coordinates. A/B comparison, event-duration analysis and terrain stay deferred. The full research contract is preserved in research-plan.md; this file defines the exact first-slice wire shape.

Direction clarification: BodyObservation.direction is the SITE-to-target unit vector expressed in MOON_ME_DE440_ME421, not an ENU tuple. Observation.sunDirectionBody/earthDirectionBody are MOON-CENTER-to-target unit vectors for globe lighting/markers. All IDs must appear in provenance (301,10,399).
