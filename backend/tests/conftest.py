"""Shared fixtures: one database built from the repo data per test session, and an API client on top of it."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
for path in (BACKEND_DIR, BACKEND_DIR / "scripts"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

FIXTURES = BACKEND_DIR / "tests" / "fixtures" / "section10.json"
REQUIRED = [REPO_ROOT / "frontend" / "src" / "data" / "landingSites.json", REPO_ROOT / "ephemeris_long"]


@pytest.fixture(scope="session")
def built(tmp_path_factory):
    """Builds the database into a temporary folder (with the cost model re-run) and returns its path."""
    missing = [str(p) for p in REQUIRED if not p.exists()]
    if missing:
        pytest.skip(f"repo data not found: {missing}")
    pytest.importorskip("numpy", reason="the cost re-run needs numpy")
    import build_db
    out = tmp_path_factory.mktemp("db")
    db_path = out / "stargazer.db"
    code = build_db.main(["--rerun-cost", "--out", str(db_path), "--cost-runs-dir", str(out / "cost_runs"),
                          "--report", str(out / "BUILD_REPORT.md")])
    assert code == 0, "build_db.py failed"
    return {"db": db_path, "dir": out}


@pytest.fixture(scope="session")
def db_path(built) -> Path:
    return built["db"]


@pytest.fixture(scope="session")
def client(db_path):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    database_url = f"sqlite:///{db_path.as_posix()}"
    # Optional: run this whole suite against the hosted (PostgreSQL) path instead of the SQLite file.
    # STARGAZER_TEST_PG_URL must be a database the tests may overwrite. See tests/test_postgres.py.
    if os.environ.get("STARGAZER_TEST_API_ON_PG") == "1" and os.environ.get("STARGAZER_TEST_PG_URL"):
        import push_to_postgres
        database_url = os.environ["STARGAZER_TEST_PG_URL"]
        push_to_postgres.push(db_path, database_url, quiet=True)
    app = create_app(Settings(database_url=database_url))
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def api(client):
    """GET helper that returns parsed JSON and asserts the status code."""
    def get(path: str, status: int = 200, **params):
        response = client.get("/api/v1" + path, params={k: v for k, v in params.items() if v is not None})
        assert response.status_code == status, f"{path} {params}: {response.status_code} {response.text[:300]}"
        return response.json()
    return get
