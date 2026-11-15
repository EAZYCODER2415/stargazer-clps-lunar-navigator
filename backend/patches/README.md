# Proposed changes to the team's scripts

Nothing in `backend/cost_mc.py` or `backend/ephemeris_fetch.py` was edited. These are the changes the
fix orders call for, as patches for the team to review and apply. The database build works with the
scripts as they are today and with the patched versions.

| file | fix orders | status |
| --- | --- | --- |
| `cost_mc.patch` | F1.3, F3.1 | Tested: run from the command line it reproduces the committed flat files, the section 10 fixtures, and the runs stored in the database (`tests/test_build.py`) |
| `ephemeris_fetch.patch` | F2.3, F4.2 | Implemented. The renamed function and the altitude lookup are tested offline. The Horizons fetch itself has not been run. |

`*.patched.py` are the full files after the patch, for reading or for copying over the originals.

## Applying

From the top of the repo. The working copies on Windows have CRLF line endings, hence the option:

```bash
git apply --ignore-whitespace backend/patches/cost_mc.patch
git apply --ignore-whitespace backend/patches/ephemeris_fetch.patch
```

If `git apply` refuses, copy the patched file over the original instead:

```bash
cp backend/patches/cost_mc.patched.py backend/cost_mc.py
cp backend/patches/ephemeris_fetch.patched.py backend/ephemeris_fetch.py
```

## What `cost_mc.patch` changes

- Reads the horizon file as `lola_terrain.py` writes it (a dict with `mask_deg`) as well as a bare list.
- Uses the site's real skyline by default when `frontend/src/data/horizon/<site>.json` exists.
  `--flat` gives the old flat-horizon behaviour. `--mask FILE` picks a specific mask.
- Reads the skyline with `derive.skyline_at`, linear between bins like the website.
  `--lookup nearest_lower_bin` reproduces earlier masked runs.
- `--seed N` (default 42). `run(..., seed=N)` restarts the generator, so a run inside another program
  matches a command-line run.
- Writes `horizon_model`, `horizon_lookup` and `seed` into the output, and names the output
  `<site>_cost_lola_mask.json` or `<site>_cost_flat.json` so the two cannot be mixed up.

After applying, regenerate and commit:

```bash
python backend/cost_mc.py ephemeris_long/malapert.json
python backend/cost_mc.py ephemeris_long/shackleton.json
python backend/cost_mc.py ephemeris_long/mons-mouton.json
```

`build_db.py` picks up `ephemeris_long/<site>_cost_lola_mask.json` when it is run without `--rerun-cost`.

## What `ephemeris_fetch.patch` changes

- Renames `calculate_longest_sun_earth_overlap` to `calculate_longest_sun_earth_overlap_flat_horizon`
  and the JSON key `best_overlap` to `best_overlap_flat_horizon`.
  **The website reads `best_overlap` today** (`getBestOverlap` in `ephemerisRuntime.js`). Apply this
  patch together with switching the website to the API value, or the best-overlap button loses its data.
- Uses each site's LOLA ground height as the observer altitude sent to Horizons, when the horizon file
  exists, and writes `observer_alt_km_used` into the output. `--sphere-altitude` keeps altitude 0.
  Re-running the fetch overwrites the ephemeris files the website reads, so check the visibility
  hours afterwards. Before relying on it, do the F4 check: re-fetch Mons Mouton and compare with the
  stored values; the expected change is under 0.001 degrees.
