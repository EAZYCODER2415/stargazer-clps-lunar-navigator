# Stargazer backend: read-only database and API

One calculation pipeline, computed once at build time, served from a database. The website, the
Python library and the CLI can all read the same numbers from here.

```
OFFLINE (you run)                                     RUNTIME (read-only)
backend/ephemeris_fetch.py -> ephemeris_long/*.json --+
lola_terrain.py            -> horizon/*.json, tiles --+--> scripts/build_db.py --> data/stargazer.db --> FastAPI --> website
backend/cost_mc.py         -> cost runs --------------+     (validate + derive)                          +--> Python / CLI
```

Status on 15 Nov 2026: **Implemented and Tested** (99 automated tests). **Not Validated**: nothing has
been compared with an independent reference beyond the JPL Horizons values it was computed from.
See `docs/BUILD_REPORT.md` for the last build and the status of each fix order.

## Quick start

Run everything from the top of the repo. Python 3.11 or newer.

```bash
pip install -r backend/requirements.txt

python backend/scripts/build_db.py --rerun-cost      # builds backend/data/stargazer.db and docs/BUILD_REPORT.md
python -m pytest backend/tests                       # 99 tests, about 10 seconds

python -m uvicorn app.main:app --app-dir backend --reload
# then open http://127.0.0.1:8000/api/v1/docs
```

`build_db.py` is the only program that writes the database. It writes to a temporary file, checks
it, renames it into place and marks it read-only.

The database layer is Python's built-in `sqlite3` (wrapped in `sqlitedb.py`), not SQLAlchemy. The
brief asked for SQLAlchemy, and the first version used it, but its compiled extensions are unsigned
and Windows 11 Smart App Control refused to load them on a team laptop ("An Application Control
policy has blocked this file"), which stopped the backend from starting. The only compiled packages
the backend needs now are numpy (build step) and pydantic.

## What is in the database

| data | source | rows now |
| --- | --- | --- |
| Sun and Earth azimuth/elevation, hourly, 2026-12-01 to 2027-03-29 | JPL Horizons via `ephemeris_fetch.py` | 2837 per body per site |
| 360-bin terrain skyline per site | NASA LOLA `LDEM_80S_80M` via `lola_terrain.py` | 360 per site |
| Height tiles (5 nested levels per site on `real-terrain`; none committed on `main` yet) | same | 15 |
| Clearance and visibility for every sample, flat and terrain-aware | derived here | 34,044 |
| Visibility windows (Sun, Earth, both) for 3 skyline scenarios | derived here | 256 |
| Summaries per lunar day and for the whole coverage | derived here | 270 |
| Cost runs: flat, LOLA mask (linear lookup), LOLA mask (floor lookup) | `cost_mc.py` | 9 |

Schema: `schema/schema.sql`. All formulas: `derive.py` (one module, so there is one method to cite).

## Conventions

- Times are UTC, ISO 8601 (`2026-12-15T06:00:00Z`). Rise and set times resolve to one second.
- Azimuth: degrees, 0 = north, 90 = east, clockwise. Elevation: degrees above the local horizontal.
- Longitude: degrees east, 0 to 360.
- A body is **geometrically visible** when `elevation > skyline at its azimuth`. The body is a point at
  its centre; the Sun's disc (about 0.5 degrees) and the Earth's (about 1.9 degrees) are not modelled.
- The skyline between whole-degree bins is read by **linear interpolation** (`linear_between_bins`),
  the same rule the website uses.
- One lunar day = 29.53 days = 708.72 hours.
- "Geometric visibility" is not electrical power and not a working radio link. There are no power or
  link-budget columns, on purpose.

## Horizon models: never mixed

Every analysis and every cost run is stored with an explicit `horizon_model`:

- `lola_mask` (default): the real LOLA skyline.
- `flat`: a 0-degree horizon, kept for comparison and for reproducing old numbers.

The API never substitutes one for the other. `/cost` returns 404 if the requested model has no cost
run. `/compare` uses one model for the whole payload and echoes it. Every response says which model
it used in `meta.horizon_model`.

## Uncertainty scenarios

Each window is computed three times: `nominal`, `optimistic` (whole skyline lowered by sigma) and
`pessimistic` (raised by sigma). Sigma is 0.3 degrees, the `HORIZON_SD_DEG` team assumption from
`cost_mc.py`. `scenario=all` returns each nominal window with an `uncertainty` block: earliest and
latest start, earliest and latest end, minimum and maximum duration. A value is `null`, with a note,
when the pessimistic window vanishes or splits, or the optimistic one merges with a neighbour.

This covers skyline error only. It does not include ephemeris error, disc size or site position error.

## Endpoints

All under `/api/v1`, GET only. Interactive docs at `/api/v1/docs`; the contract is in `openapi.json`.

| endpoint | what it returns |
| --- | --- |
| `/health` | liveness and whether the database is built |
| `/meta` | build id, coverage, conventions, row counts, input file hashes, every quality flag |
| `/sources` | provenance of each data source |
| `/sites`, `/sites/{id}` | coordinates, ground height, skyline stats, coverage, available cost runs |
| `/sites/{id}/horizon` | 360 skyline bins, blocker distances, sigma |
| `/sites/{id}/terrain-tile?level&stride` | local heightmap in metres relative to the site (about 10 km x 10 km by default; 404 if no tiles are loaded) |
| `/sites/{id}/ephemeris?body&start&end&step&format` | hourly az, el, skyline, clearance, is_visible |
| `/sites/{id}/solar-elevation?at` | Sun position, skyline and clearance at one time, for all three scenarios |
| `/sites/{id}/position?at&body` | the same for the Sun or the Earth (an addition to the brief) |
| `/sites/{id}/visibility/windows?body&start&end&month&scenario&format` | windows for sun, earth or both |
| `/sites/{id}/visibility/summary?start&days&lunar_day` | hours, fraction, longest window, longest gap, best overlap |
| `/sites/{id}/visibility/next-transition?body&after` | next rise or set, with azimuth |
| `/sites/{id}/cost?horizon_model&horizon_lookup` | p10/p50/p90, histogram, assumptions, anchors, caveats |
| `/compare?sites&start&days&lunar_day&horizon_model` | per-site summaries, windows and cost percentiles |

Useful details:

- `format=columns` returns `{column: [values]}`, which `pandas.DataFrame` accepts directly.
  `format=csv` on `/ephemeris` and `/visibility/windows` downloads a CSV file (data export).
- `month=2027-01` on `/visibility/windows` is a shortcut for one calendar month.
- Responses are capped at 3000 rows. `page.next_offset` says how to get the next page.
- Times outside the coverage return 422 `out_of_coverage` with the coverage. The API never extrapolates.
- Errors always look like `{"error": {"code": "...", "message": "..."}}`.
- Each response has an `ETag` built from the dataset build id and the URL, `Cache-Control`, and
  `X-Dataset-Build`. The data cannot change within a build, so a matching `If-None-Match` gets a 304.

### Every response has a `meta` block

`dataset_build_id`, `schema_version`, `time_scale`, `conventions`, `horizon_model`,
`mask_interpolation`, `sources`, `quality_flags` and the plain-language `caveat`. Quality flags are
filtered to the sites and cost runs in the response; `/meta` returns all of them.

## Read-only, in three layers

1. Only `scripts/build_db.py` writes, offline. The finished file is marked read-only.
2. The API opens SQLite with `mode=ro` and `PRAGMA query_only=ON` (`sqlitedb.py`, `app/db.py`). A test
   tries INSERT, UPDATE, DELETE, DROP and CREATE through the API's own connection and each one fails.
3. The API has GET routes only, and a guard that answers 405 to every other method. There is no
   raw-SQL endpoint. All SQL is parameterised.

## Python client example

```python
import httpx

API = "http://127.0.0.1:8000/api/v1"
with httpx.Client(base_url=API, timeout=30) as api:
    sites = [s["site_id"] for s in api.get("/sites").json()["sites"]]
    for site in sites:
        summary = api.get(f"/sites/{site}/visibility/summary", params={"lunar_day": 1}).json()
        cost = api.get(f"/sites/{site}/cost").json()
        both = summary["bodies"]["both"]["visible_hours"]
        burn = cost["metrics"]["burn_musd_per_usable_h"]
        print(f"{site:12s} Sun+Earth {both:6.1f} h   ${burn['p10']}M / ${burn['p50']}M / ${burn['p90']}M per usable hour")
    table = api.get("/sites/shackleton/ephemeris", params={"body": "sun", "format": "columns", "step": 6}).json()
    # pandas.DataFrame(table["columns"]) gives a ready table
    print(summary["meta"]["caveat"])
```

The Python library and CLI themselves are out of scope here; this is the shape they would wrap.

## Handoff to the frontend

Nothing in `frontend/` was changed. Three things to know:

1. **Best overlap (fix order F2).** The comparison panel shows `best_overlap` from the ephemeris JSON,
   which assumes a flat horizon, next to terrain-masked Sun and Earth hours in the same card. Switch
   `getBestOverlap` in `frontend/src/utils/ephemerisRuntime.js` to
   `GET /api/v1/sites/{id}/visibility/summary?lunar_day=1` and read `best_overlap.start_utc` and
   `best_overlap.duration_h`. With real terrain the numbers change a lot, for example Mons Mouton
   goes from 409 h to about 361 h and Malapert from 361 h to about 384 h.
2. **Cost.** The committed `ephemeris_long/*_cost.json` files are flat-horizon runs. Use
   `GET /api/v1/sites/{id}/cost` (terrain-aware by default) and plot `histogram.bins`.
3. **Not calling the API yet?** `python backend/scripts/export_frontend_json.py` writes
   `backend/data/export/<site>.json` with the terrain-aware best overlap, hours and cost for both
   horizon models. Import those instead.

CORS allows `http://localhost:5173` by default. Set `STARGAZER_CORS_ORIGINS` for a deployed site.

## Settings (environment variables)

| variable | default | meaning |
| --- | --- | --- |
| `STARGAZER_DATABASE_URL` | `sqlite:///backend/data/stargazer.db` (absolute) | `sqlite:///path` or a plain file path |
| `STARGAZER_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | comma-separated origins |
| `STARGAZER_MAX_ROWS` | `3000` | row cap per response |
| `STARGAZER_CACHE_MAX_AGE` | `3600` | seconds in `Cache-Control` |

To host it: build the database as part of the deploy, then
`python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000`.

## Things you should not read into the numbers

- **Flat versus terrain-aware.** Flat-horizon values ignore terrain. They are labelled wherever they
  appear and flagged with a warning.
- **"Both" windows versus usable hours.** Sun+Earth `both` windows are pure geometry and ignore whether
  a lander would still be alive. The cost model's usable hours count only hours while the lander is
  alive, so they are lower.
- **Modelled uncertainty versus true error.** The optimistic and pessimistic windows move the skyline
  only.
- **Window edges versus single-time lookups.** Rise and set times come from linear interpolation of the
  hourly clearance. `/solar-elevation` interpolates the position and then reads the skyline at that
  azimuth. Near a jagged skyline the two can differ by a few minutes.
- **Burn ratio in a trial with zero usable hours** is undefined. Those trials are left out of the
  percentiles and the histogram and reported in `p_zero_usable_hours` (7.7% at Shackleton rim).
- **Horizons altitude.** The ephemeris was fetched for an observer at altitude 0, while the sites are
  1.7 to 5.3 km up. Terrain is handled by the mask. The direction error from the height difference is
  at most height / distance: about 0.0009 degrees for the Earth at its closest (356,400 km) for Mons
  Mouton, and about 0.000002 degrees for the Sun. This bound has not been checked against a re-fetch.

## Fix orders, in one place

| order | where it is done |
| --- | --- |
| F1 cost on the same horizon | `cost_step.py`, `build_db.py --rerun-cost`, `/cost`, `/compare`, `patches/cost_mc.patch` |
| F2 terrain-aware best overlap | `visibility_summary`, `best_overlap` in `/visibility/summary`, `patches/ephemeris_fetch.patch` |
| F3 one mask lookup | `derive.skyline_at`; both rules reported in `docs/BUILD_REPORT.md` |
| F4 Horizons altitude | flag `HORIZONS_ALTITUDE_NOT_SITE_HEIGHT`, `patches/ephemeris_fetch.patch` |
| F5 site list | `docs/ADD_A_SITE.md`, flag `SITE_LIST_DIFFERS_FROM_PLAN_DOC` |
| F6 optional inputs | loader flags `BLOCKER_DISTANCE_MISSING`, `TERRAIN_TILE_MISSING`, `MASK_FILES_DISAGREE` |
| F7 cost anchors | `data/cost_sources.csv`, `anchors` in `/cost` |

`patches/README.md` explains how to apply the two script patches.

## Layout

```
backend/
  derive.py                 every formula: skyline lookup, clearance, windows, summaries, uncertainty
  sqlitedb.py               thin layer over Python's built-in sqlite3 (read-only open, named parameters)
  cost_step.py              runs cost_mc.py for the build without changing it
  schema/schema.sql         the database schema
  scripts/build_db.py       builds the database (the only writer)
  scripts/validate_db.py    checks a built database, read-only
  scripts/export_openapi.py writes openapi.json
  scripts/export_frontend_json.py   static JSON for a frontend not calling the API yet
  app/                      FastAPI app: main, config, db, schemas, routers/, services/
  tests/                    pytest: derive, build, API; fixtures from section 10 of the brief
  data/                     stargazer.db (git-ignored), cost_runs/, cost_sources.csv, site_notes.json
  patches/                  proposed changes to cost_mc.py and ephemeris_fetch.py
  docs/                     M0_DESIGN_NOTE.md, BUILD_REPORT.md, ADD_A_SITE.md
  openapi.json              the API contract
```

## Not done

- Earth range and light time, apparent angular sizes, shadow-length ratio (future work; Horizons can
  supply range).
- PostgreSQL profile and Dockerfile (P2 in the brief). The backend is SQLite-only: it uses Python's
  built-in `sqlite3`, and the schema uses `WITHOUT ROWID`. The SQL itself is plain and parameterised.
- More sites, arbitrary coordinates, other start dates (P2). `docs/ADD_A_SITE.md` covers adding a site.
- The Python library and CLI.
- Hosting.
