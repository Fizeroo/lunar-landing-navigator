# UI checks — two-site comparison (frontend worktree)

Recorded 2026-11-14 in `worktrees/claude` against the real dataset `public/data/ephemeris-2026-11.json` and the delivered `src/science` modules. These are the frontend developer's own checks; the architect's acceptance of the integrated build in `main-repo` is separate.

## Automated, reproducible

| Command | Result |
|---|---|
| `npx tsc --noEmit` (strict) | 0 errors |
| `npx vite build` | production bundle built |
| `node --test tests/ui.test.mjs` | 9 tests, 9 pass |

`tests/ui.test.mjs` covers UTC/duration/percent/degree/compass/coordinate formatting, the sky projection (horizon at 0, monotonic, below-horizon stays below, azimuth wrap), the conclusion logic (leader, “about the same” threshold, zero case, no ranking words), preset validity and source URLs, and — on real data — that conclusion numbers and bar totals equal the `analyzeSite` summaries.

Note: `tsconfig.json` now sets `allowImportingTsExtensions` so UI modules can use explicit `.ts` import paths and run under `node --test` without a bundler.

## Real browser (headless Microsoft Edge, software WebGL)

Viewport sizes below are **content** sizes: what remains of a maximised window after the browser's own tabs and toolbars (a 1440x852 screen leaves about 1440x772).

`tests/browser/ui-layout.mjs` (optional; needs `npm i --no-save playwright-core`):

| Content size | Layout | Moon area | Result |
|---|---|---|---|
| 1440x772 | fixed, no scrolling | 727x463 px | PASS |
| 1366x768 | fixed, no scrolling | 653x459 px | PASS |
| 1440x900 | fixed, no scrolling | 727x591 px | PASS |
| 1920x950 | fixed, no scrolling | 1207x641 px | PASS |
| 1366x650 | scrolling single column (below 700 px height or 1240 px width) | 1366x390 px | PASS: no horizontal overflow |

In the fixed layout the script requires: no page scrolling, no scrolling inside the site cards in either direction, both cards' coordinates, sky diagram and numeric Sun/Earth readouts fully visible together, the comparison inside the time panel, and no truncated numbers or labels.

`tests/browser/ui-flow.mjs` at 1440x772: **35 of 35 checks passed**, no console errors.

- No page or site-card scrolling; six timeline rows; table with three conditions x two sites; three conclusion sentences.
- Timeline row shares equal the table shares.
- Clicking the timeline moves the cursor, slider and UTC field together; bar tooltip shows minute-rounded UTC and approximate duration.
- Play advances time, cursor and readouts; the bar elements are not rebuilt during playback (analysis is cached).
- Typed UTC accepted; out-of-coverage time, missing `Z`, reversed period and invalid latitude rejected with English messages.
- Reference fixture at 89° S, 0° E, 2026-11-14T00:00:00Z: Sun alt +0.96°, az 126.6°; Earth alt −3.65°, az 358.8° (matches the first-slice acceptance values).
- Exact pole: azimuth shown as undefined, no disc drawn, altitude band explained.
- Preset selection sets coordinates and the gazetteer link; globe click moves only the active site; camera drag changes no coordinates or angles.
- Period change clamps the current time and re-labels the axis; Full range restores dataset bounds; exact end of coverage is reachable.
- No Cyrillic characters in visible text, titles, ARIA labels or placeholders; `lang="en"`; disclaimer visible.

## Not checked

- Frame rate and behaviour on a hardware GPU (the run used software rendering).
- Touch input, screen readers, browsers other than Edge.
- Content areas narrower than 1240 px or shorter than 700 px switch to a scrolling single column; that layout was only checked for horizontal overflow, not inspected in detail.
- A real (non-headless) Edge window was not driven by these scripts; the architect's acceptance in the integrated build covers that.
- Number inputs follow the browser locale (a comma decimal separator may be displayed).
