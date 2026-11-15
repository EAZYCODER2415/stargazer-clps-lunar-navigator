"""
Read-only database access.

Two kinds of database are supported, chosen by the scheme of STARGAZER_DATABASE_URL:

  sqlite:///path/to/stargazer.db (or a plain path)   the file scripts/build_db.py writes. The default.
  postgresql://user:password@host/database           a hosted copy of the same tables, for example on
                                                     Neon. Filled by scripts/push_to_postgres.py.

Either way nothing can be written. The SQLite file is opened with mode=ro and PRAGMA query_only=ON
(see backend/sqlitedb.py); a PostgreSQL session is set to default_transaction_read_only (see
backend/pgdb.py).

A hosted database is far away: every query is at least one network round trip (about 80 ms from a
laptop to Neon, measured), and one /compare request makes about 40 queries. So by default the API
does not query it per request. It downloads the 18 tables once into an in-memory SQLite database
(the whole dataset is a few megabytes), serves every request from that, and checks in the
background whether the hosted build id has changed, reloading when it has. The hosted database
stays the source of the data; requests are as fast as with the local file; and a short outage of
the hosted database does not take the API down. Set STARGAZER_HOSTED_MODE=direct to query the
hosted database on every request instead.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

from sqlitedb import Connection, open_read_only, text

from .config import BACKEND_DIR
from .errors import ApiError

log = logging.getLogger("uvicorn.error")          # uvicorn's own logger, so these lines show in its console

NOT_BUILT = "The dataset has not been built yet. Run: python backend/scripts/build_db.py --rerun-cost"
NOT_PUSHED = ("The hosted database has no Stargazer tables yet. Run: "
              "python backend/scripts/push_to_postgres.py (see backend/docs/NEON.md)")
UNREACHABLE = "The hosted database cannot be reached right now."
SCHEMA_FILE = BACKEND_DIR / "schema" / "schema.sql"
# How often the hosted database is asked whether its build id has changed.
HOSTED_CHECK_SECONDS = 60.0
# How long a request waits for the first download from the hosted database before giving up.
FIRST_LOAD_WAIT_SECONDS = 60.0


def is_postgres_url(database_url: str) -> bool:
    return database_url.startswith(("postgres://", "postgresql://"))


def sqlite_path(database_url: str) -> Path:
    """The file behind STARGAZER_DATABASE_URL: either 'sqlite:///path/to/file.db' or a plain path."""
    if "://" in database_url and not database_url.startswith("sqlite"):
        raise ValueError("STARGAZER_DATABASE_URL must be a SQLite file (sqlite:///path or a plain path) or a "
                         f"PostgreSQL URL (postgresql://...); got {database_url.split('://', 1)[0]}://...")
    raw = database_url.split("///", 1)[1] if "///" in database_url else database_url
    return Path(raw.split("?", 1)[0])


class HostedMirror:
    """
    An in-memory SQLite copy of the hosted PostgreSQL tables, refreshed when the hosted build changes.

    Each load goes into a brand-new in-memory database and is swapped in only when it is complete,
    so a request never sees half a dataset, and a failed load leaves the previous copy in service.
    """

    def __init__(self, pgdb_module, pool):
        self._pgdb = pgdb_module
        self._pool = pool
        self._lock = threading.Lock()                # guards the swap and the "is a load running" flag
        self._ready = threading.Event()              # set once the first load has finished, well or badly
        self._uri: Optional[str] = None
        self._keeper: Optional[sqlite3.Connection] = None   # keeps the current in-memory database alive
        self.build_id: Optional[str] = None
        self.generation = 0
        self.loaded_at: Optional[float] = None
        self.error: Optional[ApiError] = None
        self._loading = False
        self._checked_at = 0.0
        self.refresh_in_background()

    # ---- loading -------------------------------------------------------------------------------
    def _download(self) -> None:
        with self._pgdb.Connection(self._pool) as hosted:
            build_id = hosted.execute('SELECT build_id FROM dataset_build').scalar()
            if build_id is None:
                raise LookupError("dataset_build is empty")
            if build_id == self.build_id:
                return                                           # nothing new on the hosted side
            uri = f"file:stargazer_mirror_{id(self)}_{self.generation + 1}?mode=memory&cache=shared"
            keeper = sqlite3.connect(uri, uri=True, check_same_thread=False)
            try:
                keeper.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
                tables = [row[0] for row in keeper.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
                keeper.execute("PRAGMA foreign_keys = OFF")      # tables are filled in any order
                rows_total = 0
                for table in tables:
                    columns = [row[1] for row in keeper.execute(f'PRAGMA table_info("{table}")')]
                    column_list = ", ".join(f'"{c}"' for c in columns)
                    rows = [tuple(row) for row in hosted.execute(f'SELECT {column_list} FROM "{table}"')]
                    keeper.executemany(
                        f'INSERT INTO "{table}" ({column_list}) VALUES ({", ".join("?" * len(columns))})', rows)
                    rows_total += len(rows)
                keeper.commit()
                if keeper.execute("SELECT build_id FROM dataset_build").fetchone()[0] != build_id:
                    raise LookupError("the hosted build changed while it was being downloaded")
            except BaseException:
                keeper.close()
                raise
        with self._lock:
            old = self._keeper
            self._uri, self._keeper, self.build_id = uri, keeper, build_id
            self.generation += 1
            self.loaded_at = time.time()
        if old is not None:
            old.close()                                          # requests still using it keep it alive until they finish
        log.info("hosted dataset loaded into memory: build %s, %d tables, %d rows", build_id, len(tables), rows_total)

    def _refresh(self) -> None:
        try:
            self._download()
            self.error = None
        except Exception as error:                               # tables missing, wrong address, no network
            missing = "does not exist" in str(error) or isinstance(error, LookupError)
            self.error = ApiError(503, "database_not_built" if missing else "database_unreachable",
                                  NOT_PUSHED if missing else UNREACHABLE)
            log.warning("hosted database %s (%s). %s", "has no Stargazer tables" if missing else "is unreachable",
                        type(error).__name__, "Serving the copy already in memory." if self._uri else "No copy in memory yet.")
        finally:
            self._checked_at = time.monotonic()
            with self._lock:
                self._loading = False
            self._ready.set()

    def refresh_in_background(self) -> None:
        with self._lock:
            if self._loading:
                return
            self._loading = True
        threading.Thread(target=self._refresh, name="stargazer-hosted-refresh", daemon=True).start()

    # ---- serving -------------------------------------------------------------------------------
    def connect(self) -> Connection:
        if not self._ready.wait(FIRST_LOAD_WAIT_SECONDS):
            raise ApiError(503, "database_unreachable", "The hosted dataset is still being downloaded. Try again shortly.")
        if time.monotonic() - self._checked_at > HOSTED_CHECK_SECONDS:
            self.refresh_in_background()                         # never makes this request wait
        with self._lock:
            uri = self._uri
            if uri is None:
                raise self.error or ApiError(503, "database_unreachable", UNREACHABLE)
            raw = sqlite3.connect(uri, uri=True, check_same_thread=False)
        raw.execute("PRAGMA query_only = ON")
        return Connection(raw)


class Database:
    """Opens connections and remembers the facts that never change within a build (build id, flags, sources)."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.hosted = is_postgres_url(database_url)
        self.mirror: Optional[HostedMirror] = None
        self.path: Optional[Path] = None
        self._info: Optional[dict] = None
        self._stamp: Optional[float] = None
        if self.hosted:
            import pgdb                                         # needs pg8000; only imported when used
            self._pgdb = pgdb
            self._pool = pgdb.Pool(database_url)
            if os.environ.get("STARGAZER_HOSTED_MODE", "mirror").strip().lower() != "direct":
                self.mirror = HostedMirror(pgdb, self._pool)
        else:
            self.path = sqlite_path(database_url)

    def describe(self) -> str:
        """Where the data lives, without any password."""
        if not self.hosted:
            return str(self.path)
        return self._pgdb.describe(self.database_url) + (" (served from an in-memory copy)" if self.mirror else "")

    def available(self) -> bool:
        if not self.hosted:
            return self.path.exists()
        try:
            self.info()
            return True
        except ApiError:
            return False

    def connect(self) -> Connection:
        if self.mirror is not None:
            return self.mirror.connect()
        if self.hosted:
            try:
                return self._pgdb.Connection(self._pool)
            except Exception as error:                          # wrong address, no network, database asleep
                raise ApiError(503, "database_unreachable", UNREACHABLE) from error
        if not self.available():
            raise ApiError(503, "database_not_built", NOT_BUILT)
        return open_read_only(self.path)

    def _read_info(self) -> dict:
        with self.connect() as conn:
            build = conn.execute(text("SELECT * FROM dataset_build")).mappings().one()
            flags = list(conn.execute(text(
                "SELECT code, severity, scope, message, fix_order FROM quality_flag ORDER BY flag_id")).mappings())
            sources = {r["source_id"]: r for r in conn.execute(text("SELECT * FROM data_source")).mappings()}
        return {"build": build, "flags": flags, "sources": sources}

    def info(self) -> dict:
        """Build row, quality flags and sources. Read once per build, and again if the data is replaced."""
        if self.mirror is not None:
            conn = self.mirror.connect()                        # also raises if nothing has been loaded
            conn.close()
            stamp = float(self.mirror.generation)
            if self._info is None or stamp != self._stamp:
                self._info, self._stamp = self._read_info(), stamp
            return self._info
        if self.hosted:
            now = time.monotonic()
            if self._info is None or now - self._stamp > HOSTED_CHECK_SECONDS:
                try:
                    self._info, self._stamp = self._read_info(), now
                except ApiError:
                    raise
                except Exception as error:                      # tables missing, or the connection dropped
                    missing = "does not exist" in str(error) or isinstance(error, LookupError)
                    raise ApiError(503, "database_not_built" if missing else "database_unreachable",
                                   NOT_PUSHED if missing else UNREACHABLE) from error
            return self._info
        if not self.available():
            raise ApiError(503, "database_not_built", NOT_BUILT)
        stamp = self.path.stat().st_mtime
        if self._info is None or stamp != self._stamp:
            self._info, self._stamp = self._read_info(), stamp
        return self._info

    def build_id(self) -> Optional[str]:
        try:
            return self.info()["build"]["build_id"]
        except ApiError:
            return None
