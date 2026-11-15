#!/usr/bin/env python3
"""
export_frontend_json.py: writes small static JSON files from the built database, for a frontend
that is not calling the API yet.

    python backend/scripts/export_frontend_json.py            # -> backend/data/export/<site>.json

Each file holds, for one site and for BOTH horizon models, the terrain-aware numbers the website
currently shows from flat-horizon sources: best overlap per lunar day, Sun/Earth/both hours, and
the cost percentiles and histogram. Nothing in frontend/ is touched; copy or import the files
from there if you want to use them. The API serves the same values.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def export(db_path: Path, out_dir: Path) -> list[Path]:
    conn = sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    build_id = conn.execute("SELECT build_id FROM dataset_build").fetchone()[0]
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for site in conn.execute("SELECT site_id, name FROM site ORDER BY site_id"):
        payload = {"site_id": site["site_id"], "name": site["name"], "dataset_build_id": build_id,
                   "caveat": "Geometric visibility, not power or link budget. Costs are distributions under stated "
                             "assumptions, not mission-grade estimates.",
                   "horizon_models": {}}
        for analysis in conn.execute("SELECT analysis_id, horizon_model, mask_interpolation, sigma_deg FROM analysis "
                                     "WHERE site_id = ? ORDER BY horizon_model DESC", (site["site_id"],)):
            days = {}
            for row in conn.execute(
                    "SELECT * FROM visibility_summary WHERE analysis_id = ? AND scenario = 'nominal' ORDER BY lunar_day_index, body",
                    (analysis["analysis_id"],)):
                day = days.setdefault(str(row["lunar_day_index"]), {
                    "period_start_utc": row["period_start_utc"], "period_end_utc": row["period_end_utc"]})
                day[row["body"]] = {"visible_hours": round(row["visible_hours"], 2), "longest_window_h": round(row["longest_window_h"], 2),
                                    "longest_gap_h": round(row["longest_gap_h"], 2)}
                if row["body"] == "both":
                    day["best_overlap"] = {"hours": round(row["longest_window_h"], 1), "start_utc": row["longest_window_start_utc"],
                                           "end_utc": row["longest_window_end_utc"]}
            cost = None
            run = conn.execute("SELECT * FROM cost_run WHERE site_id = ? AND horizon_model = ? AND is_default = 1",
                               (site["site_id"], analysis["horizon_model"])).fetchone()
            if run is not None:
                metrics = {r["metric"]: {"p10": r["p10"], "p50": r["p50"], "p90": r["p90"]} for r in conn.execute(
                    "SELECT * FROM cost_metric WHERE cost_run_id = ?", (run["cost_run_id"],))}
                bins = conn.execute("SELECT bin_lo, bin_hi, trial_count FROM cost_histogram_bin WHERE cost_run_id = ? ORDER BY bin_index",
                                    (run["cost_run_id"],)).fetchall()
                cost = {"horizon_lookup": run["horizon_lookup"], "landing_time_utc": run["landing_time_utc"],
                        "mission_days": run["mission_days"], "trials": run["n_trials"],
                        "p_survive_full_mission": run["p_survive_full_mission"], "p_zero_usable_hours": run["p_zero_usable_hours"],
                        "burn_M_per_usable_h": metrics["burn_musd_per_usable_h"], "usable_h": metrics["usable_hours"],
                        "alive_days": metrics["alive_days"],
                        "histogram": {"bin_edges": [b["bin_lo"] for b in bins] + [bins[-1]["bin_hi"]],
                                      "counts": [b["trial_count"] for b in bins]}}
            payload["horizon_models"][analysis["horizon_model"]] = {
                "mask_interpolation": analysis["mask_interpolation"], "sigma_deg": analysis["sigma_deg"],
                "lunar_days": days, "cost": cost}
        path = out_dir / f"{site['site_id']}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        written.append(path)
    conn.close()
    return written


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Export static JSON from the built database.")
    parser.add_argument("--db", default=str(BACKEND_DIR / "data" / "stargazer.db"))
    parser.add_argument("--out", default=str(BACKEND_DIR / "data" / "export"))
    args = parser.parse_args(argv)
    if not Path(args.db).exists():
        print(f"Database not found: {args.db}. Build it with: python backend/scripts/build_db.py --rerun-cost", file=sys.stderr)
        return 2
    for path in export(Path(args.db), Path(args.out)):
        print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
