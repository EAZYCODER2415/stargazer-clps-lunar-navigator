"""API tests: contract, read-only enforcement, coverage rules, consistency between endpoints."""
from __future__ import annotations

import math

import pytest

SITES = ["malapert", "mons-mouton", "shackleton"]
P = "/api/v1"


# --------------------------------------------------------------------------- read-only

def test_app_has_no_non_get_routes(client):
    for route in client.app.routes:
        methods = getattr(route, "methods", None) or set()
        assert methods <= {"GET", "HEAD", "OPTIONS"}, f"{route.path} allows {methods}"


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
@pytest.mark.parametrize("path", ["/sites", "/sites/malapert", "/sites/malapert/cost", "/compare", "/meta", "/sql"])
def test_other_methods_return_405(client, method, path):
    response = getattr(client, method)(P + path)
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_site_id_is_never_interpreted_as_sql(client, api):
    response = client.get(P + "/sites/malapert'; DROP TABLE site; --")
    assert response.status_code == 404
    assert len(api("/sites")["sites"]) == 3


# --------------------------------------------------------------------------- system

def test_health_meta_sources(api):
    assert api("/health")["status"] == "ok"
    meta = api("/meta")
    assert meta["sites"] == SITES
    assert meta["coverage"]["malapert"] == {"start_utc": "2026-12-01T00:00:00Z", "end_utc": "2027-03-29T04:00:00Z",
                                           "step_seconds": 3600, "n_samples": 2837}
    assert meta["row_counts"]["ephemeris_sample"] == 3 * 2 * 2837
    codes = {f["code"] for f in meta["meta"]["quality_flags"]}
    assert {"COST_RUN_FLAT_HORIZON", "BEST_OVERLAP_IN_EPHEMERIS_FILES_IS_FLAT", "MASK_LOOKUP_RULES_DIFFER_IN_REPO",
            "HORIZONS_ALTITUDE_NOT_SITE_HEIGHT", "SITE_LIST_DIFFERS_FROM_PLAN_DOC", "COST_ANCHORS_UNVERIFIED"} <= codes
    assert {s["source_id"] for s in api("/sources")["sources"]} >= {"jpl_horizons", "lola_ldem_80s_80m"}


def test_every_response_carries_meta(api):
    for path, params in [("/sites", {}), ("/sites/malapert", {}), ("/sites/malapert/horizon", {}),
                         ("/sites/malapert/ephemeris", {"end": "2026-12-01T05:00:00Z"}),
                         ("/sites/malapert/solar-elevation", {"at": "2026-12-15T00:30:00Z"}),
                         ("/sites/malapert/visibility/windows", {}), ("/sites/malapert/visibility/summary", {}),
                         ("/sites/malapert/visibility/next-transition", {"after": "2026-12-15T00:00:00Z"}),
                         ("/sites/malapert/cost", {}), ("/compare", {})]:
        meta = api(path, **params)["meta"]
        assert meta["dataset_build_id"].startswith("sg-") and meta["time_scale"] == "UTC"
        assert "not electrical power" in meta["caveat"]
        assert "azimuth" in meta["conventions"] and isinstance(meta["quality_flags"], list)


# --------------------------------------------------------------------------- sites and terrain

def test_site_detail(api):
    site = api("/sites/mons-mouton")["site"]
    assert site["latitude_deg"] == -84.7906 and site["longitude_deg_east"] == 29.1957
    assert site["ground_height_m"] == 5321.1 and site["observer_mast_m"] == 3.0
    assert site["coordinate_status"] == "unverified"
    assert site["skyline"]["min_deg"] == -1.47 and site["skyline"]["max_deg"] == 4.05
    assert site["horizon_models"] == ["lola_mask", "flat"]
    assert api("/sites/atlantis", status=404)["error"]["code"] == "unknown_site"


def test_horizon_rows_and_columns(api):
    rows = api("/sites/shackleton/horizon")
    assert len(rows["bins"]) == 360 and rows["bins"][0]["azimuth_deg"] == 0
    assert rows["profile"]["sigma_deg"] == 0.3 and rows["stats"]["max_deg"] == 1.33
    columns = api("/sites/shackleton/horizon", format="columns")["columns"]
    assert columns["skyline_elevation_deg"] == [b["skyline_elevation_deg"] for b in rows["bins"]]


def test_terrain_tile(api):
    levels = api("/sites/malapert")["site"]["terrain_tile_levels"]
    if levels == 0:                                   # tiles are optional: e.g. a branch without frontend/src/data/terrain/
        assert api("/sites/malapert/terrain-tile", status=404)["error"]["code"] == "no_terrain_tile"
        pytest.skip("no terrain tiles in this checkout")
    tile = api("/sites/malapert/terrain-tile")
    assert "meta" in tile and tile["n_cells"] == 129 and len(tile["heights_m"]) == 129 and len(tile["heights_m"][0]) == 129
    assert 5000 <= tile["half_width_m"] <= 5120                      # about 10 km x 10 km by default
    assert abs(tile["heights_m"][64][64]) < 1.0                      # the centre point is the site itself
    assert api("/sites/malapert/terrain-tile", status=404, level=7)["error"]["code"] == "no_terrain_tile_level"
    if levels == 5:                                                  # the nested tiles written by the current lola_terrain.py
        assert tile["level_index"] == 1 and tile["stride"] == 2 and tile["spacing_m"] == 80
        full = api("/sites/malapert/terrain-tile", level=0, stride=1)
        assert full["n_cells"] == 129 and full["spacing_m"] == 10


# --------------------------------------------------------------------------- ephemeris and interpolation

def test_interpolating_at_an_hourly_timestamp_returns_the_raw_sample(api):
    rows = api("/sites/shackleton/ephemeris", start="2026-12-20T00:00:00Z", end="2026-12-20T02:00:00Z")["rows"]
    at = api("/sites/shackleton/solar-elevation", at="2026-12-20T01:00:00Z")
    assert not at["interpolated"]
    assert (at["azimuth_deg"], at["elevation_deg"]) == (rows[1]["azimuth_deg"], rows[1]["elevation_deg"])
    assert at["skyline_elevation_deg"] == pytest.approx(rows[1]["skyline_elevation_deg"], abs=1e-6)
    assert at["clearance_deg"] == pytest.approx(rows[1]["clearance_deg"], abs=2e-6)


def test_interpolating_mid_hour_lies_between_its_neighbours(api):
    rows = api("/sites/shackleton/ephemeris", body="earth", start="2026-12-20T00:00:00Z", end="2026-12-20T01:00:00Z")["rows"]
    mid = api("/sites/shackleton/position", body="earth", at="2026-12-20T00:30:00Z")
    assert mid["interpolated"]
    lo, hi = sorted([rows[0]["elevation_deg"], rows[1]["elevation_deg"]])
    assert lo <= mid["elevation_deg"] <= hi
    assert mid["elevation_deg"] == pytest.approx((lo + hi) / 2, abs=1e-6)
    lo, hi = sorted([rows[0]["azimuth_deg"], rows[1]["azimuth_deg"]])
    assert lo <= mid["azimuth_deg"] <= hi


def test_scenarios_shift_the_skyline_by_sigma(api):
    at = api("/sites/shackleton/solar-elevation", at="2027-01-15T12:20:00Z")
    s = at["scenarios"]
    assert s["optimistic"]["skyline_elevation_deg"] == pytest.approx(at["skyline_elevation_deg"] - 0.3, abs=1e-6)
    assert s["pessimistic"]["skyline_elevation_deg"] == pytest.approx(at["skyline_elevation_deg"] + 0.3, abs=1e-6)
    assert s["nominal"]["clearance_deg"] == at["clearance_deg"]


def test_ephemeris_step_formats_and_paging(api, client):
    daily = api("/sites/malapert/ephemeris", step=24, format="columns")
    assert daily["page"]["total"] == 119 and daily["step_hours"] == 24 and daily.get("rows") is None
    assert daily["columns"]["t_utc"][:2] == ["2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z"]
    page = api("/sites/malapert/ephemeris", limit=1000)
    assert page["page"] == {"returned": 1000, "total": 2837, "limit": 1000, "offset": 0, "next_offset": 1000}
    last = api("/sites/malapert/ephemeris", limit=1000, offset=2000)
    assert last["page"]["returned"] == 837 and last["page"]["next_offset"] is None
    capped = api("/sites/malapert/ephemeris", limit=999999)
    assert capped["page"]["limit"] == 3000
    csv = client.get(P + "/sites/malapert/ephemeris", params={"format": "csv", "end": "2026-12-01T03:00:00Z"})
    assert csv.headers["content-type"].startswith("text/csv")
    lines = csv.text.strip().splitlines()
    assert lines[0].startswith("t_utc,azimuth_deg") and len(lines) == 5


def test_flat_and_terrain_horizons_differ_and_are_labelled(api):
    flat = api("/sites/malapert/ephemeris", horizon_model="flat", end="2026-12-01T00:00:00Z")
    lola = api("/sites/malapert/ephemeris", end="2026-12-01T00:00:00Z")
    assert flat["meta"]["horizon_model"] == "flat" and lola["meta"]["horizon_model"] == "lola_mask"
    assert flat["rows"][0]["skyline_elevation_deg"] == 0.0 and lola["rows"][0]["skyline_elevation_deg"] != 0.0
    assert flat["rows"][0]["is_visible"] and not lola["rows"][0]["is_visible"]     # Sun is behind a 4 degree ridge


# --------------------------------------------------------------------------- coverage and validation

@pytest.mark.parametrize("path,params", [
    ("/sites/malapert/ephemeris", {"start": "2026-11-30T23:00:00Z"}),
    ("/sites/malapert/ephemeris", {"end": "2027-03-29T05:00:00Z"}),
    ("/sites/malapert/solar-elevation", {"at": "2027-04-01T00:00:00Z"}),
    ("/sites/malapert/visibility/windows", {"start": "2025-01-01"}),
    ("/sites/malapert/visibility/windows", {"month": "2027-07"}),
    ("/sites/malapert/visibility/summary", {"start": "2027-03-20", "days": 29.53}),
    ("/sites/malapert/visibility/next-transition", {"after": "2028-01-01"}),
    ("/compare", {"start": "2027-03-25", "days": 10}),
])
def test_requests_outside_coverage_are_refused_not_extrapolated(api, path, params):
    error = api(path, status=422, **params)["error"]
    assert error["code"] == "out_of_coverage"
    assert error["coverage"]["start_utc"] == "2026-12-01T00:00:00Z" and error["coverage"]["end_utc"] == "2027-03-29T04:00:00Z"


@pytest.mark.parametrize("path,params,code", [
    ("/sites/malapert/ephemeris", {"start": "yesterday"}, "invalid_timestamp"),
    ("/sites/malapert/ephemeris", {"body": "mars"}, "invalid_parameter"),
    ("/sites/malapert/ephemeris", {"horizon_model": "mountains"}, "invalid_parameter"),
    ("/sites/malapert/ephemeris", {"step": 0}, "invalid_parameter"),
    ("/sites/malapert/ephemeris", {"start": "2026-12-05", "end": "2026-12-01"}, "invalid_range"),
    ("/sites/malapert/solar-elevation", {}, "invalid_parameter"),
    ("/sites/malapert/visibility/windows", {"month": "January"}, "invalid_month"),
    ("/sites/malapert/visibility/windows", {"month": "2027-01", "start": "2027-01-02"}, "invalid_range"),
    ("/sites/malapert/visibility/windows", {"scenario": "lucky"}, "invalid_parameter"),
    ("/sites/malapert/visibility/summary", {"lunar_day": 9}, "unknown_lunar_day"),
    ("/sites/malapert/visibility/summary", {"lunar_day": 1, "days": 3}, "invalid_range"),
    ("/compare", {"sites": "malapert,malapert"}, "duplicate_site"),
])
def test_bad_parameters_get_a_clear_422(api, path, params, code):
    error = api(path, status=422, **params)["error"]
    assert error["code"] == code and error["message"]
    assert "Traceback" not in error["message"] and "/home/" not in error["message"] and "\\Users\\" not in error["message"]


def test_unknown_endpoint_is_404_json(client):
    response = client.get(P + "/sql?q=select")
    assert response.status_code == 404 and response.json()["error"]["code"] == "not_found"


# --------------------------------------------------------------------------- windows and summaries

def test_windows_for_a_month_and_uncertainty_block(api):
    january = api("/sites/shackleton/visibility/windows", body="earth", month="2027-01", scenario="all")
    assert january["range"] == {"start_utc": "2027-01-01T00:00:00Z", "end_utc": "2027-02-01T00:00:00Z", "clipped_to_coverage": False}
    (window,) = january["windows"]
    u = window["uncertainty"]
    assert u["earliest_start_utc"] < window["start_utc"] < u["latest_start_utc"]
    assert u["earliest_end_utc"] < window["end_utc"] < u["latest_end_utc"]
    assert u["min_duration_h"] < window["duration_h"] < u["max_duration_h"]
    assert 150 < window["start_azimuth_deg"] < 175 and window["peak_elevation_deg"] > 5
    march = api("/sites/shackleton/visibility/windows", body="sun", month="2027-03")
    assert march["range"]["clipped_to_coverage"] and march["range"]["end_utc"] == "2027-03-29T04:00:00Z"
    first = march["windows"][0]
    assert first["start_utc"] < "2027-03-01" and first["overlap_start_utc"] == "2027-03-01T00:00:00Z"
    assert first["overlap_duration_h"] < first["duration_h"]
    plain = api("/sites/shackleton/visibility/windows", body="earth", month="2027-01")
    assert "uncertainty" not in plain["windows"][0] or plain["windows"][0]["uncertainty"] is None


def test_split_or_vanished_pessimistic_windows_are_null_with_a_note(api):
    windows = api("/sites/shackleton/visibility/windows", body="sun", scenario="all")["windows"]
    noted = [w for w in windows if w["uncertainty"]["note"]]
    assert noted, "Shackleton's grazing Sun should produce windows with no clean uncertainty match"
    assert any("vanishes" in w["uncertainty"]["note"] and w["uncertainty"]["min_duration_h"] == 0 for w in noted)
    assert any("splits" in w["uncertainty"]["note"] and w["uncertainty"]["latest_start_utc"] is None for w in noted)


def test_both_windows_are_the_intersection(api):
    for site in SITES:
        sun = api(f"/sites/{site}/visibility/windows", body="sun")["total_overlap_hours"]
        earth = api(f"/sites/{site}/visibility/windows", body="earth")["total_overlap_hours"]
        both = api(f"/sites/{site}/visibility/windows", body="both")["total_overlap_hours"]
        assert both <= min(sun, earth) + 1e-9
    assert api("/sites/malapert/visibility/windows", body="earth")["windows"][0]["duration_h"] == 2836.0   # Earth never sets


def test_summary_by_dates_equals_precomputed_lunar_day(api):
    for site in SITES:
        for model in ("lola_mask", "flat"):
            computed = api(f"/sites/{site}/visibility/summary", horizon_model=model)
            stored = api(f"/sites/{site}/visibility/summary", horizon_model=model, lunar_day=1)
            assert computed["period"]["start_utc"] == stored["period"]["start_utc"]
            assert computed["period"]["end_utc"] == stored["period"]["end_utc"]
            for body in ("sun", "earth", "both"):
                for key, value in stored["bodies"][body].items():
                    got = computed["bodies"][body][key]
                    assert got == pytest.approx(value, abs=1e-9) if isinstance(value, float) else got == value
            assert computed["best_overlap"]["duration_h"] == pytest.approx(stored["best_overlap"]["duration_h"], abs=1e-9)


def test_best_overlap_is_terrain_aware_and_brackets(api):
    lola = api("/sites/mons-mouton/visibility/summary", lunar_day=1)["best_overlap"]
    flat = api("/sites/mons-mouton/visibility/summary", lunar_day=1, horizon_model="flat")["best_overlap"]
    assert lola["horizon_model"] == "lola_mask" and flat["horizon_model"] == "flat"
    assert abs(flat["duration_h"] - 409) <= 1 and abs(lola["duration_h"] - 360) <= 1.5
    assert lola["duration_h_pessimistic"] <= lola["duration_h"] <= lola["duration_h_optimistic"]


def test_fixture_hours_through_the_api(api):
    expected = {"malapert": (384, 709, 384), "mons-mouton": (360, 585, 360), "shackleton": (709, 308, 308)}
    for site, (sun, earth, both) in expected.items():
        bodies = api(f"/sites/{site}/visibility/summary", lunar_day=1)["bodies"]
        assert abs(bodies["sun"]["visible_hours"] - sun) <= 1.5
        assert abs(bodies["earth"]["visible_hours"] - earth) <= 1.5
        assert abs(bodies["both"]["visible_hours"] - both) <= 1.5
    dark = {"malapert": 433, "mons-mouton": 394, "shackleton": 136}
    for site, hours in dark.items():
        assert abs(api(f"/sites/{site}/visibility/summary", lunar_day=0)["bodies"]["sun"]["longest_gap_h"] - hours) <= 1.5


def test_next_transition(api):
    rise = api("/sites/malapert/visibility/next-transition", after="2026-12-01T00:00:00Z")
    assert rise["event"] == "rise" and not rise["currently_visible"] and rise["time_utc"] == "2026-12-13T02:27:46Z"
    assert rise["hours_until"] == pytest.approx(290.46, abs=0.01) and 0 <= rise["azimuth_deg"] < 360
    after_rise = api("/sites/malapert/visibility/next-transition", after=rise["time_utc"])
    assert after_rise["event"] == "set" and after_rise["time_utc"] > rise["time_utc"]
    position = api("/sites/malapert/solar-elevation", at=rise["time_utc"])
    assert abs(position["clearance_deg"]) < 0.05                    # the Sun really is at the skyline at that moment
    never = api("/sites/malapert/visibility/next-transition", after="2026-12-20T00:00:00Z", body="earth")
    assert never["event"] is None and never["currently_visible"] and "never extrapolates" in never["note"]


# --------------------------------------------------------------------------- cost

def test_cost_default_is_terrain_aware_and_states_its_horizon(api):
    for site in SITES:
        cost = api(f"/sites/{site}/cost")
        assert cost["horizon_model"] == "lola_mask" and cost["horizon_lookup"] == "linear_between_bins" and cost["is_default"]
        assert cost["meta"]["horizon_model"] == "lola_mask"
        burn = cost["metrics"]["burn_musd_per_usable_h"]
        assert burn["p10"] <= burn["p50"] <= burn["p90"]
        counts = sum(b["trial_count"] for b in cost["histogram"]["bins"])
        assert counts == cost["model"]["n_finite_trials"] <= cost["model"]["n_trials"] == 10000
        assert abs(counts - 10000 * (1 - cost["p_zero_usable_hours"])) <= 6
        assert len(cost["histogram"]["bins"]) == 40
        assert all(math.isfinite(b["bin_lo"]) and math.isfinite(b["bin_hi"]) for b in cost["histogram"]["bins"])
        assert "not a mission-grade estimate" in " ".join(cost["caveats"])
        assert "Sun AND the Earth" in cost["usable_hour_definition"]
        names = {a["name"]: a for a in cost["assumptions"]}
        assert names["delivery_price"]["evidence_status"] == "needs_verification"
        assert (names["delivery_price"]["param_min"], names["delivery_price"]["param_mode"], names["delivery_price"]["param_max"]) == (79.5, 116.9, 180.4)
        assert names["ops_cost"]["distribution"] == "not_modelled" and names["horizon_error"]["param_sd"] == 0.3
        assert {a["anchor"] for a in cost["anchors"]} == {"Peregrine", "CP-22", "IM-5"}
        assert all(a["evidence_status"] == "needs_verification" and a["source_url"] is None for a in cost["anchors"])


def test_flat_cost_is_labelled_and_flagged(api):
    flat = api("/sites/shackleton/cost", horizon_model="flat")
    assert flat["horizon_model"] == "flat" and "ignores terrain" in flat["caveats"][0]
    assert any(f["code"] == "COST_RUN_FLAT_HORIZON" and f["severity"] == "warning" for f in flat["meta"]["quality_flags"])
    lola = api("/sites/shackleton/cost")
    assert not any(f["code"] == "COST_RUN_FLAT_HORIZON" for f in lola["meta"]["quality_flags"])
    assert flat["metrics"]["burn_musd_per_usable_h"]["p50"] == 0.236
    assert lola["metrics"]["burn_musd_per_usable_h"]["p50"] != 0.236
    parity = api("/sites/shackleton/cost", horizon_lookup="nearest_lower_bin")
    assert [parity["metrics"]["burn_musd_per_usable_h"][k] for k in ("p10", "p50", "p90")] == [0.212, 0.357, 0.62]


def test_missing_cost_run_is_404_never_a_fallback(api):
    error = api("/sites/shackleton/cost", status=404, horizon_model="flat", horizon_lookup="linear_between_bins")["error"]
    assert error["code"] == "no_cost_run" and "never substituted" in error["message"]
    assert {r["horizon_model"] for r in error["available_runs"]} == {"flat", "lola_mask"}


# --------------------------------------------------------------------------- compare

def test_compare_equals_per_site_summaries_and_uses_one_horizon(api):
    for model in ("lola_mask", "flat"):
        payload = api("/compare", horizon_model=model, start="2026-12-10T00:00:00Z", days=20)
        assert payload["horizon_model"] == model and payload["meta"]["horizon_model"] == model
        assert [s["site_id"] for s in payload["sites"]] == SITES
        for entry in payload["sites"]:
            single = api(f"/sites/{entry['site_id']}/visibility/summary", horizon_model=model, start="2026-12-10T00:00:00Z", days=20)
            assert entry["bodies"] == single["bodies"]
            assert entry["best_overlap"] == single["best_overlap"]
            assert entry["period"] == single["period"]
            assert entry["cost"]["horizon_model"] == model
            cost = api(f"/sites/{entry['site_id']}/cost", horizon_model=model)
            assert entry["cost"]["metrics"] == cost["metrics"]
            windows = api(f"/sites/{entry['site_id']}/visibility/windows", horizon_model=model, body="both",
                          start="2026-12-10T00:00:00Z", end="2026-12-30T00:00:00Z")["windows"]
            assert entry["windows"]["both"] == windows


def test_compare_subset_and_lunar_day(api):
    payload = api("/compare", sites="shackleton,malapert", lunar_day=2)
    assert [s["site_id"] for s in payload["sites"]] == ["shackleton", "malapert"]
    assert all(s["period"]["lunar_day_index"] == 2 for s in payload["sites"])
    assert api("/compare", status=404, sites="malapert,narnia")["error"]["code"] == "unknown_site"


# --------------------------------------------------------------------------- headers

def test_cache_headers_etag_and_cors(client):
    first = client.get(P + "/sites/malapert/visibility/summary", headers={"Origin": "http://localhost:5173"})
    etag = first.headers["etag"]
    assert first.headers["x-dataset-build"].startswith("sg-") and etag.startswith('W/"sg-')
    assert "max-age=" in first.headers["cache-control"]
    assert first.headers["access-control-allow-origin"] == "http://localhost:5173"
    again = client.get(P + "/sites/malapert/visibility/summary", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""
    other = client.get(P + "/sites/malapert/visibility/summary", params={"horizon_model": "flat"})
    assert other.headers["etag"] != etag
    stranger = client.get(P + "/sites", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in stranger.headers
    assert "etag" not in client.get(P + "/health").headers
    big = client.get(P + "/sites/malapert/ephemeris", headers={"Accept-Encoding": "gzip"})
    assert big.headers.get("content-encoding") == "gzip"


def test_openapi_is_served_and_lists_only_get(client):
    spec = client.get(P + "/openapi.json").json()
    assert spec["info"]["title"] == "Stargazer API"
    for path, operations in spec["paths"].items():
        assert set(operations) == {"get"}, f"{path} documents {set(operations)}"
    for expected in ["/api/v1/health", "/api/v1/meta", "/api/v1/sources", "/api/v1/sites", "/api/v1/sites/{site_id}",
                     "/api/v1/sites/{site_id}/horizon", "/api/v1/sites/{site_id}/terrain-tile",
                     "/api/v1/sites/{site_id}/ephemeris", "/api/v1/sites/{site_id}/solar-elevation",
                     "/api/v1/sites/{site_id}/visibility/windows", "/api/v1/sites/{site_id}/visibility/summary",
                     "/api/v1/sites/{site_id}/visibility/next-transition", "/api/v1/sites/{site_id}/cost", "/api/v1/compare"]:
        assert expected in spec["paths"]
