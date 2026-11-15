# Immersive science demonstration result

## Reproducible prepared-region instant

This point is the deterministic `pgda90-central-south-polar-r04-c05` grid candidate from `preparedCandidateRegion(patch)` with `gridSide: 5` and a 160 m minimum coverage margin. The reported Sun and Earth altitudes are measured from the **local radial reference tangent plane** at the DEM observer position. They are not measured from the sloping terrain facet normal. At this exact prepared-data instant, both body centers are above that radial tangent plane. Neither body ray intersects a triangle within the packaged DEM patch. The correct terrain status is therefore **insufficient** for each body: no local mesh obstruction was found, while terrain beyond the finite patch remains unknown. This is not a terrain-certified clear view.

| Field | Measured value |
| --- | --- |
| UTC | `2027-01-17T03:56:37.557Z` |
| ET / TDB seconds | `853430266.7415452` |
| Candidate | `pgda90-central-south-polar-r04-c05` |
| Candidate site (planetocentric latitude, east longitude) | `-88.98599999984775°`, `+3.999999996207066°` |
| Observer clearance | `1.7 m` above the local DEM facet |
| Continuous DEM ground height | `-460.97096992167644 m` relative to the 1,737,400 m reference sphere |
| Facet slope estimate | `0.4202961036°` at the 80 m grid / triangle scale |
| Coverage margin | `1895.0805185 m` |
| Sun center altitude (terrain observation; local radial reference tangent plane) | `+1.1559474960029354°` |
| Sun local terrain status | `insufficient`, no local mesh intersection; terrain beyond patch unknown |
| Earth center altitude (terrain observation; local radial reference tangent plane) | `+7.439855772277657°` |
| Earth local terrain status | `insufficient`, no local mesh intersection; terrain beyond patch unknown |
| Reference-sphere Sun / Earth center altitude | `+1.1559473166980152°` / `+7.439785826773047°` |
| Current joint reference-sphere availability | `603763.9432053566 s` |

The returned observation is body-fixed and topocentric from the exact continuous DEM ground point plus1.7 m radial eye clearance. The candidate's reference-sphere lighting ranking remains a separate output and is not used as the local terrain visibility result. Body visibility says nothing about route safety, landing safety, power, Earth communications, or terrain outside the DEM.

## Reproduction

Run from the repository root with Node24 and the checked-in datasets. The following read-only script locates the stable candidate ID, evaluates the exact ET, and prints the terrain observer values:

```powershell
@'
import { readFileSync } from 'node:fs';
import { validateEphemeris, etToUtc } from './src/science/index.ts';
import { validateTerrainPatch } from './src/science/terrain.ts';
import { preparedCandidateRegion, searchCandidatesAsync } from './src/science/candidates.ts';
const data = validateEphemeris(JSON.parse(readFileSync('public/data/ephemeris-2026-10_2027-02.json', 'utf8')));
const patch = validateTerrainPatch(JSON.parse(readFileSync('public/data/terrain-pgda90-southpolar.json', 'utf8')));
const et = 853430266.7415452;
const results = await searchCandidatesAsync(data, patch, {
  region: preparedCandidateRegion(patch), gridSide: 5, minimumCoverageMarginM: 160,
  observerHeightM: 1.7, currentEt: et,
}, { requestId: 1, batchSize: 5 });
const candidate = results.find(r => r.id === 'pgda90-central-south-polar-r04-c05');
console.log(JSON.stringify({ utc: etToUtc(data, et), candidateId: candidate.id, site: candidate.site,
  groundHeightM: candidate.groundHeightM, slopeDeg: candidate.slopeDeg,
  coverageMarginM: candidate.coverageMarginM, reference: candidate.reference,
  terrainObservation: candidate.terrain.observation,
  sunTerrain: candidate.terrain.sun, earthTerrain: candidate.terrain.earth,
  remainingJointSeconds: candidate.lighting.current.availableSeconds }, null, 2));
'@ | node --input-type=module -
```

The reported values were produced by Node24 using `searchCandidatesAsync` from `src/science/candidates.ts`, validated ephemeris `public/data/ephemeris-2026-10_2027-02.json`, and validated DEM `public/data/terrain-pgda90-southpolar.json`. The search uses the published January ET as its required `currentEt`, then reads the terrain observation already attached to that candidate result. This preserves the candidate's original projected grid query; calling the observer again with the returned radial `candidate.site` introduces a tiny reprojection drift and is not the source of the published values. The exact UTC string above comes from the science module's ET-to-UTC conversion; ET is the reproducible computational input. Terrain altitude uses the local radial basis in `observeTerrainInstant`, while facet-normal slope is reported separately and is not the altitude reference.
