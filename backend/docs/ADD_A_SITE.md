# Adding or changing a landing site

`frontend/src/data/landingSites.json` is the only source of site rows in the database. No code in
`backend/scripts` or `backend/app` names a site. Adding a site is a data change.

`ephemeris_fetch.py` rewrites `landingSites.json` from its own `SITES` list each time it runs, so the
list to edit is the one in that script.

## Steps

1. **Add the site to `SITES` in `backend/ephemeris_fetch.py`.**
   Give it an `id` (lower case, hyphens, no spaces; it becomes part of URLs and file names), a `name`,
   `lon` (degrees east) and `lat` (degrees, south negative). Leave `alt_km` at 0.0.

2. **Fetch the ephemeris** (needs the network, about a minute per site):

   ```bash
   python backend/ephemeris_fetch.py
   ```

   This writes `ephemeris_long/<id>.json`, `frontend/src/data/ephemeris/<id>.json` and updates
   `landingSites.json`. It refetches every site, so check the visibility hours of the existing sites
   afterwards.

3. **Compute the terrain skyline and tiles** (downloads the 111 MB LOLA map into `lola_cache/` on the
   first run):

   ```bash
   python lola_terrain.py
   ```

   This writes `frontend/src/data/horizon/<id>.json`, `frontend/src/data/terrain/<id>.json` + `.bin`
   and `terrain/<id>_horizon.json`. The site must be south of 80 S: the map stops there.

4. **Rebuild the database, with the cost model re-run for the new site:**

   ```bash
   python backend/scripts/build_db.py --rerun-cost
   ```

   The build fails with a clear message if a required file for the new site is missing.

5. **Optional: add notes and a source for the coordinates** in `backend/data/site_notes.json`, keyed by
   the site id. Set `coordinate_source` to the citation and `coordinate_status` to `verified`. Until
   then the site is served with `coordinate_status: "unverified"` and an info flag.

6. **Check it:**

   ```bash
   python backend/scripts/validate_db.py
   python -m pytest backend/tests
   ```

   Some tests name the three current sites and their fixture numbers. Adding a site makes the tests
   that list all sites fail until the expected list is updated in `backend/tests/test_api.py`
   (`SITES`) and `backend/tests/test_build.py`. The section 10 fixtures cover the original three sites
   only and are skipped for others.

7. **Frontend:** the website imports each site's JSON by name in
   `frontend/src/utils/ephemerisRuntime.js` and `terrainTiles.js`. Add the new imports there.

## Replacing Mons Mouton with Wiechert Circle

The plan doc names "Wiechert Circle" as the third site; the data has Mons Mouton. If Wiechert is the
intended site, replace the Mons Mouton entry in `SITES` (step 1) with Wiechert's coordinates from a
cited source, delete the old `mons-mouton` files, and follow steps 2 to 7. Then correct the plan doc
and the slides so they match the data. I did not add Wiechert: I have no cited coordinates for it,
and the brief says not to invent data.

## Removing a site

Remove it from `SITES`, delete its files under `ephemeris_long/`, `frontend/src/data/ephemeris/`,
`frontend/src/data/horizon/`, `frontend/src/data/terrain/` and `terrain/`, re-run
`backend/ephemeris_fetch.py` (to rewrite `landingSites.json`) and rebuild.
