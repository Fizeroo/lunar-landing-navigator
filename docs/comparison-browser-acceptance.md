# Final integrated comparison acceptance

Executed 2026-11-14 after the last application change, against the production build in `main-repo` at **http://127.0.0.1:4173/**. Final bundle: `index-DGsL1Umn.js`, stylesheet `index-DJ3y5JJ9.css`. The preview remains running on loopback only. No public deployment or Git branch/worktree changes.

## Automated and independent checks

- Final `npm test`: **37 passed**, zero failures/skips. Includes original CSPICE fixtures, coordinate/render consistency, interval clipping/short windows/strict-zero contacts/intersections, English source scan, sky projection and real-data summary/conclusion checks.
- Final `npm run build`: strict TypeScript and Vite production build passed.
- [Final source delta review](comparison-final-source-review.txt): PASS, exact integrated file equality and no scientific logic change. That source report was written before the architect completed the native-browser checks documented below; its historical "pending" sentence does not describe the final delivery status.
- [Independent numerical review](comparison-numerical-review.txt): analytic oracle intervals, totals, fractions and longest spans agree for two sites and two periods within1microsecond on identical ET bounds. This is agreement within the interpolation model, not real-world event accuracy.
- The physical SPICE dataset remains SHA256 `8a9240acec08c513de2f38e5c2959ad51a6ccc8673032e53b005d07c284c5ae6`,4322samples. No fabricated fallback.
- Claude's separate final real-data headless Edge flow:35/35, with no console errors; layout assertions at1440x772,1366x768,1440x900,1920x950 and a scrolling fallback at1366x650. See [frontend evidence](ui-browser-checks.md). These are separate from the architect's native browser observations below.

## Architect's actual Windows Edge observations

Used the existing dedicated demo window, screen1440x852, approximately1440x772 page content. The first integrated screen had clipped numerical readouts and internal horizontal scrolling; Claude fixed it, the application was rebuilt, and the following checks used that final build.

1. Reloaded the final build; saw English loading state, then real dataset status. At full size both A/B coordinates, skies and numerical readouts are visible together, without card scrolling. Six timeline rows, comparison table, conclusions and model warning are visible together. Default sites Shackleton/Mons Mouton link to their official gazetteer entries and say they are illustrative reference points.
2. Entered A=(-89,0), B=(-85.3,0) and period2026-11-10T00:00:00Z through2026-11-20T00:00:00Z. Current time clamped to the new range. Bar/table shares agree: A Sun100.0%, Earth/Both30.2%; B Sun/Both45.8%, Earth60.5%. These agree with the independent oracle. Table totals and longest runs visually correspond to the spans; all three conditions in this period have at most one positive span per site.
3. Entered2026-11-14T00:00:00Z. At A the displayed Sun altitude+0.96deg/azimuth126.6deg and Earth altitude-3.65deg/azimuth358.8deg match the checked reference. The Sun symbol is above the drawn horizon, Earth below; B shows its different local sky at the same time.
4. Clicked a timeline row and pressed Play. UTC, cursor, numerical observations and diagrams changed together; Pause stopped playback. The tested click sought an intermediate November instant.
5. Entered December2 and latitude91: English out-of-coverage and latitude messages appeared. Exact south pole produced undefined azimuths with altitude-only diagrams. At north pole during the selected period, Sun/Both showed zero intervals and0.0%; the all-period south-pole Sun case showed100.0%.
6. Changed presets via their controls; corresponding coordinates and official links changed. Activated B picking, clicked the Moon, and confirmed only B became a custom point while A retained Shackleton's coordinates. South pole camera control worked.
7. Full range restored dataset bounds. Exact2026-12-01T00:00:00Z was accepted. Reloaded to the clean default full-month, paused initial state. Dismissed Edge's own translation offer without translating the application; the application remains English.

Visible screen, labels, inputs, status, warnings, source explanations and the exercised validation/pole/empty states were English. Source scan covers other application-owned strings and accessible labels. The Russian text in Windows/Edge's own UI is outside application control; native number fields may follow the user's OS decimal separator.

## Limits of this acceptance

No hardware GPU performance benchmark, touch or screen-reader certification. Small windows use a scrolling layout. Smooth sphere, height0, no terrain/mountain shadow, eclipses, refraction, electrical power or radio-link guarantees. Event times are approximate and minute-rounded, based on ten-minute Cartesian SPICE samples. Sky/space symbols are schematic; the globe night-side fill light is explicitly labeled as non-physical orientation assistance. Complete official challenge rules remain unavailable (full page HTTP502); no claim of full competition compliance.
