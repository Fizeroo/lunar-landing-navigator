# Demo walkthrough — two-site comparison

## One-minute demo

1. Open http://127.0.0.1:4173/ and press **South pole**. Site A starts at the illustrative Shackleton feature centre and B at Mons Mouton; their source links are in the cards.
2. Press **Pick on globe** on Site B, then click the Moon. Only B moves. You can also type coordinates or choose a preset.
3. Enter `2026-11-10T00:00:00Z` and `2026-11-20T00:00:00Z` as the comparison period; press **Apply**.
4. Click a timeline row, then press **Play** and **Pause**. Watch both local skies, numbers, light and the time marker change together.
5. Compare the six bars and the table's shares, total times and longest runs. Read the three short conclusions. These compare geometry only; terrain and mountain shadows are not modeled.

## Extended tour

A five-minute guided tour of the Lunar Landing Navigator. All times are UTC. The prepared dataset covers **2026-11-01T00:00:00Z to 2026-12-01T00:00:00Z**.

## Start

```powershell
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open **http://127.0.0.1:4173/** in a desktop browser with WebGL. The layout is designed to fit a 1440×900 window without page scrolling; smaller windows scroll.

## What is on screen

| Area | What it shows |
|---|---|
| Left: 3D Moon | NASA SVS texture, lit from the real Sun direction for the current time. Markers **A** (orange) and **B** (teal). Yellow and blue rays are *symbolic* directions to the Sun and Earth, not real distance or size. The night side has a faint fill light for orientation only. |
| Right: Site A and Site B cards | Preset or custom coordinates, a schematic local-sky diagram, and Sun/Earth altitude and azimuth for the current time. |
| Bottom left: time panel | Common comparison period, current time, playback, and six interval rows (Sun, Earth, Sun + Earth for each site) on one shared time axis. |
| Bottom right: comparison | For each condition and site: share of the period, total time, longest continuous interval, plus a plain-English conclusion. |
| Footer | Permanent model limits and source links. |

## Script

1. **Initial view.** Site A is Shackleton (89.67° S, 129.78° E), Site B is Mons Mouton (84.60° S, 31.00° E), the period is the whole dataset. Read the comparison table: the percentages in the table are the same numbers shown at the right end of the six timeline rows.
2. **Scrub time.** Click or drag anywhere in the timeline rows (or use the slider beneath them). The white cursor, the UTC field, both sky diagrams, both readouts and the Moon's lighting move together.
3. **Play.** Press **Play** (or Space). Choose 1 h/s, 6 h/s or 1 d/s. Playback stops at the end of the period. Only the current-time observation is recomputed while playing; the monthly interval analysis is cached.
4. **Read an interval.** Hover a bar: the tooltip gives its start and end (rounded to the minute) and its approximate duration.
5. **Read the local sky.** In each card the horizontal axis is azimuth (N → E → S → W → N) and the vertical axis is altitude on a square-root scale that enlarges the region near the horizon. A filled disc is above the horizon; a hollow dashed disc in the hatched area is below it.
6. **Change a site from a preset.** In the Site B card choose *Malapert*. The marker moves, the camera flies there, and the rows and table for B are re-analysed over the same period.
7. **Pick a site on the globe.** Press **Pick on globe** in the Site B card (the card is outlined and the hint above the Moon names the active site), then click the Moon. The site becomes a *custom point*. Dragging the Moon only moves the camera and never changes coordinates or angles.
8. **Type coordinates.** Enter latitude `-89` and longitude `0` for Site A and press **Set**. Then enter the time `2026-11-14T00:00:00Z` and press **Go**: Sun altitude +0.96°, azimuth 126.6°; Earth altitude −3.65°, azimuth 358.8°.
9. **Exact pole.** Set Site A latitude to `-90`. Azimuth is reported as *undefined* and the diagram draws a dashed altitude line across all azimuths instead of inventing a position.
10. **Change the period.** Enter `2026-11-20T00:00:00Z` to `2026-11-27T00:00:00Z` and press **Apply**. Both sites are analysed over exactly this period, the current time is moved inside it, and all shares and totals now refer to these seven days. **Full range** restores the whole dataset.
11. **Errors.** Try a time outside the dataset (`2026-12-05T00:00:00Z`), a time without `Z`, a reversed period, or latitude `95`. Each is rejected with a message; nothing is extrapolated and no stale values remain.

## How to read the results

- A bar means the **centre** of the Sun or Earth disc is above the local tangent plane of a smooth sphere of radius 1737.4 km at height 0 m. “Sun + Earth” is the intersection of the two.
- The conclusion sentences are derived only from the table numbers. A difference below 0.5 percentage points is reported as “about the same”.
- Interval ends are exact for the piecewise-linear model built from 10-minute SPICE samples; they are shown rounded to the minute and should be read as approximate.

## Limits (also shown in the app)

No terrain, terrain shadows, eclipses, refraction or light-time correction. “Above the horizon” is geometry: it is not real illumination, electrical power or a guaranteed radio link, and the comparison is not a ranking of landing safety. Preset coordinates are feature centres from the IAU/USGS Gazetteer, used as illustrative reference points on the smooth sphere; they are not designated landing sites.

## Sources

- Ephemeris: NASA/JPL NAIF SPICE generic kernels (DE440s, lunar PCK/FK, LSK) — https://naif.jpl.nasa.gov/naif/data.html. Pinned files and hashes are recorded in the dataset provenance and in `docs/science-validation.md`.
- Texture: NASA Scientific Visualization Studio, CGI Moon Kit (LRO LROC/LOLA), appearance only — https://svs.gsfc.nasa.gov/4720
- Preset names and coordinates: IAU/USGS Gazetteer of Planetary Nomenclature, retrieved 2026-11-14 — https://planetarynames.wr.usgs.gov/ (Shackleton `/Feature/5450`, de Gerlache `/Feature/1439`, Slater `/Feature/15325`, Nobile `/Feature/4321`, Malapert `/Feature/3603`, Mons Mouton `/Feature/16070`, Statio Shiv Shakti `/Feature/16272`, Statio Tranquillitatis `/Feature/5684`).
- Context for the south-polar presets: NASA, “NASA Provides Update on Artemis III Moon Landing Regions” (2024-10-28) — https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/. That release names regions and gives no coordinates; the app does not claim to reproduce them.
