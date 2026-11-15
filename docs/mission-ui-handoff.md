# Mission UI handoff (worktrees/claude → main)

Written by the UI developer on 2026-11-14 for the architect. Baseline compared: main `a135d52`.
Nothing here was committed or pushed. Reconciliation reasoning is in `docs/ui-reconciliation.md`.

## 1. Files to take from this worktree

### New files

| File | What it is |
| --- | --- |
| `src/ui/mission.ts` | Pure logic, no DOM: duration parsing, frozen What-if requests, English wording for results, Experience playback stepping, guided-demo fixture validation. |
| `src/ui/MissionPanel.ts` | Mission form, result, What-if, loading / error / unsupported / stale states, request generation ids. |
| `src/ui/GuidedDemo.ts` | Five cancellable demo steps driven by `public/data/mission-demo.json`. |
| `tests/mission-ui.test.mjs` | Unit tests for `src/ui/mission.ts` against the real science module and data. |
| `tests/browser/mission-flow.mjs` | Real-browser check of the mission flow (optional, needs Edge + `playwright-core`). |
| `docs/mission-ui-handoff.md`, `docs/ui-reconciliation.md` | This manifest and the reconciliation record. |

### Replace main's copy with this worktree's copy

| File | Why |
| --- | --- |
| `src/main.ts` | Modular UI plus mission panel, Experience and guided demo wiring. |
| `index.html` | Side column (mission panel, folded Sites A/B), folded timeline/comparison, Experience bar, demo host. |
| `src/style.css` | Styles for the above. |
| `src/ui/SiteCard.ts`, `src/ui/panels.ts`, `src/ui/format.ts` | Modular UI (not in main, or a superset of main's). |
| `src/ui/ScenarioPanel.ts` | Strict dates: no "fitted to data" badge; rows that cannot be analysed cannot be loaded. |
| `src/ui/TerrainProfileView.ts` | Adds Sun / Earth name labels on the profile markers. |
| `src/scene/MoonScene.ts` | Space framing merged from main (see reconciliation). |
| `src/scene/SurfaceScene.ts` | This worktree's version (draw/ghost API). |
| `tests/ui.test.mjs`, `tests/exploration-ui.test.mjs` | Import the catalogue instead of `presets.ts`. |
| `tests/browser/ui-flow.mjs`, `tests/browser/ui-layout.mjs` | Adapted to the folded layout. |
| `docs/demo-walkthrough.md`, `docs/ui-browser-checks.md` | Rewritten for this version. |

### Delete in main

- `src/ui/exploration.ts` — the old orchestrator. Nothing in this worktree imports it; its behaviour lives in `main.ts`, `SiteCard.ts`, `ScenarioPanel.ts`, `panels.ts` and `TerrainProfileView.ts`.
- `src/ui/presets.ts` — replaced by `src/ui/catalogue.ts`.

### Do not take from this worktree (main is authoritative; these are copies)

- `src/science/*`, including `mission.ts` (copied from worktrees/codex, SHA-256 `352C8E7D3211D3AF18A822EA16CC4D5596C7243ED5C0B9457EF601680B4FE3BC`).
- `public/data/*`, including `mission-demo.json` (SHA-256 `69C50C1D91700D86AEAD0780B4220AD59DAA521865224C9F98D653643ABDCACF`).
- `scripts/ephemeris/mission.test.mjs` (copy, for running locally).
- `package.json`: this worktree's `test` script is `node --test tests/*.test.mjs`; keep main's script, which also runs `scripts/ephemeris/*.test.mjs`.
- Identical to main already: `src/contracts.ts`, `src/scene/coords.ts`, `src/ui/{catalogue,scenario,comparison,dom,SkyDiagram,Timeline,skyProjection}.ts`, `tests/{exploration,language,render-science}.test.mjs`.

### Stale items to know about

- `fitWindow` is still exported from `src/ui/scenario.ts` (identical to main) and still unit-tested, but the app no longer calls it. It can be removed together with its test in `tests/exploration-ui.test.mjs` if you prefer.
- `main` `tests/ui.test.mjs` imports `../src/ui/presets.ts`; use this worktree's copy when `presets.ts` is deleted.

## 2. Behaviour summary

- **Layout.** The 3D view is 1020×632 px at 1440×772 (was 751×467). The right column is the mission panel; Sites A/B sit below it in a closed fold; the timeline and the comparison are closed folds under the time controls. Scenarios, catalogue and Data & accuracy dialogs are unchanged.
- **Form.** Site A/B, observer height, model, need (Sun / Earth / both), duration 6 / 12 / 24 / 48 h or custom hours, start (UTC, typed), search range (all data or the comparison period). Primary button: **Find a window**.
- **Result.** First the verdict for the exact start as written; then, separately, the search: earliest suitable start, the window, "Allowed mission starts: … to …", number of windows, longest span. Clipped ends are worded as range or data edges, never as a set.
- **No fallback.** Model "Real terrain patch" returns the science module's refusal text. No reference-sphere result is shown instead; a button sets the model field only, and the user must press Find a window again.
- **Strict dates.** Nothing is shifted: mission starts, What-if starts and saved scenarios are evaluated as written or refused with a reason.
- **What-if.** Baseline is the frozen request of the shown result. Actions: **Start one day later**, **Try Site B** (or A), **Change observer height**. `compareMissionStarts` evaluates both fixed starts; a new search is a separate action ("Put the change into the form", then Find a window).
- **Experience.** "Experience this window" puts site, height, reference-sphere ground and start into the single app state and enters Surface view. A playback bar shows Play/Pause, speed, the actual rate, Back to start and End experience. Playback slows to 10 min per second in the last 2 h and pauses at the end, saying what ended (set, range edge or data edge). Look buttons, height, tabs and the shared time controls stay usable. Bodies are drawn only at their real directions.
- **Stale results.** Any change to the form, site or height dims the result and disables its actions until a new search.
- **Request ids.** Each search has a generation id; a superseded request never renders. The id and the measured latency are shown under the result.
- **Latency.** Headless Edge (software WebGL): first search 52–75 ms, repeated searches under 1 ms (analysis cached by data, site and height in the science module). A Worker was not needed.
- **Guided demo.** select → failure → one explicit change → result → surface, cancellable at each step. Each step is computed live; the fixture's recorded values are only cross-checked and a mismatch stops the demo with a message.

## 3. Checks run in this worktree

See `docs/ui-browser-checks.md` for the full list and results. Status at the time of writing is recorded at the end of that file; anything not yet re-run after the last change is marked there.
