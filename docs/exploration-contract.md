# Exploration extension: shared implementation boundary

This extends the tested A/B application. Preserve the old dataset and APIs for regressions. All UI and new docs English. No publication, push, new agents, branches or worktrees. No origin/config/credential reads. Main integration is by explicit owned-file copy.

## Scope and ownership

Claude t1c is primary implementer: all UI, three viewing modes/cameras, scenarios/local persistence/export, catalogue presentation, timeline/event cards, progressive panels and visual polish. Scientific developer t1p owns science/events/observer/terrain modules, ephemeris extension, real DEM preparation and numerical tests. Reviewer t1q checks maths, data, integration and regressions. Architect owns this contract, integration and submission/source documentation. Do not edit another owner's files without agreement.

## Common APIs (agree before UI implementation)

Existing `observeAt`, `analyzeSite`, `SiteAnalysis` and original data remain supported. Existing A/B reference-plane results must remain reproducible. New modules export these additional APIs; use imports from their defining modules so canonical old types need not be changed.

`src/science/events.ts`:

```ts
export interface HorizonEvent { et: number; kind: 'sunrise'|'sunset'|'earthrise'|'earthset' }
export interface UpcomingEvents {
  sunrise: HorizonEvent|null; sunset: HorizonEvent|null;
  earthrise: HorizonEvent|null; earthset: HorizonEvent|null;
  joint: { startEt:number; endEt:number; ongoing:boolean; startClipped:boolean; endClipped:boolean }|null;
}
export function getUpcomingEvents(analysis: SiteAnalysis, et:number): UpcomingEvents;
```

Derive events from interval lists; never call the beginning/end of data coverage a rise/set unless genuinely computed there. End-of-coverage of an ongoing interval is a clipped window boundary, not a physical sunset. Null means "Not found within available data", never "never". Future transitions are strictly after current ET; windows may be ongoing. Full-data analysis for event search is distinct from the visible comparison period and must be labeled. UI formats countdowns/events approximately to minutes and uses the same function for buttons and cards.

`src/science/observer.ts`:

```ts
export function observeObserver(data:EphemerisData, et:number, site:Site, heightM:number): Observation;
export function analyzeObserver(data:EphemerisData, site:Site, period:TimeInterval, heightM:number): SiteAnalysis;
export function sphereHorizonDipDeg(heightM:number):number;
```

Height is above the smooth reference sphere, 0..10000m. These additional analyses use the **reference tangent plane** (altitude >0), with true topocentric observer displacement at that height. Explain that the geometric visible sphere horizon dips below this plane. A/B/scenario timeline comparisons use this reference-plane model, explicitly labeled; do not silently replace them with terrain results. The surface view may additionally show visible-sphere and local-terrain visibility, with separate labels and profile. Camera clearance is a separate visual setting; normal default can follow observer height with a safe display minimum and clearly explain any difference. Do not make a zero-height camera clip into the mesh.

`Scenario` UI-owned schema: version1, id/name, site (lat/lon/h0), startUtc, durationSeconds, observerHeightM, model:'reference-sphere', datasetId. Default scenarios A now/A +3days/B now have equal duration. Validate localStorage/import/hash before use; no unsafe object/HTML injection. Bound dates to actual dataset. Export only these public fields; import/export/local storage should preserve model/height. A shared URL may encode the scenario in a fragment; no external service required.

## Scientific data and terrain agreement

Target expanded data: 2026-10-01T00:00:00Z through2027-02-01T00:00:00Z,600ET-second sampling, roughly3.5MB uncompressed. Keep `/data/ephemeris-2026-11.json`; new production filename `/data/ephemeris-2026-10_2027-02.json`. Verify actual kernel coverage and several off-grid values; do not assume fixed UTC/ET offset. If range changes, announce to both implementers.

Terrain API must be proposed by t1p to t1n/t1c **before** frontend terrain integration, as actual DEM format/projection/coverage must be inspected first. Choose a small real southern patch from official LOLA products78/81/90 using ranged COG reads if possible. Preserve physical scale and sphere curvature. Prefer a terrain JSON grid in Moon-fixed coordinates/planetocentric lat/lon plus provenance, explicit no-data/coverage and one vetted observer location. No invented heights, filled unknown horizons or DEM edge walls. Limited radial search extent must yield "Terrain coverage insufficient" when distant occlusion cannot be excluded; distinguish a found local blocker from certified clear visibility. Profile, observer directions and rendering must share geometry. Terrain heights are relative to1737400m sphere; DEM frame is DE421 ME, application MOON_ME_DE440_ME421 alignment must be documented/checked.

Modes: Moon overview retains picking/orbit; Space view shows recognizable Moon/Earth/Sun from same body vectors, with "Distances and sizes not to scale"; Surface view uses actual local ENU directions, compass/look heading, Sun/Earth look actions and ground-safe camera. No artificial orbital motion/libration. Below-horizon bodies remain below, with explanatory direction/status. Surface mode must always work on sphere even if real terrain acquisition has an external blocker.

## Delivery gates

1. Verify current code/state and real sources; agree scientific additions.
2. Events/countdowns + extended data, then scenarios/catalogue (Claude primary).
3. Three coherent modes with same time and valid observer height, then one real terrain patch/profile if obtainable.
4. Independent math/edge regressions; source/license/AI/submission evidence docs.
5. Final production build and actual browser walkthrough after last change, three screenshots saved as artifacts, local server left running.
