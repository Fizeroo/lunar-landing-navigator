# Scientific slice: reproducible validation

Executed 2026-11-14 in `worktrees/codex`, branch `feat/astro-timeline`. This record covers the owned offline generator, real data and pure TypeScript API. Browser/renderer acceptance belongs to integration and is not claimed here.

## Reproduce (PowerShell, repository root)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-science.txt
.\.venv\Scripts\python.exe scripts/ephemeris/generate.py
.\.venv\Scripts\python.exe -B scripts/ephemeris/validate.py --horizons
node --test scripts/ephemeris/science.test.mjs
npm exec --yes --package typescript@5.9.3 -- tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions src/science/index.ts
```

Tested runtime: Windows, Python **3.14.5**, SpiceyPy **8.0.2**, NumPy **2.5.4**, **CSPICE_N0067**, Node **24.16.0**, TypeScript **5.9.3**. Requirements pin the actual installed Python packages. Node 24 runs the TypeScript module through built-in type stripping; frontend dependencies are unnecessary for this science test command.

The generator downloads only the five official HTTPS kernels named in `scripts/ephemeris/kernels.lock.json`, verifies byte length and SHA256 on both fresh downloads and cached files, then loads CSPICE. TLS verification is enabled. Its default cache is `.venv/kernels/`, never browser assets. The lock records official URLs and download completion timestamps from the initial verified files. Do not substitute newer kernels without a reviewed lock/provenance change. A changed or truncated cache is rejected, not silently trusted.

`validate.py` uses two **serial**, cached Horizons requests, one per target with four explicitly TDB epochs. URLs, HTTP status, retrieval time and unedited API payload are retained in `scripts/ephemeris/reference/`. Subsequent runs reuse those responses. To validate against a later live response, archive the existing references outside the project and deliberately fetch again; never poll Horizons on slider movement. The request User-Agent supplies the project repository as contact. Raw response format is checked before parsing.

## Data actually generated

`public/data/ephemeris-2026-11.json` is genuine SPICE data, exactly the shared `EphemerisData` shape in `src/contracts.ts`:

- Coverage: **2026-11-01T00:00:00Z through 2026-12-01T00:00:00Z**, inclusive.
- ET endpoints: **846763269.1825113** and **849355269.183072**, seconds past J2000 TDB.
- **4,322** samples: uniform **600 ET seconds**, plus the explicit final endpoint. The final interval is approximately **0.000561 s** because this UTC month is not exactly an integer number of 600 TDB seconds. It is retained and tested rather than dropping the requested endpoint.
- Model: Moon center301, Sun10, Earth399, exact `MOON_ME_DE440_ME421`, `NONE`, Float64 metres; conversion from SPICE km occurs once.
- PCK-derived radii: Moon1,737,400 m; Sun695,700,000 m; Earth bounding sphere6,378,136.6 m. Constants come from the loaded kernel pool, not comment text.
- Five kernel payloads: **45,745,465 bytes** in total. Exact hashes are in the lock and the dataset provenance.
- Delivered final JSON: **843,416 bytes**, SHA256 **8a9240acec08c513de2f38e5c2959ad51a6ccc8673032e53b005d07c284c5ae6**. The final metadata-only revision adds explicit target IDs and generator version; sample arrays were compared with the initially integrated dataset and are identical. Regeneration updates the provenance timestamp, so a later artifact hash can differ while the physical samples remain unchanged.
- Actual loaded SPK coverage for IDs3,10,301,399: **[-4734072000, 4735368000] ET**. Actual lunar binary PCK class31008 coverage: **[-14200747200, 20514081600] ET**. The intersection is **[-4734072000, 4735368000] ET**; the generator checks the requested interval against it.

The manifest's provenance includes individual hashes/URLs/retrieval times, generator/Python/SpiceyPy/CSPICE versions, actual coverage, step, epoch/time assumptions and model limitations. Only the fixed demo interval is exposed to the frontend; broad kernel coverage does not imply arbitrary-date application support.

## Direct SPICE interpolation/time gate: passed

`validation-fixtures.json` and `validation-results.json` retain actual numbers. Deterministic seed20261114; every interval midpoint plus one seeded random point per interval: **8,642 off-grid epochs × 7 sites × 2 bodies = 120,988 topocentric direction comparisons**. Sites include equator near side, far side, -89.5°/0°, -85°/45°, -89°/-135°, +45°/179.999°, and exact north pole. Direct positions are fresh CSPICE evaluations, not the interpolated samples used as their own expected values.

| Quantity | Measured maximum | Gate |
| --- | ---: | ---: |
| Topocentric spherical angular separation | 0.000003489777409° | ≤0.001° |
| Altitude error | 0.000003476710120° | measured separately |
| Angular-radius error | 0.000000073527916° | measured separately |
| UTC-pair interpolation versus direct `str2et` | 0.000001072884 s | ≤0.001 s |

Worst direction case: Earth at ET848567169.1825113, equator lon0. These maxima describe the enumerated tests, **not a proof of a global mathematical error bound**. No azimuth-error claim is made near singularities. Direct CSPICE `AZLCPO(ELLIPSOID,NONE)` fixtures independently construct the local frame for six non-polar sites at four dates; pole altitude is checked with vector geometry and azimuth remains null.

## TypeScript API: passed

`src/science/index.ts` exports `validateEphemeris`, `observeAt`, `utcToEt`, `etToUtc`; it imports only shared types and has no DOM/three.js dependency. `BodyObservation.direction` is the topocentric unit vector **expressed in lunar ME axes**; `sunDirectionBody`/`earthDirectionBody` are Moon-centered unit vectors for rendering. ENU determines the returned azimuth/altitude. Every target vector is interpolated in Cartesian coordinates **before** subtracting the site position and normalizing.

Eight Node test groups passed, including actual coverage and final endpoint, runtime schema/model/finite validation, no extrapolation, height and longitude rejection, invalid Gregorian dates and timezone-less strings, exact poles/zenith/nadir, analytic north/east, parallax, longitude seam, disk states, leap-segment rejection and incomplete/incompatible provenance rejection. The original seven math groups passed in the host timezone and again with `TZ=America/Los_Angeles`; the added metadata test then passed with the final artifact. Runtime validation checks IDs10/399, the five official pinned kernel records and their SHA256 syntax/bytes/retrieval times, generator/runtime versions, generated UTC, loaded coverage intersection and declared time/shape/limitation metadata. It does not re-download kernels or cryptographically authenticate a remotely modified JSON file. Direct CSPICE reference comparisons covered28 site/date observations (56 body observations): maximum TS/direct direction error **0.000002149248936°**, altitude **0.000002149246257°**, azimuth **0.000002913841627°** across the nonsingular fixture cases. These include interpolation error, not only ENU roundoff. Strict standalone TypeScript check passed with `noUncheckedIndexedAccess`; `pip check` reported no broken requirements.

UTC parser requires full ISO UTC with trailing `Z`, rejects second60 and invalid normalized calendar dates, and retains sample microsecond tags. UI UTC output is rounded to milliseconds between samples; UTC→ET→UTC lookup is bounded and approximates the very small varying TDB−UTC contribution. The selected month has no known leap boundary. Crossing a known pinned leap boundary or a sample segment whose ET/UTC durations differ by over0.5 s is rejected explicitly. Future UTC assumes no additional unannounced leap seconds after the pinned LSK; regeneration is required when the time assumptions change.

## Actual Horizons comparison: passed

Two real GETs, Sun10 and Earth399 relative to Moon301, each returned four rows for November1 00:00UTC, November14 00:00UTC, November30 12:34:56UTC and December1 00:00UTC. Input epochs were explicitly converted by SPICE to **JDTDB**, sent in `TLIST` with `TIME_TYPE=TDB`, `TLIST_TYPE=JD`, `REF_SYSTEM=ICRF`, `REF_PLANE=FRAME`, `OUT_UNITS=KM-S`, `VEC_TABLE=1`, `VEC_CORR=NONE`. Returned geometric ICRF vectors were compared to direct SPICE `J2000` vectors at the returned JDTDB epochs. This avoids comparing ICRF against ME or silently mixing UTC and TDB. Saved full requests/responses are the reproducible evidence.

The live API reported **version1.2**, despite the documentation page listing1.3. The first validation deliberately stopped on that mismatch. The saved1.2 JSON signature and CSV/result format were inspected and explicitly accepted; future unreviewed versions still fail. The final parser additionally requires the intended target ID, Moon301 body center, DE441 source headers, ICRF, KM-S, GEOMETRIC output and JDTDB/TDB table, with both SOE/EOE markers. Both live headers identify **DE441**, while the offline pipeline uses pinned **DE440**. Printed nine-decimal JDTDB introduces epoch quantization of up to approximately43µs; the comparison includes that effect and is not a pure ephemeris-solution difference estimate.

| Quantity, eight returned body/epoch pairs | Maximum observed |
| --- | ---: |
| ICRF position-vector difference | **2.403660418 m** |
| ICRF direction angular separation | **0.000000369163746°** |
| Topocentric angular separation after the same pinned ME rotation, seven sites | **0.000000370894771°** |

All are below the proposed external direction gate0.01°. No apparent Horizons OBSERVER az/alt was used as an exact expected value for the geometric NONE implementation. Horizons and SPICE share JPL planetary solutions: this is an independent service/implementation cross-check, not independent observational evidence. Local ENU is separately checked against direct CSPICE AZLCPO as described above.

Independent reviewer **t1q** separately reported: five kernel hashes and loaded coverage agree; five dataset nodes reproduce direct SPICE with zero metre residual; 400 random epochs ×8 sites ×2 bodies yielded maximum direction error3.48065e-6°, and actual TypeScript outputs at180 random epochs ×8 sites ×2 bodies yielded3.42120e-6°. Their independently requested Horizons Nov1/16/Dec1 values agreed at metre scale. They also verified all4,322 UTC sample mappings, endpoint handling, invalid inputs and ENU fixture residual ≤1.54e-10°. These are attributed reviewer results, additional to this developer's reproducible test runs above.

## Scope and limitations

This is **geometric**, not apparent, observer geometry on a smooth sphere, **h=0**. Azimuth is null at exact poles and horizontal-direction ratio<1e-12. Horizon and disk classifications refer to the local tangent plane; the Earth disk is a spherical envelope, not its oriented oblate limb. No terrain, slope, shadow, occultation/eclipse screening, atmospheric refraction, sunlight fraction, electrical power or radio-link computation is present. Positive solar altitude can coexist with an eclipse. No event timing/duration or A/B feature was added.

Official references: [kernel archive](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/), [exact lunar FK](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf), [SPICE positions](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkpos_c.html), [SPICE AZLCPO](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/azlcpo_c.html), [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [Horizons fair use](https://ssd-api.jpl.nasa.gov/doc/), [NAIF redistribution terms](https://naif.jpl.nasa.gov/naif/rules.html).
