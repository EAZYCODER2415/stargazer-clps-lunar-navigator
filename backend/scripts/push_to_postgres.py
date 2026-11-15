#!/usr/bin/env python3
"""
push_to_postgres.py: copy the built SQLite database into a PostgreSQL database (for example Neon).

    python backend/scripts/push_to_postgres.py                    # reads the address from STARGAZER_PG_URL
    python backend/scripts/push_to_postgres.py --print-schema     # show the PostgreSQL tables, change nothing

The SQLite file stays the source of truth: scripts/build_db.py builds it from the repo's data, and
this script uploads an exact copy. Run it again after every rebuild.

The whole upload is one transaction. If anything fails (network, a wrong value, a count that does
not match) the hosted database keeps whatever it had before, untouched.

The address holds a password. Give it through the STARGAZER_PG_URL environment variable, set with
    $env:STARGAZER_PG_URL = Read-Host "Neon address"
so that it is pasted at a prompt and not saved in the shell history, and never put it in a file
that is committed.
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

DEFAULT_DB = BACKEND_DIR / "data" / "stargazer.db"
SCHEMA_FILE = BACKEND_DIR / "schema" / "schema.sql"
BATCH_ROWS = 5000


def postgres_ddl(sqlite_schema: str) -> str:
    """
    The same tables, constraints and indexes as schema/schema.sql, in PostgreSQL's dialect.

      REAL  -> DOUBLE PRECISION   SQLite's REAL is 8 bytes; PostgreSQL's REAL is 4 and would round the data.
      BLOB  -> BYTEA
      TEXT  -> TEXT COLLATE "C"   byte order, as in SQLite, so ORDER BY and comparisons on the ISO time
                                  strings behave identically whatever locale the server was created with.
      WITHOUT ROWID is a SQLite storage option and is dropped.
    """
    out = []
    for line in sqlite_schema.splitlines():
        code, sep, comment = line.partition("--")
        code = re.sub(r"\)\s*WITHOUT\s+ROWID\s*;", ");", code, flags=re.IGNORECASE)
        code = re.sub(r"\bREAL\b", "DOUBLE PRECISION", code)
        code = re.sub(r"\bBLOB\b", "BYTEA", code)
        code = re.sub(r"\bTEXT\b", 'TEXT COLLATE "C"', code)
        if re.match(r"\s*PRAGMA\b", code, flags=re.IGNORECASE):
            continue
        out.append(code + sep + comment)
    return "\n".join(out) + "\n"


def tables_in_schema_order(schema: str) -> list[str]:
    """Table names in the order they are created, which is also a safe order to fill them in."""
    return re.findall(r"^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)", schema,
                      flags=re.IGNORECASE | re.MULTILINE)


def csv_field(value) -> str:
    """One value in PostgreSQL's CSV COPY format. NULL is an empty unquoted field; text is always quoted."""
    if value is None:
        return ""
    if isinstance(value, (bytes, memoryview)):
        return '"\\x' + bytes(value).hex() + '"'
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)                                     # shortest text that reads back to the same double
    return '"' + str(value).replace('"', '""') + '"'


def copy_table(pg, lite: sqlite3.Connection, table: str) -> int:
    columns = [row[1] for row in lite.execute(f'PRAGMA table_info("{table}")')]
    column_list = ", ".join(f'"{c}"' for c in columns)
    cursor = lite.execute(f'SELECT {column_list} FROM "{table}"')
    copied = 0
    while True:
        rows = cursor.fetchmany(BATCH_ROWS)
        if not rows:
            break
        payload = "".join(",".join(csv_field(v) for v in row) + "\n" for row in rows).encode("utf-8")
        pg.run(f'COPY "{table}" ({column_list}) FROM STDIN WITH (FORMAT csv)', stream=io.BytesIO(payload))
        copied += len(rows)
    return copied


def push(db_path: Path, url: str, quiet: bool = False) -> dict:
    """Uploads every table. Returns {table: rows}. Raises if anything does not match; nothing is kept then."""
    import pg8000.native

    import pgdb

    say = (lambda *a: None) if quiet else print
    if not db_path.exists():
        raise SystemExit(f"{db_path} does not exist. Build it first: python backend/scripts/build_db.py --rerun-cost")
    schema = SCHEMA_FILE.read_text(encoding="utf-8")
    tables = tables_in_schema_order(schema)
    lite = sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)
    in_file = {row[0] for row in lite.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}
    if set(tables) != in_file:
        raise SystemExit(f"schema.sql and {db_path.name} disagree on the tables: "
                         f"only in schema {sorted(set(tables) - in_file)}, only in file {sorted(in_file - set(tables))}. "
                         "Rebuild the database.")
    build_id = lite.execute("SELECT build_id FROM dataset_build").fetchone()[0]

    say(f"Source: {db_path} (build {build_id})")
    say(f"Target: {pgdb.describe(url)}")
    started = time.monotonic()
    pg = pg8000.native.Connection(**{**pgdb.parse_url(url), "application_name": "stargazer-push", "timeout": 120})
    counts: dict[str, int] = {}
    try:
        pg.run("START TRANSACTION")
        for table in reversed(tables):
            pg.run(f'DROP TABLE IF EXISTS "{table}" CASCADE')
        pg.run(postgres_ddl(schema))
        for table in tables:
            counts[table] = copy_table(pg, lite, table)
            there = pg.run(f'SELECT count(*) FROM "{table}"')[0][0]
            here = lite.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            if not (there == here == counts[table]):
                raise RuntimeError(f"{table}: {here} rows in the file, {counts[table]} sent, {there} arrived")
            say(f"  {table:<22} {there:>7} rows")
        pushed_build = pg.run("SELECT build_id FROM dataset_build")[0][0]
        if pushed_build != build_id:
            raise RuntimeError(f"build id arrived as {pushed_build!r}, expected {build_id!r}")
        pg.run("COMMIT")
    except BaseException:
        try:
            pg.run("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        try:
            pg.close()
        except Exception:
            pass
        lite.close()
    say(f"Done: {len(tables)} tables, {sum(counts.values())} rows, build {build_id}, "
        f"{time.monotonic() - started:.1f} s. The hosted copy was replaced in one step.")
    return counts


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Copy the built SQLite database into PostgreSQL (for example Neon).")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="the SQLite file to upload (default: backend/data/stargazer.db)")
    parser.add_argument("--url-env", default="STARGAZER_PG_URL",
                        help="name of the environment variable that holds the PostgreSQL address (default: STARGAZER_PG_URL)")
    parser.add_argument("--print-schema", action="store_true", help="print the PostgreSQL table definitions and exit")
    args = parser.parse_args(argv)

    if args.print_schema:
        print(postgres_ddl(SCHEMA_FILE.read_text(encoding="utf-8")))
        return 0
    url = os.environ.get(args.url_env, "")
    if not url:
        print(f"Set {args.url_env} to the PostgreSQL address first. In PowerShell:\n"
              f'  $env:{args.url_env} = Read-Host "Neon address"\n'
              "then paste the address from the Neon dashboard (Connect) at the prompt. It looks like\n"
              "  postgresql://user:password@host/database?sslmode=require\n"
              "Do not paste it into chat or commit it.", file=sys.stderr)
        return 2
    if not url.startswith(("postgres://", "postgresql://")):
        print(f"{args.url_env} must start with postgresql://", file=sys.stderr)
        return 2
    try:
        push(args.db, url)
    except SystemExit:
        raise
    except Exception as error:
        print(f"Upload failed, the hosted database was left as it was: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
