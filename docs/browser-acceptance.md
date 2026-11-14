# Integrated browser acceptance — 2026-11-14

Application: **http://127.0.0.1:4173/**, production Vite build from `main-repo`, Microsoft Edge on Windows. The local server listens on127.0.0.1 only and remains running in hc terminal `t1t` (`lunar-local-preview`, outlive-parent enabled). No internet publication.

## Checked in the actual browser

1. Real JSON loads successfully: header shows Nov1–Dec1 UTC; the Moon uses the locally downloaded NASA SVS color texture. No mock or fallback ephemeris is shipped.
2. Clicked the globe and observed marker/coordinate changes (example9.5080N,16.3039W) and corresponding Sun/Earth card updates.
3. Dragged to orbit and scrolled to zoom. The view changed while site coordinates and computed angles stayed unchanged.
4. Entered `2026-11-14T00:00:00Z` at lat-89/lon0: displayed Sun azimuth126.64deg, altitude+0.960deg; Earth azimuth358.77deg, altitude-3.649deg. These match the independently checked scientific fixture at displayed precision.
5. Clicked the time slider: time changed to an intermediate November instant, illumination visibly changed from a mostly dark face to a lit face, and numerical cards changed.
6. Entered the exact `2026-12-01T00:00:00Z` endpoint: accepted. Entered December2: explicit out-of-coverage error, no extrapolation.
7. Entered exact south pole lat-90/lon0: both azimuths displayed as undefined, with finite altitudes; no invented zero azimuth.
8. Pressed Play: UTC advanced, lighting/cards updated, button became Pause. Paused and restored November1/lat-89/lon0.
9. Scrolled the results panel: both Sun and Earth cards are accessible. The smooth reference-sphere / no-terrain / no-eclipse / no-power-or-radio-guarantee caption remains visible at the bottom. Verified layouts in a normal935px-wide window and maximized1440px-wide window.

No frame-rate benchmark or browser-console instrumentation is claimed. The application requires a browser with WebGL support. Its numerical model is geometric, h=0 on a sphere; texture detail is appearance only.

## Automated integration checks

`npm run build` passed (strict TypeScript plus production bundle).

`node --test scripts/ephemeris/science.test.mjs tests/render-science.test.mjs` passed **19 tests**, zero failures/skips. The same command is available as `npm test`.

Tests cover real endpoints and data model, direct CSPICE reference fixtures, UTC and leap-policy rejection, input bounds, ENU/parallax/singularities, coordinate roundtrips, scene rotation handedness and agreement of rendered solar direction with topocentric altitude within the small solar-parallax difference.

Scientific measurements and independent numerical review are recorded in [science-validation.md](science-validation.md) and [independent-science-review.txt](independent-science-review.txt). Final independent integration/source recheck: [independent-integration-review.txt](independent-integration-review.txt), PASS. The final provenance validation was included in the 19 passing tests. Running the integrated main generator with the pinned cached kernels reproduced all 4322 sample rows, model and coverage exactly.
