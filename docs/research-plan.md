# Lunar Landing Navigator — shared contract v2 and implementation gates
Date: 2026-11-14. Accepted research baseline, now preserved in the repository. See implementation-plan.md for the authorized first vertical slice.
The user has authorized implementation of ONE selected site, UTC slider, SPICE-driven lighting and angles. A/B comparison, terrain and extra features remain deferred. Preserve the existing branches/worktrees; no publication. Historical research observations below describe what was checked at planning time.

## Verified repository and team
Only README.md, commit 154e54e, no application or chosen dependencies and no project/ancestor AGENTS.md or CLAUDE.md found.
Architect t1n: main-repo / main. Claude t1c: worktrees/claude / feat/3d-moon-scene. Developer t1p: worktrees/codex / feat/astro-timeline. Reviewer t1q: main-repo / main.
All four retain their exact sessions; full-access hc checks successful. Full access does not authorize implementation.
Available local runtime: Node 24.16.0, npm 11.13.0, Python 3.14.5. SpiceyPy is not installed. Dependency/wheel compatibility is a future stage-0 gate, not a completed test.

## Challenge evidence boundary
The official exact URL https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/ is indexed with its introductory objective: intuitive comparison of landing sites/dates and Sun/Earth positions relative to the horizon, for mission planners, educators, public; power potential and DTE opportunity.
Full page fetch fails HTTP502; local web tools also encounter TLS certificate trust errors. TLS checks were not disabled. Full Details/Resources/rubric/submission requirements remain unknown. Never infer requirements from other teams' applications. 3D/slider/stack/precision/terrain are our design decisions, not verified mandatory challenge rules.
Re-fetch full challenge before declaring competition compliance; this is a compliance gate, not a reason to invent requirements.

## One chosen architecture
Vite + TypeScript strict + direct three.js / OrbitControls; simple DOM panels and SVG timelines/sky plots. No React, Cesium, database, authentication, deployed backend, SPICE WASM, or live API in the MVP.
Python + SpiceyPy/CSPICE offline data generator (separate from frontend) -> pinned immutable monthly JSON chunks and manifest -> browser scientific TypeScript WebWorker -> UI + 3D.
SPICE is the production ephemeris source. JPL Horizons is a separately executed authoritative cross-check, not a per-slider dependency. Both rely on JPL planetary solutions; do not call them independent observations.
Core frontend functions have no DOM/three.js dependency. Renderer owns no astronomy.

## Scientific data and provenance
Download unmodified kernels directly from official NAIF generic_kernels HTTPS directories:
- spk/planets/de440s.bsp (~31MB; official summary coverage 1849-12-26..2150-01-22 ET)
- pck/moon_pa_de440_200625.bpc (~12MB)
- fk/satellites/moon_de440_250416.tf (~19KB)
- lsk/naif0012.tls (~5KB, last leap entry 2017-01-01)
- pck/pck00011.tpc (~128KB, constants including body radii)
Record URLs, exact bytes/SHA256, retrieval time, generator/CSPICE versions, and actual loaded coverage intersection. Do not silently substitute newer kernels/frames. Initial exact model:
originNaifId=301 (Moon center); target IDs Sun10 and Earth399 (not EMB3).
bodyFixedFrame='MOON_ME_DE440_ME421'; positionUnits='m'; geometric correction='NONE'; frame epoch equals sample ET.
Use exact frame name, not the mutable MOON_ME alias. MOON_PA and IAU_MOON are not interchangeable with this frame.
spkpos returns km; convert to metres exactly once at boundary. All numerical values remain Float64/JS number until rendering.
SPK/BPC payloads have not yet been fully installed or used to execute a SPICE pipeline in this research. Their documentation/listings and small resource retrieval were checked. Future stage1 must prove full reproducible download and coverage.

## Contract objects and module boundary
schemaVersion='1.0' (v2 refers to this planning revision, not a released schema).
Site = id, label, coordinateFrame, latDeg planetocentric [-90,+90], lonDeg east-positive normalized [-180,+180), heightAboveReferenceSphereM.
referenceSphereRadiusM=1737400; heightAboveReferenceSphereM MUST equal zero for MVP; reject other values explicitly. Do not substitute real site altitude or mast height. Chosen coordinates represent nominal points on a reference sphere.
EphemerisManifest = ephemerisId + schemaVersion + exactFrame + origin/targets + units + correction + referenceRadius + coverage + kernel provenance + time assumptions + bodyShapeModel.
EphemerisChunk = ephemerisId + start/end + rows of UTC string Z and etSecondsPastJ2000Tdb, sunPositionM[3], earthPositionM[3].
All vector origins are the Moon center. Generate uniform ET steps initially600s; UTC tags come from SPICE. Chunk boundaries share identical endpoint and guard samples sufficient for interpolation; never extrapolate at file edges. Backend/generator is independent of any selected site.
ObservationRequest = requestId, ephemerisId, site snapshot, start/end ET, sampling/interpolation config.
ObservationResult = same identity/snapshot + local direction and az/alt for both bodies + angularRadiusDeg + centerAboveReferenceHorizon + diskState + sampled event brackets + model flags/limitations.
Changing site or ephemeris invalidates cache/results; UI ignores stale worker responses by requestId.
Derived series cached by schema/ephemeris/site/model/interval/step; source chunks cached by immutable URL/hash. No database needed. Use normal HTTP cache plus in-memory cache; no service worker required for MVP.

## Coordinates and mathematical rules
ME axes: Z north, X at lat0/lon0, Y at lat0/lon90E; right-handed.
Let u=(cos(phi)cos(lambda),cos(phi)sin(lambda),sin(phi)); site=R*u.
For each target d=targetMoonCenteredM-siteM BEFORE normalization; Earth parallax must not be omitted.
East=(-sin(lambda),cos(lambda),0).
North=(-sin(phi)cos(lambda),-sin(phi)sin(lambda),cos(phi)).
Up=u.
E=d dot East, N=d dot North, U=d dot Up.
altDeg=atan2(U,hypot(E,N)); azDeg=atan2(E,N) normalized [0,360).
az=null with azimuthDefined=false at exact poles or when hypot(E,N)/norm(d)<1e-12 (zenith or nadir); no fabricated zero. The threshold is a numerical singularity rule, not a physical accuracy claim.
No terrain, horizon dip, slope, atmosphere/refraction, or occultation is calculated in this MVP. Local reference tangent plane and smooth-sphere horizon coincide only because height is locked to zero.
geometryMode='geometric'; horizonModel='reference-tangent-h0'; terrainApplied=false; occultationsApplied=false; refractionApplied=false.
NONE is intentional. Subtracting a surface site from a Moon-center LT+S vector is not an exact observer-apparent calculation and MUST NOT be used for an apparent claim.

## Body disks
bodyShapeModel='spherical-envelope'; radiusM=max(PCK semi-axes)*1000.
Sun radius=695700000m; Earth radius=6378136.6m. Earth is a bounding sphere approximation, not its real oriented ellipsoid.
alpha=asin(radiusM/norm(d)); require finite values and distance>radius.
centerAboveReferenceHorizon=(alt>0).
diskState='none' if alt+alpha<=0; 'full' if alt-alpha>=0; otherwise 'partial'. State measures only the approximating spherical disk against the reference plane, not visible-area fraction.
No Earth occultation screening of the Sun yet; a positive solar altitude/disk state can occur during eclipse. UI and timeline must label this limitation. No claim of power output, terrain sunlight, station visibility, radio link, safe landing, or permanent illumination/shadow.
MVP timeline primary rows use CENTER flags. Disk states appear in current sky cards; any additional disk-event rows must solve alt+alpha and alt-alpha separately.

## Time, slider, range and approximation
UI accepts explicit UTC fields/ISO Z; never interprets input as the browser local timezone.
Generator uses loaded LSK + str2et/et2utc. ET means TDB seconds past J2000, not Unix milliseconds and not UTC plus a fixed69.184s.
Slider internal coordinate = sample index + fraction, mapping directly to ET sample endpoints. Cartesian position linear interpolation, then site subtraction, then normalized direction and ENU.
Arbitrary UTC input uses lookup of generated UTC/ET pairs and interpolation only inside a segment that has no leap second. This UTC-to-ET interpolation is explicitly approximate; stage1 measures its timing error against str2et. Reject input second60 and segments crossing leap boundaries in MVP, with explanatory message; do not silently shift a leap second.
Known leaps come from pinned LSK. Future UTC dates carry the assumption of no additional unannounced leap seconds; regenerate when LSK changes.
Proposed first demo dataset: exact UTC interval 2026-11-01T00:00:00Z through 2026-12-01T00:00:00Z, not an unspecified 'lunar month'. This is a replaceable project default, not a NASA requirement or claim about Artemis launch dates. Wider future coverage uses the same monthly chunks and records forecast UTC assumptions.
No extrapolation outside manifest coverage; date controls show supported interval.
Target interpolation error <=0.001deg is ANGULAR SEPARATION of topocentric unit directions vs direct SPICE at midpoint/random off-grid times and chunk boundaries, not maximum azimuth error. Also measure altitude and angular radius separately. Target is not achieved yet; refine600s sampling if it fails.
Timeline intervals/events are numerical estimates. Refine near horizon crossings and midpoint minima/maxima; same-sign endpoints may hide two crossings or tangency. Report brackets/resolution and convergence tests, not exact event seconds or guaranteed completeness. Durations integrate time intervals, not count flags. No unavailable interval becomes below-horizon by default.

## Scene and UX
Fixed Moon scene, user rotates camera; time never arbitrarily rotates the lamp.
Apply one proper rotation to every relevant position/direction: scene(x,y,z)=(ME.X,ME.Z,-ME.Y); normalize scale so lunar radius is1. Inverse is ME=(scene.x,-scene.z,scene.y).
Numerical module stays Float64; GPU receives normalized units/directions only. Sun light follows the same ephemeris direction. Globe lighting approximates a distant source and is illustrative; sky cards use topocentric d. Earth marker uses a labeled illustrative distance.
Source SVS CGI Moon Kit 2025 2k JPG, center lon0, SRGB; optional 4k TIFF converted locally later, no huge TIFF runtime. Textures are for appearance; polar source is partly filled from laser albedo, not a scientific image or DEM.
Map/raycast roundtrip uses inverse scene transform and atan2/asin, not texture UV. Handle seam, pole, sky clicks and drag-versus-click. Labels and coordinate entry remain usable on dark side; any visibility-assist rendering must not modify numerical claims.
Main screen: globe+south-pole reset, A/B coordinate cards and sky plots, common UTC interval/slider/playback, four primary center-horizon rows Sun/Earth x A/B, percent/longest contiguous sampled interval and overlap as explicitly modeled summaries; model/source/error panel always reachable and core limitations visible.
Do not rank real polar landing safety/actual energy using a no-terrain model.

## Implementation responsibilities (future authorization only)
Architect t1n owns contract and integration plan, future shared configuration boundaries.
Claude t1c owns src/scene and src/ui: globe, texture, picking, cards, timeline rendering/playback, visual checks.
Codex t1p owns scripts/ephemeris and src/astro: Python SPICE generator, immutable chunks/metadata, pure TS ENU+interpolation+timeline calculations/worker.
Reviewer t1q reviews scientific assumptions and independent reference fixtures and integration; role remains review even though technical permissions are full access.
Shared src/contracts changes require coordinator agreement; neither developer duplicates math or invents units.
No code tasks have been released.

## Small stages and gates
0. Contract/reference acceptance. Architect+reviewer. Visible result: model/requirements table and sample schema; unknown full challenge remains explicit.
1. Reproducible scientific slice. t1p, reviewed by t1q. Visible result: one date, one site, Sun/Earth angles + source/version metadata. Check isolated Python/SpiceyPy compatibility, kernel bytes/checksums/coverage/time conversion and independent reference values before UI depends on data.
2. Globe orientation/picking. t1c after contract, parallel to1. Visible result: correct NASA texture and A/B marks, coordinate entry, south-pole camera. Check axes, map landmarks, ±180 seam, poles, point roundtrip. No misleading scientific placeholder.
3. Date range/worker/timeline. t1p math+t1c presentation after1+2. Visible result: UTC slider/playback and two synchronized horizon diagrams with no per-drag external request. Check off-grid error, chunk edges, stale results, timezone independence, sample convergence.
4. Integrated comparison. t1c+t1p with architect coordination. Visible result: A/B same period, summaries, disk cards, clear reference-horizon limitations, missing-data errors. Check day/night scene against numerical normals, Earth parallax, valid comparison interval.
5. Independent acceptance and demo. t1q with t1n. Visible result: reproducible validation record, static build/demo with bundled checked dataset. Run tests and visual check on actual browser; no claiming tests already passed.

## Validation plan
Horizons real GET examples retrieved with HTTP200, JSON result text and SOE/EOE tables:
- Earth399 relative500@301 ICRF/FRAME NONE; default time observed to be TDB.
- Sun10 observer coord@301, site lon0 lat-89 alt0km, TIME_TYPE=UT AIRLESS, QUANTITIES4; 2026-11-14 00:00UT apparent az126.635106deg alt0.960002deg.
These probes establish retrieval, not validated SPICE/TS results. Saved official requests/responses: TEMP/lunar-scientific-review-t1q-RESEARCH-REVIEW-1.
Verify ICRF geometric vectors with explicit TIME_TYPE first, separately verify ICRF->ME rotations and independent ENU. Horizons observer apparent AIRLESS is only a sanity crosscheck unless corrections are matched. Proposed external angular tolerance0.01deg after matching model is a future gate, not measured accuracy.
Test Sun/Earth at equator near side, far side, two southern sites and near horizon across at least three UTC dates; include zenith/nadir/pole singularities and same-sign event intervals. Test time conversion including leap boundary failure and future-leap assumption.
Render tests: cardinal axes and mapped landmarks, site roundtrip, light direction vs subsolar normal, terminator at90deg, selected site's displayed sky position agrees with computed ENU. Rotation camera must not alter angles. Fixed camera/time screenshots plus human inspection; screenshot alone is not scientific validation.
Performance budget is a proposed acceptance: initial data load finite and visible; slider has no NASA/JPL calls; cached local playback aims >=30fps on agreed test laptop, worker responses do not apply stale state.

## Official sources and conditions
NAIF kernel directories and rules https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ ; https://naif.jpl.nasa.gov/naif/rules.html . Public download, use permitted, unmodified kernel redistribution permitted; software has its own NAIF terms, not an assumed generic MIT licence.
Frame definitions https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf .
SPK coverage https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/aa_summaries.txt .
Time https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html ; https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/str2et_c.html .
Coordinates https://psdi.astrogeology.usgs.gov/moon/standards/data_standards/ .
SPICE positions https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkpos_c.html .
Horizons https://ssd-api.jpl.nasa.gov/doc/horizons.html ; https://ssd.jpl.nasa.gov/horizons/manual.html ; fair use https://ssd-api.jpl.nasa.gov/doc/ (serial requests, cache, proper User-Agent, no direct website embedding per CORS).
SVS https://svs.gsfc.nasa.gov/4720/ ; https://svs.gsfc.nasa.gov/help/ ; credits NASA Scientific Visualization Studio; NASA media guidelines https://www.nasa.gov/nasa-brand-center/images-and-media/ ; no implied endorsement; check third-party notices.
LOLA optional next-stage terrain: IMG+LBL int16 or JP2+label, public PDS, polar stereographic and scaling metadata must be honored, heavy GIS/horizon integration. https://pds-geosciences.wustl.edu/missions/lro/lola_faq.htm ; https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_20m.lbl .
PGDA https://pgda.gsfc.nasa.gov/products/69 : TIF/COG/IMG/JP2 average illumination/Earth visibility over long cycles; cite Mazarico2011; contextual layer only, not date-specific truth or direct validation of the no-terrain model.

## Deferred
DEM-derived terrain horizon and curvature/height, high-resolution polar cap, actual crater shadows, occultation/eclipse illumination, full apparent observer geometry, stations/antennas/link budgets, solar panels/energy/thermal, landing hazard ranking, persistent-shadow claims, long-term18.6year analysis, arbitrary dates live backend, accounts/database, many-site optimization.
User decisions actually needed: real event deadline/submission guide or full challenge copy if inaccessible; whether user later prioritizes terrain realism versus breadth of dates. No ordinary stack/units/module questions need user approval. This plan assumes no available implementation time.


## Research acceptance and retrieval evidence
2026-11-14: t1p and t1q both returned ACCEPT v2 via hc; responses read by architect. t1c UI report supports this architecture and supplied scene conventions; its proposed center LT+S subtraction and unmeasured hourly error were superseded by geometric NONE and measured future gates. No implementation authorization was issued.
Actual probes by t1p: all five kernel HEAD requests HTTP200; total45,745,465 bytes; lunar BPC Range0-255 GET HTTP206 with DAF/PCK header. Full kernel downloads/installation/SPICE numerical execution have NOT been performed. Horizons geometric Sun vectors and apparent observer tables fetched successfully. Reviewer saved Earth vector and polar observer request/response artifacts.
Reports outside repo: RESEARCH-SCIENCE-1-t1p-original.md in this directory; Claude RESEARCH-UI-1.md under TEMP/claude/93770dc20f1c5dcc/04bfbf61-f814-470f-b840-377cc1142833/scratchpad; reviewer artifacts under TEMP/lunar-scientific-review-t1q-RESEARCH-REVIEW-1.
PDS conditions verified in official FAQ https://pds-geosciences.wustl.edu/faq.html: data public-domain/free access, cite product/source; LOLA/PGDA source-specific citation applies.


