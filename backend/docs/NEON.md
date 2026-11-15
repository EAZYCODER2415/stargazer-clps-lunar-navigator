# Hosting the database on Neon (PostgreSQL)

The API can read from a hosted PostgreSQL database instead of the local SQLite file. Nothing else
changes: same endpoints, same answers, still read-only.

```
repo data files  ->  build_db.py  ->  stargazer.db (SQLite)  ->  push_to_postgres.py  ->  Neon
                                            |                                               |
                                 API (default, local file)                 API (STARGAZER_DATABASE_URL set)
```

The SQLite file stays the source of truth. `push_to_postgres.py` uploads an exact copy of it.

## What you need

- A Neon project (any PostgreSQL 14+ server works the same way).
- The built SQLite file: `python backend\scripts\build_db.py --rerun-cost`
- `python -m pip install -r backend\requirements.txt` (adds `pg8000`, a pure-Python driver)

## 1. Get the address from Neon

In the Neon dashboard open **Connect** and copy the connection string. It looks like:

```
postgresql://USER:PASSWORD@ep-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

The dashboard shows a pooled address first (`-pooler` in the host name). Either one works here: the
code switches to the direct host itself, because it sets each session read-only and the pooler does
not keep session settings.

**The address contains the password.** Do not paste it into Telegram, a commit, a screenshot or an
AI chat. Keep it in an environment variable. If it leaks, reset the password in Neon.

## 2. Upload the data

PowerShell, from the top of the repo:

```powershell
$env:STARGAZER_PG_URL = Read-Host "Neon address"
python backend\scripts\push_to_postgres.py
```

`Read-Host` asks for the address and you paste it at the prompt. That keeps the password out of
PowerShell's command history, which typing it into the command itself would not. The variable lasts
until you close the window.

It prints the 18 tables with their row counts (53,166 rows in build `sg-8db7fb77e1eb`) and takes a
few seconds. The upload is one transaction: if anything fails, the hosted database keeps what it had.

Run it again after every rebuild of the SQLite file. It replaces all 18 tables.

To see the PostgreSQL table definitions without touching anything:

```powershell
python backend\scripts\push_to_postgres.py --print-schema
```

## 3. Point the API at Neon

```powershell
$env:STARGAZER_DATABASE_URL = $env:STARGAZER_PG_URL
python -m uvicorn app.main:app --app-dir backend
```

Check http://127.0.0.1:8000/api/v1/health. It should say `"database": "ok"` and the same build id
the upload printed. Unset the variable (`Remove-Item Env:STARGAZER_DATABASE_URL`) to go back to the
local file.

When the API itself is hosted, set the same two environment variables on the host:
`STARGAZER_DATABASE_URL` (the Neon address) and `STARGAZER_CORS_ORIGINS` (the website's address,
for example `https://stargazer.example.com`).

## What is different from SQLite

| | SQLite file | Neon |
|---|---|---|
| Decimal columns | `REAL` (8 bytes) | `DOUBLE PRECISION` (8 bytes; PostgreSQL's `REAL` is 4 and would round) |
| Terrain heights | `BLOB` | `BYTEA` |
| Text | byte order | `TEXT COLLATE "C"` (byte order, so sorting and time comparisons match) |
| Read-only | file opened `mode=ro` | session set `default_transaction_read_only` |
| Speed | in-process | the same: the API answers from an in-memory copy (see below) |

Constraints (primary keys, foreign keys, CHECKs, unique) and the indexes are created on Neon exactly
as in `backend/schema/schema.sql`.

For a stronger read-only guarantee, create a Neon role with only `SELECT` on the tables and use that
role's address for the API. Keep the owner's address for uploads.

## How the API uses the hosted database

A hosted database is far away. Measured from a laptop in Singapore to Neon, each query took about
80 ms, and one `/compare` request makes about 40 queries: 3.5 seconds, longer than the website
waits (1.5 s) before it shows its saved copy.

So when `STARGAZER_DATABASE_URL` is a PostgreSQL address, the API by default:

1. downloads the 18 tables once, when it starts, into an in-memory SQLite database (the whole
   dataset is a few megabytes and takes a few seconds);
2. answers every request from that copy, as fast as with the local file;
3. asks the hosted database about once a minute, in the background, whether its build id has
   changed, and reloads when it has. A request never waits for this.

The hosted database stays the source of the data. After `push_to_postgres.py` uploads a new build,
a running API picks it up within about a minute, with no restart. If the hosted database is briefly
unreachable, the API keeps serving the copy it has.

Set `STARGAZER_HOSTED_MODE=direct` to query the hosted database on every request instead (slower;
only sensible when the API runs next to the database).

## Things to know about Neon

- An idle Neon database is suspended and wakes on the next connection. With the in-memory copy
  this only affects the once-a-minute background check, never a request. The API reconnects by
  itself when a connection has gone stale.
- Create the Neon project in the region closest to where the API runs. It matters most for the
  upload and for `STARGAZER_HOSTED_MODE=direct`.
- Neon finds the database from the host name sent in the TLS handshake. `pg8000` sends it. If a
  connection ever fails with "The endpoint ID is not specified", add
  `&options=endpoint%3Dep-name-123456` to the address (Neon's documented workaround).

## Tests

```powershell
python -m pytest backend\tests                                  # 99 pass, 46 skipped (no PostgreSQL)
$env:STARGAZER_TEST_PG_URL = Read-Host "TEST database address"  # a database the tests may OVERWRITE
python -m pytest backend\tests                                  # 145 pass
$env:STARGAZER_TEST_API_ON_PG = "1"
python -m pytest backend\tests                                  # the whole API suite served from PostgreSQL
```

Never set `STARGAZER_TEST_PG_URL` to the database the live API reads. Use a separate Neon branch or
a local PostgreSQL.

`tests/test_postgres.py` uploads the freshly built file and checks that 35 requests across all 15
endpoints (errors and CSV included) return the same JSON and the same ETag from the hosted database
as from SQLite. Set `STARGAZER_HOSTED_MODE=direct` as well to run them against per-request queries.

## What was and was not checked (15 Nov 2026)

- Checked against PostgreSQL 16 with password (SCRAM) login: upload, all 145 tests in both hosted
  modes, the full API suite served from PostgreSQL, concurrent requests through uvicorn, a dropped
  connection, a hosted build change picked up without a restart, the host going away after a load,
  a wrong password (nothing changed, password not printed).
- Checked against a real Neon project from a Windows 11 laptop (Python 3.14): the upload (18 tables,
  53,166 rows) and the API in direct mode (correct answers, about 3.5 s per `/compare`, which is why
  the in-memory copy became the default).
