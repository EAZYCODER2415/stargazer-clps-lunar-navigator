# M0 design note: Stargazer read-only backend

Written 15 Nov 2026 against the repo as it was on the `real-terrain` branch (scripts already in
`backend/`). The ephemeris files, horizon masks and both scripts are identical on `main`; only the
terrain tiles differ (row 2 below). The brief's stages M0 to M3 were built in one pass at the team's request, so this note
records the decisions rather than asking for a "go".

## Design in five lines

1. `scripts/build_db.py` reads the files the team already produces, validates them, derives
   everything once and writes `data/stargazer.db` (SQLite, one file, atomic rename, marked read-only).
2. Every formula lives in `derive.py`. The build, the cost step and the API import it.
3. The API (`app/`) does lookups, interval clipping and linear interpolation only.
4. Every analysis and cost run carries an explicit `horizon_model` (`flat` or `lola_mask`). The API
   never substitutes one for the other.
5. Problems are stored as `quality_flag` rows and returned in `meta.quality_flags`, not hidden.

## Where I disagree with the brief, and what I did instead

| # | brief | what the repo or the data shows | decision |
| --- | --- | --- | --- |
| 1 | F6: prefer `terrain/<id>_horizon.json` (3 decimals) for the mask | The website reads `frontend/src/data/horizon/<id>.json` (2 decimals). With the 3-decimal mask, Mons Mouton's whole-coverage Earth hours are 2188, not the 2187 in section 10 and on the website. | The website's mask is the canonical skyline. `terrain/<id>_horizon.json` supplies only `blocker_km` and `covered_km`, after checking the two masks agree within 0.01 degrees (they differ by at most 0.005). Website and database cannot disagree. |
| 2 | One `terrain/<site>_tile.json`, 129 x 129, 10 km | True on `main`. On the `real-terrain` branch (PR open on 15 Nov) `lola_terrain.py` writes five nested levels per site as int16 in `frontend/src/data/terrain/<id>.bin` + `.json` instead. | `terrain_tile` has one row per level (int16 blob). The loader reads the nested tiles when they exist and falls back to `terrain/<id>_tile.json`. `/terrain-tile` with no parameters returns about 10 km x 10 km at up to 129 x 129 points from either. On `main` today neither file is committed, so `/terrain-tile` answers 404 until `lola_terrain.py` is run or the terrain PR is merged. |
| 3 | Check "histogram counts sum to `trials`" | Burn is undefined in a trial with zero usable hours, and `cost_mc.py` leaves those trials out of the histogram. Shackleton with the LOLA mask has 7.7% such trials (9231 of 10,000 counted). | The check is "counts sum to the trials with a defined burn ratio", and that this number is consistent with `p_zero_usable_hours`. `cost_run.n_finite_trials` stores it. |
| 4 | Scripts at the repo root | `cost_mc.py` and `ephemeris_fetch.py` are in `backend/`. | Paths follow the repo. Patches are written against `backend/`. |
| 5 | Lunar-day index 1 to 4 | 4 x 708.72 h = 2834.88 h; the data covers 2836 h, leaving a 1.1 h stub. | A period counts as a lunar day only if the data covers at least 99% of it. Four days now; a one-lunar-day file (708 h) still gets day 1. |
| 6 | `cost_metric.mean` | `cost_mc.py` does not report a mean and the brief says not to rewrite it. | `mean` is NULL. |
| 7 | SQLAlchemy 2.x, portable to PostgreSQL by changing the URL | On the first native Windows run (Python 3.14.2, SQLAlchemy 2.1.8) Windows 11 Smart App Control blocked SQLAlchemy's compiled extensions (`_cache_key_cy`, `_result_cy`): "An Application Control policy has blocked this file". `DISABLE_SQLALCHEMY_CEXT_RUNTIME=1` did not help. numpy and pydantic loaded normally. | SQLAlchemy is removed. `sqlitedb.py` wraps Python's built-in `sqlite3` with the same call shape (`conn.execute(text("... :name"), params)`), so every query is still parameterised. SQLite only; a PostgreSQL profile (P2) would mean putting a driver behind `sqlitedb.py`. |
| 8 | Rerun cost "re-seed per site" | The committed script draws from one module-level generator. | `cost_step.py` replaces `cost_mc.rng` with `default_rng(seed)` before each run. Flat re-runs reproduce the committed files exactly, and nearest-lower-bin re-runs match section 10 exactly. |

Additions the brief did not ask for (all small): `/sites/{id}/position` (the Earth as well as the Sun at
one time), `month=YYYY-MM` and `format=csv` on windows, `format=csv` on ephemeris (William asked for
windows by month and a data export), `lunar_day=` on summary and compare, and
`scripts/export_frontend_json.py`.

## Schema changes from the brief

- `quality_flag.fix_order`: which fix order a flag belongs to.
- `horizon_profile.mask_source_file`: which file the bins came from.
- `terrain_tile`: `(site_id, level_index)` key, int16 blob, `spacing_m`, `scale_m` (see 2 above).
- `analysis.sigma_deg`, `analysis.crossing_method`, `UNIQUE (site_id, horizon_model)`.
- `visibility_window`: `earliest_start_utc`, `latest_start_utc`, `earliest_end_utc`, `latest_end_utc`,
  `min_duration_h`, `max_duration_h`, `uncertainty_note`, filled for nominal windows. The match is
  precomputed, as the brief asks for everything derived.
- `visibility_summary`: `period_hours`, `longest_window_start_utc`, `longest_window_end_utc`, so best
  overlap is a lookup.
- `cost_run`: `is_default`, `n_finite_trials`, `source_file`, `horizon_lookup` limited to three values,
  `UNIQUE (site_id, horizon_model, horizon_lookup)`.
- `cost_anchor`: the delivery-price anchors with their verification status (F7).

## Section 4 flags and the plan for each fix order

| flag in the brief | quality flag code | fix order | plan |
| --- | --- | --- | --- |
| Committed cost JSONs are flat | `COST_RUN_FLAT_HORIZON` (warning) | F1 | Load them as `flat`. Re-run with the mask in the build. `/cost` defaults to `lola_mask`. Patch `cost_mc.py`. Build fails if a site has terrain-aware visibility but no terrain-aware cost. |
| `best_overlap` is flat | `BEST_OVERLAP_IN_EPHEMERIS_FILES_IS_FLAT` (info) | F2 | Never load it. Recompute per lunar day and horizon model. Patch the name in `ephemeris_fetch.py`. Write the frontend handoff. |
| Mask lookup differs | `MASK_LOOKUP_RULES_DIFFER_IN_REPO` (info) | F3 | One function, `derive.skyline_at`. Linear by default, floor kept for parity. Both reported. |
| Horizons `alt_km = 0` | `HORIZONS_ALTITUDE_NOT_SITE_HEIGHT` (info) | F4 | Store the altitude used, state the parallax bound, patch the script. The re-fetch check needs the network and is a team action. |
| Wiechert Circle vs Mons Mouton | `SITE_LIST_DIFFERS_FROM_PLAN_DOC` (warning) | F5 | Follow the data. `docs/ADD_A_SITE.md`. |
| Missing optional inputs | `BLOCKER_DISTANCE_MISSING`, `TERRAIN_TILE_MISSING`, `MASK_FILES_DISAGREE` | F6 | Load when present, flag when absent, never invent. |
| Cost anchors have no sources | `COST_ANCHORS_UNVERIFIED` (warning) | F7 | `data/cost_sources.csv` for the team; a row is verified only with a URL and a date. |

Two more flags I added: `UNCERTAINTY_IS_SKYLINE_ONLY` and `POINT_SOURCE_BODIES`, because both limit
how the windows should be read. Also `COORDINATES_UNVERIFIED` per site.

## Assumptions

- Sigma for the optimistic and pessimistic scenarios is `HORIZON_SD_DEG` read from `cost_mc.py`
  (0.3 degrees). The same shift is applied to the flat horizon so both models have all three scenarios.
- The skyline shift is applied to the whole skyline at once (fully correlated), as `cost_mc.py` does.
- Crossing times are rounded to one second, so durations computed later from stored times are exact.
- Clearance and skyline are stored to 6 decimals, the precision of the Horizons values.
- The other cost assumptions with a factual claim in a code comment but no recorded source (cost
  growth, battery endurance) are marked `needs_verification`, not `team_assumption`.
- Site notes come from comments in `ephemeris_fetch.py` and live in `data/site_notes.json`, so adding
  or correcting a site is a data change.
- The Horizons retrieval time is not recorded in the files, so `retrieved_utc` is NULL.
- The Moon's reference radius: Horizons output reports the Moon's radii as 1737.4 km, the same sphere
  LOLA heights use. I did not confirm this from a live reply for an observer on the Moon; the F4 team
  action includes reading the `Center radii` line.

## What I could not do here

- Call JPL Horizons (no network to it from the build machine). Everything about the patched
  `ephemeris_fetch.py` that needs a fetch is Implemented, not Tested.
- Run `lola_terrain.py` end to end (the 111 MB map was not copied). Its outputs in the repo were used
  as they are.
- Run the full suite on native Windows myself. It was run on Linux (Python 3.13 and 3.10). The first
  Windows run by the team exposed the SQLAlchemy block described in row 7; the code avoids POSIX-only
  calls and non-ASCII output and handles the read-only file replace.
