"""
pgdb.py: the same small interface as sqlitedb.py, for a PostgreSQL database (for example Neon).

The API's queries are plain SELECTs with `:name` placeholders, which SQLite and PostgreSQL both
understand, so the routers and services do not know which database they are talking to. Only
app/db.py chooses, from the scheme of STARGAZER_DATABASE_URL.

The driver is pg8000, which is pure Python. That matters on Windows laptops where Smart App Control
blocks unsigned compiled extensions (the reason SQLAlchemy was dropped; see docs/M0_DESIGN_NOTE.md).

Connections are kept in a small pool, because opening one to a cloud database costs a TLS handshake
and a login (a few hundred milliseconds). Every session is set read-only.
"""
from __future__ import annotations

import queue
import ssl
import threading
from typing import Any, Iterator, Optional
from urllib.parse import parse_qs, unquote, urlsplit

import pg8000.exceptions
import pg8000.native

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
# Errors that mean "this connection is dead", not "this SQL is wrong". Neon closes idle connections
# and suspends an idle database, so a pooled connection can be stale by the time it is reused.
CONNECTION_ERRORS = (pg8000.exceptions.InterfaceError, OSError, ssl.SSLError, EOFError)


def is_postgres_url(url: str) -> bool:
    return url.startswith(("postgres://", "postgresql://"))


def parse_url(url: str) -> dict:
    """
    postgresql://user:password@host:port/database?sslmode=require  ->  keyword arguments for pg8000.

    TLS is on unless the host is local or the URL says sslmode=disable. The server's certificate is
    checked against the system's certificate store, and the host name is sent with the handshake,
    which is how Neon finds the right database. An `options` query parameter (for example
    options=endpoint%3Dep-name-123456) is passed through for clients that need it.
    """
    parts = urlsplit(url)
    if not parts.hostname or not parts.username:
        raise ValueError("The PostgreSQL URL needs a user and a host: postgresql://user:password@host/database")
    query = {key: values[-1] for key, values in parse_qs(parts.query).items()}
    sslmode = query.get("sslmode", "disable" if parts.hostname in LOCAL_HOSTS else "require")
    kwargs: dict[str, Any] = {
        "user": unquote(parts.username),
        "password": unquote(parts.password) if parts.password is not None else None,
        "host": direct_host(parts.hostname),
        "port": parts.port or 5432,
        "database": unquote(parts.path.lstrip("/")) or None,
        "ssl_context": None if sslmode == "disable" else ssl.create_default_context(),
        "timeout": float(query.get("connect_timeout", 15)),
        "application_name": "stargazer-api",
    }
    if "options" in query:
        kwargs["startup_params"] = {"options": query["options"]}
    return kwargs


def direct_host(host: str) -> str:
    """
    Neon gives every database two host names: a direct one, and a pooled one with "-pooler" after the
    endpoint id (ep-name-123456-pooler.region.aws.neon.tech), which is the one its dashboard shows
    first. The pooled one goes through PgBouncer, which does not keep session settings, so the
    read-only setting below would not hold. This code keeps its own small pool, so it always uses the
    direct host; Neon documents removing "-pooler" from the host name as the way to get it.
    """
    label, dot, rest = host.partition(".")
    if label.endswith("-pooler") and rest.endswith("neon.tech"):
        return label[: -len("-pooler")] + dot + rest
    return host


def describe(url: str) -> str:
    """The URL without its password, safe to print or put in an error message."""
    parts = urlsplit(url)
    host = direct_host(parts.hostname or "")
    return f"postgresql://{parts.username or ''}@{host}{':' + str(parts.port) if parts.port else ''}{parts.path}"


class Row(tuple):
    """A result row that supports both row[0] and row['column'], like sqlite3.Row."""

    def __new__(cls, values, index: dict):
        row = super().__new__(cls, values)
        row._index = index
        return row

    def __getitem__(self, key):
        if isinstance(key, str):
            return super().__getitem__(self._index[key])
        return super().__getitem__(key)

    def keys(self) -> list[str]:
        return list(self._index)


class Mappings:
    """Rows as plain dicts."""

    def __init__(self, result: "Result"):
        self._result = result

    def _as_dict(self, row) -> dict:
        return dict(zip(self._result.names, row))

    def __iter__(self) -> Iterator[dict]:
        return (self._as_dict(row) for row in self._result)

    def first(self) -> Optional[dict]:
        row = self._result.fetchone()
        return self._as_dict(row) if row is not None else None

    def one(self) -> dict:
        rows = [self._result.fetchone(), self._result.fetchone()]
        if rows[0] is None or rows[1] is not None:
            raise LookupError(f"expected exactly one row, found {'none' if rows[0] is None else 'more than one'}")
        return self._as_dict(rows[0])

    def all(self) -> list[dict]:
        return [self._as_dict(row) for row in self._result]


class Result:
    """What Connection.execute returns: the rows of one statement, read front to back like a cursor."""

    lastrowid = None

    def __init__(self, rows: Optional[list], columns: Optional[list]):
        self.names = [column["name"] for column in (columns or [])]
        index = {name: position for position, name in enumerate(self.names)}
        self._rows = [Row(row, index) for row in (rows or [])]
        self._next = 0

    def fetchone(self) -> Optional[Row]:
        if self._next >= len(self._rows):
            return None
        self._next += 1
        return self._rows[self._next - 1]

    first = fetchone

    def fetchall(self) -> list[Row]:
        rest, self._next = self._rows[self._next:], len(self._rows)
        return rest

    def __iter__(self) -> Iterator[Row]:
        return iter(self.fetchall())

    def scalar(self) -> Any:
        row = self.fetchone()
        return row[0] if row is not None else None

    def mappings(self) -> Mappings:
        return Mappings(self)


class Pool:
    """A few open connections, handed out one at a time. Safe to use from several threads."""

    def __init__(self, url: str, size: int = 4):
        self.url = url
        self._kwargs = parse_url(url)
        self._idle: "queue.LifoQueue[pg8000.native.Connection]" = queue.LifoQueue(maxsize=size)
        self._lock = threading.Lock()

    def open(self) -> pg8000.native.Connection:
        raw = pg8000.native.Connection(**self._kwargs)
        raw.run("SET default_transaction_read_only = on")     # no statement on this session can write
        return raw

    def take(self) -> pg8000.native.Connection:
        try:
            return self._idle.get_nowait()
        except queue.Empty:
            return self.open()

    def give_back(self, raw: pg8000.native.Connection) -> None:
        try:
            self._idle.put_nowait(raw)
        except queue.Full:
            _close_quietly(raw)

    def close(self) -> None:
        while True:
            try:
                _close_quietly(self._idle.get_nowait())
            except queue.Empty:
                return


def _close_quietly(raw: pg8000.native.Connection) -> None:
    try:
        raw.close()
    except Exception:                                          # already closed by the server
        pass


class Connection:
    """One pooled connection for the length of a request. close() returns it to the pool."""

    def __init__(self, pool: Pool):
        self._pool = pool
        self._raw: Optional[pg8000.native.Connection] = pool.take()

    def execute(self, sql: str, params: Optional[dict] = None) -> Result:
        """Runs one statement with `:name` parameters. A dead pooled connection is replaced once."""
        if self._raw is None:
            raise RuntimeError("this connection has been closed")
        for attempt in (1, 2):
            try:
                rows = self._raw.run(sql, **(params or {}))
                return Result(rows, self._raw.columns)
            except CONNECTION_ERRORS:
                _close_quietly(self._raw)
                self._raw = None
                if attempt == 2:
                    raise
                self._raw = self._pool.open()
        raise AssertionError("unreachable")

    def close(self) -> None:
        if self._raw is not None:
            self._pool.give_back(self._raw)
            self._raw = None

    def __enter__(self) -> "Connection":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()
