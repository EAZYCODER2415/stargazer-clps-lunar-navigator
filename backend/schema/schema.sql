-- Stargazer read-only dataset. Schema version: see dataset_build.schema_version (set by build_db.py).
-- SQLite flavoured. Timestamps are ISO 8601 UTC text ("2026-12-01T00:00:00Z"); units are in column names.
-- Conventions: azimuth 0 = north, 90 = east, clockwise. Elevation in degrees above local horizontal.
-- Longitude east-positive, 0 to 360. Lunar reference sphere radius 1,737,400 m.
-- Only scripts/build_db.py writes to this database. The API opens it read-only.
--
-- Changes from the schema in the brief (each is explained in docs/M0_DESIGN_NOTE.md):
--   quality_flag.fix_order            which fix order (F1..F7) a flag belongs to
--   horizon_profile.mask_source_file  which file the 360 bins came from
--   terrain_tile                      one row per nested level (the repo ships 5 levels as int16, not one 129x129 JSON)
--   visibility_window.*uncertainty*   precomputed optimistic/pessimistic match for each nominal window
--   visibility_summary.longest_window_start_utc/end_utc, period_hours   so best overlap is a lookup
--   cost_run.is_default, source_file, n_finite_trials, UNIQUE(site, horizon_model, horizon_lookup)
--   cost_anchor                       the delivery-price anchors and their verification status (F7)

CREATE TABLE dataset_build (
  build_id TEXT PRIMARY KEY,
  built_at_utc TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_manifest_json TEXT NOT NULL,   -- input file names + sha256
  row_counts_json TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE data_source (
  source_id TEXT PRIMARY KEY,          -- jpl_horizons, lola_ldem_80s_80m, clps_public_awards, stargazer_cost_model
  name TEXT NOT NULL,
  version TEXT,
  url TEXT,
  retrieved_utc TEXT,
  license_note TEXT,
  description TEXT
);

CREATE TABLE quality_flag (
  flag_id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','blocker')),
  scope TEXT NOT NULL,                 -- 'dataset' | 'site:<id>' | 'cost_run:<id>'
  message TEXT NOT NULL,
  fix_order TEXT                       -- 'F1'..'F7' when the flag belongs to a fix order, else NULL
);
CREATE INDEX ix_quality_flag_scope ON quality_flag (scope);

CREATE TABLE site (
  site_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  latitude_deg REAL NOT NULL CHECK (latitude_deg BETWEEN -90 AND 90),
  longitude_deg_east REAL NOT NULL CHECK (longitude_deg_east >= 0 AND longitude_deg_east < 360),
  ground_height_m REAL,
  observer_mast_m REAL,
  region_note TEXT,
  mission_context TEXT,
  coordinate_source TEXT,
  coordinate_status TEXT NOT NULL DEFAULT 'unverified'
);

CREATE TABLE ephemeris_run (
  run_id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES site,
  source_id TEXT NOT NULL REFERENCES data_source,
  start_utc TEXT NOT NULL,
  stop_utc TEXT NOT NULL,
  step_seconds INTEGER NOT NULL,
  n_samples INTEGER NOT NULL,
  time_scale TEXT NOT NULL DEFAULT 'UTC',
  observer_center TEXT NOT NULL,       -- coord@301
  observer_alt_km_used REAL NOT NULL,
  horizons_quantities TEXT,
  retrieved_utc TEXT,
  notes TEXT
);

CREATE TABLE ephemeris_sample (
  run_id INTEGER NOT NULL REFERENCES ephemeris_run,
  body TEXT NOT NULL CHECK (body IN ('sun','earth')),
  t_utc TEXT NOT NULL,
  azimuth_deg REAL NOT NULL CHECK (azimuth_deg >= 0 AND azimuth_deg < 360),
  elevation_deg REAL NOT NULL CHECK (elevation_deg BETWEEN -90 AND 90),
  PRIMARY KEY (run_id, body, t_utc)
) WITHOUT ROWID;

CREATE TABLE horizon_profile (
  profile_id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES site,
  source_id TEXT NOT NULL REFERENCES data_source,
  mast_m REAL NOT NULL,
  ground_height_m REAL,
  azimuth_convention TEXT NOT NULL DEFAULT '0=north,90=east',
  n_bins INTEGER NOT NULL DEFAULT 360,
  sigma_deg REAL,                      -- 1-sigma skyline uncertainty; 0.3 from cost_mc.py, a team assumption
  mask_source_file TEXT,               -- file the bins were read from (the same mask the website uses)
  notes TEXT
);

CREATE TABLE horizon_bin (
  profile_id INTEGER NOT NULL REFERENCES horizon_profile,
  azimuth_deg INTEGER NOT NULL CHECK (azimuth_deg BETWEEN 0 AND 359),
  skyline_elevation_deg REAL NOT NULL,
  blocker_distance_km REAL,            -- NULL when terrain/<id>_horizon.json was not available
  covered_km REAL,
  PRIMARY KEY (profile_id, azimuth_deg)
) WITHOUT ROWID;

-- Nested height tiles around the site, as written by lola_terrain.py (16-bit little-endian integers).
CREATE TABLE terrain_tile (
  site_id TEXT NOT NULL REFERENCES site,
  level_index INTEGER NOT NULL,        -- 0 = innermost
  source_id TEXT NOT NULL REFERENCES data_source,
  half_width_m REAL NOT NULL,
  n_cells INTEGER NOT NULL,            -- points per side
  spacing_m REAL NOT NULL,
  scale_m REAL NOT NULL,               -- metres = stored integer * scale_m
  heights_i16_le BLOB NOT NULL,        -- n_cells * n_cells int16 little-endian, row-major
  layout_note TEXT NOT NULL,           -- rows south->north, cols west->east, metres relative to the site's horizontal plane
  PRIMARY KEY (site_id, level_index)
);

-- One analysis = one ephemeris run + one horizon model. Both 'flat' and 'lola_mask' are loaded per site.
CREATE TABLE analysis (
  analysis_id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES site,
  ephemeris_run_id INTEGER NOT NULL REFERENCES ephemeris_run,
  horizon_model TEXT NOT NULL CHECK (horizon_model IN ('flat','lola_mask')),
  horizon_profile_id INTEGER REFERENCES horizon_profile,   -- NULL when flat
  mask_interpolation TEXT NOT NULL,    -- 'linear_between_bins' ('not_applicable' when flat)
  sigma_deg REAL NOT NULL,             -- skyline shift used for the optimistic/pessimistic scenarios
  visible_rule TEXT NOT NULL DEFAULT 'elevation_deg > horizon_elevation_deg',
  disc_model TEXT NOT NULL DEFAULT 'body_centre_point',     -- apparent disc size NOT included
  crossing_method TEXT NOT NULL DEFAULT 'linear_interpolation_of_hourly_clearance',
  created_utc TEXT NOT NULL,
  UNIQUE (site_id, horizon_model)
);

CREATE TABLE visibility_sample (
  analysis_id INTEGER NOT NULL REFERENCES analysis,
  body TEXT NOT NULL CHECK (body IN ('sun','earth')),
  t_utc TEXT NOT NULL,
  horizon_elevation_deg REAL NOT NULL,
  clearance_deg REAL NOT NULL,         -- elevation minus skyline
  is_visible INTEGER NOT NULL CHECK (is_visible IN (0,1)),
  PRIMARY KEY (analysis_id, body, t_utc)
) WITHOUT ROWID;

CREATE TABLE visibility_window (
  window_id INTEGER PRIMARY KEY,
  analysis_id INTEGER NOT NULL REFERENCES analysis,
  body TEXT NOT NULL CHECK (body IN ('sun','earth','both')),
  scenario TEXT NOT NULL CHECK (scenario IN ('nominal','optimistic','pessimistic')),  -- skyline 0 / -sigma / +sigma
  start_utc TEXT NOT NULL,
  end_utc TEXT NOT NULL,
  duration_h REAL NOT NULL,
  start_azimuth_deg REAL,              -- NULL for 'both'
  end_azimuth_deg REAL,
  peak_elevation_deg REAL,
  starts_before_data INTEGER NOT NULL DEFAULT 0,   -- clipped by data coverage
  ends_after_data INTEGER NOT NULL DEFAULT 0,
  -- Uncertainty match, filled for nominal windows only. NULL plus a note when no clean match exists.
  earliest_start_utc TEXT,
  latest_start_utc TEXT,
  earliest_end_utc TEXT,
  latest_end_utc TEXT,
  min_duration_h REAL,
  max_duration_h REAL,
  uncertainty_note TEXT
);
CREATE INDEX ix_window ON visibility_window (analysis_id, body, scenario, start_utc);

CREATE TABLE visibility_summary (
  analysis_id INTEGER NOT NULL REFERENCES analysis,
  body TEXT NOT NULL CHECK (body IN ('sun','earth','both')),
  scenario TEXT NOT NULL CHECK (scenario IN ('nominal','optimistic','pessimistic')),
  lunar_day_index INTEGER NOT NULL,    -- 1..4, 0 = whole coverage
  period_start_utc TEXT NOT NULL,
  period_end_utc TEXT NOT NULL,
  period_hours REAL NOT NULL,
  visible_hours REAL NOT NULL,
  visible_fraction REAL NOT NULL,
  n_windows INTEGER NOT NULL,
  longest_window_h REAL NOT NULL,
  longest_window_start_utc TEXT,       -- NULL when there is no window in the period
  longest_window_end_utc TEXT,
  longest_gap_h REAL NOT NULL,         -- for the Sun, the longest darkness
  PRIMARY KEY (analysis_id, body, scenario, lunar_day_index)
);

CREATE TABLE cost_run (
  cost_run_id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES site,
  analysis_id INTEGER NOT NULL REFERENCES analysis,
  horizon_model TEXT NOT NULL CHECK (horizon_model IN ('flat','lola_mask')),
  horizon_lookup TEXT NOT NULL CHECK (horizon_lookup IN ('linear_between_bins','nearest_lower_bin','not_applicable')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),   -- the run /cost serves for this horizon_model
  model_name TEXT NOT NULL,
  n_trials INTEGER NOT NULL,
  n_finite_trials INTEGER,             -- trials with at least one usable hour (burn is undefined otherwise)
  rng_seed INTEGER,
  script_sha256 TEXT,
  source_file TEXT,
  landing_time_utc TEXT NOT NULL,
  mission_days REAL NOT NULL,
  p_survive_full_mission REAL,
  p_zero_usable_hours REAL,
  created_utc TEXT NOT NULL,
  notes TEXT,
  UNIQUE (site_id, horizon_model, horizon_lookup)
);

CREATE TABLE cost_metric (
  cost_run_id INTEGER NOT NULL REFERENCES cost_run,
  metric TEXT NOT NULL CHECK (metric IN ('burn_musd_per_usable_h','usable_hours','alive_days')),
  unit TEXT NOT NULL,
  p10 REAL NOT NULL,
  p50 REAL NOT NULL,
  p90 REAL NOT NULL,
  mean REAL,                           -- NULL: cost_mc.py does not report a mean
  PRIMARY KEY (cost_run_id, metric)
);

CREATE TABLE cost_histogram_bin (
  cost_run_id INTEGER NOT NULL REFERENCES cost_run,
  bin_index INTEGER NOT NULL,
  bin_lo REAL NOT NULL,
  bin_hi REAL NOT NULL,
  trial_count INTEGER NOT NULL,
  PRIMARY KEY (cost_run_id, bin_index)
);

CREATE TABLE cost_assumption (
  assumption_id INTEGER PRIMARY KEY,
  cost_run_id INTEGER NOT NULL REFERENCES cost_run,
  name TEXT NOT NULL,
  description TEXT,
  distribution TEXT NOT NULL CHECK (distribution IN ('triangular','normal','fixed','not_modelled')),
  param_min REAL,
  param_mode REAL,
  param_max REAL,
  param_mean REAL,
  param_sd REAL,
  unit TEXT,
  source_note TEXT,
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('anchored_on_public_data','team_assumption','needs_verification'))
);

-- Delivery-price anchors named in cost_mc.py. Filled from backend/data/cost_sources.csv (F7).
CREATE TABLE cost_anchor (
  anchor TEXT PRIMARY KEY,
  award_musd REAL NOT NULL,
  award_year INTEGER,
  source_url TEXT,
  verified_by TEXT,
  verified_on TEXT,
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('anchored_on_public_data','needs_verification'))
);
