"""
The hosted (PostgreSQL) copy must answer exactly like the SQLite file it was copied from.

These tests need a PostgreSQL database they are allowed to overwrite. They are skipped unless
STARGAZER_TEST_PG_URL is set, for example to a local server or a throwaway Neon branch:

    STARGAZER_TEST_PG_URL=postgresql://user:password@127.0.0.1:5432/stargazer_test python -m pytest backend/tests

Never point it at the database the live API reads: the test replaces every table.
"""
from __future__ import annotations

import os
import sqlite3

import pytest

PG_URL = os.environ.get("STARGAZER_TEST_PG_URL", "")
pytestmark = pytest.mark.skipif(not PG_URL, reason="STARGAZER_TEST_PG_URL is not set")

# One or more requests for every endpoint, covering each query shape the services use.
REQUESTS = [
    ("/health", {}), ("/meta", {}), ("/sources", {}), ("/sites", {}),
    ("/sites/malapert", {}), ("/sites/shackleton", {}), ("/sites/mons-mouton", {}),
    ("/sites/malapert/horizon", {}), ("/sites/shackleton/horizon", {"format": "columns"}),
    ("/sites/malapert/terrain-tile", {}), ("/sites/mons-mouton/terrain-tile", {"level": 1, "stride": 2}),
    ("/sites/malapert/ephemeris", {"limit": 50}),
    ("/sites/malapert/ephemeris", {"body": "sun", "step": 6, "format": "columns"}),
    ("/sites/shackleton/ephemeris", {"start": "2026-12-10T00:00:00Z", "end": "2026-12-12T00:00:00Z", "horizon_model": "flat"}),
    ("/sites/mons-mouton/ephemeris", {"limit": 10, "offset": 2800}),
    ("/sites/malapert/solar-elevation", {"at": "2026-12-13T02:30:00Z"}),
    ("/sites/shackleton/position", {"at": "2027-02-01T12:34:56Z", "body": "earth"}),
    ("/sites/malapert/visibility/windows", {}),
    ("/sites/malapert/visibility/windows", {"month": "2027-01", "body": "both"}),
    ("/sites/shackleton/visibility/windows", {"body": "earth", "scenario": "all", "horizon_model": "flat"}),
    ("/sites/mons-mouton/visibility/windows", {"start": "2027-01-05T00:00:00Z", "end": "2027-02-20T00:00:00Z", "scenario": "pessimistic"}),
    ("/sites/malapert/visibility/summary", {"lunar_day": 1}),
    ("/sites/shackleton/visibility/summary", {"start": "2026-12-05T00:00:00Z", "days": 20, "scenario": "optimistic"}),
    ("/sites/mons-mouton/visibility/summary", {"lunar_day": 0, "horizon_model": "flat"}),
    ("/sites/malapert/visibility/next-transition", {"after": "2026-12-06T00:00:00Z", "body": "sun"}),
    ("/sites/shackleton/visibility/next-transition", {"after": "2026-12-06T00:00:00Z", "body": "earth", "scenario": "optimistic"}),
    ("/sites/malapert/cost", {}), ("/sites/shackleton/cost", {"horizon_model": "flat"}),
    ("/sites/mons-mouton/cost", {"horizon_lookup": "nearest_lower_bin"}),
    ("/compare", {"lunar_day": 1}), ("/compare", {"lunar_day": 3, "horizon_model": "flat"}),
    ("/compare", {"sites": "malapert,shackleton", "start": "2027-01-10T00:00:00Z", "days": 10}),
    # errors must match too
    ("/sites/nowhere", {}), ("/sites/malapert/visibility/windows", {"month": "2027-13"}),
    ("/sites/malapert/visibility/summary", {"lunar_day": 99}),
]
CSV_REQUESTS = [
    ("/sites/malapert/visibility/windows", {"format": "csv", "month": "2027-01"}),
    ("/sites/shackleton/ephemeris", {"format": "csv", "limit": 200}),
]


@pytest.fixture(scope="module")
def hosted_client(db_path):
    """Uploads the freshly built SQLite file to the test PostgreSQL database and serves the API from it."""
    pytest.importorskip("pg8000", reason="the PostgreSQL path needs pg8000")
    from fastapi.testclient import TestClient

    import push_to_postgres
    from app.config import Settings
    from app.main import create_app

    push_to_postgres.push(db_path, PG_URL, quiet=True)
    app = create_app(Settings(database_url=PG_URL))
    with TestClient(app) as test_client:
        yield test_client


def test_every_table_arrives_with_every_row(hosted_client, db_path):
    import pg8000.native

    import pgdb
    lite = sqlite3.connect(str(db_path))
    pg = pg8000.native.Connection(**pgdb.parse_url(PG_URL))
    try:
        tables = [r[0] for r in lite.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        assert len(tables) == 18
        for table in tables:
            assert pg.run(f'SELECT count(*) FROM "{table}"')[0][0] == lite.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0], table
        # values survive exactly: a float column, and the terrain bytes
        assert pg.run("SELECT sum(elevation_deg) FROM ephemeris_sample")[0][0] == pytest.approx(
            lite.execute("SELECT sum(elevation_deg) FROM ephemeris_sample").fetchone()[0], abs=1e-9)
        lite_tiles = lite.execute("SELECT site_id, level_index, heights_i16_le FROM terrain_tile ORDER BY site_id, level_index").fetchall()
        pg_tiles = pg.run("SELECT site_id, level_index, heights_i16_le FROM terrain_tile ORDER BY site_id, level_index")
        assert [(s, l, bytes(b)) for s, l, b in pg_tiles] == [(s, l, bytes(b)) for s, l, b in lite_tiles]
    finally:
        pg.close()
        lite.close()


@pytest.mark.parametrize("path,params", REQUESTS, ids=[f"{p}?{'&'.join(f'{k}={v}' for k, v in q.items())}" for p, q in REQUESTS])
def test_hosted_answers_match_sqlite(client, hosted_client, path, params):
    from_file = client.get("/api/v1" + path, params=params)
    from_hosted = hosted_client.get("/api/v1" + path, params=params)
    assert from_hosted.status_code == from_file.status_code
    assert from_hosted.json() == from_file.json()
    assert from_hosted.headers.get("etag") == from_file.headers.get("etag")


@pytest.mark.parametrize("path,params", CSV_REQUESTS, ids=[p for p, _ in CSV_REQUESTS])
def test_hosted_csv_matches_sqlite(client, hosted_client, path, params):
    assert hosted_client.get("/api/v1" + path, params=params).text == client.get("/api/v1" + path, params=params).text


def test_hosted_database_is_read_only(hosted_client):
    import pg8000.exceptions

    import pgdb
    # the PostgreSQL session itself refuses writes ...
    with pgdb.Connection(pgdb.Pool(PG_URL)) as conn:
        with pytest.raises(pg8000.exceptions.DatabaseError, match="read-only"):
            conn.execute("DELETE FROM site")
    # ... and so does whatever connection the API hands to a request (in-memory copy or direct)
    with hosted_client.app.state.db.connect() as conn:
        with pytest.raises((sqlite3.OperationalError, pg8000.exceptions.DatabaseError), match="read-?only"):
            conn.execute("DELETE FROM site")
    assert hosted_client.post("/api/v1/sites").status_code == 405
    assert hosted_client.get("/api/v1/sites").json()["sites"]


def test_a_dropped_connection_is_replaced():
    """Neon closes idle connections. The next query must reconnect, not fail."""
    import pgdb
    conn = pgdb.Connection(pgdb.Pool(PG_URL))
    conn._raw.close()                                          # what the server does to an idle connection
    assert conn.execute("SELECT count(*) FROM site").scalar() == 3
    conn.close()


def _wait_for(condition, seconds=20.0):
    import time
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.05)
    return False


def test_in_memory_copy_is_the_default_and_follows_the_hosted_build(hosted_client, db_path, monkeypatch):
    """The API serves a hosted database from memory, and reloads when the hosted build id changes."""
    import pg8000.native

    import pgdb
    import push_to_postgres
    from app.db import Database

    monkeypatch.delenv("STARGAZER_HOSTED_MODE", raising=False)
    db = Database(PG_URL)
    assert db.mirror is not None
    build = db.build_id()
    assert build and build.startswith("sg-")
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM site").scalar() == 3

    owner = pg8000.native.Connection(**pgdb.parse_url(PG_URL))
    try:
        owner.run("UPDATE dataset_build SET build_id = 'sg-changed-on-host'")
        db.mirror._checked_at = 0.0                            # as if a minute had passed
        db.connect().close()                                   # an ordinary request starts the background check
        assert _wait_for(lambda: db.mirror.build_id == "sg-changed-on-host"), "the in-memory copy did not reload"
        assert db.build_id() == "sg-changed-on-host"
    finally:
        owner.close()
        push_to_postgres.push(db_path, PG_URL, quiet=True)     # put the real data back for the other tests


def test_in_memory_copy_keeps_serving_when_the_host_goes_away(hosted_client, monkeypatch):
    import pgdb
    from app.db import Database

    monkeypatch.delenv("STARGAZER_HOSTED_MODE", raising=False)
    db = Database(PG_URL)
    build = db.build_id()
    assert build
    db._pool._kwargs = {**db._pool._kwargs, "port": 1, "timeout": 2}   # nothing listens there
    db._pool.close()
    db.mirror._checked_at = 0.0
    db.connect().close()                                       # starts a background check, which fails
    assert _wait_for(lambda: db.mirror.error is not None), "the failed check was not noticed"
    with db.connect() as conn:                                 # still answered from memory
        assert conn.execute("SELECT count(*) FROM site").scalar() == 3
    assert db.build_id() == build


def test_an_unreachable_host_with_nothing_loaded_is_a_503(monkeypatch):
    from app.db import Database
    from app.errors import ApiError

    monkeypatch.delenv("STARGAZER_HOSTED_MODE", raising=False)
    db = Database("postgresql://nobody:nothing@127.0.0.1:1/none?connect_timeout=2")
    with pytest.raises(ApiError) as caught:
        db.connect()
    assert caught.value.status_code == 503 and db.available() is False and db.build_id() is None


def test_the_address_is_never_shown_with_its_password():
    import pgdb
    shown = pgdb.describe("postgresql://alice:s3cret@ep-example-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require")
    assert "s3cret" not in shown and "alice@ep-example-123456" in shown


def test_neon_pooled_host_is_swapped_for_the_direct_one():
    import pgdb
    pooled = "postgresql://alice:s3cret@ep-example-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    kwargs = pgdb.parse_url(pooled)
    assert kwargs["host"] == "ep-example-123456.ap-southeast-1.aws.neon.tech"
    assert kwargs["ssl_context"] is not None and kwargs["database"] == "neondb" and kwargs["password"] == "s3cret"
    assert pgdb.parse_url("postgresql://sg:pw@127.0.0.1:5433/stargazer")["ssl_context"] is None
    assert pgdb.direct_host("my-pooler.example.com") == "my-pooler.example.com"


def test_postgres_schema_keeps_double_precision_and_byte_order():
    import push_to_postgres
    ddl = push_to_postgres.postgres_ddl(push_to_postgres.SCHEMA_FILE.read_text(encoding="utf-8"))
    assert "WITHOUT ROWID" not in ddl and " REAL" not in ddl and "BLOB" not in ddl
    assert "DOUBLE PRECISION" in ddl and "BYTEA" in ddl and 'TEXT COLLATE "C"' in ddl
    assert len(push_to_postgres.tables_in_schema_order(ddl)) == 18
