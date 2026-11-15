#!/usr/bin/env python3
"""
validate_db.py: checks a built Stargazer database. Opens it read-only and changes nothing.

    python backend/scripts/validate_db.py                       # checks backend/data/stargazer.db
    python backend/scripts/validate_db.py path/to/stargazer.db --fixtures backend/tests/fixtures/section10.json

Exit code 0 when every structural check passes. Fixture mismatches are reported but do not fail
the run: fixtures are sanity checks from the brief, and a mismatch means "investigate", not
"adjust the numbers".
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path
from typing import Optional

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import derive  # noqa: E402

EXPECTED_TABLES = {
    "dataset_build", "data_source", "quality_flag", "site", "ephemeris_run", "ephemeris_sample",
    "horizon_profile", "horizon_bin", "terrain_tile", "analysis", "visibility_sample", "visibility_window",
    "visibility_summary", "cost_run", "cost_metric", "cost_histogram_bin", "cost_assumption", "cost_anchor",
}


def open_read_only(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)     # file:///...?mode=ro
    conn.execute("PRAGMA query_only = ON")
    conn.row_factory = sqlite3.Row
    return conn


def validate(db_path: Path, fixtures_path: Optional[Path] = None) -> dict:
    """Runs every check. Returns {'passed': [...], 'errors': [...], 'fixtures': [...], 'fixture_mismatches': [...]}."""
    out = {"passed": [], "errors": [], "fixtures": [], "fixture_mismatches": []}
    conn = open_read_only(db_path)

    def check(condition: bool, ok: str, bad: str) -> None:
        (out["passed"] if condition else out["errors"]).append(ok if condition else bad)

    def one(sql: str, *params):
        return conn.execute(sql, params).fetchone()[0]

    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        missing = EXPECTED_TABLES - tables
        check(not missing, "all expected tables exist", f"missing tables: {sorted(missing)}")
        if missing:
            return out
        check(one("SELECT COUNT(*) FROM dataset_build") == 1, "exactly one dataset_build row",
              "dataset_build must hold exactly one row")
        n_sites = one("SELECT COUNT(*) FROM site")
        check(n_sites > 0, f"{n_sites} sites loaded", "no sites loaded")

        # Ephemeris: counts, ranges, constant step.
        bad_runs = []
        for run in conn.execute("SELECT run_id, site_id, n_samples, step_seconds, start_utc, stop_utc FROM ephemeris_run"):
            for body in ("sun", "earth"):
                times = [r[0] for r in conn.execute(
                    "SELECT t_utc FROM ephemeris_sample WHERE run_id = ? AND body = ? ORDER BY t_utc", (run["run_id"], body))]
                epochs = [derive.parse_iso_utc(t) for t in times]
                steps = {round(b - a) for a, b in zip(epochs, epochs[1:])}
                if len(times) != run["n_samples"] or steps != {run["step_seconds"]} \
                        or times[0] != run["start_utc"] or times[-1] != run["stop_utc"]:
                    bad_runs.append(f"{run['site_id']}/{body}")
        check(not bad_runs, "ephemeris samples: row counts match, timestamps increase by one constant step",
              f"ephemeris rows are irregular for: {bad_runs}")
        check(one("SELECT COUNT(*) FROM ephemeris_sample WHERE azimuth_deg < 0 OR azimuth_deg >= 360 "
                  "OR elevation_deg < -90 OR elevation_deg > 90") == 0,
              "azimuth in [0, 360) and elevation in [-90, 90] for every sample", "ephemeris values out of range")

        # Horizon: 360 bins per profile.
        bad_profiles = [r[0] for r in conn.execute(
            "SELECT profile_id FROM horizon_profile p WHERE (SELECT COUNT(*) FROM horizon_bin b WHERE b.profile_id = p.profile_id) != 360")]
        check(not bad_profiles, "every horizon profile has 360 bins", f"profiles without 360 bins: {bad_profiles}")

        # Terrain tiles: blob size matches the grid.
        bad_tiles = [f"{r['site_id']}/{r['level_index']}" for r in conn.execute(
            "SELECT site_id, level_index, n_cells, LENGTH(heights_i16_le) AS n FROM terrain_tile") if r["n"] != r["n_cells"] ** 2 * 2]
        check(not bad_tiles, "terrain tile blobs match their grid size", f"terrain tile size mismatch: {bad_tiles}")

        # Analyses: both horizon models per site; a visibility sample for every ephemeris sample.
        n_analyses = one("SELECT COUNT(*) FROM analysis")
        check(n_analyses == 2 * n_sites, "each site has a flat and a lola_mask analysis",
              f"expected {2 * n_sites} analyses, found {n_analyses}")
        expected_samples = one("SELECT SUM(2 * r.n_samples) FROM analysis a JOIN ephemeris_run r ON r.run_id = a.ephemeris_run_id")
        check(one("SELECT COUNT(*) FROM visibility_sample") == expected_samples,
              "one visibility sample per ephemeris sample per analysis", "visibility_sample row count is wrong")
        check(one("SELECT COUNT(*) FROM visibility_sample WHERE (clearance_deg > 0) != (is_visible = 1)") == 0,
              "is_visible agrees with clearance_deg > 0 everywhere", "is_visible disagrees with clearance")
        check(one("SELECT COUNT(*) FROM visibility_sample v JOIN analysis a USING (analysis_id) "
                  "WHERE a.horizon_model = 'flat' AND v.horizon_elevation_deg != 0") == 0,
              "flat analyses use a 0 degree horizon", "a flat analysis has a non-zero horizon")

        # Windows: ordered, non-overlapping, durations consistent.
        problems = []
        groups: dict[tuple, list] = {}
        for w in conn.execute("SELECT analysis_id, body, scenario, start_utc, end_utc, duration_h FROM visibility_window ORDER BY start_utc"):
            groups.setdefault((w["analysis_id"], w["body"], w["scenario"]), []).append(w)
        for key, rows in groups.items():
            previous_end = None
            for w in rows:
                start, end = derive.parse_iso_utc(w["start_utc"]), derive.parse_iso_utc(w["end_utc"])
                if end < start or abs((end - start) / 3600 - w["duration_h"]) > 0.001 or (previous_end is not None and start < previous_end):
                    problems.append(key)
                    break
                previous_end = end
        check(not problems, "windows are ordered, do not overlap, and durations match their start and end",
              f"window problems in: {problems[:5]}")

        # Scenario nesting: pessimistic <= nominal <= optimistic visible hours; both <= each body.
        nesting = []
        for r in conn.execute(
                "SELECT analysis_id, body, lunar_day_index, "
                "MAX(CASE scenario WHEN 'pessimistic' THEN visible_hours END) AS p, "
                "MAX(CASE scenario WHEN 'nominal' THEN visible_hours END) AS n, "
                "MAX(CASE scenario WHEN 'optimistic' THEN visible_hours END) AS o "
                "FROM visibility_summary GROUP BY analysis_id, body, lunar_day_index"):
            if not (r["p"] <= r["n"] + 1e-6 and r["n"] <= r["o"] + 1e-6):
                nesting.append((r["analysis_id"], r["body"], r["lunar_day_index"]))
        check(not nesting, "pessimistic <= nominal <= optimistic visible hours in every summary", f"scenario nesting broken: {nesting[:5]}")
        both_bad = one(
            "SELECT COUNT(*) FROM visibility_summary b JOIN visibility_summary s ON s.analysis_id = b.analysis_id "
            "AND s.scenario = b.scenario AND s.lunar_day_index = b.lunar_day_index AND s.body IN ('sun','earth') "
            "WHERE b.body = 'both' AND b.visible_hours > s.visible_hours + 0.000001")
        check(both_bad == 0, "'both' hours never exceed Sun hours or Earth hours", "'both' exceeds a single body somewhere")
        check(one("SELECT COUNT(*) FROM visibility_summary WHERE visible_fraction < 0 OR visible_fraction > 1.000001 "
                  "OR visible_hours > period_hours + 0.000001 OR longest_window_h > visible_hours + 0.000001") == 0,
              "summary fractions and hours are within their period", "a summary has impossible hours")
        missing_whole = one("SELECT COUNT(*) FROM analysis a WHERE NOT EXISTS (SELECT 1 FROM visibility_summary s "
                            "WHERE s.analysis_id = a.analysis_id AND s.lunar_day_index = 0)")
        check(missing_whole == 0, "every analysis has a whole-coverage summary", "an analysis has no whole-coverage summary")

        # Interval hours agree with hourly sample counts (each window edge can differ from its sample edge by under an hour).
        drift = []
        for a in conn.execute("SELECT analysis_id, site_id, horizon_model FROM analysis"):
            for body in ("sun", "earth"):
                samples = one("SELECT SUM(is_visible) FROM visibility_sample WHERE analysis_id = ? AND body = ?", a["analysis_id"], body)
                s = conn.execute("SELECT visible_hours, n_windows FROM visibility_summary WHERE analysis_id = ? AND body = ? "
                                 "AND scenario = 'nominal' AND lunar_day_index = 0", (a["analysis_id"], body)).fetchone()
                if abs(s["visible_hours"] - samples) > s["n_windows"] + 1:
                    drift.append(f"{a['site_id']}/{a['horizon_model']}/{body}: {s['visible_hours']:.1f} h vs {samples} samples")
        check(not drift, "window hours agree with hourly sample counts within one hour per window", f"hours drift: {drift}")

        # Cost runs.
        cost_bad = one("SELECT COUNT(*) FROM cost_metric WHERE NOT (p10 <= p50 AND p50 <= p90)")
        check(cost_bad == 0, "cost percentiles are ordered (p10 <= p50 <= p90)", "unordered cost percentiles")
        hist_bad = [r[0] for r in conn.execute(
            "SELECT c.cost_run_id FROM cost_run c WHERE c.n_finite_trials != "
            "(SELECT SUM(trial_count) FROM cost_histogram_bin h WHERE h.cost_run_id = c.cost_run_id)")]
        check(not hist_bad, "histogram counts sum to the trials with a defined burn ratio", f"histogram sums wrong for runs {hist_bad}")
        non_finite = 0
        for (value,) in conn.execute("SELECT p10 FROM cost_metric UNION ALL SELECT p50 FROM cost_metric UNION ALL SELECT p90 FROM cost_metric "
                                     "UNION ALL SELECT bin_lo FROM cost_histogram_bin UNION ALL SELECT bin_hi FROM cost_histogram_bin"):
            if value is None or not math.isfinite(value):
                non_finite += 1
        check(non_finite == 0, "no Infinity or NaN stored in cost tables", f"{non_finite} non-finite cost values stored")
        defaults = [r[0] for r in conn.execute(
            "SELECT site_id || '/' || horizon_model FROM cost_run GROUP BY site_id, horizon_model HAVING SUM(is_default) != 1")]
        check(not defaults, "each (site, horizon model) with cost runs has exactly one default run", f"default cost run unclear for {defaults}")
        mixed = one("SELECT COUNT(*) FROM cost_run c JOIN analysis a USING (analysis_id) WHERE c.horizon_model != a.horizon_model")
        check(mixed == 0, "every cost run is attached to an analysis with the same horizon model",
              "a cost run is attached to an analysis with a different horizon model")
        uncovered = [r[0] for r in conn.execute(
            "SELECT a.site_id FROM analysis a WHERE a.horizon_model = 'lola_mask' AND NOT EXISTS "
            "(SELECT 1 FROM cost_run c WHERE c.site_id = a.site_id AND c.horizon_model = 'lola_mask')")]
        blockers = one("SELECT COUNT(*) FROM quality_flag WHERE severity = 'blocker'")
        check(len(uncovered) == blockers or not uncovered,
              "terrain-aware cost runs: every missing one is flagged as a blocker" if uncovered else "every site has a terrain-aware cost run",
              f"sites with no terrain-aware cost run and no blocker flag: {uncovered}")

        if fixtures_path and Path(fixtures_path).exists():
            _check_fixtures(conn, json.loads(Path(fixtures_path).read_text(encoding="utf-8")), out)
    finally:
        conn.close()
    return out


def _check_fixtures(conn: sqlite3.Connection, fx: dict, out: dict) -> None:
    def compare(label: str, got, expected, ok: bool) -> None:
        if ok:
            out["fixtures"].append(f"OK: {label}: {got}")
        else:
            out["fixture_mismatches"].append(f"{label}: got {got}, fixture says {expected}")

    sites = {r[0] for r in conn.execute("SELECT site_id FROM site")}

    def analysis_id(site: str, model: str):
        row = conn.execute("SELECT analysis_id FROM analysis WHERE site_id = ? AND horizon_model = ?", (site, model)).fetchone()
        return row[0] if row else None

    def sample_hours(aid: int, limit: Optional[int]):
        rows = conn.execute(
            "SELECT s.is_visible, e.is_visible FROM visibility_sample s JOIN visibility_sample e "
            "ON e.analysis_id = s.analysis_id AND e.t_utc = s.t_utc AND e.body = 'earth' "
            "WHERE s.analysis_id = ? AND s.body = 'sun' ORDER BY s.t_utc", (aid,)).fetchall()
        rows = rows[:limit] if limit else rows
        return {"sun": sum(r[0] for r in rows), "earth": sum(r[1] for r in rows), "both": sum(1 for r in rows if r[0] and r[1])}, rows

    coverage = fx.get("coverage")
    if coverage:
        for r in conn.execute("SELECT site_id, start_utc, stop_utc, n_samples FROM ephemeris_run"):
            got = {"start_utc": r[1], "end_utc": r[2], "n_samples": r[3]}
            compare(f"coverage {r[0]}", got, coverage, got == coverage)

    for site, expected in fx.get("flat_best_overlap_day1", {}).items():
        aid = analysis_id(site, "flat") if site in sites else None
        if aid is None:
            continue
        row = conn.execute("SELECT longest_window_h, longest_window_start_utc FROM visibility_summary WHERE analysis_id = ? "
                           "AND body = 'both' AND scenario = 'nominal' AND lunar_day_index = 1", (aid,)).fetchone()
        lead = derive.parse_iso_utc(expected["start_utc"]) - derive.parse_iso_utc(row[1])
        ok = abs(row[0] - expected["hours"]) <= 1.0 and 0 <= lead <= 3600
        compare(f"flat best overlap, lunar day 1, {site} (interpolated edges vs hourly count)",
                f"{row[0]:.1f} h from {row[1]}", f"{expected['hours']} h from {expected['start_utc']}", ok)

    for key, limit, label in (("lola_mask_day1_sample_hours", 709, "lunar day 1 (709 samples)"),
                              ("lola_mask_whole_coverage_sample_hours", None, "whole coverage")):
        for site, expected in fx.get(key, {}).items():
            aid = analysis_id(site, "lola_mask") if site in sites else None
            if aid is None:
                continue
            got, _ = sample_hours(aid, limit)
            compare(f"LOLA mask visible sample hours, {label}, {site}", got, expected, got == expected)

    for site, expected in fx.get("lola_mask_longest_sun_dark_h", {}).items():
        aid = analysis_id(site, "lola_mask") if site in sites else None
        if aid is None:
            continue
        longest = current = 0
        for (visible,) in conn.execute("SELECT is_visible FROM visibility_sample WHERE analysis_id = ? AND body = 'sun' ORDER BY t_utc", (aid,)):
            current = 0 if visible else current + 1
            longest = max(longest, current)
        compare(f"longest Sun-dark stretch (hourly samples), {site}", longest, expected, longest == expected)

    for key, model, lookup, label in (
            ("cost_flat_committed", "flat", "not_applicable", "cost, flat horizon (committed file)"),
            ("cost_lola_mask_nearest_lower_bin_seed42", "lola_mask", "nearest_lower_bin", "cost, LOLA mask, floor(azimuth) lookup, seed 42")):
        for site, expected in fx.get(key, {}).items():
            run = conn.execute("SELECT cost_run_id, landing_time_utc FROM cost_run WHERE site_id = ? AND horizon_model = ? AND horizon_lookup = ?",
                               (site, model, lookup)).fetchone()
            if run is None:
                if site in sites:
                    out["fixture_mismatches"].append(f"{label}, {site}: no such cost run in the database")
                continue
            metrics = {r[0]: (r[1], r[2], r[3]) for r in conn.execute(
                "SELECT metric, p10, p50, p90 FROM cost_metric WHERE cost_run_id = ?", (run[0],))}
            got = {"burn": list(metrics["burn_musd_per_usable_h"]), "usable_h_p50": int(metrics["usable_hours"][1]),
                   "alive_days_p50": metrics["alive_days"][1], "landing_time_utc": run[1]}
            ok = (all(abs(a - b) < 0.0005 for a, b in zip(got["burn"], expected["burn"]))
                  and got["usable_h_p50"] == expected["usable_h_p50"] and abs(got["alive_days_p50"] - expected["alive_days_p50"]) < 0.05
                  and got["landing_time_utc"] == expected["landing_time_utc"])
            compare(f"{label}, {site}", got, expected, ok)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Check a built Stargazer database (read-only).")
    parser.add_argument("db", nargs="?", default=str(BACKEND_DIR / "data" / "stargazer.db"))
    parser.add_argument("--fixtures", default=str(BACKEND_DIR / "tests" / "fixtures" / "section10.json"))
    args = parser.parse_args(argv)
    if not Path(args.db).exists():
        print(f"Database not found: {args.db}. Build it with: python backend/scripts/build_db.py --rerun-cost", file=sys.stderr)
        return 2
    result = validate(Path(args.db), Path(args.fixtures) if args.fixtures else None)
    for line in result["passed"]:
        print(f"PASS  {line}")
    for line in result["fixtures"]:
        print(f"FIXTURE {line}")
    for line in result["fixture_mismatches"]:
        print(f"FIXTURE MISMATCH  {line}")
    for line in result["errors"]:
        print(f"FAIL  {line}")
    print(f"\n{len(result['passed'])} passed, {len(result['errors'])} failed, {len(result['fixture_mismatches'])} fixture mismatches")
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
