"""
Stargazer read-only API.

    cd backend
    uvicorn app.main:app --reload            # http://127.0.0.1:8000/api/v1/docs

GET only. The database is opened read-only. There is no raw-SQL endpoint.
"""
from __future__ import annotations

import hashlib
import logging
import sys
from pathlib import Path
from typing import Optional

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))                 # so `derive` (backend/derive.py) is importable

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

from .config import API_PREFIX, API_VERSION, Settings, get_settings  # noqa: E402
from .db import Database  # noqa: E402
from .errors import ApiError  # noqa: E402
from .routers import compare, cost, ephemeris, sites, system, visibility  # noqa: E402
from .schemas import ErrorResponse  # noqa: E402

log = logging.getLogger("stargazer.api")

DESCRIPTION = """
Read-only data for **Stargazer**, a lunar south pole landing-site explorer (NASA Space Apps 2026).

Everything here is precomputed once by `backend/scripts/build_db.py` from JPL Horizons ephemerides,
NASA LOLA terrain and the team's cost model, so the website, the Python library and the CLI all
read the same numbers.

**Read this first**

- Values are **geometric visibility**: is the centre of the Sun or Earth above the terrain skyline?
  That is not electrical power and not a working radio link.
- Every response carries a `meta` block: dataset build id, conventions, the horizon model used,
  sources and quality flags. Check `meta.quality_flags` before quoting a number.
- `horizon_model` defaults to `lola_mask` (real terrain). `flat` is a 0-degree horizon kept for
  comparison. The API never substitutes one for the other.
- Costs are distributions under stated assumptions, not mission-grade estimates.
- The API never extrapolates outside the data coverage (see `/meta`).
"""


class ReadOnlyCacheMiddleware(BaseHTTPMiddleware):
    """Rejects anything but GET, and adds cache headers. The data is immutable within a build, so an
    ETag made from the build id and the URL identifies a response exactly."""

    async def dispatch(self, request: Request, call_next):
        if request.method not in ("GET", "OPTIONS"):
            return JSONResponse(
                {"error": {"code": "method_not_allowed", "message": "This API is read-only. Only GET is supported."}},
                status_code=405, headers={"Allow": "GET, OPTIONS"})
        db: Database = request.app.state.db
        settings: Settings = request.app.state.settings
        build_id: Optional[str] = db.build_id() if db.available() else None
        path = request.url.path
        cacheable = (request.method == "GET" and build_id is not None and path.startswith(API_PREFIX)
                     and not path.endswith("/health"))
        etag = None
        cache_headers = {}
        if cacheable:
            query = "&".join(f"{k}={v}" for k, v in sorted(request.query_params.multi_items()))
            digest = hashlib.sha256(f"{path}?{query}".encode()).hexdigest()[:16]
            etag = f'W/"{build_id}-{digest}"'
            cache_headers = {"ETag": etag, "Cache-Control": f"public, max-age={settings.cache_max_age}",
                             "X-Dataset-Build": build_id}
            if etag in request.headers.get("if-none-match", ""):
                return Response(status_code=304, headers=cache_headers)
        response = await call_next(request)
        if build_id is not None:
            response.headers["X-Dataset-Build"] = build_id
        if cacheable and response.status_code == 200:
            for name, value in cache_headers.items():
                response.headers[name] = value
        return response


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="Stargazer API", version=API_VERSION, description=DESCRIPTION,
        docs_url=f"{API_PREFIX}/docs", redoc_url=None, openapi_url=f"{API_PREFIX}/openapi.json")
    app.state.settings = settings
    app.state.db = Database(settings.database_url)

    # Added innermost first: the read-only guard runs inside gzip, which runs inside CORS.
    app.add_middleware(ReadOnlyCacheMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"], allow_headers=["*"],
                       expose_headers=["ETag", "X-Dataset-Build", "X-Horizon-Model", "X-Total-Rows"])

    @app.exception_handler(ApiError)
    async def api_error(_: Request, error: ApiError):
        return JSONResponse(error.body(), status_code=error.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, error: RequestValidationError):
        problems = [{"parameter": ".".join(str(p) for p in e.get("loc", [])[1:]) or "request", "problem": e.get("msg", "invalid")}
                    for e in error.errors()]
        summary = "; ".join(f"{p['parameter']}: {p['problem']}" for p in problems)
        return JSONResponse({"error": {"code": "invalid_parameter", "message": f"Invalid request. {summary}",
                                       "problems": problems}}, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, error: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(error.status_code, "http_error")
        message = {404: f"No such endpoint. See {API_PREFIX}/docs.",
                   405: "This API is read-only. Only GET is supported."}.get(error.status_code, str(error.detail))
        return JSONResponse({"error": {"code": code, "message": message}}, status_code=error.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, error: Exception):
        log.exception("Unhandled error: %s", error)       # details go to the server log, never to the client
        return JSONResponse({"error": {"code": "internal_error", "message": "Unexpected server error."}}, status_code=500)

    error_responses = {404: {"model": ErrorResponse, "description": "Unknown site, or the requested data is not loaded"},
                       422: {"model": ErrorResponse, "description": "Invalid parameter, or a time outside the data coverage"}}
    for module in (system, sites, ephemeris, visibility, cost, compare):
        app.include_router(module.router, prefix=API_PREFIX, responses=error_responses)
    return app


app = create_app()
