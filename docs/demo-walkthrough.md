# Demo walkthrough — mission-window version

About three minutes. Everything shown is computed in the browser from the prepared SPICE vectors; nothing is fetched at run time. All times are UTC and rounded to the minute.

## Before you start

- Open the app in a maximised window (about 1440×772 of content). The page does not scroll.
- Wait for "Data ready · 2026-10-01 to 2027-02-01 UTC" in the header.
- The large area is the 3D Moon. The right column is the **Mission window** panel.

## Option A — the guided demo (recommended)

1. Press **Guided demo** in the mission panel. A card appears over the 3D view. **Cancel demo** stops it at any step.
2. **Step 1, choose.** Site A becomes the Shackleton-area illustrative point. The form shows the need: Sun and Earth above the horizon together, 48 h, start 2026-11-16 21:00. Nothing is calculated yet. Press **Next**.
3. **Step 2, failure.** The result reads "No — not from 2026-11-16 21:00 UTC": at that exact start Earth is still below the reference horizon. Below it, separately, the search names the earliest start that works (2026-11-17 20:39) and the allowed range of starts. The requested start itself was not moved.
4. **Step 3, one change.** The card names the single change: start exactly one UTC day later. Need, duration, range, height, site and model stay the same.
5. **Step 4, result.** The What-if box compares the two fixed starts: the baseline still fails; 2026-11-17 21:00 fits, with about 12 days of joint visibility ending at Earthset on 2026-11-29 20:48.
6. **Step 5, surface.** You stand at the site at the changed start. In the playback bar press **Play**; choose "1 d per second" to go faster. The bar shows the actual rate, slows to 10 min per second near the end, and pauses when Earth's centre reaches the horizon, saying what ended. Use **Look at Earth**, **Look at Sun** or drag to look around at any time. Press **Finish**.

## Option B — by hand

1. In **Mission window** keep Site A, choose the need, press **48 h**, type a start such as `2026-11-16T21:00:00Z`, and press **Find a window**.
2. Read the coloured box first: it answers for your exact start. "Search in the range" below it is a separate answer about where a suitable start exists.
3. Open **What if…** and try **Start one day later**, **Try Site B**, or type a height and press **Change observer height**. Each compares your fixed start with exactly one change. To search again with the change, press **Put the change into the form**, then **Find a window**.
4. Press **Experience this window ▸** to stand on the surface. **Back to orbit** returns to the Moon.

## Things worth pointing out

- **Nothing is shifted.** A start outside the data, or a scenario that runs past the data, is refused with a reason.
- **Edges are not events.** If a window is cut by the search range or by the end of the data, the text says so and does not call it a sunset.
- **Terrain is not searched.** Choosing "Real terrain patch" in the form gives an explicit refusal; no reference-sphere answer is substituted.
- **Stale results are marked.** Change the form, the site or the height and the result dims until you search again.
- **Earlier tools are still there.** **Sites A and B** (current sky, next changes, location) is a fold under the mission panel; **Above-horizon intervals** and **Comparison over the period** are folds under the time controls; **Site catalogue**, **Scenarios** and **Data & accuracy** are in the header; **Space view** and **Surface view** are tabs.

## What the numbers mean

"Above the horizon" means the body's centre is above the local tangent plane of a smooth 1737.4 km sphere at the chosen observer height. It is not illumination with terrain shadows, electrical power, a guaranteed radio link or a landing-safety judgement. Times come from 10-minute samples and are approximate to about a minute.
