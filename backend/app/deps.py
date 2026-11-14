"""Request dependencies shared by the routers."""
from __future__ import annotations

from typing import Iterator

from fastapi import Depends, Request
from sqlitedb import Connection

from .config import Settings
from .db import Database


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_conn(db: Database = Depends(get_db)) -> Iterator[Connection]:
    conn = db.connect()
    try:
        yield conn
    finally:
        conn.close()


def sources_for(horizon_model: str, cost: bool = False) -> list[str]:
    """Which data sources stand behind a response."""
    used = ["jpl_horizons"]
    if horizon_model == "lola_mask":
        used.append("lola_ldem_80s_80m")
    if cost:
        used += ["stargazer_cost_model", "clps_public_awards"]
    return used
