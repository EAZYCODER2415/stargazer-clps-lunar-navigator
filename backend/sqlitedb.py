"""
sqlitedb.py: a thin layer over Python's built-in sqlite3 module.

The backend only ever talks to one SQLite file, so it needs nothing beyond the standard library.
(SQLAlchemy was used at first, as the brief asked. Its compiled extensions are unsigned and Windows
Smart App Control refuses to load them on some laptops, which stopped the whole backend from
starting. See docs/M0_DESIGN_NOTE.md.)

Call sites read like this:

    conn.execute(text("SELECT name FROM site WHERE site_id = :s"), {"s": site_id}).mappings().first()

`:name` placeholders are sqlite3's own named parameters, so values are always bound by the
database and never pasted into the SQL text.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterator, Optional, Sequence, Union


def text(sql: str) -> str:
    """Marks a string as SQL at the call site. Returns it unchanged."""
    return sql


class Mappings:
    """Rows as plain dicts."""

    def __init__(self, cursor: sqlite3.Cursor):
        self._cursor = cursor

    def __iter__(self) -> Iterator[dict]:
        return (dict(row) for row in self._cursor)

    def first(self) -> Optional[dict]:
        row = self._cursor.fetchone()
        return dict(row) if row is not None else None

    def one(self) -> dict:
        rows = self._cursor.fetchmany(2)
        if len(rows) != 1:
            raise LookupError(f"expected exactly one row, found {'none' if not rows else 'more than one'}")
        return dict(rows[0])

    def all(self) -> list[dict]:
        return [dict(row) for row in self._cursor]


class Result:
    """What Connection.execute returns. Rows support both row[0] and row['column']."""

    def __init__(self, cursor: sqlite3.Cursor):
        self._cursor = cursor

    @property
    def lastrowid(self) -> Optional[int]:
        return self._cursor.lastrowid

    def __iter__(self) -> Iterator[sqlite3.Row]:
        return iter(self._cursor)

    def first(self) -> Optional[sqlite3.Row]:
        return self._cursor.fetchone()

    def fetchone(self) -> Optional[sqlite3.Row]:
        return self._cursor.fetchone()

    def fetchall(self) -> list[sqlite3.Row]:
        return self._cursor.fetchall()

    def scalar(self) -> Any:
        row = self._cursor.fetchone()
        return row[0] if row is not None else None

    def mappings(self) -> Mappings:
        return Mappings(self._cursor)


class Connection:
    """One sqlite3 connection. Use as a context manager, or call close()."""

    def __init__(self, raw: sqlite3.Connection):
        raw.row_factory = sqlite3.Row
        self.raw = raw

    def execute(self, sql: str, params: Union[dict, Sequence[dict], None] = None) -> Result:
        """Runs one statement. A list of dicts runs it once per dict (bulk insert)."""
        if isinstance(params, (list, tuple)):
            return Result(self.raw.executemany(sql, params))
        return Result(self.raw.execute(sql, params or {}))

    def commit(self) -> None:
        self.raw.commit()

    def close(self) -> None:
        self.raw.close()

    def __enter__(self) -> "Connection":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()


def open_read_only(path: Union[str, Path]) -> Connection:
    """
    Opens a database file so that it cannot be changed: SQLite's own read-only mode (mode=ro) plus
    PRAGMA query_only=ON. Any INSERT, UPDATE, DELETE, CREATE or DROP fails with
    'attempt to write a readonly database'.
    """
    uri = Path(path).resolve().as_uri() + "?mode=ro"            # file:///.../stargazer.db?mode=ro
    raw = sqlite3.connect(uri, uri=True, check_same_thread=False)
    raw.execute("PRAGMA query_only = ON")
    return Connection(raw)


def open_for_build(path: Union[str, Path]) -> Connection:
    """Opens (and creates) a database file for writing. Only scripts/build_db.py calls this."""
    return Connection(sqlite3.connect(str(path)))
