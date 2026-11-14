"""Tests for the database build: content, read-only enforcement, fixtures, and the build gates."""
from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import BACKEND_DIR, FIXTURES, REPO_ROOT

import derive


def ro(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)


def test_validation_passes_and_every_fixture_matches(db_path):
    from validate_db import validate
    result = validate(db_path, FIXTURES)
    assert result["errors"] == []
    assert result["fixture_mismatches"] == []
    assert len(result["fixtures"]) >= 21          # coverage, best overlap, sample hours, dark stretch, both cost tables


def test_row_counts_and_ranges(db_path):
    conn = ro(db_path)
    sites = [r[0] for r in conn.execute("SELECT site_id FROM site")]
    assert sorted(sites) == ["malapert", "mons-mouton", "shackleton"]
    for (count,) in conn.execute("SELECT COUNT(*) FROM ephemeris_sample GROUP BY run_id, body"):
        assert count == 2837
    assert conn.execute("SELECT MIN(t_utc), MAX(t_utc) FROM ephemeris_sample").fetchone() == ("2026-12-01T00:00:00Z", "2027-03-29T04:00:00Z")
    assert conn.execute("SELECT COUNT(*) FROM horizon_bin").fetchone()[0] == 3 * 360
    assert conn.execute("SELECT COUNT(*) FROM analysis").fetchone()[0] == 6
    lo, hi = conn.execute("SELECT MIN(skyline_elevation_deg), MAX(skyline_elevation_deg) FROM horizon_bin b "
                          "JOIN horizon_profile p USING (profile_id) WHERE p.site_id = 'malapert'").fetchone()
    assert (lo, hi) == (-3.51, 4.45)


def test_database_file_is_read_only_and_api_connection_cannot_write(db_path):
    import os
    import stat
    assert not os.stat(db_path).st_mode & stat.S_IWUSR, "the built file should be marked read-only"
    from app.db import Database
    with Database(f"sqlite:///{db_path.as_posix()}").connect() as conn:       # exactly how the API opens it
        assert conn.execute("SELECT COUNT(*) FROM site").scalar() == 3
        for statement in ("INSERT INTO site (site_id, name, latitude_deg, longitude_deg_east) VALUES ('x', 'x', 0, 0)",
                          "UPDATE site SET name = 'x'", "DELETE FROM site", "DROP TABLE site",
                          "CREATE TABLE evil (a INTEGER)"):
            with pytest.raises(sqlite3.OperationalError) as caught:
                conn.execute(statement)
            assert "readonly" in str(caught.value).lower()
    assert ro(db_path).execute("SELECT COUNT(*) FROM site").fetchone()[0] == 3


def test_best_overlap_in_ephemeris_files_is_not_served(db_path):
    """F2: the flat best_overlap from the JSON files must not be what the terrain-aware analysis reports."""
    conn = ro(db_path)
    fx = json.loads(FIXTURES.read_text())
    row = conn.execute("SELECT s.longest_window_h FROM visibility_summary s JOIN analysis a USING (analysis_id) "
                       "WHERE a.site_id = 'mons-mouton' AND a.horizon_model = 'lola_mask' AND s.body = 'both' "
                       "AND s.scenario = 'nominal' AND s.lunar_day_index = 1").fetchone()
    assert abs(row[0] - fx["flat_best_overlap_day1"]["mons-mouton"]["hours"]) > 40      # 361 h with terrain vs 409 h flat
    assert abs(row[0] - fx["lola_mask_day1_sample_hours"]["mons-mouton"]["both"]) <= 1.0


def test_stored_clearance_uses_linear_mask_interpolation(db_path):
    conn = ro(db_path)
    mask = [r[0] for r in conn.execute("SELECT skyline_elevation_deg FROM horizon_bin b JOIN horizon_profile p USING (profile_id) "
                                       "WHERE p.site_id = 'shackleton' ORDER BY azimuth_deg")]
    rows = conn.execute("SELECT e.azimuth_deg, e.elevation_deg, v.horizon_elevation_deg, v.clearance_deg FROM ephemeris_sample e "
                        "JOIN ephemeris_run r USING (run_id) JOIN analysis a ON a.ephemeris_run_id = r.run_id "
                        "JOIN visibility_sample v ON v.analysis_id = a.analysis_id AND v.body = e.body AND v.t_utc = e.t_utc "
                        "WHERE r.site_id = 'shackleton' AND a.horizon_model = 'lola_mask' AND e.body = 'sun' LIMIT 200").fetchall()
    for az, el, skyline, clearance in rows:
        assert skyline == pytest.approx(derive.skyline_at(mask, az, derive.MASK_LINEAR), abs=1e-6)
        assert clearance == pytest.approx(el - skyline, abs=2e-6)


def test_cost_runs_keep_their_horizon_label(db_path):
    conn = ro(db_path)
    runs = conn.execute("SELECT site_id, horizon_model, horizon_lookup, is_default FROM cost_run ORDER BY 1, 2, 3").fetchall()
    assert len(runs) == 9
    for site in ("malapert", "mons-mouton", "shackleton"):
        assert (site, "flat", "not_applicable", 1) in runs
        assert (site, "lola_mask", "linear_between_bins", 1) in runs
        assert (site, "lola_mask", "nearest_lower_bin", 0) in runs
    flagged = conn.execute("SELECT COUNT(*) FROM quality_flag WHERE code = 'COST_RUN_FLAT_HORIZON' AND severity = 'warning'").fetchone()[0]
    assert flagged == 3
    assert conn.execute("SELECT COUNT(*) FROM cost_anchor WHERE evidence_status = 'needs_verification'").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM cost_assumption WHERE name = 'delivery_price' AND evidence_status != 'needs_verification'").fetchone()[0] == 0


def test_rerun_matches_committed_flat_files_exactly():
    """Parity: the in-process cost step with a flat horizon reproduces the committed <site>_cost.json files."""
    pytest.importorskip("numpy")
    import cost_step
    module = cost_step.load_cost_module(REPO_ROOT / "backend" / "cost_mc.py")
    for site in ("malapert", "shackleton"):
        committed = json.loads((REPO_ROOT / "ephemeris_long" / f"{site}_cost.json").read_text())
        rerun = cost_step.run_cost(module, REPO_ROOT / "ephemeris_long" / f"{site}.json", None, seed=42)
        for key in committed:
            assert json.loads(json.dumps(rerun[key])) == committed[key], f"{site}: {key} differs"


def _mini_repo(tmp_path: Path, with_cost_script: bool) -> Path:
    """A copy of only the files the build needs, so gates can be tested without touching the real repo."""
    root = tmp_path / "repo"
    for rel in ("frontend/src/data/landingSites.json", "frontend/src/data/horizon", "ephemeris_long"):
        src, dst = REPO_ROOT / rel, root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dst) if src.is_dir() else shutil.copy(src, dst)
    for stale in (root / "ephemeris_long").glob("*_cost_lola_mask*.json"):
        stale.unlink()
    if with_cost_script:
        (root / "backend").mkdir()
        shutil.copy(REPO_ROOT / "backend" / "cost_mc.py", root / "backend" / "cost_mc.py")
    return root


def _build(root: Path, out: Path, *extra: str) -> int:
    import build_db
    return build_db.main(["--repo-root", str(root), "--out", str(out / "s.db"), "--cost-runs-dir", str(out / "runs"),
                          "--report", "", *extra])


def test_build_fails_without_terrain_aware_cost_unless_allowed(tmp_path, capsys):
    """F1.5: a lola_mask analysis with no lola_mask cost run is a blocker."""
    root = _mini_repo(tmp_path, with_cost_script=False)
    assert _build(root, tmp_path) == 1
    assert "no terrain-aware cost run" in capsys.readouterr().err
    assert not (tmp_path / "s.db").exists()
    assert _build(root, tmp_path, "--allow-missing-cost") == 0
    conn = ro(tmp_path / "s.db")
    assert conn.execute("SELECT COUNT(*) FROM quality_flag WHERE severity = 'blocker' AND code = 'COST_RUN_MISSING_FOR_LOLA_MASK'").fetchone()[0] == 3
    # optional inputs were absent: flagged, never invented
    assert conn.execute("SELECT COUNT(*) FROM quality_flag WHERE code = 'TERRAIN_TILE_MISSING'").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM quality_flag WHERE code = 'BLOCKER_DISTANCE_MISSING'").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM horizon_bin WHERE blocker_distance_km IS NOT NULL").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM terrain_tile").fetchone()[0] == 0


def test_build_fails_loudly_when_a_required_file_is_missing(tmp_path, capsys):
    root = _mini_repo(tmp_path, with_cost_script=False)
    (root / "ephemeris_long" / "malapert.json").unlink()
    assert _build(root, tmp_path, "--allow-missing-cost") == 2
    error = capsys.readouterr().err
    assert "malapert" in error and "ephemeris_fetch.py" in error


def test_build_rejects_bad_ephemeris_values(tmp_path, capsys):
    root = _mini_repo(tmp_path, with_cost_script=False)
    path = root / "ephemeris_long" / "malapert.json"
    data = json.loads(path.read_text())
    data["sun"][10]["el"] = float("nan")
    path.write_text(json.dumps(data))
    assert _build(root, tmp_path, "--allow-missing-cost") == 2
    assert "elevation" in capsys.readouterr().err


def test_patched_cost_script_matches_the_database(tmp_path, db_path):
    """F1.3: the patched cost_mc.py, run from the command line, gives the numbers stored by the in-process build."""
    pytest.importorskip("numpy")
    root = _mini_repo(tmp_path, with_cost_script=False)
    (root / "backend").mkdir()
    shutil.copy(BACKEND_DIR / "patches" / "cost_mc.patched.py", root / "backend" / "cost_mc.py")
    shutil.copy(BACKEND_DIR / "derive.py", root / "backend" / "derive.py")
    conn = ro(db_path)
    for flags, suffix, lookup in (([], "_cost_lola_mask", "linear_between_bins"),
                                  (["--lookup", "nearest_lower_bin"], "_cost_lola_mask_nearest_lower_bin", "nearest_lower_bin"),
                                  (["--flat"], "_cost_flat", "not_applicable")):
        subprocess.run([sys.executable, "backend/cost_mc.py", "ephemeris_long/shackleton.json", *flags],
                       cwd=root, check=True, capture_output=True)
        result = json.loads((root / "ephemeris_long" / f"shackleton{suffix}.json").read_text())
        model = "flat" if lookup == "not_applicable" else "lola_mask"
        assert (result["horizon_model"], result["horizon_lookup"], result["seed"]) == (model, lookup, 42)
        p10, p50, p90 = conn.execute(
            "SELECT m.p10, m.p50, m.p90 FROM cost_metric m JOIN cost_run c USING (cost_run_id) WHERE c.site_id = 'shackleton' "
            "AND c.horizon_model = ? AND c.horizon_lookup = ? AND m.metric = 'burn_musd_per_usable_h'", (model, lookup)).fetchone()
        assert [result["burn_M_per_usable_h"][k] for k in ("p10", "p50", "p90")] == [p10, p50, p90]
    # A database built from the patched script's own outputs (no --rerun-cost) serves the same default run.
    assert _build(root, tmp_path) == 1          # only shackleton has terrain-aware cost files so far: still a blocker


def test_cost_anchor_is_verified_only_with_url_and_date(tmp_path):
    """F7: a source URL alone is not enough; the row also needs a verification date."""
    root = _mini_repo(tmp_path, with_cost_script=True)
    sources = tmp_path / "cost_sources.csv"
    sources.write_text("anchor,award_musd,award_year,source_url,verified_by,verified_on\n"
                       "Peregrine,79.5,2019,https://example.org/award,someone,2026-11-15\n"
                       "CP-22,116.9,2024,https://example.org/award2,,\n"
                       "IM-5,180.4,2026,,,\n")
    assert _build(root, tmp_path, "--rerun-cost", "--cost-sources", str(sources)) == 0
    conn = ro(tmp_path / "s.db")
    status = dict(conn.execute("SELECT anchor, evidence_status FROM cost_anchor"))
    assert status == {"Peregrine": "anchored_on_public_data", "CP-22": "needs_verification", "IM-5": "needs_verification"}
    assert conn.execute("SELECT COUNT(*) FROM cost_assumption WHERE name = 'delivery_price' AND evidence_status = 'anchored_on_public_data'").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM quality_flag WHERE code = 'COST_ANCHORS_UNVERIFIED'").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM cost_run").fetchone()[0] == 9


def test_patched_ephemeris_fetch_offline_parts(monkeypatch):
    """F2.3 / F4.2: the renamed flat-overlap function and the altitude lookup work. The Horizons fetch itself is not exercised."""
    import importlib.util
    import types
    monkeypatch.setitem(sys.modules, "requests", types.ModuleType("requests"))      # the script imports requests at the top
    monkeypatch.setattr(sys, "argv", ["ephemeris_fetch.py"])
    path = BACKEND_DIR / "patches" / "ephemeris_fetch.patched.py"
    spec = importlib.util.spec_from_file_location("ephemeris_fetch_patched", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert not hasattr(module, "calculate_longest_sun_earth_overlap")
    data = json.loads((REPO_ROOT / "ephemeris_long" / "mons-mouton.json").read_text())
    overlap = module.calculate_longest_sun_earth_overlap_flat_horizon(data["sun"], data["earth"], 1)
    assert overlap == data["best_overlap"] == {"hours": 409, "start": "2026-Dec-12 23:00"}
    # The patched script lives in backend/patches/ here, so point it at the real horizon folder.
    monkeypatch.setattr(module, "FRONTEND_HORIZON_DIR", REPO_ROOT / "frontend" / "src" / "data" / "horizon")
    site = {"id": "mons-mouton", "alt_km": 0.0}
    assert module.site_altitude_km(site) == pytest.approx(5.3211)
    assert module.site_altitude_km({"id": "no-such-site", "alt_km": 0.0}) == 0.0
    monkeypatch.setattr(module, "USE_SITE_ALTITUDE", False)
    assert module.site_altitude_km(site) == 0.0


def test_older_single_tile_and_blocker_in_website_mask_are_loaded(tmp_path):
    """F6: the 10 km tile and blocker_km written by earlier versions of lola_terrain.py are read when present."""
    root = _mini_repo(tmp_path, with_cost_script=False)
    (root / "terrain").mkdir()
    grid = [[round(0.1 * (r * 5 + c) - 1.2, 1) for c in range(5)] for r in range(5)]
    (root / "terrain" / "malapert_tile.json").write_text(json.dumps({
        "half_width_m": 5000.0, "cells": 5, "note": "rows run south to north, columns west to east; heights in metres relative to the site",
        "heights_m": grid}))
    mask_path = root / "frontend" / "src" / "data" / "horizon" / "shackleton.json"
    mask = json.loads(mask_path.read_text())
    mask["blocker_km"] = [float(i % 50) for i in range(360)]
    mask_path.write_text(json.dumps(mask))
    assert _build(root, tmp_path, "--allow-missing-cost") == 0
    conn = ro(tmp_path / "s.db")
    level, half_width, cells, spacing, scale = conn.execute(
        "SELECT level_index, half_width_m, n_cells, spacing_m, scale_m FROM terrain_tile WHERE site_id = 'malapert'").fetchone()
    assert (level, half_width, cells, spacing, scale) == (0, 5000.0, 5, 2500.0, 0.1)
    flagged = {r[0] for r in conn.execute("SELECT scope FROM quality_flag WHERE code = 'TERRAIN_TILE_MISSING'")}
    assert flagged == {"site:mons-mouton", "site:shackleton"}
    assert conn.execute("SELECT COUNT(*) FROM horizon_bin b JOIN horizon_profile p USING (profile_id) WHERE p.site_id = 'shackleton' "
                        "AND b.blocker_distance_km IS NOT NULL").fetchone()[0] == 360
    assert {r[0] for r in conn.execute("SELECT scope FROM quality_flag WHERE code = 'BLOCKER_DISTANCE_MISSING'")} == {"site:malapert", "site:mons-mouton"}
    conn.close()

    from fastapi.testclient import TestClient
    from app.config import Settings
    from app.main import create_app
    with TestClient(create_app(Settings(database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}"))) as client:
        tile = client.get("/api/v1/sites/malapert/terrain-tile").json()
        assert tile["level_index"] == 0 and tile["n_cells"] == 5 and tile["stride"] == 1
        for got_row, want_row in zip(tile["heights_m"], grid):
            assert got_row == pytest.approx(want_row, abs=1e-9)
        assert client.get("/api/v1/sites/shackleton/terrain-tile").status_code == 404
        assert client.get("/api/v1/sites/shackleton/horizon").json()["bins"][7]["blocker_distance_km"] == 7.0
