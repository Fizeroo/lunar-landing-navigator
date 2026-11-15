# One-minute mission-planning demo

The guided example uses the real prepared SPICE dataset and a **Shackleton-area illustrative point**, not an approved landing target: latitude -89.67 degrees, east longitude 129.78 degrees. The model is the reference tangent horizon of a smooth sphere, with observer height 0 m. The mission needs both body centres above that horizon continuously for 48 hours.

1. Open **Guided demo**. Examine the initial start, **16 November 2026, 21:00 UTC**. The condition fails immediately: the Sun is about 1.81 degrees above the reference horizon, but Earth's centre is about 1.37 degrees below it. This is a failed fixed start, not a claim that the site can never work.
2. Choose **Start one day later**. Keep the site, model, observer height, condition and required duration unchanged. At **17 November 2026, 21:00 UTC**, Earth's centre is about 0.02 degrees above the reference horizon. The prepared intervals give about **287 h 48 min** of continuous joint visibility remaining, more than the required 48 hours. Earth setting ends this interval.
3. Compare the unchanged baseline and the explicit alternative. Inspect the permissible-start interval separately from the current-start answer. Searching for a different successful start is a separate operation.
4. Enter **Surface view** with the selected successful window. Use **Look at Earth** and **Look at Sun**. The displayed directions come from the same scientific state as the numerical cards. Earth begins close to the horizon; it is not raised for a better image.
5. Start accelerated playback, observe the labelled speed and the countdown, then pause or look around. The experience stops at its limiting event or labelled range/data boundary. Return to the overview or comparison at any time.

The search range is the prepared interval **1 October 2026 through 1 February 2027 UTC**. Search results do not extrapolate beyond it. Event times are approximate and displayed to minutes. A date-range edge is not a sunrise or sunset.

This is geometric planning support. It does not establish landing safety, electrical power or radio-link performance. Terrain-window search is unavailable because the finite local DEM cannot certify uninterrupted visibility; terrain inspection remains a separate, explicitly labelled view.

## Reproducibility

The machine-readable fixture is `public/data/mission-demo.json`. Its expected values are checked against the mission API in `scripts/ephemeris/mission.test.mjs`. The architect separately evaluated the original observation API at both fixed UTC starts; the reviewer checks the window and limiting event. Exact serialized seconds support regression checks, not a claim of physical event-time accuracy.
