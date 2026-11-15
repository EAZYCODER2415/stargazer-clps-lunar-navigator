"""
Read-only database access.

The file is opened with SQLite's mode=ro and PRAGMA query_only=ON (see backend/sqlitedb.py), so no
statement that writes can succeed even if one were sent. Each request gets its own short-lived
connection, which also means a rebuilt database file is picked up without restarting the server.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from sqlitedb import Connection, open_read_only, text

from .errors import ApiError

NOT_BUILT = "The dataset has not been built yet. Run: python backend/scripts/build_db.py --rerun-cost"


def sqlite_path(database_url: str) -> Path:
    """The file behind STARGAZER_DATABASE_URL: either 'sqlite:///path/to/file.db' or a plain path."""
    if "://" in database_url and not database_url.startswith("sqlite"):
        raise ValueError(f"Only SQLite databases are supported; got {database_url.split('://', 1)[0]}://...")
    raw = database_url.split("///", 1)[1] if "///" in database_url else database_url
    return Path(raw.split("?", 1)[0])


class Database:
    """Opens connections and remembers the facts that never change within a build (build id, flags, sources)."""

    def __init__(self, database_url: str):
        self.database_url = database_url
        self.path = sqlite_path(database_url)
        self._info: Optional[dict] = None
        self._stamp: Optional[float] = None

    def available(self) -> bool:
        return self.path.exists()

    def connect(self) -> Connection:
        if not self.available():
            raise ApiError(503, "database_not_built", NOT_BUILT)
        return open_read_only(self.path)

    def info(self) -> dict:
        """Build row, quality flags and sources. Read once per build, and again if the file is replaced."""
        if not self.available():
            raise ApiError(503, "database_not_built", NOT_BUILT)
        stamp = self.path.stat().st_mtime
        if self._info is None or stamp != self._stamp:
            with self.connect() as conn:
                build = conn.execute(text("SELECT * FROM dataset_build")).mappings().one()
                flags = list(conn.execute(text(
                    "SELECT code, severity, scope, message, fix_order FROM quality_flag ORDER BY flag_id")).mappings())
                sources = {r["source_id"]: r for r in conn.execute(text("SELECT * FROM data_source")).mappings()}
            self._info, self._stamp = {"build": build, "flags": flags, "sources": sources}, stamp
        return self._info

    def build_id(self) -> Optional[str]:
        try:
            return self.info()["build"]["build_id"]
        except ApiError:
            return None
