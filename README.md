# Stargazer — CLPS Lunar Mission Navigator

Stargazer is a prototype for exploring how local terrain and Sun/Earth geometry affect candidate lunar landing sites. The web app combines a 3D lunar-surface view with a time slider, visibility summaries, and a site comparison panel. Python scripts prepare the ephemeris, terrain-horizon, and exploratory cost-analysis data used by the project.

## What is in the repository

- **`frontend/`** — React 19 and Vite application; Three.js renders the interactive scene.
- **`ephemeris_fetch.py`** — downloads hourly apparent Sun and Earth azimuth/elevation samples from the JPL Horizons API for the configured sites and dates. It writes data to both `ephemeris_long/` and the frontend's bundled ephemeris directory.
- **`lola_terrain.py`** — derives 360-direction skyline masks and local terrain tiles from the NASA LOLA south-polar DEM (`LDEM_80S_80M`, 80 m/pixel).
- **`cost_mc.py`** — standalone Monte Carlo analysis of cost per jointly Sun- and Earth-visible operating hour.
- **`ephemeris_long/`** — checked-in longer ephemeris datasets and example cost-analysis outputs.
- **`STARGAZER_Project_Overview_Plan.md`** — broader project direction, status, and future work.

There is currently no backend service, project API, installable Python package, or CLI application. The Python files are standalone data-preparation and analysis scripts.

## Run the web app

Requirements: Node.js and npm.

```sh
cd frontend
npm install
npm run dev
```

Vite prints the local URL. Other available scripts are:

```sh
npm run build    # production bundle in frontend/dist
npm run preview  # serve the production bundle locally
npm run lint     # run oxlint
```

## Explore the prototype

- Select **Malapert Mountain / Massif**, **Shackleton Rim (connecting ridge)**, or **Mons Mouton (IM-2 site)** from the site menu.
- Play, step through, or scrub the 29.53-day timeline. Visibility bands and summary values show the estimated Sun- and Earth-above-skyline intervals; the jump controls move to the next transition or the stored best-overlap time.
- Drag the scene to look around, scroll to zoom, or use the camera controls. Arrow keys and WASD pan the view. The tool dock toggles scene overlays and interface elements.
- Open **Compare sites** for summary values across the three bundled locations.

Coordinates and site identifiers live in `frontend/src/data/landingSites.json`. The displayed longitudes use east-positive degrees (0–360 for these sites). The initial scenario starts at **2026-12-01 00:00 UTC**.

## Data and calculation notes

The frontend loads hourly ephemeris samples from `frontend/src/data/ephemeris/` and interpolates between them. The bundled files are JPL Horizons observer ephemerides for the three configured sites, over the dates and time span recorded in each JSON file. The app's timeline covers one 29.53-day interval. Requests beyond the bundled sample range clamp to the first or last sample; change the scenario and regenerate data when analyzing another date.

Visibility is calculated by comparing a body's interpolated elevation with a 360-bin terrain skyline at its azimuth. The checked-in horizon masks under `frontend/src/data/horizon/` are generated from LOLA elevation data by `lola_terrain.py`. The distant skyline in the scene follows these masks. The nearby ground, rocks, and surface details are illustrative procedural geometry, not a high-resolution LOLA terrain rendering.

Values labeled solar power, array flux, DTE SNR, or radio-contact verdict are illustrative interface estimates. They are simple transforms of visibility/elevation and are **not** a solar-power model, communications link budget, or mission-validated result. Ephemeris sampling, one-degree horizon bins, interpolation, observer/site assumptions, and the terrain product's resolution also limit the analysis. Treat the app as a prototype for exploration, not mission-planning software.

The cost model is separate from the web app. It samples assumptions in `cost_mc.py` and produces P10/P50/P90 estimates plus a histogram; those assumptions and results are exploratory, not a validated mission cost forecast. The optional mask argument currently expects a JSON array of 360 elevation values. The terrain generator writes a JSON object containing that array under `mask_deg`, so extract that field before passing its output to the cost script.

## Regenerate analysis data

Python 3 is required. Install dependencies for the script you plan to run:
### Data scripts

The Python data scripts live in `backend/`. Run them from the top of the repo:

```bash
pip install requests numpy
python backend/ephemeris_fetch.py                        # Sun/Earth positions from JPL Horizons -> ephemeris_long/ and frontend/src/data/ephemeris/
python backend/cost_mc.py ephemeris_long/malapert.json   # cost model -> ephemeris_long/malapert_cost.json
```

`ephemeris_fetch.py` overwrites the ephemeris files the frontend reads, so check the visibility hours after re-running it.

### Validation

```sh
python -m pip install requests  # ephemeris_fetch.py
python -m pip install numpy     # lola_terrain.py and cost_mc.py
```

Fetch ephemerides (the default is 118.2 days of hourly samples beginning 2026-12-01):

```sh
python ephemeris_fetch.py
```

Optional arguments are duration in days and output directory. The script also updates the frontend site manifest and its bundled ephemeris files. It contacts the public JPL Horizons API; no API key is configured.

Generate LOLA horizon masks and terrain tiles (the first run downloads the 111 MB DEM):

```sh
python lola_terrain.py
```

Use `--dem path/to/LDEM_80S_80M.IMG` to point at a local DEM, or `--mast 3` to set observer height above ground in metres. Outputs go to `terrain/` and `frontend/src/data/horizon/`.

Run the Monte Carlo cost analysis against an ephemeris file:

```sh
python cost_mc.py ephemeris_long/malapert.json
```

Optionally pass a JSON file containing a 360-number horizon-mask array as the second argument. The result is written beside the ephemeris input with `_cost.json` appended to its filename.

## Current scope and next steps

Implemented: the browser-based surface explorer, site selection, timeline playback and visibility summaries, horizon-aware skyline rendering, comparison panel, and standalone Python data/cost scripts.

Not implemented: a backend/API, a reusable Python library or user-facing CLI, a dedicated full-screen graph view, a stationary-Moon celestial overview, or validated power, communications, and cost models. See the project overview plan for the intended direction and outstanding validation work.
