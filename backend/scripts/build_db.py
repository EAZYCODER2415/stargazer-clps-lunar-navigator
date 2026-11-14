#!/usr/bin/env python3
"""
build_db.py: builds the read-only Stargazer database from the files already in the repo.

    python backend/scripts/build_db.py --rerun-cost

This is the ONLY program that writes the database. It reads:

    frontend/src/data/landingSites.json          site list (the only source of site rows)
    ephemeris_long/<id>.json                     JPL Horizons Sun/Earth azimuth and elevation (required)
    frontend/src/data/horizon/<id>.json          LOLA skyline, the same mask the website uses (required)
    terrain/<id>_horizon.json                    blocker_km / covered_km per azimuth (optional)
    frontend/src/data/terrain/<id>.json + .bin   nested height tiles (optional), or the older single
    terrain/<id>_tile.json                       10 km tile written by earlier versions of lola_terrain.py
    ephemeris_long/<id>_cost*.json               cost model outputs (optional, see below)
    backend/data/site_notes.json                 per-site notes and coordinate status (optional)
    backend/data/cost_sources.csv                cost anchor sources for the team to fill (optional)

and writes backend/data/stargazer.db (to a temporary file first, then an atomic rename), plus
backend/docs/BUILD_REPORT.md.

Cost runs (fix order F1):
    --rerun-cost            run cost_mc.py in-process with each site's real skyline and store the result
                            (also written to backend/data/cost_runs/ so later builds can reuse it)
    without it              a lola_mask cost run is read from ephemeris_long/<id>_cost_lola_mask.json
                            (the patched cost_mc.py output) or backend/data/cost_runs/
    --allow-missing-cost    do not fail when a site has terrain-aware visibility but no terrain-aware cost run

Everything derived (clearance, windows, summaries, uncertainty bounds) is computed here, once,
with the functions in backend/derive.py.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import derive  # noqa: E402
import sqlitedb  # noqa: E402
from sqlitedb import text  # noqa: E402

SCHEMA_VERSION = "1.0.0"
SCHEMA_FILE = BACKEND_DIR / "schema" / "schema.sql"
BODIES = ("sun", "earth")
TILE_LAYOUT_NOTE = ("rows south->north, cols west->east; metres = stored integer * scale_m, measured from the "
                    "site's own horizontal plane (lunar curvature included)")
ASSUMPTION_INFO = {
    # key in cost_mc.py's "assumptions" -> (name, description, distribution, unit, source_note, evidence_status)
    "delivery_M": ("delivery_price", "CLPS delivery price", "triangular", "musd",
                   "cost_mc.py comment: anchored on CLPS task orders Peregrine $79.5M (2019), CP-22 $116.9M (2024), "
                   "IM-5 $180.4M (2026). No source recorded in the repo.", "needs_verification"),
    "cost_growth": ("cost_growth", "Cost growth on top of the award", "triangular", "fraction",
                    "cost_mc.py comment: program average reported about 26%. No source recorded in the repo.",
                    "needs_verification"),
    "ops_M_per_h": ("ops_cost", "Surface operations cost per hour alive", "triangular", "musd_per_hour",
                    "cost_mc.py comment: a CLPS task order is a fixed-price end-to-end delivery service, so operations "
                    "sit inside the delivery price.", "team_assumption"),
    "battery_h": ("battery_endurance", "Hours the lander keeps working with the Sun down", "triangular", "hours",
                  "cost_mc.py comment: Blue Ghost M1 about 5 h into lunar night; IM-1 Odysseus 10 to 20 h; neither "
                  "built to survive the night. No source recorded in the repo.", "needs_verification"),
    "horizon_sd_deg": ("horizon_error", "Skyline error (terrain model plus mast height)", "normal", "degrees",
                       "Team assumption in cost_mc.py (HORIZON_SD_DEG).", "team_assumption"),
}


class BuildError(Exception):
    """A problem that stops the build. The message says what to fix."""


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: Path):
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


# --------------------------------------------------------------------------- reading and validating inputs

class Inputs:
    """Everything read from disk for one build, plus the manifest of files used."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.manifest: dict[str, str] = {}
        self.flags: list[dict] = []
        self.notes: list[str] = []

    def rel(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.repo_root.resolve()).as_posix()
        except ValueError:
            return path.name

    def use(self, path: Path) -> Path:
        self.manifest[self.rel(path)] = sha256_file(path)
        return path

    def flag(self, code: str, severity: str, scope: str, message: str, fix_order: str | None = None) -> None:
        self.flags.append({"code": code, "severity": severity, "scope": scope, "message": message,
                           "fix_order": fix_order})


def read_sites(inputs: Inputs) -> list[dict]:
    path = inputs.repo_root / "frontend" / "src" / "data" / "landingSites.json"
    if not path.exists():
        raise BuildError(f"Site list not found: {inputs.rel(path)}. It is written by backend/ephemeris_fetch.py.")
    sites = load_json(inputs.use(path))
    if not isinstance(sites, list) or not sites:
        raise BuildError(f"{inputs.rel(path)} must be a non-empty list of sites.")
    seen = set()
    for site in sites:
        for key in ("id", "name", "latitude", "longitude"):
            if key not in site:
                raise BuildError(f"{inputs.rel(path)}: a site is missing '{key}': {site}")
        if site["id"] in seen:
            raise BuildError(f"{inputs.rel(path)}: duplicate site id '{site['id']}'")
        seen.add(site["id"])
        if not (is_number(site["latitude"]) and -90 <= site["latitude"] <= 90 and is_number(site["longitude"])):
            raise BuildError(f"{inputs.rel(path)}: bad coordinates for '{site['id']}'")
    return sites


def read_ephemeris(inputs: Inputs, site: dict) -> dict:
    path = inputs.repo_root / "ephemeris_long" / f"{site['id']}.json"
    if not path.exists():
        raise BuildError(f"Ephemeris for '{site['id']}' not found: {inputs.rel(path)}. "
                         f"Run: python backend/ephemeris_fetch.py")
    data = load_json(inputs.use(path))
    name = inputs.rel(path)
    out = {"file": name, "alt_km": float(data.get("observer_alt_km_used", data.get("site", {}).get("alt_km", 0.0)))}
    file_site = data.get("site", {})
    if abs(file_site.get("lat", site["latitude"]) - site["latitude"]) > 1e-6 or \
            abs((file_site.get("lon", site["longitude"]) - site["longitude"] + 180) % 360 - 180) > 1e-6:
        raise BuildError(f"{name}: site coordinates {file_site.get('lat')}, {file_site.get('lon')} do not match "
                         f"landingSites.json ({site['latitude']}, {site['longitude']}). Re-run backend/ephemeris_fetch.py.")
    times = None
    for body in BODIES:
        rows = data.get(body)
        if not rows:
            raise BuildError(f"{name}: no '{body}' rows")
        t = [derive.horizons_time_to_epoch(r["t"]) for r in rows]
        az = [r["az"] for r in rows]
        el = [r["el"] for r in rows]
        for i, (a, e) in enumerate(zip(az, el)):
            if not (is_number(a) and 0 <= a < 360):
                raise BuildError(f"{name}: {body} row {i}: azimuth {a!r} is outside [0, 360)")
            if not (is_number(e) and -90 <= e <= 90):
                raise BuildError(f"{name}: {body} row {i}: elevation {e!r} is outside [-90, 90]")
        steps = {round(b - a) for a, b in zip(t, t[1:])}
        if len(t) < 2 or len(steps) != 1 or next(iter(steps)) <= 0:
            raise BuildError(f"{name}: {body} timestamps must increase by one constant step; found steps {sorted(steps)[:5]}")
        if times is None:
            times = t
        elif t != times:
            raise BuildError(f"{name}: sun and earth rows do not share the same timestamps")
        out[body] = {"az": az, "el": el}
    out["times"] = times
    out["step_seconds"] = int(round(times[1] - times[0]))
    out["flat_best_overlap"] = data.get("best_overlap_flat_horizon", data.get("best_overlap"))   # kept out of the database (F2)
    return out


def read_horizon(inputs: Inputs, site: dict) -> dict:
    """The website's mask is the canonical skyline; terrain/<id>_horizon.json only adds blocker and coverage distances."""
    sid = site["id"]
    web = inputs.repo_root / "frontend" / "src" / "data" / "horizon" / f"{sid}.json"
    detail = inputs.repo_root / "terrain" / f"{sid}_horizon.json"
    if not web.exists():
        raise BuildError(f"Horizon mask for '{sid}' not found: {inputs.rel(web)}. Run: python lola_terrain.py "
                         f"(downloads the 111 MB LOLA map into lola_cache/ on first run).")
    data = load_json(inputs.use(web))
    if isinstance(data, list):                                  # a bare list of 360 numbers is accepted too
        data = {"mask_deg": data}
    mask = data.get("mask_deg")
    if not isinstance(mask, list) or len(mask) != 360 or not all(is_number(v) and -90 <= v <= 90 for v in mask):
        raise BuildError(f"{inputs.rel(web)}: mask_deg must be 360 finite numbers in degrees")
    observer = data.get("observer", {})
    def distances(source: dict, key: str):
        values = source.get(key)
        return values if isinstance(values, list) and len(values) == 360 else None

    out = {"file": inputs.rel(web), "mask": [float(v) for v in mask],
           "ground_height_m": observer.get("ground_height_m"), "mast_m": observer.get("mast_m"),
           "source": data.get("source"),
           # Some versions of lola_terrain.py also write blocker_km into the website's file.
           "blocker_km": distances(data, "blocker_km"), "covered_km": distances(data, "covered_km")}
    if out["mast_m"] is None:
        inputs.flag("MAST_HEIGHT_NOT_RECORDED", "info", f"site:{sid}",
                    f"{inputs.rel(web)} does not record the observer mast height; 3.0 m (lola_terrain.py's default) is assumed.")
        out["mast_m"] = 3.0
    if detail.exists():
        extra = load_json(inputs.use(detail))
        detail_mask = extra.get("mask_deg", [])
        diff = max((abs(a - b) for a, b in zip(mask, detail_mask)), default=float("inf")) if len(detail_mask) == 360 else float("inf")
        out["mask_file_max_diff_deg"] = diff
        if diff <= 0.01:
            out["blocker_km"] = distances(extra, "blocker_km") or out["blocker_km"]
            out["covered_km"] = distances(extra, "covered_km") or out["covered_km"]
            inputs.notes.append(f"{sid}: {inputs.rel(detail)} agrees with the website mask within {diff:.4f} deg; blocker and coverage distances loaded.")
        else:
            inputs.flag("MASK_FILES_DISAGREE", "warning", f"site:{sid}",
                        f"{inputs.rel(detail)} and {inputs.rel(web)} differ by up to {diff:.3f} deg (limit 0.01). They come "
                        f"from different lola_terrain.py runs, so blocker distances were not loaded. Re-run python lola_terrain.py.",
                        "F6")
    if out["blocker_km"] is None and "MASK_FILES_DISAGREE" not in [f["code"] for f in inputs.flags if f["scope"] == f"site:{sid}"]:
        inputs.flag("BLOCKER_DISTANCE_MISSING", "info", f"site:{sid}",
                    f"No terrain/{sid}_horizon.json, so the distance to the skyline-defining terrain is not available. "
                    f"Produce it with: python lola_terrain.py (the terrain/ folder is git-ignored, so each machine must run it).",
                    "F6")
    return out


def read_tiles(inputs: Inputs, site: dict) -> list[dict]:
    sid = site["id"]
    meta_path = inputs.repo_root / "frontend" / "src" / "data" / "terrain" / f"{sid}.json"
    bin_path = meta_path.with_suffix(".bin")
    legacy_path = inputs.repo_root / "terrain" / f"{sid}_tile.json"
    if not (meta_path.exists() and bin_path.exists()):
        if legacy_path.exists():
            return [read_legacy_tile(inputs, legacy_path)]
        inputs.flag("TERRAIN_TILE_MISSING", "info", f"site:{sid}",
                    f"No height tiles at frontend/src/data/terrain/{sid}.json + .bin (or terrain/{sid}_tile.json), so "
                    f"/terrain-tile returns 404 for this site. Produce them with: python lola_terrain.py", "F6")
        return []
    meta = load_json(inputs.use(meta_path))
    raw = inputs.use(bin_path).read_bytes()
    levels = []
    for index, level in enumerate(meta.get("levels", [])):
        cells = int(level["cells"])
        size = cells * cells * 2
        start = int(level["offset_bytes"])
        blob = raw[start:start + size]
        if len(blob) != size:
            raise BuildError(f"{inputs.rel(bin_path)}: level {index} needs {size} bytes at offset {start}, file is too short. "
                             f"Re-run python lola_terrain.py.")
        levels.append({"level_index": index, "half_width_m": float(level["half_width_m"]), "n_cells": cells,
                       "spacing_m": float(level["spacing_m"]), "scale_m": float(level["scale_m"]), "blob": blob,
                       "layout_note": TILE_LAYOUT_NOTE})
    return levels


def read_legacy_tile(inputs: Inputs, path: Path) -> dict:
    """The single 10 km tile written by earlier versions of lola_terrain.py: a square list of heights in metres."""
    import struct
    data = load_json(inputs.use(path))
    grid = data.get("heights_m")
    cells = len(grid) if isinstance(grid, list) else 0
    if cells < 2 or any(not isinstance(row, list) or len(row) != cells for row in grid) \
            or not all(is_number(v) for row in grid for v in row):
        raise BuildError(f"{inputs.rel(path)}: heights_m must be a square grid of finite numbers. Re-run python lola_terrain.py.")
    half_width = float(data["half_width_m"])
    peak = max(abs(v) for row in grid for v in row)
    scale = next((s for s in (0.1, 0.2, 0.5, 1.0, 2.0, 5.0) if peak / s < 32000), None)
    if scale is None:
        raise BuildError(f"{inputs.rel(path)}: heights up to {peak:.0f} m do not fit the 16-bit tile format.")
    blob = struct.pack(f"<{cells * cells}h", *(int(round(v / scale)) for row in grid for v in row))
    return {"level_index": 0, "half_width_m": half_width, "n_cells": cells, "spacing_m": 2 * half_width / (cells - 1),
            "scale_m": scale, "blob": blob,
            "layout_note": (data.get("note") or "rows run south to north, columns west to east; heights in metres relative "
                            "to the site") + f" (single tile from {inputs.rel(path)}; lunar curvature not included)"}


def validate_cost_result(result: dict, name: str) -> int:
    """Checks one cost_mc.py output. Returns the number of trials with a defined burn ratio."""
    for key in ("burn_M_per_usable_h", "usable_h", "alive_days"):
        p = result.get(key, {})
        values = [p.get("p10"), p.get("p50"), p.get("p90")]
        if not all(is_number(v) for v in values):
            raise BuildError(f"{name}: {key} must have finite p10/p50/p90 (burn is undefined in a trial with zero usable "
                             f"hours and must be left out, never stored as Infinity)")
        if not values[0] <= values[1] <= values[2]:
            raise BuildError(f"{name}: {key} percentiles are not ordered: {values}")
    hist = result.get("histogram", {})
    edges, counts = hist.get("bin_edges", []), hist.get("counts", [])
    if len(edges) != len(counts) + 1 or not counts:
        raise BuildError(f"{name}: histogram needs N counts and N+1 bin edges")
    trials = int(result["trials"])
    finite = int(sum(counts))
    expected = trials * (1 - float(result.get("p_zero_usable_hours", 0.0)))
    # p_zero_usable_hours is rounded to 3 decimals in the file, hence the tolerance.
    if abs(finite - expected) > 0.0005 * trials + 1:
        raise BuildError(f"{name}: histogram counts sum to {finite}, expected about {expected:.0f} "
                         f"(trials x (1 - p_zero_usable_hours))")
    return finite


# --------------------------------------------------------------------------- database writing

def create_schema(conn) -> None:
    statements = [s.strip() for s in _strip_sql_comments(SCHEMA_FILE.read_text(encoding="utf-8")).split(";")]
    for statement in statements:
        if statement:
            conn.execute(text(statement))


def _strip_sql_comments(sql: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def insert(conn, table: str, row: dict) -> int:
    columns = ", ".join(row)
    params = ", ".join(f":{key}" for key in row)
    result = conn.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({params})"), row)
    return result.lastrowid


def insert_many(conn, table: str, rows: list[dict]) -> None:
    if not rows:
        return
    columns = ", ".join(rows[0])
    params = ", ".join(f":{key}" for key in rows[0])
    conn.execute(text(f"INSERT INTO {table} ({columns}) VALUES ({params})"), rows)


def insert_sources(conn) -> None:
    insert_many(conn, "data_source", [
        {"source_id": "jpl_horizons", "name": "NASA/JPL Horizons observer tables", "version": None,
         "url": "https://ssd.jpl.nasa.gov/api/horizons.api", "retrieved_utc": None,
         "license_note": "NASA/JPL public data service",
         "description": "Apparent azimuth and elevation (QUANTITIES=4) of the Sun and Earth for an observer on the Moon "
                        "(CENTER=coord@301, geodetic site coordinates), hourly, fetched by backend/ephemeris_fetch.py. "
                        "The retrieval time is not recorded in the files."},
        {"source_id": "lola_ldem_80s_80m", "name": "NASA LOLA gridded elevation model LDEM_80S_80M", "version": "v2.0",
         "url": "https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.IMG", "retrieved_utc": None,
         "license_note": "NASA PDS public data",
         "description": "80 m/pixel south polar stereographic elevation, heights above a 1737.4 km sphere. Horizon masks "
                        "and height tiles are derived from it by lola_terrain.py."},
        {"source_id": "clps_public_awards", "name": "CLPS task order award values (as noted in cost_mc.py)", "version": None,
         "url": None, "retrieved_utc": None, "license_note": None,
         "description": "Delivery-price anchors named in a comment in backend/cost_mc.py. No sources are recorded in the "
                        "repo; see /cost anchors and backend/data/cost_sources.csv."},
        {"source_id": "stargazer_cost_model", "name": "Stargazer Monte Carlo cost model (backend/cost_mc.py)", "version": None,
         "url": None, "retrieved_utc": None, "license_note": None,
         "description": "Team model: total mission cost divided by usable operating hours. A distribution under stated "
                        "assumptions, not a mission-grade estimate."},
    ])


def build_site(conn, inputs: Inputs, site: dict, site_notes: dict, eph: dict, horizon: dict, tiles: list[dict],
               sigma: float) -> dict:
    """Inserts one site with its ephemeris, horizon, tiles, both analyses, windows and summaries."""
    sid = site["id"]
    notes = site_notes.get(sid, {})
    insert(conn, "site", {
        "site_id": sid, "name": site["name"], "latitude_deg": float(site["latitude"]),
        "longitude_deg_east": float(site["longitude"]) % 360.0,
        "ground_height_m": horizon["ground_height_m"], "observer_mast_m": horizon["mast_m"],
        "region_note": notes.get("region_note"), "mission_context": notes.get("mission_context"),
        "coordinate_source": notes.get("coordinate_source"),
        "coordinate_status": notes.get("coordinate_status") or "unverified"})
    if (notes.get("coordinate_status") or "unverified") != "verified":
        inputs.flag("COORDINATES_UNVERIFIED", "info", f"site:{sid}",
                    "Site coordinates and notes come from repo comments with no cited source. Add the citation to "
                    "backend/data/site_notes.json to mark them verified.", "F5")

    times = eph["times"]
    iso = [derive.epoch_to_iso(t) for t in times]
    run_id = insert(conn, "ephemeris_run", {
        "site_id": sid, "source_id": "jpl_horizons", "start_utc": iso[0], "stop_utc": iso[-1],
        "step_seconds": eph["step_seconds"], "n_samples": len(times), "time_scale": "UTC",
        "observer_center": "coord@301", "observer_alt_km_used": eph["alt_km"], "horizons_quantities": "4",
        "retrieved_utc": None, "notes": f"from {eph['file']}"})
    for body in BODIES:
        insert_many(conn, "ephemeris_sample", [
            {"run_id": run_id, "body": body, "t_utc": t, "azimuth_deg": a, "elevation_deg": e}
            for t, a, e in zip(iso, eph[body]["az"], eph[body]["el"])])
    ground_km = (horizon["ground_height_m"] or 0.0) / 1000.0
    if abs(eph["alt_km"] - ground_km) > 0.05:
        inputs.flag("HORIZONS_ALTITUDE_NOT_SITE_HEIGHT", "info", f"site:{sid}",
                    f"The Horizons ephemeris was fetched for an observer at {eph['alt_km']:.2f} km above the reference sphere; "
                    f"the LOLA ground height is {ground_km:.2f} km. Terrain is handled by the horizon mask, not by the ephemeris. "
                    f"Upper bound on the direction error from the height difference (height / distance): about "
                    f"{math.degrees(abs(ground_km - eph['alt_km']) / 356400.0):.5f} deg for Earth at its closest (356,400 km) and "
                    f"{math.degrees(abs(ground_km - eph['alt_km']) / 147.1e6):.7f} deg for the Sun. Not yet checked against a "
                    f"re-fetch with the real altitude.", "F4")

    profile_id = insert(conn, "horizon_profile", {
        "site_id": sid, "source_id": "lola_ldem_80s_80m", "mast_m": horizon["mast_m"],
        "ground_height_m": horizon["ground_height_m"], "n_bins": 360, "sigma_deg": sigma,
        "mask_source_file": horizon["file"],
        "notes": "Skyline includes lunar curvature, the site's ground height and the mast. sigma_deg is a team assumption "
                 "(HORIZON_SD_DEG in cost_mc.py)."})
    blocker, covered = horizon["blocker_km"], horizon["covered_km"]
    insert_many(conn, "horizon_bin", [
        {"profile_id": profile_id, "azimuth_deg": i, "skyline_elevation_deg": horizon["mask"][i],
         "blocker_distance_km": blocker[i] if blocker else None, "covered_km": covered[i] if covered else None}
        for i in range(360)])
    insert_many(conn, "terrain_tile", [
        {"site_id": sid, "level_index": level["level_index"], "source_id": "lola_ldem_80s_80m",
         "half_width_m": level["half_width_m"], "n_cells": level["n_cells"], "spacing_m": level["spacing_m"],
         "scale_m": level["scale_m"], "heights_i16_le": level["blob"], "layout_note": level["layout_note"]}
        for level in tiles])

    analyses = {}
    created = now_iso()
    periods = derive.lunar_day_periods(times[0], times[-1])
    for model, mask, pid, interp in (("flat", None, None, "not_applicable"),
                                     ("lola_mask", horizon["mask"], profile_id, derive.MASK_LINEAR)):
        analysis_id = insert(conn, "analysis", {
            "site_id": sid, "ephemeris_run_id": run_id, "horizon_model": model, "horizon_profile_id": pid,
            "mask_interpolation": interp, "sigma_deg": sigma, "created_utc": created})
        analyses[model] = analysis_id
        clearance = {}
        for body in BODIES:
            skyline, clear = derive.clearance_series(eph[body]["az"], eph[body]["el"], mask, derive.MASK_LINEAR)
            clearance[body] = clear
            insert_many(conn, "visibility_sample", [
                {"analysis_id": analysis_id, "body": body, "t_utc": t, "horizon_elevation_deg": s,
                 "clearance_deg": c, "is_visible": 1 if c > 0 else 0}
                for t, s, c in zip(iso, skyline, clear)])
        windows = {}
        for scenario in derive.SCENARIOS:
            shift = -derive.SCENARIO_SKYLINE_SHIFT[scenario] * sigma      # skyline up by sigma = clearance down by sigma
            for body in BODIES:
                windows[(body, scenario)] = derive.windows_from_clearance(times, clearance[body], shift)
            windows[("both", scenario)] = derive.intersect_windows(windows[("sun", scenario)], windows[("earth", scenario)])
        for body in BODIES + ("both",):
            bounds = derive.match_uncertainty(windows[(body, "nominal")], windows[(body, "optimistic")],
                                              windows[(body, "pessimistic")])
            for scenario in derive.SCENARIOS:
                rows = []
                for k, w in enumerate(windows[(body, scenario)]):
                    row = {"analysis_id": analysis_id, "body": body, "scenario": scenario,
                           "start_utc": derive.epoch_to_iso(w.start), "end_utc": derive.epoch_to_iso(w.end),
                           "duration_h": w.duration_h, "start_azimuth_deg": None, "end_azimuth_deg": None,
                           "peak_elevation_deg": None, "starts_before_data": int(w.starts_before_data),
                           "ends_after_data": int(w.ends_after_data), "earliest_start_utc": None,
                           "latest_start_utc": None, "earliest_end_utc": None, "latest_end_utc": None,
                           "min_duration_h": None, "max_duration_h": None, "uncertainty_note": None}
                    if body != "both":
                        row.update(derive.window_details(w, times, eph[body]["az"], eph[body]["el"]))
                    if scenario == "nominal":
                        b = bounds[k]
                        row.update({
                            "earliest_start_utc": derive.epoch_to_iso(b["earliest_start"]) if b["earliest_start"] is not None else None,
                            "latest_start_utc": derive.epoch_to_iso(b["latest_start"]) if b["latest_start"] is not None else None,
                            "earliest_end_utc": derive.epoch_to_iso(b["earliest_end"]) if b["earliest_end"] is not None else None,
                            "latest_end_utc": derive.epoch_to_iso(b["latest_end"]) if b["latest_end"] is not None else None,
                            "min_duration_h": b["min_duration_h"], "max_duration_h": b["max_duration_h"],
                            "uncertainty_note": b["note"]})
                    rows.append(row)
                insert_many(conn, "visibility_window", rows)
                summary_rows = []
                for index, start, end in periods:
                    s = derive.summarise_windows(windows[(body, scenario)], start, end)
                    summary_rows.append({
                        "analysis_id": analysis_id, "body": body, "scenario": scenario, "lunar_day_index": index,
                        "period_start_utc": derive.epoch_to_iso(start), "period_end_utc": derive.epoch_to_iso(end),
                        "period_hours": s["period_hours"], "visible_hours": s["visible_hours"],
                        "visible_fraction": s["visible_fraction"], "n_windows": s["n_windows"],
                        "longest_window_h": s["longest_window_h"],
                        "longest_window_start_utc": derive.epoch_to_iso(s["longest_window_start"]) if s["longest_window_start"] is not None else None,
                        "longest_window_end_utc": derive.epoch_to_iso(s["longest_window_end"]) if s["longest_window_end"] is not None else None,
                        "longest_gap_h": s["longest_gap_h"]})
                insert_many(conn, "visibility_summary", summary_rows)
    return {"analyses": analyses, "run_id": run_id, "profile_id": profile_id}


def insert_cost_run(conn, site_id: str, analysis_id: int, result: dict, horizon_model: str, horizon_lookup: str,
                    is_default: bool, source_file: str | None, script_hash: str | None, notes: str,
                    anchors_verified: bool, name: str) -> int:
    finite = validate_cost_result(result, name)
    cost_run_id = insert(conn, "cost_run", {
        "site_id": site_id, "analysis_id": analysis_id, "horizon_model": horizon_model,
        "horizon_lookup": horizon_lookup, "is_default": int(is_default),
        "model_name": "stargazer_cost_mc_financial_burn_ratio", "n_trials": int(result["trials"]),
        "n_finite_trials": finite, "rng_seed": result.get("seed"), "script_sha256": script_hash,
        "source_file": source_file,
        "landing_time_utc": derive.epoch_to_iso(derive.horizons_time_to_epoch(result["landing_time_utc"])),
        "mission_days": float(result["mission_days"]),
        "p_survive_full_mission": result.get("p_survive_full_mission"),
        "p_zero_usable_hours": result.get("p_zero_usable_hours"), "created_utc": now_iso(), "notes": notes})
    for key, metric, unit in (("burn_M_per_usable_h", "burn_musd_per_usable_h", "musd_per_usable_hour"),
                              ("usable_h", "usable_hours", "hours"), ("alive_days", "alive_days", "days")):
        p = result[key]
        insert(conn, "cost_metric", {"cost_run_id": cost_run_id, "metric": metric, "unit": unit,
                                     "p10": float(p["p10"]), "p50": float(p["p50"]), "p90": float(p["p90"]),
                                     "mean": None})
    edges, counts = result["histogram"]["bin_edges"], result["histogram"]["counts"]
    insert_many(conn, "cost_histogram_bin", [
        {"cost_run_id": cost_run_id, "bin_index": i, "bin_lo": float(edges[i]), "bin_hi": float(edges[i + 1]),
         "trial_count": int(counts[i])} for i in range(len(counts))])
    rows = []
    for key, value in result.get("assumptions", {}).items():
        if key not in ASSUMPTION_INFO:
            rows.append({"cost_run_id": cost_run_id, "name": key, "description": "Unrecognised assumption in the cost output",
                         "distribution": "fixed", "param_min": None, "param_mode": None, "param_max": None,
                         "param_mean": float(value) if is_number(value) else None, "param_sd": None, "unit": None,
                         "source_note": "Not described in build_db.py", "evidence_status": "needs_verification"})
            continue
        label, description, distribution, unit, source_note, evidence = ASSUMPTION_INFO[key]
        row = {"cost_run_id": cost_run_id, "name": label, "description": description, "distribution": distribution,
               "param_min": None, "param_mode": None, "param_max": None, "param_mean": None, "param_sd": None,
               "unit": unit, "source_note": source_note, "evidence_status": evidence}
        if value is None:
            row["distribution"] = "not_modelled"
        elif distribution == "triangular":
            row.update(param_min=float(value[0]), param_mode=float(value[1]), param_max=float(value[2]))
        elif distribution == "normal":
            row.update(param_mean=0.0, param_sd=float(value))
        if key == "delivery_M" and anchors_verified:
            row["evidence_status"] = "anchored_on_public_data"
        rows.append(row)
    insert_many(conn, "cost_assumption", rows)
    return cost_run_id


def read_cost_anchors(conn, inputs: Inputs, path: Path) -> bool:
    """Loads backend/data/cost_sources.csv. Returns True only when every anchor has a source URL and a verification date."""
    if not path.exists():
        inputs.flag("COST_ANCHORS_FILE_MISSING", "warning", "dataset",
                    "backend/data/cost_sources.csv is missing, so the delivery-price anchors cannot be listed or verified.", "F7")
        return False
    rows = []
    with inputs.use(path).open(encoding="utf-8", newline="") as source:
        for record in csv.DictReader(source):
            anchor = (record.get("anchor") or "").strip()
            if not anchor:
                continue
            url = (record.get("source_url") or "").strip() or None
            verified_on = (record.get("verified_on") or "").strip() or None
            rows.append({"anchor": anchor, "award_musd": float(record["award_musd"]),
                         "award_year": int(record["award_year"]) if (record.get("award_year") or "").strip() else None,
                         "source_url": url, "verified_by": (record.get("verified_by") or "").strip() or None,
                         "verified_on": verified_on,
                         "evidence_status": "anchored_on_public_data" if url and verified_on else "needs_verification"})
    insert_many(conn, "cost_anchor", rows)
    unverified = [r["anchor"] for r in rows if r["evidence_status"] != "anchored_on_public_data"]
    if unverified or not rows:
        inputs.flag("COST_ANCHORS_UNVERIFIED", "warning", "dataset",
                    f"Delivery-price anchors with no recorded source: {', '.join(unverified) or 'none listed'}. Fill source_url, "
                    f"verified_by and verified_on in backend/data/cost_sources.csv and rebuild.", "F7")
    return bool(rows) and not unverified


def build_costs(conn, inputs: Inputs, args, site: dict, eph: dict, horizon: dict, analyses: dict,
                anchors_verified: bool, cost_module, script_hash: str | None, report: dict) -> None:
    sid = site["id"]
    eph_path = inputs.repo_root / "ephemeris_long" / f"{sid}.json"
    eph_dir = inputs.repo_root / "ephemeris_long"
    site_report = report["cost"].setdefault(sid, {})

    # Flat horizon: the patched script's <id>_cost_flat.json if the team has produced it, else the legacy <id>_cost.json.
    flat_new, flat_legacy = eph_dir / f"{sid}_cost_flat.json", eph_dir / f"{sid}_cost.json"
    flat_path = flat_new if flat_new.exists() else flat_legacy if flat_legacy.exists() else None
    if flat_path:
        result = load_json(inputs.use(flat_path))
        declared = result.get("horizon_model")
        if declared not in (None, "flat"):
            raise BuildError(f"{inputs.rel(flat_path)} says horizon_model={declared!r}; a flat cost file is expected here.")
        run_id = insert_cost_run(conn, sid, analyses["flat"], result, "flat", "not_applicable", True,
                                 inputs.rel(flat_path), None,
                                 "Flat 0-degree horizon. Ignores terrain." + ("" if declared else " Legacy file with no horizon label; "
                                 "identified as flat because it matches a flat-horizon run."),
                                 anchors_verified, inputs.rel(flat_path))
        inputs.flag("COST_RUN_FLAT_HORIZON", "warning", f"cost_run:{run_id}",
                    f"This cost run ({inputs.rel(flat_path)}) assumes a flat horizon and ignores terrain. Do not show it next to "
                    f"terrain-aware visibility without saying so. Use horizon_model=lola_mask for the terrain-aware run.", "F1")
        site_report["flat"] = _cost_line(result)

    # Terrain-aware runs.
    runs_dir = Path(args.cost_runs_dir)
    lola_results: dict[str, tuple[dict, str | None]] = {}
    if args.rerun_cost:
        if cost_module is None:
            raise BuildError("--rerun-cost needs backend/cost_mc.py and numpy (pip install numpy).")
        runs_dir.mkdir(parents=True, exist_ok=True)
        for lookup, suffix in ((derive.MASK_LINEAR, ""), (derive.MASK_FLOOR, "_nearest_lower_bin")):
            import cost_step
            result = cost_step.run_cost(cost_module, eph_path, horizon["mask"], lookup, args.seed)
            out = runs_dir / f"{sid}_cost_lola_mask{suffix}.json"
            out.write_text(json.dumps(result, indent=2), encoding="utf-8")
            lola_results[lookup] = (result, inputs.rel(out))
    else:
        for lookup, suffix in ((derive.MASK_LINEAR, ""), (derive.MASK_FLOOR, "_nearest_lower_bin")):
            for folder in (eph_dir, runs_dir):
                candidate = folder / f"{sid}_cost_lola_mask{suffix}.json"
                if candidate.exists():
                    result = load_json(inputs.use(candidate))
                    declared = result.get("horizon_lookup", lookup)
                    if result.get("horizon_model", "lola_mask") != "lola_mask" or declared != lookup:
                        raise BuildError(f"{inputs.rel(candidate)} is labelled {result.get('horizon_model')}/{declared}; "
                                         f"expected lola_mask/{lookup}.")
                    lola_results[lookup] = (result, inputs.rel(candidate))
                    break
    default_lookup = derive.MASK_LINEAR if derive.MASK_LINEAR in lola_results else derive.MASK_FLOOR
    for lookup, (result, source_file) in lola_results.items():
        note = ("Real LOLA skyline, mask read by linear interpolation between bins (same rule as the website and this database)."
                if lookup == derive.MASK_LINEAR else
                "Real LOLA skyline, mask read at floor(azimuth): cost_mc.py's original rule, kept so earlier runs reproduce.")
        insert_cost_run(conn, sid, analyses["lola_mask"], result, "lola_mask", lookup, lookup == default_lookup,
                        source_file, script_hash if args.rerun_cost else None, note, anchors_verified,
                        source_file or f"{sid} lola_mask {lookup}")
        site_report[lookup] = _cost_line(result)
    if not lola_results:
        inputs.flag("COST_RUN_MISSING_FOR_LOLA_MASK", "blocker", f"site:{sid}",
                    f"'{sid}' has terrain-aware visibility but no terrain-aware cost run. Build with --rerun-cost, or run "
                    f"the patched script: python backend/cost_mc.py ephemeris_long/{sid}.json", "F1")
    elif derive.MASK_LINEAR not in lola_results:
        inputs.flag("COST_RUN_LOOKUP_NOT_LINEAR", "warning", f"site:{sid}",
                    "The only terrain-aware cost run reads the mask at floor(azimuth), while visibility uses linear "
                    "interpolation. Build with --rerun-cost to add the matching run.", "F3")


def _cost_line(result: dict) -> dict:
    return {"burn": [result["burn_M_per_usable_h"][k] for k in ("p10", "p50", "p90")],
            "usable_h": [result["usable_h"][k] for k in ("p10", "p50", "p90")],
            "alive_days_p50": result["alive_days"]["p50"],
            "landing_time_utc": derive.epoch_to_iso(derive.horizons_time_to_epoch(result["landing_time_utc"])),
            "p_zero_usable_hours": result.get("p_zero_usable_hours")}


def dataset_flags(inputs: Inputs, sites: list[dict], ephs: dict) -> None:
    inputs.flag("BEST_OVERLAP_IN_EPHEMERIS_FILES_IS_FLAT", "info", "dataset",
                "The best_overlap value inside ephemeris_long/*.json assumes a flat horizon (elevation > 0). It is not loaded. "
                "This database recomputes best overlap per lunar day for each horizon model; the website's getBestOverlap "
                "still reads the flat value until it is switched to the API.", "F2")
    inputs.flag("MASK_LOOKUP_RULES_DIFFER_IN_REPO", "info", "dataset",
                "The website reads the skyline by linear interpolation between whole-degree bins; the committed cost_mc.py "
                "uses floor(azimuth). This database uses linear interpolation for all visibility and for the default "
                "terrain-aware cost run, and also stores a floor(azimuth) cost run so earlier numbers reproduce.", "F3")
    inputs.flag("UNCERTAINTY_IS_SKYLINE_ONLY", "info", "dataset",
                "Optimistic and pessimistic windows shift the whole skyline by -/+ sigma (0.3 degrees unless changed, a team "
                "assumption). They do not include ephemeris error, the apparent size of the Sun or Earth, or site position error.")
    inputs.flag("POINT_SOURCE_BODIES", "info", "dataset",
                "The Sun and Earth are treated as points at their centres. The Sun's disc is about 0.5 degrees wide and the "
                "Earth's about 1.9 degrees as seen from the Moon, so real rises and sets are gradual.")
    plan = inputs.repo_root / "STARGAZER_Project_Overview_Plan.md"
    ids = {s["id"] for s in sites}
    if plan.exists() and "wiechert" in plan.read_text(encoding="utf-8", errors="ignore").lower() and not any("wiechert" in i for i in ids):
        inputs.flag("SITE_LIST_DIFFERS_FROM_PLAN_DOC", "warning", "dataset",
                    "STARGAZER_Project_Overview_Plan.md names 'Wiechert Circle' (and 'Shackleton Crater') as sites; the data has "
                    f"{', '.join(sorted(ids))}. The database follows the data. See backend/docs/ADD_A_SITE.md to add a site; "
                    "the team should correct the plan doc and slides.", "F5")
    coverages = {(e["times"][0], e["times"][-1], len(e["times"])) for e in ephs.values()}
    if len(coverages) > 1:
        inputs.flag("SITES_HAVE_DIFFERENT_COVERAGE", "warning", "dataset",
                    "Sites do not share the same ephemeris coverage, so comparisons use each site's own period.")


# --------------------------------------------------------------------------- orchestration

def build(args) -> int:
    repo_root = Path(args.repo_root).resolve()
    out_path = Path(args.out).resolve()
    inputs = Inputs(repo_root)
    report: dict = {"cost": {}, "sites": {}}

    sites = read_sites(inputs)
    notes_path = BACKEND_DIR / "data" / "site_notes.json"
    site_notes = load_json(inputs.use(notes_path)) if notes_path.exists() else {}
    ephs = {s["id"]: read_ephemeris(inputs, s) for s in sites}
    horizons = {s["id"]: read_horizon(inputs, s) for s in sites}
    tiles = {s["id"]: read_tiles(inputs, s) for s in sites}

    cost_script = repo_root / "backend" / "cost_mc.py"
    cost_module, script_hash = None, None
    sigma = derive.DEFAULT_SIGMA_DEG
    if cost_script.exists():
        script_hash = sha256_file(inputs.use(cost_script))
        try:
            import cost_step
            cost_module = cost_step.load_cost_module(cost_script)
            sigma = float(getattr(cost_module, "HORIZON_SD_DEG", sigma))
        except ImportError as error:                       # numpy missing: fine unless --rerun-cost was asked for
            inputs.notes.append(f"cost_mc.py could not be imported ({error}); sigma falls back to {sigma} deg.")
    if args.sigma is not None:
        sigma = args.sigma

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_name(out_path.name + f".tmp-{os.getpid()}")
    if tmp_path.exists():
        tmp_path.unlink()
    conn = sqlitedb.open_for_build(tmp_path)
    try:
        try:
            create_schema(conn)
            insert_sources(conn)
            anchors_verified = read_cost_anchors(conn, inputs, Path(args.cost_sources))
            for site in sites:
                sid = site["id"]
                built = build_site(conn, inputs, site, site_notes, ephs[sid], horizons[sid], tiles[sid], sigma)
                build_costs(conn, inputs, args, site, ephs[sid], horizons[sid], built["analyses"], anchors_verified,
                            cost_module, script_hash, report)
            dataset_flags(inputs, sites, ephs)
            insert_many(conn, "quality_flag", inputs.flags)

            tables = [r[0] for r in conn.execute(text(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"))]
            counts = {t: conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() for t in tables if t != "dataset_build"}
            manifest_json = json.dumps(dict(sorted(inputs.manifest.items())), sort_keys=True)
            # The id changes when any input file, the schema, the derivation code or a build setting changes.
            code_hash = sha256_file(BACKEND_DIR / "derive.py") + sha256_file(Path(__file__).resolve())
            build_id = "sg-" + hashlib.sha256(
                (manifest_json + SCHEMA_VERSION + code_hash + str(sigma) + str(args.seed) + str(bool(args.rerun_cost))).encode()
            ).hexdigest()[:12]
            insert(conn, "dataset_build", {
                "build_id": build_id, "built_at_utc": now_iso(), "schema_version": SCHEMA_VERSION,
                "input_manifest_json": manifest_json, "row_counts_json": json.dumps(counts, sort_keys=True),
                "notes": f"sigma_deg={sigma}; cost seed={args.seed}; rerun_cost={bool(args.rerun_cost)}"})
            conn.commit()
        finally:
            conn.close()                                 # Windows cannot rename or delete a file that is still open

        blockers = [f for f in inputs.flags if f["severity"] == "blocker"]
        from validate_db import validate            # noqa: E402  (scripts/ is on sys.path when run as a script)
        fixtures = Path(args.fixtures) if args.fixtures else None
        validation = validate(tmp_path, fixtures)
        report.update({"build_id": build_id, "counts": counts, "flags": inputs.flags, "notes": inputs.notes,
                       "validation": validation, "sigma": sigma, "seed": args.seed, "manifest": inputs.manifest,
                       "rerun_cost": bool(args.rerun_cost)})

        fail = bool(validation["errors"]) or (blockers and not args.allow_missing_cost)
        if fail:
            print_report(report, out_path, built_ok=False)
            for error in validation["errors"]:
                print(f"ERROR: {error}", file=sys.stderr)
            for flag in blockers:
                print(f"BLOCKER: {flag['message']}", file=sys.stderr)
            return 1

        if out_path.exists():
            os.chmod(out_path, stat.S_IWRITE | stat.S_IREAD)        # Windows cannot replace a read-only file
        try:
            os.replace(tmp_path, out_path)
        except PermissionError as error:
            raise BuildError(f"Could not replace {out_path.name}: it is open in another program (stop the API server, "
                             f"then build again). {error}") from error
        os.chmod(out_path, stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)   # mark the finished file read-only
        print_report(report, out_path, built_ok=True)
        if args.report:
            Path(args.report).parent.mkdir(parents=True, exist_ok=True)
            Path(args.report).write_text(render_report(report, out_path, built_ok=True), encoding="utf-8")
        return 0
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def render_report(report: dict, out_path: Path, built_ok: bool) -> str:
    lines = ["# Stargazer database build report", "",
             f"- Build id: `{report['build_id']}`",
             f"- Database: `backend/data/{out_path.name}` ({'written, marked read-only' if built_ok else 'NOT written'})",
             f"- Schema version: {SCHEMA_VERSION}",
             f"- Skyline sigma: {report['sigma']} deg. Cost seed: {report['seed']}. Cost model re-run in this build: {'yes' if report['rerun_cost'] else 'no'}",
             f"- Input files: {len(report['manifest'])} (names and SHA-256 hashes are stored in `dataset_build.input_manifest_json`)",
             "", "## Row counts", "", "| table | rows |", "| --- | --- |"]
    lines += [f"| {t} | {n} |" for t, n in sorted(report["counts"].items())]
    lines += ["", "## Quality flags raised", "", "| severity | code | scope | fix order | message |", "| --- | --- | --- | --- | --- |"]
    order = {"blocker": 0, "warning": 1, "info": 2}
    for flag in sorted(report["flags"], key=lambda f: (order[f["severity"]], f["code"], f["scope"])):
        lines.append(f"| {flag['severity']} | {flag['code']} | {flag['scope']} | {flag['fix_order'] or ''} | {flag['message']} |")
    v = report["validation"]
    lines += ["", "## Validation", "", f"{len(v['passed'])} checks passed, {len(v['errors'])} failed, "
              f"{len(v['fixture_mismatches'])} fixture mismatches.", ""]
    lines += [f"- PASS: {p}" for p in v["passed"]]
    lines += [f"- **FAIL: {e}**" for e in v["errors"]]
    lines += ["", "## Fixture checks (section 10 of the brief)", ""]
    lines += [f"- {c}" for c in v["fixtures"]] or ["- No fixture file given."]
    lines += [f"- **MISMATCH: {m}**" for m in v["fixture_mismatches"]]
    lines += ["", "## Cost per usable hour under each horizon and mask-lookup rule (fix orders F1 and F3)", "",
              "$M per usable hour, p10 / p50 / p90. Usable hours p10 / p50 / p90. Seed " + str(report["seed"]) + ".", "",
              "| site | run | burn p10 / p50 / p90 | usable h p10 / p50 / p90 | alive days p50 | landing (UTC) | P(zero usable h) |",
              "| --- | --- | --- | --- | --- | --- | --- |"]
    labels = {"flat": "flat horizon (committed file)", derive.MASK_FLOOR: "LOLA mask, floor(azimuth) lookup (parity)",
              derive.MASK_LINEAR: "LOLA mask, linear lookup (default)"}
    for sid, runs in report["cost"].items():
        for key in ("flat", derive.MASK_FLOOR, derive.MASK_LINEAR):
            if key in runs:
                r = runs[key]
                lines.append(f"| {sid} | {labels[key]} | {' / '.join(f'{x:.3f}' for x in r['burn'])} | "
                             f"{' / '.join(str(x) for x in r['usable_h'])} | {r['alive_days_p50']} | {r['landing_time_utc']} | "
                             f"{r['p_zero_usable_hours']} |")
    if report["notes"]:
        lines += ["", "## Notes", ""] + [f"- {n}" for n in report["notes"]]
    lines += fix_order_table(report)
    lines.append("")
    return "\n".join(lines)


def fix_order_table(report: dict) -> list[str]:
    """The closing table of the build report: one row per fix order from section 4.1 of the brief."""
    v = report["validation"]
    ok = v["fixtures"]
    n_sites = len(report["cost"])
    with_default = sum(1 for runs in report["cost"].values() if derive.MASK_LINEAR in runs)
    parity = sum(1 for line in ok if "floor(azimuth) lookup" in line)
    flat = sum(1 for line in ok if "flat horizon (committed file)" in line)
    overlap = sum(1 for line in ok if "flat best overlap" in line)
    hours = sum(1 for line in ok if "visible sample hours" in line)
    codes = [f["code"] for f in report["flags"]]
    tiles_missing, blocker_missing = codes.count("TERRAIN_TILE_MISSING"), codes.count("BLOCKER_DISTANCE_MISSING")
    unverified = "COST_ANCHORS_UNVERIFIED" in codes
    rows = [
        ("F1 cost uses the same horizon as visibility", "Tested",
         f"{with_default}/{n_sites} sites have a terrain-aware default cost run. Flat re-runs reproduce the committed files "
         f"({flat} fixture checks OK). LOLA re-runs with the original lookup match the brief's fixtures ({parity} OK). "
         f"/cost defaults to lola_mask and returns 404 rather than falling back; /compare uses one horizon model "
         f"(tests/test_api.py). Build gate tested (tests/test_build.py). Patch: backend/patches/cost_mc.patch, checked "
         f"against the database by running it from the command line.",
         "Apply the cost_mc.py patch, regenerate and commit the cost JSONs, and stop quoting the flat-horizon numbers."),
        ("F2 best overlap is terrain-aware", "Tested (database and API); patch Implemented",
         f"best_overlap from the ephemeris files is not loaded. It is recomputed per lunar day and horizon model, with "
         f"optimistic and pessimistic durations ({overlap} flat fixture checks OK, {hours} terrain sample-hour checks OK). "
         f"The ephemeris_fetch.py rename is a patch that compiles but has not been run against Horizons.",
         "Switch the website's getBestOverlap to the API value (see backend/README.md). Apply the rename with that change."),
        ("F3 one mask-lookup rule", "Tested",
         "derive.skyline_at is the only lookup; the cost step imports it. Both rules are in the cost table above. The rule "
         "is stored on every analysis and cost_run row.", "None."),
        ("F6 optional inputs", "Tested",
         f"Missing blocker distances or tiles raise a flag and are never invented (tests/test_build.py). In this build: "
         f"{n_sites - blocker_missing}/{n_sites} sites have blocker distances, {n_sites - tiles_missing}/{n_sites} have height tiles. "
         f"The two mask files are compared (limit 0.01 deg) before blocker distances are loaded.",
         "terrain/ is git-ignored: run python lola_terrain.py on any machine that needs blocker distances."),
        ("F4 Horizons altitude", "Implemented; Needs team",
         "observer_alt_km_used is stored; an info flag carries the parallax bound (height / distance). The "
         "ephemeris_fetch.py patch reads the altitude from the horizon file; it compiles but has not been run against Horizons.",
         "Re-fetch one site with its real altitude (Mons Mouton, 5.32 km) and compare with the stored values. Under 0.01 deg: "
         "close the flag. Also confirm the 'Center radii' line in the Horizons reply says 1737.4 km."),
        ("F7 unverified cost anchors", "Tested (loader rule); Needs team" if unverified else "Tested",
         "Anchors come from backend/data/cost_sources.csv. A row counts as verified only with source_url and verified_on. "
         + ("All anchors are currently unverified and shown as such by /cost." if unverified else "All anchors are verified."),
         "Fill source_url, verified_by and verified_on for each anchor, then rebuild." if unverified else "None."),
        ("F5 site list conflict", "Implemented; Needs team",
         "landingSites.json is the only source of site rows. backend/docs/ADD_A_SITE.md has the steps. A warning flag is raised "
         "while the plan doc still names Wiechert Circle." if "SITE_LIST_DIFFERS_FROM_PLAN_DOC" in codes else
         "landingSites.json is the only source of site rows. backend/docs/ADD_A_SITE.md has the steps.",
         "Decide the third site, correct the plan doc and slides, and cite a source for each coordinate."),
    ]
    lines = ["", "## Fix orders (section 4.1 of the brief)", "",
             "Status words: Implemented = written; Tested = covered by backend/tests (run `python -m pytest backend/tests`); "
             "Needs team = waiting on a team action. Nothing here is Validated: no result has been compared with an "
             "independent reference beyond the JPL Horizons values it was computed from.", "",
             "| order | status | evidence | left for the team |", "| --- | --- | --- | --- |"]
    lines += [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in rows]
    return lines


def print_report(report: dict, out_path: Path, built_ok: bool) -> None:
    print(render_report(report, out_path, built_ok))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Build the read-only Stargazer database.")
    parser.add_argument("--repo-root", default=str(BACKEND_DIR.parent), help="top of the repo (default: the folder above backend/)")
    parser.add_argument("--out", default=str(BACKEND_DIR / "data" / "stargazer.db"))
    parser.add_argument("--rerun-cost", action="store_true", help="run cost_mc.py with each site's real skyline")
    parser.add_argument("--allow-missing-cost", action="store_true",
                        help="build even if a site has no terrain-aware cost run")
    parser.add_argument("--cost-runs-dir", default=str(BACKEND_DIR / "data" / "cost_runs"))
    parser.add_argument("--cost-sources", default=str(BACKEND_DIR / "data" / "cost_sources.csv"),
                        help="CSV of cost anchors and their sources (fix order F7)")
    parser.add_argument("--seed", type=int, default=42, help="random seed for --rerun-cost")
    parser.add_argument("--sigma", type=float, default=None, help="skyline 1-sigma in degrees (default: HORIZON_SD_DEG from cost_mc.py)")
    parser.add_argument("--fixtures", default=str(BACKEND_DIR / "tests" / "fixtures" / "section10.json"),
                        help="fixture file to check the result against ('' to skip)")
    parser.add_argument("--report", default=str(BACKEND_DIR / "docs" / "BUILD_REPORT.md"), help="where to write the build report ('' to skip)")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        return build(args)
    except BuildError as error:
        print(f"BUILD FAILED: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
