"""Sun and Earth positions: hourly samples and single-time lookups."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlitedb import Connection

import derive

from ..config import Settings
from ..db import Database
from ..deps import get_conn, get_db, get_settings, sources_for
from ..schemas import Body, EphemerisResponse, HorizonModel, PositionResponse
from ..services import data

router = APIRouter(tags=["ephemeris"])
COLUMNS = ["t_utc", "azimuth_deg", "elevation_deg", "skyline_elevation_deg", "clearance_deg", "is_visible"]
AT_HELP = "ISO 8601 UTC time inside the data coverage, e.g. 2026-12-15T06:30:00Z"


@router.get("/sites/{site_id}/ephemeris", response_model=EphemerisResponse,
            summary="Hourly azimuth, elevation, skyline, clearance and visibility for one body")
def get_ephemeris(site_id: str,
                  body: Body = Query("sun"),
                  start: Optional[str] = Query(None, description="ISO 8601 UTC. Default: start of coverage"),
                  end: Optional[str] = Query(None, description="ISO 8601 UTC. Default: end of coverage"),
                  step: int = Query(1, ge=1, le=720, description="Keep every step-th hourly sample (a whole number of hours)"),
                  horizon_model: HorizonModel = Query("lola_mask"),
                  format: Literal["rows", "columns", "csv"] = Query("rows", description="columns suits pandas.DataFrame; csv is a download"),
                  limit: Optional[int] = Query(None, ge=1, description="Rows per page (capped by the server, 3000 by default)"),
                  offset: int = Query(0, ge=0),
                  db: Database = Depends(get_db), conn: Connection = Depends(get_conn),
                  settings: Settings = Depends(get_settings)):
    data.get_site(conn, site_id)
    run = data.get_run(conn, site_id)
    analysis = data.get_analysis(conn, site_id, horizon_model)
    rng = data.resolve_range(run, start, end)
    limit = min(limit or settings.max_rows, settings.max_rows)
    rows, total = data.ephemeris_rows(conn, run, analysis, body, rng["start"], rng["end"], step, limit, offset)
    if format == "csv":
        return Response(data.to_csv(rows, COLUMNS), media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="{site_id}_{body}_{horizon_model}.csv"',
            "X-Horizon-Model": horizon_model, "X-Total-Rows": str(total)})
    next_offset = offset + len(rows) if offset + len(rows) < total else None
    out = {"site_id": site_id, "body": body, "step_hours": step * run["step_seconds"] // 3600,
           "range": {"start_utc": derive.epoch_to_iso(rng["start"]), "end_utc": derive.epoch_to_iso(rng["end"])},
           "page": {"returned": len(rows), "total": total, "limit": limit, "offset": offset, "next_offset": next_offset},
           "meta": data.build_meta(db, horizon_model=horizon_model, mask_interpolation=analysis["mask_interpolation"],
                                   site_ids=[site_id], sources=sources_for(horizon_model))}
    if format == "columns":
        out["columns"] = data.to_columns(rows, COLUMNS)
    else:
        out["rows"] = rows
    return out


def _position(site_id: str, body: str, at: str, horizon_model: str, db: Database, conn: Connection) -> dict:
    data.get_site(conn, site_id)
    run = data.get_run(conn, site_id)
    analysis = data.get_analysis(conn, site_id, horizon_model)
    out = data.position(conn, run, analysis, body, data.parse_time(at, "at"))
    out["site_id"] = site_id
    out["meta"] = data.build_meta(db, horizon_model=horizon_model, mask_interpolation=analysis["mask_interpolation"],
                                  site_ids=[site_id], sources=sources_for(horizon_model))
    return out


@router.get("/sites/{site_id}/solar-elevation", response_model=PositionResponse,
            summary="Sun elevation, azimuth, skyline and clearance at one time")
def get_solar_elevation(site_id: str, at: str = Query(..., description=AT_HELP),
                        horizon_model: HorizonModel = Query("lola_mask"),
                        db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    return _position(site_id, "sun", at, horizon_model, db, conn)


@router.get("/sites/{site_id}/position", response_model=PositionResponse,
            summary="Sun or Earth azimuth, elevation, skyline and clearance at one time")
def get_position(site_id: str, at: str = Query(..., description=AT_HELP), body: Body = Query("sun"),
                 horizon_model: HorizonModel = Query("lola_mask"),
                 db: Database = Depends(get_db), conn: Connection = Depends(get_conn)):
    return _position(site_id, body, at, horizon_model, db, conn)
