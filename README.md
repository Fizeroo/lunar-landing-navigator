# Lunar Landing Navigator

Explore how location and time change sunlight and Earth visibility on the Moon. Compare sites, find geometric visibility windows, and descend to a first-person view of measured south-polar terrain.

**[Open the live application](https://fizeroo.github.io/lunar-landing-navigator/)** — no installation or account required.

Built for the NASA Space Apps Challenge [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/). This is an educational prototype, not an operational mission-planning or landing-safety tool. It is not endorsed by NASA.

## Try it

1. Open the app and use the startup example, **24 November 2026 at 04:00 UTC**, or choose another time within the available range.
2. Select **Find a landing candidate**. The app evaluates 25 points in a prepared south-polar region and shows up to three options.
3. Choose an option and select **Explore here** to descend to the surface. Eye height defaults to **1.7 m above the modelled ground**.
4. Drag to look around, use WASD to walk within the supported area, and select **Look at Sun** or **Look at Earth**. Optional mouse look releases with Escape.
5. Change the time or press Play, then return with **Back to orbit**.

An option with favourable reference-sphere geometry may still have **unknown terrain visibility**. A measured local obstruction is not treated as a successful visibility condition.

## What you can do

- Rotate and zoom the Moon, select coordinates, or choose a catalogue entry.
- Follow Sun and Earth directions in Orbit, Surface, and a schematic Space view.
- Evaluate lighting and Earth-visibility candidates in the prepared region.
- Open **Analysis** to compare A/B sites, inspect timelines and upcoming events, or search for a continuous mission window of a chosen duration.
- Compare alternative starts, sites, and observer heights; save scenarios locally and export or share their parameters.
- Open **Data & accuracy** for model explanations, sources, and coverage limits.

## Data and limits

| Component | What the prototype uses | Important limit |
| --- | --- | --- |
| Astronomical geometry | Prepared NASA/JPL SPICE Sun/Earth vectors and lunar orientation, **1 October 2026 through 1 February 2027 UTC** | No extrapolation outside this range. Event times are approximate; no external API is called for each time-slider movement. |
| Local terrain | NASA LRO LOLA PGDA Product 90: **101 × 101 vertices, 80 m grid spacing, approximately 8 km across** | Local obstruction checks have finite coverage. No local hit does not prove that the distant horizon is clear. |
| Visual surroundings | Coarser regional and global LOLA elevation layers | These provide visual context and do not extend the scientific horizon coverage. |
| Visibility intervals | Explicit smooth-sphere reference-horizon model for A/B summaries and mission-window searches | These intervals are separate from local terrain diagnostics. |
| Imagery | NASA SVS Moon texture, Deep Star Maps 2020, and Blue Marble Next Generation | Earth geography and sky orientation are illustrative. The Earth image is a January 2004 composite, not current weather. Enhanced sky changes visual exposure. |

The terrain grid does not resolve individual rocks or establish safe walking or landing routes. Fine visual grain adds no measured relief. Terrain can appear faceted, and low-angle shadows can show aliasing.

Geometric visibility is not electrical power, a guaranteed radio link, or landing safety. The prototype does not model eclipses, refraction, visible disc fractions, spacecraft dynamics, or soil properties. Display performance depends on the device and browser.

## Run locally

Use **Node.js 24** and npm:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. To build and preview the production version:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open **http://127.0.0.1:4173/**. Automated checks are available with `npm test`; type checking is available with `npm run typecheck`.

## How it is built

The browser application uses **TypeScript, HTML, CSS, three.js, and Vite**. Offline Python scripts prepare the scientific data using **SpiceyPy/CSPICE** and process the elevation and image assets. JPL Horizons comparisons provide a related-model check, not validation against independent observations.

The [GitHub Pages workflow](https://github.com/Fizeroo/lunar-landing-navigator/actions/workflows/pages.yml) installs locked dependencies, builds the app, and deploys **only `dist`**. It sets `VITE_BASE_PATH=/lunar-landing-navigator/`; local builds default to `/`.

## Sources, AI assistance, and licensing

- [Data sources and scientific scope](docs/data-and-sources.md)
- [Image provenance and credits](docs/visual-repair-assets.md)
- [Terrain coverage and search bounds](docs/immersive-data-scope.md)
- [Visual terrain preparation](docs/visual-context-data.md)
- [Mission-window calculations](docs/mission-planning-science.md)
- [Verification record and known limitations](docs/final-verification.md)
- [AI assistance disclosure](docs/ai-use.md)
- [Third-party software notices](docs/third-party-materials.json)

Claude Code and OpenAI Codex assisted with development, review, testing, and documentation. **The application does not use AI at runtime.** Scientific values are derived from the documented source data, not invented by an AI model.

NASA and third-party materials retain their own attribution and usage conditions. A project-code license has been proposed but not yet formally adopted; see [licensing status](docs/licensing.md). Do not assume the proposed license applies to every asset.
