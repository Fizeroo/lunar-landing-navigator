# South-pole site comparison implementation

This authorized extension supersedes the single-site scope in the historical first-slice plan. The SPICE dataset, frame, geometric conventions and Vite/TypeScript/three.js stack remain unchanged. Shared API: [comparison-contract.md](comparison-contract.md).

## Challenge alignment and evidence

The [official challenge](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/) is indexed with the objective of comparing lunar landing sites/dates and visualizing Sun/Earth positions relative to the horizon. A fresh full-page fetch on 2026-11-14 returned HTTP502. Full resource tabs, scoring and submission requirements remain unverified. The implementation addresses the verified comparison objective; it does not claim complete competition compliance. Terrain-free geometry supports exploration of opportunities, not power prediction, link engineering or landing safety.

## Delivery stages

| Stage | Owner | Visible result | Depends on | Acceptance |
|---|---|---|---|---|
| Shared boundary | Architect | Frozen interval/summary API in repository | Existing types and SPICE conventions | Both implementers consume identical types |
| Interval science | Codex developer | Sun/Earth/both spans and metrics | Prepared real vectors | Crossings between samples, sub-sample short spans, clipping, all/none and intersections tested |
| Comparison experience | Claude, primary implementer | A/B globe, coordinate controls/presets, local skies, time controls, six bars and summaries | Shared boundary and interval API | Same period for both sites; one time updates all views; complete English UI |
| Integration and fixes | Architect integrates; Claude fixes frontend | Production app on localhost | Both implementations | Tests/build pass; no fabricated fallback; summaries derive from displayed intervals |
| Independent acceptance | Reviewer and architect | Numerical and actual browser evidence | Final integrated production build | A/B selection, period change, timeline click/play, invalid dates, English states, model warnings and source links verified |

## Deliberate limits

Reference sphere, h=0, center altitude strictly greater than zero. No terrain or mountain shadows, eclipses, refraction, apparent light-time correction, solar electrical output or radio availability. Event timestamps are approximate and displayed at minute resolution. Piecewise-linear prepared data are sampled every600 ET seconds; analytic crossings are exact only for that interpolation model. No new stack, duplicate agents, branch/worktree replacement or public deployment.

## UI language and usability gate

All application-owned text must be plain English, including accessible labels, validation errors, loading, date labels and tooltips. Dates identify UTC explicitly. A/B use distinct colors and text labels. The active target for globe clicks is explicit. Both current observations and period comparison must remain readily accessible without hunting through the former long single-site sidebar. New documentation and the demo walkthrough are English. Existing historical reports are not evidence for this extension's browser acceptance.
