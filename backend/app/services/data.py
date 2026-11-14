"""
Read-only lookups for the API.

Everything here is a lookup, an interval clip or a linear interpolation on values that
scripts/build_db.py already computed. All derivation formulas live in backend/derive.py.
Every SQL statement is parameterised; nothing from a request is ever pasted into SQL.
"""
from __future__ import annotations

import sys
from array import array
from typing import Any, Iterable, Optional, Sequence

from sqlitedb import Connection, text

import derive

from ..db import Database
from ..errors import ApiError

HORIZON_MODELS = ("lola_mask", "flat")
BODIES = ("sun", "earth")
WINDOW_BODIES = ("sun", "earth", "both")
CAVEAT = ("Geometric visibility only: whether the centre of the Sun or Earth is above the terrain skyline. "
          "Sun visibility is not electrical power and Earth visibility is not a working radio link; "
          "no power-system or link-budget model is included.")
COST_CAVEAT = "A distribution under stated assumptions, not a mission-grade estimate."
USABLE_HOUR_DEFINITION = ("A usable hour is an hour in which the Sun AND the Earth are both above the skyline, counted only "
                          "while the lander is alive. The lander lands at the start of the longest sunlit stretch that begins "
                          "in the first lunar day and dies at the first dark stretch longer than its battery endurance. "
                          "Burn ratio = total mission cost / usable hours, in $M per usable hour; it is undefined in a trial "
                          "with zero usable hours, and those trials are left out of the percentiles and the histogram "
                          "(see p_zero_usable_hours).")
BOTH_VS_USABLE_NOTE = ("Sun+Earth 'both' windows are pure geometry and ignore whether a lander would still be alive. "
                       "The cost model's usable hours count only hours while the lander is alive, so they are lower.")
CONVENTIONS = {
    "time": "UTC, ISO 8601",
    "azimuth": "degrees, 0 = north, 90 = east, clockwise, in [0, 360)",
    "elevation": "degrees above the local horizontal",
    "longitude": "degrees east, 0 to 360",
    "visible_rule": "elevation_deg > skyline elevation at the body's azimuth (body centre point; apparent disc size not included)",
    "lunar_day_hours": derive.LUNAR_DAY_HOURS,
    "reference_sphere_radius_m": 1737400,
}


# --------------------------------------------------------------------------- meta

def build_meta(db: Database, *, horizon_model: Optional[str] = None, mask_interpolation: Optional[str] = None,
               site_ids: Iterable[str] = (), cost_run_ids: Iterable[int] = (), sources: Sequence[str] = (),
               all_flags: bool = False, extra: Optional[dict] = None) -> dict:
    """The `meta` block carried by every response."""
    info = db.info()
    scopes = {"dataset"} | {f"site:{s}" for s in site_ids} | {f"cost_run:{c}" for c in cost_run_ids}
    flags = [f for f in info["flags"] if all_flags or f["scope"] in scopes]
    meta = {
        "dataset_build_id": info["build"]["build_id"],
        "schema_version": info["build"]["schema_version"],
        "built_at_utc": info["build"]["built_at_utc"],
        "time_scale": "UTC",
        "conventions": CONVENTIONS,
        "horizon_model": horizon_model,
        "mask_interpolation": mask_interpolation,
        "sources": [{"source_id": s, "name": info["sources"][s]["name"], "version": info["sources"][s]["version"],
                     "url": info["sources"][s]["url"]} for s in sources if s in info["sources"]],
        "quality_flags": flags,
        "caveat": CAVEAT,
    }
    if extra:
        meta.update(extra)
    return meta


# --------------------------------------------------------------------------- parsing and coverage

def parse_time(value: str, name: str) -> float:
    try:
        return derive.parse_iso_utc(value)
    except (ValueError, TypeError):
        raise ApiError(422, "invalid_timestamp",
                       f"'{name}' must be an ISO 8601 UTC time such as 2026-12-15T06:00:00Z or 2026-12-15; got {value!r}.")


def coverage_of(run: dict) -> tuple[float, float]:
    return derive.parse_iso_utc(run["start_utc"]), derive.parse_iso_utc(run["stop_utc"])


def coverage_dict(run: dict) -> dict:
    return {"start_utc": run["start_utc"], "end_utc": run["stop_utc"], "step_seconds": run["step_seconds"],
            "n_samples": run["n_samples"]}


def require_in_coverage(t: float, run: dict, name: str) -> None:
    start, end = coverage_of(run)
    if t < start or t > end:
        raise ApiError(422, "out_of_coverage",
                       f"'{name}' ({derive.epoch_to_iso(t)}) is outside the data coverage {run['start_utc']} to "
                       f"{run['stop_utc']}. The API never extrapolates.", {"coverage": coverage_dict(run)})


def resolve_range(run: dict, start: Optional[str], end: Optional[str], month: Optional[str] = None) -> dict:
    """
    The requested [start, end]. Defaults to the full coverage. `month` (YYYY-MM) is a shortcut for a
    calendar month; a month that only partly overlaps the coverage is clipped to it and marked so.
    """
    cov_start, cov_end = coverage_of(run)
    if month is not None:
        if start is not None or end is not None:
            raise ApiError(422, "invalid_range", "Use either 'month' or 'start'/'end', not both.")
        try:
            year, mon = month.split("-")
            y, m = int(year), int(mon)
            if len(year) != 4 or not 1 <= m <= 12:
                raise ValueError
        except ValueError:
            raise ApiError(422, "invalid_month", f"'month' must look like 2027-01; got {month!r}.")
        s = derive.parse_iso_utc(f"{y:04d}-{m:02d}-01T00:00:00Z")
        e = derive.parse_iso_utc(f"{y + (m == 12):04d}-{(m % 12) + 1:02d}-01T00:00:00Z")
        if e <= cov_start or s >= cov_end:
            raise ApiError(422, "out_of_coverage",
                           f"{month} is outside the data coverage {run['start_utc']} to {run['stop_utc']}.",
                           {"coverage": coverage_dict(run)})
        clipped = s < cov_start or e > cov_end
        return {"start": max(s, cov_start), "end": min(e, cov_end), "clipped_to_coverage": clipped}
    s = parse_time(start, "start") if start is not None else cov_start
    e = parse_time(end, "end") if end is not None else cov_end
    if start is not None:
        require_in_coverage(s, run, "start")
    if end is not None:
        require_in_coverage(e, run, "end")
    if e < s:
        raise ApiError(422, "invalid_range", "'end' must not be earlier than 'start'.")
    return {"start": s, "end": e, "clipped_to_coverage": False}


def resolve_period(run: dict, start: Optional[str], days: Optional[float]) -> tuple[float, float]:
    """A [start, start + days] period for summaries. Defaults: coverage start, one lunar day (29.53 days)."""
    cov_start, cov_end = coverage_of(run)
    s = parse_time(start, "start") if start is not None else cov_start
    require_in_coverage(s, run, "start")
    length = days if days is not None else derive.LUNAR_DAY_HOURS / 24.0
    if not length > 0:
        raise ApiError(422, "invalid_range", "'days' must be greater than 0.")
    e = s + length * 86400.0
    if e > cov_end + 1e-6:
        if days is None and e - cov_end < 3600.0:
            e = cov_end                                   # hourly data may stop under an hour short of a lunar day
        else:
            raise ApiError(422, "out_of_coverage",
                           f"The period {derive.epoch_to_iso(s)} + {length:g} days ends after the data coverage "
                           f"({run['stop_utc']}). The API never extrapolates.", {"coverage": coverage_dict(run)})
    return s, e


# --------------------------------------------------------------------------- basic rows

def list_sites(conn: Connection) -> list[dict]:
    return [dict(r) for r in conn.execute(text("SELECT * FROM site ORDER BY site_id")).mappings()]


def get_site(conn: Connection, site_id: str) -> dict:
    row = conn.execute(text("SELECT * FROM site WHERE site_id = :s"), {"s": site_id}).mappings().first()
    if row is None:
        known = [r[0] for r in conn.execute(text("SELECT site_id FROM site ORDER BY site_id"))]
        raise ApiError(404, "unknown_site", f"No site with id {site_id!r}. Known sites: {', '.join(known)}.",
                       {"known_sites": known})
    return dict(row)


def get_run(conn: Connection, site_id: str) -> dict:
    row = conn.execute(text("SELECT * FROM ephemeris_run WHERE site_id = :s ORDER BY run_id LIMIT 1"),
                       {"s": site_id}).mappings().first()
    if row is None:
        raise ApiError(404, "no_ephemeris", f"No ephemeris is loaded for site {site_id!r}.")
    return dict(row)


def get_analysis(conn: Connection, site_id: str, horizon_model: str) -> dict:
    row = conn.execute(text("SELECT * FROM analysis WHERE site_id = :s AND horizon_model = :m"),
                       {"s": site_id, "m": horizon_model}).mappings().first()
    if row is None:
        raise ApiError(404, "no_analysis",
                       f"No {horizon_model} analysis is loaded for site {site_id!r}. Nothing is substituted for it.")
    return dict(row)


def get_profile(conn: Connection, site_id: str) -> Optional[dict]:
    row = conn.execute(text("SELECT * FROM horizon_profile WHERE site_id = :s ORDER BY profile_id LIMIT 1"),
                       {"s": site_id}).mappings().first()
    return dict(row) if row else None


def horizon_bins(conn: Connection, profile_id: int) -> list[dict]:
    return [dict(r) for r in conn.execute(text(
        "SELECT azimuth_deg, skyline_elevation_deg, blocker_distance_km, covered_km FROM horizon_bin "
        "WHERE profile_id = :p ORDER BY azimuth_deg"), {"p": profile_id}).mappings()]


def mask_for(conn: Connection, analysis: dict) -> Optional[list[float]]:
    """The 360-value skyline for an analysis, or None for a flat horizon."""
    if analysis["horizon_profile_id"] is None:
        return None
    return [r[0] for r in conn.execute(text(
        "SELECT skyline_elevation_deg FROM horizon_bin WHERE profile_id = :p ORDER BY azimuth_deg"),
        {"p": analysis["horizon_profile_id"]})]


def skyline_stats(bins: list[dict]) -> dict:
    values = [b["skyline_elevation_deg"] for b in bins]
    highest = max(range(len(values)), key=values.__getitem__)
    return {"min_deg": min(values), "max_deg": max(values), "mean_deg": sum(values) / len(values),
            "azimuth_of_max_deg": bins[highest]["azimuth_deg"],
            "blocker_distance_at_max_km": bins[highest]["blocker_distance_km"]}


def tile_levels(conn: Connection, site_id: str) -> list[dict]:
    return [dict(r) for r in conn.execute(text(
        "SELECT level_index, half_width_m, n_cells, spacing_m, scale_m FROM terrain_tile WHERE site_id = :s "
        "ORDER BY level_index"), {"s": site_id}).mappings()]


def cost_runs_available(conn: Connection, site_id: str) -> list[dict]:
    return [{"horizon_model": r["horizon_model"], "horizon_lookup": r["horizon_lookup"], "is_default": bool(r["is_default"])}
            for r in conn.execute(text(
                "SELECT horizon_model, horizon_lookup, is_default FROM cost_run WHERE site_id = :s "
                "ORDER BY horizon_model DESC, is_default DESC"), {"s": site_id}).mappings()]


def site_detail(conn: Connection, site: dict) -> dict:
    run = get_run(conn, site["site_id"])
    profile = get_profile(conn, site["site_id"])
    bins = horizon_bins(conn, profile["profile_id"]) if profile else []
    models = [r[0] for r in conn.execute(text(
        "SELECT horizon_model FROM analysis WHERE site_id = :s ORDER BY horizon_model DESC"), {"s": site["site_id"]})]
    return {**site, "coverage": coverage_dict(run), "observer_alt_km_used": run["observer_alt_km_used"],
            "skyline": ({**skyline_stats(bins), "sigma_deg": profile["sigma_deg"]} if bins else None),
            "horizon_models": models, "cost_runs": cost_runs_available(conn, site["site_id"]),
            "terrain_tile_levels": len(tile_levels(conn, site["site_id"]))}


# --------------------------------------------------------------------------- ephemeris and positions

def ephemeris_rows(conn: Connection, run: dict, analysis: dict, body: str, start: float, end: float, step: int,
                   limit: int, offset: int) -> tuple[list[dict], int]:
    """Hourly samples in [start, end] (every `step`-th one), joined with skyline, clearance and visibility."""
    rows = [dict(r) for r in conn.execute(text(
        "SELECT e.t_utc, e.azimuth_deg, e.elevation_deg, v.horizon_elevation_deg AS skyline_elevation_deg, "
        "v.clearance_deg, v.is_visible FROM ephemeris_sample e JOIN visibility_sample v "
        "ON v.analysis_id = :a AND v.body = e.body AND v.t_utc = e.t_utc "
        "WHERE e.run_id = :r AND e.body = :b AND e.t_utc >= :s AND e.t_utc <= :e ORDER BY e.t_utc"),
        {"a": analysis["analysis_id"], "r": run["run_id"], "b": body,
         "s": _iso_ceil(start), "e": derive.epoch_to_iso(_floor_second(end))}).mappings()]
    rows = rows[::step]
    total = len(rows)
    page = rows[offset:offset + limit]
    for row in page:
        row["is_visible"] = bool(row["is_visible"])
    return page, total


def _floor_second(t: float) -> float:
    return float(int(t // 1))


def _iso_ceil(t: float) -> str:
    whole = _floor_second(t)
    return derive.epoch_to_iso(whole if whole == t else whole + 1)


def position(conn: Connection, run: dict, analysis: dict, body: str, t: float) -> dict:
    """Azimuth, elevation, skyline and clearance of one body at one time (linear interpolation between hourly samples)."""
    iso = derive.epoch_to_iso(t)
    t = derive.parse_iso_utc(iso)                       # whole seconds
    require_in_coverage(t, run, "at")
    params = {"r": run["run_id"], "b": body, "t": iso}
    lower = conn.execute(text("SELECT t_utc, azimuth_deg, elevation_deg FROM ephemeris_sample WHERE run_id = :r "
                              "AND body = :b AND t_utc <= :t ORDER BY t_utc DESC LIMIT 1"), params).first()
    upper = conn.execute(text("SELECT t_utc, azimuth_deg, elevation_deg FROM ephemeris_sample WHERE run_id = :r "
                              "AND body = :b AND t_utc >= :t ORDER BY t_utc LIMIT 1"), params).first()
    times = [derive.parse_iso_utc(lower[0]), derive.parse_iso_utc(upper[0])]
    if times[0] == times[1]:
        azimuth, elevation, interpolated = float(lower[1]), float(lower[2]), False
    else:
        azimuth, elevation = derive.position_at(times, [lower[1], upper[1]], [lower[2], upper[2]], t)
        interpolated = True
    mask = mask_for(conn, analysis)
    skyline = derive.skyline_at(mask, azimuth, derive.MASK_LINEAR)
    azimuth, elevation, skyline = round(azimuth, 6), round(elevation, 6), round(skyline, 6)
    clearance = round(elevation - skyline, 6)
    sigma = analysis["sigma_deg"]
    scenarios = {}
    for name in derive.SCENARIOS:
        shifted = round(skyline + derive.SCENARIO_SKYLINE_SHIFT[name] * sigma, 6)
        margin = round(elevation - shifted, 6)
        scenarios[name] = {"skyline_elevation_deg": shifted, "clearance_deg": margin, "is_visible": margin > 0}
    return {"body": body, "at_utc": iso, "azimuth_deg": azimuth, "elevation_deg": elevation,
            "skyline_elevation_deg": skyline, "clearance_deg": clearance, "is_visible": clearance > 0,
            "interpolated": interpolated, "sample_before_utc": lower[0], "sample_after_utc": upper[0],
            "sigma_deg": sigma, "scenarios": scenarios}


# --------------------------------------------------------------------------- windows and summaries

def load_windows(conn: Connection, analysis_id: int, body: str, scenario: str) -> tuple[list[derive.Window], list[dict]]:
    rows = [dict(r) for r in conn.execute(text(
        "SELECT * FROM visibility_window WHERE analysis_id = :a AND body = :b AND scenario = :s ORDER BY start_utc"),
        {"a": analysis_id, "b": body, "s": scenario}).mappings()]
    windows = [derive.Window(derive.parse_iso_utc(r["start_utc"]), derive.parse_iso_utc(r["end_utc"]),
                             bool(r["starts_before_data"]), bool(r["ends_after_data"])) for r in rows]
    return windows, rows


def windows_in_range(conn: Connection, analysis: dict, body: str, scenario: str, start: float, end: float,
                     with_uncertainty: bool = False) -> list[dict]:
    """Stored windows that overlap [start, end], each with the part that falls inside the range."""
    windows, rows = load_windows(conn, analysis["analysis_id"], body, scenario)
    out = []
    for w, row in zip(windows, rows):
        s, e = max(w.start, start), min(w.end, end)
        if e < s or (e == s and end > start):       # touching the range edge is not an overlap
            continue
        item = {"start_utc": row["start_utc"], "end_utc": row["end_utc"], "duration_h": row["duration_h"],
                "start_azimuth_deg": row["start_azimuth_deg"], "end_azimuth_deg": row["end_azimuth_deg"],
                "peak_elevation_deg": row["peak_elevation_deg"],
                "starts_before_data": bool(row["starts_before_data"]), "ends_after_data": bool(row["ends_after_data"]),
                "overlap_start_utc": derive.epoch_to_iso(s), "overlap_end_utc": derive.epoch_to_iso(e),
                "overlap_duration_h": (e - s) / 3600.0}
        if with_uncertainty:
            item["uncertainty"] = {
                "earliest_start_utc": row["earliest_start_utc"], "latest_start_utc": row["latest_start_utc"],
                "earliest_end_utc": row["earliest_end_utc"], "latest_end_utc": row["latest_end_utc"],
                "min_duration_h": row["min_duration_h"], "max_duration_h": row["max_duration_h"],
                "note": row["uncertainty_note"]}
        out.append(item)
    return out


def _summary_dict(s: dict) -> dict:
    return {"visible_hours": s["visible_hours"], "visible_fraction": s["visible_fraction"], "n_windows": s["n_windows"],
            "longest_window_h": s["longest_window_h"],
            "longest_window_start_utc": derive.epoch_to_iso(s["longest_window_start"]) if s["longest_window_start"] is not None else None,
            "longest_window_end_utc": derive.epoch_to_iso(s["longest_window_end"]) if s["longest_window_end"] is not None else None,
            "longest_gap_h": s["longest_gap_h"]}


def summary_for_period(conn: Connection, analysis: dict, start: float, end: float, scenario: str = "nominal") -> dict:
    """Visibility totals for Sun, Earth and both inside [start, end], by clipping the stored windows."""
    bodies = {}
    for body in WINDOW_BODIES:
        windows, _ = load_windows(conn, analysis["analysis_id"], body, scenario)
        bodies[body] = _summary_dict(derive.summarise_windows(windows, start, end))
    overlap = {}
    for name in derive.SCENARIOS:
        if name == scenario:
            overlap[name] = bodies["both"]
        else:
            windows, _ = load_windows(conn, analysis["analysis_id"], "both", name)
            overlap[name] = _summary_dict(derive.summarise_windows(windows, start, end))
    return {"period": {"start_utc": derive.epoch_to_iso(start), "end_utc": derive.epoch_to_iso(end),
                       "hours": (end - start) / 3600.0, "lunar_day_index": None},
            "scenario": scenario, "bodies": bodies, "best_overlap": _best_overlap(analysis, overlap)}


def summary_for_lunar_day(conn: Connection, analysis: dict, index: int, scenario: str = "nominal") -> dict:
    """The precomputed summary for a lunar day (1, 2, ...) or the whole coverage (0)."""
    rows = [dict(r) for r in conn.execute(text(
        "SELECT * FROM visibility_summary WHERE analysis_id = :a AND lunar_day_index = :i"),
        {"a": analysis["analysis_id"], "i": index}).mappings()]
    if not rows:
        known = [r[0] for r in conn.execute(text(
            "SELECT DISTINCT lunar_day_index FROM visibility_summary WHERE analysis_id = :a ORDER BY 1"),
            {"a": analysis["analysis_id"]})]
        raise ApiError(422, "unknown_lunar_day",
                       f"lunar_day={index} is not in the data. Available: {known} (0 = the whole coverage).",
                       {"available_lunar_days": known})
    pick = {(r["body"], r["scenario"]): r for r in rows}

    def as_dict(r: dict) -> dict:
        return {k: r[k] for k in ("visible_hours", "visible_fraction", "n_windows", "longest_window_h",
                                  "longest_window_start_utc", "longest_window_end_utc", "longest_gap_h")}

    first = pick[("sun", scenario)]
    return {"period": {"start_utc": first["period_start_utc"], "end_utc": first["period_end_utc"],
                       "hours": first["period_hours"], "lunar_day_index": index},
            "scenario": scenario, "bodies": {b: as_dict(pick[(b, scenario)]) for b in WINDOW_BODIES},
            "best_overlap": _best_overlap(analysis, {n: as_dict(pick[("both", n)]) for n in derive.SCENARIOS})}


def _best_overlap(analysis: dict, both_by_scenario: dict) -> dict:
    nominal = both_by_scenario["nominal"]
    return {"start_utc": nominal["longest_window_start_utc"], "end_utc": nominal["longest_window_end_utc"],
            "duration_h": nominal["longest_window_h"],
            "duration_h_optimistic": both_by_scenario["optimistic"]["longest_window_h"],
            "duration_h_pessimistic": both_by_scenario["pessimistic"]["longest_window_h"],
            "horizon_model": analysis["horizon_model"],
            "note": "Longest stretch inside the period with the Sun and the Earth both above the skyline (nominal skyline). "
                    "Optimistic and pessimistic durations are the longest such stretch with the skyline lowered or raised "
                    "by sigma. " + BOTH_VS_USABLE_NOTE}


def transition(conn: Connection, run: dict, analysis: dict, body: str, after: float, scenario: str) -> dict:
    """The next rise or set after a time, read from the stored windows."""
    require_in_coverage(after, run, "after")
    windows, rows = load_windows(conn, analysis["analysis_id"], body, scenario)
    _, cov_end = coverage_of(run)
    visible_now = derive.is_inside(windows, after)
    found = derive.next_transition(windows, after, cov_end)
    out = {"body": body, "after_utc": derive.epoch_to_iso(after), "scenario": scenario, "currently_visible": visible_now,
           "event": None, "time_utc": None, "hours_until": None, "azimuth_deg": None, "note": None}
    if found is None:
        out["note"] = (f"No rise or set between {derive.epoch_to_iso(after)} and the end of the data ({run['stop_utc']}). "
                       f"The API never extrapolates.")
        return out
    out.update(event=found["event"], time_utc=derive.epoch_to_iso(found["time"]),
               hours_until=(found["time"] - after) / 3600.0)
    for w, row in zip(windows, rows):
        if found["event"] == "rise" and w.start == found["time"]:
            out["azimuth_deg"] = row["start_azimuth_deg"]
        elif found["event"] == "set" and w.end == found["time"]:
            out["azimuth_deg"] = row["end_azimuth_deg"]
    return out


# --------------------------------------------------------------------------- cost

def cost_run(conn: Connection, site_id: str, horizon_model: str, horizon_lookup: Optional[str] = None) -> dict:
    """One cost run with metrics, histogram, assumptions and anchors. Never falls back to another horizon model."""
    if horizon_lookup:
        row = conn.execute(text("SELECT * FROM cost_run WHERE site_id = :s AND horizon_model = :m AND horizon_lookup = :l"),
                           {"s": site_id, "m": horizon_model, "l": horizon_lookup}).mappings().first()
    else:
        row = conn.execute(text("SELECT * FROM cost_run WHERE site_id = :s AND horizon_model = :m AND is_default = 1"),
                           {"s": site_id, "m": horizon_model}).mappings().first()
    available = cost_runs_available(conn, site_id)
    if row is None:
        wanted = f"horizon_model={horizon_model}" + (f", horizon_lookup={horizon_lookup}" if horizon_lookup else "")
        raise ApiError(404, "no_cost_run",
                       f"No cost run with {wanted} for site {site_id!r}. A cost run for a different horizon is never "
                       f"substituted. Rebuild with: python backend/scripts/build_db.py --rerun-cost",
                       {"available_runs": available})
    run = dict(row)
    rid = run["cost_run_id"]
    metrics = {r["metric"]: {"unit": r["unit"], "p10": r["p10"], "p50": r["p50"], "p90": r["p90"], "mean": r["mean"]}
               for r in conn.execute(text("SELECT * FROM cost_metric WHERE cost_run_id = :c"), {"c": rid}).mappings()}
    bins = [{"bin_lo": r["bin_lo"], "bin_hi": r["bin_hi"], "trial_count": r["trial_count"]}
            for r in conn.execute(text("SELECT * FROM cost_histogram_bin WHERE cost_run_id = :c ORDER BY bin_index"),
                                  {"c": rid}).mappings()]
    assumptions = [{k: r[k] for k in ("name", "description", "distribution", "param_min", "param_mode", "param_max",
                                      "param_mean", "param_sd", "unit", "source_note", "evidence_status")}
                   for r in conn.execute(text("SELECT * FROM cost_assumption WHERE cost_run_id = :c ORDER BY assumption_id"),
                                         {"c": rid}).mappings()]
    anchors = [dict(r) for r in conn.execute(text("SELECT * FROM cost_anchor ORDER BY award_year, anchor")).mappings()]
    caveats = [COST_CAVEAT, BOTH_VS_USABLE_NOTE]
    if horizon_model == "flat":
        caveats.insert(0, "This run assumes a flat 0-degree horizon and ignores terrain. Do not compare it with "
                          "terrain-aware visibility.")
    return {
        "cost_run_id": rid, "site_id": site_id, "horizon_model": run["horizon_model"],
        "horizon_lookup": run["horizon_lookup"], "is_default": bool(run["is_default"]),
        "model": {"name": run["model_name"], "n_trials": run["n_trials"], "n_finite_trials": run["n_finite_trials"],
                  "rng_seed": run["rng_seed"], "script_sha256": run["script_sha256"], "source_file": run["source_file"],
                  "notes": run["notes"]},
        "landing_time_utc": run["landing_time_utc"], "mission_days": run["mission_days"],
        "p_survive_full_mission": run["p_survive_full_mission"], "p_zero_usable_hours": run["p_zero_usable_hours"],
        "metrics": metrics,
        "histogram": {"metric": "burn_musd_per_usable_h", "unit": "musd_per_usable_hour", "bins": bins,
                      "note": "Counts cover only trials with at least one usable hour."},
        "assumptions": assumptions, "anchors": anchors, "usable_hour_definition": USABLE_HOUR_DEFINITION,
        "caveats": caveats, "available_runs": available,
    }


# --------------------------------------------------------------------------- terrain tile

def terrain_tile(conn: Connection, site_id: str, level: Optional[int], stride: Optional[int]) -> dict:
    """
    One tile level as a grid of heights in metres. Defaults: the level closest to a 10 km x 10 km
    tile (half width 5 km), thinned so that no more than 129 points per side are returned.
    """
    levels = tile_levels(conn, site_id)
    if not levels:
        raise ApiError(404, "no_terrain_tile",
                       f"No height tiles are loaded for site {site_id!r}. Produce them with: python lola_terrain.py, "
                       f"then rebuild the database.")
    if level is None:
        level = min(levels, key=lambda l: abs(l["half_width_m"] - 5000.0))["level_index"]
    row = conn.execute(text("SELECT * FROM terrain_tile WHERE site_id = :s AND level_index = :l"),
                       {"s": site_id, "l": level}).mappings().first()
    if row is None:
        raise ApiError(404, "no_terrain_tile_level",
                       f"Site {site_id!r} has no tile level {level}. Available levels: {[l['level_index'] for l in levels]}.",
                       {"levels_available": levels})
    values = array("h")
    values.frombytes(bytes(row["heights_i16_le"]))
    if sys.byteorder == "big":
        values.byteswap()
    n = row["n_cells"]
    scale = row["scale_m"]
    if stride is None:
        stride = max(1, -(-(n - 1) // 128))             # ceil((n - 1) / 128): 257 points -> every 2nd, 129 -> all
    picks = list(range(0, n, stride))
    heights = [[values[r * n + c] * scale for c in picks] for r in picks]
    return {"site_id": site_id, "level_index": level, "half_width_m": row["half_width_m"],
            "n_cells_stored": n, "stride": stride, "n_cells": len(picks), "spacing_m": row["spacing_m"] * stride,
            "source_id": row["source_id"], "layout_note": row["layout_note"], "levels_available": levels,
            "heights_m": heights}


# --------------------------------------------------------------------------- table shapes

def to_columns(rows: Sequence[dict], names: Sequence[str]) -> dict[str, list[Any]]:
    """Rows -> {column: [values]}; pandas.DataFrame(result['columns']) works directly."""
    return {name: [row.get(name) for row in rows] for name in names}


def to_csv(rows: Sequence[dict], names: Sequence[str]) -> str:
    import csv
    import io
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(names)
    for row in rows:
        writer.writerow(["" if row.get(name) is None else row.get(name) for name in names])
    return buffer.getvalue()
