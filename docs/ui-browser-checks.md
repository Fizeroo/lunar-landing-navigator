# UI checks — mission-window version (frontend worktree)

**Historical layout evidence.** These checks describe the earlier mission-first interface, not acceptance of the immersive explorer. The final immersive checks and screenshots are recorded separately after integration.

Recorded 2026-11-14 in `worktrees/claude`, after the last source change, against the real files `public/data/ephemeris-2026-10_2027-02.json`, `public/data/terrain-pgda90-southpolar.json`, `public/data/mission-demo.json` and the frozen `src/science/mission.ts` (SHA-256 `352C8E7D…FE3BC`). These are the frontend developer's own checks on this worktree's build served at `http://127.0.0.1:4175/`. The architect's acceptance of the integrated build on port 4173 is separate and is not claimed here.

An earlier version of this file described the exploration layout (two site cards beside a 751×467 px 3D view, 75 browser checks). That evidence is superseded: the layout changed, and every number below was produced again on the new build.

## Automated, reproducible

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (strict) | 0 errors |
| `npm run build` | production bundle built |
| `node --test tests/*.test.mjs scripts/ephemeris/*.test.mjs` | 58 tests, 58 pass |

`tests/mission-ui.test.mjs` (16 tests, new) uses the real dataset and the real science module. It covers: duration presets and strict custom hours; the frozen baseline and the request key used for stale marking; What-if making exactly one change and leaving the baseline untouched, accepted by `compareMissionStarts`; a fixed start that fails being reported as a failure while the shifted start appears only in the separate search text; What-if +1 day evaluating 21:00 as written, not the searched 20:39; small and negative deltas reported as they are; a search range shorter than the mission as a valid no-fit blamed on the range, with the longest span and no "widen" advice; a start inside a window; no later window but earlier ones; the last instant of the data and a start outside the data; the terrain refusal text; the Experience pause point (physical end, range edge, next window start, none); playback that slows down and never passes the pause point; the guided-demo fixture agreeing with a live calculation, and malformed fixtures rejected.

## Real browser (headless Microsoft Edge, software WebGL)

Sizes are **content** sizes: a maximised window on a 1440×852 screen leaves about 1440×772. The scripts need `npm i --no-save playwright-core`.

### `tests/browser/mission-flow.mjs` at 1440×772 — 56 of 56 checks passed, no console errors

Run: `node tests/browser/mission-flow.mjs http://127.0.0.1:4175/ artifacts`

- **Layout.** No page scrolling; 3D view 1020×632 px beside a 420 px mission column; Sites A/B, timeline and comparison folded but present; primary button "Find a window"; presets 6 / 12 / 24 / 48 h and custom hours.
- **Input errors.** A start without `Z`, a start outside the data and a non-numeric duration each give an English error and no result; nothing is shifted.
- **Unsupported terrain.** The contract message is shown; no reference-sphere result appears in its place; switching the model is a separate explicit step that does not search.
- **Fixed start and search.** Shackleton, Sun and Earth together, 48 h, start 2026-11-16 21:00 UTC: "No — not from 2026-11-16 21:00 UTC". Separately: earliest start 2026-11-17 20:39 UTC, window to 2026-11-29 20:48 UTC ending at Earthset, "Allowed mission starts: 2026-11-17 20:39 UTC to 2026-11-27 20:48 UTC". The view time is not moved by a search.
- **Latency and request ids.** The measured search time is shown (first search 52–75 ms, repeats under 1 ms in this environment). Of two requests fired back to back only the newer is displayed.
- **Stale results.** Editing the form, or typing a height before leaving the field, dims the result and disables its actions; restoring the inputs clears the mark; the height reaches the site card.
- **What-if.** Buttons "Start one day later", "Try Site B", "Change observer height". +1 day evaluates 2026-11-17 21:00 as written and fits; the baseline text and the form are unchanged; gain ≈ 12 d; limiting factor Earthset. An unchanged height is refused.
- **Experience.** Enters Surface view at the fixed start; says what it plays toward; Look north works; playback runs at the shown speed, can be paused, and the shared time controls still work; it slows to 10 min per second near the end and pauses at 2026-11-29 20:47:47 UTC with "Earth just went below the reference horizon"; the Earth line reads altitude 0.00°; Back to start and End experience work.
- **Range edge.** With a one-day comparison period as the search range: a valid no-fit blamed on the range, longest span ≈ 24 h labelled as the range edge, and Experience heads to the range edge, not to a later set.
- **Guided demo.** Five steps with the real fixture; cancelled mid-way and run again to the end; the surface step starts at 2026-11-17 21:00 UTC.
- **Earlier detail.** The Sites fold, the timeline fold and the Scenarios dialog still open.

### `tests/browser/ui-flow.mjs` at 1440×772 — 78 of 78 checks passed, no console errors

The earlier regression script, adapted: it opens the three folds after each load and scopes two text selectors that the mission form made ambiguous. Three checks were added: a scenario saved for another dataset is not analysed and cannot be loaded; a window running past the data is refused and its dates stay as typed, with no badge; the terrain skyline names the Sun and Earth markers. It still covers events, time controls, site input, the catalogue, scenarios (save, import, share link, reload), Data & accuracy, Space view, Surface view and terrain, as before.

While adapting it, the script timed out once. Cause: its import fixture used a made-up dataset id, which the new strict rule correctly refuses, so the dialog stayed open. That was test data, not an application fault; the fixture now uses the loaded dataset's id and the refusal itself is checked.

### `tests/browser/ui-layout.mjs` — default state (folds closed)

| Content size | Layout | 3D area | Result |
| --- | --- | --- | --- |
| 1440×772 | fixed, no scrolling | 1020×632 px | PASS |
| 1366×768 | fixed, no scrolling | 946×628 px | PASS |
| 1440×900 | fixed, no scrolling | 1020×760 px | PASS |
| 1920×950 | fixed, no scrolling | 1500×810 px | PASS |
| 1366×650 | scrolling single column | 1366×390 px | PASS: no horizontal overflow |

In the fixed layouts the whole mission form, the Find a window button, the time controls and the model-limits footer are inside the window.

## Screenshots (real browser, final build, 1440×772)

Saved by the scripts in `artifacts/` (ignored by Git):

- `06-mission-result.png` — the mission result for the failing fixed start, with the separate search result.
- `07-surface-experience.png` — Surface view paused at the end of the window, with the reason and the What-if comparison.
- `01-moon-overview.png` to `05-data-and-accuracy.png` — regenerated by the regression script on the same build (folds open).

## Not checked

- A hardware GPU and frame rate (software rendering was used), touch input, screen readers, browsers other than Edge.
- A visible (non-headless) Edge window was not driven by these scripts.
- The integrated build in `main-repo` on port 4173.
- With the Sites fold or a long result open, the mission column scrolls inside itself; only the default state is checked for fit.
- The scrolling layout below 1240 px width or 700 px height was checked only for horizontal overflow.
- The guided demo with a site or height change: the shipped fixture uses the +1 day change; the other two kinds are covered by unit tests of the fixture validation and by the What-if browser checks, not by a demo run.
