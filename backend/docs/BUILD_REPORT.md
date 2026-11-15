# Stargazer database build report

- Build id: `sg-8db7fb77e1eb`
- Database: `backend/data/stargazer.db` (written, marked read-only)
- Schema version: 1.0.0
- Skyline sigma: 0.3 deg. Cost seed: 42. Cost model re-run in this build: yes
- Input files: 22 (names and SHA-256 hashes are stored in `dataset_build.input_manifest_json`)

## Row counts

| table | rows |
| --- | --- |
| analysis | 6 |
| cost_anchor | 3 |
| cost_assumption | 45 |
| cost_histogram_bin | 360 |
| cost_metric | 27 |
| cost_run | 9 |
| data_source | 4 |
| ephemeris_run | 3 |
| ephemeris_sample | 17022 |
| horizon_bin | 1080 |
| horizon_profile | 3 |
| quality_flag | 15 |
| site | 3 |
| terrain_tile | 15 |
| visibility_sample | 34044 |
| visibility_summary | 270 |
| visibility_window | 256 |

## Quality flags raised

| severity | code | scope | fix order | message |
| --- | --- | --- | --- | --- |
| warning | COST_ANCHORS_UNVERIFIED | dataset | F7 | Delivery-price anchors with no recorded source: Peregrine, CP-22, IM-5. Fill source_url, verified_by and verified_on in backend/data/cost_sources.csv and rebuild. |
| warning | COST_RUN_FLAT_HORIZON | cost_run:1 | F1 | This cost run (ephemeris_long/malapert_cost.json) assumes a flat horizon and ignores terrain. Do not show it next to terrain-aware visibility without saying so. Use horizon_model=lola_mask for the terrain-aware run. |
| warning | COST_RUN_FLAT_HORIZON | cost_run:4 | F1 | This cost run (ephemeris_long/shackleton_cost.json) assumes a flat horizon and ignores terrain. Do not show it next to terrain-aware visibility without saying so. Use horizon_model=lola_mask for the terrain-aware run. |
| warning | COST_RUN_FLAT_HORIZON | cost_run:7 | F1 | This cost run (ephemeris_long/mons-mouton_cost.json) assumes a flat horizon and ignores terrain. Do not show it next to terrain-aware visibility without saying so. Use horizon_model=lola_mask for the terrain-aware run. |
| warning | SITE_LIST_DIFFERS_FROM_PLAN_DOC | dataset | F5 | STARGAZER_Project_Overview_Plan.md names 'Wiechert Circle' (and 'Shackleton Crater') as sites; the data has malapert, mons-mouton, shackleton. The database follows the data. See backend/docs/ADD_A_SITE.md to add a site; the team should correct the plan doc and slides. |
| info | BEST_OVERLAP_IN_EPHEMERIS_FILES_IS_FLAT | dataset | F2 | The best_overlap value inside ephemeris_long/*.json assumes a flat horizon (elevation > 0). It is not loaded. This database recomputes best overlap per lunar day for each horizon model; the website's getBestOverlap still reads the flat value until it is switched to the API. |
| info | COORDINATES_UNVERIFIED | site:malapert | F5 | Site coordinates and notes come from repo comments with no cited source. Add the citation to backend/data/site_notes.json to mark them verified. |
| info | COORDINATES_UNVERIFIED | site:mons-mouton | F5 | Site coordinates and notes come from repo comments with no cited source. Add the citation to backend/data/site_notes.json to mark them verified. |
| info | COORDINATES_UNVERIFIED | site:shackleton | F5 | Site coordinates and notes come from repo comments with no cited source. Add the citation to backend/data/site_notes.json to mark them verified. |
| info | HORIZONS_ALTITUDE_NOT_SITE_HEIGHT | site:malapert | F4 | The Horizons ephemeris was fetched for an observer at 0.00 km above the reference sphere; the LOLA ground height is 5.13 km. Terrain is handled by the horizon mask, not by the ephemeris. Upper bound on the direction error from the height difference (height / distance): about 0.00082 deg for Earth at its closest (356,400 km) and 0.0000020 deg for the Sun. Not yet checked against a re-fetch with the real altitude. |
| info | HORIZONS_ALTITUDE_NOT_SITE_HEIGHT | site:mons-mouton | F4 | The Horizons ephemeris was fetched for an observer at 0.00 km above the reference sphere; the LOLA ground height is 5.32 km. Terrain is handled by the horizon mask, not by the ephemeris. Upper bound on the direction error from the height difference (height / distance): about 0.00086 deg for Earth at its closest (356,400 km) and 0.0000021 deg for the Sun. Not yet checked against a re-fetch with the real altitude. |
| info | HORIZONS_ALTITUDE_NOT_SITE_HEIGHT | site:shackleton | F4 | The Horizons ephemeris was fetched for an observer at 0.00 km above the reference sphere; the LOLA ground height is 1.72 km. Terrain is handled by the horizon mask, not by the ephemeris. Upper bound on the direction error from the height difference (height / distance): about 0.00028 deg for Earth at its closest (356,400 km) and 0.0000007 deg for the Sun. Not yet checked against a re-fetch with the real altitude. |
| info | MASK_LOOKUP_RULES_DIFFER_IN_REPO | dataset | F3 | The website reads the skyline by linear interpolation between whole-degree bins; the committed cost_mc.py uses floor(azimuth). This database uses linear interpolation for all visibility and for the default terrain-aware cost run, and also stores a floor(azimuth) cost run so earlier numbers reproduce. |
| info | POINT_SOURCE_BODIES | dataset |  | The Sun and Earth are treated as points at their centres. The Sun's disc is about 0.5 degrees wide and the Earth's about 1.9 degrees as seen from the Moon, so real rises and sets are gradual. |
| info | UNCERTAINTY_IS_SKYLINE_ONLY | dataset |  | Optimistic and pessimistic windows shift the whole skyline by -/+ sigma (0.3 degrees unless changed, a team assumption). They do not include ephemeris error, the apparent size of the Sun or Earth, or site position error. |

## Validation

23 checks passed, 0 failed, 0 fixture mismatches.

- PASS: all expected tables exist
- PASS: exactly one dataset_build row
- PASS: 3 sites loaded
- PASS: ephemeris samples: row counts match, timestamps increase by one constant step
- PASS: azimuth in [0, 360) and elevation in [-90, 90] for every sample
- PASS: every horizon profile has 360 bins
- PASS: terrain tile blobs match their grid size
- PASS: each site has a flat and a lola_mask analysis
- PASS: one visibility sample per ephemeris sample per analysis
- PASS: is_visible agrees with clearance_deg > 0 everywhere
- PASS: flat analyses use a 0 degree horizon
- PASS: windows are ordered, do not overlap, and durations match their start and end
- PASS: pessimistic <= nominal <= optimistic visible hours in every summary
- PASS: 'both' hours never exceed Sun hours or Earth hours
- PASS: summary fractions and hours are within their period
- PASS: every analysis has a whole-coverage summary
- PASS: window hours agree with hourly sample counts within one hour per window
- PASS: cost percentiles are ordered (p10 <= p50 <= p90)
- PASS: histogram counts sum to the trials with a defined burn ratio
- PASS: no Infinity or NaN stored in cost tables
- PASS: each (site, horizon model) with cost runs has exactly one default run
- PASS: every cost run is attached to an analysis with the same horizon model
- PASS: every site has a terrain-aware cost run

## Fixture checks (section 10 of the brief)

- OK: coverage malapert: {'start_utc': '2026-12-01T00:00:00Z', 'end_utc': '2027-03-29T04:00:00Z', 'n_samples': 2837}
- OK: coverage shackleton: {'start_utc': '2026-12-01T00:00:00Z', 'end_utc': '2027-03-29T04:00:00Z', 'n_samples': 2837}
- OK: coverage mons-mouton: {'start_utc': '2026-12-01T00:00:00Z', 'end_utc': '2027-03-29T04:00:00Z', 'n_samples': 2837}
- OK: flat best overlap, lunar day 1, malapert (interpolated edges vs hourly count): 360.9 h from 2026-12-14T17:12:43Z
- OK: flat best overlap, lunar day 1, mons-mouton (interpolated edges vs hourly count): 409.4 h from 2026-12-12T22:17:23Z
- OK: flat best overlap, lunar day 1, shackleton (interpolated edges vs hourly count): 288.5 h from 2026-12-14T23:33:39Z
- OK: LOLA mask visible sample hours, lunar day 1 (709 samples), malapert: {'sun': 384, 'earth': 709, 'both': 384}
- OK: LOLA mask visible sample hours, lunar day 1 (709 samples), mons-mouton: {'sun': 360, 'earth': 585, 'both': 360}
- OK: LOLA mask visible sample hours, lunar day 1 (709 samples), shackleton: {'sun': 709, 'earth': 308, 'both': 308}
- OK: LOLA mask visible sample hours, whole coverage, malapert: {'sun': 1326, 'earth': 2837, 'both': 1326}
- OK: LOLA mask visible sample hours, whole coverage, mons-mouton: {'sun': 1302, 'earth': 2187, 'both': 1157}
- OK: LOLA mask visible sample hours, whole coverage, shackleton: {'sun': 2434, 'earth': 1219, 'both': 1212}
- OK: longest Sun-dark stretch (hourly samples), malapert: 433
- OK: longest Sun-dark stretch (hourly samples), mons-mouton: 394
- OK: longest Sun-dark stretch (hourly samples), shackleton: 136
- OK: cost, flat horizon (committed file), malapert: {'burn': [0.344, 0.444, 0.572], 'usable_h_p50': 361, 'alive_days_p50': 18.1, 'landing_time_utc': '2026-12-14T18:00:00Z'}
- OK: cost, flat horizon (committed file), mons-mouton: {'burn': [0.302, 0.39, 0.503], 'usable_h_p50': 409, 'alive_days_p50': 17.5, 'landing_time_utc': '2026-12-12T23:00:00Z'}
- OK: cost, flat horizon (committed file), shackleton: {'burn': [0.168, 0.236, 0.376], 'usable_h_p50': 698, 'alive_days_p50': 73.5, 'landing_time_utc': '2026-12-01T00:00:00Z'}
- OK: cost, LOLA mask, floor(azimuth) lookup, seed 42, malapert: {'burn': [0.323, 0.418, 0.542], 'usable_h_p50': 384, 'alive_days_p50': 16.5, 'landing_time_utc': '2026-12-13T02:00:00Z'}
- OK: cost, LOLA mask, floor(azimuth) lookup, seed 42, mons-mouton: {'burn': [0.341, 0.441, 0.568], 'usable_h_p50': 361, 'alive_days_p50': 15.5, 'landing_time_utc': '2026-12-15T04:00:00Z'}
- OK: cost, LOLA mask, floor(azimuth) lookup, seed 42, shackleton: {'burn': [0.212, 0.357, 0.62], 'usable_h_p50': 309, 'alive_days_p50': 32.2, 'landing_time_utc': '2026-12-01T00:00:00Z'}

## Cost per usable hour under each horizon and mask-lookup rule (fix orders F1 and F3)

$M per usable hour, p10 / p50 / p90. Usable hours p10 / p50 / p90. Seed 42.

| site | run | burn p10 / p50 / p90 | usable h p10 / p50 / p90 | alive days p50 | landing (UTC) | P(zero usable h) |
| --- | --- | --- | --- | --- | --- | --- |
| malapert | flat horizon (committed file) | 0.344 / 0.444 / 0.572 | 343 / 361 / 368 | 18.1 | 2026-12-14T18:00:00Z | 0.0 |
| malapert | LOLA mask, floor(azimuth) lookup (parity) | 0.323 / 0.418 / 0.542 | 359 / 384 / 389 | 16.5 | 2026-12-13T02:00:00Z | 0.0 |
| malapert | LOLA mask, linear lookup (default) | 0.323 / 0.417 / 0.540 | 361 / 384 / 389 | 16.5 | 2026-12-13T03:00:00Z | 0.0 |
| shackleton | flat horizon (committed file) | 0.168 / 0.236 / 0.376 | 444 / 698 / 832 | 73.5 | 2026-12-01T00:00:00Z | 0.0 |
| shackleton | LOLA mask, floor(azimuth) lookup (parity) | 0.212 / 0.357 / 0.620 | 296 / 309 / 635 | 32.2 | 2026-12-01T00:00:00Z | 0.079 |
| shackleton | LOLA mask, linear lookup (default) | 0.210 / 0.344 / 0.619 | 295 / 310 / 639 | 32.3 | 2026-12-01T00:00:00Z | 0.077 |
| mons-mouton | flat horizon (committed file) | 0.302 / 0.390 / 0.503 | 392 / 409 / 418 | 17.5 | 2026-12-12T23:00:00Z | 0.0 |
| mons-mouton | LOLA mask, floor(azimuth) lookup (parity) | 0.341 / 0.441 / 0.568 | 350 / 361 / 368 | 15.5 | 2026-12-15T04:00:00Z | 0.0 |
| mons-mouton | LOLA mask, linear lookup (default) | 0.342 / 0.442 / 0.569 | 349 / 360 / 367 | 15.5 | 2026-12-15T05:00:00Z | 0.0 |

## Notes

- malapert: terrain/malapert_horizon.json agrees with the website mask within 0.0050 deg; blocker and coverage distances loaded.
- shackleton: terrain/shackleton_horizon.json agrees with the website mask within 0.0050 deg; blocker and coverage distances loaded.
- mons-mouton: terrain/mons-mouton_horizon.json agrees with the website mask within 0.0050 deg; blocker and coverage distances loaded.

## Fix orders (section 4.1 of the brief)

Status words: Implemented = written; Tested = covered by backend/tests (run `python -m pytest backend/tests`); Needs team = waiting on a team action. Nothing here is Validated: no result has been compared with an independent reference beyond the JPL Horizons values it was computed from.

| order | status | evidence | left for the team |
| --- | --- | --- | --- |
| F1 cost uses the same horizon as visibility | Tested | 3/3 sites have a terrain-aware default cost run. Flat re-runs reproduce the committed files (3 fixture checks OK). LOLA re-runs with the original lookup match the brief's fixtures (3 OK). /cost defaults to lola_mask and returns 404 rather than falling back; /compare uses one horizon model (tests/test_api.py). Build gate tested (tests/test_build.py). Patch: backend/patches/cost_mc.patch, checked against the database by running it from the command line. | Apply the cost_mc.py patch, regenerate and commit the cost JSONs, and stop quoting the flat-horizon numbers. |
| F2 best overlap is terrain-aware | Tested (database and API); patch Implemented | best_overlap from the ephemeris files is not loaded. It is recomputed per lunar day and horizon model, with optimistic and pessimistic durations (3 flat fixture checks OK, 6 terrain sample-hour checks OK). The ephemeris_fetch.py rename is a patch that compiles but has not been run against Horizons. | Switch the website's getBestOverlap to the API value (see backend/README.md). Apply the rename with that change. |
| F3 one mask-lookup rule | Tested | derive.skyline_at is the only lookup; the cost step imports it. Both rules are in the cost table above. The rule is stored on every analysis and cost_run row. | None. |
| F6 optional inputs | Tested | Missing blocker distances or tiles raise a flag and are never invented (tests/test_build.py). In this build: 3/3 sites have blocker distances, 3/3 have height tiles. The two mask files are compared (limit 0.01 deg) before blocker distances are loaded. | terrain/ is git-ignored: run python lola_terrain.py on any machine that needs blocker distances. |
| F4 Horizons altitude | Implemented; Needs team | observer_alt_km_used is stored; an info flag carries the parallax bound (height / distance). The ephemeris_fetch.py patch reads the altitude from the horizon file; it compiles but has not been run against Horizons. | Re-fetch one site with its real altitude (Mons Mouton, 5.32 km) and compare with the stored values. Under 0.01 deg: close the flag. Also confirm the 'Center radii' line in the Horizons reply says 1737.4 km. |
| F7 unverified cost anchors | Tested (loader rule); Needs team | Anchors come from backend/data/cost_sources.csv. A row counts as verified only with source_url and verified_on. All anchors are currently unverified and shown as such by /cost. | Fill source_url, verified_by and verified_on for each anchor, then rebuild. |
| F5 site list conflict | Implemented; Needs team | landingSites.json is the only source of site rows. backend/docs/ADD_A_SITE.md has the steps. A warning flag is raised while the plan doc still names Wiechert Circle. | Decide the third site, correct the plan doc and slides, and cite a source for each coordinate. |
