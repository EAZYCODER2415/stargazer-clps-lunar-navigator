"""Settings for the Stargazer API. Every value can be overridden with an environment variable."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
API_PREFIX = "/api/v1"
API_VERSION = "1.0.0"


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # STARGAZER_DATABASE_URL: sqlite:///path/to/stargazer.db or a plain file path (the default), or
    # postgresql://user:password@host/database for a hosted copy (see docs/NEON.md). Always read-only.
    database_url: str = field(default_factory=lambda: os.environ.get(
        "STARGAZER_DATABASE_URL", f"sqlite:///{(BACKEND_DIR / 'data' / 'stargazer.db').as_posix()}"))
    # STARGAZER_CORS_ORIGINS: comma-separated origins allowed to call the API from a browser.
    cors_origins: list[str] = field(default_factory=lambda: _split(os.environ.get(
        "STARGAZER_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")))
    # STARGAZER_MAX_ROWS: most rows one response may carry.
    max_rows: int = field(default_factory=lambda: int(os.environ.get("STARGAZER_MAX_ROWS", "3000")))
    # STARGAZER_CACHE_MAX_AGE: seconds a browser may reuse a response (the data never changes within a build).
    cache_max_age: int = field(default_factory=lambda: int(os.environ.get("STARGAZER_CACHE_MAX_AGE", "3600")))


def get_settings() -> Settings:
    return Settings()
